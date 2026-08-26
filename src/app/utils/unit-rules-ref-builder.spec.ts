// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { createMinimalUnitRulesRefCombinations } from './unit-rules-ref-builder';

describe('createMinimalUnitRulesRefCombinations', () => {
  it('returns inclusion-minimal alternatives in stable source order', () => {
    expect(createMinimalUnitRulesRefCombinations([
      ['Core', 'BMM', 'TW'],
      ['TM'],
      ['TM', 'TO:AUE'],
      [],
    ], { isMek: true, isIndustrialMek: false })).toEqual([
      ['Core', 'TM'],
      ['BMM', 'TM'],
      ['TW', 'TM'],
    ]);
  });

  it('removes inapplicable Mek-only books before finding coverage', () => {
    expect(createMinimalUnitRulesRefCombinations([
      ['Core', 'BMM', 'TW'],
    ], { isMek: false, isIndustrialMek: false })).toEqual([['TW']]);
    expect(createMinimalUnitRulesRefCombinations([
      ['Core', 'BMM'],
    ], { isMek: false, isIndustrialMek: false })).toEqual([]);
    expect(createMinimalUnitRulesRefCombinations([
      ['Core', 'BMM'],
    ], { isMek: true, isIndustrialMek: true })).toEqual([['BMM']]);
  });

  it('collapses supersets and treats unreferenced components as neutral', () => {
    expect(createMinimalUnitRulesRefCombinations([
      [],
      ['TM', 'TW'],
      ['TM'],
      null,
    ], { isMek: true, isIndustrialMek: false })).toEqual([['TM']]);
    expect(createMinimalUnitRulesRefCombinations([[], null, undefined], {
      isMek: true,
      isIndustrialMek: false,
    })).toEqual([]);
  });
});
