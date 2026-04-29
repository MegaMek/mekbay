import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Unit } from '../models/units.model';
import { DbService, type TagData, type TagOp } from './db.service';
import { DialogsService } from './dialogs.service';
import { LoggerService } from './logger.service';
import { TagsService } from './tags.service';
import { UserStateService } from './userState.service';
import { WsService } from './ws.service';

function createUnit(name: string): Unit {
    return {
        name,
        chassis: 'Dasher',
        type: 'Mek',
    } as Unit;
}

describe('TagsService', () => {
    let service: TagsService;
    let tagData: TagData;

    const dbServiceMock = {
        getAllTagData: jasmine.createSpy('getAllTagData'),
        saveAllTagData: jasmine.createSpy('saveAllTagData'),
        appendTagOps: jasmine.createSpy('appendTagOps'),
        getTagSyncState: jasmine.createSpy('getTagSyncState'),
        clearPendingTagOps: jasmine.createSpy('clearPendingTagOps'),
    };
    const wsServiceMock = {
        getWebSocket: jasmine.createSpy('getWebSocket'),
        sendAndWaitForResponse: jasmine.createSpy('sendAndWaitForResponse'),
        registerMessageHandler: jasmine.createSpy('registerMessageHandler'),
    };
    const userStateServiceMock = {
        uuid: jasmine.createSpy('uuid'),
    };
    const loggerServiceMock = {
        info: jasmine.createSpy('info'),
        warn: jasmine.createSpy('warn'),
        error: jasmine.createSpy('error'),
    };
    const dialogsServiceMock = {
        choose: jasmine.createSpy('choose'),
    };

    beforeEach(() => {
        TestBed.resetTestingModule();

        tagData = {
            tags: {
                cjf: {
                    label: 'CJF',
                    units: {
                        'Dasher A': {},
                        'Dasher B': {},
                        'Dasher C': {},
                    },
                    chassis: {},
                },
                cgb: {
                    label: 'CGB',
                    units: {
                        'Dasher A': {},
                        'Dasher B': {},
                        'Dasher C': {},
                    },
                    chassis: {},
                },
                clan: {
                    label: 'CLAN',
                    units: {
                        'Dasher A': {},
                        'Dasher B': {},
                        'Dasher C': {},
                    },
                    chassis: {},
                },
            },
            timestamp: 1,
            formatVersion: 3,
        };

        dbServiceMock.getAllTagData.calls.reset();
        dbServiceMock.getAllTagData.and.resolveTo(tagData);
        dbServiceMock.saveAllTagData.calls.reset();
        dbServiceMock.saveAllTagData.and.resolveTo(undefined);
        dbServiceMock.appendTagOps.calls.reset();
        dbServiceMock.appendTagOps.and.resolveTo(undefined);
        dbServiceMock.getTagSyncState.calls.reset();
        dbServiceMock.getTagSyncState.and.resolveTo({ pendingOps: [], lastSyncTs: 0 });
        dbServiceMock.clearPendingTagOps.calls.reset();
        dbServiceMock.clearPendingTagOps.and.resolveTo(undefined);
        wsServiceMock.getWebSocket.calls.reset();
        wsServiceMock.sendAndWaitForResponse.calls.reset();
        wsServiceMock.registerMessageHandler.calls.reset();
        userStateServiceMock.uuid.calls.reset();
        userStateServiceMock.uuid.and.returnValue(null);
        loggerServiceMock.info.calls.reset();
        loggerServiceMock.warn.calls.reset();
        loggerServiceMock.error.calls.reset();
        dialogsServiceMock.choose.calls.reset();

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                TagsService,
                { provide: DbService, useValue: dbServiceMock },
                { provide: WsService, useValue: wsServiceMock },
                { provide: UserStateService, useValue: userStateServiceMock },
                { provide: LoggerService, useValue: loggerServiceMock },
                { provide: DialogsService, useValue: dialogsServiceMock },
            ],
        });

        service = TestBed.inject(TagsService);
    });

    it('removes duplicate unit tags from every selected unit when adding a chassis tag', async () => {
        const units = [createUnit('Dasher A'), createUnit('Dasher B'), createUnit('Dasher C')];

        await service.modifyTag(units, 'CLAN', 'chassis', 'add');

        const savedData = (await service.getTagData()).tags;
        expect(savedData['clan'].units).toEqual({});
        expect(savedData['clan'].chassis).toEqual({ 'Dasher|Mek': {} });
        expect(savedData['cjf'].units).toEqual({
            'Dasher A': {},
            'Dasher B': {},
            'Dasher C': {},
        });
        expect(savedData['cgb'].units).toEqual({
            'Dasher A': {},
            'Dasher B': {},
            'Dasher C': {},
        });

        const [ops] = dbServiceMock.appendTagOps.calls.mostRecent().args as [TagOp[], TagData];
        expect(ops.length).toBe(4);
        expect(ops).toEqual(jasmine.arrayContaining([
            jasmine.objectContaining({ k: 'Dasher A', t: 'CLAN', c: 0, a: 0 }),
            jasmine.objectContaining({ k: 'Dasher B', t: 'CLAN', c: 0, a: 0 }),
            jasmine.objectContaining({ k: 'Dasher C', t: 'CLAN', c: 0, a: 0 }),
            jasmine.objectContaining({ k: 'Dasher|Mek', t: 'CLAN', c: 1, a: 1 }),
        ]));
    });

    it('persists cleanup of unit tags covered by same-named chassis tags', async () => {
        tagData.tags['clan'].chassis['Dasher|Mek'] = {};
        const units = [createUnit('Dasher A'), createUnit('Dasher B'), createUnit('Dasher C')];

        await service.fixNameTagsCoveredByChassis(units, tagData);

        expect(tagData.tags['clan'].units).toEqual({});
        const [ops] = dbServiceMock.appendTagOps.calls.mostRecent().args as [TagOp[], TagData];
        expect(ops.length).toBe(3);
        expect(ops).toEqual(jasmine.arrayContaining([
            jasmine.objectContaining({ k: 'Dasher A', t: 'CLAN', c: 0, a: 0 }),
            jasmine.objectContaining({ k: 'Dasher B', t: 'CLAN', c: 0, a: 0 }),
            jasmine.objectContaining({ k: 'Dasher C', t: 'CLAN', c: 0, a: 0 }),
        ]));
    });
});
