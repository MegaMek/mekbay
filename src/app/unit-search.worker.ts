// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/// <reference lib="webworker" />

import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from './models/crew.model';
import { getForcePacks } from './models/forcepacks.model';
import {
    ADVANCED_FILTERS,
    type AvailabilityFilterScope,
    type SearchTelemetryStage,
} from './services/unit-search-filters.model';
import { BVCalculatorUtil } from './utils/bv-calculator.util';
import { parseSemanticQueryAST } from './utils/semantic-filter-ast.util';
import { adjustPointValueForSkill } from './utils/pv-skill-adjustment.util';
import { parseSearchQuery } from './utils/search.util';
import { executeUnitSearch } from './utils/unit-search-executor.util';
import { getNowMs } from './utils/unit-search-shared.util';
import {
    createMulFactionEraSearchIndex,
    getMulFactionEraUnitUuids,
    type MulFactionEraSearchIndex,
} from './utils/mul-faction-era-search-index.util';
import type {
    UnitSearchWorkerCorpusSnapshot,
    UnitSearchWorkerErrorMessage,
    UnitSearchWorkerIndexSnapshot,
    UnitSearchWorkerQueryRequest,
    UnitSearchWorkerRequestMessage,
    UnitSearchWorkerResponseMessage,
    UnitSearchWorkerResultMessage,
    UnitSearchWorkerUnit,
} from './utils/unit-search-worker-protocol.util';
import { getUnitVariantGroupKey } from './utils/unit-variant.util';
import { buildASSpecialsByUnitIndex, type ParsedASSpecials } from './utils/as-special-filter.util';
import type { UnitUuid } from './services/unit-catalog/unit-catalog.types';

interface WorkerCorpusRuntime extends MulFactionEraSearchIndex {
    corpusVersion: string;
    units: UnitSearchWorkerUnit[];
    allUnitUuids: ReadonlySet<UnitUuid>;
    indexedUnitUuids: Map<string, Map<string, ReadonlySet<UnitUuid>>>;
    indexedFilterValues: Map<string, string[]>;
    indexedASSpecials: Map<UnitUuid, ParsedASSpecials>;
    forcePackToLookupKey: Map<string, Set<string>>;
}

let corpus: WorkerCorpusRuntime | null = null;
const workerDisplayNameFns = new Map(
    ADVANCED_FILTERS
        .filter(filter => typeof filter.displayNameFn === 'function')
        .map(filter => [filter.key, filter.displayNameFn!])
);

function getUnitNameKey(name: string): string {
    return name.toLowerCase();
}

function buildIndexedUnitUuids(indexes: UnitSearchWorkerIndexSnapshot): Map<string, Map<string, ReadonlySet<UnitUuid>>> {
    const result = new Map<string, Map<string, ReadonlySet<UnitUuid>>>();

    for (const [filterKey, valueMap] of Object.entries(indexes)) {
        const filterIndex = new Map<string, ReadonlySet<UnitUuid>>();
        for (const [value, unitUuids] of Object.entries(valueMap)) {
            filterIndex.set(value, new Set(unitUuids));
        }
        result.set(filterKey, filterIndex);
    }

    return result;
}

function buildIndexedFilterValues(indexes: UnitSearchWorkerIndexSnapshot): Map<string, string[]> {
    const result = new Map<string, string[]>();

    for (const [filterKey, valueMap] of Object.entries(indexes)) {
        result.set(filterKey, Object.keys(valueMap));
    }

    return result;
}

function addUnitUuids(target: Set<UnitUuid>, source: ReadonlySet<UnitUuid> | undefined): void {
    if (!source || source.size === 0) {
        return;
    }

    for (const unitUuid of source) {
        target.add(unitUuid);
    }
}

function buildForcePackIndex(units: UnitSearchWorkerUnit[]): Map<string, Set<string>> {
    const unitsByName = new Map(units.map(unit => [getUnitNameKey(unit.name), unit]));
    const result = new Map<string, Set<string>>();

    for (const pack of getForcePacks()) {
        const lookupKeys = new Set<string>();
        const addPackUnits = (packUnits: Array<{ name: string }>) => {
            for (const packUnit of packUnits) {
                const unit = unitsByName.get(getUnitNameKey(packUnit.name));
                if (unit) {
                    lookupKeys.add(getUnitVariantGroupKey(unit));
                }
            }
        };

        addPackUnits(pack.units);
        for (const variant of pack.variants ?? []) {
            addPackUnits(variant.units);
        }
        result.set(pack.name, lookupKeys);
    }

    return result;
}

