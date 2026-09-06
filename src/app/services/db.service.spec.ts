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
            type: GameSystem.CBT,
            name: 'Protected DB Force',
            personnel: { people: [], assignments: [] },
            groups: [],
        };
        const revision = (value: number) => createEmptyCBTForceForTest(instanceId, value);
        const first = { ...base, cbt: revision(1) };

        await service.saveForce(first);
        const stored = await rawStoredForce(instanceId);
        expect(stored['timestamp']).toBe(Date.parse(first.timestamp));
        expect(stored['cbt']).toEqual({ r: 1 });
        expect(stored['units']).toEqual([]);
        expect(stored['groups']).toEqual([]);
        expect(stored['personnel']).toBeUndefined();
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
            type: GameSystem.CBT,
            name: 'Obsolete development row',
            cbt: { schemaVersion: 8, forceRevision: 99 },
        });
        const current: SerializedForce = {
            version: 2,
            timestamp: '2026-08-10T00:00:01.000Z',
            instanceId,
            type: GameSystem.CBT,
            name: 'Current compact row',
            personnel: { people: [], assignments: [] },
            cbt: createEmptyCBTForceForTest(instanceId, 1),
        };

        await service.saveForce(current);

        const stored = await rawStoredForce(instanceId);
        expect(stored['name']).toBe('Current compact row');
        expect(stored['cbt']).toEqual({ r: 1 });
        expect(stored['units']).toEqual([]);
        expect(stored['groups']).toEqual([]);
        expect((stored['cbt'] as Record<string, unknown>)['schemaVersion']).toBeUndefined();
    });

    it('lists valid headers without decoding or retaining unreadable combat state', async () => {
        await putRawForce(instanceId, {
            version: 2, instanceId, timestamp: Date.parse('2026-08-10T00:00:00Z'), type: GameSystem.CBT, name: 'Preview only',
            units: [{ id: 'unit:preview', uuid: 'AZ9nZw3Le7iZL67wggL14g', crew: [{ id: 'person:pilot', name: 'Morgan', g: 3 }],
                state: { invalid: ['combat data the preview must never inspect'] } }],
            groups: [{ id: 'group:preview', unitIndices: [0] }], cbt: { r: 0 },
            personnel: [{ id: 'person:reserve', name: 'Unassigned Morgan', health: { unreadable: true } }],
        });

        const entry = (await service.listForces()).find(force => force.instanceId === instanceId)!;
        expect(entry.name).toBe('Preview only');
        expect(entry.reserveCount).toBe(1);
        expect(entry.groups![0].units[0]).toEqual(jasmine.objectContaining({ alias: 'Morgan', g: 3, p: 5 }));
        expect(JSON.stringify(entry)).not.toContain('combat data');
        expect(JSON.stringify(entry)).not.toContain('Unassigned Morgan');
        expect((entry as unknown as Record<string, unknown>)['cbt']).toBeUndefined();
        expect(await service.getForcePreview(instanceId)).toEqual(entry);
        expect(await service.getForcePreview(`${instanceId}-missing`)).toBeNull();
        await expectAsync(service.getForce(instanceId)).toBeRejected();
    });

    it('keeps cached V1 source bytes intact until an explicit best-effort load', async () => {
        const source: SerializedForce = { version: 1, instanceId, timestamp: '2026-09-01T00:00:00Z', type: GameSystem.CBT,
            name: 'Legacy cache', groups: [{ id: 'g', units: [{ id: 'u', unit: 'Atlas', state: { inventory: 'unreadable' } as never }] }] };
        await service.saveForce(source);
        expect(await rawStoredForce(instanceId)).toEqual(source as unknown as Record<string, unknown>);
        expect(await service.getForce(instanceId)).toEqual(source);
        expect((await service.listForces()).find(force => force.instanceId === instanceId)?.groups![0].units[0].unit).toBe('Atlas');
        expect((await service.getForcePreview(instanceId))?.groups![0].units[0].unit).toBe('Atlas');
    });

    it('rejects unreadable tag updates and aborts their transaction without escaping the event handler', async () => {
        const database = await (service as unknown as { dbPromise: Promise<IDBDatabase> }).dbPromise;
        const request = { result: { version: 2, instanceId, type: GameSystem.AS } } as IDBRequest;
        const put = jasmine.createSpy('put');
        const abort = jasmine.createSpy('abort');
        const transaction = { objectStore: () => ({ get: () => request, put }), abort } as unknown as IDBTransaction;
        const createTransaction = spyOn(database, 'transaction').and.returnValue(transaction);
        try {
            const result = service.updateForceTags(instanceId, ['updated']).then(
                value => ({ value, error: undefined }),
                error => ({ value: undefined, error }),
            );
            await Promise.resolve();
            let escaped: unknown;
            try {
                request.onsuccess?.call(request, new Event('success'));
            } catch (error) {
                escaped = error;
            }
            expect(escaped).toBeUndefined();
            // Avoid waiting forever if a broken event handler left the operation pending.
            if (escaped) return;

            expect((await result).error).toEqual(jasmine.any(Error));
            expect(abort).toHaveBeenCalledTimes(1);
            expect(put).not.toHaveBeenCalled();
        } finally {
            createTransaction.and.callThrough();
        }
    });

    it('leaves an unreadable stored record unchanged when its tag update fails', async () => {
        const source = { version: 2, instanceId, type: GameSystem.AS, malformed: true };
        await putRawForce(instanceId, source);

        await expectAsync(service.updateForceTags(instanceId, ['updated'])).toBeRejectedWithError();

        expect(await rawStoredForce(instanceId)).toEqual(source);
    });

    it('checks existing keys in one transaction without decoding unreadable records', async () => {
        await putRawForce(instanceId, { version: 2, malformed: true });
        const database = await (service as unknown as { dbPromise: Promise<IDBDatabase> }).dbPromise;
        const transaction = database.transaction.bind(database);
        let get!: jasmine.Spy;
        let getKey!: jasmine.Spy;
        const createTransaction = spyOn(database, 'transaction').and.callFake((...args) => {
            const created = transaction(...args);
            const store = created.objectStore('forceStore');
            get = spyOn(store, 'get').and.callThrough();
            getKey = spyOn(store, 'getKey').and.callThrough();
            return created;
        });
        try {
            const missingId = `${instanceId}-missing`;
            expect(await service.getExistingForceIds([instanceId, missingId])).toEqual(new Set([instanceId]));
            expect(createTransaction).toHaveBeenCalledOnceWith('forceStore', 'readonly');
            expect(getKey.calls.allArgs()).toEqual([[instanceId], [missingId]]);
            expect(get).not.toHaveBeenCalled();
            expect(await service.getExistingForceIds([])).toEqual(new Set());
            expect(createTransaction).toHaveBeenCalledTimes(1);
        } finally {
            createTransaction.and.callThrough();
        }
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
