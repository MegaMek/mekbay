// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { heatEffectValue,MEK_HEAT_EFFECTS } from './heat-effect-rules';

export interface MekHeatEffects {
    readonly moveModifier: number;
    readonly fireModifier: number;
}

/** Cumulative BattleTech heat penalties shared by movement and weapon fire. */
export function mekHeatEffects(heat: number): MekHeatEffects {
    return Object.freeze({
        moveModifier: heatEffectValue(MEK_HEAT_EFFECTS, 'movement', heat) ?? 0,
        fireModifier: heatEffectValue(MEK_HEAT_EFFECTS, 'fire', heat) ?? 0,
    });
}
