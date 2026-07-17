import { createMountedArmor } from '../components/armor';
import { ArmorEquipment, createEquipment } from '../../equipment.model';
import type { GyroType } from '../components/gyro-data';
import type { AeroDesignType, DriveCoreType, DropShipCollarType, EngineType, HeatSinkType } from '../types';
import type { CockpitType } from '../types/mek';
import {
  decodeBlkAeroDesignType,
  decodeBlkArmorType,
  decodeBlkCockpitType,
  decodeBlkDriveCoreType,
  decodeBlkDropShipCollarType,
  decodeBlkEngineType,
  decodeBlkGyroType,
  decodeBlkHeatSinkType,
  decodeBlkCompoundTechBase,
  decodeBlkCompoundTechLevel,
  encodeBlkAeroDesignType,
  encodeBlkArmorTechLevel,
  encodeBlkArmorTechRating,
  encodeBlkArmorType,
  encodeBlkCockpitType,
  encodeBlkDriveCoreType,
  encodeBlkDropShipCollarType,
  encodeBlkEngineType,
  encodeBlkGyroType,
  encodeBlkHeatSinkType,
  encodeBlkCompoundTechLevel,
  encodeBlkRulesLevel,
  encodeBlkTechLevel,
  getBlkMekHeatSinkEquipmentId,
  parseBlkTechLevel,
} from './blk-codec';

const ENGINE_TYPES: readonly EngineType[] = [
  'Fusion', 'ICE', 'XL', 'XXL', 'Light', 'Compact', 'Fuel Cell', 'Fission',
  'None', 'Maglev', 'Steam', 'Battery', 'Solar', 'External',
];
const COCKPIT_TYPES: readonly CockpitType[] = [
  'Standard', 'Small', 'Command Console', 'Torso-Mounted', 'Dual', 'Industrial',
  'Primitive', 'Primitive Industrial', 'Superheavy', 'Superheavy Tripod', 'Tripod',
  'Interface', 'Virtual Reality Piloting Pod', 'QuadVee', 'Superheavy Industrial',
  'Superheavy Command Console', 'Small Command Console', 'Tripod Industrial',
  'Superheavy Tripod Industrial',
];
const GYRO_TYPES: readonly GyroType[] = ['Standard', 'XL', 'Compact', 'Heavy Duty', 'None', 'Superheavy'];
const HEAT_SINK_TYPES: readonly HeatSinkType[] = ['Single', 'Double', 'Compact', 'Laser'];
const DESIGN_TYPES: readonly AeroDesignType[] = ['Civilian', 'Military'];
const DRIVE_CORE_TYPES: readonly DriveCoreType[] = ['Standard', 'Compact', 'Subcompact', 'None', 'Primitive'];
const COLLAR_TYPES: readonly DropShipCollarType[] = ['Unspecified', 'Standard', 'Prototype', 'No Boom'];

