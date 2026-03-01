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

/**
 * Engine type descriptor data — single source of truth.
 *
 * All static, per-engine-type data lives in `ENGINE_DATA`, a
 * `Record<EngineType, EngineTypeDescriptor>`.  Engine-type-dependent logic
 * elsewhere should derive from this map instead of ad-hoc if/else chains.
 *
 * Data sourced from MegaMek Engine.java and BattleTech TM / TO rules.
 */

/** Tech base as stored in entity files */
export type EntityTechBase = 'IS' | 'Clan';
export type EquipmentTechBase = EntityTechBase | 'All';

/** Tech rating:  A (primitive) → F (cutting-edge). */
export type TechRating = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

/** Availability code per era.  X = not available. */
export type AvailabilityCode = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'X';

/**
 * Construction-rules tech level.
 * Matches MegaMek `SimpleTechLevel`.
 */
export type ComponentTechLevel =
  | 'Introductory'
  | 'Standard'
  | 'Advanced'
  | 'Experimental'
  | 'Unofficial';
  
// ============================================================================
// Date sentinels  (matching MegaMek ITechnology)
// ============================================================================

/** Date not applicable / never. */
export const DATE_NONE = undefined;
/** Pre-Spaceflight era. */
export const DATE_PS = 1950;
/** Early Spaceflight era. */
export const DATE_ES = 2100;

// ============================================================================
// Tech date value type
// ============================================================================

/** A tech date that is explicitly approximate (~year). */
export interface ApproxDate {
  readonly year: number;
  readonly approximate: true;
}

/**
 * A technology date value.
 * - `number`: exact year
 * - `ApproxDate`: approximate year (displayed as ~year, range checks use year - APPROXIMATE_MARGIN)
 * - `undefined`: not applicable / never
 */
export type TechDate = number | ApproxDate | undefined;

/**
 * Margin in years applied to approximate dates during range checks.
 * Matches MegaMek `TechAdvancement.APPROXIMATE_MARGIN`.
 */
export const APPROXIMATE_MARGIN = 5;

/** Mark a tech year as approximate. */
export function approx(year: number): ApproxDate {
  return { year, approximate: true };
}

/** Extract the numeric year from a `TechDate` (returns `undefined` for DATE_NONE). */
export function techDateYear(date: TechDate): number | undefined {
  if (date == null) return undefined;
  return typeof date === 'number' ? date : date.year;
}

/** Whether a `TechDate` is approximate. */
export function isTechDateApprox(date: TechDate): boolean {
  return date != null && typeof date !== 'number';
}

/**
 * Year value adjusted for range checks: subtracts `APPROXIMATE_MARGIN`
 * for approximate dates (or adds it for extinction dates via `extinct` flag).
 */
export function effectiveTechDateYear(
  date: TechDate,
  extinct = false,
): number | undefined {
  if (date == null) return undefined;
  if (typeof date === 'number') return date;
  return extinct
    ? date.year + APPROXIMATE_MARGIN
    : date.year - APPROXIMATE_MARGIN;
}

/**
 * Format a `TechDate` for display: prepends '~' for approximate dates.
 * Returns `undefined` for DATE_NONE.
 */
export function formatTechDate(date: TechDate): string | undefined {
  if (date == null) return undefined;
  if (typeof date === 'number') return String(date);
  return `~${date.year}`;
}

/**
 * Parse a wire-format date string into a `TechDate`.
 * - `"2439"` => `2439` (exact)
 * - `"~2430"` => `{ year: 2430, approximate: true }` (approximate)
 * - `undefined` / empty => `undefined` (DATE_NONE)
 */
export function parseTechDate(value: string | undefined): TechDate {
  if (!value) return undefined;
  if (value.startsWith('~')) return approx(parseInt(value.slice(1), 10));
  return parseInt(value, 10);
}

// ============================================================================
// Tech advancement types
// ============================================================================

/**
 * Technology advancement dates for one tech variant.
 * Each date is a `TechDate`: a plain year, `approx(year)`, or `undefined`.
 */
