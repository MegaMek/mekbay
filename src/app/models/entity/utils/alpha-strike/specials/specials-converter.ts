// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { ASUnitTypeCode } from '../../../../units.model';
import type { BaseEntity } from '../../../base-entity';
import type { AlphaStrikeMovement } from '../foundation/movement';
import { AlphaStrikeSpecialAbilityCollector } from './special-ability-collector';
import { collectAlphaStrikeCoreSpecials } from './core-specials';
import { alphaStrikeEntitySpecials } from './entity-specials';
import { alphaStrikeTurretSpecial } from './turret-specials';
import { collectAlphaStrikeWeaponSpecials } from './weapon-specials';
import { BattleArmorEntity, InfantryEntity } from '../../../entities';
import { canMakeAntiMekAttacks } from '../../battle-value/infantry-rules';

export interface AlphaStrikeSpecialsContext {
  readonly type: ASUnitTypeCode;
  readonly size: number;
  readonly movement: AlphaStrikeMovement;
  readonly usesArcs: boolean;
  readonly usesArcedDamage: boolean;
  readonly hasStandardDamage: boolean;
  readonly heatSpecials: readonly string[];
  readonly overheatLong: boolean;
  readonly specialDamageHeatFactors?: readonly [number, number, number, number];
  readonly rearSpecialDamageHeatFactors?: readonly [number, number, number, number];
}

/**
 * Converts every Alpha Strike special ability for an entity.
 *
 * This is the only composition point. Category converters only determine their
 * own abilities; this function controls scope, final de-duplication, and order.
 */
export function alphaStrikeSpecialsForEntity(
  entity: BaseEntity,
  context: AlphaStrikeSpecialsContext,
): string[] {
  const specials = new AlphaStrikeSpecialAbilityCollector();
  specials.addAll(alphaStrikeEntitySpecials(entity, context.type, context.size, context.movement));
  if (hasAlphaStrikeAntiMek(entity)) specials.add('AM');
  specials.merge(collectAlphaStrikeCoreSpecials(entity, {
    type: context.type,
    hasStandardDamage: context.hasStandardDamage,
    movement: context.movement,
  }));
  if (!context.usesArcedDamage) {
    specials.merge(collectAlphaStrikeWeaponSpecials(
      entity,
      'standard',
      context.specialDamageHeatFactors,
      context.rearSpecialDamageHeatFactors,
    ));
    const turret = alphaStrikeTurretSpecial(entity, context.specialDamageHeatFactors);
    if (turret) specials.add(turret);
  }
  specials.addAll(context.heatSpecials);
  if (context.overheatLong) specials.add('OVL');
  return specials.toArray();
}

function hasAlphaStrikeAntiMek(entity: BaseEntity): boolean {
  if (entity instanceof InfantryEntity) return canMakeAntiMekAttacks(entity);
  return entity instanceof BattleArmorEntity
    && (entity.legAttackCapable() || entity.swarmAttackCapable());
}