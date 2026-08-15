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

    it('load equipment', () => {
        hydrate({
            'Catalog Key': createAmmo('CleanId', 'Clean Name'),
            CleanCatalogKey: createAmmo('Precision Ammo', 'Another Clean Name'),
            ProductionAmmo: createAmmo('ProductionAmmo', 'Production Ammo'),
        });

        const registry = service.getEquipmentRegistry();
        expect(registry.size).toBe(1);
        expect(registry.findEquipment('CleanId')).toBeNull();
        expect(registry.findEquipment('Precision Ammo')).toBeNull();
        expect(registry.findEquipment('ProductionAmmo')).toBeDefined();
    });

    it('skips malformed records without attempting to hydrate them', () => {
        hydrate({
            BrokenAmmo: {
                id: 'BrokenPlaytestAmmo',
                name: 'Broken Playtest Ammo',
                type: 'invalid-equipment-type',
            } as unknown as EquipmentRawData,
            StandardAmmo: createAmmo('StandardAmmo'),
        });

        expect(service.getEquipmentRegistry().size).toBe(1);
        expect(logger.error).not.toHaveBeenCalled();
    });
});