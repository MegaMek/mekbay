/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import type { Era } from '../models/eras.model';
import type { Faction } from '../models/factions.model';
import type { AvailabilitySource } from '../models/options.model';
import type { Unit } from '../models/units.model';

export type ForceAvailabilityKey = string;

export interface ForceAvailabilityContext {
    source: AvailabilitySource;
    getUnitKey(unit: Pick<Unit, 'id' | 'name'>): ForceAvailabilityKey;
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
    getUnitKey(unit: Pick<Unit, 'id' | 'name'>): ForceAvailabilityKey {
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