/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { Equipment } from '../equipment.model';

// ============================================================================
// Entity Identity
// ============================================================================

/** Discriminant type for all entity subclasses */
export type EntityType =
  | 'Mek'
  | 'Aero'
  | 'ConvFighter'
  | 'FixedWingSupport'
  | 'SmallCraft'
  | 'DropShip'
  | 'JumpShip'
  | 'WarShip'
  | 'SpaceStation'
  | 'Tank'
  | 'Naval'
  | 'VTOL'
  | 'SupportTank'
  | 'SupportVTOL'
  | 'LargeSupportTank'
  | 'GunEmplacement'
  | 'Infantry'
  | 'BattleArmor'
  | 'ProtoMek'
  | 'HandheldWeapon';

/** Tech base as stored in entity files */
export type EntityTechBase = 'Inner Sphere' | 'Clan' | 'Mixed';

// ============================================================================
// Engine
// ============================================================================

export type EngineType =
  | 'Fusion' | 'ICE' | 'XL' | 'XXL' | 'Light' | 'Compact'
  | 'Fuel Cell' | 'Fission' | 'None' | 'Maglev' | 'Steam'
  | 'Battery' | 'Solar' | 'External';

/** Engine flags — derived from entity properties, not user-set */
export type EngineFlag =
  | 'clan' | 'tank' | 'large' | 'superheavy' | 'support-vee';

export const ENGINE_TYPE_FROM_CODE: Record<number, EngineType> = {
  0: 'Fusion', 1: 'ICE', 2: 'XL', 3: 'XXL', 4: 'Light', 5: 'Compact',
  6: 'Fuel Cell', 7: 'Fission', 8: 'None', 9: 'Maglev', 10: 'Steam',
  11: 'Battery', 12: 'Solar', 13: 'External',
};

export const ENGINE_TYPE_TO_CODE: Record<EngineType, number> = {
  'Fusion': 0, 'ICE': 1, 'XL': 2, 'XXL': 3, 'Light': 4, 'Compact': 5,
  'Fuel Cell': 6, 'Fission': 7, 'None': 8, 'Maglev': 9, 'Steam': 10,
  'Battery': 11, 'Solar': 12, 'External': 13,
};

export function engineTypeFromCode(code: number): EngineType {
  return ENGINE_TYPE_FROM_CODE[code] ?? 'Fusion';
}

export function engineTypeToCode(type: EngineType): number {
  return ENGINE_TYPE_TO_CODE[type] ?? 0;
}

// ============================================================================
// Heat Sinks
// ============================================================================

export type HeatSinkType = 'Single' | 'Double' | 'Compact' | 'Laser';

export const HEAT_SINK_TYPE_FROM_CODE: Record<number, HeatSinkType> = {
  0: 'Single', 1: 'Double', 2: 'Compact', 3: 'Laser',
};

export const HEAT_SINK_TYPE_TO_CODE: Record<HeatSinkType, number> = {
  'Single': 0, 'Double': 1, 'Compact': 2, 'Laser': 3,
};

// ============================================================================
// Armor Types
//
// The ArmorType enum strings match the `armor.type` field in the equipment
// JSON (which mirrors MegaMek's ArmorType enum names).  The BLK format only
// stores a numeric code; the mapping below converts in both directions.
// ============================================================================

import { ArmorEquipment, EquipmentMap, TechLevel } from '../equipment.model';

/**
 * Armor type identifiers.  Values are the MegaMek ArmorType enum names and
 * match the `armor.type` field in the equipment JSON, with the addition of
 * PATCHWORK which has no standalone equipment entry.
 */
export type ArmorType =
  | 'STANDARD'
  | 'FERRO_FIBROUS'
  | 'REACTIVE'
  | 'REFLECTIVE'
  | 'HARDENED'
  | 'LIGHT_FERRO'
  | 'HEAVY_FERRO'
  | 'PATCHWORK'
  | 'STEALTH'
  | 'FERRO_FIBROUS_PROTO'
  | 'COMMERCIAL'
  | 'LC_FERRO_CARBIDE'
  | 'LC_LAMELLOR_FERRO_CARBIDE'
  | 'LC_FERRO_IMP'
  | 'INDUSTRIAL'
  | 'HEAVY_INDUSTRIAL'
  | 'FERRO_LAMELLOR'
  | 'PRIMITIVE'
  | 'EDP'
  | 'ALUM'
  | 'HEAVY_ALUM'
  | 'LIGHT_ALUM'
  | 'STEALTH_VEHICLE'
  | 'ANTI_PENETRATIVE_ABLATION'
  | 'HEAT_DISSIPATING'
  | 'IMPACT_RESISTANT'
  | 'BALLISTIC_REINFORCED'
  | 'FERRO_ALUM_PROTO'
  | 'BA_STANDARD'
  | 'BA_STANDARD_PROTOTYPE'
  | 'BA_STANDARD_ADVANCED'
  | 'BA_STEALTH_BASIC'
  | 'BA_STEALTH'
  | 'BA_STEALTH_IMP'
  | 'BA_STEALTH_PROTOTYPE'
  | 'BA_FIRE_RESIST'
  | 'BA_MIMETIC'
  | 'BA_REFLECTIVE'
  | 'BA_REACTIVE'
  | 'PRIMITIVE_FIGHTER'
  | 'PRIMITIVE_AERO'
  | 'AEROSPACE'
  | 'STANDARD_PROTOMEK'
  | 'SV_BAR_2'
  | 'SV_BAR_3'
  | 'SV_BAR_4'
  | 'SV_BAR_5'
  | 'SV_BAR_6'
  | 'SV_BAR_7'
  | 'SV_BAR_8'
  | 'SV_BAR_9'
  | 'SV_BAR_10';

