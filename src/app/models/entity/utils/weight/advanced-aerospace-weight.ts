// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, ArmorEquipment, MiscEquipment, StructureEquipment, WeaponEquipment } from '../../../equipment.model';
import { getBayConstructionWeight, isQuartersBay } from '../../bays/bay-definitions';
import type { JumpShipEntity } from '../../entities/largecraft/jumpship-entity';
import { ceilToHalfTon } from './weight-rounding';
import { capitalCraftArmorPointsPerTon } from '../large-craft-armor';
import { isConstructionSystemEquipment } from '../../../construction-equipment.model';
import { isNavalC3Equipment } from '../../../c3-network.model';
import { usesLargeCraftAerospaceSupportSlot } from '../../../aerospace-support-equipment.model';
import { usesLargeCraftSensorSlot } from '../../../sensor-equipment.model';

export interface AdvancedAerospaceWeightBreakdown {
  readonly structure: number; readonly engine: number; readonly jumpDrive: number;
  readonly lithiumFusionBattery: number; readonly sail: number; readonly controls: number;
  readonly fuel: number; readonly heatSinks: number; readonly armor: number;
  readonly fireControl: number; readonly miscellaneous: number; readonly weapons: number;
  readonly ammo: number; readonly carryingSpace: number; readonly dockingCollars: number;
  readonly quarters: number; readonly gravDecks: number; readonly escapeCraft: number;
  readonly exact: number; readonly rounded: number;
}

export function calculateAdvancedAerospaceEffectiveTonnage(entity: JumpShipEntity): number {
  return calculateAdvancedAerospaceWeightBreakdown(entity).rounded;
}

export function calculateAdvancedAerospaceWeightBreakdown(entity: JumpShipEntity): AdvancedAerospaceWeightBreakdown {
  const tonnage = entity.tonnage();
  const primitive = entity.driveCoreType() === 'Primitive';
  const year = entity.effectiveOriginalBuildYear();
  const structure = entity.entityType === 'WarShip'
    ? ceilToHalfTon(entity.structuralIntegrity() * tonnage / 1000)
    : ceilToHalfTon(tonnage / (entity.entityType === 'SpaceStation' ? 100 : 150));
  const engineMultiplier = primitive ? primitiveEngineMultiplier(year) : 0.06;
  const engine = roundHalf(entity.originalWalkMP() === 0
    ? 0.012 * tonnage
    : tonnage * entity.originalWalkMP() * engineMultiplier);
  const jumpDrive = entity.jumpDriveWeight();
  const lithiumFusionBattery = entity.lithiumFusion() ? 0.01 * tonnage : 0;
  const sail = calculateSailWeight(entity, primitive, year);
  const controls = Math.ceil(tonnage * (primitive
    ? primitiveControlMultiplier(year)
    : entity.entityType === 'SpaceStation' ? 0.001 : 0.0025));
  const baseFuelPointsPerTon = tonnage < 110000 ? 10 : tonnage < 250000 ? 5 : 2.5;
  const fuelPointsPerTon = baseFuelPointsPerTon / (primitive ? primitiveFuelFactor(year) : 1);
  const fuelOnly = roundHalf(entity.fuel() / fuelPointsPerTon);
  const fuel = fuelOnly + Math.ceil(fuelOnly * 0.02);
  const freeHeatSinks = Math.floor(45 + Math.sqrt(engine * (primitive ? 1 : 2)));
  const heatSinks = Math.max(0, entity.heatSinkCount() - freeHeatSinks);
  const armor = calculateArmorWeight(entity, primitive);
  const fireControl = calculateExtraSlotWeight(entity);
  let miscellaneous = 0, weapons = 0, ammo = 0;
  for (const mount of entity.equipment()) {
    const equipment = mount.equipment;
    if (!equipment) throw new Error(`Unresolved equipment ${mount.equipmentId} on ${entity.displayName()}`);
    if (equipment instanceof ArmorEquipment || equipment instanceof StructureEquipment) continue;
    if (equipment instanceof AmmoEquipment) {
      if (mount.location !== 'Unallocated' && mount.location !== 'None') {
        const bins = Math.ceil((mount.getAmmoShots() ?? equipment.shots) / equipment.shots);
        ammo += ceilToHalfTon(requireTonnage(entity, mount) * bins);
      }
    } else if (equipment instanceof WeaponEquipment) {
      weapons += requireTonnage(entity, mount);
    } else if (equipment instanceof MiscEquipment && !isConstructionSystemEquipment(equipment)) {
      miscellaneous += requireTonnage(entity, mount);
    }
  }
  let carryingSpace = 0, quarters = 0;
  for (const transporter of entity.transporters()) {
    if (transporter.kind === 'troop-space') carryingSpace += transporter.totalSpace;
    else if (transporter.kind === 'bay') {
      const weight = getBayConstructionWeight(transporter);
      if (isQuartersBay(transporter)) quarters += weight;
      else carryingSpace += weight;
    }
  }
  const dockingCollars = entity.dockingCollarCount() * 1000;
  const gravDecks = entity.gravDecks().reduce((sum, diameter) => sum + (diameter < 100 ? 50 : diameter <= 250 ? 100 : 500), 0);
  const escapeCraft = 7 * (entity.lifeboats() + entity.escapePods());
  const exact = structure + engine + jumpDrive + lithiumFusionBattery + sail + controls
    + fuel + heatSinks + armor + fireControl + miscellaneous + weapons + ammo
    + carryingSpace + dockingCollars + quarters + gravDecks + escapeCraft;
  return { structure, engine, jumpDrive, lithiumFusionBattery, sail, controls, fuel,
    heatSinks, armor, fireControl, miscellaneous, weapons, ammo, carryingSpace,
    dockingCollars, quarters, gravDecks, escapeCraft, exact, rounded: ceilToHalfTon(exact) };
}

