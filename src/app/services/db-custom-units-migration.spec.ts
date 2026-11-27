// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DbService } from './db.service';
import { DialogsService } from './dialogs.service';
import { LoggerService } from './logger.service';

describe('custom library storage separation upgrade', () => {
    it('keeps owned records, moves subscriptions, and drops only unpersistable previews in an isolated database', async () => {
        const name = 'custom-library-migration-' + crypto.randomUUID();
        const open = indexedDB.open.bind(indexedDB);
        const owned = { schemaVersion: 1, uuid: crypto.randomUUID(), createdAt: 1, updatedAt: 1, format: 'mtf', source: 'owned native source' };
        const subscribed = { ...owned, uuid: crypto.randomUUID(), accountUuid: 'viewer', owned: false, subscribed: true, source: 'followed native source' };
        const preview = { ...subscribed, uuid: crypto.randomUUID(), subscribed: false };
        await new Promise<void>((resolve, reject) => {
            const request = open(name, 19);
            request.onupgradeneeded = () => {
                const store = request.result.createObjectStore('customUnitsStore');
                store.put(owned, owned.uuid);
                store.put(subscribed, ['viewer', subscribed.uuid]);
                store.put(preview, ['viewer', preview.uuid]);
                store.put(null, 'unreadable');
            };
            request.onsuccess = () => { request.result.close(); resolve(); };
            request.onerror = () => reject(request.error);
        });
        let database: IDBDatabase | undefined;
        try {
            spyOn(indexedDB, 'open').and.callFake((_name, version) => open(name, version));
            TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), DbService,
                { provide: LoggerService, useValue: { info() {}, warn() {}, error() {} } },
                { provide: DialogsService, useValue: { choose: async () => 'continue', showError: async () => undefined } },
            ] });
            const service = TestBed.inject(DbService);
            await service.waitForDbReady();
            database = await (service as unknown as { dbPromise: Promise<IDBDatabase> }).dbPromise;
            const rows = await service.listCustomUnits();
            expect(rows.filter(Boolean)).toEqual([owned, subscribed]);
            const read = (store: string) => new Promise<unknown[]>((resolve, reject) => {
                const tx = database!.transaction(store, 'readonly'), request = tx.objectStore(store).getAll();
                tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error);
            });
            expect((await read('customUnitsStore')).filter(Boolean)).toEqual([owned]);
            expect(await read('subscribedCustomUnitsStore')).toEqual([subscribed]);
        } finally {
            database?.close();
            await new Promise<void>((resolve, reject) => {
                const request = indexedDB.deleteDatabase(name);
                request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
            });
        }
    });
});
