// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { WeaponEquipment } from '../../../../equipment.model';
import {
  TestBipedMekEntity,
  TestQuadVeeEntity,
  TestTankEntity,
  TestTripodMekEntity,
  TestVtolEntity,
} from '../../../testing/test-entities';
import { addTestEquipment } from '../../../testing/test-mounted-equipment';
import {
  alphaStrikeDamageLocationMultiplier,
  hasAlphaStrikeTurretLocation,
  type AlphaStrikeDamageLocation,
} from './generic-location-mapper';

describe('Alpha Strike generic location mapper', () => {
  it('routes physical vehicle rear mounts independently of rear-facing flags', () => {
    const vehicle = new TestTankEntity();
    const front = addWeapon(vehicle, { location: 'Front', rearMounted: true });
    const rear = addWeapon(vehicle, { location: 'Rear' });

    expect(scopes(vehicle, front)).toEqual({ standard: 1, rear: 0, turret: 0 });
    expect(scopes(vehicle, rear)).toEqual({ standard: 0, rear: 1, turret: 0 });
  });

  it('counts vehicle turret weapons globally and in TUR', () => {
    const vehicle = new TestTankEntity();
    const turret = addWeapon(vehicle, { location: 'Turret' });

    expect(scopes(vehicle, turret)).toEqual({ standard: 1, rear: 0, turret: 1 });
    expect(hasAlphaStrikeTurretLocation(vehicle)).toBeTrue();
  });

  it('routes Mek rear mounts exclusively and duplicates turret mounts globally', () => {
    const mek = new TestBipedMekEntity();
    const rear = addWeapon(mek, { location: 'RT', rearMounted: true });
    const turret = addWeapon(mek, { location: 'HD', turretMounted: true });

    expect(scopes(mek, rear)).toEqual({ standard: 0, rear: 1, turret: 0 });
    expect(scopes(mek, turret)).toEqual({ standard: 1, rear: 0, turret: 1 });
    expect(hasAlphaStrikeTurretLocation(mek)).toBeTrue();
  });

  it('uses the same physical routing for VTOL locations', () => {
    const vtol = new TestVtolEntity();
    const turret = addWeapon(vtol, { location: 'Turret' });
    const rear = addWeapon(vtol, { location: 'Rear' });

    expect(scopes(vtol, turret)).toEqual({ standard: 1, rear: 0, turret: 1 });
    expect(scopes(vtol, rear)).toEqual({ standard: 0, rear: 1, turret: 0 });
  });

  it('applies Java tripod and QuadVee turret exceptions', () => {
    const tripod = new TestTripodMekEntity();
    const tripodArm = addWeapon(tripod, { location: 'RA' });
    const tripodLeg = addWeapon(tripod, { location: 'CL' });
    const quadVee = new TestQuadVeeEntity();
    const quadVeeLeg = addWeapon(quadVee, { location: 'FLL' });

    expect(scopes(tripod, tripodArm)).toEqual({ standard: 1, rear: 0, turret: 1 });
    expect(scopes(tripod, tripodLeg)).toEqual({ standard: 1, rear: 0, turret: 0 });
    expect(scopes(quadVee, quadVeeLeg)).toEqual({ standard: 1, rear: 0, turret: 1 });
  });

});

function addWeapon(
  entity: TestTankEntity | TestVtolEntity | TestBipedMekEntity | TestTripodMekEntity | TestQuadVeeEntity,
  options: { location: string; rearMounted?: boolean; turretMounted?: boolean },
) {
  return addTestEquipment(entity, new WeaponEquipment({
    id: `test-${entity.mountedWeapons().length}`,
    name: 'Test weapon',
    type: 'weapon',
    weapon: { damage: 5, rackSize: 0, ranges: [5, 10, 15, 20], ammoType: 'NA' },
  }), options) as ReturnType<typeof entity.mountedWeapons>[number];
}

function scopes(
  entity: Parameters<typeof alphaStrikeDamageLocationMultiplier>[0],
  mount: Parameters<typeof alphaStrikeDamageLocationMultiplier>[2],
): Record<AlphaStrikeDamageLocation, number> {
  return {
    standard: alphaStrikeDamageLocationMultiplier(entity, 'standard', mount),
    rear: alphaStrikeDamageLocationMultiplier(entity, 'rear', mount),
    turret: alphaStrikeDamageLocationMultiplier(entity, 'turret', mount),
  };
}
