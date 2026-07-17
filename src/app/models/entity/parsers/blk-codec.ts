import type { MountedArmor } from '../components/armor';
import type { GyroType } from '../components/gyro-data';
import type { ArmorType } from '../types/armor';
import type { AeroCockpitType, AeroDesignType, DriveCoreType, DropShipCollarType } from '../types/aero';
import type { EngineType } from '../types/engine';
import type { CockpitType } from '../types/mek';
import { createCompoundTechLevel, type ComponentTechLevel, type CompoundTechLevel, type EntityTechBase } from '../types/tech';
import type { HeatSinkType } from '../types/heat-sink';

export interface BlkTechLevel {
  readonly techBase: EntityTechBase;
  readonly rulesLevel: number;
  readonly mixedTech: boolean;
}

const TECH_RATING_TO_BLK_CODE: Readonly<Record<string, number>> = {
  A: 0, B: 1, C: 2, D: 3, E: 4, F: 5,
};

export function encodeBlkCompoundTechLevel(
  technology: CompoundTechLevel,
): number {
  if (technology.scope === 'Allowed All') return -2;
  if (technology.scope === 'Unknown') return -1;
  if (technology.scope === 'IS TW') return 3;
  if (technology.scope === 'TW') return 4;
  if (technology.scope === 'All IS') return 11;
  if (technology.scope === 'All Clan') return 12;
  if (technology.scope === 'All') return 13;
  if (technology.level === 'Introductory') return 0;
  const isClan = technology.scope === 'Clan';
  if (technology.level === 'Advanced') return isClan ? 6 : 5;
  if (technology.level === 'Experimental') return isClan ? 8 : 7;
  if (technology.level === 'Unofficial') return isClan ? 10 : 9;
  return isClan ? 2 : 1;
}

export function decodeBlkCompoundTechLevel(code: number): CompoundTechLevel {
  switch (code) {
    case -2: return { level: 'Standard', scope: 'Allowed All' };
    case 0: return { level: 'Introductory', scope: 'IS' };
    case 1: return { level: 'Standard', scope: 'IS' };
    case 2: return { level: 'Standard', scope: 'Clan' };
    case 3: return { level: 'Standard', scope: 'IS TW' };
    case 4: return { level: 'Standard', scope: 'TW' };
    case 5: return { level: 'Advanced', scope: 'IS' };
    case 6: return { level: 'Advanced', scope: 'Clan' };
    case 7: return { level: 'Experimental', scope: 'IS' };
    case 8: return { level: 'Experimental', scope: 'Clan' };
    case 9: return { level: 'Unofficial', scope: 'IS' };
    case 10: return { level: 'Unofficial', scope: 'Clan' };
    case 11: return { level: 'Standard', scope: 'All IS' };
    case 12: return { level: 'Standard', scope: 'All Clan' };
    case 13: return { level: 'Standard', scope: 'All' };
    default: return { level: 'Standard', scope: 'Unknown' };
  }
}

export function decodeBlkCompoundTechBase(code: number, fallback: EntityTechBase): EntityTechBase {
  const scope = decodeBlkCompoundTechLevel(code).scope;
  if (scope === 'Clan' || scope === 'All Clan') return 'Clan';
  if (scope === 'IS' || scope === 'IS TW' || scope === 'All IS') return 'IS';
  return fallback;
}

export function componentTechLevelFromRulesLevel(rulesLevel: number): ComponentTechLevel {
  switch (rulesLevel) {
    case 1: return 'Introductory';
    case 3: return 'Advanced';
    case 4: return 'Experimental';
    case 5: return 'Unofficial';
    default: return 'Standard';
  }
}

export function parseBlkTechLevel(value: string): BlkTechLevel {
  const normalized = value.trim();
  const mixedTech = /^mixed\b/i.test(normalized);
  const techBase: EntityTechBase = /clan(?:\s+chassis)?/i.test(normalized) ? 'Clan' : 'IS';
  const numericLevel = normalized.match(/\blevel\s+(\d+)\b/i)?.[1];
  let rulesLevel = numericLevel ? Number(numericLevel) : 2;

  if (/\bunofficial\b/i.test(normalized)) rulesLevel = 5;
  else if (/\bexperimental\b/i.test(normalized)) rulesLevel = 4;
  else if (/\badvanced\b/i.test(normalized)) rulesLevel = 3;

  return { techBase, rulesLevel, mixedTech };
}

export function encodeBlkTechLevel(techLevel: BlkTechLevel): string {
  if (techLevel.mixedTech) {
    const chassis = techLevel.techBase === 'Clan' ? 'Clan Chassis' : 'IS Chassis';
    const suffix = new Map<number, string>([
      [3, 'Advanced'],
      [4, 'Experimental'],
      [5, 'Unofficial'],
    ]).get(techLevel.rulesLevel);
    return `Mixed (${chassis})${suffix ? ` ${suffix}` : ''}`;
  }
  return `${techLevel.techBase === 'Clan' ? 'Clan' : 'IS'} Level ${techLevel.rulesLevel}`;
}

