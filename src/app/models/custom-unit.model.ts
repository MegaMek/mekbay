// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asUnitUuid, type NativeUnitFormat, type UnitUuid } from '../services/unit-catalog/unit-catalog.types';
import { MAX_UNIT_SOURCE_BYTES } from '../services/unit-catalog/core-unit-manifest';

/** Native construction facts only; summaries, rules and runtime state are derived. */
export interface SavedCustomUnit {
    readonly schemaVersion: 1;
    readonly uuid: UnitUuid;
    readonly originalUnitUuid?: UnitUuid;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly format: NativeUnitFormat;
    readonly source: string;
}

/** Decode untrusted IndexedDB data at its owning boundary. Native content is parsed separately. */
export function decodeSavedCustomUnit(value: unknown): SavedCustomUnit {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid custom unit record');
    const record = value as Record<string, unknown>;
    if (record['schemaVersion'] !== 1
        || typeof record['uuid'] !== 'string'
        || (record['originalUnitUuid'] !== undefined && typeof record['originalUnitUuid'] !== 'string')
        || (record['format'] !== 'mtf' && record['format'] !== 'blk')
        || typeof record['source'] !== 'string'
        || !record['source'].trim()
        || new TextEncoder().encode(record['source']).byteLength > MAX_UNIT_SOURCE_BYTES
        || typeof record['createdAt'] !== 'number' || !Number.isFinite(record['createdAt'])
        || typeof record['updatedAt'] !== 'number' || !Number.isFinite(record['updatedAt'])) {
        throw new Error('Invalid custom unit record');
    }
    const uuid = asUnitUuid(record['uuid']);
    const originalUnitUuid = record['originalUnitUuid'] === undefined
        ? undefined : asUnitUuid(record['originalUnitUuid']);
    if (originalUnitUuid === uuid) throw new Error('A custom unit cannot be its own original model');
    return Object.freeze({
        schemaVersion: 1, uuid,
        ...(originalUnitUuid ? { originalUnitUuid } : {}),
        createdAt: record['createdAt'], updatedAt: record['updatedAt'],
        format: record['format'], source: record['source'],
    });
}
