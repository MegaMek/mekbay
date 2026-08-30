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
    afterInitialize(): Promise<void>;
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
            assetHash: 'test-hash',
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
        expect(registry.size).toBe(4);
        expect(registry.findEquipment('CleanId')).toBeDefined();
        expect(registry.findEquipment('Precision Ammo')).toBeDefined();
        expect(registry.findEquipment('ProductionAmmo')).toBeDefined();
        expect(registry.findEquipment('Light Minesweeper')).toBeDefined();
    });

    it('skips records that fail to hydrate', () => {
        hydrate({
            BrokenEquipment: null as unknown as EquipmentRawData,
            StandardAmmo: createAmmo('StandardAmmo'),
        });

        expect(service.getEquipmentRegistry().size).toBe(2);
        expect(service.getEquipmentRegistry().findEquipment('StandardAmmo')).toBeDefined();
        expect(service.getEquipmentRegistry().findEquipment('Light Minesweeper')).toBeDefined();
        expect(logger.error).toHaveBeenCalledOnceWith(jasmine.stringContaining(
            'Failed to hydrate cached equipment BrokenEquipment',
        ));
    });

    it('uses the supplier asset hash as the catalog revision', async () => {
        const seam = service as unknown as HydratableEquipmentCatalogService;
        const equipment = { StandardAmmo: createAmmo('StandardAmmo') };
        seam.hydrate({ version: '1', assetHash: 'first', equipment });
        await seam.afterInitialize();
        const first = service.getCatalogRevision();

        seam.hydrate({ version: '1', assetHash: 'second', equipment });
        await seam.afterInitialize();
        expect(service.getCatalogRevision()).toBe('second');
        expect(service.getCatalogRevision()).not.toBe(first);

        seam.hydrate({
            version: '2',
            assetHash: 'second',
            equipment: { StandardAmmo: createAmmo('StandardAmmo', 'Changed Semantic Name') },
        });
        await seam.afterInitialize();
        expect(service.getCatalogRevision()).toBe('second');
    });

    it('builds and commits one equipment registry directly', () => {
        const input: RawEquipmentData = {
            version: 'snapshot-v1',
            assetHash: 'transport-a',
            equipment: {
                StandardAmmo: {
                    ...createAmmo('StandardAmmo'),
                    aliases: ['Original Alias'],
                    modes: ['Original Mode'],
                    flags: ['F_ENERGY'],
                },
            },
        };
        const prepared = service.prepareBundledCatalog(input);
        service.commitPreparedCatalog(prepared);

        expect(service.getEquipmentRegistry()).toBe(prepared.registry);
        expect(service.getCatalogRevision()).toBe('transport-a');
        expect(service.getEquipmentRegistry().findEquipment('StandardAmmo')).toEqual(
            jasmine.objectContaining({
                name: 'StandardAmmo',
                aliases: ['Original Alias'],
                modes: ['Original Mode'],
            }),
        );
    });
});
