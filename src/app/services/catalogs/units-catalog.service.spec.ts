// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { UnitSummary } from '../../models/unit-summary.model';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { LoggerService } from '../logger.service';
import { CustomUnitsService } from '../custom-units.service';
import {
    CoreUnitCatalogService,
    type CoreUnitCatalogSnapshot,
    type PreparedCoreCatalogActivation,
} from '../unit-catalog/core-unit-catalog.service';
import {
    MM_DATA_UNIT_PROVIDER_ID,
    asCatalogActivationId,
    asSourceHash,
    asUnitUuid,
    makeUnitFileName,
    type StoredCoreContent,
} from '../unit-catalog/unit-catalog.types';
import { UnitsCatalogService } from './units-catalog.service';

const UUIDS = [
    asUnitUuid('019f6767-0dcb-7bb8-992f-000000000001'),
    asUnitUuid('019f6767-0dcb-7bb8-992f-000000000002'),
];
const SOURCE_HASH = asSourceHash('A'.repeat(27));

function summary(name: string, index: number): UnitSummary {
    const unit = createEmptyUnit({ uuid: UUIDS[index], name, chassis: name, id: index + 1 });
    return {
        ...unit,
        uuid: UUIDS[index],
        provider: MM_DATA_UNIT_PROVIDER_ID,
        origin: 'megamek',
        hash: SOURCE_HASH,
        baseChassis: unit.chassis,
        entityType: 'Mek',
        pv: unit.as.PV,
        engine: unit.engine || null,
    } as UnitSummary;
}

function snapshot(
    revision: number,
    summaries: readonly UnitSummary[],
    digest = revision === 1 ? 'A'.repeat(43) : 'B'.repeat(43),
): CoreUnitCatalogSnapshot {
    return {
        revision,
        summaries,
        generation: {
            activationId: asCatalogActivationId(digest),
        } as NonNullable<CoreUnitCatalogSnapshot['generation']>,
    };
}

function activation(value: CoreUnitCatalogSnapshot): PreparedCoreCatalogActivation {
    return {
        revision: value.revision,
        generation: value.generation!,
        dependencies: {},
        snapshot: value,
        committedState: { status: 'ready', availableUnits: value.summaries.length },
    } as PreparedCoreCatalogActivation;
}