export function encodeBlkRulesLevel(rulesLevel: number, isClan: boolean): number {
  return encodeBlkCompoundTechLevel(createCompoundTechLevel(
    componentTechLevelFromRulesLevel(rulesLevel),
    isClan ? 'Clan' : 'IS',
  ));
}

const HEAT_SINK_TYPE_FROM_BLK_CODE: Readonly<Record<number, HeatSinkType>> = {
  0: 'Single',
  1: 'Double',
  2: 'Compact',
  3: 'Laser',
};

const HEAT_SINK_TYPE_TO_BLK_CODE: Readonly<Record<HeatSinkType, number>> = {
  Single: 0,
  Double: 1,
  Compact: 2,
  Laser: 3,
};

export const ARMOR_TYPE_FROM_BLK_CODE: Readonly<Record<number, ArmorType>> = {
  0: 'STANDARD', 1: 'FERRO_FIBROUS', 2: 'REACTIVE', 3: 'REFLECTIVE', 4: 'HARDENED',
  5: 'LIGHT_FERRO', 6: 'HEAVY_FERRO', 7: 'PATCHWORK', 8: 'STEALTH',
  9: 'FERRO_FIBROUS_PROTO', 10: 'COMMERCIAL', 11: 'LC_FERRO_CARBIDE',
  12: 'LC_LAMELLOR_FERRO_CARBIDE', 13: 'LC_FERRO_IMP', 14: 'INDUSTRIAL',
  15: 'HEAVY_INDUSTRIAL', 16: 'FERRO_LAMELLOR', 17: 'PRIMITIVE', 18: 'EDP',
  19: 'ALUM', 20: 'HEAVY_ALUM', 21: 'LIGHT_ALUM', 22: 'STEALTH_VEHICLE',
  23: 'ANTI_PENETRATIVE_ABLATION', 24: 'HEAT_DISSIPATING', 25: 'IMPACT_RESISTANT',
  26: 'BALLISTIC_REINFORCED', 27: 'FERRO_ALUM_PROTO', 28: 'BA_STANDARD',
  29: 'BA_STANDARD_PROTOTYPE', 30: 'BA_STANDARD_ADVANCED', 31: 'BA_STEALTH_BASIC',
  32: 'BA_STEALTH', 33: 'BA_STEALTH_IMP', 34: 'BA_STEALTH_PROTOTYPE',
  35: 'BA_FIRE_RESIST', 36: 'BA_MIMETIC', 37: 'BA_REFLECTIVE', 38: 'BA_REACTIVE',
  39: 'PRIMITIVE_FIGHTER', 40: 'PRIMITIVE_AERO', 41: 'AEROSPACE',
  42: 'STANDARD_PROTOMEK', 43: 'SV_BAR_2', 44: 'SV_BAR_3', 45: 'SV_BAR_4',
  46: 'SV_BAR_5', 47: 'SV_BAR_6', 48: 'SV_BAR_7', 49: 'SV_BAR_8', 50: 'SV_BAR_9',
  51: 'SV_BAR_10',
};

const ARMOR_TYPE_TO_BLK_CODE: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(ARMOR_TYPE_FROM_BLK_CODE).map(([code, type]) => [type, Number(code)]),
);

const ENGINE_TYPE_TO_BLK_CODE: Readonly<Record<EngineType, number>> = {
  Fusion: 0, ICE: 1, XL: 2, XXL: 3, Light: 4, Compact: 5, 'Fuel Cell': 6,
  Fission: 7, None: 8, Maglev: 9, Steam: 10, Battery: 11, Solar: 12, External: 13,
};

const COCKPIT_TYPE_TO_BLK_CODE: Readonly<Record<CockpitType, number>> = {
  Standard: 0, Small: 1, 'Command Console': 2, 'Torso-Mounted': 3, Dual: 4,
  Industrial: 5, Primitive: 6, 'Primitive Industrial': 7, Superheavy: 8,
  'Superheavy Tripod': 9, Tripod: 10, Interface: 11,
  'Virtual Reality Piloting Pod': 12, QuadVee: 13, 'Superheavy Industrial': 14,
  'Superheavy Command Console': 15, 'Small Command Console': 16,
  'Tripod Industrial': 17, 'Superheavy Tripod Industrial': 18,
};

const GYRO_TYPE_TO_BLK_CODE: Readonly<Record<GyroType, number>> = {
  Standard: 0, XL: 1, Compact: 2, 'Heavy Duty': 3, None: 4, Superheavy: 5,
};

const DRIVE_CORE_TYPE_TO_BLK_CODE: Readonly<Record<DriveCoreType, number>> = {
  Standard: 0, Compact: 1, Subcompact: 2, None: 3, Primitive: 4,
};

const DROP_SHIP_COLLAR_TYPE_TO_BLK_CODE: Readonly<Record<DropShipCollarType, number>> = {
  Unspecified: -1, Standard: 0, Prototype: 1, 'No Boom': 2,
};

