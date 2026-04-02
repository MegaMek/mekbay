import { provideZonelessChangeDetection } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { Unit } from '../models/units.model';
import { DataService } from './data.service';
import { DbService } from './db.service';
import { LoggerService } from './logger.service';
import { PublicTagsService } from './public-tags.service';
import { TagsService } from './tags.service';
import { UnitInitializerService } from './unit-initializer.service';
import { UserStateService } from './userState.service';
import { WsService } from './ws.service';

function createUnit(name: string): Unit {
    return { name } as Unit;
}

describe('DataService', () => {
    let service: DataService;
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
                { provide: HttpClient, useValue: {} },
                { provide: DbService, useValue: {} },
                { provide: WsService, useValue: {} },
                { provide: UserStateService, useValue: {} },
                { provide: UnitInitializerService, useValue: {} },
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

    it('retrieves units by name without matching case exactly', () => {
        const unit = createUnit('Mad Cat Prime');

        service['rebuildUnitNameMap']([unit]);

        expect(service.getUnitByName('Mad Cat Prime')).toBe(unit);
        expect(service.getUnitByName('mad cat prime')).toBe(unit);
        expect(service.getUnitByName('MAD CAT PRIME')).toBe(unit);
    });
});