import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Unit } from '../models/units.model';
import { GameSystem } from '../models/common.model';
import { DataService } from './data.service';
import { DbService } from './db.service';
import { LoggerService } from './logger.service';
import { PublicTagsService } from './public-tags.service';
import { TagsService } from './tags.service';
import { UnitInitializerService } from './unit-initializer.service';
import { UnitRuntimeService } from './unit-runtime.service';
import { UserStateService } from './userState.service';
import { WsService } from './ws.service';
import { UnitSearchIndexService } from './unit-search-index.service';
import { UnitsCatalogService } from './catalogs/units-catalog.service';
import { EquipmentCatalogService } from './catalogs/equipment-catalog.service';
import { ErasCatalogService } from './catalogs/eras-catalog.service';
import { FactionsCatalogService } from './catalogs/mulfactions-catalog.service';
import { MegaMekAvailabilityCatalogService } from './catalogs/megamek-availability-catalog.service';
import { MegaMekFactionsCatalogService } from './catalogs/megamek-factions-catalog.service';
import { MegaMekRulesetsCatalogService } from './catalogs/megamek-rulesets-catalog.service';
import { MulUnitSourcesCatalogService } from './catalogs/mul-unit-sources-catalog.service';
import { QuirksCatalogService } from './catalogs/quirks-catalog.service';
import { SourcebooksCatalogService } from './catalogs/sourcebooks-catalog.service';

function createUnit(name: string): Unit {
    return { name } as Unit;
}

