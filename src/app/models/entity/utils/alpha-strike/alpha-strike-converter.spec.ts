// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { MountedArmor } from '../../components';
import { locationArmor } from '../../types';
import { AmmoEquipment, ArmorEquipment, WeaponEquipment } from '../../../equipment.model';
import {
  TestAeroSpaceFighterEntity as AeroSpaceFighterEntity,
  TestBattleArmorEntity as BattleArmorEntity,
  TestBipedMekEntity as BipedMekEntity,
  TestConvFighterEntity as ConvFighterEntity,
  TestDropShipEntity as DropShipEntity,
  TestFixedWingSupportEntity as FixedWingSupportEntity,
  TestInfantryEntity as InfantryEntity,
  TestJumpShipEntity as JumpShipEntity,
  TestLamEntity as LamEntity,
  TestSmallCraftEntity as SmallCraftEntity,
  TestSpaceStationEntity as SpaceStationEntity,
  TestSupportTankEntity as SupportTankEntity,
  TestTankEntity as TankEntity,
  TestVtolEntity as VtolEntity,
  TestWarShipEntity as WarShipEntity,
} from '../../testing/test-entities';
import { addTestEquipment, addTestEquipmentWithFlags } from '../../testing/test-mounted-equipment';
import {
  convertEntityToAlphaStrike,
  convertEntityToAlphaStrikeWithReport,
  tmmForMovement,
} from './alpha-strike-converter';

