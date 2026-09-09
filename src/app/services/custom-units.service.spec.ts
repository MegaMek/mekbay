// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { decodeSavedCustomUnit, type SavedCustomUnit } from '../models/custom-unit.model';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import { createTestMekEntity, createTestTankEntity } from '../testing/unit-test-helpers';
import { MountedEngine } from '../models/entity/components';
import { encodeNativeEntity } from '../models/entity/write-entity';
import { CustomUnitsService } from './custom-units.service';
import { UnitArtworkService } from './unit-artwork.service';
import { encodeUnitImage } from '../utils/unit-artwork.util';
import { hasEmbeddedUnitArtwork } from '../models/entity/native-unit-artwork';
import { DbService } from './db.service';
import { MAX_OWNED_CUSTOM_UNITS } from '../models/custom-design-policy';
import { LoggerService } from './logger.service';
import type { PreparedApplicationCatalogDependencies } from './unit-catalog/application-catalog-bundle-coordinator.service';
import { asUnitUuid } from './unit-catalog/unit-catalog.types';
import { EntityUnitSummaryProjector } from './unit-catalog/entity-summary-projector';
import { UNIT_SUMMARY_VERSION } from '../models/unit-summary.model';
import type { StoredCustomUnitSummary } from './unit-catalog/custom-unit-summary-cache';

const ORIGINAL = asUnitUuid('019f6767-0dcb-7bb8-992f-000000000001');
const DEPENDENCIES = {
    assetHashes: { equipment: 'equipment', quirks: 'quirks', sourcebooks: 'sourcebooks', sprites: 'sprites', factions: 'factions' },
    equipment: { registry: createTestEquipmentRegistry() },
    quirks: { quirksByKey: new Map() },
    sourcebooks: { sourcebooksByAbbrev: new Map() },
    sprites: { assignmentContext: { assignments: undefined } },
    getProjector: async () => new EntityUnitSummaryProjector(DEPENDENCIES.equipment.registry),
} as unknown as PreparedApplicationCatalogDependencies;

function mek(overrides: Parameters<typeof createTestMekEntity>[0] = {}) {
    const entity = createTestMekEntity(overrides);
    entity.setTonnage(50);
    entity.configureEngine(new MountedEngine({ type: 'Fusion', rating: 250, techBase: 'IS' }));
    return entity;
}

