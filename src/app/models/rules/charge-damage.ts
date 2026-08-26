// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { MotiveModes } from '../motiveModes.model';
import { getTargetMovementDistanceModifier } from '../target-number-calculator.model';

export interface ChargeDamageInput {
    readonly ruleset: CBTRuleset;
    readonly massTons: number;
    readonly movementMode: MotiveModes | null;
    readonly movementDistance: number;
    readonly maximumDistance: number;
    readonly hasRamPlate: boolean;
    readonly hasWorkingRamPlate: boolean;
    readonly bonusDamage?: number;
    readonly maximumBonusDamage?: number;
}

export interface ChargeDamageProjection {
    readonly damage: number;
    readonly maximumDamage: number;
    readonly baseDamage: number;
    readonly weakened: boolean;
    readonly displayFormula?: string;
}

/** Shared Core/TW Charge formula for every Entity family that can charge. */
export function calculateChargeDamage(input: ChargeDamageInput): ChargeDamageProjection {
    const bonusDamage = input.bonusDamage ?? 0;
    const maximumBonusDamage = input.maximumBonusDamage ?? bonusDamage;
    const selectedMovement = input.movementMode === 'walk' || input.movementMode === 'run';
    const damageFor = input.ruleset === 'core-2026'
        ? (distance: number, ramPlate: boolean): number => {
            const perTmm = input.massTons / 5;
            const base = Math.ceil(perTmm * (getTargetMovementDistanceModifier(distance) + 1));
            return ramPlate ? Math.ceil(base * 1.5) : base;
        }
        : (distance: number, ramPlate: boolean): number => {
            const perHex = input.massTons / 10;
            const base = Math.ceil(perHex * (Math.max(1, distance) - 1));
            return ramPlate ? Math.ceil(base * 1.5) : base;
        };
    const baseDamage = damageFor(input.movementDistance, input.hasWorkingRamPlate);
    const damage = baseDamage + bonusDamage;
    const maximumDamage = damageFor(input.maximumDistance, input.hasRamPlate) + maximumBonusDamage;
    const coefficient = roundHundredths(
        input.massTons
        / (input.ruleset === 'core-2026' ? 5 : 10)
        * (input.hasWorkingRamPlate ? 1.5 : 1),
    );
    return Object.freeze({
        damage,
        maximumDamage,
        baseDamage,
        weakened: (!input.hasWorkingRamPlate && input.hasRamPlate)
            || bonusDamage < maximumBonusDamage,
        ...(!selectedMovement ? {
            displayFormula: input.ruleset === 'core-2026'
                ? `${coefficient}×(TMM+1)${bonusDamage > 0 ? `+${bonusDamage}` : ''}`
                : `${coefficient}/hex${bonusDamage > 0 ? `+${bonusDamage}` : ''}`,
        } : {}),
    });
}

function roundHundredths(value: number): number {
    return Math.round(value * 100) / 100;
}
