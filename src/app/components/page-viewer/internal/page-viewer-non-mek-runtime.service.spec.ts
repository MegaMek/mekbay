// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { asCrewPositionId,asLocationId } from '../../../models/entity/entity-identifiers';
import { TestInfantryEntity,TestTankEntity } from '../../../models/entity/testing/test-entities';
import type { CBTForceMember } from '../../../models/force-member.model';
import type { NonMekRecordSheetCrewPosition } from '../../../models/runtime/non-mek-record-sheet';
import { createPristineNonMekUnitState } from '../../../models/runtime/non-mek-unit-instance';
import { DialogsService } from '../../../services/dialogs.service';
import { ForcePilotEditorService } from '../../../services/force-pilot-editor.service';
import { LoggerService } from '../../../services/logger.service';
import { OptionsService } from '../../../services/options.service';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { PickerFactoryService } from '../../../services/picker-factory.service';
import { ToastService } from '../../../services/toast.service';
import { UnitNameService } from '../../../services/unit-name.service';
import { PageViewerZoomPanService } from '../page-viewer-zoom-pan.service';
import { PageViewerNonMekRuntimeService,nonMekCrewStateCommand } from './page-viewer-non-mek-runtime.service';
import { PageViewerOverlayService } from './page-viewer-overlay.service';

describe('PageViewerNonMekRuntimeService ammo loadout navigation', () => {
    it('routes the current sheet ammo interaction to its member and the ammo tab', () => {
        const overlays = jasmine.createSpyObj<PageViewerOverlayService>('PageViewerOverlayService', ['openEquipment']);
        TestBed.configureTestingModule({ providers: [
            PageViewerNonMekRuntimeService,
            { provide: PageViewerOverlayService, useValue: overlays },
            ...[
                DialogsService, ForcePilotEditorService, LoggerService, OptionsService,
                OverlayManagerService, PickerFactoryService, ToastService, UnitNameService, PageViewerZoomPanService,
            ].map(provide => ({ provide, useValue: {} })),
        ] });
        const service = TestBed.inject(PageViewerNonMekRuntimeService);
        const context = { owner: {}, state: createPristineNonMekUnitState(new TestTankEntity()) };
        const member = {
            id: 'tank-1',
            nonMekRecordSheetSnapshot: () => ({ stateRevision: 3, editContext: context }),
        } as unknown as CBTForceMember;
        const event = new MouseEvent('click');

        service.handle(member, { kind: 'open-equipment', tab: 'ammo', context }, event);
        expect(overlays.openEquipment).toHaveBeenCalledOnceWith('tank-1', event, 'ammo');
        service.handle(member, { kind: 'open-equipment', tab: 'ammo', context: { ...context, owner: {} } }, event);
        expect(overlays.openEquipment).toHaveBeenCalledTimes(1);
    });
});

describe('PageViewerNonMekRuntimeService async heat edits', () => {
    function setup(trackPhaseAndTurn: boolean) {
        const closed = new Subject<number>();
        const dialogs = { createDialog: jasmine.createSpy('createDialog').and.returnValue({ closed }) };
        const dispatch = jasmine.createSpy('dispatchUnitCommand').and.resolveTo({ accepted: true, changed: true });
        const context = { owner: {}, state: createPristineNonMekUnitState(new TestTankEntity()) };
        let currentContext = context;
        TestBed.configureTestingModule({ providers: [
            PageViewerNonMekRuntimeService,
            { provide: DialogsService, useValue: dialogs },
            { provide: OptionsService, useValue: { options: () => ({ trackPhaseAndTurn }) } },
            ...[
                PageViewerOverlayService, ForcePilotEditorService, LoggerService,
                OverlayManagerService, PickerFactoryService, ToastService, UnitNameService, PageViewerZoomPanService,
            ].map(provide => ({ provide, useValue: {} })),
        ] });
        const member = {
            id: 'aero-1',
            force: { dispatchUnitCommand: dispatch },
            nonMekRecordSheetSnapshot: () => ({
                editContext: currentContext,
                heat: { tracked: true, current: 0, pending: null },
            }),
        } as unknown as CBTForceMember;
        TestBed.inject(PageViewerNonMekRuntimeService).handle(
            member, { kind: 'heat-overflow', context }, new MouseEvent('click'),
        );
        expect(dialogs.createDialog).toHaveBeenCalledTimes(1);
        return { closed, dispatch, context, replaceOwner: () => { currentContext = { ...context, owner: {} }; } };
    }

    it('keeps pending heat and the source context when a dialog completes', async () => {
        const { closed, dispatch, context } = setup(true);
        closed.next(40);
        await Promise.resolve();
        expect(dispatch).toHaveBeenCalledOnceWith('aero-1', { type: 'set-pending-heat', heat: 40 }, context);
    });

    it('uses committed heat when phase tracking is disabled', async () => {
        const { closed, dispatch, context } = setup(false);
        closed.next(40);
        await Promise.resolve();
        expect(dispatch).toHaveBeenCalledOnceWith('aero-1', { type: 'set-heat', heat: 40 }, context);
    });

    it('discards a dialog result after same-revision owner replacement', async () => {
        const { closed, dispatch, replaceOwner } = setup(true);
        replaceOwner();
        closed.next(40);
        await Promise.resolve();
        expect(dispatch).not.toHaveBeenCalled();
    });
});

