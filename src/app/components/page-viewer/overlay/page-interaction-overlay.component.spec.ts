// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { CBTForce, type CBTForceEndTurnAllResult } from '../../../models/cbt-force.model';
import type { CBTForceMember, CBTMekForceMember } from '../../../models/force-member.model';
import { TestBipedMekEntity, TestTankEntity } from '../../../models/entity/testing/test-entities';
import type { MekTurnPanelSnapshot } from '../../../models/runtime/mek-turn-panel';
import { PageInteractionOverlayComponent } from './page-interaction-overlay.component';

describe('PageInteractionOverlay End All owner route', () => {
    it('does not prompt when there is no force owner', async () => {
        const component = componentFor(null, true);

        await component.endTurnForAll();

        expect(componentServiceSpy(component, 'dialogsService', 'requestConfirmation')).not.toHaveBeenCalled();
    });

    it('delegates exactly once and never loops visible legacy units', async () => {
        const legacyEndTurn = jasmine.createSpy('legacyEndTurn');
        const force = forceStub({
            accepted: true,
            changed: true,
            atomic: false,
            results: [],
        }, legacyEndTurn);
        const component = componentFor(force, true);

        await component.endTurnForAll();

        expect(force.endAll).toHaveBeenCalledTimes(1);
        expect(legacyEndTurn).not.toHaveBeenCalled();
    });

    it('does not call the owner when confirmation is declined', async () => {
        const force = forceStub(acceptedResult());

        await componentFor(force, false).endTurnForAll();

        expect(force.endAll).not.toHaveBeenCalled();
    });

    it('surfaces an owner rejection without retrying', async () => {
        const force = forceStub({
            accepted: false,
            changed: false,
            atomic: false,
            results: [{
                instanceId: 'unit:retained-v2-test',
                accepted: false,
                changed: false,
                reason: 'UNSUPPORTED_HEAT_CONTEXT',
            }],
        });
        const component = componentFor(force, true);
        const toast = componentServiceSpy(component, 'toastService', 'showToast');

        await component.endTurnForAll();

        expect(force.endAll).toHaveBeenCalledTimes(1);
        expect(toast).toHaveBeenCalledOnceWith(
            'Could not end turn for all units: unit:retained-v2-test: unsupported heat context.',
            'error',
        );
    });

    it('surfaces an unexpected owner failure without falling back to legacy mutation', async () => {
        const legacyEndTurn = jasmine.createSpy('legacyEndTurn');
        const force = forceStub(acceptedResult(), legacyEndTurn);
        force.endAll.and.rejectWith(new Error('owner failed'));
        const component = componentFor(force, true);
        const toast = componentServiceSpy(component, 'toastService', 'showToast');

        await component.endTurnForAll();

        expect(force.endAll).toHaveBeenCalledTimes(1);
        expect(legacyEndTurn).not.toHaveBeenCalled();
        expect(toast).toHaveBeenCalledOnceWith(
            'Could not end turn for all units: owner failed.',
            'error',
        );
    });
});

