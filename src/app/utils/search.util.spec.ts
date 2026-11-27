// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { createSearchMatcher, highlightMatches, matchesSearch, parseSearchQuery } from './search.util';
import { removeAccents } from './string.util';

describe('search.util', () => {
    it('keeps the compiled matcher equivalent when catalog text is already normalized', () => {
        const cases = [
            { query: "wolf's dragoons", text: 'Wolf’s Dragoons', expected: true },
            { query: 'whm6r', text: 'Warhammer WHM-6R', expected: true },
            { query: 'yaolien', text: 'Yao Lien YOL-4C', expected: true },
            { query: 'enyo', text: 'Yao Lien YOL-4C', expected: false },
            { query: 'atlas,locust;shadow hawk', text: 'Shadow Hawk SHD-2H', expected: true },
            { query: 'atlas,locust;shadow hawk', text: 'Warhammer WHM-6R', expected: false },
        ];

        for (const testCase of cases) {
            const tokens = parseSearchQuery(testCase.query);
            const normalizedText = removeAccents(testCase.text.toLowerCase());
            const matcher = createSearchMatcher(tokens, true, true);

            expect(matcher(normalizedText))
                .withContext(`${testCase.query} against ${testCase.text}`)
                .toBe(testCase.expected);
            expect(matcher(normalizedText)).toBe(matchesSearch(testCase.text, tokens, true));
        }
    });

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

    it('matches concatenated tokens across whitespace when they start at a word boundary', () => {
        const query = parseSearchQuery('yaolien');

        expect(matchesSearch('Yao Lien YOL-4C', query, true)).toBeTrue();
    });

    it('does not bridge alphanumeric partial matches across whitespace boundaries', () => {
        const query = parseSearchQuery('enyo');

        expect(matchesSearch('Yao Lien YOL-4C', query, true)).toBeFalse();
        expect(highlightMatches('Yao Lien YOL-4C', query, true)).not.toContain('matchHighlight');
    });

    it('prefers the longest alphanumeric highlight span before shorter overlapping tokens', () => {
        const query = parseSearchQuery('yaolien y');

        expect(highlightMatches('Yao Lien', query, true)).toBe('<span class="matchHighlight">Yao Lien</span>');
        expect(highlightMatches('YOL-4C', query, true)).toBe('<span class="matchHighlight">Y</span>OL-4C');
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
