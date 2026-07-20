import type { MiscEquipment } from '../../equipment.model';
import { EquipmentRegistry } from '../../equipment-lookup';
import { ArmorEquipment } from '../../equipment.model';
import type { CockpitType, EngineType, EntityTechBase, EquipmentTechBase } from '../types';
import type { HeatSinkType } from '../types/heat-sink';
import { COCKPIT_DATA } from '../components/cockpit-data';
import { GYRO_DATA, type GyroType } from '../components/gyro-data';

const FULL_HEAD_EJECTION_SYSTEM = 'Full Head Ejection System';
const RISC_HEAT_SINK_OVERRIDE_KIT = 'RISC Heat Sink Override Kit';

function matchesMtfValue(value: string, canonicalValue: string): boolean {
  return value.trim().toLocaleLowerCase() === canonicalValue.toLocaleLowerCase();
}

export function decodeMtfFullHeadEjectionSystem(value: string): boolean {
  return matchesMtfValue(value, FULL_HEAD_EJECTION_SYSTEM);
}

export function encodeMtfFullHeadEjectionSystem(installed: boolean): string | null {
  return installed ? FULL_HEAD_EJECTION_SYSTEM : null;
}

export function decodeMtfRiscHeatSinkOverrideKit(value: string): boolean {
  return matchesMtfValue(value, RISC_HEAT_SINK_OVERRIDE_KIT);
}

export function encodeMtfRiscHeatSinkOverrideKit(installed: boolean): string | null {
  return installed ? RISC_HEAT_SINK_OVERRIDE_KIT : null;
}

export function decodeMtfCockpitType(value: string): CockpitType {
  if (value in COCKPIT_DATA) return value as CockpitType;
  const stripped = value.replace(/\s+Cockpit$/i, '').trim();
  if (stripped in COCKPIT_DATA) return stripped as CockpitType;
  const hyphenated = stripped.replace(/\s+/g, '-');
  return hyphenated in COCKPIT_DATA ? hyphenated as CockpitType : 'Standard';
}

export function decodeMtfGyroType(value: string): GyroType {
  if (value in GYRO_DATA) return value as GyroType;
  const stripped = value.replace(/\s+Gyro$/i, '').trim();
  return stripped in GYRO_DATA ? stripped as GyroType : 'Standard';
}

export interface MtfEngineInfo {
  readonly rating: number;
  readonly type: EngineType;
  readonly techBase: EntityTechBase;
}

export interface MtfArmorInfo {
  readonly type: string;
  readonly clanTech: boolean;
  readonly patchwork: boolean;
}

export interface MtfStructureInfo {
  readonly name: string;
  readonly techBase: EntityTechBase | null;
  readonly hybrid: boolean;
}

export function decodeMtfEngine(value: string): MtfEngineInfo {
  const trimmed = value.trim();
  const rating = parseInt(trimmed.match(/^(\d+)/)?.[1] ?? '0', 10);
  const typeMatches: readonly [string, EngineType][] = [
    ['Fuel Cell', 'Fuel Cell'], ['XXL', 'XXL'], ['XL', 'XL'], ['Light', 'Light'],
    ['Compact', 'Compact'], ['ICE', 'ICE'], ['I.C.E.', 'ICE'], ['Fission', 'Fission'],
    ['None', 'None'], ['Maglev', 'Maglev'], ['Steam', 'Steam'], ['Battery', 'Battery'],
    ['Solar', 'Solar'], ['External', 'External'], ['Fusion', 'Fusion'],
  ];
  return {
    rating,
    type: typeMatches.find(([pattern]) => trimmed.includes(pattern))?.[1] ?? 'Fusion',
    techBase: trimmed.includes('(Clan)') ? 'Clan' : 'IS',
  };
}

export interface MtfEngineEncoding {
  readonly rating: number;
  readonly type: EngineType;
  readonly techBase: EntityTechBase;
  readonly mixedTech: boolean;
}

const MTF_MEK_ENGINE_TYPES: ReadonlySet<EngineType> = new Set([
  'Fusion', 'XL', 'XXL', 'Light', 'Compact', 'ICE', 'Fuel Cell', 'Fission',
]);

export function encodeMtfEngine(engine: MtfEngineEncoding | null): string {
  if (!engine) return 'None';
  const typeName = engine.type;
  if (!MTF_MEK_ENGINE_TYPES.has(typeName)) {
    throw new Error(`Engine type "${typeName}" cannot be encoded in a Mek MTF`);
  }
  const large = engine.rating > 400 ? 'Large ' : '';
  if (engine.techBase === 'Clan') {
    return `${engine.rating} ${large}${typeName} (Clan) Engine`;
  }
  return `${engine.rating} ${large}${typeName} Engine${engine.mixedTech ? '(IS)' : ''}`;
}

