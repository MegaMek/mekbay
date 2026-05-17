/// <reference lib="webworker" />

import type { Unit } from './models/units.model';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from './models/crew-member.model';
import { getForcePacks } from './models/forcepacks.model';
import {
    ADVANCED_FILTERS,
    type AvailabilityFilterScope,
    type SearchTelemetryStage,
} from './services/unit-search-filters.model';
import { BVCalculatorUtil } from './utils/bv-calculator.util';
import { getEffectivePilotingSkill } from './utils/cbt-common.util';
import { getForcePackLookupKey } from './utils/force-pack.util';
import { parseSemanticQueryAST } from './utils/semantic-filter-ast.util';
import { PVCalculatorUtil } from './utils/pv-calculator.util';
import { parseSearchQuery } from './utils/search.util';
import { executeUnitSearch } from './utils/unit-search-executor.util';
import { getNowMs } from './utils/unit-search-shared.util';
import type {
    UnitSearchWorkerCorpusSnapshot,
    UnitSearchWorkerErrorMessage,
    UnitSearchWorkerFactionEraSnapshot,
    UnitSearchWorkerIndexSnapshot,
    UnitSearchWorkerQueryRequest,
    UnitSearchWorkerRequestMessage,
    UnitSearchWorkerResponseMessage,
    UnitSearchWorkerResultMessage,
} from './utils/unit-search-worker-protocol.util';