describe('UnitsCatalogService native core projection', () => {
    let service: UnitsCatalogService;
    let current: ReturnType<typeof signal<CoreUnitCatalogSnapshot>>;
    let pending: ReturnType<typeof signal<PreparedCoreCatalogActivation | undefined>>;
    let initializeCore: jasmine.Spy;
    let finalizeCore: jasmine.Spy;
    let commitCore: jasmine.Spy;
    let rejectCore: jasmine.Spy;
    let acknowledgeCore: jasmine.Spy;
    let readUnitSource: jasmine.Spy;
    let logger: jasmine.SpyObj<Pick<LoggerService, 'info' | 'warn' | 'error'>>;
    let customRevision: ReturnType<typeof signal<number>>;
    let customSummaries: UnitSummary[];
    let customSources: Map<UnitSummary['uuid'], StoredCoreContent>;

    beforeEach(() => {
        TestBed.resetTestingModule();
        customRevision = signal(0);
        customSummaries = [];
        customSources = new Map();
        current = signal<CoreUnitCatalogSnapshot>({ revision: 0, summaries: [] });
        pending = signal<PreparedCoreCatalogActivation | undefined>(
            activation(snapshot(1, [summary('Alpha', 0), summary('Beta', 1)])),
        );
        initializeCore = jasmine.createSpy('initialize').and.resolveTo(undefined);
        finalizeCore = jasmine.createSpy('finalizePendingActivation').and.resolveTo(true);
        rejectCore = jasmine.createSpy('rejectPendingActivation');
        acknowledgeCore = jasmine.createSpy('acknowledgeCatalogConsumersReady').and.resolveTo(undefined);
        readUnitSource = jasmine.createSpy('readUnitSource').and.resolveTo(undefined);
        logger = jasmine.createSpyObj('LoggerService', ['info', 'warn', 'error']);
        commitCore = jasmine.createSpy('commitPendingActivation').and.callFake((revision: number) => {
            const candidate = pending();
            if (!candidate || candidate.revision !== revision) return undefined;
            current.set(candidate.snapshot);
            pending.set(undefined);
            return candidate.snapshot;
        });

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                UnitsCatalogService,
                {
                    provide: CustomUnitsService,
                    useValue: {
                        initialize: () => Promise.resolve(),
                        revision: customRevision.asReadonly(),
                        prepareSummaries: () => customSummaries,
                        captureSources: () => new Map(customSources),
                        commitSummaries: () => undefined,
                    },
                },
                {
                    provide: CoreUnitCatalogService,
                    useValue: {
                        state: signal({ status: 'idle', availableUnits: 0 }).asReadonly(),
                        catalogSnapshot: current.asReadonly(),
                        pendingActivation: pending.asReadonly(),
                        initialize: initializeCore,
                        finalizePendingActivation: finalizeCore,
                        commitPendingActivation: commitCore,
                        rejectPendingActivation: rejectCore,
                        acknowledgeCatalogConsumersReady: acknowledgeCore,
                        readUnitSource,
                    },
                },
                { provide: LoggerService, useValue: logger },
            ],
        });
        service = TestBed.inject(UnitsCatalogService);
    });

    async function initializeAndCommit(): Promise<number> {
        const first = service.initialize();
        expect(service.initialize()).toBe(first);
        await first;
        const revision = service.pendingActivation()!.revision;
        expect(await service.finalizePendingActivation(revision)).toBeTrue();
        expect(service.commitPendingActivation(revision)).toBeDefined();
        return revision;
    }

    it('publishes only the prepared native core catalog', async () => {
        await initializeAndCommit();

        expect(initializeCore).toHaveBeenCalledTimes(1);
        expect(service.getUnits().map(unit => unit.name)).toEqual(['Alpha', 'Beta']);
        expect(service.getCoreSummaries().map(unit => unit.name)).toEqual(['Alpha', 'Beta']);
        expect(service.getUnits().every(unit => !Object.hasOwn(unit, 'fluff'))).toBeTrue();
    });

    it('preserves transient tag overlays when a core design is replaced', async () => {
        await initializeAndCommit();
        const alpha = service.getUnits()[0]!;
        alpha._nameTags = [{ tag: 'Owned', quantity: 2 }];
        alpha._chassisTags = [{ tag: 'Chassis', quantity: 1 }];
        alpha._publicTags = [{ tag: 'Public', publicId: 'tag-1', subscribed: true }];

        pending.set(activation(snapshot(2, [summary('Alpha Prime', 0), summary('Beta', 1)])));
        TestBed.tick();
        await Promise.resolve();
        const revision = service.pendingActivation()!.revision;
        expect(service.commitPendingActivation(revision)).toBeDefined();

        const replacement = service.getUnits()[0]!;
        expect(replacement.name).toBe('Alpha Prime');
        expect(replacement._nameTags).toEqual([{ tag: 'Owned', quantity: 2 }]);
        expect(replacement._chassisTags).toEqual([{ tag: 'Chassis', quantity: 1 }]);
        expect(replacement._publicTags).toEqual([
            { tag: 'Public', publicId: 'tag-1', subscribed: true },
        ]);
        expect(replacement).not.toBe(alpha);
    });

    it('coalesces concurrent source extraction but does not retain a manual source cache', async () => {
        await initializeAndCommit();
        const file = makeUnitFileName(UUIDS[0], 'mtf');
        let release!: (source: StoredCoreContent) => void;
        readUnitSource.and.returnValue(new Promise<StoredCoreContent>(resolve => { release = resolve; }));

        const first = service.readNativeUnitSource(UUIDS[0]);
        const second = service.readNativeUnitSource(UUIDS[0]);
        expect(readUnitSource).toHaveBeenCalledTimes(1);
        release({
            file,
            hash: SOURCE_HASH,
            format: 'mtf',
            bytes: new TextEncoder().encode('Version:1.3').buffer,
        });
        const [firstSource, secondSource] = await Promise.all([first, second]);

        expect(firstSource).toEqual(secondSource);
        expect(firstSource?.bytes).not.toBe(secondSource?.bytes);
        readUnitSource.and.resolveTo(firstSource);
        await service.readNativeUnitSource(UUIDS[0]);
        expect(readUnitSource).toHaveBeenCalledTimes(2);
        expect(logger.info).toHaveBeenCalledTimes(2);
    });

    it('acknowledges the committed core generation and delegates rejection', async () => {
        const revision = await initializeAndCommit();
        await service.acknowledgeCatalogRevisionApplied(revision);
        expect(acknowledgeCore).toHaveBeenCalledOnceWith(
            1,
            asCatalogActivationId('A'.repeat(43)),
        );

        pending.set(activation(snapshot(2, [summary('Alpha Prime', 0)])));
        TestBed.tick();
        await Promise.resolve();
        const rejected = service.pendingActivation()!.revision;
        const error = new Error('invalid catalog');
        service.rejectPendingActivation(rejected, error);
        expect(rejectCore).toHaveBeenCalledOnceWith(2, error);
        expect(service.pendingActivation()).toBeUndefined();
    });

    it('fails closed when core initialization prepares no activation', async () => {
        pending.set(undefined);
        await expectAsync(service.initialize()).toBeRejectedWithError(
            /prepared no complete activation/u,
        );
    });

    it('atomically joins custom adds, updates and removal while retaining the core summaries', async () => {
        await initializeAndCommit();
        const custom = { ...summary('Custom Alpha', 0),
            uuid: asUnitUuid('019f6767-0dcb-7bb8-992f-000000000003'),
            origin: 'user' as const, isCustom: true };
        customSummaries = [custom];
        customRevision.set(1);
        TestBed.tick();
        let candidate = service.pendingActivation()!;
        expect(service.getSummaries().length).toBe(2);
        expect(candidate.snapshot.summaries.length).toBe(3);
        expect(await service.finalizePendingActivation(candidate.revision)).toBeTrue();
        service.commitPendingActivation(candidate.revision);
        expect(service.getSummaries().map(unit => unit.name)).toEqual(['Alpha', 'Beta', 'Custom Alpha']);
        expect(service.getCoreSummaries().map(unit => unit.name)).toEqual(['Alpha', 'Beta']);
        expect(commitCore).toHaveBeenCalledTimes(1);
        expect(finalizeCore).toHaveBeenCalledTimes(1);

        customSummaries = [{ ...custom, name: 'Custom Beta' }];
        customRevision.set(2);
        TestBed.tick();
        candidate = service.pendingActivation()!;
        service.commitPendingActivation(candidate.revision);
        expect(service.getUnits().map(unit => unit.name)).toEqual(['Alpha', 'Beta', 'Custom Beta']);

        customSummaries = [];
        customRevision.set(3);
        TestBed.tick();
        service.commitPendingActivation(service.pendingActivation()!.revision);
        expect(service.getUnits().map(unit => unit.name)).toEqual(['Alpha', 'Beta']);
        expect(commitCore).toHaveBeenCalledTimes(1);
    });

    it('binds custom native bytes to the visible summary revision and detaches each load', async () => {
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-000000000003');
        const source: StoredCoreContent = { file: makeUnitFileName(uuid, 'mtf'), hash: SOURCE_HASH,
            format: 'mtf', bytes: new TextEncoder().encode('old').buffer };
        customSummaries = [{ ...summary('Custom Alpha', 0), uuid, origin: 'user', isCustom: true }];
        customSources.set(uuid, source);
        await initializeAndCommit();
        customSources.set(uuid, { ...source, bytes: new TextEncoder().encode('new').buffer });
        customRevision.set(1);
        TestBed.tick();
        expect(new TextDecoder().decode((await service.readNativeUnitSource(uuid))!.bytes)).toBe('old');
        service.commitPendingActivation(service.pendingActivation()!.revision);
        const first = (await service.readNativeUnitSource(uuid))!;
        const second = (await service.readNativeUnitSource(uuid))!;
        expect(new TextDecoder().decode(first.bytes)).toBe('new');
        expect(first.bytes).not.toBe(second.bytes);
        expect(readUnitSource).not.toHaveBeenCalled();
    });

    it('does not reset or mutate visible core search overlays while preparing a custom edit', async () => {
        await initializeAndCommit();
        const active = service.getUnits()[0];
        active._searchKey = 'ready-to-search';
        active._nameTags = [{ tag: 'Owned', quantity: 3 }];
        active.as.dmg._dmgS = 7;
        customRevision.set(1);
        TestBed.tick();
        const candidate = service.pendingActivation()!.snapshot.units[0];
        expect(candidate).not.toBe(active);
        candidate._searchKey = 'replacement';
        candidate._nameTags = [];
        candidate.as.dmg._dmgS = 12;
        candidate.as.MVm[''] = 99;
        expect(active._searchKey).toBe('ready-to-search');
        expect(active._nameTags).toEqual([{ tag: 'Owned', quantity: 3 }]);
        expect(active.as.dmg._dmgS).toBe(7);
        expect(active.as.MVm['']).not.toBe(99);
    });

    it('can retry publishing an unchanged saved custom revision after search preparation fails', async () => {
        await initializeAndCommit();
        customRevision.set(1);
        const failedRevision = service.prepareCustomChanges()!;
        service.rejectPendingActivation(failedRevision, new Error('Index preparation failed'));
        expect(service.getUnits().map(unit => unit.name)).toEqual(['Alpha', 'Beta']);
        const retryRevision = service.prepareCustomChanges()!;
        expect(retryRevision).toBeGreaterThan(failedRevision);
        expect(service.commitPendingActivation(retryRevision)).toBeDefined();
        expect(commitCore).toHaveBeenCalledTimes(1);
        expect(rejectCore).not.toHaveBeenCalled();
    });
});