export interface TechDates {
  readonly prototype?: TechDate;
  readonly production?: TechDate;
  readonly common?: TechDate;
  readonly extinct?: TechDate;
  readonly reintroduced?: TechDate;
}

/**
 * Per-tech-base dates for components that have different IS and Clan
 * availability timelines (e.g. Small Cockpit: IS from 3061, Clan from 3081).
 *
 * Matches MegaMek's `TechAdvancement` which stores `isAdvancement` and
 * `clanAdvancement` separately.
 */
export interface SplitTechDates {
  readonly is?: TechDates;
  readonly clan?: TechDates;
}

/** Type guard: is the dates value a per-tech-base split? */
export function isSplitTechDates(dates: TechDates | SplitTechDates): dates is SplitTechDates {
  return 'is' in dates;
}

/**
 * Resolve `TechDates` for a specific tech base.
 *
 * If the dates are per-tech-base (`SplitTechDates`), returns the dates
 * for the requested tech base.  Otherwise returns the unified `TechDates`.
 */
export function resolveTechDates(
  dates: TechDates | SplitTechDates,
  techBase: EquipmentTechBase = 'IS',
): TechDates | undefined {
  if (isSplitTechDates(dates)) {
    return techBase === 'Clan' ? dates['clan'] : dates['is'];
  }
  return dates;
}

/**
 * Check whether a technology is available (at least prototype level)
 * for a given tech base at a given year.
 *
 * Returns `true` if the resolved prototype or production date for
 * `techBase` is defined and ≤ `year`.
 */
export function isTechAvailableForBase(
  dates: TechDates | SplitTechDates,
  techBase: EquipmentTechBase,
  year: number,
): boolean {
  const resolved = resolveTechDates(dates, techBase);
  if (!resolved) {
    throw new Error(`Invalid tech dates: ${JSON.stringify(dates)}`);
  }

  // Must have at least prototype, production, or common date ≤ year to be available
  const protoYear = effectiveTechDateYear(resolved.prototype);
  const prodYear = effectiveTechDateYear(resolved.production);
  const commonYear = effectiveTechDateYear(resolved.common);
  const introduced = (protoYear != null && year >= protoYear)
                  || (prodYear != null && year >= prodYear)
                  || (commonYear != null && year >= commonYear);
  if (!introduced) return false;

  // Check extinction: if extinct date exists and year >= extinct, tech is gone
  // (approximate extinction dates are shifted forward by APPROXIMATE_MARGIN)
  const extinctYear = effectiveTechDateYear(resolved.extinct, true);
  if (extinctYear != null && year >= extinctYear) {
    // Unless reintroduced after the extinction
    const reintroYear = effectiveTechDateYear(resolved.reintroduced);
    if (reintroYear != null && reintroYear > extinctYear && year >= reintroYear) {
      return true;
    }
    return false;
  }

  return true;
}

/** Faction codes for tech-advancement milestones. */
export interface TechFactions {
  readonly prototype?: readonly string[];
  readonly production?: readonly string[];
  readonly reintroduction?: readonly string[];
}

/**
 * Complete tech advancement for one component variant.
 *
 * Availability eras (tuple indices): [Star League, Succession Wars, Clan Invasion, Dark Age].
 *
 * The `dates` field can be either:
 * - `TechDates` — single set of dates (used when IS & Clan share the same timeline,
 *   or when `techBase` is IS-only / Clan-only)
 * - `SplitTechDates` — per-tech-base dates (used when IS & Clan have different
 *   availability timelines, e.g. Small Cockpit)
 */
export interface TechAdvancement {
  readonly techBase: EquipmentTechBase;
  readonly rating: TechRating;
  readonly availability: readonly [AvailabilityCode, AvailabilityCode, AvailabilityCode, AvailabilityCode];
  readonly level: ComponentTechLevel;
  readonly dates: TechDates | SplitTechDates;
  readonly factions?: TechFactions;
}