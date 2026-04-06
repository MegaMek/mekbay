import { highlightMatches, matchesSearch, parseSearchQuery } from './search.util';

describe('search.util', () => {
    it('matches apostrophe variants when alphanumeric normalization is enabled', () => {
        const query = parseSearchQuery("wolf's dragoons");

        expect(matchesSearch('Wolf’s Dragoons', query, true)).toBeTrue();
    });

    it('matches tokens that include parenthesized text', () => {
        const query = parseSearchQuery('wolf (beta');

        expect(matchesSearch('Clan Wolf (Beta Galaxy)', query, true)).toBeTrue();
    });

    it('highlights smart-apostrophe matches from ascii input', () => {
        const query = parseSearchQuery("wolf's");

        expect(highlightMatches('Wolf’s Dragoons', query, true)).toContain('matchHighlight');
    });

    it('keeps quoted specials intact as a single exact search token', () => {
        const query = parseSearchQuery('"TUR(4/4/2,IF1,TAG)"');

        expect(query).toEqual([
            {
                tokens: [{ token: 'tur(4/4/2,if1,tag)', mode: 'exact' }],
            },
        ]);
        expect(matchesSearch('TUR(4/4/2,IF1,TAG)', query, true)).toBeTrue();
        expect(matchesSearch('IF1', query, true)).toBeFalse();
    });
});