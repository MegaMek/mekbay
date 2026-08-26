// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentFlag } from './equipment-flags.type';
import type { Equipment } from './equipment.model';
import { isEquipmentForPlatform } from './equipment-platform.model';

const STRUCTURE_MODIFIERS = Object.freeze([
  ['F_AMPHIBIOUS', 1.75],
  ['F_ARMORED_CHASSIS', 1.5],
  ['F_BICYCLE', 0.75],
  ['F_CONVERTIBLE', 1.1],
  ['F_DUNE_BUGGY', 1.5],
  ['F_ENVIRONMENTAL_SEALING', 2],
  ['F_EXTERNAL_POWER_PICKUP', 1.1],
  ['F_HYDROFOIL', 1.7],
  ['F_MONOCYCLE', 0.5],
  ['F_OFF_ROAD', 1.5],
  ['F_PROP', 1.2],
  ['F_SNOWMOBILE', 1.75],
  ['F_STOL_CHASSIS', 1.5],
  ['F_SUBMERSIBLE', 1.8],
  ['F_TRACTOR_MODIFICATION', 1.2],
  ['F_TRAILER_MODIFICATION', 0.8],
  ['F_ULTRA_LIGHT', 0.5],
  ['F_VSTOL_CHASSIS', 2],
] as const satisfies readonly (readonly [EquipmentFlag, number])[]);

const SUPPORT_VEHICLE_COST_MODIFIERS = Object.freeze([
  ['F_AMPHIBIOUS', 1.25],
  ['F_ARMORED_CHASSIS', 2],
  ['F_BICYCLE', 0.75],
  ['F_CONVERTIBLE', 1.1],
  ['F_DUNE_BUGGY', 1.25],
  ['F_ENVIRONMENTAL_SEALING', 1.75],
  ['F_EXTERNAL_POWER_PICKUP', 1.1],
  ['F_HYDROFOIL', 1.1],
  ['F_MONOCYCLE', 1.3],
  ['F_OFF_ROAD', 1.2],
  ['F_PROP', 0.75],
  ['F_SNOWMOBILE', 1.3],
  ['F_STOL_CHASSIS', 1.5],
  ['F_SUBMERSIBLE', 3.5],
  ['F_TRACTOR_MODIFICATION', 1.1],
  ['F_TRAILER_MODIFICATION', 0.75],
  ['F_ULTRA_LIGHT', 1.5],
  ['F_VSTOL_CHASSIS', 2],
] as const satisfies readonly (readonly [EquipmentFlag, number])[]);

const FIXED_WING_COST_MODIFIERS = Object.freeze([
  ['F_AMPHIBIOUS', 1.25],
  ['F_ARMORED_CHASSIS', 2],
  ['F_ENVIRONMENTAL_SEALING', 1.75],
  ['F_PROP', 0.75],
  ['F_STOL_CHASSIS', 1.5],
  ['F_ULTRA_LIGHT', 1.5],
  ['F_VSTOL_CHASSIS', 2],
] as const satisfies readonly (readonly [EquipmentFlag, number])[]);

export type ChassisEquipmentKind =
  | 'amphibious'
  | 'armored-chassis'
  | 'bicycle'
  | 'convertible'
  | 'dune-buggy'
  | 'environmental-sealing'
  | 'external-power-pickup'
  | 'hydrofoil'
  | 'monocycle'
  | 'off-road'
  | 'propeller'
  | 'snowmobile'
  | 'stol'
  | 'submersible'
  | 'tractor'
  | 'trailer'
  | 'ultra-light'
  | 'vstol'
  | 'flotation-hull'
  | 'limited-amphibious'
  | 'fully-amphibious'
  | 'armored-motive-system'
  | 'tracks'
  | 'chain-drape'
  | 'magnetic-clamp'
  | 'lam-fuel-tank';

