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
 * Cockpit type descriptor data — single source of truth.
 *
 * All static, per-cockpit-type data lives in `COCKPIT_DATA`, a
 * `Record<CockpitType, CockpitTypeDescriptor>`.  Cockpit-type-dependent
 * logic elsewhere should derive from this map instead of ad-hoc if/else chains.
 *
 * Data sourced from MegaMek Mek.java, MekCostCalculator.java,
 * MekBVCalculator.java, TestMek.java, and BattleTech TM / TO rules.
 */

import { approx, DATE_NONE, type CockpitType, type TechAdvancement } from '../types';

// ============================================================================
// Crew type classification
// ============================================================================

/**
 * Crew configuration required by this cockpit type.
 * Matches MegaMek `CrewType` enum values used in Mek constructor.
 */
export type CockpitCrewType =
  | 'Single'
  | 'Dual'
  | 'Command Console'
  | 'Tripod'
  | 'Superheavy Tripod'
  | 'QuadVee';

// ============================================================================
// Head layout type
// ============================================================================

/**
 * Critical slot layout for the head location.
 * Each entry is the system type string for that slot index, or `null`
 * for an empty / equipment-available slot.
 * Length is always 6 (standard head) but only some slots are used.
 */
export type CockpitHeadLayout = readonly (string | null)[];

// ============================================================================
// Cockpit type descriptor
// ============================================================================

/**
 * Complete static data for one cockpit type.
 */
export interface CockpitTypeDescriptor {
  // ── Identity ──

  /** Numeric type code matching MegaMek `Mek.COCKPIT_*` constants. */
  readonly code: number;
  /** Full display name (e.g. "Standard Cockpit", "Small Cockpit"). */
  readonly fullName: string;
  /** Short display name (e.g. "Standard", "Small"). */
  readonly shortName: string;

  // ── Weight ──

  /** Cockpit weight in tons. From TestMek.getWeightCockpit(). */
  readonly weight: number;

  // ── Cost ──

  /** Cost in C-bills. From MekCostCalculator. */
  readonly cost: number;

  // ── BV ──

  /**
   * BV multiplier applied to total base BV in processSummarize().
   * Most cockpits are 1.0; Small / Torso-Mounted / Small Command Console = 0.95;
   * Interface = 1.30.
   */
  readonly bvMultiplier: number;

  /**
   * Whether this cockpit adds CT front + rear armor to defensive BV.
   * Only true for Torso-Mounted cockpit.
   */
  readonly addsDefensiveBVForCTArmor: boolean;

  // ── Head critical slot layout ──

  /**
   * Head slot layout for this cockpit type.
   * Each entry is the system type for that slot index.
   * `null` means the slot is empty/available for equipment.
   */
  readonly headLayout: CockpitHeadLayout;

  /**
   * Whether this cockpit type places crits in the center torso
   * (Cockpit + Sensors in CT, Life Support in side torsos).
   * Only true for Torso-Mounted and VRRP.
   */
  readonly hasTorsoSlots: boolean;

  // ── Flags ──

  /** Whether this is an industrial cockpit (no advanced fire control). */
  readonly isIndustrial: boolean;
  /** Whether this is a primitive cockpit. */
  readonly isPrimitive: boolean;
  /** Whether the cockpit can eject. Torso-Mounted cannot. */
  readonly canEject: boolean;
  /** Whether the cockpit has a command console bonus. */
  readonly hasCommandConsoleBonus: boolean;
  /** Whether the cockpit is a superheavy variant. */
  readonly isSuperHeavy: boolean;
  /** Whether the cockpit is a tripod variant. */
  readonly isTripod: boolean;

  // ── Crew type ──

  /** Crew type required by this cockpit. */
  readonly crewType: CockpitCrewType;

  // ── Tech advancement ──

  /** Technology advancement data. */
  readonly tech: TechAdvancement;

  // ── Adv. Fire Control tech advancement (industrial cockpits only) ──

  /**
   * Tech advancement for Advanced Fire Control upgrade.
   * Only relevant for industrial cockpits. `undefined` for non-industrial.
   */
  readonly advancedFireControlTech?: TechAdvancement;
}

// ============================================================================
// Shared constants
// ============================================================================

/** Standard 6-slot head layout: LS, Sensors, Cockpit, (empty), Sensors, LS */
const HEAD_STANDARD: CockpitHeadLayout = [
  'Life Support', 'Sensors', 'Cockpit', null, 'Sensors', 'Life Support',
];

