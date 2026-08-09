// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export interface InventoryComponentReference {
    location: string;
    componentIndex: number;
    binIndex: number | null;
}

/** Parses the stable `equipment@location#component[.bin]` inventory ID suffix. */
export function parseInventoryComponentReference(id: string): InventoryComponentReference | null {
    const match = id.match(/@([^#]+)#(\d+)(?:\.(\d+))?$/);
    if (!match) return null;

    const location = match[1].trim();
    const componentIndex = Number(match[2]);
    const binIndex = match[3] === undefined ? null : Number(match[3]);
    if (!location || !Number.isSafeInteger(componentIndex)) return null;
    if (binIndex !== null && !Number.isSafeInteger(binIndex)) return null;
    return { location, componentIndex, binIndex };
}
