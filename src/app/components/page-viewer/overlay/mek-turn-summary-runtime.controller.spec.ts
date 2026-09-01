// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { DestroyRef } from '@angular/core';
import { Subject } from 'rxjs';

import type { CBTMekForceMember } from '../../../models/force-member.model';
import { createPristineMekHeatStateV2 } from '../../../models/runtime/mek-heat-state-v2';
import { createPristineMekMovementPsrStateV2 } from '../../../models/runtime/mek-movement-psr-v2';
import { createPristineMekTurnStateV2 } from '../../../models/runtime/mek-turn-state-v2';
import type { MekTurnPanelSnapshot } from '../../../models/runtime/mek-turn-panel';
import type { OptionsService } from '../../../services/options.service';
import type { ToastService } from '../../../services/toast.service';
import { MekTurnSummaryRuntimeController } from './mek-turn-summary-runtime.controller';

function snapshot(revision: number): MekTurnPanelSnapshot {
    return {
        published: {},
        stateRevision: revision,
        movement: { kind: 'unsupported', blockers: ['fixture'] },
        movementState: createPristineMekMovementPsrStateV2(),
        activeBoosterComponentIds: [],
        heat: createPristineMekHeatStateV2(),
        heatProjection: { kind: 'unsupported', blockers: ['fixture'] },
        turn: createPristineMekTurnStateV2(),
        canTakeActiveActions: true,
        conditions: [],
    } as unknown as MekTurnPanelSnapshot;
}

