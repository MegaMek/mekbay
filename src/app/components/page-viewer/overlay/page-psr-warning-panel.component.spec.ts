// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Overlay } from '@angular/cdk/overlay';
import { Subject } from 'rxjs';

import type { CBTMekForceMember } from '../../../models/force-member.model';
import { createPristineMekHeatStateV2 } from '../../../models/runtime/mek-heat-state-v2';
import {
    createPristineMekMovementPsrStateV2,
    type MekPilotCheckV2,
} from '../../../models/runtime/mek-movement-psr-v2';
import { createPristineMekTurnStateV2 } from '../../../models/runtime/mek-turn-state-v2';
import type { MekTurnPanelSnapshot } from '../../../models/runtime/mek-turn-panel';
import { OptionsService } from '../../../services/options.service';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { ToastService } from '../../../services/toast.service';
import { PAGE_TURN_MEMBER } from './page-turn-summary.util';
import {
    PagePsrWarningPanelComponent,
    psrRollOutcome,
    togglePsrWarningOverlay,
} from './page-psr-warning-panel.component';

describe('togglePsrWarningOverlay', () => {
    it('keeps the turn summary open until the PSR panel closes', () => {
        const closed = new Subject<void>();
        const overlayManager = {
            has: jasmine.createSpy('has').and.returnValue(false),
            closeManagedOverlay: jasmine.createSpy('closeManagedOverlay'),
            createManagedOverlay: jasmine.createSpy('createManagedOverlay').and.returnValue({ closed }),
            blockCloseUntil: jasmine.createSpy('blockCloseUntil'),
            unblockClose: jasmine.createSpy('unblockClose'),
        } as unknown as OverlayManagerService;
        const member = { id: 'unit-1' } as CBTMekForceMember;
        const overlay = { scrollStrategies: { block: () => ({}) } } as unknown as Overlay;

        togglePsrWarningOverlay(
            member,
            overlayManager,
            Injector.create({ providers: [] }),
            overlay,
        );

        expect(overlayManager.blockCloseUntil).toHaveBeenCalledOnceWith('turnSummary-unit-1');
        expect(overlayManager.closeManagedOverlay).not.toHaveBeenCalledWith('turnSummary-unit-1');

        closed.next();

        expect(overlayManager.unblockClose).toHaveBeenCalledOnceWith('turnSummary-unit-1');
        expect(overlayManager.closeManagedOverlay).not.toHaveBeenCalledWith('turnSummary-unit-1');
    });
});

describe('psrRollOutcome', () => {
    it('uses the typed pilot-check target as the exact success boundary', () => {
        expect(psrRollOutcome(7, 8)).toBe('failed');
        expect(psrRollOutcome(8, 8)).toBe('success');
        expect(psrRollOutcome(12, 8)).toBe('success');
    });
});

