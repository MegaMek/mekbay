// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { GameSystem } from '../models/common.model';
import type { UnitSearchNormalization } from '../models/unit-search-result.model';
import type { UnitSummary } from '../models/unit-summary.model';
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
    /** Original committed clauses; preserving these avoids flattening repeated constraints. */
    semanticTokenTexts?: readonly string[];
    /** Raw grouped query to preserve before applying UI-only filters. */
    preservedQuery?: string;
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
    units: UnitSummary[],
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
    semanticTokenTexts = [],
    preservedQuery,
    gameSystem,
    totalRangesCache,
}: BuildWorkerExecutionQueryArgs): string {
    const groupedQuery = preservedQuery?.trim();
    const uiFilterText = filterStateToSemanticText(
        effectiveFilterState,
        groupedQuery ? '' : escapePlainTextForWorkerExecutionQuery(effectiveTextSearch),
        gameSystem,
        totalRangesCache,
    ).trim();

    if (groupedQuery) {
        return uiFilterText ? `(${groupedQuery}) ${uiFilterText}` : groupedQuery;
    }

    return [uiFilterText, ...semanticTokenTexts]
        .map(part => part.trim())
        .filter(Boolean)
        .join(' ');
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
