// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { ArmorData } from '../../equipment.model';

const SPHEROID_THRESHOLDS = [12500, 20000, 35000, 50000, 65000] as const;
const AERODYNE_THRESHOLDS = [6000, 9500, 12500, 17500, 25000] as const;
const CAPITAL_THRESHOLDS = [150000, 250000] as const;

export function smallCraftArmorPointsPerTon(
  tonnage: number,
  spheroid: boolean,
  armor: Pick<ArmorData, 'pptMultiplier' | 'pptDropship'>,
): number {
  return armorPointsPerTon(
    tonnage,
    armor.pptMultiplier,
    armor.pptDropship,
    spheroid ? SPHEROID_THRESHOLDS : AERODYNE_THRESHOLDS,
  );
}

export function capitalCraftArmorPointsPerTon(
  tonnage: number,
  armor: Pick<ArmorData, 'pptMultiplier' | 'pptCapital'>,
): number {
  return armorPointsPerTon(tonnage, armor.pptMultiplier, armor.pptCapital, CAPITAL_THRESHOLDS);
}

function armorPointsPerTon(
  tonnage: number,
  multiplier: number,
  values: readonly number[],
  thresholds: readonly number[],
): number {
  if (values.length <= thresholds.length) return 16 * multiplier;
  const index = thresholds.findIndex(threshold => tonnage < threshold);
  return values[index < 0 ? values.length - 1 : index]!;
}
