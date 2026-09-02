// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { MountedArmor } from '../components/armor';
import { ArmorEquipment, createEquipment } from '../../equipment.model';
import {
  type AeroDesignType,
  type DriveCoreType,
  type DropShipCollarType,
  type EngineType,
  type HeatSinkType,
  VALID_TECH_BASE_STRINGS,
} from '../types';
import {
  encodeBlkAeroCockpitType,
  decodeBlkAeroDesignType,
  decodeBlkAeroCockpitType,
  decodeBlkArmorType,
  decodeBlkDriveCoreType,
  decodeBlkDropShipCollarType,
  decodeBlkEngineType,
  decodeBlkHeatSinkType,
  decodeBlkCompoundTechBase,
  decodeBlkCompoundTechLevel,
  encodeBlkAeroDesignType,
  encodeBlkArmorTechLevel,
  encodeBlkArmorTechRating,
  encodeBlkArmorType,
  encodeBlkDriveCoreType,
  encodeBlkDropShipCollarType,
  encodeBlkEngineType,
  encodeBlkHeatSinkType,
  encodeBlkTechLevel,
  parseBlkTechLevel,
} from './blk-codec';

const ENGINE_TYPES: readonly EngineType[] = [
  'Fusion', 'ICE', 'XL', 'XXL', 'Light', 'Compact', 'Fuel Cell', 'Fission',
  'None', 'Maglev', 'Steam', 'Battery', 'Solar', 'External',
];
const HEAT_SINK_TYPES: readonly HeatSinkType[] = ['Single', 'Double', 'Compact', 'Laser'];
const DESIGN_TYPES: readonly AeroDesignType[] = ['Civilian', 'Military'];
const DRIVE_CORE_TYPES: readonly DriveCoreType[] = ['Standard', 'Compact', 'Subcompact', 'None', 'Primitive'];
const COLLAR_TYPES: readonly DropShipCollarType[] = ['Unspecified', 'Standard', 'Prototype', 'No Boom'];

