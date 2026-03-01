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

import { approx, DATE_ES, DATE_NONE, DATE_PS, type EngineType, type TechAdvancement, type TechRating } from '../types';

// ============================================================================
// Engine power-source classification
// ============================================================================

/**
 * Power source of an engine type.
 */
export type EnginePowerSource =
  | 'fusion'       // Fusion, XL, XXL, Light, Compact
  | 'fission'      // Fission
  | 'combustion'   // ICE
  | 'fuel-cell'    // Fuel Cell
  | 'steam'        // Steam
  | 'battery'      // Battery
  | 'solar'        // Solar
  | 'maglev'       // Maglev
  | 'external'     // External
  | 'none';        // None

// ============================================================================
// Movement heat profile
// ============================================================================

/** Base movement heat values for a BattleMek with this engine type. */
export interface EngineMovementHeat {
  /** Heat generated while stationary (0 for most, 2 for XXL). */
  readonly standing: number;
  /** Heat generated while walking. */
  readonly walk: number;
  /** Heat generated while running. */
  readonly run: number;
  /** Heat generated while sprinting. */
  readonly sprint: number;
  /** Minimum jump heat threshold. */
  readonly jumpMin: number;
  /** Heat per jump MP spent. */
  readonly jumpPerMP: number;
}

// ============================================================================
// Side-torso critical slot layout
// ============================================================================

/** Engine crit counts in each side torso, varying by tech base and weight class. */
export interface SideTorsoSlotConfig {
  /** Inner Sphere, normal chassis. */
  readonly is: number;
  /** Clan, normal chassis. */
  readonly clan: number;
  /** Inner Sphere, superheavy chassis. */
  readonly isSH: number;
  /** Clan, superheavy chassis. */
  readonly clanSH: number;
}

// ============================================================================
// Support-vehicle weight multipliers
// ============================================================================

/**
 * SV engine weight multipliers, indexed by tech rating.
 * From TM p. 127, TO:AU&E p. 62.
 * A value of 0 means unavailable at that tech rating.
 */
export type SVWeightMultipliers = Readonly<Record<TechRating, number>>;

// ============================================================================
// Engine type descriptor
// ============================================================================

/**
 * Complete static data for one engine type.
 *
 * All properties that vary by `EngineType` are co-located here.
 * Runtime engine instances (`MountedEngine`) auto-resolve this via
 * `ENGINE_DATA[engine.type]`.
 */
export interface EngineTypeDescriptor {
  // ── Identity ──

  /** Numeric type code matching MegaMek `Engine.ENGINE_*` constants. */
  readonly code: number;

  // ── Classification ──

  /** Mutually exclusive power source category. */
  readonly powerSource: EnginePowerSource;

  // ── Heat ──

  /** Number of weight-free heat sinks the engine provides. */
  readonly weightFreeHeatSinks: number;
  /** Base movement heat for BattleMeks (entity context may further modify). */
  readonly movementHeat: EngineMovementHeat;

  // ── Weight ──

  /** Multiplier applied to the base engine weight from the weight table. */
  readonly weightMultiplier: number;
  /** Minimum engine weight in tons (e.g. 5 for Fission). */
  readonly minWeight: number;
  /** Extra multiplier for tank/vehicle engines (1.5 for fusion & fission, 1.0 otherwise). */
  readonly tankWeightMultiplier: number;
  /** Support-vehicle weight multipliers per tech rating. */
  readonly svWeightMultipliers: SVWeightMultipliers;

  // ── Cost ──

  /** Base cost in C-bills per rating point (large engines double this). */
  readonly baseCost: number;
  /** Support-vehicle cost multiplier (tonnage × 5,000 × this). */
  readonly svCostMultiplier: number;

  // ── Critical slots ──

  /** Engine crit count in each side torso. */
  readonly sideTorsoSlots: SideTorsoSlotConfig;

  // ── Tech advancement ──

