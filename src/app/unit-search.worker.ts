/// <reference lib="webworker" />

import type { Unit } from './models/units.model';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from './models/crew-member.model';
import { getForcePacks } from './models/forcepacks.model';
import {
    ADVANCED_FILTERS,
    type AvailabilityFilterScope,
    type SearchTelemetryStage,
} from './services/unit-search-filters.model';
import {
    MEGAMEK_AVAILABILITY_UNKNOWN,
    MEGAMEK_AVAILABILITY_ALL_RARITY_OPTIONS,
    MEGAMEK_AVAILABILITY_FROM_FILTER_OPTIONS,
    MEGAMEK_AVAILABILITY_FROM_OPTIONS,
    type MegaMekAvailabilityFrom,
    type MegaMekAvailabilityRarity,
} from './models/megamek/availability.model';
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
    UnitSearchWorkerMegaMekAvailabilityBucketSnapshot,
    UnitSearchWorkerMegaMekAvailabilitySnapshot,
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
    megaMekAvailability: WorkerMegaMekAvailabilityRuntime;
}

interface WorkerMegaMekAvailabilityBucketRuntime {
    unitNames: ReadonlySet<string>;
    bySource: Map<MegaMekAvailabilityFrom, ReadonlySet<string>>;
    byRarity: Map<MegaMekAvailabilityFrom, Map<MegaMekAvailabilityRarity, ReadonlySet<string>>>;
}

