// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { ArmorEquipment } from '../../../equipment.model';
import type { UnitSubtype, UnitType } from '../../types';

/** Default Total Warfare target movement modifier (advanced movement option off). */
export function targetMovementModifier(mp: number, jumped = false, airborne = false): number {
  if (mp <= 0) return 0;
  let modifier = mp >= 25 ? 6 : mp >= 18 ? 5 : mp >= 10 ? 4 : mp >= 7 ? 3 : mp >= 5 ? 2 : mp >= 3 ? 1 : 0;
  if (airborne) modifier++;
  else if (jumped) modifier++;
  return modifier;
}

/** TM p.316 offensive speed factor, rounded exactly as MegaMek does. */
export function offensiveSpeedFactor(mp: number): number {
  return Math.round(Math.pow(1 + (mp - 5) / 10, 1.2) * 100) / 100;
}

/** Pure armor-type kernel shared by mutable and immutable calculator adapters. */
export function armorBVMultiplierForType(armorType: string | undefined): number {
  switch (armorType) {
    case 'HARDENED': return 2;
    case 'REACTIVE':
    case 'REFLECTIVE':
    case 'BALLISTIC_REINFORCED': return 1.5;
    case 'FERRO_LAMELLOR':
    case 'ANTI_PENETRATIVE_ABLATION': return 1.2;
    case 'HEAT_DISSIPATING': return 1.1;
    default: return 1;
  }
}

export function armorBVMultiplier(armor: ArmorEquipment | undefined): number {
  return armorBVMultiplierForType(armor?.armorType);
}

export function mekArmorBarFactor(armorType: string | undefined): number {
  return armorType === 'COMMERCIAL' ? 0.5 : 1;
}

export function vehicleTypeModifier(motive: string): number {
  switch (motive) {
    case 'Tracked': return 0.9;
    case 'Wheeled': return 0.8;
    case 'Hover':
    case 'VTOL':
    case 'WiGE': return 0.7;
    default: return 0.6;
  }
}

export function ammoKey(ammoType: string, rackSize: number, location?: string): string {
  const key = `${ammoType}:${rackSize}`;
  return location === undefined ? key : `${location}:${key}`;
}

const MEK_SKILL_MULTIPLIERS = Object.freeze([
  Object.freeze([2.42, 2.31, 2.21, 2.10, 1.93, 1.75, 1.68, 1.59, 1.50]),
  Object.freeze([2.21, 2.11, 2.02, 1.92, 1.76, 1.60, 1.54, 1.46, 1.38]),
  Object.freeze([1.93, 1.85, 1.76, 1.68, 1.54, 1.40, 1.35, 1.28, 1.21]),
  Object.freeze([1.66, 1.58, 1.51, 1.44, 1.32, 1.20, 1.16, 1.10, 1.04]),
  Object.freeze([1.38, 1.32, 1.26, 1.20, 1.10, 1.00, 0.95, 0.90, 0.85]),
  Object.freeze([1.31, 1.19, 1.13, 1.08, 0.99, 0.90, 0.86, 0.81, 0.77]),
  Object.freeze([1.24, 1.12, 1.07, 1.02, 0.94, 0.85, 0.81, 0.77, 0.72]),
  Object.freeze([1.17, 1.06, 1.01, 0.96, 0.88, 0.80, 0.76, 0.72, 0.68]),
  Object.freeze([1.10, 0.99, 0.95, 0.90, 0.83, 0.75, 0.71, 0.68, 0.64]),
] as const);

/** Minimal canonical facts needed by the Classic crew-skill BV rule. */
export interface ClassicSkillUnitFacts {
  readonly unitType: UnitType;
  readonly unitSubtype: UnitSubtype;
  readonly canAntiMech: boolean;
}

const DEFAULT_PILOTING_SKILL = 5;
const NO_ANTIMEK_SKILL = 8;

/** Fixed piloting column for unit families that do not use the requested value. */
export function fixedClassicPilotingSkill(facts: ClassicSkillUnitFacts): number | null {
  if (facts.unitType === 'ProtoMek') return DEFAULT_PILOTING_SKILL;
  if (facts.unitType !== 'Infantry' || facts.canAntiMech) return null;
  if (facts.unitSubtype === 'Conventional Infantry'
    || facts.unitSubtype === 'Motorized Conventional Infantry') return NO_ANTIMEK_SKILL;
  return DEFAULT_PILOTING_SKILL;
}

export function effectiveClassicPilotingSkill(
  facts: ClassicSkillUnitFacts,
  requested: number,
): number {
  return fixedClassicPilotingSkill(facts) ?? requested;
}

/** Total Warfare/Core crew-skill adjustment over a current or pristine Mek BV. */
export function adjustMekBattleValueForSkills(base: number, gunnery: number, piloting: number): number {
  const row = MEK_SKILL_MULTIPLIERS[Math.max(0, Math.min(8, Math.trunc(gunnery)))]!;
  const multiplier = row[Math.max(0, Math.min(8, Math.trunc(piloting)))] ?? 1;
  return multiplier === 1 ? base : Math.round(base * multiplier);
}

/** Entity/search adapters share this rule without making UnitSummary an authority. */
export function adjustClassicBattleValueForSkills(
  base: number,
  gunnery: number,
  piloting: number,
  facts: ClassicSkillUnitFacts,
): number {
  return adjustMekBattleValueForSkills(
    base,
    gunnery,
    effectiveClassicPilotingSkill(facts, piloting),
  );
}
