// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentFlag } from './equipment-flags.type';
import type { Equipment } from './equipment.model';
import { isHeatSinkEquipment } from './heat-equipment.model';

const STRUCTURE_FLAGS = Object.freeze([
    'F_ENDO_STEEL',
    'F_ENDO_COMPOSITE',
    'F_ENDO_STEEL_PROTO',
    'F_COMPOSITE',
    'F_INDUSTRIAL_STRUCTURE',
    'F_REINFORCED',
] as const satisfies readonly EquipmentFlag[]);

const ARMOR_FLAGS = Object.freeze([
    'F_FERRO_FIBROUS',
    'F_FERRO_FIBROUS_PROTO',
    'F_FERRO_LAMELLOR',
    'F_LIGHT_FERRO',
    'F_HEAVY_FERRO',
    'F_REACTIVE',
    'F_REFLECTIVE',
    'F_HARDENED_ARMOR',
    'F_PRIMITIVE_ARMOR',
    'F_COMMERCIAL_ARMOR',
    'F_INDUSTRIAL_ARMOR',
    'F_HEAVY_INDUSTRIAL_ARMOR',
    'F_ANTI_PENETRATIVE_ABLATIVE',
    'F_HEAT_DISSIPATING',
    'F_IMPACT_RESISTANT',
    'F_BALLISTIC_REINFORCED',
    'F_ELECTRIC_DISCHARGE_ARMOR',
    'F_SUPPORT_VEE_BAR_ARMOR',
] as const satisfies readonly EquipmentFlag[]);

const FIGHTER_ARMOR_FLAGS = Object.freeze([
    'F_LIGHT_FERRO',
    'F_HEAVY_FERRO',
    'F_REACTIVE',
    'F_REFLECTIVE',
    'F_HARDENED_ARMOR',
] as const satisfies readonly EquipmentFlag[]);

const SMALL_CRAFT_ARMOR_FLAGS = Object.freeze([
    ...FIGHTER_ARMOR_FLAGS,
    'F_PRIMITIVE_ARMOR',
] as const satisfies readonly EquipmentFlag[]);

const SUPPORT_VEHICLE_ARMOR_FLAGS = Object.freeze([
    'F_SUPPORT_VEE_BAR_ARMOR',
    'F_FERRO_FIBROUS',
    'F_FERRO_LAMELLOR',
    'F_LIGHT_FERRO',
    'F_HEAVY_FERRO',
    'F_REACTIVE',
    'F_REFLECTIVE',
    'F_HARDENED_ARMOR',
] as const satisfies readonly EquipmentFlag[]);

const FIXED_WING_SUPPORT_ARMOR_FLAGS = Object.freeze([
    'F_FERRO_FIBROUS',
    'F_FERRO_LAMELLOR',
    'F_LIGHT_FERRO',
    'F_HEAVY_FERRO',
    'F_REACTIVE',
    'F_REFLECTIVE',
    'F_HARDENED_ARMOR',
] as const satisfies readonly EquipmentFlag[]);

export type ConstructionWeightProfile =
    | 'general'
    | 'fighter'
    | 'small-craft'
    | 'support-vehicle'
    | 'fixed-wing-support';

export function isStructureConstructionEquipment(equipment: Equipment | null | undefined): boolean {
    return equipment?.hasAnyFlag(STRUCTURE_FLAGS) === true;
}

export function isArmorConstructionEquipment(equipment: Equipment | null | undefined): boolean {
    return equipment?.hasAnyFlag(ARMOR_FLAGS) === true;
}

/**
 * Synthetic construction entries are accounted for by their owning structure,
 * armor, or heat-sink section and must not be counted again as miscellaneous.
 */
export function isConstructionSystemEquipment(
    equipment: Equipment | null | undefined,
    profile: ConstructionWeightProfile = 'general',
): boolean {
    if (!equipment) return false;
    if (isHeatSinkEquipment(equipment)) return true;
    if (profile === 'fighter') return equipment.hasAnyFlag(FIGHTER_ARMOR_FLAGS);
    if (profile === 'small-craft') return equipment.hasAnyFlag(SMALL_CRAFT_ARMOR_FLAGS);
    if (profile === 'support-vehicle') return equipment.hasAnyFlag(SUPPORT_VEHICLE_ARMOR_FLAGS);
    if (profile === 'fixed-wing-support') {
        return equipment.hasAnyFlag(FIXED_WING_SUPPORT_ARMOR_FLAGS);
    }
    return isStructureConstructionEquipment(equipment) || isArmorConstructionEquipment(equipment);
}

export type StructureConstructionKind =
    | 'endo-steel'
    | 'endo-composite'
    | 'endo-steel-prototype'
    | 'composite'
    | 'industrial'
    | 'reinforced';

