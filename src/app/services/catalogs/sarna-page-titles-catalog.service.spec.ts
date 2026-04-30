import { provideZonelessChangeDetection } from '@angular/core';
import { HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import type { SarnaPageTitlesData } from '../../models/sarna-page-titles.model';
import { DbService } from '../db.service';
import { LoggerService } from '../logger.service';
import { SarnaPageTitlesCatalogService } from './sarna-page-titles-catalog.service';

async function settleMicrotasks(): Promise<void> {
    for (let index = 0; index < 3; index += 1) {
        await Promise.resolve();
    }
}

describe('SarnaPageTitlesCatalogService', () => {
    let service: SarnaPageTitlesCatalogService;
    let httpMock: HttpTestingController;
    let dbServiceMock: {
        getSarnaPageTitles: jasmine.Spy;
        saveSarnaPageTitles: jasmine.Spy;
    };

    const cachedTitles: SarnaPageTitlesData = {
        etag: 'etag-1',
        titlesByType: {
            Mek: [
                'Avatar (BattleMech)',
                'Avatar (OmniMech)',
                'Centurion (BattleMech)',
            ],
            Aero: [
                'Avatar (WarShip class)',
                'Centurion (Aerospace Fighter class)',
                'Centurion (OmniFighter class)',
            ],
            Tank: [
                'Pegasus (Combat Vehicle)',
                'Pegasus (OmniVehicle)',
            ],
            Infantry: [],
            ProtoMek: [],
            'Handheld Weapon': [],
        },
    };

    beforeEach(() => {
        TestBed.resetTestingModule();

        dbServiceMock = {
            getSarnaPageTitles: jasmine.createSpy('getSarnaPageTitles').and.resolveTo(cachedTitles),
            saveSarnaPageTitles: jasmine.createSpy('saveSarnaPageTitles').and.resolveTo(undefined),
        };

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
                SarnaPageTitlesCatalogService,
                { provide: DbService, useValue: dbServiceMock },
                { provide: LoggerService, useValue: { info: jasmine.createSpy('info'), warn: jasmine.createSpy('warn'), error: jasmine.createSpy('error') } },
            ],
        });

        service = TestBed.inject(SarnaPageTitlesCatalogService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify();
    });

    async function initializeFromCache(): Promise<void> {
        const initializePromise = service.initialize();
        await settleMicrotasks();

        const headRequest = httpMock.expectOne('assets/sarna-page-titles.json');
        expect(headRequest.request.method).toBe('HEAD');
        headRequest.flush('', {
            headers: new HttpHeaders({ ETag: 'etag-1' }),
        });

        await initializePromise;
    }

    it('uses the omni flag to prefer omni Sarna pages for ambiguous chassis names', async () => {
        await initializeFromCache();

        expect(service.getPageTitleForUnit({ chassis: 'Avatar', type: 'Mek', subtype: 'BattleMek', omni: 0 })).toBe('Avatar (BattleMech)');
        expect(service.getPageTitleForUnit({ chassis: 'Avatar', type: 'Mek', subtype: 'BattleMek Omni', omni: 1 })).toBe('Avatar (OmniMech)');
        expect(service.getPageTitleForUnit({ chassis: 'Centurion', type: 'Aero', subtype: 'Aerospace Fighter Omni', omni: 1 })).toBe('Centurion (OmniFighter class)');
    });

    it('uses the Tank bucket for VTOL and Naval Sarna lookups', async () => {
        await initializeFromCache();

        expect(service.getPageTitleForUnit({ chassis: 'Pegasus', type: 'VTOL', subtype: 'Combat Vehicle Omni', omni: 1 })).toBe('Pegasus (OmniVehicle)');
        expect(service.getPageTitleForUnit({ chassis: 'Pegasus', type: 'Naval', subtype: 'Combat Vehicle', omni: 0 })).toBe('Pegasus (Combat Vehicle)');
    });

    it('returns undefined when the chassis is not in the Sarna title bucket', async () => {
        await initializeFromCache();

        expect(service.getPageTitleForUnit({ chassis: 'Not A Sarna Page', type: 'Mek' })).toBeUndefined();
        expect(service.hasPageForUnit({ chassis: 'Not A Sarna Page', type: 'Mek' })).toBeFalse();
    });
});