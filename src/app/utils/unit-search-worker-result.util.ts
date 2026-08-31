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
    normalizationMatchesByUnitUuid: ReadonlyMap<string, UnitSearchNormalizationMatch>;
}

export function hydrateWorkerSearchResult(
    result: UnitSearchWorkerResultMessage,
    getUnitByUuid: (unitUuid: string) => UnitSummary | undefined,
): HydratedWorkerSearchResult {
    const units: UnitSummary[] = [];
    const normalizationMatchesByUnitUuid = new Map<string, UnitSearchNormalizationMatch>();
    const seenUnitUuids = new Set<string>();

    for (const entry of result.entries) {
        if (seenUnitUuids.has(entry.unitUuid)) {
            continue;
        }
        const unit = getUnitByUuid(entry.unitUuid);
        if (!unit) {
            continue;
        }

        seenUnitUuids.add(entry.unitUuid);
        units.push(unit);
        if (entry.match) {
            normalizationMatchesByUnitUuid.set(entry.unitUuid, entry.match);
        }
    }

    return { units, normalizationMatchesByUnitUuid };
}

export function hydrateWorkerResultUnits(
    result: UnitSearchWorkerResultMessage,
    getUnitByUuid: (unitUuid: string) => UnitSummary | undefined,
): UnitSummary[] {
    return hydrateWorkerSearchResult(result, getUnitByUuid).units;
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
