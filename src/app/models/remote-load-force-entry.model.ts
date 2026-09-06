// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { GameSystem } from './common.model';
import { asUnitUuid, type UnitUuid } from '../services/unit-catalog/unit-catalog.types';
import { unpackUuid } from './runtime/compact-uuid';

export interface RemoteLoadForceUnit {
    unit?: string;
    uuid?: UnitUuid;
    alias?: string;
    skill?: number;
    g?: number;
    p?: number;
    commander?: boolean;
    state?: { destroyed?: boolean };
}

export interface RemoteLoadForceGroup {
    name?: string;
    formationId?: string;
    units: RemoteLoadForceUnit[];
}

export interface RemoteLoadForceEntry {
    version?: 1 | 2;
    instanceId: string;
    timestamp: string;
    type?: GameSystem;
    owned?: boolean;
    name: string;
    note?: string;
    tags?: string[];
    factionId?: number;
    eraId?: number;
    bv?: number;
    pv?: number;
    reserveCount?: number;
    groups?: RemoteLoadForceGroup[];
}

/** List-only tuple: absent details mean an occupied station with default skills. */
export type RemoteLoadForceListUnitV2 = readonly [uuid: string, details?: {
    readonly name?: string;
    readonly skill?: number;
    readonly g?: number;
    readonly p?: number;
    readonly commander?: true;
    readonly destroyed?: true;
    readonly vacant?: true;
}];

export interface RemoteLoadForceListGroupV2 {
    readonly name?: string;
    readonly formationId?: string;
    readonly units: readonly RemoteLoadForceListUnitV2[];
}

/** A transport summary built from projected headers; never stored as force data. */
export interface RemoteLoadForceListEntryV2 extends Omit<RemoteLoadForceEntry, 'version' | 'timestamp' | 'type' | 'groups'> {
    readonly version: 2;
    readonly timestamp: number;
    readonly type: GameSystem;
    readonly groups: readonly RemoteLoadForceListGroupV2[];
}

export type RemoteLoadForceWireEntry = RemoteLoadForceEntry | RemoteLoadForceListEntryV2;

/** Reads only preview facts, from cloud or an IndexedDB record. */
export function decodeRemoteLoadForceEntry(value: unknown): RemoteLoadForceEntry {
    const root = record(value, 'force list entry');
    const version = root['version'] ?? 1;
    if (version !== 1 && version !== 2) throw new Error('Unsupported force-list version');
    if (typeof root['instanceId'] !== 'string' || typeof root['name'] !== 'string'
        || (typeof root['timestamp'] !== 'string' && typeof root['timestamp'] !== 'number')) {
        throw new Error('Invalid force-list metadata');
    }
    const type = root['type'] === GameSystem.AS ? GameSystem.AS : GameSystem.CBT;
    const timestamp = typeof root['timestamp'] === 'number'
        ? new Date(root['timestamp']).toISOString() : root['timestamp'];
    let reserveCount = 0;
    if (version === 2) {
        reserveCount = Array.isArray(root['personnel']) ? root['personnel'].length : 0;
        if (Number.isSafeInteger(root['reserveCount']) && (root['reserveCount'] as number) >= 0) {
            reserveCount = root['reserveCount'] as number;
        }
    }
    return {
        version,
        instanceId: root['instanceId'],
        timestamp,
        type,
        name: root['name'],
        ...(typeof root['note'] === 'string' ? { note: root['note'] } : {}),
        ...(Array.isArray(root['tags']) ? {
            tags: root['tags'].filter((tag): tag is string => typeof tag === 'string'),
        } : {}),
        ...(typeof root['factionId'] === 'number' ? { factionId: root['factionId'] } : {}),
        ...(typeof root['eraId'] === 'number' ? { eraId: root['eraId'] } : {}),
        ...(typeof root['bv'] === 'number' ? { bv: root['bv'] } : {}),
        ...(typeof root['pv'] === 'number' ? { pv: root['pv'] } : {}),
        ...(typeof root['owned'] === 'boolean' ? { owned: root['owned'] } : {}),
        reserveCount,
        groups: version === 1 ? legacyGroups(root)
            : root['units'] === undefined ? currentListGroups(root, type) : storedGroups(root, type),
    };
}

function currentListGroups(root: Record<string, unknown>, system: GameSystem): RemoteLoadForceGroup[] {
    return array(root['groups'], 'force.groups').map(value => {
        const group = record(value, 'force group');
        return {
            ...(typeof group['name'] === 'string' ? { name: group['name'] } : {}),
            ...(typeof group['formationId'] === 'string' ? { formationId: group['formationId'] } : {}),
            units: array(group['units'], 'force group units').map(value => currentListUnit(value, system)),
        };
    });
}

