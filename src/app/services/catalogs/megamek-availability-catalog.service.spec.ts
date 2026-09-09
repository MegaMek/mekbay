// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { LoggerService } from '../logger.service';
import { CatalogStorage } from './catalog-storage.service';
import { RepositoryAssetManifestService } from './repository-asset-manifest.service';
import { MegaMekAvailabilityCatalogService } from './megamek-availability-catalog.service';

describe('MegaMekAvailabilityCatalogService name boundary', () => {
    it('joins external availability names only to core units', () => {
        TestBed.configureTestingModule({ providers: [
            { provide: LoggerService, useValue: {} },
            { provide: CatalogStorage, useValue: {} },
            { provide: RepositoryAssetManifestService, useValue: {} },
        ] });
        const service = TestBed.inject(MegaMekAvailabilityCatalogService);
        const core = createEmptyUnit({ name: 'Collision' });
        const custom = createEmptyUnit({ name: core.name, isCustom: true });
        const record = { n: core.name, e: { 1: { 10: [80, 0] as [number, number] } } };
        service['hydrate']([record]);
        expect(service.getRecordForUnit(core)).toBe(record);
        expect(service.getRecordForUnit(custom)).toBeUndefined();
        expect(service.getAvailabilityForUnit(custom, 1, 10)).toBeUndefined();
    });
});
