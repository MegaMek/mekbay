import { MountedArmor, MountedEngine } from '../../components';
import { locationArmor } from '../../types';
import { ArmorEquipment, WeaponEquipment } from '../../../equipment.model';
import {
  TestAeroSpaceFighterEntity as AeroSpaceFighterEntity,
  TestBattleArmorEntity as BattleArmorEntity,
  TestBipedMekEntity as BipedMekEntity,
  TestConvFighterEntity as ConvFighterEntity,
  TestDropShipEntity as DropShipEntity,
  TestFixedWingSupportEntity as FixedWingSupportEntity,
  TestInfantryEntity as InfantryEntity,
  TestLamEntity as LamEntity,
  TestSmallCraftEntity as SmallCraftEntity,
  TestSupportTankEntity as SupportTankEntity,
  TestWarShipEntity as WarShipEntity,
} from '../../testing/test-entities';
import { addTestEquipment, addTestEquipmentWithFlags } from '../../testing/test-mounted-equipment';
import {
  convertEntityToAlphaStrike,
  convertEntityToAlphaStrikeWithReport,
  tmmForMovement,
} from './alpha-strike-converter';

describe('Alpha Strike conversion', () => {
  it('converts a basic BattleMek foundation', () => {
    const entity = new BipedMekEntity();
    entity.setTonnage(100);
    entity.originalWalkMP.set(3);
    entity.mountedEngine.set(new MountedEngine({
      type: 'Fusion', rating: 300, techBase: 'IS', installed: true,
    }));
    entity.armorValues.set(new Map([
      ['HD', locationArmor(9)], ['CT', locationArmor(47, 15)],
      ['LT', locationArmor(32, 10)], ['RT', locationArmor(32, 10)],
      ['LA', locationArmor(34)], ['RA', locationArmor(34)],
      ['LL', locationArmor(41)], ['RL', locationArmor(41)],
    ]));

    const result = convertEntityToAlphaStrike(entity);

    expect(result.TP).toBe('BM');
    expect(result.SZ).toBe(4);
    expect(result.MVm).toEqual({ '': 6 });
    expect(result.MV).toBe('6\"');
    expect(result.MVp).toBe('');
    expect(result.TMM).toBe(1);
    expect(result.Arm).toBe(10);
    expect(result.Str).toBe(8);
    expect(result.usesOV).toBe(true);
    expect(result.usesArcs).toBe(false);
    expect(result.Th).toBe(-1);
  });

  it('applies armor material modifiers before rounding', () => {
    const entity = new BipedMekEntity();
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

  it('adds LAM special movement without changing primary movement', () => {
    const entity = new LamEntity();
    entity.setTonnage(50);
    entity.originalWalkMP.set(5);
    entity.lamType.set('Standard');

    const result = convertEntityToAlphaStrike(entity);

    expect(result.MVp).toBe('');
    expect(result.MVm).toEqual({ '': 10, a: 0, g: 0 });
    expect(result.MV).toBe('10\"');
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
    const entity = new BipedMekEntity();
    addTestEquipment(entity, weapon, { location: 'RA' });

    expect(convertEntityToAlphaStrike(entity).dmg.dmgE).toBe('0');
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

  it('converts every TMM boundary', () => {
    expect([4, 5, 8, 9, 12, 13, 18, 19, 34, 35].map(tmmForMovement))
      .toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
  });

  it('merges core special abilities into exported stats and conversion reports', () => {
    const entity = new BipedMekEntity();
    entity.omni.set(true);
    addTestEquipmentWithFlags(entity, ['F_ECM', 'F_ANGEL_ECM']);
    addTestEquipmentWithFlags(entity, 'F_BAP');

    const converted = convertEntityToAlphaStrikeWithReport(entity);

    expect(converted.stats.PV).toBe(0);
    expect(converted.stats.specials).toEqual(['AECM', 'ENE', 'OMNI', 'PRB', 'RCN']);
    expect(converted.report).toContain('Further Special Abilities:\n');
    expect(converted.report).toContain('AECM\n');
    expect(converted.report).toContain('RCN\n');
  });

  it('returns the same stats through the report API', () => {
    const entity = new BipedMekEntity();
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
    const entity = new BipedMekEntity();
    entity.chassis.set('123456789012345');

    const { reportEvents } = convertEntityToAlphaStrikeWithReport(entity);

    expect(reportEvents.slice(0, 2)).toEqual([
      { kind: 'header', text: 'Alpha Strike Conversion for' },
      { kind: 'header', text: '123456789012345' },
    ]);
  });

  it('uses the default Gunnery skill of four in conversion reports', () => {
    const entity = new BipedMekEntity();

    const { reportEvents } = convertEntityToAlphaStrikeWithReport(entity);

    expect(reportEvents).toContain(jasmine.objectContaining({
      kind: 'line', type: 'Skill:', result: '4',
    }));
  });

  it('uses an overridden Gunnery skill in conversion reports', () => {
    const entity = new BipedMekEntity();

    const { reportEvents } = convertEntityToAlphaStrikeWithReport(entity, { skill: 2 });

    expect(reportEvents).toContain(jasmine.objectContaining({
      kind: 'line', type: 'Skill:', result: '2',
    }));
  });

  it('rejects an invalid Alpha Strike skill', () => {
    const entity = new BipedMekEntity();

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