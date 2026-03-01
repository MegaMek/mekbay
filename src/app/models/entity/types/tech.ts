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

import { EquipmentTechBase } from "./entity";

/**
 * Engine type descriptor data — single source of truth.
 *
 * All static, per-engine-type data lives in `ENGINE_DATA`, a
 * `Record<EngineType, EngineTypeDescriptor>`.  Engine-type-dependent logic
 * elsewhere should derive from this map instead of ad-hoc if/else chains.
 *
 * Data sourced from MegaMek Engine.java and BattleTech TM / TO rules.
 */

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
 * - `number` — exact year
 * - `ApproxDate` — approximate year (displayed as ~year, range checks use year − APPROXIMATE_MARGIN)
 * - `undefined` — not applicable / never
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

// ============================================================================
// Tech advancement types
// ============================================================================

/**
 * Technology advancement dates for one engine variant.
 * Each date is a `TechDate`: a plain year, `approx(year)`, or `undefined`.
 */
export interface TechDates {
  readonly prototype: TechDate;
  readonly production: TechDate;
  readonly common: TechDate;
  readonly extinct?: TechDate;
  readonly reintroduced?: TechDate;
}

/** Faction codes for tech-advancement milestones. */
export interface TechFactions {
  readonly prototype?: readonly string[];
  readonly production?: readonly string[];
  readonly reintroduction?: readonly string[];
}

/**
 * Complete tech advancement for one engine variant.
 *
 * Availability eras (tuple indices): [Star League, Succession Wars, Clan Invasion, Dark Age].
 */
export interface TechAdvancement {
  readonly techBase: EquipmentTechBase;
  readonly rating: TechRating;
  readonly availability: readonly [AvailabilityCode, AvailabilityCode, AvailabilityCode, AvailabilityCode];
  readonly level: ComponentTechLevel;
  readonly dates: TechDates;
  readonly factions?: TechFactions;
}