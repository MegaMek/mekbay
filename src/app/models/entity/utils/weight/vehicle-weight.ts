// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, ArmorEquipment, MiscEquipment, StructureEquipment, WeaponEquipment, type Equipment } from '../../../equipment.model';
import { isHeatSinkEquipment } from '../../../heat-equipment.model';
import { isModularArmorEquipment } from '../../../modular-armor.model';
import { getBayConstructionWeight, isQuartersBay } from '../../bays/bay-definitions';
import type { VehicleEntity } from '../../entities/vehicle/vehicle-entity';
import { STRUCTURE_TYPE } from '../../types/structure';
import { calculateHeatNeutralRequirement, calculatePowerAmplifierWeight } from '../cost/common';
import { getEquipmentEngineWeight } from '../equipment-engine-weight';
import { resolveLabArmorEquipment } from './armor-weight';
import { ceilToHalfTon, ceilToKilogram } from './weight-rounding';
import { isConstructionSystemEquipment } from '../../../construction-equipment.model';

export interface VehicleWeightBreakdown {
  readonly engine: number;
  readonly structure: number;
  readonly controls: number;
  readonly heatSinks: number;
  readonly armor: number;
  readonly turret: number;
  readonly dualTurret: number;
  readonly liftingEquipment: number;
  readonly miscellaneous: number;
  readonly weapons: number;
  readonly ammo: number;
  readonly powerAmplifiers: number;
  readonly carryingSpace: number;
  readonly exact: number;
  readonly rounded: number;
}

export function calculateVehicleEffectiveTonnage(entity: VehicleEntity): number {
  return calculateVehicleWeightBreakdown(entity).rounded;
}

export function calculateVehicleWeightBreakdown(entity: VehicleEntity): VehicleWeightBreakdown {
  if (entity.isSupportVehicle()) {
    throw new Error(`Support vehicle weight requires its dedicated verifier: ${entity.displayName()}`);
  }

  const engine = getEquipmentEngineWeight(entity);
  const structure = calculateVehicleStructureWeight(entity);
  const controls = entity.hasNoControlSystems() ? 0 : ceilToHalfTon(entity.tonnage() / 20);
  const heatSinks = Math.max(0,
    calculateHeatNeutralRequirement(entity) - entity.mountedEngine().weightFreeHeatSinks,
  );
  const armor = calculateVehicleArmorWeight(entity);
  const turret = calculateVehicleTurretWeight(entity, false);
  const dualTurret = calculateVehicleTurretWeight(entity, true);
  const liftingEquipment = ['Hover', 'VTOL', 'Hydrofoil', 'Submarine', 'WiGE'].includes(entity.motiveType())
    ? ceilToHalfTon(entity.tonnage() / 10)
    : 0;

  let miscellaneous = 0;
  let weapons = 0;
  let ammo = 0;
  for (const mount of entity.equipment()) {
    const equipment = mount.equipment;
    if (!equipment) throw new Error(`Unresolved equipment ${mount.equipmentId} on ${entity.displayName()}`);
    if (equipment instanceof ArmorEquipment || equipment instanceof StructureEquipment) continue;
    if (equipment instanceof AmmoEquipment) {
      if (mount.location !== 'None') ammo += requireTonnage(entity, mount);
    } else if (equipment instanceof WeaponEquipment) {
      weapons += requireTonnage(entity, mount);
    } else if (equipment instanceof MiscEquipment && !isConstructionSystemEquipment(equipment)) {
      miscellaneous += requireTonnage(entity, mount);
    }
  }

  const powerAmplifiers = calculatePowerAmplifierWeight(entity);
  const carryingSpace = entity.transporters().reduce((total, transporter) => {
    if (transporter.kind === 'troop-space') return total + transporter.totalSpace;
    if (transporter.kind !== 'bay' || isQuartersBay(transporter)) return total;
    return total + getBayConstructionWeight(transporter);
  }, entity.extraSeats() * 0.5);

  const exact = engine + structure + controls + heatSinks + armor + turret + dualTurret
    + liftingEquipment + miscellaneous + weapons + ammo + powerAmplifiers + carryingSpace;
  return {
    engine, structure, controls, heatSinks, armor, turret, dualTurret, liftingEquipment,
    miscellaneous, weapons, ammo, powerAmplifiers, carryingSpace, exact,
    rounded: ceilToHalfTon(exact),
  };
}