describe('BLK codec', () => {
  it('round trips every engine, cockpit, gyro, and heat-sink code', () => {
    for (const type of ENGINE_TYPES) expect(decodeBlkEngineType(encodeBlkEngineType(type))).toBe(type);
    for (const type of COCKPIT_TYPES) expect(decodeBlkCockpitType(encodeBlkCockpitType(type))).toBe(type);
    for (const type of GYRO_TYPES) expect(decodeBlkGyroType(encodeBlkGyroType(type))).toBe(type);
    for (const type of HEAT_SINK_TYPES) expect(decodeBlkHeatSinkType(encodeBlkHeatSinkType(type))).toBe(type);
  });

  it('round trips every aero construction code', () => {
    for (const type of DESIGN_TYPES) expect(decodeBlkAeroDesignType(encodeBlkAeroDesignType(type))).toBe(type);
    for (const type of DRIVE_CORE_TYPES) expect(decodeBlkDriveCoreType(encodeBlkDriveCoreType(type))).toBe(type);
    for (const type of COLLAR_TYPES) expect(decodeBlkDropShipCollarType(encodeBlkDropShipCollarType(type))).toBe(type);
  });

  it('uses canonical defaults for unknown codes', () => {
    expect(decodeBlkArmorType(999)).toBe('STANDARD');
    expect(decodeBlkEngineType(999)).toBe('Fusion');
    expect(decodeBlkCockpitType(999)).toBe('Standard');
    expect(decodeBlkGyroType(999)).toBe('Standard');
    expect(decodeBlkDriveCoreType(999)).toBe('Standard');
    expect(decodeBlkDropShipCollarType(999)).toBe('Unspecified');
  });

  it('resolves Mek heat-sink equipment IDs by type and tech base', () => {
    expect(getBlkMekHeatSinkEquipmentId('Double', 'IS')).toBe('ISDoubleHeatSink');
    expect(getBlkMekHeatSinkEquipmentId('Double', 'Clan')).toBe('CLDoubleHeatSink');
    expect(getBlkMekHeatSinkEquipmentId('Compact', 'IS')).toBe('1 Compact Heat Sink');
    expect(getBlkMekHeatSinkEquipmentId('Laser', 'Clan')).toBe('Laser Heat Sink');
    expect(getBlkMekHeatSinkEquipmentId('Single', 'IS')).toBe('Heat Sink');
  });

  it('encodes armor type and structured BLK values', () => {
    const equipment = createEquipment({
      id: 'Clan Ferro-Fibrous',
      name: 'Ferro-Fibrous',
      type: 'armor',
      armor: { type: 'FERRO_FIBROUS' },
      tech: { base: 'Clan', level: 'Experimental' },
    });
    expect(equipment instanceof ArmorEquipment).toBeTrue();
    const armor = createMountedArmor({
      type: 'FERRO_FIBROUS',
      techBase: 'Clan',
      techRating: 4,
      armor: equipment as ArmorEquipment,
      technology: { level: equipment.level, scope: 'Clan' },
    });
    expect(encodeBlkArmorType(armor)).toBe(1);
    expect(encodeBlkArmorTechRating(armor)).toBe(4);
    expect(encodeBlkArmorTechLevel(armor)).toBe(8);
  });

  it('uses structured armor technology for unresolved equipment', () => {
    const armor = createMountedArmor();
    expect(encodeBlkArmorTechLevel(armor)).toBe(0);
  });

  it('maps entity rules levels to Java compound tech levels', () => {
    expect(encodeBlkRulesLevel(1, false)).toBe(0);
    expect(encodeBlkRulesLevel(2, false)).toBe(1);
    expect(encodeBlkRulesLevel(2, true)).toBe(2);
    expect(encodeBlkRulesLevel(3, false)).toBe(5);
    expect(encodeBlkRulesLevel(3, true)).toBe(6);
    expect(encodeBlkRulesLevel(4, false)).toBe(7);
    expect(encodeBlkRulesLevel(4, true)).toBe(8);
    expect(encodeBlkRulesLevel(5, false)).toBe(9);
    expect(encodeBlkRulesLevel(5, true)).toBe(10);
  });

  it('encodes every component level as a MegaMek compound tech level', () => {
    const codes = [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    for (const code of codes) {
      expect(encodeBlkCompoundTechLevel(decodeBlkCompoundTechLevel(code))).toBe(code);
    }
  });

  it('decodes compound tech codes only into domain tech bases', () => {
    for (const code of [2, 6, 8, 10, 12]) expect(decodeBlkCompoundTechBase(code, 'IS')).toBe('Clan');
    for (const code of [0, 1, 3, 5, 7, 9, 11]) expect(decodeBlkCompoundTechBase(code, 'Clan')).toBe('IS');
    for (const code of [-1, 4, 13]) expect(decodeBlkCompoundTechBase(code, 'Clan')).toBe('Clan');
  });

  it('parses and canonically encodes BLK entity tech levels', () => {
    expect(parseBlkTechLevel(' IS Level 2 Advanced ')).toEqual({ techBase: 'IS', rulesLevel: 3, mixedTech: false });
    expect(parseBlkTechLevel('Mixed (IS Chassis)')).toEqual({ techBase: 'IS', rulesLevel: 2, mixedTech: true });
    expect(parseBlkTechLevel('Mixed (Clan Chassis) Experimental')).toEqual({ techBase: 'Clan', rulesLevel: 4, mixedTech: true });
    expect(encodeBlkTechLevel({ techBase: 'IS', rulesLevel: 2, mixedTech: true })).toBe('Mixed (IS Chassis)');
    expect(encodeBlkTechLevel({ techBase: 'Clan', rulesLevel: 4, mixedTech: true })).toBe('Mixed (Clan Chassis) Experimental');
    expect(encodeBlkTechLevel({ techBase: 'IS', rulesLevel: 2, mixedTech: false })).toBe('IS Level 2');
  });
});
