// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { createMinimalUnitRulesRefCombinations, unitRulesRefRequirers } from './unit-rules-ref-builder';

describe('unitRulesRefRequirers', () => {
  const components = [
    { name: 'Long Tom Cannon Ammo', books: ['TO:AUE'] },
    { name: 'Long Tom Cannon Ammo', books: ['TO:AUE'] },
    { name: 'Long Tom Cannon', books: ['TO:AUE', 'Core'] },
    { name: 'ER Large Laser', books: ['TW', 'BMM', 'TO:AUE'] },
    { name: 'Medium Pulse Laser', books: ['TW', 'BMM'] },
    { name: '', books: [] },
  ];

  it('names once each component that no companion book covers', () => {
    expect(unitRulesRefRequirers(components, 'TO:AUE', [['TW']])).toEqual([
      { name: 'Long Tom Cannon', unless: [] },
      { name: 'Long Tom Cannon Ammo', unless: [] },
    ]);
  });

  it('marks a component that only some merged alternatives cover, after the unconditional ones', () => {
    expect(unitRulesRefRequirers(components, 'TO:AUE', [['BMM', 'Core', 'TM', 'TW']])).toEqual([
      { name: 'Long Tom Cannon Ammo', unless: [] },
      { name: 'ER Large Laser', unless: ['BMM', 'TW'] },
      { name: 'Long Tom Cannon', unless: ['Core'] },
    ]);
  });
});

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
