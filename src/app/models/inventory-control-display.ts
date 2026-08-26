// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

export interface InventoryControlDisplayData {
    readonly name: string;
    readonly location: string;
    readonly heat: string;
    readonly damage: string;
    readonly hit: string;
    readonly min: string;
    readonly short: string;
    readonly medium: string;
    readonly long: string;
}

const MODE_DISPLAY_NAMES: Readonly<Record<string, string>> = Object.freeze({
    Standard: 'STD',
    'Extended Range': 'ER',
    'High Explosive': 'HE',
});

export function formatInventoryControlModeName(modeName: string): string {
    return MODE_DISPLAY_NAMES[modeName] ?? modeName;
}
