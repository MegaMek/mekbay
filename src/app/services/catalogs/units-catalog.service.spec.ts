import { provideZonelessChangeDetection } from '@angular/core';
import { HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { REMOTE_HOST } from '../../models/common.model';
import type { Options } from '../../models/options.model';
import type { Unit, Units } from '../../models/units.model';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { DbService } from '../db.service';
import { LoggerService } from '../logger.service';
import { OptionsService } from '../options.service';
import { UnitRuntimeService } from '../unit-runtime.service';
import { UnitsCatalogService } from './units-catalog.service';

async function settleMicrotasks(): Promise<void> {
    for (let index = 0; index < 5; index += 1) {
        await Promise.resolve();
    }
}

function buildPrimaryUnits(count: number): Unit[] {
    const units: Unit[] = [];
    for (let i = 0; i < count; i += 1) {
        units.push(createEmptyUnit({ id: -1, name: `Primary ${i}` }));
    }
    units.push(createEmptyUnit({ id: -1, name: 'Shared Unit' }));
    return units;
}

describe('UnitsCatalogService custom servers', () => {
    let service: UnitsCatalogService;
    let httpMock: HttpTestingController;
    let optionsSignal: ReturnType<typeof signal<Options>>;
    let dbMock: {
        getUnits: jasmine.Spy;
        saveUnits: jasmine.Spy;
        getCustomServerUnits: jasmine.Spy;
        saveCustomServerUnits: jasmine.Spy;
    };
    let preprocessSpy: jasmine.Spy;

    const CUSTOM_SERVER = 'https://custom.example';

    beforeEach(() => {
        TestBed.resetTestingModule();

        optionsSignal = signal<Options>({ unitServers: [CUSTOM_SERVER] } as Options);

        dbMock = {
            getUnits: jasmine.createSpy('getUnits').and.resolveTo(null),
            saveUnits: jasmine.createSpy('saveUnits').and.resolveTo(undefined),
            getCustomServerUnits: jasmine.createSpy('getCustomServerUnits').and.resolveTo(null),
            saveCustomServerUnits: jasmine.createSpy('saveCustomServerUnits').and.resolveTo(undefined),
        };

        preprocessSpy = jasmine.createSpy('preprocessUnits');

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
                UnitsCatalogService,
                { provide: DbService, useValue: dbMock },
                { provide: UnitRuntimeService, useValue: { preprocessUnits: preprocessSpy } },
                { provide: OptionsService, useValue: { options: optionsSignal } },
                { provide: LoggerService, useValue: { info() {}, warn() {}, error() {} } },
            ],
        });

        service = TestBed.inject(UnitsCatalogService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify();
    });

    async function flush(url: string, method: 'HEAD' | 'GET', body: unknown, etag: string): Promise<void> {
        const request = httpMock.expectOne(url);
        expect(request.request.method).toBe(method);
        request.flush(body as any, { headers: new HttpHeaders({ ETag: etag }) });
        await settleMicrotasks();
    }

    it('merges new-named units from a custom server and tags them with the server host', async () => {
        const primaryUnits = buildPrimaryUnits(9000);
        const primaryBody: Units = { version: '1', etag: '', units: primaryUnits };
        const customBody: Units = {
            version: '1',
            etag: '',
            units: [
                createEmptyUnit({ id: 0, name: 'Shared Unit' }), // collides with primary -> dropped
                createEmptyUnit({ id: 500, name: 'Custom Alpha' }),
                createEmptyUnit({ id: 0, name: 'Custom Beta' }), // null-ish id -> reassigned
            ],
        };

        const initializePromise = service.initialize();
        await settleMicrotasks();

        // Primary db.mekbay.com flow
        await flush(`${REMOTE_HOST}/units.json`, 'HEAD', '', 'primary-etag');
        await flush(`${REMOTE_HOST}/units.json`, 'GET', primaryBody, 'primary-etag');

        // Custom server flow
        await flush(`${CUSTOM_SERVER}/units.json`, 'HEAD', '', 'custom-etag');
        await flush(`${CUSTOM_SERVER}/units.json`, 'GET', customBody, 'custom-etag');

        await initializePromise;

        const units = service.getUnits();
        const byName = new Map(units.map(u => [u.name, u]));

        // 9001 primary (incl. Shared Unit) + 2 custom (Alpha, Beta)
        expect(units.length).toBe(9003);

        expect(byName.get('Custom Alpha')?.serverHost).toBe(CUSTOM_SERVER);
        expect(byName.get('Custom Beta')?.serverHost).toBe(CUSTOM_SERVER);

        // Collision: primary wins, only one Shared Unit, no serverHost.
        expect(units.filter(u => u.name === 'Shared Unit').length).toBe(1);
        expect(byName.get('Shared Unit')?.serverHost).toBeUndefined();

        // Beta had a non-positive id and was reassigned to a unique negative id.
        expect(byName.get('Custom Beta')?.id).toBeLessThan(0);

        // Custom server dataset was cached for offline use.
        expect(dbMock.saveCustomServerUnits).toHaveBeenCalledWith(CUSTOM_SERVER, jasmine.objectContaining({ etag: 'custom-etag' }));

        // preprocessUnits re-run over the merged set.
        expect(preprocessSpy).toHaveBeenCalled();
        const lastPreprocessArg = preprocessSpy.calls.mostRecent().args[0] as Unit[];
        expect(lastPreprocessArg.length).toBe(9003);
    });

    it('does not query custom servers when none are configured', async () => {
        optionsSignal.set({ unitServers: [] } as unknown as Options);

        const primaryUnits = buildPrimaryUnits(9000);
        const primaryBody: Units = { version: '1', etag: '', units: primaryUnits };

        const initializePromise = service.initialize();
        await settleMicrotasks();

        await flush(`${REMOTE_HOST}/units.json`, 'HEAD', '', 'primary-etag');
        await flush(`${REMOTE_HOST}/units.json`, 'GET', primaryBody, 'primary-etag');

        await initializePromise;

        expect(service.getUnits().length).toBe(9001);
        expect(dbMock.getCustomServerUnits).not.toHaveBeenCalled();
        httpMock.verify(); // no outstanding custom-server requests
    });
});
