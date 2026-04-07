import { formatRulesReference, Rulebook } from './common.model';

describe('common.model RulesReference formatting', () => {
    it('formats a single rules page with a singular label', () => {
        expect(formatRulesReference({ book: Rulebook.CO, page: 72 })).toBe('BattleTech: Campaign Operations, p.72');
    });

    it('formats multiple rules pages as a comma-separated list', () => {
        expect(formatRulesReference({ book: Rulebook.ASCE, page: [101, 175] })).toBe("Alpha Strike: Commander's Edition, pp.101, 175");
    });
});