export function calculateVehicleStructureWeight(entity: VehicleEntity): number {
  const structureType = entity.uniformStructure()?.structure.structureTypeId ?? STRUCTURE_TYPE.STANDARD;
  let divisor = structureType === STRUCTURE_TYPE.INDUSTRIAL ? 20 : 10;
  const navalSuperHeavy = entity.isSuperHeavy()
    && ['Naval', 'Submarine'].includes(entity.motiveType());
  if (entity.isSuperHeavy() && !navalSuperHeavy) divisor /= 2;
  return ceilToHalfTon(entity.tonnage() / divisor);
}

export function calculateVehicleArmorWeight(entity: VehicleEntity): number {
  const uniform = entity.uniformArmor();
  if (uniform && !entity.hasPatchworkArmor()) {
    const armor = resolveLabArmorEquipment(entity, uniform);
    return ceilToHalfTon(entity.totalArmorPoints() / (16 * armor.pptMultiplier));
  }
  let raw = 0;
  for (const [location, points] of entity.armorValues()) {
    const armor = entity.armorByLocation().get(location)?.armor;
    if (!armor) continue;
    raw += ((points.front ?? 0) + (points.rear ?? 0)) / (16 * armor.pptMultiplier);
  }
  return ceilToHalfTon(raw);
}

/**
 * One turret's mass, for weight and cost (TM p. 279: 5,000 x turret tonnage). On Combat and Support Vehicles alike,
 * "Turrets weigh 10 percent as much as all equipment mounted within the turret, except for armor, ammunition, heat
 * sinks and power amplifiers (rounded up to the nearest kilograms for Small Support Vehicles, or to the nearest
 * half-ton for vehicles weighing 5 tons and up)" (TM p. 241); a dual turret follows the same rules (TO:AUE p. 159).
 * An OmniVehicle's base chassis fixes it.
 */
export function calculateVehicleTurretWeight(entity: VehicleEntity, dual: boolean): number {
  const exists = dual ? entity.hasDualTurret() : entity.hasTurret();
  if (!exists) return 0;
  const baseWeight = dual ? entity.baseChassisTurret2Weight() : entity.baseChassisTurretWeight();
  if (entity.omni() && baseWeight >= 0) return baseWeight;
  const locations = dual ? ['Front Turret'] : ['Turret', 'Rear Turret'];
  const raw = entity.equipment().reduce((total, mount) =>
    locations.includes(mount.location) && isVehicleTurretPayload(mount.equipment) ? total + requireTonnage(entity, mount) : total,
  0) / 10;
  return entity.isSupportVehicle() && entity.tonnage() < 5 ? ceilToKilogram(raw) : ceilToHalfTon(raw);
}

/**
 * Equipment a vehicle turret's mass counts: not armor, ammunition or heat sinks (TM p. 241). Modular Armor is an armor
 * type (TO:AUE p. 92); power amplifiers are never turret mounts.
 */
export function isVehicleTurretPayload(equipment: Equipment | undefined): boolean {
  return !(equipment instanceof AmmoEquipment) && !(equipment instanceof ArmorEquipment)
    && !isModularArmorEquipment(equipment) && !isHeatSinkEquipment(equipment);
}

function requireTonnage(
  entity: VehicleEntity,
  mount: { equipmentId: string; getTonnage(owner: VehicleEntity): number | undefined },
): number {
  const tonnage = mount.getTonnage(entity);
  if (tonnage === undefined) {
    throw new Error(`Unable to calculate tonnage for ${mount.equipmentId} on ${entity.displayName()}`);
  }
  return tonnage;
}
