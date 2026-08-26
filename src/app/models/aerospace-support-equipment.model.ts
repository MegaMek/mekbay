// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentFlag } from './equipment-flags.type';
import type { Equipment } from './equipment.model';
import { isEquipmentForPlatform } from './equipment-platform.model';
import { isChaffPodEquipment } from './utility-equipment.model';

export type AerospaceSupportEquipmentKind =
  | 'bomb-bay'
  | 'booby-trap'
  | 'external-stores-hardpoint'
  | 'mobile-hpg'
  | 'space-mine-dispenser'
  | 'vehicle-mine-dispenser';

const MOBILE_HPG_FLAG = 'F_MOBILE_HPG' as const;
const BOMB_AMMO_FLAGS: readonly EquipmentFlag[] = Object.freeze([
  'F_ALT_BOMB',
  'F_DIVE_BOMB',
  'F_GROUND_BOMB',
  'F_OTHER_BOMB',
  'F_SPACE_BOMB',
]);
const BOMB_WEAPON_FLAG = 'F_BOMB_WEAPON' as const;

export function aerospaceSupportEquipmentKind(
  equipment: Equipment | null | undefined,
): AerospaceSupportEquipmentKind | null {
  if (equipment?.hasFlag('F_BOMB_BAY') === true) return 'bomb-bay';
  if (equipment?.hasFlag('F_BOOBY_TRAP') === true) return 'booby-trap';
  if (equipment?.hasFlag('F_EXTERNAL_STORES_HARDPOINT') === true) return 'external-stores-hardpoint';
  if (equipment?.hasFlag(MOBILE_HPG_FLAG) === true) return 'mobile-hpg';
  if (equipment?.hasFlag('F_SPACE_MINE_DISPENSER') === true) return 'space-mine-dispenser';
  if (equipment?.hasFlag('F_VEHICLE_MINE_DISPENSER') === true) return 'vehicle-mine-dispenser';
  return null;
}

export function aerospaceSupportAlphaStrikeAbilities(
  equipment: Equipment | null | undefined,
): readonly string[] {
  const kind = aerospaceSupportEquipmentKind(equipment);
  return kind === 'mobile-hpg' ? Object.freeze(['HPG']) : Object.freeze([]);
}

export function aerospaceMineDispenserCapacity(
  equipment: Equipment | null | undefined,
): number | null {
  const kind = aerospaceSupportEquipmentKind(equipment);
  return kind === 'space-mine-dispenser' || kind === 'vehicle-mine-dispenser' ? 2 : null;
}

export function isBoobyTrapEquipment(equipment: Equipment | null | undefined): boolean {
  return aerospaceSupportEquipmentKind(equipment) === 'booby-trap';
}

export function isBombBayEquipment(equipment: Equipment | null | undefined): boolean {
  return aerospaceSupportEquipmentKind(equipment) === 'bomb-bay';
}

/** Bomb payload identity used by targeting and aerospace construction mass. */
export function isBombEquipment(equipment: Equipment | null | undefined): boolean {
  if (equipment?.type === 'ammo') return equipment.hasAnyFlag(BOMB_AMMO_FLAGS);
  return equipment?.type === 'weapon' && equipment.hasFlag(BOMB_WEAPON_FLAG);
}

export function isExternalStoresHardpointEquipment(
  equipment: Equipment | null | undefined,
): boolean {
  return aerospaceSupportEquipmentKind(equipment) === 'external-stores-hardpoint';
}

export function aerospaceSupportCrewContribution(
  equipment: Equipment | null | undefined,
): number {
  return aerospaceSupportEquipmentKind(equipment) === 'mobile-hpg'
    ? isEquipmentForPlatform(equipment, 'tank') ? 1 : 10
    : 0;
}

export function aerospaceSupportOperatingHeat(
  equipment: Equipment | null | undefined,
): number | null {
  return aerospaceSupportEquipmentKind(equipment) === 'mobile-hpg'
    ? isEquipmentForPlatform(equipment, 'mek') ? 20 : 40
    : null;
}

export function unsupportedMekAerospaceHeatFlag(
  equipment: Equipment | null | undefined,
): EquipmentFlag | undefined {
  return aerospaceSupportEquipmentKind(equipment) === 'mobile-hpg' ? MOBILE_HPG_FLAG : undefined;
}

export function boobyTrapVariableTonnage(
  equipment: Equipment | null | undefined,
  entityTonnage: number,
  standardRound: (value: number) => number,
): number | null {
  return isBoobyTrapEquipment(equipment) ? standardRound(entityTonnage / 10) : null;
}

export function usesLargeCraftAerospaceSupportSlot(
  equipment: Equipment | null | undefined,
): boolean {
  const kind = aerospaceSupportEquipmentKind(equipment);
  return isChaffPodEquipment(equipment)
    || kind === 'space-mine-dispenser'
    || kind === 'mobile-hpg';
}

export function usesSmallCraftAerospaceSupportSlot(
  equipment: Equipment | null | undefined,
): boolean {
  return usesLargeCraftAerospaceSupportSlot(equipment) || isBoobyTrapEquipment(equipment);
}

export function isExplosiveAerospaceSupportEquipment(
  equipment: Equipment | null | undefined,
): boolean {
  return isBombBayEquipment(equipment) || isBoobyTrapEquipment(equipment);
}