  /** Primary tech advancement (IS tech for IS-only types, ALL for universal). */
  readonly tech: TechAdvancement;
  /** Clan tech advancement (only for types with separate IS / Clan variants). */
  readonly clanTech?: TechAdvancement;
  /** Large-engine variant tech (rating > 400). */
  readonly largeTech?: TechAdvancement;
  /** Large Clan variant tech. */
  readonly largeClanTech?: TechAdvancement;
  /** Support-vehicle variant tech (overrides `tech` when the SV flag is set). */
  readonly supportTech?: TechAdvancement;
}

// ============================================================================
// Shared constants (reused across descriptors to reduce duplication)
// ============================================================================

const STANDARD_HEAT: EngineMovementHeat = {
  standing: 0, walk: 1, run: 2, sprint: 3, jumpMin: 3, jumpPerMP: 1,
};
const XXL_HEAT: EngineMovementHeat = {
  standing: 2, walk: 4, run: 6, sprint: 9, jumpMin: 6, jumpPerMP: 2,
};
const ZERO_HEAT: EngineMovementHeat = {
  standing: 0, walk: 0, run: 0, sprint: 0, jumpMin: 0, jumpPerMP: 0,
};

const NO_SIDE_TORSO: SideTorsoSlotConfig = { is: 0, clan: 0, isSH: 0, clanSH: 0 };

const SV_ZERO: SVWeightMultipliers = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };

// ============================================================================
// ENGINE_DATA  —  Record<EngineType, EngineTypeDescriptor>
// ============================================================================

/**
 * The master engine-type lookup.
 *
 * Order follows the `EngineType` union / MegaMek numeric type codes.
 * Tech advancement data transcribed from MegaMek `Engine.java`.
 */
