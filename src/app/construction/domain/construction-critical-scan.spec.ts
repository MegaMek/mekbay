// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { AmmoEquipment, MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import { BattleArmorEntity } from '../../models/entity/entities';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { calculateBattleArmorWeightBreakdown } from '../../models/entity/utils/weight/battle-armor-weight';
import { createConstructionEntity } from './construction-factory';
import { validateConstruction } from './construction-rules';

const registry = createTestEquipmentRegistry();
const gun = new WeaponEquipment({ id: 'Support gun', name: 'Support gun', type: 'weapon',
    flags: ['F_BA_WEAPON'], stats: { tonnage: .2, criticalSlots: 2 }, weapon: { ammoType: 'AC', rackSize: 2 } });
const ammo = new AmmoEquipment({ id: 'Support ammo', name: 'Support ammo', type: 'ammo',
    flags: ['F_BATTLEARMOR'], stats: { criticalSlots: 1 }, ammo: { type: 'AC', rackSize: 2, shots: 4, kgPerShot: 2 } });

describe('construction second critical scan', () => {
    it('charges equipment to the first and last BA suits and reports the correct overweight trooper', () => {
        const entity = createConstructionEntity('BattleArmor', registry) as BattleArmorEntity;
        addTestEquipment(entity, gun, { location: 'Trooper 1', baMountLocation: 'Body' });
        addTestEquipment(entity, new WeaponEquipment({ id: 'Heavy gun', name: 'Heavy gun', type: 'weapon',
            flags: ['F_BA_WEAPON'], stats: { tonnage: 2, criticalSlots: 1 } }),
            { location: `Trooper ${entity.trooperCount()}`, baMountLocation: 'Body' });
        const weights = calculateBattleArmorWeightBreakdown(entity);
        expect(weights.suits.map(suit => suit.weapons)).toEqual([.2, 0, 0, 2]);
        const issues = validateConstruction(entity).messages.filter(message => message.code === 'BA_SUIT_OVERWEIGHT');
        expect(issues.length).toBe(1);
        expect(issues[0].message).toContain('Trooper 4');
    });

    for (const [base, weaponWeight, ammoWeight] of [['IS', .1, .004], ['Clan', .08, .0032]] as const) {
        it(`reserves individually assigned squad-support weapon and ammunition mass on every ${base} suit`, () => {
            const entity = createConstructionEntity('BattleArmor', registry) as BattleArmorEntity;
            entity.techBase.set(base);
            addTestEquipment(entity, gun, { location: 'Trooper 1', baMountLocation: 'Body', isSSWM: true });
            addTestEquipment(entity, ammo, { location: 'Trooper 1', baMountLocation: 'Body', isSSWM: true, shotsCount: 4 });
            const weights = calculateBattleArmorWeightBreakdown(entity);
            for (const suit of weights.suits) {
                expect(suit.weapons).toBeCloseTo(weaponWeight, 6);
                expect(suit.ammo).toBeCloseTo(ammoWeight, 6);
            }
            expect(weights.suits.every(suit => suit.exact === weights.suits[0].exact)).toBeTrue();
        });
    }

    it('checks each suit has room for the full squad-support weapon and its ammunition', () => {
        const entity = createConstructionEntity('BattleArmor', registry) as BattleArmorEntity;
        addTestEquipment(entity, gun, { location: 'Trooper 1', baMountLocation: 'Body', isSSWM: true });
        addTestEquipment(entity, ammo, { location: 'Trooper 1', baMountLocation: 'Body', isSSWM: true, shotsCount: 4 });
        addTestEquipment(entity, new MiscEquipment({ id: 'Body gear', name: 'Body gear', type: 'misc',
            flags: ['F_BA_EQUIPMENT'], stats: { tonnage: .01, criticalSlots: 2 } }),
            { location: 'Trooper 2', baMountLocation: 'Body' });
        const messages = validateConstruction(entity).messages;
        expect(messages).toContain(jasmine.objectContaining({ code: 'BA_LOCATION_SLOTS',
            message: 'Trooper 2 Body uses 5 of 4 critical slots.' }));
        expect(messages.some(message => message.code === 'BA_ANTI_MEK_WEAPON_LIMIT')).toBeFalse();
    });

    it('counts squad-level support gear once per suit and ignores unallocated support gear', () => {
        const entity = createConstructionEntity('BattleArmor', registry) as BattleArmorEntity;
        addTestEquipment(entity, gun, { location: 'Squad', baMountLocation: 'Body', isSSWM: true });
        addTestEquipment(entity, gun, { allocation: { kind: 'unallocated' }, baMountLocation: 'Body', isSSWM: true });
        expect(calculateBattleArmorWeightBreakdown(entity).suits.map(suit => suit.weapons)).toEqual([.1, .1, .1, .1]);
    });
});
