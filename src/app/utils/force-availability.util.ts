// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Era } from '../models/eras.model';
import type { Faction } from '../models/factions.model';
import type { AvailabilitySource } from '../models/options.model';
import type { UnitSummary } from '../models/unit-summary.model';

export type ForceAvailabilityKey = string;

export interface ForceAvailabilityContext {
    source: AvailabilitySource;
    getUnitKey(unit: Pick<UnitSummary, 'id' | 'name'>): ForceAvailabilityKey;
    getVisibleEraUnitIds(era: Era): ReadonlySet<ForceAvailabilityKey>;
    getFactionUnitIds(faction: Faction, contextEraIds?: ReadonlySet<number>): ReadonlySet<ForceAvailabilityKey>;
    getFactionEraUnitIds(faction: Faction, era: Era): ReadonlySet<ForceAvailabilityKey>;
}

function normalizeMembershipUnitIds(unitIds: number[] | Set<number> | undefined): Set<ForceAvailabilityKey> {
    if (!unitIds) {
        return new Set<ForceAvailabilityKey>();
    }

    if (unitIds instanceof Set) {
        return new Set(Array.from(unitIds, (unitId) => String(unitId)));
    }

    return new Set(unitIds.map((unitId) => String(unitId)));
}

const MUL_FORCE_AVAILABILITY_CONTEXT: ForceAvailabilityContext = {
    source: 'mul',
    getUnitKey(unit: Pick<UnitSummary, 'id' | 'name'>): ForceAvailabilityKey {
        return String(unit.id);
    },
    getVisibleEraUnitIds(era: Era): ReadonlySet<ForceAvailabilityKey> {
        return normalizeMembershipUnitIds(era.units as number[] | Set<number> | undefined);
    },
    getFactionUnitIds(faction: Faction, contextEraIds?: ReadonlySet<number>): ReadonlySet<ForceAvailabilityKey> {
        const unitIds = new Set<ForceAvailabilityKey>();

        for (const [eraIdText, eraUnitIds] of Object.entries(faction.eras)) {
            const eraId = Number(eraIdText);
            if (contextEraIds && !contextEraIds.has(eraId)) {
                continue;
            }

            for (const unitId of normalizeMembershipUnitIds(eraUnitIds)) {
                unitIds.add(unitId);
            }
        }

        return unitIds;
    },
    getFactionEraUnitIds(faction: Faction, era: Era): ReadonlySet<ForceAvailabilityKey> {
        return normalizeMembershipUnitIds(faction.eras[era.id] as number[] | Set<number> | undefined);
    },
};

export function createMulForceAvailabilityContext(): ForceAvailabilityContext {
    return MUL_FORCE_AVAILABILITY_CONTEXT;
}
