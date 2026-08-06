// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    DEFAULT_CLASSIC_BV_NORMALIZATION_MAX,
    type BvNormalizationSettings,
} from '../models/unit-search-result.model';
import type { Unit, UnitSubtype, UnitType } from '../models/units.model';
import { BVCalculatorUtil } from './bv-calculator.util';
import {
    findBvNormalizationMatch,
    isValidBvNormalizationSettings,
    isValidTargetBvRange,
} from './bv-normalization.util';
import { isValidNormalizationSkillRange, updateNumericRangeBound } from './unit-search-normalization-range.util';

function createUnit(overrides: Partial<Unit> = {}): Unit {
    return {
        name: 'Test Unit',
        bv: 1000,
        type: 'Mek' as UnitType,
        subtype: '' as UnitSubtype,
        canAntiMech: true,
        ...overrides,
    } as Unit;
}

function settings(
    targetMin: number,
    targetMax: number,
    gunneryMin = 0,
    gunneryMax = 8,
    pilotingMin = 0,
    pilotingMax = 8,
    maxDelta = 8,
): BvNormalizationSettings {
    return {
        targetBv: { min: targetMin, max: targetMax },
        gunnery: { min: gunneryMin, max: gunneryMax },
        piloting: { min: pilotingMin, max: pilotingMax },
        maxDelta,
    };
}

