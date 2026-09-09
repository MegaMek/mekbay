// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { BaseEntity } from '../../base-entity';
import type { InfantryEntity } from '../../entities/infantry/infantry-entity';
import type { BattleArmorEntity } from '../../entities/infantry/battle-armor-entity';
import type { MekEntity } from '../../entities/mek/mek-entity';
import type { ProtoMekEntity } from '../../entities/protomek/protomek-entity';
import type { VehicleEntity } from '../../entities/vehicle/vehicle-entity';
import type { AeroEntity } from '../../entities/aero/aero-entity';
import type { HandheldWeaponEntity } from '../../entities/misc/handheld-weapon-entity';
import type { FixedWingSupportEntity } from '../../entities/aero/fixed-wing-support-entity';
import type { SmallCraftEntity } from '../../entities/aero/small-craft-entity';
import type { JumpShipEntity } from '../../entities/largecraft/jumpship-entity';
import { getInfantryWeightBreakdown } from '../infantry-tonnage';
import { calculateMekWeightBreakdown } from './mek-weight';
import { calculateBattleArmorWeightBreakdown } from './battle-armor-weight';
import { calculateProtoMekWeightBreakdown } from './protomek-weight';
import { calculateVehicleWeightBreakdown } from './vehicle-weight';
import { calculateSupportVehicleWeightBreakdown } from './support-vehicle-weight';
import { calculateFighterWeightBreakdown } from './fighter-weight';
import { calculateHandheldWeaponWeightBreakdown } from './handheld-weapon-weight';
import { calculateFixedWingSupportWeightBreakdown } from './fixed-wing-support-weight';
import { calculateSmallCraftWeightBreakdown } from './small-craft-weight';
import { calculateAdvancedAerospaceWeightBreakdown } from './advanced-aerospace-weight';

/**
 * Calculate installed construction mass independently of declared chassis
 * capacity (`BaseEntity.tonnage`).
 *
 * Families are enabled only after their MegaMek verifier calculation has
 * been ported and checked against the generated weight reports. Returning
 * declared tonnage as a fallback would hide underweight and overweight units.
 */
export function calculateEntityEffectiveTonnage(entity: BaseEntity): number {
  return calculateEntityWeightBreakdown(entity).rounded;
}

/** The same family calculation supplies both installed mass and its complete breakdown. */
export function calculateEntityWeightBreakdown(entity: BaseEntity) {
  switch (entity.entityType) {
    case 'JumpShip':
    case 'WarShip':
    case 'SpaceStation':
      return calculateAdvancedAerospaceWeightBreakdown(entity as JumpShipEntity);
    case 'SmallCraft':
    case 'DropShip':
      return calculateSmallCraftWeightBreakdown(entity as SmallCraftEntity);
    case 'FixedWingSupport':
      return calculateFixedWingSupportWeightBreakdown(entity as FixedWingSupportEntity);
    case 'HandheldWeapon':
      return calculateHandheldWeaponWeightBreakdown(entity as HandheldWeaponEntity);
    case 'Aero':
    case 'ConvFighter':
      return calculateFighterWeightBreakdown(entity as AeroEntity);
    case 'SupportTank':
    case 'LargeSupportTank':
    case 'SupportNaval':
    case 'SupportVTOL':
      return calculateSupportVehicleWeightBreakdown(entity as VehicleEntity & import('../../entities/support-vehicle').SupportVehicle);
    case 'Tank':
    case 'Naval':
    case 'VTOL':
      return calculateVehicleWeightBreakdown(entity as VehicleEntity);
    case 'ProtoMek':
      return calculateProtoMekWeightBreakdown(entity as ProtoMekEntity);
    case 'BattleArmor':
      return calculateBattleArmorWeightBreakdown(entity as BattleArmorEntity);
    case 'Mek':
      return calculateMekWeightBreakdown(entity as MekEntity);
    case 'Infantry':
      return getInfantryWeightBreakdown(entity as InfantryEntity);
    default:
      throw new Error(`Effective tonnage is not implemented for ${entity.entityType}`);
  }
}
