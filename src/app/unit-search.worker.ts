// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/// <reference lib="webworker" />

import type { UnitSummary } from './models/unit-summary.model';
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
import { getNowMs, getUnitSearchIdentityKey } from './utils/unit-search-shared.util';
import {
    createMulFactionEraSearchIndex,
    getMulFactionEraUnitIdentityKeys,
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
} from './utils/unit-search-worker-protocol.util';
import { getUnitVariantGroupKey } from './utils/unit-variant.util';
import {
    MM_DATA_UNIT_PROVIDER_ID,
    type UnitProviderId,
} from './services/unit-catalog/unit-catalog.types';

interface WorkerCorpusRuntime extends MulFactionEraSearchIndex {
    corpusVersion: string;
    units: UnitSummary[];
    allUnitIdentityKeys: ReadonlySet<string>;
    indexedUnitIds: Map<string, Map<string, ReadonlySet<string>>>;
    indexedFilterValues: Map<string, string[]>;
    forcePackToLookupKey: Map<string, Set<string>>;
}

type CatalogIdentityUnit = UnitSummary & { readonly provider?: UnitProviderId };

let corpus: WorkerCorpusRuntime | null = null;
const workerDisplayNameFns = new Map(
    ADVANCED_FILTERS
        .filter(filter => typeof filter.displayNameFn === 'function')
        .map(filter => [filter.key, filter.displayNameFn!])
);

function getUnitNameKey(name: string): string {
    return name.toLowerCase();
}

function getUnitProvider(unit: UnitSummary): UnitProviderId {
    return (unit as CatalogIdentityUnit).provider ?? MM_DATA_UNIT_PROVIDER_ID;
}

function buildIndexedUnitIds(indexes: UnitSearchWorkerIndexSnapshot): Map<string, Map<string, ReadonlySet<string>>> {
    const result = new Map<string, Map<string, ReadonlySet<string>>>();

    for (const [filterKey, valueMap] of Object.entries(indexes)) {
        const filterIndex = new Map<string, ReadonlySet<string>>();
        for (const [value, unitIdentityKeys] of Object.entries(valueMap)) {
            filterIndex.set(value, new Set(unitIdentityKeys));
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

function addUnitIdentityKeys(target: Set<string>, source: ReadonlySet<string> | undefined): void {
    if (!source || source.size === 0) {
        return;
    }

    for (const unitIdentityKey of source) {
        target.add(unitIdentityKey);
    }
}

function buildForcePackIndex(units: UnitSummary[]): Map<string, Set<string>> {
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
    const units = snapshot.units as unknown as UnitSummary[];
    const allUnitIdentityKeys = new Set(units.map(getUnitSearchIdentityKey));
    const forcePackToLookupKey = buildForcePackIndex(units);
    onProgress(1, `Loaded ${units.length.toLocaleString()} compact unit search records`);

    const indexedUnitIds = buildIndexedUnitIds(snapshot.indexes);
    const indexedFilterValues = buildIndexedFilterValues(snapshot.indexes);
    onProgress(2, 'Hydrated unit filter indexes');

    const factionEraSearchIndex = createMulFactionEraSearchIndex(snapshot.factionEraIndex);
    onProgress(3, 'Hydrated faction and era memberships');

    return {
        corpusVersion: snapshot.corpusVersion,
        units,
        allUnitIdentityKeys,
        indexedUnitIds,
        indexedFilterValues,
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

    const getFactionEraUnitIdentityKeys = (eraName: string, factionNames: readonly string[]): ReadonlySet<string> => {
        return getMulFactionEraUnitIdentityKeys(runtime, [eraName], factionNames);
    };

    const getMembershipUnitIdentityKeys = (scope?: AvailabilityFilterScope): ReadonlySet<string> => {
        const unitIdentityKeys = new Set<string>();

        if (scope?.eraNames !== undefined && scope.factionNames !== undefined) {
            for (const eraName of scope.eraNames) {
                addUnitIdentityKeys(unitIdentityKeys, getFactionEraUnitIdentityKeys(eraName, scope.factionNames));
            }

            return unitIdentityKeys;
        }

        if (scope?.eraNames !== undefined) {
            for (const eraName of scope.eraNames) {
                addUnitIdentityKeys(unitIdentityKeys, runtime.indexedUnitIds.get('era')?.get(eraName));
            }

            return unitIdentityKeys;
        }

        if (scope?.factionNames !== undefined) {
            for (const factionName of scope.factionNames) {
                addUnitIdentityKeys(unitIdentityKeys, runtime.indexedUnitIds.get('faction')?.get(factionName));
            }

            return unitIdentityKeys;
        }

        addUnitIdentityKeys(unitIdentityKeys, runtime.allUnitIdentityKeys);

        return unitIdentityKeys;
    };

    const getScopedEraUnitIdentityKeys = (
        eraName: string,
        scope?: AvailabilityFilterScope,
    ): ReadonlySet<string> => {
        return getMembershipUnitIdentityKeys(
            scope?.factionNames === undefined
                ? { eraNames: [eraName] }
                : { eraNames: [eraName], factionNames: scope.factionNames },
        );
    };

    const getScopedFactionUnitIdentityKeys = (
        factionName: string,
        eraNames?: readonly string[],
    ): ReadonlySet<string> => {
        return getMembershipUnitIdentityKeys(
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
    ): ReadonlySet<string> | undefined => {
        if (filterKey === 'era') {
            return getScopedEraUnitIdentityKeys(value, scope);
        }

        if (filterKey === 'faction') {
            return getScopedFactionUnitIdentityKeys(value, scope?.eraNames);
        }

        return runtime.indexedUnitIds.get(filterKey)?.get(value);
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
        getAdjustedBV: (unit: UnitSummary) => {
            const gunnery = request.pilotGunnerySkill;
            const piloting = request.pilotPilotingSkill;
            return BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, gunnery, piloting);
        },
        getAdjustedPV: (unit: UnitSummary) => {
            if (request.pilotGunnerySkill === DEFAULT_GUNNERY_SKILL) {
                return unit.as.PV;
            }
            return adjustPointValueForSkill(unit.as.PV, request.pilotGunnerySkill);
        },
        unitBelongsToEra: (unit: UnitSummary, eraName: string, scope?: AvailabilityFilterScope) => getScopedEraUnitIdentityKeys(eraName, scope).has(getUnitSearchIdentityKey(unit)),
        unitBelongsToFaction: (unit: UnitSummary, factionName: string, eraNames?: readonly string[]) => getScopedFactionUnitIdentityKeys(factionName, eraNames).has(getUnitSearchIdentityKey(unit)),
        unitBelongsToForcePack: (unit: UnitSummary, packName: string) => runtime.forcePackToLookupKey.get(packName)?.has(getUnitVariantGroupKey(unit)) ?? false,
        getAllEraNames: getEraFilterValues,
        getAllFactionNames: getFactionFilterValues,
        getDisplayName: (filterKey: string, value: string) => workerDisplayNameFns.get(filterKey)?.(value),
        getIndexedUnitIds,
        getIndexedFilterValues,
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
            const match = execution.normalizationMatchesByUnitIdentity.get(getUnitSearchIdentityKey(unit));
            const identity = {
                provider: getUnitProvider(unit),
                uuid: unit.uuid,
                unitName: unit.name,
            };
            return match ? { ...identity, match } : identity;
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
