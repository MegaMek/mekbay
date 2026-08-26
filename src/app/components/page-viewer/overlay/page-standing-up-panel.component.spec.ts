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
    type MekMovementPsrStateV2,
} from '../../../models/runtime/mek-movement-psr-v2';
import { createPristineMekTurnStateV2 } from '../../../models/runtime/mek-turn-state-v2';
import type { MekTurnPanelSnapshot } from '../../../models/runtime/mek-turn-panel';
import type { CBTUnitCommand } from '../../../models/runtime/unit-instance';
import { OptionsService } from '../../../services/options.service';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { ToastService } from '../../../services/toast.service';
import { PAGE_TURN_MEMBER } from './page-turn-summary.util';
import {
    PageStandingUpPanelComponent,
    STANDING_UP_REVIEW_ONLY,
    toggleStandingUpOverlay,
} from './page-standing-up-panel.component';

describe('toggleStandingUpOverlay', () => {
    it('keeps the turn summary open until the standing panel closes', () => {
        const closed = new Subject<void>();
        const overlayManager = {
            has: jasmine.createSpy('has').and.returnValue(false),
            createManagedOverlay: jasmine.createSpy('createManagedOverlay').and.returnValue({ closed }),
            blockCloseUntil: jasmine.createSpy('blockCloseUntil'),
            unblockClose: jasmine.createSpy('unblockClose'),
        } as unknown as OverlayManagerService;
        const member = { id: 'mek-1' } as CBTMekForceMember;
        const overlay = { scrollStrategies: { block: () => ({}) } } as unknown as Overlay;

        toggleStandingUpOverlay(
            member,
            overlayManager,
            Injector.create({ providers: [] }),
            overlay,
        );

        expect(overlayManager.blockCloseUntil).toHaveBeenCalledOnceWith('turnSummary-mek-1');
        closed.next();
        expect(overlayManager.unblockClose).toHaveBeenCalledOnceWith('turnSummary-mek-1');
    });
});

describe('PageStandingUpPanelComponent', () => {
    it('uses the projected TW target and dispatches careful standing through V2', async () => {
        const harness = standingMember();
        const fixture = createComponent(harness.member, false);
        const component = fixture.componentInstance;

        expect(component.targetRoll()).toBe(5);
        expect(component.supportsCarefulStand()).toBeTrue();
        expect(component.modifiersList()).toEqual([]);

        component.setCarefulStand({ target: { checked: true } } as unknown as Event);
        expect(component.targetRoll()).toBe(3);
        expect(component.modifiersList()).toEqual([{ reason: 'Careful stand', modifier: -2 }]);

        await component.resolve('failed');

        expect(harness.dispatch).toHaveBeenCalledOnceWith('mek-1', jasmine.objectContaining({
            type: 'resolve-mek-stand-attempt',
            carefulStand: true,
            evidence: { dice: [1, 1], claimedOutcome: 'failed' },
            expectedRevision: 4,
            commandId: jasmine.any(String),
        }));
        expect(component.lastOutcome()).toBe('failed');
        expect(component.attempts()).toBe(1);
        expect(component.carefulStand()).toBeTrue();
    });

    it('allows only attempt correction in review mode', async () => {
        const harness = standingMember(2);
        const fixture = createComponent(harness.member, true);
        const component = fixture.componentInstance;

        fixture.detectChanges();
        expect(component.reviewOnly).toBeTrue();
        expect(fixture.nativeElement.querySelector('.psr-resolution-actions')).toBeNull();
        expect(fixture.nativeElement.querySelector('.careful-stand')).toBeNull();
        expect(fixture.nativeElement.querySelector('dice-roller')).toBeNull();

        component.setCarefulStand({ target: { checked: true } } as unknown as Event);
        await component.resolve('success');
        expect(harness.dispatch).not.toHaveBeenCalled();

        await component.adjustAttempts(-1);
        expect(harness.dispatch).toHaveBeenCalledOnceWith('mek-1', jasmine.objectContaining({
            type: 'adjust-mek-stand-attempts',
            delta: -1,
        }));
        expect(component.attempts()).toBe(1);
    });
});

