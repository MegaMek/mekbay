// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { ForceMember } from '../models/force-member.model';
import { formatBvPv, formatForceMembersBvPv } from './force-viewer-bv-pv-display.util';

describe('force viewer BV/PV display', () => {
    it('formats the adjusted value after skills', () => {
        expect(formatBvPv(1_250, 1_000, 'adjustedPostSkill')).toBe('1,250');
    });

    it('formats the adjusted value before skills', () => {
        expect(formatBvPv(1_250, 1_000, 'adjustedPreSkill')).toBe('1,000');
    });

    it('formats both adjusted values with the post-skill value first', () => {
        expect(formatBvPv(1_250, 1_000, 'both')).toBe('1,250 (1,000)');
    });

    it('suppresses the duplicate pre-skill value when both values are equal', () => {
        expect(formatBvPv(1_000, 1_000, 'both')).toBe('1,000');
    });

    it('never compresses BV/PV values', () => {
        expect(formatBvPv(12_600, 10_400, 'both')).toBe('12,600 (10,400)');
    });

    it('formats zero totals', () => {
        expect(formatBvPv(0, 0, 'both')).toBe('0');
    });

    it('shows intermediate values with at most two decimal places', () => {
        expect(formatBvPv(2_501, 2_000.9, 'both')).toBe('2,501 (2,000.9)');
        expect(formatBvPv(2_501, 2_000.999, 'adjustedPreSkill')).toBe('2,001');
    });

    it('selects damaged or pristine CBT pre-skill and post-skill projections independently', () => {
        const member = {
            kind: 'cbt',
            adjustedBattleValue: () => 800,
            pristineAdjustedBattleValue: () => 1_000,
            currentBaseBattleValue: () => 700,
            pristineBattleValue: () => 900,
            adjustedPreSkillBattleValue: () => 751,
            pristineAdjustedPreSkillBattleValue: () => 951,
            entity: { battleValue: () => 900 },
        } as unknown as ForceMember;

        expect(formatForceMembersBvPv([member], 'adjustedPreSkill', 'damaged')).toBe('751');
        expect(formatForceMembersBvPv([member], 'adjustedPreSkill', 'pristine')).toBe('951');
        expect(formatForceMembersBvPv([member], 'both', 'damaged')).toBe('800 (751)');
        expect(formatForceMembersBvPv([member], 'both', 'pristine')).toBe('1,000 (951)');
        expect(formatForceMembersBvPv([member], 'adjustedPostSkill', 'damaged')).toBe('800');
        expect(formatForceMembersBvPv([member], 'adjustedPostSkill', 'pristine')).toBe('1,000');
    });

    it('sums rounded force-adjusted unit values and collapses matching totals', () => {
        const members = [
            { base: 1_800, forceAdjusted: 2_251 },
            { base: 1_400, forceAdjusted: 1_745 },
        ].map(({ base, forceAdjusted }) => ({
            kind: 'cbt',
            adjustedBattleValue: () => forceAdjusted,
            adjustedPreSkillBattleValue: () => forceAdjusted,
            pristineAdjustedBattleValue: () => forceAdjusted,
            pristineAdjustedPreSkillBattleValue: () => forceAdjusted,
            currentBaseBattleValue: () => base,
            pristineBattleValue: () => base,
            entity: { battleValue: () => base },
        } as unknown as ForceMember));

        // The per-unit pre-skill values 2250.6 and 1744.6 round to a total of 3996, not 3995.
        for (const damageMode of ['damaged', 'pristine'] as const) {
            expect(formatForceMembersBvPv(members, 'adjustedPreSkill', damageMode)).toBe('3,996');
            expect(formatForceMembersBvPv(members, 'both', damageMode)).toBe('3,996');
        }
    });

    it('preserves Alpha Strike values under either damage policy', () => {
        const member = {
            getBv: () => 42,
            getPreSkillBv: () => 30,
        } as unknown as ForceMember;

        expect(formatForceMembersBvPv([member], 'both', 'damaged')).toBe('42 (30)');
        expect(formatForceMembersBvPv([member], 'both', 'pristine')).toBe('42 (30)');
    });
});