export function chassisEquipmentKind(
  equipment: Equipment | null | undefined,
): ChassisEquipmentKind | null {
  if (equipment?.hasFlag('F_AMPHIBIOUS') === true) return 'amphibious';
  if (equipment?.hasFlag('F_ARMORED_CHASSIS') === true) return 'armored-chassis';
  if (equipment?.hasFlag('F_BICYCLE') === true) return 'bicycle';
  if (equipment?.hasFlag('F_CONVERTIBLE') === true) return 'convertible';
  if (equipment?.hasFlag('F_DUNE_BUGGY') === true) return 'dune-buggy';
  if (equipment?.hasFlag('F_ENVIRONMENTAL_SEALING') === true) return 'environmental-sealing';
  if (equipment?.hasFlag('F_EXTERNAL_POWER_PICKUP') === true) return 'external-power-pickup';
  if (equipment?.hasFlag('F_HYDROFOIL') === true) return 'hydrofoil';
  if (equipment?.hasFlag('F_MONOCYCLE') === true) return 'monocycle';
  if (equipment?.hasFlag('F_OFF_ROAD') === true) return 'off-road';
  if (equipment?.hasFlag('F_PROP') === true) return 'propeller';
  if (equipment?.hasFlag('F_SNOWMOBILE') === true) return 'snowmobile';
  if (equipment?.hasFlag('F_STOL_CHASSIS') === true) return 'stol';
  if (equipment?.hasFlag('F_SUBMERSIBLE') === true) return 'submersible';
  if (equipment?.hasFlag('F_TRACTOR_MODIFICATION') === true) return 'tractor';
  if (equipment?.hasFlag('F_TRAILER_MODIFICATION') === true) return 'trailer';
  if (equipment?.hasFlag('F_ULTRA_LIGHT') === true) return 'ultra-light';
  if (equipment?.hasFlag('F_VSTOL_CHASSIS') === true) return 'vstol';
  if (equipment?.hasFlag('F_FLOTATION_HULL') === true) return 'flotation-hull';
  if (equipment?.hasFlag('F_LIMITED_AMPHIBIOUS') === true) return 'limited-amphibious';
  if (equipment?.hasFlag('F_FULLY_AMPHIBIOUS') === true) return 'fully-amphibious';
  if (equipment?.hasFlag('F_ARMORED_MOTIVE_SYSTEM') === true) return 'armored-motive-system';
  if (equipment?.hasFlag('F_TRACKS') === true) return 'tracks';
  if (equipment?.hasFlag('F_CHAIN_DRAPE') === true) return 'chain-drape';
  if (equipment?.hasFlag('F_MAGNETIC_CLAMP') === true) return 'magnetic-clamp';
  if (equipment?.hasFlag('F_LAM_FUEL_TANK') === true) return 'lam-fuel-tank';
  return null;
}

export function supportVehicleStructureMultiplier(
  equipment: Iterable<Equipment | null | undefined>,
): number {
  return combinedModifier(equipment, STRUCTURE_MODIFIERS);
}

export function supportVehicleChassisCostMultiplier(
  equipment: Iterable<Equipment | null | undefined>,
  profile: 'support-vehicle' | 'fixed-wing-support' = 'support-vehicle',
): number {
  return combinedModifier(
    equipment,
    profile === 'fixed-wing-support' ? FIXED_WING_COST_MODIFIERS : SUPPORT_VEHICLE_COST_MODIFIERS,
  );
}

export function isChassisSystemEquipment(equipment: Equipment | null | undefined): boolean {
  return equipment?.hasFlag('F_CHASSIS_MODIFICATION') === true;
}

export function isEnvironmentalSealingEquipment(equipment: Equipment | null | undefined): boolean {
  return chassisEquipmentKind(equipment) === 'environmental-sealing';
}

export function isFlotationOrSealingEquipment(equipment: Equipment | null | undefined): boolean {
  const kind = chassisEquipmentKind(equipment);
  return kind === 'flotation-hull' || kind === 'environmental-sealing';
}

export function isDuneBuggyEquipment(equipment: Equipment | null | undefined): boolean {
  return chassisEquipmentKind(equipment) === 'dune-buggy';
}

export function isOffRoadEquipment(equipment: Equipment | null | undefined): boolean {
  return chassisEquipmentKind(equipment) === 'off-road';
}

export function isPropellerEquipment(equipment: Equipment | null | undefined): boolean {
  return chassisEquipmentKind(equipment) === 'propeller';
}

export function isHydrofoilEquipment(equipment: Equipment | null | undefined): boolean {
  return chassisEquipmentKind(equipment) === 'hydrofoil';
}

export function isTrailerEquipment(equipment: Equipment | null | undefined): boolean {
  return chassisEquipmentKind(equipment) === 'trailer';
}

export function isVstolEquipment(equipment: Equipment | null | undefined): boolean {
  return chassisEquipmentKind(equipment) === 'vstol';
}

export function isStolOrVstolEquipment(equipment: Equipment | null | undefined): boolean {
  const kind = chassisEquipmentKind(equipment);
  return kind === 'stol' || kind === 'vstol';
}

export function isTracksEquipment(equipment: Equipment | null | undefined): boolean {
  return chassisEquipmentKind(equipment) === 'tracks';
}

export function isQuadVeeTracksEquipment(equipment: Equipment | null | undefined): boolean {
  return isTracksEquipment(equipment) && equipment?.hasFlag('S_QUADVEE_WHEELS') === true;
}

export function isChainDrapeEquipment(equipment: Equipment | null | undefined): boolean {
  return chassisEquipmentKind(equipment) === 'chain-drape';
}

export function isMagneticClampEquipment(equipment: Equipment | null | undefined): boolean {
  return chassisEquipmentKind(equipment) === 'magnetic-clamp';
}

export function isLamFuelTankEquipment(equipment: Equipment | null | undefined): boolean {
  return chassisEquipmentKind(equipment) === 'lam-fuel-tank';
}

