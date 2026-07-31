import type { BaseEntity } from '../../base-entity';
import { BVCalculator, type BattleValueBreakdown } from './bv-calculator';
import {
  AeroBVCalculator,
  BattleArmorBVCalculator,
  CombatVehicleBVCalculator,
  DropShipBVCalculator,
  HandheldWeaponBVCalculator,
  InfantryBVCalculator,
  JumpShipBVCalculator,
  MekBVCalculator,
  ProtoMekBVCalculator,
  WarShipBVCalculator,
} from './family-calculators';

/** Mirrors Entity.getBvCalculator()/BVCalculator.getBVCalculator dispatch. */
export function getBVCalculator(entity: BaseEntity): BVCalculator {
  switch (entity.entityType) {
    case 'Mek': return new MekBVCalculator(entity as never);
    case 'ProtoMek': return new ProtoMekBVCalculator(entity as never);
    case 'BattleArmor': return new BattleArmorBVCalculator(entity as never);
    case 'Infantry': return new InfantryBVCalculator(entity as never);
    case 'WarShip': return new WarShipBVCalculator(entity as never);
    case 'JumpShip':
    case 'SpaceStation': return new JumpShipBVCalculator(entity as never);
    case 'DropShip': return new DropShipBVCalculator(entity as never);
    case 'Aero':
    case 'ConvFighter':
    case 'SmallCraft':
    case 'FixedWingSupport': return new AeroBVCalculator(entity as never);
    case 'HandheldWeapon': return new HandheldWeaponBVCalculator(entity);
    default: return new CombatVehicleBVCalculator(entity);
  }
}

export function calculateBattleValue(entity: BaseEntity): number {
  return getBVCalculator(entity).calculateBaseBV();
}

/** Calculates the numeric BV and its structured report in one traversal. */
export function calculateBattleValueDetails(entity: BaseEntity): BattleValueBreakdown {
  return getBVCalculator(entity).calculate();
}