/** Map from BLK armor type code → ArmorType enum */
export const ARMOR_TYPE_FROM_CODE: Record<number, ArmorType> = {
  0:  'STANDARD',
  1:  'FERRO_FIBROUS',
  2:  'REACTIVE',
  3:  'REFLECTIVE',
  4:  'HARDENED',
  5:  'LIGHT_FERRO',
  6:  'HEAVY_FERRO',
  7:  'PATCHWORK',
  8:  'STEALTH',
  9:  'FERRO_FIBROUS_PROTO',
  10: 'COMMERCIAL',
  11: 'LC_FERRO_CARBIDE',
  12: 'LC_LAMELLOR_FERRO_CARBIDE',
  13: 'LC_FERRO_IMP',
  14: 'INDUSTRIAL',
  15: 'HEAVY_INDUSTRIAL',
  16: 'FERRO_LAMELLOR',
  17: 'PRIMITIVE',
  18: 'EDP',
  19: 'ALUM',
  20: 'HEAVY_ALUM',
  21: 'LIGHT_ALUM',
  22: 'STEALTH_VEHICLE',
  23: 'ANTI_PENETRATIVE_ABLATION',
  24: 'HEAT_DISSIPATING',
  25: 'IMPACT_RESISTANT',
  26: 'BALLISTIC_REINFORCED',
  27: 'FERRO_ALUM_PROTO',
  28: 'BA_STANDARD',
  29: 'BA_STANDARD_PROTOTYPE',
  30: 'BA_STANDARD_ADVANCED',
  31: 'BA_STEALTH_BASIC',
  32: 'BA_STEALTH',
  33: 'BA_STEALTH_IMP',
  34: 'BA_STEALTH_PROTOTYPE',
  35: 'BA_FIRE_RESIST',
  36: 'BA_MIMETIC',
  37: 'BA_REFLECTIVE',
  38: 'BA_REACTIVE',
  39: 'PRIMITIVE_FIGHTER',
  40: 'PRIMITIVE_AERO',
  41: 'AEROSPACE',
  42: 'STANDARD_PROTOMEK',
  43: 'SV_BAR_2',
  44: 'SV_BAR_3',
  45: 'SV_BAR_4',
  46: 'SV_BAR_5',
  47: 'SV_BAR_6',
  48: 'SV_BAR_7',
  49: 'SV_BAR_8',
  50: 'SV_BAR_9',
  51: 'SV_BAR_10',
};

/** Reverse map from ArmorType enum → BLK numeric code */
export const ARMOR_TYPE_TO_CODE: Record<string, number> = Object.fromEntries(
  Object.entries(ARMOR_TYPE_FROM_CODE).map(([code, name]) => [name, parseInt(code, 10)])
);

export function armorTypeFromCode(code: number): ArmorType {
  return ARMOR_TYPE_FROM_CODE[code] ?? 'STANDARD';
}

export function armorTypeToCode(type: ArmorType): number {
  return ARMOR_TYPE_TO_CODE[type] ?? 0;
}

// ── Armor tech helpers (derive from ArmorEquipment data) ────────────────────

/** Convert a tech rating letter (A–F) to its numeric index (0–5). */
export const TECH_RATING_TO_NUMBER: Record<string, number> = {
  A: 0, B: 1, C: 2, D: 3, E: 4, F: 5,
};

/**
 * Compound tech level as written to BLK `armor_tech_level`.
 * Mirrors `SimpleTechLevel.getCompoundTechLevel(isClan)` in MegaMek.
 *
 * | TechLevel      | IS | Clan |
 * |----------------|----|------|
 * | Introductory   |  0 |    0 |
 * | Standard       |  1 |    2 |
 * | Advanced       |  5 |    6 |
 * | Experimental   |  7 |    8 |
 */
export function compoundTechLevel(level: TechLevel | undefined, isClan: boolean): number {
  switch (level) {
    case 'Introductory':  return 0;
    case 'Standard':      return isClan ? 2 : 1;
    case 'Advanced':      return isClan ? 6 : 5;
    case 'Experimental':  return isClan ? 8 : 7;
    default:              return isClan ? 2 : 1; // safe fallback
  }
}

// ── Armor equipment resolution ──────────────────────────────────────────────

