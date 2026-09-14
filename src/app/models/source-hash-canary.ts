// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { NativeUnitFormat } from '../services/unit-catalog/unit-catalog.types';
import { sha1Base64Url } from '../utils/sha1.util';
import { BuildingBlock } from './entity/parsers/building-block';
import { isMtfLocationHeader, isNativeFluffField } from './entity/parsers/entity-fluff-parser';
import { extractNativeUnitArtwork } from './entity/native-unit-artwork';

declare const sourceHashCanaryBrand: unique symbol;

/** Four leading base64url hash characters: a compact 24-bit change canary. */
export type SourceHashCanary = string & {
    readonly [sourceHashCanaryBrand]: 'SourceHashCanary';
};

export const SOURCE_HASH_CANARY_LENGTH = 4;

const SOURCE_HASH_CANARY_PATTERN = /^[A-Za-z0-9_-]{4}$/u;

export function asSourceHashCanary(value: string): SourceHashCanary {
    if (!SOURCE_HASH_CANARY_PATTERN.test(value)) {
        throw new Error('Invalid source hash canary');
    }
    return value as SourceHashCanary;
}

export function sourceHashCanary(sourceHash: string): SourceHashCanary | undefined {
    const prefix = sourceHash.slice(0, SOURCE_HASH_CANARY_LENGTH);
    return SOURCE_HASH_CANARY_PATTERN.test(prefix)
        ? prefix as SourceHashCanary
        : undefined;
}

export function sourceHashCanaryChanged(
    saved: SourceHashCanary | undefined,
    current: SourceHashCanary | undefined,
): boolean {
    return saved !== undefined && current !== undefined && current !== saved;
}

/** Shared by generated summaries, runtime restores, and custom-unit saves. */
export async function nativeSourceHashCanary(source: string, format: NativeUnitFormat): Promise<SourceHashCanary> {
    source = extractNativeUnitArtwork(source, format).source;
    const ignoredField = (key: string) => key === 'generator' || key === 'iconpath' || isNativeFluffField(key, format);
    let inMtfSection = false;
    const normalized = format === 'blk'
        ? JSON.stringify(new BuildingBlock(source).sourceDocument.nodes.flatMap(node => {
            if (node.kind === 'blank' || node.kind === 'comment') return [];
            if (node.kind === 'block') {
                return ignoredField(node.normalizedTag) ? [] : [[node.normalizedTag, node.values]];
            }
            return [[node.raw.trim()]];
        }))
        : source.split(/\r\n|\n|\r/u).map(line => line.trim())
            .filter(line => {
                if (line === '' || line.startsWith('#')) {
                    inMtfSection = false;
                    return !line.startsWith('#');
                }
                if (isMtfLocationHeader(line) || /^weapons\s*:/iu.test(line)) inMtfSection = true;
                if (inMtfSection) return true;
                const separator = line.indexOf(':');
                return separator <= 0 || !ignoredField(line.slice(0, separator).trim().toLowerCase());
            })
            .join('\n').trim();
    return sourceHashCanary(await sha1Base64Url(new TextEncoder().encode(normalized)))!;
}