describe('PageInteractionOverlay turn boundaries', () => {
    it('dispatches End Phase through the admitted V2 member at the displayed revision', async () => {
        const dispatch = jasmine.createSpy('dispatchMekUnitCommand').and.resolveTo({
            accepted: true,
            changed: true,
            revision: 13,
        });
        const component = componentForMember(dispatch, 12);
        const event = { stopPropagation: jasmine.createSpy('stopPropagation') } as unknown as MouseEvent;

        await component.endPhase(event);

        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        expect(dispatch).toHaveBeenCalledOnceWith('mek-1', jasmine.objectContaining({
            type: 'end-phase',
            expectedRevision: 12,
            commandId: jasmine.any(String),
        }));
    });

    it('commits pending non-Mek Entity damage through the same End Phase button', async () => {
        const dispatch = jasmine.createSpy('dispatchNonMekUnitCommand').and.resolveTo({
            accepted: true,
            changed: true,
            currentRevision: 13,
        });
        const entity = new TestTankEntity();
        const force = {
            getUnitSnapshot: () => ({
                entity,
                state: { stateRevision: 12 },
            }),
            dispatchNonMekUnitCommand: dispatch,
        };
        const member = {
            kind: 'cbt',
            id: 'tank-1',
            force,
            entity,
        } as unknown as CBTForceMember;
        const component = Object.create(PageInteractionOverlayComponent.prototype) as PageInteractionOverlayComponent;
        Object.assign(component as unknown as Record<string, unknown>, {
            member: () => member,
            turn: () => null,
            toastService: { showToast: jasmine.createSpy('showToast') },
        });
        const event = { stopPropagation: jasmine.createSpy('stopPropagation') } as unknown as MouseEvent;

        await component.endPhase(event);

        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        expect(dispatch).toHaveBeenCalledOnceWith('tank-1', {
            kind: 'end-phase',
            expectedRevision: 12,
        });
    });

    it('dispatches End Turn with the configured heat policy and surfaces rejection', async () => {
        const dispatch = jasmine.createSpy('dispatchMekUnitCommand').and.resolveTo({
            accepted: false,
            changed: false,
            reason: 'PENDING_PILOT_CHECKS',
            revision: 12,
        });
        const component = componentForMember(dispatch, 12, true);
        const toast = componentServiceSpy(component, 'toastService', 'showToast');

        await component.endTurn({ stopPropagation: () => undefined } as unknown as MouseEvent);

        expect(dispatch).toHaveBeenCalledOnceWith('mek-1', jasmine.objectContaining({
            type: 'end-turn',
            policy: 'automatic',
            expectedRevision: 12,
            commandId: jasmine.any(String),
        }));
        expect(toast).toHaveBeenCalledOnceWith(
            'Resolve pending Piloting Skill Rolls before ending the turn.',
            'error',
        );
    });
});

function componentFor(force: CBTForce | null, confirmed: boolean): PageInteractionOverlayComponent {
    const component = Object.create(PageInteractionOverlayComponent.prototype) as PageInteractionOverlayComponent;
    Object.assign(component as unknown as Record<string, unknown>, {
        force: () => force,
        dialogsService: {
            requestConfirmation: jasmine.createSpy('requestConfirmation').and.resolveTo(confirmed),
        },
        toastService: {
            showToast: jasmine.createSpy('showToast'),
        },
    });
    return component;
}

function forceStub(
    result: CBTForceEndTurnAllResult,
    legacyEndTurn: jasmine.Spy = jasmine.createSpy('legacyEndTurn'),
): CBTForce & { readonly endAll: jasmine.Spy } {
    const endAll = jasmine.createSpy('endTurnForAllUnits').and.resolveTo(result);
    return Object.assign(Object.create(CBTForce.prototype), {
        endAll,
        endTurnForAllUnits: endAll,
        units: () => [{ endTurn: legacyEndTurn }],
    }) as CBTForce & { readonly endAll: jasmine.Spy };
}

function acceptedResult(): CBTForceEndTurnAllResult {
    return Object.freeze({
        accepted: true,
        changed: true,
        atomic: false,
        results: Object.freeze([]),
    });
}

function componentForMember(
    dispatch: jasmine.Spy,
    revision: number,
    automated = false,
): PageInteractionOverlayComponent {
    const component = Object.create(PageInteractionOverlayComponent.prototype) as PageInteractionOverlayComponent;
    const force = { dispatchMekUnitCommand: dispatch };
    const entity = new TestBipedMekEntity();
    const member = {
        kind: 'cbt',
        id: 'mek-1',
        force,
        entity,
    } as unknown as CBTMekForceMember;
    Object.assign(component as unknown as Record<string, unknown>, {
        member: () => member,
        turn: () => ({ stateRevision: revision } as MekTurnPanelSnapshot),
        optionsService: { cbtAutomationMode: () => automated ? 'yes' : 'no' },
        toastService: { showToast: jasmine.createSpy('showToast') },
    });
    return component;
}

function componentServiceSpy(
    component: PageInteractionOverlayComponent,
    service: 'toastService' | 'dialogsService',
    method: 'showToast' | 'requestConfirmation',
): jasmine.Spy {
    return ((component as unknown as Record<string, Record<string, jasmine.Spy>>)[service])[method];
}
