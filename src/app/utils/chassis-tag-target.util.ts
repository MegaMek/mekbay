// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary } from '../models/unit-summary.model';
import { TagsService } from '../services/tags.service';

export function getChassisTagTargetUnits(units: UnitSummary[], allUnits: UnitSummary[]): UnitSummary[] {
    const chassisKeys = new Set(units.map(unit => TagsService.getChassisTagKey(unit)));
    const unitsByKey = new Map<string, UnitSummary>();

    for (const unit of allUnits) {
        if (chassisKeys.has(TagsService.getChassisTagKey(unit))) {
            unitsByKey.set(TagsService.getUnitTagKey(unit), unit);
        }
    }

    for (const unit of units) {
        unitsByKey.set(TagsService.getUnitTagKey(unit), unit);
    }

    return Array.from(unitsByKey.values());
}