interface WorkerCorpusRuntime {
    corpusVersion: string;
    units: Unit[];
    allUnitNames: ReadonlySet<string>;
    indexedUnitIds: Map<string, Map<string, ReadonlySet<string>>>;
    indexedFilterValues: Map<string, string[]>;
    factionEraUnitIds: Map<string, Map<string, ReadonlySet<string>>>;
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

function buildIndexedUnitIds(indexes: UnitSearchWorkerIndexSnapshot): Map<string, Map<string, ReadonlySet<string>>> {
    const result = new Map<string, Map<string, ReadonlySet<string>>>();

    for (const [filterKey, valueMap] of Object.entries(indexes)) {
        const filterIndex = new Map<string, ReadonlySet<string>>();
        for (const [value, unitNames] of Object.entries(valueMap)) {
            filterIndex.set(value, new Set(unitNames));
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

function buildFactionEraUnitIds(factionEraIndex: UnitSearchWorkerFactionEraSnapshot): Map<string, Map<string, ReadonlySet<string>>> {
    const result = new Map<string, Map<string, ReadonlySet<string>>>();

    for (const [eraName, factionMap] of Object.entries(factionEraIndex)) {
        const eraIndex = new Map<string, ReadonlySet<string>>();
        for (const [factionName, unitNames] of Object.entries(factionMap)) {
            eraIndex.set(factionName, new Set(unitNames));
        }
        result.set(eraName, eraIndex);
    }

    return result;
}

function addUnitNames(target: Set<string>, source: ReadonlySet<string> | undefined): void {
    if (!source || source.size === 0) {
        return;
    }

    for (const unitName of source) {
        target.add(unitName);
    }
}

function buildForcePackIndex(units: Unit[]): Map<string, Set<string>> {
    const unitsByName = new Map(units.map(unit => [getUnitNameKey(unit.name), unit]));
    const result = new Map<string, Set<string>>();

    for (const pack of getForcePacks()) {
        const lookupKeys = new Set<string>();
        const addPackUnits = (packUnits: Array<{ name: string }>) => {
            for (const packUnit of packUnits) {
                const unit = unitsByName.get(getUnitNameKey(packUnit.name));
                if (unit) {
                    lookupKeys.add(getForcePackLookupKey(unit));
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

function hydrateCorpus(snapshot: UnitSearchWorkerCorpusSnapshot): WorkerCorpusRuntime {
    return {
        corpusVersion: snapshot.corpusVersion,
        units: snapshot.units,
        allUnitNames: new Set(snapshot.units.map((unit) => unit.name)),
        indexedUnitIds: buildIndexedUnitIds(snapshot.indexes),
        indexedFilterValues: buildIndexedFilterValues(snapshot.indexes),
        factionEraUnitIds: buildFactionEraUnitIds(snapshot.factionEraIndex),
        forcePackToLookupKey: buildForcePackIndex(snapshot.units),
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

    const getFactionEraUnitNames = (eraName: string, factionNames: readonly string[]): ReadonlySet<string> => {
        const unitNames = new Set<string>();
        if (factionNames.length === 0) {
            return unitNames;
        }

        const eraFactionUnitIds = runtime.factionEraUnitIds.get(eraName);
        for (const factionName of factionNames) {
            addUnitNames(unitNames, eraFactionUnitIds?.get(factionName));
        }

        return unitNames;
    };

    const getMembershipUnitNames = (scope?: AvailabilityFilterScope): ReadonlySet<string> => {
        const unitNames = new Set<string>();

        if (scope?.eraNames !== undefined && scope.factionNames !== undefined) {
            for (const eraName of scope.eraNames) {
                addUnitNames(unitNames, getFactionEraUnitNames(eraName, scope.factionNames));
            }

            return unitNames;
        }

        if (scope?.eraNames !== undefined) {
            for (const eraName of scope.eraNames) {
                addUnitNames(unitNames, runtime.indexedUnitIds.get('era')?.get(eraName));
            }

            return unitNames;
        }

        if (scope?.factionNames !== undefined) {
            for (const factionName of scope.factionNames) {
                addUnitNames(unitNames, runtime.indexedUnitIds.get('faction')?.get(factionName));
            }

            return unitNames;
        }

        addUnitNames(unitNames, runtime.allUnitNames);

        return unitNames;
    };

    const getScopedEraUnitNames = (
        eraName: string,
        scope?: AvailabilityFilterScope,
    ): ReadonlySet<string> => {
        return getMembershipUnitNames(
            scope?.factionNames === undefined
                ? { eraNames: [eraName] }
                : { eraNames: [eraName], factionNames: scope.factionNames },
        );
    };

    const getScopedFactionUnitNames = (
        factionName: string,
        eraNames?: readonly string[],
    ): ReadonlySet<string> => {
        return getMembershipUnitNames(
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
            return getScopedEraUnitNames(value, scope);
        }

        if (filterKey === 'faction') {
            return getScopedFactionUnitNames(value, scope?.eraNames);
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
        getAdjustedBV: (unit: Unit) => {
            const gunnery = request.pilotGunnerySkill;
            const piloting = getEffectivePilotingSkill(unit, request.pilotPilotingSkill);
            if (gunnery === DEFAULT_GUNNERY_SKILL && piloting === DEFAULT_PILOTING_SKILL) {
                return unit.bv;
            }
            return BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, gunnery, piloting);
        },
        getAdjustedPV: (unit: Unit) => {
            if (request.pilotGunnerySkill === DEFAULT_GUNNERY_SKILL) {
                return unit.as.PV;
            }
            return PVCalculatorUtil.calculateAdjustedPV(unit.as.PV, request.pilotGunnerySkill);
        },
        unitBelongsToEra: (unit: Unit, eraName: string, scope?: AvailabilityFilterScope) => getScopedEraUnitNames(eraName, scope).has(unit.name),
        unitBelongsToFaction: (unit: Unit, factionName: string, eraNames?: readonly string[]) => getScopedFactionUnitNames(factionName, eraNames).has(unit.name),
        unitBelongsToForcePack: (unit: Unit, packName: string) => runtime.forcePackToLookupKey.get(packName)?.has(getForcePackLookupKey(unit)) ?? false,
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
        unitNames: execution.results.map(unit => unit.name),
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
                corpus = hydrateCorpus(data.snapshot);
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
