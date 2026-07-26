import { MountedArmor, MountedEngine } from '../../../components';
import { ArmorEquipment, MiscEquipment, WeaponEquipment } from '../../../../equipment.model';
import {
  TestAeroSpaceFighterEntity as AeroSpaceFighterEntity,
  TestBattleArmorEntity as BattleArmorEntity,
  TestBipedMekEntity as BipedMekEntity,
  TestDropShipEntity as DropShipEntity,
  TestInfantryEntity as InfantryEntity,
  TestProtoMekEntity as ProtoMekEntity,
  TestSupportTankEntity as SupportTankEntity,
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
    expect(alphaStrikeCoreSpecials(new BattleArmorEntity(), { type: 'BA', hasStandardDamage: true })).toEqual(['CAR5']);
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
    expect(alphaStrikeCoreSpecials(vehicle, { type: 'CV', hasStandardDamage: true }))
      .toEqual(['ENE', 'OMNI', 'SRCH']);
  });

  it('converts canonical equipment, armor, engine, and armored-mount abilities', () => {
    const entity = new BipedMekEntity();
    entity.mountedEngine.set(new MountedEngine({ type: 'ICE', rating: 100, techBase: 'IS' }));
    entity.setUniformArmor(new MountedArmor({
      armor: new ArmorEquipment({ id: 'Reactive', name: 'Reactive', type: 'armor', armor: { type: 'REACTIVE' } }),
      techBase: 'IS',
    }));
    addTestEquipmentWithFlags(entity, 'F_TSM');
    addTestEquipmentWithFlags(entity, 'F_RADICAL_HEATSINK');
    addTestEquipmentWithFlags(entity, 'F_EJECTION_SEAT');
    addTestEquipmentWithFlags(entity, 'F_C3I');
    addTestEquipmentWithFlags(entity, 'F_C3S', { armored: true });

    expect(alphaStrikeCoreSpecials(entity, GROUND_CONTEXT)).toEqual([
      'ARM', 'C3I', 'C3S', 'EE', 'ENE', 'ES', 'MHQ3', 'RCA', 'RHS', 'TSM',
    ]);
  });

  it('adds intrinsic SRCH to combat vehicles but not support vehicles', () => {
    const vehicle = new TankEntity();
    expect(alphaStrikeCoreSpecials(vehicle, { type: 'CV', hasStandardDamage: true }))
      .toEqual(['ENE', 'SRCH']);

    const supportVehicle = new SupportTankEntity();
    expect(alphaStrikeCoreSpecials(supportVehicle, { type: 'SV', hasStandardDamage: true }))
      .toEqual(['ENE']);
  });

  it('deduplicates intrinsic and mounted vehicle searchlights', () => {
    const vehicle = new TankEntity();
    addTestEquipmentWithFlags(vehicle, 'F_SEARCHLIGHT');

    expect(alphaStrikeCoreSpecials(vehicle, { type: 'CV', hasStandardDamage: true }))
      .toEqual(['ENE', 'SRCH']);

    const supportVehicle = new SupportTankEntity();
    addTestEquipmentWithFlags(supportVehicle, 'F_SEARCHLIGHT');
    expect(alphaStrikeCoreSpecials(supportVehicle, { type: 'SV', hasStandardDamage: true }))
      .toEqual(['ENE', 'SRCH']);
  });

  it('adds SEAL and engine-qualified SOA only for sealed vehicles', () => {
    const fusionVehicle = new TankEntity();
    fusionVehicle.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 100, techBase: 'IS' }));
    addTestEquipmentWithFlags(fusionVehicle, 'F_ENVIRONMENTAL_SEALING');
    expect(alphaStrikeCoreSpecials(fusionVehicle, { type: 'CV', hasStandardDamage: true }))
      .toEqual(['ENE', 'SEAL', 'SOA', 'SRCH']);

    const iceVehicle = new TankEntity();
    iceVehicle.mountedEngine.set(new MountedEngine({ type: 'ICE', rating: 100, techBase: 'IS' }));
    addTestEquipmentWithFlags(iceVehicle, 'F_ENVIRONMENTAL_SEALING');
    expect(alphaStrikeCoreSpecials(iceVehicle, { type: 'CV', hasStandardDamage: true }))
      .toEqual(['EE', 'ENE', 'SEAL', 'SRCH']);
  });

  it('converts tractor, trailer, and hitch modifications to one HTC ability', () => {
    const entity = new TankEntity();
    addTestEquipmentWithFlags(entity, 'F_TRACTOR_MODIFICATION');
    addTestEquipmentWithFlags(entity, 'F_TRAILER_MODIFICATION');
    addTestEquipmentWithFlags(entity, 'F_HITCH');

    expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
      .toEqual(['ENE', 'HTC', 'SRCH']);
  });

  it('converts mobile HPG equipment by its canonical flag', () => {
    const entity = new TankEntity();
    addTestEquipmentWithFlags(entity, 'F_MOBILE_HPG');

    expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
      .toEqual(['ENE', 'HPG', 'SRCH']);
  });

  it('aggregates variable cargo mounts and cargo bays into CT with doors', () => {
    const entity = new TankEntity();
    addTestEquipment(entity, new MiscEquipment({
      id: 'cargo', name: 'Cargo', type: 'misc', flags: ['F_CARGO'],
      stats: { tonnage: 'variable' },
    }), { size: 1.5 });
    entity.transporters.set([{
      id: 'cargo-bay', kind: 'bay', configuration: { type: 'cargo' }, capacity: 2.5,
      doors: 2, bayNumber: 1, omni: false,
    }]);

    expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
      .toEqual(['CT4-D2', 'ENE', 'SRCH']);
  });

  it('rounds large-aerospace cargo and converts high capacity to CK', () => {
    const largeCraft = new DropShipEntity();
    largeCraft.transporters.set([{
      id: 'cargo-bay', kind: 'bay', configuration: { type: 'cargo' }, capacity: 10.6,
      doors: 1, bayNumber: 1, omni: false,
    }]);
    expect(alphaStrikeCoreSpecials(largeCraft, { type: 'DS', hasStandardDamage: true }))
      .toEqual(['CT11-D1']);

    const vehicle = new TankEntity();
    vehicle.transporters.set([{
      id: 'cargo-bay', kind: 'bay', configuration: { type: 'cargo' }, capacity: 1_501,
      doors: 3, bayNumber: 1, omni: false,
    }]);
    expect(alphaStrikeCoreSpecials(vehicle, { type: 'CV', hasStandardDamage: true }))
      .toEqual(['CK2-D3', 'ENE', 'SRCH']);
  });

  it('adds MFB from mobile-base equipment and qualifying transport bays', () => {
    const equipped = new TankEntity();
    addTestEquipmentWithFlags(equipped, 'F_MOBILE_FIELD_BASE');
    expect(alphaStrikeCoreSpecials(equipped, { type: 'CV', hasStandardDamage: true }))
      .toEqual(['ENE', 'MFB', 'SRCH']);

    const carrier = new DropShipEntity();
    carrier.transporters.set([{
      id: 'mek-bay', kind: 'bay', configuration: { type: 'mek' }, capacity: 2,
      doors: 1, bayNumber: 1, omni: false,
    }]);
    expect(alphaStrikeCoreSpecials(carrier, { type: 'DS', hasStandardDamage: true }))
      .toEqual(['MFB1', 'MT2-D1']);
  });

  it('aggregates transport bay capacities and doors into their Alpha Strike specials', () => {
    const entity = new DropShipEntity();
    entity.transporters.set([
      { id: 'fighter', kind: 'bay', configuration: { type: 'fighter', arts: false }, capacity: 2, doors: 1, bayNumber: 1, omni: false },
      { id: 'mek', kind: 'bay', configuration: { type: 'mek' }, capacity: 3, doors: 2, bayNumber: 2, omni: false },
      { id: 'infantry', kind: 'bay', configuration: { type: 'infantry', infantryType: 'Foot' }, capacity: 28, doors: 1, bayNumber: 3, omni: false },
      { id: 'troop-space', kind: 'troop-space', totalSpace: 2, omni: false },
      { id: 'collar', kind: 'docking-collar', collarNumber: 1, omni: false },
    ]);

    expect(alphaStrikeCoreSpecials(entity, { type: 'DS', hasStandardDamage: true }))
      .toEqual(['AT2-D1', 'DT1', 'IT30', 'MFB2', 'MT3-D2']);
  });

  it('derives jump and UMU advantages relative to the primary movement TMM', () => {
    const entity = new BipedMekEntity();

    expect(alphaStrikeCoreSpecials(entity, {
      ...GROUND_CONTEXT,
      movement: { primary: '', values: { '': 10, j: 6, s: 20 } },
    })).toEqual(['ENE', 'JMPW1', 'SUBS2']);
  });

  it('does not add a relative movement ability when that movement is primary or has the same TMM', () => {
    const entity = new BipedMekEntity();

    expect(alphaStrikeCoreSpecials(entity, {
      ...GROUND_CONTEXT,
      movement: { primary: 'j', values: { '': 10, j: 12, s: 10 } },
    })).toEqual(['ENE']);
  });

  it('keeps ENE arc-local for large aerospace and damage-dependent for aerospace elements', () => {
    expect(alphaStrikeCoreSpecials(new DropShipEntity(), { type: 'DS', hasStandardDamage: true })).toEqual([]);
    expect(alphaStrikeCoreSpecials(new AeroSpaceFighterEntity(), { type: 'AF', hasStandardDamage: false })).toEqual([]);
    expect(alphaStrikeCoreSpecials(new AeroSpaceFighterEntity(), { type: 'AF', hasStandardDamage: true })).toEqual(['ENE']);
  });

  it('adds CAR from the ceiling of every infantry unit weight', () => {
    const battleArmor = new BattleArmorEntity();
    battleArmor.trooperCount.set(4);
    const infantry = new InfantryEntity();
    infantry.squadSize.set(37);

    expect(alphaStrikeCoreSpecials(battleArmor, { type: 'BA', hasStandardDamage: true }))
      .toEqual(['CAR4']);
    expect(alphaStrikeCoreSpecials(infantry, { type: 'CI', hasStandardDamage: true }))
      .toEqual(['CAR4']);
  });

  it('adds MEC only for mechanized-capable Battle Armor', () => {
    const entity = new BattleArmorEntity();
    addTestEquipmentWithFlags(entity, 'F_BASIC_MANIPULATOR');

    expect(alphaStrikeCoreSpecials(entity, { type: 'BA', hasStandardDamage: true }))
      .toEqual(['CAR5', 'MEC']);
  });

  it('adds XMEC for magnetic clamps and lets it supersede MEC', () => {
    const entity = new BattleArmorEntity();
    entity.chassisType.set('Quad');
    addTestEquipmentWithFlags(entity, 'F_MAGNETIC_CLAMP');

    expect(alphaStrikeCoreSpecials(entity, { type: 'BA', hasStandardDamage: true }))
      .toEqual(['CAR5', 'XMEC']);
  });
});
