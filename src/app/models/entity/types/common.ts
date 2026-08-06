// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Quirk } from '../../quirks.model';

/** A catalog quirk assigned to an entity, with optional unit-specific data. */
export interface EntityQuirk {
  /** Shared invariant catalog record. */
  readonly quirk: Quirk;
  /** Unit-specific option value, such as the year in `obsolete:2520`. */
  readonly value?: string;
}

export interface EntityWeaponQuirk {
  name: string;
  weaponName: string;
  location: string;
  slot: number;
}

export type C3SystemType = 'None' | 'C3' | 'C3i' | 'Naval C3' | 'Nova CEWS';

// ============================================================================
// Fluff
// ============================================================================

export interface EntityFluff {
  overview?: string;
  capabilities?: string;
  deployment?: string;
  history?: string;
  manufacturer?: string;
  primaryFactory?: string;
  systemManufacturers?: Record<string, string>;
  systemModels?: Record<string, string>;
  notes?: string;
  fluffDate?: string;
  /** Spacecraft-specific fluff fields */
  use?: string;
  length?: string;
  width?: string;
  height?: string;
}

// ============================================================================
// Validation - tiered slices
//
// Validation is split into independent computed slices (engine, armor,
// equipment, type-specific) so that changing armour doesn't recompute the
// engine check, and vice-versa.  A single aggregate computed collects them.
// ============================================================================

export type ValidationCategory =
  | 'engine' | 'armor' | 'weight' | 'equipment' | 'structure'
  | 'movement' | 'heat' | 'tech' | 'crit' | 'general';

export interface EntityValidationMessage {
  severity: 'error' | 'warning' | 'info';
  category: ValidationCategory;
  code: string;
  message: string;
  location?: string;
}

export interface EntityValidationResult {
  valid: boolean;
  messages: EntityValidationMessage[];
}
