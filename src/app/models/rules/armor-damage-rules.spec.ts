// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import { TestBattleArmorEntity, TestSupportTankEntity, TestTankEntity } from '../entity/testing/test-entities';
import type { WeaponType } from '../weapon-types.model';
import { FALL_DAMAGE, PHYSICAL_DAMAGE, reflectedHeat, resolveArmorDamage, rifleHitDamage } from './armor-damage-rules';

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
        // Battle armor's laser-reflective armor halves energy damage, without the brittleness (TO:AUE p. 93).
        expect(resolveArmorDamage('total-warfare', 4, 8, 'BA_REFLECTIVE', weapon('DE', 'H')).armorDamage).toBe(2);
        expect(resolveArmorDamage('core-2026', 4, 8, 'BA_REFLECTIVE', weapon('DE')).armorDamage).toBe(2);
        expect(resolveArmorDamage('core-2026', 2, 8, 'BA_REFLECTIVE', weapon('AE')).armorDamage).toBe(2);
        // Reactive armor runs out: the rest reaches the structure at full strength.
        expect(resolveArmorDamage('core-2026', 7, 2, 'REACTIVE', weapon('M')))
            .toEqual({ armorDamage: 2, remainingDamage: 3 });
    });

    it('halves damage to heat-dissipating armor only for heat-causing weapons under Core', () => {
        expect(resolveArmorDamage('core-2026', 5, 3, 'HEAT_DISSIPATING', weapon('H')))
            .toEqual({ armorDamage: 3, remainingDamage: 0 });
        expect(resolveArmorDamage('core-2026', 5, 1, 'HEAT_DISSIPATING', weapon('H')))
            .toEqual({ armorDamage: 1, remainingDamage: 3 });
        expect(resolveArmorDamage('core-2026', 5, 8, 'HEAT_DISSIPATING', weapon('DE')).armorDamage).toBe(5);
        expect(resolveArmorDamage('total-warfare', 5, 8, 'HEAT_DISSIPATING', weapon('H')).armorDamage).toBe(5);
    });

    it('applies the fall rules of impact-resistant and laser-reflective armor', () => {
        expect(resolveArmorDamage('core-2026', 5, 10, 'IMPACT_RESISTANT', FALL_DAMAGE))
            .toEqual({ armorDamage: 2, remainingDamage: 0 });
        // Total Warfare takes 1 off every 3 points or fraction of a fall too (IO p. 81): 5 -> 3.
        expect(resolveArmorDamage('total-warfare', 5, 10, 'IMPACT_RESISTANT', FALL_DAMAGE))
            .toEqual({ armorDamage: 3, remainingDamage: 0 });
        expect(resolveArmorDamage('core-2026', 5, 2, 'REFLECTIVE', FALL_DAMAGE))
            .toEqual({ armorDamage: 2, remainingDamage: 4 });
    });

    it('doubles physical attacks on laser-reflective armor and softens them on impact-resistant armor', () => {
        expect(resolveArmorDamage('core-2026', 4, 20, 'REFLECTIVE', PHYSICAL_DAMAGE).armorDamage).toBe(8);
        // Both take 1 off every 3 points or fraction (7 -> 4), and leave at least 1 (Core p. 202; IO p. 81).
        expect(resolveArmorDamage('core-2026', 7, 20, 'IMPACT_RESISTANT', PHYSICAL_DAMAGE).armorDamage).toBe(4);
        expect(resolveArmorDamage('total-warfare', 7, 20, 'IMPACT_RESISTANT', PHYSICAL_DAMAGE).armorDamage).toBe(4);
        expect(resolveArmorDamage('core-2026', 1, 20, 'IMPACT_RESISTANT', PHYSICAL_DAMAGE).armorDamage).toBe(1);
        expect(resolveArmorDamage('total-warfare', 1, 20, 'IMPACT_RESISTANT', PHYSICAL_DAMAGE).armorDamage).toBe(1);
    });
});

describe('reflectedHeat', () => {
    it('halves the heat of reflected weapons on laser-reflective armor under TW only (TO:AUE p. 93)', () => {
        const flamer = { kind: 'weapon' as const, types: ['DE', 'H'] as WeaponType[] };
        const inferno = { kind: 'weapon' as const, types: ['M', 'H'] as WeaponType[] };
        expect(reflectedHeat('total-warfare', 'REFLECTIVE', flamer, 5)).toBe(2);
        expect(reflectedHeat('total-warfare', 'REFLECTIVE', flamer, 1)).toBe(1);
        expect(reflectedHeat('total-warfare', 'REFLECTIVE', flamer, 0)).toBe(0);
        expect(reflectedHeat('total-warfare', 'REFLECTIVE', inferno, 4)).toBe(4);
        expect(reflectedHeat('total-warfare', 'STANDARD', flamer, 5)).toBe(5);
        // Core p. 202 removed the heat-halving effect (Core changelog).
        expect(reflectedHeat('core-2026', 'REFLECTIVE', flamer, 5)).toBe(5);
    });
});

describe('rifleHitDamage', () => {
    it('takes 3 off a rifle hit on armor, to a minimum of 0 (Core p. 190; TO:AuE p. 150)', () => {
        // A unit not open here keeps its armor: Core spares all but 'Mechs, vehicles and aerospace units; Total
        // Warfare spares only infantry, battle armor and buildings. A target of no declared type is a 'Mech.
        const declared = (ruleset: CBTRuleset) =>
            ([undefined, 'vehicle', 'aero', 'protoMek', 'infantry', 'battle-armor', 'building'] as const)
                .map(unitType => rifleHitDamage(ruleset, 9, { unitType }));
        expect(declared('core-2026')).toEqual([6, 6, 6, 9, 9, 9, 9]);
        expect(declared('total-warfare')).toEqual([6, 6, 6, 6, 9, 9, 9]);
        expect(rifleHitDamage('total-warfare', 3, { unitType: 'mek-biped' })).toBe(0);
    });

    it("reduces a Total Warfare hit only on the armor left where it strikes, a Core hit on the unit's type", () => {
        const tank = new TestTankEntity();
        const struck = (armor: number) => ({ entity: tank, location: 'Front', armor });
        // Total Warfare: internal structure is never reduced; Core has no such exception.
        expect([rifleHitDamage('total-warfare', 9, struck(4)), rifleHitDamage('total-warfare', 9, struck(0))])
            .toEqual([6, 9]);
        expect(rifleHitDamage('core-2026', 9, struck(0))).toBe(6);
        expect(rifleHitDamage('total-warfare', 9, { entity: new TestBattleArmorEntity(), location: 'Trooper 1', armor: 4 }))
            .toBe(9);

        // A support vehicle's armor below BAR 8 is spared under Total Warfare.
        const supportTank = new TestSupportTankEntity();
        supportTank.barRating.set(5);
        expect(rifleHitDamage('total-warfare', 9, { entity: supportTank, location: 'Front', armor: 4 })).toBe(9);
        supportTank.barRating.set(10);
        expect(rifleHitDamage('total-warfare', 9, { entity: supportTank, location: 'Front', armor: 4 })).toBe(6);
    });
});
