// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/**
 * Gyro system component — runtime helpers.
 *
 * Delegates all static per-type data to `gyro-data.ts`.
 * Re-exports data symbols for barrel convenience.
 */

import type { GyroType } from './gyro-data';
import {
  GYRO_DATA,
} from './gyro-data';

// Re-export gyro-data symbols for barrel convenience
export {
  GYRO_DATA,
  type GyroType,
  type GyroTypeDescriptor,
  getGyroTechAdvancement,
} from './gyro-data';

// ============================================================================
// Legacy GyroComponent interface (kept for engine.ts compatibility)
// ============================================================================

/**
 * Lightweight gyro component view used by `buildCTSystemLayout`.
 * Derived from `GyroTypeDescriptor` for backwards compatibility.
 */
export interface GyroComponent {
  readonly type: GyroType;
  /** Number of critical slots the gyro occupies in the Center Torso */
  readonly criticalSlots: number;
}

// ============================================================================
// Lookup helpers
// ============================================================================

/** All known gyro types (keys of GYRO_DATA). */
export function getAllGyroTypes(): readonly GyroType[] {
  return Object.keys(GYRO_DATA) as GyroType[];
}

/** Resolve a GyroComponent by type name. Falls back to Standard. */
export function getGyro(type: GyroType): GyroComponent {
  const desc = GYRO_DATA[type];
  return { type: desc.shortName as GyroType, criticalSlots: desc.criticalSlots };
}
