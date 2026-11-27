// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import type { NativeUnitFormat } from '../../services/unit-catalog/unit-catalog.types';

/** File intake includes artwork; the cleaned design retains the smaller native source limit. */
export const MAX_NATIVE_IMPORT_BYTES = 8 * 1024 * 1024;
export interface EncodedUnitArtwork { readonly fluff?: string; readonly icon?: string }
export interface ExtractedUnitArtwork { readonly source: string; readonly images: EncodedUnitArtwork }

export function hasEmbeddedUnitArtwork(source: string, format: NativeUnitFormat): boolean {
    return format === 'mtf' ? /^\s*(?:fluffimage|icon)[^\S\r\n]*:/im.test(source)
        : /<\s*(?:fluffimage|icon)\s*>/i.test(source);
}

/** Remove every image occurrence without rewriting any construction facts. Last occurrence wins. */
export function extractNativeUnitArtwork(source: string, format: NativeUnitFormat): ExtractedUnitArtwork {
    const images: { fluff?: string; icon?: string } = {};
    const keep = (tag: string, value: string): void => {
        images[tag.toLowerCase() === 'fluffimage' ? 'fluff' : 'icon'] = value.trim();
    };
    const clean = format === 'mtf'
        ? source.replace(/^[^\S\r\n]*(fluffimage|icon)[^\S\r\n]*:([^\r\n]*)(?:\r\n|\r|\n|$)/gim,
            (_match, tag: string, value: string) => { keep(tag, value); return ''; })
        : source.replace(/(?:^[^\S\r\n]*)?<\s*(fluffimage|icon)\s*>([\s\S]*?)<\/\s*\1\s*>[^\S\r\n]*(?:\r\n|\r|\n)?/gim,
            (_match, tag: string, value: string) => { keep(tag, value.replace(/\s/g, '')); return ''; });
    if (hasEmbeddedUnitArtwork(clean, format)) throw new Error('The unit has an unterminated embedded image field.');
    return { source: clean, images };
}

export function assertImageFreeUnitSource(source: string, format: NativeUnitFormat): void {
    if (hasEmbeddedUnitArtwork(source, format)) throw new Error('Embedded artwork must be extracted before saving a unit.');
}
