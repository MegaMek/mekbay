// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

const TROOP_FACTORS = [
  0, 0, 1, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 8, 9, 9,
  10, 10, 11, 11, 12, 13, 14, 15, 16, 16, 17, 17, 17, 18, 18,
] as const;

/** Alpha Strike conventional-infantry troop factor, capped at 30 troopers. */
export function alphaStrikeTroopFactor(strength: number): number {
  if (!Number.isInteger(strength) || strength < 0) {
    throw new RangeError('Troop strength must be a nonnegative integer');
  }
  return TROOP_FACTORS[Math.min(strength, 30)];
}