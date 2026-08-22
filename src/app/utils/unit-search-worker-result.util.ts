// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { GameSystem } from '../models/common.model';
import type { UnitSearchNormalizationMatch } from '../models/unit-search-result.model';
import type { UnitSummary } from '../models/unit-summary.model';
import type { SearchTelemetrySnapshot } from '../services/unit-search-filters.model';
import type { UnitSearchWorkerResultMessage } from './unit-search-worker-protocol.util';

interface WorkerResultTelemetryContext {
    timestamp: number;
    gameSystem: GameSystem;
    sortKey: string;
    sortDirection: 'asc' | 'desc';
    resultCount: number;
    stages?: SearchTelemetrySnapshot['stages'];
    totalMs?: number;
}

export interface HydratedWorkerSearchResult {
    units: UnitSummary[];
    normalizationMatchesByUnitName: ReadonlyMap<string, UnitSearchNormalizationMatch>;
}

export function hydrateWorkerSearchResult(
    result: UnitSearchWorkerResultMessage,
    getUnitByName: (unitName: string) => UnitSummary | undefined,
): HydratedWorkerSearchResult {
    const units: UnitSummary[] = [];
    const normalizationMatchesByUnitName = new Map<string, UnitSearchNormalizationMatch>();
    const seenUnitNames = new Set<string>();

    for (const entry of result.entries) {
        if (seenUnitNames.has(entry.unitName)) {
            continue;
        }
        const unit = getUnitByName(entry.unitName);
        if (!unit) {
            continue;
        }

        seenUnitNames.add(entry.unitName);
        units.push(unit);
        if (entry.match) {
            normalizationMatchesByUnitName.set(entry.unitName, entry.match);
        }
    }

    return { units, normalizationMatchesByUnitName };
}

export function hydrateWorkerResultUnits(
    result: UnitSearchWorkerResultMessage,
    getUnitByName: (unitName: string) => UnitSummary | undefined,
): UnitSummary[] {
    return hydrateWorkerSearchResult(result, getUnitByName).units;
}

export function buildWorkerSearchTelemetrySnapshot(
    result: UnitSearchWorkerResultMessage,
    context: WorkerResultTelemetryContext,
): SearchTelemetrySnapshot {
    return {
        timestamp: context.timestamp,
        query: result.telemetryQuery,
        gameSystem: context.gameSystem,
        unitCount: result.unitCount,
        resultCount: context.resultCount,
        sortKey: context.sortKey,
        sortDirection: context.sortDirection,
        isComplex: result.isComplex,
        stages: context.stages ?? result.stages,
        totalMs: context.totalMs ?? result.totalMs,
    };
}