describe('MekTurnSummaryRuntimeController', () => {
    it('captures the admitted member before reading its initial snapshot and follows force changes', () => {
        const changed = new Subject<void>();
        const first = snapshot(0);
        const second = snapshot(1);
        const getSnapshot = jasmine.createSpy('getMekTurnPanelSnapshot').and.returnValues(first, second);
        const force = { changed, getMekTurnPanelSnapshot: getSnapshot };
        const member = { id: 'mek-1', force } as unknown as CBTMekForceMember;
        const destroyRef = {
            onDestroy: (callback: () => void) => {
                return () => callback;
            },
        } as unknown as DestroyRef;
        const options = {
            cbtAutomationMode: () => 'no',
        } as unknown as OptionsService;

        const controller = new MekTurnSummaryRuntimeController(
            member,
            options,
            { showToast: jasmine.createSpy('showToast') } as unknown as ToastService,
            destroyRef,
        );

        expect(controller.member).toBe(member);
        expect(controller.snapshot()).toBe(first);
        expect(controller.currentMovement()).toBeNull();

        changed.next();

        expect(controller.snapshot()).toBe(second);
        expect(getSnapshot).toHaveBeenCalledTimes(2);
    });

    it('hides movement modes with no entity-derived MP and previews zero hexes before one commit', async () => {
        const changed = new Subject<void>();
        const movementState = {
            ...createPristineMekMovementPsrStateV2(),
            movement: {
                schemaVersion: 1,
                mode: 'run',
                distance: 2,
                boosterComponentIds: [],
            },
        };
        const current = {
            ...snapshot(4),
            movement: {
                kind: 'supported',
                actions: [
                    { kind: 'stationary', legal: true, minimumMp: 0, maximumMp: 0, reasons: [], warnings: [] },
                    { kind: 'walk', legal: true, minimumMp: 0, maximumMp: 5, reasons: [], warnings: [] },
                    { kind: 'run', legal: true, minimumMp: 0, maximumMp: 8, reasons: [], warnings: [] },
                    { kind: 'jump', legal: false, minimumMp: 0, maximumMp: 0, reasons: [], warnings: [] },
                    { kind: 'UMU', legal: false, minimumMp: 0, maximumMp: 0, reasons: [], warnings: [] },
                    { kind: 'get-up', legal: false, reasons: [], warnings: [] },
                ],
            },
            movementState,
        } as unknown as MekTurnPanelSnapshot;
        const dispatch = jasmine.createSpy('dispatchMekUnitCommand').and.resolveTo({
            accepted: true,
            changed: true,
            revision: 5,
        });
        const force = {
            changed,
            getMekTurnPanelSnapshot: () => current,
            dispatchMekUnitCommand: dispatch,
        };
        const member = { id: 'mek-1', force } as unknown as CBTMekForceMember;
        const controller = new MekTurnSummaryRuntimeController(
            member,
            { cbtAutomationMode: () => 'no' } as unknown as OptionsService,
            { showToast: jasmine.createSpy('showToast') } as unknown as ToastService,
            { onDestroy: () => () => undefined } as unknown as DestroyRef,
        );

        expect(controller.movementActions().map(action => action.kind))
            .toEqual(['stationary', 'walk', 'run']);
        expect(controller.movementMinimum('run')).toBe(0);
        expect(controller.movementDistance()).toBe(2);

        controller.previewMovementDistance(0);
        expect(controller.movementDistance()).toBe(0);
        expect(dispatch).not.toHaveBeenCalled();

        await controller.setMovementDistance(0);
        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(dispatch.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({
            type: 'declare-mek-movement',
            declaration: jasmine.objectContaining({ mode: 'run', distance: 0 }),
        }));
        expect(controller.movementDistance()).toBe(2);
    });

    it('keeps TW Running Minimum Movement visible after a stand attempt exhausts its effective MP', () => {
        const changed = new Subject<void>();
        const current = {
            ...snapshot(6),
            movement: {
                kind: 'supported',
                actions: [
                    { kind: 'stationary', legal: true, minimumMp: 0, maximumMp: 0, reasons: [], warnings: [] },
                    {
                        kind: 'run', legal: true, minimumMp: 0, maximumMp: 1,
                        ordinaryMaximumMp: 1, reasons: [], warnings: [],
                    },
                ],
                declaration: { legal: true, maximumMp: 0, reasons: [], warnings: [] },
            },
            movementState: {
                ...createPristineMekMovementPsrStateV2(),
                movement: {
                    schemaVersion: 1,
                    mode: 'run',
                    distance: 0,
                    boosterComponentIds: [],
                },
                standAttempts: 1,
            },
        } as unknown as MekTurnPanelSnapshot;
        const force = {
            changed,
            getMekTurnPanelSnapshot: () => current,
        };
        const controller = new MekTurnSummaryRuntimeController(
            { id: 'mek-1', force } as unknown as CBTMekForceMember,
            { cbtAutomationMode: () => 'no' } as unknown as OptionsService,
            { showToast: jasmine.createSpy('showToast') } as unknown as ToastService,
            { onDestroy: () => () => undefined } as unknown as DestroyRef,
        );

        expect(controller.movementActions().map(action => action.kind)).toEqual(['stationary', 'run']);
        expect(controller.movementCapacity('run')).toBe(1);
        expect(controller.movementMaximum('run')).toBe(0);
    });

    it('wires the Run button to the exact active MASC-family component IDs', async () => {
        const changed = new Subject<void>();
        const current = {
            ...snapshot(2),
            activeBoosterComponentIds: ['component:masc', 'component:supercharger'],
            movement: {
                kind: 'supported',
                actions: [{
                    kind: 'run', legal: true, minimumMp: 0, maximumMp: 15,
                    ordinaryMaximumMp: 9, reasons: [], warnings: [],
                }],
            },
        } as unknown as MekTurnPanelSnapshot;
        const dispatch = jasmine.createSpy('dispatchMekUnitCommand').and.resolveTo({
            accepted: true, changed: true, revision: 3,
        });
        const force = {
            changed,
            getMekTurnPanelSnapshot: () => current,
            dispatchMekUnitCommand: dispatch,
        };
        const controller = new MekTurnSummaryRuntimeController(
            { id: 'mek-1', force } as unknown as CBTMekForceMember,
            { cbtAutomationMode: () => 'no' } as unknown as OptionsService,
            { showToast: jasmine.createSpy('showToast') } as unknown as ToastService,
            { onDestroy: () => () => undefined } as unknown as DestroyRef,
        );

        await controller.selectMovement(controller.movementAction('run')!);

        expect(dispatch).toHaveBeenCalledOnceWith('mek-1', jasmine.objectContaining({
            type: 'declare-mek-movement',
            declaration: jasmine.objectContaining({
                mode: 'run',
                boosterComponentIds: ['component:masc', 'component:supercharger'],
            }),
        }));
    });

    it('keeps a now-illegal selected mode visible so the same button can clear it', async () => {
        const changed = new Subject<void>();
        const current = {
            ...snapshot(9),
            movement: {
                kind: 'supported',
                actions: [
                    { kind: 'stationary', legal: true, minimumMp: 0, maximumMp: 0, reasons: [], warnings: [] },
                    { kind: 'walk', legal: true, minimumMp: 0, maximumMp: 3, reasons: [], warnings: [] },
                    {
                        kind: 'jump', legal: false, minimumMp: 0, maximumMp: 0,
                        reasons: [{ code: 'NO_MOVEMENT_POINTS', message: 'No jump MP remains' }], warnings: [],
                    },
                    { kind: 'run', legal: true, minimumMp: 0, maximumMp: 5, reasons: [], warnings: [] },
                    { kind: 'UMU', legal: false, minimumMp: 0, maximumMp: 0, reasons: [], warnings: [] },
                ],
            },
            movementState: {
                ...createPristineMekMovementPsrStateV2(),
                movement: {
                    schemaVersion: 1,
                    mode: 'jump',
                    distance: 1,
                    boosterComponentIds: [],
                },
            },
        } as unknown as MekTurnPanelSnapshot;
        const dispatch = jasmine.createSpy('dispatchMekUnitCommand').and.resolveTo({
            accepted: true, changed: true, revision: 10,
        });
        const force = {
            changed,
            getMekTurnPanelSnapshot: () => current,
            dispatchMekUnitCommand: dispatch,
        };
        const controller = new MekTurnSummaryRuntimeController(
            { id: 'mek-1', force } as unknown as CBTMekForceMember,
            { cbtAutomationMode: () => 'no' } as unknown as OptionsService,
            { showToast: jasmine.createSpy('showToast') } as unknown as ToastService,
            { onDestroy: () => () => undefined } as unknown as DestroyRef,
        );

        const jump = controller.movementAction('jump');
        expect(jump).toBeDefined();
        expect(jump!.legal).toBeFalse();

        await controller.selectMovement(jump!);

        expect(dispatch).toHaveBeenCalledOnceWith('mek-1', jasmine.objectContaining({
            type: 'clear-mek-movement',
        }));
    });

    it('projects turn-summary failure controls and dispatches cover/equipment changes through V2', async () => {
        const changed = new Subject<void>();
        let current = snapshot(7);
        const dispatchUnit = jasmine.createSpy('dispatchMekUnitCommand').and.resolveTo({
            accepted: true, changed: true, revision: 8,
        });
        const dispatchEquipment = jasmine.createSpy('dispatchMekEquipmentChoice').and.resolveTo({
            accepted: true, changed: true,
        });
        const sequenceToken = 'sequence-token' as never;
        const statusToken = 'status-token' as never;
        const force = {
            changed,
            getMekTurnPanelSnapshot: () => current,
            getEquipmentPanelSnapshot: () => ({
                components: [{ componentId: 'component:masc', status: 'available' }],
            }),
            getMekEquipmentInteractions: (surface: string) => {
                expect(surface).toBe('turn-summary');
                return [{
                    instanceId: 'mek-1',
                    componentId: 'component:masc',
                    componentLabel: 'MASC',
                    choices: [
                        {
                            token: sequenceToken,
                            handlerId: 'masc-handler',
                            interactionKind: 'escalating-failure',
                            label: '3+',
                            shortLabel: '3+',
                            failureTarget: 3,
                            active: true,
                            disabled: false,
                        },
                        {
                            token: statusToken,
                            handlerId: 'masc-handler',
                            interactionKind: 'escalating-failure',
                            label: '✖',
                            shortLabel: '✖',
                            active: false,
                            disabled: false,
                        },
                    ],
                }];
            },
            dispatchMekUnitCommand: dispatchUnit,
            dispatchMekEquipmentChoice: dispatchEquipment,
        };
        const member = { id: 'mek-1', force } as unknown as CBTMekForceMember;
        const controller = new MekTurnSummaryRuntimeController(
            member,
            { cbtAutomationMode: () => 'no' } as unknown as OptionsService,
            { showToast: jasmine.createSpy('showToast') } as unknown as ToastService,
            { onDestroy: () => () => undefined } as unknown as DestroyRef,
        );

        const rows = controller.equipmentTrackControlRows();
        expect(rows.length).toBe(1);
        expect(rows[0]).toEqual(jasmine.objectContaining({ label: 'MASC', active: true }));
        expect(rows[0]?.statusChoice?.token).toBe(statusToken);

        await controller.selectCover('heavy');
        expect(dispatchUnit).toHaveBeenCalledWith('mek-1', jasmine.objectContaining({
            type: 'replace-turn-state',
            turn: jasmine.objectContaining({ cover: 'heavy' }),
        }));

        current = { ...current, stateRevision: 8 } as MekTurnPanelSnapshot;
        await controller.selectEquipmentTrackChoice(rows[0]!.sequenceChoices[0]!);
        expect(dispatchEquipment).toHaveBeenCalledOnceWith(sequenceToken);
    });

    it('does not dispatch spotting when the Entity runtime has no active controller', async () => {
        const changed = new Subject<void>();
        let current = { ...snapshot(3), canTakeActiveActions: false } as MekTurnPanelSnapshot;
        const dispatch = jasmine.createSpy('dispatchMekUnitCommand').and.resolveTo({
            accepted: true,
            changed: true,
            revision: 4,
        });
        const force = {
            changed,
            getMekTurnPanelSnapshot: () => current,
            dispatchMekUnitCommand: dispatch,
        };
        const controller = new MekTurnSummaryRuntimeController(
            { id: 'mek-1', force } as unknown as CBTMekForceMember,
            { cbtAutomationMode: () => 'no' } as unknown as OptionsService,
            { showToast: jasmine.createSpy('showToast') } as unknown as ToastService,
            { onDestroy: () => () => undefined } as unknown as DestroyRef,
        );

        await controller.toggleSpotting();
        expect(dispatch).not.toHaveBeenCalled();

        current = { ...current, canTakeActiveActions: true };
        changed.next();
        await controller.toggleSpotting();
        expect(dispatch).toHaveBeenCalledOnceWith('mek-1', jasmine.objectContaining({
            type: 'replace-turn-state',
            turn: jasmine.objectContaining({ spotting: true }),
        }));
    });
});
