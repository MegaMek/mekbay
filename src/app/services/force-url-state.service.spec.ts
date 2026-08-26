// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { ForceMember } from '../models/force-member.model';
import { DataService } from './data.service';
import { DialogsService } from './dialogs.service';
import { ForceOperationService } from './force-operation.service';
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
});