export const ENGINE_DATA: Readonly<Record<EngineType, EngineTypeDescriptor>> = {

  // ────────────────────────────────────────────────────────────────────────
  // 0 — Fusion
  // ────────────────────────────────────────────────────────────────────────
  'Fusion': {
    code: 0,
    powerSource: 'fusion',
    weightFreeHeatSinks: 10,
    movementHeat: STANDARD_HEAT,
    weightMultiplier: 1.0,
    minWeight: 0,
    tankWeightMultiplier: 1.5,
    svWeightMultipliers: { A: 0, B: 0, C: 1.5, D: 1.0, E: 0.75, F: 0.5 },
    baseCost: 5000,
    svCostMultiplier: 2.0,
    sideTorsoSlots: NO_SIDE_TORSO,
    tech: {
      techBase: 'All', rating: 'D',
      availability: ['C', 'E', 'D', 'D'],
      level: 'Introductory',
      dates: { prototype: DATE_ES, production: DATE_ES, common: approx(2300) },
    },
    largeTech: {
      techBase: 'All', rating: 'D',
      availability: ['C', 'E', 'D', 'D'],
      level: 'Experimental',
      dates: { prototype: 2630, production: approx(3085), common: approx(3120) },
      factions: { prototype: ['TH'], production: ['LC'] },
    },
    supportTech: {
      techBase: 'All', rating: 'C',
      availability: ['C', 'E', 'D', 'C'],
      level: 'Standard',
      dates: { prototype: DATE_ES, production: DATE_ES, common: DATE_ES },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 1 — ICE  (Combustion)
  // ────────────────────────────────────────────────────────────────────────
  'ICE': {
    code: 1,
    powerSource: 'combustion',
    weightFreeHeatSinks: 0,
    movementHeat: STANDARD_HEAT,      // TacOps: ICE Meks generate movement heat
    weightMultiplier: 2.0,
    minWeight: 0,
    tankWeightMultiplier: 1.0,
    svWeightMultipliers: { A: 0, B: 3.0, C: 2.0, D: 1.5, E: 1.3, F: 1.0 },
    baseCost: 1250,
    svCostMultiplier: 1.0,
    sideTorsoSlots: NO_SIDE_TORSO,
    tech: {
      techBase: 'All', rating: 'C',
      availability: ['A', 'A', 'A', 'A'],
      level: 'Introductory',
      dates: { prototype: DATE_ES, production: DATE_ES, common: approx(2300) },
    },
    largeTech: {
      techBase: 'All', rating: 'C',
      availability: ['A', 'A', 'A', 'A'],
      level: 'Experimental',
      dates: {
        prototype: DATE_NONE, production: 2630, common: approx(3120),
        extinct: DATE_NONE, reintroduced: DATE_NONE,
      },
      factions: { prototype: ['TH'], production: ['LC'] },
    },
    supportTech: {
      techBase: 'All', rating: 'B',
      availability: ['A', 'A', 'A', 'A'],
      level: 'Standard',
      dates: { prototype: DATE_PS, production: DATE_PS, common: DATE_PS },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 2 — XL
  // ────────────────────────────────────────────────────────────────────────
  'XL': {
    code: 2,
    powerSource: 'fusion',
    weightFreeHeatSinks: 10,
    movementHeat: STANDARD_HEAT,
    weightMultiplier: 0.5,
    minWeight: 0,
    tankWeightMultiplier: 1.5,
    svWeightMultipliers: SV_ZERO,
    baseCost: 20_000,
    svCostMultiplier: 1.0,
    sideTorsoSlots: { is: 3, clan: 2, isSH: 2, clanSH: 1 },
    // IS XL
    tech: {
      techBase: 'IS', rating: 'E',
      availability: ['D', 'F', 'E', 'D'],
      level: 'Standard',
      dates: { prototype: 2556, production: 2579, common: 3045, extinct: 2865, reintroduced: 3035 },
      factions: { prototype: ['TH'], production: ['TH'], reintroduction: ['LC'] },
    },
    // Clan XL
    clanTech: {
      techBase: 'Clan', rating: 'F',
      availability: ['D', 'E', 'D', 'D'],
      level: 'Standard',
      dates: { prototype: approx(2824), production: 2827, common: 2829 },
      factions: { prototype: ['CSF'], production: ['CSF'] },
    },
    // Large IS XL
    largeTech: {
      techBase: 'IS', rating: 'E',
      availability: ['D', 'F', 'E', 'E'],
      level: 'Experimental',
      dates: { prototype: approx(2635), production: approx(3085), common: DATE_NONE, extinct: 2822, reintroduced: 3054 },
      factions: { prototype: ['TH'], production: ['TH'], reintroduction: ['LC', 'FS'] },
    },
    // Large Clan XL
    largeClanTech: {
      techBase: 'Clan', rating: 'F',
      availability: ['D', 'F', 'E', 'E'],
      level: 'Experimental',
      dates: { prototype: approx(2850), production: approx(3080), common: DATE_NONE },
      factions: { prototype: ['CIH'], production: ['CHH'] },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 3 — XXL
  // ────────────────────────────────────────────────────────────────────────
  'XXL': {
    code: 3,
    powerSource: 'fusion',
    weightFreeHeatSinks: 10,
    movementHeat: XXL_HEAT,
    weightMultiplier: 1 / 3,
    minWeight: 0,
    tankWeightMultiplier: 1.5,
    svWeightMultipliers: SV_ZERO,
    baseCost: 100_000,
    svCostMultiplier: 1.0,
    sideTorsoSlots: { is: 6, clan: 4, isSH: 3, clanSH: 2 },
    // IS XXL
    tech: {
      techBase: 'IS', rating: 'F',
      availability: ['X', 'X', 'F', 'E'],
      level: 'Advanced',
      dates: {
        prototype: 3055, production: approx(3125), common: DATE_NONE,
        extinct: DATE_NONE, reintroduced: DATE_NONE,
      },
      factions: { prototype: ['FS', 'LC'], production: ['LC'] },
    },
    // Clan XXL
    clanTech: {
      techBase: 'Clan', rating: 'F',
      availability: ['X', 'X', 'F', 'E'],
      level: 'Advanced',
      dates: {
        prototype: 3030, production: approx(3125), common: DATE_NONE,
        extinct: DATE_NONE, reintroduced: DATE_NONE,
      },
      factions: { prototype: ['CSF'], production: ['CSF'] },
    },
    // Large IS XXL
    largeTech: {
      techBase: 'IS', rating: 'F',
      availability: ['X', 'X', 'F', 'F'],
      level: 'Experimental',
      dates: {
        prototype: 2630, production: approx(3130), common: DATE_NONE,
        extinct: DATE_NONE, reintroduced: DATE_NONE,
      },
      factions: { prototype: ['FS'], production: ['LC'] },
    },
    // Large Clan XXL
    largeClanTech: {
      techBase: 'Clan', rating: 'F',
      availability: ['X', 'X', 'F', 'F'],
      level: 'Experimental',
      dates: {
        prototype: 2630, production: approx(3130), common: DATE_NONE,
        extinct: DATE_NONE, reintroduced: DATE_NONE,
      },
      factions: { prototype: ['CSF'], production: ['CSF'] },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 4 — Light  (IS only)
  // ────────────────────────────────────────────────────────────────────────
  'Light': {
    code: 4,
    powerSource: 'fusion',
    weightFreeHeatSinks: 10,
    movementHeat: STANDARD_HEAT,
    weightMultiplier: 0.75,
    minWeight: 0,
    tankWeightMultiplier: 1.5,
    svWeightMultipliers: SV_ZERO,
    baseCost: 15_000,
    svCostMultiplier: 1.0,
    // Java treats Light same as Clan XL for side-torso crits regardless of tech base
    sideTorsoSlots: { is: 2, clan: 2, isSH: 1, clanSH: 1 },
    tech: {
      techBase: 'IS', rating: 'D',
      availability: ['X', 'X', 'E', 'D'],
      level: 'Standard',
      dates: { prototype: approx(3055), production: 3062, common: 3067 },
      factions: { prototype: ['MERC'], production: ['LC'] },
    },
    largeTech: {
      techBase: 'IS', rating: 'D',
      availability: ['X', 'X', 'E', 'E'],
      level: 'Experimental',
      dates: { prototype: approx(3064), production: 3065, common: DATE_NONE },
      factions: { prototype: ['LC'], production: ['LC'] },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 5 — Compact  (IS only)
  // ────────────────────────────────────────────────────────────────────────
  'Compact': {
    code: 5,
    powerSource: 'fusion',
    weightFreeHeatSinks: 10,
    movementHeat: STANDARD_HEAT,
    weightMultiplier: 1.5,
    minWeight: 0,
    tankWeightMultiplier: 1.5,
    svWeightMultipliers: SV_ZERO,
    baseCost: 10_000,
    svCostMultiplier: 1.0,
    sideTorsoSlots: NO_SIDE_TORSO,
    tech: {
      techBase: 'IS', rating: 'E',
      availability: ['X', 'X', 'E', 'D'],
      level: 'Standard',
      dates: {
        prototype: approx(3060), production: 3066, common: approx(3072),
        extinct: DATE_NONE, reintroduced: DATE_NONE,
      },
      factions: { prototype: ['LC'], production: ['LC'] },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 6 — Fuel Cell
  // ────────────────────────────────────────────────────────────────────────
  'Fuel Cell': {
    code: 6,
    powerSource: 'fuel-cell',
    weightFreeHeatSinks: 1,
    movementHeat: STANDARD_HEAT,      // TacOps: Fuel Cell Meks generate movement heat
    weightMultiplier: 1.2,
    minWeight: 0,
    tankWeightMultiplier: 1.0,
    svWeightMultipliers: { A: 0, B: 0, C: 1.2, D: 1.0, E: 0.9, F: 0.7 },
    baseCost: 3500,
    svCostMultiplier: 1.4,
    sideTorsoSlots: NO_SIDE_TORSO,
    tech: {
      techBase: 'All', rating: 'D',
      availability: ['C', 'D', 'D', 'C'],
      level: 'Standard',
      dates: { prototype: approx(2300), production: 2470, common: 3078 },
      factions: { prototype: ['TA'], production: ['TH'] },
    },
    supportTech: {
      techBase: 'All', rating: 'C',
      availability: ['B', 'C', 'C', 'B'],
      level: 'Standard',
      dates: { prototype: DATE_PS, production: DATE_PS, common: DATE_PS },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 7 — Fission
  // ────────────────────────────────────────────────────────────────────────
  'Fission': {
    code: 7,
    powerSource: 'fission',
    weightFreeHeatSinks: 5,
    movementHeat: STANDARD_HEAT,
    weightMultiplier: 1.75,
    minWeight: 5,
    tankWeightMultiplier: 1.5,
    svWeightMultipliers: { A: 0, B: 0, C: 1.75, D: 1.5, E: 1.4, F: 1.3 },
    baseCost: 7500,
    svCostMultiplier: 3.0,
    sideTorsoSlots: NO_SIDE_TORSO,
    tech: {
      techBase: 'All', rating: 'D',
      availability: ['E', 'E', 'D', 'D'],
      level: 'Standard',
      dates: { prototype: 2470, production: 2882, common: 3079 },
      factions: { prototype: ['TH'], production: ['TC'] },
    },
    supportTech: {
      techBase: 'All', rating: 'C',
      availability: ['E', 'E', 'D', 'C'],
      level: 'Standard',
      dates: { prototype: DATE_ES, production: DATE_ES, common: DATE_ES },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 8 — None
  // ────────────────────────────────────────────────────────────────────────
  'None': {
    code: 8,
    powerSource: 'none',
    weightFreeHeatSinks: 0,
    movementHeat: ZERO_HEAT,
    weightMultiplier: 0,
    minWeight: 0,
    tankWeightMultiplier: 1.0,
    svWeightMultipliers: SV_ZERO,
    baseCost: 0,
    svCostMultiplier: 1.0,
    sideTorsoSlots: NO_SIDE_TORSO,
    tech: {
      techBase: 'All', rating: 'A',
      availability: ['A', 'A', 'A', 'A'],
      level: 'Standard',
      dates: { prototype: DATE_PS, production: DATE_PS, common: DATE_PS },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 9 — Maglev
  // ────────────────────────────────────────────────────────────────────────
  'Maglev': {
    code: 9,
    powerSource: 'maglev',
    weightFreeHeatSinks: 0,
    movementHeat: ZERO_HEAT,
    weightMultiplier: 0,
    minWeight: 0,
    tankWeightMultiplier: 1.0,
    svWeightMultipliers: { A: 0, B: 0, C: 0.8, D: 0.7, E: 0.6, F: 0.5 },
    baseCost: 0,
    svCostMultiplier: 2.5,
    sideTorsoSlots: NO_SIDE_TORSO,
    tech: {
      techBase: 'All', rating: 'C',
      availability: ['D', 'F', 'E', 'D'],
      level: 'Standard',
      dates: { prototype: DATE_ES, production: DATE_ES, common: DATE_ES },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 10 — Steam
  // ────────────────────────────────────────────────────────────────────────
  'Steam': {
    code: 10,
    powerSource: 'steam',
    weightFreeHeatSinks: 0,
    movementHeat: ZERO_HEAT,
    weightMultiplier: 0,
    minWeight: 0,
    tankWeightMultiplier: 1.0,
    svWeightMultipliers: { A: 4.0, B: 3.5, C: 3.0, D: 2.8, E: 2.6, F: 2.5 },
    baseCost: 0,
    svCostMultiplier: 0.8,
    sideTorsoSlots: NO_SIDE_TORSO,
    tech: {
      techBase: 'All', rating: 'A',
      availability: ['A', 'A', 'A', 'A'],
      level: 'Standard',
      dates: { prototype: DATE_PS, production: DATE_PS, common: DATE_PS },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 11 — Battery
  // ────────────────────────────────────────────────────────────────────────
  'Battery': {
    code: 11,
    powerSource: 'battery',
    weightFreeHeatSinks: 0,
    movementHeat: ZERO_HEAT,
    weightMultiplier: 0,
    minWeight: 0,
    tankWeightMultiplier: 1.0,
    svWeightMultipliers: { A: 0, B: 0, C: 1.5, D: 1.2, E: 1.0, F: 0.8 },
    baseCost: 0,
    svCostMultiplier: 1.2,
    sideTorsoSlots: NO_SIDE_TORSO,
    tech: {
      techBase: 'All', rating: 'C',
      availability: ['A', 'B', 'A', 'A'],
      level: 'Standard',
      dates: { prototype: DATE_PS, production: DATE_PS, common: DATE_PS },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 12 — Solar
  // ────────────────────────────────────────────────────────────────────────
  'Solar': {
    code: 12,
    powerSource: 'solar',
    weightFreeHeatSinks: 0,
    movementHeat: ZERO_HEAT,
    weightMultiplier: 0,
    minWeight: 0,
    tankWeightMultiplier: 1.0,
    svWeightMultipliers: { A: 0, B: 0, C: 5.0, D: 4.5, E: 4.0, F: 3.5 },
    baseCost: 0,
    svCostMultiplier: 1.6,
    sideTorsoSlots: NO_SIDE_TORSO,
    tech: {
      techBase: 'All', rating: 'C',
      availability: ['C', 'D', 'C', 'C'],
      level: 'Standard',
      dates: { prototype: DATE_PS, production: DATE_PS, common: DATE_PS },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 13 — External
  // ────────────────────────────────────────────────────────────────────────
  'External': {
    code: 13,
    powerSource: 'external',
    weightFreeHeatSinks: 0,
    movementHeat: ZERO_HEAT,
    weightMultiplier: 0,
    minWeight: 0,
    tankWeightMultiplier: 1.0,
    svWeightMultipliers: { A: 0, B: 1.4, C: 1.0, D: 0.8, E: 0.7, F: 0.6 },
    baseCost: 0,
    svCostMultiplier: 1.0,
    sideTorsoSlots: NO_SIDE_TORSO,
    tech: {
      techBase: 'All', rating: 'B',
      availability: ['C', 'D', 'C', 'C'],
      level: 'Standard',
      dates: { prototype: DATE_NONE, production: DATE_NONE, common: DATE_PS },
    },
  },
};

// ============================================================================
// Descriptor lookup helpers
// ============================================================================

/**
 * Resolve the correct `EngineTechAdvancement` for an engine instance,
 * selecting among standard / clan / large / support variants.
 *
 * Mirrors the selection logic in MegaMek `Engine.getTechAdvancement()`.
 */
export function getEngineTechAdvancement(
  type: EngineType,
  flags: { clan?: boolean; large?: boolean; supportVee?: boolean },
): TechAdvancement {
  const desc = ENGINE_DATA[type];

  if (flags.supportVee && desc.supportTech) return desc.supportTech;

  if (flags.large) {
    if (flags.clan && desc.largeClanTech) return desc.largeClanTech;
    if (desc.largeTech) return desc.largeTech;
  }

  if (flags.clan && desc.clanTech) return desc.clanTech;

  return desc.tech;
}

// ============================================================================
// Derived code maps (built from ENGINE_DATA at module load)
// ============================================================================

/**
 * Reverse lookup: numeric code → EngineType string.
 * Derived from the `code` field on each `EngineTypeDescriptor`.
 */
export const ENGINE_TYPE_FROM_CODE: Record<number, EngineType> =
  Object.fromEntries(
    (Object.entries(ENGINE_DATA) as [EngineType, EngineTypeDescriptor][])
      .map(([name, desc]) => [desc.code, name]),
  ) as Record<number, EngineType>;

/**
 * Forward lookup: EngineType string → numeric code.
 * Derived from the `code` field on each `EngineTypeDescriptor`.
 */
export const ENGINE_TYPE_TO_CODE: Record<EngineType, number> =
  Object.fromEntries(
    (Object.entries(ENGINE_DATA) as [EngineType, EngineTypeDescriptor][])
      .map(([name, desc]) => [name, desc.code]),
  ) as Record<EngineType, number>;

/** Convert a numeric engine code (from BLK files) to an EngineType string. */
export function engineTypeFromCode(code: number): EngineType {
  return ENGINE_TYPE_FROM_CODE[code] ?? 'Fusion';
}

/** Convert an EngineType string to its numeric code (for BLK output). */
export function engineTypeToCode(type: EngineType): number {
  return ENGINE_TYPE_TO_CODE[type] ?? 0;
}