describe('Alpha Strike conversion', () => {
  it('converts Meks through the canonical entity calculation surface', () => {
    expect(convertEntityToAlphaStrike(new BipedMekEntity()).TP).toBe('BM');
    expect(convertEntityToAlphaStrike(new LamEntity()).TP).toBe('BM');
  });

  it('applies armor material modifiers before rounding', () => {
    const entity = new TankEntity();
    entity.setTonnage(50);
    entity.setUniformArmor(new MountedArmor({
      armor: new ArmorEquipment({
        id: 'Hardened Armor', name: 'Hardened Armor', type: 'armor',
        armor: { type: 'HARDENED' },
      }),
      techBase: 'IS',
    }));
    entity.armorValues.set(new Map([['CT', locationArmor(30)]]));

    expect(convertEntityToAlphaStrike(entity).Arm).toBe(2);
  });

  it('converts Battle Armor points for the whole squad', () => {
    const entity = new BattleArmorEntity();
    entity.squadSize.set(5);
    entity.armorValues.set(new Map([['Squad', locationArmor(8)]]));

    const result = convertEntityToAlphaStrike(entity);

    expect(result.TP).toBe('BA');
    expect(result.Arm).toBe(1);
    expect(result.Str).toBe(2);
  });

  it('uses minimum movement for immobile conventional infantry', () => {
    const entity = new InfantryEntity();
    entity.originalWalkMP.set(0);
    entity.motiveType.set('Leg');

    const result = convertEntityToAlphaStrike(entity);

    expect(result.MVm).toEqual({ f: 2 });
    expect(result.MV).toBe('2\"f');
    expect(result.TMM).toBe(0);
  });

  it('uses fighter threshold and null exported TMM', () => {
    const entity = new AeroSpaceFighterEntity();
    entity.setTonnage(75);
    entity.originalWalkMP.set(5);
    entity.armorValues.set(new Map([['Nose', locationArmor(60)]]));

    const result = convertEntityToAlphaStrike(entity);

    expect(result.TP).toBe('AF');
    expect(result.TMM).toBeNull();
    expect(result.Arm).toBe(2);
    expect(result.Th).toBe(1);
    expect(result.usesE).toBe(true);
  });

  it('derives Alpha Strike VSTOL from entity family, conventional-fighter state, or fixed-wing chassis equipment', () => {
    const aerospaceFighter = new AeroSpaceFighterEntity();
    expect(convertEntityToAlphaStrike(aerospaceFighter).specials).toContain('VSTOL');

    const conventionalFighter = new ConvFighterEntity();
    expect(convertEntityToAlphaStrike(conventionalFighter).specials).not.toContain('VSTOL');
    conventionalFighter.vstol.set(true);
    expect(convertEntityToAlphaStrike(conventionalFighter).specials).toContain('VSTOL');

    const fixedWingSupport = new FixedWingSupportEntity();
    addTestEquipmentWithFlags(fixedWingSupport, 'F_STOL_CHASSIS', { location: 'Body' });
    expect(convertEntityToAlphaStrike(fixedWingSupport).specials).toContain('VSTOL');
  });

  it('grants ATMO to VTOL combat vehicles only', () => {
    expect(convertEntityToAlphaStrike(new VtolEntity()).specials).toContain('ATMO');
    expect(convertEntityToAlphaStrike(new SupportTankEntity()).specials).not.toContain('ATMO');
  });

  it('grants SPC to aerospace fighters and large aerospace, but not atmospheric fighters', () => {
    const aerospaceFighter = new AeroSpaceFighterEntity();
    expect(convertEntityToAlphaStrike(aerospaceFighter).specials).toContain('SPC');

    for (const entity of [
      new SmallCraftEntity(), new DropShipEntity(), new JumpShipEntity(),
      new SpaceStationEntity(), new WarShipEntity(),
    ]) {
      expect(convertEntityToAlphaStrike(entity).specials).toContain('SPC');
    }

    expect(convertEntityToAlphaStrike(new ConvFighterEntity()).specials).not.toContain('SPC');
    expect(convertEntityToAlphaStrike(new FixedWingSupportEntity()).specials).not.toContain('SPC');
  });

  it('derives fighter BOMB and aerospace-fighter FUEL from family, size, and fuel', () => {
    const aerospaceFighter = new AeroSpaceFighterEntity();
    aerospaceFighter.setTonnage(75);
    aerospaceFighter.fuel.set(30);
    expect(convertEntityToAlphaStrike(aerospaceFighter).specials)
      .toEqual(jasmine.arrayContaining(['BOMB3', 'FUEL2']));

    const conventionalFighter = new ConvFighterEntity();
    conventionalFighter.setTonnage(50);
    expect(convertEntityToAlphaStrike(conventionalFighter).specials).toContain('BOMB2');
    expect(convertEntityToAlphaStrike(conventionalFighter).specials).not.toContain('FUEL0');
  });

  it('derives fixed-wing support BOMB from its bomb capacity', () => {
    const entity = new FixedWingSupportEntity();
    addTestEquipmentWithFlags(entity, 'F_EXTERNAL_STORES_HARDPOINT');
    addTestEquipmentWithFlags(entity, 'F_EXTERNAL_STORES_HARDPOINT');
    addTestEquipmentWithFlags(entity, 'F_EXTERNAL_STORES_HARDPOINT');
    addTestEquipmentWithFlags(entity, 'F_EXTERNAL_STORES_HARDPOINT');
    addTestEquipmentWithFlags(entity, 'F_EXTERNAL_STORES_HARDPOINT');

    expect(convertEntityToAlphaStrike(entity).specials).toContain('BOMB1');
  });

  it('derives Java large-craft size, drive, fusion, and crew specials', () => {
    const smallCraft = new SmallCraftEntity();
    smallCraft.setTonnage(2_500);
    expect(convertEntityToAlphaStrike(smallCraft).specials).toContain('VLG');

    const dropShip = new DropShipEntity();
    dropShip.crew.set(90);
    expect(convertEntityToAlphaStrike(dropShip).specials)
      .toEqual(jasmine.arrayContaining(['CRW2', 'LG']));

    const jumpShip = new JumpShipEntity();
    jumpShip.crew.set(180);
    jumpShip.lithiumFusion.set(true);
    expect(convertEntityToAlphaStrike(jumpShip).specials)
      .toEqual(jasmine.arrayContaining(['CRW2', 'KF', 'LF']));

    jumpShip.driveCoreType.set('None');
    expect(convertEntityToAlphaStrike(jumpShip).specials).not.toContain('KF');
  });

  it('grants VSTOL to spheroid small craft intrinsically', () => {
    const entity = new SmallCraftEntity();
    entity.motiveType.set('Spheroid');

    expect(convertEntityToAlphaStrike(entity).specials).toContain('VSTOL');
  });

  it('suppresses extreme-range standard damage for ground conversion', () => {
    const weapon = new WeaponEquipment({
      id: 'long-weapon', name: 'Long Weapon', type: 'weapon',
      weapon: { av: [10, 10, 10, 10], ranges: [6, 12, 24, 30], ammoType: 'NA' },
    });
    const entity = new TankEntity();
    addTestEquipment(entity, weapon, { location: 'Front' });

    expect(convertEntityToAlphaStrike(entity).dmg.dmgE).toBe('0');
  });

  it('excludes artillery and torpedo launchers from generic standard damage', () => {
    const entity = new TankEntity();
    addTestEquipment(entity, new WeaponEquipment({
      id: 'srt-6', name: 'SRT 6', type: 'weapon',
      weapon: {
        damage: 'cluster', rackSize: 6, ranges: [3, 6, 9, 12], ammoType: 'SRM_TORPEDO',
        alphaStrike: { battleForceClass: 'TORPEDO' },
      },
    }), { location: 'RA' });
    addTestEquipment(entity, new AmmoEquipment({
      id: 'long-tom-cannon-ammo', name: 'Long Tom Cannon Ammo', type: 'ammo',
      ammo: { type: 'LONG_TOM_CANNON', rackSize: 0, shots: 20 },
    }), { location: 'RT', shotsCount: 20 });
    addTestEquipment(entity, new WeaponEquipment({
      id: 'sniper', name: 'Sniper', type: 'weapon', flags: ['F_ARTILLERY'],
      weapon: { damage: 'artillery', ranges: [6, 12, 18, 24], ammoType: 'SNIPER' },
    }), { location: 'LA' });

    expect(convertEntityToAlphaStrike(entity).dmg).toEqual({
      dmgS: '0', dmgM: '0', dmgL: '0', dmgE: '0',
    });
  });

  it('retains artillery-cannon standard damage despite its artillery flag', () => {
    const entity = new AeroSpaceFighterEntity();
    addTestEquipment(entity, new WeaponEquipment({
      id: 'long-tom-cannon', name: 'Long Tom Cannon', type: 'weapon', flags: ['F_ARTILLERY'],
      weapon: {
        damage: 'artillery', rackSize: 20, ranges: [4, 10, 20, 30], ammoType: 'LONG_TOM_CANNON',
        alphaStrike: { damage: [1.32, 3, 3, 0] },
      },
    }), { location: 'Fuselage' });
    addTestEquipment(entity, new AmmoEquipment({
      id: 'long-tom-cannon-ammo', name: 'Long Tom Cannon Ammo', type: 'ammo',
      ammo: { type: 'LONG_TOM_CANNON', rackSize: 20, shots: 20 },
    }), { location: 'Fuselage', shotsCount: 20 });

    expect(convertEntityToAlphaStrike(entity).dmg).toEqual({
      dmgS: '2', dmgM: '3', dmgL: '3', dmgE: '0',
    });
  });

  it('converts front-mounted weapon heat damage into HT after Java thresholds', () => {
    const entity = new TankEntity();
    for (let index = 0; index < 3; index++) {
      addTestEquipment(entity, new WeaponEquipment({
        id: `flamer-${index}`, name: 'Flamer', type: 'weapon', flags: ['F_FLAMER'],
        weapon: {
          heat: 3, damage: 2, ranges: [1, 2, 3, 4], ammoType: 'NA',
          alphaStrike: { heatDamage: [2, 0, 0, 0] },
        },
      }), { location: 'RA' });
    }

    expect(convertEntityToAlphaStrike(entity).specials).toContain('HT1/-/-');
  });

  it('applies the Battle Armor troop factor before deriving HT', () => {
    const entity = new BattleArmorEntity();
    addTestEquipment(entity, new WeaponEquipment({
      id: 'ba-heavy-flamer', name: 'BA Heavy Flamer', type: 'weapon',
      flags: ['F_FLAMER', 'F_BA_WEAPON'],
      weapon: {
        heat: 5, damage: 4, ranges: [2, 3, 4, 6], ammoType: 'NA',
        alphaStrike: { heatDamage: [4, 0, 0, 0] },
      },
    }), { location: 'Squad' });

    expect(convertEntityToAlphaStrike(entity).specials).toContain('HT2/-/-');
  });

  it('converts conventional-infantry field guns without a troop factor', () => {
    const fieldGun = new WeaponEquipment({
      id: 'field-gun', name: 'Field Gun', type: 'weapon',
      weapon: { damage: 10, ranges: [5, 10, 20, 24], ammoType: 'NA' },
    });
    const entity = new InfantryEntity();
    addTestEquipment(entity, fieldGun, { location: 'Field Guns' });
    addTestEquipment(entity, fieldGun, { location: 'Field Guns' });

    expect(convertEntityToAlphaStrike(entity).dmg).toEqual({
      dmgS: '2', dmgM: '2', dmgL: '2', dmgE: '0',
    });
  });

  it('derives conventional-infantry HT from its canonical primary weapon', () => {
    const entity = new InfantryEntity();
    entity.squadSize.set(30);
    entity.squadCount.set(1);
    const flamer = new WeaponEquipment({
      id: 'infantry-flamer', name: 'Infantry Flamer', type: 'weapon',
      flags: ['F_INFANTRY', 'F_FLAMER'],
      weapon: { ammoType: 'NA' },
      infantry: { damage: 1, range: 1 },
    });
    if (!flamer.isInfantryWeapon()) throw new Error('Expected infantry flamer');
    entity.primaryWeapon.set(flamer);

    expect(convertEntityToAlphaStrike(entity).specials).toContain('HT2/-/-');
  });

  it('uses field guns instead of infantry weapons when deriving infantry HT', () => {
    const entity = new InfantryEntity();
    entity.squadSize.set(30);
    entity.squadCount.set(1);
    const flamer = new WeaponEquipment({
      id: 'infantry-flamer', name: 'Infantry Flamer', type: 'weapon',
      flags: ['F_INFANTRY', 'F_FLAMER'],
      weapon: { ammoType: 'NA' }, infantry: { damage: 1, range: 1 },
    });
    if (!flamer.isInfantryWeapon()) throw new Error('Expected infantry flamer');
    entity.primaryWeapon.set(flamer);
    addTestEquipment(entity, new WeaponEquipment({
      id: 'field-ac', name: 'Field AC', type: 'weapon',
      weapon: { damage: 10, ranges: [3, 6, 9, 12], ammoType: 'AC' },
    }), { location: 'Field Guns' });

    expect(convertEntityToAlphaStrike(entity).specials).not.toContain('HT2/-/-');
  });

  it('does not treat MFUK plasma as conventional-infantry HT', () => {
    const entity = new InfantryEntity();
    entity.squadSize.set(30);
    entity.squadCount.set(1);
    const plasma = new WeaponEquipment({
      id: 'infantry-mfuk', name: 'Infantry MFUK Plasma', type: 'weapon',
      flags: ['F_INFANTRY', 'F_PLASMA_MFUK'],
      weapon: { ammoType: 'NA' }, infantry: { damage: 1, range: 1 },
    });
    if (!plasma.isInfantryWeapon()) throw new Error('Expected infantry plasma weapon');
    entity.primaryWeapon.set(plasma);

    expect(convertEntityToAlphaStrike(entity).specials).not.toContain('HT2/-/-');
  });

  it('uses four arcs for large aerospace threshold and movement', () => {
    const entity = new DropShipEntity();
    entity.setTonnage(5_000);
    entity.motiveType.set('Spheroid');
    entity.originalWalkMP.set(3);
    entity.structuralIntegrity.set(8);
    entity.armorValues.set(new Map([
      ['Nose', locationArmor(90)], ['Left Side', locationArmor(80)],
      ['Right Side', locationArmor(80)], ['Aft', locationArmor(50)],
    ]));

    const result = convertEntityToAlphaStrike(entity);

    expect(result.TP).toBe('DS');
    expect(result.MV).toBe('3p');
    expect(result.Arm).toBe(10);
    expect(result.Str).toBe(4);
    expect(result.Th).toBe(1);
    expect(result.usesArcs).toBe(true);
    expect(result.frontArc).toBeDefined();
    expect(result.frontArc?.specials).toEqual(['ENE']);
  });

  it('splits spheroid side weapons between adjacent canonical arcs', () => {
    const weapon = new WeaponEquipment({
      id: 'side-weapon', name: 'Side Weapon', type: 'weapon',
      weapon: { damage: 10, ranges: [5, 10, 20, 24], ammoType: 'NA' },
    });
    const entity = new DropShipEntity();
    entity.motiveType.set('Spheroid');
    addTestEquipment(entity, weapon, { location: 'Left Side' });

    const result = convertEntityToAlphaStrike(entity);

    expect(result.frontArc?.STD.dmgS).toBe('1');
    expect(result.leftArc?.STD.dmgS).toBe('1');
    expect(result.rightArc?.STD.dmgS).toBe('0');
    expect(result.rearArc?.STD.dmgS).toBe('0');
  });

  it('uses capital armor and WarShip structure scaling', () => {
    const entity = new WarShipEntity();
    entity.setTonnage(600_000);
    entity.structuralIntegrity.set(75);
    entity.armorValues.set(new Map([['Nose', locationArmor(600)]]));

    const result = convertEntityToAlphaStrike(entity);

    expect(result.TP).toBe('WS');
    expect(result.Arm).toBe(198);
    expect(result.Str).toBe(75);
  });

  it('uses support-vehicle size thresholds', () => {
    const entity = new SupportTankEntity();
    entity.motiveType.set('Tracked');
    entity.setTonnage(201);

    const result = convertEntityToAlphaStrike(entity);

    expect(result.TP).toBe('SV');
    expect(result.SZ).toBe(4);
    expect(result.usesArcs).toBe(true);
  });

  it('keeps generic damage when a large support vehicle exports final arcs', () => {
    const weapon = new WeaponEquipment({
      id: 'test-laser', name: 'Test Laser', type: 'weapon',
      weapon: { damage: 10, ranges: [3, 6, 9, 12], ammoType: 'NA' },
    });
    const entity = new SupportTankEntity();
    entity.setTonnage(201);
    entity.addEquipment({
      equipmentId: weapon.id,
      equipment: weapon,
      allocation: { kind: 'location', location: 'Front' },
      rearMounted: false,
      turretMounted: false,
      omniPodMounted: false,
      armored: false,
    });

    const result = convertEntityToAlphaStrike(entity);

    expect(result.usesArcs).toBe(true);
    expect(result.dmg.dmgS).toBe('1');
    expect(result.frontArc?.STD.dmgS).toBe('0');
    expect(result.leftArc?.specials).toEqual([]);
  });

  it('duplicates vehicle turret damage globally and in a TUR damage vector', () => {
    const entity = new VtolEntity();
    addTestEquipment(entity, new WeaponEquipment({
      id: 'turret-laser', name: 'Turret Laser', type: 'weapon',
      weapon: { damage: 10, rackSize: 0, ranges: [5, 10, 15, 20], ammoType: 'NA' },
    }), { location: 'Turret' });

    const result = convertEntityToAlphaStrike(entity);

    expect(result.dmg).toEqual({ dmgS: '1', dmgM: '1', dmgL: '0', dmgE: '0' });
    expect(result.specials).toContain('TUR(1/1/-)');
  });

  it('preserves sub-minimum turret damage as 0* and omits absent turret damage', () => {
    const entity = new VtolEntity();
    addTestEquipment(entity, new WeaponEquipment({
      id: 'light-turret-laser', name: 'Light Turret Laser', type: 'weapon',
      weapon: { damage: 1, rackSize: 0, ranges: [5, 10, 15, 20], ammoType: 'NA' },
    }), { location: 'Turret' });

    expect(convertEntityToAlphaStrike(entity).specials).toContain('TUR(0*/0*/-)');
    expect(convertEntityToAlphaStrike(new VtolEntity()).specials.some(special => special.startsWith('TUR('))).toBeFalse();
  });

  it('serializes ability-only and combined nested TUR contents deterministically', () => {
    const amsEntity = new VtolEntity();
    addTestEquipment(amsEntity, new WeaponEquipment({
      id: 'turret-ams', name: 'Turret AMS', type: 'weapon', flags: ['F_AMS'],
      weapon: { damage: 0, rackSize: 0, ranges: [0, 0, 0, 0], ammoType: 'NA' },
    }), { location: 'Turret' });
    expect(convertEntityToAlphaStrike(amsEntity).specials).toContain('TUR(AMS)');

    const entity = new VtolEntity();
    addTestEquipment(entity, new WeaponEquipment({
      id: 'turret-lrm', name: 'Turret LRM', type: 'weapon',
      flags: ['F_LRM', 'F_MISSILE', 'F_TAG', 'F_INDIRECT_FIRE'],
      weapon: {
        damage: 'cluster', rackSize: 20, ranges: [7, 14, 21, 28], ammoType: 'LRM',
        alphaStrike: { battleForceClass: 'LRM' },
      },
    }), { location: 'Turret' });
    addTestEquipment(entity, new WeaponEquipment({
      id: 'turret-flamer', name: 'Turret Flamer', type: 'weapon', flags: ['F_FLAMER'],
      weapon: {
        damage: 1, rackSize: 0, ranges: [1, 1, 1, 1], ammoType: 'NA',
        alphaStrike: { heatDamage: [2, 0, 0, 0] },
      },
    }), { location: 'Turret' });
    addTestEquipment(entity, new WeaponEquipment({
      id: 'turret-flamer-2', name: 'Turret Flamer 2', type: 'weapon', flags: ['F_FLAMER'],
      weapon: {
        damage: 1, rackSize: 0, ranges: [1, 1, 1, 1], ammoType: 'NA',
        alphaStrike: { heatDamage: [2, 0, 0, 0] },
      },
    }), { location: 'Turret' });
    addTestEquipment(entity, new WeaponEquipment({
      id: 'turret-flamer-3', name: 'Turret Flamer 3', type: 'weapon', flags: ['F_FLAMER'],
      weapon: {
        damage: 1, rackSize: 0, ranges: [1, 1, 1, 1], ammoType: 'NA',
        alphaStrike: { heatDamage: [2, 0, 0, 0] },
      },
    }), { location: 'Turret' });
    addTestEquipment(entity, new AmmoEquipment({
      id: 'turret-lrm-ammo', name: 'Turret LRM Ammo', type: 'ammo',
      ammo: { type: 'LRM', rackSize: 20, shots: 20 },
    }), { location: 'Body', shotsCount: 20 });

    expect(convertEntityToAlphaStrike(entity).specials).toContain('TUR(2/2/2,HT1/-/-,IF1,LRM1/1/1,TAG)');
  });

  it('converts every TMM boundary', () => {
    expect([4, 5, 8, 9, 12, 13, 18, 19, 34, 35].map(tmmForMovement))
      .toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
  });

  it('merges core special abilities into exported stats and conversion reports', () => {
    const entity = new TankEntity();
    entity.omni.set(true);
    addTestEquipmentWithFlags(entity, ['F_ECM', 'F_ANGEL_ECM']);
    addTestEquipmentWithFlags(entity, 'F_BAP');

    const converted = convertEntityToAlphaStrikeWithReport(entity);

    expect(converted.stats.PV).toBeGreaterThan(0);
    expect(converted.stats.specials).toEqual(['AECM', 'ENE', 'OMNI', 'PRB', 'RCN', 'SRCH']);
    expect(converted.report).toContain('Further Special Abilities:\n');
    expect(converted.report).toContain('AECM\n');
    expect(converted.report).toContain('RCN\n');
  });

  it('returns the same stats through the report API', () => {
    const entity = new TankEntity();
    entity.chassis.set('Atlas');
    entity.model.set('AS7-D');
    entity.role.set('Juggernaut');
    entity.mulId.set(140);
    entity.setTonnage(100);

    const direct = convertEntityToAlphaStrike(entity);
    const converted = convertEntityToAlphaStrikeWithReport(entity);

    expect(converted.stats).toEqual(direct);
    expect(converted.reportEvents.length).toBeGreaterThan(0);
    expect(converted.report).toContain('Alpha Strike Conversion for Atlas AS7-D\n');
    expect(converted.report).toContain('Basic Info:\n');
    expect(converted.report).toContain('Damage Conversion:\n');
    expect(converted.report).toContain('Point Value:\n');
    expect(converted.report.endsWith('\n')).toBe(true);
  });

  it('uses two report headers for a name at the long-name boundary', () => {
    const entity = new TankEntity();
    entity.chassis.set('123456789012345');

    const { reportEvents } = convertEntityToAlphaStrikeWithReport(entity);

    expect(reportEvents.slice(0, 2)).toEqual([
      { kind: 'header', text: 'Alpha Strike Conversion for' },
      { kind: 'header', text: '123456789012345' },
    ]);
  });

  it('uses the default Gunnery skill of four in conversion reports', () => {
    const entity = new TankEntity();

    const { reportEvents } = convertEntityToAlphaStrikeWithReport(entity);

    expect(reportEvents).toContain(jasmine.objectContaining({
      kind: 'line', type: 'Skill:', result: '4',
    }));
  });

  it('uses an overridden Gunnery skill in conversion reports', () => {
    const entity = new TankEntity();

    const { reportEvents } = convertEntityToAlphaStrikeWithReport(entity, { skill: 2 });

    expect(reportEvents).toContain(jasmine.objectContaining({
      kind: 'line', type: 'Skill:', result: '2',
    }));
  });

  it('rejects an invalid Alpha Strike skill', () => {
    const entity = new TankEntity();

    expect(() => convertEntityToAlphaStrike(entity, { skill: -1 }))
      .toThrowError(RangeError, 'Alpha Strike skill must be a non-negative integer.');
    expect(() => convertEntityToAlphaStrike(entity, { skill: 2.5 }))
      .toThrowError(RangeError, 'Alpha Strike skill must be a non-negative integer.');
  });

  it('omits the TMM report row for aerospace and supports CRLF output', () => {
    const entity = new AeroSpaceFighterEntity();
    entity.chassis.set('Sabre');

    const converted = convertEntityToAlphaStrikeWithReport(entity, { eol: '\r\n' });
    const tmmRows = converted.reportEvents.filter(event =>
      event.kind === 'line' && event.type === 'TMM');

    expect(tmmRows).toEqual([]);
    expect(converted.report).toContain('\r\n');
    expect(converted.report.replaceAll('\r\n', '')).not.toContain('\n');
  });
});
