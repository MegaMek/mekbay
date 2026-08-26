// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    resolveAmmoKgPerShot,
    resolveAmmoBattleValue,
    resolveAmmoShots,
    resolveChangedAmmoCapacity,
    type AmmoCapacityFacts,
} from './ammo-capacity-rules';

describe('ammo capacity rules', () => {
    const standard = facts(20);
    const precision = facts(20, ['M_PRECISION'], 20);
    const armorPiercing = facts(20, ['M_ARMOR_PIERCING'], 20);

    it('derives the ruleset-specific precision/AP density from standard ammunition', () => {
        expect(resolveAmmoShots('core-2026', precision)).toBe(12);
        expect(resolveAmmoShots('core-2026', armorPiercing)).toBe(16);
        expect(resolveAmmoShots('core-2026', standard)).toBe(20);
        expect(resolveAmmoShots('total-warfare', precision)).toBe(10);
        expect(resolveAmmoShots('total-warfare', armorPiercing)).toBe(10);
        expect(resolveAmmoShots('total-warfare', standard)).toBe(20);
        expect(resolveAmmoKgPerShot('core-2026', precision)).toBeCloseTo(1000 / 12, 10);
        expect(resolveChangedAmmoCapacity('core-2026', standard, 10, precision)).toBe(6);
        expect(resolveChangedAmmoCapacity('core-2026', standard, 10, armorPiercing)).toBe(8);
        expect(resolveChangedAmmoCapacity('total-warfare', standard, 10, precision)).toBe(5);
        expect(resolveChangedAmmoCapacity('total-warfare', standard, 10, armorPiercing)).toBe(5);
    });

    it('ports the ruleset-specific anti-TSM warhead capacity and BV', () => {
        const ax = Object.freeze({
            ...facts(20, ['M_AX_HEAD'], 20),
            bv: 7,
            baseAmmoBv: 10,
        });

        expect(resolveAmmoShots('core-2026', ax)).toBe(20);
        expect(resolveAmmoBattleValue('core-2026', ax)).toBe(10);
        expect(resolveAmmoShots('total-warfare', ax)).toBe(10);
        expect(resolveAmmoBattleValue('total-warfare', ax)).toBe(20);
    });

    it('uses explicit kg/shot without a second ruleset vocabulary', () => {
        const custom = facts(20, [], undefined, 25);
        expect(resolveAmmoKgPerShot('core-2026', custom)).toBe(25);
        expect(resolveChangedAmmoCapacity('core-2026', custom, 8, facts(10))).toBe(2);
    });
});

function facts(
    shots: number,
    munitionTypes: readonly string[] = [],
    baseAmmoShots?: number,
    kgPerShot = 0,
): AmmoCapacityFacts {
    return Object.freeze({
        shots,
        kgPerShot,
        hasCustomKgPerShot: kgPerShot > 0,
        munitionTypes: new Set(munitionTypes),
        ...(baseAmmoShots === undefined ? {} : { baseAmmoShots }),
    });
}
