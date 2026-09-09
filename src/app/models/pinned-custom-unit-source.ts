// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { MAX_UNIT_SOURCE_BYTES } from '../services/unit-catalog/core-unit-manifest';
import type { NativeUnitFormat } from '../services/unit-catalog/unit-catalog.types';

/** Exact custom design used by one saved force instance; core catalog sources stay external. */
export interface PinnedCustomUnitSource {
    readonly format: NativeUnitFormat;
    readonly source: string;
}

/** Wire shape/size boundary. Native identity and format are checked by the source loader. */
export function decodePinnedCustomUnitSource(value: unknown): PinnedCustomUnitSource {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid pinned custom source');
    const record = value as Record<string, unknown>;
    if (Object.keys(record).some(key => key !== 'format' && key !== 'source')
        || (record['format'] !== 'mtf' && record['format'] !== 'blk')
        || typeof record['source'] !== 'string' || !record['source'].trim()
        || new TextEncoder().encode(record['source']).byteLength > MAX_UNIT_SOURCE_BYTES) {
        throw new Error('Invalid pinned custom source');
    }
    return Object.freeze({ format: record['format'], source: record['source'] });
}
