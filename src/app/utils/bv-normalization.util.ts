// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from '../models/crew.model';
import {
    DEFAULT_CLASSIC_BV_NORMALIZATION_MAX,
    type UnitSearchNormalizationMatch,
    type BvNormalizationSettings,
    type UnitSearchNumericRange,
} from '../models/unit-search-result.model';
import type { UnitSummary } from '../models/unit-summary.model';
import { BVCalculatorUtil } from './bv-calculator.util';
import { getEffectivePilotingSkill, getFixedPilotingSkill } from './cbt-common.util';
import {
    isValidNormalizationSkillRange,
    isWithinNumericRange,
    MAX_NORMALIZATION_SKILL,
} from './unit-search-normalization-range.util';

type BvNormalizationMatch = Extract<UnitSearchNormalizationMatch, { kind: 'bv' }>;
type BvNormalizationUnit = Pick<UnitSummary, 'bv' | 'type' | 'subtype' | 'canAntiMech'>;

export function isValidTargetBvRange(range: UnitSearchNumericRange): boolean {
    return Number.isInteger(range.min)
        && Number.isInteger(range.max)
        && range.min >= 0
        && range.max <= DEFAULT_CLASSIC_BV_NORMALIZATION_MAX
        && range.min <= range.max;
}

export function isValidBvNormalizationSettings(settings: BvNormalizationSettings): boolean {
    return isValidTargetBvRange(settings.targetBv)
        && isValidNormalizationSkillRange(settings.gunnery)
        && isValidNormalizationSkillRange(settings.piloting)
        && Number.isInteger(settings.maxDelta)
        && settings.maxDelta >= 0
        && settings.maxDelta <= MAX_NORMALIZATION_SKILL;
}

/**
 * Finds one deterministic skill pair whose adjusted BV lies within the inclusive target range.
 *
 * With an explicit target maximum, matching pairs are ordered by highest adjusted BV without
 * exceeding that maximum. When the maximum remains at its default sentinel, a fitting effective
 * default crew is returned without adjustment and other matches retain midpoint-based ordering.
 * Ties prefer distance from the default crew, Gunnery/Piloting difference, Gunnery, and finally
 * Piloting. Units with mandatory Piloting ignore the selected Piloting range and maximum skill
 * delta, so only their Gunnery is normalized.
 */
export function findBvNormalizationMatch(
    unit: BvNormalizationUnit,
    settings: BvNormalizationSettings,
): BvNormalizationMatch | null {
    if (!isValidBvNormalizationSettings(settings)
        || !Number.isFinite(unit.bv)
        || unit.bv <= 0) {
        return null;
    }

    const targetMidpoint = (settings.targetBv.min + settings.targetBv.max) / 2;
    const maximizeAdjustedBv = settings.targetBv.max !== DEFAULT_CLASSIC_BV_NORMALIZATION_MAX;
    const fixedPiloting = getFixedPilotingSkill(unit);
    const defaultPiloting = fixedPiloting ?? DEFAULT_PILOTING_SKILL;
    const defaultIsEligible = isWithinNumericRange(DEFAULT_GUNNERY_SKILL, settings.gunnery)
        && (fixedPiloting !== null
            || (isWithinNumericRange(DEFAULT_PILOTING_SKILL, settings.piloting)
                && Math.abs(DEFAULT_GUNNERY_SKILL - defaultPiloting) <= settings.maxDelta));

    if (!maximizeAdjustedBv && defaultIsEligible) {
        const defaultMatch = createMatch(unit, DEFAULT_GUNNERY_SKILL, defaultPiloting);
        if (isWithinNumericRange(defaultMatch.adjustedValue, settings.targetBv)) {
            return defaultMatch;
        }
    }

    let bestMatch: BvNormalizationMatch | null = null;
    const pilotingMin = fixedPiloting ?? settings.piloting.min;
    const pilotingMax = fixedPiloting ?? settings.piloting.max;

    for (let gunnery = settings.gunnery.min; gunnery <= settings.gunnery.max; gunnery++) {
        for (let requestedPiloting = pilotingMin; requestedPiloting <= pilotingMax; requestedPiloting++) {
            const piloting = getEffectivePilotingSkill(unit, requestedPiloting);
            if (fixedPiloting === null && Math.abs(gunnery - piloting) > settings.maxDelta) {
                continue;
            }

            const candidate = createMatch(unit, gunnery, piloting);
            if (!isWithinNumericRange(candidate.adjustedValue, settings.targetBv)) {
                continue;
            }

            if (!bestMatch || compareMatches(candidate, bestMatch, targetMidpoint, maximizeAdjustedBv) < 0) {
                bestMatch = candidate;
            }
        }
    }

    return bestMatch;
}

function createMatch(unit: BvNormalizationUnit, gunnery: number, piloting: number): BvNormalizationMatch {
    return {
        kind: 'bv',
        adjustedValue: BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, gunnery, piloting),
        gunnery,
        piloting,
    };
}

function compareMatches(
    left: BvNormalizationMatch,
    right: BvNormalizationMatch,
    targetMidpoint: number,
    maximizeAdjustedBv: boolean,
): number {
    const adjustedValueOrder = maximizeAdjustedBv
        ? compareNumber(right.adjustedValue, left.adjustedValue)
        : compareNumber(Math.abs(left.adjustedValue - targetMidpoint), Math.abs(right.adjustedValue - targetMidpoint));

    return adjustedValueOrder
        || compareNumber(distanceFromDefault(left), distanceFromDefault(right))
        || compareNumber(Math.abs(left.gunnery - left.piloting), Math.abs(right.gunnery - right.piloting))
        || compareNumber(left.gunnery, right.gunnery)
        || compareNumber(left.piloting, right.piloting);
}

function distanceFromDefault(match: BvNormalizationMatch): number {
    return Math.abs(match.gunnery - DEFAULT_GUNNERY_SKILL)
        + Math.abs(match.piloting - DEFAULT_PILOTING_SKILL);
}

function compareNumber(left: number, right: number): number {
    return left - right;
}
