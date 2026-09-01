// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    calculateTacticalPipContentWidth,
    calculateTacticalPipRows,
} from './tactical-pip-matrix.directive';

describe('calculateTacticalPipRows', () => {
    it('uses two rows before adding another column', () => {
        expect(calculateTacticalPipRows(12, 108)).toBe(2);
        expect(calculateTacticalPipRows(20, 108)).toBe(2);
    });

    it('adds only the minimum rows required to avoid horizontal overflow', () => {
        expect(calculateTacticalPipRows(12, 107)).toBe(3);
        expect(calculateTacticalPipRows(25, 108)).toBe(3);
        expect(calculateTacticalPipRows(1000, 167)).toBe(67);
    });

    it('keeps the two-row default when more columns fit than are needed', () => {
        expect(calculateTacticalPipRows(25, 1000)).toBe(2);
    });

    it('keeps one group and Battle Armor tracks on a single line', () => {
        expect(calculateTacticalPipRows(5, 1)).toBe(1);
        expect(calculateTacticalPipRows(30, 1, true)).toBe(1);
    });

    it('falls back to two rows while a multi-group track cannot be measured', () => {
        expect(calculateTacticalPipRows(12, 0)).toBe(2);
        expect(calculateTacticalPipRows(12, Number.NaN)).toBe(2);
    });
});

describe('calculateTacticalPipContentWidth', () => {
    it('measures the intended two-row content before deciding whether tracks wrap', () => {
        expect(calculateTacticalPipContentWidth(3)).toBe(108);
        expect(calculateTacticalPipContentWidth(4)).toBe(108);
        expect(calculateTacticalPipContentWidth(5)).toBe(167);
    });

    it('measures Battle Armor content as one line', () => {
        expect(calculateTacticalPipContentWidth(3, true)).toBe(167);
    });
});
