import { createEmptyUnit } from '../testing/unit-test-helpers';
import { getUnitVariantGroupKey, isSameVariantGroup, unitMatchesVariantGroup } from './unit-variant.util';

describe('unit variant group utilities', () => {
    it('keys variants by chassis, Alpha Strike type, and omni status', () => {
        const battleMek = createEmptyUnit({ chassis: 'Peacekeeper', omni: 0, as: { TP: 'BM' } });
        const industrialMek = createEmptyUnit({ chassis: 'Peacekeeper', omni: 0, as: { TP: 'IM' } });
        const omniBattleMek = createEmptyUnit({ chassis: 'Peacekeeper', omni: 1, as: { TP: 'BM' } });

        expect(getUnitVariantGroupKey(battleMek)).toBe('Peacekeeper|BM');
        expect(getUnitVariantGroupKey(industrialMek)).toBe('Peacekeeper|IM');
        expect(getUnitVariantGroupKey(omniBattleMek)).toBe('Peacekeeper|BM|O');
    });

    it('matches units against a variant group identity', () => {
        const group = { chassis: 'Nova', asType: 'BM', omni: true };

        expect(unitMatchesVariantGroup(createEmptyUnit({ chassis: 'Nova', omni: 1, as: { TP: 'BM' } }), group)).toBeTrue();
        expect(unitMatchesVariantGroup(createEmptyUnit({ chassis: 'Nova', omni: 0, as: { TP: 'BM' } }), group)).toBeFalse();
        expect(unitMatchesVariantGroup(createEmptyUnit({ chassis: 'Nova', omni: 1, as: { TP: 'IM' } }), group)).toBeFalse();
    });

    it('compares two units by variant chassis without creating lookup keys', () => {
        const source = createEmptyUnit({ chassis: 'Nova', omni: 1, as: { TP: 'BM' } });

        expect(isSameVariantGroup(source, createEmptyUnit({ chassis: 'Nova', omni: 1, as: { TP: 'BM' } }))).toBeTrue();
        expect(isSameVariantGroup(source, createEmptyUnit({ chassis: 'Nova', omni: 0, as: { TP: 'BM' } }))).toBeFalse();
        expect(isSameVariantGroup(source, createEmptyUnit({ chassis: 'Nova', omni: 1, as: { TP: 'IM' } }))).toBeFalse();
    });
});