function calculateSailWeight(entity: JumpShipEntity, primitive: boolean, year: number): number {
  if (!entity.sail()) return 0;
  let divisor: number, base: number;
  if (primitive && year < 2300) {
    if (year < 2230) { divisor = 2000; base = 300; }
    else if (year < 2260) { divisor = 4000; base = 150; }
    else { divisor = 8000; base = 75; }
  } else {
    divisor = entity.entityType === 'WarShip' ? 20000 : primitive ? 20000 : 7500;
    base = 30;
  }
  return Math.ceil(entity.tonnage() / divisor) + base;
}

function calculateArmorWeight(entity: JumpShipEntity, primitive: boolean): number {
  const armor = entity.uniformArmor()?.armor;
  if (!armor) return 0;
  let points = entity.totalArmorPoints();
  if (primitive) points = Math.ceil(points / 0.66);
  const weightedPoints = Math.max(0, points - 6 * Math.round(entity.structuralIntegrity() / 10));
  const pointsPerTon = capitalCraftArmorPointsPerTon(entity.tonnage(), armor);
  return ceilToHalfTon(weightedPoints / pointsPerTon);
}

function calculateExtraSlotWeight(entity: JumpShipEntity): number {
  const slotsPerArc = entity.entityType === 'JumpShip' ? 12 : 20;
  const arcs = new Map<string, { slots: number; tonnage: number }>();
  for (const mount of entity.equipment()) {
    const equipment = mount.equipment;
    if (!equipment || mount.location === 'Unallocated' || mount.location === 'None') continue;
    if (!(equipment instanceof WeaponEquipment)
      && !(equipment instanceof MiscEquipment
        && (usesLargeCraftAerospaceSupportSlot(equipment)
          || usesLargeCraftSensorSlot(equipment)))) continue;
    const arc = arcs.get(mount.location) ?? { slots: 0, tonnage: 0 };
    arc.slots += equipment.hasWeaponTrait('mass-driver') ? 10 : 1;
    arc.tonnage += requireTonnage(entity, mount);
    arcs.set(mount.location, arc);
  }
  const multiplier = entity.equipment().some(mount => isNavalC3Equipment(mount.equipment)) ? 2 : 1;
  let result = 0;
  for (const arc of arcs.values()) {
    const excess = Math.trunc((arc.slots - 1) / slotsPerArc);
    if (excess > 0) result += ceilToHalfTon(excess * arc.tonnage / 10) * multiplier;
  }
  return result;
}

function roundHalf(value: number): number { return Math.round(value * 2) / 2; }
function primitiveEngineMultiplier(year: number): number { return year >= 2300 ? .06 : year >= 2251 ? .066 : year >= 2201 ? .084 : year >= 2151 ? .102 : .12; }
function primitiveControlMultiplier(year: number): number { return year >= 2300 ? .0025 : year >= 2251 ? .00275 : year >= 2201 ? .0035 : year >= 2151 ? .005 : .00625; }
function primitiveFuelFactor(year: number): number { return year >= 2300 ? 1 : year >= 2251 ? 1.1 : year >= 2201 ? 1.4 : year >= 2151 ? 1.7 : 2; }
function requireTonnage(entity: JumpShipEntity, mount: { equipmentId: string; getTonnage(owner: JumpShipEntity): number | undefined }): number {
  const value = mount.getTonnage(entity);
  if (value === undefined) throw new Error(`Unable to calculate tonnage for ${mount.equipmentId} on ${entity.displayName()}`);
  return value;
}
