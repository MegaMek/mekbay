import type { ASUnitTypeCode } from '../../../../units.model';
import type { BaseEntity } from '../../../base-entity';
import type { AlphaStrikeMovement } from '../foundation/movement';
import { AlphaStrikeSpecialAbilityCollector } from './special-ability-collector';
import { alphaStrikeCoreSpecials } from './core-specials';
import { alphaStrikeEntitySpecials } from './entity-specials';
import { alphaStrikeTurretSpecial } from './turret-specials';
import { alphaStrikeWeaponSpecials } from './weapon-specials';

export interface AlphaStrikeSpecialsContext {
  readonly type: ASUnitTypeCode;
  readonly size: number;
  readonly movement: AlphaStrikeMovement;
  readonly usesArcs: boolean;
  readonly hasStandardDamage: boolean;
  readonly heatSpecials: readonly string[];
  readonly overheatLong: boolean;
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
  specials.addAll(alphaStrikeEntitySpecials(entity, context.type, context.size));
  specials.addAll(alphaStrikeCoreSpecials(entity, {
    type: context.type,
    hasStandardDamage: context.hasStandardDamage,
    movement: context.movement,
  }));
  if (!context.usesArcs) {
    specials.addAll(alphaStrikeWeaponSpecials(entity));
    const turret = alphaStrikeTurretSpecial(entity);
    if (turret) specials.add(turret);
  }
  specials.addAll(context.heatSpecials);
  if (context.overheatLong) specials.add('OVL');
  return specials.toArray();
}
