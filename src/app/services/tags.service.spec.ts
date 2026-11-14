// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { UnitSummary } from '../models/unit-summary.model';
import { DbService, type TagData, type TagOp, type TagSyncState } from './db.service';
import { DialogsService } from './dialogs.service';
import { LoggerService } from './logger.service';
import { TagsService } from './tags.service';
import { UserStateService } from './userState.service';
import { WsService } from './ws.service';
import { createEmptyUnit } from '../testing/unit-test-helpers';

function createUnit(name: string): UnitSummary {
    return createEmptyUnit({
        name,
        chassis: 'Dasher',
        type: 'Mek',
    });
}

/** Lets queued cloud uploads run. */
const settle = () => new Promise(resolve => setTimeout(resolve));

describe('TagsService', () => {
    let service: TagsService;
    let tagData: TagData;
    let syncState: TagSyncState;
    let units: UnitSummary[];
    let dasherA: UnitSummary;
    let dasherB: UnitSummary;
    let dasherC: UnitSummary;

    // Pending ops and lastSyncTs behave like the IndexedDB queue.
    const dbServiceMock = {
        getAllTagData: jasmine.createSpy('getAllTagData'),
        saveAllTagData: jasmine.createSpy('saveAllTagData'),
        saveMigratedTagData: jasmine.createSpy('saveMigratedTagData'),
        appendTagOps: jasmine.createSpy('appendTagOps'),
        getTagSyncState: jasmine.createSpy('getTagSyncState'),
        clearPendingTagOps: jasmine.createSpy('clearPendingTagOps'),
        resetTagSyncTimestamp: jasmine.createSpy('resetTagSyncTimestamp'),
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

    function enableCloud(getTagOpsResponse: object, fullStateResponse: object = getTagOpsResponse): void {
        userStateServiceMock.uuid.and.returnValue('user-1');
        wsServiceMock.getWebSocket.and.returnValue({ readyState: WebSocket.OPEN } as WebSocket);
        wsServiceMock.sendAndWaitForResponse.and.callFake(async (message: { action: string; since?: number }) => {
            if (message.action === 'getTagOps') {
                return message.since === 0 ? fullStateResponse : getTagOpsResponse;
            }
            return { serverTs: 11 };
        });
    }

    function sentActions(): string[] {
        return wsServiceMock.sendAndWaitForResponse.calls.allArgs()
            .map(([message]) => (message as { action: string }).action);
    }

    beforeEach(() => {
        TestBed.resetTestingModule();

        dasherA = createUnit('Dasher A');
        dasherB = createUnit('Dasher B');
        dasherC = createUnit('Dasher C');
        units = [dasherA, dasherB, dasherC];
        const unitKeys = () => ({
            [dasherA.uuid]: {},
            [dasherB.uuid]: {},
            [dasherC.uuid]: {},
        });
        tagData = {
            tags: {
                cjf: { label: 'CJF', units: unitKeys(), chassis: {} },
                cgb: { label: 'CGB', units: unitKeys(), chassis: {} },
                clan: { label: 'CLAN', units: unitKeys(), chassis: {} },
            },
            timestamp: 1,
            formatVersion: 5,
        };
        syncState = { pendingOps: [], lastSyncTs: 0 };

        for (const spy of [...Object.values(dbServiceMock), ...Object.values(wsServiceMock),
            userStateServiceMock.uuid, ...Object.values(loggerServiceMock), dialogsServiceMock.choose]) {
            spy.calls.reset();
        }
        dbServiceMock.getAllTagData.and.callFake(async () => tagData);
        dbServiceMock.saveAllTagData.and.resolveTo(undefined);
        dbServiceMock.saveMigratedTagData.and.callFake(async (_data: TagData, migrateOps: (ops: TagOp[]) => TagOp[]) => {
            syncState.pendingOps = migrateOps(syncState.pendingOps);
        });
        dbServiceMock.appendTagOps.and.callFake(async (ops: TagOp[]) => {
            syncState.pendingOps.push(...ops);
        });
        dbServiceMock.getTagSyncState.and.callFake(async () => ({ ...syncState, pendingOps: [...syncState.pendingOps] }));
        dbServiceMock.clearPendingTagOps.and.callFake(async (syncTs: number, settledCount: number) => {
            syncState = { pendingOps: syncState.pendingOps.slice(settledCount), lastSyncTs: syncTs };
            return [...syncState.pendingOps];
        });
        dbServiceMock.resetTagSyncTimestamp.and.callFake(async () => {
            syncState.lastSyncTs = 0;
        });
        wsServiceMock.getWebSocket.and.returnValue(null);
        userStateServiceMock.uuid.and.returnValue(null);

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

    it('keys unit tags by unit UUID, not by the shared unit name', async () => {
        const sameName = createUnit('Dasher A');

        await service.modifyTag([sameName], 'Scout', 'name', 'add', 2);

        expect((await service.getTagData()).tags['scout'].units).toEqual({ [sameName.uuid]: { q: 2 } });
        const [ops] = dbServiceMock.appendTagOps.calls.mostRecent().args as [TagOp[], TagData];
        expect(ops).toEqual([jasmine.objectContaining({ k: sameName.uuid, t: 'Scout', c: 0, a: 1, q: 2 })]);
    });

    it('removes duplicate unit tags from every selected unit when adding a chassis tag', async () => {
        await service.modifyTag(units, 'CLAN', 'chassis', 'add');

        const savedData = (await service.getTagData()).tags;
        expect(savedData['clan'].units).toEqual({});
        expect(savedData['clan'].chassis).toEqual({ 'Dasher|BM': {} });
        expect(Object.keys(savedData['cjf'].units)).toEqual([dasherA.uuid, dasherB.uuid, dasherC.uuid]);
        expect(Object.keys(savedData['cgb'].units)).toEqual([dasherA.uuid, dasherB.uuid, dasherC.uuid]);

        const [ops] = dbServiceMock.appendTagOps.calls.mostRecent().args as [TagOp[], TagData];
        expect(ops.length).toBe(4);
        expect(ops).toEqual(jasmine.arrayContaining([
            jasmine.objectContaining({ k: dasherA.uuid, t: 'CLAN', c: 0, a: 0 }),
            jasmine.objectContaining({ k: dasherB.uuid, t: 'CLAN', c: 0, a: 0 }),
            jasmine.objectContaining({ k: dasherC.uuid, t: 'CLAN', c: 0, a: 0 }),
            jasmine.objectContaining({ k: 'Dasher|BM', t: 'CLAN', c: 1, a: 1 }),
        ]));
    });

    it('persists cleanup of unit tags covered by same-named chassis tags', async () => {
        tagData.tags['clan'].chassis['Dasher|BM'] = {};

        await service.fixNameTagsCoveredByChassis(units, tagData);

        expect(tagData.tags['clan'].units).toEqual({});
        const [ops] = dbServiceMock.appendTagOps.calls.mostRecent().args as [TagOp[], TagData];
        expect(ops.length).toBe(3);
        expect(ops).toEqual(jasmine.arrayContaining([
            jasmine.objectContaining({ k: dasherA.uuid, t: 'CLAN', c: 0, a: 0 }),
            jasmine.objectContaining({ k: dasherB.uuid, t: 'CLAN', c: 0, a: 0 }),
            jasmine.objectContaining({ k: dasherC.uuid, t: 'CLAN', c: 0, a: 0 }),
        ]));
    });

    it('migrates each V3 unit name to the one unit carrying it and drops names no unit carries', async () => {
        const customTwin = createEmptyUnit({ name: 'Dasher A', chassis: 'Dasher', type: 'Mek', isCustom: true });
        tagData = {
            tags: {
                scout: {
                    label: 'Scout',
                    units: { 'Dasher A': { q: 3 }, [dasherB.uuid]: { q: 2 }, 'Dasher B': {}, 'dasher c': {} },
                    chassis: {},
                },
                retired: { label: 'Retired', units: { 'Retired Unit': { q: 4 } }, chassis: {} },
            },
            timestamp: 1,
            formatVersion: 4,
        };
        syncState.pendingOps = [
            { k: 'Dasher A', t: 'Scout', c: 0, a: 1, ts: 2 },
            { k: 'Retired Unit', t: 'Retired', c: 0, a: 0, ts: 2 },
            { k: '', t: 'Scout', c: 0, a: 2, ts: 2, n: 'Recon' },
        ];

        const migrated = await service.migrateTagKeys([...units, customTwin], tagData);

        expect(migrated.formatVersion).toBe(5);
        // Names are exact; the core unit precedes its same-named custom twin.
        expect(migrated.tags).toEqual({
            scout: { label: 'Scout', units: { [dasherA.uuid]: { q: 3 }, [dasherB.uuid]: { q: 2 } }, chassis: {} },
        });
        expect(syncState.pendingOps).toEqual([
            { k: dasherA.uuid, t: 'Scout', c: 0, a: 1, ts: 2 },
            { k: '', t: 'Scout', c: 0, a: 2, ts: 2, n: 'Recon' },
        ]);
        expect(dbServiceMock.saveMigratedTagData).toHaveBeenCalledOnceWith(migrated, jasmine.any(Function));
        expect(wsServiceMock.sendAndWaitForResponse).not.toHaveBeenCalled();
    });

    it('migrates format 3 chassis tags to every matching variant group', async () => {
        tagData.tags['clan'].units = {};
        tagData.tags['clan'].chassis = {
            'Centurion|Mek': { q: 2 },
        };
        tagData.formatVersion = 3;
        const centurions = [
            createEmptyUnit({ name: 'Centurion CN9-A', chassis: 'Centurion', type: 'Mek', omni: 0, as: { TP: 'BM' } }),
            createEmptyUnit({ name: 'Centurion Omni', chassis: 'Centurion', type: 'Mek', omni: 1, as: { TP: 'BM' } }),
            createEmptyUnit({ name: 'Centurion Industrial', chassis: 'Centurion', type: 'Mek', omni: 0, as: { TP: 'IM' } }),
        ];

        const migrated = await service.migrateTagKeys(centurions, tagData);

        expect(migrated.formatVersion).toBe(5);
        expect(migrated.tags['clan'].chassis).toEqual({
            'Centurion|BM': { q: 2 },
            'Centurion|BM|O': { q: 2 },
            'Centurion|IM': { q: 2 },
        });
        expect(dbServiceMock.saveMigratedTagData).toHaveBeenCalledWith(migrated, jasmine.any(Function));
    });

    it('leaves a V4 document alone, keeping keys of units outside the current catalog', async () => {
        tagData.tags['custom'] = { label: 'Custom', units: { 'custom-not-projected-yet': { q: 2 } }, chassis: {} };
        const stored = structuredClone(tagData);

        await service.migrateTagKeys(units, tagData);

        expect(tagData).toEqual(stored);
        expect(dbServiceMock.saveMigratedTagData).not.toHaveBeenCalled();
        expect(dbServiceMock.appendTagOps).not.toHaveBeenCalled();
    });

    it('waits for the local migration before reading the cloud', async () => {
        enableCloud({ serverTs: 10, ops: [], formatVersion: 5 });

        const sync = service.syncFromCloud();
        await settle();
        expect(wsServiceMock.sendAndWaitForResponse).not.toHaveBeenCalled();

        await service.migrateTagKeys(units, tagData);
        await sync;

        expect(sentActions()).toEqual(['getTagOps']);
    });

    it('migrates a V3 cloud copy before applying it and then upgrades the cloud copy', async () => {
        await service.migrateTagKeys(units, tagData);
        enableCloud({
            serverTs: 10,
            formatVersion: 4,
            fullState: {
                tags: { scout: { label: 'Scout', units: { 'Dasher A': {}, 'Dasher B': { q: 2 }, 'Gone Unit': {} }, chassis: {} } },
                timestamp: 10,
                formatVersion: 4,
            },
        });

        await service.syncFromCloud();

        const local = await service.getTagData();
        expect(local.formatVersion).toBe(5);
        expect(local.tags).toEqual({
            scout: { label: 'Scout', units: { [dasherA.uuid]: {}, [dasherB.uuid]: { q: 2 } }, chassis: {} },
        });
        expect(sentActions()).toEqual(['getTagOps', 'setTagState']);
        expect(wsServiceMock.sendAndWaitForResponse).toHaveBeenCalledWith(jasmine.objectContaining({
            action: 'setTagState',
            uuid: 'user-1',
            data: local,
        }));
        expect(syncState.lastSyncTs).toBe(11);
    });

    it('rebuilds an older-format cloud copy from its full state plus the pending ops', async () => {
        // A V3 offline edit, stored and queued under the unit name.
        tagData = {
            tags: { scout: { label: 'Scout', units: { 'Dasher A': {} }, chassis: {} } },
            timestamp: 1,
            formatVersion: 4,
        };
        syncState = { pendingOps: [{ k: 'Dasher A', t: 'Scout', c: 0, a: 1, ts: 2 }], lastSyncTs: 10 };
        await service.migrateTagKeys(units, tagData);
        // lastSyncTs reads as current, yet the cloud copy holds another device's tag.
        enableCloud({ serverTs: 10, ops: [], formatVersion: 4 }, {
            serverTs: 10,
            formatVersion: 4,
            fullState: {
                tags: { recon: { label: 'Recon', units: { 'Dasher C': { q: 2 } }, chassis: {} } },
                timestamp: 10,
                formatVersion: 4,
            },
        });

        await service.syncFromCloud();

        const local = await service.getTagData();
        expect(local.tags).toEqual({
            recon: { label: 'Recon', units: { [dasherC.uuid]: { q: 2 } }, chassis: {} },
            scout: { label: 'Scout', units: { [dasherA.uuid]: {} }, chassis: {} },
        });
        expect(sentActions()).toEqual(['getTagOps', 'getTagOps', 'setTagState']);
        expect(wsServiceMock.sendAndWaitForResponse).toHaveBeenCalledWith(jasmine.objectContaining({
            action: 'setTagState',
            data: local,
        }));
        expect(dialogsServiceMock.choose).not.toHaveBeenCalled();
        expect(syncState).toEqual({ pendingOps: [], lastSyncTs: 11 });
    });

    it('uploads pending ops queued before the migration with UUID keys', async () => {
        tagData.formatVersion = 4;
        syncState = { pendingOps: [{ k: 'Dasher A', t: 'Scout', c: 0, a: 1, ts: 2 }], lastSyncTs: 10 };
        await service.migrateTagKeys(units, tagData);
        enableCloud({ serverTs: 10, ops: [], formatVersion: 5 });

        await service.syncFromCloud();

        expect(wsServiceMock.sendAndWaitForResponse).toHaveBeenCalledWith(jasmine.objectContaining({
            action: 'tagOps',
            ops: [{ k: dasherA.uuid, t: 'Scout', c: 0, a: 1, ts: 2 }],
        }));
        expect(syncState).toEqual({ pendingOps: [], lastSyncTs: 11 });
    });

    it('holds tag ops back until the cloud is reconciled on the current connection', async () => {
        await service.migrateTagKeys(units, tagData);
        enableCloud({ serverTs: 10, ops: [], formatVersion: 5 });
        syncState.lastSyncTs = 10;

        await service.modifyTag([dasherA], 'Scout', 'name', 'add');
        await settle();
        expect(sentActions()).toEqual([]);

        await service.syncFromCloud();
        expect(sentActions()).toEqual(['getTagOps', 'tagOps']);

        await service.modifyTag([dasherB], 'Scout', 'name', 'add');
        await settle();
        expect(sentActions()).toEqual(['getTagOps', 'tagOps', 'tagOps']);
        expect(syncState.pendingOps).toEqual([]);

        // A reconnected socket is not reconciled yet.
        wsServiceMock.getWebSocket.and.returnValue({ readyState: WebSocket.OPEN } as WebSocket);
        await service.modifyTag([dasherC], 'Scout', 'name', 'add');
        await settle();
        expect(sentActions().length).toBe(3);
        expect(syncState.pendingOps).toEqual([jasmine.objectContaining({ k: dasherC.uuid, t: 'Scout', a: 1 })]);
    });

    it('merges a conflict by replaying the pending ops on the cloud state, keeping its removals', async () => {
        await service.migrateTagKeys(units, tagData);
        syncState = { pendingOps: [{ k: dasherA.uuid, t: 'Scout', c: 0, a: 1, ts: 6 }], lastSyncTs: 5 };
        // Another device removed CJF, which this device still has.
        const cloudTags = structuredClone(tagData.tags);
        delete cloudTags['cjf'];
        enableCloud({ serverTs: 10, formatVersion: 5, fullState: { tags: cloudTags, timestamp: 10, formatVersion: 5 } });
        dialogsServiceMock.choose.and.resolveTo('merge');

        await service.syncFromCloud();

        const local = await service.getTagData();
        expect(Object.keys(local.tags).sort()).toEqual(['cgb', 'clan', 'scout']);
        expect(local.tags['scout'].units).toEqual({ [dasherA.uuid]: {} });
        expect(sentActions()).toEqual(['getTagOps', 'setTagState']);
        expect(syncState).toEqual({ pendingOps: [], lastSyncTs: 11 });
    });

    it('keeps pending ops when another session resets the cloud state', async () => {
        await service.migrateTagKeys(units, tagData);
        service.registerWsHandlers();
        const reset = wsServiceMock.registerMessageHandler.calls.allArgs()
            .find(([action]) => action === 'tagStateReset')![1] as () => Promise<void>;
        syncState = { pendingOps: [{ k: dasherA.uuid, t: 'Scout', c: 0, a: 1, ts: 6 }], lastSyncTs: 10 };
        const cloudTags = { cgb: structuredClone(tagData.tags['cgb']) };
        enableCloud({ serverTs: 12, ops: [], formatVersion: 5 },
            { serverTs: 12, formatVersion: 5, fullState: { tags: cloudTags, timestamp: 12, formatVersion: 5 } });
        dialogsServiceMock.choose.and.resolveTo('merge');

        await reset();

        expect(dialogsServiceMock.choose).toHaveBeenCalled();
        const local = await service.getTagData();
        expect(Object.keys(local.tags).sort()).toEqual(['cgb', 'scout']);
        expect(sentActions()).toEqual(['getTagOps', 'setTagState']);
        expect(syncState).toEqual({ pendingOps: [], lastSyncTs: 11 });
    });

    it('persists deletion of empty tag entries', async () => {
        tagData.tags['empty'] = { label: 'Empty', units: {}, chassis: {} };

        await service.deleteTag('Empty');

        expect(tagData.tags['empty']).toBeUndefined();
        expect(dbServiceMock.appendTagOps).not.toHaveBeenCalled();
        expect(dbServiceMock.saveAllTagData).toHaveBeenCalledOnceWith(tagData);
    });
});
