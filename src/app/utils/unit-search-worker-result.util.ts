// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { GameSystem } from '../models/common.model';
import type { UnitSearchNormalizationMatch } from '../models/unit-search-result.model';
import type { UnitSummary } from '../models/unit-summary.model';
import type { SearchTelemetrySnapshot } from '../services/unit-search-filters.model';
import type { UnitProviderId } from '../services/unit-catalog/unit-catalog.types';
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
    normalizationMatchesByUnit: ReadonlyMap<UnitSummary, UnitSearchNormalizationMatch>;
}

export function hydrateWorkerSearchResult(
    result: UnitSearchWorkerResultMessage,
    getUnitByIdentity: (provider: UnitProviderId, uuid: string) => UnitSummary | undefined,
): HydratedWorkerSearchResult {
    const units: UnitSummary[] = [];
    const normalizationMatchesByUnit = new Map<UnitSummary, UnitSearchNormalizationMatch>();
    const seenIdentities = new Set<string>();

    for (const entry of result.entries) {
        const identityKey = `${entry.provider.length}:${entry.provider}${entry.uuid.length}:${entry.uuid}`;
        if (seenIdentities.has(identityKey)) {
            continue;
        }
        const unit = getUnitByIdentity(entry.provider, entry.uuid);
        if (!unit || unit.name !== entry.unitName) {
            continue;
        }

        seenIdentities.add(identityKey);
        units.push(unit);
        if (entry.match) {
            normalizationMatchesByUnit.set(unit, entry.match);
        }
    }

    return { units, normalizationMatchesByUnit };
}

export function hydrateWorkerResultUnits(
    result: UnitSearchWorkerResultMessage,
    getUnitByIdentity: (provider: UnitProviderId, uuid: string) => UnitSummary | undefined,
): UnitSummary[] {
    return hydrateWorkerSearchResult(result, getUnitByIdentity).units;
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
