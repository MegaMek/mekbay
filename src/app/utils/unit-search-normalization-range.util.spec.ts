import {
    isValidNormalizationSkillRange,
    isWithinNumericRange,
    updateNumericRangeBound,
} from './unit-search-normalization-range.util';

describe('unit search normalization ranges', () => {
    it('updates either bound while preserving ordering', () => {
        expect(updateNumericRangeBound({ min: 2, max: 6 }, 'min', 4)).toEqual({ min: 4, max: 6 });
        expect(updateNumericRangeBound({ min: 2, max: 6 }, 'max', 4)).toEqual({ min: 2, max: 4 });
        expect(updateNumericRangeBound({ min: 2, max: 6 }, 'min', 7)).toEqual({ min: 7, max: 7 });
        expect(updateNumericRangeBound({ min: 2, max: 6 }, 'max', 1)).toEqual({ min: 1, max: 1 });
    });

    it('validates inclusive Skill ranges from zero through eight', () => {
        expect(isValidNormalizationSkillRange({ min: 0, max: 8 })).toBeTrue();
        expect(isValidNormalizationSkillRange({ min: 4, max: 4 })).toBeTrue();
    });

    it('rejects malformed Skill ranges', () => {
        for (const range of [
            { min: -1, max: 8 },
            { min: 0, max: 9 },
            { min: 5, max: 4 },
            { min: 0.5, max: 4 },
            { min: 0, max: Number.NaN },
            { min: 0, max: Number.POSITIVE_INFINITY },
        ]) {
            expect(isValidNormalizationSkillRange(range)).withContext(JSON.stringify(range)).toBeFalse();
        }
    });

    it('checks inclusive numeric range membership', () => {
        expect(isWithinNumericRange(2, { min: 2, max: 4 })).toBeTrue();
        expect(isWithinNumericRange(4, { min: 2, max: 4 })).toBeTrue();
        expect(isWithinNumericRange(1, { min: 2, max: 4 })).toBeFalse();
        expect(isWithinNumericRange(5, { min: 2, max: 4 })).toBeFalse();
    });
});
