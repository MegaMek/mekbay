// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    comparativePilotingModifier,
    physicalAttackCheckModifier,
    physicalAttackPilotChecks,
    physicalHitTable,
    physicalSelfDamage,
} from './physical-attack-rules';
import { damageGroups, physicalAttackProfile, resolveWeaponAttack } from './weapon-attack-resolution';

describe('physical attack rules', () => {
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
        expect(physicalSelfDamage('charge', 50, 85)).toEqual({ damage: 9, table: 'standard' });
        expect(physicalSelfDamage('death-from-above', 55, 85)).toEqual({ damage: 11, table: 'kick' });
        expect(physicalSelfDamage('punch', 55, 85)).toBeNull();
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
