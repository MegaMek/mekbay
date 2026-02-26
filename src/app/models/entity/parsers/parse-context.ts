/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import { Equipment, EquipmentAliasMap, EquipmentMap } from '../../equipment.model';
import { EntityTechBase } from '../types';
import { resolveEquipment } from './equipment-resolver';

// Re-export validation sets so parsers can import from parse-context OR types
export {
  VALID_VEHICLE_MOTION_TYPES,
  VALID_INFANTRY_MOTION_TYPES,
  VALID_BA_MOTION_TYPES,
  VALID_AERO_MOTION_TYPES,
  VALID_SPACECRAFT_MOTION_TYPES,
  VALID_FUEL_TYPES,
  VALID_SYSTEM_MANUFACTURER_KEYS,
  VALID_TECH_BASE_STRINGS,
  VALID_BA_WEIGHT_CLASSES,
  VALID_DESIGN_TYPE_CODES,
  normalizeSystemManufacturerKey,
} from '../types';

// ============================================================================
// Diagnostic types
// ============================================================================

export type ParseSeverity = 'error' | 'warning';

export interface ParseDiagnostic {
  severity: ParseSeverity;
  /** Which field/block produced the problem, e.g. 'engine_type', 'Front Equipment' */
  field: string;
  /** Human-readable description */
  message: string;
}

// ============================================================================
// Equipment fallback hook
// ============================================================================

/**
 * A callback invoked when equipment cannot be found in the local DB.
 *
 * This is the extension point for future remote equipment retrieval
 * (e.g. fetching custom equipment from a remote server by UUID).
 *
 * Return the Equipment object on success, or `null` if the equipment
 * truly does not exist (which will be recorded as an error).
 */
export type EquipmentFallbackFn = (
  internalName: string,
) => Equipment | null;

// ============================================================================
// ParseContext
// ============================================================================

/**
 * Accumulates parse diagnostics (errors and warnings) during entity parsing.
 *
 * Passed through from `parseEntity()` to every sub-parser so that problems
 * are gathered rather than swallowed or thrown.
 *
 * After parsing completes the caller can inspect `errors` and `warnings` to
 * decide how to present problems to the user (e.g. toast notifications,
 * editor squiggles, import report).
 */
export class ParseContext {
  /** File being parsed (for diagnostic display) */
  readonly fileName: string;

  /** Equipment database for name resolution */
  readonly equipmentDb: EquipmentMap;

  /** Pre-built alias → Equipment index for O(1) alias lookups */
  readonly aliasMap: EquipmentAliasMap | undefined;

  /** Optional fallback for custom/remote equipment lookup */
  readonly equipmentFallback: EquipmentFallbackFn | null;

  /** Accumulated diagnostics */
  readonly diagnostics: ParseDiagnostic[] = [];

  constructor(
    fileName: string,
    equipmentDb: EquipmentMap,
    equipmentFallback?: EquipmentFallbackFn | null,
    aliasMap?: EquipmentAliasMap,
  ) {
    this.fileName = fileName;
    this.equipmentDb = equipmentDb;
    this.aliasMap = aliasMap;
    this.equipmentFallback = equipmentFallback ?? null;
  }

  // ── Diagnostic helpers ──

  error(field: string, message: string): void {
    this.diagnostics.push({ severity: 'error', field, message });
  }

  warn(field: string, message: string): void {
    this.diagnostics.push({ severity: 'warning', field, message });
  }

  get errors(): ParseDiagnostic[] {
    return this.diagnostics.filter(d => d.severity === 'error');
  }

  get warnings(): ParseDiagnostic[] {
    return this.diagnostics.filter(d => d.severity === 'warning');
  }

  get hasErrors(): boolean {
    return this.diagnostics.some(d => d.severity === 'error');
  }

  get hasWarnings(): boolean {
    return this.diagnostics.some(d => d.severity === 'warning');
  }

  // ── Validation helpers ──

  /**
   * Validate that a value is within an allowed set.
   * If invalid, records a warning (not error) since the file can still be loaded.
   * @returns true if valid
   */
  validateEnum<T>(field: string, value: T, validSet: Set<T>, label: string): boolean {
    if (!validSet.has(value)) {
      this.warn(field, `Unknown ${label}: "${value}"`);
      return false;
    }
    return true;
  }

  /**
   * Validate a numeric code maps to a known value in a code table.
   * @returns true if valid
   */
  validateCode(field: string, code: number, codeTable: Record<number, string>): boolean {
    if (!(code in codeTable)) {
      this.warn(field, `Unknown code ${code} for ${field} (expected one of: ${Object.keys(codeTable).join(', ')})`);
      return false;
    }
    return true;
  }

  /**
   * Validate that a value is a finite number.
   * @returns true if valid
   */
  validateNumber(field: string, value: unknown): boolean {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.warn(field, `Expected a number for ${field}, got: "${value}"`);
      return false;
    }
    return true;
  }

  /**
   * Validate that a value is a non-negative integer.
   * @returns true if valid
   */
  validateNonNegativeInt(field: string, value: number): boolean {
    if (!Number.isInteger(value) || value < 0) {
      this.warn(field, `Expected a non-negative integer for ${field}, got: ${value}`);
      return false;
    }
    return true;
  }

  // ── Equipment resolution with validation ──

  /**
   * Resolve equipment by name, falling back to the optional hook, and recording
   * an error if the equipment cannot be found at all.
   *
   * @param name       Internal name from the file
   * @param techBase   Entity's tech base for prefix resolution
   * @param field      Diagnostic field label (e.g. "Front Equipment")
   * @returns Resolved Equipment, or `null` if not found (error recorded)
   */
  resolveEquipment(
    name: string,
    field: string,
  ): Equipment | null {
    if (!name || name === '-Empty-') return null;

    // 1. Try local DB (uses alias index when available)
    const local = resolveEquipment(name, this.equipmentDb, this.aliasMap);
    if (local) return local;

    // 2. Try fallback (future: remote/UUID lookup)
    if (this.equipmentFallback) {
      const fallback = this.equipmentFallback(name);
      if (fallback) return fallback;
    }

    // 3. Not found — record error
    this.error(field, `Equipment not found: "${name}"`);
    return null;
  }
}
