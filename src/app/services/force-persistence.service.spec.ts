// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CBTForce } from '../models/cbt-force.model';
import { GameSystem } from '../models/common.model';
import type { SerializedCBTForce } from '../models/force-serialization';
import { createEmptyCBTForceForTest } from '../testing/unit-test-helpers';
import { CBTUnitService } from './cbt-unit.service';
import { DataService } from './data.service';
import { DbService } from './db.service';
import { ForcePersistenceService } from './force-persistence.service';
import { LoggerService } from './logger.service';
import { OptionsService } from './options.service';
import { UnitRuntimeService } from './unit-runtime.service';
import { UserStateService } from './userState.service';
import { WsService, type WsMessage } from './ws.service';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(complete => { resolve = complete; });
    return { promise, resolve };
}

describe('ForcePersistenceService cloud acknowledgements', () => {
    let persistence: ForcePersistenceService;
    let force: CBTForce;
    let ws: jasmine.SpyObj<WsService>;
    let db: jasmine.SpyObj<DbService>;
    let logger: jasmine.SpyObj<LoggerService>;
    let firstRequest: ReturnType<typeof deferred<void>>;
    let firstResponse: ReturnType<typeof deferred<WsMessage>>;
    let beforeUnload: EventListener;

    beforeEach(async () => {
        ws = jasmine.createSpyObj<WsService>('WsService', [
            'getWebSocket', 'getWsReady', 'sendAndWaitForResponse', 'send',
        ]);
        ws.getWebSocket.and.returnValue({ readyState: WebSocket.OPEN } as WebSocket);
        ws.getWsReady.and.resolveTo();
        firstRequest = deferred<void>();
        firstResponse = deferred<WsMessage>();
        ws.sendAndWaitForResponse.and.callFake((() => {
            if (ws.sendAndWaitForResponse.calls.count() === 1) {
                firstRequest.resolve();
                return firstResponse.promise;
            }
            return Promise.resolve({ action: 'forceSaved' });
        }) as WsService['sendAndWaitForResponse']);
        logger = jasmine.createSpyObj<LoggerService>('LoggerService', ['info', 'warn', 'error']);
        db = jasmine.createSpyObj<DbService>('DbService', ['getForce', 'saveForce', 'countForces']);
        db.getForce.and.resolveTo(null);
        db.saveForce.and.resolveTo();
        db.countForces.and.resolveTo(1);
        const data = { getFactionById: () => null, getEraById: () => null };
        TestBed.configureTestingModule({
            providers: [
                ForcePersistenceService,
                { provide: DataService, useValue: data },
                { provide: DbService, useValue: db },
                { provide: WsService, useValue: ws },
                { provide: UserStateService, useValue: { uuid: () => 'user-1' } },
                { provide: UnitRuntimeService, useValue: {} },
                { provide: CBTUnitService, useValue: {} },
                { provide: LoggerService, useValue: logger },
                { provide: OptionsService, useValue: {
                    options: () => ({
                        CBTRules: 'total-warfare',
                        CBTOptionalRules: { forcedWithdrawal: true, sprinting: false },
                    }),
                } },
            ],
        });
        const windowListeners = spyOn(window, 'addEventListener').and.callThrough();
        persistence = TestBed.inject(ForcePersistenceService);
        beforeUnload = windowListeners.calls.allArgs()
            .find(([event]) => String(event) === 'beforeunload')![1] as EventListener;
        spyOn<any>(persistence, 'canUseCloud').and.resolveTo(ws.getWebSocket());
        const serialized: SerializedCBTForce = {
            version: 2,
            instanceId: 'force-cloud-ack',
            timestamp: '2026-09-05T19:56:00.000Z',
            name: 'Cloud acknowledgement',
            type: GameSystem.CBT,
            personnel: { people: [], assignments: [] },
            cbt: createEmptyCBTForceForTest('force-cloud-ack', 4),
        };
        force = await CBTForce.deserialize(serialized, TestBed.inject(DataService), TestBed.inject(Injector));
        force.markCloudCBTForceV2Saved(serialized);
        expect(persistence.activateForceAuthority(force)).toBeTrue();
        await force.addGroup('First lance');
    });

    for (const localOnlySave of [false, true]) {
        it(`creates a cloud force with an explicit absent revision (local save first: ${localOnlySave})`, async () => {
            const created = new CBTForce('New cloud force', TestBed.inject(DataService), TestBed.inject(Injector));
            expect(created.instanceId()).toBeNull();
            expect(persistence.activateForceAuthority(created)).toBeTrue();
            // Adding the first unit creates its roster group and mints the force ID.
            await created.addGroup('First lance');
            if (localOnlySave) await persistence.saveForce(created, true);
            ws.sendAndWaitForResponse.and.callFake(((request: {
                cbtPersistence?: { expectedRevision?: number | null };
            }) => Promise.resolve(request.cbtPersistence?.expectedRevision === null
                ? { action: 'forceSaved' }
                : { action: 'error', code: 'force_revision_conflict', message: 'Missing new-force revision' }
            )) as WsService['sendAndWaitForResponse']);

            expect(await persistence.saveForceAndWaitForCloud(created)).toBeTrue();

            expect(ws.sendAndWaitForResponse).toHaveBeenCalledOnceWith(jasmine.objectContaining({
                cbtPersistence: { writerVersion: 2, expectedRevision: null },
            }));
            expect(created.getExpectedCloudCBTForceV2Revision()).toBe(created.getCBTForceV2Revision());
        });
    }

    it('keeps the cloud revision unknown for an existing force loaded without cloud evidence', async () => {
        const loaded = await CBTForce.deserialize({
            version: 2,
            instanceId: 'force-unobserved-cloud',
            timestamp: '2026-09-05T19:56:00.000Z',
            name: 'Unobserved cloud force',
            type: GameSystem.CBT,
            personnel: { people: [], assignments: [] },
            cbt: createEmptyCBTForceForTest('force-unobserved-cloud', 4),
        }, TestBed.inject(DataService), TestBed.inject(Injector));
        expect(persistence.activateForceAuthority(loaded)).toBeTrue();
        await loaded.addGroup('Local edit');
        await persistence.saveForce(loaded, true);

        expect(loaded.getExpectedCloudCBTForceV2Revision()).toBeUndefined();
        expect(ws.sendAndWaitForResponse).not.toHaveBeenCalled();
    });

    it('uploads revision 3000 after many offline edits without treating it as a cloud revision', async () => {
        const created = new CBTForce('Offline force', TestBed.inject(DataService), TestBed.inject(Injector));
        expect(persistence.activateForceAuthority(created)).toBeTrue();
        const group = await created.addGroup('Lance');
        for (let revision = 2; revision <= 3000; revision += 1) {
            await created.updateGroup(group, { name: `Lance ${revision}` });
        }
        await persistence.saveForce(created, true);
        expect(created.getCBTForceV2Revision()).toBe(3000);
        expect(created.getExpectedCloudCBTForceV2Revision()).toBeNull();
        ws.sendAndWaitForResponse.and.resolveTo({ action: 'forceSaved' });

        await persistence.saveForceMissingFromCloud(created);

        expect(ws.sendAndWaitForResponse).toHaveBeenCalledOnceWith(jasmine.objectContaining({
            data: jasmine.objectContaining({ cbt: jasmine.objectContaining({ r: 3000 }) }),
            cbtPersistence: { writerVersion: 2, expectedRevision: null },
        }));
        expect(created.getExpectedCloudCBTForceV2Revision()).toBe(3000);
    });

    it('uploads a force reloaded offline at revision 3000 once reconnect confirms cloud absence', async () => {
        const local: SerializedCBTForce = {
            version: 2,
            instanceId: 'force-offline-reload',
            timestamp: '2026-09-05T19:56:00.000Z',
            name: 'Reloaded offline force',
            type: GameSystem.CBT,
            owned: true,
            personnel: { people: [], assignments: [] },
            cbt: createEmptyCBTForceForTest('force-offline-reload', 3000),
        };
        db.getForce.and.resolveTo(local);
        (persistence as any).canUseCloud.and.resolveTo(null);
        const loaded = (await persistence.getForce(local.instanceId))!;
        expect(loaded.getExpectedCloudCBTForceV2Revision()).toBeUndefined();
        expect(persistence.activateForceAuthority(loaded)).toBeTrue();
        (persistence as any).canUseCloud.and.resolveTo(ws.getWebSocket());
        ws.sendAndWaitForResponse.and.resolveTo({ action: 'forceSaved' });

        await persistence.saveForceMissingFromCloud(loaded);

        expect(ws.sendAndWaitForResponse).toHaveBeenCalledOnceWith(jasmine.objectContaining({
            data: jasmine.objectContaining({ cbt: jasmine.objectContaining({ r: 3000 }) }),
            cbtPersistence: { writerVersion: 2, expectedRevision: null },
        }));
        expect(loaded.getExpectedCloudCBTForceV2Revision()).toBe(3000);
    });

    it('does not replace an acknowledged cloud revision with a late missing-force response', async () => {
        await persistence.saveForceMissingFromCloud(force);

        expect(ws.sendAndWaitForResponse).not.toHaveBeenCalled();
        expect(force.getExpectedCloudCBTForceV2Revision()).toBe(4);
    });

    for (const successor of ['queued', 'debounced', 'later'] as const) {
        it(`keeps an acknowledged revision after a roster edit with a ${successor} successor`, async () => {
            const firstSave = persistence.saveForceAndWaitForCloud(force);
            await firstRequest.promise;
            const savedRevision = force.getCBTForceV2Revision();
            await force.addGroup('Second lance');
            const latestRevision = force.getCBTForceV2Revision();
            let secondSave: Promise<void> | undefined;
            if (successor !== 'later') {
                await persistence.saveForce(force);
                if (successor === 'queued') {
                    secondSave = (persistence as any).flushSaveForceCloud(force.instanceId());
                }
            }

            firstResponse.resolve({ action: 'forceSaved' });
            // The older bytes were saved, but the latest local edit still needs saving.
            expect(await firstSave).toBeFalse();
            if (successor !== 'queued') {
                expect(force.getExpectedCloudCBTForceV2Revision()).toBe(savedRevision);
                if (successor === 'later') await persistence.saveForce(force);
                secondSave = (persistence as any).flushSaveForceCloud(force.instanceId());
            }
            await secondSave;

            expect(ws.sendAndWaitForResponse).toHaveBeenCalledTimes(2);
            expect(ws.sendAndWaitForResponse.calls.argsFor(1)[0]).toEqual(jasmine.objectContaining({
                cbtPersistence: { writerVersion: 2, expectedRevision: savedRevision },
            }));
            expect(force.getExpectedCloudCBTForceV2Revision()).toBe(latestRevision);
            expect(force.groups().map(group => group.name())).toEqual(['First lance', 'Second lance']);
            expect(logger.error).not.toHaveBeenCalled();
        });
    }

    it('carries the acknowledged revision across an obsolete queued save without sending its bytes', async () => {
        const firstSave = persistence.saveForceAndWaitForCloud(force);
        await firstRequest.promise;
        const savedRevision = force.getCBTForceV2Revision();
        await force.addGroup('Second lance');
        await persistence.saveForce(force);
        const skippedSave = (persistence as any).flushSaveForceCloud(force.instanceId());
        await force.addGroup('Third lance');
        await persistence.saveForce(force);
        const latestSave = (persistence as any).flushSaveForceCloud(force.instanceId());

        firstResponse.resolve({ action: 'forceSaved' });
        await Promise.all([firstSave, skippedSave, latestSave]);

        expect(ws.sendAndWaitForResponse).toHaveBeenCalledTimes(2);
        expect(ws.sendAndWaitForResponse.calls.argsFor(1)[0]).toEqual(jasmine.objectContaining({
            cbtPersistence: { writerVersion: 2, expectedRevision: savedRevision },
        }));
        expect(force.getExpectedCloudCBTForceV2Revision()).toBe(force.getCBTForceV2Revision());
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('does not acknowledge a rejected save after a local roster edit', async () => {
        const firstSave = persistence.saveForceAndWaitForCloud(force);
        await firstRequest.promise;
        await force.addGroup('Second lance');
        firstResponse.resolve({ action: 'error', code: 'force_revision_conflict', message: 'Cloud conflict' });

        await expectAsync(firstSave).toBeRejectedWithError('Cloud conflict');
        expect(force.getExpectedCloudCBTForceV2Revision()).toBe(4);
    });

    it('queues a page-hide flush behind an in-flight save and retains it until acknowledged', async () => {
        const firstSave = persistence.saveForceAndWaitForCloud(force);
        await firstRequest.promise;
        const savedRevision = force.getCBTForceV2Revision();
        await force.addGroup('Second lance');
        await persistence.saveForce(force);
        const flush = spyOn<any>(persistence, 'flushSaveForceCloud').and.callThrough();

        window.dispatchEvent(new Event('pagehide'));
        expect(ws.sendAndWaitForResponse).toHaveBeenCalledTimes(1);
        firstResponse.resolve({ action: 'forceSaved' });
        await firstSave;
        await flush.calls.mostRecent()?.returnValue;

        expect(ws.sendAndWaitForResponse).toHaveBeenCalledTimes(2);
        expect(ws.sendAndWaitForResponse.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({
            cbtPersistence: { writerVersion: 2, expectedRevision: savedRevision },
        }));
        expect(force.getExpectedCloudCBTForceV2Revision()).toBe(force.getCBTForceV2Revision());
        expect(persistence.hasPendingForceSaves()).toBeFalse();
    });

    it('does not send an obsolete snapshot when the page hides before the next autosave is prepared', async () => {
        await persistence.saveForce(force);
        await force.addGroup('Second lance');
        const flush = spyOn<any>(persistence, 'flushSaveForceCloud').and.callThrough();

        window.dispatchEvent(new Event('pagehide'));
        await flush.calls.mostRecent()?.returnValue;

        expect(ws.sendAndWaitForResponse).not.toHaveBeenCalled();
        expect(ws.send).not.toHaveBeenCalled();
        expect(force.getExpectedCloudCBTForceV2Revision()).toBe(4);
    });

    for (const event of ['visibilitychange', 'pagehide', 'beforeunload']) {
        it(`tracks the acknowledgement when ${event} flushes a save and editing resumes`, async () => {
            await persistence.saveForce(force);
            const savedRevision = force.getCBTForceV2Revision();
            const flush = spyOn<any>(persistence, 'flushSaveForceCloud').and.callThrough();
            if (event === 'visibilitychange') {
                spyOnProperty(document, 'visibilityState', 'get').and.returnValue('hidden');
                document.dispatchEvent(new Event(event));
            } else if (event === 'beforeunload') {
                // Karma treats a dispatched beforeunload as a full page reload.
                beforeUnload(new Event(event));
            } else {
                window.dispatchEvent(new Event(event));
            }

            // A final page event must put the request on the socket synchronously.
            expect(ws.sendAndWaitForResponse).toHaveBeenCalledTimes(1);
            expect(ws.send).not.toHaveBeenCalled();
            expect(persistence.hasPendingForceSaves()).toBeTrue();
            firstResponse.resolve({ action: 'forceSaved' });
            await flush.calls.mostRecent()?.returnValue;
            expect(force.getExpectedCloudCBTForceV2Revision()).toBe(savedRevision);

            await force.addGroup('Second lance');
            expect(await persistence.saveForceAndWaitForCloud(force)).toBeTrue();
            expect(ws.sendAndWaitForResponse.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({
                cbtPersistence: { writerVersion: 2, expectedRevision: savedRevision },
            }));
            expect(logger.error).not.toHaveBeenCalled();
        });
    }
});
