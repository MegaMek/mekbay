// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/** Device-local user artwork. IndexedDB key is the unit UUID, independent of any account. */
export interface UnitArtwork { readonly fluff?: Blob; readonly icon?: Blob }
export const MAX_UNIT_ARTWORK_BYTES = 4 * 1024 * 1024;
export function unitArtworkSize(artwork: UnitArtwork): number {
    return (artwork.fluff?.size ?? 0) + (artwork.icon?.size ?? 0);
}
export function isUnitArtwork(value: unknown): value is UnitArtwork {
    if (!value || typeof value !== 'object') return false;
    const row = value as UnitArtwork;
    return [row.fluff, row.icon].every(blob => blob === undefined
        || (blob instanceof Blob && blob.type === 'image/png' && blob.size > 0))
        && unitArtworkSize(row) > 0 && unitArtworkSize(row) <= MAX_UNIT_ARTWORK_BYTES;
}
