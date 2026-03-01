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
 * MountedEngine - the single class for engine + heat-sink state.
 *
 * The engine is the most complex system component:
 * - It spans multiple locations (CT + side torsos for XL/XXL/Light)
 * - Its critical slot layout depends on the gyro type
 * - It integrates heat sinks (weight-free, crit-free up to a capacity)
 * - Its weight depends on the type, rating, and various flags
 *
 * **MountedEngine** combines the engine definition (type, rating, tech base)
 * with its heat-sink configuration and auto-resolves the descriptor from
 * `ENGINE_DATA` so that all engine-related data lives in one place.
 *
 * In MegaMek, engine-integrated heat sinks are stored as "misc" equipment
 * with negative slot indices.  Here we track them as a count on the
 * MountedEngine, which is simpler and sufficient for round-trip fidelity.
 *
 * These are NOT equipment from equipment2.json.
 */

import { signal, computed, WritableSignal } from '@angular/core';
import type { EngineType, EntityTechBase, HeatSinkType, TechAdvancement } from '../types';
import { MEK_SLOTS_PER_LOCATION } from '../types';
import { type GyroType, getGyro, normalizeGyroType } from './gyro';
import {
  ENGINE_DATA,
  type EngineTypeDescriptor,
  type EnginePowerSource,
  type EngineMovementHeat,
  getEngineTechAdvancement,
} from './engine-data';

// Re-export engine-data symbols for barrel convenience
export { ENGINE_DATA, type EngineTypeDescriptor, type EnginePowerSource, type EngineMovementHeat } from './engine-data';
export { getEngineTechAdvancement } from './engine-data';
export {
  ENGINE_TYPE_FROM_CODE, ENGINE_TYPE_TO_CODE,
  engineTypeFromCode, engineTypeToCode,
} from './engine-data';

// ============================================================================
// MountedEngine init & class
// ============================================================================

/**
 * Initialiser object for `new MountedEngine(...)`.
 * Only `type`, `rating`, and `techBase` are required; heat-sink
 * fields default to Single / 10 / -1 when omitted.
 */
export interface MountedEngineInit {
  readonly type: EngineType;
  readonly rating: number;
  readonly techBase: EntityTechBase;
  readonly isSuperHeavy?: boolean;
  readonly heatSinkType?: HeatSinkType;
  readonly totalHeatSinks?: number;
  readonly rawHeatSinkLabel?: string;
  readonly baseChassisHeatSinks?: number;
}

/**
 * MountedEngine contains all engine-related data for an entity:
 * - The engine definition (type, rating, tech base, large/superheavy)
 * - A reference to the engine-type descriptor from `ENGINE_DATA`
 * - The heat-sink configuration (type, total count, integral vs. external)
 */
export class MountedEngine {
  // -- Core identity --
  type: WritableSignal<EngineType>;
  readonly rating: number;
  readonly techBase: EntityTechBase;
  readonly isSuperHeavy: boolean;

  // -- Heat-sink configuration --
  /** Type of heat sinks installed (Single, Double, Compact, Laser). */
  heatSinkType: WritableSignal<HeatSinkType>;
  /**
   * Total heat sink count as declared in the file (MTF `heat sinks:` line).
   * Includes BOTH engine-integrated and externally mounted heat sinks.
   */
  installedHeatSinksCount: WritableSignal<number>;
  /**
   * Raw heat-sink type label from the file for round-trip fidelity.
   * e.g. "Single", "IS Double", "Clan Double", "Compact", "Laser"
   */
  readonly rawHeatSinkLabel: string;
  /**
   * Base chassis heat sinks (from BLK/MTF `base chassis heat sinks:` line).
   * -1 means not specified.
   */
  readonly baseChassisHeatSinks: number;

