import { APPROXIMATE_MARGIN, getEffectiveAdvancementYear, parseAdvancementYear } from './tech-advancement-date.util';

describe('tech advancement date util', () => {
    it('parses standard advancement years and era abbreviations', () => {
        expect(parseAdvancementYear('~3079')).toBe(3079);
        expect(parseAdvancementYear('ES')).toBe(1950);
        expect(parseAdvancementYear('PS')).toBe(2100);
        expect(parseAdvancementYear('-')).toBeNull();
    });

    it('applies approximate margins based on comparison purpose', () => {
        expect(APPROXIMATE_MARGIN).toBe(5);
        expect(getEffectiveAdvancementYear('~3079', 'availability')).toBe(3074);
        expect(getEffectiveAdvancementYear('~2790', 'extinct')).toBe(2795);
        expect(getEffectiveAdvancementYear('3079', 'availability')).toBe(3079);
    });
});