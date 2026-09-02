// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem } from './common.model';
import { asUnitUuid, type UnitUuid } from '../services/unit-catalog/unit-catalog.types';
import {
    FORCE_LIST_ENTRY_INDEX,
    FORCE_LIST_FORMAT_VERSION,
    FORCE_LIST_GROUP_INDEX,
    FORCE_LIST_GROUP_METADATA_FIELD,
    FORCE_LIST_METADATA_FIELD,
    FORCE_LIST_SYSTEM_CODE,
    FORCE_LIST_UNIT_INDEX,
    FORCE_LIST_UNIT_METADATA_FIELD,
} from './runtime/force-storage-vocabulary';

export interface RemoteLoadForceUnit {
    unit?: string;
    uuid?: UnitUuid;
    alias?: string;
    skill?: number;
    g?: number; // gunnery
    p?: number; // piloting
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
    groups?: RemoteLoadForceGroup[];
}

/** V2 server list row: [2,id,time,system(0 CBT/1 AS),name,groups,metadata?]. */
export type RemoteLoadForceWireEntry = RemoteLoadForceEntry | readonly unknown[];

export function decodeRemoteLoadForceEntry(value: RemoteLoadForceWireEntry): RemoteLoadForceEntry {
    if (!Array.isArray(value)) {
        const entry = value as RemoteLoadForceEntry;
        return { ...entry, version: entry.version ?? 1 };
    }
    if (value[FORCE_LIST_ENTRY_INDEX.revision] !== FORCE_LIST_FORMAT_VERSION
        || typeof value[FORCE_LIST_ENTRY_INDEX.instanceId] !== 'string'
        || (typeof value[FORCE_LIST_ENTRY_INDEX.timestamp] !== 'number'
            && typeof value[FORCE_LIST_ENTRY_INDEX.timestamp] !== 'string')
        || (value[FORCE_LIST_ENTRY_INDEX.system] !== FORCE_LIST_SYSTEM_CODE.classicBattleTech
            && value[FORCE_LIST_ENTRY_INDEX.system] !== FORCE_LIST_SYSTEM_CODE.alphaStrike)
        || typeof value[FORCE_LIST_ENTRY_INDEX.name] !== 'string'
        || !Array.isArray(value[FORCE_LIST_ENTRY_INDEX.groups])) {
        throw new Error('Invalid compact force-list entry');
    }
    const instanceId = value[FORCE_LIST_ENTRY_INDEX.instanceId] as string;
    const rawTimestamp = value[FORCE_LIST_ENTRY_INDEX.timestamp] as string | number;
    const name = value[FORCE_LIST_ENTRY_INDEX.name] as string;
    const rawGroups = value[FORCE_LIST_ENTRY_INDEX.groups] as unknown[];
    const system = value[FORCE_LIST_ENTRY_INDEX.system] === FORCE_LIST_SYSTEM_CODE.classicBattleTech
        ? GameSystem.CBT
        : GameSystem.AS;
    const metadata = optionalRecord(
        value[FORCE_LIST_ENTRY_INDEX.metadata],
        'force-list metadata',
    );
    const note = metadata?.[FORCE_LIST_METADATA_FIELD.note];
    const tags = metadata?.[FORCE_LIST_METADATA_FIELD.tags];
    const factionId = metadata?.[FORCE_LIST_METADATA_FIELD.factionId];
    const eraId = metadata?.[FORCE_LIST_METADATA_FIELD.eraId];
    const battleValue = metadata?.[FORCE_LIST_METADATA_FIELD.battleValue];
    const pointValue = metadata?.[FORCE_LIST_METADATA_FIELD.pointValue];
    const owned = metadata?.[FORCE_LIST_METADATA_FIELD.owned];
    return {
        version: FORCE_LIST_FORMAT_VERSION,
        instanceId,
        timestamp: typeof rawTimestamp === 'number'
            ? new Date(rawTimestamp).toISOString()
            : rawTimestamp,
        type: system,
        name,
        ...(typeof note === 'string' ? { note } : {}),
        ...(Array.isArray(tags) ? {
            tags: tags.filter((tag): tag is string => typeof tag === 'string'),
        } : {}),
        ...(typeof factionId === 'number' ? { factionId } : {}),
        ...(typeof eraId === 'number' ? { eraId } : {}),
        ...(typeof battleValue === 'number' ? { bv: battleValue } : {}),
        ...(typeof pointValue === 'number' ? { pv: pointValue } : {}),
        ...(owned === 0
            ? { owned: false }
            : owned === 1
                ? { owned: true }
                : {}),
        groups: rawGroups.map((group, index) => decodeCompactGroup(group, system, index)),
    };
}

