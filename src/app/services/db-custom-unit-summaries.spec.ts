// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import { DbService } from './db.service';
import { DialogsService } from './dialogs.service';
import { LoggerService } from './logger.service';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import type { SavedCustomUnit } from '../models/custom-unit.model';
import type { StoredCustomUnitSummary } from './unit-catalog/custom-unit-summary-cache';
import { asUnitUuid } from './unit-catalog/unit-catalog.types';

describe('persistent custom summary store', () => {
    it('upgrades without changing designs, survives reopen, isolates accounts and deletes matching cache rows', async () => {
        const name = 'custom-summary-cache-' + crypto.randomUUID();
        const open = indexedDB.open.bind(indexedDB);
        const uuid = asUnitUuid(crypto.randomUUID());
        const native: SavedCustomUnit = { schemaVersion: 1, uuid, format: 'mtf', source: 'native design',
            createdAt: 1, updatedAt: 1, accountUuid: 'owner', owned: true };
        await new Promise<void>((resolve, reject) => {
            const request = open(name, 20);
            request.onupgradeneeded = () => request.result.createObjectStore('customUnitsStore').put(native, ['owner', uuid]);
            request.onsuccess = () => { request.result.close(); resolve(); };
            request.onerror = () => reject(request.error);
        });
        let database: IDBDatabase | undefined;
        try {
            spyOn(indexedDB, 'open').and.callFake((_name, version) => open(name, version));
            const create = async () => {
                TestBed.resetTestingModule();
                TestBed.configureTestingModule({ providers: [DbService,
                    { provide: LoggerService, useValue: { info() {}, warn() {}, error() {} } },
                    { provide: DialogsService, useValue: { choose: async () => 'continue', showError: async () => undefined } },
                ] });
                const service = TestBed.inject(DbService);
                await service.waitForDbReady();
                database = await (service as unknown as { dbPromise: Promise<IDBDatabase> }).dbPromise;
                return service;
            };
            let service = await create();
            expect(await service.listCustomUnits()).toEqual([native]);
            expect(database!.objectStoreNames.contains('customUnitSummariesStore')).toBeTrue();
            const cached: StoredCustomUnitSummary = { accountUuid: 'owner', uuid, dependencies: 'test', summary: createEmptyUnit({ uuid }) };
            await service.saveCustomUnitSummaries([cached, { ...cached, accountUuid: 'viewer' }]);
            database!.close();
            service = await create();
            expect(await service.listCustomUnits()).toEqual([native]);
            expect(await service.listCustomUnitSummaries()).toEqual([cached, { ...cached, accountUuid: 'viewer' }]);
            await service.updateCustomUnits([{ uuid, accountUuid: 'owner', update: () => undefined }]);
            expect(await service.listCustomUnits()).toEqual([]);
            expect(await service.listCustomUnitSummaries()).toEqual([{ ...cached, accountUuid: 'viewer' }]);
        } finally {
            database?.close();
            await new Promise<void>((resolve, reject) => {
                const request = indexedDB.deleteDatabase(name);
                request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
            });
        }
    });
});
