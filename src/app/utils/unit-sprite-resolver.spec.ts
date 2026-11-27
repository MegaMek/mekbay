// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSpriteAssignments } from './unit-sprite-assignment-resolver';
import {
  TestAeroSpaceFighterEntity as AeroEntity,
  TestBattleArmorEntity as BattleArmorEntity,
  TestBipedMekEntity as BipedMekEntity,
  TestDropShipEntity as DropShipEntity,
  TestInfantryEntity as InfantryEntity,
  TestQuadMekEntity as QuadMekEntity,
  TestSmallCraftEntity as SmallCraftEntity,
  TestSupportNavalEntity as SupportNavalEntity,
  TestTankEntity as TankEntity,
  TestTripodMekEntity as TripodMekEntity,
  TestWarShipEntity as WarShipEntity,
} from '../models/entity/testing/test-entities';
import { getDefaultSpriteAssignmentKey, resolveUnitSpritePath } from './unit-sprite-resolver';
import { createEmptyUnit } from '../testing/unit-test-helpers';

const assignments: UnitSpriteAssignments = {
  exact: {
    'ATLAS AS7-D': 'meks/Atlas_D.png',
    'DEFAULT_MEDIUM': 'defaults/default_medium.png',
    'DEFAULT_HEAVY': 'defaults/default_heavy.png',
    'DEFAULT_ASSAULT': 'defaults/default_assault.png',
    'DEFAULT_QUAD': 'defaults/default_quad.png',
    'DEFAULT_TRIPOD': 'defaults/default_tripod.png',
    'DEFAULT_TRACKED': 'defaults/default_tracked.png',
    'DEFAULT_TRACKED_HEAVY': 'defaults/default_tracked_heavy.png',
    'DEFAULT_TRACKED_ASSAULT': 'defaults/default_tracked_assault.png',
    'DEFAULT_NAVAL': 'defaults/default_naval.png',
    'DEFAULT_BA': 'defaults/default_ba.png',
    'DEFAULT_INFANTRY': 'defaults/default_infantry_platoon.png',
    'DEFAULT_AERO': 'defaults/asf.png',
    'DEFAULT_SMALL_CRAFT_AERO': 'dropships/shuttle.png',
    'DEFAULT_SMALL_CRAFT_SPHERE': 'dropships/sphere.png',
    'DEFAULT_DROPSHIP_AERO': 'dropships/leopard.png',
    'DEFAULT_DROPSHIP_SPHERE': 'defaults/dropship_spheroid.png',
    'DEFAULT_WARSHIP': 'warships/Naga.png',
  },
  chassis: {
    'ATLAS': 'meks/Atlas.png',
  },
};