function createComponent(member: CBTMekForceMember, reviewOnly: boolean) {
    TestBed.configureTestingModule({
        imports: [PageStandingUpPanelComponent],
        providers: [
            { provide: PAGE_TURN_MEMBER, useValue: member },
            { provide: STANDING_UP_REVIEW_ONLY, useValue: reviewOnly },
            { provide: OptionsService, useValue: { options: () => ({ cbtAutomations: false }) } },
            { provide: ToastService, useValue: { showToast: jasmine.createSpy('showToast') } },
            {
                provide: OverlayManagerService,
                useValue: { closeManagedOverlay: jasmine.createSpy('closeManagedOverlay') },
            },
        ],
    });
    const fixture = TestBed.createComponent(PageStandingUpPanelComponent);
    fixture.detectChanges();
    return fixture;
}

function standingMember(initialAttempts = 0): {
    readonly member: CBTMekForceMember;
    readonly dispatch: jasmine.Spy;
} {
    const changed = new Subject<void>();
    let revision = 4;
    let attempts = initialAttempts;
    let carefulStand = false;
    let current = standingSnapshot(revision, attempts, carefulStand);
    const dispatch = jasmine.createSpy('dispatchMekUnitCommand').and.callFake(async (
        _instanceId: string,
        command: CBTUnitCommand,
    ) => {
        if (command.type === 'resolve-mek-stand-attempt') {
            attempts += 1;
            carefulStand = command.carefulStand;
        } else if (command.type === 'adjust-mek-stand-attempts') {
            attempts = Math.max(0, attempts + command.delta);
            if (command.delta < 0) carefulStand = false;
        }
        revision += 1;
        current = standingSnapshot(revision, attempts, carefulStand);
        return { accepted: true, changed: true, revision };
    });
    const force = {
        changed,
        getMekTurnPanelSnapshot: () => current,
        dispatchMekUnitCommand: dispatch,
    };
    return {
        member: { id: 'mek-1', force } as unknown as CBTMekForceMember,
        dispatch,
    };
}

function standingSnapshot(
    revision: number,
    attempts: number,
    carefulStand: boolean,
): MekTurnPanelSnapshot {
    const movementState: MekMovementPsrStateV2 = {
        ...createPristineMekMovementPsrStateV2(),
        standAttempts: attempts,
        carefulStand,
    };
    return {
        entityUuid: 'entity:mek-1',
        stateRevision: revision,
        movement: {
            kind: 'supported',
            rulesFlavor: 'total-warfare',
            permanentPsrModifiers: [],
            actions: [{ kind: 'get-up', legal: true, reasons: [], warnings: [] }],
            standing: {
                attempts,
                carefulStand,
                movementPointsSpent: carefulStand ? 5 : attempts * 2,
                movementMode: 'walk',
                requiresPilotCheck: true,
                targetNumber: 5,
                standingModifier: 0,
                supportsCarefulStand: true,
                canCarefulStand: true,
                attemptLimit: null,
            },
        },
        movementState,
        activeBoosterComponentIds: [],
        attackMovementModifiers: { stationary: 0, walk: 1, run: 2, jump: 3, UMU: 3 },
        defenseModifierBreakdown: [],
        defenseModifierTotal: { modifier: 0 },
        spottingModifier: 1,
        turn: createPristineMekTurnStateV2(),
        cover: {
            partiallyUnderwater: false,
            submerged: false,
            building: { level: null, modifier: 0 },
        },
        heat: createPristineMekHeatStateV2(),
        heatProjection: { kind: 'unsupported', blockers: ['fixture'] },
        conditions: ['prone'],
    } as unknown as MekTurnPanelSnapshot;
}