describe('BLK codec', () => {
  it('encodes semantic aero cockpit types to MegaMek BLK codes', () => {
    expect(encodeBlkAeroCockpitType('Standard')).toBe(0);
    expect(encodeBlkAeroCockpitType('Small')).toBe(1);
    expect(encodeBlkAeroCockpitType('Command Console')).toBe(2);
    expect(encodeBlkAeroCockpitType('Primitive')).toBe(3);
  });

  it('round trips every live engine and heat-sink code', () => {
    for (const type of ENGINE_TYPES) expect(decodeBlkEngineType(encodeBlkEngineType(type))).toBe(type);
    for (const type of HEAT_SINK_TYPES) expect(decodeBlkHeatSinkType(encodeBlkHeatSinkType(type))).toBe(type);
  });

  it('round trips every aero construction code', () => {
    for (const type of DESIGN_TYPES) expect(decodeBlkAeroDesignType(encodeBlkAeroDesignType(type))).toBe(type);
    for (const type of DRIVE_CORE_TYPES) expect(decodeBlkDriveCoreType(encodeBlkDriveCoreType(type))).toBe(type);
    for (const type of COLLAR_TYPES) expect(decodeBlkDropShipCollarType(encodeBlkDropShipCollarType(type))).toBe(type);
  });

  it('decodes aerospace cockpit codes independently of Mek cockpit codes', () => {
    expect([0, 1, 2, 3].map(decodeBlkAeroCockpitType))
      .toEqual(['Standard', 'Small', 'Command Console', 'Primitive']);
  });

  it('uses canonical defaults for unknown codes', () => {
    expect(decodeBlkArmorType(999)).toBe('STANDARD');
    expect(decodeBlkEngineType(999)).toBe('Fusion');
    expect(decodeBlkDriveCoreType(999)).toBe('Standard');
    expect(decodeBlkDropShipCollarType(999)).toBe('Unspecified');
  });

  it('encodes armor type and structured BLK values', () => {
    const equipment = createEquipment({
      id: 'Clan Ferro-Fibrous',
      name: 'Ferro-Fibrous',
      type: 'armor',
      armor: { type: 'FERRO_FIBROUS' },
      tech: { base: 'Clan', level: 'Experimental', rating: 'E' },
    });
    expect(equipment instanceof ArmorEquipment).toBeTrue();
    const armor = new MountedArmor({
      techBase: 'Clan',
      techRating: 'E',
      armor: equipment as ArmorEquipment,
      technology: { level: 'Experimental', scope: 'Clan' },
    });
    expect(encodeBlkArmorType(armor)).toBe(1);
    expect(encodeBlkArmorTechRating(armor)).toBe(4);
    expect(encodeBlkArmorTechLevel(armor)).toBe(8);
  });

  it('uses structured armor technology for resolved Standard armor', () => {
    const equipment = new ArmorEquipment({
      id: 'Standard Armor',
      name: 'Standard',
      type: 'armor',
      armor: { type: 'STANDARD' },
      tech: { base: 'All', level: 'Introductory' },
    });
    const armor = new MountedArmor({ armor: equipment, techBase: 'IS' });
    expect(encodeBlkArmorTechLevel(armor)).toBe(0);
  });

  it('decodes compound tech codes only into domain tech bases', () => {
    for (const code of [2, 6, 8, 10, 12]) expect(decodeBlkCompoundTechBase(code, 'IS')).toBe('Clan');
    for (const code of [0, 1, 3, 5, 7, 9, 11]) expect(decodeBlkCompoundTechBase(code, 'Clan')).toBe('IS');
    expect(decodeBlkCompoundTechBase(-1, 'Clan')).toBe('Clan');
    expect(decodeBlkCompoundTechBase(-1, 'IS')).toBe('IS');
    for (const code of [4, 13]) expect(decodeBlkCompoundTechBase(code, 'Clan')).toBe('Clan');
  });

  it('parses and canonically encodes BLK entity tech levels', () => {
    expect(parseBlkTechLevel(' IS Level 2 Advanced ')).toEqual({ techBase: 'IS', rulesLevel: 3, mixedTech: false });
    expect(parseBlkTechLevel('Mixed (IS Chassis)')).toEqual({ techBase: 'IS', rulesLevel: 2, mixedTech: true });
    expect(parseBlkTechLevel('Mixed (Clan Chassis) Advanced')).toEqual({ techBase: 'Clan', rulesLevel: 3, mixedTech: true });
    expect(parseBlkTechLevel('Mixed (Clan Chassis) Experimental')).toEqual({ techBase: 'Clan', rulesLevel: 4, mixedTech: true });
    expect(encodeBlkTechLevel({ techBase: 'IS', rulesLevel: 2, mixedTech: true })).toBe('Mixed (IS Chassis)');
    expect(encodeBlkTechLevel({ techBase: 'Clan', rulesLevel: 4, mixedTech: true })).toBe('Mixed (Clan Chassis) Experimental');
    expect(encodeBlkTechLevel({ techBase: 'IS', rulesLevel: 2, mixedTech: false })).toBe('IS Level 2');
  });

  it('validates exactly the BLK entity tech-level strings accepted by MegaMek', () => {
    const megaMekTechLevels = [
      'IS',
      'IS Level 1', 'IS Level 2', 'IS Level 3', 'IS Level 4', 'IS Level 5',
      'Clan',
      'Clan Level 2', 'Clan Level 3', 'Clan Level 4', 'Clan Level 5',
      'Mixed (IS Chassis)',
      'Mixed (IS Chassis) Advanced',
      'Mixed (IS Chassis) Experimental',
      'Mixed (IS Chassis) Unofficial',
      'Mixed (Clan Chassis)',
      'Mixed (Clan Chassis) Advanced',
      'Mixed (Clan Chassis) Experimental',
      'Mixed (Clan Chassis) Unofficial',
    ];

    expect([...VALID_TECH_BASE_STRINGS]).toEqual(megaMekTechLevels);
    expect(VALID_TECH_BASE_STRINGS.has('Mixed (Clan Chassis) Level 3')).toBeFalse();
    expect(VALID_TECH_BASE_STRINGS.has('Clan Level 1')).toBeFalse();
  });
});
