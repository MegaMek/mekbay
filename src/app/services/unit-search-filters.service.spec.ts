import { provideZonelessChangeDetection, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { Eras } from '../models/eras.model';
import type { MULFactions } from '../models/mulfactions.model';
import { MULFACTION_EXTINCT } from '../models/mulfactions.model';
import type { AvailabilitySource } from '../models/options.model';
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
import { MEGAMEK_AVAILABILITY_UNKNOWN, type MegaMekWeightedAvailabilityRecord } from '../models/megamek/availability.model';
import { MEGAMEK_RARITY_PRODUCTION_SORT_KEY } from './unit-search-filters.model';
import { SEARCH_WORKER_FACTORY } from '../utils/unit-search-worker-factory.util';
import type { SearchWorkerLike } from '../utils/unit-search-worker-client.util';
import type { UnitSearchWorkerResponseMessage } from '../utils/unit-search-worker-protocol.util';

const originalJasmineTimeoutInterval = jasmine.DEFAULT_TIMEOUT_INTERVAL;
jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;

interface BenchmarkBundle {
    units: Units;
    factions: MULFactions;
    eras: Eras;
}

interface SyntheticMegaMekRarityBenchmarkScenario {
    bundle: BenchmarkBundle;
    availabilityRecords: MegaMekWeightedAvailabilityRecord[];
    availabilityRecordsByName: ReadonlyMap<string, MegaMekWeightedAvailabilityRecord>;
    expectedTopScore: number;
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

function createTestUnit(overrides: Partial<Unit>): Unit {
    return {
        name: 'Test Unit',
        id: 1,
        chassis: 'Test Unit',
        model: 'Prime',
        year: 3050,
        weightClass: 'Medium',
        tons: 50,
        offSpeedFactor: 0,
        bv: 1000,
        pv: 35,
        cost: 1000000,
        level: 2,
        techBase: 'Inner Sphere',
        techRating: 'D',
        type: 'Mek',
        subtype: 'BattleMek',
        omni: 0,
        engine: 'Fusion',
        engineRating: 250,
        engineHS: 10,
        engineHSType: 'Heat Sink',
        source: ['SRC-A'],
        role: 'Skirmisher',
        armorType: 'Standard',
        structureType: 'Standard',
        armor: 100,
        armorPer: 80,
        internal: 50,
        heat: 10,
        dissipation: 10,
        moveType: 'Biped',
        walk: 5,
        walk2: 5,
        run: 8,
        run2: 8,
        jump: 0,
        jump2: 0,
        umu: 0,
        c3: '',
        dpt: 10,
        comp: [{ id: 'laser', q: 1, n: 'Laser', t: 'E', p: 0, l: 'CT' }],
        su: 1,
        crewSize: 1,
        quirks: [],
        features: [],
        icon: '',
        sheets: [],
        as: {
            TP: 'BM',
            PV: 35,
            SZ: 2,
            TMM: 1,
            usesOV: false,
            OV: 0,
            MV: '8',
            MVm: { '': 8 },
            usesTh: false,
            Th: 0,
            Arm: 4,
            Str: 4,
            specials: [],
            dmg: {
                dmgS: '3',
                dmgM: '2',
                dmgL: '1',
                dmgE: '0',
            },
            usesE: false,
            usesArcs: false,
        },
        _searchKey: '',
        _displayType: '',
        _maxRange: 0,
        _dissipationEfficiency: 0,
        _mdSumNoPhysical: 0,
        _mdSumNoPhysicalNoOneshots: 0,
        _nameTags: [],
        _chassisTags: [],
        _publicTags: [],
        ...overrides,
    };
}

function createStandaloneBundle(): BenchmarkBundle {
    const firstUnit = createTestUnit({
        id: 1,
        name: 'Test Mek',
        chassis: 'Test Mek',
        model: 'Prime',
        type: 'Mek',
        subtype: 'BattleMek',
        source: ['SRC-A'],
        quirks: ['Accurate Weapon'],
        features: ['CASE'],
        as: {
            ...createTestUnit({}).as,
            TP: 'BM',
            specials: ['ECM'],
        },
        _nameTags: ['tag-a'],
    });
    const secondUnit = createTestUnit({
        id: 2,
        name: 'Test Tank',
        chassis: 'Test Tank',
        model: 'A',
        type: 'Tank',
        subtype: 'Combat Vehicle',
        moveType: 'Tracked',
        source: ['SRC-B'],
        comp: [{ id: 'cannon', q: 1, n: 'Cannon', t: 'B', p: 0, l: 'FR' }],
        quirks: ['Poor Performance'],
        features: ['Amphibious'],
        as: {
            ...createTestUnit({}).as,
            TP: 'CV',
            specials: ['TAG'],
        },
        _nameTags: ['tag-b'],
    });

    return {
        units: {
            version: 'test',
            etag: 'test',
            units: [firstUnit, secondUnit],
        },
        eras: {
            version: 'test',
            etag: 'test',
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
            version: 'test',
            etag: 'test',
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

function buildSyntheticMegaMekRarityBenchmarkScenario(targetCount: number): SyntheticMegaMekRarityBenchmarkScenario {
    const bundle = buildBenchmarkBundle(createStandaloneBundle(), targetCount);
    let expectedTopScore = -1;

    const availabilityRecords = bundle.units.units.flatMap((unit, index) => {
        if (index % 13 === 0) {
            return [];
        }

        let productionScore = (index % 10) + 1;
        let salvageScore = (((index + 3) % 8) + 1) * 1.2;

        if (index % 10 === 0) {
            productionScore = 0;
        }
        if (index % 15 === 0) {
            salvageScore = 0;
        }

        const effectiveScore = Math.max(productionScore, salvageScore);
        expectedTopScore = Math.max(expectedTopScore, effectiveScore);

        return [{
            n: unit.name,
            e: {
                '1': {
                    '1': [productionScore, salvageScore] as [number, number],
                },
            },
        }];
    });

    const availabilityRecordsByName = new Map(
        availabilityRecords.map(record => [record.n, record] as const)
    );

    return {
        bundle,
        availabilityRecords,
        availabilityRecordsByName,
        expectedTopScore,
    };
}

function hydrateDataService(dataService: DataService, bundle: BenchmarkBundle): void {
    (dataService as any).unitsCatalog.hydrate(cloneUnit(bundle.units));
    (dataService as any).erasCatalog.hydrate(cloneUnit(bundle.eras));
    (dataService as any).factionsCatalog.hydrate(cloneUnit(bundle.factions));
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
                availabilitySource: 'mul' as AvailabilitySource,
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
                factions: await factionsResponse.json() as MULFactions,
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

    afterAll(() => {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = originalJasmineTimeoutInterval;
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

    xit('recomputes search results when the search corpus is refreshed', async () => {
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

        (dataService as any).forcePackToLookupKey = new Map([
            ['stale-pack', new Set(['Stale Unit|Mek|BattleMek'])],
        ]);
        (dataService as any).lookupKeyToForcePacks = new Map([
            ['Stale Unit|Mek|BattleMek', ['stale-pack']],
        ]);

        dataService.refreshSearchCorpus();

        expect((dataService as any).forcePackToLookupKey).toBeNull();
        expect((dataService as any).lookupKeyToForcePacks).toBeNull();
    });

    it('ignores the remaining BV/PV cap when computing force generator eligible units', () => {
        const bundle = createStandaloneBundle();
        bundle.units.units[0].bv = 1200;
        bundle.units.units[0].as.PV = 28;
        bundle.units.units[1].bv = 2800;
        bundle.units.units[1].as.PV = 55;

        const { service, gameServiceStub } = createService(bundle);

        service.bvPvLimit.set(1500);
        service.forceTotalBvPv.set(0);

        expect(service.filteredUnits().map(unit => unit.name)).toEqual(['Test Mek']);
        expect(service.forceGeneratorEligibleUnits().map(unit => unit.name)).toEqual(['Test Mek', 'Test Tank']);

        gameServiceStub.currentGameSystem.set(GameSystem.ALPHA_STRIKE);
        service.bvPvLimit.set(30);

        expect(service.filteredUnits().map(unit => unit.name)).toEqual(['Test Mek']);
        expect(service.forceGeneratorEligibleUnits().map(unit => unit.name)).toEqual(['Test Mek', 'Test Tank']);
    });

    it('distinguishes force packs by subtype when chassis and type match', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the force pack subtype test.');
            return;
        }

        const FORCE_PACK_NAME = 'Third Star League Battle Group';
        const bundle = buildSmallBundle(benchmarkBundle);
        const [battleMekPeacekeeper, industrialPeacekeeper] = bundle.units.units;

        battleMekPeacekeeper.name = 'BMPeacekeeper_PKP1A';
        battleMekPeacekeeper.chassis = 'Peacekeeper';
        battleMekPeacekeeper.model = 'PKP-1A';
        battleMekPeacekeeper.type = 'Mek';
        battleMekPeacekeeper.subtype = 'BattleMek';
        battleMekPeacekeeper.as = { ...battleMekPeacekeeper.as, TP: 'BM' };

        industrialPeacekeeper.name = 'Peacekeeper_Industrial_Test';
        industrialPeacekeeper.chassis = 'Peacekeeper';
        industrialPeacekeeper.model = 'Industrial';
        industrialPeacekeeper.type = 'Mek';
        industrialPeacekeeper.subtype = 'Industrial Mek';
        industrialPeacekeeper.as = { ...industrialPeacekeeper.as, TP: 'IM' };

        const { dataService, service } = createService(bundle);

        expect(dataService.getForcePacksForUnit(battleMekPeacekeeper)).toContain(FORCE_PACK_NAME);
        expect(dataService.getForcePacksForUnit(industrialPeacekeeper)).not.toContain(FORCE_PACK_NAME);
        expect(dataService.unitBelongsToForcePack(industrialPeacekeeper, FORCE_PACK_NAME)).toBeFalse();

        service.setFilter('subtype', ['Industrial Mek']);

        const forcePackOptions = service.advOptions()['forcePack']?.options ?? [];
        const namedForcePackOptions = forcePackOptions.filter(option => typeof option !== 'number');
        const thirdStarLeagueOption = namedForcePackOptions.find(option => option.name === FORCE_PACK_NAME);

        expect(thirdStarLeagueOption).toEqual(jasmine.objectContaining({ name: FORCE_PACK_NAME, available: false }));

        service.setFilter('forcePack', [FORCE_PACK_NAME]);

        expect(service.filteredUnits()).toEqual([]);
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

    it('filters MegaMek faction dropdown availability by the selected era instead of MUL indexes', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the MegaMek faction availability test.');
            return;
        }

        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.eras.eras = [
            {
                id: 1,
                name: 'Age of War',
                img: '',
                years: {
                    from: 2005,
                    to: 2570,
                },
                units: [1],
                factions: [],
            },
            {
                id: 2,
                name: 'Succession Wars',
                img: '',
                years: {
                    from: 2781,
                    to: 3049,
                },
                units: [1, 2],
                factions: [],
            },
        ];
        bundle.factions.factions = [
            {
                id: 1,
                name: 'Draconis Combine',
                group: 'Inner Sphere',
                img: '',
                eras: {
                    1: new Set([1]),
                    2: new Set([1]),
                },
            },
            {
                id: 2,
                name: 'Federated Suns',
                group: 'Inner Sphere',
                img: '',
                eras: {
                    2: new Set([2]),
                },
            },
            {
                id: 3,
                name: 'Lyran Commonwealth',
                group: 'Inner Sphere',
                img: '',
                eras: {
                    2: new Set([2]),
                },
            },
        ];

        const { dataService, service, optionsServiceStub } = createService(bundle);
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: bundle.units.units[0].name,
                // t: bundle.units.units[0].type,
                // c: bundle.units.units[0].chassis,
                // m: bundle.units.units[0].model,
                e: {
                    '1': { '1': [5, 0] },
                    '2': { '1': [4, 0] },
                },
            },
            {
                n: bundle.units.units[1].name,
                // t: bundle.units.units[1].type,
                // c: bundle.units.units[1].chassis,
                // m: bundle.units.units[1].model,
                e: {
                    '1': { '2': [4, 0] },
                    '2': { '2': [6, 0] },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => (
                record.n === unit.name
            ));
        });

        optionsServiceStub.options.set({
            ...optionsServiceStub.options(),
            availabilitySource: 'megamek',
        });
        service.setFilter('era', ['Age of War']);

        const factionOptions = service.advOptions()['faction']?.options ?? [];
        const namedFactionOptions = factionOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');

        expect(namedFactionOptions.find((option) => option.name === 'Draconis Combine')).toEqual(jasmine.objectContaining({ available: true }));
        expect(namedFactionOptions.find((option) => option.name === 'Federated Suns')).toEqual(jasmine.objectContaining({ available: true }));
        expect(namedFactionOptions.find((option) => option.name === 'Lyran Commonwealth')).toEqual(jasmine.objectContaining({ available: false }));
    });

    it('filters MegaMek era dropdown availability by the selected faction instead of MUL indexes', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the MegaMek era availability test.');
            return;
        }

        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.eras.eras = [
            {
                id: 1,
                name: 'Age of War',
                img: '',
                years: {
                    from: 2005,
                    to: 2570,
                },
                units: [1],
                factions: [],
            },
            {
                id: 2,
                name: 'Succession Wars',
                img: '',
                years: {
                    from: 2781,
                    to: 3049,
                },
                units: [1, 2],
                factions: [],
            },
        ];
        bundle.factions.factions = [
            {
                id: 1,
                name: 'Draconis Combine',
                group: 'Inner Sphere',
                img: '',
                eras: {
                    1: new Set([1]),
                    2: new Set([1]),
                },
            },
            {
                id: 2,
                name: 'Federated Suns',
                group: 'Inner Sphere',
                img: '',
                eras: {
                    2: new Set([2]),
                },
            },
        ];

        const { dataService, service, optionsServiceStub } = createService(bundle);
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: bundle.units.units[0].name,
                // t: bundle.units.units[0].type,
                // c: bundle.units.units[0].chassis,
                // m: bundle.units.units[0].model,
                e: {
                    '1': { '1': [5, 0] },
                    '2': { '1': [4, 0] },
                },
            },
            {
                n: bundle.units.units[1].name,
                // t: bundle.units.units[1].type,
                // c: bundle.units.units[1].chassis,
                // m: bundle.units.units[1].model,
                e: {
                    '1': { '2': [4, 0] },
                    '2': { '2': [6, 0] },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => (
                record.n === unit.name
            ));
        });

        optionsServiceStub.options.set({
            ...optionsServiceStub.options(),
            availabilitySource: 'megamek',
        });
        service.setFilter('faction', {
            'Federated Suns': {
                name: 'Federated Suns',
                state: 'or',
                count: 1,
            },
        });

        const eraOptions = service.advOptions()['era']?.options ?? [];
        const namedEraOptions = eraOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');

        expect(namedEraOptions.find((option) => option.name === 'Age of War')).toEqual(jasmine.objectContaining({ available: true }));
        expect(namedEraOptions.find((option) => option.name === 'Succession Wars')).toEqual(jasmine.objectContaining({ available: true }));
    });

    it('filters MUL era dropdown availability by the selected faction membership', () => {
        const bundle = createStandaloneBundle();
        bundle.eras.eras = [
            {
                id: 1,
                name: 'Clan Invasion',
                img: '',
                years: {
                    from: 3049,
                    to: 3061,
                },
                units: [1, 2],
                factions: [],
            },
            {
                id: 2,
                name: 'ilClan',
                img: '',
                years: {
                    from: 3151,
                    to: 9999,
                },
                units: [1, 2],
                factions: [],
            },
        ];
        bundle.factions.factions = [
            {
                id: 1,
                name: 'Clan Jade Falcon',
                group: 'IS Clan',
                img: '',
                eras: {
                    1: new Set([1]),
                },
            },
            {
                id: 2,
                name: 'Clan Wolf',
                group: 'IS Clan',
                img: '',
                eras: {
                    2: new Set([1]),
                },
            },
        ];

        const { service } = createService(bundle);
        service.setFilter('faction', {
            'Clan Jade Falcon': {
                name: 'Clan Jade Falcon',
                state: 'or',
                count: 1,
            },
        });

        const eraOptions = service.advOptions()['era']?.options ?? [];
        const namedEraOptions = eraOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');

        expect(namedEraOptions.find((option) => option.name === 'Clan Invasion')).toEqual(jasmine.objectContaining({ available: true }));
        expect(namedEraOptions.find((option) => option.name === 'ilClan')).toEqual(jasmine.objectContaining({ available: false }));
    });

    it('filters MUL faction dropdown availability by multistate era membership', () => {
        const bundle = createStandaloneBundle();
        bundle.eras.eras = [
            {
                id: 1,
                name: 'Clan Invasion',
                img: '',
                years: {
                    from: 3049,
                    to: 3061,
                },
                units: [1, 2],
                factions: [],
            },
            {
                id: 2,
                name: 'ilClan',
                img: '',
                years: {
                    from: 3151,
                    to: 9999,
                },
                units: [1, 2],
                factions: [],
            },
        ];
        bundle.factions.factions = [
            {
                id: 1,
                name: 'Clan Jade Falcon',
                group: 'IS Clan',
                img: '',
                eras: {
                    1: new Set([1]),
                },
            },
            {
                id: 2,
                name: 'Clan Wolf',
                group: 'IS Clan',
                img: '',
                eras: {
                    1: new Set([2]),
                    2: new Set([2]),
                },
            },
            {
                id: 3,
                name: 'Clan Sea Fox',
                group: 'IS Clan',
                img: '',
                eras: {
                    2: new Set([1]),
                },
            },
        ];

        const { service } = createService(bundle);
        service.setFilter('era', {
            'Clan Invasion': {
                name: 'Clan Invasion',
                state: 'and',
                count: 1,
            },
            ilClan: {
                name: 'ilClan',
                state: 'and',
                count: 1,
            },
        });

        const factionOptions = service.advOptions()['faction']?.options ?? [];
        const namedFactionOptions = factionOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');

        expect(namedFactionOptions.find((option) => option.name === 'Clan Jade Falcon')).toEqual(jasmine.objectContaining({ available: false }));
        expect(namedFactionOptions.find((option) => option.name === 'Clan Wolf')).toEqual(jasmine.objectContaining({ available: true }));
        expect(namedFactionOptions.find((option) => option.name === 'Clan Sea Fox')).toEqual(jasmine.objectContaining({ available: false }));
    });

    it('keeps era dropdown options in chronological catalog order', () => {
        const bundle = createStandaloneBundle();
        bundle.eras.eras = [
            {
                id: 2,
                name: 'Succession Wars',
                img: '',
                years: {
                    from: 2781,
                    to: 3049,
                },
                units: [1, 2],
                factions: [],
            },
            {
                id: 1,
                name: 'Age of War',
                img: '',
                years: {
                    from: 2005,
                    to: 2570,
                },
                units: [1],
                factions: [],
            },
            {
                id: 3,
                name: 'Clan Invasion',
                img: '',
                years: {
                    from: 3050,
                    to: 3061,
                },
                units: [2],
                factions: [],
            },
        ];
        bundle.factions.factions = [{
            id: 1,
            name: 'Test Faction',
            group: 'Other',
            img: '',
            eras: {
                1: new Set([1]),
                2: new Set([1, 2]),
                3: new Set([2]),
            },
        }];

        const { service } = createService(bundle);
        const eraOptions = service.advOptions()['era']?.options ?? [];
        const namedEraOptions = eraOptions.filter((option): option is { name: string } => typeof option !== 'number');

        expect(namedEraOptions.map((option) => option.name)).toEqual([
            'Age of War',
            'Succession Wars',
            'Clan Invasion',
        ]);
    });

    it('scopes MegaMek faction dropdown availability by Available From and Rarity selections', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the MegaMek availability scope test.');
            return;
        }

        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.units.units[0].name = 'Ymir BWP-2B';
        bundle.units.units[0].chassis = 'Ymir';
        bundle.units.units[0].model = 'BWP-2B';
        bundle.units.units[1].name = 'Other Unit';
        bundle.units.units[1].chassis = 'Other';
        bundle.units.units[1].model = 'OTHER-1';
        bundle.eras.eras = [{
            id: 9,
            name: 'Age of War',
            img: '',
            years: {
                from: 2005,
                to: 2570,
            },
            units: [1],
            factions: [],
        }];
        bundle.factions.factions = [27, 30, 34, 38, 42, 60, 87].map((id) => ({
            id,
            name: `Faction ${id}`,
            group: 'Other',
            img: '',
            eras: {
                9: new Set([1]),
            },
        }));

        const { dataService, service, optionsServiceStub } = createService(bundle);
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: bundle.units.units[0].name,
                // t: 'Mek',
                // c: 'Ymir',
                // m: 'BWP-2B',
                e: {
                    '9': {
                        '27': [0, 1],
                        '30': [0, 1],
                        '34': [0, 1],
                        '38': [0, 1],
                        '42': [0, 1],
                        '60': [6.6, 0],
                        '87': [0, 1],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => (
                record.n === unit.name
            ));
        });

        optionsServiceStub.options.set({
            ...optionsServiceStub.options(),
            availabilitySource: 'megamek',
        });
        service.setFilter('era', ['Age of War']);
        service.searchText.set('BWP-2B');
        service.setFilter('availabilityFrom', ['Production']);

        let factionOptions = service.advOptions()['faction']?.options ?? [];
        let namedFactionOptions = factionOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');

        expect(namedFactionOptions.filter((option) => option.available !== false).map((option) => option.name)).toEqual(['Faction 60']);

        service.setFilter('availabilityFrom', ['Salvage']);

        factionOptions = service.advOptions()['faction']?.options ?? [];
        namedFactionOptions = factionOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');

        expect(namedFactionOptions.filter((option) => option.available !== false).map((option) => option.name)).toEqual([
            'Faction 27',
            'Faction 30',
            'Faction 34',
            'Faction 38',
            'Faction 42',
            'Faction 87',
        ]);

        service.unsetFilter('availabilityFrom');
        service.setFilter('availabilityRarity', ['Common']);

        factionOptions = service.advOptions()['faction']?.options ?? [];
        namedFactionOptions = factionOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');

        expect(namedFactionOptions.filter((option) => option.available !== false).map((option) => option.name)).toEqual(['Faction 60']);

        service.setFilter('availabilityRarity', ['Very Rare']);

        factionOptions = service.advOptions()['faction']?.options ?? [];
        namedFactionOptions = factionOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');

        expect(namedFactionOptions.filter((option) => option.available !== false).map((option) => option.name)).toEqual([
            'Faction 27',
            'Faction 30',
            'Faction 34',
            'Faction 38',
            'Faction 42',
            'Faction 87',
        ]);
    });

    it('scopes MegaMek Available From dropdown availability by the selected rarity', () => {
        const bundle = createStandaloneBundle();
        bundle.units.units[0].name = 'Ymir BWP-2B';
        bundle.units.units[0].chassis = 'Ymir';
        bundle.units.units[0].model = 'BWP-2B';
        bundle.units.units[1].name = 'Other Unit';
        bundle.units.units[1].chassis = 'Other';
        bundle.units.units[1].model = 'OTHER-1';
        bundle.eras.eras = [{
            id: 9,
            name: 'Age of War',
            img: '',
            years: {
                from: 2005,
                to: 2570,
            },
            units: [1],
            factions: [],
        }];
        bundle.factions.factions = [{
            id: 30,
            name: 'Draconis Combine',
            group: 'Inner Sphere',
            img: '',
            eras: {
                9: new Set([1]),
            },
        }];

        const { dataService, service, optionsServiceStub } = createService(bundle);
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: bundle.units.units[0].name,
                e: {
                    '9': {
                        '30': [6.6, 1],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        optionsServiceStub.options.set({
            ...optionsServiceStub.options(),
            availabilitySource: 'megamek',
        });
        service.setFilter('era', ['Age of War']);
        service.setFilter('faction', {
            'Draconis Combine': {
                name: 'Draconis Combine',
                state: 'or',
                count: 1,
            },
        });
        service.setFilter('availabilityRarity', ['Common']);

        let availabilityFromOptions = service.advOptions()['availabilityFrom']?.options ?? [];
        let namedAvailabilityFromOptions = availabilityFromOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');

        expect(namedAvailabilityFromOptions.find((option) => option.name === 'Production')).toEqual(jasmine.objectContaining({ available: true }));
        expect(namedAvailabilityFromOptions.find((option) => option.name === 'Salvage')).toEqual(jasmine.objectContaining({ available: false }));

        service.setFilter('availabilityRarity', ['Very Rare']);

        availabilityFromOptions = service.advOptions()['availabilityFrom']?.options ?? [];
        namedAvailabilityFromOptions = availabilityFromOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');

        expect(namedAvailabilityFromOptions.find((option) => option.name === 'Production')).toEqual(jasmine.objectContaining({ available: false }));
        expect(namedAvailabilityFromOptions.find((option) => option.name === 'Salvage')).toEqual(jasmine.objectContaining({ available: true }));
    });

    it('scopes MegaMek rarity dropdown availability by the highest rarity within era, faction, and source', () => {
        const bundle = createStandaloneBundle();
        bundle.units.units[0].name = 'BattleMaster C3';
        bundle.units.units[0].chassis = 'BattleMaster';
        bundle.units.units[0].model = 'C3';
        bundle.units.units[1].name = 'Other Unit';
        bundle.units.units[1].chassis = 'Other';
        bundle.units.units[1].model = 'OTHER-1';
        bundle.eras.eras = [
            {
                id: 3131,
                name: 'Dark Age',
                img: '',
                years: {
                    from: 3131,
                    to: 3150,
                },
                units: [1],
                factions: [],
            },
            {
                id: 3151,
                name: 'ilClan',
                img: '',
                years: {
                    from: 3151,
                    to: 9999,
                },
                units: [1],
                factions: [],
            },
        ];
        bundle.factions.factions = [
            {
                id: 1,
                name: 'Rasalhague Dominion',
                group: 'IS Clan',
                img: '',
                eras: {
                    3131: new Set([1]),
                    3151: new Set([1]),
                },
            },
            {
                id: 2,
                name: 'Clan Protectorate',
                group: 'IS Clan',
                img: '',
                eras: {
                    3151: new Set([1]),
                },
            },
        ];

        const { dataService, service, optionsServiceStub } = createService(bundle);
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: 'BattleMaster C3',
                e: {
                    '3131': {
                        '1': [2, 2],
                    },
                    '3151': {
                        '1': [2, 2],
                        '2': [7, 0],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        const rasalhagueDominion = {
            'Rasalhague Dominion': {
                name: 'Rasalhague Dominion',
                state: 'or',
                count: 1,
            },
        };

        optionsServiceStub.options.set({
            ...optionsServiceStub.options(),
            availabilitySource: 'megamek',
        });
        service.searchText.set('BattleMaster');
        service.setFilter('era', ['ilClan']);

        let rarityOptions = service.advOptions()['availabilityRarity']?.options ?? [];
        let namedRarityOptions = rarityOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');

        expect(namedRarityOptions.find((option) => option.name === 'Common')).toEqual(jasmine.objectContaining({ available: true }));
        expect(namedRarityOptions.find((option) => option.name === 'Very Rare')).toEqual(jasmine.objectContaining({ available: false }));

        service.setFilter('availabilityFrom', ['Salvage']);

        rarityOptions = service.advOptions()['availabilityRarity']?.options ?? [];
        namedRarityOptions = rarityOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');

        expect(namedRarityOptions.find((option) => option.name === 'Common')).toEqual(jasmine.objectContaining({ available: false }));
        expect(namedRarityOptions.find((option) => option.name === 'Very Rare')).toEqual(jasmine.objectContaining({ available: true }));

        service.setFilter('availabilityFrom', ['Production']);

        rarityOptions = service.advOptions()['availabilityRarity']?.options ?? [];
        namedRarityOptions = rarityOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');

        expect(namedRarityOptions.find((option) => option.name === 'Common')).toEqual(jasmine.objectContaining({ available: true }));
        expect(namedRarityOptions.find((option) => option.name === 'Very Rare')).toEqual(jasmine.objectContaining({ available: false }));

        service.setFilter('faction', rasalhagueDominion);

        rarityOptions = service.advOptions()['availabilityRarity']?.options ?? [];
        namedRarityOptions = rarityOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');

        expect(namedRarityOptions.find((option) => option.name === 'Common')).toEqual(jasmine.objectContaining({ available: false }));
        expect(namedRarityOptions.find((option) => option.name === 'Very Rare')).toEqual(jasmine.objectContaining({ available: true }));
    });

    it('filters MegaMek units by the highest rarity within the selected era, faction, and source', () => {
        const bundle = createStandaloneBundle();
        bundle.units.units[0].name = 'BattleMaster C3';
        bundle.units.units[0].chassis = 'BattleMaster';
        bundle.units.units[0].model = 'C3';
        bundle.units.units[1].name = 'Other Unit';
        bundle.units.units[1].chassis = 'Other';
        bundle.units.units[1].model = 'OTHER-1';
        bundle.eras.eras = [
            {
                id: 3131,
                name: 'Dark Age',
                img: '',
                years: {
                    from: 3131,
                    to: 3150,
                },
                units: [1],
                factions: [],
            },
            {
                id: 3151,
                name: 'ilClan',
                img: '',
                years: {
                    from: 3151,
                    to: 9999,
                },
                units: [1],
                factions: [],
            },
        ];
        bundle.factions.factions = [
            {
                id: 1,
                name: 'Rasalhague Dominion',
                group: 'IS Clan',
                img: '',
                eras: {
                    3131: new Set([1]),
                    3151: new Set([1]),
                },
            },
            {
                id: 2,
                name: 'Clan Protectorate',
                group: 'IS Clan',
                img: '',
                eras: {
                    3151: new Set([1]),
                },
            },
        ];

        const { dataService, service, optionsServiceStub } = createService(bundle);
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: 'BattleMaster C3',
                e: {
                    '3131': {
                        '1': [2, 2],
                    },
                    '3151': {
                        '1': [2, 2],
                        '2': [7, 0],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        const rasalhagueDominion = {
            'Rasalhague Dominion': {
                name: 'Rasalhague Dominion',
                state: 'or',
                count: 1,
            },
        };

        optionsServiceStub.options.set({
            ...optionsServiceStub.options(),
            availabilitySource: 'megamek',
        });
        service.searchText.set('BattleMaster');
        service.setFilter('era', ['ilClan']);
        service.setFilter('availabilityRarity', ['Common']);

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['BattleMaster C3']);

        service.setFilter('availabilityRarity', ['Very Rare']);

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual([]);

        service.setFilter('availabilityFrom', ['Salvage']);

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['BattleMaster C3']);

        service.setFilter('availabilityFrom', ['Production']);

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual([]);

        service.setFilter('faction', rasalhagueDominion);

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['BattleMaster C3']);

        service.setFilter('era', ['Dark Age']);
        service.unsetFilter('faction');
        service.unsetFilter('availabilityFrom');
        service.setFilter('availabilityRarity', ['Common']);

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual([]);

        service.setFilter('availabilityRarity', ['Very Rare']);

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['BattleMaster C3']);
    });

    it('localizes displayed MegaMek badges by era, faction, and source filters', () => {
        const bundle = createStandaloneBundle();
        bundle.units.units[0].name = 'BattleMaster C3';
        bundle.units.units[0].chassis = 'BattleMaster';
        bundle.units.units[0].model = 'C3';
        bundle.eras.eras = [
            {
                id: 3131,
                name: 'Dark Age',
                img: '',
                years: {
                    from: 3131,
                    to: 3150,
                },
                units: [1],
                factions: [],
            },
            {
                id: 3151,
                name: 'ilClan',
                img: '',
                years: {
                    from: 3151,
                    to: 9999,
                },
                units: [1],
                factions: [],
            },
        ];
        bundle.factions.factions = [
            {
                id: 1,
                name: 'Rasalhague Dominion',
                group: 'IS Clan',
                img: '',
                eras: {
                    3131: new Set([1]),
                    3151: new Set([1]),
                },
            },
            {
                id: 2,
                name: 'Clan Protectorate',
                group: 'IS Clan',
                img: '',
                eras: {
                    3151: new Set([1]),
                },
            },
        ];

        const { dataService, service, optionsServiceStub } = createService(bundle);
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: 'BattleMaster C3',
                e: {
                    '3131': {
                        '1': [2, 2],
                    },
                    '3151': {
                        '1': [2, 2],
                        '2': [7, 0],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        const rasalhagueDominion = {
            'Rasalhague Dominion': {
                name: 'Rasalhague Dominion',
                state: 'or',
                count: 1,
            },
        };

        optionsServiceStub.options.set({
            ...optionsServiceStub.options(),
            availabilitySource: 'megamek',
        });

        service.setFilter('era', ['Dark Age']);
        expect(service.getMegaMekAvailabilityBadges(bundle.units.units[0])).toEqual([
            { source: 'Production', score: 2, rarity: 'Very Rare' },
            { source: 'Salvage', score: 2, rarity: 'Very Rare' },
        ]);

        service.setFilter('era', ['ilClan']);
        expect(service.getMegaMekAvailabilityBadges(bundle.units.units[0])).toEqual([
            { source: 'Production', score: 7, rarity: 'Common' },
            { source: 'Salvage', score: 2, rarity: 'Very Rare' },
        ]);

        service.setFilter('availabilityFrom', ['Production']);
        expect(service.getMegaMekAvailabilityBadges(bundle.units.units[0])).toEqual([
            { source: 'Production', score: 7, rarity: 'Common' },
        ]);

        service.setFilter('faction', rasalhagueDominion);
        expect(service.getMegaMekAvailabilityBadges(bundle.units.units[0])).toEqual([
            { source: 'Production', score: 2, rarity: 'Very Rare' },
        ]);
    });

    it('bridges MUL availability badges and rarity filters through MUL faction membership', () => {
        const bundle = createStandaloneBundle();
        bundle.units.units[0].name = 'BattleMaster C3';
        bundle.units.units[0].chassis = 'BattleMaster';
        bundle.units.units[0].model = 'C3';
        bundle.units.units[1].name = 'Other Unit';
        bundle.units.units[1].chassis = 'Other';
        bundle.units.units[1].model = 'OTHER-1';
        bundle.eras.eras = [
            {
                id: 3131,
                name: 'Dark Age',
                img: '',
                years: {
                    from: 3131,
                    to: 3150,
                },
                units: [1],
                factions: [],
            },
            {
                id: 3151,
                name: 'ilClan',
                img: '',
                years: {
                    from: 3151,
                    to: 9999,
                },
                units: [1],
                factions: [],
            },
        ];
        bundle.factions.factions = [
            {
                id: 40,
                name: 'Rasalhague Dominion',
                group: 'IS Clan',
                img: '',
                eras: {
                    3131: new Set([1]),
                    3151: new Set([1]),
                },
            },
            {
                id: 82,
                name: 'Clan Sea Fox',
                group: 'IS Clan',
                img: '',
                eras: {
                    3131: new Set([1]),
                },
            },
            {
                id: 100,
                name: 'Clan Protectorate',
                group: 'IS Clan',
                img: '',
                eras: {
                    3151: new Set([1]),
                },
            },
        ];

        const { dataService, service } = createService(bundle);
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: 'BattleMaster C3',
                e: {
                    '3131': {
                        '40': [2, 0],
                        '82': [0, 1],
                        '100': [7, 0],
                    },
                    '3151': {
                        '40': [2, 0],
                        '100': [7, 0],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        service.searchText.set('BattleMaster');
        service.setFilter('era', ['Dark Age']);

        expect(service.getMegaMekAvailabilityBadges(bundle.units.units[0])).toEqual([
            { source: 'Production', score: 2, rarity: 'Very Rare' },
            { source: 'Salvage', score: 1, rarity: 'Very Rare' },
        ]);

        let rarityOptions = service.advOptions()['availabilityRarity']?.options ?? [];
        let namedRarityOptions = rarityOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');

        expect(namedRarityOptions.find((option) => option.name === 'Common')).toEqual(jasmine.objectContaining({ available: false }));
        expect(namedRarityOptions.find((option) => option.name === 'Very Rare')).toEqual(jasmine.objectContaining({ available: true }));

        service.setFilter('availabilityRarity', ['Common']);
        expect(service.filteredUnits().map((unit) => unit.name)).toEqual([]);

        service.setFilter('availabilityRarity', ['Very Rare']);
        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['BattleMaster C3']);

        service.setFilter('era', ['ilClan']);
        service.setFilter('availabilityRarity', ['Common']);

        let factionOptions = service.advOptions()['faction']?.options ?? [];
        let namedFactionOptions = factionOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');

        expect(namedFactionOptions.find((option) => option.name === 'Clan Protectorate')).toEqual(jasmine.objectContaining({ available: true }));
        expect(namedFactionOptions.find((option) => option.name === 'Rasalhague Dominion')).toEqual(jasmine.objectContaining({ available: false }));

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['BattleMaster C3']);
    });

    it('surfaces Unknown MUL availability options for factions without MegaMek data', () => {
        const bundle = createStandaloneBundle();
        bundle.units.units[0].name = 'BattleMaster C3';
        bundle.units.units[0].chassis = 'BattleMaster';
        bundle.units.units[0].model = 'C3';
        bundle.eras.eras = [{
            id: 3151,
            name: 'ilClan',
            img: '',
            years: {
                from: 3151,
                to: 9999,
            },
            units: [1],
            factions: [],
        }];
        bundle.factions.factions = [
            {
                id: 40,
                name: 'Rasalhague Dominion',
                group: 'IS Clan',
                img: '',
                eras: {
                    3151: new Set([1]),
                },
            },
            {
                id: 100,
                name: 'Clan Protectorate',
                group: 'IS Clan',
                img: '',
                eras: {
                    3151: new Set([1]),
                },
            },
            {
                id: 120,
                name: 'Raven Alliance',
                group: 'IS Clan',
                img: '',
                eras: {
                    3151: new Set([1]),
                },
            },
        ];

        const { dataService, service } = createService(bundle);
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: 'BattleMaster C3',
                e: {
                    '3151': {
                        '40': [2, 0],
                        '100': [7, 0],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        service.searchText.set('BattleMaster');
        service.setFilter('era', ['ilClan']);

        let availabilityFromOptions = service.advOptions()['availabilityFrom']?.options ?? [];
        let namedAvailabilityFromOptions = availabilityFromOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');

        expect(namedAvailabilityFromOptions.find((option) => option.name === 'Unknown')).toEqual(jasmine.objectContaining({ available: true }));
        expect(namedAvailabilityFromOptions.find((option) => option.name === 'Production')).toEqual(jasmine.objectContaining({ available: true }));
        expect(service.getMegaMekAvailabilityBadges(bundle.units.units[0])).toEqual([
            { source: 'Production', score: 7, rarity: 'Common' },
        ]);

        service.setFilter('availabilityFrom', ['Unknown']);
        expect(service.getMegaMekAvailabilityBadges(bundle.units.units[0])).toEqual([
            { source: MEGAMEK_AVAILABILITY_UNKNOWN, score: -1, rarity: MEGAMEK_AVAILABILITY_UNKNOWN },
        ]);

        let factionOptions = service.advOptions()['faction']?.options ?? [];
        let namedFactionOptions = factionOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');
        expect(namedFactionOptions.find((option) => option.name === 'Raven Alliance')).toEqual(jasmine.objectContaining({ available: true }));
        expect(namedFactionOptions.find((option) => option.name === 'Rasalhague Dominion')).toEqual(jasmine.objectContaining({ available: false }));
        expect(namedFactionOptions.find((option) => option.name === 'Clan Protectorate')).toEqual(jasmine.objectContaining({ available: false }));

        let availabilityRarityOptions = service.advOptions()['availabilityRarity']?.options ?? [];
        let namedAvailabilityRarityOptions = availabilityRarityOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');
        expect(namedAvailabilityRarityOptions.filter((option) => option.available !== false).map((option) => option.name)).toEqual(['Unknown']);

        service.unsetFilter('availabilityFrom');
        service.setFilter('availabilityRarity', ['Unknown']);
        expect(service.getMegaMekAvailabilityBadges(bundle.units.units[0])).toEqual([
            { source: MEGAMEK_AVAILABILITY_UNKNOWN, score: -1, rarity: MEGAMEK_AVAILABILITY_UNKNOWN },
        ]);

        factionOptions = service.advOptions()['faction']?.options ?? [];
        namedFactionOptions = factionOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');
        expect(namedFactionOptions.find((option) => option.name === 'Raven Alliance')).toEqual(jasmine.objectContaining({ available: true }));
        expect(namedFactionOptions.find((option) => option.name === 'Rasalhague Dominion')).toEqual(jasmine.objectContaining({ available: false }));
        expect(namedFactionOptions.find((option) => option.name === 'Clan Protectorate')).toEqual(jasmine.objectContaining({ available: false }));

        availabilityFromOptions = service.advOptions()['availabilityFrom']?.options ?? [];
        namedAvailabilityFromOptions = availabilityFromOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');
        expect(namedAvailabilityFromOptions.filter((option) => option.available !== false).map((option) => option.name)).toEqual(['Unknown']);

        service.unsetFilter('availabilityRarity');

        service.setFilter('faction', {
            'Raven Alliance': {
                name: 'Raven Alliance',
                state: 'or',
                count: 1,
            },
        });

        availabilityFromOptions = service.advOptions()['availabilityFrom']?.options ?? [];
        namedAvailabilityFromOptions = availabilityFromOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');
        expect(namedAvailabilityFromOptions.filter((option) => option.available !== false).map((option) => option.name)).toEqual(['Unknown']);

        availabilityRarityOptions = service.advOptions()['availabilityRarity']?.options ?? [];
        namedAvailabilityRarityOptions = availabilityRarityOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');
        expect(namedAvailabilityRarityOptions.filter((option) => option.available !== false).map((option) => option.name)).toEqual(['Unknown']);

        expect(service.getMegaMekAvailabilityBadges(bundle.units.units[0])).toEqual([
            { source: MEGAMEK_AVAILABILITY_UNKNOWN, score: -1, rarity: MEGAMEK_AVAILABILITY_UNKNOWN },
        ]);

        service.setFilter('availabilityRarity', ['Unknown']);

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['BattleMaster C3']);
    });

    it('keeps units without MegaMek availability data visible by default but excludes them when an availability filter is applied', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the MegaMek no-data availability test.');
            return;
        }

        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.units.units[0].name = 'Available Unit';
        bundle.units.units[0].chassis = 'Available Unit';
        bundle.units.units[0].model = 'AVL-1';
        bundle.units.units[1].name = 'Missing Data Unit';
        bundle.units.units[1].id = bundle.units.units[0].id;
        bundle.units.units[1].chassis = 'Missing Data Unit';
        bundle.units.units[1].model = 'MIS-1';
        bundle.eras.eras = [{
            id: 9,
            name: 'Age of War',
            img: '',
            years: {
                from: 2005,
                to: 2570,
            },
            units: [1, 2],
            factions: [],
        }];
        bundle.factions.factions = [{
            id: 60,
            name: 'Faction 60',
            group: 'Other',
            img: '',
            eras: {
                9: new Set([1, 2]),
            },
        }];

        const { dataService, service, optionsServiceStub } = createService(bundle);
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: bundle.units.units[0].name,
                // t: bundle.units.units[0].type,
                // c: bundle.units.units[0].chassis,
                // m: bundle.units.units[0].model,
                e: {
                    '9': {
                        '60': [6.6, 0],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => (
                record.n === unit.name
            ));
        });

        optionsServiceStub.options.set({
            ...optionsServiceStub.options(),
            availabilitySource: 'megamek',
        });

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['Available Unit', 'Missing Data Unit']);

        service.setFilter('era', ['Age of War']);

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['Available Unit']);

        service.resetFilters();

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['Available Unit', 'Missing Data Unit']);
    });

    it('filters MegaMek units by Available From from the UI', () => {
        const bundle = createStandaloneBundle();
        bundle.units.units[0].name = 'Production Unit';
        bundle.units.units[0].chassis = 'Production Unit';
        bundle.units.units[0].model = 'PROD-1';
        bundle.units.units[1].name = 'Salvage Unit';
        bundle.units.units[1].chassis = 'Salvage Unit';
        bundle.units.units[1].model = 'SALV-1';
        bundle.eras.eras[0].units = [1, 2];
        bundle.factions.factions[0].eras[1] = new Set([1, 2]);

        const { dataService, service, optionsServiceStub } = createService(bundle);
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: 'Production Unit',
                e: {
                    '1': {
                        '1': [5, 0],
                    },
                },
            },
            {
                n: 'Salvage Unit',
                e: {
                    '1': {
                        '1': [0, 3],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        optionsServiceStub.options.set({
            ...optionsServiceStub.options(),
            availabilitySource: 'megamek',
        });

        service.setFilter('availabilityFrom', ['Production']);

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['Production Unit']);

        service.setFilter('availabilityFrom', ['Salvage']);

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['Salvage Unit']);
    });

    it('filters MegaMek units by semantic rarity queries', () => {
        const bundle = createStandaloneBundle();
        bundle.units.units[0].name = 'Very Rare Unit';
        bundle.units.units[0].chassis = 'Very Rare Unit';
        bundle.units.units[0].model = 'VR-1';
        bundle.units.units[1].name = 'Common Unit';
        bundle.units.units[1].chassis = 'Common Unit';
        bundle.units.units[1].model = 'COM-1';
        bundle.eras.eras[0].units = [1, 2];
        bundle.factions.factions[0].eras[1] = new Set([1, 2]);

        const { dataService, service, optionsServiceStub } = createService(bundle);
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: 'Very Rare Unit',
                e: {
                    '1': {
                        '1': [1, 0],
                    },
                },
            },
            {
                n: 'Common Unit',
                e: {
                    '1': {
                        '1': [7, 0],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        optionsServiceStub.options.set({
            ...optionsServiceStub.options(),
            availabilitySource: 'megamek',
        });

        service.searchText.set('rarity="very rare"');

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['Very Rare Unit']);
    });

    it('filters MegaMek units by semantic rarity queries while the worker is active', async () => {
        const worker = new FakeSearchWorker();
        const bundle = createStandaloneBundle();
        bundle.units.units[0].name = 'Very Common Crab';
        bundle.units.units[0].chassis = 'Very Common Crab';
        bundle.units.units[0].model = 'VCC-1';
        bundle.units.units[1].name = 'Unknown Crab';
        bundle.units.units[1].chassis = 'Unknown Crab';
        bundle.units.units[1].model = 'UNC-1';
        bundle.eras.eras[0].units = [1, 2];
        bundle.factions.factions[0].eras[1] = new Set([1, 2]);

        const { dataService, service, optionsServiceStub } = createService(bundle, {
            workerFactory: () => worker,
        });
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: 'Very Common Crab',
                e: {
                    '1': {
                        '1': [9, 0],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        await flushAsyncWork();

        optionsServiceStub.options.set({
            ...optionsServiceStub.options(),
            availabilitySource: 'megamek',
        });
        service.searchText.set('crab rarity="very common"');
        service.filteredUnits();

        const corpusVersion = (service as any).getWorkerCorpusVersion();
        const snapshot = (service as any).getWorkerCorpusSnapshot(corpusVersion);
        const request = (service as any).buildWorkerSearchRequest(corpusVersion);

        (service as any).searchWorkerClient.submit(snapshot, request);

        const initMessage = worker.messages.at(-1) as any;
        worker.emit({ type: 'ready', corpusVersion: initMessage.snapshot.corpusVersion });
        await flushAsyncWork();

        const executeMessage = worker.messages.filter((message: any) => message.type === 'execute').at(-1) as any;
        worker.emit({
            type: 'result',
            revision: executeMessage.request.revision,
            corpusVersion: executeMessage.request.corpusVersion,
            telemetryQuery: executeMessage.request.telemetryQuery,
            unitNames: ['Very Common Crab', 'Unknown Crab'],
            stages: [],
            totalMs: 1,
            unitCount: bundle.units.units.length,
            isComplex: false,
        });
        await flushAsyncWork();

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['Very Common Crab']);
    });

    it('filters MegaMek units by semantic Unknown rarity queries while the worker is active', async () => {
        const worker = new FakeSearchWorker();
        const bundle = createStandaloneBundle();
        bundle.units.units[0].name = 'Known Crab';
        bundle.units.units[0].chassis = 'Known Crab';
        bundle.units.units[0].model = 'KNC-1';
        bundle.units.units[1].name = 'Unknown Crab';
        bundle.units.units[1].chassis = 'Unknown Crab';
        bundle.units.units[1].model = 'UNC-1';
        bundle.eras.eras[0].units = [1, 2];
        bundle.factions.factions[0].eras[1] = new Set([1, 2]);

        const { dataService, service, optionsServiceStub } = createService(bundle, {
            workerFactory: () => worker,
        });
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: 'Known Crab',
                e: {
                    '1': {
                        '1': [9, 0],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        await flushAsyncWork();

        optionsServiceStub.options.set({
            ...optionsServiceStub.options(),
            availabilitySource: 'megamek',
        });
        service.searchText.set('crab rarity="unknown"');
        service.filteredUnits();

        const corpusVersion = (service as any).getWorkerCorpusVersion();
        const snapshot = (service as any).getWorkerCorpusSnapshot(corpusVersion);
        const request = (service as any).buildWorkerSearchRequest(corpusVersion);

        (service as any).searchWorkerClient.submit(snapshot, request);

        const initMessage = worker.messages.at(-1) as any;
        worker.emit({ type: 'ready', corpusVersion: initMessage.snapshot.corpusVersion });
        await flushAsyncWork();

        const executeMessage = worker.messages.filter((message: any) => message.type === 'execute').at(-1) as any;
        worker.emit({
            type: 'result',
            revision: executeMessage.request.revision,
            corpusVersion: executeMessage.request.corpusVersion,
            telemetryQuery: executeMessage.request.telemetryQuery,
            unitNames: ['Known Crab', 'Unknown Crab'],
            stages: [],
            totalMs: 1,
            unitCount: bundle.units.units.length,
            isComplex: false,
        });
        await flushAsyncWork();

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['Unknown Crab']);
    });

    it('filters MegaMek units by Unknown rarity from the UI', () => {
        const bundle = createStandaloneBundle();
        bundle.units.units[0].name = 'Known Unit';
        bundle.units.units[0].chassis = 'Known Unit';
        bundle.units.units[0].model = 'KNO-1';
        bundle.units.units[1].name = 'Unknown Unit';
        bundle.units.units[1].chassis = 'Unknown Unit';
        bundle.units.units[1].model = 'UNK-1';
        bundle.eras.eras[0].units = [1, 2];
        bundle.factions.factions[0].eras[1] = new Set([1, 2]);

        const { dataService, service, optionsServiceStub } = createService(bundle);
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: 'Known Unit',
                e: {
                    '1': {
                        '1': [9, 0],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        optionsServiceStub.options.set({
            ...optionsServiceStub.options(),
            availabilitySource: 'megamek',
        });

        service.setFilter('availabilityRarity', ['Unknown']);

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['Unknown Unit']);
    });

    it('sorts by MegaMek rarity even when MUL availability is selected', () => {
        const bundle = createStandaloneBundle();
        const lowUnit = bundle.units.units[0];
        const highUnit = bundle.units.units[1];
        const unknownUnit = createTestUnit({
            id: 3,
            name: 'Unknown Unit',
            chassis: 'Unknown Unit',
            model: 'UNK-1',
        });

        lowUnit.name = 'Low Unit';
        lowUnit.chassis = 'Low Unit';
        lowUnit.model = 'LOW-1';
        highUnit.name = 'High Unit';
        highUnit.chassis = 'High Unit';
        highUnit.model = 'HIGH-1';
        bundle.units.units.push(unknownUnit);
        bundle.eras.eras[0].units = [1, 2, 3];
        bundle.factions.factions[0].eras[1] = new Set([1, 2, 3]);

        const { dataService, service } = createService(bundle);
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: lowUnit.name,
                e: {
                    '1': {
                        '1': [3, 0],
                    },
                },
            },
            {
                n: highUnit.name,
                e: {
                    '1': {
                        '1': [5, 1],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        service.setSortOrder(MEGAMEK_RARITY_PRODUCTION_SORT_KEY);
        service.setSortDirection('desc');

        expect(service.filteredUnits().map(unit => unit.name)).toEqual(['High Unit', 'Low Unit', 'Unknown Unit']);
    });

    it('matches MegaMek Age of War results when the era is expressed as semantic text', () => {
        const bundle = createStandaloneBundle();
        bundle.units.units[0].name = 'Aquarius Escort';
        bundle.units.units[0].chassis = 'Aquarius Escort';
        bundle.units.units[0].model = '';
        bundle.units.units[0].type = 'Aero';
        bundle.units.units[0].subtype = 'Spheroid Small Craft';
        bundle.units.units[0].year = 3050;
        bundle.units.units[0].as = {
            ...bundle.units.units[0].as,
            TP: 'SC',
        };
        bundle.units.units[1].name = 'Later Unit';
        bundle.units.units[1].chassis = 'Later Unit';
        bundle.units.units[1].model = 'L-1';
        bundle.units.units[1].year = 3050;
        bundle.eras.eras = [{
            id: 9,
            name: 'Age of War',
            img: '',
            years: {
                from: 2005,
                to: 2570,
            },
            units: [1, 2],
            factions: [],
        }];
        bundle.factions.factions = [{
            id: 30,
            name: 'Draconis Combine',
            group: 'Inner Sphere',
            img: '',
            eras: {
                9: new Set([1, 2]),
            },
        }];

        const { dataService, service, optionsServiceStub } = createService(bundle);
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: bundle.units.units[0].name,
                e: {
                    '9': {
                        '30': [7.2, 0],
                    },
                },
            },
            {
                n: bundle.units.units[1].name,
                e: {
                    '10': {
                        '30': [7.2, 0],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        optionsServiceStub.options.set({
            ...optionsServiceStub.options(),
            availabilitySource: 'megamek',
        });
        service.searchText.set('era="Age of War"');

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['Aquarius Escort']);
    });

    it('marks the MegaMek Extinct faction as available when extinct units exist', () => {
        const bundle = createStandaloneBundle();
        bundle.units.units[0].name = 'Boomerang';
        bundle.units.units[0].chassis = 'Boomerang';
        bundle.units.units[0].model = 'BMR-1';
        bundle.units.units[1].name = 'Ghost';
        bundle.units.units[1].chassis = 'Ghost';
        bundle.units.units[1].model = 'GST-1';
        bundle.eras.eras = [
            {
                id: 1,
                name: 'Age of War',
                img: '',
                years: { from: 2005, to: 2570 },
                units: [1],
                factions: [],
            },
            {
                id: 2,
                name: 'Star League',
                img: '',
                years: { from: 2571, to: 2780 },
                units: [1],
                factions: [],
            },
            {
                id: 3,
                name: 'Early Succession War',
                img: '',
                years: { from: 2781, to: 2900 },
                units: [1],
                factions: [],
            },
            {
                id: 4,
                name: 'Late Succession War - LosTech',
                img: '',
                years: { from: 2901, to: 3049 },
                units: [1, 2],
                factions: [],
            },
        ];
        bundle.factions.factions = [
            {
                id: 30,
                name: 'Draconis Combine',
                group: 'Inner Sphere',
                img: '',
                eras: {
                    1: new Set([1]),
                    2: new Set([1]),
                    4: new Set([1]),
                },
            },
            {
                id: MULFACTION_EXTINCT,
                name: 'Extinct',
                group: 'Other',
                img: '',
                eras: {},
            },
        ];

        const { dataService, service, optionsServiceStub } = createService(bundle);
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: bundle.units.units[0].name,
                e: {
                    '1': { '30': [6, 0] },
                    '2': { '30': [5, 0] },
                    '4': { '30': [4, 0] },
                },
            },
            {
                n: bundle.units.units[1].name,
                e: {
                    '4': { '30': [4, 0] },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        optionsServiceStub.options.set({
            ...optionsServiceStub.options(),
            availabilitySource: 'megamek',
        });

        const factionOptions = service.advOptions()['faction']?.options ?? [];
        const namedFactionOptions = factionOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');

        expect(namedFactionOptions.find((option) => option.name === 'Extinct')).toEqual(jasmine.objectContaining({ available: true }));
    });

    it('limits MegaMek era dropdown options to eras with extinct units when Extinct is selected', () => {
        const bundle = createStandaloneBundle();
        bundle.units.units[0].name = 'Boomerang';
        bundle.units.units[0].chassis = 'Boomerang';
        bundle.units.units[0].model = 'BMR-1';
        bundle.units.units[1].name = 'Ghost';
        bundle.units.units[1].chassis = 'Ghost';
        bundle.units.units[1].model = 'GST-1';
        bundle.eras.eras = [
            {
                id: 1,
                name: 'Age of War',
                img: '',
                years: { from: 2005, to: 2570 },
                units: [1],
                factions: [],
            },
            {
                id: 2,
                name: 'Star League',
                img: '',
                years: { from: 2571, to: 2780 },
                units: [1],
                factions: [],
            },
            {
                id: 3,
                name: 'Early Succession War',
                img: '',
                years: { from: 2781, to: 2900 },
                units: [1],
                factions: [],
            },
            {
                id: 4,
                name: 'Late Succession War - LosTech',
                img: '',
                years: { from: 2901, to: 3049 },
                units: [1, 2],
                factions: [],
            },
        ];
        bundle.factions.factions = [
            {
                id: 30,
                name: 'Draconis Combine',
                group: 'Inner Sphere',
                img: '',
                eras: {
                    1: new Set([1]),
                    2: new Set([1]),
                    4: new Set([1]),
                },
            },
            {
                id: MULFACTION_EXTINCT,
                name: 'Extinct',
                group: 'Other',
                img: '',
                eras: {},
            },
        ];

        const { dataService, service, optionsServiceStub } = createService(bundle);
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: bundle.units.units[0].name,
                e: {
                    '1': { '30': [6, 0] },
                    '2': { '30': [5, 0] },
                    '4': { '30': [4, 0] },
                },
            },
            {
                n: bundle.units.units[1].name,
                e: {
                    '4': { '30': [4, 0] },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        optionsServiceStub.options.set({
            ...optionsServiceStub.options(),
            availabilitySource: 'megamek',
        });
        service.setFilter('faction', {
            'Extinct': {
                name: 'Extinct',
                state: 'or',
                count: 1,
            },
        });

        const eraOptions = service.advOptions()['era']?.options ?? [];
        const namedEraOptions = eraOptions.filter((option): option is { name: string; available?: boolean } => typeof option !== 'number');

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['Boomerang']);
        expect(namedEraOptions.find((option) => option.name === 'Age of War')).toEqual(jasmine.objectContaining({ available: false }));
        expect(namedEraOptions.find((option) => option.name === 'Star League')).toEqual(jasmine.objectContaining({ available: false }));
        expect(namedEraOptions.find((option) => option.name === 'Early Succession War')).toEqual(jasmine.objectContaining({ available: true }));
        expect(namedEraOptions.find((option) => option.name === 'Late Succession War - LosTech')).toEqual(jasmine.objectContaining({ available: false }));

        service.setFilter('era', ['Early Succession War']);

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['Boomerang']);
    });

    it('keeps the worker active in MegaMek mode while applying MegaMek availability filters after worker search', async () => {
        const worker = new FakeSearchWorker();
        const bundle = benchmarkBundle && benchmarkBundle.units.units.length >= 2
            ? buildSmallBundle(benchmarkBundle)
            : createStandaloneBundle();
        const { dataService, service, optionsServiceStub, loggerStub } = createService(bundle, {
            workerFactory: () => worker,
        });

        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: bundle.units.units[0].name,
                // t: bundle.units.units[0].type,
                // c: bundle.units.units[0].chassis,
                // m: bundle.units.units[0].model,
                e: {
                    '1': {
                        '1': [6, 0],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        await flushAsyncWork();

        optionsServiceStub.options.set({
            ...optionsServiceStub.options(),
            availabilitySource: 'megamek',
        });
        service.setFilter('availabilityFrom', ['Production']);
        service.searchText.set('Test');
        service.filteredUnits();

        expect((service as any).workerSearchActive()).toBeTrue();
        expect(loggerStub.info).toHaveBeenCalledWith('Unit search worker startup: enabled');

        const corpusVersion = (service as any).getWorkerCorpusVersion();
        const snapshot = (service as any).getWorkerCorpusSnapshot(corpusVersion);
        const request = (service as any).buildWorkerSearchRequest(corpusVersion);

        (service as any).searchWorkerClient.submit(snapshot, request);

        const initMessage = worker.messages.at(-1) as any;

        worker.emit({ type: 'ready', corpusVersion: initMessage.snapshot.corpusVersion });
        await flushAsyncWork();

        const executeMessage = worker.messages.filter((message: any) => message.type === 'execute').at(-1) as any;
        expect(executeMessage).toBeTruthy();
        expect(executeMessage.request.executionQuery).not.toContain('from=Production');

        worker.emit({
            type: 'result',
            revision: executeMessage.request.revision,
            corpusVersion: executeMessage.request.corpusVersion,
            telemetryQuery: executeMessage.request.telemetryQuery,
            unitNames: bundle.units.units.map((unit) => unit.name),
            stages: [],
            totalMs: 1,
            unitCount: bundle.units.units.length,
            isComplex: false,
        });
        await flushAsyncWork();

        expect(service.filteredUnits().map(unit => unit.name)).toEqual(['Test Mek']);
    });

    it('updates MegaMek worker post-filters when faction or era changes', async () => {
        const worker = new FakeSearchWorker();
        const bundle = createStandaloneBundle();
        bundle.units.units[0].name = 'BattleMaster C3';
        bundle.units.units[0].chassis = 'BattleMaster';
        bundle.units.units[0].model = 'C3';
        bundle.units.units[1].name = 'Common Dominion Mek';
        bundle.units.units[1].chassis = 'Common Dominion';
        bundle.units.units[1].model = 'CDM-1';
        bundle.units.units[1].type = 'Mek';
        bundle.units.units[1].subtype = 'BattleMek';
        bundle.units.units[1].moveType = 'Biped';
        bundle.units.units[1].as = {
            ...bundle.units.units[1].as,
            TP: 'BM',
        };
        bundle.eras.eras = [
            {
                id: 1,
                name: 'ilClan',
                img: '',
                years: {
                    from: 3151,
                    to: 9999,
                },
                units: [1, 2],
                factions: [],
            },
            {
                id: 2,
                name: 'Dark Age',
                img: '',
                years: {
                    from: 3131,
                    to: 3150,
                },
                units: [1],
                factions: [],
            },
        ];
        bundle.factions.factions = [
            {
                id: 1,
                name: 'Rasalhague Dominion',
                group: 'IS Clan',
                img: '',
                eras: {
                    1: new Set([1, 2]),
                    2: new Set([1]),
                },
            },
            {
                id: 2,
                name: 'Clan Protectorate',
                group: 'IS Clan',
                img: '',
                eras: {
                    1: new Set([1]),
                },
            },
        ];

        const { dataService, service, optionsServiceStub } = createService(bundle, {
            workerFactory: () => worker,
        });
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: 'BattleMaster C3',
                e: {
                    '1': {
                        '1': [4, 0],
                        '2': [7, 0],
                    },
                    '2': {
                        '1': [7, 0],
                    },
                },
            },
            {
                n: 'Common Dominion Mek',
                e: {
                    '1': {
                        '1': [7, 0],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        const rasalhagueDominion = {
            'Rasalhague Dominion': {
                name: 'Rasalhague Dominion',
                state: 'or',
                count: 1,
            },
        };
        const clanProtectorate = {
            'Clan Protectorate': {
                name: 'Clan Protectorate',
                state: 'or',
                count: 1,
            },
        };

        await flushAsyncWork();

        optionsServiceStub.options.set({
            ...optionsServiceStub.options(),
            availabilitySource: 'megamek',
        });
        service.setFilter('type', ['Mek']);
        service.setFilter('era', ['ilClan']);
        service.setFilter('faction', rasalhagueDominion);
        service.setFilter('availabilityRarity', ['Common']);
        service.filteredUnits();

        expect((service as any).workerSearchActive()).toBeTrue();

        const corpusVersion = (service as any).getWorkerCorpusVersion();
        const snapshot = (service as any).getWorkerCorpusSnapshot(corpusVersion);
        const request = (service as any).buildWorkerSearchRequest(corpusVersion);

        expect(request.executionQuery).not.toContain('era=ilClan');
        expect(request.executionQuery).not.toContain('faction="Rasalhague Dominion"');
        expect(request.executionQuery.toLowerCase()).not.toContain('rarity');

        (service as any).searchWorkerClient.submit(snapshot, request);

        const initMessage = worker.messages.at(-1) as any;
        worker.emit({ type: 'ready', corpusVersion: initMessage.snapshot.corpusVersion });
        await flushAsyncWork();

        const firstExecuteMessage = worker.messages.filter((message: any) => message.type === 'execute').at(-1) as any;
        expect(firstExecuteMessage.request.executionQuery).not.toContain('era=ilClan');
        expect(firstExecuteMessage.request.executionQuery).not.toContain('faction="Rasalhague Dominion"');
        expect(firstExecuteMessage.request.executionQuery.toLowerCase()).not.toContain('rarity');

        worker.emit({
            type: 'result',
            revision: firstExecuteMessage.request.revision,
            corpusVersion: firstExecuteMessage.request.corpusVersion,
            telemetryQuery: firstExecuteMessage.request.telemetryQuery,
            unitNames: ['BattleMaster C3', 'Common Dominion Mek'],
            stages: [],
            totalMs: 1,
            unitCount: bundle.units.units.length,
            isComplex: false,
        });
        await flushAsyncWork();

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['Common Dominion Mek']);

        service.setFilter('faction', clanProtectorate);
        await flushAsyncWork();

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['BattleMaster C3']);

        service.setFilter('era', ['Dark Age']);
        service.setFilter('faction', rasalhagueDominion);
        await flushAsyncWork();

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['BattleMaster C3']);
    });

    it('keeps MegaMek-backed availability filters on the main thread while MUL worker search stays active', async () => {
        const worker = new FakeSearchWorker();
        const bundle = createStandaloneBundle();
        bundle.units.units[0].name = 'Rare Salvage Crab';
        bundle.units.units[0].chassis = 'Rare Salvage Crab';
        bundle.units.units[0].model = 'RSC-1';
        bundle.units.units[1].name = 'Common Production Crab';
        bundle.units.units[1].chassis = 'Common Production Crab';
        bundle.units.units[1].model = 'CPC-1';
        bundle.eras.eras[0].units = [1, 2];
        bundle.factions.factions[0].eras[1] = new Set([1, 2]);

        const { dataService, service } = createService(bundle, {
            workerFactory: () => worker,
        });
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: 'Rare Salvage Crab',
                e: {
                    '1': {
                        '1': [0, 4],
                    },
                },
            },
            {
                n: 'Common Production Crab',
                e: {
                    '1': {
                        '1': [7, 0],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        await flushAsyncWork();

        service.setFilter('availabilityFrom', ['Salvage']);
        service.setFilter('availabilityRarity', ['Rare']);
        service.searchText.set('Crab');
        service.filteredUnits();

        expect((service as any).workerSearchActive()).toBeTrue();

        const corpusVersion = (service as any).getWorkerCorpusVersion();
        const snapshot = (service as any).getWorkerCorpusSnapshot(corpusVersion);
        const request = (service as any).buildWorkerSearchRequest(corpusVersion);

        expect(request.executionQuery.toLowerCase()).not.toContain('from');
        expect(request.executionQuery.toLowerCase()).not.toContain('rarity');

        (service as any).searchWorkerClient.submit(snapshot, request);

        const initMessage = worker.messages.at(-1) as any;
        worker.emit({ type: 'ready', corpusVersion: initMessage.snapshot.corpusVersion });
        await flushAsyncWork();

        const executeMessage = worker.messages.filter((message: any) => message.type === 'execute').at(-1) as any;
        expect(executeMessage.request.executionQuery.toLowerCase()).not.toContain('from');
        expect(executeMessage.request.executionQuery.toLowerCase()).not.toContain('rarity');

        worker.emit({
            type: 'result',
            revision: executeMessage.request.revision,
            corpusVersion: executeMessage.request.corpusVersion,
            telemetryQuery: executeMessage.request.telemetryQuery,
            unitNames: ['Rare Salvage Crab', 'Common Production Crab'],
            stages: [],
            totalMs: 1,
            unitCount: bundle.units.units.length,
            isComplex: false,
        });
        await flushAsyncWork();

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['Rare Salvage Crab']);
    });

    it('keeps MUL worker rarity post-filters scoped to the selected era and faction', async () => {
        const worker = new FakeSearchWorker();
        const bundle = createStandaloneBundle();
        bundle.units.units[0].name = 'BattleMaster C3';
        bundle.units.units[0].chassis = 'BattleMaster';
        bundle.units.units[0].model = 'C3';
        bundle.units.units[1].name = 'Common Dominion Mek';
        bundle.units.units[1].chassis = 'Common Dominion';
        bundle.units.units[1].model = 'CDM-1';
        bundle.units.units[1].type = 'Mek';
        bundle.units.units[1].subtype = 'BattleMek';
        bundle.units.units[1].moveType = 'Biped';
        bundle.units.units[1].as = {
            ...bundle.units.units[1].as,
            TP: 'BM',
        };
        bundle.eras.eras = [{
            id: 1,
            name: 'ilClan',
            img: '',
            years: {
                from: 3151,
                to: 9999,
            },
            units: [1, 2],
            factions: [],
        }];
        bundle.factions.factions = [
            {
                id: 1,
                name: 'Rasalhague Dominion',
                group: 'IS Clan',
                img: '',
                eras: {
                    1: new Set([1, 2]),
                },
            },
            {
                id: 2,
                name: 'Clan Protectorate',
                group: 'IS Clan',
                img: '',
                eras: {
                    1: new Set([1]),
                },
            },
        ];

        const { dataService, service } = createService(bundle, {
            workerFactory: () => worker,
        });
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: 'BattleMaster C3',
                e: {
                    '1': {
                        '1': [4, 0],
                        '2': [7, 0],
                    },
                },
            },
            {
                n: 'Common Dominion Mek',
                e: {
                    '1': {
                        '1': [7, 0],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        await flushAsyncWork();

        service.setFilter('era', ['ilClan']);
        service.setFilter('faction', {
            'Rasalhague Dominion': {
                name: 'Rasalhague Dominion',
                state: 'or',
                count: 1,
            },
        });
        service.setFilter('availabilityRarity', ['Common']);
        service.filteredUnits();

        expect((service as any).workerSearchActive()).toBeTrue();

        const corpusVersion = (service as any).getWorkerCorpusVersion();
        const snapshot = (service as any).getWorkerCorpusSnapshot(corpusVersion);
        const request = (service as any).buildWorkerSearchRequest(corpusVersion);

        expect(request.executionQuery).toContain('era=ilClan');
        expect(request.executionQuery).toContain('faction="Rasalhague Dominion"');
        expect(request.executionQuery.toLowerCase()).not.toContain('rarity');

        (service as any).searchWorkerClient.submit(snapshot, request);

        const initMessage = worker.messages.at(-1) as any;
        worker.emit({ type: 'ready', corpusVersion: initMessage.snapshot.corpusVersion });
        await flushAsyncWork();

        const executeMessage = worker.messages.filter((message: any) => message.type === 'execute').at(-1) as any;
        expect(executeMessage.request.executionQuery).toContain('era=ilClan');
        expect(executeMessage.request.executionQuery).toContain('faction="Rasalhague Dominion"');
        expect(executeMessage.request.executionQuery.toLowerCase()).not.toContain('rarity');

        worker.emit({
            type: 'result',
            revision: executeMessage.request.revision,
            corpusVersion: executeMessage.request.corpusVersion,
            telemetryQuery: executeMessage.request.telemetryQuery,
            unitNames: ['BattleMaster C3', 'Common Dominion Mek'],
            stages: [],
            totalMs: 1,
            unitCount: bundle.units.units.length,
            isComplex: false,
        });
        await flushAsyncWork();

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['Common Dominion Mek']);
    });

    it('keeps MUL worker rarity post-filters scoped when text search narrows results to a single unit', async () => {
        const worker = new FakeSearchWorker();
        const bundle = createStandaloneBundle();
        bundle.units.units[0].name = 'BattleMaster C3';
        bundle.units.units[0].chassis = 'BattleMaster';
        bundle.units.units[0].model = 'C3';
        bundle.eras.eras = [{
            id: 1,
            name: 'ilClan',
            img: '',
            years: {
                from: 3151,
                to: 9999,
            },
            units: [1],
            factions: [],
        }];
        bundle.factions.factions = [
            {
                id: 1,
                name: 'Rasalhague Dominion',
                group: 'IS Clan',
                img: '',
                eras: {
                    1: new Set([1]),
                },
            },
            {
                id: 2,
                name: 'Clan Protectorate',
                group: 'IS Clan',
                img: '',
                eras: {
                    1: new Set([1]),
                },
            },
        ];

        const { dataService, service } = createService(bundle, {
            workerFactory: () => worker,
        });
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: 'BattleMaster C3',
                e: {
                    '1': {
                        '1': [4, 0],
                        '2': [7, 0],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        await flushAsyncWork();

        service.searchText.set('BattleMaster');
        service.setFilter('era', ['ilClan']);
        service.setFilter('faction', {
            'Rasalhague Dominion': {
                name: 'Rasalhague Dominion',
                state: 'or',
                count: 1,
            },
        });
        service.setFilter('availabilityRarity', ['Common']);
        service.filteredUnits();

        expect((service as any).workerSearchActive()).toBeTrue();

        const corpusVersion = (service as any).getWorkerCorpusVersion();
        const snapshot = (service as any).getWorkerCorpusSnapshot(corpusVersion);
        const request = (service as any).buildWorkerSearchRequest(corpusVersion);

        expect(request.executionQuery).toContain('BattleMaster');
        expect(request.executionQuery).toContain('era=ilClan');
        expect(request.executionQuery).toContain('faction="Rasalhague Dominion"');
        expect(request.executionQuery.toLowerCase()).not.toContain('rarity');

        (service as any).searchWorkerClient.submit(snapshot, request);

        const initMessage = worker.messages.at(-1) as any;
        worker.emit({ type: 'ready', corpusVersion: initMessage.snapshot.corpusVersion });
        await flushAsyncWork();

        const executeMessage = worker.messages.filter((message: any) => message.type === 'execute').at(-1) as any;
        expect(executeMessage.request.executionQuery).toContain('BattleMaster');
        expect(executeMessage.request.executionQuery).toContain('era=ilClan');
        expect(executeMessage.request.executionQuery).toContain('faction="Rasalhague Dominion"');
        expect(executeMessage.request.executionQuery.toLowerCase()).not.toContain('rarity');

        worker.emit({
            type: 'result',
            revision: executeMessage.request.revision,
            corpusVersion: executeMessage.request.corpusVersion,
            telemetryQuery: executeMessage.request.telemetryQuery,
            unitNames: ['BattleMaster C3'],
            stages: [],
            totalMs: 1,
            unitCount: bundle.units.units.length,
            isComplex: false,
        });
        await flushAsyncWork();

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual([]);
    });

    it('filters MUL semantic rarity queries after worker results', async () => {
        const worker = new FakeSearchWorker();
        const bundle = createStandaloneBundle();
        bundle.units.units[0].name = 'Very Common Crab';
        bundle.units.units[0].chassis = 'Very Common Crab';
        bundle.units.units[0].model = 'VCC-1';
        bundle.units.units[1].name = 'Unknown Crab';
        bundle.units.units[1].chassis = 'Unknown Crab';
        bundle.units.units[1].model = 'UNC-1';
        bundle.eras.eras[0].units = [1, 2];
        bundle.factions.factions[0].eras[1] = new Set([1, 2]);

        const { dataService, service } = createService(bundle, {
            workerFactory: () => worker,
        });
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: 'Very Common Crab',
                e: {
                    '1': {
                        '1': [9, 0],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        await flushAsyncWork();

        service.searchText.set('crab rarity="very common"');
        service.filteredUnits();

        expect((service as any).workerSearchActive()).toBeTrue();

        const corpusVersion = (service as any).getWorkerCorpusVersion();
        const snapshot = (service as any).getWorkerCorpusSnapshot(corpusVersion);
        const request = (service as any).buildWorkerSearchRequest(corpusVersion);

        expect(request.executionQuery.toLowerCase()).not.toContain('rarity');

        (service as any).searchWorkerClient.submit(snapshot, request);

        const initMessage = worker.messages.at(-1) as any;
        worker.emit({ type: 'ready', corpusVersion: initMessage.snapshot.corpusVersion });
        await flushAsyncWork();

        const executeMessage = worker.messages.filter((message: any) => message.type === 'execute').at(-1) as any;
        expect(executeMessage.request.executionQuery.toLowerCase()).not.toContain('rarity');

        worker.emit({
            type: 'result',
            revision: executeMessage.request.revision,
            corpusVersion: executeMessage.request.corpusVersion,
            telemetryQuery: executeMessage.request.telemetryQuery,
            unitNames: ['Very Common Crab', 'Unknown Crab'],
            stages: [],
            totalMs: 1,
            unitCount: bundle.units.units.length,
            isComplex: false,
        });
        await flushAsyncWork();

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['Very Common Crab']);
    });

    it('uses sync fallback results while MegaMek availability worker filters are pending', async () => {
        const worker = new FakeSearchWorker();
        const bundle = createStandaloneBundle();
        bundle.units.units[0].name = 'Rare Salvage Crab';
        bundle.units.units[0].chassis = 'Rare Salvage Crab';
        bundle.units.units[0].model = 'RSC-1';
        bundle.units.units[1].name = 'Common Salvage Crab';
        bundle.units.units[1].chassis = 'Common Salvage Crab';
        bundle.units.units[1].model = 'CSC-1';
        bundle.eras.eras[0].units = [1, 2];
        bundle.factions.factions[0].eras[1] = new Set([1, 2]);

        const { dataService, service, optionsServiceStub } = createService(bundle, {
            workerFactory: () => worker,
        });
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: 'Rare Salvage Crab',
                e: {
                    '1': {
                        '1': [0, 4],
                    },
                },
            },
            {
                n: 'Common Salvage Crab',
                e: {
                    '1': {
                        '1': [0, 7],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        await flushAsyncWork();

        optionsServiceStub.options.set({
            ...optionsServiceStub.options(),
            availabilitySource: 'megamek',
        });
        service.setFilter('availabilityFrom', ['Salvage']);
        service.setFilter('availabilityRarity', ['Rare']);
        service.searchText.set('Crab');
        await flushAsyncWork();

        const corpusVersion = (service as any).getWorkerCorpusVersion();
        const snapshot = (service as any).getWorkerCorpusSnapshot(corpusVersion);
        const request = (service as any).buildWorkerSearchRequest(corpusVersion);

        (service as any).workerRequestRevision.set(request.revision);
        (service as any).searchWorkerClient.submit(snapshot, request);

        expect((service as any).workerSearchActive()).toBeTrue();
        expect(service.isSearchSettled()).toBeFalse();
        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['Rare Salvage Crab']);
        expect(service.forceGeneratorEligibleUnits().map((unit) => unit.name)).toEqual(['Rare Salvage Crab']);
    });

    it('filters Unknown rarity on the main thread after worker results', async () => {
        const worker = new FakeSearchWorker();
        const bundle = createStandaloneBundle();
        bundle.units.units[0].name = 'Known Unit';
        bundle.units.units[0].chassis = 'Known Unit';
        bundle.units.units[0].model = 'KNO-1';
        bundle.units.units[1].name = 'Unknown Unit';
        bundle.units.units[1].chassis = 'Unknown Unit';
        bundle.units.units[1].model = 'UNK-1';
        bundle.eras.eras[0].units = [1, 2];
        bundle.factions.factions[0].eras[1] = new Set([1, 2]);

        const { dataService, service, optionsServiceStub } = createService(bundle, {
            workerFactory: () => worker,
        });
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: 'Known Unit',
                e: {
                    '1': {
                        '1': [9, 0],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        await flushAsyncWork();

        optionsServiceStub.options.set({
            ...optionsServiceStub.options(),
            availabilitySource: 'megamek',
        });
        service.setFilter('availabilityRarity', ['Unknown']);
        service.searchText.set('Unit');
        service.filteredUnits();

        expect((service as any).workerSearchActive()).toBeTrue();

        const corpusVersion = (service as any).getWorkerCorpusVersion();
        const snapshot = (service as any).getWorkerCorpusSnapshot(corpusVersion);
        const request = (service as any).buildWorkerSearchRequest(corpusVersion);

        (service as any).searchWorkerClient.submit(snapshot, request);

        const initMessage = worker.messages.at(-1) as any;
        worker.emit({ type: 'ready', corpusVersion: initMessage.snapshot.corpusVersion });
        await flushAsyncWork();

        const executeMessage = worker.messages.filter((message: any) => message.type === 'execute').at(-1) as any;
        worker.emit({
            type: 'result',
            revision: executeMessage.request.revision,
            corpusVersion: executeMessage.request.corpusVersion,
            telemetryQuery: executeMessage.request.telemetryQuery,
            unitNames: ['Known Unit', 'Unknown Unit'],
            stages: [],
            totalMs: 1,
            unitCount: bundle.units.units.length,
            isComplex: false,
        });
        await flushAsyncWork();

        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['Unknown Unit']);
    });

    it('falls back to sync execution for complex MegaMek semantic queries', async () => {
        const worker = new FakeSearchWorker();
        const bundle = createStandaloneBundle();
        const { service, optionsServiceStub } = createService(bundle, {
            workerFactory: () => worker,
        });

        await flushAsyncWork();

        optionsServiceStub.options.set({
            ...optionsServiceStub.options(),
            availabilitySource: 'megamek',
        });
        service.searchText.set('Test OR from=Production');
        service.filteredUnits();

        expect((service as any).workerSearchActive()).toBeFalse();
    });

    it('falls back to sync execution for complex MUL semantic availability queries', async () => {
        const worker = new FakeSearchWorker();
        const bundle = createStandaloneBundle();
        bundle.units.units[0].name = 'Very Common Crab';
        bundle.units.units[0].chassis = 'Very Common Crab';
        bundle.units.units[0].model = 'VCC-1';
        bundle.units.units[1].name = 'Unknown Crab';
        bundle.units.units[1].chassis = 'Unknown Crab';
        bundle.units.units[1].model = 'UNC-1';
        bundle.eras.eras[0].units = [1, 2];
        bundle.factions.factions[0].eras[1] = new Set([1, 2]);

        const { dataService, service } = createService(bundle, {
            workerFactory: () => worker,
        });
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: 'Very Common Crab',
                e: {
                    '1': {
                        '1': [9, 0],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        await flushAsyncWork();

        service.searchText.set('NoMatch OR rarity="very common"');
        service.filteredUnits();

        expect((service as any).workerSearchActive()).toBeFalse();
        expect(service.filteredUnits().map((unit) => unit.name)).toEqual(['Very Common Crab']);
    });

    it('re-sorts worker results by MegaMek rarity on the main thread', async () => {
        const worker = new FakeSearchWorker();
        const bundle = createStandaloneBundle();
        const lowUnit = bundle.units.units[0];
        const highUnit = bundle.units.units[1];
        const unknownUnit = createTestUnit({
            id: 3,
            name: 'Unknown Unit',
            chassis: 'Unknown Unit',
            model: 'UNK-1',
        });

        lowUnit.name = 'Low Unit';
        lowUnit.chassis = 'Low Unit';
        lowUnit.model = 'LOW-1';
        highUnit.name = 'High Unit';
        highUnit.chassis = 'High Unit';
        highUnit.model = 'HIGH-1';
        bundle.units.units.push(unknownUnit);
        bundle.eras.eras[0].units = [1, 2, 3];
        bundle.factions.factions[0].eras[1] = new Set([1, 2, 3]);

        const { dataService, service } = createService(bundle, {
            workerFactory: () => worker,
        });
        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue([
            {
                n: lowUnit.name,
                e: {
                    '1': {
                        '1': [3, 0],
                    },
                },
            },
            {
                n: highUnit.name,
                e: {
                    '1': {
                        '1': [5, 1],
                    },
                },
            },
        ]);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return dataService.getMegaMekAvailabilityRecords().find((record) => record.n === unit.name);
        });

        await flushAsyncWork();

        service.setSortOrder(MEGAMEK_RARITY_PRODUCTION_SORT_KEY);
        service.setSortDirection('desc');

        const corpusVersion = (service as any).getWorkerCorpusVersion();
        const snapshot = (service as any).getWorkerCorpusSnapshot(corpusVersion);
        const request = (service as any).buildWorkerSearchRequest(corpusVersion);

        (service as any).searchWorkerClient.submit(snapshot, request);

        const initMessage = worker.messages.at(-1) as any;
        expect(initMessage).toBeTruthy();

        worker.emit({ type: 'ready', corpusVersion: initMessage.snapshot.corpusVersion });
        await flushAsyncWork();

        const executeMessage = worker.messages.filter((message: any) => message.type === 'execute').at(-1) as any;
        expect(executeMessage?.request.sortKey).toBe('');

        worker.emit({
            type: 'result',
            revision: executeMessage.request.revision,
            corpusVersion: executeMessage.request.corpusVersion,
            telemetryQuery: executeMessage.request.telemetryQuery,
            unitNames: ['Low Unit', 'Unknown Unit', 'High Unit'],
            stages: [],
            totalMs: 1,
            unitCount: bundle.units.units.length,
            isComplex: false,
        });
        await flushAsyncWork();

        expect(service.filteredUnits().map(unit => unit.name)).toEqual(['High Unit', 'Low Unit', 'Unknown Unit']);
    });

    it('logs when the search worker is unavailable at startup', () => {
        const { loggerStub } = createService(createStandaloneBundle());

        expect(loggerStub.info).toHaveBeenCalledWith('Unit search worker startup: disabled');
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
        expect(service.filterState()['era']?.value).toEqual({
            'Succession Wars': {
                name: 'Succession Wars',
                state: 'or',
                count: 1,
            },
        });
    });

    it('loads legacy comma-containing Alpha Strike specials from URL params end to end', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the URL canonicalization test.');
            return;
        }

        const special = 'TUR(2/3/3,IF2,LRM1/2/2)';
        const bundle = buildSmallBundle(benchmarkBundle);
        bundle.units.units[0].as.specials = ['IF2'];
        bundle.units.units[1].as.specials = [special];

        const { service, gameServiceStub } = createService(bundle);
        gameServiceStub.currentGameSystem.set(GameSystem.ALPHA_STRIKE);

        const params = new URLSearchParams();
        params.set('filters', `as.specials:${special}`);

        service.applySearchParamsFromUrl(params, { expandView: false });

        expect(service.filterState()['as.specials']?.value).toEqual({
            [special]: {
                name: special,
                state: 'or',
                count: 1,
            },
        });
        expect(service.filteredUnits().map(unit => unit.name)).toEqual(['Test Tank']);
        expect(service.queryParameters()['filters']).toBe(`as.specials:"${special}"`);
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

    it('serializes multistate era selections into worker execution queries', () => {
        const bundle = createStandaloneBundle();
        bundle.eras.eras = [
            ...bundle.eras.eras,
            {
                id: 2,
                name: 'Jihad',
                img: '',
                years: {
                    from: 3067,
                    to: 3080,
                },
                units: [1],
                factions: [],
            },
        ];
        bundle.factions.factions[0].eras = {
            1: new Set([1, 2]),
            2: new Set([1]),
        };

        const { service } = createService(bundle);

        service.setFilter('era', {
            'Succession Wars': {
                name: 'Succession Wars',
                state: 'or',
                count: 1,
            },
            Jihad: {
                name: 'Jihad',
                state: 'and',
                count: 1,
            },
        });

        const request = (service as any).buildWorkerSearchRequest((service as any).getWorkerCorpusVersion());

        expect(request.executionQuery).toContain('era="Succession Wars"');
        expect(request.executionQuery).toContain('era&=Jihad');
    });

    it('keeps MUL era and faction filters in worker execution queries while stripping availability filters', () => {
        const bundle = createStandaloneBundle();

        const { service } = createService(bundle);

        service.setFilter('era', ['Succession Wars']);
        service.setFilter('faction', {
            'Test Faction': {
                name: 'Test Faction',
                state: 'or',
                count: 1,
            },
        });
        service.setFilter('availabilityFrom', ['Production']);
        service.setFilter('availabilityRarity', ['Common']);

        const request = (service as any).buildWorkerSearchRequest((service as any).getWorkerCorpusVersion());

        expect(request.executionQuery).toContain('era="Succession Wars"');
        expect(request.executionQuery).toContain('faction="Test Faction"');
        expect(request.executionQuery.toLowerCase()).not.toContain('from');
        expect(request.executionQuery.toLowerCase()).not.toContain('rarity');
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

    it('requires faction membership in every selected multistate era', async () => {
        const bundle = createStandaloneBundle();
        bundle.units.units[0].name = 'Masakari Prime';
        bundle.units.units[0].chassis = 'Masakari';
        bundle.units.units[0].model = 'Prime';
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
                name: 'ilClan',
                img: '',
                years: { from: 3151, to: 9999 },
                units: [1, 2],
                factions: [],
            },
        ];
        bundle.factions.factions = [
            {
                id: 1,
                name: 'Clan Jade Falcon',
                group: 'IS Clan',
                img: '',
                eras: {
                    1: new Set([1]),
                },
            },
            {
                id: 2,
                name: 'Clan Wolf',
                group: 'IS Clan',
                img: '',
                eras: {
                    2: new Set([1]),
                },
            },
        ];

        const { service } = createService(bundle);
        service.setFilter('era', {
            'Clan Invasion': {
                name: 'Clan Invasion',
                state: 'and',
                count: 1,
            },
            ilClan: {
                name: 'ilClan',
                state: 'and',
                count: 1,
            },
        });
        service.setFilter('faction', {
            'Clan Jade Falcon': {
                name: 'Clan Jade Falcon',
                state: 'or',
                count: 1,
            },
        });
        service.setSearchText('masakari');
        await flushAsyncWork();

        expect(service.filteredUnits().map(unit => unit.name)).toEqual([]);
    });

    it('requires faction membership in every selected multistate era for semantic search text', async () => {
        const bundle = createStandaloneBundle();
        bundle.units.units[0].name = 'Masakari Prime';
        bundle.units.units[0].chassis = 'Masakari';
        bundle.units.units[0].model = 'Prime';
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
                name: 'ilClan',
                img: '',
                years: { from: 3151, to: 9999 },
                units: [1, 2],
                factions: [],
            },
        ];
        bundle.factions.factions = [
            {
                id: 1,
                name: 'Clan Jade Falcon',
                group: 'IS Clan',
                img: '',
                eras: {
                    1: new Set([1]),
                },
            },
            {
                id: 2,
                name: 'Clan Wolf',
                group: 'IS Clan',
                img: '',
                eras: {
                    2: new Set([1]),
                },
            },
        ];

        const { service } = createService(bundle);
        service.setSearchText('masak era&="Clan Invasion",ilClan faction="Clan Jade Falcon"');
        await flushAsyncWork();

        expect(service.filteredUnits().map(unit => unit.name)).toEqual([]);
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

    it('exposes wildcard-only exclusive faction filters with both structured and plain semantic display values', async () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the semantic faction wildcard display test.');
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
                name: 'Capellan March',
                group: 'Inner Sphere',
                img: '',
                eras: { 1: new Set([2]) },
            },
        ];

        const { service } = createService(bundle);
        service.searchText.set('faction=="Capellan *"');
        await flushAsyncWork();

        const factionOptions = service.advOptions()['faction'];

        expect(factionOptions && factionOptions.type === 'dropdown' ? factionOptions.semanticOnly : undefined).toBeTrue();
        expect(factionOptions && factionOptions.type === 'dropdown' ? factionOptions.displayText : undefined).toBe('==Capellan *');
        expect(factionOptions && factionOptions.type === 'dropdown' ? factionOptions.displayItems : undefined).toEqual([
            { text: '==Capellan *', state: 'or' },
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

    it('clears cached indexed _tags option names when tags appear after initial render', () => {
        if (!benchmarkBundle || benchmarkBundle.units.units.length < 2) {
            pending('Real unit data could not be loaded for the tag cache test.');
            return;
        }

        const bundle = buildSmallBundle(benchmarkBundle);
        for (const unit of bundle.units.units) {
            unit._nameTags = [];
            unit._chassisTags = [];
            unit._publicTags = [];
        }

        const { dataService, service } = createService(bundle);
        const initialTagOptions = service.advOptions()['_tags']?.options ?? [];

        expect(initialTagOptions).toEqual([]);

        (dataService as any).applyTagDataToUnits({
            tags: {
                alpha: {
                    label: 'alpha-tag',
                    units: { 'Test Mek': {} },
                    chassis: {},
                },
            },
            timestamp: 1,
            formatVersion: 3,
        });

        const tagOptions = service.advOptions()['_tags']?.options ?? [];
        const namedTagOptions = tagOptions.filter(option => typeof option !== 'number');

        expect(namedTagOptions).toEqual([
            jasmine.objectContaining({ name: 'alpha-tag', available: true }),
        ]);
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

    xit('captures advOptions telemetry with per-filter timings', async () => {
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

    // Manual diagnostic benchmark: run with xit -> it to enable
    xit('benchmarks synthetic MegaMek rarity sorting across 50,000 units', async () => {
        const setupStartedAt = performance.now();
        const scenario = buildSyntheticMegaMekRarityBenchmarkScenario(50000);
        const { dataService, service } = createService(scenario.bundle);

        spyOn(dataService, 'getMegaMekAvailabilityRecords').and.returnValue(scenario.availabilityRecords);
        spyOn(dataService, 'getMegaMekAvailabilityRecordForUnit').and.callFake((unit: Pick<Unit, 'name'>) => {
            return scenario.availabilityRecordsByName.get(unit.name);
        });

        (service as any).slowSearchTelemetryThresholdMs = 0;
        service.setSortOrder('name');
        service.filteredUnits();
        await flushAsyncWork();
        const setupMs = performance.now() - setupStartedAt;

        service.setSortOrder(MEGAMEK_RARITY_PRODUCTION_SORT_KEY);
        service.setSortDirection('desc');
        service.searchText.set('');

        const coldStartedAt = performance.now();
        const coldFilteredUnits = service.filteredUnits();
        const coldElapsedMs = performance.now() - coldStartedAt;

        await flushAsyncWork();

        const coldTelemetry = service.searchTelemetry();
        const coldSortStage = coldTelemetry?.stages.find(stage => stage.name === 'sort');

        service.setSortOrder('name');
        service.filteredUnits();
        await flushAsyncWork();

        service.setSortOrder(MEGAMEK_RARITY_PRODUCTION_SORT_KEY);

        const warmStartedAt = performance.now();
        const filteredUnits = service.filteredUnits();
        const warmElapsedMs = performance.now() - warmStartedAt;

        await flushAsyncWork();

        const telemetry = service.searchTelemetry();
        const sortStage = telemetry?.stages.find(stage => stage.name === 'sort');
        const topRecord = scenario.availabilityRecordsByName.get(filteredUnits[0]?.name ?? '');
        const topScore = Math.max(topRecord?.e['1']?.['1']?.[0] ?? -1, topRecord?.e['1']?.['1']?.[1] ?? -1);

        console.info('MEGAMEK_RARITY_SORT_BENCH', JSON.stringify({
            unitCount: scenario.bundle.units.units.length,
            resultCount: filteredUnits.length,
            setupMs: Number(setupMs.toFixed(2)),
            coldTotalMs: Number(coldElapsedMs.toFixed(2)),
            coldTelemetryTotalMs: Number((coldTelemetry?.totalMs ?? 0).toFixed(2)),
            coldSortMs: Number((coldSortStage?.durationMs ?? 0).toFixed(2)),
            warmTotalMs: Number(warmElapsedMs.toFixed(2)),
            warmTelemetryTotalMs: Number((telemetry?.totalMs ?? 0).toFixed(2)),
            warmSortMs: Number((sortStage?.durationMs ?? 0).toFixed(2)),
            topScore,
        }));

        expect(coldFilteredUnits.length).toBe(50000);
        expect(filteredUnits.length).toBe(50000);
        expect(telemetry?.unitCount).toBe(50000);
        expect(sortStage).toBeDefined();
        expect(topScore).toBe(scenario.expectedTopScore);
    });

    xit('does not write to logger signals synchronously while filteredUnits is computing', async () => {
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