function invertCodeMap<T extends string>(
  map: Readonly<Record<T, number>>,
): Readonly<Record<number, T>> {
  return Object.fromEntries(
    (Object.entries(map) as [T, number][]).map(([type, code]) => [code, type]),
  ) as Record<number, T>;
}

export const ENGINE_TYPE_FROM_BLK_CODE = invertCodeMap(ENGINE_TYPE_TO_BLK_CODE);
const COCKPIT_TYPE_FROM_BLK_CODE = invertCodeMap(COCKPIT_TYPE_TO_BLK_CODE);
const AERO_COCKPIT_TYPE_FROM_BLK_CODE: Readonly<Record<number, AeroCockpitType>> = {
  0: 'Standard', 1: 'Small', 2: 'Command Console', 3: 'Primitive',
};
const GYRO_TYPE_FROM_BLK_CODE = invertCodeMap(GYRO_TYPE_TO_BLK_CODE);
const DRIVE_CORE_TYPE_FROM_BLK_CODE = invertCodeMap(DRIVE_CORE_TYPE_TO_BLK_CODE);
const DROP_SHIP_COLLAR_TYPE_FROM_BLK_CODE = invertCodeMap(DROP_SHIP_COLLAR_TYPE_TO_BLK_CODE);

export function decodeBlkHeatSinkType(code: number): HeatSinkType {
  return HEAT_SINK_TYPE_FROM_BLK_CODE[code] ?? 'Single';
}

export function decodeBlkAeroCockpitType(code: number): AeroCockpitType {
  return AERO_COCKPIT_TYPE_FROM_BLK_CODE[code] ?? 'Standard';
}

export function encodeBlkHeatSinkType(type: HeatSinkType): number {
  return HEAT_SINK_TYPE_TO_BLK_CODE[type] ?? 0;
}

export function decodeBlkArmorType(code: number): ArmorType {
  return ARMOR_TYPE_FROM_BLK_CODE[code] ?? 'STANDARD';
}

export function decodeBlkEngineType(code: number): EngineType {
  return ENGINE_TYPE_FROM_BLK_CODE[code] ?? 'Fusion';
}

export function encodeBlkEngineType(type: EngineType): number {
  return ENGINE_TYPE_TO_BLK_CODE[type] ?? 0;
}

export function decodeBlkCockpitType(code: number): CockpitType {
  return COCKPIT_TYPE_FROM_BLK_CODE[code] ?? 'Standard';
}

export function encodeBlkCockpitType(type: CockpitType): number {
  return COCKPIT_TYPE_TO_BLK_CODE[type] ?? 0;
}

export function decodeBlkGyroType(code: number): GyroType {
  return GYRO_TYPE_FROM_BLK_CODE[code] ?? 'Standard';
}

export function encodeBlkGyroType(type: GyroType): number {
  return GYRO_TYPE_TO_BLK_CODE[type] ?? 0;
}

export function decodeBlkAeroDesignType(code: number): AeroDesignType {
  return code === 1 ? 'Military' : 'Civilian';
}

export function encodeBlkAeroDesignType(type: AeroDesignType): number {
  return type === 'Military' ? 1 : 0;
}

export function decodeBlkDriveCoreType(code: number): DriveCoreType {
  return DRIVE_CORE_TYPE_FROM_BLK_CODE[code] ?? 'Standard';
}

export function encodeBlkDriveCoreType(type: DriveCoreType): number {
  return DRIVE_CORE_TYPE_TO_BLK_CODE[type] ?? 0;
}

export function decodeBlkDropShipCollarType(code: number): DropShipCollarType {
  return DROP_SHIP_COLLAR_TYPE_FROM_BLK_CODE[code] ?? 'Unspecified';
}

export function encodeBlkDropShipCollarType(type: DropShipCollarType): number {
  return DROP_SHIP_COLLAR_TYPE_TO_BLK_CODE[type] ?? -1;
}

export function getBlkMekHeatSinkEquipmentId(
  type: HeatSinkType,
  techBase: EntityTechBase,
): string {
  switch (type) {
    case 'Double': return techBase === 'Clan' ? 'CLDoubleHeatSink' : 'ISDoubleHeatSink';
    case 'Compact': return '1 Compact Heat Sink';
    case 'Laser': return 'Laser Heat Sink';
    default: return 'Heat Sink';
  }
}

export function encodeBlkArmorType(armor: MountedArmor): number {
  return ARMOR_TYPE_TO_BLK_CODE[armor.type] ?? 0;
}

export function encodeBlkArmorTechRating(armor: MountedArmor): number {
  if (armor.techRating >= 0) return armor.techRating;
  if (armor.armor) return TECH_RATING_TO_BLK_CODE[armor.armor.rating] ?? 3;
  return 0;
}

export function encodeBlkArmorTechLevel(armor: MountedArmor): number {
  return encodeBlkCompoundTechLevel(armor.technology);
}
