// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Era } from '../models/eras.model';
import type { Faction } from '../models/factions.model';
import type { AvailabilitySource } from '../models/options.model';
import type { UnitSummary } from '../models/unit-summary.model';
import type { MulAvailabilityIndex } from './mul-availability-index';

export type ForceAvailabilityKey = string;

export interface ForceAvailabilityContext {
    source: AvailabilitySource;
    getUnitKey(unit: Pick<UnitSummary, 'uuid' | 'name'>): ForceAvailabilityKey;
    getVisibleEraUnitIds(era: Era): ReadonlySet<ForceAvailabilityKey>;
    getFactionUnitIds(faction: Faction, contextEraIds?: ReadonlySet<number>): ReadonlySet<ForceAvailabilityKey>;
    getFactionEraUnitIds(faction: Faction, era: Era): ReadonlySet<ForceAvailabilityKey>;
    factionExistsInEra?(faction: Faction, era: Era): boolean;
}

export function createMulForceAvailabilityContext(
    index: MulAvailabilityIndex,
    units?: readonly Pick<UnitSummary, 'uuid'>[],
): ForceAvailabilityContext {
    const unitUuids = units && [...new Set(units.map(unit => unit.uuid))];
    const scoped = (members: ReadonlySet<UnitSummary['uuid']>): ReadonlySet<UnitSummary['uuid']> => (
        unitUuids ? new Set(unitUuids.filter(uuid => members.has(uuid))) : members
    );
    return {
        source: 'mul',
        getUnitKey: unit => unit.uuid,
        getVisibleEraUnitIds: era => scoped(index.getEraUnitUuids(era.id)),
        getFactionUnitIds: (faction, eraIds) => scoped(index.getFactionUnitUuids(faction.id, eraIds)),
        getFactionEraUnitIds: (faction, era) => scoped(index.getFactionEraUnitUuids(faction.id, era.id)),
        factionExistsInEra: (faction, era) => index.factionExistsInEra(faction.id, era.id),
    };
}
