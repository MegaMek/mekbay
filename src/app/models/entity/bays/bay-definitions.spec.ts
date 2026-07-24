import type { EntityTransportBay } from '../types/transport';
import {
  decodeBaySize,
  encodeBaySize,
  getBayRecordSheetName,
  getBayTransporterType,
  isQuartersBay,
  getBayConstructionWeight,
  resolveStandardBayType,
} from './bay-definitions';

describe('bay definitions', () => {
  it('calculates construction mass for unit bays', () => {
    const fighterBay = { id: 'fighters', kind: 'bay' as const,
      configuration: { type: 'fighter' as const, arts: false }, capacity: 6,
      doors: 1, bayNumber: 1, omni: false };
    expect(getBayConstructionWeight(fighterBay)).toBe(900);
    expect(getBayConstructionWeight({ ...fighterBay,
      configuration: { type: 'fighter', arts: true } })).toBe(1125);
  });

  it('uses fixed DropShuttle bay construction mass', () => {
    expect(getBayConstructionWeight({ id: 'shuttle', kind: 'bay',
      configuration: { type: 'drop-shuttle', facing: 0 }, capacity: 2,
      doors: 1, bayNumber: 1, omni: false })).toBe(11_000);
  });

  it('resolves canonical BLK types and aliases', () => {
    expect(resolveStandardBayType('mekbay')).toBe('mek');
    expect(resolveStandardBayType('MechBay')).toBe('mek');
    expect(resolveStandardBayType('refrigeratedcargobay')).toBe('refrigerated-cargo');
    expect(resolveStandardBayType('LiquidCargoBay')).toBe('liquid-cargo');
    expect(resolveStandardBayType('ProtoMekBay')).toBe('protomek');
  });

  it('separates quarter capacity from construction weight', () => {
    expect(decodeBaySize({ type: 'steerage-quarters' }, 26)).toEqual({
      capacity: 5,
      constructionWeight: 26,
    });

    const parsedQuarter: EntityTransportBay = {
      id: 'parsed', kind: 'bay', configuration: { type: 'steerage-quarters' },
      capacity: 5, constructionWeight: 26, doors: 0, bayNumber: 1, omni: false,
    };
    const createdQuarter: EntityTransportBay = {
      id: 'created', kind: 'bay', configuration: { type: 'steerage-quarters' },
      capacity: 5, doors: 0, bayNumber: 1, omni: false,
    };
    expect(encodeBaySize(parsedQuarter)).toBe(26);
    expect(encodeBaySize(createdQuarter)).toBe(25);
    expect(isQuartersBay(parsedQuarter)).toBeTrue();
  });

  it('distinguishes transporter terminology from record-sheet terminology', () => {
    expect(getBayTransporterType({ type: 'mek' })).toBe('Mek');
    expect(getBayRecordSheetName({ type: 'mek' })).toBe('Mech');
    expect(getBayTransporterType({ type: 'protomek' })).toBe('ProtoMek');
    expect(getBayRecordSheetName({ type: 'protomek' })).toBe('ProtoMech');
    expect(getBayTransporterType({ type: 'refrigerated-cargo' })).toBe('Reefer');
    expect(getBayRecordSheetName({ type: 'refrigerated-cargo' })).toBe('Reefer');
  });
});