export function chassisDefensiveBattleValueBonus(
  equipment: Equipment | null | undefined,
): number {
  const kind = chassisEquipmentKind(equipment);
  if (kind === 'fully-amphibious') return 0.2;
  return kind === 'limited-amphibious'
    || kind === 'dune-buggy'
    || kind === 'flotation-hull'
    || kind === 'environmental-sealing'
    || kind === 'armored-motive-system'
    ? 0.1
    : 0;
}

export function chassisAlphaStrikeAbilities(
  equipment: Equipment | null | undefined,
): readonly ('ARS' | 'AMP' | 'ORO' | 'DUN' | 'HTC')[] {
  const kind = chassisEquipmentKind(equipment);
  const abilities: ('ARS' | 'AMP' | 'ORO' | 'DUN' | 'HTC')[] = [];
  if (kind === 'armored-motive-system') abilities.push('ARS');
  if (kind === 'amphibious' || kind === 'fully-amphibious' || kind === 'limited-amphibious') {
    abilities.push('AMP');
  }
  if (kind === 'off-road') abilities.push('ORO');
  if (kind === 'dune-buggy') abilities.push('DUN');
  if (kind === 'tractor' || kind === 'trailer') abilities.push('HTC');
  return abilities;
}

export interface ChassisTonnageContext {
  readonly entityTonnage: number;
  readonly entityIsSupportVehicle: boolean;
  readonly standardRound: (value: number) => number;
}

/** Entity-dependent tonnage owned by chassis and motive equipment. */
export function chassisEquipmentVariableTonnage(
  equipment: Equipment | null | undefined,
  context: ChassisTonnageContext,
): number | null {
  const kind = chassisEquipmentKind(equipment);
  const tonnage = context.entityTonnage;
  if (kind === 'chain-drape') return nextHalfTon(tonnage / 10);
  if (kind === 'armored-motive-system') {
    return context.standardRound(tonnage * (equipment?.techBase === 'Clan' ? 0.1 : 0.15));
  }
  if (kind === 'dune-buggy') return tonnage / 10;
  if (kind === 'environmental-sealing') {
    return context.entityIsSupportVehicle ? 0 : context.standardRound(tonnage / 10);
  }
  if (kind === 'tracks') {
    return context.standardRound(tonnage * (isQuadVeeTracksEquipment(equipment) ? 0.15 : 0.1));
  }
  if (kind === 'limited-amphibious') return context.standardRound(tonnage / 25);
  if (kind === 'fully-amphibious') return context.standardRound(tonnage / 10);
  if (kind === 'magnetic-clamp' && isEquipmentForPlatform(equipment, 'protomek')) {
    if (tonnage < 6) return 0.25;
    if (tonnage < 10) return 0.5;
    return 1;
  }
  return null;
}

export interface ChassisCostContext {
  readonly entityTonnage: number;
  readonly entityIsMek: boolean;
  readonly engineRating: number;
  readonly equipmentTonnage: () => number | undefined;
}

/**
 * Returns null when the equipment is not a variable-cost chassis item.
 * Undefined means it matched but its dependent tonnage could not be resolved.
 */
export function chassisEquipmentVariableCost(
  equipment: Equipment | null | undefined,
  context: ChassisCostContext,
): number | null | undefined {
  const kind = chassisEquipmentKind(equipment);
  if (kind === 'flotation-hull' || kind === 'off-road') return 0;
  if (kind === 'environmental-sealing') {
    return context.entityIsMek ? 225 * context.entityTonnage : 0;
  }
  if (kind === 'armored-motive-system') return mapTonnage(context, value => value * 100000);
  if (kind === 'limited-amphibious' || kind === 'fully-amphibious') {
    return mapTonnage(context, value => value * 10000);
  }
  if (kind === 'dune-buggy') return mapTonnage(context, value => 10 * value * value);
  if (kind === 'tracks') {
    const multiplier = isQuadVeeTracksEquipment(equipment) ? 750 : 500;
    return Math.ceil((multiplier * context.engineRating * context.entityTonnage) / 75);
  }
  return null;
}

function combinedModifier(
  equipment: Iterable<Equipment | null | undefined>,
  modifiers: readonly (readonly [EquipmentFlag, number])[],
): number {
  const installed = [...equipment];
  return modifiers.reduce((result, [flag, modifier]) => (
    installed.some(candidate => candidate?.hasFlag(flag)) ? result * modifier : result
  ), 1);
}

function mapTonnage(
  context: ChassisCostContext,
  calculate: (tonnage: number) => number,
): number | undefined {
  const tonnage = context.equipmentTonnage();
  return tonnage === undefined ? undefined : calculate(tonnage);
}

function nextHalfTon(tonnage: number): number {
  return Math.ceil(Math.round(tonnage * 1000) / 500) / 2;
}
