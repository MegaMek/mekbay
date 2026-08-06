// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ordinaryVehicleArmorLocations } from './blk-constants';

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
});