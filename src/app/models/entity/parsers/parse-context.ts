// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { EquipmentRegistry } from '../../equipment-lookup';
import { Equipment } from '../../equipment.model';
import { Sourcebook, SourcebookReference } from '../../sourcebook.model';
import type { Quirk } from '../../quirks.model';
import { EntityQuirk, EntityTechBase } from '../types';

// Re-export validation sets so parsers can import from parse-context OR types
export {
  VALID_VEHICLE_MOTIVE_TYPES,
  VALID_INFANTRY_MOTIVE_TYPES,
  VALID_BA_MOTIVE_TYPES,
  VALID_AERO_MOTIVE_TYPES,
  VALID_SPACECRAFT_MOTIVE_TYPES,
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

export interface EntityLoadIssue {
  readonly code: string;
  readonly severity: ParseSeverity;
  /** Which field/block produced the problem, e.g. 'engine_type', 'Front Equipment' */
  readonly field: string;
  /** Human-readable description */
  readonly message: string;
}

export function isEntityLoadIssueArray(value: unknown): value is readonly EntityLoadIssue[] {
  return Array.isArray(value) && value.every(issue => issue !== null
    && typeof issue === 'object'
    && typeof issue.code === 'string' && issue.code.length > 0
    && (issue.severity === 'error' || issue.severity === 'warning')
    && typeof issue.field === 'string'
    && typeof issue.message === 'string' && issue.message.length > 0);
}

export type SourcebookResolverFn = (abbrev: string) => Sourcebook | undefined;
export type QuirkResolverFn = (key: string) => Quirk | undefined;

export interface ParseContextOptions {
  sourcebookResolver?: SourcebookResolverFn | null;
  quirkResolver?: QuirkResolverFn | null;
}

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

  /** Canonical equipment collection and lookup index */
  readonly equipmentRegistry: EquipmentRegistry;

  readonly sourcebookResolver: SourcebookResolverFn | null;

  readonly quirkResolver: QuirkResolverFn | null;

  /** Accumulated diagnostics */
  readonly diagnostics: EntityLoadIssue[] = [];

  constructor(
    fileName: string,
    equipmentRegistry: EquipmentRegistry,
    options: ParseContextOptions = {},
  ) {
    this.fileName = fileName;
    this.equipmentRegistry = equipmentRegistry;
    this.sourcebookResolver = options.sourcebookResolver ?? null;
    this.quirkResolver = options.quirkResolver ?? null;
  }

  resolveSourcebook(abbrev: string): SourcebookReference {
    return this.sourcebookResolver?.(abbrev) ?? { abbrev, canon: false, unresolved: true };
  }

  resolveQuirk(rawKey: string, field = 'quirks'): EntityQuirk | null {
    const separator = rawKey.indexOf(':');
    const key = separator >= 0 ? rawKey.slice(0, separator) : rawKey;
    const value = separator >= 0 ? rawKey.slice(separator + 1) : undefined;
    const quirk = this.quirkResolver?.(key);
    if (!quirk) {
      this.error(field, `Unknown quirk key: "${key}"`, 'QUIRK_NOT_FOUND');
      return null;
    }
    return {
      quirk,
      ...(value === undefined ? {} : { value }),
    };
  }

  // ── Diagnostic helpers ──

  error(field: string, message: string, code = 'ENTITY_PARSE_ERROR'): void {
    this.diagnostics.push({ code, severity: 'error', field, message });
  }

  warn(field: string, message: string, code = 'ENTITY_PARSE_WARNING'): void {
    this.diagnostics.push({ code, severity: 'warning', field, message });
  }

  get errors(): EntityLoadIssue[] {
    return this.diagnostics.filter(d => d.severity === 'error');
  }

  get warnings(): EntityLoadIssue[] {
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
  validateEnum<T>(field: string, value: T, validSet: ReadonlySet<T>, label: string): boolean {
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
   * Resolve equipment by name and record an error if it is missing from the catalog.
   *
   * @param name       Internal name from the file
   * @param field      Diagnostic field label (e.g. "Front Equipment")
   * @param techBase   Entity's tech base for prefix resolution
   * @returns Resolved Equipment, or `null` if not found (error recorded)
   */
  resolveEquipment(
    name: string,
    field: string,
    techBase?: EntityTechBase,
  ): Equipment | null {
    if (!name || name === '-Empty-') return null;

    const local = techBase
      ? this.equipmentRegistry.findForTechBase(name, techBase)
      : this.equipmentRegistry.findEquipment(name);
    if (local) return local;

    this.error(field, `Equipment not found: "${name}"`, 'EQUIPMENT_NOT_FOUND');
    return null;
  }
}
