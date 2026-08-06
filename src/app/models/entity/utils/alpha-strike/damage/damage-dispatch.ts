// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { ASUnitTypeCode } from '../../../../units.model';
import {
  BattleArmorEntity,
  type BaseEntity,
  InfantryEntity,
} from '../../../entities';
import {
  LARGE_AEROSPACE_TYPES,
  isAerospaceElement,
} from '../foundation/unit-classification';

export type AlphaStrikeDamageFamily =
  | 'battle-armor'
  | 'conventional-infantry'
  | 'arced'
  | 'aerospace'
  | 'generic';

/**
 * Selects the Java damage converter family at the damage-conversion phase.
 * Support-vehicle size abilities are assigned later and must not trigger arced damage here.
 */
export function alphaStrikeDamageFamily(
  entity: BaseEntity,
  type: ASUnitTypeCode,
): AlphaStrikeDamageFamily {
  if (entity instanceof BattleArmorEntity) return 'battle-armor';
  if (entity instanceof InfantryEntity) return 'conventional-infantry';
  if (LARGE_AEROSPACE_TYPES.has(type)) return 'arced';
  if (isAerospaceElement(entity, type)) return 'aerospace';
  return 'generic';
}
