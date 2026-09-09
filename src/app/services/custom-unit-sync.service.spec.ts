// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { CustomUnitSyncService } from './custom-unit-sync.service';
import { CustomUnitsService } from './custom-units.service';
import { WsService } from './ws.service';
import { UserStateService } from './userState.service';
import { DbService } from './db.service';
import { DataService } from './data.service';
import { LoggerService } from './logger.service';
import { ToastService } from './toast.service';
import { compressCustomDesign } from '../models/custom-design-policy';
import type { SavedCustomUnit } from '../models/custom-unit.model';
import { asUnitUuid, type UnitUuid } from './unit-catalog/unit-catalog.types';
import { sha1Base64Url } from '../utils/sha1.util';
import { createTestMekEntity } from '../testing/unit-test-helpers';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import { encodeNativeEntity } from '../models/entity/write-entity';
import { MountedEngine } from '../models/entity/components';
import { EntityUnitSummaryProjector } from './unit-catalog/entity-summary-projector';
import type { PreparedApplicationCatalogDependencies } from './unit-catalog/application-catalog-bundle-coordinator.service';

const account = 'owner-account';
const id = (n: number) => asUnitUuid(`019f6767-0dcb-7bb8-992f-${String(n).padStart(12, '0')}`);
async function record(n: number, overrides: Partial<SavedCustomUnit> = {}): Promise<SavedCustomUnit> {
    const source = `uuid:${id(n)}\nchassis:Test\nmodel:Design ${n}\n`;
    const hash = await sha1Base64Url(new TextEncoder().encode(source).buffer);
    return { schemaVersion: 1, uuid: id(n), source, format: 'mtf', accountUuid: account, owned: true, subscribed: false,
        hash, syncedHash: hash, ownerId: 'public-owner', createdAt: 1, updatedAt: 1, ...overrides };
}
const manifest = (r: SavedCustomUnit) => ({ uuid: r.uuid, hash: r.hash, owned: r.owned, subscribed: r.subscribed,
    ownerId: r.ownerId, createdAt: r.createdAt, updatedAt: r.updatedAt, deleted: false, subscriberCount: 7 });
const cloud = (r: SavedCustomUnit) => ({ ...manifest(r), ...compressCustomDesign(r.uuid, r) });

