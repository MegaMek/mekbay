// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { getUnitHeight, type UnitSummary } from './unit-summary.model';

describe('unit height', () => {
    const unit = (type: UnitSummary['type'], tons: number): Pick<UnitSummary, 'type' | 'tons'> => ({ type, tons });

    it('derives standing height from unit type and superheavy weight', () => {
        expect(getUnitHeight(unit('Mek', 125))).toBe(3);
        expect(getUnitHeight(unit('Mek', 100))).toBe(2);
        expect(getUnitHeight(unit('Tank', 200))).toBe(1);
    });

    it('reduces prone height by one with a minimum of one', () => {
        expect(getUnitHeight(unit('Mek', 125), true)).toBe(2);
        expect(getUnitHeight(unit('Mek', 100), true)).toBe(1);
        expect(getUnitHeight(unit('Tank', 200), true)).toBe(1);
    });
});
