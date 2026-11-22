// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { battleArmorMissileColumns } from '../../utils/cluster-hit-table';
import { infantryCasualties, infantryHitClass } from './infantry-hit-damage';
import { asComponentId } from '../entity/entity-identifiers';
import { AmmoEquipment, WeaponEquipment } from '../equipment.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES, type CBTGameRules } from './game-rules';
import { locksOnTarget, resolveWeaponAttack, weaponAttackProfile } from './weapon-attack-resolution';

describe('weapon attack resolution', () => {
    it('uses the full LRM-20 cluster potential against conventional infantry even on a low cluster roll', () => {
        const lrm20 = new WeaponEquipment({ id: 'LRM20', name: 'LRM 20', type: 'weapon', flags: ['F_MISSILE'],
            weapon: { damage: 'cluster', ammoType: 'LRM', rackSize: 20 } });
        const profile = weaponAttackProfile({ ...salvo, equipment: lrm20, targetConventionalInfantry: true }, TW_GAME_RULES)!;
        expect(resolveWeaponAttack(profile, [4, 4], [1, 1]).hits).toBe(20);
        expect(resolveWeaponAttack(profile, [1, 1], [1, 1]).hits).toBe(0);
    });

    it('rolls the published 54-BA-missile salvo twice on column 27 (TW p. 218)', () => {
        const launcher = new WeaponEquipment({ id: 'BA9', name: 'BA missiles', type: 'weapon', flags: ['F_MISSILE'],
            weapon: { damage: 'cluster', ammoType: 'SRM', rackSize: 9 } });
        const profile = weaponAttackProfile({ ...salvo, equipment: launcher, firingSuits: 6, ammo: null,
            damage: { values: [2], maximum: 18, unit: 'missile' } }, TW_GAME_RULES)!;
        expect(profile.clusterColumns).toEqual([27, 27]);
        expect(resolveWeaponAttack(profile, [4, 4], [1, 1], 0, [], undefined, [[6, 6]]).hits).toBe(36);
        expect(battleArmorMissileColumns(71)).toEqual([24, 24, 23]);
        expect(battleArmorMissileColumns(61)).toEqual([40, 21]);
    });

    it('keeps each BA flamer hit separate for damage, heat-only locations and infantry burst dice', () => {
        const flamer = new WeaponEquipment({ id: 'BAFlamer', name: 'BA Flamer', type: 'weapon', flags: ['F_FLAMER'],
            weapon: { damage: 2 } });
        const profile = weaponAttackProfile({ ...salvo, equipment: flamer, firingSuits: 3, ammo: null,
            damage: { values: [2], maximum: 2 }, heatWeapon: { weapon: { kind: 'flamer', heat: null },
                mode: 'damage', ruleset: 'total-warfare', target: { tracksHeat: false, fireResistant: false } } }, TW_GAME_RULES)!;
        const hits = resolveWeaponAttack(profile, [4, 4], [6, 6]);
        expect(hits.groups).toEqual([2, 2, 2]);
        const die = jasmine.createSpy('d6').and.returnValue(2);
        expect(infantryCasualties(infantryHitClass(flamer, true), [], hits.groups, false, false, 1, die)).toBe(18);
        expect(die).toHaveBeenCalledTimes(9);
        const heatOnly = { ...profile, heatWeapon: { ...profile.heatWeapon!, mode: 'heat' as const,
            target: { tracksHeat: true, fireResistant: false } } };
        expect(resolveWeaponAttack(heatOnly, [4, 4], [6, 6])).toEqual(jasmine.objectContaining({ groups: [0, 0, 0], heat: 6 }));
    });

    it('rolls one BA squad attack for four lasers or eight SRM missiles', () => {
        const laser = new WeaponEquipment({ id: 'MediumLaser', name: 'Medium Laser', type: 'weapon', weapon: { damage: 5 } });
        const gun = weaponAttackProfile({ ...salvo, equipment: laser, ammo: null, firingSuits: 4,
            damage: { values: [5], maximum: 5 } }, TW_GAME_RULES)!;
        expect(resolveWeaponAttack(gun, [4, 4], [5, 6]).groups).toEqual([5, 5, 5, 5]);
        const srm = new WeaponEquipment({ id: 'BASRM2', name: 'SRM 2', type: 'weapon', flags: ['F_MISSILE', 'F_SRM'],
            weapon: { damage: 'cluster', ammoType: 'SRM', rackSize: 2 } });
        const ammo = new AmmoEquipment({ id: 'SRMAmmo', name: 'SRM ammo', type: 'ammo',
            ammo: { type: 'SRM', damagePerShot: 2, rackSize: 2 } });
        const missiles = weaponAttackProfile({ ...salvo, equipment: srm, ammo, firingSuits: 4,
            damage: { values: [2], maximum: 4, unit: 'missile' } }, TW_GAME_RULES)!;
        expect(resolveWeaponAttack(missiles, [4, 4], [5, 6]).groups).toEqual(Array(8).fill(2));
    });

    const weaponId = asComponentId('weapon');
    const lrm15 = new WeaponEquipment({
        id: 'ISLRM15', name: 'LRM 15', type: 'weapon', flags: ['F_MISSILE', 'F_LRM'],
        weapon: { damage: 'cluster', rackSize: 15, ammoType: 'LRM' },
    });
    const lrmAmmo = new AmmoEquipment({
        id: 'ISLRM15 Ammo', name: 'LRM 15 Ammo', type: 'ammo',
        ammo: { type: 'LRM', rackSize: 15, damagePerShot: 1 },
    });

    const salvo = { componentId: weaponId, equipment: lrm15, mode: undefined, ammo: lrmAmmo, types: [],
        name: 'Salvo', targetNumber: 7, partialCover: false, damage: { values: [1], maximum: 15, unit: 'missile' as const } };

    it('rolls a Silver Bullet Gauss rack of 15 and locates every pellet separately', () => {
        const equipment = new WeaponEquipment({ id: 'ISSBGauss', name: 'SB Gauss', type: 'weapon',
            weapon: { damage: 15, ammoType: 'SBGAUSS', rackSize: 15 } });
        const profile = weaponAttackProfile({ ...salvo, equipment, damage: { values: [15], maximum: 15 } }, TW_GAME_RULES)!;
        expect(resolveWeaponAttack(profile, [4, 4], [4, 3]).groups).toEqual(Array(9).fill(1));
    });

    it('locates a Narc homing pod without impact damage and distinguishes the two explosive pods', () => {
        for (const type of ['NARC', 'INARC'] as const) {
            const equipment = new WeaponEquipment({ id: type, name: type, type: 'weapon', flags: ['F_NARC'],
                weapon: { damage: 'cluster', ammoType: type, rackSize: 1 } });
            for (const explosive of [false, true]) {
                const ammo = new AmmoEquipment({ id: 'pod', name: 'Pod', type: 'ammo', ammo: { type,
                    rackSize: 1, munitionType: [explosive ? 'M_NARC_EX' : 'M_STANDARD'] } });
                const profile = weaponAttackProfile({ ...salvo, equipment, ammo }, TW_GAME_RULES)!;
                expect(!!profile.narcPod).toBe(!explosive);
                expect(resolveWeaponAttack(profile, [4, 4], null).groups).toEqual([explosive ? type === 'NARC' ? 4 : 6 : 0]);
                expect(resolveWeaponAttack(profile, [1, 2], null).groups).toEqual([]);
            }
        }
    });

    it('uses live direct guidance and actual HAG range in the salvo before the cluster roll', () => {
        const strikes = (facts: Partial<typeof salvo> & Partial<Parameters<typeof weaponAttackProfile>[0]>) =>
            resolveWeaponAttack(weaponAttackProfile({ ...salvo, ...facts }, TW_GAME_RULES)!, [4, 4], [3, 4]).hits;
        expect([strikes({ artemis: 'iv' }), strikes({ narcGuided: true }), strikes({ artemis: 'iv', indirect: true }),
            strikes({ artemis: 'v', hostileEcm: true })]).toEqual([12, 12, 9, 9]);
        expect(weaponAttackProfile({ ...salvo, artemis: 'v' }, TW_GAME_RULES)?.clusterModifier).toBe(3);
        const equipment = new WeaponEquipment({ id: 'CLHAG20', name: 'HAG/20', type: 'weapon', flags: ['F_HAG'],
            weapon: { damage: 'cluster', ammoType: 'HAG', rackSize: 20 } });
        const hits = (range: 'short' | 'long') => resolveWeaponAttack(weaponAttackProfile({ ...salvo, equipment,
            damage: { values: [20], maximum: 20 }, range }, TW_GAME_RULES)!, [4, 4], [2, 2]).hits;
        expect([hits('short'), hits('long')]).toEqual([12, 6]);
    });

    it('absorbs phase-start CF separately for each TW hit group', () => {
        const hits = (rules: CBTGameRules) => resolveWeaponAttack(weaponAttackProfile({ ...salvo, buildingCf: 38 },
            rules)!, [4, 4], [4, 3]).groups;
        expect(hits(TW_GAME_RULES)).toEqual([1, 0]);
        expect(hits(CORE_2026_GAME_RULES)).toEqual([5, 4]);
    });

    it('requires a Streak lock under Angel ECM but rolls the ordinary number of missiles only after the lock', () => {
        const equipment = new WeaponEquipment({ id: 'streak', name: 'Streak SRM 6', type: 'weapon',
            flags: ['F_MISSILE', 'F_SRM'], weapon: { damage: 'cluster', rackSize: 6, ammoType: 'SRM_STREAK' } });
        for (const rules of [TW_GAME_RULES, CORE_2026_GAME_RULES]) {
            const facts = { ...salvo, equipment, hostileEcm: true };
            const normal = weaponAttackProfile(facts, rules)!;
            const angel = weaponAttackProfile({ ...facts, angelEcm: true }, rules)!;
            expect(resolveWeaponAttack(normal, [4, 4], null).hits).toBe(6);
            expect(resolveWeaponAttack(angel, [4, 4], [1, 1]).hits).toBe(2);
            expect(angel.lockRequired).toBeTrue();
            expect(resolveWeaponAttack(angel, [1, 1], null).hits).toBe(0);
        }
    });

    it('engages AMS separately from ordinary penalties, with Core interception and the TW floor', () => {
        for (const rules of [CORE_2026_GAME_RULES, TW_GAME_RULES]) {
            const profile = weaponAttackProfile(salvo, rules)!;
            expect(resolveWeaponAttack(profile, [4, 4], [2, 2], -4).hits).toBe(5);
            expect(resolveWeaponAttack(profile, [4, 4], [2, 2], 0, [], 2).hits)
                .toBe(rules.id === 'core-2026' ? 0 : 5);
            const streak = { ...profile, projectiles: 6, streak: true as const, allHit: true };
            expect(resolveWeaponAttack(streak, [4, 4], null, 0, [], 6).hits).toBe(4);
            const single = { ...profile, projectiles: 1 };
            expect(resolveWeaponAttack(single, [4, 4], null, 0, [], 2).hits).toBe(rules.id === 'core-2026' ? 1 : 0);
            expect(resolveWeaponAttack(single, [4, 4], null, 0, [], 5).hits).toBe(rules.id === 'core-2026' ? 0 : 1);
        }
    });

    it('keeps each operating plasma rifle’s heat dice and resolves one combined bay hit', () => {
        const heat = { weapon: { kind: 'plasma-rifle', heat: '1d6', otherDamageDice: 2 }, mode: 'both',
            target: { tracksHeat: true, fireResistant: false }, ruleset: 'total-warfare' } as const;
        const profile = weaponAttackProfile({ ...salvo, aerospace: { attackValue: 20, grouping: 'single',
            scale: 1, heatWeapons: [{ heat, value: 10 }, { heat, value: 10 }] } }, TW_GAME_RULES)!;
        const hit = resolveWeaponAttack(profile, [4, 4], null, 0, [3, 5]);
        expect([hit.groups, hit.heat]).toEqual([[20], 8]);
    });

    it('uses air-to-air and combined bay AV with the class-specific hit locations', () => {
        const fire = (attackValue: number, grouping: 'single' | 'cluster' | 'ultra') => resolveWeaponAttack(
            weaponAttackProfile({ ...salvo, aerospace: { attackValue, grouping, scale: 1, heatWeapons: [] } },
                TW_GAME_RULES)!, [4, 4], null).groups;
        expect(fire(9, 'cluster')).toEqual([5, 4]);
        expect(fire(24, 'single')).toEqual([24]);
        expect(fire(20, 'ultra')).toEqual([10, 10]);
    });

    it('burns out a charged Total Warfare PPC on a natural 2 even when 2 would hit', () => {
        const ppc = new WeaponEquipment({
            id: 'ISPPC', name: 'PPC', type: 'weapon', flags: ['F_PPC', 'F_ENERGY'],
            weapon: { damage: 10 },
        });
        const attack = (rules: CBTGameRules, chargedPpc: boolean, targetNumber: number) => weaponAttackProfile({
            componentId: weaponId, equipment: ppc, mode: undefined, ammo: null, types: ['DE'], name: 'PPC',
            damage: { values: [chargedPpc ? 15 : 10], maximum: chargedPpc ? 15 : 10 },
            partialCover: false, targetNumber, chargedPpc,
        }, rules)!;
        for (const targetNumber of [2, 7]) {
            expect(resolveWeaponAttack(attack(TW_GAME_RULES, true, targetNumber), [1, 1], null))
                .toEqual({ capacitorBurnout: true, hit: false, hits: 0, groups: [], heat: 0, jammed: false });
        }
        expect(resolveWeaponAttack(attack(TW_GAME_RULES, true, 2), [1, 2], null).groups).toEqual([15]);
        expect(resolveWeaponAttack(attack(TW_GAME_RULES, false, 2), [1, 1], null).groups).toEqual([10]);
        expect(resolveWeaponAttack(attack(CORE_2026_GAME_RULES, true, 2), [1, 1], null).groups).toEqual([15]);
    });

    it('marks a rifle, whose hits lose their 3 points only where they strike (`rifleHitDamage`)', () => {
        const rifle = weaponAttackProfile({
            componentId: weaponId,
            equipment: new WeaponEquipment({
                id: 'Rifle (Cannon, Heavy)', name: 'Heavy Rifle', type: 'weapon', flags: ['F_BALLISTIC', 'F_DIRECT_FIRE'],
                weapon: { damage: 9, ammoType: 'RIFLE' },
            }),
            mode: undefined, damage: { values: [9], maximum: 9 }, ammo: null, types: ['DB'], name: 'Heavy Rifle',
            targetNumber: 6, partialCover: false,
        }, TW_GAME_RULES)!;
        expect([rifle.damagePerHit, rifle.rifle]).toEqual([9, true]);
    });

    it('carries the size of an autocannon firing armor-piercing rounds for its armor-piercing check', () => {
        const autocannon = new WeaponEquipment({
            id: 'ISAC5', name: 'AC/5', type: 'weapon', flags: ['F_AC', 'F_BALLISTIC', 'F_DIRECT_FIRE'],
            weapon: { damage: 5, rackSize: 5, ammoType: 'AC' },
        });
        const armorPiercing = new AmmoEquipment({
            id: 'ISArmorPiercingAC5 Ammo', name: 'AC/5 Armor-Piercing Ammo', type: 'ammo',
            ammo: { type: 'AC', rackSize: 5, shots: 10, damagePerShot: 5, munitionType: ['M_ARMOR_PIERCING'] },
        });
        const profile = (ammo: AmmoEquipment | null) => weaponAttackProfile({
            componentId: weaponId, equipment: autocannon, mode: undefined, damage: { values: [5], maximum: 5 }, ammo,
            types: ['DB'], name: 'AC/5', targetNumber: 6, partialCover: false,
        }, CORE_2026_GAME_RULES)!;
        expect([profile(armorPiercing).ammo, profile(armorPiercing).rackSize]).toEqual(['armor-piercing', 5]);
        expect([profile(null).ammo, profile(null).rackSize]).toEqual([undefined, undefined]);
    });

    it('reports a tandem-charge SRM as one two-point hit per warhead', () => {
        const launcher = new WeaponEquipment({ id: 'ISSRM2', name: 'SRM 2', type: 'weapon', flags: ['F_SRM', 'F_MISSILE'],
            weapon: { damage: 'cluster', rackSize: 2, ammoType: 'SRM' } });
        const ammo = new AmmoEquipment({ id: 'TC', name: 'TC SRM ammo', type: 'ammo',
            ammo: { type: 'SRM', rackSize: 2, damagePerShot: 2, munitionType: ['M_TANDEM_CHARGE'] } });
        const profile = weaponAttackProfile({ componentId: weaponId, equipment: launcher, mode: undefined,
            damage: { values: [2], maximum: 4, unit: 'missile' }, ammo, types: ['M'], name: 'SRM 2',
            targetNumber: 6, partialCover: false }, TW_GAME_RULES)!;
        expect(profile.ammo).toBe('tandem-charge');
        expect(profile.rackSize).toBeUndefined();
        expect(resolveWeaponAttack(profile, [6, 6], [6, 6]).groups).toEqual([2, 2]);
    });

    it('applies the AX penalty to an SRM cluster roll even under hostile ECM (Core p. 192, TO:AUE p. 179)', () => {
        const srm = new WeaponEquipment({
            id: 'ISSRM6', name: 'SRM 6', type: 'weapon', flags: ['F_MISSILE', 'F_SRM'],
            weapon: { damage: 'cluster', rackSize: 6, ammoType: 'SRM' },
        });
        const acid = new AmmoEquipment({
            id: 'AX SRM 6 Ammo', name: 'AX SRM 6 Ammo', type: 'ammo',
            ammo: { type: 'SRM', rackSize: 6, damagePerShot: 2, munitionType: ['M_AX_HEAD'] },
        });
        const facts = { componentId: weaponId, equipment: srm, mode: undefined,
            damage: { values: [2], maximum: 12, unit: 'missile' as const }, ammo: acid, types: [],
            name: 'SRM 6', targetNumber: 6, partialCover: false };
        for (const hostileEcm of [false, true]) {
            const hits = (rules: CBTGameRules) => {
                const profile = weaponAttackProfile({ ...facts, hostileEcm }, rules)!;
                return [resolveWeaponAttack(profile, [4, 4], [3, 3]).hits, resolveWeaponAttack(profile, [4, 4], [4, 3]).hits];
            };
            // On the 6 column, unmodified rolls of 6 and 7 would both hit with four missiles.
            expect(hits(CORE_2026_GAME_RULES)).toEqual([3, 4]);
            expect(hits(TW_GAME_RULES)).toEqual([3, 3]);
        }
    });

    it('rolls missiles on the Cluster Hits Table and groups them in five-point clusters', () => {
        const profile = weaponAttackProfile({ componentId: weaponId, equipment: lrm15, mode: undefined, damage: { values: [1], maximum: 15, unit: 'missile' }, ammo: lrmAmmo, types: [], name: 'LRM 15', targetNumber: 8, partialCover: false }, TW_GAME_RULES)!;

        expect(resolveWeaponAttack(profile, [3, 4], [6, 6])).toEqual({ hit: false, jammed: false, hits: 0, groups: [], heat: 0 });
        // Roll 8 on the 15 column: 9 missiles → 5 + 4.
        expect(resolveWeaponAttack(profile, [4, 4], [4, 4])).toEqual({ hit: true, jammed: false, hits: 9, groups: [5, 4], heat: 0 });
        // Artemis-style modifiers are clamped to the table.
        expect(resolveWeaponAttack(profile, [6, 6], [6, 6], 2).hits).toBe(15);
    });

    it('hits with every Streak missile, one location per two-point missile', () => {
        const streak = new WeaponEquipment({
            id: 'ISStreakSRM4', name: 'Streak SRM 4', type: 'weapon', flags: ['F_MISSILE', 'F_SRM'],
            weapon: { damage: 'cluster', rackSize: 4, ammoType: 'SRM_STREAK' },
        });
        const profile = weaponAttackProfile({ componentId: weaponId, equipment: streak, mode: undefined, damage: { values: [2], maximum: 8, unit: 'missile' }, ammo: null, types: [], name: 'Streak SRM 4', targetNumber: 7, partialCover: false }, TW_GAME_RULES)!;

        expect(resolveWeaponAttack(profile, [5, 2], null)).toEqual({ hit: true, jammed: false, hits: 4, groups: [2, 2, 2, 2], heat: 0 });
    });

    it('locks a direct iATM on but not the Fusillade that fires its munitions (IO:AE pp. 59-60)', () => {
        const iatm = new WeaponEquipment({
            id: 'CLiATM3', name: 'iATM 3', type: 'weapon', flags: ['F_MISSILE', 'F_MEK_WEAPON'],
            weapon: { damage: 'cluster', rackSize: 3, ammoType: 'IATM' },
        });
        const fusillade = new WeaponEquipment({
            id: 'Fusillade', name: 'Fusillade Launcher', type: 'weapon',
            flags: ['F_MISSILE', 'F_ONE_SHOT', 'F_DOUBLE_ONE_SHOT', 'F_PROTO_WEAPON'],
            weapon: { damage: 'cluster', rackSize: 3, ammoType: 'IATM' },
        });
        expect(locksOnTarget(iatm)).toBeTrue();
        expect(locksOnTarget(fusillade)).toBeFalse();

        const profile = weaponAttackProfile({ componentId: weaponId, equipment: fusillade, mode: undefined, damage: { values: [2], maximum: 6, unit: 'missile' }, ammo: null, types: [], name: 'Fusillade Launcher', targetNumber: 7, partialCover: false }, TW_GAME_RULES)!;
        expect(profile.allHit).toBeFalse();
        // The integral Artemis adds 2 to the Cluster Hits Table roll (IO:AE p. 59): a natural 8 on the 3 column hits
        // with 3 missiles, and with 2 once hostile ECM takes the modifier away.
        expect(profile.clusterModifier).toBe(2);
        expect(resolveWeaponAttack(profile, [4, 3], [4, 4]).hits).toBe(3);
        expect(resolveWeaponAttack(profile, [4, 3], [4, 4], 0).hits).toBe(2);
        // A jammed attacker starts without it: "unless hostile ECM interferes" (IO:AE p. 59; TW p. 134).
        expect(weaponAttackProfile({ componentId: weaponId, equipment: fusillade, mode: undefined, damage: { values: [2], maximum: 6, unit: 'missile' }, ammo: null, types: [], name: 'Fusillade Launcher', targetNumber: 7, partialCover: false, hostileEcm: true }, TW_GAME_RULES)!
            .clusterModifier).toBeUndefined();
        // The iATM it derives from rolls no cluster when it fires directly, and Artemis doesn't help it indirectly.
        expect(weaponAttackProfile({ componentId: weaponId, equipment: iatm, mode: undefined, damage: { values: [2], maximum: 6, unit: 'missile' }, ammo: null, types: [], name: 'iATM 3', targetNumber: 7, partialCover: false }, TW_GAME_RULES)!
            .clusterModifier).toBeUndefined();
    });

    it('adds an ATM\'s integral Artemis to its cluster roll unless hostile ECM interferes (TW p. 138)', () => {
        const atm = new WeaponEquipment({
            id: 'CLATM3', name: 'ATM 3', type: 'weapon', flags: ['F_MISSILE', 'F_MEK_WEAPON'],
            weapon: { damage: 'cluster', rackSize: 3, ammoType: 'ATM' },
        });
        const facts = { componentId: weaponId, equipment: atm, mode: undefined, damage: { values: [2], maximum: 6, unit: 'missile' as const }, ammo: null, types: [], name: 'ATM 3', targetNumber: 7, partialCover: false };
        // A natural 8 on the 3 column hits with 3 missiles, and with 2 under hostile ECM.
        expect(resolveWeaponAttack(weaponAttackProfile(facts, TW_GAME_RULES)!, [4, 3], [4, 4]).hits).toBe(3);
        expect(resolveWeaponAttack(weaponAttackProfile({ ...facts, hostileEcm: true }, TW_GAME_RULES)!, [4, 3], [4, 4]).hits).toBe(2);
    });

    it('rolls an iATM fired indirectly on the Cluster Hits Table, with no lock to miss (IO:AE p. 60)', () => {
        const iatm = new WeaponEquipment({
            id: 'CLiATM3', name: 'iATM 3', type: 'weapon', flags: ['F_MISSILE', 'F_MEK_WEAPON', 'F_INDIRECT_FIRE'],
            weapon: { damage: 'cluster', rackSize: 3, ammoType: 'IATM' },
        });
        const indirect = weaponAttackProfile({ componentId: weaponId, equipment: iatm, mode: undefined, damage: { values: [2], maximum: 6, unit: 'missile' }, ammo: null, types: [], name: 'iATM 3', targetNumber: 7, partialCover: false, indirect: true }, TW_GAME_RULES)!;
        // Not locked on, so a miss spends its ammo and heat, and a hit reads the 3 column: a 7 hits with 2 missiles.
        expect(indirect.allHit).toBeFalse();
        expect(resolveWeaponAttack(indirect, [4, 3], [4, 3]).hits).toBe(2);
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
            [3, 3], null)).toEqual({ hit: true, jammed: false, hits: 1, groups: [8], heat: 0 });
        const ultra = weaponAttackProfile({ componentId: weaponId, equipment: uac, mode: 'Ultra', damage: { values: [5], maximum: 10, unit: 'shot' }, ammo: null, types: [], name: 'UAC', targetNumber: 6, partialCover: false }, TW_GAME_RULES)!;
        // Roll 8 on the 2 column: both shots hit, each rolling its own location.
        expect(resolveWeaponAttack(ultra, [4, 4], [4, 4])).toEqual({ hit: true, jammed: false, hits: 2, groups: [5, 5], heat: 0 });
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
        expect(resolveWeaponAttack(profile, [4, 4], [3, 4])).toEqual({ hit: true, jammed: false, hits: 3, groups: [2, 2, 2], heat: 0 });
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
