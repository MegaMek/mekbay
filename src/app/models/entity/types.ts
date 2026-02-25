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
  | 'CL'                                                        // tripod extra
  | 'FLL' | 'FRL' | 'RLL' | 'RRL';                              // quad

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

// ============================================================================
// Location Constant Arrays
// ============================================================================

export const MEK_LOCATIONS = ['HD', 'LA', 'LT', 'CT', 'RT', 'RA', 'LL', 'RL'] as const;
export const MEK_TRIPOD_LOCATIONS = [...MEK_LOCATIONS, 'CL'] as const;
export const MEK_QUAD_LOCATIONS = ['HD', 'FLL', 'LT', 'CT', 'RT', 'FRL', 'RLL', 'RRL'] as const;

/** Mek locations that support rear armor (front + rear ≤ 2 × IS) */
export const MEK_REAR_ARMOR_LOCATIONS: ReadonlySet<string> = new Set(['CT', 'LT', 'RT']);

export const AERO_LOCATIONS = ['Nose', 'Left Wing', 'Right Wing', 'Aft'] as const;
export const AERO_EQUIP_LOCATIONS = ['Nose', 'Left Wing', 'Right Wing', 'Aft', 'Wings', 'Fuselage'] as const;
export const FIXED_WING_EQUIP_LOCATIONS = ['Nose', 'Left Wing', 'Right Wing', 'Aft', 'Wings', 'Body'] as const;

export const TANK_LOCATIONS = ['Front', 'Right', 'Left', 'Rear'] as const;
export const VTOL_LOCATIONS = ['Front', 'Right', 'Left', 'Rear', 'Rotor'] as const;

export const BA_LOCATIONS = ['Squad'] as const;
export const PROTO_LOCATIONS = ['Head', 'Torso', 'Right Arm', 'Left Arm', 'Legs'] as const;

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
