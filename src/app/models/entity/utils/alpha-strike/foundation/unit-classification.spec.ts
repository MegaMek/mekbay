// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
  TestAeroSpaceFighterEntity as AeroSpaceFighterEntity,
  TestBattleArmorEntity as BattleArmorEntity,
  TestBipedMekEntity as BipedMekEntity,
  TestConvFighterEntity as ConvFighterEntity,
  TestDropShipEntity as DropShipEntity,
  TestFixedWingSupportEntity as FixedWingSupportEntity,
  TestHandheldWeaponEntity as HandheldWeaponEntity,
  TestInfantryEntity as InfantryEntity,
  TestJumpShipEntity as JumpShipEntity,
  TestLamEntity as LamEntity,
  TestProtoMekEntity as ProtoMekEntity,
  TestQuadVeeEntity as QuadVeeEntity,
  TestSmallCraftEntity as SmallCraftEntity,
  TestSpaceStationEntity as SpaceStationEntity,
  TestSupportTankEntity as SupportTankEntity,
  TestTankEntity as TankEntity,
  TestWarShipEntity as WarShipEntity,
} from '../../../testing/test-entities';
import {
  AEROSPACE_EXPORT_TYPES,
  LARGE_AEROSPACE_TYPES,
  alphaStrikeSize,
  alphaStrikeUnitType,
  isAerospaceElement,
  isFighter,
  usesArcs,
} from './unit-classification';

describe('Alpha Strike unit classification', () => {
  it('classifies every supported entity family', () => {
    const spheroid = new DropShipEntity();
    spheroid.motiveType.set('Spheroid');
    const aerodyne = new DropShipEntity();
    aerodyne.motiveType.set('Aerodyne');
    const support = new SupportTankEntity();

    expect([
      alphaStrikeUnitType(new BipedMekEntity()),
      alphaStrikeUnitType(new ProtoMekEntity()),
      alphaStrikeUnitType(new TankEntity()),
      alphaStrikeUnitType(support),
      alphaStrikeUnitType(new BattleArmorEntity()),
      alphaStrikeUnitType(new InfantryEntity()),
      alphaStrikeUnitType(new SpaceStationEntity()),
      alphaStrikeUnitType(new WarShipEntity()),
      alphaStrikeUnitType(new JumpShipEntity()),
      alphaStrikeUnitType(spheroid),
      alphaStrikeUnitType(aerodyne),
      alphaStrikeUnitType(new SmallCraftEntity()),
      alphaStrikeUnitType(new FixedWingSupportEntity()),
      alphaStrikeUnitType(new ConvFighterEntity()),
      alphaStrikeUnitType(new AeroSpaceFighterEntity()),
      alphaStrikeUnitType(new HandheldWeaponEntity()),
    ]).toEqual([
      'BM', 'PM', 'CV', 'SV', 'BA', 'CI', 'SS', 'WS', 'JS', 'DS', 'DA', 'SC', 'SV', 'CF', 'AF', 'XX',
    ]);
  });

  it('classifies every Mek form through the entity family', () => {
    expect([new BipedMekEntity(), new LamEntity(), new QuadVeeEntity()].map(alphaStrikeUnitType))
      .toEqual(['BM', 'BM', 'BM']);
  });

  it('uses exact ordinary-ground and fighter size boundaries', () => {
    const mek = new BipedMekEntity();
    expect([39, 40, 59, 60, 79, 80].map(tons => {
      mek.setTonnage(tons);
      return alphaStrikeSize(mek);
    })).toEqual([1, 2, 2, 3, 3, 4]);

    const fighter = new AeroSpaceFighterEntity();
    expect([49, 50, 74, 75].map(tons => {
      fighter.setTonnage(tons);
      return alphaStrikeSize(fighter);
    })).toEqual([1, 2, 2, 3]);
  });

  it('uses exact support-vehicle size boundaries', () => {
    const support = new SupportTankEntity();
    support.motiveType.set('Tracked');

    expect([4, 5, 100, 101, 200, 201].map(tons => {
      support.setTonnage(tons);
      return alphaStrikeSize(support);
    })).toEqual([1, 2, 2, 3, 3, 4]);
  });

  it('distinguishes exported aerospace, fighter, and final arc semantics', () => {
    const fixedWingSupport = new FixedWingSupportEntity();

    expect(AEROSPACE_EXPORT_TYPES.has('AF')).toBe(true);
    expect(AEROSPACE_EXPORT_TYPES.has('SV')).toBe(false);
    expect(LARGE_AEROSPACE_TYPES.has('SC')).toBe(true);
    expect(LARGE_AEROSPACE_TYPES.has('AF')).toBe(false);
    expect(isAerospaceElement(fixedWingSupport, 'SV')).toBe(true);
    expect(isFighter(fixedWingSupport, 'SV')).toBe(true);
    expect(usesArcs('AF', 3)).toBe(false);
    expect(usesArcs('SC', 1)).toBe(true);
    expect(usesArcs('SV', 2)).toBe(false);
    expect(usesArcs('SV', 3)).toBe(true);
  });
});
