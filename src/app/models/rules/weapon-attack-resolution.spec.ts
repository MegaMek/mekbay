// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asComponentId } from '../entity/entity-identifiers';
import { AmmoEquipment, WeaponEquipment } from '../equipment.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES, type CBTGameRules } from './game-rules';
import { resolveWeaponAttack, weaponAttackProfile } from './weapon-attack-resolution';

describe('weapon attack resolution', () => {
    const weaponId = asComponentId('weapon');
    const lrm15 = new WeaponEquipment({
        id: 'ISLRM15', name: 'LRM 15', type: 'weapon', flags: ['F_MISSILE', 'F_LRM'],
        weapon: { damage: 'cluster', rackSize: 15, ammoType: 'LRM' },
    });
    const lrmAmmo = new AmmoEquipment({
        id: 'ISLRM15 Ammo', name: 'LRM 15 Ammo', type: 'ammo',
        ammo: { type: 'LRM', rackSize: 15, damagePerShot: 1 },
    });

    it('rolls missiles on the Cluster Hits Table and groups them in five-point clusters', () => {
        const profile = weaponAttackProfile({ componentId: weaponId, equipment: lrm15, mode: undefined, damage: { values: [1], maximum: 15, unit: 'missile' }, ammo: lrmAmmo, types: [], name: 'LRM 15', targetNumber: 8, partialCover: false }, TW_GAME_RULES)!;

        expect(resolveWeaponAttack(profile, [3, 4], [6, 6])).toEqual({ hit: false, jammed: false, hits: 0, groups: [] });
        // Roll 8 on the 15 column: 9 missiles → 5 + 4.
        expect(resolveWeaponAttack(profile, [4, 4], [4, 4])).toEqual({ hit: true, jammed: false, hits: 9, groups: [5, 4] });
        // Artemis-style modifiers are clamped to the table.
        expect(resolveWeaponAttack(profile, [6, 6], [6, 6], 2).hits).toBe(15);
    });

    it('hits with every Streak missile, one location per two-point missile', () => {
        const streak = new WeaponEquipment({
            id: 'ISStreakSRM4', name: 'Streak SRM 4', type: 'weapon', flags: ['F_MISSILE', 'F_SRM'],
            weapon: { damage: 'cluster', rackSize: 4, ammoType: 'SRM_STREAK' },
        });
        const profile = weaponAttackProfile({ componentId: weaponId, equipment: streak, mode: undefined, damage: { values: [2], maximum: 8, unit: 'missile' }, ammo: null, types: [], name: 'Streak SRM 4', targetNumber: 7, partialCover: false }, TW_GAME_RULES)!;

        expect(resolveWeaponAttack(profile, [5, 2], null)).toEqual({ hit: true, jammed: false, hits: 4, groups: [2, 2, 2, 2] });
    });

    it('treats direct-fire weapons as one hit and rapid-fire shots as separate locations', () => {
        const laser = new WeaponEquipment({
            id: 'ISLargeLaser', name: 'Large Laser', type: 'weapon', flags: ['F_ENERGY', 'F_DIRECT_FIRE'],
            weapon: { damage: 8 },
        });
        const uac = new WeaponEquipment({
            id: 'ISUltraAC5', name: 'Ultra AC/5', type: 'weapon', flags: ['F_AC', 'F_BALLISTIC', 'F_DIRECT_FIRE'],
            modes: ['Single', 'Ultra'], weapon: { damage: 5, ammoType: 'AC_ULTRA' },
        });

        expect(resolveWeaponAttack(weaponAttackProfile({ componentId: weaponId, equipment: laser, mode: undefined, damage: { values: [8], maximum: 8 }, ammo: null, types: [], name: 'LL', targetNumber: 6, partialCover: false }, TW_GAME_RULES)!,
            [3, 3], null)).toEqual({ hit: true, jammed: false, hits: 1, groups: [8] });
        const ultra = weaponAttackProfile({ componentId: weaponId, equipment: uac, mode: 'Ultra', damage: { values: [5], maximum: 10, unit: 'shot' }, ammo: null, types: [], name: 'UAC', targetNumber: 6, partialCover: false }, TW_GAME_RULES)!;
        // Roll 8 on the 2 column: both shots hit, each rolling its own location.
        expect(resolveWeaponAttack(ultra, [4, 4], [4, 4])).toEqual({ hit: true, jammed: false, hits: 2, groups: [5, 5] });
        expect(weaponAttackProfile({ componentId: weaponId, equipment: uac, mode: 'Single', damage: { values: [5], maximum: 10, unit: 'shot' }, ammo: null, types: [], name: 'UAC', targetNumber: 6, partialCover: false }, TW_GAME_RULES)!
            .projectiles).toBe(1);
    });

    it('groups rocket launcher and LRM torpedo hits in five-point clusters like LRMs', () => {
        for (const ammoType of ['ROCKET_LAUNCHER', 'LRM_TORPEDO'] as const) {
            const launcher = new WeaponEquipment({
                id: ammoType, name: ammoType, type: 'weapon', flags: ['F_MISSILE'],
                weapon: { damage: 'cluster', rackSize: 20, ammoType },
            });
            const profile = weaponAttackProfile({ componentId: weaponId, equipment: launcher, mode: undefined, damage: { values: [1], maximum: 20, unit: 'missile' }, ammo: null, types: [], name: ammoType, targetNumber: 6, partialCover: false }, TW_GAME_RULES)!;
            // Roll 8 on the 20 column: 12 missiles → 5 + 5 + 2.
            expect(resolveWeaponAttack(profile, [4, 4], [4, 4]).groups).toEqual([5, 5, 2]);
        }
    });

    it('groups ATM damage in 5-point clusters under Total Warfare and 6 under Core', () => {
        const atm = new WeaponEquipment({
            id: 'CLATM6', name: 'ATM 6', type: 'weapon', flags: ['F_MISSILE', 'F_ATM'],
            weapon: { damage: 'cluster', rackSize: 6, ammoType: 'ATM' },
        });
        const groups = (rules: CBTGameRules) => resolveWeaponAttack(weaponAttackProfile({ componentId: weaponId, equipment: atm, mode: undefined, damage: { values: [2], maximum: 12, unit: 'missile' }, ammo: null, types: [], name: 'ATM 6', targetNumber: 6, partialCover: false }, rules)!, [6, 6], [6, 6]).groups;

        expect(groups(TW_GAME_RULES)).toEqual([5, 5, 2]);
        expect(groups(CORE_2026_GAME_RULES)).toEqual([6, 6]);
    });

    it('rolls a machine gun array on its linked guns, one location per gun', () => {
        const array = new WeaponEquipment({
            id: 'ISMGA', name: 'Machine Gun Array', type: 'weapon', flags: ['F_MGA'], weapon: { damage: 2 },
        });
        const profile = weaponAttackProfile({ componentId: weaponId, equipment: array, mode: undefined, damage: { values: [2], maximum: 8, unit: 'shot' }, ammo: null, types: [], name: 'MGA', targetNumber: 6, partialCover: false }, TW_GAME_RULES)!;
        // Roll 7 on the 4 column: 3 guns hit.
        expect(resolveWeaponAttack(profile, [4, 4], [3, 4])).toEqual({ hit: true, jammed: false, hits: 3, groups: [2, 2, 2] });
    });

    it('jams rapid-firing autocannons on low to-hit rolls, by ruleset', () => {
        const autocannon = (ammoType: 'AC_ROTARY' | 'AC_ULTRA', modes: string[]) => new WeaponEquipment({
            id: ammoType, name: ammoType, type: 'weapon', flags: ['F_AC', 'F_BALLISTIC', 'F_DIRECT_FIRE'],
            modes, weapon: { damage: 5, ammoType },
        });
        const profile = (ammoType: 'AC_ROTARY' | 'AC_ULTRA', modes: string[], mode: string, rules: CBTGameRules) =>
            weaponAttackProfile({ componentId: weaponId, equipment: autocannon(ammoType, modes), mode,
                damage: { values: [5], maximum: 30, unit: 'shot' }, ammo: null, types: ['DB'], name: ammoType,
                targetNumber: 8, partialCover: false }, rules)!;
        const rotary = profile('AC_ROTARY', ['1', '2', '3', '4', '5', '6'], '6', CORE_2026_GAME_RULES);

        // Six shots jam on 4 or less, and the shots still fire.
        expect(rotary.jamRoll).toBe(4);
        expect(resolveWeaponAttack(rotary, [2, 2], [4, 4]).jammed).toBeTrue();
        expect(resolveWeaponAttack(rotary, [2, 3], [4, 4]).jammed).toBeFalse();
        // Ultra ACs jam on a 2 under Total Warfare only.
        expect(profile('AC_ULTRA', ['Single', 'Ultra'], 'Ultra', TW_GAME_RULES).jamRoll).toBe(2);
        expect(profile('AC_ULTRA', ['Single', 'Ultra'], 'Ultra', CORE_2026_GAME_RULES).jamRoll).toBeNull();
        expect(profile('AC_ULTRA', ['Single', 'Ultra'], 'Single', TW_GAME_RULES).jamRoll).toBeNull();
    });

    it('has no attack to resolve for weapons without damage', () => {
        const tag = new WeaponEquipment({ id: 'ISTAG', name: 'TAG', type: 'weapon', flags: ['F_TAG'], weapon: {} });
        expect(weaponAttackProfile({ componentId: weaponId, equipment: tag, mode: undefined, damage: { values: [0], maximum: 0 }, ammo: null, types: [], name: 'TAG', targetNumber: 7, partialCover: false }, TW_GAME_RULES)).toBeNull();
    });
});
