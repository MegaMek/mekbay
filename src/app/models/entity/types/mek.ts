// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { MekLocation } from './locations';
import type { EntityMountedEquipment } from './equipment';

// ============================================================================
// Mek Configuration
// ============================================================================

export type MekConfig = 'Biped' | 'Quad' | 'Tripod' | 'LAM' | 'QuadVee';

/** Mek system types that occupy critical slots */
export type MekSystemType =
  | 'Engine' | 'Gyro' | 'Sensors' | 'Life Support' | 'Cockpit'
  | 'Shoulder' | 'Upper Arm Actuator' | 'Lower Arm Actuator' | 'Hand Actuator'
  | 'Hip' | 'Upper Leg Actuator' | 'Lower Leg Actuator' | 'Foot Actuator'
  | 'Landing Gear' | 'Avionics' | 'Conversion Gear';

/** Number of critical slots per location for all Mek types (including superheavy). */
export const MEK_SLOTS_PER_LOCATION = 12;

/** Mek locations that support rear armor */
export const MEK_REAR_ARMOR_LOCATIONS: ReadonlySet<string> = new Set(['CT', 'LT', 'RT']);

export const MEK_TORSO_LOCATIONS: ReadonlySet<string> = new Set(['CT', 'LT', 'RT']);
export const MEK_SIDE_TORSO_LOCATIONS = ['LT', 'RT'] as const satisfies readonly MekLocation[];

const MEK_LOCATION_LABELS: Readonly<Record<MekLocation, string>> = {
  HD: 'Head',
  CT: 'Center Torso',
  LT: 'Left Torso',
  RT: 'Right Torso',
  LA: 'Left Arm',
  RA: 'Right Arm',
  LL: 'Left Leg',
  RL: 'Right Leg',
  CL: 'Center Leg',
  FLL: 'Front Left Leg',
  FRL: 'Front Right Leg',
  RLL: 'Rear Left Leg',
  RRL: 'Rear Right Leg',
};

/** Full display label for a canonical Mek location. */
export function getMekLocationLabel(location: string | undefined): string | null {
  return location && isMekLocation(location) ? MEK_LOCATION_LABELS[location] : null;
}

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
 * `transfersTo`  - next inward location for damage transfer when this
 *                  location's internal structure is destroyed.
 *                  `null` = terminal (CT destroyed → Mek destroyed).
 *
 * `dependents`   - locations physically attached to this one that are
 *                  also destroyed when it is destroyed
 *                  (e.g. losing RT also destroys RA).
 */
export interface LocTopology {
  readonly transfersTo: MekLocation | null;
  readonly dependents: readonly MekLocation[];
}

type BipedTopologyLocation = Exclude<MekLocation, 'CL' | 'FLL' | 'FRL' | 'RLL' | 'RRL'>;
type TripodTopologyLocation = BipedTopologyLocation | 'CL';
type QuadTopologyLocation = Exclude<MekLocation, 'LA' | 'RA' | 'LL' | 'RL' | 'CL'>;
export type MekTopology = Readonly<Partial<Record<MekLocation, LocTopology>>>;

/**
 * Biped Mek location topology.
 *
 *            HD
 *            │
 *    LA─LT──CT──RT─RA
 *        │       │
 *       LL      RL
 */
export const BIPED_TOPOLOGY = {
  HD:  { transfersTo: 'CT',   dependents: [] },
  CT:  { transfersTo: null,   dependents: [] },
  RT:  { transfersTo: 'CT',   dependents: ['RA'] },
  LT:  { transfersTo: 'CT',   dependents: ['LA'] },
  RA:  { transfersTo: 'RT',   dependents: [] },
  LA:  { transfersTo: 'LT',   dependents: [] },
  RL:  { transfersTo: 'RT',   dependents: [] },
  LL:  { transfersTo: 'LT',   dependents: [] },
} as const satisfies Readonly<Record<BipedTopologyLocation, LocTopology>>;

/**
 * Tripod Mek location topology.
 *
 *            HD
 *            │
 *    LA─LT──CT──RT─RA
 *        │   |   │
 *       LL  CL  RL
 */
/** Tripod Mek location topology: biped structure with a center leg. */
export const TRIPOD_TOPOLOGY = {
  ...BIPED_TOPOLOGY,
  CL: { transfersTo: 'CT', dependents: [] },
} as const satisfies Readonly<Record<TripodTopologyLocation, LocTopology>>;

/**
 * Quad Mek location topology.
 *
 *             HD
 *             │
 *   FLL─LT──CT──RT─FRL
 *        │       │
 *       RLL     RRL
 */
export const QUAD_TOPOLOGY = {
  HD:  { transfersTo: 'CT',   dependents: [] },
  CT:  { transfersTo: null,   dependents: [] },
  RT:  { transfersTo: 'CT',   dependents: ['FRL'] },
  LT:  { transfersTo: 'CT',   dependents: ['FLL'] },
  FRL: { transfersTo: 'RT',   dependents: [] },
  FLL: { transfersTo: 'LT',   dependents: [] },
  RRL: { transfersTo: 'RT',   dependents: [] },
  RLL: { transfersTo: 'LT',   dependents: [] },
} as const satisfies Readonly<Record<QuadTopologyLocation, LocTopology>>;

/** Adjacent location pairs that may share split equipment (legs excluded). */
const MEK_SPLIT_ADJACENT_LOCATIONS: ReadonlyMap<MekLocation, ReadonlySet<MekLocation>> = new Map([
  ['LA', new Set<MekLocation>(['LT'])],
  ['LT', new Set<MekLocation>(['LA', 'CT'])],
  ['RA', new Set<MekLocation>(['RT'])],
  ['RT', new Set<MekLocation>(['RA', 'CT'])],
  ['CT', new Set<MekLocation>(['LT', 'RT'])],
]);

