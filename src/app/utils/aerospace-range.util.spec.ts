// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    CAPITAL_AEROSPACE_RANGE_LIMITS,
    STANDARD_AEROSPACE_RANGE_LIMITS,
    aerospaceAttackValues,
    aerospaceRangeBracket,
    aerospaceRangeCaptions,
    aerospaceRangeLimits,
    isRangeBracketWithinMaximum,
    effectiveAerospaceMaximumBracket,
} from './aerospace-range.util';
import {
    ATM_EXTENDED_RANGE_PROFILE, ATM_HIGH_EXPLOSIVE_PROFILE, ATM_IMPROVED_MAGNETIC_PULSE_PROFILE, MML_SRM_PROFILE,
} from '../models/ammo-weapon-profile.model';

describe('aerospace range utilities', () => {
    it('selects standard brackets at each boundary', () => {
        expect(aerospaceRangeBracket(6, STANDARD_AEROSPACE_RANGE_LIMITS)).toBe('short');
        expect(aerospaceRangeBracket(7, STANDARD_AEROSPACE_RANGE_LIMITS)).toBe('medium');
        expect(aerospaceRangeBracket(12, STANDARD_AEROSPACE_RANGE_LIMITS)).toBe('medium');
        expect(aerospaceRangeBracket(13, STANDARD_AEROSPACE_RANGE_LIMITS)).toBe('long');
        expect(aerospaceRangeBracket(20, STANDARD_AEROSPACE_RANGE_LIMITS)).toBe('long');
        expect(aerospaceRangeBracket(21, STANDARD_AEROSPACE_RANGE_LIMITS)).toBe('extreme');
        expect(aerospaceRangeBracket(25, STANDARD_AEROSPACE_RANGE_LIMITS)).toBe('extreme');
        expect(aerospaceRangeBracket(26, STANDARD_AEROSPACE_RANGE_LIMITS)).toBeNull();
    });

    it('formats contiguous captions for display', () => {
        expect(aerospaceRangeCaptions(STANDARD_AEROSPACE_RANGE_LIMITS)).toEqual([
            '(1–6)',
            '(7–12)',
            '(13–20)',
            '(21–25)'
        ]);
        expect(aerospaceRangeCaptions(CAPITAL_AEROSPACE_RANGE_LIMITS)).toEqual([
            '(1–12)',
            '(13–24)',
            '(25–40)',
            '(41–50)'
        ]);
    });

    it('selects capital limits only for capital weapons', () => {
        expect(aerospaceRangeLimits({ capital: false })).toBe(STANDARD_AEROSPACE_RANGE_LIMITS);
        expect(aerospaceRangeLimits({ capital: true })).toBe(CAPITAL_AEROSPACE_RANGE_LIMITS);
    });

    it('compares brackets using their rules order', () => {
        expect(isRangeBracketWithinMaximum('short', 'short')).toBeTrue();
        expect(isRangeBracketWithinMaximum('medium', 'long')).toBeTrue();
        expect(isRangeBracketWithinMaximum('extreme', 'long')).toBeFalse();
    });

    it('uses the ammo profile maximum bracket when present', () => {
        expect(effectiveAerospaceMaximumBracket({ maxRangeBracket: 'medium' }, ATM_EXTENDED_RANGE_PROFILE)).toBe('extreme');
        expect(effectiveAerospaceMaximumBracket({ maxRangeBracket: 'long' }, MML_SRM_PROFILE)).toBe('short');
        expect(effectiveAerospaceMaximumBracket({ maxRangeBracket: 'long' }, null)).toBe('long');
    });

    it('applies MegaMek ATM and MML attack-value adjustments', () => {
        const weapon = { weapon: { av: [5.1, 7.1, 8, 9] } } as never;

        expect(aerospaceAttackValues(weapon, null)).toEqual([6, 8, 8, 9]);
        expect(aerospaceAttackValues(weapon, ATM_EXTENDED_RANGE_PROFILE)).toEqual([4, 4, 4, 4]);
        expect(aerospaceAttackValues(weapon, ATM_HIGH_EXPLOSIVE_PROFILE)).toEqual([9, 0, 0, 0]);
        expect(aerospaceAttackValues(weapon, ATM_IMPROVED_MAGNETIC_PULSE_PROFILE)).toEqual([3, 0, 0, 0]);
        expect(aerospaceAttackValues(weapon, MML_SRM_PROFILE)).toEqual([12, 0, 0, 0]);
    });

    it('adds the Artemis values of TW p. 303, TO:AUE p. 95 and IO:AE p. 65', () => {
        const launcher = (ammoType: string, rackSize: number, av: readonly number[]) =>
            ({ ammoType, rackSize, weapon: { av } }) as never;
        const mml7 = launcher('MML', 7, [4, 4, 4, 0]);

        // Artemis IV: MML 7 4/6 and its SRM 8/12, LRM 15 9/12, SRM 4 4/6
        expect(aerospaceAttackValues(mml7, null, 'iv')).toEqual([6, 6, 6, 0]);
        expect(aerospaceAttackValues(mml7, MML_SRM_PROFILE, 'iv')).toEqual([12, 0, 0, 0]);
        expect(aerospaceAttackValues(launcher('LRM', 15, [9, 9, 9, 0]), null, 'iv')).toEqual([12, 12, 12, 0]);
        expect(aerospaceAttackValues(launcher('SRM', 4, [4, 0, 0, 0]), null, 'iv')).toEqual([6, 0, 0, 0]);
        // Artemis V reads a Cluster Hits roll of 10, which also lifts an MML 3; Artemis IV does not
        expect(aerospaceAttackValues(launcher('MML', 3, [2, 2, 2, 0]), null, 'iv')).toEqual([2, 2, 2, 0]);
        expect(aerospaceAttackValues(launcher('MML', 3, [2, 2, 2, 0]), null, 'v')).toEqual([3, 3, 3, 0]);
        // Prototype Artemis IV reads a roll of 8, which only adds a hit to a 2-missile rack
        expect(aerospaceAttackValues(launcher('SRM', 2, [2, 0, 0, 0]), null, 'prototype')).toEqual([4, 0, 0, 0]);
        expect(aerospaceAttackValues(launcher('LRM', 15, [9, 9, 9, 0]), null, 'prototype')).toEqual([9, 9, 9, 0]);
    });
});
