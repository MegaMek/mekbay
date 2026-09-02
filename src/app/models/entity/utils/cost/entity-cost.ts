// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { BaseEntity } from '../../base-entity';
import type { AeroEntity } from '../../entities/aero/aero-entity';
import type { ConvFighterEntity } from '../../entities/aero/conv-fighter-entity';
import type { DropShipEntity } from '../../entities/aero/dropship-entity';
import type { FixedWingSupportEntity } from '../../entities/aero/fixed-wing-support-entity';
import type { SmallCraftEntity } from '../../entities/aero/small-craft-entity';
import type { BattleArmorEntity } from '../../entities/infantry/battle-armor-entity';
import type { InfantryEntity } from '../../entities/infantry/infantry-entity';
import type { JumpShipEntity } from '../../entities/largecraft/jumpship-entity';
import type { SpaceStationEntity } from '../../entities/largecraft/space-station-entity';
import type { WarShipEntity } from '../../entities/largecraft/warship-entity';
import type { MekEntity } from '../../entities/mek/mek-entity';
import type { ProtoMekEntity } from '../../entities/protomek/protomek-entity';
import { isVehicleEntity } from '../entity-type-guards';
import { calculateAeroFighterCostReport, calculateConventionalFighterCostReport } from './aerospace';
import { calculateMountedEquipmentCostBreakdown } from './equipment-total';
import { amount, buildCostReport } from './cost-report';
import type { EntityCostReport } from './cost-report';
import { calculateFixedWingSupportCostReport } from './fixed-wing-support';
import { calculateBattleArmorCostReport, calculateInfantryCostReport } from './infantry';
import {
  calculateDropShipCostReport,
  calculateJumpShipCostReport,
  calculateSpaceStationCostReport,
  calculateWarShipCostReport,
} from './large-craft';
import { calculateMekCostReport } from './meks';
import { calculateProtoMekCostReport } from './protomeks';
import { calculateSmallCraftCostReport } from './small-craft';
import { calculateVehicleCostReport } from './vehicles';

export interface EntityCostOptions {
  /** Excludes ammunition other than coolant pods. MegaMek's exported cost uses false. */
  readonly ignoreAmmo?: boolean;
}

/** Returns the canonical construction-cost report for the entity state. */
export function calculateEntityCostDetails(
  entity: BaseEntity,
  options: EntityCostOptions = {},
): EntityCostReport {
  const ignoreAmmo = options.ignoreAmmo ?? false;
  const equipment = calculateMountedEquipmentCostBreakdown(entity, ignoreAmmo);
  const equipmentCost = equipment.total;

  // MegaMek prices a handheld weapon's equipment once as its structure and
  // once as its equipment payload.
  if (entity.entityType === 'HandheldWeapon') {
    return buildCostReport([amount('Structure', equipmentCost), ...equipment.entries]);
  }
  if (entity.entityType === 'ProtoMek') {
    return calculateProtoMekCostReport(entity as ProtoMekEntity, equipment.entries);
  }
  if (isVehicleEntity(entity)) return calculateVehicleCostReport(entity, equipment.entries);
  if (entity.entityType === 'Aero') return calculateAeroFighterCostReport(entity as AeroEntity, equipment.entries);
  if (entity.entityType === 'ConvFighter') {
    return calculateConventionalFighterCostReport(entity as ConvFighterEntity, equipment.entries);
  }
  if (entity.entityType === 'BattleArmor') {
    return calculateBattleArmorCostReport(entity as BattleArmorEntity, equipment.entries);
  }
  if (entity.entityType === 'Infantry') return calculateInfantryCostReport(entity as InfantryEntity);
  if (entity.entityType === 'Mek') return calculateMekCostReport(entity as MekEntity, equipment.entries);
  if (entity.entityType === 'SmallCraft') {
    return calculateSmallCraftCostReport(entity as SmallCraftEntity, equipment.entries);
  }
  if (entity.entityType === 'FixedWingSupport') {
    return calculateFixedWingSupportCostReport(entity as FixedWingSupportEntity, equipment.entries);
  }
  if (entity.entityType === 'DropShip') {
    return calculateDropShipCostReport(entity as DropShipEntity, equipment.entries);
  }
  if (entity.entityType === 'JumpShip') {
    return calculateJumpShipCostReport(entity as JumpShipEntity, equipment.entries);
  }
  if (entity.entityType === 'WarShip') {
    return calculateWarShipCostReport(entity as WarShipEntity, equipment.entries);
  }
  if (entity.entityType === 'SpaceStation') {
    return calculateSpaceStationCostReport(entity as SpaceStationEntity, equipment.entries);
  }

  return buildCostReport([amount('Equipment', equipmentCost)]);
}
