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

    it('does not load equipment with playtest in its display name, regardless of case', () => {
        hydrate({
            StandardAmmo: createAmmo('StandardAmmo', 'Standard AC/5 Ammo'),
            ExperimentalAmmo: createAmmo('ExperimentalAmmo', 'Precision PlAyTeSt AC/5 Ammo'),
        });

        const registry = service.getEquipmentRegistry();
        expect(registry.size).toBe(1);
        expect(registry.findEquipment('StandardAmmo')).toBeDefined();
        expect(registry.findEquipment('ExperimentalAmmo')).toBeNull();
    });

    it('does not load equipment identified as playtest by its catalog key or canonical id', () => {
        hydrate({
            'Playtest Catalog Key': createAmmo('CleanId', 'Clean Name'),
            CleanCatalogKey: createAmmo('Precision Playtest Ammo', 'Another Clean Name'),
            ProductionAmmo: createAmmo('ProductionAmmo', 'Production Ammo'),
        });

        const registry = service.getEquipmentRegistry();
        expect(registry.size).toBe(1);
        expect(registry.findEquipment('CleanId')).toBeNull();
        expect(registry.findEquipment('Precision Playtest Ammo')).toBeNull();
        expect(registry.findEquipment('ProductionAmmo')).toBeDefined();
    });

    it('skips malformed playtest records without attempting to hydrate them', () => {
        hydrate({
            BrokenPlaytestAmmo: {
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