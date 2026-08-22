// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { EntityTransporter } from '../models/entity/types/transport';
import { projectRecordSheetBays } from '../models/entity/bays/record-sheet-bay-projection';
import type { UnitSummary } from '../models/unit-summary.model';

type UnitCargo = NonNullable<UnitSummary['cargo']>;

function formatCapacity(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value);
}

export function buildUnitCargoMetadata(transporters: readonly EntityTransporter[]): UnitCargo | undefined {
  const groups = projectRecordSheetBays(transporters);
  if (groups.length === 0) return undefined;
  return groups.map(group => ({
    n: group.bayNumber,
    type: group.members.map(member => member.typeName).join('/'),
    capacity: group.members.map(member => formatCapacity(member.capacity)).join('/'),
    doors: group.doors,
  }));
}