function hydrateCorpus(
    snapshot: UnitSearchWorkerCorpusSnapshot,
    onProgress: (completed: number, detail: string) => void = () => undefined,
): WorkerCorpusRuntime {
    const units = snapshot.units;
    const allUnitUuids = new Set(units.map(unit => unit.uuid));
    const forcePackToLookupKey = buildForcePackIndex(units);
    onProgress(1, `Loaded ${units.length.toLocaleString()} compact unit search records`);

    const indexedUnitUuids = buildIndexedUnitUuids(snapshot.indexes);
    const indexedFilterValues = buildIndexedFilterValues(snapshot.indexes);
    onProgress(2, 'Hydrated unit filter indexes');

    const factionEraSearchIndex = createMulFactionEraSearchIndex(snapshot.factionEraIndex);
    onProgress(3, 'Hydrated faction and era memberships');

    return {
        corpusVersion: snapshot.corpusVersion,
        units,
        allUnitUuids,
        indexedUnitUuids,
        indexedFilterValues,
        indexedASSpecials: buildASSpecialsByUnitIndex(
            units,
            unit => unit.uuid,
            unit => unit.as?.specials,
        ),
        ...factionEraSearchIndex,
        forcePackToLookupKey,
    };
}

export const __test__ = {
    hydrateCorpus,
    buildResultMessage,
};

function buildResultMessage(runtime: WorkerCorpusRuntime, request: UnitSearchWorkerQueryRequest): UnitSearchWorkerResultMessage {
    const parseStartedAt = getNowMs();
    const parsedQuery = parseSemanticQueryAST(request.executionQuery, request.gameSystem);
    const parseDurationMs = getNowMs() - parseStartedAt;

    const getFactionEraUnitUuids = (eraName: string, factionNames: readonly string[]): ReadonlySet<UnitUuid> => {
        return getMulFactionEraUnitUuids(runtime, [eraName], factionNames);
    };

    const getMembershipUnitUuids = (scope?: AvailabilityFilterScope): ReadonlySet<UnitUuid> => {
        const unitUuids = new Set<UnitUuid>();

        if (scope?.eraNames !== undefined && scope.factionNames !== undefined) {
            for (const eraName of scope.eraNames) {
                addUnitUuids(unitUuids, getFactionEraUnitUuids(eraName, scope.factionNames));
            }

            return unitUuids;
        }

        if (scope?.eraNames !== undefined) {
            for (const eraName of scope.eraNames) {
                addUnitUuids(unitUuids, runtime.indexedUnitUuids.get('era')?.get(eraName));
            }

            return unitUuids;
        }

        if (scope?.factionNames !== undefined) {
            for (const factionName of scope.factionNames) {
                addUnitUuids(unitUuids, runtime.indexedUnitUuids.get('faction')?.get(factionName));
            }

            return unitUuids;
        }

        addUnitUuids(unitUuids, runtime.allUnitUuids);

        return unitUuids;
    };

    const getScopedEraUnitUuids = (
        eraName: string,
        scope?: AvailabilityFilterScope,
    ): ReadonlySet<UnitUuid> => {
        return getMembershipUnitUuids(
            scope?.factionNames === undefined
                ? { eraNames: [eraName] }
                : { eraNames: [eraName], factionNames: scope.factionNames },
        );
    };

    const getScopedFactionUnitUuids = (
        factionName: string,
        eraNames?: readonly string[],
    ): ReadonlySet<UnitUuid> => {
        return getMembershipUnitUuids(
            eraNames === undefined
                ? { factionNames: [factionName] }
                : { eraNames: [...eraNames], factionNames: [factionName] },
        );
    };

    const getEraFilterValues = (): string[] => {
        return [...(runtime.indexedFilterValues.get('era') ?? [])];
    };

    const getFactionFilterValues = (): string[] => {
        return [...(runtime.indexedFilterValues.get('faction') ?? [])];
    };

    const getIndexedUnitIds = (
        filterKey: string,
        value: string,
        scope?: AvailabilityFilterScope,
    ): ReadonlySet<UnitUuid> | undefined => {
        if (filterKey === 'era') {
            return getScopedEraUnitUuids(value, scope);
        }

        if (filterKey === 'faction') {
            return getScopedFactionUnitUuids(value, scope?.eraNames);
        }

        return runtime.indexedUnitUuids.get(filterKey)?.get(value);
    };

    const getIndexedFilterValues = (filterKey: string): readonly string[] => {
        if (filterKey === 'era') {
            return getEraFilterValues();
        }

        if (filterKey === 'faction') {
            return getFactionFilterValues();
        }

        return runtime.indexedFilterValues.get(filterKey) ?? [];
    };

    const execution = executeUnitSearch({
        units: runtime.units,
        parsedQuery,
        searchTokens: parseSearchQuery(parsedQuery.textSearch),
        gameSystem: request.gameSystem,
        sortKey: request.sortKey,
        sortDirection: request.sortDirection,
        bvPvLimit: request.bvPvLimit,
        forceTotalBvPv: request.forceTotalBvPv,
        normalization: request.normalization,
        getAdjustedBV: (unit: UnitSearchWorkerUnit) => {
            const gunnery = request.pilotGunnerySkill;
            const piloting = request.pilotPilotingSkill;
            return BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, gunnery, piloting);
        },
        getAdjustedPV: (unit: UnitSearchWorkerUnit) => {
            if (request.pilotGunnerySkill === DEFAULT_GUNNERY_SKILL) {
                return unit.as.PV;
            }
            return adjustPointValueForSkill(unit.as.PV, request.pilotGunnerySkill);
        },
        unitBelongsToEra: (unit: UnitSearchWorkerUnit, eraName: string, scope?: AvailabilityFilterScope) => getScopedEraUnitUuids(eraName, scope).has(unit.uuid),
        unitBelongsToFaction: (unit: UnitSearchWorkerUnit, factionName: string, eraNames?: readonly string[]) => getScopedFactionUnitUuids(factionName, eraNames).has(unit.uuid),
        unitBelongsToForcePack: (unit: UnitSearchWorkerUnit, packName: string) => runtime.forcePackToLookupKey.get(packName)?.has(getUnitVariantGroupKey(unit)) ?? false,
        getAllEraNames: getEraFilterValues,
        getAllFactionNames: getFactionFilterValues,
        getDisplayName: (filterKey: string, value: string) => workerDisplayNameFns.get(filterKey)?.(value),
        getIndexedUnitIds,
        getIndexedFilterValues,
        getIndexedASSpecials: unitUuid => runtime.indexedASSpecials.get(unitUuid),
    });

    const parseStage: SearchTelemetryStage = {
        name: 'parse-query',
        durationMs: parseDurationMs,
        inputCount: runtime.units.length,
    };

    return {
        type: 'result',
        revision: request.revision,
        corpusVersion: runtime.corpusVersion,
        telemetryQuery: request.telemetryQuery,
        entries: execution.results.map(unit => {
            const match = execution.normalizationMatchesByUnitUuid.get(unit.uuid);
            return match ? { unitUuid: unit.uuid, match } : { unitUuid: unit.uuid };
        }),
        stages: [parseStage, ...execution.telemetryStages],
        totalMs: parseDurationMs + execution.totalMs,
        unitCount: execution.unitCount,
        isComplex: execution.isComplex,
    };
}

