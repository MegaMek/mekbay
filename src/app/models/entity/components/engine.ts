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

/**
 * Engine system component & MountedEngine wrapper.
 *
 * The engine is the most complex system component:
 * - It spans multiple locations (CT + side torsos for XL/XXL/Light)
 * - Its critical slot layout depends on the gyro type
 * - It integrates heat sinks (weight-free, crit-free up to a capacity)
 * - Its weight depends on the type, rating, and various flags
 *
 * **MountedEngine** wraps the engine together with its heat-sink
 * configuration so that all engine-related data lives in one place.
 *
 * In MegaMek, engine-integrated heat sinks are stored as "misc" equipment
 * with negative slot indices.  Here we track them as a count on the
 * MountedEngine, which is simpler and sufficient for round-trip fidelity.
 *
 * These are NOT equipment from equipment2.json.
 */

import type { EngineType, HeatSinkType } from '../types';
import { MEK_SLOTS_PER_LOCATION } from '../types';
import { type GyroType, getGyro, normalizeGyroType } from './gyro';

// ============================================================================
// Engine Component — static definition
// ============================================================================

export interface EngineComponent {
  readonly type: EngineType;
  readonly rating: number;
  readonly isClan: boolean;
  readonly isLarge: boolean;
  readonly isSuperHeavy: boolean;
}

/**
 * Create an EngineComponent from parsed values.
 */
export function createEngine(
  type: EngineType,
  rating: number,
  isClan: boolean,
  isSuperHeavy = false,
): EngineComponent {
  return {
    type,
    rating,
    isClan,
    isLarge: rating > 400,
    isSuperHeavy,
  };
}

// ============================================================================
// Engine classification helpers
// ============================================================================

/**
 * True if this engine type is a fusion engine (produces heat sinks).
 * Matches MegaMek Engine.isFusion().
 */
export function isFusionEngine(type: EngineType): boolean {
  return type !== 'ICE' && type !== 'Fission' && type !== 'Fuel Cell'
    && type !== 'None' && type !== 'Battery' && type !== 'Solar'
    && type !== 'Steam' && type !== 'Maglev' && type !== 'External';
}

// ============================================================================
// Heat sink integration
// ============================================================================

/**
 * Number of weight-free heat sinks the engine provides.
 * Matches MegaMek Engine.getWeightFreeEngineHeatSinks().
 */
export function getWeightFreeHeatSinks(type: EngineType): number {
  if (isFusionEngine(type)) return 10;
  if (type === 'Fission') return 5;
  if (type === 'Fuel Cell') return 1;
  return 0;
}

/**
 * Maximum number of heat sinks that can be integrated into the engine
 * (i.e. don't require critical slots).
 * Matches MegaMek Engine.integralHeatSinkCapacity().
 */
export function getIntegralHeatSinkCapacity(rating: number, compact: boolean): number {
  if (compact) {
    return Math.floor(rating / 25) * 2;
  }
  return Math.floor(rating / 25);
}

// ============================================================================
// Critical slot layout — Center Torso
// ============================================================================

/**
 * Get the engine CT critical slot indices, given gyro type.
 * Matches MegaMek Engine.getCenterTorsoCriticalSlots().
 *
 * Returns an array of 0-based slot indices in the CT that the engine occupies.
 */
export function getEngineCTSlots(engine: EngineComponent, gyroType: GyroType | string): number[] {
  const { type, isLarge, isSuperHeavy } = engine;
  const normalizedGyro = normalizeGyroType(gyroType as string);

  if (type === 'Compact') {
    return isSuperHeavy ? [0, 1] : [0, 1, 2];
  }

  if (isLarge) {
    if (isSuperHeavy) {
      // Large + SH: always the same regardless of gyro type
      return [0, 1, 2, 5];
    }
    if (normalizedGyro === 'None') {
      // No gyro → engine fills contiguous slots
      return [0, 1, 2, 3, 4, 5, 6, 7];
    }
    if (normalizedGyro === 'Compact') {
      return [0, 1, 2, 5, 6, 7, 8, 9];
    }
    // Standard/Heavy Duty/XL/Superheavy gyro — all use default layout
    return [0, 1, 2, 7, 8, 9, 10, 11];
  }

  // Normal-sized engine
  if (normalizedGyro === 'None') {
    // No gyro → engine fills 6 contiguous slots
    return isSuperHeavy ? [0, 1, 2] : [0, 1, 2, 3, 4, 5];
  }
  if (normalizedGyro === 'Compact') {
    return isSuperHeavy ? [0, 1, 2] : [0, 1, 2, 5, 6, 7];
  }
  if (normalizedGyro === 'XL') {
    return isSuperHeavy ? [0, 1, 2] : [0, 1, 2, 9, 10, 11];
  }
  // Standard/Heavy Duty/Superheavy gyro
  return isSuperHeavy ? [0, 1, 2] : [0, 1, 2, 7, 8, 9];
}

