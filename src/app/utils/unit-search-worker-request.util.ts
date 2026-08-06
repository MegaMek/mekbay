// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { GameSystem } from '../models/common.model';
import type { UnitSearchNormalization } from '../models/unit-search-result.model';
import type { Unit } from '../models/units.model';
import { filterStateToSemanticText } from './semantic-filter.util';
import type {
    UnitSearchWorkerCorpusSnapshot,
    UnitSearchWorkerFactionEraSnapshot,
    UnitSearchWorkerIndexSnapshot,
    UnitSearchWorkerQueryRequest,
} from './unit-search-worker-protocol.util';
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
    normalization: UnitSearchNormalization | null;
}

const SEMANTIC_TEXT_ESCAPE_PATTERN = /([()=><!"'&\\])/g;

function escapePlainTextForWorkerExecutionQuery(text: string): string {
    return text.replace(SEMANTIC_TEXT_ESCAPE_PATTERN, '\\$1');
}

export function getWorkerCorpusVersion(searchCorpusVersion: string | number, tagsVersion: number): string {
    return `${searchCorpusVersion}:${tagsVersion}`;
}

export function getWorkerCorpusSnapshot(
    cache: UnitSearchWorkerCorpusCache,
    corpusVersion: string,
    units: Unit[],
    indexes: UnitSearchWorkerIndexSnapshot,
    factionEraIndex: UnitSearchWorkerFactionEraSnapshot,
): { snapshot: UnitSearchWorkerCorpusSnapshot; cache: UnitSearchWorkerCorpusCache } {
    if (cache.snapshot && cache.version === corpusVersion) {
        return { snapshot: cache.snapshot, cache };
    }

    const snapshot: UnitSearchWorkerCorpusSnapshot = {
        corpusVersion,
        units,
        indexes,
        factionEraIndex,
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
        escapePlainTextForWorkerExecutionQuery(effectiveTextSearch),
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
        normalization: args.normalization,
    };
}