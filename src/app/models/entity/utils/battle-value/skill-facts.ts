// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../base-entity';
import { InfantryBaseEntity } from '../../entities/infantry/infantry-base-entity';
import {
  adjustClassicBattleValueForSkills,
  effectiveClassicPilotingSkill,
  type ClassicSkillUnitFacts,
} from './rules';

/** Canonical crew-skill facts for a loaded Entity. */
export function classicSkillFactsForEntity(entity: BaseEntity): ClassicSkillUnitFacts {
  return Object.freeze({
    unitType: entity.unitType(),
    unitSubtype: entity.unitSubtype(),
    canAntiMech: entity instanceof InfantryBaseEntity && entity.canAntiMech(),
  });
}

export function effectiveEntityPilotingSkill(entity: BaseEntity, requested: number): number {
  return effectiveClassicPilotingSkill(classicSkillFactsForEntity(entity), requested);
}

export function adjustEntityBattleValueForSkills(
  entity: BaseEntity,
  base: number,
  gunnery: number,
  piloting: number,
): number {
  return adjustClassicBattleValueForSkills(
    base,
    gunnery,
    piloting,
    classicSkillFactsForEntity(entity),
  );
}
