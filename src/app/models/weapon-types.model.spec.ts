import { normalizeWeaponType } from './weapon-types.model';

describe('normalizeWeaponType', () => {
    it('normalizes canonical values across casing and whitespace', () => {
        expect(normalizeWeaponType('  ai  ')).toBe('AI');
        expect(normalizeWeaponType('db')).toBe('DB');
    });

    it('normalizes the legacy AP alias to AI', () => {
        expect(normalizeWeaponType('AP')).toBe('AI');
        expect(normalizeWeaponType(' ap ')).toBe('AI');
    });

    it('preserves normalized unknown values for downstream validation', () => {
        expect(normalizeWeaponType(' unknown ')).toBe('UNKNOWN');
        expect(normalizeWeaponType('   ')).toBe('');
    });
});