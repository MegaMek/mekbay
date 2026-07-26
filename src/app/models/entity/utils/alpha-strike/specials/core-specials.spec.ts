import { MountedArmor } from '../../../components';
import { ArmorEquipment, WeaponEquipment } from '../../../../equipment.model';
import {
  TestAeroSpaceFighterEntity as AeroSpaceFighterEntity,
  TestBattleArmorEntity as BattleArmorEntity,
  TestBipedMekEntity as BipedMekEntity,
  TestDropShipEntity as DropShipEntity,
  TestProtoMekEntity as ProtoMekEntity,
  TestTankEntity as TankEntity,
} from '../../../testing/test-entities';
import { addTestEquipment, addTestEquipmentWithFlags } from '../../../testing/test-mounted-equipment';
import { alphaStrikeCoreSpecials } from './core-specials';

const GROUND_CONTEXT = { type: 'BM' as const, hasStandardDamage: true };

function stealthArmor(type = 'STEALTH'): MountedArmor {
  return new MountedArmor({
    armor: new ArmorEquipment({ id: type, name: type, type: 'armor', armor: { type } }),
    techBase: 'IS',
  });
}

describe('Alpha Strike core specials', () => {
  it('adds ENE when an eligible unit has no explosive components', () => {
    expect(alphaStrikeCoreSpecials(new BipedMekEntity(), GROUND_CONTEXT)).toEqual(['ENE']);
  });

  it('suppresses ENE for an installed explosive weapon', () => {
    const entity = new BipedMekEntity();
    addTestEquipment(entity, new WeaponEquipment({
      id: 'explosive', name: 'Explosive Weapon', type: 'weapon', stats: { explosive: true },
      weapon: { explosionDamage: 10, ammoType: 'NA' },
    }));

    expect(alphaStrikeCoreSpecials(entity, GROUND_CONTEXT)).toEqual([]);
  });

  it('ignores unallocated explosive components for ENE', () => {
    const entity = new BipedMekEntity();
    addTestEquipment(entity, new WeaponEquipment({
      id: 'unallocated-explosive', name: 'Unallocated Explosive Weapon', type: 'weapon',
      stats: { explosive: true }, weapon: { explosionDamage: 10, ammoType: 'NA' },
    }), { allocation: { kind: 'unallocated' } });

    expect(alphaStrikeCoreSpecials(entity, GROUND_CONTEXT)).toEqual(['ENE']);
  });

  it('applies CASE precedence and removes all CASE variants when ENE applies', () => {
    const protectedEntity = new BipedMekEntity();
    addTestEquipment(protectedEntity, new WeaponEquipment({
      id: 'explosive', name: 'Explosive Weapon', type: 'weapon', stats: { explosive: true },
      weapon: { explosionDamage: 10, ammoType: 'NA' },
    }));
    addTestEquipmentWithFlags(protectedEntity, 'F_CASE');
    addTestEquipmentWithFlags(protectedEntity, 'F_CASE_II');
    addTestEquipmentWithFlags(protectedEntity, 'F_CASE_P');
    expect(alphaStrikeCoreSpecials(protectedEntity, GROUND_CONTEXT)).toEqual(['CASEII', 'CASEP']);

    const nonExplosiveEntity = new BipedMekEntity();
    addTestEquipmentWithFlags(nonExplosiveEntity, 'F_CASE');
    addTestEquipmentWithFlags(nonExplosiveEntity, 'F_CASE_II');
    addTestEquipmentWithFlags(nonExplosiveEntity, 'F_CASE_P');
    expect(alphaStrikeCoreSpecials(nonExplosiveEntity, GROUND_CONTEXT)).toEqual(['ENE']);
  });

  it('grants Clan units CASE only when they contain an explosive component', () => {
    const entity = new BipedMekEntity();
    entity.techBase.set('Clan');
    addTestEquipment(entity, new WeaponEquipment({
      id: 'explosive', name: 'Explosive Weapon', type: 'weapon', stats: { explosive: true },
      weapon: { explosionDamage: 10, ammoType: 'NA' },
    }));

    expect(alphaStrikeCoreSpecials(entity, GROUND_CONTEXT)).toEqual(['CASE']);
  });

  it('does not grant CASE to families that are ineligible for it', () => {
    const fighter = new AeroSpaceFighterEntity();
    fighter.techBase.set('Clan');
    addTestEquipment(fighter, new WeaponEquipment({
      id: 'explosive', name: 'Explosive Weapon', type: 'weapon', stats: { explosive: true },
      weapon: { explosionDamage: 10, ammoType: 'NA' },
    }));
    addTestEquipmentWithFlags(fighter, 'F_CASE_II');

    expect(alphaStrikeCoreSpecials(fighter, { type: 'AF', hasStandardDamage: true })).toEqual([]);
    expect(alphaStrikeCoreSpecials(new BattleArmorEntity(), { type: 'BA', hasStandardDamage: true })).toEqual([]);
    expect(alphaStrikeCoreSpecials(new ProtoMekEntity(), { type: 'PM', hasStandardDamage: true })).toEqual(['ENE']);
  });

  it('converts ECM and probe variants with their implied reconnaissance ability', () => {
    const entity = new BipedMekEntity();
    addTestEquipmentWithFlags(entity, 'F_ECM');
    addTestEquipmentWithFlags(entity, 'F_BAP');
    addTestEquipmentWithFlags(entity, 'F_BLOODHOUND');
    addTestEquipmentWithFlags(entity, 'F_WATCHDOG');
    addTestEquipmentWithFlags(entity, 'F_NOVA');

    expect(alphaStrikeCoreSpecials(entity, GROUND_CONTEXT)).toEqual([
      'ECM', 'ENE', 'NOVA', 'PRB', 'RCN', 'WAT', 'LPRB', 'BH',
    ].sort());
  });

  it('lets Angel ECM supersede generic ECM while retaining light ECM', () => {
    const entity = new BipedMekEntity();
    addTestEquipmentWithFlags(entity, 'F_ECM');
    addTestEquipmentWithFlags(entity, ['F_ECM', 'F_ANGEL_ECM']);
    addTestEquipmentWithFlags(entity, ['F_ECM', 'F_SINGLE_HEX_ECM']);

    expect(alphaStrikeCoreSpecials(entity, GROUND_CONTEXT)).toEqual(['AECM', 'ENE', 'LECM']);
  });

  it('adds STL only for uniform stealth armor and OMNI only for Mek and vehicle units', () => {
    const mek = new BipedMekEntity();
    mek.omni.set(true);
    mek.setUniformArmor(stealthArmor());
    expect(alphaStrikeCoreSpecials(mek, GROUND_CONTEXT)).toEqual(['ENE', 'OMNI', 'STL']);

    mek.setArmorAt('CT', stealthArmor('STANDARD'));
    expect(alphaStrikeCoreSpecials(mek, GROUND_CONTEXT)).toEqual(['ENE', 'OMNI']);

    const vehicle = new TankEntity();
    vehicle.omni.set(true);
    expect(alphaStrikeCoreSpecials(vehicle, { type: 'CV', hasStandardDamage: true })).toEqual(['ENE', 'OMNI']);
  });

  it('keeps ENE arc-local for large aerospace and damage-dependent for aerospace elements', () => {
    expect(alphaStrikeCoreSpecials(new DropShipEntity(), { type: 'DS', hasStandardDamage: true })).toEqual([]);
    expect(alphaStrikeCoreSpecials(new AeroSpaceFighterEntity(), { type: 'AF', hasStandardDamage: false })).toEqual([]);
    expect(alphaStrikeCoreSpecials(new AeroSpaceFighterEntity(), { type: 'AF', hasStandardDamage: true })).toEqual(['ENE']);
  });
});
