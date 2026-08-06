// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { MotiveType } from './motive';

// ============================================================================
// Beast Mount Types (see TO:AU&E p.106)
// ============================================================================

/** Beast size categories per TO:AU&E p.106 */
export type BeastSize = 'Large' | 'Very Large' | 'Monstrous';

/**
 * Data for a beast mount used by beast-mounted infantry.
 * Predefined mounts are loaded from infantry-mounts.json.
 * Custom mounts are parsed from BLK `Beast:Custom:...` strings.
 */
export interface InfantryMount {
  /** Name of the beast (e.g. "Tariq", "Horse", "Hipposaur") */
  name: string;
  /** Size category */
  size: BeastSize;
  /** Weight of each beast in tons */
  weight: number;
  /** Movement points using primary movement mode */
  movementPoints: number;
  /** Primary movement mode of the beast */
  movementMode: MotiveType;
  /** Number of damage dice for burst damage vs conventional infantry */
  burstDamage: number;
  /** Additional damage vs non-infantry units */
  vehicleDamage: number;
  /** Divisor applied to incoming damage */
  damageDivisor: number;
  /** Maximum water depth the beast can enter (-1 = unlimited) */
  maxWaterDepth: number;
  /** Secondary ground MP for beasts with non-ground primary mode */
  secondaryGroundMP: number;
  /** Turns the beast can stay underwater before surfacing */
  uwEndurance: number;
  /** Whether this is a custom (user-defined) mount */
  custom?: boolean;
}

// ============================================================================
// Infantry Specializations
// ============================================================================

export type InfantrySpecialization =
  | 'bridge-engineers' | 'demo-engineers' | 'fire-engineers' | 'mine-engineers'
  | 'sensor-engineers' | 'trench-engineers' | 'marines' | 'mountain-troops'
  | 'paramedics' | 'paratroops' | 'tag-troops' | 'xct' | 'scuba';

export const INFANTRY_SPECIALIZATION_FROM_BIT: Record<number, InfantrySpecialization> = {
  0: 'bridge-engineers', 1: 'demo-engineers', 2: 'fire-engineers',
  3: 'mine-engineers', 4: 'sensor-engineers', 5: 'trench-engineers',
  6: 'marines', 7: 'mountain-troops', 8: 'paramedics',
  9: 'paratroops', 10: 'tag-troops', 11: 'xct', 12: 'scuba',
};

export const INFANTRY_SPECIALIZATION_TO_BIT: Record<InfantrySpecialization, number> = {
  'bridge-engineers': 0, 'demo-engineers': 1, 'fire-engineers': 2,
  'mine-engineers': 3, 'sensor-engineers': 4, 'trench-engineers': 5,
  'marines': 6, 'mountain-troops': 7, 'paramedics': 8,
  'paratroops': 9, 'tag-troops': 10, 'xct': 11, 'scuba': 12,
};
