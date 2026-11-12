// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asComponentId } from '../entity/entity-identifiers';
import type { EquipmentFlag } from '../equipment-flags.type';
import { WeaponEquipment } from '../equipment.model';
import { TW_GAME_RULES } from './game-rules';
import {
    heatWeaponMode,
    heatWeaponOf,
    resolveHeatWeaponHit,
    type HeatWeapon,
    type HeatWeaponTarget,
} from './heat-weapon-rules';
import { attackHeatWeapon, resolveWeaponAttack, weaponAttackProfile } from './weapon-attack-resolution';

describe('heat-causing weapons', () => {
    const mek: HeatWeaponTarget = { tracksHeat: true, fireResistant: false };
    const tank: HeatWeaponTarget = { tracksHeat: false, fireResistant: false };
    const fireResistant: HeatWeaponTarget = { tracksHeat: false, fireResistant: true };
    const flamer: HeatWeapon = { kind: 'flamer', heat: null };
    const rifle: HeatWeapon = { kind: 'plasma-rifle', heat: '1d6', otherDamageDice: 2 };
    const cannon: HeatWeapon = { kind: 'plasma-cannon' };
    const dice = [4, 5, 6];
    const hit = (weapon: HeatWeapon, damage: number, mode: 'damage' | 'heat' | 'both', core: boolean, target: HeatWeaponTarget) => {
        const result = resolveHeatWeaponHit(weapon, damage, mode, core ? 'core-2026' : 'total-warfare', target, dice);
        return [result.damage, result.heat];
    };

    it('lets a Total Warfare flamer deliver heat or damage, and Core or Enhanced Flamers both', () => {
        expect(heatWeaponMode(flamer, 'total-warfare', false, false)).toBe('damage');
        expect(heatWeaponMode(flamer, 'total-warfare', false, true)).toBe('heat');
        expect(heatWeaponMode(flamer, 'total-warfare', true, false)).toBe('both');
        expect(heatWeaponMode(flamer, 'core-2026', false, false)).toBe('both');
        // A flame-based weapon that is no flamer, such as a man-portable plasma rifle, always declares.
        const plasmaRifle: HeatWeapon = { kind: 'heat-or-damage' };
        expect(heatWeaponMode(plasmaRifle, 'total-warfare', true, true)).toBe('heat');
        expect(heatWeaponMode(plasmaRifle, 'core-2026', false, false)).toBe('damage');
        // Its declared heat is standard damage to a unit that does not track heat, never damage and heat both.
        expect(hit(plasmaRifle, 2, 'heat', true, tank)).toEqual([2, 0]);
        expect(hit(plasmaRifle, 2, 'heat', true, mek)).toEqual([0, 2]);

        expect(hit(flamer, 2, 'damage', false, mek)).toEqual([2, 0]);
        expect(hit(flamer, 2, 'heat', false, mek)).toEqual([0, 2]);
        // Heat can only be declared against a unit that tracks it; anything else takes the damage.
        expect(hit(flamer, 2, 'heat', false, tank)).toEqual([2, 0]);
        expect(hit(flamer, 2, 'both', false, mek)).toEqual([2, 2]);
        // Core counts each heat point as 2 damage to a unit that does not track heat.
        expect(hit(flamer, 2, 'both', true, tank)).toEqual([6, 0]);
        expect(hit({ kind: 'flamer', heat: 1 }, 2, 'both', true, mek)).toEqual([2, 1]);
    });

    it('adds plasma heat to heat-tracking units and damage to the rest', () => {
        expect(hit(rifle, 10, 'both', false, mek)).toEqual([10, 4]);
        expect(hit(rifle, 10, 'both', false, tank)).toEqual([19, 0]);
        expect(hit(rifle, 10, 'both', true, tank)).toEqual([18, 0]);
        expect(hit({ kind: 'plasma-rifle', heat: '1d3', otherDamageDice: 1 }, 4, 'both', false, mek)).toEqual([4, 2]);
        expect(hit(cannon, 0, 'both', false, mek)).toEqual([0, 9]);
        expect(hit(cannon, 0, 'both', false, tank)).toEqual([15, 0]);
        expect(hit(cannon, 0, 'both', true, tank)).toEqual([18, 0]);
    });

    it('lets battle armor declare heat only with the plasma rifle, and infantry with any flame-based weapon', () => {
        const weapon = (id: string, flags: EquipmentFlag[]) => heatWeaponOf(new WeaponEquipment({
            id, name: id, type: 'weapon', flags, weapon: { damage: 1 },
        }));
        expect(weapon('ISBAPlasmaRifle', ['F_BA_WEAPON', 'F_PLASMA'])).toEqual({ kind: 'heat-or-damage' });
        expect(weapon('ISBAFireDrakeNeedler', ['F_BA_WEAPON', 'F_INCENDIARY_NEEDLES'])).toBeNull();
        expect(weapon('Needler, Support (Firedrake)', ['F_INFANTRY', 'F_INCENDIARY_NEEDLES']))
            .toEqual({ kind: 'heat-or-damage' });
        expect(weapon('InfantryGrenadeInferno', ['F_INFANTRY', 'F_INFERNO'])).toEqual({ kind: 'heat-or-damage' });
    });

    it('halves standard damage and ignores heat against fire-resistant armor', () => {
        expect(hit(rifle, 10, 'both', false, fireResistant)).toEqual([5, 0]);
        expect(hit(flamer, 3, 'both', true, fireResistant)).toEqual([2, 0]);
        expect(hit(cannon, 0, 'both', false, fireResistant)).toEqual([0, 0]);
    });

    it('reads only the dice each hit needs', () => {
        const read = (weapon: HeatWeapon, core: boolean, target: HeatWeaponTarget) =>
            resolveHeatWeaponHit(weapon, 10, 'both', core ? 'core-2026' : 'total-warfare', target, dice).dice;
        expect(read(rifle, false, mek)).toBe(1);
        expect(read(rifle, false, tank)).toBe(2);
        expect(read(cannon, false, tank)).toBe(3);
        expect(read(cannon, true, tank)).toBe(2);
        expect(read(cannon, false, fireResistant)).toBe(0);
        expect(read(flamer, true, mek)).toBe(0);
    });

    it('resolves a plasma rifle hit as 10 damage plus rolled heat, and against a tank in 5-point groups', () => {
        const plasma = new WeaponEquipment({
            id: 'ISPlasmaRifle', name: 'Plasma Rifle', type: 'weapon', flags: ['F_ENERGY', 'F_PLASMA'],
            weapon: { damage: 10 },
        });
        expect(heatWeaponOf(plasma)).toEqual(rifle);
        const profile = (target: HeatWeaponTarget) => weaponAttackProfile({
            componentId: asComponentId('plasma'), equipment: plasma, mode: undefined,
            damage: { values: [10], maximum: 10 }, ammo: null, types: [], name: 'Plasma Rifle', targetNumber: 7,
            partialCover: false, heatWeapon: attackHeatWeapon(plasma, undefined, 'total-warfare', false, target),
        }, TW_GAME_RULES)!;

        expect(resolveWeaponAttack(profile(mek), [4, 4], null, 0, dice)).toEqual(
            { hit: true, jammed: false, hits: 1, groups: [10], heat: 4 });
        expect(resolveWeaponAttack(profile(tank), [4, 4], null, 0, dice).groups).toEqual([5, 5, 5, 4]);
    });
});
