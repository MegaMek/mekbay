// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  isNativeEntityType,
  nativeCapabilityForUnitTypeAlias,
} from './codec-capabilities';
import type { EntityType } from './types';

describe('native codec capabilities', () => {
  it('recognizes every supported EntityType at persisted-data ingress', () => {
    const expected: EntityType[] = [
      'Mek', 'Aero', 'ConvFighter', 'FixedWingSupport', 'SmallCraft', 'DropShip',
      'JumpShip', 'WarShip', 'SpaceStation', 'Tank', 'Naval', 'VTOL',
      'SupportTank', 'SupportNaval', 'SupportVTOL', 'LargeSupportTank', 'Infantry',
      'BattleArmor', 'ProtoMek', 'HandheldWeapon', 'GunEmplacement', 'BuildingEntity',
    ];
    expected.forEach(type => expect(isNativeEntityType(type)).toBeTrue());
    for (const invalid of [undefined, null, 0, {}, 'FutureMysteryUnit', 'Mek ']) {
      expect(isNativeEntityType(invalid)).toBeFalse();
    }
  });

  it('maps every supported native entity to its codec family', () => {
    expect(nativeCapabilityForUnitTypeAlias('BattleMek')).toEqual(jasmine.objectContaining({
      family: 'mek', format: 'mtf',
    }));
    expect(nativeCapabilityForUnitTypeAlias('GunEmplacement')).toEqual(jasmine.objectContaining({
      family: 'static-emplacement', format: 'blk',
    }));
    expect(nativeCapabilityForUnitTypeAlias('Tank')).toEqual(jasmine.objectContaining({
      family: 'vehicle', format: 'blk',
    }));
  });

  it('resolves recognized aliases to the same canonical family', () => {
    expect(nativeCapabilityForUnitTypeAlias('Naval')).toBe(nativeCapabilityForUnitTypeAlias('Tank'));
    expect(nativeCapabilityForUnitTypeAlias('Warship')).toBe(nativeCapabilityForUnitTypeAlias('WarShip'));
  });

  it('default-denies unknown UnitType values', () => {
    expect(nativeCapabilityForUnitTypeAlias('FutureMysteryUnit')).toBeUndefined();
  });
});
