import { provideZonelessChangeDetection, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { Eras } from '../models/eras.model';
import type { Factions } from '../models/factions.model';
import type { Unit, Units } from '../models/units.model';
import { GameSystem } from '../models/common.model';
import { DataService } from './data.service';
import { DbService } from './db.service';
import { GameService } from './game.service';
import { LoggerService } from './logger.service';
import { OptionsService } from './options.service';
import { PublicTagsService } from './public-tags.service';
import { TagsService } from './tags.service';
import { UnitInitializerService } from './unit-initializer.service';
import { UnitSearchFiltersService } from './unit-search-filters.service';
import { UrlStateService } from './url-state.service';
import { UserStateService } from './userState.service';
import { WsService } from './ws.service';
import {
    getAdvancedFilterConfigByKey,
    getDropdownCapabilityMetadataErrors,
    usesIndexedDropdownAvailability,
    usesIndexedDropdownUniverse,
} from '../utils/unit-search-filter-config.util';
import { SEARCH_WORKER_FACTORY } from '../utils/unit-search-worker-factory.util';
import type { SearchWorkerLike } from '../utils/unit-search-worker-client.util';
import type { UnitSearchWorkerResponseMessage } from '../utils/unit-search-worker-protocol.util';

interface BenchmarkBundle {
    units: Units;
    factions: Factions;
    eras: Eras;
}

class FakeSearchWorker implements SearchWorkerLike {
    onmessage: ((event: MessageEvent<UnitSearchWorkerResponseMessage>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    readonly messages: unknown[] = [];

    postMessage(message: unknown): void {
        this.messages.push(message);
    }

    terminate(): void {
        return;
    }

    emit(message: UnitSearchWorkerResponseMessage): void {
        this.onmessage?.({ data: message } as MessageEvent<UnitSearchWorkerResponseMessage>);
    }

    fail(message: string): void {
        this.onerror?.({ message } as ErrorEvent);
    }
}

function cloneUnit<T>(value: T): T {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value)) as T;
}

function prepareUnitForSearch(unit: Unit, index: number): Unit {
    const clone = cloneUnit(unit);
    clone.id = index + 1;
    clone.name = `${unit.name}__${index}`;
    clone._nameTags = clone._nameTags ?? [];
    clone._chassisTags = clone._chassisTags ?? [];
    clone._publicTags = clone._publicTags ?? [];
    clone.comp = clone.comp ?? [];
    clone.quirks = clone.quirks ?? [];
    clone.features = clone.features ?? [];
    clone.source = clone.source ?? [];
    return clone;
}

function buildBenchmarkBundle(payload: BenchmarkBundle, targetCount: number): BenchmarkBundle {
    const prepared = payload.units.units.map((unit, index) => prepareUnitForSearch(unit, index));
    if (prepared.length === 0) {
        return {
            units: { ...payload.units, units: [] },
            factions: { ...payload.factions, factions: [] },
            eras: { ...payload.eras, eras: [] },
        };
    }

    const dataset: Unit[] = [];
    const idExpansion = new Map<number, number[]>();
    for (let index = 0; index < targetCount; index++) {
        const unit = prepareUnitForSearch(prepared[index % prepared.length], index);
        dataset.push(unit);
        const expandedIds = idExpansion.get(prepared[index % prepared.length].id) ?? [];
        expandedIds.push(unit.id);
        idExpansion.set(prepared[index % prepared.length].id, expandedIds);
    }

    const expandIds = (ids: number[]) => ids.flatMap(id => idExpansion.get(id) ?? []);

    return {
        units: {
            ...payload.units,
            units: dataset,
        },
        eras: {
            ...payload.eras,
            eras: payload.eras.eras.map(era => ({
                ...cloneUnit(era),
                factions: Array.isArray(era.factions) ? [...era.factions] : Array.from(era.factions),
                units: expandIds(Array.isArray(era.units) ? era.units : Array.from(era.units)),
            })),
        },
        factions: {
            ...payload.factions,
            factions: payload.factions.factions.map(faction => ({
                ...cloneUnit(faction),
                eras: Object.fromEntries(
                    Object.entries(faction.eras).map(([eraId, unitIds]) => [
                        Number(eraId),
                        new Set(expandIds(Array.isArray(unitIds) ? unitIds : Array.from(unitIds))),
                    ])
                ) as Record<number, Set<number>>,
            })),
        },
    };
}

function buildSmallBundle(payload: BenchmarkBundle): BenchmarkBundle {
    const [firstSource, secondSource] = payload.units.units;
    if (!firstSource || !secondSource) {
        throw new Error('Benchmark payload must contain at least two units');
    }

    const firstUnit = prepareUnitForSearch(firstSource, 0);
    firstUnit.id = 1;
    firstUnit.name = 'Test Mek';
    firstUnit.chassis = 'Test Mek';
    firstUnit.model = 'Prime';
    firstUnit.type = 'Mek';
    firstUnit.subtype = 'BattleMek';
    firstUnit.as = { ...firstUnit.as, TP: 'BM' };
    firstUnit.as.specials = ['ECM'];
    firstUnit.year = 3050;
    firstUnit.source = ['SRC-A'];
    firstUnit.comp = [{ id: 'laser', q: 1, n: 'Laser', t: 'E', p: 0, l: 'CT' }];
    firstUnit.features = ['CASE'];
    firstUnit.quirks = ['Accurate Weapon'];
    firstUnit._nameTags = ['tag-a'];
    firstUnit._chassisTags = [];
    firstUnit._publicTags = [];

    const secondUnit = prepareUnitForSearch(secondSource, 1);
    secondUnit.id = 2;
    secondUnit.name = 'Test Tank';
    secondUnit.chassis = 'Test Tank';
    secondUnit.model = 'A';
    secondUnit.type = 'Tank';
    secondUnit.subtype = 'Combat Vehicle';
    secondUnit.as = { ...secondUnit.as, TP: 'CV' };
    secondUnit.as.specials = ['TAG'];
    secondUnit.year = 3050;
    secondUnit.source = ['SRC-B'];
    secondUnit.comp = [{ id: 'cannon', q: 1, n: 'Cannon', t: 'B', p: 0, l: 'FR' }];
    secondUnit.features = ['Amphibious'];
    secondUnit.quirks = ['Poor Performance'];
    secondUnit._nameTags = ['tag-b'];
    secondUnit._chassisTags = [];
    secondUnit._publicTags = [];

    return {
        units: {
            version: payload.units.version,
            etag: payload.units.etag,
            units: [firstUnit, secondUnit],
        },
        eras: {
            version: payload.eras.version,
            etag: payload.eras.etag,
            eras: [{
                id: 1,
                name: 'Succession Wars',
                img: '',
                years: {
                    from: 3000,
                    to: 3100,
                },
                units: [1, 2],
                factions: [],
            }],
        },
        factions: {
            version: payload.factions.version,
            etag: payload.factions.etag,
            factions: [{
                id: 1,
                name: 'Test Faction',
                group: 'Other',
                img: '',
                eras: {
                    1: new Set([1, 2]),
                },
            }],
        },
    };
}

function hydrateDataService(dataService: DataService, bundle: BenchmarkBundle): void {
    const storeMap = new Map<string, any>(((dataService as any).remoteStores as any[]).map(store => [store.key, store]));

    for (const key of ['factions', 'eras', 'units']) {
        const store = storeMap.get(key);
        const value = bundle[key as keyof BenchmarkBundle];
        (dataService as any).data[key] = store?.preprocess ? store.preprocess(cloneUnit(value)) : cloneUnit(value);
    }

    (dataService as any).postprocessData();
    dataService.isDataReady.set(true);
}

async function flushAsyncWork(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('UnitSearchFiltersService search telemetry', () => {
    let benchmarkBundle: BenchmarkBundle | null = null;
    let sharedService: UnitSearchFiltersService | null = null;
    let sharedDataService: DataService | null = null;
    let sharedGameServiceStub: { currentGameSystem: ReturnType<typeof signal<GameSystem>> } | null = null;

    function createService(
        bundleOverride?: BenchmarkBundle,
        options?: {
            useRealLogger?: boolean;
            workerFactory?: (() => SearchWorkerLike) | null;
            automaticallyConvertFiltersToSemantic?: boolean;
        }
    ) {
        const dbServiceStub = {
            waitForDbReady: () => Promise.resolve(),
        };

        const optionsServiceStub = {
            options: signal({
                automaticallyConvertFiltersToSemantic: options?.automaticallyConvertFiltersToSemantic ?? false,
            }),
        };

        const gameServiceStub = {
            currentGameSystem: signal(GameSystem.CLASSIC),
        };

        const loggerStub = {
            info: jasmine.createSpy('info'),
            warn: jasmine.createSpy('warn'),
            error: jasmine.createSpy('error'),
        };

        const wsServiceStub = {
            getWebSocket: () => null,
            getWsReady: () => Promise.resolve(),
            send: jasmine.createSpy('send'),
        };

        const httpClientStub = {};

        const urlStateServiceStub = {
            initialState: {
                gameSystem: null,
                hasMeaningfulParams: false,
                params: new URLSearchParams(),
            },
            registerConsumer: jasmine.createSpy('registerConsumer'),
            markConsumerReady: jasmine.createSpy('markConsumerReady'),
            setParams: jasmine.createSpy('setParams'),
        };

        const tagsServiceStub = {
            syncFromCloud: jasmine.createSpy('syncFromCloud'),
            getNameTags: () => ({}),
            getChassisTags: () => ({}),
            getTagData: async () => ({ tags: {}, timestamp: 0, formatVersion: 3 as const }),
            setRefreshUnitsCallback: jasmine.createSpy('setRefreshUnitsCallback'),
            setNotifyStoreUpdatedCallback: jasmine.createSpy('setNotifyStoreUpdatedCallback'),
            registerWsHandlers: jasmine.createSpy('registerWsHandlers'),
        };

        const publicTagsServiceStub = {
            initialize: jasmine.createSpy('initialize'),
            setRefreshUnitsCallback: jasmine.createSpy('setRefreshUnitsCallback'),
            registerWsHandlers: jasmine.createSpy('registerWsHandlers'),
            getPublicTagsForUnit: () => [],
            isTagSubscribed: () => false,
            getAllPublicTags: () => [],
            getSubscribedTags: () => [],
        };

        const userStateServiceStub = {
            publicId: () => null,
            uuid: () => '',
        };

        const unitInitializerStub = {
            initializeUnit: jasmine.createSpy('initializeUnit'),
        };

        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                DataService,
                UnitSearchFiltersService,
                { provide: HttpClient, useValue: httpClientStub },
                { provide: DbService, useValue: dbServiceStub },
                { provide: WsService, useValue: wsServiceStub },
                { provide: UnitInitializerService, useValue: unitInitializerStub },
                { provide: OptionsService, useValue: optionsServiceStub },
                { provide: GameService, useValue: gameServiceStub },
                { provide: UrlStateService, useValue: urlStateServiceStub },
                { provide: UserStateService, useValue: userStateServiceStub },
                { provide: PublicTagsService, useValue: publicTagsServiceStub },
                { provide: TagsService, useValue: tagsServiceStub },
                { provide: SEARCH_WORKER_FACTORY, useValue: options?.workerFactory ?? null },
            ],
        });

        if (!options?.useRealLogger) {
            TestBed.overrideProvider(LoggerService, { useValue: loggerStub });
        }

        const dataService = TestBed.inject(DataService);
        const bundle = bundleOverride ?? benchmarkBundle;
        if (bundle) {
            hydrateDataService(dataService, bundle);
        }

        return {
            dataService,
            service: TestBed.inject(UnitSearchFiltersService),
            optionsServiceStub,
            loggerStub,
            logger: TestBed.inject(LoggerService),
            gameServiceStub,
        };
    }

    beforeAll(async () => {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;

        try {
            const [unitsResponse, factionsResponse, erasResponse] = await Promise.all([
                fetch('https://db.mekbay.com/units.json'),
                fetch('https://db.mekbay.com/factions.json'),
                fetch('https://db.mekbay.com/eras.json'),
            ]);

            if (!unitsResponse.ok || !factionsResponse.ok || !erasResponse.ok) {
                throw new Error('Failed to load one or more benchmark payloads');
            }

            benchmarkBundle = buildBenchmarkBundle({
                units: await unitsResponse.json() as Units,
                factions: await factionsResponse.json() as Factions,
                eras: await erasResponse.json() as Eras,
            }, 10000);

            const { service, dataService, gameServiceStub } = createService();
            sharedService = service;
            sharedDataService = dataService;
            sharedGameServiceStub = gameServiceStub;
        } catch {
            benchmarkBundle = null;
        }
    });

    xit('captures stage timings for a 10,000-unit real-data search', async () => {
        if (!sharedService) {
            pending('Real unit data could not be loaded for the benchmark test.');
            return;
        }
        sharedService.resetFilters();
        sharedService.searchText.set('crab bv=1000-3000');
        const service = sharedService;

        const results = service.filteredUnits();
        await Promise.resolve();
        const telemetry = service.searchTelemetry();

        expect(results.length).toBeGreaterThan(0);
        expect(telemetry).not.toBeNull();
        expect(telemetry?.query).toBe('crab bv=1000-3000');
        expect(telemetry?.unitCount).toBe(10000);
        expect(telemetry?.resultCount).toBe(results.length);
        expect(telemetry?.totalMs).toBeGreaterThan(0);
        expect(telemetry?.stages.map(stage => stage.name)).toContain('parse-query');
        expect(telemetry?.stages.map(stage => stage.name)).toContain('ast-filter');
        expect(telemetry?.stages.map(stage => stage.name)).toContain('sort');
    });

    it('skips relevance prep for complex filter-only searches', async () => {
        if (!sharedService) {
            pending('Real unit data could not be loaded for the benchmark test.');
            return;
        }

        sharedService.resetFilters();
        const service = sharedService;

        service.searchText.set('(faction=="draco*" or faction="*suns") and type=BM');

        const results = service.filteredUnits();
        await Promise.resolve();
        const telemetry = service.searchTelemetry();

        expect(results.length).toBeGreaterThan(0);
        expect(telemetry).not.toBeNull();
        expect(telemetry?.isComplex).toBeTrue();
        expect(telemetry?.stages.map(stage => stage.name)).not.toContain('relevance-prep');
        expect(telemetry?.stages.map(stage => stage.name)).toContain('ast-filter');
    });

    it('recomputes search results when the search corpus is refreshed', async () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length === 0) {
            pending('Real unit data could not be loaded for the benchmark test.');
            return;
        }

        const { dataService, service } = createService();
        service.searchText.set('refreshprobeunit');

        expect(service.filteredUnits().length).toBe(0);

        const addedUnit = prepareUnitForSearch(benchmarkBundle.units.units[0], dataService.getUnits().length);
        addedUnit.chassis = 'RefreshProbeUnit';
        addedUnit.model = 'Benchmark';
        addedUnit.name = 'Refresh Probe Unit';

        dataService.getUnits().push(addedUnit);
        dataService.refreshSearchCorpus();

        const results = service.filteredUnits();
        await Promise.resolve();
        const telemetry = service.searchTelemetry();

        expect(results.some(unit => unit.name === 'Refresh Probe Unit')).toBeTrue();
        expect(telemetry?.unitCount).toBe(10001);
    });

    it('invalidates force pack lookup caches when the search corpus is refreshed', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length === 0) {
            pending('Real unit data could not be loaded for the cache invalidation test.');
            return;
        }

        const { dataService } = createService(buildSmallBundle(benchmarkBundle));

        (dataService as any).forcePackToChassisType = new Map([
            ['stale-pack', new Set(['Stale Unit|Mek'])],
        ]);
        (dataService as any).chassisTypeToForcePacks = new Map([
            ['Stale Unit|Mek', ['stale-pack']],
        ]);

        dataService.refreshSearchCorpus();

        expect((dataService as any).forcePackToChassisType).toBeNull();
        expect((dataService as any).chassisTypeToForcePacks).toBeNull();
    });

    it('keeps bounded dropdown options stable and marks out-of-context entries unavailable', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the dropdown test.');
            return;
        }

        const { service } = createService(buildSmallBundle(benchmarkBundle));
        service.setFilter('type', ['Mek']);

        const subtypeOptions = service.advOptions()['subtype']?.options ?? [];
        const namedSubtypeOptions = subtypeOptions.filter(option => typeof option !== 'number');
        const battleMechOption = namedSubtypeOptions.find(option => option.name === 'BattleMek');
        const combatVehicleOption = namedSubtypeOptions.find(option => option.name === 'Combat Vehicle');

        expect(namedSubtypeOptions.length).toBe(2);
        expect(battleMechOption).toEqual(jasmine.objectContaining({ name: 'BattleMek', available: true }));
        expect(combatVehicleOption).toEqual(jasmine.objectContaining({ name: 'Combat Vehicle', available: false }));
    });

    it('keeps array-backed bounded dropdown options stable and marks out-of-context entries unavailable', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the dropdown test.');
            return;
        }

        const { service } = createService(buildSmallBundle(benchmarkBundle));
        service.setFilter('type', ['Mek']);

        const sourceOptions = service.advOptions()['source']?.options ?? [];
        const namedSourceOptions = sourceOptions.filter(option => typeof option !== 'number');
        const availableSource = namedSourceOptions.find(option => option.name === 'SRC-A');
        const unavailableSource = namedSourceOptions.find(option => option.name === 'SRC-B');

        expect(namedSourceOptions.length).toBe(2);
        expect(availableSource).toEqual(jasmine.objectContaining({ name: 'SRC-A', available: true }));
        expect(unavailableSource).toEqual(jasmine.objectContaining({ name: 'SRC-B', available: false }));
    });

    it('keeps indexed faction self and co-matches available for multistate AND selections', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the faction AND availability test.');
            return;
        }

        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.factions.factions = [
            {
                id: 1,
                name: "Wolf's Dragoons",
                group: 'Mercenary',
                img: '',
                eras: { 1: new Set([1]) },
            },
            {
                id: 2,
                name: 'Mercenary',
                group: 'Mercenary',
                img: '',
                eras: { 1: new Set([1]) },
            },
            {
                id: 3,
                name: 'Clan Wolf',
                group: 'IS Clan',
                img: '',
                eras: { 1: new Set([2]) },
            },
        ];

        const { service } = createService(bundle);
        service.setFilter('faction', {
            "Wolf's Dragoons": {
                name: "Wolf's Dragoons",
                state: 'and',
                count: 1,
            },
        });

        const factionOptions = service.advOptions()['faction']?.options ?? [];
        const namedFactionOptions = factionOptions.filter(option => typeof option !== 'number');
        const dragoons = namedFactionOptions.find(option => option.name === "Wolf's Dragoons");
        const mercenary = namedFactionOptions.find(option => option.name === 'Mercenary');
        const clanWolf = namedFactionOptions.find(option => option.name === 'Clan Wolf');

        expect(dragoons).toEqual(jasmine.objectContaining({ name: "Wolf's Dragoons", available: true }));
        expect(mercenary).toEqual(jasmine.objectContaining({ name: 'Mercenary', available: true }));
        expect(clanWolf).toEqual(jasmine.objectContaining({ name: 'Clan Wolf', available: false }));
    });

    it('keeps indexed source self and co-matches available for multistate AND selections', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the source AND availability test.');
            return;
        }

        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.units.units[0].source = ['SRC-A', 'SRC-C'];
        bundle.units.units[1].source = ['SRC-B'];

        const { service } = createService(bundle);
        service.setFilter('source', {
            'SRC-A': {
                name: 'SRC-A',
                state: 'and',
                count: 1,
            },
        });

        const sourceOptions = service.advOptions()['source']?.options ?? [];
        const namedSourceOptions = sourceOptions.filter(option => typeof option !== 'number');
        const sourceA = namedSourceOptions.find(option => option.name === 'SRC-A');
        const sourceC = namedSourceOptions.find(option => option.name === 'SRC-C');
        const sourceB = namedSourceOptions.find(option => option.name === 'SRC-B');

        expect(sourceA).toEqual(jasmine.objectContaining({ name: 'SRC-A', available: true }));
        expect(sourceC).toEqual(jasmine.objectContaining({ name: 'SRC-C', available: true }));
        expect(sourceB).toEqual(jasmine.objectContaining({ name: 'SRC-B', available: false }));
    });

    it('does not throw when stale multistate era state is present', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the era state regression test.');
            return;
        }

        const { service } = createService(buildSmallBundle(benchmarkBundle));
        service.filterState.set({
            era: {
                interactedWith: true,
                value: {
                    'Succession Wars': {
                        name: 'Succession Wars',
                        state: 'or',
                        count: 1,
                    },
                },
            },
        });

        expect(() => service.advOptions()).not.toThrow();
    });

    it('canonicalizes indexed source, faction, and era filters from URL params', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the URL canonicalization test.');
            return;
        }

        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.eras.eras = [{
            id: 1,
            name: 'Succession Wars',
            img: '',
            years: {
                from: 3000,
                to: 3100,
            },
            units: [1, 2],
            factions: [],
        }];
        bundle.factions.factions = [{
            id: 1,
            name: 'Test Faction',
            group: 'Other',
            img: '',
            eras: {
                1: new Set([1, 2]),
            },
        }];

        const { service } = createService(bundle);
        const params = new URLSearchParams();
        params.set('filters', 'source:src-a|faction:test faction|era:succession wars');

        service.applySearchParamsFromUrl(params, { expandView: false });

        expect(service.filterState()['source']?.value).toEqual({
            'SRC-A': {
                name: 'SRC-A',
                state: 'or',
                count: 1,
            },
        });
        expect(service.filterState()['faction']?.value).toEqual({
            'Test Faction': {
                name: 'Test Faction',
                state: 'or',
                count: 1,
            },
        });
        expect(service.filterState()['era']?.value).toEqual(['Succession Wars']);
    });

    it('declares indexed dropdown capabilities for source, faction, and era', () => {
        const sourceConfig = getAdvancedFilterConfigByKey('source');
        const factionConfig = getAdvancedFilterConfigByKey('faction');
        const eraConfig = getAdvancedFilterConfigByKey('era');

        expect(usesIndexedDropdownUniverse(sourceConfig)).toBeTrue();
        expect(usesIndexedDropdownAvailability(sourceConfig)).toBeTrue();
        expect(usesIndexedDropdownUniverse(factionConfig)).toBeTrue();
        expect(usesIndexedDropdownAvailability(factionConfig)).toBeTrue();
        expect(usesIndexedDropdownUniverse(eraConfig)).toBeTrue();
        expect(usesIndexedDropdownAvailability(eraConfig)).toBeTrue();
    });

    it('keeps dropdown capability metadata fully specified', () => {
        expect(getDropdownCapabilityMetadataErrors()).toEqual([]);
    });

    it('keeps component options stable and marks out-of-context entries unavailable', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the dropdown test.');
            return;
        }

        const { service } = createService(buildSmallBundle(benchmarkBundle));
        service.setFilter('type', ['Mek']);

        const componentOptions = service.advOptions()['componentName']?.options ?? [];
        const namedComponentOptions = componentOptions.filter(option => typeof option !== 'number');
        const availableComponent = namedComponentOptions.find(option => option.name === 'Laser');
        const unavailableComponent = namedComponentOptions.find(option => option.name === 'Cannon');

        expect(namedComponentOptions.length).toBeGreaterThanOrEqual(2);
        expect(availableComponent).toEqual(jasmine.objectContaining({ name: 'Laser', available: true }));
        expect(unavailableComponent).toEqual(jasmine.objectContaining({ name: 'Cannon', available: false }));
    });

    it('computes component option counts from the indexed path', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the dropdown test.');
            return;
        }

        const { service } = createService(buildSmallBundle(benchmarkBundle));
        service.setFilter('componentName', {
            Laser: {
                name: 'Laser',
                state: 'or',
                count: 2,
            },
        });

        const componentOptions = service.advOptions()['componentName']?.options ?? [];
        const namedComponentOptions = componentOptions.filter(option => typeof option !== 'number');
        const laserOption = namedComponentOptions.find(option => option.name === 'Laser');
        const cannonOption = namedComponentOptions.find(option => option.name === 'Cannon');

        expect(laserOption).toEqual(jasmine.objectContaining({ name: 'Laser', count: 1 }));
        expect(cannonOption).toEqual(jasmine.objectContaining({ name: 'Cannon', count: 1 }));
    });

    it('matches componentName quantity filters greater than one', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the dropdown test.');
            return;
        }

        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.units.units[0].name = 'LRM Carrier';
        bundle.units.units[0].chassis = 'LRM Carrier';
        bundle.units.units[0].comp = [
            { id: 'lrm5-left', q: 2, n: 'LRM 5', t: 'M', p: 0, l: 'LT' } as any,
            { id: 'lrm5-right', q: 4, n: 'LRM 5', t: 'M', p: 0, l: 'RT' } as any,
        ];
        bundle.units.units[1].name = 'Single LRM Scout';
        bundle.units.units[1].chassis = 'Single LRM Scout';
        bundle.units.units[1].comp = [{ id: 'lrm5-single', q: 1, n: 'LRM 5', t: 'M', p: 0, l: 'RA' } as any];

        const { service } = createService(bundle);
        service.setFilter('componentName', {
            'LRM 5': {
                name: 'LRM 5',
                state: 'or',
                count: 2,
            },
        });

        expect(service.filteredUnits().map(unit => unit.name)).toEqual(['LRM Carrier']);
    });

    it('matches componentName quantity filters greater than one when synced to semantic text', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the dropdown test.');
            return;
        }

        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.units.units[0].name = 'LRM Carrier';
        bundle.units.units[0].chassis = 'LRM Carrier';
        bundle.units.units[0].comp = [
            { id: 'lrm5-left', q: 2, n: 'LRM 5', t: 'M', p: 0, l: 'LT' } as any,
            { id: 'lrm5-right', q: 4, n: 'LRM 5', t: 'M', p: 0, l: 'RT' } as any,
        ];
        bundle.units.units[1].name = 'Single LRM Scout';
        bundle.units.units[1].chassis = 'Single LRM Scout';
        bundle.units.units[1].comp = [{ id: 'lrm5-single', q: 1, n: 'LRM 5', t: 'M', p: 0, l: 'RA' } as any];

        const { service } = createService(bundle, {
            automaticallyConvertFiltersToSemantic: true,
        });
        service.setFilter('componentName', {
            'LRM 5': {
                name: 'LRM 5',
                state: 'or',
                count: 2,
            },
        });

        expect(service.searchText()).toContain('equipment="LRM 5:>=2"');
        expect(service.filteredUnits().map(unit => unit.name)).toEqual(['LRM Carrier']);
    });

    it('matches direct semantic equipment quantity filters greater than one', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the dropdown test.');
            return;
        }

        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.units.units[0].name = 'LRM Carrier';
        bundle.units.units[0].chassis = 'LRM Carrier';
        bundle.units.units[0].comp = [
            { id: 'lrm5-left', q: 2, n: 'LRM 5', t: 'M', p: 0, l: 'LT' } as any,
            { id: 'lrm5-right', q: 4, n: 'LRM 5', t: 'M', p: 0, l: 'RT' } as any,
        ];
        bundle.units.units[1].name = 'Single LRM Scout';
        bundle.units.units[1].chassis = 'Single LRM Scout';
        bundle.units.units[1].comp = [{ id: 'lrm5-single', q: 1, n: 'LRM 5', t: 'M', p: 0, l: 'RA' } as any];

        const { service } = createService(bundle);
        service.searchText.set('equipment="LRM 5:>=2"');

        expect(service.filteredUnits().map(unit => unit.name)).toEqual(['LRM Carrier']);
    });

    it('serializes worker execution queries for component counts as minimum constraints', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the worker quantity test.');
            return;
        }

        const worker = new FakeSearchWorker();
        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.units.units[0].name = 'LRM Boat';
        bundle.units.units[0].chassis = 'LRM Boat';
        bundle.units.units[0].comp = [
            { id: 'lrm5-left', q: 2, n: 'LRM 5', t: 'M', p: 0, l: 'LT' } as any,
            { id: 'lrm5-right', q: 4, n: 'LRM 5', t: 'M', p: 0, l: 'RT' } as any,
        ];
        bundle.units.units[1].name = 'Single LRM Scout';
        bundle.units.units[1].chassis = 'Single LRM Scout';
        bundle.units.units[1].comp = [{ id: 'lrm5-single', q: 1, n: 'LRM 5', t: 'M', p: 0, l: 'RA' } as any];

        const { service } = createService(bundle, {
            workerFactory: () => worker,
        });

        service.setFilter('componentName', {
            'LRM 5': {
                name: 'LRM 5',
                state: 'or',
                count: 2,
            },
        });

        const request = (service as any).buildWorkerSearchRequest((service as any).getWorkerCorpusVersion());

        expect(request.executionQuery).toContain('equipment="LRM 5:>=2"');

    });

    it('matches mixed component count and AND equipment semantic filters', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the equipment AND test.');
            return;
        }

        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.units.units[0].name = 'LRM Ammo Carrier';
        bundle.units.units[0].chassis = 'LRM Ammo Carrier';
        bundle.units.units[0].comp = [
            { id: 'lrm5-left', q: 2, n: 'LRM 5', t: 'M', p: 0, l: 'LT' } as any,
            { id: 'lrm5-right', q: 4, n: 'LRM 5', t: 'M', p: 0, l: 'RT' } as any,
            { id: 'lrm5-ammo', q: 1, n: 'LRM 5 Ammo', t: 'A', p: 0, l: 'CT' } as any,
        ];
        bundle.units.units[1].name = 'LRM Battery';
        bundle.units.units[1].chassis = 'LRM Battery';
        bundle.units.units[1].comp = [
            { id: 'lrm5-left', q: 2, n: 'LRM 5', t: 'M', p: 0, l: 'LT' } as any,
            { id: 'lrm5-right', q: 4, n: 'LRM 5', t: 'M', p: 0, l: 'RT' } as any,
        ];

        const { service } = createService(bundle);
        service.searchText.set('equipment="LRM 5:>=6" equipment&="LRM 5 Ammo"');

        expect(service.filteredUnits().map(unit => unit.name)).toEqual(['LRM Ammo Carrier']);
    });

    it('serializes mixed component OR and AND selections into separate worker tokens', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the worker quantity test.');
            return;
        }

        const worker = new FakeSearchWorker();
        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.units.units[0].comp = [
            { id: 'lrm5-left', q: 2, n: 'LRM 5', t: 'M', p: 0, l: 'LT' } as any,
            { id: 'lrm5-right', q: 4, n: 'LRM 5', t: 'M', p: 0, l: 'RT' } as any,
            { id: 'lrm5-ammo', q: 1, n: 'LRM 5 Ammo', t: 'A', p: 0, l: 'CT' } as any,
        ];

        const { service } = createService(bundle, {
            workerFactory: () => worker,
        });

        service.setFilter('componentName', {
            'LRM 5': {
                name: 'LRM 5',
                state: 'or',
                count: 6,
            },
            'LRM 5 Ammo': {
                name: 'LRM 5 Ammo',
                state: 'and',
                count: 1,
            },
        });

        const request = (service as any).buildWorkerSearchRequest((service as any).getWorkerCorpusVersion());

        expect(request.executionQuery).toContain('equipment="LRM 5:>=6"');
        expect(request.executionQuery).toContain('equipment&="LRM 5 Ammo"');
    });

    it('preserves semantic-only chassis filters in worker execution queries', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the worker semantic filter test.');
            return;
        }

        const worker = new FakeSearchWorker();
        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.units.units[0].name = 'Longbow Prime';
        bundle.units.units[0].chassis = 'Longbow';
        bundle.units.units[1].name = 'Catapult Prime';
        bundle.units.units[1].chassis = 'Catapult';

        const { service } = createService(bundle, {
            workerFactory: () => worker,
        });

        service.searchText.set('chassis="Longbow"');

        const request = (service as any).buildWorkerSearchRequest((service as any).getWorkerCorpusVersion());

        expect(request.executionQuery).toContain('chassis=Longbow');
    });

    it('canonicalizes semantic dropdown values to existing option casing', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the semantic casing test.');
            return;
        }

        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.units.units[0].role = 'Ambusher';
        bundle.units.units[1].role = 'Scout';

        const { service } = createService(bundle);
        service.searchText.set('role=ambusher');

        expect(service.effectiveFilterState()['role']?.value).toEqual(['Ambusher']);
        expect(service.filteredUnits().map(unit => unit.name)).toEqual(['Test Mek']);
    });

    it('builds advanced options for filters from both game modes', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the cross-mode adv options test.');
            return;
        }

        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.units.units[0].as = { ...bundle.units.units[0].as, PV: 25 };
        bundle.units.units[1].as = { ...bundle.units.units[1].as, PV: 40 };

        const { service, gameServiceStub } = createService(bundle);
        gameServiceStub.currentGameSystem.set(GameSystem.CLASSIC);

        const advOptions = service.advOptions();

        expect(advOptions['bv']).toBeDefined();
        expect(advOptions['as.PV']).toBeDefined();
    });

    it('applies alpha strike UI filters while classic mode is active', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the cross-mode filter test.');
            return;
        }

        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.units.units[0].as = { ...bundle.units.units[0].as, PV: 25 };
        bundle.units.units[1].as = { ...bundle.units.units[1].as, PV: 40 };

        const { service, gameServiceStub } = createService(bundle);
        gameServiceStub.currentGameSystem.set(GameSystem.CLASSIC);

        service.setFilter('as.PV', [20, 30]);

        expect(service.filteredUnits().map(unit => unit.name)).toEqual(['Test Mek']);
    });

    it('applies alpha strike semantic filters while classic mode is active', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the cross-mode semantic test.');
            return;
        }

        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.units.units[0].as = { ...bundle.units.units[0].as, PV: 25 };
        bundle.units.units[1].as = { ...bundle.units.units[1].as, PV: 40 };

        const { service, gameServiceStub } = createService(bundle);
        gameServiceStub.currentGameSystem.set(GameSystem.CLASSIC);

        service.searchText.set('pv=20-30');

        expect(service.filteredUnits().map(unit => unit.name)).toEqual(['Test Mek']);
    });

    it('promotes overlapping faction dropdown filters into simple semantic text ownership', async () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the faction promotion test.');
            return;
        }

        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.factions.factions = [
            {
                id: 1,
                name: 'Alyina Mercantile League',
                group: 'IS Clan',
                img: '',
                eras: { 1: new Set([1]) },
            },
            {
                id: 2,
                name: 'Draconis Combine',
                group: 'Inner Sphere',
                img: '',
                eras: { 1: new Set([2]) },
            },
        ];

        const { service } = createService(bundle);
        service.setFilter('faction', {
            'Alyina Mercantile League': {
                name: 'Alyina Mercantile League',
                state: 'or',
                count: 1,
            },
        });

        const promotedText = service.setSearchText('faction="Draconis Combine"');
        await flushAsyncWork();

        expect(promotedText).toContain('faction=');
        expect(promotedText).toContain('Alyina Mercantile League');
        expect(promotedText).toContain('Draconis Combine');
        expect(service.searchText()).toBe(promotedText);
        expect(service.filterState()['faction']).toBeUndefined();

        const effectiveFaction = service.effectiveFilterState()['faction']?.value as Record<string, { state: string }>;
        expect(Object.keys(effectiveFaction ?? {}).sort()).toEqual(['Alyina Mercantile League', 'Draconis Combine']);
        expect(service.filteredUnits().map(unit => unit.name)).toEqual(['Test Mek', 'Test Tank']);
    });

    it('matches semantic faction filters with punctuation-insensitive values', async () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the faction semantic normalization test.');
            return;
        }

        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.factions.factions = [
            {
                id: 1,
                name: "Wolf's Dragoons",
                group: 'Mercenary',
                img: '',
                eras: { 1: new Set([1]) },
            },
            {
                id: 2,
                name: 'Clan Wolf',
                group: 'IS Clan',
                img: '',
                eras: { 1: new Set([2]) },
            },
        ];

        const { service } = createService(bundle);
        service.setSearchText('faction="Wolfs Dragoons"');
        await flushAsyncWork();

        expect(service.filteredUnits().map(unit => unit.name)).toEqual(['Test Mek']);
    });

    it('limits faction results to the selected era when both filters are active', async () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the era-faction intersection test.');
            return;
        }

        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.eras.eras = [
            {
                id: 1,
                name: 'Clan Invasion',
                img: '',
                years: { from: 3049, to: 3061 },
                units: [1, 2],
                factions: [],
            },
            {
                id: 2,
                name: 'Jihad',
                img: '',
                years: { from: 3067, to: 3081 },
                units: [2],
                factions: [],
            },
        ];
        bundle.factions.factions = [
            {
                id: 1,
                name: 'Clan Coyote',
                group: 'IS Clan',
                img: '',
                eras: {
                    1: new Set([1]),
                    2: new Set([2]),
                },
            },
        ];

        const { service } = createService(bundle);
        service.setFilter('era', ['Clan Invasion']);
        service.setFilter('faction', {
            'Clan Coyote': {
                name: 'Clan Coyote',
                state: 'or',
                count: 1,
            },
        });
        await flushAsyncWork();

        expect(service.filteredUnits().map(unit => unit.name)).toEqual(['Test Mek']);

        const workerSnapshot = (service as any).getWorkerCorpusSnapshot((service as any).getWorkerCorpusVersion());
        expect(workerSnapshot.factionEraIndex['Clan Invasion']?.['Clan Coyote']).toEqual(['Test Mek']);
        expect(workerSnapshot.factionEraIndex['Jihad']?.['Clan Coyote']).toEqual(['Test Tank']);
    });

    it('promotes overlapping faction dropdown filters into wildcard semantic ownership', async () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the faction wildcard promotion test.');
            return;
        }

        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.factions.factions = [
            {
                id: 1,
                name: 'Alyina Mercantile League',
                group: 'IS Clan',
                img: '',
                eras: { 1: new Set([1]) },
            },
            {
                id: 2,
                name: 'Draconis Combine',
                group: 'Inner Sphere',
                img: '',
                eras: { 1: new Set([2]) },
            },
        ];

        const { service } = createService(bundle);
        service.setFilter('faction', {
            'Alyina Mercantile League': {
                name: 'Alyina Mercantile League',
                state: 'or',
                count: 1,
            },
        });

        const promotedText = service.setSearchText('faction="draco*"');
        await flushAsyncWork();

        expect(promotedText).toContain('faction=');
        expect(promotedText).toContain('Alyina Mercantile League');
        expect(promotedText).toContain('draco*');
        expect(service.searchText()).toBe(promotedText);
        expect(service.filterState()['faction']).toBeUndefined();
        expect(service.filteredUnits().map(unit => unit.name)).toEqual(['Test Mek', 'Test Tank']);
        const factionOptions = service.advOptions()['faction'];
        expect(factionOptions && factionOptions.type === 'dropdown' ? factionOptions.displayItems : undefined).toEqual([
            { text: 'draco*', state: 'or' },
            { text: 'Alyina Mercantile League', state: 'or' },
        ]);
    });

    it('does not promote overlapping faction filters while a semantic quote is still open', async () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the incomplete semantic faction test.');
            return;
        }

        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.factions.factions = [
            {
                id: 1,
                name: 'Capellan Confederation',
                group: 'Inner Sphere',
                img: '',
                eras: { 1: new Set([1]) },
            },
            {
                id: 2,
                name: 'Draconis Combine',
                group: 'Inner Sphere',
                img: '',
                eras: { 1: new Set([2]) },
            },
        ];

        const { service } = createService(bundle);
        service.setFilter('faction', {
            'Capellan Confederation': {
                name: 'Capellan Confederation',
                state: 'or',
                count: 1,
            },
        });

        const rawText = 'faction="dra';
        const promotedText = service.setSearchText(rawText);
        await flushAsyncWork();

        expect(promotedText).toBe(rawText);
        expect(service.searchText()).toBe(rawText);
        expect(service.filterState()['faction']?.value).toEqual({
            'Capellan Confederation': {
                name: 'Capellan Confederation',
                state: 'or',
                count: 1,
            },
        });
        expect(service.semanticFilterKeys().has('faction')).toBeFalse();
        expect(service.effectiveFilterState()['faction']?.value).toEqual({
            'Capellan Confederation': {
                name: 'Capellan Confederation',
                state: 'or',
                count: 1,
            },
        });
    });

    it('keeps linked semantic-only filters when syncing another filter to text', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the semantic sync test.');
            return;
        }

        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.units.units[0].name = 'Longbow Prime';
        bundle.units.units[0].chassis = 'Longbow';
        bundle.units.units[0].comp = [
            { id: 'LRM 5', q: 2, n: 'LRM 5', t: 'M', p: 0, l: 'LT' } as any,
            { id: 'LRM 5', q: 4, n: 'LRM 5', t: 'M', p: 0, l: 'RT' } as any,
        ];
        bundle.units.units[1].name = 'Catapult Prime';
        bundle.units.units[1].chassis = 'Catapult';
        bundle.units.units[1].comp = [
            { id: 'LRM 5', q: 1, n: 'LRM 5', t: 'M', p: 0, l: 'RA' } as any,
        ];

        const { service } = createService(bundle, {
            automaticallyConvertFiltersToSemantic: true,
        });
        service.searchText.set('chassis="Longbow"');
        service.setFilter('componentName', {
            'LRM 5': {
                name: 'LRM 5',
                state: 'or',
                count: 6,
            },
        });

        expect(service.searchText()).toContain('chassis=Longbow');
        expect(service.searchText()).toContain('equipment="LRM 5:>=6"');
        expect(service.filteredUnits().map(unit => unit.name)).toEqual(['Longbow Prime']);
    });

    it('keeps tag options stable and marks out-of-context entries unavailable', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the dropdown test.');
            return;
        }

        const { service } = createService(buildSmallBundle(benchmarkBundle));
        service.setFilter('type', ['Mek']);

        const tagOptions = service.advOptions()['_tags']?.options ?? [];
        const namedTagOptions = tagOptions.filter(option => typeof option !== 'number');
        const availableTag = namedTagOptions.find(option => option.name === 'tag-a');
        const unavailableTag = namedTagOptions.find(option => option.name === 'tag-b');

        expect(namedTagOptions.length).toBe(2);
        expect(availableTag).toEqual(jasmine.objectContaining({ name: 'tag-a', available: true }));
        expect(unavailableTag).toEqual(jasmine.objectContaining({ name: 'tag-b', available: false }));
    });

    it('updates the indexed _tags universe when tag data changes', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the tag index test.');
            return;
        }

        const { dataService, service } = createService(buildSmallBundle(benchmarkBundle));
        const initialTagIds = dataService.getIndexedUnitIds('_tags', 'tag-a');

        expect(initialTagIds?.has('Test Mek')).toBeTrue();

        (dataService as any).applyTagDataToUnits({
            tags: {
                alpha: {
                    label: 'alpha-tag',
                    units: { 'Test Mek': {} },
                    chassis: {},
                },
                beta: {
                    label: 'beta-tag',
                    units: { 'Test Tank': {} },
                    chassis: {},
                },
            },
            timestamp: 1,
            formatVersion: 3,
        });

        const indexedAlphaIds = dataService.getIndexedUnitIds('_tags', 'alpha-tag');
        const indexedBetaIds = dataService.getIndexedUnitIds('_tags', 'beta-tag');
        const dropdownUniverse = dataService.getDropdownOptionUniverse('_tags').map(option => option.name);
        const tagOptions = service.advOptions()['_tags']?.options ?? [];
        const namedTagOptions = tagOptions.filter(option => typeof option !== 'number');

        expect(dataService.getIndexedUnitIds('_tags', 'tag-a')).toBeUndefined();
        expect(indexedAlphaIds?.has('Test Mek')).toBeTrue();
        expect(indexedBetaIds?.has('Test Tank')).toBeTrue();
        expect(dropdownUniverse).toEqual(['alpha-tag', 'beta-tag']);
        expect(namedTagOptions.map(option => option.name)).toEqual(['alpha-tag', 'beta-tag']);
    });

    it('keeps Alpha Strike specials stable and marks out-of-context entries unavailable', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the dropdown test.');
            return;
        }

        const { service, gameServiceStub } = createService(buildSmallBundle(benchmarkBundle));
        gameServiceStub.currentGameSystem.set(GameSystem.ALPHA_STRIKE);
        service.setFilter('as.TP', ['BM']);

        const specialsOptions = service.advOptions()['as.specials']?.options ?? [];
        const namedSpecialsOptions = specialsOptions.filter(option => typeof option !== 'number');
        const availableSpecial = namedSpecialsOptions.find(option => option.name === 'ECM');
        const unavailableSpecial = namedSpecialsOptions.find(option => option.name === 'TAG');

        expect(namedSpecialsOptions.length).toBe(2);
        expect(availableSpecial).toEqual(jasmine.objectContaining({ name: 'ECM', available: true }));
        expect(unavailableSpecial).toEqual(jasmine.objectContaining({ name: 'TAG', available: false }));
    });

    it('captures advOptions telemetry with per-filter timings', async () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length === 0) {
            pending('Real unit data could not be loaded for the advOptions telemetry test.');
            return;
        }

        const { service } = createService();
        service.searchText.set('crab');
        service.setFilter('type', ['Mek']);

        const advOptions = service.advOptions();
        expect(Object.keys(advOptions).length).toBeGreaterThan(0);
        expect(service.advOptionsTelemetry()).toBeNull();

        await Promise.resolve();

        const telemetry = service.advOptionsTelemetry();
        const componentStage = telemetry?.filters.find(stage => stage.key === 'componentName');

        expect(telemetry).not.toBeNull();
        expect(telemetry?.query).toBe('crab');
        expect(telemetry?.baseUnitCount).toBe(10000);
        expect(telemetry?.textFilteredUnitCount).toBeLessThanOrEqual(telemetry?.baseUnitCount ?? 0);
        expect(telemetry?.visibleFilterCount).toBeGreaterThan(0);
        expect(componentStage).toEqual(jasmine.objectContaining({ key: 'componentName', type: 'dropdown' }));
        expect(componentStage?.optionCount).toBeGreaterThan(0);
        expect(componentStage?.contextUnitCount).toBeGreaterThan(0);
        expect(componentStage?.contextDerivationMs).toBeGreaterThanOrEqual(0);
        expect(componentStage?.contextStrategy).toBe('fully-filtered');
    });

    it('captures excluded-filter context derivation telemetry for interacted filters', async () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the advOptions context telemetry test.');
            return;
        }

        const { service } = createService(buildSmallBundle(benchmarkBundle));
        service.setFilter('type', ['Mek']);
        service.setFilter('subtype', ['BattleMek']);

        const advOptions = service.advOptions();
        expect(Object.keys(advOptions).length).toBeGreaterThan(0);

        await Promise.resolve();

        const telemetry = service.advOptionsTelemetry();
        const typeStage = telemetry?.filters.find(stage => stage.key === 'type');
        const subtypeStage = telemetry?.filters.find(stage => stage.key === 'subtype');

        expect(typeStage?.contextStrategy).toBe('excluded-filter');
        expect(subtypeStage?.contextStrategy).toBe('excluded-filter');
        expect(typeStage?.contextDerivationMs).toBeGreaterThanOrEqual(0);
        expect(subtypeStage?.contextDerivationMs).toBeGreaterThanOrEqual(0);
    });

    it('tracks context derivation strategy across active filter counts', async () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the advOptions context strategy test.');
            return;
        }

        const { service } = createService(buildSmallBundle(benchmarkBundle));

        const getStrategyCounts = async (configure: (service: UnitSearchFiltersService) => void) => {
            service.resetFilters();
            await flushAsyncWork();

            configure(service);
            service.advOptions();
            await flushAsyncWork();

            const filters = service.advOptionsTelemetry()?.filters ?? [];
            return {
                excluded: filters.filter(s => s.contextStrategy === 'excluded-filter').length,
                base: filters.filter(s => s.contextStrategy === 'base-units').length,
            };
        };

        const oneFilter = await getStrategyCounts(service => {
            service.setFilter('type', ['Mek']);
        });
        const twoFilters = await getStrategyCounts(service => {
            service.setFilter('type', ['Mek']);
            service.setFilter('subtype', ['BattleMek']);
        });
        const threeFilters = await getStrategyCounts(service => {
            service.setFilter('type', ['Mek']);
            service.setFilter('subtype', ['BattleMek']);
            service.setFilter('techBase', ['Inner Sphere']);
        });

        expect(oneFilter.excluded).toBe(0);
        expect(oneFilter.base).toBeGreaterThan(0);
        expect(twoFilters.excluded).toBe(2);
        expect(threeFilters.excluded).toBe(3);
    });

    // Manual diagnostic benchmark: run with xit -> it to enable
    xit('benchmarks advOptions telemetry for componentName, source, role, faction, and era filters', async () => {
        if (!sharedService) {
            pending('Real unit data could not be loaded for the advOptions filter benchmark test.');
            return;
        }

        const service = sharedService;
        service.resetFilters();

        const pickFirstAvailableOption = (service: UnitSearchFiltersService, key: string): string => {
            const filter = service.advOptions()[key];
            if (!filter || filter.type !== 'dropdown') {
                throw new Error(`Expected dropdown filter for ${key}`);
            }

            const option = filter.options.find(entry => entry.available !== false);
            if (!option) {
                throw new Error(`Expected at least one available option for ${key}`);
            }

            return option.name;
        };

        const selectedValues = {
            componentName: pickFirstAvailableOption(service, 'componentName'),
            source: pickFirstAvailableOption(service, 'source'),
            role: pickFirstAvailableOption(service, 'role'),
            faction: pickFirstAvailableOption(service, 'faction'),
            era: pickFirstAvailableOption(service, 'era'),
        };

        const measureScenario = async (
            label: string,
            configure: (service: UnitSearchFiltersService, selectedValues: {
                componentName: string;
                source: string;
                role: string;
                faction: string;
                era: string;
            }) => void,
        ) => {
            service.resetFilters();
            await flushAsyncWork();

            configure(service, selectedValues);

            const filteredUnits = service.filteredUnits();
            const advOptions = service.advOptions();
            expect(Object.keys(advOptions).length).toBeGreaterThan(0);

            await flushAsyncWork();

            const telemetry = service.advOptionsTelemetry();
            expect(telemetry).not.toBeNull();

            const filters = telemetry?.filters ?? [];
            return {
                label,
                selectedValue: selectedValues[label as keyof typeof selectedValues],
                resultCount: filteredUnits.length,
                totalMs: Number((telemetry?.totalMs ?? 0).toFixed(2)),
                totalContextDerivationMs: Number(filters.reduce((sum, stage) => sum + stage.contextDerivationMs, 0).toFixed(2)),
                slowestContextStages: filters
                    .slice()
                    .sort((a, b) => b.contextDerivationMs - a.contextDerivationMs)
                    .slice(0, 5)
                    .map(stage => ({
                        key: stage.key,
                        strategy: stage.contextStrategy,
                        contextDerivationMs: Number(stage.contextDerivationMs.toFixed(2)),
                        contextUnitCount: stage.contextUnitCount,
                    })),
            };
        };

        const report = [
            await measureScenario('componentName', (service, selectedValues) => {
                service.setFilter('componentName', {
                    [selectedValues.componentName]: {
                        name: selectedValues.componentName,
                        state: 'or',
                        count: 1,
                    },
                });
            }),
            await measureScenario('source', (service, selectedValues) => {
                service.setFilter('source', {
                    [selectedValues.source]: {
                        name: selectedValues.source,
                        state: 'or',
                        count: 1,
                    },
                });
            }),
            await measureScenario('role', (service, selectedValues) => {
                service.setFilter('role', [selectedValues.role]);
            }),
            await measureScenario('faction', (service, selectedValues) => {
                service.setFilter('faction', {
                    [selectedValues.faction]: {
                        name: selectedValues.faction,
                        state: 'or',
                        count: 1,
                    },
                });
            }),
            await measureScenario('era', (service, selectedValues) => {
                service.setFilter('era', [selectedValues.era]);
            }),
        ];

        console.info('ADV_OPTIONS_FILTER_BENCH', JSON.stringify(report));

        expect(report.length).toBe(5);
        expect(report.every(entry => entry.totalMs >= 0)).toBeTrue();
    });

    it('does not write to logger signals synchronously while filteredUnits is computing', async () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length === 0) {
            pending('Real unit data could not be loaded for the logger regression test.');
            return;
        }

        const { service, logger } = createService(undefined, { useRealLogger: true });
        const loggerService = logger as LoggerService;
        spyOn(console, 'log');
        (service as any).slowSearchTelemetryThresholdMs = 0;

        service.searchText.set('crab bv=1000-3000');

        expect(() => service.filteredUnits()).not.toThrow();
        expect(service.searchTelemetry()).toBeNull();

        await Promise.resolve();

        expect(service.searchTelemetry()).not.toBeNull();
        expect(loggerService.logs().some(entry => entry.message.includes('Unit search telemetry:'))).toBeTrue();
    });

    it('uses worker results when a worker factory is provided', async () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the worker integration test.');
            return;
        }

        const worker = new FakeSearchWorker();
        const bundle = buildSmallBundle(benchmarkBundle);
        const { service } = createService(bundle, {
            workerFactory: () => worker,
        });

        service.searchText.set('Test Mek');
        service.filteredUnits();
        expect((service as any).workerSearchEnabled()).toBeTrue();
        const corpusVersion = (service as any).getWorkerCorpusVersion();
        const snapshot = (service as any).getWorkerCorpusSnapshot(corpusVersion);
        const request = (service as any).buildWorkerSearchRequest(corpusVersion);
        (service as any).searchWorkerClient.submit(snapshot, request);

        const initMessage = worker.messages.at(-1) as any;
        expect(initMessage).toBeTruthy();

        worker.emit({ type: 'ready', corpusVersion: initMessage.snapshot.corpusVersion });
        await flushAsyncWork();

        const executeMessage = worker.messages.filter((message: any) => message.type === 'execute').at(-1) as any;
        expect(executeMessage).toBeTruthy();

        worker.emit({
            type: 'result',
            revision: executeMessage.request.revision,
            corpusVersion: executeMessage.request.corpusVersion,
            telemetryQuery: executeMessage.request.telemetryQuery,
            unitNames: [bundle.units.units[0].name],
            stages: [],
            totalMs: 1,
            unitCount: 2,
            isComplex: false,
        });
        await flushAsyncWork();

        expect(service.filteredUnits().map(unit => unit.name)).toEqual(['Test Mek']);
    });

    it('ignores stale worker results and applies only the latest response', async () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the worker integration test.');
            return;
        }

        const worker = new FakeSearchWorker();
        const bundle = buildSmallBundle(benchmarkBundle);
        const { service } = createService(bundle, {
            workerFactory: () => worker,
        });

        service.searchText.set('Test Mek');
        service.filteredUnits();
        expect((service as any).workerSearchEnabled()).toBeTrue();
        const initialCorpusVersion = (service as any).getWorkerCorpusVersion();
        const initialSnapshot = (service as any).getWorkerCorpusSnapshot(initialCorpusVersion);
        const initialRequest = (service as any).buildWorkerSearchRequest(initialCorpusVersion);
        (service as any).searchWorkerClient.submit(initialSnapshot, initialRequest);

        const initMessage = worker.messages.at(-1) as any;
        worker.emit({ type: 'ready', corpusVersion: initMessage.snapshot.corpusVersion });
        await flushAsyncWork();

        const firstExecute = worker.messages.filter((message: any) => message.type === 'execute').at(-1) as any;
        service.searchText.set('Test Tank');
        service.filteredUnits();
        const nextCorpusVersion = (service as any).getWorkerCorpusVersion();
        const nextSnapshot = (service as any).getWorkerCorpusSnapshot(nextCorpusVersion);
        const nextRequest = (service as any).buildWorkerSearchRequest(nextCorpusVersion);
        (service as any).searchWorkerClient.submit(nextSnapshot, nextRequest);
        const secondExecute = worker.messages.filter((message: any) => message.type === 'execute').at(-1) as any;

        worker.emit({
            type: 'result',
            revision: firstExecute.request.revision,
            corpusVersion: firstExecute.request.corpusVersion,
            telemetryQuery: firstExecute.request.telemetryQuery,
            unitNames: [bundle.units.units[0].name],
            stages: [],
            totalMs: 1,
            unitCount: 2,
            isComplex: false,
        });
        await flushAsyncWork();

        expect(service.filteredUnits()).toEqual([]);

        worker.emit({
            type: 'result',
            revision: secondExecute.request.revision,
            corpusVersion: secondExecute.request.corpusVersion,
            telemetryQuery: secondExecute.request.telemetryQuery,
            unitNames: [bundle.units.units[1].name],
            stages: [],
            totalMs: 1,
            unitCount: 2,
            isComplex: false,
        });
        await flushAsyncWork();

        expect(service.filteredUnits().map(unit => unit.name)).toEqual(['Test Tank']);
    });

    it('falls back to synchronous execution when the worker fails', async () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the worker integration test.');
            return;
        }

        const worker = new FakeSearchWorker();
        const { service } = createService(buildSmallBundle(benchmarkBundle), {
            workerFactory: () => worker,
        });

        service.searchText.set('type=Mek');
        service.filteredUnits();
        expect((service as any).workerSearchEnabled()).toBeTrue();
        const corpusVersion = (service as any).getWorkerCorpusVersion();
        const snapshot = (service as any).getWorkerCorpusSnapshot(corpusVersion);
        const request = (service as any).buildWorkerSearchRequest(corpusVersion);
        (service as any).searchWorkerClient.submit(snapshot, request);
        worker.fail('boom');
        await flushAsyncWork();

        expect(service.filteredUnits().map(unit => unit.name)).toEqual(['Test Mek']);
    });
});