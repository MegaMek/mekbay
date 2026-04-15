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

    it('matches punctuation-insensitive model tokens within a single word', () => {
        const query = parseSearchQuery('whm6r');

        expect(matchesSearch('Warhammer WHM-6R', query, true)).toBeTrue();
        expect(highlightMatches('Warhammer WHM-6R', query, true)).toContain('matchHighlight');
    });

    it('does not bridge alphanumeric partial matches across whitespace boundaries', () => {
        const query = parseSearchQuery('enyo');

        expect(matchesSearch('Yao Lien YOL-4C', query, true)).toBeFalse();
        expect(highlightMatches('Yao Lien YOL-4C', query, true)).not.toContain('matchHighlight');
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

    it('splits comma and semicolon separated groups as OR branches', () => {
        const query = parseSearchQuery('atlas,locust;shadow hawk');

        expect(query).toEqual([
            { tokens: [{ token: 'atlas', mode: 'partial' }] },
            { tokens: [{ token: 'locust', mode: 'partial' }] },
            {
                tokens: [
                    { token: 'shadow', mode: 'partial' },
                    { token: 'hawk', mode: 'partial' },
                ],
            },
        ]);
        expect(matchesSearch('Locust LCT-1V', query, true)).toBeTrue();
        expect(matchesSearch('Shadow Hawk SHD-2H', query, true)).toBeTrue();
        expect(matchesSearch('Warhammer WHM-6R', query, true)).toBeFalse();
    });

    it('keeps commas inside quoted groups from creating OR branches', () => {
        const query = parseSearchQuery('"TUR(2/3/3,IF2,LRM1/2/2)",tag');

        expect(query).toEqual([
            {
                tokens: [{ token: 'tur(2/3/3,if2,lrm1/2/2)', mode: 'exact' }],
            },
            {
                tokens: [{ token: 'tag', mode: 'partial' }],
            },
        ]);
    });
});