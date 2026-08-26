// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { REMOTE_HOST } from '../../models/common.model';
import type { Options } from '../../models/options.model';
import type { UnitSummary, Units } from '../../models/unit-summary.model';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { LoggerService } from '../logger.service';
import { OptionsService } from '../options.service';
import {
    CoreUnitCatalogService,
    type CoreUnitCatalogSnapshot,
    type PreparedCoreCatalogActivation,
} from '../unit-catalog/core-unit-catalog.service';
import {
    MM_DATA_UNIT_PROVIDER_ID,
    asCatalogActivationId,
    asSourceHash,
    asUnitProviderId,
    asUnitUuid,
    makeUnitFileName,
    type StoredCoreContent,
} from '../unit-catalog/unit-catalog.types';
import { customProviderIdForServer } from '../unit-catalog/custom-provider-catalog';
import {
    NATIVE_UNIT_SOURCE_CACHE_LIMIT,
    type PreparedUnitsCatalogActivation,
    UnitsCatalogService,
} from './units-catalog.service';
import { CatalogStorage } from './catalog-storage.service';

const UUIDS = [
    asUnitUuid('019f6767-0dcb-7bb8-992f-000000000001'),
    asUnitUuid('019f6767-0dcb-7bb8-992f-000000000002'),
];
const SOURCE_HASH = asSourceHash('A'.repeat(27));

function summary(name: string, index: number, id = -1): UnitSummary {
    const legacy = createEmptyUnit({ uuid: UUIDS[index], name, chassis: name, id });
    return {
        ...legacy,
        uuid: UUIDS[index],
        provider: MM_DATA_UNIT_PROVIDER_ID,
        origin: 'megamek',
        hash: SOURCE_HASH,
        baseChassis: legacy.chassis,
        entityType: 'Mek',
        pv: legacy.as.PV,
        engine: legacy.engine || null,
    } as UnitSummary;
}

function coreSnapshot(
    revision: number,
    snapshotSummaries: readonly UnitSummary[],
    activationDigest = 'A'.repeat(43),
): CoreUnitCatalogSnapshot {
    return {
        revision,
        summaries: snapshotSummaries,
        generation: {
            activationId: asCatalogActivationId(activationDigest),
        } as NonNullable<CoreUnitCatalogSnapshot['generation']>,
    };
}

