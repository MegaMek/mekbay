import { ParseContext } from './parse-context';
import { parseTransporterLines, serializeTransporterLines } from './transporter-codec';
import type { EntityTechBase } from '../types';
import { projectRecordSheetBays } from '../bays/record-sheet-bay-projection';

function parse(lines: string[], techBase: EntityTechBase = 'IS') {
  return parseTransporterLines(lines, techBase, new ParseContext('test.blk', {}));
}

describe('transporter codec', () => {
  it('normalizes BLK aliases and specialized bay configuration', () => {
    expect(parse([
      'mechbay:2:1:4',
      'artsasfbay:6:2:5',
      'battlearmorbay:3:1:6::-1:3',
      'dropshuttlebay:1:1:7::2:0',
    ], 'Clan')).toEqual([
      { id: 'transporter-1', kind: 'bay', configuration: { type: 'mek' }, capacity: 2, doors: 1, bayNumber: 4, omni: false },
      { id: 'transporter-2', kind: 'bay', configuration: { type: 'fighter', arts: true }, capacity: 6, doors: 2, bayNumber: 5, omni: false },
      { id: 'transporter-3', kind: 'bay', configuration: { type: 'battle-armor', techBase: 'Clan', comStar: true }, capacity: 3, doors: 1, bayNumber: 6, omni: false },
      { id: 'transporter-4', kind: 'bay', configuration: { type: 'drop-shuttle', facing: 2 }, capacity: 2, doors: 1, bayNumber: 7, omni: false },
    ]);
  });

  it('stores infantry as total physical space while projecting platoon capacity', () => {
    const transporters = parse(['infantrybay:4:1:2:Motorized']);
    expect(transporters[0]).toEqual({
      id: 'transporter-1', kind: 'bay', configuration: { type: 'infantry', infantryType: 'Motorized' },
      capacity: 28, doors: 1, bayNumber: 2, omni: false,
    });
    expect(projectRecordSheetBays(transporters)[0].members[0].capacity).toBe(4);
  });

  it('keeps physical bays distinct while grouping record-sheet rows', () => {
    const groups = projectRecordSheetBays([
      { id: 'cargo', kind: 'bay', configuration: { type: 'cargo' }, capacity: 2, doors: 1, bayNumber: 3, omni: false },
      { id: 'ba', kind: 'bay', configuration: { type: 'battle-armor', techBase: 'IS', comStar: false }, capacity: 1, doors: 2, bayNumber: 3, omni: false },
      { id: 'quarters', kind: 'bay', configuration: { type: 'crew-quarters' }, capacity: 5, constructionWeight: 35, doors: 0, bayNumber: 4, omni: false },
    ]);
    expect(groups.length).toBe(1);
    expect(groups[0].members.map(member => member.typeName)).toEqual(['Battle Armor', 'Cargo']);
    expect(groups[0].doors).toBe(2);
  });

  it('allocates unique numbers and preserves unsupported lines', () => {
    const context = new ParseContext('test.blk', {});
    const transporters = parseTransporterLines([
      'cargobay:1:1:2',
      'mekbay:1:1:2',
      'futuretransport:7:1',
      'dockingcollar',
    ], 'IS', context);
    expect(transporters.map(transporter => transporter.kind === 'bay' ? transporter.bayNumber : transporter.kind === 'docking-collar' ? transporter.collarNumber : undefined)).toEqual([2, 1, undefined, 3]);
    expect(transporters[2]).toEqual({ id: 'transporter-3', kind: 'unknown', rawLine: 'futuretransport:7:1', omni: false });
    expect(context.warnings.length).toBe(1);
  });

  it('round trips canonical construction data through BLK lines', () => {
    const original = parse([
      'infantrybay:4:1:2:Jump:-1:0:omni',
      'artsnavalrepairpressurized:500:2:3::4:0',
      'battlearmorbay:2:1:5::-1:3',
      'troopspace:1.5',
      'dockingcollar',
    ]);
    expect(parse(serializeTransporterLines(original))).toEqual(original);
  });

  it('preserves quarter construction weight while exposing person capacity', () => {
    const original = parse(['steeragequarters:26:0']);
    expect(original[0]).toEqual({
      id: 'transporter-1', kind: 'bay', configuration: { type: 'steerage-quarters' },
      capacity: 5, constructionWeight: 26, doors: 0, bayNumber: 1, omni: false,
    });
    expect(parse(serializeTransporterLines(original))).toEqual(original);
  });
});
