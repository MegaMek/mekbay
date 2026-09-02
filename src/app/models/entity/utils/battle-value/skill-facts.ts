// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../base-entity';
import { InfantryBaseEntity } from '../../entities/infantry/infantry-base-entity';
import {
  adjustCBTBattleValueForSkills,
  effectiveCBTPilotingSkill,
  fixedCBTPilotingSkill,
  unroundedCBTBattleValueForSkills,
  type CBTSkillUnitFacts,
} from './rules';

/** Canonical crew-skill facts for a loaded Entity. */
export function classicSkillFactsForEntity(entity: BaseEntity): CBTSkillUnitFacts {
  return Object.freeze({
    unitType: entity.unitType(),
    unitSubtype: entity.unitSubtype(),
    canAntiMech: entity instanceof InfantryBaseEntity && entity.canAntiMech(),
  });
}

export function effectiveEntityPilotingSkill(entity: BaseEntity, requested: number): number {
  return effectiveCBTPilotingSkill(classicSkillFactsForEntity(entity), requested);
}

export function fixedEntityPilotingSkill(entity: BaseEntity): number | null {
  return fixedCBTPilotingSkill(classicSkillFactsForEntity(entity));
}

export function adjustEntityBattleValueForSkills(
  entity: BaseEntity,
  base: number,
  gunnery: number,
  piloting: number,
): number {
  return adjustCBTBattleValueForSkills(
    base,
    gunnery,
    piloting,
    classicSkillFactsForEntity(entity),
  );
}

/** Crew-skill-adjusted entity BV before the one final integer rounding boundary. */
export function unroundedEntityBattleValueForSkills(
  entity: BaseEntity,
  base: number,
  gunnery: number,
  piloting: number,
): number {
  return unroundedCBTBattleValueForSkills(
    base,
    gunnery,
    piloting,
    classicSkillFactsForEntity(entity),
  );
}