/** Lazily built index: ArmorType → { is?: ArmorEquipment, clan?: ArmorEquipment } */
let _armorIndex: Map<string, { is?: ArmorEquipment; clan?: ArmorEquipment }> | null = null;
let _armorIndexDb: EquipmentMap | null = null;

/**
 * Build (or return cached) index mapping ArmorType enum → ArmorEquipment,
 * split by tech base.  Rebuilt when the underlying equipment DB changes.
 */
export function getArmorIndex(
  equipmentDb: EquipmentMap,
): Map<string, { is?: ArmorEquipment; clan?: ArmorEquipment }> {
  if (_armorIndex && _armorIndexDb === equipmentDb) return _armorIndex;

  const idx = new Map<string, { is?: ArmorEquipment; clan?: ArmorEquipment }>();
  for (const eq of Object.values(equipmentDb)) {
    if (!(eq instanceof ArmorEquipment)) continue;
    const aType = eq.armorType; // e.g. 'ALUM', 'STANDARD'
    if (!aType) continue;
    const entry = idx.get(aType) ?? {};
    if (eq.techBase === 'Clan') entry.clan = eq;
    else entry.is = eq; // 'IS' or 'All'
    idx.set(aType, entry);
  }

  _armorIndex = idx;
  _armorIndexDb = equipmentDb;
  return idx;
}

/**
 * Resolve the ArmorEquipment for a given ArmorType + tech base.
 * Returns null for PATCHWORK or unknown types.
 */
export function resolveArmorEquipment(
  armorType: ArmorType,
  isClan: boolean,
  equipmentDb: EquipmentMap,
): ArmorEquipment | null {
  const idx = getArmorIndex(equipmentDb);
  const entry = idx.get(armorType);
  if (!entry) return null;
  if (isClan) return entry.clan ?? entry.is ?? null;
  return entry.is ?? entry.clan ?? null;
}

/**
 * Resolve ArmorEquipment by display name (e.g. "Ferro-Fibrous" from MTF).
 * Searches the equipment DB for an ArmorEquipment with a matching `name`.
 */
export function resolveArmorByName(
  displayName: string,
  isClan: boolean,
  equipmentDb: EquipmentMap,
): ArmorEquipment | null {
  let best: ArmorEquipment | null = null;
  for (const eq of Object.values(equipmentDb)) {
    if (!(eq instanceof ArmorEquipment)) continue;
    if (eq.name !== displayName) continue;
    // Prefer matching tech base
    if (isClan && eq.techBase === 'Clan') return eq;
    if (!isClan && eq.techBase !== 'Clan') return eq;
    best = eq; // fallback to any match
  }
  return best;
}

// ============================================================================
// Internal Structure Types
// ============================================================================

export const STRUCTURE_TYPE_FROM_CODE: Record<number, string> = {
  0: 'Standard',
  1: 'Endo Steel',
  2: 'Endo Steel Prototype',
  3: 'Reinforced',
  4: 'Composite',
  5: 'Industrial',
  6: 'Endo-Composite',
};

export const STRUCTURE_TYPE_TO_CODE: Record<string, number> = Object.fromEntries(
  Object.entries(STRUCTURE_TYPE_FROM_CODE).map(([code, name]) => [name, parseInt(code, 10)])
);

export function structureTypeFromCode(code: number): string {
  return STRUCTURE_TYPE_FROM_CODE[code] ?? 'Standard';
}

export function structureTypeToCode(name: string): number {
  return STRUCTURE_TYPE_TO_CODE[name] ?? 0;
}

// ============================================================================
// Gyro Types (Mek)
// ============================================================================

export const GYRO_TYPE_FROM_CODE: Record<number, string> = {
  0: 'Standard', 1: 'XL', 2: 'Compact', 3: 'Heavy Duty', 4: 'None', 5: 'Superheavy',
};

export function gyroTypeFromCode(code: number): string {
  return GYRO_TYPE_FROM_CODE[code] ?? 'Standard';
}

// ============================================================================
// Cockpit Types (Mek / Aero)
// ============================================================================

export const MEK_COCKPIT_TYPE_FROM_CODE: Record<number, string> = {
  0: 'Standard', 1: 'Small', 2: 'Command Console', 3: 'Torso-Mounted',
  4: 'Dual', 5: 'Industrial', 6: 'Primitive', 7: 'Primitive Industrial',
  8: 'Superheavy', 9: 'Superheavy Tripod', 10: 'Tripod',
  11: 'Interface', 12: 'Virtual Reality Piloting Pod', 13: 'QuadVee',
};

export function mekCockpitTypeFromCode(code: number): string {
  return MEK_COCKPIT_TYPE_FROM_CODE[code] ?? 'Standard';
}

// ============================================================================
// Valid Value Sets (for parser validation)
// ============================================================================

/** Valid vehicle motion types — derived from SUSPENSION_FACTOR_TABLE keys */
export const VALID_VEHICLE_MOTION_TYPES = new Set([
  'Tracked', 'Wheeled', 'Hover', 'WiGE',
  'Naval', 'Submarine', 'Hydrofoil',
  'VTOL',
]);