// ============================================================================
// Critical slot layout — Side Torsos
// ============================================================================

/**
 * Get the engine side-torso critical slot indices.
 * Matches MegaMek Engine.getSideTorsoCriticalSlots().
 *
 * Returns an array of 0-based slot indices in each side torso.
 */
export function getEngineSideTorsoSlots(engine: EngineComponent): number[] {
  const { type, isClan, isSuperHeavy } = engine;

  if (type === 'Light' || (type === 'XL' && isClan)) {
    return isSuperHeavy ? [0] : [0, 1];
  }
  if (type === 'XL') {
    // IS XL
    return isSuperHeavy ? [0, 1] : [0, 1, 2];
  }
  if (type === 'XXL' && isClan) {
    return isSuperHeavy ? [0, 1] : [0, 1, 2, 3];
  }
  if (type === 'XXL') {
    // IS XXL
    return isSuperHeavy ? [0, 1, 2] : [0, 1, 2, 3, 4, 5];
  }
  // Fusion, Compact, ICE, etc. — no side torso crits
  return [];
}

// ============================================================================
// Engine weight
// ============================================================================

/** Engine weight lookup table, indexed by ceil(rating / 5). */
export const ENGINE_WEIGHT_TABLE: readonly number[] = [
  0.0, 0.25, 0.5, 0.5, 0.5, 0.5, 1.0, 1.0, 1.0, 1.0, 1.5, 1.5, 1.5, 2.0, 2.0,
  2.0, 2.5, 2.5, 3.0, 3.0, 3.0, 3.5, 3.5, 4.0, 4.0, 4.0, 4.5, 4.5, 5.0, 5.0,
  5.5, 5.5, 6.0, 6.0, 6.0, 7.0, 7.0, 7.5, 7.5, 8.0, 8.5,
  8.5, 9.0, 9.5, 10.0, 10.0, 10.5, 11.0, 11.5, 12.0, 12.5,
  13.0, 13.5, 14.0, 14.5, 15.5, 16.0, 16.5, 17.5, 18.0,
  19.0, 19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 27.0,
  28.5, 29.5, 31.5, 33.0, 34.5, 36.5, 38.5, 41.0, 43.5,
  46.0, 49.0, 52.5,
  56.5, 61.0, 66.5, 72.5, 79.5, 87.5, 97.0, 107.5, 119.5,
  133.5, 150.0, 168.5, 190.0, 214.5, 243.0, 275.5, 313.0,
  356.0, 405.5, 462.5,
];

/**
 * Get the base weight of a standard fusion engine at a given rating.
 * Returns 0 for ratings outside the table.
 */
export function getEngineBaseWeight(rating: number): number {
  const idx = Math.ceil(rating / 5);
  if (idx < 0 || idx >= ENGINE_WEIGHT_TABLE.length) return 0;
  return ENGINE_WEIGHT_TABLE[idx];
}

// ============================================================================
// MountedEngine — wraps engine + heat sinks for an entity
// ============================================================================

/**
 * MountedEngine contains all engine-related data for an entity:
 * - The engine component itself (type, rating, tech base)
 * - The heat sink configuration (type, total count, how many are
 *   integrated vs. externally mounted)
 *
 * In MegaMek, engine-integrated heat sinks are stored as "misc" equipment
 * with negative slot indices.  Here we track them as a count on the
 * MountedEngine, which is simpler and sufficient for round-trip fidelity.
 */
export interface MountedEngine {
  /** The engine component */
  readonly engine: EngineComponent;

  /** Type of heat sinks installed (Single, Double, Compact, Laser) */
  readonly heatSinkType: HeatSinkType;

