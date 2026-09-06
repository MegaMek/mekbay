// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestInfantryEntity } from '../entity/testing/test-entities';
import type { EquipmentFlag } from '../equipment-flags.type';
import { WeaponEquipment,type InfantryWeaponEquipment } from '../equipment.model';
import { projectConventionalInfantryCombat } from './conventional-infantry-combat-rules';

describe('conventional infantry combat reference', () => {
    it('uses the capped primary and uncapped secondary, with printed CBT damage rounding', () => {
        const entity = infantry(8, 3);
        entity.primaryWeapon.set(weapon(0.8, 1));
        entity.secondaryWeapon.set(weapon(1.1, 3));
        entity.secondaryCount.set(2);
        const profile = projectConventionalInfantryCombat(entity);
        expect(profile.maximumStrength).toBe(24);
        expect(profile.damagePerTrooper).toBeCloseTo(0.725, 8);
        expect(profile.damageByStrength[3]).toBe(2);
        expect(profile.damageByStrength[24]).toBe(17);
    });

    it('uses the entity troop limit for recognizable oversized imported definitions', () => {
        const entity = infantry(10, 4);
        entity.primaryWeapon.set(weapon(0.2, 1));
        const profile = projectConventionalInfantryCombat(entity);
        expect(entity.validationResult().valid).toBeFalse();
        expect(profile.maximumStrength).toBe(30);
        expect(profile.damageByStrength.length).toBe(31);
        expect(profile.damageByStrength[30]).toBe(6);
    });

    it('retains zero range and projects category 4 through 7 intermediate modifiers', () => {
        const entity = infantry(7, 4);
        entity.primaryWeapon.set(weapon(0.2, 0));
        expect(projectConventionalInfantryCombat(entity).rangeModifiers.slice(0, 4)).toEqual([0, null, null, null]);
        entity.primaryWeapon.set(weapon(0.2, 4));
        expect(projectConventionalInfantryCombat(entity).rangeModifiers.slice(4, 14))
            .toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, null]);
        entity.primaryWeapon.set(weapon(0.2, 7));
        expect(projectConventionalInfantryCombat(entity).rangeModifiers[18]).toBe(6);
    });

    it('uses the secondary range only for multiple non-TAG secondaries and retains point-blank penalties', () => {
        const entity = infantry(7, 4);
        entity.primaryWeapon.set(weapon(0.2, 1));
        entity.secondaryWeapon.set(weapon(0.4, 3, ['F_INF_POINT_BLANK']));
        entity.secondaryCount.set(1);
        expect(projectConventionalInfantryCombat(entity).rangeModifiers.slice(0, 5)).toEqual([-1, 0, 2, 4, null]);
        entity.secondaryCount.set(2);
        expect(projectConventionalInfantryCombat(entity).rangeModifiers[4]).toBe(2);
        entity.secondaryWeapon.set(weapon(0.4, 3, ['F_TAG']));
        expect(projectConventionalInfantryCombat(entity).rangeModifiers[4]).toBeNull();
    });

    it('projects underwater range zero without promoting it to one hex', () => {
        const entity = infantry(7, 4);
        entity.primaryWeapon.set(weapon(0.2, 1));
        entity.motiveType.set('UMU');
        expect(projectConventionalInfantryCombat(entity).underwaterRangeModifiers?.slice(0, 3)).toEqual([0, null, null]);
    });

    it('derives the damage-cap burst benefit from the primary weapon even when secondary weapons determine range', () => {
        const entity = infantry(7, 4);
        entity.primaryWeapon.set(weapon(0.2, 1));
        entity.secondaryWeapon.set(weapon(1.1, 3));
        entity.secondaryCount.set(2);
        expect(projectConventionalInfantryCombat(entity).rangeModifiers[0]).toBe(-2);
        entity.primaryWeapon.set(weapon(0.8, 1));
        expect(projectConventionalInfantryCombat(entity).rangeModifiers[0]).toBe(-3);
    });
});

function infantry(squadSize: number, squads: number): TestInfantryEntity {
    const entity = new TestInfantryEntity();
    entity.squadSize.set(squadSize);
    entity.squadCount.set(squads);
    return entity;
}

function weapon(damage: number, range: number, flags: readonly EquipmentFlag[] = []): InfantryWeaponEquipment {
    const value = new WeaponEquipment({ id: `infantry-${damage}-${range}`, name: 'Infantry weapon', type: 'weapon',
        flags: ['F_INFANTRY', ...flags], infantry: { damage, range } });
    if (!value.isInfantryWeapon()) throw new Error('Expected infantry weapon');
    return value;
}
