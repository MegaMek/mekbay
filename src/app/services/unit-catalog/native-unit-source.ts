// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { type CoreUnitManifestEntry, MAX_UNIT_SOURCE_BYTES } from './core-unit-manifest';
import {
    asUnitUuid,
    NativeUnitFormat,
    parseUnitFileName,
    StoredCoreContent,
    UnitUuid,
} from './unit-catalog.types';

export class NativeUnitSourceValidationError extends Error {
    public constructor(
        public readonly code: 'size' | 'encoding' | 'uuid' | 'format',
        message: string,
    ) {
        super(message);
        this.name = 'NativeUnitSourceValidationError';
    }
}

function copyBytes(source: ArrayBuffer | ArrayBufferView): ArrayBuffer {
    const view = ArrayBuffer.isView(source)
        ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
        : new Uint8Array(source);
    return view.slice().buffer;
}

function canonicalizeEmbeddedUuid(value: string): UnitUuid {
    try {
        return asUnitUuid(value.toLowerCase());
    } catch (error) {
        throw new NativeUnitSourceValidationError('uuid', String(error));
    }
}

function decodeUtf8(bytes: ArrayBuffer): string {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        throw new NativeUnitSourceValidationError('encoding', 'Native unit source is not valid UTF-8');
    }
}

function extractMtfUuid(raw: string): UnitUuid {
    if (/<\/?UnitType>/iu.test(raw)) {
        throw new NativeUnitSourceValidationError('format', 'BLK tag syntax cannot be stored as MTF');
    }
    const values: string[] = [];
    let hasChassis = false;
    for (const line of raw.split(/\r?\n/u)) {
        const separator = line.indexOf(':');
        if (separator <= 0) {
            continue;
        }
        const key = line.slice(0, separator).trim().toLowerCase();
        const value = line.slice(separator + 1).trim();
        if (key === 'uuid') {
            values.push(value);
        } else if (key === 'unittype' || key === 'unit type') {
            throw new NativeUnitSourceValidationError('format', 'Explicit non-MTF unit type found in MTF source');
        } else if (key === 'chassis' && value.length > 0) {
            hasChassis = true;
        }
    }
    if (values.length !== 1 || !hasChassis) {
        throw new NativeUnitSourceValidationError('format', 'MTF must contain exactly one UUID and a chassis');
    }
    return canonicalizeEmbeddedUuid(values[0]);
}

function taggedValues(raw: string, tag: string): string[] {
    const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const pattern = new RegExp(`<${escapedTag}>\\s*([^<]*?)\\s*</${escapedTag}>`, 'giu');
    return [...raw.matchAll(pattern)].map((match) => match[1].trim());
}

function extractBlkUuid(raw: string): UnitUuid {
    const uuidValues = taggedValues(raw, 'UUID');
    const unitTypes = taggedValues(raw, 'UnitType');
    if (uuidValues.length !== 1 || unitTypes.length !== 1 || unitTypes[0].length === 0) {
        throw new NativeUnitSourceValidationError('format', 'BLK must contain exactly one UUID and UnitType');
    }
    const forbiddenMekTypes = new Set([
        'mek',
        'battlemech',
        'battlemek',
        'bipedmek',
        'tripodmek',
        'quadmek',
        'quadvee',
        'lam',
    ]);
    if (forbiddenMekTypes.has(unitTypes[0].replace(/[\s_-]+/gu, '').toLowerCase())) {
        throw new NativeUnitSourceValidationError('format', 'Mek units must use MTF; Mek BLK is forbidden');
    }
    return canonicalizeEmbeddedUuid(uuidValues[0]);
}

export interface ValidatedNativeUnitSource {
    readonly uuid: UnitUuid;
    readonly format: NativeUnitFormat;
    readonly bytes: ArrayBuffer;
}

export async function validateNativeUnitSource(
    expectedUuid: UnitUuid,
    format: NativeUnitFormat,
    source: ArrayBuffer | ArrayBufferView,
): Promise<ValidatedNativeUnitSource> {
    const bytes = copyBytes(source);
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_UNIT_SOURCE_BYTES) {
        throw new NativeUnitSourceValidationError('size', `Native unit source has invalid byte length ${bytes.byteLength}`);
    }
    const raw = decodeUtf8(bytes);
    const embeddedUuid = format === 'mtf' ? extractMtfUuid(raw) : extractBlkUuid(raw);
    if (embeddedUuid !== expectedUuid) {
        throw new NativeUnitSourceValidationError(
            'uuid',
            `Native source UUID ${embeddedUuid} does not match manifest UUID ${expectedUuid}`,
        );
    }
    return Object.freeze({ uuid: embeddedUuid, format, bytes });
}

export async function buildStoredCoreContent(
    uuid: UnitUuid,
    entry: CoreUnitManifestEntry,
    source: ArrayBuffer | ArrayBufferView,
): Promise<StoredCoreContent> {
    const parsedFile = parseUnitFileName(entry.file);
    if (parsedFile.uuid !== uuid || parsedFile.format !== entry.format) {
        throw new NativeUnitSourceValidationError('format', 'Native unit filename disagrees with its manifest entry');
    }
    const validated = await validateNativeUnitSource(uuid, entry.format, source);
    return Object.freeze({
        file: entry.file,
        hash: entry.hash,
        format: entry.format,
        bytes: validated.bytes,
    });
}
