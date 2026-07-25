import { MountedArmor, MountedEngine } from '../../components';
import { locationArmor } from '../../types';
import { ArmorEquipment } from '../../../equipment.model';
import {
  TestAeroSpaceFighterEntity as AeroSpaceFighterEntity,
  TestBattleArmorEntity as BattleArmorEntity,
  TestBipedMekEntity as BipedMekEntity,
  TestDropShipEntity as DropShipEntity,
  TestInfantryEntity as InfantryEntity,
  TestLamEntity as LamEntity,
  TestSupportTankEntity as SupportTankEntity,
  TestWarShipEntity as WarShipEntity,
} from '../../testing/test-entities';
import { convertEntityToAlphaStrike, tmmForMovement } from './alpha-strike-converter';

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

  it('converts every TMM boundary', () => {
    expect([4, 5, 8, 9, 12, 13, 18, 19, 34, 35].map(tmmForMovement))
      .toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
  });
});