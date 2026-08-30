// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
  ordinaryVehicleArmorLocations,
  superheavyVehicleArmorLocations,
} from './blk-constants';

describe('ordinary vehicle BLK armor locations', () => {
  it('keeps turretless armor in hull order', () => {
    expect(ordinaryVehicleArmorLocations(4).slice(0, 4))
      .toEqual(['Front', 'Right', 'Left', 'Rear']);
  });

  it('maps a single turret to the legacy Turret location', () => {
    expect(ordinaryVehicleArmorLocations(5).slice(0, 5))
      .toEqual(['Front', 'Right', 'Left', 'Rear', 'Turret']);
  });

  it('maps dual-turret armor in MegaMek rear-then-front order', () => {
    expect(ordinaryVehicleArmorLocations(6).slice(0, 6))
      .toEqual(['Front', 'Right', 'Left', 'Rear', 'Rear Turret', 'Front Turret']);
  });

  it('maps a single superheavy turret to the canonical Turret location', () => {
    expect(superheavyVehicleArmorLocations(7).slice(0, 7))
      .toEqual(['Front', 'Front Right', 'Front Left', 'Rear Right', 'Rear Left', 'Rear', 'Turret']);
  });

  it('keeps MegaMek rear-then-front order for dual superheavy turrets', () => {
    expect(superheavyVehicleArmorLocations(8).slice(-2)).toEqual(['Rear Turret', 'Front Turret']);
  });
});
