// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    physicalAttackTroopersHit,
    physicalDamageGroupSize,
    physicalStrikesRandomSide,
    physicalTargetIssue,
    physicalTargetModifier,
    type PhysicalAttackKind,
    physicalAttackMeetsBuildingCover,
    physicalAttackMeetsWaterCover,
    comparativePilotingModifier,
    physicalAttackCheckModifier,
    physicalAttackPilotChecks,
    physicalHitTable,
    physicalSelfDamage,
    physicalStrike,
} from './physical-attack-rules';
import type { CBTRuleset } from '../cbt-ruleset.model';
import { damageGroups, physicalAttackProfile, resolveWeaponAttack } from './weapon-attack-resolution';
import { physicalAttackMeetsPartialCover, physicalAttackTargetNumber } from '../runtime/equipment-panel';

describe('physical attack rules', () => {
    for (const ruleset of ['core-2026', 'total-warfare'] as const) {
        it(`checks punch reach, posture and relative height under ${ruleset}`, () => {
            const punch = (distance: number, prone: boolean, targetLevelDifference: number) =>
                physicalTargetIssue('punch', undefined, { distance, unitType: 'mek-biped', tnCalculator: { prone, targetLevelDifference } }, ruleset);
            expect([punch(5, false, 0), punch(0, false, 0), punch(1, true, 0), punch(1, false, -1),
                punch(1, false, 1), punch(1, true, 1), punch(1, false, 2)])
                .toEqual(['out-of-range', 'out-of-range', 'invalid', 'invalid', null, null, 'out-of-range']);
            expect(physicalStrike('punch', 'punch', { mek: true, prone: false, levelDifference: 1 }, ruleset).table).toBe('kick');
            expect(physicalStrike('punch', 'punch', { mek: true, prone: true, levelDifference: 1 }, ruleset).table)
                .toBe(ruleset === 'core-2026' ? 'punch' : 'standard');
        });
        it(`checks the standing target's chassis and resolved table for water cover under ${ruleset}`, () => {
            const row = { ruleset, hitTable: 'punch' as const, kind: 'punch' as const,
                attackerWater: { partiallyUnderwater: false, submerged: false }, hitModifiers: [0] };
            const covered = { tnModifier: 1, partialCover: { modifier: 1, water: true } };
            expect(physicalAttackTargetNumber(row, 5, null, { ...covered, unitType: 'mek-biped' })).toBe(5);
            expect(physicalAttackTargetNumber(row, 5, null, { ...covered, unitType: 'mek-quad' })).toBe(6);
            expect(physicalAttackTargetNumber(row, 5, null,
                { ...covered, unitType: 'mek-biped', tnCalculator: { targetLevelDifference: 1 } })).toBe(6);
        });
    }

    it('checks building occupants independently of intervening cover under Total Warfare', () => {
        const target = { distance: 1, unitType: 'mek-quad' as const, tnCalculator: { buildingCover: 'building-1' as const } };
        expect(physicalTargetIssue('punch', undefined, target, 'total-warfare', 'punch', { insideBuilding: false })).toBe('invalid');
        expect(physicalTargetIssue('punch', undefined, target, 'total-warfare', 'punch', { insideBuilding: true })).toBeNull();
        expect(physicalTargetIssue('charge', undefined, target, 'total-warfare', 'standard', { insideBuilding: false })).toBeNull();
        const covered = { tnModifier: 1, partialCover: { modifier: 1, water: false } };
        expect(physicalAttackMeetsPartialCover({
            kind: 'punch', hitTable: 'punch', ruleset: 'core-2026',
            attackerWater: { submerged: false, partiallyUnderwater: false },
        }, { ...covered, unitType: 'mek-quad' })).toBeTrue();
    });

    it('requires overlap with a ground target or a flying VTOL at the elevation of the attack', () => {
        const vtol = (kind: PhysicalAttackKind, targetLevelDifference: number, largeTarget = false, jumpMp = 0) =>
            physicalTargetIssue(kind, undefined, { distance: 1, unitType: 'vtol-wige',
                tnCalculator: { isAirborne: true, vtol: true, largeTarget, targetLevelDifference } }, 'total-warfare', 'standard', { jumpMp });
        expect([vtol('kick', -1), vtol('kick', -1, true), vtol('punch', 0), vtol('punch', 1),
            vtol('kick', 2), vtol('club', 3), vtol('club', 4), vtol('death-from-above', 4, false, 3)])
            .toEqual(['out-of-range', null, 'out-of-range', null, 'out-of-range', null, 'out-of-range', 'out-of-range']);
        expect(physicalTargetIssue('punch', undefined, { unitType: 'vehicle', distance: 1 })).toBe('invalid');
        expect(physicalTargetIssue('punch', undefined, { unitType: 'vehicle', distance: 1,
            tnCalculator: { targetLevelDifference: 1 } })).toBeNull();
    });

    it('reaches only infantry in the hex with a thrash, and only a vehicle there with a prone punch', () => {
        expect(physicalTargetIssue('thrash', 'infantry-in-hex', { unitType: 'infantry', distance: 0 })).toBeNull();
        expect(physicalTargetIssue('thrash', 'infantry-in-hex', { unitType: 'battle-armor', distance: 0 })).toBeNull();
        expect(physicalTargetIssue('thrash', 'infantry-in-hex', { unitType: 'infantry', distance: 1 })).toBe('out-of-range');
        expect(physicalTargetIssue('thrash', 'infantry-in-hex', { unitType: 'mek-biped', distance: 0 })).toBe('invalid');
        // A thrash needs a clear or paved hex.
        expect(physicalTargetIssue('thrash', 'infantry-in-hex', { unitType: 'infantry', distance: 0,
            tnCalculator: { targetHexCover: 'light' } })).toBe('invalid');
        expect(physicalTargetIssue('thrash', 'infantry-in-hex', { unitType: 'infantry', distance: 0,
            tnCalculator: { targetHexCover: 'none' } })).toBeNull();
        expect(physicalTargetIssue('punch', 'vehicle-in-hex', { unitType: 'vehicle', distance: 0 })).toBeNull();
        expect(physicalTargetIssue('punch', 'vehicle-in-hex', { unitType: 'infantry', distance: 0 })).toBe('invalid');
        expect(physicalTargetIssue('kick', undefined, { unitType: 'mek-biped', distance: 1 })).toBeNull();
        // Infantry cannot be charged (TW p. 148).
        expect(physicalTargetIssue('charge', undefined, { unitType: 'infantry', distance: 1 })).toBe('invalid');
    });

    it('adds +3 to kicks and DFAs against infantry, and strikes a vehicle in the hex on a random side', () => {
        expect(['kick', 'mule-kick', 'death-from-above', 'punch'].map(kind =>
            physicalTargetModifier(kind as PhysicalAttackKind, 'battle-armor')?.modifier ?? 0)).toEqual([3, 3, 3, 0]);
        expect(physicalTargetModifier('kick', 'vehicle')).toBeNull();
        expect(physicalStrikesRandomSide('kick', { unitType: 'vehicle', distance: 0 })).toBeTrue();
        expect(physicalStrikesRandomSide('punch', { unitType: 'vehicle', distance: 0 })).toBeTrue();
        expect(physicalStrikesRandomSide('kick', { unitType: 'vehicle', distance: 1 })).toBeFalse();
    });

    it('eliminates damage / 10 conventional troopers, doubled when mechanized, and a thrash its damage', () => {
        expect([physicalAttackTroopersHit('kick', 14, false), physicalAttackTroopersHit('kick', 14, true)]).toEqual([2, 4]);
        expect(physicalAttackTroopersHit('thrash', 17, false)).toBe(17);
        // A thrash splits into 5-point groups against battle armor only (TW p. 151).
        expect([physicalDamageGroupSize('thrash', 17, 'battle-armor'), physicalDamageGroupSize('thrash', 17)]).toEqual([5, 17]);
        // A DFA's 15 points eliminate 15 / 10, rounded up, conventional troopers: one group, not three.
        expect(physicalDamageGroupSize('death-from-above', 15, 'infantry')).toBe(15);
        expect(physicalAttackTroopersHit('death-from-above', 15, false)).toBe(2);
        expect(physicalAttackPilotChecks('total-warfare', 'thrash', true).attacker).toEqual(['made-thrash']);
    });

    it('meets Depth 1 water cover under Core except for charges, punches, submerged attackers and kicks from the water', () => {
        const dry = { partiallyUnderwater: false, submerged: false };
        const wading = { partiallyUnderwater: true, submerged: false };
        const submerged = { partiallyUnderwater: false, submerged: true };
        const meets = (kind: 'punch' | 'kick' | 'club' | 'charge', table: 'punch' | 'kick' | 'standard', water: typeof dry) =>
            physicalAttackMeetsWaterCover('core-2026', kind, table, water);

        expect([meets('punch', 'punch', dry), meets('punch', 'punch', submerged)]).toEqual([false, false]);
        expect([meets('kick', 'kick', dry), meets('kick', 'kick', wading), meets('kick', 'kick', submerged)])
            .toEqual([true, false, false]);
        expect([meets('club', 'standard', wading), meets('club', 'standard', submerged)]).toEqual([true, false]);
        expect(meets('charge', 'standard', dry)).toBeFalse();
        // Total Warfare's Depth 1 water covers a standing 'Mech against every attack.
        expect(physicalAttackMeetsWaterCover('total-warfare', 'charge', 'standard', submerged)).toBeTrue();
        // A TW DFA's roll is not modified for terrain; Core's charge and punch table ignore a building's cover too.
        expect(physicalAttackMeetsWaterCover('total-warfare', 'death-from-above', 'punch', dry)).toBeFalse();
        expect([physicalAttackMeetsBuildingCover('core-2026', 'charge', 'standard'),
            physicalAttackMeetsBuildingCover('core-2026', 'club', 'standard'),
            physicalAttackMeetsBuildingCover('total-warfare', 'charge', 'standard')]).toEqual([false, true, true]);
        // The target's +1 water cover leaves the target number of an attack the water does not cover.
        const target = { tnModifier: 3, partialCover: { modifier: 1, water: true } };
        expect(physicalAttackTargetNumber({ hitModifiers: [-2], meetsWaterCover: false }, 5, null, target)).toBe(5);
        expect(physicalAttackTargetNumber({ hitModifiers: [-2], meetsWaterCover: true }, 5, null, target)).toBe(6);
        // The leg-hit rule follows the same cover: a building's cover counts against every physical attack.
        expect(physicalAttackMeetsPartialCover({ meetsWaterCover: false }, target)).toBeFalse();
        expect(physicalAttackMeetsPartialCover({ meetsWaterCover: true }, target)).toBeTrue();
        expect(physicalAttackMeetsPartialCover({ meetsWaterCover: false },
            { partialCover: { modifier: 1, water: false } })).toBeTrue();
        expect(physicalAttackMeetsPartialCover({ meetsBuildingCover: false },
            { partialCover: { modifier: 1, water: false } })).toBeFalse();
    });

    it('compares no Piloting for a DFA against infantry, linked or not, and adds +3', () => {
        const dfa = { hitModifiers: ['versus'] as const, kind: 'death-from-above' as const };
        const infantry = { tnModifier: 0, unitType: 'infantry' as const };
        expect(physicalAttackTargetNumber(dfa, 5, null, infantry)).toBe(8);
        expect(physicalAttackTargetNumber(dfa, 5, null, infantry, { piloting: 2, immobile: false })).toBe(8);
        // Against a 'Mech the skills compare, and an unknown skill leaves no number.
        const mek = { tnModifier: 0, unitType: 'mek-biped' as const };
        expect(physicalAttackTargetNumber(dfa, 5, null, mek, { piloting: 4, immobile: false })).toBe(6);
        expect(physicalAttackTargetNumber(dfa, 5, null, mek)).toBeNull();
    });

    it('strikes only a standing Mek on the punch and kick tables, and a DFA a prone Mek from the rear', () => {
        expect(physicalStrike('kick', 'kick', { mek: true, prone: false })).toEqual({ table: 'kick' });
        expect(physicalStrike('kick', 'kick', { mek: false, prone: false })).toEqual({ table: 'standard' });
        expect(physicalStrike('punch', 'punch', { mek: true, prone: true })).toEqual({ table: 'standard' });
        expect(physicalStrike('death-from-above', 'punch', { mek: true, prone: true }))
            .toEqual({ table: 'standard', arc: 'rear' });
        expect(physicalStrike('death-from-above', 'punch', { mek: false, prone: false }))
            .toEqual({ table: 'standard', arc: 'front' });
    });

    it('reads punches, claws and DFAs on the punch table, kicks on the kick table, the rest on the standard table', () => {
        expect(physicalHitTable('punch', false)).toBe('punch');
        expect(physicalHitTable('death-from-above', false)).toBe('punch');
        expect(physicalHitTable('weapon', true)).toBe('punch');
        expect(physicalHitTable('kick', false)).toBe('kick');
        expect(physicalHitTable('club', false)).toBe('standard');
        expect(physicalHitTable('charge', false)).toBe('standard');
    });

    it('strikes charges in 5-point groupings and other attacks as one', () => {
        const charge = physicalAttackProfile({ name: 'Charge', kind: 'charge', damage: 12, targetNumber: 5, table: 'standard', partialCover: false });
        expect(resolveWeaponAttack(charge, [3, 3], null).groups).toEqual([5, 5, 2]);
        const kick = physicalAttackProfile({ name: 'Kick', kind: 'kick', damage: 12, targetNumber: 5, table: 'kick', partialCover: false });
        expect(resolveWeaponAttack(kick, [3, 3], null).groups).toEqual([12]);
        const push = physicalAttackProfile({ name: 'Push', kind: 'push', damage: 0, targetNumber: 5, table: 'standard', partialCover: false });
        expect(resolveWeaponAttack(push, [3, 3], null)).toEqual(jasmine.objectContaining({ hit: true, groups: [] }));
        expect(damageGroups(0, 1)).toEqual([]);
    });

    it('compares pilots for charges and DFAs, taking 4 for an immobile target', () => {
        expect(comparativePilotingModifier(5, 4, false)).toBe(1);
        expect(comparativePilotingModifier(3, 5, false)).toBe(-2);
        expect(comparativePilotingModifier(5, 2, true)).toBe(1);
    });

    it('costs the attacker 1 per 10 target tons for a charge and 1 per 5 own tons on the kick table for a DFA', () => {
        const facts = { attackerTons: 55, targetTons: 85, attackDamage: 6, attackerSubmerged: false };
        expect(physicalSelfDamage('total-warfare', 'charge', true, { ...facts, attackerTons: 50 }))
            .toEqual({ damage: 9, table: 'standard', groupSize: 5 });
        // Charging underwater halves it, rounding down (Core p. 77; BMM p. 35): to 0 under Total Warfare, never below 1
        // under Core (p. 88).
        const submerged = (ruleset: CBTRuleset, targetTons: number) =>
            physicalSelfDamage(ruleset, 'charge', true, { ...facts, targetTons, attackerSubmerged: true })?.damage;
        expect([submerged('total-warfare', 85), submerged('total-warfare', 10), submerged('core-2026', 10)])
            .toEqual([4, 0, 1]);
        expect(physicalSelfDamage('total-warfare', 'death-from-above', true, facts)).toEqual({ damage: 11, table: 'kick', groupSize: 5 });
        expect(physicalSelfDamage('total-warfare', 'punch', true, facts)).toBeNull();
        expect(physicalSelfDamage('total-warfare', 'charge', false, facts)).toBeNull();
    });

    it("deals a missed brush off's punch to the 'Mech itself as one hit on the punch table (TW p. 222)", () => {
        const facts = { attackerTons: 55, targetTons: 1, attackDamage: 6, attackerSubmerged: false };
        expect(physicalSelfDamage('total-warfare', 'brush-off', false, facts)).toEqual({ damage: 6, table: 'punch', groupSize: 6 });
        expect(physicalSelfDamage('total-warfare', 'brush-off', true, facts)).toBeNull();
    });

    it('forces the Piloting Skill Rolls of each ruleset', () => {
        expect(physicalAttackPilotChecks('total-warfare', 'kick', true).target).toEqual(['kicked']);
        expect(physicalAttackPilotChecks('total-warfare', 'kick', false).attacker).toEqual(['missed-kick']);
        expect(physicalAttackPilotChecks('core-2026', 'club', true).target).toEqual(['clubbed']);
        expect(physicalAttackPilotChecks('total-warfare', 'club', true).target).toEqual([]);
        expect(physicalAttackPilotChecks('total-warfare', 'death-from-above', true).attacker).toEqual(['made-death-from-above']);
        expect(physicalAttackPilotChecks('core-2026', 'death-from-above', false))
            .toEqual(jasmine.objectContaining({ attacker: [], target: [], attackerFalls: true }));
        expect(physicalAttackPilotChecks('core-2026', 'charge', true).target).toEqual(['charged']);
        expect(physicalAttackPilotChecks('core-2026', 'charge', false)).toEqual(jasmine.objectContaining({ attacker: [], target: [] }));
    });

    it('sets the modifier of each roll by ruleset', () => {
        expect(physicalAttackCheckModifier('total-warfare', 'kicked')).toBe(0);
        expect(physicalAttackCheckModifier('core-2026', 'clubbed')).toBe(0);
        expect(physicalAttackCheckModifier('total-warfare', 'clubbed')).toBeNull();
        expect(physicalAttackCheckModifier('total-warfare', 'made-death-from-above')).toBe(4);
        expect(physicalAttackCheckModifier('core-2026', 'made-death-from-above')).toBe(2);
        expect(physicalAttackCheckModifier('core-2026', 'charged')).toBe(2);
    });
});
