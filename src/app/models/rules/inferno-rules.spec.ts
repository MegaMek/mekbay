// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asComponentId, asLocationId } from '../entity/entity-identifiers';
import {
    TestAeroSpaceFighterEntity,
    TestBattleArmorEntity,
    TestBipedMekEntity,
    TestConvFighterEntity,
    TestDropShipEntity,
    TestInfantryEntity,
    TestProtoMekEntity,
    TestTankEntity,
} from '../entity/testing/test-entities';
import { AmmoEquipment, WeaponEquipment } from '../equipment.model';
import type { AttackHitLocation } from '../runtime/attack-hit-location';
import { gameRulesFor, TW_GAME_RULES, type CBTGameRules } from './game-rules';
import { infernoEffect, infernoMissilesStruck, isInfernoAmmo, type InfernoMissile } from './inferno-rules';
import { resolveWeaponAttack, weaponAttackProfile } from './weapon-attack-resolution';

describe('inferno rules', () => {
    const at = (code: string): InfernoMissile => ({
        location: Object.freeze({
            kind: 'non-mek', label: code, locationId: asLocationId(`location:${code}`), arc: 'front', effects: [],
        }) as AttackHitLocation,
    });
    const mekHit: InfernoMissile = { location: { kind: 'mek', label: 'CT', location: 'CT', rear: false, throughArmorCritical: false } };
    const cover: InfernoMissile = { location: { kind: 'miss', label: 'Cover' } };
    const unread: InfernoMissile = { location: null };

    it('heats a Mek 2 per missile, except missiles stopped by partial cover', () => {
        expect(infernoEffect(new TestBipedMekEntity(), [mekHit, mekHit, cover])).toEqual({ kind: 'heat', heat: 4 });
    });

    it('eliminates 3 conventional troopers per missile and 1 battle armor trooper per 3', () => {
        expect(infernoEffect(new TestInfantryEntity(), [unread, unread])).toEqual({ kind: 'troopers', troopers: 6 });
        expect(infernoEffect(new TestBattleArmorEntity(), Array(5).fill(unread)))
            .toEqual({ kind: 'battle-armor-troopers', troopers: 1 });
    });

    it('rolls a vehicle critical per missile and destroys a ProtoMek location per 3', () => {
        expect(infernoEffect(new TestTankEntity(), [at('Front'), at('Left')])).toEqual({
            kind: 'vehicle-criticals', locationIds: [asLocationId('location:Front'), asLocationId('location:Left')],
        });
        const near = { location: { kind: 'miss', label: 'Miss' } } as const;
        expect(infernoEffect(new TestProtoMekEntity(), [at('Torso'), at('Torso'), at('Legs'), at('Torso'), at('Torso'), near]))
            .toEqual({ kind: 'protomek-locations', locationIds: [asLocationId('location:Legs')] });
        // A set whose roll names a destroyed arm transfers its damage to the torso, but destroys nothing.
        const transferred: InfernoMissile = { location: { ...at('Torso').location!, transferred: true } as AttackHitLocation };
        expect(infernoEffect(new TestProtoMekEntity(), [at('Torso'), at('Torso'), transferred]))
            .toEqual({ kind: 'protomek-locations', locationIds: [] });
    });

    it('heats fighters and small craft, damages conventional fighters, and spares large craft', () => {
        expect(infernoEffect(new TestAeroSpaceFighterEntity(), [at('Nose')])).toEqual({ kind: 'heat', heat: 2 });
        expect(infernoEffect(new TestConvFighterEntity(), Array(7).fill(at('Nose'))))
            .toEqual({ kind: 'structural-integrity', damage: 2 });
        expect(infernoEffect(new TestDropShipEntity(), [at('Nose')])).toEqual({ kind: 'none' });
    });

    it('counts every three missiles over the turn, not per attack', () => {
        // Two earlier missiles plus two now complete one set of three.
        expect(infernoEffect(new TestBattleArmorEntity(), [unread, unread], 2))
            .toEqual({ kind: 'battle-armor-troopers', troopers: 1 });
        expect(infernoEffect(new TestBattleArmorEntity(), [unread], 3))
            .toEqual({ kind: 'battle-armor-troopers', troopers: 0 });
        expect(infernoEffect(new TestProtoMekEntity(), [at('Legs'), at('Torso')], 1))
            .toEqual({ kind: 'protomek-locations', locationIds: [asLocationId('location:Torso')] });
        // A Mek's missile on partial cover does not count; a ProtoMek's near miss does.
        expect(infernoMissilesStruck(new TestBipedMekEntity(), [mekHit, cover])).toBe(1);
        expect(infernoMissilesStruck(new TestProtoMekEntity(), [at('Torso'), { location: { kind: 'miss', label: 'Miss' } }]))
            .toBe(2);
    });

    it('resolves inferno SRMs as one missile per group instead of damage', () => {
        const srm6 = new WeaponEquipment({
            id: 'ISSRM6', name: 'SRM 6', type: 'weapon', flags: ['F_MISSILE', 'F_SRM'],
            weapon: { damage: 'cluster', rackSize: 6, ammoType: 'SRM' },
        });
        const inferno = new AmmoEquipment({
            id: 'ISSRM6 Inferno Ammo', name: 'SRM 6 Inferno Ammo', type: 'ammo',
            ammo: { type: 'SRM', rackSize: 6, damagePerShot: 2, munitionType: ['M_INFERNO'] },
        });
        const fire = (rules: CBTGameRules) => weaponAttackProfile({
            componentId: asComponentId('srm'), equipment: srm6, mode: undefined,
            damage: { values: [2], maximum: 12, unit: 'missile' }, ammo: inferno, types: [], name: 'SRM 6',
            targetNumber: 7, partialCover: true,
        }, rules)!;
        const profile = fire(TW_GAME_RULES);

        expect(profile.inferno).toBeTrue();
        // Roll 8 on the 6 column: 4 missiles, each its own group.
        expect(resolveWeaponAttack(profile, [4, 4], [4, 4])).toEqual({ hit: true, jammed: false, hits: 4, groups: [1, 1, 1, 1], heat: 0 });
        // Core missiles roll their locations too, so partial cover can stop them (Xotl, Core forum ruling, 19 Oct 2026)
        const core = fire(gameRulesFor('core-2026'));
        expect(core.partialCover).toBeTrue();
    });

    it('fires Improved Inferno iATM missiles as infernos that all hit when fired directly (IO:AE pp. 60-61)', () => {
        const iatm6 = new WeaponEquipment({
            id: 'CLiATM6', name: 'iATM 6', type: 'weapon', flags: ['F_MISSILE'],
            weapon: { damage: 'cluster', rackSize: 6, ammoType: 'IATM' },
        });
        const iiw = new AmmoEquipment({
            id: 'CLiATM6 IIW Ammo', name: 'iATM 6 IIW Ammo', type: 'ammo',
            ammo: { type: 'IATM', rackSize: 6, damagePerShot: 1, munitionType: ['M_IATM_IIW'] },
        });
        expect(isInfernoAmmo(iiw)).toBeTrue();
        const profile = weaponAttackProfile({
            componentId: asComponentId('iatm'), equipment: iatm6, mode: undefined,
            damage: { values: [2], maximum: 12, unit: 'missile' }, ammo: iiw, types: [], name: 'iATM 6',
            targetNumber: 7, partialCover: false,
        }, TW_GAME_RULES)!;
        // A Streak-like lock: every missile hits, with no Cluster Hits Table roll.
        expect(resolveWeaponAttack(profile, [4, 4], [3, 4])).toEqual({
            hit: true, jammed: false, hits: 6, groups: [1, 1, 1, 1, 1, 1], heat: 0,
        });
    });
});
