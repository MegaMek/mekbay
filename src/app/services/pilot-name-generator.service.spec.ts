/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 */

import { TestBed } from '@angular/core/testing';

import type { PilotNameCatalog } from '../models/pilot-name-catalog.model';
import { PilotNameCatalogService } from './catalogs/pilot-name-catalog.service';
import { PilotNameGeneratorService } from './pilot-name-generator.service';

describe('PilotNameGeneratorService', () => {
    const catalog: PilotNameCatalog = {
        maleGivenNames: { 1: [{ value: 'John', weight: 1 }] },
        femaleGivenNames: { 1: [{ value: 'Jane', weight: 1 }] },
        surnames: { 1: [{ value: 'Smith', weight: 1 }] },
        factions: {
            General: {
                surnameEthnicities: [{ value: 1, weight: 1 }],
                givenNameEthnicities: { 1: [{ value: 1, weight: 1 }] },
            },
        },
        factionProfiles: {},
        callsigns: [{ value: 'Ace', weight: 1 }],
        bloodnameClans: {},
        bloodnames: [],
    };

    beforeEach(() => TestBed.resetTestingModule());

    function configure(catalogService: object): void {
        TestBed.configureTestingModule({
            providers: [
                PilotNameGeneratorService,
                { provide: PilotNameCatalogService, useValue: catalogService },
            ],
        });
    }

    it('initializes the lazy catalog before generating', async () => {
        const catalogService = {
            initialize: jasmine.createSpy('initialize').and.resolveTo(undefined),
            getCatalog: jasmine.createSpy('getCatalog').and.returnValue(catalog),
        };
        configure(catalogService);

        const result = await TestBed.inject(PilotNameGeneratorService).generate({ includeCallsign: false });

        expect(catalogService.initialize).toHaveBeenCalledTimes(1);
        expect(catalogService.getCatalog).toHaveBeenCalledTimes(1);
        expect(result).toMatch(/^(John|Jane) Smith$/);
    });

    it('uses the catalog faction profile for Clan single-name formatting', async () => {
        const profiledCatalog: PilotNameCatalog = {
            ...catalog,
            factionProfiles: {
                10: { generator: 'General', isClan: true },
                12: { generator: 'General', isClan: false },
            },
        };
        const catalogService = {
            initialize: jasmine.createSpy('initialize').and.resolveTo(undefined),
            getCatalog: jasmine.createSpy('getCatalog').and.returnValue(profiledCatalog),
        };
        configure(catalogService);
        const service = TestBed.inject(PilotNameGeneratorService);

        expect(await service.generate({ factionId: 10, includeCallsign: false })).toMatch(/^(John|Jane)$/);
        expect(await service.generate({ factionId: 12, includeCallsign: false })).toMatch(/^(John|Jane) Smith$/);
        expect(await service.generate({ factionId: 404, includeCallsign: false })).toMatch(/^(John|Jane) Smith$/);
    });

    it('propagates catalog initialization failures', async () => {
        const catalogService = {
            initialize: jasmine.createSpy('initialize').and.rejectWith(new Error('offline')),
            getCatalog: jasmine.createSpy('getCatalog'),
        };
        configure(catalogService);

        await expectAsync(TestBed.inject(PilotNameGeneratorService).generate()).toBeRejectedWithError('offline');
        expect(catalogService.getCatalog).not.toHaveBeenCalled();
    });
});