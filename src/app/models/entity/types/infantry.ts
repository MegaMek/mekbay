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
 * Predefined mounts are canonical parser data; no runtime catalog is required.
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

/** Canonical beast mount specifications shared by native decoding and construction. */
export const PREDEFINED_INFANTRY_MOUNTS: ReadonlyMap<string, InfantryMount> = new Map([
  ['Donkey',            { name: 'Donkey',            size: 'Large',      weight: 0.15, movementPoints: 2, movementMode: 'Leg',       burstDamage: 0,  vehicleDamage: 0, damageDivisor: 1.0, maxWaterDepth: 0,  secondaryGroundMP: 0, uwEndurance: 0 }],
  ['Coventry Kangaroo', { name: 'Coventry Kangaroo', size: 'Large',      weight: 0.11, movementPoints: 3, movementMode: 'Leg',       burstDamage: 1,  vehicleDamage: 1, damageDivisor: 1.0, maxWaterDepth: 0,  secondaryGroundMP: 0, uwEndurance: 0 }],
  ['Horse',             { name: 'Horse',             size: 'Large',      weight: 0.5,  movementPoints: 3, movementMode: 'Leg',       burstDamage: 0,  vehicleDamage: 0, damageDivisor: 1.0, maxWaterDepth: 0,  secondaryGroundMP: 0, uwEndurance: 0 }],
  ['Camel',             { name: 'Camel',             size: 'Large',      weight: 0.65, movementPoints: 2, movementMode: 'Leg',       burstDamage: 0,  vehicleDamage: 0, damageDivisor: 1.0, maxWaterDepth: 0,  secondaryGroundMP: 0, uwEndurance: 0 }],
  ['Branth',            { name: 'Branth',            size: 'Large',      weight: 0.72, movementPoints: 6, movementMode: 'VTOL',      burstDamage: 2,  vehicleDamage: 1, damageDivisor: 1.0, maxWaterDepth: 0,  secondaryGroundMP: 0, uwEndurance: 0 }],
  ['Odessan Raxx',      { name: 'Odessan Raxx',      size: 'Large',      weight: 2.4,  movementPoints: 2, movementMode: 'Leg',       burstDamage: 1,  vehicleDamage: 1, damageDivisor: 1.0, maxWaterDepth: 0,  secondaryGroundMP: 0, uwEndurance: 0 }],
  ['Tabiranth',         { name: 'Tabiranth',         size: 'Large',      weight: 0.25, movementPoints: 2, movementMode: 'Leg',       burstDamage: 1,  vehicleDamage: 1, damageDivisor: 1.0, maxWaterDepth: 0,  secondaryGroundMP: 0, uwEndurance: 0 }],
  ['Tariq',             { name: 'Tariq',             size: 'Large',      weight: 0.51, movementPoints: 5, movementMode: 'Leg',       burstDamage: 0,  vehicleDamage: 0, damageDivisor: 1.0, maxWaterDepth: 0,  secondaryGroundMP: 0, uwEndurance: 0 }],
  ['Elephant',          { name: 'Elephant',          size: 'Very Large', weight: 6.0,  movementPoints: 2, movementMode: 'Leg',       burstDamage: 1,  vehicleDamage: 1, damageDivisor: 2.0, maxWaterDepth: 1,  secondaryGroundMP: 0, uwEndurance: 0 }],
  ['Orca',              { name: 'Orca',              size: 'Very Large', weight: 7.2,  movementPoints: 5, movementMode: 'Submarine', burstDamage: 2,  vehicleDamage: 1, damageDivisor: 2.0, maxWaterDepth: -1, secondaryGroundMP: 0, uwEndurance: 180 }],
  ['Hipposaur',         { name: 'Hipposaur',         size: 'Monstrous',  weight: 35.5, movementPoints: 2, movementMode: 'Submarine', burstDamage: 10, vehicleDamage: 4, damageDivisor: 4.0, maxWaterDepth: -1, secondaryGroundMP: 1, uwEndurance: 2 }],
] as [string, InfantryMount][]);

