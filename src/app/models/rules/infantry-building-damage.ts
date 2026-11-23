// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

export const INFANTRY_BUILDING_TYPES = ['light', 'medium', 'heavy', 'hardened'] as const;
export type InfantryBuildingType = (typeof INFANTRY_BUILDING_TYPES)[number];

export function isInfantryBuildingType(value: unknown): value is InfantryBuildingType {
    return INFANTRY_BUILDING_TYPES.some(type => type === value);
}

/** TW p.175: origin is excluded; each interior hex or level up to the target counts once. */
export function interiorBuildingDistance(range: number, levelDifference = 0): number {
    return range + Math.abs(levelDifference);
}

/** TW p. 172: a hit on the building hex affects occupants with LOS to the level struck. */
export function exteriorInfantryDamage(damage: number, building: InfantryBuildingType): number {
    const percent = { light: 75, medium: 50, heavy: 25, hardened: 0 }[building];
    return Math.round(damage * percent / 100);
}

/** TW p. 172 examples apply the individual weapon's class to the share reaching the platoon. */
export function ordinaryInfantryTroopers(damage: number, types: readonly string[]): number {
    if (damage <= 0) return 0;
    const multipliers = [damage / 10];
    if (types.includes('C')) multipliers.push(types.includes('M') ? damage / 5 : damage / 10 + 1);
    if (types.includes('P')) multipliers.push(damage / 10 + 2);
    if (types.includes('AE')) multipliers.push(damage * 2);
    return Math.ceil(Math.max(...multipliers));
}

export function buildingCollateral(weapon: Readonly<{
    collateralBuilding?: InfantryBuildingType; types: readonly string[]; infantryClass?: string; inferno?: boolean;
}>, totalDamage: number): Readonly<{ damage: number; troopers?: number }> | undefined {
    if (!weapon.collateralBuilding || weapon.inferno) return undefined;
    const damage = exteriorInfantryDamage(totalDamage, weapon.collateralBuilding);
    if (weapon.infantryClass === 'infantry' || weapon.types.includes('H')) return { damage };
    const types = weapon.infantryClass?.startsWith('burst') ? ['DB'] : weapon.types;
    return { damage, troopers: ordinaryInfantryTroopers(damage, types) };
}

/** TW p. 175 and errata p. 176: halve burst damage before the interior building protection. */
export function interiorInfantryDamage(damage: number, building?: InfantryBuildingType, burst = false): number {
    if (!building) return damage;
    const percent = { light: 100, medium: 100, heavy: 75, hardened: 50 }[building];
    return Math.round((burst ? Math.round(damage / 2) : damage) * percent / 100);
}
