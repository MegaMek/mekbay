// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { TestBed } from '@angular/core/testing';
import { DbService } from './db.service';
import { CustomUnitsService } from './custom-units.service';
import { DialogsService } from './dialogs.service';
import { LoggerService } from './logger.service';
import type { SavedCustomUnit } from '../models/custom-unit.model';
import { asUnitUuid } from './unit-catalog/unit-catalog.types';
import { sha1Base64Url } from '../utils/sha1.util';

describe('custom designs across IndexedDB connections', () => {
    const accountUuid = 'owner';
    let name: string, databases: IDBDatabase[], first: DbService, second: DbService, library: CustomUnitsService;
    const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-000000000001');
    async function revision(model: string, overrides: Partial<SavedCustomUnit> = {}): Promise<SavedCustomUnit> {
        const source = `uuid:${uuid}\nchassis:Test\nmodel:${model}\n`;
        const hash = await sha1Base64Url(new TextEncoder().encode(source).buffer);
        return { schemaVersion: 1, uuid, accountUuid, owned: true, format: 'mtf', source, hash,
            createdAt: 1, updatedAt: 2, ...overrides };
    }
    const write = (db: DbService, record: SavedCustomUnit) => db.updateCustomUnits([{ uuid, accountUuid, update: () => record }]);
    const stored = async () => (await first.listCustomUnits())[0] as SavedCustomUnit | undefined;

    beforeEach(async () => {
        name = 'custom-tab-races-' + crypto.randomUUID(); databases = [];
        const open = indexedDB.open.bind(indexedDB);
        spyOn(indexedDB, 'open').and.callFake((_name, version) => open(name, version));
        TestBed.configureTestingModule({ providers: [DbService, CustomUnitsService,
            { provide: LoggerService, useValue: { info() {}, warn() {}, error() {} } },
            { provide: DialogsService, useValue: { choose: async () => 'continue' } },
        ] });
        first = TestBed.inject(DbService);
        second = TestBed.runInInjectionContext(() => new DbService());
        for (const db of [first, second]) databases.push(await (db as unknown as { dbPromise: Promise<IDBDatabase> }).dbPromise);
        library = TestBed.inject(CustomUnitsService);
        library.setAccount(accountUuid);
    });

    afterEach(async () => {
        TestBed.resetTestingModule();
        databases.forEach(db => db.close());
        await new Promise<void>((resolve, reject) => {
            const request = indexedDB.deleteDatabase(name);
            request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
        });
    });

    it('merges an acknowledgement into the latest durable draft instead of overwriting it', async () => {
        const uploaded = await revision('A', { pending: 'save', syncedHash: 'base' });
        await write(first, uploaded); await library.initialize();
        const newer = await revision('B', { pending: 'save', syncedHash: 'base', updatedAt: 3 });
        await write(second, newer);
        await library.acknowledgeUpload(uploaded, uploaded.hash!, 'public-owner');
        expect(await stored()).toEqual({ ...newer, syncedHash: uploaded.hash, ownerId: 'public-owner' });
        expect((await library.get(uuid))?.source).toBe(newer.source);
    });

    it('does not accept a remote body or deletion over a pending edit in another connection', async () => {
        const original = await revision('A');
        await write(first, original); await library.initialize();
        const pending = await revision('B', { pending: 'save', updatedAt: 3 });
        await write(second, pending);
        await library.acceptRemote(await revision('Cloud', { updatedAt: 4 }));
        await library.removeRemote(uuid, accountUuid);
        await library.removeRemote(uuid, accountUuid, true);
        expect(await stored()).toEqual(pending);
        expect((await library.get(uuid))?.source).toBe(pending.source);
    });

    it('does not roll a newer acknowledged cloud base backwards', async () => {
        const uploaded = await revision('A', { pending: 'save', syncedHash: 'base' });
        const newer = await revision('B', { syncedHash: 'newer-cloud-base' });
        await write(first, uploaded); await library.initialize();
        await write(second, newer);
        await library.acknowledgeUpload(uploaded, uploaded.hash!, 'public-owner');
        expect(await stored()).toEqual(newer);
    });

    it('rolls back the whole transaction if moving an unbound design collides with an account record', async () => {
        const unbound = await revision('Local', { accountUuid: '' });
        const owned = await revision('Account');
        await first.updateCustomUnits([{ uuid, accountUuid: '', update: () => unbound }, { uuid, accountUuid, update: () => owned }]);
        await library.initialize();
        await expectAsync(library.bindLocalDesigns(accountUuid)).toBeRejectedWithError(/identity is already in use/);
        expect((await first.listCustomUnits()).length).toBe(2);
        expect((await first.listCustomUnits()).map(row => (row as SavedCustomUnit).source).sort()).toEqual([unbound.source, owned.source].sort());
    });

    it('refreshes another open library after a committed local-store change', async () => {
        const other = TestBed.runInInjectionContext(() => new CustomUnitsService());
        other.setAccount(accountUuid);
        await Promise.all([library.initialize(), other.initialize()]);
        const remote = await revision('Broadcast');
        await library.acceptRemote(remote);
        const deadline = performance.now() + 2000;
        while (!await other.get(uuid) && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
        expect((await other.get(uuid))?.source).toBe(remote.source);
    });
});
