// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export interface InventoryComponentReference {
    componentIndex: number;
    binIndex: number | null;
}

/** Parses the stable `equipment@location#component[.bin]` inventory ID suffix. */
export function parseInventoryComponentReference(id: string): InventoryComponentReference | null {
    const suffix = id.split('#').pop();
    if (!suffix) return null;

    const [componentIndexText, binIndexText] = suffix.split('.');
    const componentIndex = Number(componentIndexText);
    const binIndex = binIndexText === undefined ? null : Number(binIndexText);
    if (!Number.isInteger(componentIndex) || componentIndex < 0) return null;
    if (binIndex !== null && (!Number.isInteger(binIndex) || binIndex < 0)) return null;
    return { componentIndex, binIndex };
}