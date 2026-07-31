import {
    CAPITAL_AEROSPACE_RANGE_LIMITS,
    STANDARD_AEROSPACE_RANGE_LIMITS,
    aerospaceMaximumDistance,
    aerospaceAttackValues,
    aerospaceRangeBracket,
    aerospaceRangeCaptions,
    aerospaceRangeLimits,
    isRangeBracketWithinMaximum,
    effectiveAerospaceMaximumBracket,
} from './aerospace-range.util';
import { ATM_EXTENDED_RANGE_PROFILE, ATM_HIGH_EXPLOSIVE_PROFILE, MML_SRM_PROFILE } from '../models/ammo-weapon-profile.model';

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
        expect(aerospaceMaximumDistance({ capital: true }, 'extreme')).toBe(50);
        expect(aerospaceMaximumDistance({ capital: false }, 'long')).toBe(20);
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
        expect(aerospaceAttackValues(weapon, MML_SRM_PROFILE)).toEqual([12, 0, 0, 0]);
    });
});
