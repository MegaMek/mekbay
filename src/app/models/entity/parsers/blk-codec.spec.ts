import { ArmorEquipment } from '../../equipment.model';
import { createMountedArmor } from '../components/armor';
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
  getBlkMekHeatSinkEquipmentId,
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

  it('encodes armor type and explicit BLK overrides', () => {
    const armor = createMountedArmor({ type: 'FERRO_FIBROUS', techRating: 4, techLevel: 6 });
    expect(encodeBlkArmorType(armor)).toBe(1);
    expect(encodeBlkArmorTechRating(armor)).toBe(4);
    expect(encodeBlkArmorTechLevel(armor, true)).toBe(6);
  });

  it('derives BLK armor rating and compound tech level from equipment', () => {
    const equipment = new ArmorEquipment({
      id: 'TestArmor', name: 'Test Armor', type: 'armor',
      tech: { rating: 'E', level: 'Advanced' }, armor: { type: 'STANDARD' },
    });
    const armor = createMountedArmor({ armor: equipment });
    expect(encodeBlkArmorTechRating(armor)).toBe(4);
    expect(encodeBlkArmorTechLevel(armor, false)).toBe(5);
    expect(encodeBlkArmorTechLevel(armor, true)).toBe(6);
  });
});
