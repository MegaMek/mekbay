// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { adjustPointValueForSkill } from './pv-skill-adjustment.util';

describe('adjustPointValueForSkill', () => {
    it('returns base PV for the default skill', () => {
        expect(adjustPointValueForSkill(20, 4)).toBe(20);
    });

    it('applies improved-skill bracket boundaries', () => {
        expect(adjustPointValueForSkill(7, 3)).toBe(8);
        expect(adjustPointValueForSkill(8, 3)).toBe(10);
        expect(adjustPointValueForSkill(13, 3)).toBe(16);
    });

    it('applies reduced-skill bracket boundaries', () => {
        expect(adjustPointValueForSkill(14, 5)).toBe(13);
        expect(adjustPointValueForSkill(15, 5)).toBe(13);
        expect(adjustPointValueForSkill(25, 5)).toBe(22);
    });

    it('preserves the minimum point value', () => {
        expect(adjustPointValueForSkill(1, 10)).toBe(1);
    });

    it('rejects invalid values', () => {
        expect(() => adjustPointValueForSkill(0, 4)).toThrowError(RangeError);
        expect(() => adjustPointValueForSkill(10, -1)).toThrowError(RangeError);
        expect(() => adjustPointValueForSkill(10, 1.5)).toThrowError(RangeError);
    });
});