function decodeCompactGroup(value: unknown, system: GameSystem, index: number): RemoteLoadForceGroup {
    if (!Array.isArray(value) || !Array.isArray(value[FORCE_LIST_GROUP_INDEX.units])) {
        throw new Error(`Invalid compact force-list group ${index}`);
    }
    const rawUnits = value[FORCE_LIST_GROUP_INDEX.units] as unknown[];
    const metadata = optionalRecord(
        value[FORCE_LIST_GROUP_INDEX.metadata],
        `force-list group ${index} metadata`,
    );
    const name = metadata?.[FORCE_LIST_GROUP_METADATA_FIELD.name];
    const formationId = metadata?.[FORCE_LIST_GROUP_METADATA_FIELD.formationId];
    return {
        ...(typeof name === 'string' ? { name } : {}),
        ...(typeof formationId === 'string' ? { formationId } : {}),
        units: rawUnits.map((unit, unitIndex) =>
            decodeCompactUnit(unit, system, index, unitIndex)),
    };
}

function decodeCompactUnit(
    value: unknown,
    system: GameSystem,
    groupIndex: number,
    unitIndex: number,
): RemoteLoadForceUnit {
    if (!Array.isArray(value) || typeof value[FORCE_LIST_UNIT_INDEX.catalogUuid] !== 'string') {
        throw new Error(`Invalid compact force-list unit ${groupIndex}:${unitIndex}`);
    }
    const catalogUuid = value[FORCE_LIST_UNIT_INDEX.catalogUuid] as string;
    const metadataPath = `force-list unit ${groupIndex}:${unitIndex} metadata`;
    const metadata = optionalRecord(value[FORCE_LIST_UNIT_INDEX.metadata], metadataPath);
    exactOptionalKeys(metadata, Object.values(FORCE_LIST_UNIT_METADATA_FIELD), metadataPath);
    const alias = metadata?.[FORCE_LIST_UNIT_METADATA_FIELD.alias];
    const skill = metadata?.[FORCE_LIST_UNIT_METADATA_FIELD.alphaStrikeSkill];
    const gunnery = metadata?.[FORCE_LIST_UNIT_METADATA_FIELD.gunnery];
    const piloting = metadata?.[FORCE_LIST_UNIT_METADATA_FIELD.piloting];
    return {
        uuid: expandCompactUuid(catalogUuid),
        ...(typeof alias === 'string' ? { alias } : {}),
        ...(typeof skill === 'number'
            ? { skill }
            : system === GameSystem.AS ? { skill: 4 } : {}),
        ...(typeof gunnery === 'number' ? { g: gunnery } : {}),
        ...(typeof piloting === 'number' ? { p: piloting } : {}),
        ...(compactTrue(
            metadata?.[FORCE_LIST_UNIT_METADATA_FIELD.commander],
            `${metadataPath}.${FORCE_LIST_UNIT_METADATA_FIELD.commander}`,
        ) ? { commander: true } : {}),
        state: {
            destroyed: compactTrue(
                metadata?.[FORCE_LIST_UNIT_METADATA_FIELD.destroyed],
                `${metadataPath}.${FORCE_LIST_UNIT_METADATA_FIELD.destroyed}`,
            ),
        },
    };
}

function compactTrue(value: unknown, path: string): boolean {
    if (value === undefined) return false;
    if (value !== 1) throw new Error(`Invalid ${path}`);
    return true;
}

function exactOptionalKeys(
    value: Record<string, unknown> | undefined,
    allowed: readonly string[],
    path: string,
): void {
    if (value === undefined) return;
    const allowedKeys = new Set(allowed);
    const unknown = Object.keys(value).find(key => !allowedKeys.has(key));
    if (unknown !== undefined) throw new Error(`Invalid ${path}.${unknown}`);
}

function optionalRecord(value: unknown, path: string): Record<string, unknown> | undefined {
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${path}`);
    return value as Record<string, unknown>;
}

function expandCompactUuid(value: string): UnitUuid {
    if (!/^[A-Za-z0-9_-]{22}$/u.test(value)) throw new Error('Invalid compact force-list UUID');
    let bytes: string;
    try {
        bytes = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '==');
    } catch {
        throw new Error('Invalid compact force-list UUID');
    }
    if (bytes.length !== 16) throw new Error('Invalid compact force-list UUID');
    const hex = Array.from(bytes, byte => byte.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    return asUnitUuid([
        hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
        hex.slice(16, 20), hex.slice(20),
    ].join('-'));
}
