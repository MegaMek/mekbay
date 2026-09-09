// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { MAX_NATIVE_IMPORT_BYTES, type EncodedUnitArtwork } from '../models/entity/native-unit-artwork';
import { MAX_UNIT_ARTWORK_BYTES, unitArtworkSize, type UnitArtwork } from '../models/unit-artwork.model';

/** Decode user-selected images once and store a bounded PNG understood by native exports. */
export async function normalizeUnitImage(blob: Blob): Promise<Blob> {
    if (!blob.size || blob.size > MAX_NATIVE_IMPORT_BYTES) throw new Error('Choose an image no larger than 8 MB.');
    const bitmap = await createImageBitmap(blob);
    try {
        if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 32 * 1024 * 1024) {
            throw new Error('This image has too many pixels. Choose a smaller image.');
        }
        const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value =>
            value ? resolve(value) : reject(new Error('Unable to encode this image.')), 'image/png'));
        if (png.size > MAX_UNIT_ARTWORK_BYTES) throw new Error('This image is too large to store. Choose a simpler image.');
        return png;
    } finally { bitmap.close(); }
}

export async function decodeUnitArtwork(images: EncodedUnitArtwork): Promise<{ artwork: UnitArtwork | null; warnings: string[] }> {
    const artwork: { fluff?: Blob; icon?: Blob } = {};
    const warnings: string[] = [];
    for (const kind of ['fluff', 'icon'] as const) {
        const encoded = images[kind];
        if (!encoded) continue;
        try {
            if (encoded.length > MAX_NATIVE_IMPORT_BYTES) throw new Error('Image is too large.');
            const base64 = encoded.replace(/^data:image\/[^;,]+;base64,/i, '').replace(/\s/g, '');
            const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
            const png = await normalizeUnitImage(new Blob([bytes]));
            if (unitArtworkSize(artwork) + png.size > MAX_UNIT_ARTWORK_BYTES) throw new Error('Artwork is too large.');
            artwork[kind] = png;
        } catch {
            warnings.push(`The embedded ${kind === 'fluff' ? 'fluff image' : 'icon'} could not be imported; it was removed from the unit source.`);
        }
    }
    return { artwork: unitArtworkSize(artwork) ? artwork : null, warnings };
}

export async function encodeUnitImage(blob: Blob): Promise<string> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
}