describe('PagePsrWarningPanelComponent', () => {
    it('renders a projected V2 automatic fall with its entity-owned location label', () => {
        const changed = new Subject<void>();
        const locationId = 'location:left-leg';
        const movementState = {
            ...createPristineMekMovementPsrStateV2(),
            automaticFalls: [{
                triggerKind: 'leg-destroyed-auto-fall' as const,
                locationIds: [locationId as never],
            }],
        };
        const snapshot = {
            entityUuid: 'entity:mek-1',
            stateRevision: 1,
            movement: { kind: 'unsupported', blockers: ['fixture'] },
            movementState,
            activeBoosterComponentIds: [],
            locationLabels: { [locationId]: 'Left Leg' },
            turn: createPristineMekTurnStateV2(),
            cover: { partiallyUnderwater: false, submerged: false, building: { level: null, modifier: 0 } },
            heat: createPristineMekHeatStateV2(),
            heatProjection: { kind: 'unsupported', blockers: ['fixture'] },
            conditions: [],
        } as unknown as MekTurnPanelSnapshot;
        const force = { changed, getMekTurnPanelSnapshot: () => snapshot };
        const member = { id: 'mek-1', force } as unknown as CBTMekForceMember;

        TestBed.configureTestingModule({
            imports: [PagePsrWarningPanelComponent],
            providers: [
                { provide: PAGE_TURN_MEMBER, useValue: member },
                { provide: OptionsService, useValue: { cbtAutomationMode: () => 'no' } },
                { provide: ToastService, useValue: { showToast: jasmine.createSpy('showToast') } },
                {
                    provide: OverlayManagerService,
                    useValue: { closeManagedOverlay: jasmine.createSpy('closeManagedOverlay') },
                },
            ],
        });
        const fixture = TestBed.createComponent(PagePsrWarningPanelComponent);
        fixture.detectChanges();

        const automatic = fixture.nativeElement.querySelector('.automatic-failure') as HTMLElement;
        expect(automatic.textContent).toContain('Leg destroyed');
        expect(automatic.textContent).toContain('Left Leg');
        expect(automatic.textContent).toContain('AUTOMATIC FAILURE');
        expect(fixture.nativeElement.querySelector('.psr-target')).toBeNull();
        expect(fixture.nativeElement.querySelector('.psr-resolution-actions')).toBeNull();
    });

    it('keeps non-fall checks actionable while an automatic fall replaces fall checks', async () => {
        const changed = new Subject<void>();
        const fallCheck = pilotCheck('fall-check', 'leg-destroyed', 'Leg destroyed', 7);
        const shutdownCheck = pilotCheck('shutdown-check', 'shutdown', 'Shutdown attempt', 8);
        let current = panelSnapshot({
            automaticFalls: [{
                triggerKind: 'gyro-destroyed',
                locationIds: [],
            }],
            checks: [fallCheck, shutdownCheck],
        });
        const dispatch = jasmine.createSpy('dispatchMekUnitCommand').and.callFake(async () => {
            current = panelSnapshot({
                automaticFalls: current.movementState.automaticFalls,
                checks: [{ ...shutdownCheck, status: 'success', resolution: { dice: [2, 6], total: 8 } }],
                revision: 2,
            });
            return { accepted: true, changed: true, revision: 2 };
        });
        const member = {
            id: 'mek-1',
            force: {
                changed,
                getMekTurnPanelSnapshot: () => current,
                dispatchMekUnitCommand: dispatch,
            },
        } as unknown as CBTMekForceMember;

        TestBed.configureTestingModule({
            imports: [PagePsrWarningPanelComponent],
            providers: [
                { provide: PAGE_TURN_MEMBER, useValue: member },
                { provide: OptionsService, useValue: { cbtAutomationMode: () => 'no' } },
                { provide: ToastService, useValue: { showToast: jasmine.createSpy('showToast') } },
                { provide: OverlayManagerService, useValue: { closeManagedOverlay: jasmine.createSpy('closeManagedOverlay') } },
            ],
        });
        const fixture = TestBed.createComponent(PagePsrWarningPanelComponent);
        fixture.detectChanges();
        const component = fixture.componentInstance;

        expect(component.psrChecks().map(check => check.checkId)).toEqual(['shutdown-check']);
        expect(fixture.nativeElement.textContent).toContain('Shutdown attempt');
        expect(fixture.nativeElement.querySelector('.psr-resolution-actions')).not.toBeNull();

        component.selectOutcome(component.psrChecks()[0]!, 'success');
        fixture.detectChanges();

        expect(dispatch).not.toHaveBeenCalled();
        expect(fixture.nativeElement.querySelector('.psr-result')?.textContent.trim()).toBe('success');

        await component.accept();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(dispatch).toHaveBeenCalledOnceWith('mek-1', jasmine.objectContaining({
            type: 'resolve-mek-pilot-check',
            checkId: 'shutdown-check',
            evidence: { dice: [6, 2], claimedOutcome: 'success' },
        }));
        expect(fixture.nativeElement.querySelector('.psr-result')?.textContent.trim()).toBe('success');
    });

    it('stages rolled dice and cascades later fall checks until ACCEPT', async () => {
        const changed = new Subject<void>();
        const first = pilotCheck('first-fall', 'leg-destroyed', 'First fall check', 7);
        const second = pilotCheck('second-fall', 'leg-destroyed', 'Second fall check', 8);
        let current = panelSnapshot({ automaticFalls: [], checks: [first, second] });
        const dispatch = jasmine.createSpy('dispatchMekUnitCommand').and.callFake(async (
            _instanceId: string,
            command: { readonly checkId: string; readonly evidence: { readonly dice: readonly [number, number] } },
        ) => {
            current = panelSnapshot({
                automaticFalls: [],
                checks: current.movementState.checks.map(check => check.checkId === command.checkId
                    ? {
                        ...check,
                        status: command.evidence.dice[0] + command.evidence.dice[1] >= check.targetNumber
                            ? 'success' as const
                            : 'failed' as const,
                        resolution: {
                            dice: command.evidence.dice,
                            total: command.evidence.dice[0] + command.evidence.dice[1],
                        },
                    }
                    : check),
                revision: current.stateRevision + 1,
            });
            return { accepted: true, changed: true, revision: current.stateRevision };
        });
        const member = {
            id: 'mek-1',
            force: {
                changed,
                getMekTurnPanelSnapshot: () => current,
                dispatchMekUnitCommand: dispatch,
            },
        } as unknown as CBTMekForceMember;
        const closeManagedOverlay = jasmine.createSpy('closeManagedOverlay');
        TestBed.configureTestingModule({
            imports: [PagePsrWarningPanelComponent],
            providers: [
                { provide: PAGE_TURN_MEMBER, useValue: member },
                { provide: OptionsService, useValue: { cbtAutomationMode: () => 'no' } },
                { provide: ToastService, useValue: { showToast: jasmine.createSpy('showToast') } },
                { provide: OverlayManagerService, useValue: { closeManagedOverlay } },
            ],
        });
        const fixture = TestBed.createComponent(PagePsrWarningPanelComponent);
        fixture.detectChanges();
        const component = fixture.componentInstance;

        component.selectOutcome(first, 'failed', [1, 2]);
        fixture.detectChanges();

        expect(dispatch).not.toHaveBeenCalled();
        expect(component.diceFor(first)).toEqual([1, 2]);
        expect(component.isCascadedFailure(second)).toBeTrue();
        expect(fixture.nativeElement.textContent).toContain('FAILED — PREVIOUS FALL CHECK FAILED');
        expect(component.canAccept()).toBeTrue();

        await component.accept();

        expect(dispatch).toHaveBeenCalledTimes(2);
        expect(dispatch.calls.argsFor(0)[1]).toEqual(jasmine.objectContaining({
            checkId: 'first-fall',
            evidence: { dice: [1, 2], claimedOutcome: 'failed' },
        }));
        expect(dispatch.calls.argsFor(1)[1]).toEqual(jasmine.objectContaining({
            checkId: 'second-fall',
            evidence: jasmine.objectContaining({ claimedOutcome: 'failed' }),
        }));
        expect(closeManagedOverlay).toHaveBeenCalledOnceWith('psrWarning-mek-1');
    });
});

