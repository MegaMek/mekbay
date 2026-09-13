// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ForceLoadingOverlayComponent, type ForceLoadingOverlayData } from '../components/force-loading-overlay/force-loading-overlay.component';
import type { Force } from '../models/force.model';
import type { ForceMember } from '../models/force-member.model';
import { DataService } from './data.service';
import { DialogsService } from './dialogs.service';
import { ForceOperationService } from './force-operation.service';
import { ForcePersistenceService } from './force-persistence.service';
import { ForceUnitAdmissionService } from './force-unit-admission.service';
import { ForceUrlStateService, type ForceUrlWorkspace } from './force-url-state.service';
import { LayoutService } from './layout.service';
import { LoggerService } from './logger.service';
import { UrlService } from './url.service';

describe('ForceUrlStateService', () => {
    it('publishes a selected unit only after its force has a saved instance ID', () => {
        const instanceId = signal('');
        const selected = signal({
            id: 'unit-1',
            force: { instanceId: () => instanceId() },
        } as unknown as ForceMember);
        const setQueryParams = jasmine.createSpy('setQueryParams');

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                ForceUrlStateService,
                { provide: DataService, useValue: { isDataReady: () => false } },
                { provide: DialogsService, useValue: {} },
                { provide: ForceOperationService, useValue: { currentOperation: signal(null) } },
                { provide: ForcePersistenceService, useValue: { getForce: jasmine.createSpy('getForce') } },
                { provide: ForceUnitAdmissionService, useValue: {} },
                { provide: LayoutService, useValue: {} },
                { provide: LoggerService, useValue: {} },
                {
                    provide: UrlService,
                    useValue: { initialParams: new URLSearchParams(), setQueryParams },
                },
            ],
        });
        const service = TestBed.inject(ForceUrlStateService);
        service.configure({
            loadedForces: () => [],
            selectedUnit: selected,
        } as unknown as ForceUrlWorkspace);
        service.setSynchronizationEnabled(true);
        TestBed.runInInjectionContext(() => service.start());
        TestBed.tick();

        expect(setQueryParams.calls.mostRecent().args[0].sel).toBeNull();

        instanceId.set('force-1');
        TestBed.tick();

        expect(setQueryParams.calls.mostRecent().args[0].sel).toBe('unit-1');
    });

    describe('force-link loading dialog', () => {
        let params: URLSearchParams;
        let catalogReady: ReturnType<typeof signal<boolean>>;
        let requireCatalogReady: jasmine.Spy;
        let getForce: jasmine.Spy;
        let loadOperation: jasmine.Spy;
        let createDialog: jasmine.Spy;
        let closeDialog: jasmine.Spy;
        let showError: jasmine.Spy;
        let addLoadedForce: jasmine.Spy;

        beforeEach(() => {
            params = new URLSearchParams('instance=force-1');
            catalogReady = signal(false);
            requireCatalogReady = jasmine.createSpy('requireApplicationCatalogReady').and.resolveTo();
            getForce = jasmine.createSpy('getForce').and.resolveTo(null);
            loadOperation = jasmine.createSpy('loadOperation').and.resolveTo(false);
            closeDialog = jasmine.createSpy('close');
            createDialog = jasmine.createSpy('createDialog').and.returnValue({ close: closeDialog });
            showError = jasmine.createSpy('showError').and.resolveTo();
            addLoadedForce = jasmine.createSpy('addLoadedForce').and.returnValue(true);
            TestBed.configureTestingModule({
                providers: [
                    provideZonelessChangeDetection(),
                    ForceUrlStateService,
                    { provide: DataService, useValue: {
                        isDataReady: catalogReady,
                        requireApplicationCatalogReady: requireCatalogReady,
                    } },
                    { provide: DialogsService, useValue: {
                        createDialog, showError, showNotice: jasmine.createSpy('showNotice').and.resolveTo(),
                    } },
                    { provide: ForceOperationService, useValue: { currentOperation: signal(null), loadOperation } },
                    { provide: ForcePersistenceService, useValue: { getForce } },
                    { provide: ForceUnitAdmissionService, useValue: {} },
                    { provide: LayoutService, useValue: {} },
                    { provide: LoggerService, useValue: { warn: jasmine.createSpy('warn'), error: jasmine.createSpy('error') } },
                    { provide: UrlService, useValue: { initialParams: params, setQueryParams: jasmine.createSpy('setQueryParams') } },
                ],
            });
        });

        function start(): void {
            const service = TestBed.inject(ForceUrlStateService);
            service.configure({
                loadedForces: () => [],
                selectedUnit: () => null,
                addLoadedForce,
            } as unknown as ForceUrlWorkspace);
            TestBed.runInInjectionContext(() => service.start());
            TestBed.tick();
        }

        async function settle(): Promise<void> {
            await new Promise<void>(resolve => setTimeout(resolve, 0));
        }

        it('blocks interaction before catalog readiness and until the force is added', async () => {
            let finishCatalog!: () => void;
            let finishForce!: (force: Force) => void;
            requireCatalogReady.and.returnValue(new Promise<void>(resolve => { finishCatalog = resolve; }));
            getForce.and.returnValue(new Promise<Force>(resolve => { finishForce = resolve; }));

            start();

            expect(createDialog).toHaveBeenCalledOnceWith(ForceLoadingOverlayComponent, jasmine.objectContaining({
                disableClose: true, hasBackdrop: true, closeOnNavigation: false, autoFocus: 'dialog',
            }));
            const data = createDialog.calls.mostRecent().args[1].data as ForceLoadingOverlayData;
            expect(data.message()).toBe('Preparing force data…');
            expect(getForce).not.toHaveBeenCalled();
            expect(closeDialog).not.toHaveBeenCalled();

            finishCatalog();
            await settle();
            expect(getForce).toHaveBeenCalledOnceWith('force-1', false, jasmine.objectContaining({
                showLoading: false, onMetadata: jasmine.any(Function),
            }));
            expect(data.message()).toBe('Loading force 1 of 1…');
            expect(closeDialog).not.toHaveBeenCalled();

            const options = getForce.calls.mostRecent().args[2] as Parameters<ForcePersistenceService['getForce']>[2];
            options?.onMetadata?.({ instanceId: 'force-1', name: 'Mercenary Knights', factionId: 1, eraId: 2 });
            expect(data.forces()).toEqual([{
                instanceId: 'force-1', name: 'Mercenary Knights', factionId: 1, eraId: 2, status: 'loading',
            }]);

            const force = {} as Force;
            finishForce(force);
            await settle();
            expect(addLoadedForce).toHaveBeenCalledOnceWith(force, 'friendly', true);
            expect(data.forces()[0].status).toBe('loaded');
            expect(closeDialog).toHaveBeenCalledTimes(1);
        });

        it('keeps one dialog open across multiple forces', async () => {
            params.set('instance', 'force-1,enemy:force-2');
            let finishSecond!: () => void;
            getForce.and.callFake((id: string) => id === 'force-1'
                ? Promise.resolve(null)
                : new Promise<void>(resolve => { finishSecond = resolve; }));
            start();
            await settle();

            const data = createDialog.calls.mostRecent().args[1].data as ForceLoadingOverlayData;
            expect(data.message()).toBe('Loading force 2 of 2…');
            expect(data.forces().map(force => [force.instanceId, force.status])).toEqual([
                ['force-1', 'failed'], ['force-2', 'loading'],
            ]);
            expect(createDialog).toHaveBeenCalledTimes(1);
            expect(closeDialog).not.toHaveBeenCalled();
            finishSecond();
            await settle();
            expect(closeDialog).toHaveBeenCalledTimes(1);
        });

        it('covers operation restoration and closes when it completes', async () => {
            params.delete('instance');
            params.set('operation', 'operation-1');
            let finishOperation!: (loaded: boolean) => void;
            loadOperation.and.returnValue(new Promise<boolean>(resolve => { finishOperation = resolve; }));
            start();
            await settle();

            expect(loadOperation).toHaveBeenCalledOnceWith('operation-1', jasmine.objectContaining({
                skipPrompts: true, onForceProgress: jasmine.any(Function),
            }));
            expect(closeDialog).not.toHaveBeenCalled();
            finishOperation(true);
            await settle();
            expect(closeDialog).toHaveBeenCalledTimes(1);
            expect(getForce).not.toHaveBeenCalled();
        });

        it('unblocks the page when a force is missing', async () => {
            start();
            await settle();
            expect(closeDialog).toHaveBeenCalledTimes(1);
        });

        it('closes the loading dialog and reports a catalog failure', async () => {
            requireCatalogReady.and.rejectWith(new Error('Catalog unavailable'));
            start();
            await settle();
            expect(getForce).not.toHaveBeenCalled();
            expect(closeDialog).toHaveBeenCalledTimes(1);
            expect(showError).toHaveBeenCalled();
        });

        it('closes the loading dialog and reports a force restoration failure', async () => {
            getForce.and.rejectWith(new Error('Force unavailable'));
            start();
            await settle();
            expect(closeDialog).toHaveBeenCalledTimes(1);
            expect(showError).toHaveBeenCalled();
        });

        it('does not block ordinary search-only startup', async () => {
            params.delete('instance');
            params.set('q', 'King Crab');
            start();
            catalogReady.set(true);
            TestBed.tick();
            await settle();
            expect(createDialog).not.toHaveBeenCalled();
            expect(requireCatalogReady).not.toHaveBeenCalled();
        });
    });
});
