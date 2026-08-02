/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from '../models/crew-member.model';
import {
    DEFAULT_CLASSIC_BV_NORMALIZATION_MAX,
    type BvNormalizationMatch,
    type BvNormalizationSettings,
    type UnitSearchNumericRange,
} from '../models/unit-search-result.model';
import type { Unit } from '../models/units.model';
import { BVCalculatorUtil } from './bv-calculator.util';
import { getEffectivePilotingSkill, getFixedPilotingSkill } from './cbt-common.util';

export const MIN_CLASSIC_PILOT_SKILL = 0;
export const MAX_CLASSIC_PILOT_SKILL = 8;

/**
 * Updates one range bound and moves the opposite bound when necessary to preserve ordering.
 */
export function updateNumericRangeBound(
    range: UnitSearchNumericRange,
    bound: 'min' | 'max',
    value: number,
): UnitSearchNumericRange {
    if (bound === 'min') {
        return { min: value, max: Math.max(value, range.max) };
    }

    return { min: Math.min(range.min, value), max: value };
}

export function isValidClassicSkillRange(range: UnitSearchNumericRange): boolean {
    return Number.isInteger(range.min)
        && Number.isInteger(range.max)
        && range.min >= MIN_CLASSIC_PILOT_SKILL
        && range.max <= MAX_CLASSIC_PILOT_SKILL
        && range.min <= range.max;
}

export function isValidTargetBvRange(range: UnitSearchNumericRange): boolean {
    return Number.isInteger(range.min)
        && Number.isInteger(range.max)
        && range.min >= 0
        && range.max <= DEFAULT_CLASSIC_BV_NORMALIZATION_MAX
        && range.min <= range.max;
}

export function isValidBvNormalizationSettings(settings: BvNormalizationSettings): boolean {
    return isValidTargetBvRange(settings.targetBv)
        && isValidClassicSkillRange(settings.gunnery)
        && isValidClassicSkillRange(settings.piloting)
        && Number.isInteger(settings.maxDelta)
        && settings.maxDelta >= 0
        && settings.maxDelta <= MAX_CLASSIC_PILOT_SKILL;
}

/**
 * Finds one deterministic skill pair whose adjusted BV lies within the inclusive target range.
 *
 * A fitting effective default crew is returned without adjustment. Otherwise, matching pairs are
 * ordered by adjusted BV distance from the target midpoint, distance from the default crew,
 * Gunnery/Piloting difference, Gunnery, and finally Piloting. Units with mandatory Piloting ignore
 * the selected Piloting range and maximum skill delta, so only their Gunnery is normalized.
 */
export function findBvNormalizationMatch(
    unit: Unit,
    settings: BvNormalizationSettings,
): BvNormalizationMatch | null {
    if (!isValidBvNormalizationSettings(settings)
        || !Number.isFinite(unit.bv)
        || unit.bv <= 0) {
        return null;
    }

    const targetMidpoint = (settings.targetBv.min + settings.targetBv.max) / 2;
    const fixedPiloting = getFixedPilotingSkill(unit);
    const defaultPiloting = fixedPiloting ?? DEFAULT_PILOTING_SKILL;
    const defaultIsEligible = isWithinRange(DEFAULT_GUNNERY_SKILL, settings.gunnery)
        && (fixedPiloting !== null
            || (isWithinRange(DEFAULT_PILOTING_SKILL, settings.piloting)
                && Math.abs(DEFAULT_GUNNERY_SKILL - defaultPiloting) <= settings.maxDelta));

    if (defaultIsEligible) {
        const defaultMatch = createMatch(unit, DEFAULT_GUNNERY_SKILL, defaultPiloting);
        if (isWithinRange(defaultMatch.adjustedBv, settings.targetBv)) {
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
            if (!isWithinRange(candidate.adjustedBv, settings.targetBv)) {
                continue;
            }

            if (!bestMatch || compareMatches(candidate, bestMatch, targetMidpoint) < 0) {
                bestMatch = candidate;
            }
        }
    }

    return bestMatch;
}

function createMatch(unit: Unit, gunnery: number, piloting: number): BvNormalizationMatch {
    return {
        adjustedBv: BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, gunnery, piloting),
        gunnery,
        piloting,
    };
}

function isWithinRange(value: number, range: UnitSearchNumericRange): boolean {
    return value >= range.min && value <= range.max;
}

function compareMatches(
    left: BvNormalizationMatch,
    right: BvNormalizationMatch,
    targetMidpoint: number,
): number {
    return compareNumber(Math.abs(left.adjustedBv - targetMidpoint), Math.abs(right.adjustedBv - targetMidpoint))
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
