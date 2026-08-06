// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    bondNumberRange,
    normalizeBoundedInteger,
    normalizeBoundedIntegerInput,
} from './bounded-integer-input.util';

describe('bounded integer input utilities', () => {
    it('floors and clamps values to inclusive boundaries', () => {
        expect(normalizeBoundedInteger(-1000, { min: 0, max: 999_999 })).toBe(0);
        expect(normalizeBoundedInteger(1000.9, { min: 0, max: 999_999 })).toBe(1000);
        expect(normalizeBoundedInteger(1_000_000, { min: 0, max: 999_999 })).toBe(999_999);
    });

    it('parses formatted strings and uses the fallback for invalid values', () => {
        expect(normalizeBoundedInteger('12,345', { min: 0, max: 999_999 })).toBe(12_345);
        expect(normalizeBoundedInteger('', { min: 1, max: 10, fallback: 4 })).toBe(4);
        expect(normalizeBoundedInteger('invalid', { min: 1, max: 10, fallback: 20 })).toBe(10);
    });

    it('rejects inverted integer bounds', () => {
        expect(() => normalizeBoundedInteger(5, { min: 10, max: 1 })).toThrowError(RangeError);
    });

    it('rejects non-finite bounds', () => {
        expect(() => normalizeBoundedInteger(5, { min: Number.NaN, max: 10 })).toThrowError(RangeError);
        expect(() => normalizeBoundedInteger(5, { min: 0, max: Number.POSITIVE_INFINITY })).toThrowError(RangeError);
    });

    it('rewrites the input with its normalized value', () => {
        const input = document.createElement('input');
        input.value = '-1000';

        const value = normalizeBoundedIntegerInput({ target: input } as unknown as Event, {
            min: 0,
            max: 999_999,
        });

        expect(value).toBe(0);
        expect(input.value).toBe('0');
    });

    it('can display normalized zero as empty', () => {
        const input = document.createElement('input');
        input.value = '-1';

        const value = normalizeBoundedIntegerInput({ target: input } as unknown as Event, {
            min: 0,
            max: Number.MAX_SAFE_INTEGER,
            emptyWhenZero: true,
        });

        expect(value).toBe(0);
        expect(input.value).toBe('');
    });

    describe('bonded ranges', () => {
        it('raises a lower maximum to the edited minimum', () => {
            expect(bondNumberRange({ min: 10, max: 8 }, 'min')).toEqual({ min: 10, max: 10 });
        });

        it('lowers a higher minimum to the edited maximum', () => {
            expect(bondNumberRange({ min: 10, max: 8 }, 'max')).toEqual({ min: 8, max: 8 });
        });

        it('preserves ordered, equal, and open ranges', () => {
            expect(bondNumberRange({ min: 4, max: 8 }, 'min')).toEqual({ min: 4, max: 8 });
            expect(bondNumberRange({ min: 8, max: 8 }, 'max')).toEqual({ min: 8, max: 8 });
            expect(bondNumberRange({ min: 10, max: null }, 'min')).toEqual({ min: 10, max: null });
            expect(bondNumberRange({ min: null, max: 8 }, 'max')).toEqual({ min: null, max: 8 });
        });
    });
});
