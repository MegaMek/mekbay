/// <reference lib="webworker" />

import type { Unit } from './models/units.model';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from './models/crew-member.model';
import { getForcePacks } from './models/forcepacks.model';
import { ADVANCED_FILTERS, type SearchTelemetryStage } from './services/unit-search-filters.model';
import { BVCalculatorUtil } from './utils/bv-calculator.util';
import { getEffectivePilotingSkill } from './utils/cbt-common.util';
import { parseSemanticQueryAST } from './utils/semantic-filter-ast.util';
import { PVCalculatorUtil } from './utils/pv-calculator.util';
import { parseSearchQuery } from './utils/search.util';
import { executeUnitSearch } from './utils/unit-search-executor.util';
import { getNowMs } from './utils/unit-search-shared.util';
import type {
    UnitSearchWorkerCorpusSnapshot,
    UnitSearchWorkerErrorMessage,
    UnitSearchWorkerIndexSnapshot,
    UnitSearchWorkerQueryRequest,
    UnitSearchWorkerRequestMessage,
    UnitSearchWorkerResponseMessage,
    UnitSearchWorkerResultMessage,
} from './utils/unit-search-worker-protocol.util';

interface WorkerCorpusRuntime {
    corpusVersion: string;
    units: Unit[];
    indexedUnitIds: Map<string, Map<string, ReadonlySet<string>>>;
    indexedFilterValues: Map<string, string[]>;
    forcePackToChassisType: Map<string, Set<string>>;
}

let corpus: WorkerCorpusRuntime | null = null;
const workerDisplayNameFns = new Map(
    ADVANCED_FILTERS
        .filter(filter => typeof filter.displayNameFn === 'function')
        .map(filter => [filter.key, filter.displayNameFn!])
);

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

function buildForcePackIndex(units: Unit[]): Map<string, Set<string>> {
    const unitsByName = new Map(units.map(unit => [unit.name, unit]));
    const result = new Map<string, Set<string>>();

    for (const pack of getForcePacks()) {
        const chassisTypes = new Set<string>();
        const addPackUnits = (packUnits: Array<{ name: string }>) => {
            for (const packUnit of packUnits) {
                const unit = unitsByName.get(packUnit.name);
                if (unit) {
                    chassisTypes.add(`${unit.chassis}|${unit.type}`);
                }
            }
        };

        addPackUnits(pack.units);
        for (const variant of pack.variants ?? []) {
            addPackUnits(variant.units);
        }
        result.set(pack.name, chassisTypes);
    }

    return result;
}

function hydrateCorpus(snapshot: UnitSearchWorkerCorpusSnapshot): WorkerCorpusRuntime {
    return {
        corpusVersion: snapshot.corpusVersion,
        units: snapshot.units,
        indexedUnitIds: buildIndexedUnitIds(snapshot.indexes),
        indexedFilterValues: buildIndexedFilterValues(snapshot.indexes),
        forcePackToChassisType: buildForcePackIndex(snapshot.units),
    };
}

function buildResultMessage(runtime: WorkerCorpusRuntime, request: UnitSearchWorkerQueryRequest): UnitSearchWorkerResultMessage {
    const parseStartedAt = getNowMs();
    const parsedQuery = parseSemanticQueryAST(request.executionQuery, request.gameSystem);
    const parseDurationMs = getNowMs() - parseStartedAt;

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
        unitBelongsToEra: (unit: Unit, eraName: string) => runtime.indexedUnitIds.get('era')?.get(eraName)?.has(unit.name) ?? false,
        unitBelongsToFaction: (unit: Unit, factionName: string) => runtime.indexedUnitIds.get('faction')?.get(factionName)?.has(unit.name) ?? false,
        unitBelongsToForcePack: (unit: Unit, packName: string) => runtime.forcePackToChassisType.get(packName)?.has(`${unit.chassis}|${unit.type}`) ?? false,
        getAllEraNames: () => runtime.indexedFilterValues.get('era') ?? [],
        getAllFactionNames: () => runtime.indexedFilterValues.get('faction') ?? [],
        getDisplayName: (filterKey: string, value: string) => workerDisplayNameFns.get(filterKey)?.(value),
        getIndexedUnitIds: (filterKey: string, value: string) => runtime.indexedUnitIds.get(filterKey)?.get(value),
        getIndexedFilterValues: (filterKey: string) => runtime.indexedFilterValues.get(filterKey) ?? [],
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