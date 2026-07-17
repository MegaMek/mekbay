import { AmmoEquipment, MiscEquipment, StructureEquipment, WeaponEquipment } from '../../equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY, EquipmentRegistry } from '../../equipment-lookup';
import { ParseContext } from './parse-context';
import { parseMtf } from './mtf-parser';
import { writeMtf } from '../writers/mtf-writer';

describe('MTF parser identity', () => {
  it('preserves an existing UUID', () => {
    const uuid = '019f6767-0dcb-7bb8-992f-aef08202f5e1';
    const entity = parseMtf(minimalMtf(`uuid:${uuid}\n`), new ParseContext('test.mtf', EMPTY_EQUIPMENT_REGISTRY));

    expect(entity.uuid()).toBe(uuid);
  });

  it('generates a UUID when the file does not provide one', () => {
    const entity = parseMtf(minimalMtf(), new ParseContext('test.mtf', EMPTY_EQUIPMENT_REGISTRY));

    expect(entity.uuid()).toBeTruthy();
  });

  it('decodes optional Mek systems and writes their canonical MTF values', () => {
    const entity = parseMtf(
      minimalMtf(
        'ejection:full head ejection system\n' +
        'heat sink kit:risc heat sink override kit\n',
      ),
      new ParseContext('optional-systems.mtf', EMPTY_EQUIPMENT_REGISTRY),
    );

    expect(entity.hasFullHeadEjectionSystem()).toBe(true);
    expect(entity.hasRiscHeatSinkOverrideKit()).toBe(true);
    expect(writeMtf(entity)).toContain('\nejection:Full Head Ejection System\n');
    expect(writeMtf(entity)).toContain('\nheat sink kit:RISC Heat Sink Override Kit\n');
  });

  it('does not retain unknown optional Mek system strings', () => {
    const entity = parseMtf(
      minimalMtf('ejection:Unknown\nheat sink kit:Unknown\n'),
      new ParseContext('unknown-optional-systems.mtf', EMPTY_EQUIPMENT_REGISTRY),
    );

    expect(entity.hasFullHeadEjectionSystem()).toBe(false);
    expect(entity.hasRiscHeatSinkOverrideKit()).toBe(false);
    expect(writeMtf(entity)).not.toContain('\nejection:');
    expect(writeMtf(entity)).not.toContain('\nheat sink kit:');
  });

  it('resolves the selected heat-sink technology to real equipment', () => {
    const compactHeatSink = new MiscEquipment({
      id: '1 Compact Heat Sink', name: '1 Compact Heat Sink', type: 'misc',
      flags: ['F_HEAT_SINK', 'F_COMPACT_HEAT_SINK'],
    });
    const registry = new EquipmentRegistry({ [compactHeatSink.id]: compactHeatSink });
    const entity = parseMtf(
      minimalMtf().replace('heat sinks:10 Single', 'heat sinks:10 Compact'),
      new ParseContext('test.mtf', registry),
    );

    expect(entity.heatSinkEquipment()).toBe(compactHeatSink);
    expect(entity.integralHeatSinks()).toEqual({ count: 8, equipment: compactHeatSink });
    expect(entity.equipment().filter(mount => mount.allocation.kind !== 'engine').length).toBe(2);
    expect(entity.totalHeatSinks()).toBe(10);
  });

  it('preserves Freezers identified by critical slots under a Single header', () => {
    const singleHeatSink = new MiscEquipment({
      id: 'Heat Sink', name: 'Heat Sink', type: 'misc', flags: ['F_HEAT_SINK'],
    });
    const freezer = new MiscEquipment({
      id: 'ISDoubleHeatSinkFreezer', name: 'Double Heat Sink (Freezers)', type: 'misc',
      aliases: ['Freezers'],
      stats: { criticalSlots: 3 },
      flags: ['F_IS_DOUBLE_HEAT_SINK_PROTOTYPE'],
    });
    const registry = new EquipmentRegistry({
      [singleHeatSink.id]: singleHeatSink,
      [freezer.id]: freezer,
    });
    const entity = parseMtf(
      minimalMtf().replace(
        'heat sinks:10 Single',
        'heat sinks:1 Single\nLeft Torso:\nFreezers\nFreezers\nFreezers',
      ),
      new ParseContext('freezer.mtf', registry),
    );

    expect(entity.heatSinkEquipment()).toBe(singleHeatSink);
    expect(entity.equipment().filter(mount => mount.equipment === freezer).length).toBe(1);
    expect(entity.integralHeatSinks()).toBeNull();
    expect(entity.totalHeatSinks()).toBe(1);
  });

  it('preserves explicit structure technology on an opposite-tech chassis', () => {
    const standardStructure = new StructureEquipment({
      id: 'Standard', name: 'Standard', type: 'structure',
      tech: { base: 'All' }, structure: { typeId: 0 },
    });
    const registry = new EquipmentRegistry({ [standardStructure.id]: standardStructure });
    const entity = parseMtf(
      minimalMtf()
        .replace('Config:Biped', 'Config:Biped\ntechbase:Clan')
        .replace('engine:100 Fusion Engine', 'engine:100 Fusion Engine\nstructure:IS Standard'),
      new ParseContext('mixed-structure.mtf', registry),
    );

    expect(writeMtf(entity)).toContain('\nstructure:IS Standard\n');
  });

  it('derives construction jump MP from installed equipment', () => {
    const entity = parseMtf(
      minimalMtf().replace('jump mp:0', 'jump mp:5'),
      new ParseContext('construction-jump-mp.mtf', EMPTY_EQUIPMENT_REGISTRY),
    );

    expect(entity.installedJumpJetMP()).toBe(0);
    expect(entity.jumpMP()).toBe(0);
    expect(writeMtf(entity)).toContain('\njump mp:0\n');
  });

  it('does not add implicit Clan CASE where explicit CASE already protects the location', () => {
    const clanCase = new MiscEquipment({
      id: 'Clan CASE', name: 'CASE', type: 'misc', flags: ['F_CASE'],
    });
    const innerSphereCase = new MiscEquipment({
      id: 'ISCASE', name: 'CASE', type: 'misc', flags: ['F_CASE'],
    });
    const ammo = new AmmoEquipment({ id: 'Test Ammo', name: 'Test Ammo', type: 'ammo' });
    const registry = new EquipmentRegistry({
      [clanCase.id]: clanCase,
      [innerSphereCase.id]: innerSphereCase,
      [ammo.id]: ammo,
    });
    const entity = parseMtf(
      clanMtf('Left Torso:\nISCASE\nTest Ammo'),
      new ParseContext('explicit-case.mtf', registry),
    );

    expect(entity.equipment().filter(mount => mount.equipment === clanCase)).toHaveSize(0);
    expect(entity.equipment().filter(mount => mount.equipment === innerSphereCase)).toHaveSize(1);
  });

  it('respects Clan CASE opt-outs', () => {
    const clanCase = new MiscEquipment({
      id: 'Clan CASE', name: 'CASE', type: 'misc', flags: ['F_CASE'],
    });
    const ammo = new AmmoEquipment({ id: 'Test Ammo', name: 'Test Ammo', type: 'ammo' });
    const registry = new EquipmentRegistry({ [clanCase.id]: clanCase, [ammo.id]: ammo });
    const entity = parseMtf(
      clanMtf('clancaseoptedoutlocs:LT\nLeft Torso:\nTest Ammo'),
      new ParseContext('case-opt-out.mtf', registry),
    );

    expect(entity.equipment().filter(mount => mount.equipment === clanCase)).toHaveSize(0);
  });

  it('adds implicit Clan CASE to a Clan location containing explosive ammo', () => {
    const clanCase = new MiscEquipment({
      id: 'Clan CASE', name: 'CASE', type: 'misc', flags: ['F_CASE'],
    });
    const ammo = new AmmoEquipment({
      id: 'Test Ammo', name: 'Test Ammo', type: 'ammo', stats: { explosive: true },
    });
    const registry = new EquipmentRegistry({ [clanCase.id]: clanCase, [ammo.id]: ammo });
    const entity = parseMtf(
      clanMtf('Right Torso:\nTest Ammo'),
      new ParseContext('explosive-ammo.mtf', registry),
    );

    expect(entity.equipment().filter(mount => mount.equipment === clanCase).map(mount => mount.location))
      .toEqual(['RT']);
  });

  it('does not add implicit Clan CASE for explosive non-ammunition equipment', () => {
    const clanCase = new MiscEquipment({
      id: 'Clan CASE', name: 'CASE', type: 'misc', flags: ['F_CASE'],
    });
    const explosiveWeapon = new WeaponEquipment({
      id: 'Explosive Weapon', name: 'Explosive Weapon', type: 'weapon',
      stats: { criticalSlots: 8, explosive: true },
    });
    const registry = new EquipmentRegistry({
      [clanCase.id]: clanCase,
      [explosiveWeapon.id]: explosiveWeapon,
    });
    const entity = parseMtf(
      clanMtf(
        'Right Arm:\nExplosive Weapon\nExplosive Weapon\nExplosive Weapon\nExplosive Weapon\n' +
        'Right Torso:\nExplosive Weapon (Split)\nExplosive Weapon\nExplosive Weapon\nExplosive Weapon',
      ),
      new ParseContext('split-explosive.mtf', registry),
    );

    const caseLocations = entity.equipment()
      .filter(mount => mount.equipment === clanCase)
      .map(mount => mount.location)
      .sort();
    expect(caseLocations).toEqual([]);
  });

  it('does not propagate implicit Clan CASE on an Inner Sphere unit with explicit Clan CASE', () => {
    const clanCase = new MiscEquipment({
      id: 'Clan CASE', name: 'CASE', type: 'misc', tech: { base: 'Clan' }, flags: ['F_CASE'],
    });
    const ammo = new AmmoEquipment({
      id: 'Test Ammo', name: 'Test Ammo', type: 'ammo', stats: { explosive: true },
    });
    const registry = new EquipmentRegistry({ [clanCase.id]: clanCase, [ammo.id]: ammo });
    const entity = parseMtf(
      minimalMtf().replace('armor:Standard(Inner Sphere)', 'armor:Standard(Inner Sphere)\nLeft Torso:\nClan CASE\nRight Torso:\nTest Ammo'),
      new ParseContext('is-explicit-clan-case.mtf', registry),
    );

    expect(entity.equipment().filter(mount => mount.equipment === clanCase).map(mount => mount.location))
      .toEqual(['LT']);
  });
});

function minimalMtf(identity = ''): string {
  return `${identity}chassis:Test
model:TST-1
Config:Biped
mass:20
engine:100 Fusion Engine
heat sinks:10 Single
walk mp:5
jump mp:0
armor:Standard(Inner Sphere)
`;
}

function clanMtf(extra: string): string {
  return minimalMtf()
    .replace('Config:Biped', 'Config:Biped\ntechbase:Clan')
    .replace('armor:Standard(Inner Sphere)', `armor:Standard(Clan)\n${extra}`);
}
