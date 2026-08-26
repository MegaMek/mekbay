// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Equipment } from '../../equipment.model';
import type { EntityMountedEquipment } from '../types/equipment';
import type { FixedPhysicalDamage } from '../types/weapon';
import {
  isPhysicalWeaponFlags,
  isBackhoeFlags,
  isClubOrHandWeaponFlags,
  isFlailFlags,
  isHandClawFlags,
  isImprovisedClawFlags,
  isPhysicalEngineeringToolFlags,
  isPhysicalSawFlags,
  isProtoMekMeleeFlags,
  isProtoMekQuadMeleeSystemFlags,
  isShieldFlags,
  isSpotWelderFlags,
  isTalonFlags,
  physicalEquipmentBattleValueFromFlags,
  physicalEquipmentCriticalSlotsFromFlags,
  physicalEquipmentKindFromFlags,
  physicalEquipmentOperatingHeatFromFlags,
  physicalEquipmentVariableCostFromFlags,
  physicalEquipmentVariableTonnageFromFlags,
  resolvePhysicalWeaponDamageFromFlags,
  resolveShieldProfileFromFlags,
  resolveShieldSizeFromFlags,
  type ShieldProfile,
  type PhysicalEquipmentKind,
} from './physical-weapon-kernel';

export type { ShieldProfile } from './physical-weapon-kernel';
export type { PhysicalEquipmentKind } from './physical-weapon-kernel';

export type EntityMountedPhysicalWeapon = EntityMountedEquipment & {
  readonly equipment: Equipment;
};

/** Physical equipment exported as an independently mounted attack capability. */
export function isPhysicalWeaponEquipment(equipment?: Equipment): boolean {
  return !!equipment && isPhysicalWeaponFlags(equipment.flags);
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
  return { kind: 'fixed', value: resolvePhysicalWeaponDamageFromFlags(equipment.flags, entityTonnage) };
}

export function physicalEquipmentKind(equipment?: Equipment): PhysicalEquipmentKind | null {
  return equipment ? physicalEquipmentKindFromFlags(equipment.flags) : null;
}

export function isClubOrHandWeaponEquipment(equipment?: Equipment): boolean {
  return equipment !== undefined && isClubOrHandWeaponFlags(equipment.flags);
}

export function physicalEquipmentVariableTonnage(
  equipment: Equipment | undefined,
  entityTonnage: number,
): number | null {
  return equipment
    ? physicalEquipmentVariableTonnageFromFlags(equipment.flags, entityTonnage)
    : null;
}

export function physicalEquipmentVariableCost(
  equipment: Equipment | undefined,
  entityTonnage: number,
): number | null {
  return equipment
    ? physicalEquipmentVariableCostFromFlags(equipment.flags, entityTonnage)
    : null;
}

export function physicalEquipmentCriticalSlots(
  equipment: Equipment | undefined,
  entityTonnage: number,
): number | null {
  return equipment
    ? physicalEquipmentCriticalSlotsFromFlags(equipment.flags, entityTonnage)
    : null;
}

export function physicalEquipmentBattleValue(
  equipment: Equipment | undefined,
  entityTonnage: number,
  myomerMultiplier: number,
): number | null {
  return equipment
    ? physicalEquipmentBattleValueFromFlags(equipment.flags, entityTonnage, myomerMultiplier)
    : null;
}

export function physicalEquipmentOperatingHeat(equipment?: Equipment): number {
  return equipment ? physicalEquipmentOperatingHeatFromFlags(equipment.flags) : 0;
}

export function isPhysicalSawEquipment(equipment?: Equipment): boolean {
  return equipment !== undefined && isPhysicalSawFlags(equipment.flags);
}

export function isPhysicalEngineeringToolEquipment(equipment?: Equipment): boolean {
  return equipment !== undefined && isPhysicalEngineeringToolFlags(equipment.flags);
}

export function isBackhoeEquipment(equipment?: Equipment): boolean {
  return equipment !== undefined && isBackhoeFlags(equipment.flags);
}

export function isHandClawEquipment(equipment?: Equipment): boolean {
  return equipment !== undefined && isHandClawFlags(equipment.flags);
}

export function isImprovisedClawEquipment(equipment?: Equipment): boolean {
  return equipment !== undefined && isImprovisedClawFlags(equipment.flags);
}

export function isTalonEquipment(equipment?: Equipment): boolean {
  return equipment !== undefined && isTalonFlags(equipment.flags);
}

export function isFlailEquipment(equipment?: Equipment): boolean {
  return equipment !== undefined && isFlailFlags(equipment.flags);
}

export function isSpotWelderEquipment(equipment?: Equipment): boolean {
  return equipment !== undefined && isSpotWelderFlags(equipment.flags);
}

export function isProtoMekMeleeEquipment(equipment?: Equipment): boolean {
  return equipment !== undefined && isProtoMekMeleeFlags(equipment.flags);
}

export function isProtoMekQuadMeleeSystemEquipment(equipment?: Equipment): boolean {
  return equipment !== undefined && isProtoMekQuadMeleeSystemFlags(equipment.flags);
}

export function isShieldEquipment(equipment?: Equipment): boolean {
  return equipment !== undefined && isShieldFlags(equipment.flags);
}

export function resolveShieldSize(equipment?: Equipment): 'small' | 'medium' | 'large' | undefined {
  return equipment === undefined ? undefined : resolveShieldSizeFromFlags(equipment.flags);
}

/** Static shield values shared by record-sheet and live rules calculations. */
export function resolveShieldProfile(equipment?: Equipment): ShieldProfile | undefined {
  return equipment ? resolveShieldProfileFromFlags(equipment.flags) : undefined;
}
