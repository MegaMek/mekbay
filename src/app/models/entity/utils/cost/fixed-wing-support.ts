// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { FixedWingSupportEntity } from '../../entities/aero/fixed-wing-support-entity';
import { getEquipmentEngineWeight } from '../equipment-engine-weight';
import { nextHalfTon, standardRound } from './common';
import { amount, buildCostReport, multiplier, type EntityCostEntry, type EntityCostReport } from './cost-report';
import { isPpcEquipment } from '../../../ppc-capacitor.model';
import { isSupportVehicleBarArmor } from '../../../construction-equipment.model';
import {
  supportVehicleChassisCostMultiplier,
  supportVehicleStructureMultiplier,
} from '../../../chassis-equipment.model';

/** Mirrors MegaMek's FixedWingSupportCostCalculator. */
export function calculateFixedWingSupportCost(
  entity: FixedWingSupportEntity,
  equipmentCost: number,
): number {
  return calculateFixedWingSupportCostReport(entity, [amount('Equipment', equipmentCost)]).total;
}

export function calculateFixedWingSupportCostReport(
  entity: FixedWingSupportEntity,
  equipment: readonly EntityCostEntry[],
): EntityCostReport {
  const tonnage = entity.tonnage();
  const engine = entity.mountedEngine();
  const structureWeight = floorSupportWeight(
    fixedWingBaseChassisValue(tonnage)
      * techRatingStructureMultiplier(entity.structuralTechRating())
      * supportVehicleStructureMultiplier(entity.equipment().map(mount => mount.equipment))
      * tonnage,
    tonnage,
  );
  const chassisCost = 2500 * structureWeight
    * supportVehicleChassisCostMultiplier(
      entity.equipment().map(mount => mount.equipment),
      'fixed-wing-support',
    );
  const engineCost = engine.installed
    ? 5000 * getEquipmentEngineWeight(entity) * engine.descriptor().svCostMultiplier
    : 0;
  const armorCost = calculateFixedWingArmorCost(entity);
  const structuralTechMultiplier = 0.5 + entity.structuralTechRating() * 0.25;

  // This family deliberately considers only laser and PPC flags. Unlike other
  // support vehicles, plasma weapons and flamers do not enter either sum.
  let requiredHeatSinks = 0;
  let amplifierWeaponTonnage = 0;
  for (const mount of entity.mountedWeapons()) {
    if (!mount.equipment.hasWeaponTrait('laser') && !isPpcEquipment(mount.equipment)) continue;
    requiredHeatSinks += mount.equipment.heat;
    amplifierWeaponTonnage += mount.getTonnage(entity) ?? 0;
  }
  const amplifierWeight = engine.isFusion || engine.isFission
    || entity.weightClass() === 'Small Support'
    ? 0
    : nextHalfTon(amplifierWeaponTonnage / 10);

  return buildCostReport([
    amount('Chassis', chassisCost), amount('Engine', engineCost), amount('Armor', armorCost),
    multiplier('Structural Tech Rating', structuralTechMultiplier),
    amount('Power Amplifiers', 20000 * amplifierWeight), amount('Heatsinks', 2000 * requiredHeatSinks),
    ...equipment, multiplier('Omni Multiplier', 1.25, entity.omni()),
    multiplier('Weight Multiplier', fixedWingPriceMultiplier(entity.motiveType(), tonnage)),
  ], true);
}

function fixedWingBaseChassisValue(tonnage: number): number {
  return tonnage < 5 ? 0.08 : tonnage <= 100 ? 0.1 : 0.15;
}

function calculateFixedWingArmorCost(entity: FixedWingSupportEntity): number {
  const uniform = entity.uniformArmor();
  if (uniform) {
    const armor = uniform.armor;
    if (!armor.hasFixedCost()) throw new Error(`Unable to calculate armor cost for ${armor.id}`);
    if (isSupportVehicleBarArmor(armor)) return entity.totalArmorPoints() * armor.cost;
    return standardRound(entity.totalArmorPoints() / (16 * armor.pptMultiplier), entity) * armor.cost;
  }

  let total = 0;
  for (const [location, mountedArmor] of entity.armorByLocation()) {
    const armor = mountedArmor.armor;
    if (!armor.hasFixedCost()) throw new Error(`Unable to calculate armor cost for ${armor.id}`);
    const points = entity.armorValues().get(location);
    const armorPoints = (points?.front ?? 0) + (points?.rear ?? 0);
    total += isSupportVehicleBarArmor(armor)
      ? armorPoints * armor.cost
      : standardRound(armorPoints / (16 * armor.pptMultiplier), entity) * armor.cost;
  }
  return total;
}

function techRatingStructureMultiplier(rating: number): number {
  return [1.6, 1.3, 1.15, 1, 0.85, 0.66][rating] ?? 1;
}

function floorSupportWeight(weight: number, tonnage: number): number {
  return tonnage < 5 ? Math.floor(weight * 1000) / 1000 : Math.floor(weight * 2) / 2;
}

function fixedWingPriceMultiplier(motiveType: string, tonnage: number): number {
  if (motiveType === 'Airship') return 1 + tonnage / 10000;
  if (motiveType === 'Station Keeping') return 1 + tonnage / 75;
  return 1 + tonnage / 50;
}
