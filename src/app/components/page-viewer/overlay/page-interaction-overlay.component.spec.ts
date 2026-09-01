// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTForceMember, CBTMekForceMember } from '../../../models/force-member.model';
import { TestBipedMekEntity, TestTankEntity } from '../../../models/entity/testing/test-entities';
import type { MekTurnPanelSnapshot } from '../../../models/runtime/mek-turn-panel';
import { PageInteractionOverlayComponent } from './page-interaction-overlay.component';

describe('PageInteractionOverlay turn boundaries', () => {
    it('resumes a notification chain without committing a phase or turn', async () => {
        const resume = jasmine.createSpy('resolvePendingUnitAutomation').and.resolveTo(true);
        const member = {
            id: 'mek-1',
            force: { resolvePendingUnitAutomation: resume },
        } as unknown as CBTMekForceMember;
        const component: PageInteractionOverlayComponent = Object.create(
            PageInteractionOverlayComponent.prototype,
        );
        const closeAllOverlays = jasmine.createSpy('closeAllOverlays');
        Object.assign(component as unknown as Record<string, unknown>, {
            member: () => member,
            turnTrackerVisible: () => true,
            closeAllOverlays,
        });
        const event = { stopPropagation: jasmine.createSpy('stopPropagation') } as unknown as Event;

        await component.openNotification({ kind: 'psr', event });

        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        expect(closeAllOverlays).toHaveBeenCalledTimes(1);
        expect(resume).toHaveBeenCalledOnceWith('mek-1');
    });

    it('dispatches End Phase through the admitted V2 member', async () => {
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
            closeAllOverlays: jasmine.createSpy('closeAllOverlays'),
        });
        const event = { stopPropagation: jasmine.createSpy('stopPropagation') } as unknown as MouseEvent;

        await component.endPhase(event);

        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        expect(dispatch).toHaveBeenCalledOnceWith('tank-1', {
            kind: 'end-phase',
        });
    });

    it('dispatches End Turn with the configured heat policy and surfaces read-only rejection', async () => {
        const dispatch = jasmine.createSpy('dispatchMekUnitCommand').and.resolveTo({
            accepted: false,
            changed: false,
            reason: 'READ_ONLY',
            revision: 12,
        });
        const component = componentForMember(dispatch, 12, true);
        const toast = componentServiceSpy(component, 'toastService', 'showToast');

        await component.endTurn({ stopPropagation: () => undefined } as unknown as MouseEvent);

        expect(dispatch).toHaveBeenCalledOnceWith('mek-1', jasmine.objectContaining({
            type: 'end-turn',
            policy: 'automatic',
        }));
        expect(toast).toHaveBeenCalledOnceWith('This force is read-only.', 'error');
    });
});

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
        closeAllOverlays: jasmine.createSpy('closeAllOverlays'),
    });
    return component;
}

function componentServiceSpy(
    component: PageInteractionOverlayComponent,
    service: 'toastService',
    method: 'showToast',
): jasmine.Spy {
    return ((component as unknown as Record<string, Record<string, jasmine.Spy>>)[service])[method];
}