describe('custom unit account sync', () => {
    let rows: Map<string, SavedCustomUnit>, request: jasmine.Spy, toast: jasmine.Spy;
    let connected: boolean, service: CustomUnitSyncService, library: CustomUnitsService;
    let remote: SavedCustomUnit[], currentAccount: ReturnType<typeof signal<string>>;
    let notify: (message: Record<string, unknown>) => void;
    const notificationComplete = () => (service as unknown as { notifications?: Promise<void> }).notifications;
    const key = (r: Pick<SavedCustomUnit, 'uuid' | 'accountUuid'>) => `${r.accountUuid ?? ''}:${r.uuid}`;

    async function setup(initial: SavedCustomUnit[] = []): Promise<void> {
        connected = false; rows = new Map(initial.map(r => [key(r), r])); remote = [];
        currentAccount = signal(account);
        request = jasmine.createSpy('request').and.callFake(async (message: { action: string; cursor?: string; unitUuid?: UnitUuid; unitUuids?: UnitUuid[] }) => {
            if (message.action === 'listCustomUnits') {
                const offset = message.cursor ? remote.findIndex(r => r.uuid === message.cursor) + 1 : 0;
                const page = remote.slice(offset, offset + 200);
                return { action: 'customUnitsList', units: page.map(manifest), nextCursor: offset + 200 < remote.length ? page.at(-1)!.uuid : null };
            }
            if (message.action === 'getCustomUnits') return { action: 'customUnitBatch', designs: remote.filter(r => message.unitUuids!.includes(r.uuid)).map(cloud), missing: [], remaining: [] };
            if (message.action === 'getCustomUnit') return { action: 'customUnit', unit: remote.find(r => r.uuid === message.unitUuid) ? cloud(remote.find(r => r.uuid === message.unitUuid)!) : null };
            return { action: 'customUnitDeleted' };
        });
        toast = jasmine.createSpy('toast');
        TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), CustomUnitsService, CustomUnitSyncService,
            { provide: WsService, useValue: { wsConnected: () => connected, waitForWebSocket: async () => undefined,
                sendAndWaitForResponse: request, registerMessageHandler: (_action: string, handler: typeof notify) => { notify = handler; return () => undefined; } } },
            { provide: UserStateService, useValue: { uuid: currentAccount } },
            { provide: DbService, useValue: {
                unitArtworkChanges: new Subject(), listUnitArtwork: async () => new Map(), listCustomUnits: async () => [...rows.values()],
                listCustomUnitSummaries: async () => [], saveCustomUnitSummaries: async () => undefined,
                updateCustomUnits: async (changes: Parameters<DbService['updateCustomUnits']>[0]) => changes.map(change => {
                    const key = `${change.accountUuid}:${change.uuid}`;
                    const next = change.update(rows.get(key));
                    if (next) rows.set(key, next); else rows.delete(key);
                    return next;
                }) } },
            { provide: DataService, useValue: { refreshCustomUnits: async () => undefined } },
            { provide: LoggerService, useValue: { warn: () => undefined } },
            { provide: ToastService, useValue: { showToast: toast } },
        ] });
        service = TestBed.inject(CustomUnitSyncService); library = service.library;
        TestBed.tick();
        await library.initialize();
        connected = true;
    }

    it('downloads missing and changed designs only, and announces subscription updates once', async () => {
        const unchanged = await record(1), changed = await record(2, { owned: false, subscribed: true });
        await setup([unchanged, changed]);
        const source = changed.source + 'revision:updated\n';
        remote = [unchanged, await record(2, { owned: false, subscribed: true, source, hash: await sha1Base64Url(new TextEncoder().encode(source).buffer) }), await record(3)];
        await service.sync();
        const downloads = request.calls.allArgs().map(a => a[0]).filter(m => m.action === 'getCustomUnits');
        expect(downloads.length).toBe(1);
        expect(downloads[0].unitUuids).toEqual([id(2), id(3)]);
        expect((await library.get(id(2)))?.source).toBe(source);
        expect(toast).toHaveBeenCalledOnceWith(jasmine.stringContaining('1 subscribed custom design updated'), 'info');
        expect(service.subscriberCounts().get(id(1))).toBe(7);
        request.calls.reset();
        await service.sync();
        expect(request.calls.allArgs().map(a => a[0].action)).toEqual(['listCustomUnits']);
    });

    it('receives 1,000 designs in five manifest pages and fifty bounded downloads', async () => {
        await setup();
        remote = await Promise.all(Array.from({ length: 1000 }, (_, n) => record(n + 1)));
        const before = library.revision();
        await service.sync();
        expect(service.error()).toBe('');
        expect(library.records().length).toBe(1000);
        expect(rows.size).toBe(1000);
        expect(library.revision() - before).toBe(1);
        const messages = request.calls.allArgs().map(a => a[0]);
        expect(messages.filter(m => m.action === 'listCustomUnits').length).toBe(5);
        expect(messages.filter(m => m.action === 'getCustomUnits').length).toBe(50);
        expect(messages.every(m => m.accountUuid === account)).toBeTrue();
    }, 20000);

    it('persists a subscription, removes it on unsubscribe, and keeps a shared preview temporary', async () => {
        await setup();
        remote = [await record(1, { owned: false })];
        await service.openShared(id(1));
        expect(rows.size).toBe(0);
        expect(library.isOwned(id(1))).toBeFalse();
        await service.subscribe(id(1));
        expect(rows.size).toBe(1);
        expect((await library.get(id(1)))?.subscribed).toBeTrue();
        await service.unsubscribe(id(1));
        expect(rows.size).toBe(0);
        expect(await library.get(id(1))).toBeUndefined();
        expect(request.calls.allArgs().some(args => args[0].action === 'saveCustomUnit')).toBeFalse();
    });

    it('also keeps a share-link preview temporary when the server reports ownership', async () => {
        await setup(); remote = [await record(1)];
        await service.openShared(id(1));
        expect(rows.size).toBe(0);
        expect(await library.get(id(1))).toBeDefined();
        expect(library.isTemporary(id(1))).toBeTrue();
        // Account library sync must still install this owned design on a new device.
        await service.sync();
        expect(rows.size).toBe(1);
        expect(library.isTemporary(id(1))).toBeFalse();
        expect(request.calls.allArgs().some(args => args[0].action === 'saveCustomUnit')).toBeFalse();
    });

    it('sends a pending deletion even when an initial upload acknowledgement was lost', async () => {
        await setup([await record(1, { pending: 'delete', syncedHash: undefined })]);
        await service.sync();
        expect(request.calls.first().args[0]).toEqual(jasmine.objectContaining({ action: 'deleteCustomUnit', unitUuid: id(1) }));
        expect(rows.size).toBe(0);
        expect(library.pendingRecords()).toEqual([]);
    });

    it('finishes an in-flight download before unsubscribing, without restoring the removed subscription', async () => {
        await setup();
        remote = [await record(1, { owned: false, subscribed: true })];
        let finishDownload!: () => void;
        let started!: () => void;
        const downloading = new Promise<void>(resolve => { started = resolve; });
        request.and.callFake(async (message: { action: string }) => {
            if (message.action === 'listCustomUnits') return { action: 'customUnitsList', units: remote.map(manifest) };
            if (message.action === 'getCustomUnits') {
                started();
                await new Promise<void>(resolve => { finishDownload = resolve; });
                return { action: 'customUnitBatch', designs: remote.map(cloud), remaining: [] };
            }
            return { action: 'customUnitUnsubscribed' };
        });
        const sync = service.sync();
        await downloading;
        const unsubscribe = service.unsubscribe(id(1));
        finishDownload();
        await Promise.all([sync, unsubscribe]);
        expect(request.calls.allArgs().map(a => a[0].action)).toEqual(['listCustomUnits', 'getCustomUnits', 'unsubscribeCustomUnit']);
        expect(await library.get(id(1))).toBeUndefined();
        expect(rows.size).toBe(0);
    });

    it('rejects a response from an account that changed while the request was in flight', async () => {
        await setup();
        const other = await record(1);
        request.and.callFake(async () => { currentAccount.set('different-account'); return { action: 'customUnit', unit: cloud(other) }; });
        await expectAsync(service.openShared(id(1))).toBeRejectedWithError(/account changed/);
        expect(rows.size).toBe(0);
    });

    it('shares concurrent requests for one exact revision without caching later requests', async () => {
        await setup(); remote = [await record(1)];
        const [first, second] = await Promise.all([service.fetch(id(1), remote[0].hash), service.fetch(id(1), remote[0].hash)]);
        expect(first).toEqual(second);
        expect(request.calls.count()).toBe(1);
        await service.fetch(id(1), remote[0].hash);
        expect(request.calls.count()).toBe(2);
    });

    it('coalesces live notifications into a targeted download without requesting a manifest', async () => {
        const original = await record(2, { owned: false, subscribed: true });
        await setup([await record(1), original, await record(3, { owned: false, subscribed: true })]);
        const source = original.source + 'revision:new\n';
        remote = [{ ...original, source, updatedAt: 2, hash: await sha1Base64Url(new TextEncoder().encode(source).buffer) }];
        for (let index = 0; index < 3; index++) notify({ unitUuid: id(2), hash: remote[0].hash });
        await notificationComplete();
        expect(request.calls.allArgs().map(args => args[0].action)).toEqual(['getCustomUnits']);
        expect(request.calls.first().args[0].unitUuids).toEqual([id(2)]);
        expect((await library.get(id(2)))?.source).toBe(source);
        expect(library.records().length).toBe(3);
        expect(toast).toHaveBeenCalledOnceWith(jasmine.stringContaining('1 subscribed custom design updated'), 'info');
    });

    it('processes a newer push received while the earlier body is downloading', async () => {
        const original = await record(1, { owned: false, subscribed: true });
        await setup([original]);
        const sourceA = original.source + 'revision:A\n', sourceB = original.source + 'revision:B\n';
        const changed = async (source: string, updatedAt: number) => ({ ...original, source, updatedAt, hash: await sha1Base64Url(new TextEncoder().encode(source).buffer) });
        const a = await changed(sourceA, 2), b = await changed(sourceB, 3);
        let started!: () => void, finish!: () => void;
        const downloading = new Promise<void>(resolve => { started = resolve; });
        request.and.callFake(async () => {
            if (request.calls.count() === 1) {
                started(); await new Promise<void>(resolve => { finish = resolve; });
                return { action: 'customUnitBatch', designs: [cloud(a)] };
            }
            return { action: 'customUnitBatch', designs: [cloud(b)] };
        });
        notify({ unitUuid: id(1), hash: a.hash });
        await downloading;
        notify({ unitUuid: id(1), hash: b.hash });
        finish();
        await notificationComplete();
        expect(request.calls.count()).toBe(2);
        expect((await library.get(id(1)))?.source).toBe(sourceB);
    });

    it('applies an unsubscribe from another device without persisting the returned shared preview', async () => {
        await setup([await record(1, { owned: false, subscribed: true })]);
        remote = [await record(1, { owned: false, subscribed: false })];
        notify({ unitUuid: id(1) }); await notificationComplete();
        expect(request.calls.allArgs().map(args => args[0].action)).toEqual(['getCustomUnits']);
        expect(await library.get(id(1))).toBeUndefined();
        expect(rows.size).toBe(0);
    });

    for (const keepCopy of [false, true]) it(`resolves conflicting owned edits${keepCopy ? ' while preserving a local copy' : ' using the cloud version'}`, async () => {
        const entity = createTestMekEntity({ uuid: id(1), model: 'Local draft' });
        entity.setTonnage(50); entity.configureEngine(new MountedEngine({ type: 'Fusion', rating: 250, techBase: 'IS' }));
        const source = encodeNativeEntity(entity);
        const local = await record(1, { source, hash: await sha1Base64Url(new TextEncoder().encode(source).buffer), pending: 'save' });
        await setup([local]);
        remote = [await record(1)];
        request.and.callFake(async (message: { action: string }) => {
            if (message.action === 'saveCustomUnit') return { action: 'error', code: 'conflict', message: 'Conflicting edits' };
            if (message.action === 'listCustomUnits') return { action: 'customUnitsList', units: remote.map(manifest) };
            return { action: 'customUnit', unit: cloud(remote[0]) };
        });
        await service.sync();
        expect(service.conflicts().has(id(1))).toBeTrue();
        const registry = createTestEquipmentRegistry();
        library.commitSummaries({ assetHashes: { equipment: 'e', quirks: 'q', sourcebooks: 's', sprites: 'p' },
            equipment: { registry }, quirks: { quirksByKey: new Map() }, sourcebooks: { sourcebooksByAbbrev: new Map() },
            getProjector: async () => new EntityUnitSummaryProjector(registry),
        } as unknown as PreparedApplicationCatalogDependencies, []);
        library.onLocalChange = undefined;
        await service.resolveConflict(local, keepCopy);
        expect(service.conflicts().has(id(1))).toBeFalse();
        expect((await library.get(id(1)))?.source).toBe(remote[0].source);
        expect((await library.get(id(1)))?.pending).toBeUndefined();
        const copies = library.records().filter(record => record.uuid !== id(1));
        expect(copies.length).toBe(keepCopy ? 1 : 0);
        if (keepCopy) {
            expect(copies[0].source).toContain('Local draft');
            expect(copies[0].pending).toBe('save');
            expect(copies[0].originalUnitUuid).toBe(id(1));
        }
    });
});
