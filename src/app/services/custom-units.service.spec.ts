// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { decodeSavedCustomUnit, type SavedCustomUnit } from '../models/custom-unit.model';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import { createTestMekEntity, createTestTankEntity } from '../testing/unit-test-helpers';
import { MountedEngine } from '../models/entity/components';
import { encodeNativeEntity } from '../models/entity/write-entity';
import { CustomUnitsService } from './custom-units.service';
import { DbService } from './db.service';
import { LoggerService } from './logger.service';
import type { PreparedApplicationCatalogDependencies } from './unit-catalog/application-catalog-bundle-coordinator.service';
import { asUnitUuid } from './unit-catalog/unit-catalog.types';

const ORIGINAL = asUnitUuid('019f6767-0dcb-7bb8-992f-000000000001');
const DEPENDENCIES = {
    equipment: { registry: createTestEquipmentRegistry() },
    quirks: { quirksByKey: new Map() },
    sourcebooks: { sourcebooksByAbbrev: new Map() },
    sprites: { assignmentContext: { assignments: undefined } },
} as unknown as PreparedApplicationCatalogDependencies;

function mek(overrides: Parameters<typeof createTestMekEntity>[0] = {}) {
    const entity = createTestMekEntity(overrides);
    entity.setTonnage(50);
    entity.configureEngine(new MountedEngine({ type: 'Fusion', rating: 250, techBase: 'IS' }));
    return entity;
}

describe('CustomUnitsService native construction persistence', () => {
    let rows: unknown[];
    let save: jasmine.Spy;
    let logger: jasmine.SpyObj<LoggerService>;

    function createService(): CustomUnitsService {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({ providers: [
            provideZonelessChangeDetection(), CustomUnitsService,
            { provide: DbService, useValue: {
                listCustomUnits: async () => structuredClone(rows),
                saveCustomUnit: save,
                deleteCustomUnit: async (uuid: string) => {
                    rows = rows.filter(row => (row as SavedCustomUnit).uuid !== uuid);
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
        save = jasmine.createSpy('saveCustomUnit').and.callFake(async (record: SavedCustomUnit) => {
            rows = [structuredClone(record), ...rows.filter(row => (row as SavedCustomUnit).uuid !== record.uuid)];
        });
        logger = jasmine.createSpyObj('LoggerService', ['info', 'warn', 'error']);
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
            'createdAt', 'format', 'originalUnitUuid', 'schemaVersion', 'source', 'updatedAt', 'uuid',
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
        const summaries = service.prepareSummaries(DEPENDENCIES);
        expect(summaries.length).toBe(1);
        expect(summaries[0].model).toBe('Workshop');
        expect(summaries[0].origin).toBe('user');
        expect(summaries[0].isCustom).toBeTrue();
        expect(summaries[0].canon).toBeFalse();
        expect(summaries[0].originalUnitUuid).toBe(ORIGINAL);
        expect(summaries[0].id).toBeLessThan(-1);

        const reloaded = createService();
        await reloaded.initialize();
        expect((await reloaded.load(saved.uuid)).model()).toBe('Workshop');
        expect(reloaded.prepareSummaries(DEPENDENCIES)[0].hash).toBe(summaries[0].hash);
        await reloaded.delete(saved.uuid);
        expect(reloaded.records()).toEqual([]);
        expect(reloaded.prepareSummaries(DEPENDENCIES)).toEqual([]);
        expect(rows).toEqual([]);
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
        expect(service.prepareSummaries(DEPENDENCIES)[0].entityType).toBe('Tank');
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
        expect(service.prepareSummaries(DEPENDENCIES)).toEqual([]);
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

    it('captures the requested editor revision before asynchronous storage work begins', async () => {
        const service = createService();
        const entity = mek({ model: 'Captured' });
        const saving = service.save(entity);
        entity.model.set('Changed while saving');
        const saved = await saving;
        expect((await service.load(saved.uuid)).model()).toBe('Captured');
        expect(entity.model()).toBe('Changed while saving');
        expect(service.prepareSummaries(DEPENDENCIES)[0].model).toBe('Captured');
    });
});
