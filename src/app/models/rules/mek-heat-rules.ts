// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

export interface MekHeatEffects {
    readonly moveModifier: number;
    readonly fireModifier: number;
}

/** Cumulative BattleTech heat penalties shared by movement and weapon fire. */
export function mekHeatEffects(heat: number): MekHeatEffects {
    return Object.freeze({
        moveModifier: heat >= 25 ? -5
            : heat >= 20 ? -4
                : heat >= 15 ? -3
                    : heat >= 10 ? -2
                        : heat >= 5 ? -1
                            : 0,
        fireModifier: heat >= 24 ? 4
            : heat >= 17 ? 3
                : heat >= 13 ? 2
                    : heat >= 8 ? 1
                        : 0,
    });
}
