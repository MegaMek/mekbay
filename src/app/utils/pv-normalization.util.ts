// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DEFAULT_GUNNERY_SKILL } from '../models/crew.model';
import {
    DEFAULT_ALPHA_STRIKE_PV_NORMALIZATION_MAX,
    type UnitSearchNormalizationMatch,
    type PvNormalizationSettings,
    type UnitSearchNumericRange,
} from '../models/unit-search-result.model';
import type { UnitSummary } from '../models/unit-summary.model';
import { adjustPointValueForSkill } from './pv-skill-adjustment.util';
import { isValidNormalizationSkillRange, isWithinNumericRange } from './unit-search-normalization-range.util';

type PvNormalizationMatch = Extract<UnitSearchNormalizationMatch, { kind: 'pv' }>;

export function isValidTargetPvRange(range: UnitSearchNumericRange): boolean {
    return Number.isInteger(range.min)
        && Number.isInteger(range.max)
        && range.min >= 0
        && range.max <= DEFAULT_ALPHA_STRIKE_PV_NORMALIZATION_MAX
        && range.min <= range.max;
}

export function isValidPvNormalizationSettings(settings: PvNormalizationSettings): boolean {
    return isValidTargetPvRange(settings.targetPv) && isValidNormalizationSkillRange(settings.skill);
}

/**
 * Finds the deterministic Alpha Strike Skill whose adjusted PV best fits the target range.
 * An explicit target maximum selects the highest adjusted PV that does not exceed it. When the
 * maximum remains at its default sentinel, a fitting Skill 4 and midpoint-based ordering are
 * preserved.
 */
export function findPvNormalizationMatch(
    unit: UnitSummary,
    settings: PvNormalizationSettings,
): PvNormalizationMatch | null {
    const basePv = unit.as?.PV;
    if (!isValidPvNormalizationSettings(settings)
        || !Number.isInteger(basePv)
        || basePv <= 0) {
        return null;
    }

    const maximizeAdjustedPv = settings.targetPv.max !== DEFAULT_ALPHA_STRIKE_PV_NORMALIZATION_MAX;
    if (!maximizeAdjustedPv && isWithinNumericRange(DEFAULT_GUNNERY_SKILL, settings.skill)) {
        const defaultMatch = createMatch(basePv, DEFAULT_GUNNERY_SKILL);
        if (isWithinNumericRange(defaultMatch.adjustedValue, settings.targetPv)) {
            return defaultMatch;
        }
    }

    const targetMidpoint = (settings.targetPv.min + settings.targetPv.max) / 2;
    let bestMatch: PvNormalizationMatch | null = null;
    for (let skill = settings.skill.min; skill <= settings.skill.max; skill++) {
        const candidate = createMatch(basePv, skill);
        if (!isWithinNumericRange(candidate.adjustedValue, settings.targetPv)) {
            continue;
        }
        if (!bestMatch || compareMatches(candidate, bestMatch, targetMidpoint, maximizeAdjustedPv) < 0) {
            bestMatch = candidate;
        }
    }
    return bestMatch;
}

function createMatch(basePv: number, skill: number): PvNormalizationMatch {
    return {
        kind: 'pv',
        adjustedValue: adjustPointValueForSkill(basePv, skill),
        skill,
    };
}

function compareMatches(
    left: PvNormalizationMatch,
    right: PvNormalizationMatch,
    midpoint: number,
    maximizeAdjustedPv: boolean,
): number {
    const adjustedValueOrder = maximizeAdjustedPv
        ? right.adjustedValue - left.adjustedValue
        : Math.abs(left.adjustedValue - midpoint) - Math.abs(right.adjustedValue - midpoint);

    return adjustedValueOrder
        || Math.abs(left.skill - DEFAULT_GUNNERY_SKILL) - Math.abs(right.skill - DEFAULT_GUNNERY_SKILL)
        || left.skill - right.skill;
}
