// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/** Canonical MegaMek structure IDs shared by the equipment catalog and BLK files. */
export const STRUCTURE_TYPE = {
  STANDARD: 0,
  INDUSTRIAL: 1,
  ENDO_STEEL: 2,
  ENDO_STEEL_PROTOTYPE: 3,
  REINFORCED: 4,
  COMPOSITE: 5,
  ENDO_COMPOSITE: 6,
} as const;

export type StructureType = typeof STRUCTURE_TYPE[keyof typeof STRUCTURE_TYPE];
