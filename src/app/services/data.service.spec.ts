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
import { MegaMekFactionsCatalogService } from './catalogs/megamek-factions-catalog.service';
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
    };
    const wsServiceMock = {
        sendAndWaitForResponse: jasmine.createSpy('sendAndWaitForResponse'),
    };
    const userStateServiceMock = {
        uuid: jasmine.createSpy('uuid').and.returnValue('user-1'),
    };
    const unitRuntimeServiceMock = {
        getUnitByName: jasmine.createSpy('getUnitByName').and.returnValue(undefined),
    };
    const tagsServiceMock = {
        setRefreshUnitsCallback: jasmine.createSpy('setRefreshUnitsCallback'),
        setNotifyStoreUpdatedCallback: jasmine.createSpy('setNotifyStoreUpdatedCallback'),
        registerWsHandlers: jasmine.createSpy('registerWsHandlers'),
    };
    const publicTagsServiceMock = {
        setRefreshUnitsCallback: jasmine.createSpy('setRefreshUnitsCallback'),
        initialize: jasmine.createSpy('initialize'),
        registerWsHandlers: jasmine.createSpy('registerWsHandlers'),
    };

    beforeEach(() => {
        TestBed.resetTestingModule();
        dbServiceMock.getForce.calls.reset();
        dbServiceMock.getForce.and.resolveTo(null);
        dbServiceMock.saveForce.calls.reset();
        wsServiceMock.sendAndWaitForResponse.calls.reset();
        wsServiceMock.sendAndWaitForResponse.and.resolveTo(undefined);
        userStateServiceMock.uuid.calls.reset();
        userStateServiceMock.uuid.and.returnValue('user-1');
        unitRuntimeServiceMock.getUnitByName.calls.reset();
        unitRuntimeServiceMock.getUnitByName.and.returnValue(undefined);
        tagsServiceMock.setRefreshUnitsCallback.calls.reset();
        tagsServiceMock.setNotifyStoreUpdatedCallback.calls.reset();
        tagsServiceMock.registerWsHandlers.calls.reset();
        publicTagsServiceMock.setRefreshUnitsCallback.calls.reset();
        publicTagsServiceMock.initialize.calls.reset();
        publicTagsServiceMock.registerWsHandlers.calls.reset();

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                DataService,
                { provide: DbService, useValue: dbServiceMock },
                { provide: WsService, useValue: wsServiceMock },
                { provide: UserStateService, useValue: userStateServiceMock },
                { provide: UnitInitializerService, useValue: {} },
                { provide: UnitRuntimeService, useValue: unitRuntimeServiceMock },
                { provide: UnitSearchIndexService, useValue: {} },
                { provide: UnitsCatalogService, useValue: {} },
                { provide: EquipmentCatalogService, useValue: {} },
                { provide: ErasCatalogService, useValue: {} },
                { provide: FactionsCatalogService, useValue: {} },
                { provide: MegaMekFactionsCatalogService, useValue: {} },
                { provide: MulUnitSourcesCatalogService, useValue: {} },
                { provide: QuirksCatalogService, useValue: {} },
                { provide: SourcebooksCatalogService, useValue: {} },
                { provide: TagsService, useValue: tagsServiceMock },
                { provide: PublicTagsService, useValue: publicTagsServiceMock },
                {
                    provide: LoggerService,
                    useValue: {
                        info: jasmine.createSpy('info'),
                        warn: jasmine.createSpy('warn'),
                        error: jasmine.createSpy('error'),
                    },
                },
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
});