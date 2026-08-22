// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { AlphaStrikeArcStats, AlphaStrikeUnitStats } from '../../../../unit-summary.model';

export type AlphaStrikeDamage = AlphaStrikeUnitStats['dmg'];
export type AlphaStrikeArcName = 'frontArc' | 'leftArc' | 'rightArc' | 'rearArc';
export type RawDamageVector = [short: number, medium: number, long: number, extreme: number];

export interface AlphaStrikeDamageResult {
  readonly standard: AlphaStrikeDamage;
  readonly overheat: number;
  readonly arcs: Partial<Record<AlphaStrikeArcName, AlphaStrikeArcStats>>;
}

/** Shared result shape for a non-arced damage-family conversion. */
export interface AlphaStrikeStandardDamageResult extends AlphaStrikeDamageResult {
  readonly overheatLong?: boolean;
  readonly heatSpecials: readonly string[];
  readonly specialDamageHeatFactors?: Readonly<RawDamageVector>;
  readonly rearSpecialDamageHeatFactors?: Readonly<RawDamageVector>;
}

export const ZERO_DAMAGE: Readonly<AlphaStrikeDamage> = Object.freeze({
  dmgS: '0',
  dmgM: '0',
  dmgL: '0',
  dmgE: '0',
});

export function createRawDamageVector(): RawDamageVector {
  return [0, 0, 0, 0];
}

export function createEmptyArc(): AlphaStrikeArcStats {
  return {
    STD: { ...ZERO_DAMAGE },
    CAP: { ...ZERO_DAMAGE },
    SCAP: { ...ZERO_DAMAGE },
    MSL: { ...ZERO_DAMAGE },
    specials: [],
  };
}

export function createEmptyArcs(): Record<AlphaStrikeArcName, AlphaStrikeArcStats> {
  return {
    frontArc: createEmptyArc(),
    leftArc: createEmptyArc(),
    rightArc: createEmptyArc(),
    rearArc: createEmptyArc(),
  };
}