export function areMekSplitLocationsAdjacent(locationA: string, locationB: string): boolean {
  return isMekLocation(locationA)
    && isMekLocation(locationB)
    && (MEK_SPLIT_ADJACENT_LOCATIONS.get(locationA)?.has(locationB) ?? false);
}

/** Returns the split location with the more restrictive firing arc. */
export function getMekSplitPrimaryLocation(locationA: string, locationB: string): string {
  if (MEK_TORSO_LOCATIONS.has(locationB) && !MEK_TORSO_LOCATIONS.has(locationA)) return locationB;
  if (MEK_TORSO_LOCATIONS.has(locationA) && !MEK_TORSO_LOCATIONS.has(locationB)) return locationA;
  if (locationA === 'CT') return locationA;
  if (locationB === 'CT') return locationB;
  return locationA;
}

export const BIPED_LEG_LOCATIONS = ['LL', 'RL'] as const satisfies readonly MekLocation[];
export const TRIPOD_LEG_LOCATIONS = ['LL', 'RL', 'CL'] as const satisfies readonly MekLocation[];
export const QUAD_LEG_LOCATIONS = ['FLL', 'FRL', 'RLL', 'RRL'] as const satisfies readonly MekLocation[];

export const LEG_LOCATIONS: ReadonlySet<string> = new Set([
  ...TRIPOD_LEG_LOCATIONS,
  ...QUAD_LEG_LOCATIONS,
]);

const ARM_LOCATIONS = ['LA', 'RA'] as const satisfies readonly MekLocation[];
const QUAD_LEG_LOCATION_SET: ReadonlySet<string> = new Set(QUAD_LEG_LOCATIONS);

export function isQuadMekConfig(config: MekConfig): boolean {
  return config === 'Quad' || config === 'QuadVee';
}

export function getMekLegLocations(config: MekConfig): readonly MekLocation[] {
  if (isQuadMekConfig(config)) return QUAD_LEG_LOCATIONS;
  if (config === 'Tripod') return TRIPOD_LEG_LOCATIONS;
  return BIPED_LEG_LOCATIONS;
}

export function isMekLegLocation(config: MekConfig, location: string): location is MekLocation {
  return getMekLegLocations(config).some(leg => leg === location);
}

export function getMekLimbLocations(config: MekConfig): readonly MekLocation[] {
  const legs = getMekLegLocations(config);
  return isQuadMekConfig(config) ? legs : [...legs, ...ARM_LOCATIONS];
}

export function inferMekConfigFromLocations(locations: Iterable<string>): 'Biped' | 'Quad' | 'Tripod' {
  let hasCenterLeg = false;
  for (const location of locations) {
    if (QUAD_LEG_LOCATION_SET.has(location)) return 'Quad';
    if (location === 'CL') hasCenterLeg = true;
  }
  return hasCenterLeg ? 'Tripod' : 'Biped';
}

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
): MekTopology {
  const config = inferMekConfigFromLocations(locationKeys);
  if (config === 'Quad') return QUAD_TOPOLOGY;
  if (config === 'Tripod') return TRIPOD_TOPOLOGY;
  return BIPED_TOPOLOGY;
}

/** Returns the location whose destruction also destroys the given dependent location. */
export function getMekLocationParent(
  locationKeys: Iterable<string>,
  location: string,
): MekLocation | null {
  if (!isMekLocation(location)) return null;
  const topology = getTopologyFor(locationKeys);
  return (Object.entries(topology) as [MekLocation, LocTopology][])
    .find(([, descriptor]) => descriptor.dependents.includes(location))?.[0] ?? null;
}

// ============================================================================
// Critical Slot View - derived, read-only grid cell
//
// The Mek crit grid is a COMPUTED view, never a writable signal.
// Writers and UI read this view; mutations go through the equipment list.
// ============================================================================

export type CriticalSlotView =
  | {
    readonly type: 'system';
    readonly systemType: MekSystemType;
    readonly armored: boolean;
    readonly omniPod: false;
  }
  | {
    readonly type: 'equipment';
    /** One mount normally; up to two canonical mounts share a superheavy slot. */
    readonly mounts: readonly [EntityMountedEquipment, ...EntityMountedEquipment[]];
    /** Slot-wide state; shared equipment cannot be partially armored or OmniPod-mounted. */
    readonly armored: boolean;
    readonly omniPod: boolean;
  }
  | {
    readonly type: 'empty';
    readonly armored: false;
    readonly omniPod: false;
  };

/** Serializes one or two canonical mounts occupying a physical critical slot. */
export function formatCriticalSlotEquipment(
  slot: Extract<CriticalSlotView, { type: 'equipment' }>,
  formatMount: (mount: EntityMountedEquipment, isLast: boolean) => string,
): string {
  const lastIndex = slot.mounts.length - 1;
  return slot.mounts.map((mount, index) => formatMount(mount, index === lastIndex)).join('|');
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
  125: [4, 38, 26, 21, 26],
  130: [4, 39, 27, 21, 27],
  135: [4, 41, 28, 22, 28],
  140: [4, 42, 29, 23, 29],
  145: [4, 44, 31, 24, 31],
  150: [4, 45, 32, 25, 32],
  155: [4, 47, 33, 26, 33],
  160: [4, 48, 34, 26, 34],
  165: [4, 50, 35, 27, 35],
  170: [4, 51, 36, 28, 36],
  175: [4, 53, 37, 29, 37],
  180: [4, 54, 38, 30, 38],
  185: [4, 56, 39, 31, 39],
  190: [4, 57, 40, 31, 40],
  195: [4, 59, 41, 32, 41],
  200: [4, 60, 42, 33, 42],
};
