import { getMegaMekAvailabilityRarityForScore } from './availability.model';

describe('getMegaMekAvailabilityRarityForScore', () => {
    it('treats scores below 1 as unavailable', () => {
        expect(getMegaMekAvailabilityRarityForScore(0)).toBe('Not Available');
        expect(getMegaMekAvailabilityRarityForScore(0.99)).toBe('Not Available');
    });

    it('splits scores 1 through 10 into even 1.8-wide rarity buckets', () => {
        expect(getMegaMekAvailabilityRarityForScore(1)).toBe('Very Rare');
        expect(getMegaMekAvailabilityRarityForScore(2.8)).toBe('Very Rare');
        expect(getMegaMekAvailabilityRarityForScore(2.8001)).toBe('Rare');

        expect(getMegaMekAvailabilityRarityForScore(4.6)).toBe('Rare');
        expect(getMegaMekAvailabilityRarityForScore(4.6001)).toBe('Uncommon');

        expect(getMegaMekAvailabilityRarityForScore(6.4)).toBe('Uncommon');
        expect(getMegaMekAvailabilityRarityForScore(6.4001)).toBe('Common');

        expect(getMegaMekAvailabilityRarityForScore(8.2)).toBe('Common');
        expect(getMegaMekAvailabilityRarityForScore(8.2001)).toBe('Very Common');
        expect(getMegaMekAvailabilityRarityForScore(10)).toBe('Very Common');
    });
});