export function decodeMtfStructure(value: string): MtfStructureInfo {
  const trimmed = value.trim() || 'Standard';
  if (trimmed.toLowerCase() === 'hybrid') {
    return { name: 'Standard', techBase: null, hybrid: true };
  }
  const match = trimmed.match(/^(IS|Clan)\s+(.+)$/i);
  if (!match) return { name: trimmed, techBase: null, hybrid: false };
  return {
    name: match[2].trim() || 'Standard',
    techBase: match[1].toLowerCase() === 'clan' ? 'Clan' : 'IS',
    hybrid: false,
  };
}

export function encodeMtfStructure(
  name: string,
  techBase: EntityTechBase | null,
  hybrid: boolean,
): string {
  if (hybrid) return 'Hybrid';
  return `${techBase ? `${techBase} ` : ''}${name}`;
}

export function decodeMtfArmor(value: string): MtfArmorInfo {
  const trimmed = value.trim();
  if (trimmed.toLowerCase().includes('patchwork')) {
    return { type: 'Patchwork', clanTech: trimmed.includes('(Clan)'), patchwork: true };
  }
  const type = trimmed
    .replace(/\s*\(Clan\)/i, '')
    .replace(/\s*\(Inner Sphere\)/i, '')
    .replace(/\s*\(IS\)/i, '')
    .replace(/\s*Armor$/i, '')
    .trim() || 'Standard';
  return { type, clanTech: trimmed.includes('(Clan)'), patchwork: false };
}

/**
 * Resolve an MTF armor display name using MegaMek's tech-prefixed aliases.
 */
export function resolveMtfArmorEquipment(
  displayName: string,
  isClan: boolean,
  equipmentRegistry: EquipmentRegistry,
): ArmorEquipment | null {
  let lookupName = displayName.trim()
    .replace(/\s*\((?:Inner Sphere|IS|Clan)\)\s*$/i, '')
    .trim();
  if (!/^(?:Clan|IS)\s/i.test(lookupName)) {
    lookupName = `${isClan ? 'Clan' : 'IS'} ${lookupName}`;
  }
  if (!/\sArmor$/i.test(lookupName)) lookupName += ' Armor';

  const equipment = equipmentRegistry.find(lookupName);
  return equipment instanceof ArmorEquipment ? equipment : null;
}

export function encodeMtfArmor(
  displayName: string,
  techBase: EquipmentTechBase,
  patchwork: boolean,
): string {
  if (patchwork) return 'Patchwork';
  return `${displayName}(${techBase === 'Clan' ? 'Clan' : 'Inner Sphere'})`;
}

export interface MtfHeatSinkConfiguration {
  readonly count: number;
  readonly type: HeatSinkType;
  readonly equipmentId: string;
}

export function decodeMtfHeatSinks(value: string): MtfHeatSinkConfiguration {
  const parts = value.trim().split(/\s+/);
  const parsedCount = parseInt(parts[0], 10);
  const count = Number.isNaN(parsedCount) ? 10 : parsedCount;
  const label = parts.slice(1).join(' ') || 'Single';
  const lowerLabel = label.toLowerCase();

  if (lowerLabel.includes('freezer')) {
    return { count, type: 'Double', equipmentId: 'ISDoubleHeatSinkFreezer' };
  }
  if (lowerLabel.includes('prototype')) {
    return { count, type: 'Double', equipmentId: 'ISDoubleHeatSinkPrototype' };
  }
  if (lowerLabel.includes('double')) {
    return {
      count,
      type: 'Double',
      equipmentId: /^Clan\b/i.test(label) ? 'CLDoubleHeatSink' : 'ISDoubleHeatSink',
    };
  }
  if (lowerLabel.includes('compact')) {
    return { count, type: 'Compact', equipmentId: '1 Compact Heat Sink' };
  }
  if (lowerLabel.includes('laser')) {
    return { count, type: 'Laser', equipmentId: 'Laser Heat Sink' };
  }
  return { count, type: 'Single', equipmentId: 'Heat Sink' };
}

export function encodeMtfHeatSinkType(equipment: MiscEquipment | null): string {
  if (!equipment) return 'Single';
  if (equipment.hasFlag('F_IS_DOUBLE_HEAT_SINK_PROTOTYPE')) return 'Single';
  if (equipment.isCompactHeatSink) return 'Compact';
  if (equipment.hasFlag('F_LASER_HEAT_SINK')) return 'Laser';
  if (equipment.hasFlag('F_DOUBLE_HEAT_SINK')) {
    return `${equipment.tech.base === 'Clan' ? 'Clan' : 'IS'} Double`;
  }
  return 'Single';
}