function pilotCheck(
    checkId: string,
    triggerKind: 'leg-destroyed' | 'shutdown',
    reason: string,
    targetNumber: number,
): MekPilotCheckV2 {
    return {
        checkId,
        source: {
            sourceKind: triggerKind === 'shutdown' ? 'action' : 'damage',
            triggerKind,
            witness: '{}',
            criticalSlotIds: [],
            locationIds: [],
            baseTarget: targetNumber,
            triggerModifier: 0,
        },
        producingRevision: 1,
        ordinal: 0,
        targetNumber,
        reason,
        status: 'pending' as const,
    };
}

function panelSnapshot(options: {
    readonly automaticFalls: MekTurnPanelSnapshot['movementState']['automaticFalls'];
    readonly checks: MekTurnPanelSnapshot['movementState']['checks'];
    readonly revision?: number;
}): MekTurnPanelSnapshot {
    return {
        entityUuid: 'entity:mek-1',
        stateRevision: options.revision ?? 1,
        movement: { kind: 'unsupported', blockers: ['fixture'] },
        movementState: {
            ...createPristineMekMovementPsrStateV2(),
            automaticFalls: options.automaticFalls,
            checks: options.checks,
        },
        activeBoosterComponentIds: [],
        locationLabels: {},
        turn: createPristineMekTurnStateV2(),
        cover: { partiallyUnderwater: false, submerged: false, building: { level: null, modifier: 0 } },
        heat: createPristineMekHeatStateV2(),
        heatProjection: { kind: 'unsupported', blockers: ['fixture'] },
        conditions: [],
    } as unknown as MekTurnPanelSnapshot;
}
