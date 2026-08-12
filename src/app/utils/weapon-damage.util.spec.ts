// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { formatWeaponDamage } from './weapon-damage.util';

describe('formatWeaponDamage', () => {
    it('formats fixed, fractional, and range damage without changing precision', () => {
        expect(formatWeaponDamage({ values: [5], maximum: 5 })).toBe('5');
        expect(formatWeaponDamage({ values: [0.52], maximum: 0.52 })).toBe('0.52');
        expect(formatWeaponDamage({ values: [10, 8, 5], maximum: 10 })).toBe('10/8/5');
    });

    it('hides zero by default and preserves range separators', () => {
        expect(formatWeaponDamage({ values: [0], maximum: 0 })).toBe('');
        expect(formatWeaponDamage({ values: [0], maximum: 0 }, { showZero: true })).toBe('0');
        expect(formatWeaponDamage({ values: [10, 0, 5], maximum: 10 })).toBe('10//5');
    });

    it('formats missile, shot, and artillery units', () => {
        expect(formatWeaponDamage({ values: [2], maximum: 12, unit: 'missile' })).toBe('2/Msl');
        expect(formatWeaponDamage({ values: [5], maximum: 10, unit: 'shot' })).toBe('5/Sht');
        expect(formatWeaponDamage(
            { values: [5], maximum: 10, unit: 'shot' },
            { shotSuffix: '/Sht' },
        )).toBe('5/Sht');
        expect(formatWeaponDamage({ values: [20], maximum: 20, unit: 'artillery' })).toBe('20A');
    });

    it('does not append a unit when the formatted damage is empty', () => {
        expect(formatWeaponDamage({ values: [], maximum: 0, unit: 'missile' })).toBe('');
    });
});
