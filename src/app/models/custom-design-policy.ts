// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { deflate, Inflate } from 'pako';
import { assertImageFreeUnitSource } from './entity/native-unit-artwork';
import type { PinnedCustomUnitSource } from './pinned-custom-unit-source';
import { decodePinnedCustomUnitSource } from './pinned-custom-unit-source';
import { asUnitUuid, type UnitUuid } from '../services/unit-catalog/unit-catalog.types';
import { MAX_UNIT_SOURCE_BYTES } from '../services/unit-catalog/core-unit-manifest';

// Client admission limits; the server treats force design tables as opaque and bounds the whole payload.
export const MAX_EMBEDDED_CUSTOM_DESIGNS = 20;
export const MAX_EMBEDDED_CUSTOM_BYTES = 192 * 1024;
// JSON escaping can expand a source byte to six characters; include bounded row metadata.
export const MAX_EMBEDDED_CUSTOM_EXPANDED_BYTES = MAX_EMBEDDED_CUSTOM_DESIGNS * MAX_UNIT_SOURCE_BYTES * 6 + 1024;
export const MAX_OWNED_CUSTOM_UNITS = 5000;
export const CUSTOM_UNIT_LIBRARY_FULL_MESSAGE = 'You can own up to ' + MAX_OWNED_CUSTOM_UNITS.toLocaleString('en-US') + ' custom units. Delete a design from My Custom Units before saving another. You can still edit your existing designs.';
export class CustomDesignCapacityError extends Error {}
export const CUSTOM_DESIGN_COUNT_LIMIT_MESSAGE = 'A force can include up to ' + MAX_EMBEDDED_CUSTOM_DESIGNS + ' different custom designs. Remove a design or add this unit to another force.';
export const CUSTOM_DESIGN_SIZE_LIMIT_MESSAGE = 'The custom designs in this force are too large to save together. Remove a custom design or move it to another force.';
export interface CompressedCustomDesign { uuid: UnitUuid; format: 'mtf' | 'blk'; data: string }
export interface CompressedCustomDesignTable { encoding: 'deflate'; data: string }
export interface EmbeddedCustomDesign { uuid: UnitUuid; source: PinnedCustomUnitSource }

function deflateText(source: string): string {
    const bytes = deflate(new TextEncoder().encode(source), { level: 9 });
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
}

function inflateText(data: string, maxBytes: number): string {
    const chunks: Uint8Array[] = [];
    let length = 0;
    const inflater = new Inflate({ chunkSize: 8192 });
    inflater.onData = chunk => {
        length += chunk.length;
        if (length > maxBytes) throw new Error('Custom design exceeds the source size limit');
        chunks.push(chunk);
    };
    if (!inflater.push(Uint8Array.from(atob(data), c => c.charCodeAt(0)), true) || inflater.err) throw new Error('Unreadable compressed custom design');
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}

/** Cloud designs remain individually compressed and addressable by UUID/hash. */
export function compressCustomDesign(uuid: UnitUuid, source: PinnedCustomUnitSource): CompressedCustomDesign {
    assertImageFreeUnitSource(source.source, source.format);
    return { uuid, format: source.format, data: deflateText(source.source) };
}

export function decompressCustomDesign(value: unknown): EmbeddedCustomDesign {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid custom design');
    const v = value as Record<string, unknown>;
    if (Object.keys(v).some(k => !['uuid', 'format', 'data'].includes(k)) || typeof v['uuid'] !== 'string'
        || (v['format'] !== 'mtf' && v['format'] !== 'blk') || typeof v['data'] !== 'string' || v['data'].length > MAX_UNIT_SOURCE_BYTES * 2) throw new Error('Invalid custom design');
    return { uuid: asUnitUuid(v['uuid']), source: decodePinnedCustomUnitSource({ format: v['format'], source: inflateText(v['data'], MAX_UNIT_SOURCE_BYTES) }) };
}

/** One transport block for the entire force table; callers retain its small decoded index. */
export function compressEmbeddedCustomDesigns(designs: readonly EmbeddedCustomDesign[]): CompressedCustomDesignTable {
    designs.forEach(({ source }) => assertImageFreeUnitSource(source.source, source.format));
    return { encoding: 'deflate', data: deflateText(JSON.stringify(designs.map(({ uuid, source }) => ({ uuid, ...source })))) };
}

export function decompressEmbeddedCustomDesigns(value: unknown): readonly EmbeddedCustomDesign[] {
    if (value === undefined) return [];
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_EMBEDDED_CUSTOM_BYTES) throw new Error('Embedded custom designs are too large');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid embedded custom design table');
    const packed = value as Record<string, unknown>;
    if (Object.keys(packed).some(k => k !== 'encoding' && k !== 'data') || packed['encoding'] !== 'deflate' || typeof packed['data'] !== 'string') throw new Error('Invalid embedded custom design table');
    const rows: unknown = JSON.parse(inflateText(packed['data'], MAX_EMBEDDED_CUSTOM_EXPANDED_BYTES));
    if (!Array.isArray(rows) || rows.length > MAX_EMBEDDED_CUSTOM_DESIGNS) throw new Error('Too many embedded custom designs');
    const designs = rows.map(raw => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid embedded custom design');
        const row = raw as Record<string, unknown>;
        if (Object.keys(row).some(k => !['uuid', 'format', 'source'].includes(k)) || typeof row['uuid'] !== 'string') throw new Error('Invalid embedded custom design');
        return { uuid: asUnitUuid(row['uuid']), source: decodePinnedCustomUnitSource({ format: row['format'], source: row['source'] }) };
    });
    if (new Set(designs.map(designKey)).size !== designs.length) throw new Error('Duplicate embedded custom design');
    return designs;
}

function designKey({ uuid, source }: EmbeddedCustomDesign): string { return JSON.stringify([uuid, source.format, source.source]); }

export function planEmbeddedDesigns(sources: readonly EmbeddedCustomDesign[]) {
    const designs = [...new Map(sources.map(entry => [designKey(entry), entry])).values()];
    if (designs.length > MAX_EMBEDDED_CUSTOM_DESIGNS) throw new CustomDesignCapacityError(CUSTOM_DESIGN_COUNT_LIMIT_MESSAGE);
    const compressed = designs.length ? compressEmbeddedCustomDesigns(designs) : undefined;
    if (compressed && new TextEncoder().encode(JSON.stringify(compressed)).byteLength > MAX_EMBEDDED_CUSTOM_BYTES) {
        throw new CustomDesignCapacityError(CUSTOM_DESIGN_SIZE_LIMIT_MESSAGE);
    }
    const selected = new Map(designs.map((entry, index) => [designKey(entry), index]));
    return { designs, compressed, indexes: sources.map(entry => selected.get(designKey(entry))!) };
}