/** Valid infantry motion types */
export const VALID_INFANTRY_MOTION_TYPES = new Set([
  'Leg', 'Motorized', 'Jump', 'Mechanized', 'Submarine',
  'Hover', 'Wheeled', 'Tracked', 'VTOL',
]);

/** Valid BA motion types */
export const VALID_BA_MOTION_TYPES = new Set([
  'Leg', 'Jump', 'VTOL', 'UMU',
]);

/** Valid aero motion types */
export const VALID_AERO_MOTION_TYPES = new Set(['Aerodyne']);

/** Valid DropShip / SmallCraft motion types */
export const VALID_SPACECRAFT_MOTION_TYPES = new Set(['Aerodyne', 'Spheroid']);

/** Valid fuel types for vehicles */
export const VALID_FUEL_TYPES = new Set([
  'PETROCHEMICALS', 'ALCOHOL', 'NATURAL_GAS', 'COAL', 'WOOD',
  'METHANE', 'KEROSENE', 'DIESEL', 'GASOLINE',
]);

/** Canonical system manufacturer/model keys (from MegaMek's System enum) */
export type SystemManufacturerKey = 'CHASSIS' | 'ENGINE' | 'ARMOR' | 'JUMP_JET' | 'COMMUNICATIONS' | 'TARGETING';

/** The 6 canonical keys */
export const VALID_SYSTEM_MANUFACTURER_KEYS = new Set<SystemManufacturerKey>([
  'CHASSIS', 'ENGINE', 'ARMOR', 'JUMP_JET', 'COMMUNICATIONS', 'TARGETING',
]);

/**
 * Normalize variant key forms to canonical keys.
 * MegaMek-resaved files always use the uppercase canonical form, but older
 * hand-edited files or third-party tools might use mixed-case variants.
 * Returns the canonical key, or `undefined` if unrecognized.
 */
export const SYSTEM_MANUFACTURER_KEY_ALIASES: Record<string, SystemManufacturerKey> = {
  // Canonical (identity)
  'CHASSIS':        'CHASSIS',
  'ENGINE':         'ENGINE',
  'ARMOR':          'ARMOR',
  'JUMP_JET':       'JUMP_JET',
  'COMMUNICATIONS': 'COMMUNICATIONS',
  'TARGETING':      'TARGETING',
  // Mixed-case variants
  'JUMPJET':        'JUMP_JET',
};

export function normalizeSystemManufacturerKey(raw: string): SystemManufacturerKey | undefined {
  return SYSTEM_MANUFACTURER_KEY_ALIASES[raw];
}

/** Valid BLK tech-level strings in the `type` block */
export const VALID_TECH_BASE_STRINGS = new Set([
  'IS Level 1', 'IS Level 2', 'IS Level 3', 'IS Level 4', 'IS Level 5',
  'Clan Level 1', 'Clan Level 2', 'Clan Level 3', 'Clan Level 4', 'Clan Level 5',
  'Mixed (IS Chassis) Level 1', 'Mixed (IS Chassis) Level 2', 'Mixed (IS Chassis) Level 3',
  'Mixed (IS Chassis) Level 4', 'Mixed (IS Chassis) Level 5',
  'Mixed (Clan Chassis) Level 1', 'Mixed (Clan Chassis) Level 2', 'Mixed (Clan Chassis) Level 3',
  'Mixed (Clan Chassis) Level 4', 'Mixed (Clan Chassis) Level 5',
  'IS Level 2 (Unofficial)', 'IS Level 3 (Unofficial)',
  'Clan Level 2 (Unofficial)', 'Clan Level 3 (Unofficial)',
  'Mixed (IS Chassis) Level 2 (Unofficial)', 'Mixed (IS Chassis) Level 3 (Unofficial)',
  'Mixed (Clan Chassis) Level 2 (Unofficial)', 'Mixed (Clan Chassis) Level 3 (Unofficial)',
]);

/** Valid BA weight classes */
export const VALID_BA_WEIGHT_CLASSES = new Set([
  'PA(L)', 'Light', 'Medium', 'Heavy', 'Assault',
]);

/** Valid design type codes for DropShips */
export const VALID_DESIGN_TYPE_CODES = new Set([0, 1]);

// ============================================================================
// Mek Configuration
// ============================================================================

export type MekConfig = 'Biped' | 'Quad' | 'Tripod' | 'LAM' | 'QuadVee';

/** Mek system types that occupy critical slots */
export type MekSystemType =
  | 'Engine' | 'Gyro' | 'Sensors' | 'Life Support' | 'Cockpit'
  | 'Shoulder' | 'Upper Arm Actuator' | 'Lower Arm Actuator' | 'Hand Actuator'
  | 'Hip' | 'Upper Leg Actuator' | 'Lower Leg Actuator' | 'Foot Actuator'
  | 'Landing Gear' | 'Avionics';

