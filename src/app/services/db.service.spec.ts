// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GameSystem } from '../models/common.model';
import type { SerializedForce } from '../models/force-serialization';
import { DbService } from './db.service';
import { DialogsService } from './dialogs.service';
import { LoggerService } from './logger.service';
import { createEmptyCBTForceForTest } from '../testing/unit-test-helpers';

describe('DbService current force persistence', () => {
    let service: DbService;
    const instanceId = `force-v2-db-${Date.now()}-${Math.random()}`;

    beforeEach(async () => {
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                DbService,
                { provide: LoggerService, useValue: { info: () => undefined, warn: () => undefined, error: () => undefined } },
                { provide: DialogsService, useValue: { choose: () => Promise.resolve('continue'), showError: () => Promise.resolve() } },
            ],
        });
        service = TestBed.inject(DbService);
        await service.waitForDbReady();
    });

    afterEach(async () => {
        await service.deleteForce(instanceId);
    });

    it('writes admitted compact V2 records without materializing their predecessor', async () => {
        const base: SerializedForce = {
            version: 2,
            timestamp: '2026-08-10T00:00:00.000Z',
            instanceId,
            type: GameSystem.CLASSIC,
            name: 'Protected DB Force',
            groups: [],
        };
        const revision = (value: number) => createEmptyCBTForceForTest(instanceId, value);
        const first = { ...base, cbt: revision(1) };

        await service.saveForce(first);
        const stored = await rawStoredForce(instanceId);
        expect(stored['cbt']).toEqual(jasmine.objectContaining({ r: 1, u: [], g: [] }));
        expect((stored['cbt'] as Record<string, unknown>)['schemaVersion']).toBeUndefined();
        expect((stored['cbt'] as Record<string, unknown>)['forceId']).toBeUndefined();
        await expectAsync(service.saveForce(base)).toBeRejectedWithError(/current CBT snapshot/u);
        expect((await service.getForce(instanceId))?.cbt).toEqual(first.cbt);

        const second = { ...base, timestamp: '2026-08-10T00:00:01.000Z', cbt: revision(2) };
        await service.saveForce(second);
        expect((await service.getForce(instanceId))?.cbt).toEqual(second.cbt);
    });

    it('replaces an unsupported development row without adding a migration for it', async () => {
        await putRawForce(instanceId, {
            version: 2,
            timestamp: '2026-08-10T00:00:00.000Z',
            instanceId,
            type: GameSystem.CLASSIC,
            name: 'Obsolete development row',
            cbt: { schemaVersion: 8, forceRevision: 99 },
        });
        const current: SerializedForce = {
            version: 2,
            timestamp: '2026-08-10T00:00:01.000Z',
            instanceId,
            type: GameSystem.CLASSIC,
            name: 'Current compact row',
            cbt: createEmptyCBTForceForTest(instanceId, 1),
        };

        await service.saveForce(current);

        const stored = await rawStoredForce(instanceId);
        expect(stored['name']).toBe('Current compact row');
        expect(stored['cbt']).toEqual(jasmine.objectContaining({ r: 1, u: [], g: [] }));
        expect((stored['cbt'] as Record<string, unknown>)['schemaVersion']).toBeUndefined();
    });
});

async function rawStoredForce(instanceId: string): Promise<Record<string, unknown>> {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('mekbay');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    try {
        return await new Promise<Record<string, unknown>>((resolve, reject) => {
            const transaction = database.transaction('forceStore', 'readonly');
            const request = transaction.objectStore('forceStore').get(instanceId);
            transaction.oncomplete = () => resolve(request.result as Record<string, unknown>);
            transaction.onerror = () => reject(transaction.error);
        });
    } finally {
        database.close();
    }
}

