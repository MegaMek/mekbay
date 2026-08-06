// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/** Returns the Battle Armor trooper number represented by a location label. */
export function getBattleArmorTrooperNumber(location: string): number | null {
    const match = location.trim().match(/^(?:Trooper\s+|T)(\d+)$/i);
    if (!match) return null;
    const trooperNumber = Number(match[1]);
    return Number.isInteger(trooperNumber) && trooperNumber > 0 ? trooperNumber : null;
}

/** Converts accepted Battle Armor trooper labels to their canonical `T<n>` form. */
export function normalizeBattleArmorTrooperLocation(location: string): string {
    const trooperNumber = getBattleArmorTrooperNumber(location);
    return trooperNumber === null ? location : `T${trooperNumber}`;
}