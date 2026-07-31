import { Equipment } from '../../equipment.model';
import type { EntityMountedEquipment } from '../types/equipment';
import type { FixedPhysicalDamage } from '../types/weapon';

export type EntityMountedPhysicalWeapon = EntityMountedEquipment & {
  readonly equipment: Equipment;
};

/** Physical equipment exported as an independently mounted attack capability. */
export function isPhysicalWeaponEquipment(equipment?: Equipment): boolean {
  return !!equipment && equipment.hasAnyFlag(['F_CLUB', 'F_HAND_WEAPON', 'F_TALON']);
}

export function isEntityMountedPhysicalWeapon(
  mount: EntityMountedEquipment,
): mount is EntityMountedPhysicalWeapon {
  return isPhysicalWeaponEquipment(mount.equipment);
}

/** Static record-sheet damage, excluding combat state, modes, myomer, and target effects. */
export function resolvePhysicalWeaponDamage(
  equipment: Equipment,
  entityTonnage: number,
): FixedPhysicalDamage {
  let value: number;
  if (equipment.hasFlag('F_TALON')) value = Math.round(Math.floor(entityTonnage / 5) * 1.5);
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