interface WorkerMegaMekAvailabilityRuntime {
    all: WorkerMegaMekAvailabilityBucketRuntime;
    knownUnitNames: ReadonlySet<string>;
    eras: Map<string, WorkerMegaMekAvailabilityBucketRuntime>;
    factions: Map<string, WorkerMegaMekAvailabilityBucketRuntime>;
    eraFactions: Map<string, Map<string, WorkerMegaMekAvailabilityBucketRuntime>>;
    extinctFactionName?: string;
    extinctUnitNames: ReadonlySet<string>;
    extinctByEra: Map<string, ReadonlySet<string>>;
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

function buildMegaMekAvailabilityBucketRuntime(
    bucket: UnitSearchWorkerMegaMekAvailabilityBucketSnapshot,
): WorkerMegaMekAvailabilityBucketRuntime {
    const bySource = new Map<MegaMekAvailabilityFrom, ReadonlySet<string>>();
    const byRarity = new Map<MegaMekAvailabilityFrom, Map<MegaMekAvailabilityRarity, ReadonlySet<string>>>();

    for (const availabilityFrom of MEGAMEK_AVAILABILITY_FROM_OPTIONS) {
        bySource.set(availabilityFrom, new Set(bucket.bySource[availabilityFrom] ?? []));

        const rarityMap = new Map<MegaMekAvailabilityRarity, ReadonlySet<string>>();
        const raritySnapshot = bucket.byRarity[availabilityFrom] ?? {};
        for (const rarity of MEGAMEK_AVAILABILITY_ALL_RARITY_OPTIONS) {
            rarityMap.set(rarity, new Set(raritySnapshot[rarity] ?? []));
        }
        byRarity.set(availabilityFrom, rarityMap);
    }

    return {
        unitNames: new Set(bucket.unitNames),
        bySource,
        byRarity,
    };
}

function buildMegaMekAvailabilityRuntime(
    snapshot: UnitSearchWorkerMegaMekAvailabilitySnapshot,
): WorkerMegaMekAvailabilityRuntime {
    const eras = new Map<string, WorkerMegaMekAvailabilityBucketRuntime>();
    for (const [eraName, bucket] of Object.entries(snapshot.eras)) {
        eras.set(eraName, buildMegaMekAvailabilityBucketRuntime(bucket));
    }

    const factions = new Map<string, WorkerMegaMekAvailabilityBucketRuntime>();
    for (const [factionName, bucket] of Object.entries(snapshot.factions)) {
        factions.set(factionName, buildMegaMekAvailabilityBucketRuntime(bucket));
    }

    const eraFactions = new Map<string, Map<string, WorkerMegaMekAvailabilityBucketRuntime>>();
    for (const [eraName, factionMap] of Object.entries(snapshot.eraFactions)) {
        const buckets = new Map<string, WorkerMegaMekAvailabilityBucketRuntime>();
        for (const [factionName, bucket] of Object.entries(factionMap)) {
            buckets.set(factionName, buildMegaMekAvailabilityBucketRuntime(bucket));
        }
        eraFactions.set(eraName, buckets);
    }

    return {
        all: buildMegaMekAvailabilityBucketRuntime(snapshot.all),
        knownUnitNames: new Set(snapshot.knownUnitNames),
        eras,
        factions,
        eraFactions,
        extinctFactionName: snapshot.extinctFactionName,
        extinctUnitNames: new Set(snapshot.extinctUnitNames),
        extinctByEra: new Map(
            Object.entries(snapshot.extinctByEra).map(([eraName, unitNames]) => [eraName, new Set(unitNames)]),
        ),
    };
}

function buildMegaMekScopedCacheKey(
    kind: 'available' | 'membership' | 'rarity' | 'unknown',
    scope?: AvailabilityFilterScope,
    extras: string[] = [],
): string {
    const eraKey = scope?.eraNames ? [...scope.eraNames].map((name) => name.toLowerCase()).sort().join(',') : '*';
    const factionKey = scope?.factionNames ? [...scope.factionNames].map((name) => name.toLowerCase()).sort().join(',') : '*';
    const availabilityFromKey = scope?.availabilityFromNames ? [...scope.availabilityFromNames].sort().join(',') : '*';
    const suffix = extras.length > 0 ? `|${extras.join('|')}` : '';

    return `${kind}|e=${eraKey}|f=${factionKey}|from=${availabilityFromKey}${suffix}`;
}

function addUnitNames(target: Set<string>, source: ReadonlySet<string> | undefined): void {
    if (!source || source.size === 0) {
        return;
    }

    for (const unitName of source) {
        target.add(unitName);
    }
}

function getRequestedMegaMekAvailabilitySources(scope?: AvailabilityFilterScope): readonly MegaMekAvailabilityFrom[] {
    if (!scope?.availabilityFromNames || scope.availabilityFromNames.length === 0) {
        return MEGAMEK_AVAILABILITY_FROM_OPTIONS;
    }

    const availabilityFrom = scope.availabilityFromNames.filter((value): value is MegaMekAvailabilityFrom => (
        value === 'Production' || value === 'Salvage'
    ));

    return availabilityFrom.length > 0
        ? availabilityFrom
        : MEGAMEK_AVAILABILITY_FROM_OPTIONS;
}

function addUnknownUnitNames(
    target: Set<string>,
    allUnitNames: ReadonlySet<string>,
    knownUnitNames: ReadonlySet<string>,
): void {
    for (const unitName of allUnitNames) {
        if (!knownUnitNames.has(unitName)) {
            target.add(unitName);
        }
    }
}

function addUnavailableUnitNamesFromBucket(
    target: Set<string>,
    bucket: WorkerMegaMekAvailabilityBucketRuntime | undefined,
    availabilityFrom: readonly MegaMekAvailabilityFrom[],
    knownUnitNames: ReadonlySet<string>,
): void {
    if (!bucket) {
        addUnitNames(target, knownUnitNames);
        return;
    }

    const availableUnitNames = new Set<string>();
    for (const source of availabilityFrom) {
        addUnitNames(availableUnitNames, bucket.bySource.get(source));
    }

    for (const unitName of knownUnitNames) {
        if (!availableUnitNames.has(unitName)) {
            target.add(unitName);
        }
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
        megaMekAvailability: buildMegaMekAvailabilityRuntime(snapshot.megaMekAvailability),
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
    const useMegaMekAvailability = request.availabilitySource === 'megamek';
    const megaMekScopedUnitIdsCache = new Map<string, ReadonlySet<string>>();
    const megaMekEraNames = Array.from(runtime.megaMekAvailability.eras.keys());
    const megaMekFactionNames = Array.from(runtime.megaMekAvailability.factions.keys());
    if (
        runtime.megaMekAvailability.extinctFactionName
        && !megaMekFactionNames.includes(runtime.megaMekAvailability.extinctFactionName)
    ) {
        megaMekFactionNames.push(runtime.megaMekAvailability.extinctFactionName);
    }

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

    const getMulMembershipUnitNames = (scope?: AvailabilityFilterScope): ReadonlySet<string> => {
        const unitNames = new Set<string>();

        if (scope?.eraNames !== undefined && scope.factionNames !== undefined) {
            for (const eraName of scope.eraNames) {
                const eraFactionUnitIds = runtime.factionEraUnitIds.get(eraName);
                for (const factionName of scope.factionNames) {
                    addUnitNames(unitNames, eraFactionUnitIds?.get(factionName));
                }
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

    const getMegaMekMembershipUnitNames = (scope?: AvailabilityFilterScope): ReadonlySet<string> => {
        const cacheKey = buildMegaMekScopedCacheKey('membership', scope);
        const cached = megaMekScopedUnitIdsCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const unitNames = new Set<string>();
        const megaMek = runtime.megaMekAvailability;

        if (scope?.eraNames && scope.factionNames) {
            for (const eraName of scope.eraNames) {
                const eraFactionBuckets = megaMek.eraFactions.get(eraName);
                for (const factionName of scope.factionNames) {
                    const bucket = eraFactionBuckets?.get(factionName);
                    if (bucket) {
                        addUnitNames(unitNames, bucket.unitNames);
                        continue;
                    }

                    if (factionName === megaMek.extinctFactionName) {
                        addUnitNames(unitNames, megaMek.extinctByEra.get(eraName));
                    }
                }
            }
        } else if (scope?.eraNames) {
            for (const eraName of scope.eraNames) {
                addUnitNames(unitNames, megaMek.eras.get(eraName)?.unitNames);
            }
        } else if (scope?.factionNames) {
            for (const factionName of scope.factionNames) {
                const bucket = megaMek.factions.get(factionName);
                if (bucket) {
                    addUnitNames(unitNames, bucket.unitNames);
                    continue;
                }

                if (factionName === megaMek.extinctFactionName) {
                    addUnitNames(unitNames, megaMek.extinctUnitNames);
                }
            }
        } else {
            addUnitNames(unitNames, megaMek.all.unitNames);
        }

        megaMekScopedUnitIdsCache.set(cacheKey, unitNames);
        return unitNames;
    };

    const getMegaMekUnknownUnitNames = (): ReadonlySet<string> => {
        const cacheKey = buildMegaMekScopedCacheKey('unknown');
        const cached = megaMekScopedUnitIdsCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const unitNames = new Set<string>();
        addUnknownUnitNames(unitNames, runtime.allUnitNames, runtime.megaMekAvailability.knownUnitNames);
        megaMekScopedUnitIdsCache.set(cacheKey, unitNames);
        return unitNames;
    };

    const getMegaMekAvailabilityUnitNames = (scope?: AvailabilityFilterScope): ReadonlySet<string> => {
        const cacheKey = buildMegaMekScopedCacheKey('available', scope);
        const cached = megaMekScopedUnitIdsCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const availabilityFrom = getRequestedMegaMekAvailabilitySources(scope);
        const unitNames = new Set<string>();
        const megaMek = runtime.megaMekAvailability;

        if (scope?.eraNames && scope.factionNames) {
            for (const eraName of scope.eraNames) {
                const eraFactionBuckets = megaMek.eraFactions.get(eraName);
                for (const factionName of scope.factionNames) {
                    if (factionName === megaMek.extinctFactionName) {
                        continue;
                    }

                    const bucket = eraFactionBuckets?.get(factionName);
                    for (const source of availabilityFrom) {
                        addUnitNames(unitNames, bucket?.bySource.get(source));
                    }
                }
            }
        } else if (scope?.eraNames) {
            for (const eraName of scope.eraNames) {
                const bucket = megaMek.eras.get(eraName);
                for (const source of availabilityFrom) {
                    addUnitNames(unitNames, bucket?.bySource.get(source));
                }
            }
        } else if (scope?.factionNames) {
            for (const factionName of scope.factionNames) {
                if (factionName === megaMek.extinctFactionName) {
                    continue;
                }

                const bucket = megaMek.factions.get(factionName);
                for (const source of availabilityFrom) {
                    addUnitNames(unitNames, bucket?.bySource.get(source));
                }
            }
        } else {
            for (const source of availabilityFrom) {
                addUnitNames(unitNames, megaMek.all.bySource.get(source));
            }
        }

        megaMekScopedUnitIdsCache.set(cacheKey, unitNames);
        return unitNames;
    };

    const getMegaMekRarityUnitNames = (
        rarity: MegaMekAvailabilityRarity,
        scope?: AvailabilityFilterScope,
    ): ReadonlySet<string> => {
        const cacheKey = buildMegaMekScopedCacheKey('rarity', scope, [rarity]);
        const cached = megaMekScopedUnitIdsCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const availabilityFrom = getRequestedMegaMekAvailabilitySources(scope);
        const unitNames = new Set<string>();
        const megaMek = runtime.megaMekAvailability;

        if (rarity === MEGAMEK_AVAILABILITY_UNKNOWN) {
            addUnitNames(unitNames, getMegaMekUnknownUnitNames());
        } else if (rarity === 'Not Available') {
            if (scope?.eraNames && scope.factionNames) {
                for (const eraName of scope.eraNames) {
                    const eraFactionBuckets = megaMek.eraFactions.get(eraName);
                    for (const factionName of scope.factionNames) {
                        if (factionName === megaMek.extinctFactionName) {
                            continue;
                        }

                        addUnavailableUnitNamesFromBucket(unitNames, eraFactionBuckets?.get(factionName), availabilityFrom, megaMek.knownUnitNames);
                    }
                }
            } else if (scope?.eraNames) {
                for (const eraName of scope.eraNames) {
                    addUnavailableUnitNamesFromBucket(unitNames, megaMek.eras.get(eraName), availabilityFrom, megaMek.knownUnitNames);
                }
            } else if (scope?.factionNames) {
                for (const factionName of scope.factionNames) {
                    if (factionName === megaMek.extinctFactionName) {
                        continue;
                    }

                    addUnavailableUnitNamesFromBucket(unitNames, megaMek.factions.get(factionName), availabilityFrom, megaMek.knownUnitNames);
                }
            } else {
                addUnavailableUnitNamesFromBucket(unitNames, megaMek.all, availabilityFrom, megaMek.knownUnitNames);
            }
        } else if (scope?.eraNames && scope.factionNames) {
            for (const eraName of scope.eraNames) {
                const eraFactionBuckets = megaMek.eraFactions.get(eraName);
                for (const factionName of scope.factionNames) {
                    if (factionName === megaMek.extinctFactionName) {
                        continue;
                    }

                    const bucket = eraFactionBuckets?.get(factionName);
                    for (const source of availabilityFrom) {
                        addUnitNames(unitNames, bucket?.byRarity.get(source)?.get(rarity));
                    }
                }
            }
        } else if (scope?.eraNames) {
            for (const eraName of scope.eraNames) {
                const bucket = megaMek.eras.get(eraName);
                for (const source of availabilityFrom) {
                    addUnitNames(unitNames, bucket?.byRarity.get(source)?.get(rarity));
                }
            }
        } else if (scope?.factionNames) {
            for (const factionName of scope.factionNames) {
                if (factionName === megaMek.extinctFactionName) {
                    continue;
                }

                const bucket = megaMek.factions.get(factionName);
                for (const source of availabilityFrom) {
                    addUnitNames(unitNames, bucket?.byRarity.get(source)?.get(rarity));
                }
            }
        } else {
            for (const source of availabilityFrom) {
                addUnitNames(unitNames, megaMek.all.byRarity.get(source)?.get(rarity));
            }
        }

        megaMekScopedUnitIdsCache.set(cacheKey, unitNames);
        return unitNames;
    };

    const getMembershipUnitNames = (scope?: AvailabilityFilterScope): ReadonlySet<string> => {
        return useMegaMekAvailability
            ? getMegaMekMembershipUnitNames(scope)
            : getMulMembershipUnitNames(scope);
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
        return useMegaMekAvailability
            ? [...megaMekEraNames]
            : [...(runtime.indexedFilterValues.get('era') ?? [])];
    };

    const getFactionFilterValues = (): string[] => {
        return useMegaMekAvailability
            ? [...megaMekFactionNames]
            : [...(runtime.indexedFilterValues.get('faction') ?? [])];
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
        unitMatchesAvailabilityFrom: (unit: Unit, availabilityFromName: string, scope?: AvailabilityFilterScope) => {
            if (availabilityFromName.trim().toLowerCase() === MEGAMEK_AVAILABILITY_UNKNOWN.toLowerCase()) {
                return getMegaMekUnknownUnitNames().has(unit.name);
            }

            return getMegaMekAvailabilityUnitNames({
                ...scope,
                availabilityFromNames: [availabilityFromName],
            }).has(unit.name);
        },
        unitMatchesAvailabilityRarity: (unit: Unit, rarityName: string, scope?: AvailabilityFilterScope) => {
            if (rarityName.trim().toLowerCase() === MEGAMEK_AVAILABILITY_UNKNOWN.toLowerCase()) {
                return getMegaMekUnknownUnitNames().has(unit.name);
            }

            return getMegaMekRarityUnitNames(rarityName as MegaMekAvailabilityRarity, scope).has(unit.name);
        },
        unitBelongsToForcePack: (unit: Unit, packName: string) => runtime.forcePackToLookupKey.get(packName)?.has(getForcePackLookupKey(unit)) ?? false,
        getAllEraNames: getEraFilterValues,
        getAllFactionNames: getFactionFilterValues,
        getAllAvailabilityFromNames: () => [...MEGAMEK_AVAILABILITY_FROM_FILTER_OPTIONS],
        getAllAvailabilityRarityNames: () => [...MEGAMEK_AVAILABILITY_ALL_RARITY_OPTIONS],
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