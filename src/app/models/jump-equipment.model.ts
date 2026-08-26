// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Equipment } from './equipment.model';
import { hasAnyPrototypeVariant, hasEquipmentVariant } from './equipment-variant.model';

export type JumpJetKind = 'standard' | 'improved' | 'prototype-improved';

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
    const prototype = hasAnyPrototypeVariant(equipment);
    if (standard && (improved || prototype)) return null;
    if (improved || prototype) return improved && !prototype ? 'improved' : 'prototype-improved';
    return 'standard';
}

export function jumpJetCriticalExplosionDamage(equipment: Equipment | undefined): 10 | undefined {
    return isJumpJetEquipment(equipment)
        && hasEquipmentVariant(equipment, 'improved')
        && hasEquipmentVariant(equipment, 'prototype-subtype')
        ? PROTOTYPE_IMPROVED_JUMP_JET_EXPLOSION_DAMAGE
        : undefined;
}

export function jumpJetTonnageMultiplier(equipment: Equipment | undefined): 1 | 2 | null {
    const kind = jumpJetKind(equipment);
    return kind === null ? null : kind === 'improved' ? 2 : 1;
}

export function isImprovedJumpJetEquipment(equipment: Equipment | undefined): boolean {
    return isJumpJetEquipment(equipment) && hasEquipmentVariant(equipment, 'improved');
}

export function isPrototypeImprovedJumpJetEquipment(equipment: Equipment | undefined): boolean {
    return isImprovedJumpJetEquipment(equipment)
        && hasEquipmentVariant(equipment, 'prototype-subtype');
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

export function partialWingJumpBonus(weightClass: string): 1 | 2 {
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
        entityWeightClass: string;
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
    weightClass: string,
): number | null {
    if (!isMechanicalJumpBoosterEquipment(equipment)) return null;
    if (weightClass === 'Assault') return 300000;
    if (weightClass === 'Heavy') return 150000;
    if (weightClass === 'Medium') return 75000;
    return 50000;
}

export function jumpBoosterCriticalSlots(
    equipment: Equipment | null | undefined,
    quad: boolean,
): number | null {
    return isJumpBoosterEquipment(equipment) ? (quad ? 8 : 4) : null;
}
