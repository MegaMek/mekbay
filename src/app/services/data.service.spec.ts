import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
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

describe('DataService', () => {
    let service: DataService;
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
        unitRuntimeServiceMock.getUnitByName.calls.reset();
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
                { provide: DbService, useValue: {} },
                { provide: WsService, useValue: {} },
                { provide: UserStateService, useValue: {} },
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
});