// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { FormatBvPipe } from './format-bv.pipe';

describe('FormatBvPipe', () => {
    it('shows up to two decimal places without trailing zeroes', () => {
        expect(FormatBvPipe.formatValue(2000)).toBe('2000');
        expect(FormatBvPipe.formatValue(2000.9)).toBe('2000.9');
        expect(FormatBvPipe.formatValue(2000.999)).toBe('2001');
    });

    it('optionally groups thousands', () => {
        expect(FormatBvPipe.formatValue(2000.9, true)).toBe('2,000.9');
    });

    it('does not display negative zero after visual rounding', () => {
        expect(FormatBvPipe.formatValue(-0.004)).toBe('0');
    });
});
