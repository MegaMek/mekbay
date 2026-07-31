import { ArmorEquipment } from '../../../../equipment.model';
import { MountedArmor, MountedEngine } from '../../../components';
import {
  TestAeroSpaceFighterEntity as AeroSpaceFighterEntity,
  TestBattleArmorEntity as BattleArmorEntity,
  TestBipedMekEntity as BipedMekEntity,
  TestHandheldWeaponEntity as HandheldWeaponEntity,
  TestSupportNavalEntity as SupportNavalEntity,
  TestWarShipEntity as WarShipEntity,
} from '../../../testing/test-entities';
import { locationArmor } from '../../../types';
import {
  alphaStrikeArmor,
  alphaStrikeRoundUp,
  alphaStrikeStructure,
  alphaStrikeThreshold,
} from './integrity';

describe('Alpha Strike integrity conversion', () => {
  it('applies armor material modifiers before normal rounding', () => {
    const entity = new BipedMekEntity();
    entity.setUniformArmor(new MountedArmor({
      armor: new ArmorEquipment({
        id: 'hardened', name: 'Hardened Armor', type: 'armor', armor: { type: 'HARDENED' },
      }),
      techBase: 'IS',
    }));
    entity.armorValues.set(new Map([['CT', locationArmor(30)]]));

    expect(alphaStrikeArmor(entity)).toBe(2);
  });

  it('converts capital armor at the inherited capital scale', () => {
    const entity = new WarShipEntity();
    entity.armorValues.set(new Map([['Nose', locationArmor(600)]]));

    expect(alphaStrikeArmor(entity)).toBe(198);
  });

  it('uses Mek engine and weight structure tables', () => {
    const entity = new BipedMekEntity();
    entity.setTonnage(100);
    entity.mountedEngine.set(new MountedEngine({
      type: 'Fusion', rating: 300, techBase: 'IS', installed: true,
    }));

    expect(alphaStrikeStructure(entity)).toBe(8);
  });

  it('converts Battle Armor and aerospace structure', () => {
    const battleArmor = new BattleArmorEntity();
    const fighter = new AeroSpaceFighterEntity();
    fighter.structuralIntegrity.set(7);

    expect(alphaStrikeStructure(battleArmor)).toBe(2);
    expect(alphaStrikeStructure(fighter)).toBe(4);
  });

  it('uses naval support-vehicle structure divisors at boundaries', () => {
    const entity = new SupportNavalEntity();
    entity.motiveType.set('Naval');
    entity.setTonnage(500.5);

    expect(alphaStrikeStructure(entity)).toBe(Math.ceil(entity.totalInternalPoints() / 20));
  });

  it('returns the unsupported integrity sentinel', () => {
    expect(alphaStrikeStructure(new HandheldWeaponEntity())).toBe(-1);
  });

  it('uses Java-compatible threshold rounding for fighter and four-arc units', () => {
    expect(alphaStrikeRoundUp(0)).toBe(0);
    expect(alphaStrikeRoundUp(0.5)).toBe(1);
    expect(alphaStrikeThreshold(2, true)).toBe(1);
    expect(alphaStrikeThreshold(10, false)).toBe(1);
  });
});