describe('classic BV normalization', () => {
    describe('range bound updates', () => {
        it('raises max when min crosses it', () => {
            expect(updateNumericRangeBound({ min: 1000, max: 1500 }, 'min', 2000))
                .toEqual({ min: 2000, max: 2000 });
        });

        it('lowers min when max crosses it', () => {
            expect(updateNumericRangeBound({ min: 1000, max: 1500 }, 'max', 500))
                .toEqual({ min: 500, max: 500 });
        });

        it('preserves the opposite bound for ordered and equal values', () => {
            expect(updateNumericRangeBound({ min: 1000, max: 1500 }, 'min', 1250))
                .toEqual({ min: 1250, max: 1500 });
            expect(updateNumericRangeBound({ min: 1000, max: 1500 }, 'max', 1250))
                .toEqual({ min: 1000, max: 1250 });
            expect(updateNumericRangeBound({ min: 1000, max: 1500 }, 'min', 1500))
                .toEqual({ min: 1500, max: 1500 });
        });
    });

    describe('validation', () => {
        it('accepts inclusive skill boundaries and an ordered nonnegative target', () => {
            expect(isValidNormalizationSkillRange({ min: 0, max: 8 })).toBeTrue();
            expect(isValidTargetBvRange({ min: 0, max: 0 })).toBeTrue();
            expect(isValidTargetBvRange({ min: 0, max: 999_999 })).toBeTrue();
            expect(isValidBvNormalizationSettings(settings(0, 100, 0, 8, 0, 8))).toBeTrue();
        });

        it('rejects inverted, fractional, non-finite, and out-of-bounds skill ranges', () => {
            const invalidRanges = [
                { min: 5, max: 4 },
                { min: -1, max: 4 },
                { min: 4, max: 9 },
                { min: 1.5, max: 4 },
                { min: Number.NaN, max: 4 },
                { min: 0, max: Number.POSITIVE_INFINITY },
            ];

            for (const range of invalidRanges) {
                expect(isValidNormalizationSkillRange(range)).withContext(JSON.stringify(range)).toBeFalse();
            }
        });

        it('rejects inverted, negative, fractional, and non-finite target ranges', () => {
            const invalidRanges = [
                { min: 1001, max: 1000 },
                { min: -1, max: 1000 },
                { min: 999.5, max: 1000 },
                { min: 0, max: 1_000_000 },
                { min: Number.NaN, max: 1000 },
                { min: 0, max: Number.POSITIVE_INFINITY },
            ];

            for (const range of invalidRanges) {
                expect(isValidTargetBvRange(range)).withContext(JSON.stringify(range)).toBeFalse();
            }
        });

        it('accepts max delta boundaries and rejects invalid values', () => {
            expect(isValidBvNormalizationSettings(settings(0, 100, 0, 8, 0, 8, 0))).toBeTrue();
            expect(isValidBvNormalizationSettings(settings(0, 100, 0, 8, 0, 8, 8))).toBeTrue();

            for (const maxDelta of [-1, 9, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
                expect(isValidBvNormalizationSettings(settings(0, 100, 0, 8, 0, 8, maxDelta)))
                    .withContext(`${maxDelta}`)
                    .toBeFalse();
            }
        });
    });

    it('matches every exact skill pair across the complete 0-8 matrix', () => {
        const unit = createUnit({ bv: 10_000 });

        for (let gunnery = 0; gunnery <= 8; gunnery++) {
            for (let piloting = 0; piloting <= 8; piloting++) {
                const adjustedBv = BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, gunnery, piloting);
                expect(findBvNormalizationMatch(
                    unit,
                    settings(adjustedBv, adjustedBv, gunnery, gunnery, piloting, piloting),
                )).withContext(`G${gunnery}/P${piloting}`).toEqual({ kind: 'bv', adjustedValue: adjustedBv, gunnery, piloting });
            }
        }
    });

    it('includes both target BV boundaries', () => {
        const unit = createUnit();

        expect(findBvNormalizationMatch(unit, settings(1000, 1100, 4, 4, 4, 5)))
            .toEqual({ kind: 'bv', adjustedValue: 1100, gunnery: 4, piloting: 4 });
        expect(findBvNormalizationMatch(unit, settings(1000, 1100, 4, 4, 4, 4)))
            .toEqual({ kind: 'bv', adjustedValue: 1100, gunnery: 4, piloting: 4 });
    });

    it('allows only skill pairs within max delta, including the boundary', () => {
        const unit = createUnit();
        const allowedBv = BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, 2, 3);
        const disallowedBv = BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, 2, 4);

        expect(findBvNormalizationMatch(unit, settings(allowedBv, allowedBv, 2, 2, 3, 3, 1)))
            .toEqual({ kind: 'bv', adjustedValue: allowedBv, gunnery: 2, piloting: 3 });
        expect(findBvNormalizationMatch(unit, settings(disallowedBv, disallowedBv, 2, 2, 4, 4, 1)))
            .toBeNull();
    });

    it('allows only equal effective skills when max delta is zero', () => {
        const unit = createUnit();
        const equalBv = BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, 3, 3);

        expect(findBvNormalizationMatch(unit, settings(equalBv, equalBv, 3, 3, 2, 3, 0)))
            .toEqual({ kind: 'bv', adjustedValue: equalBv, gunnery: 3, piloting: 3 });
    });

    it('ignores the Piloting range and max delta for fixed-Piloting units', () => {
        const unit = createUnit({ type: 'ProtoMek' as UnitType });
        const adjustedBv = BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, 3, 5);

        expect(findBvNormalizationMatch(unit, settings(adjustedBv, adjustedBv, 3, 3, 0, 0, 0)))
            .toEqual({ kind: 'bv', adjustedValue: adjustedBv, gunnery: 3, piloting: 5 });
    });

    it('still limits fixed-Piloting units to the selected Gunnery range', () => {
        const unit = createUnit({ type: 'ProtoMek' as UnitType });
        const defaultBv = BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, 4, 5);

        expect(findBvNormalizationMatch(unit, settings(defaultBv, defaultBv, 3, 3, 0, 0, 0))).toBeNull();
    });

    it('returns null when no pair reaches the target or the base BV is invalid', () => {
        expect(findBvNormalizationMatch(createUnit(), settings(3000, 4000, 4, 5, 4, 5))).toBeNull();
        expect(findBvNormalizationMatch(createUnit({ bv: 0 }), settings(0, 0))).toBeNull();
        expect(findBvNormalizationMatch(createUnit({ bv: -1 }), settings(0, 100))).toBeNull();
        expect(findBvNormalizationMatch(createUnit({ bv: Number.NaN }), settings(0, 100))).toBeNull();
    });

    it('bypasses a fitting default crew to maximize BV under a constrained maximum', () => {
        const match = findBvNormalizationMatch(createUnit(), settings(850, 1100, 4, 5, 4, 5));

        expect(match).toEqual({ kind: 'bv', adjustedValue: 1100, gunnery: 4, piloting: 4 });
    });

    it('chooses the highest reachable BV without surpassing a constrained maximum', () => {
        const match = findBvNormalizationMatch(createUnit(), settings(850, 999, 4, 5, 4, 5));

        expect(match).toEqual({ kind: 'bv', adjustedValue: 990, gunnery: 5, piloting: 4 });
    });

    it('preserves a fitting default crew when the maximum remains at its sentinel', () => {
        const match = findBvNormalizationMatch(
            createUnit(),
            settings(900, DEFAULT_CLASSIC_BV_NORMALIZATION_MAX, 3, 5, 4, 5),
        );

        expect(match).toEqual({ kind: 'bv', adjustedValue: 1000, gunnery: 4, piloting: 5 });
    });

    it('maximizes Gunnery-adjusted BV while retaining mandatory Piloting', () => {
        const unit = createUnit({ type: 'ProtoMek' as UnitType });
        const maximumBv = BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, 3, 5);

        expect(findBvNormalizationMatch(unit, settings(0, maximumBv, 3, 5, 0, 0, 0)))
            .toEqual({ kind: 'bv', adjustedValue: maximumBv, gunnery: 3, piloting: 5 });
    });

    it('does not use the default crew when a variable Piloting range excludes it', () => {
        const unit = createUnit();
        const adjustedBv = BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, 4, 4);

        expect(findBvNormalizationMatch(unit, settings(1000, 1100, 4, 4, 4, 4)))
            .toEqual({ kind: 'bv', adjustedValue: adjustedBv, gunnery: 4, piloting: 4 });
    });

    it('prefers the pair closest to default 4/5 when adjusted BV distances tie', () => {
        const unit = createUnit({ bv: 100 });
        const match = findBvNormalizationMatch(unit, settings(99, 100, 4, 5, 4, 5));

        expect(match).toEqual({ kind: 'bv', adjustedValue: 100, gunnery: 4, piloting: 5 });
    });

    it('uses stable skill tie-breaks when pairs have the same rounded BV', () => {
        const unit = createUnit({ bv: 1 });
        const match = findBvNormalizationMatch(unit, settings(1, 1, 3, 5, 4, 6));

        expect(match).toEqual({ kind: 'bv', adjustedValue: 1, gunnery: 4, piloting: 5 });
    });

    it('reports effective Piloting and deduplicates fixed ProtoMek pairs', () => {
        const unit = createUnit({ type: 'ProtoMek' as UnitType });
        const adjustedBv = BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, 4, 5);

        expect(findBvNormalizationMatch(unit, settings(adjustedBv, adjustedBv, 4, 4, 0, 8)))
            .toEqual({ kind: 'bv', adjustedValue: adjustedBv, gunnery: 4, piloting: 5 });
    });

    it('uses Piloting 5 for mechanized infantry without anti-Mech capability', () => {
        const unit = createUnit({
            type: 'Infantry' as UnitType,
            subtype: 'Mechanized Conventional Infantry' as UnitSubtype,
            canAntiMech: false,
        });
        const adjustedBv = BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, 4, 5);

        expect(findBvNormalizationMatch(unit, settings(adjustedBv, adjustedBv, 4, 4, 0, 8)))
            .toEqual({ kind: 'bv', adjustedValue: adjustedBv, gunnery: 4, piloting: 5 });
    });

    it('uses Piloting 8 for conventional infantry without anti-Mech capability', () => {
        const unit = createUnit({
            type: 'Infantry' as UnitType,
            subtype: 'Conventional Infantry' as UnitSubtype,
            canAntiMech: false,
        });
        const adjustedBv = BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, 4, 8);

        expect(findBvNormalizationMatch(unit, settings(adjustedBv, adjustedBv, 4, 4, 0, 0, 0)))
            .toEqual({ kind: 'bv', adjustedValue: adjustedBv, gunnery: 4, piloting: 8 });
    });

    it('honors the requested Piloting range for infantry with anti-Mech capability', () => {
        const unit = createUnit({
            type: 'Infantry' as UnitType,
            subtype: 'Conventional Infantry' as UnitSubtype,
            canAntiMech: true,
        });
        const adjustedBv = BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, 4, 2);

        expect(findBvNormalizationMatch(unit, settings(adjustedBv, adjustedBv, 4, 4, 2, 2)))
            .toEqual({ kind: 'bv', adjustedValue: adjustedBv, gunnery: 4, piloting: 2 });
    });
});
