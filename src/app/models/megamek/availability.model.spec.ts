import { getMegaMekAvailabilityRarityForScore } from './availability.model';

describe('getMegaMekAvailabilityRarityForScore', () => {
    it('treats non-positive scores as unavailable', () => {
        expect(getMegaMekAvailabilityRarityForScore(-1)).toBe('Not Available');
        expect(getMegaMekAvailabilityRarityForScore(0)).toBe('Not Available');
    });

    it('splits scores 1 through 100 into 20-point rarity buckets', () => {
        expect(getMegaMekAvailabilityRarityForScore(1)).toBe('Very Rare');
        expect(getMegaMekAvailabilityRarityForScore(19)).toBe('Very Rare');

        expect(getMegaMekAvailabilityRarityForScore(20)).toBe('Rare');
        expect(getMegaMekAvailabilityRarityForScore(39)).toBe('Rare');

        expect(getMegaMekAvailabilityRarityForScore(40)).toBe('Uncommon');
        expect(getMegaMekAvailabilityRarityForScore(59)).toBe('Uncommon');

        expect(getMegaMekAvailabilityRarityForScore(60)).toBe('Common');
        expect(getMegaMekAvailabilityRarityForScore(79)).toBe('Common');

        expect(getMegaMekAvailabilityRarityForScore(80)).toBe('Very Common');
        expect(getMegaMekAvailabilityRarityForScore(100)).toBe('Very Common');
    });
});