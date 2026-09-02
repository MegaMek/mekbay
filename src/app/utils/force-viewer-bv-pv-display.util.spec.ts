// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { formatBvPv } from './force-viewer-bv-pv-display.util';

describe('force viewer BV/PV display', () => {
    it('formats the adjusted value', () => {
        expect(formatBvPv(1_250, 1_000, 'adjusted')).toBe('1,250');
    });

    it('formats the pre-skill base value', () => {
        expect(formatBvPv(1_250, 1_000, 'base')).toBe('1,000');
    });

    it('formats adjusted and base values in adjusted-first order', () => {
        expect(formatBvPv(1_250, 1_000, 'both')).toBe('1,250 (1,000)');
    });

    it('suppresses the duplicate base value when both values are equal', () => {
        expect(formatBvPv(1_000, 1_000, 'both')).toBe('1,000');
    });

    it('never compresses BV/PV values', () => {
        expect(formatBvPv(12_600, 10_400, 'both')).toBe('12,600 (10,400)');
    });

    it('formats zero totals', () => {
        expect(formatBvPv(0, 0, 'both')).toBe('0');
    });

    it('shows pre-skill values with up to two decimal places', () => {
        expect(formatBvPv(2_501, 2_000.9, 'both')).toBe('2,501 (2,000.9)');
        expect(formatBvPv(2_501, 2_000.99, 'base')).toBe('2,000.99');
    });
});
