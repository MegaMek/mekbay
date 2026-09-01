// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { EntityRepository } from '../models/entity/entity-repository';
import { EquipmentCatalogService } from './catalogs/equipment-catalog.service';
import { QuirksCatalogService } from './catalogs/quirks-catalog.service';
import { SourcebooksCatalogService } from './catalogs/sourcebooks-catalog.service';
import { DataService } from './data.service';
import {
    CoreCatalogNativeEntitySourceRepository,
    NativeEntityService,
} from './native-entity.service';
import { CoreUnitCatalogService } from './unit-catalog/core-unit-catalog.service';
import { asSourceHash, asUnitUuid } from './unit-catalog/unit-catalog.types';

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
                { provide: CoreCatalogNativeEntitySourceRepository, useValue: {} },
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
});
