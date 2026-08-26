// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { parseNativeEntityFluff } from './entity-fluff-parser';

describe('native EntityFluff parser', () => {
  it('reads MTF prose and systems without treating critical slots as fields', () => {
    const fluff = parseNativeEntityFluff([
      'Chassis: Awesome',
      'Overview: A durable assault Mek.',
      'SystemManufacturer: ENGINE:Vlar',
      'SystemMode: ENGINE:300',
      'Left Arm:',
      'Manufacturer: This is equipment, not fluff',
      '',
      'History: Served for centuries.',
    ].join('\n'), 'mtf');

    expect(fluff).toEqual({
      overview: 'A durable assault Mek.',
      history: 'Served for centuries.',
      systemManufacturers: { ENGINE: 'Vlar' },
      systemModels: { ENGINE: '300' },
    });
  });

  it('reads multiline BLK prose and normalized systems', () => {
    const fluff = parseNativeEntityFluff([
      '<UnitType>', 'Tank', '</UnitType>',
      '<overview>', 'Line one', 'Line two', '</overview>',
      '<manufacturer>', 'Corean', '</manufacturer>',
      '<systemManufacturers>', 'ENGINE:Vlar', '</systemManufacturers>',
      '<systemModels>', 'ENGINE:300', '</systemModels>',
    ].join('\n'), 'blk');

    expect(fluff).toEqual({
      overview: 'Line one\nLine two',
      manufacturer: 'Corean',
      systemManufacturers: { ENGINE: 'Vlar' },
      systemModels: { ENGINE: '300' },
    });
  });
});