  constructor(init: MountedEngineInit) {
    this.type = signal<EngineType>(init.type);
    this.rating = init.rating;
    this.techBase = init.techBase;
    this.isSuperHeavy = init.isSuperHeavy ?? false;

    this.heatSinkType = signal<HeatSinkType>(init.heatSinkType ?? 'Single');
    this.installedHeatSinksCount = signal<number>(init.totalHeatSinks ?? 0);
    this.rawHeatSinkLabel = init.rawHeatSinkLabel ?? this.heatSinkType();
    this.baseChassisHeatSinks = init.baseChassisHeatSinks ?? -1;
  }

  descriptor = computed<EngineTypeDescriptor>(() => ENGINE_DATA[this.type()]);

  // ========================================================================
  //  Heat sinks
  // ========================================================================

  /** Number of weight-free heat sinks the engine provides. */
  get weightFreeHeatSinks(): number { return this.descriptor().weightFreeHeatSinks; }

  /** Base movement heat for BattleMeks with this engine type. */
  get movementHeat(): EngineMovementHeat { return this.descriptor().movementHeat; }

  /**
   * Maximum number of heat sinks that can be integrated into the engine
   * (i.e. don't require critical slots).
   * Matches MegaMek Engine.integralHeatSinkCapacity().
   */
  integralHeatSinkCapacity = computed<number>(() => {
    if (this.heatSinkType() === 'Compact') {
      return Math.floor(this.rating / 25) * 2;
    }
    return Math.floor(this.rating / 25);
  });

  // ========================================================================
  //  Weight
  // ========================================================================

  /** Base engine weight from the weight table for this rating. */
  get baseWeight(): number { return getEngineBaseWeight(this.rating); }

  /** Whether this is a large engine (rating > 400). */
  get isLarge() { return this.rating > 400; }

  // ========================================================================
  //  Cost
  // ========================================================================

  /** Base cost per engine rating point (large engines double this). */
  get baseCost(): number { return this.descriptor().baseCost; }

  // ========================================================================
  //  Classification (delegated to descriptor)
  // ========================================================================

  /** Mutually exclusive power source of this engine type. */
  get powerSource(): EnginePowerSource { return this.descriptor().powerSource; }

  /** True if this engine type is a fusion engine (produces free heat sinks). */
  get isFusion(): boolean { return this.descriptor().powerSource === 'fusion'; }

  /** True if this engine type is a fission engine. */
  get isFission(): boolean { return this.descriptor().powerSource === 'fission'; }

  /** True if this engine type is an internal-combustion engine. */
  get isICE(): boolean { return this.descriptor().powerSource === 'combustion'; }

  /** True when the engine type is not `None`. */
  get hasEngine(): boolean { return this.descriptor().powerSource !== 'none'; }

  // ========================================================================
  //  Weight
  // ========================================================================

  /**
   * Compute the actual engine weight in tons, applying type multiplier,
   * minimum weight, large-engine doubling, and optional tank multiplier.
   * Rounds up to the nearest half-ton.
   *
   * Mirrors MegaMek `Engine.getEngineWeight()` / `getEngineTankWeight()`.
   */
  getWeight(flags?: { tank?: boolean }): number {
    const desc = this.descriptor();
    let weight = this.baseWeight * desc.weightMultiplier;
    weight = Math.max(weight, desc.minWeight);
    if (this.isLarge) weight *= 2;
    weight = Math.ceil(weight * 2) / 2; // round up to nearest half-ton
    if (flags?.tank) {
      weight *= desc.tankWeightMultiplier;
      weight = Math.ceil(weight * 2) / 2;
    }
    return weight;
  }

  // ========================================================================
  //  Tech advancement
  // ========================================================================

  /**
   * Resolve the correct `TechAdvancement` for this engine, selecting among
   * standard / clan / large / support variants.
   *
   * Defaults are derived from instance state (`techBase`, `isLarge`);
   * pass explicit flags to override.
   */
  getTechAdvancement(flags?: {
    clan?: boolean;
    large?: boolean;
    supportVee?: boolean;
  }): TechAdvancement {
    return getEngineTechAdvancement(this.type(), {
      clan: flags?.clan ?? (this.techBase === 'Clan'),
      large: flags?.large ?? this.isLarge,
      supportVee: flags?.supportVee,
    });
  }

