// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { createEmptyUnit } from '../testing/unit-test-helpers';
import { BVCalculatorUtil } from './bv-calculator.util';

describe('BVCalculatorUtil', () => {
    it('keeps the pre-skill value unrounded and rounds only the adjusted result', () => {
        const unit = createEmptyUnit();

        expect(BVCalculatorUtil.calculateAdjustedBV(unit, 1112.375, 4, 3)).toBe(1335);
    });

    it('rounds the final value even when the skill multiplier is one', () => {
        const unit = createEmptyUnit();

        expect(BVCalculatorUtil.calculateAdjustedBV(unit, 2000.49, 4, 5)).toBe(2000);
        expect(BVCalculatorUtil.calculateAdjustedBV(unit, 2000.5, 4, 5)).toBe(2001);
    });

    it('reports only the unrounded skill cost, excluding final rounding', () => {
        const unit = createEmptyUnit();

        expect(BVCalculatorUtil.calculatePilotBV(unit, 2149.4, 4, 5)).toBe(0);
        expect(BVCalculatorUtil.calculatePilotBV(unit, 677.6, 4, 4)).toBeCloseTo(67.76, 10);
    });
});
