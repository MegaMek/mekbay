// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { BaseEntity } from '../base-entity';
import { BV_MOVEMENT_CALCULATION } from '../types';
import { isMekEntity } from './entity-type-guards';

/**
 * MegaMek's TM p.316 offensive speed factor, rounded to two decimal places.
 *
 * This is deliberately separate from battle-value assembly: the value is also
 * exported as `offSpeedFactor` by SVGMassPrinter.
 */
export function offensiveSpeedFactor(mp: number): number {
  return Math.round(Math.pow(1 + (mp - 5) / 10, 1.2) * 100) / 100;
}

/**
 * Select the movement value used by MegaMek's BV calculator for the
 * offensive speed factor.  Movement values use the BV calculation settings
 * (`max*MP`), not transient in-game movement state.
 */
export function offensiveSpeedFactorMP(entity: BaseEntity): number {
  const run = entity.maxRunMP();
  const jump = entity.computeJumpMP(BV_MOVEMENT_CALCULATION);

  switch (entity.entityType) {
    case 'Aero':
    case 'ConvFighter':
    case 'FixedWingSupport':
    case 'SmallCraft':
    case 'DropShip':
    case 'WarShip':
      return run;

    case 'JumpShip':
      return 1;

    case 'SpaceStation':
    case 'HandheldWeapon':
      return 0;

    case 'BattleArmor':
      return Math.max(entity.maxWalkMP(), jump, entity.umuMP());

    case 'Infantry':
      return Math.max(run, jump, entity.umuMP());

    case 'Tank':
    case 'Naval':
    case 'VTOL':
    case 'SupportTank':
    case 'SupportNaval':
    case 'SupportVTOL':
    case 'LargeSupportTank': {
      // BV uses cruise MP for trains and treats a zero-MP trailer as MP 1.
      const vehicleRun = entity.originalWalkMP() === 0 ? 1
        : entity.motiveType() === 'Rail' || entity.motiveType() === 'MagLev' ? entity.maxWalkMP()
          : run;
      return vehicleRun + Math.round(jump / 2);
    }

    default:
      if (isMekEntity(entity)) {
        if (entity.isLandAirMek()) return run + Math.round(entity.airMekFlankMP() / 2);
      }
      return run + Math.round(Math.max(jump, entity.umuMP()) / 2);
  }
}

/** Return the entity's exported offensive BV speed factor. */
export function getOffensiveSpeedFactor(entity: BaseEntity): number {
  return offensiveSpeedFactor(offensiveSpeedFactorMP(entity));
}

export { calculateBattleValue, calculateBattleValueDetails, getBVCalculator } from './battle-value/factory';
export type { BattleValueBreakdown, BattleValueDetail } from './battle-value/bv-calculator';
export {
  BVCalculator,
} from './battle-value/bv-calculator';
export {
  AeroBVCalculator,
  BattleArmorBVCalculator,
  CombatVehicleBVCalculator,
  HandheldWeaponBVCalculator,
  HeatTrackingBVCalculator,
  InfantryBVCalculator,
  LargeAeroBVCalculator,
  ProtoMekBVCalculator,
} from './battle-value/family-calculators';
