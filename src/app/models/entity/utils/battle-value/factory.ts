// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { BaseEntity } from '../../base-entity';
import type { StaticEmplacementEntity } from '../../entities/misc/static-emplacement-entity';
import { MobileStructureBVCalculator } from './mobile-structure-bv-calculator';
import type { EntityStateView } from '../../entity-state-view';
import { CORE_2026_RULESET, type CBTRuleset } from '../../../cbt-ruleset.model';
import { gameRulesFor } from '../../../rules/game-rules';
import { BVCalculator, type BattleValueBreakdown } from './bv-calculator';
import {
  AeroBVCalculator,
  BattleArmorBVCalculator,
  CombatVehicleBVCalculator,
  DropShipBVCalculator,
  HandheldWeaponBVCalculator,
  InfantryBVCalculator,
  LargeAeroBVCalculator,
  MekBVCalculator,
  ProtoMekBVCalculator,
  WarShipBVCalculator,
} from './family-calculators';

/** Mirrors Entity.getBvCalculator()/BVCalculator.getBVCalculator dispatch. */
export function getBVCalculator(
  entity: BaseEntity,
  state?: EntityStateView,
  ruleset: CBTRuleset = CORE_2026_RULESET,
): BVCalculator {
  const rules = gameRulesFor(ruleset);
  switch (entity.entityType) {
    case 'Mek': return new MekBVCalculator(entity as never, state, rules);
    case 'ProtoMek': return new ProtoMekBVCalculator(entity as never, state, rules);
    case 'BattleArmor': return new BattleArmorBVCalculator(entity as never, state, rules);
    case 'Infantry': return new InfantryBVCalculator(entity as never, state, rules);
    case 'WarShip': return new WarShipBVCalculator(entity as never, state, rules);
    case 'JumpShip':
    case 'SpaceStation': return new LargeAeroBVCalculator(entity as never, state, rules);
    case 'DropShip': return new DropShipBVCalculator(entity as never, state, rules);
    case 'Aero':
    case 'ConvFighter':
    case 'SmallCraft':
    case 'FixedWingSupport': return new AeroBVCalculator(entity as never, state, rules);
    case 'HandheldWeapon': return new HandheldWeaponBVCalculator(entity, state, rules);
    case 'MobileStructure': return new MobileStructureBVCalculator(entity as StaticEmplacementEntity, state, rules);
    default: return new CombatVehicleBVCalculator(entity, state, rules);
  }
}

export function calculateBattleValue(
  entity: BaseEntity,
  state?: EntityStateView,
  ruleset: CBTRuleset = CORE_2026_RULESET,
): number {
  const manual = entity.manualBV();
  if (manual > 0) return manual;
  return getBVCalculator(entity, state, ruleset).calculateBaseBV();
}

/** Applies authored BV while retaining the calculated report for inspection. */
export function calculateBattleValueDetails(
  entity: BaseEntity,
  state?: EntityStateView,
  ruleset: CBTRuleset = CORE_2026_RULESET,
): BattleValueBreakdown {
  const calculated = getBVCalculator(entity, state, ruleset).calculate();
  const manual = entity.manualBV();
  if (manual <= 0) return calculated;
  return {
    ...calculated,
    base: manual,
    details: [
      { type: 'Calculated Battle Value', total: calculated.base, details: calculated.details },
      { type: 'Manual Battle Value', calculation: 'Overrides calculated BV', total: manual },
    ],
  };
}