function currentListUnit(value: unknown, system: GameSystem): RemoteLoadForceUnit {
    const row = array(value, 'force-list unit');
    if (row.length < 1 || row.length > 2 || typeof row[0] !== 'string') {
        throw new Error('Invalid force-list unit tuple');
    }
    const details = row.length === 1 ? undefined : record(row[1], 'force-list unit details');
    if (details !== undefined) {
        if (details['name'] !== undefined && typeof details['name'] !== 'string') {
            throw new Error('Invalid force-list unit name');
        }
        for (const key of ['skill', 'g', 'p']) {
            if (details[key] !== undefined && (typeof details[key] !== 'number' || !Number.isFinite(details[key]))) {
                throw new Error('Invalid force-list unit ' + key);
            }
        }
        for (const key of ['commander', 'destroyed', 'vacant']) {
            if (details[key] !== undefined && typeof details[key] !== 'boolean') {
                throw new Error('Invalid force-list unit ' + key);
            }
        }
    }
    const unit: RemoteLoadForceUnit = {
        uuid: asUnitUuid(unpackUuid(row[0], 'force-list unit UUID')),
        state: { destroyed: details?.['destroyed'] === true },
    };
    if (details?.['vacant'] === true) return unit;
    if (typeof details?.['name'] === 'string') unit.alias = details['name'];
    if (system === GameSystem.AS) unit.skill = (details?.['skill'] as number | undefined) ?? 4;
    else {
        unit.g = (details?.['g'] as number | undefined) ?? 4;
        unit.p = (details?.['p'] as number | undefined) ?? 5;
    }
    if (details?.['commander'] === true) unit.commander = true;
    return unit;
}

/** Local IndexedDB records expose the same preview facts without decoding runtime state. */
function storedGroups(root: Record<string, unknown>, system: GameSystem): RemoteLoadForceGroup[] {
    const units = array(root['units'], 'force.units').map((value, index): RemoteLoadForceUnit => {
        const unit = record(value, 'force.units[' + index + ']');
        if (typeof unit['uuid'] !== 'string') throw new Error('Missing force-list unit UUID');
        let g: number | undefined;
        let p: number | undefined;
        let pilot: Record<string, unknown> | undefined;
        let commander = false;
        if (unit['crew'] !== undefined) {
            for (const rawPerson of array(unit['crew'], 'force unit crew')) {
                if (rawPerson === null) continue;
                const person = record(rawPerson, 'force-list crew person');
                pilot ??= person;
                commander ||= person['commander'] === true;
                const gunnery = typeof person['g'] === 'number' ? person['g'] : 4;
                const piloting = typeof person['p'] === 'number' ? person['p'] : 5;
                g = g === undefined ? gunnery : Math.min(g, gunnery);
                p = p === undefined ? piloting : Math.min(p, piloting);
            }
        }
        return {
            uuid: asUnitUuid(unpackUuid(unit['uuid'], 'force.units[' + index + '].uuid')),
            ...(typeof pilot?.['name'] === 'string' ? { alias: pilot['name'] } : {}),
            ...(system === GameSystem.AS ? {
                ...(pilot ? { skill: typeof pilot['g'] === 'number' ? pilot['g'] : 4 } : {}),
            } : { ...(g === undefined ? {} : { g }), ...(p === undefined ? {} : { p }) }),
            ...(commander ? { commander: true } : {}),
            state: { destroyed: unit['destroyed'] === true },
        };
    });
    return array(root['groups'], 'force.groups').map(value => {
        const group = record(value, 'force group');
        return {
            ...(typeof group['name'] === 'string' ? { name: group['name'] } : {}),
            ...(typeof group['formationId'] === 'string' ? { formationId: group['formationId'] } : {}),
            units: array(group['unitIndices'], 'force group unitIndices').map(index => {
                if (!Number.isSafeInteger(index) || (index as number) < 0 || !units[index as number]) {
                    throw new Error('Force-list group references a missing unit');
                }
                return units[index as number]!;
            }),
        };
    });
}

/** Legacy previews never migrate, materialize, or overwrite a unit. */
function legacyGroups(root: Record<string, unknown>): RemoteLoadForceGroup[] {
    return array(root['groups'] ?? [], 'legacy force groups').map(value => {
        const group = record(value, 'legacy force group');
        return {
            ...(typeof group['name'] === 'string' ? { name: group['name'] } : {}),
            ...(typeof group['formationId'] === 'string' ? { formationId: group['formationId'] } : {}),
            units: array(group['units'] ?? [], 'legacy group units').map(value => {
                const unit = isRecord(value) ? value : {};
                const state = isRecord(unit['state']) ? unit['state'] : {};
                const crew = Array.isArray(state['crew']) ? state['crew'] : [];
                const pilot = isRecord(crew[0]) ? crew[0] : {};
                const gunner = isRecord(crew[1]) ? crew[1] : pilot;
                const g = unit['g'] ?? gunner['gunnerySkill'];
                const p = unit['p'] ?? pilot['pilotingSkill'];
                return {
                    ...(typeof unit['unit'] === 'string' ? { unit: unit['unit'] } : {}),
                    ...(typeof unit['alias'] === 'string' ? { alias: unit['alias'] } : {}),
                    ...(typeof unit['skill'] === 'number' ? { skill: unit['skill'] } : {}),
                    ...(typeof g === 'number' ? { g } : {}),
                    ...(typeof p === 'number' ? { p } : {}),
                    ...(unit['commander'] === true ? { commander: true } : {}),
                    state: { destroyed: state['destroyed'] === true },
                };
            }),
        };
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function record(value: unknown, path: string): Record<string, unknown> {
    if (!isRecord(value)) throw new Error('Invalid ' + path);
    return value;
}
function array(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) throw new Error('Invalid ' + path);
    return value;
}
