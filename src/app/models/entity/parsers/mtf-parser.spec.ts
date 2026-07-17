import { MiscEquipment, StructureEquipment } from '../../equipment.model';
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