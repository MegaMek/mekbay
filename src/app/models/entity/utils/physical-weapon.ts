// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Equipment } from '../../equipment.model';
import type { EntityMountedEquipment } from '../types/equipment';
import type { FixedPhysicalDamage } from '../types/weapon';

export type EntityMountedPhysicalWeapon = EntityMountedEquipment & {
  readonly equipment: Equipment;
};

export interface ShieldProfile {
  readonly bashBonus: number;
  readonly damageAbsorption: number;
  readonly damageCapacity: number;
}

/** Physical equipment exported as an independently mounted attack capability. */
export function isPhysicalWeaponEquipment(equipment?: Equipment): boolean {
  return !!equipment && equipment.hasAnyFlag(['F_SHIELD', 'F_CLUB', 'F_HAND_WEAPON', 'F_TALON']);
}

export function isEntityMountedPhysicalWeapon(
  mount: EntityMountedEquipment,
): mount is EntityMountedPhysicalWeapon {
  return isPhysicalWeaponEquipment(mount.equipment);
}

/** Static shield values shared by record-sheet and live rules calculations. */
export function resolveShieldProfile(equipment?: Equipment): ShieldProfile | undefined {
  if (!equipment) return undefined;
  if (equipment.hasFlag('S_SHIELD_LARGE')) {
    return { bashBonus: 3, damageAbsorption: 7, damageCapacity: 25 };
  }
  if (equipment.hasFlag('S_SHIELD_MEDIUM')) {
    return { bashBonus: 2, damageAbsorption: 5, damageCapacity: 18 };
  }
  if (equipment.hasFlag('S_SHIELD_SMALL')) {
    return { bashBonus: 1, damageAbsorption: 3, damageCapacity: 11 };
  }
  return undefined;
}

/** Static record-sheet damage, excluding combat state, modes, myomer, and target effects. */
export function resolvePhysicalWeaponDamage(
  equipment: Equipment,
  entityTonnage: number,
): FixedPhysicalDamage {
  let value: number;
  if (equipment.hasFlag('F_SHIELD')) value = resolveShieldProfile(equipment)?.damageAbsorption ?? 0;
  else if (equipment.hasFlag('F_TALON')) value = Math.round(Math.floor(entityTonnage / 5) * 1.5);
  else if (equipment.hasAllFlags(['F_HAND_WEAPON', 'S_CLAW'])) value = Math.ceil(entityTonnage / 7);
  else if (equipment.hasFlag('S_SWORD')) value = Math.ceil(entityTonnage / 10) + 1;
  else if (equipment.hasFlag('S_RETRACTABLE_BLADE')) value = Math.ceil(entityTonnage / 10);
  else if (equipment.hasFlag('S_MACE')) value = Math.ceil(entityTonnage / 4);
  else if (equipment.hasFlag('S_PILE_DRIVER')) value = 10;
  else if (equipment.hasFlag('S_FLAIL')) value = 9;
  else if (equipment.hasFlag('S_DUAL_SAW')) value = 7;
  else if (equipment.hasFlag('S_CHAINSAW')) value = 5;
  else if (equipment.hasFlag('S_BACKHOE')) value = 6;
  else if (equipment.hasFlag('S_MINING_DRILL')) value = 4;
  else if (equipment.hasFlag('S_WRECKING_BALL')) value = 8;
  else if (equipment.hasFlag('S_VIBRO_LARGE')) value = 14;
  else if (equipment.hasFlag('S_VIBRO_MEDIUM')) value = 10;
  else if (equipment.hasFlag('S_VIBRO_SMALL')) value = 7;
  else if (equipment.hasFlag('S_CHAIN_WHIP')) value = 3;
  else if (equipment.hasFlag('S_COMBINE')) value = 3;
  else if (equipment.hasAnyFlag(['S_ROCK_CUTTER', 'S_SPOT_WELDER'])) value = 5;
  else value = Math.floor(entityTonnage / 5);

  return { kind: 'fixed', value };
}