describe('PageViewerNonMekRuntimeService aggregate infantry edits', () => {
    function select(maximum: number, committed: number, preview: number, strength: number, pending: boolean) {
        const context = { owner: {}, state: createPristineNonMekUnitState(new TestInfantryEntity()) };
        const dispatch = jasmine.createSpy('dispatchUnitCommand').and.resolveTo({ accepted: true, changed: true, state: context.state });
        TestBed.configureTestingModule({ providers: [
            PageViewerNonMekRuntimeService,
            { provide: OptionsService, useValue: { options: () => ({ trackPhaseAndTurn: pending }) } },
            { provide: ToastService, useValue: { showToast: () => undefined } },
            ...[
                DialogsService, PageViewerOverlayService, ForcePilotEditorService, LoggerService,
                OverlayManagerService, PickerFactoryService, UnitNameService, PageViewerZoomPanService,
            ].map(provide => ({ provide, useValue: {} })),
        ] });
        const locationId = asLocationId('infantry');
        const member = {
            id: 'infantry-1',
            force: { dispatchUnitCommand: dispatch },
            nonMekRecordSheetSnapshot: () => ({
                editContext: context,
                locations: [{ locationId, maximumInternal: maximum, remainingInternal: committed,
                    previewRemainingInternal: preview, code: 'Infantry', armor: [] }],
            }),
        } as unknown as CBTForceMember;
        TestBed.inject(PageViewerNonMekRuntimeService).handle(member, {
            kind: 'infantry-strength', locationId, context,
            strength,
        }, new MouseEvent('click'));
        return { dispatch, context, locationId };
    }

    it('uses committed strength when phase tracking is disabled despite a pending preview', () => {
        const { dispatch, context, locationId } = select(30, 30, 25, 28, false);
        expect(dispatch).toHaveBeenCalledOnceWith('infantry-1', {
            type: 'damage-internal', locationId, amount: 3, target: 'committed',
        }, context);
    });

    it('hits the last committed active point instead of treating the pending preview as already damaged', () => {
        const { dispatch, context, locationId } = select(30, 28, 25, 28, false);
        expect(dispatch).toHaveBeenCalledOnceWith('infantry-1', {
            type: 'damage-internal', locationId, amount: 1, target: 'committed',
        }, context);
    });

    it('uses the pending perspective to repair the same aggregate selection', () => {
        const { dispatch, context, locationId } = select(30, 30, 25, 28, true);
        expect(dispatch).toHaveBeenCalledOnceWith('infantry-1', {
            type: 'repair-internal', locationId, amount: 3, target: 'pending',
        }, context);
    });

    it('can remove one troop at the thirty-troop limit', () => {
        const { dispatch, context, locationId } = select(30, 30, 30, 30, false);
        expect(dispatch).toHaveBeenCalledOnceWith('infantry-1', {
            type: 'damage-internal', locationId, amount: 1, target: 'committed',
        }, context);
    });

    it('can remove the last troop exactly', () => {
        const { dispatch, context, locationId } = select(30, 1, 1, 1, false);
        expect(dispatch).toHaveBeenCalledOnceWith('infantry-1', {
            type: 'damage-internal', locationId, amount: 1, target: 'committed',
        }, context);
    });

    for (const strength of [0, 31, 1.5]) {
        it(`rejects invalid strength selection ${strength}`, () => {
            expect(select(30, 30, 30, strength, false).dispatch).not.toHaveBeenCalled();
        });
    }
});

describe('PageViewerNonMekRuntimeService crew state command', () => {
    it('maps the non-Mek stunned label to canonical unconscious state', () => {
        expect(nonMekCrewStateCommand(
            position('healthy'),
            ['stunned'],
            'stunned',
        )).toEqual({
            type: 'set-crew-state',
            
            positionId: CREW_ID,
            wounds: 0,
            unconscious: true,
            ejected: false,
        });

        expect(nonMekCrewStateCommand(
            position('stunned'),
            ['stunned'],
            'stunned',
        )).toEqual(jasmine.objectContaining({
            unconscious: false,
            ejected: false,
        }));
    });

    it('keeps vehicle killed/stunned controls and rejects display-only states', () => {
        expect(nonMekCrewStateCommand(
            position('healthy'),
            ['killed', 'stunned'],
            'killed',
        )).toEqual(jasmine.objectContaining({ dead: true, unconscious: false }));
        expect(nonMekCrewStateCommand(
            position('dead'),
            ['unconscious'],
            'dead',
        )).toBeNull();
    });
});

const CREW_ID = asCrewPositionId('crew:0');

function position(effectiveState: NonMekRecordSheetCrewPosition['effectiveState']): NonMekRecordSheetCrewPosition {
    return Object.freeze({
        positionId: CREW_ID,
        occurrence: 0,
        name: 'Crew 1',
        gunnery: 4,
        piloting: 5,
        state: Object.freeze({
            wounds: effectiveState === 'dead' || effectiveState === 'killed' ? 6 : 0,
            unconscious: effectiveState === 'unconscious' || effectiveState === 'stunned',
            ejected: false,
            ...(effectiveState === 'dead' || effectiveState === 'killed'
                ? { dead: true as const }
                : {}),
        }),
        effectiveState,
    });
}
