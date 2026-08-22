// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary } from "./unit-summary.model";

export type TechBase = 'Inner Sphere' | 'Clan';
export type TechBaseAvailability = 'IS' | 'Clan' | 'All';

export type UnitTechBaseDisplay = TechBase | `Mixed (${TechBase})`;

export function getUnitTechBaseDisplay(unit: Pick<UnitSummary, 'techBase' | 'mixed'>): UnitTechBaseDisplay {
    return unit.mixed ? `Mixed (${unit.techBase})` : unit.techBase;
}


export function getUnitsAverageTechBase(units: UnitSummary[]): TechBase {
    const counts: Partial<Record<TechBase, number>> = {};
    for (const unit of units) {
        if (unit.mixed) {
            counts['Clan'] = (counts['Clan'] || 0) + 1;
            counts['Inner Sphere'] = (counts['Inner Sphere'] || 0) + 1;
        } else {
            counts[unit.techBase] = (counts[unit.techBase] || 0) + 1;
        }
    }
    let majority: TechBase = 'Inner Sphere';
    let max = 0;
    // Mixed is expanded to both
    for (const tb of ['Inner Sphere', 'Clan'] as const) {
        const count = counts[tb] ?? 0;
        if (count > max) {
            majority = tb;
            max = count;
        }
    }
    return majority;
}