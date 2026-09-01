// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { GameSystem } from '../models/common.model';
import type { Force } from '../models/force.model';
import type { ForceSlot } from '../models/force-slot.model';
import { DialogsService } from './dialogs.service';
import { ForceOperationService, type ForceOperationHost } from './force-operation.service';
import { ForcePersistenceService } from './force-persistence.service';
import { LoggerService } from './logger.service';
import { OperationStorageService } from './operation-storage.service';
import { ToastService } from './toast.service';

describe('ForceOperationService', () => {
    it('owns operation persistence and ordering without forwarding through ForceBuilder', async () => {
        const first = force('force:a', 'Alpha');
        const second = force('force:b', 'Bravo');
        let slots: ForceSlot[] = [slot(first, 'friendly'), slot(second, 'enemy')];
        const saveOperation = jasmine.createSpy('saveOperation').and.resolveTo();
        const saveForce = jasmine.createSpy('saveForce').and.resolveTo();
        const service = TestBed.configureTestingModule({
            providers: [
                ForceOperationService,
                { provide: ForcePersistenceService, useValue: { saveForce } },
                { provide: OperationStorageService, useValue: { saveOperation } },
                {
                    provide: DialogsService,
                    useValue: {
                        createDialog: () => ({
                            closed: of({
                                name: 'Operation One',
                                note: 'test',
                                forces: [
                                    { instanceId: 'force:b', alignment: 'friendly' },
                                    { instanceId: 'force:a', alignment: 'enemy' },
                                ],
                            }),
                        }),
                    },
                },
                { provide: LoggerService, useValue: jasmine.createSpyObj('LoggerService', ['error', 'warn']) },
                { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['showToast']) },
            ],
        }).inject(ForceOperationService);
        service.configure(host(() => slots, next => { slots = next; }));

        expect(service.canSaveOperation()).toBeTrue();
        expect(await service.saveOperation()).toBeTrue();

        expect(slots.map(candidate => candidate.force)).toEqual([second, first]);
        expect(slots.map(candidate => candidate.alignment)).toEqual(['friendly', 'enemy']);
        expect(saveOperation).toHaveBeenCalledTimes(1);
        expect(saveForce).toHaveBeenCalledTimes(2);
        expect(service.currentOperation()).toEqual(jasmine.objectContaining({
            name: 'Operation One', owned: true,
        }));
        expect(service.canSaveOperation()).toBeFalse();
        expect(service.canUpdateOperation()).toBeTrue();
    });
});

function force(instanceId: string, name: string): Force {
    return {
        gameSystem: GameSystem.CBT,
        instanceId: () => instanceId,
        displayName: () => name,
        faction: () => null,
        era: () => null,
        totalBv: () => 1000,
        readOnly: () => false,
        owned: () => true,
        timestamp: '2026-08-13T00:00:00.000Z',
    } as unknown as Force;
}

function slot(forceValue: Force, alignment: 'friendly' | 'enemy'): ForceSlot {
    return { force: forceValue, alignment, changeSub: null };
}

function host(
    loadedForces: () => ForceSlot[],
    setLoadedForces: (slots: ForceSlot[]) => void,
): ForceOperationHost {
    return {
        loadedForces,
        setLoadedForces,
        saveForce: async () => true,
        checkForcesBeforeReplacement: async () => true,
        removeAllForces: async () => true,
        clearLoadedForcesForOperation: async () => true,
        addLoadedForce: () => true,
        loadAllUnits: async () => undefined,
        setUrlInitializationPending: () => undefined,
    };
}