// ============================================================================
// Location Topology
//
// Defines the physical connection graph between Mek locations: which
// location damage transfers into, and which locations are destroyed as
// dependents when a parent is lost.
// ============================================================================

/**
 * Physical connection descriptor for a single Mek location.
 *
 * `transfersTo`  — next inward location for damage transfer when this
 *                  location's internal structure is destroyed.
 *                  `null` = terminal (CT destroyed → Mek destroyed).
 *
 * `dependents`   — locations physically attached to this one that are
 *                  also destroyed when it is destroyed
 *                  (e.g. losing RT also destroys RA).
 */
export interface LocTopology {
  readonly transfersTo: MekLocation | null;
  readonly dependents: readonly MekLocation[];
}

/**
 * Biped / Tripod Mek location topology.
 *
 *            HD
 *            │
 *    LA─LT──CT──RT─RA
 *        │       │
 *       LL      RL
 *       (CL)              ← Tripod only
 */
export const BIPED_TOPOLOGY: Readonly<Record<MekLocation, LocTopology>> = {
  HD:  { transfersTo: 'CT',   dependents: [] },
  CT:  { transfersTo: null,   dependents: [] },
  RT:  { transfersTo: 'CT',   dependents: ['RA'] },
  LT:  { transfersTo: 'CT',   dependents: ['LA'] },
  RA:  { transfersTo: 'RT',   dependents: [] },
  LA:  { transfersTo: 'LT',   dependents: [] },
  RL:  { transfersTo: 'RT',   dependents: [] },
  LL:  { transfersTo: 'LT',   dependents: [] },
  CL:  { transfersTo: 'CT',   dependents: [] },   // Tripod only
  // Quad keys — present but unused for bipeds
  FLL: { transfersTo: 'LT',   dependents: [] },
  FRL: { transfersTo: 'RT',   dependents: [] },
  RLL: { transfersTo: 'LT',   dependents: [] },
  RRL: { transfersTo: 'RT',   dependents: [] },
};

/**
 * Quad Mek location topology.
 *
 *             HD
 *             │
 *   FLL─LT──CT──RT─FRL
 *        │       │
 *       RLL     RRL
 */
export const QUAD_TOPOLOGY: Readonly<Record<MekLocation, LocTopology>> = {
  HD:  { transfersTo: 'CT',   dependents: [] },
  CT:  { transfersTo: null,   dependents: [] },
  RT:  { transfersTo: 'CT',   dependents: ['FRL', 'RRL'] },
  LT:  { transfersTo: 'CT',   dependents: ['FLL', 'RLL'] },
  FRL: { transfersTo: 'RT',   dependents: [] },
  FLL: { transfersTo: 'LT',   dependents: [] },
  RRL: { transfersTo: 'RT',   dependents: [] },
  RLL: { transfersTo: 'LT',   dependents: [] },
  // Biped keys — present but unused for quads
  RA:  { transfersTo: 'RT',   dependents: [] },
  LA:  { transfersTo: 'LT',   dependents: [] },
  RL:  { transfersTo: 'RT',   dependents: [] },
  LL:  { transfersTo: 'LT',   dependents: [] },
  CL:  { transfersTo: 'CT',   dependents: [] },
};

/** Set of all leg-type location codes (biped + quad + tripod) */
export const LEG_LOCATIONS: ReadonlySet<MekLocation> = new Set<MekLocation>(
  ['LL', 'RL', 'CL', 'FRL', 'FLL', 'RRL', 'RLL'],
);

/** Set of quad-only leg location codes */
export const FOUR_LEGGED_LOCATIONS: ReadonlySet<MekLocation> = new Set<MekLocation>(
  ['FRL', 'FLL', 'RRL', 'RLL'],
);

/**
 * The complete set of all canonical MekLocation values.
 * Used internally by the `isMekLocation` type guard.
 */
const ALL_MEK_LOCATIONS: ReadonlySet<string> = new Set<MekLocation>([
  'HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL',
  'CL', 'FLL', 'FRL', 'RLL', 'RRL',
]);

/** Type guard: narrows an arbitrary string to `MekLocation`. */
export function isMekLocation(s: string): s is MekLocation {
  return ALL_MEK_LOCATIONS.has(s);
}

/** Returns the appropriate topology map for a set of location keys. */
export function getTopologyFor(
  locationKeys: Iterable<string>,
): Readonly<Record<MekLocation, LocTopology>> {
  for (const key of locationKeys) {
    if (isMekLocation(key) && FOUR_LEGGED_LOCATIONS.has(key)) return QUAD_TOPOLOGY;
  }
  return BIPED_TOPOLOGY;
}

// ============================================================================
// Infantry Specializations
// ============================================================================

export type InfantrySpecialization =
  | 'bridge-engineers' | 'demo-engineers' | 'fire-engineers' | 'mine-engineers'
  | 'sensor-engineers' | 'trench-engineers' | 'marines' | 'mountain-troops'
  | 'paramedics' | 'paratroops' | 'tag-troops' | 'xct' | 'scuba';

