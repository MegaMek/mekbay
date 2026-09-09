// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Overlay } from '@angular/cdk/overlay';
import { TestBipedMekEntity,TestTankEntity } from '../../../models/entity/testing/test-entities';
import type { CBTForceMember,CBTMekForceMember } from '../../../models/force-member.model';
import type { CBTUnitViewMode } from '../../../models/options.model';
import type { MekTurnPanelSnapshot } from '../../../models/runtime/mek-turn-panel';
import { PageInteractionOverlayComponent } from './page-interaction-overlay.component';
import { CBTAutomationToastService } from '../../../services/cbt-automation-toast.service';
import { DialogsService } from '../../../services/dialogs.service';
import { ForceWorkspaceStateService } from '../../../services/force-workspace-state.service';
import { OptionsService } from '../../../services/options.service';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { ToastService } from '../../../services/toast.service';
import { PageViewerStateService } from '../internal/page-viewer-state.service';

describe('PageInteractionOverlay toolbar visibility', () => {
    it('removes inactive toolbars from the DOM and restores them independently of end-phase controls', () => {
        TestBed.configureTestingModule({
            imports: [PageInteractionOverlayComponent],
            providers: [
                PageViewerStateService,
                { provide: OptionsService, useValue: { options: signal({ cbtUnitViewMode: 'sheet' }) } },
                { provide: DialogsService, useValue: {} },
                { provide: ForceWorkspaceStateService, useValue: {} },
                { provide: Overlay, useValue: {} },
                { provide: OverlayManagerService, useValue: { closeAllManagedOverlays: () => {} } },
                { provide: ToastService, useValue: {} },
                { provide: CBTAutomationToastService, useValue: {
                    setVisibleUnitIds: () => {}, clearVisibleUnitIds: () => {},
                } },
            ],
        });
        const fixture = TestBed.createComponent(PageInteractionOverlayComponent);
        fixture.componentInstance.dirtyPhase = signal(true);
        const element: HTMLElement = fixture.nativeElement;

        for (const mode of ['page', 'fixed']) {
            fixture.componentRef.setInput('mode', mode);
            fixture.componentRef.setInput('showTopRightControls', true);
            fixture.detectChanges();
            expect(element.querySelector('.top-right-controls')).not.toBeNull();
            fixture.componentRef.setInput('showTopRightControls', false);
            fixture.detectChanges();
            expect(element.querySelector('.top-right-controls')).toBeNull();
            expect(element.querySelector('.end-phase-button')).not.toBeNull();
        }

        fixture.componentRef.setInput('showTopRightControls', true);
        TestBed.inject(PageViewerStateService).beginInventoryDialog();
        fixture.detectChanges();
        expect(element.querySelector('.top-right-controls')).toBeNull();
        expect(element.querySelector('.end-phase-button')).toBeNull();
    });
});

describe('PageInteractionOverlay view selection', () => {
    it('writes toolbar changes to the persisted view option and closes overlays', () => {
        const options = signal({ cbtUnitViewMode: 'tactical' as CBTUnitViewMode });
        const setOption = jasmine.createSpy('setOption').and.callFake(
            (_key: string, cbtUnitViewMode: CBTUnitViewMode) => options.set({ cbtUnitViewMode }),
        );
        const closeAllOverlays = jasmine.createSpy('closeAllOverlays');
        const component = Object.create(PageInteractionOverlayComponent.prototype) as PageInteractionOverlayComponent;
        Object.assign(component, { optionsService: { options, setOption }, closeAllOverlays });
        const event = { stopPropagation: jasmine.createSpy('stopPropagation') } as unknown as Event;

        component.toggleUnitView(event);

        expect(setOption).toHaveBeenCalledOnceWith('cbtUnitViewMode', 'sheet');
        expect(options().cbtUnitViewMode).toBe('sheet');
        expect(closeAllOverlays).toHaveBeenCalledTimes(1);
        expect(event.stopPropagation).toHaveBeenCalledTimes(1);

        component.toggleUnitView(event);

        expect(setOption).toHaveBeenCalledWith('cbtUnitViewMode', 'tactical');
        expect(options().cbtUnitViewMode).toBe('tactical');
    });
});

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

    it('keeps the unnumbered automatic-fall icon routed to its explanation panel', async () => {
        const component: PageInteractionOverlayComponent = Object.create(
            PageInteractionOverlayComponent.prototype,
        );
        Object.assign(component as unknown as Record<string, unknown>, {
            notificationSnapshot: () => ({
                pendingEvents: [],
                automaticFallTooltip: [{ label: 'Automatic fall', value: 'Gyro destroyed' }],
            }),
        });
        const openPsrWarning = spyOn(component, 'openPsrWarning');
        const event = {} as Event;

        await component.openNotification({ kind: 'fall', event });

        expect(openPsrWarning).toHaveBeenCalledOnceWith(event);
    });

    it('dispatches End Phase through the admitted V2 member', async () => {
        const dispatch = jasmine.createSpy('dispatchUnitCommand').and.resolveTo({
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
        const dispatch = jasmine.createSpy('dispatchUnitCommand').and.resolveTo({
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
            dispatchUnitCommand: dispatch,
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
            type: 'end-phase',
            policy: 'automatic',
        });
    });

    it('dispatches End Turn with the configured heat policy and surfaces read-only rejection', async () => {
        const dispatch = jasmine.createSpy('dispatchUnitCommand').and.resolveTo({
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
    const force = { dispatchUnitCommand: dispatch };
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
