// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { BaseEntity } from '../../base-entity';
import { WeaponEquipment } from '../../../equipment.model';
import type { EntityMountedEquipment } from '../../types/equipment';
import { getEquipmentEngineWeight } from '../equipment-engine-weight';
import { fireControlVariableCost, getFireControlWeaponCost } from '../fire-control';
import {
  getTargetingComputerRelevantWeight,
  targetingComputerVariableCost,
} from '../targeting-computer';
import {
  isBattleArmorMyomerBoosterEquipment,
  isJetBoosterEquipment,
  isMascEquipment,
  isSuperchargerEquipment,
} from '../../../escalating-equipment.model';
import {
  isPartialWingEquipment,
  jumpBoosterVariableCost,
} from '../../../jump-equipment.model';
import { isActuatorEnhancementSystem } from '../../../myomer-equipment.model';
import { isDroneOperatingSystemEquipment } from '../../../drone-operating-system.model';
import { isRamPlateEquipment, isSpikesEquipment } from '../../../physical-augmentation.model';
import { physicalEquipmentVariableCost } from '../physical-weapon';
import { chassisEquipmentVariableCost } from '../../../chassis-equipment.model';
import { largeCraftEquipmentVariableCost } from '../../../large-craft-equipment.model';
import { supportEquipmentVariableCost } from '../../../support-equipment.model';
import { turretEquipmentVariableCost } from '../../../turret-equipment.model';
import { isAntiMekGearEquipment } from '../../../infantry-equipment.model';
import { isDamageInterruptCircuitEquipment } from '../../../utility-equipment.model';

/** Resolves one mount's database-backed fixed or entity-dependent variable cost. */
export function getEquipmentCost(
  entity: BaseEntity,
  mount: EntityMountedEquipment,
): number | undefined {
  const equipment = mount.equipment;
  if (!equipment) return undefined;
  if (equipment.hasFixedCost()) {
    if (!(equipment instanceof WeaponEquipment) || !mount.armored) return equipment.cost;
    const criticalSlots = mount.getNumCriticalSlots(entity);
    return criticalSlots === undefined
      ? undefined
      : equipment.cost + (150000 * criticalSlots);
  }

  const tonnage = entity.tonnage();
  const physicalCost = physicalEquipmentVariableCost(equipment, tonnage);
  const chassisCost = chassisEquipmentVariableCost(equipment, {
    entityTonnage: tonnage,
    entityIsMek: entity.entityType === 'Mek',
    engineRating: entity.mountedEngine().rating,
    equipmentTonnage: () => mount.getTonnage(entity),
  });
  const jumpBoosterCost = jumpBoosterVariableCost(equipment, entity.weightClass());
  const targetingComputerCost = targetingComputerVariableCost(
    equipment,
    () => getTargetingComputerRelevantWeight(entity),
  );
  const fireControlCost = fireControlVariableCost(equipment, () => getFireControlWeaponCost(entity));
  const largeCraftCost = largeCraftEquipmentVariableCost(entity, mount);
  const supportCost = supportEquipmentVariableCost(entity, mount);
  const turretCost = turretEquipmentVariableCost(entity, mount);
  let cost: number | undefined;
  if (supportCost !== null) {
    cost = supportCost;
  } else if (isBattleArmorMyomerBoosterEquipment(equipment)) {
    cost = entity.runMP() * 75000;
  } else if (chassisCost !== null) {
    cost = chassisCost;
  } else if (isJetBoosterEquipment(equipment) || isSuperchargerEquipment(equipment)) {
    cost = entity.isSupportVehicle()
      ? getEquipmentEngineWeight(entity) * 10000
      : entity.mountedEngine().rating * 10000;
  } else if (isMascEquipment(equipment) && entity.entityType === 'ProtoMek') {
    cost = Math.round(entity.mountedEngine().rating * 1000 * tonnage * 0.025);
  } else if (isMascEquipment(equipment)) {
    const mascTonnage = Math.round(tonnage / (equipment.techBase === 'Clan' ? 25 : 20));
    cost = entity.mountedEngine().rating * mascTonnage * 1000;
  } else if (targetingComputerCost !== null) {
    cost = targetingComputerCost;
  } else if (isDroneOperatingSystemEquipment(equipment)) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : (equipmentTonnage * 10000) + 5000;
  } else if (turretCost !== null) {
    cost = turretCost;
  } else if (physicalCost !== null) {
    cost = physicalCost;
  } else if (isSpikesEquipment(equipment)) {
    cost = Math.ceil(tonnage * 50);
  } else if (isPartialWingEquipment(equipment)) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : Math.ceil(equipmentTonnage * 50000);
  } else if (isActuatorEnhancementSystem(equipment)) {
    cost = Math.ceil(tonnage * (entity.locationIsLeg(mount.location) ? 700 : 500));
  } else if (jumpBoosterCost !== null) {
    cost = jumpBoosterCost;
  } else if (fireControlCost !== null) {
    cost = fireControlCost;
  } else if (largeCraftCost !== null) {
    cost = largeCraftCost;
  } else if (isRamPlateEquipment(equipment)) {
    const equipmentTonnage = mount.getTonnage(entity);
    cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 10000;
  } else if (isDamageInterruptCircuitEquipment(equipment)) {
    cost = 150 * Math.max(1, entity.crewSlotCount());
  } else if (isAntiMekGearEquipment(equipment)) {
    // Anti-Mek training is represented by Infantry's price multiplier;
    // the equipment marker has no independent additive cost.
    cost = 0;
  }

  if (cost === undefined || !mount.armored) return cost;
  const criticalSlots = mount.getNumCriticalSlots(entity);
  return criticalSlots === undefined ? undefined : cost + (150000 * criticalSlots);
}