describe('DataService', () => {
    let service: DataService;
    const dbServiceMock = {
        getForce: jasmine.createSpy('getForce'),
        saveForce: jasmine.createSpy('saveForce'),
        waitForDbReady: jasmine.createSpy('waitForDbReady').and.resolveTo(undefined),
    };
    const wsServiceMock = {
        sendAndWaitForResponse: jasmine.createSpy('sendAndWaitForResponse'),
    };
    const userStateServiceMock = {
        uuid: jasmine.createSpy('uuid').and.returnValue('user-1'),
    };
    const unitRuntimeServiceMock = {
        getUnitByName: jasmine.createSpy('getUnitByName').and.returnValue(undefined),
        applyTagDataToUnits: jasmine.createSpy('applyTagDataToUnits'),
        applyPublicTagsToUnits: jasmine.createSpy('applyPublicTagsToUnits'),
        loadUnitTags: jasmine.createSpy('loadUnitTags').and.resolveTo(undefined),
        postprocessUnits: jasmine.createSpy('postprocessUnits'),
        linkEquipmentToUnits: jasmine.createSpy('linkEquipmentToUnits'),
    };
    const unitSearchIndexServiceMock = {
        rebuildIndexes: jasmine.createSpy('rebuildIndexes'),
    };
    const unitsCatalogMock = {
        initialize: jasmine.createSpy('initialize').and.resolveTo(undefined),
        getUnits: jasmine.createSpy('getUnits').and.returnValue([]),
    };
    const equipmentCatalogMock = {
        initialize: jasmine.createSpy('initialize').and.resolveTo(undefined),
        getEquipments: jasmine.createSpy('getEquipments').and.returnValue({}),
        getEquipmentByName: jasmine.createSpy('getEquipmentByName').and.returnValue(undefined),
    };
    const erasCatalogMock = {
        initialize: jasmine.createSpy('initialize').and.resolveTo(undefined),
        getEras: jasmine.createSpy('getEras').and.returnValue([]),
        getEraByName: jasmine.createSpy('getEraByName').and.returnValue(undefined),
        getEraById: jasmine.createSpy('getEraById').and.returnValue(undefined),
    };
    const factionsCatalogMock = {
        initialize: jasmine.createSpy('initialize').and.resolveTo(undefined),
        getFactions: jasmine.createSpy('getFactions').and.returnValue([]),
        getFactionByName: jasmine.createSpy('getFactionByName').and.returnValue(undefined),
        getFactionById: jasmine.createSpy('getFactionById').and.returnValue(undefined),
    };
    const megaMekAvailabilityCatalogMock = {
        initialize: jasmine.createSpy('initialize').and.resolveTo(undefined),
        getRecords: jasmine.createSpy('getRecords').and.returnValue([]),
        getRecordForUnit: jasmine.createSpy('getRecordForUnit').and.returnValue(undefined),
    };
    const megaMekFactionsCatalogMock = {
        initialize: jasmine.createSpy('initialize').and.resolveTo(undefined),
        getFactions: jasmine.createSpy('getFactions').and.returnValue({}),
        getFactionByKey: jasmine.createSpy('getFactionByKey').and.returnValue(undefined),
        getFactionsByMulId: jasmine.createSpy('getFactionsByMulId').and.returnValue([]),
        getFactionAffiliation: jasmine.createSpy('getFactionAffiliation').and.returnValue('Other'),
    };
    const megaMekRulesetsCatalogMock = {
        initialize: jasmine.createSpy('initialize').and.resolveTo(undefined),
        getRulesets: jasmine.createSpy('getRulesets').and.returnValue([]),
        getRulesetByFactionKey: jasmine.createSpy('getRulesetByFactionKey').and.returnValue(undefined),
    };
    const mulUnitSourcesCatalogMock = {
        initialize: jasmine.createSpy('initialize').and.resolveTo(undefined),
    };
    const quirksCatalogMock = {
        initialize: jasmine.createSpy('initialize').and.resolveTo(undefined),
        getQuirkByName: jasmine.createSpy('getQuirkByName').and.returnValue(undefined),
    };
    const sourcebooksCatalogMock = {
        initialize: jasmine.createSpy('initialize').and.resolveTo(undefined),
        getSourcebookByAbbrev: jasmine.createSpy('getSourcebookByAbbrev').and.returnValue(undefined),
        getSourcebookTitle: jasmine.createSpy('getSourcebookTitle').and.callFake((abbrev: string) => abbrev),
    };
    const tagsServiceMock = {
        setRefreshUnitsCallback: jasmine.createSpy('setRefreshUnitsCallback'),
        setNotifyStoreUpdatedCallback: jasmine.createSpy('setNotifyStoreUpdatedCallback'),
        registerWsHandlers: jasmine.createSpy('registerWsHandlers'),
        syncFromCloud: jasmine.createSpy('syncFromCloud'),
    };
    const publicTagsServiceMock = {
        setRefreshUnitsCallback: jasmine.createSpy('setRefreshUnitsCallback'),
        initialize: jasmine.createSpy('initialize'),
        registerWsHandlers: jasmine.createSpy('registerWsHandlers'),
    };
    const loggerServiceMock = {
        info: jasmine.createSpy('info'),
        warn: jasmine.createSpy('warn'),
        error: jasmine.createSpy('error'),
    };

    beforeEach(() => {
        TestBed.resetTestingModule();
        dbServiceMock.getForce.calls.reset();
        dbServiceMock.getForce.and.resolveTo(null);
        dbServiceMock.saveForce.calls.reset();
        dbServiceMock.waitForDbReady.calls.reset();
        dbServiceMock.waitForDbReady.and.resolveTo(undefined);
        wsServiceMock.sendAndWaitForResponse.calls.reset();
        wsServiceMock.sendAndWaitForResponse.and.resolveTo(undefined);
        userStateServiceMock.uuid.calls.reset();
        userStateServiceMock.uuid.and.returnValue('user-1');
        unitRuntimeServiceMock.getUnitByName.calls.reset();
        unitRuntimeServiceMock.getUnitByName.and.returnValue(undefined);
        unitRuntimeServiceMock.applyTagDataToUnits.calls.reset();
        unitRuntimeServiceMock.applyPublicTagsToUnits.calls.reset();
        unitRuntimeServiceMock.loadUnitTags.calls.reset();
        unitRuntimeServiceMock.loadUnitTags.and.resolveTo(undefined);
        unitRuntimeServiceMock.postprocessUnits.calls.reset();
        unitRuntimeServiceMock.linkEquipmentToUnits.calls.reset();
        unitSearchIndexServiceMock.rebuildIndexes.calls.reset();
        unitsCatalogMock.initialize.calls.reset();
        unitsCatalogMock.initialize.and.resolveTo(undefined);
        unitsCatalogMock.getUnits.calls.reset();
        unitsCatalogMock.getUnits.and.returnValue([]);
        equipmentCatalogMock.initialize.calls.reset();
        equipmentCatalogMock.initialize.and.resolveTo(undefined);
        equipmentCatalogMock.getEquipments.calls.reset();
        equipmentCatalogMock.getEquipments.and.returnValue({});
        equipmentCatalogMock.getEquipmentByName.calls.reset();
        equipmentCatalogMock.getEquipmentByName.and.returnValue(undefined);
        erasCatalogMock.initialize.calls.reset();
        erasCatalogMock.initialize.and.resolveTo(undefined);
        erasCatalogMock.getEras.calls.reset();
        erasCatalogMock.getEras.and.returnValue([]);
        erasCatalogMock.getEraByName.calls.reset();
        erasCatalogMock.getEraByName.and.returnValue(undefined);
        erasCatalogMock.getEraById.calls.reset();
        erasCatalogMock.getEraById.and.returnValue(undefined);
        factionsCatalogMock.initialize.calls.reset();
        factionsCatalogMock.initialize.and.resolveTo(undefined);
        factionsCatalogMock.getFactions.calls.reset();
        factionsCatalogMock.getFactions.and.returnValue([]);
        factionsCatalogMock.getFactionByName.calls.reset();
        factionsCatalogMock.getFactionByName.and.returnValue(undefined);
        factionsCatalogMock.getFactionById.calls.reset();
        factionsCatalogMock.getFactionById.and.returnValue(undefined);
        megaMekAvailabilityCatalogMock.initialize.calls.reset();
        megaMekAvailabilityCatalogMock.initialize.and.resolveTo(undefined);
        megaMekAvailabilityCatalogMock.getRecords.calls.reset();
        megaMekAvailabilityCatalogMock.getRecords.and.returnValue([]);
        megaMekAvailabilityCatalogMock.getRecordForUnit.calls.reset();
        megaMekAvailabilityCatalogMock.getRecordForUnit.and.returnValue(undefined);
        megaMekFactionsCatalogMock.initialize.calls.reset();
        megaMekFactionsCatalogMock.initialize.and.resolveTo(undefined);
        megaMekFactionsCatalogMock.getFactions.calls.reset();
        megaMekFactionsCatalogMock.getFactions.and.returnValue({});
        megaMekFactionsCatalogMock.getFactionByKey.calls.reset();
        megaMekFactionsCatalogMock.getFactionByKey.and.returnValue(undefined);
        megaMekFactionsCatalogMock.getFactionsByMulId.calls.reset();
        megaMekFactionsCatalogMock.getFactionsByMulId.and.returnValue([]);
        megaMekFactionsCatalogMock.getFactionAffiliation.calls.reset();
        megaMekFactionsCatalogMock.getFactionAffiliation.and.returnValue('Other');
        megaMekRulesetsCatalogMock.initialize.calls.reset();
        megaMekRulesetsCatalogMock.initialize.and.resolveTo(undefined);
        megaMekRulesetsCatalogMock.getRulesets.calls.reset();
        megaMekRulesetsCatalogMock.getRulesets.and.returnValue([]);
        megaMekRulesetsCatalogMock.getRulesetByFactionKey.calls.reset();
        megaMekRulesetsCatalogMock.getRulesetByFactionKey.and.returnValue(undefined);
        mulUnitSourcesCatalogMock.initialize.calls.reset();
        mulUnitSourcesCatalogMock.initialize.and.resolveTo(undefined);
        quirksCatalogMock.initialize.calls.reset();
        quirksCatalogMock.initialize.and.resolveTo(undefined);
        quirksCatalogMock.getQuirkByName.calls.reset();
        quirksCatalogMock.getQuirkByName.and.returnValue(undefined);
        sourcebooksCatalogMock.initialize.calls.reset();
        sourcebooksCatalogMock.initialize.and.resolveTo(undefined);
        sourcebooksCatalogMock.getSourcebookByAbbrev.calls.reset();
        sourcebooksCatalogMock.getSourcebookByAbbrev.and.returnValue(undefined);
        sourcebooksCatalogMock.getSourcebookTitle.calls.reset();
        sourcebooksCatalogMock.getSourcebookTitle.and.callFake((abbrev: string) => abbrev);
        tagsServiceMock.setRefreshUnitsCallback.calls.reset();
        tagsServiceMock.setNotifyStoreUpdatedCallback.calls.reset();
        tagsServiceMock.registerWsHandlers.calls.reset();
        tagsServiceMock.syncFromCloud.calls.reset();
        publicTagsServiceMock.setRefreshUnitsCallback.calls.reset();
        publicTagsServiceMock.initialize.calls.reset();
        publicTagsServiceMock.registerWsHandlers.calls.reset();
        loggerServiceMock.info.calls.reset();
        loggerServiceMock.warn.calls.reset();
        loggerServiceMock.error.calls.reset();

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                DataService,
                { provide: DbService, useValue: dbServiceMock },
                { provide: WsService, useValue: wsServiceMock },
                { provide: UserStateService, useValue: userStateServiceMock },
                { provide: UnitInitializerService, useValue: {} },
                { provide: UnitRuntimeService, useValue: unitRuntimeServiceMock },
                { provide: UnitSearchIndexService, useValue: unitSearchIndexServiceMock },
                { provide: UnitsCatalogService, useValue: unitsCatalogMock },
                { provide: EquipmentCatalogService, useValue: equipmentCatalogMock },
                { provide: ErasCatalogService, useValue: erasCatalogMock },
                { provide: FactionsCatalogService, useValue: factionsCatalogMock },
                { provide: MegaMekAvailabilityCatalogService, useValue: megaMekAvailabilityCatalogMock },
                { provide: MegaMekFactionsCatalogService, useValue: megaMekFactionsCatalogMock },
                { provide: MegaMekRulesetsCatalogService, useValue: megaMekRulesetsCatalogMock },
                { provide: MulUnitSourcesCatalogService, useValue: mulUnitSourcesCatalogMock },
                { provide: QuirksCatalogService, useValue: quirksCatalogMock },
                { provide: SourcebooksCatalogService, useValue: sourcebooksCatalogMock },
                { provide: TagsService, useValue: tagsServiceMock },
                { provide: PublicTagsService, useValue: publicTagsServiceMock },
                { provide: LoggerService, useValue: loggerServiceMock },
            ],
        });

        service = TestBed.inject(DataService);
    });

    it('delegates unit lookup to the runtime service', () => {
        service.getUnitByName('Mad Cat Prime');

        expect(unitRuntimeServiceMock.getUnitByName).toHaveBeenCalledOnceWith('Mad Cat Prime');
    });

    it('merges local force entries with lightweight cloud bulk entries', async () => {
        const atlas = createUnit('Atlas');
        unitRuntimeServiceMock.getUnitByName.and.callFake((name: string) => name === 'Atlas' ? atlas : undefined);

        dbServiceMock.getForce.and.callFake(async (instanceId: string) => {
            if (instanceId !== 'force-1') return null;
            return {
                version: 1,
                instanceId: 'force-1',
                timestamp: '2026-04-01T00:00:00Z',
                type: GameSystem.ALPHA_STRIKE,
                name: 'Local Force',
                groups: [{
                    id: 'group-1',
                    units: [{
                        id: 'unit-1',
                        unit: 'Atlas',
                        state: {
                            modified: false,
                            destroyed: false,
                            shutdown: false,
                        },
                    }],
                }],
            };
        });
        wsServiceMock.sendAndWaitForResponse.and.resolveTo({
            data: [
                {
                    instanceId: 'force-1',
                    timestamp: '2026-04-02T00:00:00Z',
                    type: GameSystem.ALPHA_STRIKE,
                    name: 'Cloud Force',
                    owned: false,
                    groups: [{
                        name: 'Lance',
                        formationId: 'formation-1',
                        units: [{ unit: 'Atlas', alias: 'Skull', state: { destroyed: true } }],
                    }],
                },
                {
                    instanceId: 'force-2',
                    timestamp: '2026-04-03T00:00:00Z',
                    type: GameSystem.CLASSIC,
                    name: 'Cloud Only',
                    owned: true,
                    groups: [{
                        name: 'Star',
                        units: [{ unit: 'Atlas', state: { destroyed: false } }],
                    }],
                },
            ],
        });
        spyOn<any>(service, 'canUseCloud').and.returnValue(Promise.resolve({} as WebSocket));

        const entries = await service.getLoadForceEntriesByIds(['force-1', 'force-2']);

        expect(wsServiceMock.sendAndWaitForResponse).toHaveBeenCalledWith({
            action: 'getForcesBulk',
            instanceIds: ['force-1', 'force-2'],
        });
        expect(entries.map((entry) => entry.instanceId)).toEqual(['force-1', 'force-2']);
        expect(entries[0].name).toBe('Cloud Force');
        expect(entries[0].local).toBeTrue();
        expect(entries[0].cloud).toBeTrue();
        expect(entries[0].owned).toBeFalse();
        expect(entries[0].groups[0].formationId).toBe('formation-1');
        expect(entries[0].groups[0].units[0]).toEqual({ unit: atlas, alias: 'Skull', destroyed: true });
        expect(entries[1].name).toBe('Cloud Only');
        expect(entries[1].local).toBeFalse();
        expect(entries[1].cloud).toBeTrue();
        expect(entries[1].groups[0].units[0].unit).toBe(atlas);
    });

    it('caches missing forces locally via full force fetches', async () => {
        dbServiceMock.getForce.and.callFake(async (instanceId: string) => (
            instanceId === 'force-local'
                ? {
                    version: 1,
                    instanceId,
                    timestamp: '2026-04-01T00:00:00Z',
                    type: GameSystem.CLASSIC,
                    name: 'Local Only',
                    groups: [],
                }
                : null
        ));
        wsServiceMock.sendAndWaitForResponse.and.callFake(async (payload: { instanceId: string }) => {
            if (payload.instanceId === 'force-missing') {
                return {
                    data: {
                        version: 1,
                        instanceId: 'force-missing',
                        timestamp: '2026-04-05T00:00:00Z',
                        type: GameSystem.CLASSIC,
                        name: 'Fetched Force',
                        groups: [],
                    },
                };
            }

            return { data: null };
        });
        spyOn<any>(service, 'canUseCloud').and.returnValue(Promise.resolve({} as WebSocket));

        const cached = await service.cacheForcesLocally(['force-local', 'force-missing', 'force-unknown', 'force-missing']);

        expect(cached).toBe(1);
        expect(wsServiceMock.sendAndWaitForResponse).toHaveBeenCalledWith({
            action: 'getForce',
            uuid: 'user-1',
            instanceId: 'force-missing',
            ownedOnly: false,
        });
        expect(wsServiceMock.sendAndWaitForResponse).toHaveBeenCalledWith({
            action: 'getForce',
            uuid: 'user-1',
            instanceId: 'force-unknown',
            ownedOnly: false,
        });
        expect(dbServiceMock.saveForce).toHaveBeenCalledTimes(1);
        expect(dbServiceMock.saveForce).toHaveBeenCalledWith(jasmine.objectContaining({ instanceId: 'force-missing' }));
    });

    it('skips MegaMek catalogs during startup initialize', async () => {
        await service.initialize();

        expect(megaMekAvailabilityCatalogMock.initialize).not.toHaveBeenCalled();
        expect(megaMekFactionsCatalogMock.initialize).not.toHaveBeenCalled();
        expect(megaMekRulesetsCatalogMock.initialize).not.toHaveBeenCalled();
        expect(quirksCatalogMock.initialize).toHaveBeenCalledTimes(1);
        expect(sourcebooksCatalogMock.initialize).toHaveBeenCalledTimes(1);
        expect(service.isDataReady()).toBeTrue();
    });

    it('initializes MegaMek availability on demand once and bumps the search corpus version', async () => {
        expect(service.searchCorpusVersion()).toBe(0);

        expect(await service.ensureMegaMekAvailabilityCatalogInitialized()).toBeTrue();
        expect(service.searchCorpusVersion()).toBe(1);
        expect(megaMekAvailabilityCatalogMock.initialize).toHaveBeenCalledTimes(1);

        expect(await service.ensureMegaMekAvailabilityCatalogInitialized()).toBeTrue();
        expect(service.searchCorpusVersion()).toBe(1);
        expect(megaMekAvailabilityCatalogMock.initialize).toHaveBeenCalledTimes(1);
    });

    it('logs the failing startup catalog name during initialize', async () => {
        quirksCatalogMock.initialize.and.rejectWith(
            new TypeError("Cannot read properties of undefined (reading 'length')"),
        );

        await service.initialize();

        expect(loggerServiceMock.error.calls.allArgs()).toContain([
            'Failed to initialize catalog service "quirks": TypeError: Cannot read properties of undefined (reading \'length\')',
        ]);
        expect(loggerServiceMock.error.calls.allArgs()).toContain([
            'Failed to initialize 1 catalog service: "quirks"',
        ]);
        expect(service.isDataReady()).toBeTrue();
    });
});