function postError(message: string, revision?: number, corpusVersion?: string): void {
    const error: UnitSearchWorkerErrorMessage = {
        type: 'error',
        revision,
        corpusVersion,
        message,
    };
    postMessage(error satisfies UnitSearchWorkerResponseMessage);
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
    addEventListener('message', ({ data }: MessageEvent<UnitSearchWorkerRequestMessage>) => {
        try {
            if (data.type === 'init') {
                corpus = hydrateCorpus(data.snapshot, (completed, detail) => {
                    postMessage({
                        type: 'progress',
                        corpusVersion: data.snapshot.corpusVersion,
                        completed,
                        total: 4,
                        detail,
                    } satisfies UnitSearchWorkerResponseMessage);
                });
                postMessage({
                    type: 'ready',
                    corpusVersion: data.snapshot.corpusVersion,
                } satisfies UnitSearchWorkerResponseMessage);
                return;
            }

            if (!corpus || corpus.corpusVersion !== data.request.corpusVersion) {
                postError('Search worker corpus is not ready for this request', data.request.revision, data.request.corpusVersion);
                return;
            }

            postMessage(buildResultMessage(corpus, data.request) satisfies UnitSearchWorkerResponseMessage);
        } catch (error) {
            const request = data.type === 'execute' ? data.request : undefined;
            postError(error instanceof Error ? error.message : 'Search worker failed', request?.revision, request?.corpusVersion);
        }
    });
}
