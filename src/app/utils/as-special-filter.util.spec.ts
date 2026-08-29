// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    evaluateASSpecialsFilter,
    formatASSpecialMinimumQuery,
    getASSpecialMinimumFieldLabels,
    getASSpecialToken,
    parseASSpecialAbility,
    parseASSpecialMinimumQuery,
    parseASSpecials,
    unitMatchesASSpecialSelections,
} from './as-special-filter.util';

describe('Alpha Strike special filtering', () => {
    const specials = [
        'AC2/2/2',
        'TAG',
        'TSM',
        'TUR(3/3/3,IF2,LRM3/3/2)',
    ];

    it('tokenizes top-level and turret-contained abilities without exposing turret damage as an ability', () => {
        const parsed = parseASSpecials(specials);

        expect(parsed.occurrences.map(occurrence => occurrence.token)).toEqual([
            'AC',
            'TAG',
            'TSM',
            'TUR',
            'IF',
            'LRM',
        ]);
        expect(parsed.occurrences.find(occurrence => occurrence.token === 'TUR')?.values.map(value => value?.rank ?? null))
            .toEqual([3, 3, 3]);
        expect(parsed.occurrences.find(occurrence => occurrence.token === 'LRM')?.values.map(value => value?.rank ?? null))
            .toEqual([3, 3, 2]);
        expect(parsed.abilities.find(ability => ability.token === 'TUR')).toEqual(jasmine.objectContaining({
            lookupText: 'TUR',
            turretDamage: '3/3/3',
            children: [
                jasmine.objectContaining({ token: 'IF', rawText: 'IF2' }),
                jasmine.objectContaining({ token: 'LRM', rawText: 'LRM3/3/2' }),
            ],
        }));
    });

    it('also accepts a comma-delimited specials string while preserving TUR parentheses', () => {
        const parsed = parseASSpecials('AC2/2/2, TAG, TSM, TUR(3/3/3, IF2, LRM3/3/2)');

        expect(parsed.occurrences.map(occurrence => occurrence.token)).toEqual([
            'AC',
            'TAG',
            'TSM',
            'TUR',
            'IF',
            'LRM',
        ]);
    });

    it('keeps digits that belong to ability names while removing numeric parameters', () => {
        expect(getASSpecialToken('C3M2')).toBe('C3M');
        expect(getASSpecialToken('C3I')).toBe('C3I');
        expect(getASSpecialToken('BHJ2')).toBe('BHJ2');
        expect(getASSpecialToken('ARTCM5-1')).toBe('ARTCM5');
        expect(getASSpecialToken('TSEMP-O1')).toBe('TSEMP');
    });

    it('uses one shared structural parser for simple, parameterized, and nested abilities', () => {
        expect(parseASSpecialAbility('LAM(6"g/12a)')).toEqual(jasmine.objectContaining({
            lookupText: 'LAM',
            token: 'LAM',
            children: [],
        }));
        expect(parseASSpecialAbility('TUR(2/2/1,TUR(1/1/-,TAG))')).toEqual(jasmine.objectContaining({
            token: 'TUR',
            children: [jasmine.objectContaining({
                token: 'TUR',
                children: [jasmine.objectContaining({ token: 'TAG' })],
            })],
        }));
    });

    it('formats and parses neutral contextual slots as inclusive minimum queries', () => {
        expect(formatASSpecialMinimumQuery('AC', [null, null, 3])).toBe('AC*/*/>=3');
        expect(parseASSpecialMinimumQuery('AC*/*/>=3')).toEqual({
            token: 'AC',
            minimumValues: [null, null, 3],
        });
        expect(parseASSpecialMinimumQuery('AC2/2/2')).toBeNull();
    });

    it('round-trips artillery tokens whose type names contain digits', () => {
        const formatted = formatASSpecialMinimumQuery('ARTCM5', [1]);

        expect(formatted).toBe('ARTCM5>=1');
        expect(getASSpecialToken(formatted)).toBe('ARTCM5');
        expect(parseASSpecialMinimumQuery(formatted)).toEqual({
            token: 'ARTCM5',
            minimumValues: [1],
        });
        expect(evaluateASSpecialsFilter(['ARTCM5-1'], '=', [formatted])).toBeTrue();
    });

    it('materializes declared implicit-one values without adding fields to flag abilities', () => {
        const parsed = parseASSpecials(['SNARC', 'CNARC', 'TAG']);

        expect(parsed.occurrences.find(occurrence => occurrence.token === 'SNARC')?.values)
            .toEqual([{ text: '1', rank: 1 }]);
        expect(parsed.occurrences.find(occurrence => occurrence.token === 'CNARC')?.values)
            .toEqual([{ text: '1', rank: 1 }]);
        expect(parsed.occurrences.find(occurrence => occurrence.token === 'TAG')?.values).toEqual([]);
        expect(evaluateASSpecialsFilter(['SNARC'], '=', ['SNARC>=1'])).toBeTrue();
        expect(evaluateASSpecialsFilter(['SNARC'], '=', ['SNARC>=2'])).toBeFalse();
    });

    it('applies only populated minima and matches nested turret abilities', () => {
        expect(unitMatchesASSpecialSelections(specials, [{
            name: 'AC',
            state: 'or',
            minimumValues: [null, null, 2],
        }])).toBeTrue();
        expect(unitMatchesASSpecialSelections(specials, [{
            name: 'AC',
            state: 'or',
            minimumValues: [null, null, 3],
        }])).toBeFalse();
        expect(unitMatchesASSpecialSelections(specials, [{
            name: 'TUR',
            state: 'or',
            minimumValues: [null, null, 3],
        }])).toBeTrue();
        expect(unitMatchesASSpecialSelections(specials, [{
            name: 'IF',
            state: 'or',
            minimumValues: [2],
        }])).toBeTrue();
    });

    it('retains legacy exact, comparison, wildcard, and zero-star semantics', () => {
        expect(evaluateASSpecialsFilter(['FLK2/3/1'], '=', ['FLK2/>2'])).toBeTrue();
        expect(evaluateASSpecialsFilter(['FLK2/2/2'], '=', ['FLK2/2/2'])).toBeTrue();
        expect(evaluateASSpecialsFilter(['FLK0*/0*/0*'], '=', ['FLK*/*/0*'])).toBeTrue();
        expect(evaluateASSpecialsFilter(['TUR(0*/0*/0*,FLK2/1/0)'], '=', ['FLK>=2'])).toBeTrue();
    });

    it('provides range labels only for observed numeric fields', () => {
        expect(getASSpecialMinimumFieldLabels('AC', 3)).toEqual(['S', 'M', 'L']);
        expect(getASSpecialMinimumFieldLabels('IF', 1)).toEqual(['']);
        expect(getASSpecialMinimumFieldLabels('TSM', 0)).toEqual([]);
    });
});
