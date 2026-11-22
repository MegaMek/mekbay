// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { ArmorType } from '../entity/types';
import { TestAeroSpaceFighterEntity, TestBattleArmorEntity, TestSupportTankEntity, TestTankEntity } from '../entity/testing/test-entities';
import type { WeaponType } from '../weapon-types.model';
import {
    armorForCriticalCheck,
    armorPiercingCheckModifiers,
    armorPiercingIgnoresSpecialArmor,
    FALL_DAMAGE,
    PHYSICAL_DAMAGE,
    reflectedHeat,
    resolveArmorDamage,
    rifleHitDamage,
} from './armor-damage-rules';

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
        // Total Warfare too: two pips hold four of five points, so one reaches the structure (TO:AUE pp. 93-94).
        expect(resolveArmorDamage('total-warfare', 5, 2, 'REFLECTIVE', weapon('DE')))
            .toEqual({ armorDamage: 2, remainingDamage: 1 });
    });

    it('lets Core armor-piercing rounds and acid missiles past special armor reduction', () => {
        const ap = { kind: 'weapon' as const, types: ['DB'] as WeaponType[], ammo: 'armor-piercing' as const };
        const acid = { kind: 'weapon' as const, types: ['M'] as WeaponType[], ammo: 'acid' as const };
        // Core p. 191: ballistic-reinforced armor gives no reduction against armor-piercing rounds; TW still halves.
        expect(resolveArmorDamage('core-2026', 5, 10, 'BALLISTIC_REINFORCED', ap).armorDamage).toBe(5);
        expect(resolveArmorDamage('total-warfare', 5, 10, 'BALLISTIC_REINFORCED', ap).armorDamage).toBe(2);
        // Core p. 192: an acid missile deals 3, unreduced, to these armors with 3 or more points left, else its 2.
        expect(resolveArmorDamage('core-2026', 2, 10, 'REACTIVE', acid)).toEqual({ armorDamage: 3, remainingDamage: 0 });
        expect(resolveArmorDamage('core-2026', 2, 10, 'BALLISTIC_REINFORCED', acid).armorDamage).toBe(3);
        expect(resolveArmorDamage('core-2026', 2, 2, 'REACTIVE', acid)).toEqual({ armorDamage: 2, remainingDamage: 0 });
        expect(resolveArmorDamage('core-2026', 2, 10, 'STANDARD', acid).armorDamage).toBe(2);
        // Armor-piercing rounds deal standard damage to standard armor: each point removes a full hardened pip, two
        // marks (Core p. 191; TO:AUE p. 93).
        for (const ruleset of ['core-2026', 'total-warfare'] as const) {
            expect(resolveArmorDamage(ruleset, 5, 6, 'HARDENED', ap)).withContext(ruleset)
                .toEqual({ armorDamage: 6, remainingDamage: 2 });
        }
        expect(armorPiercingIgnoresSpecialArmor('core-2026', 'ANTI_PENETRATIVE_ABLATION', ap)).toBeTrue();
        expect(armorPiercingIgnoresSpecialArmor('core-2026', 'REACTIVE', ap)).toBeFalse();
        expect(armorPiercingIgnoresSpecialArmor('total-warfare', 'HARDENED', ap)).toBeFalse();
    });

    it('reads the armor-piercing check modifiers by ruleset, autocannon size and armor', () => {
        const total = (ruleset: CBTRuleset, armor: ArmorType, rackSize: number) => armorPiercingCheckModifiers(ruleset, armor,
            { kind: 'weapon', types: ['DB'], ammo: 'armor-piercing', rackSize })?.reduce((sum, row) => sum + row.value, 0) ?? null;
        // Core p.191, the AC/15 as MegaMek; TW p.140, the sizes between as MegaMek.
        expect([2, 4, 5, 10, 15, 20].map(size => total('core-2026', 'STANDARD', size))).toEqual([-3, -2, -2, -1, -1, -1]);
        expect([2, 4, 5, 6, 8, 10, 15, 20].map(size => total('total-warfare', 'STANDARD', size)))
            .toEqual([-4, -3, -3, -3, -2, -2, -2, -1]);
        // Core: ablation, ballistic-reinforced and hardened armor negate it. TW: hardened, ferro-lamellor and reactive
        // negate it; ablation -2, laser-reflective +2, impact-resistant +1 (IO:AE pp.80, 82; TO:AUE pp.92-94).
        const armors: readonly ArmorType[] = ['ANTI_PENETRATIVE_ABLATION', 'BALLISTIC_REINFORCED', 'HARDENED',
            'FERRO_LAMELLOR', 'REACTIVE', 'REFLECTIVE', 'IMPACT_RESISTANT'];
        expect(armors.map(armor => total('core-2026', armor, 5))).toEqual([null, null, null, -2, -2, -2, -2]);
        expect(armors.map(armor => total('total-warfare', armor, 5))).toEqual([-5, -3, null, null, null, -1, -2]);
        expect(armorPiercingCheckModifiers('total-warfare', 'STANDARD', weapon('DB'))).toBeNull();
    });

    it('uses the armor on the receiving face for a tandem-charge warhead', () => {
        const tandem = { kind: 'weapon' as const, types: ['M' as const], ammo: 'tandem-charge' as const };
        for (const ruleset of ['core-2026', 'total-warfare'] as const) {
            const total = (armor: ArmorType, stillArmored = true, lowBar = false) =>
                armorPiercingCheckModifiers(ruleset, armorForCriticalCheck(ruleset, armor, 2, stillArmored ? 1 : 2), tandem, lowBar)
                    ?.reduce((sum, row) => sum + row.value, 0) ?? null;
            expect(total('STANDARD')).toBe(-2);
            expect(total('BALLISTIC_REINFORCED')).toBe(-2);
            expect(total('COMMERCIAL', true, true)).toBe(0);
            expect(total('REFLECTIVE')).toBe(0);
            expect(total('IMPACT_RESISTANT')).toBe(-1);
            expect(total('ANTI_PENETRATIVE_ABLATION')).toBe(ruleset === 'core-2026' ? null : -4);
            expect(total('ANTI_PENETRATIVE_ABLATION', false)).toBe(ruleset === 'core-2026' ? null : -2);
            for (const armor of ['HARDENED', 'FERRO_LAMELLOR', 'REACTIVE'] as const) expect(total(armor)).toBeNull();
            expect(resolveArmorDamage(ruleset, 2, 3, 'HARDENED', tandem)).toEqual({ armorDamage: 3, remainingDamage: 0 });
            expect(resolveArmorDamage(ruleset, 2, 3, 'HARDENED', tandem, new TestAeroSpaceFighterEntity()))
                .toEqual({ armorDamage: 2, remainingDamage: 0 });
        }
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