  /**
   * Total heat sink count as declared in the file (MTF `heat sinks:` line).
   * This includes BOTH engine-integrated and externally mounted heat sinks.
   */
  readonly totalHeatSinks: number;

  /**
   * The raw heat-sink type label from the file for round-trip fidelity.
   * e.g. "Single", "IS Double", "Clan Double", "Compact", "Laser"
   */
  readonly rawHeatSinkLabel: string;

  /**
   * Base chassis heat sinks (from BLK/MTF `base chassis heat sinks:` line).
   * -1 means not specified.
   */
  readonly baseChassisHeatSinks: number;
}

// ============================================================================
// MountedEngine — derived queries
// ============================================================================

/**
 * Get the maximum number of heat sinks that can be integrated into
 * this mounted engine (don't require crit slots).
 */
export function getEngineIntegralCapacity(me: MountedEngine): number {
  return getIntegralHeatSinkCapacity(
    me.engine.rating,
    me.heatSinkType === 'Compact',
  );
}

/**
 * Get the number of heat sinks actually integrated into the engine.
 * This is min(totalHeatSinks, integralCapacity).
 */
export function getEngineIntegratedHeatSinks(me: MountedEngine): number {
  return Math.min(me.totalHeatSinks, getEngineIntegralCapacity(me));
}

/**
 * Get the number of externally mounted heat sinks (those that need crit slots).
 * total - integrated = external
 */
export function getExternalHeatSinks(me: MountedEngine): number {
  return Math.max(0, me.totalHeatSinks - getEngineIntegralCapacity(me));
}

// ============================================================================
// MountedEngine — factory
// ============================================================================

/**
 * Create a MountedEngine from an engine component + optional heat sink config.
 */
export function createMountedEngine(
  engine: EngineComponent,
  opts?: Partial<Pick<MountedEngine, 'heatSinkType' | 'totalHeatSinks' | 'rawHeatSinkLabel' | 'baseChassisHeatSinks'>>,
): MountedEngine {
  const heatSinkType = opts?.heatSinkType ?? 'Single';
  const totalHeatSinks = opts?.totalHeatSinks ?? 10;
  return {
    engine,
    heatSinkType,
    totalHeatSinks,
    rawHeatSinkLabel: opts?.rawHeatSinkLabel ?? heatSinkType,
    baseChassisHeatSinks: opts?.baseChassisHeatSinks ?? -1,
  };
}

// ============================================================================
// CT / Side-Torso system layout builders
// ============================================================================

/**
 * Build the full center-torso system slot layout, combining engine + gyro.
 * Returns an array of length `slotsPerLocation` where each entry is
 * a system type string or null (empty).
 *
 * This matches MegaMek's Engine.getCenterTorsoCriticalSlots() +
 * Mek.getGyroCrits() combined layout.
 */
export function buildCTSystemLayout(
  engine: EngineComponent,
  gyroType: GyroType | string,
): (string | null)[] {
  const layout: (string | null)[] = new Array(MEK_SLOTS_PER_LOCATION).fill(null);
  const engineSlots = getEngineCTSlots(engine, gyroType);
  const gyro = getGyro(gyroType);

  // Place engine slots
  for (const idx of engineSlots) {
    if (idx < MEK_SLOTS_PER_LOCATION) layout[idx] = 'Engine';
  }

  // Place gyro slots immediately after the first contiguous engine block
  // Find the first gap in engine slots to determine gyro start position
  let gyroStart = 0;
  for (const idx of engineSlots) {
    if (idx === gyroStart) gyroStart = idx + 1;
    else break;
  }
  for (let i = 0; i < gyro.criticalSlots; i++) {
    const idx = gyroStart + i;
    if (idx < MEK_SLOTS_PER_LOCATION) layout[idx] = 'Gyro';
  }

  return layout;
}

/**
 * Build the side-torso system slot layout for one side torso.
 */
export function buildSideTorsoSystemLayout(
  engine: EngineComponent,
): (string | null)[] {
  const layout: (string | null)[] = new Array(MEK_SLOTS_PER_LOCATION).fill(null);
  const slots = getEngineSideTorsoSlots(engine);
  for (const idx of slots) {
    if (idx < MEK_SLOTS_PER_LOCATION) layout[idx] = 'Engine';
  }
  return layout;
}