export const INFANTRY_SPECIALIZATION_FROM_BIT: Record<number, InfantrySpecialization> = {
  0: 'bridge-engineers', 1: 'demo-engineers', 2: 'fire-engineers',
  3: 'mine-engineers', 4: 'sensor-engineers', 5: 'trench-engineers',
  6: 'marines', 7: 'mountain-troops', 8: 'paramedics',
  9: 'paratroops', 10: 'tag-troops', 11: 'xct', 12: 'scuba',
};

export const INFANTRY_SPECIALIZATION_TO_BIT: Record<InfantrySpecialization, number> = {
  'bridge-engineers': 0, 'demo-engineers': 1, 'fire-engineers': 2,
  'mine-engineers': 3, 'sensor-engineers': 4, 'trench-engineers': 5,
  'marines': 6, 'mountain-troops': 7, 'paramedics': 8,
  'paratroops': 9, 'tag-troops': 10, 'xct': 11, 'scuba': 12,
};

// ============================================================================
// Typed Location IDs
//
// Canonical identifiers for every location family. Parser normalization maps
// convert raw MTF/BLK strings to these IDs at ingress — the rest of the
// codebase ONLY uses these canonical IDs.
// ============================================================================

/** Canonical Mek location codes */
export type MekLocation =
  | 'HD' | 'CT' | 'LT' | 'RT' | 'LA' | 'RA' | 'LL' | 'RL'   // biped
  | 'CL'                                                    // tripod extra
  | 'FLL' | 'FRL' | 'RLL' | 'RRL';                          // quad

/** Canonical Aero armor/structure locations */
export type AeroArmorLocation = 'Nose' | 'Left Wing' | 'Right Wing' | 'Aft';

/** Canonical Aero equipment locations (include stowage) */
export type AeroEquipLocation =
  | 'Nose' | 'Left Wing' | 'Right Wing' | 'Aft' | 'Wings'
  | 'Fuselage' | 'Body';

/** Canonical Tank location codes */
export type TankLocation =
  | 'Front' | 'Right' | 'Left' | 'Rear'
  | 'Turret' | 'Front Turret' | 'Rear Turret' | 'Rotor';

/** Canonical SmallCraft / DropShip equipment locations */
export type SmallCraftEquipLocation =
  | 'Nose' | 'Left Side' | 'Right Side' | 'Aft' | 'Hull';

/** Canonical JumpShip / WarShip / SpaceStation locations */
export type LargeCraftLocation = 'Nose' | 'FLS' | 'FRS' | 'ALS' | 'ARS' | 'Aft';

export type Location = MekLocation | AeroArmorLocation | AeroEquipLocation | TankLocation | SmallCraftEquipLocation | LargeCraftLocation;

// ============================================================================
// Location Constant Arrays
// ============================================================================

export const MEK_LOCATIONS = ['HD', 'LA', 'LT', 'CT', 'RT', 'RA', 'LL', 'RL'] as const;
export const MEK_TRIPOD_LOCATIONS = [...MEK_LOCATIONS, 'CL'] as const;
export const MEK_QUAD_LOCATIONS = ['HD', 'FLL', 'LT', 'CT', 'RT', 'FRL', 'RLL', 'RRL'] as const;

/** Mek locations that support rear armor */
export const MEK_REAR_ARMOR_LOCATIONS: ReadonlySet<string> = new Set(['CT', 'LT', 'RT']);

export const AERO_LOCATIONS = ['Nose', 'Left Wing', 'Right Wing', 'Aft'] as const;
export const AERO_EQUIP_LOCATIONS = ['Nose', 'Left Wing', 'Right Wing', 'Aft', 'Wings', 'Fuselage'] as const;
export const FIXED_WING_EQUIP_LOCATIONS = ['Nose', 'Left Wing', 'Right Wing', 'Aft', 'Wings', 'Body'] as const;

export const TANK_LOCATIONS = ['Front', 'Right', 'Left', 'Rear'] as const;
export const VTOL_LOCATIONS = ['Front', 'Right', 'Left', 'Rear', 'Rotor'] as const;
export const TANK_LOCATIONS_WITH_TURRET = [...TANK_LOCATIONS, 'Turret'] as const;
export const TANK_LOCATIONS_WITH_DUAL_TURRET = [...TANK_LOCATIONS, 'Front Turret', 'Rear Turret'] as const;
export const VTOL_LOCATIONS_WITH_TURRET = ['Front', 'Right', 'Left', 'Rear', 'Turret', 'Rotor'] as const;
export const LARGE_SUPPORT_TANK_LOCATIONS = [
  'Front', 'Front Right', 'Front Left',
  'Right', 'Left',
  'Rear', 'Rear Right', 'Rear Left',
] as const;
export const LARGE_SUPPORT_TANK_LOCATIONS_WITH_TURRET = [...LARGE_SUPPORT_TANK_LOCATIONS, 'Turret'] as const;

