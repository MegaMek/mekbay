// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DEFAULT_ALPHA_STRIKE_PV_NORMALIZATION_MAX, type PvNormalizationSettings } from '../models/unit-search-result.model';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { adjustPointValueForSkill } from './pv-skill-adjustment.util';
import {
    findPvNormalizationMatch,
    isValidPvNormalizationSettings,
    isValidTargetPvRange,
} from './pv-normalization.util';

function settings(
    targetMin: number,
    targetMax: number,
    skillMin = 0,
    skillMax = 8,
): PvNormalizationSettings {
    return {
        targetPv: { min: targetMin, max: targetMax },
        skill: { min: skillMin, max: skillMax },
    };
}

function unit(pv = 20) {
    return createEmptyUnit({ name: `PV ${pv}`, as: { ...createEmptyUnit().as, PV: pv } });
}

describe('PV normalization', () => {
    it('validates target and skill boundaries', () => {
        expect(isValidTargetPvRange({ min: 0, max: DEFAULT_ALPHA_STRIKE_PV_NORMALIZATION_MAX })).toBeTrue();
        expect(isValidPvNormalizationSettings(settings(0, DEFAULT_ALPHA_STRIKE_PV_NORMALIZATION_MAX, 0, 8))).toBeTrue();

        for (const invalid of [
            settings(-1, 10),
            settings(10, 9),
            settings(0, DEFAULT_ALPHA_STRIKE_PV_NORMALIZATION_MAX + 1),
            settings(0.5, 10),
            settings(0, 10, -1, 8),
            settings(0, 10, 0, 9),
            settings(0, 10, 5, 4),
            settings(0, 10, 0.5, 4),
        ]) {
            expect(isValidPvNormalizationSettings(invalid)).toBeFalse();
        }
    });

    it('bypasses a fitting Skill 4 to maximize PV under a constrained maximum', () => {
        expect(findPvNormalizationMatch(unit(20), settings(19, 25, 3, 5))).toEqual({
            kind: 'pv',
            adjustedValue: 24,
            skill: 3,
        });
    });

    it('preserves a fitting Skill 4 when the maximum remains at its sentinel', () => {
        expect(findPvNormalizationMatch(
            unit(20),
            settings(19, DEFAULT_ALPHA_STRIKE_PV_NORMALIZATION_MAX, 3, 5),
        )).toEqual({
            kind: 'pv',
            adjustedValue: 20,
            skill: 4,
        });
    });

    it('matches exact adjusted PV values at inclusive boundaries', () => {
        const basePv = 20;
        for (let skill = 0; skill <= 8; skill++) {
            const adjustedPv = adjustPointValueForSkill(basePv, skill);
            expect(findPvNormalizationMatch(unit(basePv), settings(adjustedPv, adjustedPv, skill, skill)))
                .withContext(`Skill ${skill}`)
                .toEqual({ kind: 'pv', adjustedValue: adjustedPv, skill });
        }
    });

    it('chooses the highest reachable PV without surpassing a constrained maximum', () => {
        const match = findPvNormalizationMatch(unit(20), settings(11, 18, 5, 8));
        expect(match?.skill).toBe(5);
        expect(match?.adjustedValue).toBe(18);
    });

    it('returns null when no skill fits or the unit PV is invalid', () => {
        expect(findPvNormalizationMatch(unit(20), settings(1, 1, 0, 8))).toBeNull();
        for (const pv of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(findPvNormalizationMatch(unit(pv), settings(0, 100)))
                .withContext(`PV ${pv}`)
                .toBeNull();
        }
    });

    it('preserves the minimum adjusted PV of one', () => {
        expect(findPvNormalizationMatch(unit(1), settings(1, 1, 8, 8))).toEqual({
            kind: 'pv',
            adjustedValue: 1,
            skill: 8,
        });
    });

    it('prefers the Skill closest to 4 when multiple Skills have the same adjusted PV', () => {
        expect(findPvNormalizationMatch(unit(1), settings(1, 1, 5, 8))).toEqual({
            kind: 'pv',
            adjustedValue: 1,
            skill: 5,
        });
    });
});
