// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { EntityRepository } from '../models/entity/entity-repository';
import { MountedEngine } from '../models/entity/components';
import { encodeNativeEntity } from '../models/entity/write-entity';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import { createTestMekEntity } from '../testing/unit-test-helpers';
import { EquipmentCatalogService } from './catalogs/equipment-catalog.service';
import { QuirksCatalogService } from './catalogs/quirks-catalog.service';
import { SourcebooksCatalogService } from './catalogs/sourcebooks-catalog.service';
import { DataService } from './data.service';
import { NativeEntityService } from './native-entity.service';
import { UnitsCatalogService } from './catalogs/units-catalog.service';
import { CoreUnitCatalogService } from './unit-catalog/core-unit-catalog.service';
import { asSourceHash, asUnitUuid, makeUnitFileName } from './unit-catalog/unit-catalog.types';

describe('NativeEntityService persisted identity resolution', () => {
    it('resolves the UUID against the current catalog generation', async () => {
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
        const currentHash = asSourceHash(`${'B'.repeat(26)}A`);
        const repositoryLoad = spyOn(EntityRepository.prototype, 'load').and.resolveTo({} as never);

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                NativeEntityService,
                {
                    provide: CoreUnitCatalogService,
                    useValue: {
                        getPublishedGeneration: () => ({
                            activationId: 'current-generation',
                            manifest: { manifest: { units: { [uuid]: { hash: currentHash } } } },
                        }),
                    },
                },
                { provide: UnitsCatalogService, useValue: {} },
                {
                    provide: EquipmentCatalogService,
                    useValue: {
                        getCatalogRevision: () => 'equipment-1',
                        getEquipmentRegistry: () => ({}),
                    },
                },
                {
                    provide: SourcebooksCatalogService,
                    useValue: {
                        getCatalogRevision: () => 'sourcebooks-1',
                        getSourcebooks: () => new Map(),
                    },
                },
                {
                    provide: QuirksCatalogService,
                    useValue: {
                        getCatalogRevision: () => 'quirks-1',
                        getQuirksByKey: () => new Map(),
                    },
                },
                {
                    provide: DataService,
                    useValue: { requireApplicationCatalogReady: () => Promise.resolve() },
                },
            ],
        });

        await TestBed.inject(NativeEntityService).load(uuid);

        expect(repositoryLoad).toHaveBeenCalledOnceWith({
            uuid,
            sourceHash: currentHash,
        });
    });

    it('loads current custom native bytes and keeps prior loaded designs intact after an update', async () => {
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
        const entity = createTestMekEntity({ uuid, model: 'First revision' });
        entity.setTonnage(50);
        entity.configureEngine(new MountedEngine({ type: 'Fusion', rating: 250, techBase: 'IS' }));
        let source = { file: makeUnitFileName(uuid, 'mtf'), format: 'mtf' as const,
            hash: asSourceHash('A'.repeat(27)), bytes: new TextEncoder().encode(encodeNativeEntity(entity)).buffer };
        TestBed.configureTestingModule({ providers: [
            provideZonelessChangeDetection(), NativeEntityService,
            { provide: CoreUnitCatalogService, useValue: {
                getPublishedGeneration: () => ({ activationId: 'core-generation', manifest: { manifest: { units: {} } } }),
            } },
            { provide: UnitsCatalogService, useValue: {
                hasCustomUnit: (identity: string) => identity === uuid,
                readNativeUnitSource: async () => source,
            } },
            { provide: EquipmentCatalogService, useValue: {
                getCatalogRevision: () => 'equipment-1', getEquipmentRegistry: () => createTestEquipmentRegistry(),
            } },
            { provide: SourcebooksCatalogService, useValue: {
                getCatalogRevision: () => 'sourcebooks-1', getSourcebooks: () => new Map(),
            } },
            { provide: QuirksCatalogService, useValue: {
                getCatalogRevision: () => 'quirks-1', getQuirksByKey: () => new Map(),
            } },
            { provide: DataService, useValue: { requireApplicationCatalogReady: async () => undefined } },
        ] });
        const service = TestBed.inject(NativeEntityService);
        expect(service.canLoad({ uuid })).toBeTrue();
        const first = await service.load(uuid);
        entity.model.set('Second revision');
        source = { ...source, hash: asSourceHash(`${'B'.repeat(26)}A`),
            bytes: new TextEncoder().encode(encodeNativeEntity(entity)).buffer };
        const second = await service.load(uuid);
        expect(first.entity.model()).toBe('First revision');
        expect(second.entity.model()).toBe('Second revision');
        expect(first.entity).not.toBe(second.entity);
        expect(second.source.sourceHash).toBe(source.hash);
    });
});
