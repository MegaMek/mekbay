// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { isEquipmentForPlatform } from './equipment-platform.model';

export const MASC_FLAG = 'F_MASC' as const;
export const JET_BOOSTER_FLAG = 'F_JET_BOOSTER' as const;
export const SUPERCHARGER_FLAG = 'S_SUPERCHARGER' as const;
export const RADICAL_HEAT_SINK_FLAG = 'F_RADICAL_HEATSINK' as const;
export const BLUE_SHIELD_FLAG = 'F_BLUE_SHIELD' as const;
export const EMERGENCY_COOLANT_SYSTEM_FLAG = 'F_EMERGENCY_COOLANT_SYSTEM' as const;
export const VIRAL_JAMMER_DECOY_FLAG = 'F_VIRAL_JAMMER_DECOY' as const;
export const VIRAL_JAMMER_HOMING_FLAG = 'F_VIRAL_JAMMER_HOMING' as const;
export const VIRAL_JAMMER_OPERATING_HEAT = 12;
export const BLUE_SHIELD_EXPLOSION_DAMAGE = 5;
export const EMERGENCY_COOLANT_SYSTEM_EXPLOSION_DAMAGE = 5;
export const BLUE_SHIELD_BV_BONUS = 0.2;
export const BLUE_SHIELD_BV_MULTIPLIER = 1 + BLUE_SHIELD_BV_BONUS;
export const EMERGENCY_COOLANT_HEAT_EFFICIENCY_BONUS = 4;

export interface EscalatingEquipmentView {
    hasFlag(flag: string): boolean;
}

export function isMascEquipment(equipment: EscalatingEquipmentView | null | undefined): boolean {
    return equipment?.hasFlag(MASC_FLAG) === true;
}

export function isJetBoosterEquipment(
    equipment: EscalatingEquipmentView | null | undefined,
): boolean {
    return isMascEquipment(equipment) && equipment!.hasFlag(JET_BOOSTER_FLAG);
}

export function isSuperchargerEquipment(
    equipment: EscalatingEquipmentView | null | undefined,
): boolean {
    return isMascEquipment(equipment) && equipment!.hasFlag(SUPERCHARGER_FLAG);
}

export function isBattleArmorMyomerBoosterEquipment(
    equipment: EscalatingEquipmentView | null | undefined,
): boolean {
    return isMascEquipment(equipment) && isEquipmentForPlatform(equipment, 'battle-armor');
}

export function isRadicalHeatSinkEquipment(
    equipment: EscalatingEquipmentView | null | undefined,
): boolean {
    return equipment?.hasFlag(RADICAL_HEAT_SINK_FLAG) === true;
}

export function isBlueShieldEquipment(
    equipment: EscalatingEquipmentView | null | undefined,
): boolean {
    return equipment?.hasFlag(BLUE_SHIELD_FLAG) === true;
}

export function isEmergencyCoolantSystemEquipment(
    equipment: EscalatingEquipmentView | null | undefined,
): boolean {
    return equipment?.hasFlag(EMERGENCY_COOLANT_SYSTEM_FLAG) === true;
}

export function isViralJammerDecoyEquipment(
    equipment: EscalatingEquipmentView | null | undefined,
): boolean {
    return equipment?.hasFlag(VIRAL_JAMMER_DECOY_FLAG) === true;
}

export function isViralJammerHomingEquipment(
    equipment: EscalatingEquipmentView | null | undefined,
): boolean {
    return equipment?.hasFlag(VIRAL_JAMMER_HOMING_FLAG) === true;
}

export function isViralJammerEquipment(
    equipment: EscalatingEquipmentView | null | undefined,
): boolean {
    return isViralJammerDecoyEquipment(equipment) || isViralJammerHomingEquipment(equipment);
}

export function movementBoosterUsableWhile(
    equipment: EscalatingEquipmentView | null | undefined,
    airborne: boolean | null,
): boolean {
    return isMascEquipment(equipment) && (!isJetBoosterEquipment(equipment) || airborne === true);
}

/** Undefined delegates to the ordinary equipment explosion rule. */
export function escalatingFailureCriticalExplosionDamage(
    equipment: EscalatingEquipmentView | null | undefined,
    active: boolean,
): number | undefined {
    if (isBlueShieldEquipment(equipment)) return active ? BLUE_SHIELD_EXPLOSION_DAMAGE : 0;
    if (isEmergencyCoolantSystemEquipment(equipment)) {
        return EMERGENCY_COOLANT_SYSTEM_EXPLOSION_DAMAGE;
    }
    return undefined;
}

export function escalatingEquipmentAlphaStrikeAbilities(
    equipment: EscalatingEquipmentView | null | undefined,
): readonly ('RHS' | 'ECS' | 'DJ' | 'HJ')[] {
    const abilities: ('RHS' | 'ECS' | 'DJ' | 'HJ')[] = [];
    if (isRadicalHeatSinkEquipment(equipment)) abilities.push('RHS');
    if (isEmergencyCoolantSystemEquipment(equipment)) abilities.push('ECS');
    if (isViralJammerDecoyEquipment(equipment)) abilities.push('DJ');
    if (isViralJammerHomingEquipment(equipment)) abilities.push('HJ');
    return Object.freeze(abilities);
}
