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
 * Gyro system component.
 *
 * Gyros are fundamental structural elements of every Mek, with statically
 * known properties (crit slots, weight, etc.) initialised at runtime.
 * They are NOT equipment from equipment2.json.
 */

// ============================================================================
// Types
// ============================================================================

export type GyroType =
  | 'None' | 'Standard' | 'XL' | 'Compact' | 'Heavy Duty' | 'Superheavy';

// ============================================================================
// Gyro Component
// ============================================================================

export interface GyroComponent {
  readonly type: GyroType;
  /** Number of critical slots the gyro occupies in the Center Torso */
  readonly criticalSlots: number;
}

const GYRO_DEFINITIONS: Record<GyroType, GyroComponent> = {
  'None':       { type: 'None',       criticalSlots: 0 },
  'Standard':   { type: 'Standard',   criticalSlots: 4 },
  'XL':         { type: 'XL',         criticalSlots: 6 },
  'Compact':    { type: 'Compact',    criticalSlots: 2 },
  'Heavy Duty': { type: 'Heavy Duty', criticalSlots: 4 },
  'Superheavy': { type: 'Superheavy', criticalSlots: 4 },
};

// ============================================================================
// Lookup
// ============================================================================

/**
 * Normalize raw gyro type strings from MTF files.
 * MegaMek writes "XL Gyro", "Compact Gyro", etc. we strip the " Gyro" suffix.
 */
export function normalizeGyroType(raw: string): GyroType {
  let s = raw.replace(/\s+Gyro$/i, '').trim();
  if (s in GYRO_DEFINITIONS) return s as GyroType;
  return 'Standard';
}

/** Resolve a GyroComponent by type name. Falls back to Standard. */
export function getGyro(type: string): GyroComponent {
  return GYRO_DEFINITIONS[normalizeGyroType(type)];
}

/** Get all known gyro types. */
export function getAllGyroTypes(): readonly GyroType[] {
  return Object.keys(GYRO_DEFINITIONS) as GyroType[];
}
