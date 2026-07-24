import { MiscEquipment } from '../../equipment.model';
import {
  decodeMtfArmor,
  decodeMtfEngine,
  decodeMtfHeatSinks,
  decodeMtfStructure,
  encodeMtfArmor,
  encodeMtfEngine,
  encodeMtfHeatSinkType,
  encodeMtfStructure,
} from './mtf-codec';

describe('MTF codec', () => {
  it('decodes engine rating, type, and tech base', () => {
    expect(decodeMtfEngine('300 XL Engine (Clan)')).toEqual({
      rating: 300,
      type: 'XL',
      techBase: 'Clan',
    });
    expect(decodeMtfEngine('200 I.C.E. Engine').type).toBe('ICE');
  });

  it('encodes canonical engine lines for pure and mixed tech', () => {
    expect(encodeMtfEngine({ rating: 160, type: 'Fusion', techBase: 'IS', mixedTech: false }))
      .toBe('160 Fusion Engine');
    expect(encodeMtfEngine({ rating: 300, type: 'XL', techBase: 'Clan', mixedTech: false }))
      .toBe('300 XL (Clan) Engine');
    expect(encodeMtfEngine({ rating: 300, type: 'XL', techBase: 'IS', mixedTech: true }))
      .toBe('300 XL Engine(IS)');
    expect(encodeMtfEngine({ rating: 450, type: 'XXL', techBase: 'Clan', mixedTech: true }))
      .toBe('450 Large XXL (Clan) Engine');
    expect(encodeMtfEngine(null)).toBe('None');
  });

  it('rejects engine types that cannot be represented by a Mek MTF', () => {
    for (const type of ['None', 'Maglev', 'Steam', 'Battery', 'Solar', 'External'] as const) {
      expect(() => encodeMtfEngine({ rating: 100, type, techBase: 'IS', mixedTech: false }))
        .withContext(type)
        .toThrowError(`Engine type "${type}" cannot be encoded in a Mek MTF`);
    }
  });

  it('decodes and encodes armor lines', () => {
    expect(decodeMtfArmor('Ferro-Fibrous Armor (Clan)')).toEqual({
      type: 'Ferro-Fibrous',
      clanTech: true,
      patchwork: false,
    });
    expect(decodeMtfArmor('Patchwork Armor').patchwork).toBeTrue();
    expect(encodeMtfArmor('Ferro-Fibrous', 'Clan', false)).toBe('Ferro-Fibrous(Clan)');
    expect(encodeMtfArmor('Standard', 'IS', false)).toBe('Standard(Inner Sphere)');
    expect(encodeMtfArmor('ignored', 'IS', true)).toBe('Patchwork');
  });

  it('preserves MTF structure technology and Hybrid construction', () => {
    expect(decodeMtfStructure('IS Reinforced')).toEqual({
      name: 'Reinforced', techBase: 'IS', hybrid: false,
    });
    expect(decodeMtfStructure('Standard')).toEqual({
      name: 'Standard', techBase: null, hybrid: false,
    });
    expect(decodeMtfStructure('Hybrid')).toEqual({
      name: 'Standard', techBase: null, hybrid: true,
    });
    expect(encodeMtfStructure('Standard', 'Clan', false)).toBe('Clan Standard');
    expect(encodeMtfStructure('Standard', null, false)).toBe('Standard');
    expect(encodeMtfStructure('Standard', null, true)).toBe('Hybrid');
  });

  it('decodes heat sink count, type, and equipment identity', () => {
    expect(decodeMtfHeatSinks('12 Double')).toEqual({
      count: 12,
      type: 'Double',
      equipmentId: 'ISDoubleHeatSink',
    });
    expect(decodeMtfHeatSinks('10 Freezers')).toEqual({
      count: 10,
      type: 'Double',
      equipmentId: 'ISDoubleHeatSinkFreezer',
    });
  });

  it('encodes engine-integrated heat sink types using MegaMek MTF rules', () => {
    const prototype = new MiscEquipment({
      id: 'ISDoubleHeatSinkPrototype', name: 'Double Heat Sink Prototype', type: 'misc',
      flags: ['F_IS_DOUBLE_HEAT_SINK_PROTOTYPE'],
    });
    const freezer = new MiscEquipment({
      id: 'ISDoubleHeatSinkFreezer', name: 'Double Heat Sink (Freezers)', type: 'misc',
      flags: ['F_IS_DOUBLE_HEAT_SINK_PROTOTYPE'],
    });
    const clanDouble = new MiscEquipment({
      id: 'CLDoubleHeatSink', name: 'Double Heat Sink', type: 'misc',
      flags: ['F_DOUBLE_HEAT_SINK'], tech: { base: 'Clan' },
    });
    const laser = new MiscEquipment({
      id: 'Laser Heat Sink', name: 'Laser Heat Sink', type: 'misc',
      flags: ['F_LASER_HEAT_SINK'],
    });

    expect(encodeMtfHeatSinkType(prototype)).toBe('Single');
    expect(encodeMtfHeatSinkType(freezer)).toBe('Single');
    expect(encodeMtfHeatSinkType(clanDouble)).toBe('Clan Double');
    expect(encodeMtfHeatSinkType(laser)).toBe('Laser');
  });
});