export function structureConstructionKind(
    equipment: Equipment | null | undefined,
): StructureConstructionKind | null {
    if (equipment?.hasFlag('F_ENDO_STEEL') === true) return 'endo-steel';
    if (equipment?.hasFlag('F_ENDO_COMPOSITE') === true) return 'endo-composite';
    if (equipment?.hasFlag('F_ENDO_STEEL_PROTO') === true) return 'endo-steel-prototype';
    if (equipment?.hasFlag('F_COMPOSITE') === true) return 'composite';
    if (equipment?.hasFlag('F_INDUSTRIAL_STRUCTURE') === true) return 'industrial';
    if (equipment?.hasFlag('F_REINFORCED') === true) return 'reinforced';
    return null;
}

export function structureConstructionTonnageFraction(
    equipment: Equipment | null | undefined,
): number | null {
    const kind = structureConstructionKind(equipment);
    if (kind === 'industrial' || kind === 'reinforced') return 0.2;
    if (kind === 'endo-steel' || kind === 'endo-steel-prototype' || kind === 'composite') return 0.05;
    if (kind === 'endo-composite') return 0.075;
    return null;
}

export function structureBattleValueMultiplier(equipment: Equipment | null | undefined): number {
    const kind = structureConstructionKind(equipment);
    if (kind === 'industrial' || kind === 'composite') return 0.5;
    if (kind === 'reinforced') return 2;
    return 1;
}

export type ArmorConstructionKind =
    | 'ferro-fibrous'
    | 'ferro-fibrous-prototype'
    | 'ferro-lamellor'
    | 'light-ferro'
    | 'heavy-ferro'
    | 'reactive'
    | 'reflective'
    | 'hardened'
    | 'primitive'
    | 'commercial'
    | 'industrial'
    | 'heavy-industrial'
    | 'anti-penetrative-ablative'
    | 'heat-dissipating'
    | 'impact-resistant'
    | 'ballistic-reinforced'
    | 'electric-discharge'
    | 'support-vehicle-bar';

export function armorConstructionKind(
    equipment: Equipment | null | undefined,
): ArmorConstructionKind | null {
    if (equipment?.hasFlag('F_FERRO_FIBROUS') === true) return 'ferro-fibrous';
    if (equipment?.hasFlag('F_FERRO_FIBROUS_PROTO') === true) return 'ferro-fibrous-prototype';
    if (equipment?.hasFlag('F_FERRO_LAMELLOR') === true) return 'ferro-lamellor';
    if (equipment?.hasFlag('F_LIGHT_FERRO') === true) return 'light-ferro';
    if (equipment?.hasFlag('F_HEAVY_FERRO') === true) return 'heavy-ferro';
    if (equipment?.hasFlag('F_REACTIVE') === true) return 'reactive';
    if (equipment?.hasFlag('F_REFLECTIVE') === true) return 'reflective';
    if (equipment?.hasFlag('F_HARDENED_ARMOR') === true) return 'hardened';
    if (equipment?.hasFlag('F_PRIMITIVE_ARMOR') === true) return 'primitive';
    if (equipment?.hasFlag('F_COMMERCIAL_ARMOR') === true) return 'commercial';
    if (equipment?.hasFlag('F_INDUSTRIAL_ARMOR') === true) return 'industrial';
    if (equipment?.hasFlag('F_HEAVY_INDUSTRIAL_ARMOR') === true) return 'heavy-industrial';
    if (equipment?.hasFlag('F_ANTI_PENETRATIVE_ABLATIVE') === true) return 'anti-penetrative-ablative';
    if (equipment?.hasFlag('F_HEAT_DISSIPATING') === true) return 'heat-dissipating';
    if (equipment?.hasFlag('F_IMPACT_RESISTANT') === true) return 'impact-resistant';
    if (equipment?.hasFlag('F_BALLISTIC_REINFORCED') === true) return 'ballistic-reinforced';
    if (equipment?.hasFlag('F_ELECTRIC_DISCHARGE_ARMOR') === true) return 'electric-discharge';
    if (equipment?.hasFlag('F_SUPPORT_VEE_BAR_ARMOR') === true) return 'support-vehicle-bar';
    return null;
}

export function isSupportVehicleBarArmor(equipment: Equipment | null | undefined): boolean {
    return armorConstructionKind(equipment) === 'support-vehicle-bar';
}

export function isElectricDischargeArmor(equipment: Equipment | null | undefined): boolean {
    return armorConstructionKind(equipment) === 'electric-discharge';
}

export function isHardenedArmor(equipment: Equipment | null | undefined): boolean {
    return armorConstructionKind(equipment) === 'hardened';
}

export function isHeatDissipatingArmor(equipment: Equipment | null | undefined): boolean {
    return armorConstructionKind(equipment) === 'heat-dissipating';
}

export function isIndustrialStructureEquipment(
    equipment: Equipment | null | undefined,
): boolean {
    return structureConstructionKind(equipment) === 'industrial';
}