export const BA_LOCATIONS = ['Squad'] as const;
export const PROTO_LOCATIONS = ['Head', 'Torso', 'Right Arm', 'Left Arm', 'Legs'] as const;
export const PROTO_LOCATIONS_WITH_MAIN_GUN = [...PROTO_LOCATIONS, 'Main Gun'] as const;

export const LARGE_CRAFT_LOCATIONS = ['Nose', 'FLS', 'FRS', 'ALS', 'ARS', 'Aft'] as const;
export const SMALL_CRAFT_EQUIP_LOCATIONS = ['Nose', 'Left Side', 'Right Side', 'Aft', 'Hull'] as const;
export const SMALL_CRAFT_ARMOR_LOCATIONS = ['Nose', 'Left Side', 'Right Side', 'Aft'] as const;
export const DROPSHIP_LOCATIONS = ['Nose', 'LF', 'RF', 'LBS', 'RBS', 'Aft'] as const;

// ============================================================================
// Armor — structured face model
//
// Replaces the old "CT-rear" string-key convention with a typed structure.
// Every location stores { front, rear }.  For locations without rear armor,
// `rear` is always 0.
// ============================================================================

/** Which face of armor we are referencing */
export type ArmorFace = 'front' | 'rear';

/** Armor values for a single location. Rear is 0 for locations without rear armor. */
export interface LocationArmor {
  readonly front: number;
  readonly rear: number;
}

/** Create a LocationArmor, defaulting rear to 0 */
export function locationArmor(front: number, rear = 0): LocationArmor {
  return { front, rear };
}

// ============================================================================
// Mount Placement — Mek crit slot positions
//
// Each placement anchors one crit of an equipment mount to a specific
// (location, slot-index) pair.  Together with the system template, these
// derive the crit-slot grid without a separate editable signal.
// ============================================================================

/** A single crit-slot assignment for a Mek equipment mount */
export interface MountPlacement {
  readonly location: string;
  readonly slotIndex: number;
}

// ============================================================================
// Mounted Equipment — the single canonical equipment model
//
// The entity's `equipment` signal is the sole source of truth for what is
// installed.  Mek critical-slot grids and location inventories are DERIVED
// from this list; they are never independently editable.
// ============================================================================

export interface EntityMountedEquipment {
  /** Stable unique identifier within this entity */
  readonly mountId: string;

  /** Internal name — lookup key into the equipment DB */
  equipmentId: string;

  /** Resolved reference (set after parse / on equipment DB load) */
  equipment?: Equipment;

  /** Primary location code (canonical ID) */
  location: string;

  /**
   * Mek only: explicit crit-slot assignments for this mount.
   * The array length equals the number of crits the equipment occupies.
   * Non-Mek entity types leave this undefined.
   */
  placements?: readonly MountPlacement[];

  /** Number of crits occupied (equals placements.length for Meks) */
  criticalSlots?: number;

  /** Rear-mounted */
  rearMounted: boolean;

  /** Turret-mounted (Mek head turret) */
  turretMounted: boolean;

  /** Vehicle turret type */
  turretType?: 'standard' | 'sponson' | 'pintle';

  /** OmniPod equipped */
  omniPodMounted: boolean;

  /** Component armored */
  armored: boolean;

  /** VGL facing (0–5) */
  facing?: number;

  /** Variable-size equipment size */
  size?: number;

  /** Split weapon tracking (Mek: crits span multiple locations) */
  isSplit?: boolean;

  /** BA mount location */
  baMountLocation?: 'Body' | 'LA' | 'RA' | 'Turret';

  /** Detachable Weapon Pack */
  isDWP?: boolean;

  /** Squad Support Weapon Mount */
  isSSWM?: boolean;

  /** Anti-Personnel Mount weapon */
  isAPM?: boolean;

  /** Ammo: shot count */
  shotsLeft?: number;

  /** Weapon bay members (large craft) */
  bayWeapons?: number[];

  /** Weapon bay ammo (large craft) */
  bayAmmo?: number[];

  /** Starts a new weapon bay (large craft) */
  isNewBay?: boolean;

  /** Combined slot — second equipment in same slot (superheavy Mek) */
  secondEquipmentId?: string;
  secondEquipment?: Equipment;
}

// ============================================================================
// Critical Slot View — derived, read-only grid cell
//
// The Mek crit grid is a COMPUTED view, never a writable signal.
// Writers and UI read this view; mutations go through the equipment list.
// ============================================================================

export interface CriticalSlotView {
  readonly type: 'system' | 'equipment' | 'empty';
  readonly systemType?: MekSystemType;
  /** References EntityMountedEquipment.mountId — not an array index */
  readonly mountId?: string;
  readonly armored: boolean;
  readonly omniPod: boolean;
}

// ============================================================================
// Transporters & Bays
// ============================================================================

export interface EntityTransporter {
  type: string;
  capacity: number;
  doors: number;
  bayNumber: number;
  platoonType?: string;
  facing?: number;
  bitmap?: number;
}