/** Small cockpit: LS, Sensors, Cockpit, Sensors, (empty), (empty) */
const HEAD_SMALL: CockpitHeadLayout = [
  'Life Support', 'Sensors', 'Cockpit', 'Sensors', null, null,
];

/** Dual / Command Console / Interface / QuadVee / Superheavy Command: 2× cockpit crits */
const HEAD_DUAL: CockpitHeadLayout = [
  'Life Support', 'Sensors', 'Cockpit', 'Cockpit', 'Sensors', 'Life Support',
];

/** Small Command Console: small cockpit with 2× cockpit crits */
const HEAD_SMALL_COMMAND: CockpitHeadLayout = [
  'Life Support', 'Sensors', 'Cockpit', 'Cockpit', 'Sensors', null,
];

/** Torso-Mounted / VRRP: only sensors in head, cockpit moves to CT */
const HEAD_TORSO_MOUNTED: CockpitHeadLayout = [
  'Sensors', 'Sensors', null, null, null, null,
];

/** Advanced Fire Control tech advancement (shared by all industrial cockpits). */
const ADV_FIRE_CONTROL_TECH: TechAdvancement = {
  techBase: 'All', rating: 'D',
  availability: ['D', 'E', 'E', 'D'],
  level: 'Standard',
  dates: { prototype: approx(2469), production: 2470, common: 2491 },
};

// ============================================================================
// COCKPIT_DATA — Record<CockpitType, CockpitTypeDescriptor>
// ============================================================================

/**
 * The master cockpit-type lookup.
 *
 * Order follows the `CockpitType` union / MegaMek numeric type codes.
 * Tech advancement data transcribed from MegaMek `Mek.java` (COCKPIT_TA[]),
 * weights from `TestMek.getWeightCockpit()`, costs from `MekCostCalculator`,
 * BV from `MekBVCalculator.processSummarize()`.
 */
