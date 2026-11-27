// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { MAX_UNIT_SOURCE_BYTES } from '../services/unit-catalog/core-unit-manifest';
import type { NativeUnitFormat } from '../services/unit-catalog/unit-catalog.types';

/** Sprite catalog key only; the tuple never contains image bytes. */
export type CustomDesignPreview = readonly [chassis: string, model: string, clanName: string, icon: string];

export function decodeCustomDesignPreview(value: unknown): CustomDesignPreview {
    if (!Array.isArray(value) || value.length !== 4
        || value.some(field => typeof field !== 'string' || field.length > 512 || field.includes('\0'))
        || value[3].includes(':')) {
        throw new Error('Invalid custom design preview');
    }
    return Object.freeze([...value]) as unknown as CustomDesignPreview;
}

/** Exact custom design used by one saved force instance; core catalog sources stay external. */
export interface PinnedCustomUnitSource {
    readonly format: NativeUnitFormat;
    readonly source: string;
    readonly preview?: CustomDesignPreview;
}

/** Wire shape/size boundary. Native identity and format are checked by the source loader. */
export function decodePinnedCustomUnitSource(value: unknown): PinnedCustomUnitSource {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid pinned custom source');
    const record = value as Record<string, unknown>;
    if (Object.keys(record).some(key => key !== 'format' && key !== 'source' && key !== 'preview')
        || (record['format'] !== 'mtf' && record['format'] !== 'blk')
        || typeof record['source'] !== 'string' || !record['source'].trim()
        || new TextEncoder().encode(record['source']).byteLength > MAX_UNIT_SOURCE_BYTES) {
        throw new Error('Invalid pinned custom source');
    }
    return Object.freeze({ format: record['format'], source: record['source'],
        ...(record['preview'] === undefined ? {} : { preview: decodeCustomDesignPreview(record['preview']) }) });
}
