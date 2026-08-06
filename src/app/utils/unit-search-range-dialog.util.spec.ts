// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { normalizeUnitSearchRange, rangeFilterAllowsFloatingValues } from './unit-search-range-dialog.util';

describe('unit search range dialog utilities', () => {
    describe('normalizeUnitSearchRange', () => {
        it('preserves an in-range ascending range', () => {
            expect(normalizeUnitSearchRange({ from: 20, to: 80 }, [0, 100])).toEqual([20, 80]);
        });

        it('uses available boundaries for missing endpoints', () => {
            expect(normalizeUnitSearchRange({ from: null, to: 80 }, [10, 100])).toEqual([10, 80]);
            expect(normalizeUnitSearchRange({ from: 20, to: null }, [10, 100])).toEqual([20, 100]);
        });

        it('independently clamps both endpoints', () => {
            expect(normalizeUnitSearchRange({ from: -5, to: 200 }, [0, 100])).toEqual([0, 100]);
        });

        it('orders reversed endpoints after clamping', () => {
            expect(normalizeUnitSearchRange({ from: 90, to: 20 }, [0, 100])).toEqual([20, 90]);
            expect(normalizeUnitSearchRange({ from: 120, to: -20 }, [0, 100])).toEqual([0, 100]);
        });

        it('supports negative and fractional boundaries', () => {
            expect(normalizeUnitSearchRange({ from: -2.5, to: 1.25 }, [-5.5, 5.5])).toEqual([-2.5, 1.25]);
        });
    });

    describe('rangeFilterAllowsFloatingValues', () => {
        it('rejects floating values for an absent or integer-only configuration', () => {
            expect(rangeFilterAllowsFloatingValues(undefined)).toBeFalse();
            expect(rangeFilterAllowsFloatingValues({ stepSize: 2 })).toBeFalse();
        });

        it('allows floating values for fractional steps or special values', () => {
            expect(rangeFilterAllowsFloatingValues({ stepSize: 0.5 })).toBeTrue();
            expect(rangeFilterAllowsFloatingValues({ stepSize: 1, specialValues: [1, 2.5] })).toBeTrue();
        });
    });
});
