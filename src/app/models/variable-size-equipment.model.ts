// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Equipment } from './equipment.model';

/** Catalog marker for equipment whose authored mount size carries rule meaning. */
export function isVariableSizeEquipment(equipment: Equipment | null | undefined): boolean {
  return equipment?.hasFlag('F_VARIABLE_SIZE') === true;
}
