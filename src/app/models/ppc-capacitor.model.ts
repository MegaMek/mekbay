// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

export const PPC_FLAG = 'F_PPC' as const;
export const PPC_CAPACITOR_FLAG = 'F_PPC_CAPACITOR' as const;
export const PPC_CAPACITOR_COMPATIBLE_FLAG = 'F_PPC_CAPACITOR_COMPATIBLE' as const;
export const PPC_CAPACITOR_HEAT_BONUS = 5;
export const PPC_CAPACITOR_DAMAGE_BONUS = 5;

export interface PpcCapacitorCompatibilityContext {
    readonly year: number;
}

export interface PpcEquipmentView {
    readonly id?: string;
    hasFlag(flag: string): boolean;
}

export function isPpcEquipment(equipment: PpcEquipmentView | null | undefined): boolean {
    return equipment?.hasFlag(PPC_FLAG) === true;
}

export function isPpcCapacitorEquipment(equipment: PpcEquipmentView | null | undefined): boolean {
    return equipment?.hasFlag(PPC_CAPACITOR_FLAG) === true;
}

export function isPpcCapacitorCompatibleWeapon(
    equipment: PpcEquipmentView | null | undefined,
    context?: PpcCapacitorCompatibilityContext,
): boolean {
    return equipment?.hasFlag(PPC_FLAG) === true
        && equipment.hasFlag(PPC_CAPACITOR_COMPATIBLE_FLAG)
        && !(context && equipment.id === 'CLERPPC' && context.year < 3101);
}

export function isPpcCapacitorLink(
    capacitor: PpcEquipmentView | null | undefined,
    weapon: PpcEquipmentView | null | undefined,
    context?: PpcCapacitorCompatibilityContext,
): boolean {
    return isPpcCapacitorEquipment(capacitor)
        && isPpcCapacitorCompatibleWeapon(weapon, context);
}
