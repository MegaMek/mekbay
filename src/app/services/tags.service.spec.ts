import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Unit } from '../models/units.model';
import { DbService, type TagData, type TagOp } from './db.service';
import { DialogsService } from './dialogs.service';
import { LoggerService } from './logger.service';
import { TagsService } from './tags.service';
import { UserStateService } from './userState.service';
import { WsService } from './ws.service';
import { createEmptyUnit } from '../testing/unit-test-helpers';

function createUnit(name: string): Unit {
    return createEmptyUnit({
        name,
        chassis: 'Dasher',
        type: 'Mek',
    });
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
        expect(savedData['clan'].chassis).toEqual({ 'Dasher|BM': {} });
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
            jasmine.objectContaining({ k: 'Dasher|BM', t: 'CLAN', c: 1, a: 1 }),
        ]));
    });

    it('persists cleanup of unit tags covered by same-named chassis tags', async () => {
        tagData.tags['clan'].chassis['Dasher|BM'] = {};
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

    it('migrates legacy chassis tags to every matching variant group', async () => {
        tagData.tags['clan'].units = {};
        tagData.tags['clan'].chassis = {
            'Centurion|Mek': { q: 2 },
        };
        tagData.formatVersion = 3;
        const units = [
            createEmptyUnit({ name: 'Centurion CN9-A', chassis: 'Centurion', type: 'Mek', omni: 0, as: { TP: 'BM' } }),
            createEmptyUnit({ name: 'Centurion Omni', chassis: 'Centurion', type: 'Mek', omni: 1, as: { TP: 'BM' } }),
            createEmptyUnit({ name: 'Centurion Industrial', chassis: 'Centurion', type: 'Mek', omni: 0, as: { TP: 'IM' } }),
        ];

        const migrated = await service.migrateChassisTagsToVariantGroups(units, tagData);

        expect(migrated.formatVersion).toBe(4);
        expect(migrated.tags['clan'].chassis).toEqual({
            'Centurion|BM': { q: 2 },
            'Centurion|BM|O': { q: 2 },
            'Centurion|IM': { q: 2 },
        });
        expect(dbServiceMock.saveAllTagData).toHaveBeenCalledWith(migrated);
    });

    it('pushes full local tag state when sync finds an older remote format', async () => {
        tagData.formatVersion = 4;
        userStateServiceMock.uuid.and.returnValue('user-1');
        wsServiceMock.getWebSocket.and.returnValue({ readyState: WebSocket.OPEN } as WebSocket);
        wsServiceMock.sendAndWaitForResponse.and.callFake(async (message: { action: string }) => {
            if (message.action === 'getTagOps') {
                return { serverTs: 10, ops: [], formatVersion: 3 };
            }

            return { serverTs: 11 };
        });

        await service.syncFromCloud();

        expect(wsServiceMock.sendAndWaitForResponse).toHaveBeenCalledWith(jasmine.objectContaining({
            action: 'setTagState',
            uuid: 'user-1',
            data: tagData,
        }));
        expect(dbServiceMock.clearPendingTagOps).toHaveBeenCalledWith(11);
    });

    it('persists deletion of empty tag entries', async () => {
        tagData.tags['empty'] = { label: 'Empty', units: {}, chassis: {} };

        await service.deleteTag('Empty');

        expect(tagData.tags['empty']).toBeUndefined();
        expect(dbServiceMock.appendTagOps).not.toHaveBeenCalled();
        expect(dbServiceMock.saveAllTagData).toHaveBeenCalledOnceWith(tagData);
    });
});
