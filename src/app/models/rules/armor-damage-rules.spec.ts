// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { WeaponType } from '../weapon-types.model';
import { FALL_DAMAGE, PHYSICAL_DAMAGE, resolveArmorDamage } from './armor-damage-rules';

describe('resolveArmorDamage', () => {
    const weapon = (...types: WeaponType[]) => ({ kind: 'weapon' as const, types });

    it('lets special armor resist only its weapon types, rounding by ruleset', () => {
        // Laser-reflective vs a laser: TW halves rounding down; Core lets the leftover point destroy a pip.
        expect(resolveArmorDamage('total-warfare', 5, 10, 'REFLECTIVE', weapon('DE')))
            .toEqual({ armorDamage: 2, remainingDamage: 0 });
        expect(resolveArmorDamage('core-2026', 5, 10, 'REFLECTIVE', weapon('DE')))
            .toEqual({ armorDamage: 3, remainingDamage: 0 });
        // Missiles ignore laser-reflective; area effect is doubled like a fall.
        expect(resolveArmorDamage('core-2026', 5, 10, 'REFLECTIVE', weapon('M')).armorDamage).toBe(5);
        expect(resolveArmorDamage('core-2026', 2, 10, 'REFLECTIVE', weapon('AE')).armorDamage).toBe(4);
        // Impact-resistant armor only softens falls.
        expect(resolveArmorDamage('core-2026', 5, 10, 'IMPACT_RESISTANT', weapon('DB')).armorDamage).toBe(5);
        // Reactive armor runs out: the rest reaches the structure at full strength.
        expect(resolveArmorDamage('core-2026', 7, 2, 'REACTIVE', weapon('M')))
            .toEqual({ armorDamage: 2, remainingDamage: 3 });
    });

    it('applies the fall rules of impact-resistant and laser-reflective armor', () => {
        expect(resolveArmorDamage('core-2026', 5, 10, 'IMPACT_RESISTANT', FALL_DAMAGE))
            .toEqual({ armorDamage: 2, remainingDamage: 0 });
        expect(resolveArmorDamage('total-warfare', 5, 10, 'IMPACT_RESISTANT', FALL_DAMAGE))
            .toEqual({ armorDamage: 4, remainingDamage: 0 });
        expect(resolveArmorDamage('core-2026', 5, 2, 'REFLECTIVE', FALL_DAMAGE))
            .toEqual({ armorDamage: 2, remainingDamage: 4 });
    });

    it('doubles physical attacks on laser-reflective armor and softens them on impact-resistant armor', () => {
        expect(resolveArmorDamage('core-2026', 4, 20, 'REFLECTIVE', PHYSICAL_DAMAGE).armorDamage).toBe(8);
        // Core: 1 off every 3 points or fraction (7 -> 4); Total Warfare: 1 off every full 3 (7 -> 5).
        expect(resolveArmorDamage('core-2026', 7, 20, 'IMPACT_RESISTANT', PHYSICAL_DAMAGE).armorDamage).toBe(4);
        expect(resolveArmorDamage('total-warfare', 7, 20, 'IMPACT_RESISTANT', PHYSICAL_DAMAGE).armorDamage).toBe(5);
        expect(resolveArmorDamage('core-2026', 1, 20, 'IMPACT_RESISTANT', PHYSICAL_DAMAGE).armorDamage).toBe(1);
    });
});
