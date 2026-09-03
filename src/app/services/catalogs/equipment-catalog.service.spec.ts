// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { EquipmentRawData, RawEquipmentData } from '../../models/equipment.model';
import { DbService } from '../db.service';
import { LoggerService } from '../logger.service';
import { EquipmentCatalogService } from './equipment-catalog.service';

interface HydratableEquipmentCatalogService {
    hydrate(data: RawEquipmentData): void;
    getMinimumDatasetSize(): number;
}

function createAmmo(id: string, name = id): EquipmentRawData {
    return {
        id,
        name,
        type: 'ammo',
        ammo: {
            type: 'AC',
            rackSize: 5,
            shots: 20,
        },
    };
}

describe('EquipmentCatalogService', () => {
    let service: EquipmentCatalogService;
    let logger: { error: jasmine.Spy };

    beforeEach(() => {
        logger = { error: jasmine.createSpy('error') };

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
                EquipmentCatalogService,
                { provide: DbService, useValue: {} },
                { provide: LoggerService, useValue: logger },
            ],
        });

        service = TestBed.inject(EquipmentCatalogService);
    });

    function hydrate(equipment: RawEquipmentData['equipment']): void {
        (service as unknown as HydratableEquipmentCatalogService).hydrate({
            version: 'test',
            etag: 'test-etag',
            equipment,
        });
    }

    it('loads equipment', () => {
        hydrate({
            CleanId: createAmmo('CleanId', 'Clean Name'),
            'Precision Ammo': createAmmo('Precision Ammo', 'Another Clean Name'),
            ProductionAmmo: createAmmo('ProductionAmmo', 'Production Ammo'),
        });

        const registry = service.getEquipmentRegistry();
        expect(registry.size).toBe(3);
        expect(registry.findEquipment('CleanId')).toBeDefined();
        expect(registry.findEquipment('Precision Ammo')).toBeDefined();
        expect(registry.findEquipment('ProductionAmmo')).toBeDefined();
    });

    it('accepts equipment datasets with at least 3000 entries', () => {
        expect((service as unknown as HydratableEquipmentCatalogService).getMinimumDatasetSize()).toBe(3000);
    });

    it('skips records that fail to hydrate', () => {
        hydrate({
            BrokenEquipment: null as unknown as EquipmentRawData,
            StandardAmmo: createAmmo('StandardAmmo'),
        });

        expect(service.getEquipmentRegistry().size).toBe(1);
        expect(service.getEquipmentRegistry().findEquipment('StandardAmmo')).toBeDefined();
        expect(logger.error).toHaveBeenCalledOnceWith(jasmine.stringContaining(
            'Failed to hydrate cached equipment BrokenEquipment',
        ));
    });
});