  // ========================================================================
  //  Critical slot layout
  // ========================================================================

  /**
   * Get the engine CT critical slot indices, given gyro type.
   * Matches MegaMek Engine.getCenterTorsoCriticalSlots().
   *
   * Returns an array of 0-based slot indices in the CT that the engine occupies.
   */
  getCTSlots(gyroType: GyroType | string): number[] {
    return getEngineCTSlots(this, gyroType);
  }

  /**
   * Get the engine side-torso critical slot indices.
   * Returns an array of 0-based slot indices in each side torso.
   */
  getSideTorsoSlots(): number[] {
    return getEngineSideTorsoSlots(this);
  }
}

// ============================================================================
// Mek-specific critical slot helpers (free functions)
// ============================================================================

/**
 * Compute the CT critical slot indices occupied by the engine.
 * Mirrors MegaMek `Engine.getCenterTorsoCriticalSlots()`.
 */
function getEngineCTSlots(engine: MountedEngine, gyroType: GyroType | string): number[] {
  const normalizedGyro = normalizeGyroType(gyroType as string);

  if (engine.type() === 'Compact') {
    return engine.isSuperHeavy ? [0, 1] : [0, 1, 2];
  }

  if (engine.isLarge) {
    if (engine.isSuperHeavy) {
      if (normalizedGyro === 'None') return [0, 1, 2, 3];
      return [0, 1, 2, 5];
    }
    if (normalizedGyro === 'None') return [0, 1, 2, 3, 4, 5, 6, 7];
    if (normalizedGyro === 'Compact') return [0, 1, 2, 5, 6, 7, 8, 9];
    return [0, 1, 2, 7, 8, 9, 10, 11];
  }

  // Normal-sized engine
  if (normalizedGyro === 'None') {
    return engine.isSuperHeavy ? [0, 1, 2] : [0, 1, 2, 3, 4, 5];
  }
  if (normalizedGyro === 'Compact') {
    return engine.isSuperHeavy ? [0, 1, 2] : [0, 1, 2, 5, 6, 7];
  }
  if (normalizedGyro === 'XL') {
    return engine.isSuperHeavy ? [0, 1, 2] : [0, 1, 2, 9, 10, 11];
  }
  // Standard / Heavy Duty / Superheavy gyro
  return engine.isSuperHeavy ? [0, 1, 2] : [0, 1, 2, 7, 8, 9];
}

/**
 * Compute the side-torso critical slot indices occupied by the engine.
 * Mirrors MegaMek `Engine.getSideTorsoCriticalSlots()`.
 */
function getEngineSideTorsoSlots(engine: MountedEngine): number[] {
  const desc = engine.descriptor();
  if (!desc.sideTorsoSlots) return [];

  const count = engine.isSuperHeavy
    ? (engine.techBase === 'Clan' ? desc.sideTorsoSlots.clanSH : desc.sideTorsoSlots.isSH)
    : engine.techBase === 'Clan'
      ? desc.sideTorsoSlots.clan
      : desc.sideTorsoSlots.is;

  return Array.from({ length: count }, (_, i) => i);
}

// ============================================================================
// Engine weight table
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
  engine: MountedEngine,
  gyroType: GyroType | string,
): (string | null)[] {
  const layout: (string | null)[] = new Array(MEK_SLOTS_PER_LOCATION).fill(null);
  const engineSlots = engine.getCTSlots(gyroType);
  const gyro = getGyro(gyroType);

  // Place engine slots
  for (const idx of engineSlots) {
    if (idx < MEK_SLOTS_PER_LOCATION) layout[idx] = 'Engine';
  }

  // Place gyro slots immediately after the first contiguous engine block
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
  engine: MountedEngine,
): (string | null)[] {
  const layout: (string | null)[] = new Array(MEK_SLOTS_PER_LOCATION).fill(null);
  const slots = engine.getSideTorsoSlots();
  for (const idx of slots) {
    if (idx < MEK_SLOTS_PER_LOCATION) layout[idx] = 'Engine';
  }
  return layout;
}
