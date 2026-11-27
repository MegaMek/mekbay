// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
  buildASSpecialsByUnitIndex,
  compileASSpecialQueries,
  compileASSpecialSelections,
  evaluateASSpecialsFilter,
  formatASSpecialMinimumQuery,
  getASSpecialFilterValues,
  getASSpecialMinimumFieldLabels,
  getASSpecialToken,
  parseASSpecialMinimumQuery,
  parseASSpecials,
  unitMatchesASSpecialSelections,
} from './as-special-filter.util';
import type { AlphaStrikeArcStats } from '../models/unit-summary.model';

describe('Alpha Strike special filtering', () => {
  const specials = ['AC2/2/2', 'TAG', 'TSM', 'TUR(3/3/3,IF2,LRM3/3/2)'];
  const queries = (...values: string[]) => compileASSpecialQueries(values);

  const emptyArc = (): AlphaStrikeArcStats => ({
    STD: { dmgS: '0', dmgM: '0', dmgL: '0', dmgE: '0' },
    CAP: { dmgS: '0', dmgM: '0', dmgL: '0', dmgE: '0' },
    SCAP: { dmgS: '0', dmgM: '0', dmgL: '0', dmgE: '0' },
    MSL: { dmgS: '0', dmgM: '0', dmgL: '0', dmgE: '0' },
    specials: [],
  });

  it('projects nonzero arc damage into four-slot specials without changing the summary', () => {
    const frontArc = emptyArc();
    const rearArc = emptyArc();
    frontArc.STD = { dmgS: '14', dmgM: '15', dmgL: '12', dmgE: '0' };
    frontArc.SCAP = { dmgS: '31', dmgM: '31', dmgL: '0', dmgE: '0' };
    frontArc.MSL = { dmgS: '4', dmgM: '4', dmgL: '4', dmgE: '4' };
    rearArc.CAP.dmgE = '0*';
    const stats = { specials: ['RBT', 'CAP'], frontArc, rearArc };
    const values = getASSpecialFilterValues(stats);

    expect(values).toEqual(['RBT', 'STD14/15/12/0', 'SCAP31/31/0/0', 'MSL4/4/4/4', 'CAP0/0/0/0*']);
    expect(stats.specials).toEqual(['RBT', 'CAP']);
    for (const token of ['STD', 'CAP', 'SCAP', 'MSL']) {
      expect(getASSpecialMinimumFieldLabels(token, 4)).toEqual(['S', 'M', 'L', 'E']);
      expect(evaluateASSpecialsFilter(values, '=', queries(token))).toBeTrue();
    }
    expect(evaluateASSpecialsFilter(values, '=', queries('MSL>=4/>=4/>=4/>=4'))).toBeTrue();
    expect(evaluateASSpecialsFilter(values, '=', queries('MSL*/*/*/>=5'))).toBeFalse();
  });

  it('omits all-zero damage specials even when a bare token is present', () => {
    expect(getASSpecialFilterValues({ specials: ['TAG', 'CAP', 'MSL'], frontArc: emptyArc() })).toEqual(['TAG']);
    expect(getASSpecialFilterValues({ specials: ['TAG'] })).toEqual(['TAG']);
    expect(getASSpecialFilterValues(undefined)).toEqual([]);
  });

  it('requires one arc to satisfy every populated minimum', () => {
    const leftArc = emptyArc();
    const rightArc = emptyArc();
    leftArc.STD.dmgS = '10';
    rightArc.STD.dmgM = '10';
    const values = getASSpecialFilterValues({ specials: [], leftArc, rightArc });

    expect(
      unitMatchesASSpecialSelections(
        values,
        compileASSpecialSelections([{ name: 'STD', state: 'and', minimumValues: [10, 10, null, null] }]),
      ),
    ).toBeFalse();
    expect(
      unitMatchesASSpecialSelections(
        values,
        compileASSpecialSelections([{ name: 'STD', state: 'and', minimumValues: [null, 10, null, null] }]),
      ),
    ).toBeTrue();
    expect(
      unitMatchesASSpecialSelections(
        values,
        compileASSpecialSelections([{ name: 'STD', state: 'not', minimumValues: [null, 10, null, null] }]),
      ),
    ).toBeFalse();
  });

  it('tokenizes top-level and turret-contained abilities without exposing turret damage as an ability', () => {
    const parsed = parseASSpecials(specials);

    expect(parsed.occurrences.map((occurrence) => occurrence.token)).toEqual(['AC', 'TAG', 'TSM', 'TUR', 'IF', 'LRM']);
    expect(
      parsed.occurrences.find((occurrence) => occurrence.token === 'TUR')?.values.map((value) => value?.rank ?? null),
    ).toEqual([3, 3, 3]);
    expect(
      parsed.occurrences.find((occurrence) => occurrence.token === 'LRM')?.values.map((value) => value?.rank ?? null),
    ).toEqual([3, 3, 2]);
    expect(parsed.abilities.find((ability) => ability.token === 'TUR')).toEqual(
      jasmine.objectContaining({
        lookupText: 'TUR',
        turretDamage: '3/3/3',
        children: [
          jasmine.objectContaining({ token: 'IF', rawText: 'IF2' }),
          jasmine.objectContaining({ token: 'LRM', rawText: 'LRM3/3/2' }),
        ],
      }),
    );
  });

  it('also accepts a comma-delimited specials string while preserving TUR parentheses', () => {
    const parsed = parseASSpecials('AC2/2/2, TAG, TSM, TUR(3/3/3, IF2, LRM3/3/2)');

    expect(parsed.occurrences.map((occurrence) => occurrence.token)).toEqual(['AC', 'TAG', 'TSM', 'TUR', 'IF', 'LRM']);
  });

  it('keeps digits that belong to ability names while removing numeric parameters', () => {
    expect(getASSpecialToken('C3M2')).toBe('C3M');
    expect(getASSpecialToken('C3I')).toBe('C3I');
    expect(getASSpecialToken('BHJ2')).toBe('BHJ2');
    expect(getASSpecialToken('ARTCM5-1')).toBe('ARTCM5');
    expect(getASSpecialToken('TSEMP-O1')).toBe('TSEMP');
  });

  it('uses one shared structural parser for simple, parameterized, and nested abilities', () => {
    expect(parseASSpecials('LAM(6"g/12a)').abilities[0]).toEqual(
      jasmine.objectContaining({
        lookupText: 'LAM',
        token: 'LAM',
        children: [],
      }),
    );
    expect(parseASSpecials('TUR(2/2/1,TUR(1/1/-,TAG))').abilities[0]).toEqual(
      jasmine.objectContaining({
        token: 'TUR',
        children: [
          jasmine.objectContaining({
            token: 'TUR',
            children: [jasmine.objectContaining({ token: 'TAG' })],
          }),
        ],
      }),
    );
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
    expect(evaluateASSpecialsFilter(['ARTCM5-1'], '=', queries(formatted))).toBeTrue();
  });

  it('materializes declared implicit-one values without adding fields to flag abilities', () => {
    const parsed = parseASSpecials(['SNARC', 'CNARC', 'TAG']);

    expect(parsed.occurrences.find((occurrence) => occurrence.token === 'SNARC')?.values).toEqual([
      { text: '1', rank: 1 },
    ]);
    expect(parsed.occurrences.find((occurrence) => occurrence.token === 'CNARC')?.values).toEqual([
      { text: '1', rank: 1 },
    ]);
    expect(parsed.occurrences.find((occurrence) => occurrence.token === 'TAG')?.values).toEqual([]);
    expect(evaluateASSpecialsFilter(['SNARC'], '=', queries('SNARC>=1'))).toBeTrue();
    expect(evaluateASSpecialsFilter(['SNARC'], '=', queries('SNARC>=2'))).toBeFalse();
  });

  it('applies only populated minima and matches nested turret abilities', () => {
    expect(
      unitMatchesASSpecialSelections(
        specials,
        compileASSpecialSelections([
          {
            name: 'AC',
            state: 'or',
            minimumValues: [null, null, 2],
          },
        ]),
      ),
    ).toBeTrue();
    expect(
      unitMatchesASSpecialSelections(
        specials,
        compileASSpecialSelections([
          {
            name: 'AC',
            state: 'or',
            minimumValues: [null, null, 3],
          },
        ]),
      ),
    ).toBeFalse();
    expect(
      unitMatchesASSpecialSelections(
        specials,
        compileASSpecialSelections([
          {
            name: 'TUR',
            state: 'or',
            minimumValues: [null, null, 3],
          },
        ]),
      ),
    ).toBeTrue();
    expect(
      unitMatchesASSpecialSelections(
        specials,
        compileASSpecialSelections([
          {
            name: 'IF',
            state: 'or',
            minimumValues: [2],
          },
        ]),
      ),
    ).toBeTrue();
  });

  it('retains legacy exact, comparison, wildcard, and zero-star semantics', () => {
    expect(evaluateASSpecialsFilter(['FLK2/3/1'], '=', queries('FLK2/>2'))).toBeTrue();
    expect(evaluateASSpecialsFilter(['FLK2/2/2'], '=', queries('FLK2/2/2'))).toBeTrue();
    expect(evaluateASSpecialsFilter(['FLK0*/0*/0*'], '=', queries('FLK*/*/0*'))).toBeTrue();
    expect(evaluateASSpecialsFilter(['TUR(0*/0*/0*,FLK2/1/0)'], '=', queries('FLK>=2'))).toBeTrue();
  });

  it('shares parsed collections only within one catalog generation', () => {
    const units = [
      { id: 'a', specials: ['TAG', 'IF2'] },
      { id: 'b', specials: ['TAG', 'IF2'] },
    ];
    const first = buildASSpecialsByUnitIndex(
      units,
      (unit) => unit.id,
      (unit) => unit.specials,
    );
    const second = buildASSpecialsByUnitIndex(
      units,
      (unit) => unit.id,
      (unit) => unit.specials,
    );

    expect(first.get('a')).toBe(first.get('b'));
    expect(second.get('a')).toBe(second.get('b'));
    expect(second.get('a')).not.toBe(first.get('a'));
  });

  it('provides range labels only for observed numeric fields', () => {
    expect(getASSpecialMinimumFieldLabels('AC', 3)).toEqual(['S', 'M', 'L']);
    expect(getASSpecialMinimumFieldLabels('IF', 1)).toEqual(['']);
    expect(getASSpecialMinimumFieldLabels('TSM', 0)).toEqual([]);
  });
});
