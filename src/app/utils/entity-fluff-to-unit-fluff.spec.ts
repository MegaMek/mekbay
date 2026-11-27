// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { entityFluffToUnitFluff } from './entity-fluff-to-unit-fluff';

describe('entityFluffToUnitFluff', () => {
  it('detaches, orders, and recursively freezes display fluff', () => {
    const source = {
      overview: 'Overview',
      systemManufacturers: { TARGETING: 'Dalban', ENGINE: 'Vlar' },
      systemModels: { ENGINE: '300' },
    };

    const result = entityFluffToUnitFluff(source)!;
    source.overview = 'mutated';
    source.systemManufacturers.ENGINE = 'mutated';

    expect(result).toEqual({
      overview: 'Overview',
      systems: [
        { label: 'Engine', manufacturer: 'Vlar', model: '300' },
        { label: 'Targeting/Tracking', manufacturer: 'Dalban' },
      ],
    });
    expect(Object.isFrozen(result)).toBeTrue();
    expect(Object.isFrozen(result.systems)).toBeTrue();
    expect(result.systems?.every(Object.isFrozen)).toBeTrue();
  });

  it('omits blank fields and returns undefined for empty fluff', () => {
    expect(entityFluffToUnitFluff({ overview: '\t\u2003', notes: ' keep me ' })).toEqual({
      notes: ' keep me ',
    });
    expect(entityFluffToUnitFluff({})).toBeUndefined();
  });
});
