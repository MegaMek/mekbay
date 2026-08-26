// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  approx,
  type TechAdvancement,
  type TechRatingSource,
} from '../types';

/** MegaMek's canonical technology record for Standard internal structure. */
const STANDARD_STRUCTURE_TECH = {
  techBase: 'All',
  rating: 'D',
  availability: ['C', 'C', 'C', 'C'],
  level: 'Introductory',
  dates: { prototype: approx(2430), production: 2439, common: 2505 },
} as const satisfies TechAdvancement;

/**
 * Resolve structure technology from immutable definition facts. Standard
 * structure owns a rules-defined record; every other type uses its catalog
 * record. Both mutable and published adapters share this kernel.
 */
export function structureTechAdvancement(
  structureTypeId: number,
  catalogTech: TechRatingSource,
): TechRatingSource {
  return structureTypeId === 0 ? STANDARD_STRUCTURE_TECH : catalogTech;
}
