import { buildUnitCargoMetadata } from '../../../utils/unit-cargo-metadata-builder';
import type { EntityTransporter } from './transport';

describe('buildUnitCargoMetadata', () => {
  it('groups conceptual bays and applies record-sheet names and capacities', () => {
    const transporters: EntityTransporter[] = [
      { id: 'ba', kind: 'bay', configuration: { type: 'battle-armor', techBase: 'Clan', comStar: false }, capacity: 3, doors: 1, bayNumber: 2, omni: false },
      { id: 'cargo', kind: 'bay', configuration: { type: 'cargo' }, capacity: 2, doors: 2, bayNumber: 2, omni: false },
      { id: 'infantry', kind: 'bay', configuration: { type: 'infantry', infantryType: 'Motorized' }, capacity: 28, doors: 1, bayNumber: 1, omni: false },
      { id: 'proto', kind: 'bay', configuration: { type: 'protomek' }, capacity: 2, doors: 1, bayNumber: 3, omni: false },
    ];
    expect(buildUnitCargoMetadata(transporters)).toEqual([
      { n: 1, type: 'Infantry (Motorized)', capacity: '4', doors: 1 },
      { n: 2, type: 'Cargo/Battle Armor', capacity: '2/15', doors: 2 },
      { n: 3, type: 'ProtoMech', capacity: '10', doors: 1 },
    ]);
  });

  it('formats up to three fractional digits and omits non-cargo transporters', () => {
    expect(buildUnitCargoMetadata([
      { id: 'cargo', kind: 'bay', configuration: { type: 'cargo' }, capacity: 0.013, doors: 1, bayNumber: 2, omni: false },
    ])).toEqual([
      { n: 2, type: 'Cargo', capacity: '0.013', doors: 1 },
    ]);

    expect(buildUnitCargoMetadata([
      { id: 'collar', kind: 'docking-collar', collarNumber: 1, omni: false },
      { id: 'quarters', kind: 'bay', configuration: { type: 'crew-quarters' }, capacity: 10, constructionWeight: 70, doors: 0, bayNumber: 2, omni: false },
    ])).toBeUndefined();
  });
});