async function settleMicrotasks(): Promise<void> {
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe('UnitsCatalogService native core cutover', () => {
    let service: UnitsCatalogService;
    let httpMock: HttpTestingController;
    let optionsSignal: ReturnType<typeof signal<Options>>;
    let summaries: UnitSummary[];
    let catalogStorageMock: {
        get: jasmine.Spy;
        put: jasmine.Spy;
    };
    let coreSnapshotSignal: ReturnType<typeof signal<CoreUnitCatalogSnapshot>>;
    let corePendingSignal: ReturnType<typeof signal<PreparedCoreCatalogActivation | undefined>>;
    let acknowledgeCatalogConsumersReady: jasmine.Spy;
    let commitCorePendingActivation: jasmine.Spy;
    let readUnitSource: jasmine.Spy;
    let logger: jasmine.SpyObj<Pick<LoggerService, 'info' | 'warn' | 'error'>>;

    const CUSTOM_SERVER = 'https://custom.example';

    beforeEach(() => {
        TestBed.resetTestingModule();
        summaries = [summary('Primary Alpha', 0), summary('Shared Unit', 1)];
        optionsSignal = signal<Options>({ unitServers: [CUSTOM_SERVER] } as Options);
        catalogStorageMock = {
            get: jasmine.createSpy('get').and.resolveTo(undefined),
            put: jasmine.createSpy('put').and.resolveTo(undefined),
        };
        const coreState = signal({ status: 'idle', availableUnits: 0 } as const);
        coreSnapshotSignal = signal<CoreUnitCatalogSnapshot>(coreSnapshot(1, summaries));
        corePendingSignal = signal<PreparedCoreCatalogActivation | undefined>(undefined);
        acknowledgeCatalogConsumersReady = jasmine.createSpy('acknowledgeCatalogConsumersReady').and.resolveTo();
        readUnitSource = jasmine.createSpy('readUnitSource').and.resolveTo(undefined);
        logger = jasmine.createSpyObj('LoggerService', ['info', 'warn', 'error']);
        commitCorePendingActivation = jasmine.createSpy('commitPendingActivation').and.callFake((revision: number) => {
            const pending = corePendingSignal();
            if (!pending || pending.revision !== revision) return undefined;
            coreSnapshotSignal.set(pending.snapshot);
            corePendingSignal.set(undefined);
            return pending.snapshot;
        });
        const coreMock = {
            state: coreState.asReadonly(),
            catalogSnapshot: coreSnapshotSignal.asReadonly(),
            pendingActivation: corePendingSignal.asReadonly(),
            initialize: jasmine.createSpy('initialize').and.resolveTo(undefined),
            whenRefreshSettled: jasmine.createSpy('whenRefreshSettled').and.resolveTo(undefined),
            readUnitSource,
            getSummaries: jasmine.createSpy('getSummaries').and.callFake(() => summaries),
            finalizePendingActivation: jasmine.createSpy('finalizePendingActivation').and.resolveTo(true),
            commitPendingActivation: commitCorePendingActivation,
            rejectPendingActivation: jasmine.createSpy('rejectPendingActivation'),
            acknowledgeCatalogConsumersReady,
        };

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
                UnitsCatalogService,
                { provide: CoreUnitCatalogService, useValue: coreMock },
                { provide: CatalogStorage, useValue: catalogStorageMock },
                { provide: OptionsService, useValue: { options: optionsSignal } },
                { provide: LoggerService, useValue: logger },
            ],
        });
        service = TestBed.inject(UnitsCatalogService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => httpMock.verify());

    async function flush(url: string, method: 'HEAD' | 'GET', body: unknown, etag: string): Promise<void> {
        let request = httpMock.match(url)[0];
        for (let attempt = 0; !request && attempt < 50; attempt += 1) {
            await new Promise<void>(resolve => setTimeout(resolve, 0));
            request = httpMock.match(url)[0];
        }
        if (!request) throw new Error(`Timed out waiting for ${method} ${url}`);
        expect(request.request.method).toBe(method);
        request.flush(body as never, { headers: new HttpHeaders({ ETag: etag }) });
        await settleMicrotasks();
    }

    async function waitForPendingActivation(
        expectedUnitCount?: number,
        expectedKind?: PreparedUnitsCatalogActivation['kind'],
    ): Promise<PreparedUnitsCatalogActivation> {
        for (let attempt = 0; attempt < 50; attempt += 1) {
            TestBed.tick();
            await settleMicrotasks();
            const pending = service.pendingActivation();
            if (pending
                && (expectedUnitCount === undefined || pending.snapshot.units.length === expectedUnitCount)
                && (expectedKind === undefined || pending.kind === expectedKind)) {
                return pending;
            }
            await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
        throw new Error(`Timed out waiting for ${expectedKind ?? 'any'} activation with ${expectedUnitCount ?? 'any'} units`);
    }

    async function commitPreparedActivation(
        expectedUnitCount?: number,
        expectedKind?: PreparedUnitsCatalogActivation['kind'],
    ): Promise<PreparedUnitsCatalogActivation> {
        const pending = await waitForPendingActivation(expectedUnitCount, expectedKind);
        expect(await service.finalizePendingActivation(pending!.revision)).toBeTrue();
        expect(service.commitPendingActivation(pending!.revision)).toBeDefined();
        TestBed.tick();
        await settleMicrotasks();
        return pending!;
    }

    it('logs the exact native BLK/MTF file once when it is extracted, not on LRU hits', async () => {
        const file = makeUnitFileName(UUIDS[0], 'mtf');
        readUnitSource.and.resolveTo({
            file,
            hash: SOURCE_HASH,
            format: 'mtf',
            bytes: new TextEncoder().encode('Version:1.3').buffer,
        });

        await expectAsync(service.readNativeUnitSource(MM_DATA_UNIT_PROVIDER_ID, UUIDS[0]))
            .toBeResolvedTo(jasmine.objectContaining({ file, format: 'mtf' }));
        await service.readNativeUnitSource(MM_DATA_UNIT_PROVIDER_ID, UUIDS[0]);

        expect(logger.info).toHaveBeenCalledOnceWith(
            `Opening native MTF unit file "${file}" (${MM_DATA_UNIT_PROVIDER_ID}/${UUIDS[0]}).`,
        );
    });

    it('coalesces concurrent first opens of the same native source into one ZIP extraction', async () => {
        const file = makeUnitFileName(UUIDS[0], 'mtf');
        let release!: (value: StoredCoreContent) => void;
        readUnitSource.and.returnValue(new Promise<StoredCoreContent>(resolve => { release = resolve; }));

        const first = service.readNativeUnitSource(MM_DATA_UNIT_PROVIDER_ID, UUIDS[0]);
        const second = service.readNativeUnitSource(MM_DATA_UNIT_PROVIDER_ID, UUIDS[0]);
        expect(readUnitSource).toHaveBeenCalledTimes(1);

        release({
            file,
            hash: SOURCE_HASH,
            format: 'mtf',
            bytes: new TextEncoder().encode('Version:1.3').buffer,
        });
        const [firstSource, secondSource] = await Promise.all([first, second]);

        expect(readUnitSource).toHaveBeenCalledTimes(1);
        expect(firstSource).toEqual(secondSource);
        expect(firstSource?.bytes).not.toBe(secondSource?.bytes);
        expect(logger.info).toHaveBeenCalledTimes(1);
    });

    it('keeps a detached bounded LRU of recently opened native sources', async () => {
        const ids = Array.from({ length: NATIVE_UNIT_SOURCE_CACHE_LIMIT + 1 }, (_, index) =>
            asUnitUuid(`019f6767-0dcb-7bb8-992f-${String(index + 100).padStart(12, '0')}`));
        readUnitSource.and.callFake(async (uuid: string) => ({
            file: makeUnitFileName(asUnitUuid(uuid), 'mtf'),
            hash: SOURCE_HASH,
            format: 'mtf' as const,
            bytes: new TextEncoder().encode(uuid).buffer,
        }));

        for (const id of ids.slice(0, NATIVE_UNIT_SOURCE_CACHE_LIMIT)) {
            await service.readNativeUnitSource(MM_DATA_UNIT_PROVIDER_ID, id);
        }
        const first = await service.readNativeUnitSource(MM_DATA_UNIT_PROVIDER_ID, ids[0]!);
        expect(readUnitSource).toHaveBeenCalledTimes(NATIVE_UNIT_SOURCE_CACHE_LIMIT);
        new Uint8Array(first!.bytes)[0] = 0;

        const firstAgain = await service.readNativeUnitSource(MM_DATA_UNIT_PROVIDER_ID, ids[0]!);
        expect(new TextDecoder().decode(firstAgain!.bytes)).toBe(ids[0]);
        expect(readUnitSource).toHaveBeenCalledTimes(NATIVE_UNIT_SOURCE_CACHE_LIMIT);

        await service.readNativeUnitSource(MM_DATA_UNIT_PROVIDER_ID, ids.at(-1)!);
        await service.readNativeUnitSource(MM_DATA_UNIT_PROVIDER_ID, ids[1]!);
        expect(readUnitSource).toHaveBeenCalledTimes(NATIVE_UNIT_SOURCE_CACHE_LIMIT + 2);
    });

    it('invalidates native-source cache entries when the core activation changes', async () => {
        readUnitSource.and.resolveTo({
            file: makeUnitFileName(UUIDS[0], 'mtf'),
            hash: SOURCE_HASH,
            format: 'mtf',
            bytes: new TextEncoder().encode('Version:1.3').buffer,
        });

        await service.readNativeUnitSource(MM_DATA_UNIT_PROVIDER_ID, UUIDS[0]);
        await service.readNativeUnitSource(MM_DATA_UNIT_PROVIDER_ID, UUIDS[0]);
        expect(readUnitSource).toHaveBeenCalledTimes(1);

        coreSnapshotSignal.set(coreSnapshot(2, summaries, `${'B'.repeat(42)}E`));
        await service.readNativeUnitSource(MM_DATA_UNIT_PROVIDER_ID, UUIDS[0]);
        expect(readUnitSource).toHaveBeenCalledTimes(2);
    });

    it('never requests units.json and imports explicit custom providers as catalog-only summaries', async () => {
        const customBody: Units = {
            version: '1',
            assetHash: 'custom-v1',
            units: [
                createEmptyUnit({ uuid: '019f6767-0dcb-7bb8-992f-000000000010', id: 0, name: 'Shared Unit' }),
                createEmptyUnit({
                    uuid: '019f6767-0dcb-7bb8-992f-000000000011', id: 500, name: 'Custom Alpha',
                }),
                createEmptyUnit({ uuid: '019f6767-0dcb-7bb8-992f-000000000012', id: 0, name: 'Custom Beta' }),
            ],
        };

        const first = service.initialize();
        expect(service.initialize()).toBe(first);
        await settleMicrotasks();

        httpMock.expectNone(`${REMOTE_HOST}/units.json?ngsw-bypass=true`);
        await flush(`${CUSTOM_SERVER}/units.json?ngsw-bypass=true`, 'GET', customBody, 'custom-etag');
        await first;
        await commitPreparedActivation(5);

        const units = service.getUnits();
        expect(units.map(unit => unit.name)).toEqual(['Primary Alpha', 'Shared Unit', 'Shared Unit', 'Custom Alpha', 'Custom Beta']);
        expect(units.find(unit => unit.name === 'Custom Alpha')?.serverHost).toBe(CUSTOM_SERVER);
        expect(units.find(unit => unit.name === 'Custom Beta')?.id).toBe(0);
        expect(catalogStorageMock.put).toHaveBeenCalledWith(
            jasmine.any(String),
            jasmine.any(String),
            jasmine.objectContaining({ assetHash: jasmine.any(String) }),
        );
        expect(service.getCoreSummaryByIdentity(MM_DATA_UNIT_PROVIDER_ID, UUIDS[0])).toBe(summaries[0]);
        const custom = service.getCoreSummaryByIdentity(
            await customProviderIdForServer(CUSTOM_SERVER),
            '019f6767-0dcb-7bb8-992f-000000000011',
        );
        expect(custom).toEqual(jasmine.objectContaining({
            origin: 'user',
            provider: await customProviderIdForServer(CUSTOM_SERVER),
        }));
        expect(Object.prototype.hasOwnProperty.call(custom!, 'fluff')).toBeFalse();
        expect(Object.prototype.hasOwnProperty.call(
            units.find(unit => unit.name === 'Custom Alpha')!,
            'fluff',
        )).toBeFalse();

        const initialRevision = service.catalogRevision();
        const tagged = units.find(unit => unit.name === 'Primary Alpha')!;
        tagged._nameTags = [{ tag: 'Owned', quantity: 2 }];
        tagged._chassisTags = [{ tag: 'Chassis', quantity: 1 }];
        tagged._publicTags = [{ tag: 'Shared', publicId: 'public-1', subscribed: true }];
        const nextCore = [summary('Primary Omega', 0), summary('Shared Unit', 1)];
        coreSnapshotSignal.set(coreSnapshot(2, nextCore, 'Q'.repeat(43)));
        TestBed.tick();
        await settleMicrotasks();
        await commitPreparedActivation(5);

        const updatedUnits = service.getUnits();
        expect(service.catalogRevision()).toBe(initialRevision + 1);
        expect(updatedUnits.map(unit => unit.name)).toEqual([
            'Primary Omega', 'Shared Unit', 'Shared Unit', 'Custom Alpha', 'Custom Beta',
        ]);
        expect(updatedUnits.find(unit => unit.name === 'Custom Alpha')?.serverHost).toBe(CUSTOM_SERVER);
        const updatedTagged = updatedUnits.find(unit => unit.name === 'Primary Omega')!;
        expect(updatedTagged._nameTags).toEqual([{ tag: 'Owned', quantity: 2 }]);
        expect(updatedTagged._chassisTags).toEqual([{ tag: 'Chassis', quantity: 1 }]);
        expect(updatedTagged._publicTags).toEqual([
            { tag: 'Shared', publicId: 'public-1', subscribed: true },
        ]);

        await service.acknowledgeCatalogRevisionApplied(service.catalogRevision());
        expect(acknowledgeCatalogConsumersReady).toHaveBeenCalledOnceWith(
            2,
            asCatalogActivationId('Q'.repeat(43)),
        );

        coreSnapshotSignal.set(coreSnapshot(2, nextCore, 'Q'.repeat(43)));
        TestBed.tick();
        await settleMicrotasks();
        expect(service.catalogRevision()).toBe(initialRevision + 1);
    });

    it('reads only the local core snapshot when no custom provider is configured', async () => {
        optionsSignal.set({ unitServers: [REMOTE_HOST] } as Options);
        await service.initialize();
        await commitPreparedActivation(2);

        httpMock.expectNone(`${REMOTE_HOST}/units.json?ngsw-bypass=true`);
        expect(service.getUnits().map(unit => unit.name)).toEqual(['Primary Alpha', 'Shared Unit']);
        expect(catalogStorageMock.get).not.toHaveBeenCalled();
        expect(logger.info).not.toHaveBeenCalledWith('[Background:custom-unit-catalogs] Started.');
    });

    it('publishes the local candidate without waiting for an optional custom provider', async () => {
        const initialization = service.initialize();
        let initialized = false;
        void initialization.then(() => { initialized = true; });
        await settleMicrotasks();

        expect(initialized).toBeTrue();
        expect(service.pendingActivation()?.snapshot.units.map(unit => unit.name))
            .toEqual(['Primary Alpha', 'Shared Unit']);

        await flush(`${CUSTOM_SERVER}/units.json?ngsw-bypass=true`, 'GET', {
            version: '1', assetHash: '', units: [],
        }, 'custom-etag');
        await service.whenBackgroundCatalogSettled();
    });

    it('preserves a custom provider LKG instead of caching an implausibly truncated refresh', async () => {
        const cached: Units = {
            version: '1',
            assetHash: 'old-hash',
            units: Array.from({ length: 100 }, (_, index) => createEmptyUnit({
                id: 1_000 + index,
                name: `Cached Custom ${index}`,
                uuid: `019f6767-0dcb-7bb8-992f-${String(index).padStart(12, '0')}`,
            })),
        };
        catalogStorageMock.get.and.resolveTo(cached);
        const initialization = service.initialize();
        await settleMicrotasks();
        await flush(`${CUSTOM_SERVER}/units.json?ngsw-bypass=true`, 'GET', {
            version: '1', assetHash: '', units: [createEmptyUnit({ name: 'Truncated' })],
        }, 'new-etag');
        await initialization;
        await commitPreparedActivation(102);

        expect(service.getUnits().filter(unit => unit.serverHost === CUSTOM_SERVER).length).toBe(100);
        expect(service.getUnits().some(unit => unit.name === 'Truncated')).toBeFalse();
        expect(catalogStorageMock.put).not.toHaveBeenCalled();
    });

    it('publishes the validated provider LKG while offline without issuing a request', async () => {
        const cached: Units = {
            version: '1', assetHash: 'old-hash', units: [createEmptyUnit({
                uuid: '019f6767-0dcb-7bb8-992f-000000000200', name: 'Offline Custom',
            })],
        };
        catalogStorageMock.get.and.resolveTo(cached);
        const original = Object.getOwnPropertyDescriptor(navigator, 'onLine');
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
        try {
            await service.initialize();
            await commitPreparedActivation(3);
        } finally {
            if (original) Object.defineProperty(navigator, 'onLine', original);
            else delete (navigator as { onLine?: boolean }).onLine;
        }

        httpMock.expectNone(`${CUSTOM_SERVER}/units.json?ngsw-bypass=true`);
        expect(service.getUnits().some(unit => unit.name === 'Offline Custom')).toBeTrue();
    });

    it('folds a startup custom overlay into the cold core activation without a second runtime rebuild', async () => {
        const candidateSnapshot = coreSnapshot(1, summaries);
        coreSnapshotSignal.set(coreSnapshot(0, []));
        corePendingSignal.set({
            revision: 41,
            generation: candidateSnapshot.generation!,
            dependencies: {},
            snapshot: candidateSnapshot,
            committedState: { status: 'ready', availableUnits: summaries.length },
        } as unknown as PreparedCoreCatalogActivation);
        const customBody: Units = {
            version: '1',
            assetHash: 'custom-fast-v1',
            units: [createEmptyUnit({
                uuid: '019f6767-0dcb-7bb8-992f-000000000201',
                name: 'Fast Custom',
            })],
        };

        const initialization = service.initialize();
        await settleMicrotasks();
        await flush(`${CUSTOM_SERVER}/units.json?ngsw-bypass=true`, 'GET', customBody, 'custom-etag');
        await initialization;
        await service.whenBackgroundCatalogSettled();

        expect(service.getUnits()).toEqual([]);
        expect(service.pendingActivation()?.kind).toBe('megamek');
        expect(service.pendingActivation()?.snapshot.units.map(unit => unit.name))
            .toEqual(['Primary Alpha', 'Shared Unit', 'Fast Custom']);

        await commitPreparedActivation(3, 'megamek');
        expect(service.getUnits().map(unit => unit.name))
            .toEqual(['Primary Alpha', 'Shared Unit', 'Fast Custom']);
        expect(service.pendingActivation()).toBeUndefined();
        expect(commitCorePendingActivation).toHaveBeenCalledOnceWith(41);
        expect(logger.info).toHaveBeenCalledWith(
            jasmine.stringMatching(/^\[Background:custom-unit-catalogs\] Updated in \d+ ms\.$/u),
        );
    });

    it('fails closed when no summary generation is available', async () => {
        summaries = [];
        coreSnapshotSignal.set(coreSnapshot(2, summaries, 'Q'.repeat(43)));
        await expectAsync(service.initialize()).toBeRejectedWithError(/prepared no complete activation/u);
        httpMock.expectNone(`${REMOTE_HOST}/units.json?ngsw-bypass=true`);
    });
});
