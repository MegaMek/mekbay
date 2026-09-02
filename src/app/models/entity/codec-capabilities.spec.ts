// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  NATIVE_CODEC_CAPABILITIES,
  nativeCapabilityForEntityType,
  nativeCapabilityForUnitTypeAlias,
} from './codec-capabilities';
import type { EntityType } from './types';

describe('native codec capabilities', () => {
  it('covers every EntityType exactly once', () => {
    const expected: EntityType[] = [
      'Mek', 'Aero', 'ConvFighter', 'FixedWingSupport', 'SmallCraft', 'DropShip',
      'JumpShip', 'WarShip', 'SpaceStation', 'Tank', 'Naval', 'VTOL',
      'SupportTank', 'SupportNaval', 'SupportVTOL', 'LargeSupportTank', 'Infantry',
      'BattleArmor', 'ProtoMek', 'HandheldWeapon', 'GunEmplacement', 'BuildingEntity',
    ];
    const actual = NATIVE_CODEC_CAPABILITIES.flatMap(row => row.entityTypes);

    expect(new Set(actual).size).toBe(actual.length);
    expect([...actual].sort()).toEqual([...expected].sort());
    expected.forEach(type => expect(nativeCapabilityForEntityType(type)).toBeDefined());
  });

  it('maps every supported native entity to its codec family', () => {
    expect(nativeCapabilityForUnitTypeAlias('BattleMek')).toEqual(jasmine.objectContaining({
      family: 'mek', format: 'mtf', dialect: 'megamek-mtf', dialectVersion: 1,
    }));
    expect(nativeCapabilityForEntityType('GunEmplacement')).toEqual(jasmine.objectContaining({
      format: 'blk', decodeEntity: true,
    }));
    expect(nativeCapabilityForEntityType('Tank')).toEqual(jasmine.objectContaining({
      family: 'vehicle', format: 'blk', decodeEntity: true,
    }));
  });

  it('keeps native capability metadata explicit', () => {
    const vehicle = nativeCapabilityForEntityType('Naval');

    expect(vehicle.decodeEntity).toBeTrue();
    expect('verifiedMegaMekInterop' in vehicle).toBeFalse();
  });

  it('default-denies unknown UnitType values', () => {
    expect(nativeCapabilityForUnitTypeAlias('FutureMysteryUnit')).toBeUndefined();
  });
});
