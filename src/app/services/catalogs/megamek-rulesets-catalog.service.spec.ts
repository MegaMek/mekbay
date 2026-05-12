import { provideZonelessChangeDetection } from '@angular/core';
import { HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import type { MegaMekRulesetRecord, MegaMekRulesetsData } from '../../models/megamek/rulesets.model';
import { DbService } from '../db.service';
import { LoggerService } from '../logger.service';
import { MegaMekRulesetsCatalogService } from './megamek-rulesets-catalog.service';

async function settleMicrotasks(): Promise<void> {
    for (let index = 0; index < 3; index += 1) {
        await Promise.resolve();
    }
}

function createRuleset(factionKey: string): MegaMekRulesetRecord {
    return {
        factionKey,
        indexes: { forceIndexesByEchelon: { LANCE: [0] } },
        forceCount: 1,
        forces: [{ echelon: { code: 'LANCE' } }],
    };
}

describe('MegaMekRulesetsCatalogService', () => {
    let service: MegaMekRulesetsCatalogService;
    let httpMock: HttpTestingController;
    let cachedRulesets: MegaMekRulesetsData | null;
    let savedRulesets: MegaMekRulesetsData[];
    let logger: {
        info: jasmine.Spy;
        warn: jasmine.Spy;
        error: jasmine.Spy;
    };

    beforeEach(() => {
        cachedRulesets = null;
        savedRulesets = [];
        logger = {
            info: jasmine.createSpy('info'),
            warn: jasmine.createSpy('warn'),
            error: jasmine.createSpy('error'),
        };

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
                MegaMekRulesetsCatalogService,
                {
                    provide: DbService,
                    useValue: {
                        getMegaMekRulesets: jasmine.createSpy('getMegaMekRulesets').and.callFake(async () => cachedRulesets),
                        saveMegaMekRulesets: jasmine.createSpy('saveMegaMekRulesets').and.callFake(async (data: MegaMekRulesetsData) => {
                            savedRulesets.push(data);
                            cachedRulesets = data;
                        }),
                    },
                },
                { provide: LoggerService, useValue: logger },
            ],
        });

        service = TestBed.inject(MegaMekRulesetsCatalogService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify();
    });

    it('rejects stale cached schema versions and fetches the current ruleset catalog', async () => {
        cachedRulesets = {
            etag: 'old-etag',
            version: 2,
            rulesets: [createRuleset('OLD')],
        };

        const initializePromise = service.initialize();
        await settleMicrotasks();

        const headRequest = httpMock.expectOne('assets/rulesets.json');
        expect(headRequest.request.method).toBe('HEAD');
        headRequest.flush('', {
            headers: new HttpHeaders({ ETag: 'new-etag' }),
        });
        await settleMicrotasks();

        const getRequest = httpMock.expectOne('assets/rulesets.json');
        expect(getRequest.request.method).toBe('GET');
        getRequest.flush({
            etag: 'ignored-remote-etag',
            version: 3,
            rulesets: [createRuleset('NEW')],
        }, {
            headers: new HttpHeaders({ ETag: 'new-etag' }),
        });

        await initializePromise;

        expect(service.getRulesets().map((ruleset) => ruleset.factionKey)).toEqual(['NEW']);
        expect(savedRulesets.length).toBe(1);
        expect(savedRulesets[0].version).toBe(3);
        expect(logger.warn).toHaveBeenCalledWith(jasmine.stringMatching(/Ignoring invalid cache megamek_rulesets dataset/));
    });

    it('accepts legacy array-shaped remote rulesets as the current schema', async () => {
        const initializePromise = service.initialize();
        await settleMicrotasks();

        const headRequest = httpMock.expectOne('assets/rulesets.json');
        expect(headRequest.request.method).toBe('HEAD');
        headRequest.flush('', {
            headers: new HttpHeaders({ ETag: 'array-etag' }),
        });
        await settleMicrotasks();

        const getRequest = httpMock.expectOne('assets/rulesets.json');
        expect(getRequest.request.method).toBe('GET');
        getRequest.flush([createRuleset('ARR')], {
            headers: new HttpHeaders({ ETag: 'array-etag' }),
        });

        await initializePromise;

        expect(service.getRulesetByFactionKey('ARR')).toBeDefined();
        expect(savedRulesets[0].version).toBe(3);
        expect(savedRulesets[0].etag).toBe('array-etag');
    });

    it('rejects stale wrapped remote rulesets instead of caching them', async () => {
        cachedRulesets = {
            etag: 'current-etag',
            version: 3,
            rulesets: [createRuleset('CUR')],
        };

        const initializePromise = service.initialize();
        await settleMicrotasks();

        const headRequest = httpMock.expectOne('assets/rulesets.json');
        expect(headRequest.request.method).toBe('HEAD');
        headRequest.flush('', {
            headers: new HttpHeaders({ ETag: 'stale-remote-etag' }),
        });
        await settleMicrotasks();

        const getRequest = httpMock.expectOne('assets/rulesets.json');
        expect(getRequest.request.method).toBe('GET');
        getRequest.flush({
            etag: 'stale-remote-etag',
            version: 2,
            rulesets: [createRuleset('OLD')],
        }, {
            headers: new HttpHeaders({ ETag: 'stale-remote-etag' }),
        });

        await expectAsync(initializePromise).toBeRejectedWithError(/Rejected megamek_rulesets update/);

        expect(service.getRulesets().map((ruleset) => ruleset.factionKey)).toEqual(['CUR']);
        expect(savedRulesets).toEqual([]);
        expect(logger.warn).toHaveBeenCalledWith('Preserved cached megamek_rulesets after rejecting the remote update.');
    });
});