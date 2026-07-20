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
import { calculateAeroFighterCost, calculateConventionalFighterCost } from './aerospace';
import { calculateMountedEquipmentCost } from './equipment-total';
import { calculateFixedWingSupportCost } from './fixed-wing-support';
import { calculateBattleArmorCost, calculateInfantryCost } from './infantry';
import {
  calculateDropShipCost,
  calculateJumpShipCost,
  calculateSpaceStationCost,
  calculateWarShipCost,
} from './large-craft';
import { calculateMekCost } from './meks';
import { calculateProtoMekCost } from './protomeks';
import { calculateSmallCraftCost } from './small-craft';
import { calculateVehicleCost } from './vehicles';

export interface EntityCostOptions {
  /** Excludes ammunition other than coolant pods. MegaMek's exported cost uses false. */
  readonly ignoreAmmo?: boolean;
}

/**
 * Calculates the construction cost represented by canonical entity state.
 *
 * Equipment prices come from the equipment database through
 * `EntityMountedEquipment.getCost()`. That method only calculates a price
 * when the database marks the equipment cost as `variable`; fixed prices are
 * returned unchanged.
 */
export function calculateEntityCost(
  entity: BaseEntity,
  options: EntityCostOptions = {},
): number {
  const ignoreAmmo = options.ignoreAmmo ?? false;
  const equipmentCost = calculateMountedEquipmentCost(entity, ignoreAmmo);

  // MegaMek prices a handheld weapon's equipment once as its structure and
  // once as its equipment payload.
  if (entity.entityType === 'HandheldWeapon') return equipmentCost * 2;
  if (entity.entityType === 'ProtoMek') {
    return calculateProtoMekCost(entity as ProtoMekEntity, equipmentCost);
  }
  if (isVehicleEntity(entity)) return calculateVehicleCost(entity, equipmentCost);
  if (entity.entityType === 'Aero') return calculateAeroFighterCost(entity as AeroEntity, equipmentCost);
  if (entity.entityType === 'ConvFighter') {
    return calculateConventionalFighterCost(entity as ConvFighterEntity, equipmentCost);
  }
  if (entity.entityType === 'BattleArmor') {
    return calculateBattleArmorCost(entity as BattleArmorEntity, equipmentCost);
  }
  if (entity.entityType === 'Infantry') return calculateInfantryCost(entity as InfantryEntity);
  if (entity.entityType === 'Mek') return calculateMekCost(entity as MekEntity, equipmentCost);
  if (entity.entityType === 'SmallCraft') {
    return calculateSmallCraftCost(entity as SmallCraftEntity, equipmentCost);
  }
  if (entity.entityType === 'FixedWingSupport') {
    return calculateFixedWingSupportCost(entity as FixedWingSupportEntity, equipmentCost);
  }
  if (entity.entityType === 'DropShip') {
    return calculateDropShipCost(entity as DropShipEntity, equipmentCost);
  }
  if (entity.entityType === 'JumpShip') {
    return calculateJumpShipCost(entity as JumpShipEntity, equipmentCost);
  }
  if (entity.entityType === 'WarShip') {
    return calculateWarShipCost(entity as WarShipEntity, equipmentCost);
  }
  if (entity.entityType === 'SpaceStation') {
    return calculateSpaceStationCost(entity as SpaceStationEntity, equipmentCost);
  }

  return equipmentCost;
}