describe('CustomUnitsService native construction persistence', () => {
    let rows: unknown[];
    let cachedRows: unknown[];
    let saveSummaries: jasmine.Spy;
    let save: jasmine.Spy;
    let logger: jasmine.SpyObj<LoggerService>;

    function createService(): CustomUnitsService {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({ providers: [
            provideZonelessChangeDetection(), CustomUnitsService,
            { provide: DbService, useValue: {
                unitArtworkChanges: new Subject(), listUnitArtwork: async () => new Map(),
                listCustomUnits: async () => structuredClone(rows),
                listCustomUnitSummaries: async () => structuredClone(cachedRows),
                saveCustomUnitSummaries: saveSummaries,
                updateCustomUnits: async (changes: Parameters<DbService['updateCustomUnits']>[0]) => {
                    const results = [];
                    for (const { uuid, accountUuid, update } of changes) {
                        const current = (rows as SavedCustomUnit[]).find(row => row.uuid === uuid && (row.accountUuid ?? '') === accountUuid);
                        const next = update(current);
                        if (next !== current) {
                            if (next) await save(next);
                            else {
                                rows = rows.filter(row => row !== current);
                                cachedRows = cachedRows.filter(row => (row as StoredCustomUnitSummary).uuid !== uuid || (row as StoredCustomUnitSummary).accountUuid !== accountUuid);
                            }
                        }
                        results.push(next);
                    }
                    return results;
                },
            } },
            { provide: LoggerService, useValue: logger },
        ] });
        const service = TestBed.inject(CustomUnitsService);
        service.commitSummaries(DEPENDENCIES, []);
        return service;
    }

    beforeEach(() => {
        rows = [];
        cachedRows = [];
        saveSummaries = jasmine.createSpy('saveCustomUnitSummaries').and.callFake(async (summaries: readonly StoredCustomUnitSummary[]) => {
            for (const summary of summaries) {
                cachedRows = [structuredClone(summary), ...cachedRows.filter(row => (row as StoredCustomUnitSummary).uuid !== summary.uuid
                    || (row as StoredCustomUnitSummary).accountUuid !== summary.accountUuid)];
            }
        });
        save = jasmine.createSpy('saveCustomUnit').and.callFake(async (record: SavedCustomUnit) => {
            rows = [structuredClone(record), ...rows.filter(row => (row as SavedCustomUnit).uuid !== record.uuid || ((row as SavedCustomUnit).accountUuid ?? '') !== (record.accountUuid ?? ''))];
        });
        logger = jasmine.createSpyObj('LoggerService', ['info', 'warn', 'error']);
    });

    it('reuses owned and subscribed summaries after a fresh service loads IndexedDB', async () => {
        const projector = await DEPENDENCIES.getProjector();
        const project = spyOn(projector, 'project').and.callThrough();
        spyOn(DEPENDENCIES, 'getProjector').and.resolveTo(projector);
        const first = createService();
        const owned = await first.save(mek({ model: 'Owned' }));
        const subscribed = mek({ uuid: ORIGINAL, model: 'Subscribed' });
        await first.acceptRemote({ ...owned, uuid: ORIGINAL, source: encodeNativeEntity(subscribed), hash: undefined,
            owned: false, subscribed: true, pending: undefined });
        const expected = await first.prepareSummaries(DEPENDENCIES);
        expect(cachedRows.length).toBe(2);
        project.calls.reset();
        const reloaded = createService();
        await reloaded.initialize();
        expect((await reloaded.prepareSummaries(DEPENDENCIES)).map(unit => unit.model).sort())
            .toEqual(expected.map(unit => unit.model).sort());
        expect(project).not.toHaveBeenCalled();
    });

    it('regenerates an obsolete or corrupt persisted summary and replaces the cache', async () => {
        const first = createService();
        await first.save(mek());
        (cachedRows[0] as StoredCustomUnitSummary).summary.summaryVersion--;
        const projector = await DEPENDENCIES.getProjector();
        const project = spyOn(projector, 'project').and.callThrough();
        spyOn(DEPENDENCIES, 'getProjector').and.resolveTo(projector);
        let reloaded = createService();
        await reloaded.initialize();
        await reloaded.prepareSummaries(DEPENDENCIES);
        expect(project).toHaveBeenCalledTimes(1);
        expect((cachedRows[0] as StoredCustomUnitSummary).summary.summaryVersion).toBe(UNIT_SUMMARY_VERSION);
        cachedRows = [{ ...(cachedRows[0] as StoredCustomUnitSummary), summary: null }];
        reloaded = createService();
        await reloaded.initialize();
        await reloaded.prepareSummaries(DEPENDENCIES);
        expect(project).toHaveBeenCalledTimes(2);
    });

    it('retains a successful native save when the disposable summary cache cannot be written', async () => {
        saveSummaries.and.rejectWith(new Error('Cache unavailable'));
        const service = createService();
        const saved = await service.save(mek({ model: 'Saved' }));
        expect((await service.get(saved.uuid))?.source).toContain('Saved');
        expect(rows.length).toBe(1);
        expect(logger.warn).toHaveBeenCalledWith(jasmine.stringContaining('could not be cached'));
    });

    it('rebuilds only the changed source after restart, then invalidates persisted dependency revisions', async () => {
        const first = createService();
        const saved = await first.save(mek({ model: 'First' }));
        await first.save(mek({ model: 'Second' }));
        const changed = await first.load(saved.uuid);
        changed.model.set('Changed on disk');
        rows = rows.map(row => (row as SavedCustomUnit).uuid === saved.uuid
            ? { ...saved, source: encodeNativeEntity(changed) } : row);
        const projector = await DEPENDENCIES.getProjector();
        const project = spyOn(projector, 'project').and.callThrough();
        spyOn(DEPENDENCIES, 'getProjector').and.resolveTo(projector);
        let reloaded = createService();
        await reloaded.initialize();
        expect((await reloaded.prepareSummaries(DEPENDENCIES)).map(unit => unit.model).sort())
            .toEqual(['Changed on disk', 'Second']);
        expect(project).toHaveBeenCalledTimes(1);
        expect(project.calls.first().args[0].entryKey.design.uuid).toBe(saved.uuid);
        reloaded = createService();
        await reloaded.initialize();
        const dependencies = { ...DEPENDENCIES, assetHashes: { ...DEPENDENCIES.assetHashes, equipment: 'new-equipment' } };
        await reloaded.prepareSummaries(dependencies);
        expect(project).toHaveBeenCalledTimes(3);
        reloaded = createService();
        await reloaded.initialize();
        await reloaded.prepareSummaries(dependencies);
        expect(project).toHaveBeenCalledTimes(3);
    });

    it('keeps temporary previews out of the persisted summary cache', async () => {
        const first = createService();
        const saved = await first.save(mek({ model: 'Saved' }));
        await first.acknowledgeUpload(saved, saved.hash!, 'owner');
        const preview = await first.load(saved.uuid);
        preview.model.set('Preview');
        await first.acceptRemote({ ...saved, pending: undefined, hash: undefined, source: encodeNativeEntity(preview) }, false);
        expect((await first.prepareSummaries(DEPENDENCIES))[0].model).toBe('Preview');
        expect((cachedRows[0] as StoredCustomUnitSummary).summary.model).toBe('Saved');
        const projector = await DEPENDENCIES.getProjector();
        const project = spyOn(projector, 'project').and.callThrough();
        spyOn(DEPENDENCIES, 'getProjector').and.resolveTo(projector);
        const reloaded = createService();
        await reloaded.initialize();
        expect((await reloaded.prepareSummaries(DEPENDENCIES))[0].model).toBe('Saved');
        expect(project).not.toHaveBeenCalled();
    });

    it('moves a local summary cache into the signed-in account with its native design', async () => {
        const first = createService();
        await first.save(mek());
        first.setAccount('owner');
        await first.bindLocalDesigns('owner');
        expect(cachedRows.map(row => (row as StoredCustomUnitSummary).accountUuid)).toEqual(['owner']);
        const projector = await DEPENDENCIES.getProjector();
        const project = spyOn(projector, 'project').and.callThrough();
        spyOn(DEPENDENCIES, 'getProjector').and.resolveTo(projector);
        const reloaded = createService();
        reloaded.setAccount('owner');
        await reloaded.initialize();
        expect((await reloaded.prepareSummaries(DEPENDENCIES)).length).toBe(1);
        expect(project).not.toHaveBeenCalled();
    });

    it('reuses unchanged projections and the summary already checked when saving an edit', async () => {
        const projector = await DEPENDENCIES.getProjector();
        const project = spyOn(projector, 'project').and.callThrough();
        spyOn(DEPENDENCIES, 'getProjector').and.resolveTo(projector);
        const service = createService();
        const first = await service.save(mek({ model: 'First' }));
        await service.save(mek({ model: 'Second' }));
        project.calls.reset();
        const initial = await service.prepareSummaries(DEPENDENCIES);
        service.commitSummaries(DEPENDENCIES, initial);
        expect(project).not.toHaveBeenCalled();
        const draft = await service.load(first.uuid);
        draft.model.set('Edited');
        await service.save(draft, { uuid: first.uuid });
        const current = await service.prepareSummaries(DEPENDENCIES);
        expect(project).toHaveBeenCalledTimes(1);
        expect(current.map(unit => unit.model).sort()).toEqual(['Edited', 'Second']);
        expect(initial.map(unit => unit.model).sort()).toEqual(['First', 'Second']);
        expect(current.map(unit => unit.uuid)).not.toEqual(initial.map(unit => unit.uuid));
        expect(new Map(current.map(unit => [unit.uuid, unit.id]))).toEqual(new Map(initial.map(unit => [unit.uuid, unit.id])));
        service.commitSummaries(DEPENDENCIES, current);
        await service.save(mek({ model: 'Third' }));
        const withAddition = await service.prepareSummaries(DEPENDENCIES);
        expect(new Set(withAddition.map(unit => unit.uuid)).size).toBe(3);
        expect(withAddition.every(unit => unit.id === null)).toBeTrue();
        expect(withAddition.filter(unit => unit.model !== 'Third').map(unit => unit.id)).toEqual(current.map(unit => unit.id));
    });

    it('rebuilds all obsolete summaries and all summaries affected by dependency changes', async () => {
        const projector = await DEPENDENCIES.getProjector();
        const original = projector.project.bind(projector);
        let obsolete = true;
        const project = spyOn(projector, 'project').and.callFake(async input => {
            const projected = await original(input);
            if (obsolete) projected.summary.summaryVersion = UNIT_SUMMARY_VERSION - 1;
            return projected;
        });
        spyOn(DEPENDENCIES, 'getProjector').and.resolveTo(projector);
        const service = createService();
        await service.save(mek({ model: 'First' }));
        await service.save(mek({ model: 'Second' }));
        obsolete = false;
        project.calls.reset();
        expect((await service.prepareSummaries(DEPENDENCIES)).every(unit => unit.summaryVersion === UNIT_SUMMARY_VERSION)).toBeTrue();
        expect(project).toHaveBeenCalledTimes(2);
        const next = { ...DEPENDENCIES, assetHashes: { ...DEPENDENCIES.assetHashes, equipment: 'changed' } };
        await service.prepareSummaries(next);
        expect(project).toHaveBeenCalledTimes(4);
        await service.prepareSummaries({ ...next, assetHashes: { ...next.assetHashes, factions: 'changed' } });
        expect(project).toHaveBeenCalledTimes(4);
    });

    it('rebuilds only the changed native source when a subscription is refreshed', async () => {
        const projector = await DEPENDENCIES.getProjector();
        const project = spyOn(projector, 'project').and.callThrough();
        spyOn(DEPENDENCIES, 'getProjector').and.resolveTo(projector);
        const service = createService();
        const first = mek({ uuid: ORIGINAL, model: 'First' });
        const second = mek({ uuid: asUnitUuid('019f6767-0dcb-7bb8-992f-000000000002'), model: 'Second' });
        const record = (entity: typeof first): SavedCustomUnit => ({
            schemaVersion: 1, uuid: entity.uuid(), format: 'mtf', source: encodeNativeEntity(entity),
            createdAt: 1, updatedAt: 1, accountUuid: '', owned: false, subscribed: true,
        });
        await service.acceptRemoteBatch([record(first), record(second)]);
        await service.prepareSummaries(DEPENDENCIES);
        project.calls.reset();
        first.model.set('Updated');
        await service.acceptRemote({ ...record(first), updatedAt: 2 });
        const summaries = await service.prepareSummaries(DEPENDENCIES);
        expect(project).toHaveBeenCalledTimes(1);
        expect(project.calls.first().args[0].entryKey.design.uuid).toBe(first.uuid());
        expect(summaries.map(unit => unit.model).sort()).toEqual(['Second', 'Updated']);
    });

    it('keeps cached summaries independent of mutable search and presentation overlays', async () => {
        const service = createService();
        await service.save(mek({ model: 'Original' }));
        const first = (await service.prepareSummaries(DEPENDENCIES))[0];
        const damage = first.as.dmg.dmgS;
        first.as.dmg.dmgS = '999';
        first.as.MVm[''] = 999;
        first.model = 'Mutated view';
        const second = (await service.prepareSummaries(DEPENDENCIES))[0];
        expect(second.model).toBe('Original');
        expect(second.as.dmg.dmgS).toBe(damage);
        expect(second.as.MVm['']).not.toBe(999);
    });

    it('copies core MTF into a new UUID without mutating the source and preserves original lineage on update', async () => {
        const service = createService();
        const core = mek({ uuid: ORIGINAL, chassis: 'Crab', model: 'CRB-20', id: 123 });
        core.mulId.set(123);
        const saved = await service.save(core, { originalUnitUuid: ORIGINAL });
        expect(saved.uuid).not.toBe(ORIGINAL);
        expect(saved.originalUnitUuid).toBe(ORIGINAL);
        expect(core.uuid()).toBe(ORIGINAL);
        expect(core.mulId()).toBe(123);
        expect(Object.keys(saved).sort()).toEqual([
            'accountUuid', 'createdAt', 'format', 'hash', 'originalUnitUuid', 'owned', 'pending', 'schemaVersion', 'source', 'updatedAt', 'uuid',
        ]);
        const editing = await service.load(saved.uuid);
        editing.model.set('Workshop');
        const updated = await service.save(editing, { uuid: saved.uuid });
        expect(updated.uuid).toBe(saved.uuid);
        expect(updated.createdAt).toBe(saved.createdAt);
        expect(updated.originalUnitUuid).toBe(ORIGINAL);
        const relabeled = await service.save(editing, {
            uuid: saved.uuid, originalUnitUuid: asUnitUuid('019f6767-0dcb-7bb8-992f-000000000002'),
        });
        expect(relabeled.originalUnitUuid).toBe(ORIGINAL);
        expect(core.model()).toBe('CRB-20');
        const summaries = (await service.prepareSummaries(DEPENDENCIES));
        expect(summaries.length).toBe(1);
        expect(summaries[0].model).toBe('Workshop');
        expect(summaries[0].origin).toBe('user');
        expect(summaries[0].isCustom).toBeTrue();
        expect(summaries[0].canon).toBeFalse();
        expect(summaries[0].originalUnitUuid).toBe(ORIGINAL);
        expect(summaries[0].id).toBe(123);

        const reloaded = createService();
        await reloaded.initialize();
        expect((await reloaded.load(saved.uuid)).model()).toBe('Workshop');
        expect((await reloaded.prepareSummaries(DEPENDENCIES))[0].hash).toBe(summaries[0].hash);
        await reloaded.delete(saved.uuid);
        expect(reloaded.records()).toEqual([]);
        expect((await reloaded.prepareSummaries(DEPENDENCIES))).toEqual([]);
        expect(reloaded.pendingRecords()[0].pending).toBe('delete');
    });

    it('round-trips BLK designs and returns fresh detached editor instances', async () => {
        const service = createService();
        const tank = createTestTankEntity({ uuid: ORIGINAL, chassis: 'Vedette', model: 'Custom' });
        const saved = await service.save(tank, { originalUnitUuid: ORIGINAL });
        expect(saved.format).toBe('blk');
        const first = await service.load(saved.uuid);
        const second = await service.load(saved.uuid);
        expect(first.entityType).toBe('Tank');
        expect(first).not.toBe(second);
        first.model.set('Modified');
        expect(second.model()).toBe('Custom');
        expect((await service.prepareSummaries(DEPENDENCIES))[0].entityType).toBe('Tank');
        const copy = await service.save(first, { originalUnitUuid: saved.originalUnitUuid });
        expect(copy.uuid).not.toBe(saved.uuid);
        expect(copy.originalUnitUuid).toBe(ORIGINAL);
        expect(service.records().length).toBe(2);
    });

    it('rejects attempts to overwrite a core UUID and publishes nothing after failed storage', async () => {
        const service = createService();
        const entity = mek({ uuid: ORIGINAL });
        await expectAsync(service.save(entity, { uuid: ORIGINAL })).toBeRejectedWithError(/existing custom/u);
        save.and.rejectWith(new Error('Storage full'));
        await expectAsync(service.save(entity)).toBeRejectedWithError('Storage full');
        expect(service.records()).toEqual([]);
        expect((await service.prepareSummaries(DEPENDENCIES))).toEqual([]);
    });

    it('skips malformed persisted rows individually and validates embedded source identity', async () => {
        const service = createService();
        const good = await service.save(mek({ uuid: ORIGINAL, chassis: 'Good' }));
        rows.push({ ...good, uuid: ORIGINAL }, { schemaVersion: 999 }, null);
        const reloaded = createService();
        await reloaded.initialize();
        expect(reloaded.records()).toEqual([good]);
        expect(logger.warn).toHaveBeenCalledTimes(3);
        expect(() => decodeSavedCustomUnit({ ...good, originalUnitUuid: good.uuid })).toThrowError(/own original/u);
    });

    it('uses catalog resolvers for imported and history snapshots', () => {
        const service = createService();
        const book = { id: 1, sku: 'TW', abbrev: 'TW', title: 'Total Warfare', canon: true };
        const quirk = { key: 'easy_maintain', name: 'Easy to Maintain', type: 'positive' as const, description: 'Test' };
        service.commitSummaries({ ...DEPENDENCIES,
            sourcebooks: { ...DEPENDENCIES.sourcebooks, sourcebooksByAbbrev: new Map([['TW', book]]) },
            quirks: { ...DEPENDENCIES.quirks, quirksByKey: new Map([[quirk.key, quirk]]) },
        }, []);
        const entity = mek();
        entity.source.set([book]);
        entity.quirks.set([{ quirk }]);
        const draft = service.parseDraft(encodeNativeEntity(entity), 'mtf');
        expect(draft.source()).toContain(book);
        expect(draft.quirks().map(value => value.quirk)).toEqual([quirk]);
        expect(draft.loadIssues().some(issue => issue.code === 'QUIRK_NOT_FOUND')).toBeFalse();
        draft.model.set('Undo snapshot');
        const restored = service.parseDraft(encodeNativeEntity(draft), 'mtf');
        expect(restored.source()).toContain(book);
        expect(restored.quirks().map(value => value.quirk)).toEqual([quirk]);
    });

    it('preserves newer edits and deletion intent when an earlier upload completes', async () => {
        const service = createService();
        service.setAccount('owner');
        const first = await service.save(mek({ model: 'First' }));
        const draft = await service.load(first.uuid);
        draft.model.set('Second');
        const second = await service.save(draft, { uuid: first.uuid });
        await service.acknowledgeUpload(first, first.hash!, 'public-owner');
        expect(await service.get(first.uuid)).toEqual(jasmine.objectContaining({ source: second.source, pending: 'save', syncedHash: first.hash }));
        const nextUpload = (await service.get(first.uuid))!;
        await service.delete(first.uuid);
        await service.acknowledgeUpload(nextUpload, second.hash!, 'public-owner');
        expect(service.records()).toEqual([]);
        expect(service.pendingRecords()[0]).toEqual(jasmine.objectContaining({ pending: 'delete', syncedHash: second.hash }));
    });

    it('isolates the same shared design between accounts without losing the owner\'s pending edits', async () => {
        const service = createService();
        service.setAccount('owner');
        const saved = await service.save(mek());
        service.setAccount('viewer');
        expect(service.records()).toEqual([]);
        await service.acceptRemote({ ...saved, accountUuid: 'viewer', owned: false, subscribed: true, pending: undefined });
        expect(service.isOwned(saved.uuid)).toBeFalse();
        await expectAsync(service.save(await service.load(saved.uuid), { uuid: saved.uuid })).toBeRejectedWithError(/Clone it/);
        await service.removeRemote(saved.uuid);
        service.setAccount('owner');
        expect(service.isOwned(saved.uuid)).toBeTrue();
        expect(service.pendingRecords()[0]).toEqual(saved);
        expect((await service.load(saved.uuid)).uuid()).toBe(saved.uuid);
        expect(rows).toEqual([saved]);
    });

    it('does not replace a pending local edit with a download that finished late', async () => {
        const service = createService();
        const first = await service.save(mek({ model: 'First' }));
        const draft = await service.load(first.uuid);
        draft.model.set('Second');
        const second = await service.save(draft, { uuid: first.uuid });
        await service.acceptRemote({ ...first, pending: undefined });
        expect(await service.get(first.uuid)).toEqual(second);
    });

    for (const reverse of [false, true]) {
        it(`hydrates duplicate cache keys using the owned record and its matching source (${reverse})`, async () => {
            const owned: SavedCustomUnit = { schemaVersion: 1, uuid: ORIGINAL, createdAt: 1, updatedAt: 1,
                format: 'mtf', source: encodeNativeEntity(mek({ uuid: ORIGINAL, model: 'Owned' })),
                accountUuid: 'viewer', owned: true };
            const subscribed: SavedCustomUnit = { ...owned, owned: false, updatedAt: 2,
                source: encodeNativeEntity(mek({ uuid: ORIGINAL, model: 'Subscribed' })) };
            rows = reverse ? [subscribed, owned] : [owned, subscribed];
            const service = createService();
            service.setAccount('viewer');
            await service.initialize();
            expect(await service.get(ORIGINAL)).toEqual(owned);
            expect((await service.prepareSummaries(DEPENDENCIES)).map(unit => unit.model)).toEqual(['Owned']);
            expect(new TextDecoder().decode(service.captureSources().get(ORIGINAL)!.bytes)).toBe(owned.source);
        });

        it(`prefers owned custom records and sources over subscriptions regardless of order (${reverse})`, async () => {
            const owned: SavedCustomUnit = { schemaVersion: 1, uuid: ORIGINAL, createdAt: 1, updatedAt: 1,
                format: 'mtf', source: encodeNativeEntity(mek({ uuid: ORIGINAL, model: 'Owned' })),
                accountUuid: '', owned: true };
            const subscribed: SavedCustomUnit = { ...owned, accountUuid: 'viewer', owned: false,
                source: encodeNativeEntity(mek({ uuid: ORIGINAL, model: 'Subscribed' })) };
            rows = reverse ? [subscribed, owned] : [owned, subscribed];
            const service = createService();
            service.setAccount('viewer');
            await service.initialize();

            expect(service.records()).toEqual([owned]);
            expect(await service.get(ORIGINAL)).toEqual(owned);
            expect((await service.load(ORIGINAL)).model()).toBe('Owned');
            expect((await service.prepareSummaries(DEPENDENCIES)).map(unit => unit.model)).toEqual(['Owned']);
            expect(new TextDecoder().decode(service.captureSources().get(ORIGINAL)!.bytes)).toBe(owned.source);
        });

        it(`keeps an owned design when a sync batch contains the same UUID as a subscription (${reverse})`, async () => {
            const service = createService();
            service.setAccount('viewer');
            const owned: SavedCustomUnit = { schemaVersion: 1, uuid: ORIGINAL, createdAt: 1, updatedAt: 1,
                format: 'mtf', source: encodeNativeEntity(mek({ uuid: ORIGINAL, model: 'Owned' })),
                accountUuid: 'viewer', owned: true };
            const subscribed: SavedCustomUnit = { ...owned, owned: false,
                source: encodeNativeEntity(mek({ uuid: ORIGINAL, model: 'Subscribed' })) };
            await service.acceptRemoteBatch(reverse ? [subscribed, owned] : [owned, subscribed]);
            await service.acceptRemote(subscribed);

            expect(await service.get(ORIGINAL)).toEqual(jasmine.objectContaining(owned));
            expect((await service.load(ORIGINAL)).model()).toBe('Owned');
            expect(rows).toEqual([owned]);
        });
    }

    it('limits new owned designs to 5,000 while allowing edits, deletions, subscriptions and other accounts', async () => {
        const id = (n: number) => asUnitUuid('019f6767-0dcb-7bb8-992f-' + String(n).padStart(12, '0'));
        rows = Array.from({ length: MAX_OWNED_CUSTOM_UNITS }, (_, i) => ({ schemaVersion: 1, uuid: id(i + 1),
            createdAt: 1, updatedAt: 1, format: 'mtf', source: 'uuid:' + id(i + 1) + '\nchassis:Test\n', accountUuid: 'owner', owned: true }));
        rows.push({ ...(rows[0] as SavedCustomUnit), uuid: id(5001), source: 'uuid:' + id(5001) + '\nchassis:Shared\n', owned: false, subscribed: true });
        rows.push({ ...(rows[0] as SavedCustomUnit), accountUuid: 'other-account' });
        const service = createService(); service.setAccount('owner'); await service.initialize();
        await expectAsync(service.save(mek())).toBeRejectedWithError(/5,000/);
        expect(save).not.toHaveBeenCalled();
        await service.save(mek(), { uuid: id(1) });
        expect(save).toHaveBeenCalledTimes(1);
        await service.delete(id(2));
        await service.save(mek());
        expect(service.records().filter(r => r.owned !== false).length).toBe(5000);
        expect(service.records().filter(r => r.subscribed).length).toBe(1);
        service.setAccount('other-account');
        await service.save(mek());
        expect(service.records().filter(r => r.owned !== false).length).toBe(2);
    }, 20000);

    it('extracts both native image formats under the final UUID before persisting or hashing a design', async () => {
        const service = createService();
        const saveArtwork = spyOn(TestBed.inject(UnitArtworkService), 'set').and.resolveTo();
        const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
        const png = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)));
        const encoded = await encodeUnitImage(png);
        for (const entity of [mek(), createTestTankEntity()]) {
            entity.fluffImageEncoded.set(encoded); entity.iconEncoded.set(encoded);
            const record = await service.save(entity);
            expect(hasEmbeddedUnitArtwork(record.source, record.format)).toBeFalse();
            expect(saveArtwork.calls.mostRecent().args[0]).toBe(record.uuid);
            expect(saveArtwork.calls.mostRecent().args[1]?.fluff?.type).toBe('image/png');
            expect(saveArtwork.calls.mostRecent().args[1]?.icon?.type).toBe('image/png');
            const loaded = await service.load(record.uuid);
            expect(loaded.fluffImageEncoded()).toBe(''); expect(loaded.iconEncoded()).toBe('');
            const updated = await service.save(loaded, { uuid: record.uuid });
            expect(updated.hash).toBe(record.hash);
        }
    });

    it('captures the requested editor revision before asynchronous storage work begins', async () => {
        const service = createService();
        const entity = mek({ model: 'Captured' });
        const saving = service.save(entity);
        entity.model.set('Changed while saving');
        const saved = await saving;
        expect((await service.load(saved.uuid)).model()).toBe('Captured');
        expect(entity.model()).toBe('Changed while saving');
        expect((await service.prepareSummaries(DEPENDENCIES))[0].model).toBe('Captured');
    });
});
