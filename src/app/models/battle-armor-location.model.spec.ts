import { getBattleArmorTrooperNumber, normalizeBattleArmorTrooperLocation } from './battle-armor-location.model';

describe('Battle Armor trooper locations', () => {
    it('parses supported trooper labels and normalizes them to a canonical location', () => {
        expect(getBattleArmorTrooperNumber('T3')).toBe(3);
        expect(getBattleArmorTrooperNumber(' trooper 3 ')).toBe(3);
        expect(normalizeBattleArmorTrooperLocation('Trooper 3')).toBe('T3');
    });

    it('preserves non-trooper labels', () => {
        expect(getBattleArmorTrooperNumber('Squad')).toBeNull();
        expect(getBattleArmorTrooperNumber('T0')).toBeNull();
        expect(normalizeBattleArmorTrooperLocation('Squad')).toBe('Squad');
    });
});