export const COCKPIT_DATA: Readonly<Record<CockpitType, CockpitTypeDescriptor>> = {

  // ────────────────────────────────────────────────────────────────────────
  // 0 — Standard
  // ────────────────────────────────────────────────────────────────────────
  'Standard': {
    code: 0,
    fullName: 'Standard Cockpit',
    shortName: 'Standard',
    weight: 3,
    cost: 200_000,
    bvMultiplier: 1.0,
    addsDefensiveBVForCTArmor: false,
    headLayout: HEAD_STANDARD,
    hasTorsoSlots: false,
    isIndustrial: false,
    isPrimitive: false,
    canEject: true,
    hasCommandConsoleBonus: false,
    isSuperHeavy: false,
    isTripod: false,
    crewType: 'Single',
    tech: {
      techBase: 'All', rating: 'D',
      availability: ['C', 'C', 'C', 'C'],
      level: 'Introductory',
      dates: {
        is: { prototype: 2464, production: 2471, common: 2488 },
        clan: { prototype: DATE_NONE, production: 2808, common: 2808 },
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 1 — Small
  // ────────────────────────────────────────────────────────────────────────
  'Small': {
    code: 1,
    fullName: 'Small Cockpit',
    shortName: 'Small',
    weight: 2,
    cost: 175_000,
    bvMultiplier: 0.95,
    addsDefensiveBVForCTArmor: false,
    headLayout: HEAD_SMALL,
    hasTorsoSlots: false,
    isIndustrial: false,
    isPrimitive: false,
    canEject: true,
    hasCommandConsoleBonus: false,
    isSuperHeavy: false,
    isTripod: false,
    crewType: 'Single',
    tech: {
      techBase: 'All', rating: 'E',
      availability: ['X', 'X', 'E', 'D'],
      level: 'Standard',
      dates: {
        is: { prototype: 3061, production: 3068, common: 3081 },
        clan: { prototype: DATE_NONE, production: 3081, common: DATE_NONE },
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 2 — Command Console
  // ────────────────────────────────────────────────────────────────────────
  'Command Console': {
    code: 2,
    fullName: 'Command Console',
    shortName: 'Command Console',
    weight: 6,
    cost: 700_000,
    bvMultiplier: 1.0,
    addsDefensiveBVForCTArmor: false,
    headLayout: HEAD_DUAL,
    hasTorsoSlots: false,
    isIndustrial: false,
    isPrimitive: false,
    canEject: true,
    hasCommandConsoleBonus: true,
    isSuperHeavy: false,
    isTripod: false,
    crewType: 'Command Console',
    tech: {
      techBase: 'All', rating: 'D',
      availability: ['C', 'F', 'E', 'D'],
      level: 'Advanced',
      dates: {
        is: { prototype: 2621, production: 2632, common: DATE_NONE, extinct: 2846, reintroduced: 3026 },
        clan: { prototype: DATE_NONE, production: 2808, common: DATE_NONE },
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 3 — Torso-Mounted
  // ────────────────────────────────────────────────────────────────────────
  'Torso-Mounted': {
    code: 3,
    fullName: 'Torso-Mounted Cockpit',
    shortName: 'Torso Mounted',
    weight: 4,
    cost: 750_000,
    bvMultiplier: 0.95,
    addsDefensiveBVForCTArmor: true,
    headLayout: HEAD_TORSO_MOUNTED,
    hasTorsoSlots: true,
    isIndustrial: false,
    isPrimitive: false,
    canEject: false,
    hasCommandConsoleBonus: false,
    isSuperHeavy: false,
    isTripod: false,
    crewType: 'Single',
    tech: {
      techBase: 'All', rating: 'D',
      availability: ['X', 'X', 'F', 'F'],
      level: 'Experimental',
      dates: {
        is: { prototype: 3053, production: 3071, common: DATE_NONE },
        clan: { prototype: 3056, production: 3070, common: DATE_NONE },
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 4 — Dual
  // ────────────────────────────────────────────────────────────────────────
  'Dual': {
    code: 4,
    fullName: 'Dual Cockpit',
    shortName: 'Dual',
    weight: 4,
    cost: 40_000,
    bvMultiplier: 1.0,
    addsDefensiveBVForCTArmor: false,
    headLayout: HEAD_DUAL,
    hasTorsoSlots: false,
    isIndustrial: false,
    isPrimitive: false,
    canEject: true,
    hasCommandConsoleBonus: false,
    isSuperHeavy: false,
    isTripod: false,
    crewType: 'Dual',
    tech: {
      techBase: 'All', rating: 'D',
      availability: ['C', 'C', 'C', 'C'],
      level: 'Unofficial',
      dates: { prototype: approx(2468), production: 2470, common: 2487 },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 5 — Industrial
  // ────────────────────────────────────────────────────────────────────────
  'Industrial': {
    code: 5,
    fullName: 'Industrial Cockpit',
    shortName: 'Industrial',
    weight: 3,
    cost: 100_000,
    bvMultiplier: 1.0,
    addsDefensiveBVForCTArmor: false,
    headLayout: HEAD_STANDARD,
    hasTorsoSlots: false,
    isIndustrial: true,
    isPrimitive: false,
    canEject: true,
    hasCommandConsoleBonus: false,
    isSuperHeavy: false,
    isTripod: false,
    crewType: 'Single',
    tech: {
      techBase: 'All', rating: 'C',
      availability: ['B', 'C', 'C', 'B'],
      level: 'Standard',
      dates: {
        is: { prototype: 2465, production: 2471, common: 2491 },
        clan: { prototype: DATE_NONE, production: 2808, common: 2808 },
      },
    },
    advancedFireControlTech: ADV_FIRE_CONTROL_TECH,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 6 — Primitive
  // ────────────────────────────────────────────────────────────────────────
  'Primitive': {
    code: 6,
    fullName: 'Primitive Cockpit',
    shortName: 'Primitive',
    weight: 5,
    cost: 200_000,
    bvMultiplier: 1.0,
    addsDefensiveBVForCTArmor: false,
    headLayout: HEAD_STANDARD,
    hasTorsoSlots: false,
    isIndustrial: false,
    isPrimitive: true,
    canEject: true,
    hasCommandConsoleBonus: false,
    isSuperHeavy: false,
    isTripod: false,
    crewType: 'Single',
    tech: {
      techBase: 'All', rating: 'D',
      availability: ['D', 'X', 'X', 'F'],
      level: 'Advanced',
      dates: {
        is: { prototype: 2426, production: 2440, common: DATE_NONE },
        clan: { prototype: DATE_NONE, production: 2808, common: DATE_NONE },
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 7 — Primitive Industrial
  // ────────────────────────────────────────────────────────────────────────
  'Primitive Industrial': {
    code: 7,
    fullName: 'Primitive Industrial Cockpit',
    shortName: 'Primitive Industrial',
    weight: 5,
    cost: 100_000,
    bvMultiplier: 1.0,
    addsDefensiveBVForCTArmor: false,
    headLayout: HEAD_STANDARD,
    hasTorsoSlots: false,
    isIndustrial: true,
    isPrimitive: true,
    canEject: true,
    hasCommandConsoleBonus: false,
    isSuperHeavy: false,
    isTripod: false,
    crewType: 'Single',
    tech: {
      techBase: 'All', rating: 'C',
      availability: ['C', 'X', 'X', 'F'],
      level: 'Advanced',
      dates: {
        is: { prototype: 2296, production: 2351, common: DATE_NONE, extinct: 2520 },
        clan: { prototype: DATE_NONE, production: DATE_NONE, common: DATE_NONE },
      },
    },
    advancedFireControlTech: ADV_FIRE_CONTROL_TECH,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 8 — Superheavy
  // ────────────────────────────────────────────────────────────────────────
  'Superheavy': {
    code: 8,
    fullName: 'Superheavy Cockpit',
    shortName: 'Superheavy',
    weight: 4,
    cost: 300_000,
    bvMultiplier: 1.0,
    addsDefensiveBVForCTArmor: false,
    headLayout: HEAD_STANDARD,
    hasTorsoSlots: false,
    isIndustrial: false,
    isPrimitive: false,
    canEject: true,
    hasCommandConsoleBonus: false,
    isSuperHeavy: true,
    isTripod: false,
    crewType: 'Single',
    tech: {
      techBase: 'IS', rating: 'E',
      availability: ['X', 'X', 'F', 'E'],
      level: 'Advanced',
      dates: { prototype: approx(3060), production: 3076, common: DATE_NONE },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 9 — Superheavy Tripod
  // ────────────────────────────────────────────────────────────────────────
  'Superheavy Tripod': {
    code: 9,
    fullName: 'Superheavy Tripod Cockpit',
    shortName: 'Superheavy Tripod',
    weight: 5,
    cost: 500_000,
    bvMultiplier: 1.0,
    addsDefensiveBVForCTArmor: false,
    headLayout: HEAD_STANDARD,
    hasTorsoSlots: false,
    isIndustrial: false,
    isPrimitive: false,
    canEject: true,
    hasCommandConsoleBonus: false,
    isSuperHeavy: true,
    isTripod: true,
    crewType: 'Superheavy Tripod',
    tech: {
      techBase: 'IS', rating: 'E',
      availability: ['X', 'F', 'X', 'F'],
      level: 'Advanced',
      dates: { prototype: approx(3130), production: 3135, common: DATE_NONE },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 10 — Tripod
  // ────────────────────────────────────────────────────────────────────────
  'Tripod': {
    code: 10,
    fullName: 'Tripod Cockpit',
    shortName: 'Tripod',
    weight: 4,
    cost: 400_000,
    bvMultiplier: 1.0,
    addsDefensiveBVForCTArmor: false,
    headLayout: HEAD_STANDARD,
    hasTorsoSlots: false,
    isIndustrial: false,
    isPrimitive: false,
    canEject: true,
    hasCommandConsoleBonus: false,
    isSuperHeavy: false,
    isTripod: true,
    crewType: 'Tripod',
    tech: {
      techBase: 'IS', rating: 'F',
      availability: ['X', 'X', 'X', 'F'],
      level: 'Advanced',
      dates: { prototype: approx(2590), production: 2702, common: DATE_NONE },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 11 — Interface
  // ────────────────────────────────────────────────────────────────────────
  'Interface': {
    code: 11,
    fullName: 'Interface Cockpit',
    shortName: 'Interface',
    weight: 4,
    cost: 200_000,
    bvMultiplier: 1.30,
    addsDefensiveBVForCTArmor: false,
    headLayout: HEAD_DUAL,
    hasTorsoSlots: false,
    isIndustrial: false,
    isPrimitive: false,
    canEject: true,
    hasCommandConsoleBonus: false,
    isSuperHeavy: false,
    isTripod: false,
    crewType: 'Single',
    tech: {
      techBase: 'All', rating: 'E',
      availability: ['X', 'X', 'F', 'F'],
      level: 'Experimental',
      dates: {
        is: { prototype: 3070, production: DATE_NONE, common: DATE_NONE },
        clan: { prototype: 3079, production: DATE_NONE, common: DATE_NONE },
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 12 — Virtual Reality Piloting Pod (VRRP / VRPP)
  // ────────────────────────────────────────────────────────────────────────
  'Virtual Reality Piloting Pod': {
    code: 12,
    fullName: 'Virtual Reality Piloting Pod',
    shortName: 'VRPP',
    weight: 3,
    cost: 1_250_000,
    bvMultiplier: 1.0,
    addsDefensiveBVForCTArmor: false,
    headLayout: HEAD_TORSO_MOUNTED,
    hasTorsoSlots: true,
    isIndustrial: false,
    isPrimitive: false,
    canEject: true,
    hasCommandConsoleBonus: false,
    isSuperHeavy: false,
    isTripod: false,
    crewType: 'Single',
    tech: {
      techBase: 'IS', rating: 'E',
      availability: ['X', 'X', 'F', 'X'],
      level: 'Experimental',
      dates: { prototype: 3052, production: DATE_NONE, common: DATE_NONE, extinct: 3055 },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 13 — QuadVee
  // ────────────────────────────────────────────────────────────────────────
  'QuadVee': {
    code: 13,
    fullName: 'QuadVee Cockpit',
    shortName: 'QuadVee',
    weight: 4,
    cost: 375_000,
    bvMultiplier: 1.0,
    addsDefensiveBVForCTArmor: false,
    headLayout: HEAD_DUAL,
    hasTorsoSlots: false,
    isIndustrial: false,
    isPrimitive: false,
    canEject: true,
    hasCommandConsoleBonus: false,
    isSuperHeavy: false,
    isTripod: false,
    crewType: 'QuadVee',
    tech: {
      techBase: 'Clan', rating: 'F',
      availability: ['X', 'X', 'X', 'F'],
      level: 'Advanced',
      dates: { prototype: approx(3130), production: 3135, common: DATE_NONE },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 14 — Superheavy Industrial
  // ────────────────────────────────────────────────────────────────────────
  'Superheavy Industrial': {
    code: 14,
    fullName: 'Superheavy Industrial Cockpit',
    shortName: 'Superheavy Industrial',
    weight: 4,
    cost: 200_000,
    bvMultiplier: 1.0,
    addsDefensiveBVForCTArmor: false,
    headLayout: HEAD_STANDARD,
    hasTorsoSlots: false,
    isIndustrial: true,
    isPrimitive: false,
    canEject: true,
    hasCommandConsoleBonus: false,
    isSuperHeavy: true,
    isTripod: false,
    crewType: 'Single',
    tech: {
      techBase: 'IS', rating: 'D',
      availability: ['X', 'F', 'F', 'F'],
      level: 'Advanced',
      dates: { prototype: approx(2905), production: 2940, common: DATE_NONE },
    },
    advancedFireControlTech: ADV_FIRE_CONTROL_TECH,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 15 — Superheavy Command Console
  // ────────────────────────────────────────────────────────────────────────
  'Superheavy Command Console': {
    code: 15,
    fullName: 'Superheavy Command Console',
    shortName: 'Superheavy Command',
    weight: 7,
    cost: 800_000,
    bvMultiplier: 1.0,
    addsDefensiveBVForCTArmor: false,
    headLayout: HEAD_DUAL,
    hasTorsoSlots: false,
    isIndustrial: false,
    isPrimitive: false,
    canEject: true,
    hasCommandConsoleBonus: true,
    isSuperHeavy: true,
    isTripod: false,
    crewType: 'Command Console',
    tech: {
      techBase: 'IS', rating: 'E',
      availability: ['X', 'X', 'F', 'E'],
      level: 'Advanced',
      dates: { prototype: approx(3060), production: 3076, common: DATE_NONE },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 16 — Small Command Console
  // ────────────────────────────────────────────────────────────────────────
  'Small Command Console': {
    code: 16,
    fullName: 'Small Command Console',
    shortName: 'Small Command',
    weight: 5,
    cost: 675_000,
    bvMultiplier: 0.95,
    addsDefensiveBVForCTArmor: false,
    headLayout: HEAD_SMALL_COMMAND,
    hasTorsoSlots: false,
    isIndustrial: false,
    isPrimitive: false,
    canEject: true,
    hasCommandConsoleBonus: true,
    isSuperHeavy: false,
    isTripod: false,
    crewType: 'Command Console',
    tech: {
      techBase: 'All', rating: 'E',
      availability: ['X', 'X', 'E', 'D'],
      level: 'Advanced',
      dates: {
        is: { prototype: 3061, production: 3068, common: 3081 },
        clan: { prototype: DATE_NONE, production: 3081, common: DATE_NONE },
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 17 — Tripod Industrial
  // ────────────────────────────────────────────────────────────────────────
  'Tripod Industrial': {
    code: 17,
    fullName: 'Tripod Industrial Cockpit',
    shortName: 'Tripod Industrial',
    weight: 4,
    cost: 300_000,
    bvMultiplier: 1.0,
    addsDefensiveBVForCTArmor: false,
    headLayout: HEAD_STANDARD,
    hasTorsoSlots: false,
    isIndustrial: true,
    isPrimitive: false,
    canEject: true,
    hasCommandConsoleBonus: false,
    isSuperHeavy: false,
    isTripod: true,
    crewType: 'Tripod',
    tech: {
      techBase: 'IS', rating: 'E',
      availability: ['X', 'F', 'X', 'F'],
      level: 'Advanced',
      dates: { prototype: approx(3130), production: 3135, common: DATE_NONE },
    },
    advancedFireControlTech: ADV_FIRE_CONTROL_TECH,
  },

  // ────────────────────────────────────────────────────────────────────────
  // 18 — Superheavy Tripod Industrial
  // ────────────────────────────────────────────────────────────────────────
  'Superheavy Tripod Industrial': {
    code: 18,
    fullName: 'Superheavy Tripod Industrial Cockpit',
    shortName: 'Superheavy Tripod Industrial',
    weight: 4,
    cost: 400_000,
    bvMultiplier: 1.0,
    addsDefensiveBVForCTArmor: false,
    headLayout: HEAD_STANDARD,
    hasTorsoSlots: false,
    isIndustrial: true,
    isPrimitive: false,
    canEject: true,
    hasCommandConsoleBonus: false,
    isSuperHeavy: true,
    isTripod: true,
    crewType: 'Superheavy Tripod',
    tech: {
      techBase: 'IS', rating: 'F',
      availability: ['X', 'X', 'X', 'F'],
      level: 'Advanced',
      dates: { prototype: approx(2590), production: 2702, common: DATE_NONE },
    },
    advancedFireControlTech: ADV_FIRE_CONTROL_TECH,
  },
};

// ============================================================================
// Descriptor lookup helpers
// ============================================================================

/**
 * Resolve the `TechAdvancement` for a cockpit type.
 */
export function getCockpitTechAdvancement(type: CockpitType): TechAdvancement {
  return COCKPIT_DATA[type].tech;
}

// ============================================================================
// Derived code maps (built from COCKPIT_DATA at module load)
// ============================================================================

/**
 * Reverse lookup: numeric code → CockpitType string.
 * Derived from the `code` field on each `CockpitTypeDescriptor`.
 */
export const COCKPIT_TYPE_FROM_CODE: Record<number, CockpitType> =
  Object.fromEntries(
    (Object.entries(COCKPIT_DATA) as [CockpitType, CockpitTypeDescriptor][])
      .map(([name, desc]) => [desc.code, name]),
  ) as Record<number, CockpitType>;

/**
 * Forward lookup: CockpitType string → numeric code.
 * Derived from the `code` field on each `CockpitTypeDescriptor`.
 */
export const COCKPIT_TYPE_TO_CODE: Record<CockpitType, number> =
  Object.fromEntries(
    (Object.entries(COCKPIT_DATA) as [CockpitType, CockpitTypeDescriptor][])
      .map(([name, desc]) => [name, desc.code]),
  ) as Record<CockpitType, number>;

/** Convert a numeric cockpit code (from BLK files) to a CockpitType string. */
export function cockpitTypeFromCode(code: number): CockpitType {
  return COCKPIT_TYPE_FROM_CODE[code] ?? 'Standard';
}

/** Convert a CockpitType string to its numeric code (for BLK output). */
export function cockpitTypeToCode(type: CockpitType): number {
  return COCKPIT_TYPE_TO_CODE[type] ?? 0;
}
