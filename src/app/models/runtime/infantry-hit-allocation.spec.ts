// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTForceMember } from '../force-member.model';
import { TestInfantryEntity, TestBattleArmorEntity } from '../entity/testing/test-entities';
import { AmmoEquipment, WeaponEquipment } from '../equipment.model';
import { infantryCasualties, infantryHitClass } from '../rules/infantry-hit-damage';
import type { AttackEvent, AttackHitGroup } from '../../services/game-events.service';
import { allocateInfantryHits, allocateSuitGroups } from './infantry-hit-allocation';

describe('TW infantry damage', () => {
    const group = (damage: number, aux: number): AttackHitGroup => ({ damage, aux, location: [4, 4] });
    it('converts the whole weapon, then applies exposure and mechanized protection or vulnerability', () => {
        const die = jasmine.createSpy('d6').and.returnValues(3, 4, 3, 4);
        expect(infantryCasualties('ordinary', ['DB'], [15], false, false, 1, die)).toBe(2);
        expect(infantryCasualties('ordinary', ['DB'], [15], false, true, 1, die)).toBe(4);
        expect(infantryCasualties('ordinary', ['DB'], [15], true, false, 1, die)).toBe(4);
        expect(infantryCasualties('ordinary', ['M', 'C'], [5, 5, 5, 4], false, false, 1, die)).toBe(4);
        const mg = new WeaponEquipment({ id: 'ISMG', name: 'Machine Gun', type: 'weapon', weapon: { ammoType: 'MG' } });
        expect(infantryCasualties(infantryHitClass(mg, false), ['DB'], [2], false, false, 1, die)).toBe(7);
        expect(infantryCasualties(infantryHitClass(mg, false), ['DB'], [2], true, false, 1, die)).toBe(3);
        expect(die).toHaveBeenCalledTimes(4);
    });
    it('uses half the infantry burst dice inside then applies the interior protection before mechanized armor', () => {
        const machineGun = () => 6;
        expect(infantryCasualties('burst-2', ['DB'], [2], false, false, 1, machineGun, 'light')).toBe(6);
        expect(infantryCasualties('burst-2', ['DB'], [2], false, false, 1, machineGun, 'hardened')).toBe(3);
        expect(infantryCasualties('burst-2', ['DB'], [2], true, false, 1, machineGun, 'hardened')).toBe(1);
    });

    it('prepares the actual incoming report from the defender’s preview state without modifying the received roll', () => {
        const event: AttackEvent = { kind: 'attack', id: 'attack', attacker: 'Atlas', fromForce: 'a', fromUnit: 'u',
            toUnit: 'i', turn: 1, arc: 'front', weapons: [{ name: 'Gauss', types: ['DB'], infantryClass: 'ordinary',
                infantryInOpen: false, targetNumber: 4, toHit: [4, 4], groups: [group(15, 1)] }] };
        const member = (entity: TestInfantryEntity | TestBattleArmorEntity, code: string, internal = 3) => ({
            entity, force: { getUnitSnapshot: () => ({ ruleset: 'total-warfare' }) }, nonMekRecordSheetSnapshot: () => ({ locations: [{ code, previewRemainingInternal: internal,
                armor: [{ previewRemaining: 2 }] }] }),
        }) as unknown as CBTForceMember;
        const die = jasmine.createSpy('unused die');
        const infantry = allocateInfantryHits(member(new TestInfantryEntity(), 'Infantry'), event, die);
        expect(infantry.weapons[0].groups[0]).toEqual({ ...group(2, 1), trooperLocation: 'Infantry' });
        const armored = allocateInfantryHits(member(new TestBattleArmorEntity(), 'Trooper 1'), event, die);
        expect(armored.weapons[0].groups[0]).toEqual({ ...group(15, 1), trooperLocation: 'Trooper 1' });
        const machineGuns = { ...event, weapons: [{ ...event.weapons[0], infantryClass: 'infantry' as const,
            infantryBurstDice: 1, groups: [group(11, 1)] }] };
        const bonus = jasmine.createSpy('one burst die for the platoon').and.returnValue(4);
        const recorded = { ...event, weapons: [{ ...event.weapons[0], infantryClass: 'burst-2' as const,
            infantryDice: [3, 4], groups: [group(2, 1)] }] };
        expect(allocateInfantryHits(member(new TestInfantryEntity(), 'Infantry', 28), recorded, die).weapons[0].groups[0].damage).toBe(7);
        const hit = allocateInfantryHits(member(new TestInfantryEntity(), 'Infantry', 28), machineGuns, bonus);
        expect(hit.weapons[0].groups[0].damage).toBe(15);
        expect(bonus).toHaveBeenCalledTimes(1);
        expect(event.weapons[0].groups[0].damage).toBe(15);
        expect(die).not.toHaveBeenCalled();
    });

    it('classifies fragmentation and flechette by the selected munition', () => {
        for (const [munition, damage] of [['M_FRAGMENTATION', 20], ['M_FLECHETTE', 10]] as const) {
            const launcher = new WeaponEquipment({ id: 'launcher', name: 'Launcher', type: 'weapon', weapon: {} });
            const ammo = new AmmoEquipment({ id: 'ammo', name: 'Ammo', type: 'ammo', ammo: { munitionType: [munition] } });
            const hit = infantryHitClass(launcher, false, ammo);
            expect(infantryCasualties(hit, ['DB'], [damage], false, false, 1, () => 1)).toBe(damage);
            expect(infantryCasualties(hit, ['DB'], [damage], true, false, 1, () => 1)).toBe(damage / 2);
            expect(infantryHitClass(launcher, false)).toBe('ordinary');
        }
    });

    it('resolves the full PPC hit before deciding whether a reflective suit survives', () => {
        const suit = { code: 'Trooper 1', armor: 2, internal: 1, armorType: 'BA_REFLECTIVE' as const };
        const source = { kind: 'weapon' as const, types: ['DE' as const] };
        expect(allocateSuitGroups([group(2, 1), group(10, 1), group(1, 1)], [suit], false, () => 1,
            'total-warfare', source).map(hit => hit.damage)).toEqual([2, 10]);
        expect([suit.armor, suit.internal]).toEqual([0, 0]);
    });

    it('assigns each group to a surviving suit, discards overflow, and applies area damage to each survivor', () => {
        const suits = [{ code: 'Trooper 1', armor: 1, internal: 1, armorType: null }, { code: 'Trooper 3', armor: 7, internal: 1, armorType: null }];
        const die = jasmine.createSpy('d6').and.returnValues(2, 3);
        expect(allocateSuitGroups([group(5, 1), group(3, 1)], suits, false, die, 'total-warfare', { kind: 'weapon', types: [] }).map(g => [g.trooperLocation, g.damage]))
            .toEqual([['Trooper 1', 5], ['Trooper 3', 3]]);
        expect(die).toHaveBeenCalledTimes(2);
        const area = [{ code: 'Trooper 1', armor: 0, internal: 1, armorType: null }, { code: 'Trooper 2', armor: 2, internal: 1, armorType: null }];
        expect(allocateSuitGroups([group(2, 6)], area, true, die, 'total-warfare', { kind: 'weapon', types: ['AE'] }).map(g => g.damage)).toEqual([2, 2]);
        expect(die).toHaveBeenCalledTimes(2);
    });
});