async function putRawForce(instanceId: string, force: Record<string, unknown>): Promise<void> {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('mekbay');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    try {
        await new Promise<void>((resolve, reject) => {
            const transaction = database.transaction('forceStore', 'readwrite');
            transaction.objectStore('forceStore').put(force, instanceId);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    } finally {
        database.close();
    }
}

describe('DbService blocked database upgrade', () => {
    it('rejects before one recovery dialog and closes a late successful connection', async () => {
        TestBed.resetTestingModule();
        const request = {} as IDBOpenDBRequest;
        spyOn(indexedDB, 'open').and.returnValue(request);
        let resolveChoice!: (choice: 'continue') => void;
        const choose = jasmine.createSpy('choose').and.returnValue(
            new Promise<'retry' | 'reset' | 'continue'>(resolve => {
                resolveChoice = resolve as (choice: 'continue') => void;
            }),
        );
        const showError = jasmine.createSpy('showError').and.resolveTo();
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                DbService,
                { provide: LoggerService, useValue: { info() {}, warn() {}, error() {} } },
                { provide: DialogsService, useValue: { choose, showError } },
            ],
        });
        const service = TestBed.inject(DbService);
        const ready = service.waitForDbReady();

        request.onblocked?.call(request, new Event('blocked') as IDBVersionChangeEvent);
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
        expect(choose).toHaveBeenCalledTimes(1);
        expect(showError).not.toHaveBeenCalled();
        const dialogOptions = choose.calls.mostRecent().args[4] as { readonly messageHtml: string };
        expect(dialogOptions.messageHtml).toContain('Close every other MekBay tab before retrying');

        const close = jasmine.createSpy('close');
        const lateDatabase = { close } as unknown as IDBDatabase;
        request.onsuccess?.call(request, {
            target: { result: lateDatabase },
        } as unknown as Event);
        expect(close).toHaveBeenCalledTimes(1);

        resolveChoice('continue');
        await ready;
        expect(service.isDegraded()).toBeTrue();
    });
});

describe('DbService legacy catalog cleanup', () => {
    it('deletes every disposable catalog row during the schema 17 upgrade', async () => {
        TestBed.resetTestingModule();
        const openRequest = {} as IDBOpenDBRequest;
        spyOn(indexedDB, 'open').and.returnValue(openRequest);
        const deletedKeys: string[] = [];
        const keyCursorRequest = {} as IDBRequest<IDBCursor | null>;
        const forceCursorRequest = {} as IDBRequest<IDBCursorWithValue | null>;
        const baseStore = {
            indexNames: { contains: () => true },
            createIndex: () => undefined,
        };
        const generalStore = {
            ...baseStore,
            delete: (key: IDBValidKey) => {
                deletedKeys.push(String(key));
                return {} as IDBRequest<undefined>;
            },
            openKeyCursor: () => keyCursorRequest,
        };
        const forceStore = { ...baseStore, openCursor: () => forceCursorRequest };
        const stores = new Map<string, unknown>([
            ['store', generalStore],
            ['forceStore', forceStore],
            ['forceV2Store', { ...baseStore, put: () => undefined }],
        ]);
        const storeNames = [
            'store', 'sheetsStore', 'forceStore', 'forceV2Store', 'tagsStore',
            'savedSearchesStore', 'canvasStore', 'publicTagsStore',
            'operationsStore', 'organizationsStore',
        ];
        const transaction = {
            objectStore: (name: string) => stores.get(name) ?? baseStore,
        } as unknown as IDBTransaction;
        const database = {
            objectStoreNames: { contains: (name: string) => storeNames.includes(name) },
            createObjectStore: () => baseStore,
            deleteObjectStore: () => undefined,
            close: () => undefined,
            onversionchange: null,
        } as unknown as IDBDatabase;
        Object.assign(openRequest, { result: database, transaction });

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                DbService,
                { provide: LoggerService, useValue: { info() {}, warn() {}, error() {} } },
                { provide: DialogsService, useValue: { choose: () => Promise.resolve('continue'), showError: () => Promise.resolve() } },
            ],
        });
        const service = TestBed.inject(DbService);
        openRequest.onupgradeneeded?.call(openRequest, {
            target: openRequest,
            oldVersion: 16,
        } as unknown as IDBVersionChangeEvent);

        (forceCursorRequest as unknown as { result: IDBCursorWithValue | null }).result = null;
        forceCursorRequest.onsuccess?.call(forceCursorRequest, new Event('success'));
        (keyCursorRequest as unknown as { result: IDBCursor | null }).result = {
            key: 'options',
            continue: () => undefined,
        } as unknown as IDBCursor;
        keyCursorRequest.onsuccess?.call(keyCursorRequest, new Event('success'));

        for (const key of [
            'equipment', 'factions', 'megamekFactions', 'megamekAvailability',
            'megamekRulesets', 'eras', 'sourcebooks', 'quirks', 'sarnaPageTitles',
            'forceNameWords', 'pilotNames',
        ]) {
            expect(deletedKeys).toContain(key);
        }
        expect(deletedKeys).not.toContain('options');

        openRequest.onsuccess?.call(openRequest, { target: openRequest } as unknown as Event);
        await service.waitForDbReady();
    });
});