export interface EntityWeaponBay {
  weaponIndices: number[];
  ammoIndices: number[];
  location: string;
  bayType: string;
}

export interface EntityTransportBay {
  type: string;
  capacity: number;
  doors: number;
  bayNumber: number;
}

// ============================================================================
// Crew (SmallCraft / DropShip)
// ============================================================================

export interface SmallCraftCrew {
  officers?: number;
  gunners?: number;
  crew?: number;
  passengers?: number;
  marines?: number;
  battleArmorHandles?: number;
  firstClassQuarters?: number;
  secondClassQuarters?: number;
  crewQuarters?: number;
  steerage?: number;
}

// ============================================================================
// Quirks
// ============================================================================

export interface EntityQuirk {
  name: string;
}

export interface EntityWeaponQuirk {
  name: string;
  weaponName: string;
  location: string;
  slot: number;
}

// ============================================================================
// Fluff
// ============================================================================

export interface EntityFluff {
  overview?: string;
  capabilities?: string;
  deployment?: string;
  history?: string;
  manufacturer?: string;
  primaryFactory?: string;
  systemManufacturers?: Record<string, string>;
  systemModels?: Record<string, string>;
  notes?: string;
}

// ============================================================================
// Validation — tiered slices
//
// Validation is split into independent computed slices (engine, armor,
// equipment, type-specific) so that changing armour doesn't recompute the
// engine check, and vice-versa.  A single aggregate computed collects them.
// ============================================================================

export type ValidationCategory =
  | 'engine' | 'armor' | 'weight' | 'equipment' | 'structure'
  | 'movement' | 'heat' | 'tech' | 'crit' | 'general';

export interface EntityValidationMessage {
  severity: 'error' | 'warning' | 'info';
  category: ValidationCategory;
  code: string;
  message: string;
  location?: string;
}

export interface EntityValidationResult {
  valid: boolean;
  messages: EntityValidationMessage[];
}

// ============================================================================
// Internal Structure Lookup Tables
// ============================================================================

/**
 * Standard internal structure table for Meks, indexed by tonnage.
 * Each entry is [Head, CT, SideTorso, Arm, Leg].
 */
export const MEK_INTERNAL_STRUCTURE: Record<number, [number, number, number, number, number]> = {
  10:  [3,  4,  3,  1,  2],
  15:  [3,  5,  4,  2,  3],
  20:  [3,  6,  5,  3,  4],
  25:  [3,  8,  6,  4,  6],
  30:  [3, 10,  7,  5,  7],
  35:  [3, 11,  8,  6,  8],
  40:  [3, 12, 10,  6, 10],
  45:  [3, 14, 11,  7, 11],
  50:  [3, 16, 12,  8, 12],
  55:  [3, 18, 13,  9, 13],
  60:  [3, 20, 14, 10, 14],
  65:  [3, 21, 15, 10, 15],
  70:  [3, 22, 15, 11, 15],
  75:  [3, 23, 16, 12, 16],
  80:  [3, 25, 17, 13, 17],
  85:  [3, 27, 18, 14, 18],
  90:  [3, 29, 19, 15, 19],
  95:  [3, 30, 20, 16, 20],
  100: [3, 31, 21, 17, 21],
  105: [4, 32, 22, 17, 22],
  110: [4, 33, 23, 18, 23],
  115: [4, 35, 24, 19, 24],
  120: [4, 36, 25, 20, 25],
  125: [4, 38, 26, 20, 26],
  130: [4, 39, 27, 21, 27],
  135: [4, 41, 28, 22, 28],
  140: [4, 42, 29, 23, 29],
  145: [4, 44, 31, 24, 31],
  150: [4, 45, 32, 25, 32],
  155: [4, 47, 33, 25, 33],
  160: [4, 48, 34, 26, 34],
  165: [4, 50, 35, 27, 35],
  170: [4, 51, 36, 28, 36],
  175: [4, 53, 37, 29, 37],
  180: [4, 54, 38, 30, 38],
  185: [4, 56, 39, 30, 39],
  190: [4, 57, 40, 31, 40],
  195: [4, 59, 41, 32, 41],
  200: [4, 60, 42, 33, 42],
};

// ============================================================================
// Suspension Factor Table (Tanks)
// ============================================================================

export const SUSPENSION_FACTOR_TABLE: Record<string, (tonnage: number) => number> = {
  'Tracked':   (_t: number) => 0,
  'Wheeled':   (t: number) => t <= 80 ? 20 : 40,
  'Hover':     (t: number) => t <= 10 ? 40 : t <= 20 ? 85 : t <= 30 ? 130 : t <= 40 ? 175 : 220,
  'Naval':     (_t: number) => 30,
  'Submarine': (_t: number) => 35,
  'Hydrofoil': (_t: number) => 60,
  'WiGE':      (t: number) => t <= 80 ? 45 : 80,
  'VTOL':      (t: number) => t <= 10 ? 50 : t <= 20 ? 95 : t <= 30 ? 140 : 140,
};
