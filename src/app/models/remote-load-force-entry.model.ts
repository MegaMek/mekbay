// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem } from './common.model';
import { asUnitUuid, type UnitUuid } from '../services/unit-catalog/unit-catalog.types';

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
    if (value[0] !== 2 || typeof value[1] !== 'string'
        || (typeof value[2] !== 'number' && typeof value[2] !== 'string')
        || (value[3] !== 0 && value[3] !== 1)
        || typeof value[4] !== 'string'
        || !Array.isArray(value[5])) {
        throw new Error('Invalid compact force-list entry');
    }
    const system = value[3] === 0 ? GameSystem.CBT : GameSystem.AS;
    const metadata = optionalRecord(value[6], 'force-list metadata');
    return {
        version: 2,
        instanceId: value[1],
        timestamp: typeof value[2] === 'number' ? new Date(value[2]).toISOString() : value[2],
        type: system,
        name: value[4],
        ...(typeof metadata?.['n'] === 'string' ? { note: metadata['n'] } : {}),
        ...(Array.isArray(metadata?.['t']) ? {
            tags: metadata['t'].filter((tag): tag is string => typeof tag === 'string'),
        } : {}),
        ...(typeof metadata?.['f'] === 'number' ? { factionId: metadata['f'] } : {}),
        ...(typeof metadata?.['e'] === 'number' ? { eraId: metadata['e'] } : {}),
        ...(typeof metadata?.['b'] === 'number' ? { bv: metadata['b'] } : {}),
        ...(typeof metadata?.['p'] === 'number' ? { pv: metadata['p'] } : {}),
        ...(metadata?.['o'] === 0 ? { owned: false } : metadata?.['o'] === 1 ? { owned: true } : {}),
        groups: value[5].map((group, index) => decodeCompactGroup(group, system, index)),
    };
}

function decodeCompactGroup(value: unknown, system: GameSystem, index: number): RemoteLoadForceGroup {
    if (!Array.isArray(value) || !Array.isArray(value[0])) {
        throw new Error(`Invalid compact force-list group ${index}`);
    }
    const metadata = optionalRecord(value[1], `force-list group ${index} metadata`);
    return {
        ...(typeof metadata?.['n'] === 'string' ? { name: metadata['n'] } : {}),
        ...(typeof metadata?.['f'] === 'string' ? { formationId: metadata['f'] } : {}),
        units: value[0].map((unit, unitIndex) => decodeCompactUnit(unit, system, index, unitIndex)),
    };
}

function decodeCompactUnit(
    value: unknown,
    system: GameSystem,
    groupIndex: number,
    unitIndex: number,
): RemoteLoadForceUnit {
    if (!Array.isArray(value) || typeof value[0] !== 'string') {
        throw new Error(`Invalid compact force-list unit ${groupIndex}:${unitIndex}`);
    }
    const metadata = optionalRecord(value[1], `force-list unit ${groupIndex}:${unitIndex} metadata`);
    const flags = typeof metadata?.['x'] === 'number' ? metadata['x'] : 0;
    return {
        uuid: expandCompactUuid(value[0]),
        ...(typeof metadata?.['a'] === 'string' ? { alias: metadata['a'] } : {}),
        ...(typeof metadata?.['s'] === 'number'
            ? { skill: metadata['s'] }
            : system === GameSystem.AS ? { skill: 4 } : {}),
        ...(typeof metadata?.['g'] === 'number' ? { g: metadata['g'] } : {}),
        ...(typeof metadata?.['p'] === 'number' ? { p: metadata['p'] } : {}),
        ...((flags & 1) !== 0 ? { commander: true } : {}),
        state: { destroyed: (flags & 2) !== 0 },
    };
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
