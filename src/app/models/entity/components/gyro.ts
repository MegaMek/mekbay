/*
 * Copyright (C) 2025-2026 The MegaMek Team. All Rights Reserved.
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
  GYRO_TYPE_FROM_CODE,
  gyroTypeFromCode,
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

/**
 * Normalize raw gyro type strings from MTF files.
 * MegaMek writes "XL Gyro", "Compact Gyro", etc. — we strip the " Gyro" suffix.
 */
export function normalizeGyroType(raw: string): GyroType {
  if (raw in GYRO_DATA) return raw as GyroType;
  const stripped = raw.replace(/\s+Gyro$/i, '').trim();
  if (stripped in GYRO_DATA) return stripped as GyroType;
  return 'Standard';
}

/** Resolve a GyroComponent by type name. Falls back to Standard. */
export function getGyro(type: string): GyroComponent {
  const desc = GYRO_DATA[normalizeGyroType(type)];
  return { type: desc.shortName as GyroType, criticalSlots: desc.criticalSlots };
}
