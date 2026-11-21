// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Equipment } from './equipment.model';
import { hasEquipmentVariant } from './equipment-variant.model';
import type { WeightClass } from './entity/types';
import type { EngineMovementHeat } from './entity/components/engine-data';

export type JumpJetKind = 'standard' | 'primitive-prototype' | 'improved' | 'prototype-improved';

export const JUMP_JET_FLAG = 'F_JUMP_JET' as const;
export const UMU_FLAG = 'F_UMU' as const;
export const PARTIAL_WING_FLAG = 'F_PARTIAL_WING' as const;
export const SUPER_COOLED_MYOMER_FLAG = 'F_SCM' as const;
export const PARTIAL_WING_HEAT_DISSIPATION_BONUS = 3;
export const PROTOTYPE_IMPROVED_JUMP_JET_EXPLOSION_DAMAGE = 10;
const JUMP_BOOSTER_FLAG = 'F_JUMP_BOOSTER' as const;
const MECHANICAL_JUMP_BOOSTER_FLAG = 'F_MECHANICAL_JUMP_BOOSTER' as const;

export function isJumpJetEquipment(equipment: Equipment | undefined): boolean {
    return equipment?.hasFlag(JUMP_JET_FLAG) === true;
}

export function jumpJetKind(equipment: Equipment | undefined): JumpJetKind | null {
    if (!equipment || !isJumpJetEquipment(equipment)) return null;
    const standard = equipment.hasFlag('S_STANDARD');
    const improved = hasEquipmentVariant(equipment, 'improved');
    const prototype = hasEquipmentVariant(equipment, 'prototype-subtype');
    if (standard && (improved || prototype)) return null;
    if (improved) return prototype ? 'prototype-improved' : 'improved';
    return prototype ? 'primitive-prototype' : 'standard';
}

export function jumpJetCriticalExplosionDamage(equipment: Equipment | undefined): 10 | undefined {
    return isJumpJetEquipment(equipment)
        && hasEquipmentVariant(equipment, 'improved')
        && hasEquipmentVariant(equipment, 'prototype-subtype')
        ? PROTOTYPE_IMPROVED_JUMP_JET_EXPLOSION_DAMAGE
        : undefined;
}

export function isImprovedJumpJetEquipment(equipment: Equipment | undefined): boolean {
    return isJumpJetEquipment(equipment) && hasEquipmentVariant(equipment, 'improved');
}

export function isPrototypeImprovedJumpJetEquipment(equipment: Equipment | undefined): boolean {
    return isImprovedJumpJetEquipment(equipment)
        && hasEquipmentVariant(equipment, 'prototype-subtype');
}

export function standardJumpJetTonnage(unitTonnage: number): number {
    if (unitTonnage <= 55) return 0.5;
    if (unitTonnage <= 85) return 1;
    return 2;
}

/** Campaign Operations p. 213 drops fractional Jumping MP after totaling the surviving jets. */
export function wholeJumpJetMp(jets: readonly { readonly mpContribution: number }[]): number {
    return Math.floor(jets.reduce((total, jet) => total + jet.mpContribution, 0));
}

export function minimumJumpJets(movedMP: number, workingJetThrust: readonly number[]): number {
    // Campaign Operations p. 213 charges heat per jet fired. Use the fewest jets for the declared jump.
    let remainingMP = movedMP;
    let jetsFired = 0;
    for (const thrust of [...workingJetThrust].sort((a, b) => b - a)) {
        if (remainingMP <= 0 || thrust <= 0) break;
        remainingMP -= thrust;
        jetsFired++;
    }
    // AirMech movement and sheet declarations can extend beyond the installed Jumping MP.
    return jetsFired + Math.max(0, Math.ceil(remainingMP));
}

export function mekJumpHeat(
    engineHeat: Pick<EngineMovementHeat, 'jumpMin' | 'jumpPerMP'>,
    kind: JumpJetKind,
    movedMP: number,
    workingJetThrust: readonly number[],
    jetsFired = minimumJumpJets(movedMP, workingJetThrust),
): number {
    const heatMP = kind === 'improved' ? Math.ceil(jetsFired / 2)
        : kind === 'prototype-improved' ? jetsFired * 2
        : jetsFired;
    const heat = Math.max(engineHeat.jumpMin, heatMP * engineHeat.jumpPerMP);
    return kind === 'prototype-improved' ? Math.max(6, heat) : heat;
}

export function isUmuEquipment(equipment: Equipment | undefined): boolean {
    return equipment?.hasFlag(UMU_FLAG) === true;
}

export function jumpPropulsionTonnageMultiplier(equipment: Equipment | undefined): 1 | 2 | null {
    if (!equipment || (!isJumpJetEquipment(equipment) && !isUmuEquipment(equipment))) return null;
    const improved = hasEquipmentVariant(equipment, 'improved');
    const prototype = hasEquipmentVariant(equipment, 'prototype-subtype');
    return improved && !prototype ? 2 : 1;
}

export function isPartialWingEquipment(equipment: Equipment | undefined): boolean {
    return equipment?.hasFlag(PARTIAL_WING_FLAG) === true;
}

export function isSuperCooledMyomerEquipment(equipment: Equipment | undefined): boolean {
    return equipment?.hasFlag(SUPER_COOLED_MYOMER_FLAG) === true;
}

export function partialWingJumpBonus(weightClass: WeightClass): 1 | 2 {
    return ['Ultra Light', 'Light', 'Medium'].includes(weightClass) ? 2 : 1;
}

export function isJumpBoosterEquipment(equipment: Equipment | null | undefined): boolean {
    return equipment?.hasFlag(JUMP_BOOSTER_FLAG) === true;
}

export function isMechanicalJumpBoosterEquipment(
    equipment: Equipment | null | undefined,
): boolean {
    return equipment?.hasFlag(MECHANICAL_JUMP_BOOSTER_FLAG) === true;
}

export function isAnyJumpBoosterEquipment(equipment: Equipment | null | undefined): boolean {
    return isJumpBoosterEquipment(equipment) || isMechanicalJumpBoosterEquipment(equipment);
}

export function jumpBoosterVariableTonnage(
    equipment: Equipment | null | undefined,
    context: Readonly<{
        entityTonnage: number;
        entityWeightClass: WeightClass;
        mountSize: number;
        standardRound: (value: number) => number;
    }>,
): number | null | undefined {
    if (isMechanicalJumpBoosterEquipment(equipment)) {
        if (context.entityWeightClass === 'Ultra Light' || context.entityWeightClass === 'Light') return 0.05;
        if (context.entityWeightClass === 'Medium') return 0.1;
        if (context.entityWeightClass === 'Heavy') return 0.25;
        if (context.entityWeightClass === 'Assault') return 0.5;
        return undefined;
    }
    if (isJumpBoosterEquipment(equipment)) {
        return context.standardRound(context.entityTonnage * context.mountSize * 0.05);
    }
    return null;
}

export function jumpBoosterVariableCost(
    equipment: Equipment | null | undefined,
    weightClass: WeightClass,
): number | null {
    if (!isMechanicalJumpBoosterEquipment(equipment)) return null;
    if (weightClass === 'Assault') return 300000;
    if (weightClass === 'Heavy') return 150000;
    if (weightClass === 'Medium') return 75000;
    return 50000;
}
