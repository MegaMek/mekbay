// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { TestBed } from '@angular/core/testing';
import { DbService } from './db.service';
import { UnitArtworkService } from './unit-artwork.service';
import { LoggerService } from './logger.service';
import { DialogsService } from './dialogs.service';
import { asUnitUuid } from './unit-catalog/unit-catalog.types';
import { encodeUnitImage } from '../utils/unit-artwork.util';
import type { SavedCustomUnit } from '../models/custom-unit.model';
import { createDirectMekRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import { encodeNativeEntity } from '../models/entity/write-entity';
import { asForceId, emptyRuntimeHistory, CBT_FORCE_PERSISTENCE_SCHEMA_VERSION } from '../models/runtime/persistence-v2';
import { GameSystem } from '../models/common.model';
import type { SerializedCBTForce } from '../models/force-serialization';
import { sha1Base64Url } from '../utils/sha1.util';
import { sourceHashCanary } from '../models/source-hash-canary';

describe('device-local unit artwork storage', () => {
    let name: string, database: IDBDatabase, db: DbService, artwork: UnitArtworkService, png: Blob;
    const first = asUnitUuid('019f6767-0dcb-7bb8-992f-000000000011');
    const second = asUnitUuid('019f6767-0dcb-7bb8-992f-000000000012');
    beforeEach(async () => {
        name = 'unit-artwork-test-' + crypto.randomUUID();
        const open = indexedDB.open.bind(indexedDB);
        spyOn(indexedDB, 'open').and.callFake((_name, version) => open(name, version));
        TestBed.configureTestingModule({ providers: [DbService, UnitArtworkService,
            { provide: LoggerService, useValue: { info() {}, warn() {}, error() {} } },
            { provide: DialogsService, useValue: { choose: async () => 'continue', showError: async () => undefined } },
        ] });
        db = TestBed.inject(DbService); await db.waitForDbReady();
        database = await (db as unknown as { dbPromise: Promise<IDBDatabase> }).dbPromise;
        artwork = TestBed.inject(UnitArtworkService); await artwork.initialize();
        const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
        png = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)));
    });
    afterEach(async () => {
        TestBed.resetTestingModule(); database.close();
        await new Promise<void>((resolve, reject) => {
            const request = indexedDB.deleteDatabase(name);
            request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
        });
    });
    it('stores by UUID alone and retains artwork through account logout and catalogue purges', async () => {
        await artwork.set(first, { fluff: png });
        const row: SavedCustomUnit = { schemaVersion: 1, uuid: first, accountUuid: 'owner', format: 'mtf', source: `uuid:${first}\n`, createdAt: 1, updatedAt: 1 };
        await db.updateCustomUnits([{ uuid: first, accountUuid: 'owner', update: () => row }]);
        await db.updateCustomUnits([{ uuid: first, accountUuid: 'owner', update: () => undefined }]);
        await db.clearLocalUserStores(); await db.clearCatalogCaches();
        expect((await db.getUnitArtwork(first))?.fluff?.size).toBe(png.size);
        expect(await db.listCustomUnits()).toEqual([]);
        const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
            const tx = database.transaction('unitArtworkStore', 'readonly');
            const request = tx.objectStore('unitArtworkStore').getAllKeys();
            tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error);
        });
        expect(keys.map(String)).toEqual([String(first)]);
    });
    it('counts blobs and revokes URLs when images are replaced, selectively purged, or all purged', async () => {
        const revoke = spyOn(URL, 'revokeObjectURL').and.callThrough();
        await artwork.set(first, { fluff: png, icon: png }); await artwork.set(second, { fluff: png });
        expect(artwork.count()).toBe(2); expect(artwork.bytes()).toBe(png.size * 3);
        const url = artwork.url(first)!;
        await artwork.set(first, { fluff: png });
        expect(revoke).toHaveBeenCalledWith(url);
        const changed = artwork.url(first)!; expect(changed).not.toBe(url);
        await artwork.purge([second]); expect(artwork.count()).toBe(1); expect(artwork.get(first)).not.toBeNull();
        await artwork.purge(); expect(artwork.records().size).toBe(0); expect(artwork.bytes()).toBe(0);
        expect(revoke).toHaveBeenCalledWith(changed);
    });
    it('sideloads force artwork before returning clean source and preserves an existing override', async () => {
        const base64 = await encodeUnitImage(png);
        const source = `uuid:${first}\nchassis:Atlas\nfluffimage:${base64}\n`;
        const pin = await artwork.extractSource(first, { format: 'mtf', source });
        expect(pin.source).toBe(`uuid:${first}\nchassis:Atlas\n`);
        expect((await db.getUnitArtwork(first))?.fluff?.type).toBe('image/png');
        await artwork.set(first, { icon: png });
        await artwork.extractSource(first, { format: 'mtf', source });
        const current = await db.getUnitArtwork(first);
        expect(current?.fluff).toBeUndefined(); expect(current?.icon?.size).toBe(png.size);
    });
    it('cleans a downloaded force before local storage while retaining its artwork and correct source canary', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const original = encodeNativeEntity(fixture.entity);
        const image = await encodeUnitImage(png);
        const unit = { ...fixture.instance.serialize(), customSource: { format: 'mtf' as const, source: original + `fluffimage:${image}\n` } };
        const forceId = asForceId('force:artwork');
        const positions = unit.deployment.values.crewAssignment.positions;
        const force: SerializedCBTForce = {
            version: 2, timestamp: '2026-09-09T12:00:00.000Z', instanceId: forceId, type: GameSystem.CBT, name: 'Artwork force',
            personnel: {
                people: positions.map((position, i) => ({ id: `person:${i}`, name: position.name, gunnery: position.gunnery, piloting: position.piloting })),
                assignments: positions.map((position, i) => ({ unitId: unit.instanceId, positionId: position.positionId, personId: `person:${i}` })),
            },
            cbt: { schemaVersion: CBT_FORCE_PERSISTENCE_SCHEMA_VERSION, forceId, forceRevision: unit.stateRevision, history: emptyRuntimeHistory(),
                units: [{ instanceId: unit.instanceId, stateRevision: unit.stateRevision, unit }],
                roster: { schemaVersion: 1, groups: [{ groupId: 'group:artwork', order: 0, members: [{ instanceId: unit.instanceId, order: 0 }] }] },
                encounter: { networks: [] },
            },
        };
        await db.saveForce(force);
        const saved = await db.getForce(forceId) as SerializedCBTForce;
        expect(saved.cbt.units[0].unit.customSource?.source).toBe(original);
        const hash = await sha1Base64Url(new TextEncoder().encode(original).buffer);
        expect(saved.cbt.units[0].unit.sourceHashCanary).toBe(sourceHashCanary(hash));
        expect(unit.customSource.source).toContain('fluffimage:');
        expect((await db.getUnitArtwork(fixture.identity))?.fluff?.type).toBe('image/png');
    });
    it('receives every direct database artwork write in a batch', async () => {
        await Promise.all([db.saveUnitArtwork(first, { fluff: png }), db.saveUnitArtwork(second, { fluff: png })]);
        await (artwork as unknown as { changes: Promise<void> }).changes;
        expect(artwork.count()).toBe(2);
    });
    it('refuses to persist an image-bearing custom unit record', async () => {
        const row: SavedCustomUnit = { schemaVersion: 1, uuid: first, accountUuid: '', format: 'blk', source: '<fluffimage>bad</fluffimage>', createdAt: 1, updatedAt: 1 };
        await expectAsync(db.updateCustomUnits([{ uuid: first, accountUuid: '', update: () => row }])).toBeRejectedWithError(/artwork/);
        expect(await db.listCustomUnits()).toEqual([]);
    });
});
