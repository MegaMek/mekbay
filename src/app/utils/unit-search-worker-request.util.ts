/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
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

import type { GameSystem } from '../models/common.model';
import type { Unit } from '../models/units.model';
import { filterStateToSemanticText } from './semantic-filter.util';
import type { UnitSearchWorkerCorpusSnapshot, UnitSearchWorkerIndexSnapshot, UnitSearchWorkerQueryRequest } from './unit-search-worker-protocol.util';
import type { FilterState } from '../services/unit-search-filters.model';

interface UnitSearchWorkerCorpusCache {
    version: string | null;
    snapshot: UnitSearchWorkerCorpusSnapshot | null;
}

interface BuildWorkerExecutionQueryArgs {
    effectiveFilterState: FilterState;
    effectiveTextSearch: string;
    gameSystem: GameSystem;
    totalRangesCache: Record<string, [number, number]>;
}

interface BuildWorkerSearchRequestArgs {
    revision: number;
    corpusVersion: string;
    executionQuery: string;
    telemetryQuery: string;
    gameSystem: GameSystem;
    sortKey: string;
    sortDirection: 'asc' | 'desc';
    bvPvLimit: number;
    forceTotalBvPv: number;
    pilotGunnerySkill: number;
    pilotPilotingSkill: number;
}

export function getWorkerCorpusVersion(searchCorpusVersion: string | number, tagsVersion: number): string {
    return `${searchCorpusVersion}:${tagsVersion}`;
}

export function getWorkerCorpusSnapshot(
    cache: UnitSearchWorkerCorpusCache,
    corpusVersion: string,
    units: Unit[],
    indexes: UnitSearchWorkerIndexSnapshot,
): { snapshot: UnitSearchWorkerCorpusSnapshot; cache: UnitSearchWorkerCorpusCache } {
    if (cache.snapshot && cache.version === corpusVersion) {
        return { snapshot: cache.snapshot, cache };
    }

    const snapshot: UnitSearchWorkerCorpusSnapshot = {
        corpusVersion,
        units,
        indexes,
    };

    return {
        snapshot,
        cache: {
            version: corpusVersion,
            snapshot,
        },
    };
}

export function buildWorkerExecutionQuery({
    effectiveFilterState,
    effectiveTextSearch,
    gameSystem,
    totalRangesCache,
}: BuildWorkerExecutionQueryArgs): string {
    return filterStateToSemanticText(
        effectiveFilterState,
        effectiveTextSearch,
        gameSystem,
        totalRangesCache,
    ).trim();
}

export function buildWorkerSearchRequest(args: BuildWorkerSearchRequestArgs): UnitSearchWorkerQueryRequest {
    return {
        revision: args.revision,
        corpusVersion: args.corpusVersion,
        executionQuery: args.executionQuery,
        telemetryQuery: args.telemetryQuery,
        gameSystem: args.gameSystem,
        sortKey: args.sortKey,
        sortDirection: args.sortDirection,
        bvPvLimit: args.bvPvLimit,
        forceTotalBvPv: args.forceTotalBvPv,
        pilotGunnerySkill: args.pilotGunnerySkill,
        pilotPilotingSkill: args.pilotPilotingSkill,
    };
}