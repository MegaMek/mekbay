// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Unit } from '../models/units.model';
import { TagsService } from '../services/tags.service';

export function getChassisTagTargetUnits(units: Unit[], allUnits: Unit[]): Unit[] {
    const chassisKeys = new Set(units.map(unit => TagsService.getChassisTagKey(unit)));
    const unitsByName = new Map<string, Unit>();

    for (const unit of allUnits) {
        if (chassisKeys.has(TagsService.getChassisTagKey(unit))) {
            unitsByName.set(unit.name, unit);
        }
    }

    for (const unit of units) {
        unitsByName.set(unit.name, unit);
    }

    return Array.from(unitsByName.values());
}
