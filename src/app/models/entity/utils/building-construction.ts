// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { WeaponEquipment, type Equipment } from '../../equipment.model';
import type { BuildingElevator } from '../types/building';

export function buildingCapitalWeapon(equipment: Equipment | undefined): boolean {
  return equipment instanceof WeaponEquipment && (equipment.capital || equipment.subCapital);
}

export function buildingRoofFacility(equipment: Equipment | undefined): boolean {
  return buildingFacility(equipment)?.roof ?? false;
}

/** Entity-dependent values for MegaMek's BuildingEquipmentType, using ordinary mounted size. */
export function buildingFacility(equipment: Equipment | undefined, size = 1, constructionFactor = 0):
  { tons: number; cost: number; crew: number; roof: boolean } | undefined {
  switch (equipment?.id) {
    case 'Unspecified Building Equipment': return { tons: size, cost: 0, crew: 0, roof: false };
    // The equipment rule (TO:AUE p. 124) and table supersede the old 2,500 t example on p. 84.
    case 'Building Flight Deck': return { tons: 1500, cost: 1000000, crew: 20, roof: true };
    case 'Building Helipad': return { tons: 500, cost: 200000, crew: 5, roof: true };
    case 'Building Landing Deck': return { tons: 500 * size, cost: 500000 * size, crew: 3 * size, roof: true };
    case 'Modular Structure Linkage': return { tons: Math.ceil(constructionFactor / 2), cost: 0, crew: 4, roof: false };
    default: return undefined;
  }
}

export function buildingCanSpread(equipment: Equipment | undefined): boolean {
  return !!equipment && (equipment.hasFlag('F_POWER_GENERATOR') || buildingCapitalWeapon(equipment)
    || (buildingRoofFacility(equipment) && equipment.id !== 'Building Helipad'));
}

export function buildingCanAutomate(equipment: Equipment | undefined): boolean {
  return equipment instanceof WeaponEquipment && !equipment.isInfantryWeapon() && !buildingCapitalWeapon(equipment)
    && !equipment.hasAnyFlag(['F_ARTILLERY', 'F_AMS', 'F_AMS_BAY', 'F_B_POD', 'F_AP_POD']);
}

export function buildingElevatorRange(lift: BuildingElevator): readonly [number, number] {
  const stops = [...lift.exits.keys()];
  return stops.length ? [Math.min(...stops), Math.max(...stops)] : [0, 0];
}

export function buildingElevatorWeight(lift: BuildingElevator): number {
  const [lower, upper] = buildingElevatorRange(lift);
  return Math.ceil(lift.capacity / 20) * Math.max(0, upper - Math.max(1, lower) + 1);
}