describe('unit sprite resolver', () => {
  const thunderbirdAssignments: UnitSpriteAssignments = {
    ...assignments,
    chassis: { THUNDERBIRD: 'fighter/Thunderbird THB-D36.png' },
  };

  it('gives a Mek named Thunderbird its Mek fallback while retaining the aerospace name match', () => {
    const mek = new BipedMekEntity();
    mek.chassis.set('thunderbird');
    mek.model.set('Custom');
    mek.setTonnage(50);
    expect(resolveUnitSpritePath(mek, thunderbirdAssignments)).toBe('defaults/default_medium.png');
    const aero = new AeroEntity();
    aero.chassis.set('Thunderbird');
    expect(resolveUnitSpritePath(aero, thunderbirdAssignments)).toBe('fighter/Thunderbird THB-D36.png');
  });

  it('replaces wrong-type cached summary icons and keeps compatible choices and defaults', () => {
    const summary = createEmptyUnit({
      chassis: 'Thunderbird', model: 'Custom', entityType: 'Mek', moveType: 'Biped', weightClass: 'Medium',
      icon: 'fighter/Thunderbird THB-D36.png',
    });
    expect(resolveUnitSpritePath(summary, thunderbirdAssignments)).toBe('defaults/default_medium.png');
    summary.icon = 'defaults/asf.png';
    expect(resolveUnitSpritePath(summary, thunderbirdAssignments)).toBe('defaults/default_medium.png');
    summary.icon = 'meks/Atlas.png';
    expect(resolveUnitSpritePath(summary, thunderbirdAssignments)).toBe('meks/Atlas.png');
    summary.icon = 'defaults/default_medium.png';
    expect(resolveUnitSpritePath(summary, thunderbirdAssignments)).toBe('defaults/default_medium.png');
  });

  it('prefers an explicit sprite and resumes automatic assignment when cleared', () => {
    const entity = new BipedMekEntity();
    entity.chassis.set('Atlas');
    entity.model.set('AS7-D');
    entity.iconPath.set('vehicles/custom.png');
    expect(resolveUnitSpritePath(entity, assignments)).toBe('vehicles/custom.png');
    expect(resolveUnitSpritePath(entity, undefined)).toBe('vehicles/custom.png');
    entity.iconPath.set('');
    expect(resolveUnitSpritePath(entity, assignments)).toBe('meks/Atlas_D.png');
  });

  it('skips missing sprites through automatic assignment and the unit-type default', () => {
    const entity = new BipedMekEntity();
    entity.chassis.set('Atlas');
    entity.model.set('AS7-D');
    entity.setTonnage(50);
    entity.iconPath.set('missing.png');
    expect(resolveUnitSpritePath(entity, assignments, path => path !== 'missing.png')).toBe('meks/Atlas_D.png');
    expect(resolveUnitSpritePath(entity, assignments, path => path.startsWith('defaults/')))
      .toBe('defaults/default_medium.png');
  });

  it('uses exact unit mappings before chassis mappings', () => {
    const entity = new BipedMekEntity();
    entity.chassis.set('Atlas');
    entity.model.set('AS7-D');

    expect(resolveUnitSpritePath(entity, assignments)).toBe('meks/Atlas_D.png');
  });

  it('uses the full chassis mapping when no exact unit mapping exists', () => {
    const entity = new BipedMekEntity();
    entity.chassis.set('Atlas');
    entity.model.set('AS7-RS');

    expect(resolveUnitSpritePath(entity, assignments)).toBe('meks/Atlas.png');
  });

  it('matches Java keys case-insensitively while preserving punctuation and whitespace', () => {
    const entity = new BipedMekEntity();
    entity.chassis.set('atlas');
    entity.model.set('as7-d');

    expect(resolveUnitSpritePath(entity, assignments)).toBe('meks/Atlas_D.png');

    entity.model.set(' as7-d');
    expect(resolveUnitSpritePath(entity, assignments)).toBe('meks/Atlas.png');
  });

  it('includes the alternate Clan chassis name in exact and chassis keys', () => {
    const entity = new BipedMekEntity();
    entity.chassis.set('Mad Cat');
    entity.clanName.set('Timber Wolf');
    entity.model.set('Prime');
    const clanAssignments: UnitSpriteAssignments = {
      exact: { 'MAD CAT (TIMBER WOLF) PRIME': 'meks/TimberWolfPrime.png' },
      chassis: { 'MAD CAT (TIMBER WOLF)': 'meks/TimberWolf.png' },
    };

    expect(resolveUnitSpritePath(entity, clanAssignments)).toBe('meks/TimberWolfPrime.png');

    entity.model.set('A');
    expect(resolveUnitSpritePath(entity, clanAssignments)).toBe('meks/TimberWolf.png');
  });

  it('falls back by Mek configuration and weight class', () => {
    const medium = new BipedMekEntity();
    medium.setTonnage(50);
    expect(getDefaultSpriteAssignmentKey(medium)).toBe('default_medium');
    expect(resolveUnitSpritePath(medium, assignments)).toBe('defaults/default_medium.png');

    const quad = new QuadMekEntity();
    expect(getDefaultSpriteAssignmentKey(quad)).toBe('default_quad');
    expect(resolveUnitSpritePath(quad, assignments)).toBe('defaults/default_quad.png');

    const tripod = new TripodMekEntity();
    expect(getDefaultSpriteAssignmentKey(tripod)).toBe('default_tripod');
    expect(resolveUnitSpritePath(tripod, assignments)).toBe('defaults/default_tripod.png');
  });

  it('falls back by vehicle movement and Java weight-class rules', () => {
    const tracked = new TankEntity();
    tracked.motiveType.set('Tracked');
    tracked.setTonnage(65);
    expect(getDefaultSpriteAssignmentKey(tracked)).toBe('default_tracked_heavy');
    expect(resolveUnitSpritePath(tracked, assignments)).toBe('defaults/default_tracked_heavy.png');

    tracked.setTonnage(90);
    expect(getDefaultSpriteAssignmentKey(tracked)).toBe('default_tracked_assault');
    expect(resolveUnitSpritePath(tracked, assignments)).toBe('defaults/default_tracked_assault.png');

    const naval = new SupportNavalEntity();
    naval.motiveType.set('Naval');
    expect(getDefaultSpriteAssignmentKey(naval)).toBe('default_naval');
    expect(resolveUnitSpritePath(naval, assignments)).toBe('defaults/default_naval.png');
  });

  it('falls back for infantry and aerospace families', () => {
    expect(resolveUnitSpritePath(new BattleArmorEntity(), assignments)).toBe('defaults/default_ba.png');
    expect(resolveUnitSpritePath(new InfantryEntity(), assignments)).toBe('defaults/default_infantry_platoon.png');
    expect(resolveUnitSpritePath(new AeroEntity(), assignments)).toBe('defaults/asf.png');
    expect(resolveUnitSpritePath(new WarShipEntity(), assignments)).toBe('warships/Naga.png');
  });

  it('selects aerodyne and spheroid craft defaults', () => {
    const smallCraft = new SmallCraftEntity();
    smallCraft.motiveType.set('Aerodyne');
    expect(resolveUnitSpritePath(smallCraft, assignments)).toBe('dropships/shuttle.png');
    smallCraft.motiveType.set('Spheroid');
    expect(resolveUnitSpritePath(smallCraft, assignments)).toBe('dropships/sphere.png');

    const dropShip = new DropShipEntity();
    dropShip.motiveType.set('Aerodyne');
    expect(resolveUnitSpritePath(dropShip, assignments)).toBe('dropships/leopard.png');
    dropShip.motiveType.set('Spheroid');
    expect(resolveUnitSpritePath(dropShip, assignments)).toBe('defaults/dropship_spheroid.png');
  });

  it('returns an empty path when assignments or the selected default are unavailable', () => {
    expect(resolveUnitSpritePath(new BipedMekEntity(), undefined)).toBe('');
    expect(resolveUnitSpritePath(new BipedMekEntity(), { exact: {}, chassis: {} })).toBe('');
  });
});
