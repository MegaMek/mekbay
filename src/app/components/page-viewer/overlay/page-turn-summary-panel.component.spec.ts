// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import { Overlay } from '@angular/cdk/overlay';
import { Subject } from 'rxjs';

import type { CBTForceMember, CBTMekForceMember } from '../../../models/force-member.model';
import {
    TestAeroSpaceFighterEntity,
    TestBattleArmorEntity,
    TestTankEntity,
} from '../../../models/entity/testing/test-entities';
import { buildNonMekRuntimeIndex } from '../../../models/runtime/non-mek-runtime-index';
import { createPristineNonMekUnitState } from '../../../models/runtime/non-mek-unit-instance';
import { createPristineMekHeatStateV2 } from '../../../models/runtime/mek-heat-state-v2';
import {
    createPristineMekMovementPsrStateV2,
    type MekMovementModeV2,
} from '../../../models/runtime/mek-movement-psr-v2';
import { createPristineMekTurnStateV2 } from '../../../models/runtime/mek-turn-state-v2';
import type { MekTurnPanelSnapshot } from '../../../models/runtime/mek-turn-panel';
import { OptionsService } from '../../../services/options.service';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { ToastService } from '../../../services/toast.service';
import { STANDING_UP_REVIEW_ONLY } from './page-standing-up-panel.component';
import { PageTurnSummaryPanelComponent } from './page-turn-summary-panel.component';

describe('PageTurnSummaryPanelComponent', () => {
    it('distinguishes Core Immobile from an otherwise stationary-only unit', () => {
        const harness = turnMember(turnSnapshot());
        const fixture = createComponent(harness.member, overlayManager());
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelectorAll('.move-button').length).toBe(1);
        expect(fixture.nativeElement.querySelector('.move-button.stationary-only')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.immobile-status')).toBeNull();

        harness.set(turnSnapshot({ immobile: true }));
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.move-button')).toBeNull();
        expect(fixture.nativeElement.querySelector('.immobile-status')?.textContent.trim())
            .toBe('Unit is immobile');

        harness.set(turnSnapshot({ rulesFlavor: 'total-warfare', immobile: true }));
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.immobile-status')).toBeNull();
        expect(fixture.nativeElement.querySelector('.move-button.stationary-only')).not.toBeNull();

        harness.set(turnSnapshot({ immobile: true, selectedMode: 'run', distance: 5 }));
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.immobile-status')?.textContent.trim())
            .toBe('Unit is immobile');
        expect(Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('.move-button'))
            .map(button => button.textContent?.trim())).toEqual(['', 'Run+2']);
        expect(fixture.nativeElement.querySelector('.move-button.selected')?.textContent.trim()).toBe('Run+2');
        expect(fixture.nativeElement.querySelector('hex-slider')).not.toBeNull();
    });

    it('reviews spent stand-attempt MP without mutating the attempt', () => {
        const manager = overlayManager();
        const harness = turnMember(turnSnapshot({ attempts: 1 }));
        const fixture = createComponent(harness.member, manager);
        const component = fixture.componentInstance;
        const event = { stopPropagation: jasmine.createSpy('stopPropagation') } as unknown as MouseEvent;

        expect(component.standAttempts()).toBe(1);
        expect(component.standAttemptMovementPointsSpent()).toBe(2);

        component.reviewStandAttempts(event);

        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        expect(harness.dispatch).not.toHaveBeenCalled();
        expect(manager.createManagedOverlay).toHaveBeenCalled();
        const portal = manager.createManagedOverlay.calls.mostRecent().args[2];
        expect(portal.injector.get(STANDING_UP_REVIEW_ONLY)).toBeTrue();
        expect(manager.blockCloseUntil).toHaveBeenCalledOnceWith('turnSummary-mek-1');

        manager.closed.next();
        expect(manager.unblockClose).toHaveBeenCalledOnceWith('turnSummary-mek-1');
    });

    it('colors a movement button only when that exact action requires a PSR', () => {
        const base = turnSnapshot({ selectedMode: 'run', distance: 0 });
        if (base.movement.kind !== 'supported') throw new Error('Turn fixture movement must be supported');
        const supportedMovement = base.movement;
        const runWarning = { code: 'MOVEMENT_IMPAIRED' as const, message: 'Movement is impaired' };
        const withRunCheck = (requiresPilotCheck: boolean) => ({
            ...base,
            movement: {
                ...supportedMovement,
                actions: supportedMovement.actions.map(action => action.kind === 'run'
                    ? {
                        ...action,
                        legal: true,
                        maximumMp: 2,
                        warnings: [runWarning],
                        requiresPilotCheck,
                    }
                    : action),
            },
        }) as MekTurnPanelSnapshot;
        const harness = turnMember(withRunCheck(false));
        const fixture = createComponent(harness.member, overlayManager());
        fixture.detectChanges();

        const runButton = () => Array.from<HTMLElement>(
            fixture.nativeElement.querySelectorAll('.move-button'),
        ).find(button => button.textContent?.includes('Run'))!;
        expect(runButton().classList.contains('danger')).toBeFalse();

        harness.set(withRunCheck(true));
        fixture.detectChanges();
        expect(runButton().classList.contains('danger')).toBeTrue();
    });

    it('uses the shared turn panel for direct vehicle Entity movement', () => {
        const manager = overlayManager();
        const harness = entityTurnMember();
        const fixture = createComponent(harness.member, manager);
        fixture.detectChanges();

        const labels = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('.move-button'))
            .map(button => button.textContent?.replace(/\s+/gu, ' ').trim())
            .filter(Boolean);
        expect(labels).toEqual(['Cruise+1', 'Flank+2']);
        expect(fixture.nativeElement.querySelector('.spotting-button')).toBeNull();
        expect(fixture.nativeElement.querySelector('.cover-control')).toBeNull();
        expect(fixture.nativeElement.querySelector('[aria-label="Defense"]')).not.toBeNull();

        fixture.componentInstance.selectMove('walk');

        expect(harness.dispatch).toHaveBeenCalledOnceWith('tank-1', {
            kind: 'set-movement',
            expectedRevision: 0,
            movement: { mode: 'walk', distance: 0, boosterComponentIds: [] },
        });
    });

    it('uses Entity movement capacity and the Battle Armor defense modifier', () => {
        const harness = battleArmorTurnMember();
        const fixture = createComponent(harness.member, overlayManager());
        fixture.detectChanges();
        const component = fixture.componentInstance;

        expect(component.moveCapacity()).toBe(3);
        expect(component.moveMin()).toBe(1);
        expect(component.moveMax()).toBe(3);
        expect(component.getTotalTargetModifierAsDefender()).toBe('+1');
        expect(component.defenseTargetModifierTooltip()).toContain(
            jasmine.objectContaining({ label: 'Battle Armor', value: '+1' }),
        );
    });

    it('shows direct aerospace heat state in the shared turn panel', () => {
        const harness = aeroTurnMember();
        const fixture = createComponent(harness.member, overlayManager());
        fixture.detectChanges();
        const text = (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/gu, ' ') ?? '';

        expect(fixture.componentInstance.tracksHeat()).toBeTrue();
        expect(text).toContain('Current:8');
        expect(text).toContain('Target:19');
        expect(text).toContain('Heat sinks off:2');
        expect(text).toContain('Dissipation:16');
    });
});

function createComponent(member: CBTForceMember, manager: ReturnType<typeof overlayManager>) {
    TestBed.configureTestingModule({
        imports: [PageTurnSummaryPanelComponent],
        providers: [
            { provide: OptionsService, useValue: { options: () => ({ cbtAutomations: false, trackPhaseAndTurn: true }) } },
            { provide: ToastService, useValue: { showToast: jasmine.createSpy('showToast') } },
            { provide: OverlayManagerService, useValue: manager },
            { provide: Overlay, useValue: { scrollStrategies: { block: () => ({}) } } },
        ],
    });
    const fixture = TestBed.createComponent(PageTurnSummaryPanelComponent);
    fixture.componentRef.setInput('member', member);
    return fixture;
}

function entityTurnMember() {
    const changed = new Subject<void>();
    const entity = new TestTankEntity();
    entity.setTonnage(40);
    entity.originalWalkMP.set(4);
    const snapshot = {
        instanceId: 'tank-1',
        entity,
        index: buildNonMekRuntimeIndex(entity),
        sourceRef: {},
        ruleset: 'core-2026',
        state: createPristineNonMekUnitState(entity),
    };
    const dispatch = jasmine.createSpy('dispatchNonMekUnitCommand').and.resolveTo({
        accepted: true,
        changed: true,
        state: snapshot.state,
    });
    const force = {
        changed,
        getUnitSnapshot: () => snapshot,
        hasRuntimeHistoryForUnitTurn: () => false,
        dispatchNonMekUnitCommand: dispatch,
    };
    return {
        member: {
            kind: 'cbt',
            id: 'tank-1',
            summary: {
                entityType: 'Tank',
                type: 'Tank',
                subtype: 'Combat Vehicle',
                moveType: 'Tracked',
            },
            force,
        } as unknown as CBTForceMember,
        dispatch,
    };
}

function battleArmorTurnMember() {
    const changed = new Subject<void>();
    const entity = new TestBattleArmorEntity();
    entity.originalWalkMP.set(1);
    entity.propulsionMP.set(3);
    entity.motiveType.set('Jump');
    const pristine = createPristineNonMekUnitState(entity);
    const state = {
        ...pristine,
        turn: {
            ...pristine.turn,
            movement: { mode: 'jump' as const, distance: 1, boosterComponentIds: [] },
        },
    };
    const snapshot = {
        instanceId: 'battle-armor-1',
        entity,
        index: buildNonMekRuntimeIndex(entity),
        sourceRef: {},
        ruleset: 'core-2026' as const,
        state,
    };
    const force = {
        changed,
        getUnitSnapshot: () => snapshot,
        hasRuntimeHistoryForUnitTurn: () => false,
        dispatchNonMekUnitCommand: jasmine.createSpy('dispatchNonMekUnitCommand'),
    };
    return {
        member: {
            kind: 'cbt',
            id: 'battle-armor-1',
            summary: {
                entityType: 'BattleArmor',
                type: 'Infantry',
                subtype: 'Battle Armor',
                moveType: 'Jump',
            },
            force,
        } as unknown as CBTForceMember,
    };
}

function aeroTurnMember() {
    const changed = new Subject<void>();
    const entity = new TestAeroSpaceFighterEntity();
    entity.structuralIntegrity.set(8);
    entity.heatSinkCount.set(10);
    entity.heatSinkType.set('Double');
    const pristine = createPristineNonMekUnitState(entity);
    const snapshot = {
        instanceId: 'aero-1',
        entity,
        index: buildNonMekRuntimeIndex(entity),
        sourceRef: {},
        ruleset: 'core-2026' as const,
        state: {
            ...pristine,
            heat: { current: 8, previous: 0, pendingOverride: 19, heatsinksOff: 2 },
        },
    };
    const force = {
        changed,
        getUnitSnapshot: () => snapshot,
        hasRuntimeHistoryForUnitTurn: () => false,
        dispatchNonMekUnitCommand: jasmine.createSpy('dispatchNonMekUnitCommand'),
    };
    return {
        member: {
            kind: 'cbt',
            id: 'aero-1',
            summary: {
                entityType: 'Aero',
                type: 'Aerospace Fighter',
                subtype: 'Aerospace Fighter',
                moveType: 'Aerodyne',
            },
            force,
        } as unknown as CBTForceMember,
    };
}

function overlayManager() {
    const closed = new Subject<void>();
    return {
        closed,
        has: jasmine.createSpy('has').and.returnValue(false),
        createManagedOverlay: jasmine.createSpy('createManagedOverlay').and.returnValue({ closed }),
        closeManagedOverlay: jasmine.createSpy('closeManagedOverlay'),
        blockCloseUntil: jasmine.createSpy('blockCloseUntil'),
        unblockClose: jasmine.createSpy('unblockClose'),
    };
}

function turnMember(initial: MekTurnPanelSnapshot) {
    const changed = new Subject<void>();
    let current = initial;
    const dispatch = jasmine.createSpy('dispatchMekUnitCommand').and.resolveTo({
        accepted: true,
        changed: false,
        revision: current.stateRevision,
    });
    const force = {
        changed,
        getMekTurnPanelSnapshot: () => current,
        getEquipmentPanelSnapshot: () => ({ components: [] }),
        getMekEquipmentInteractions: () => [],
        dispatchMekUnitCommand: dispatch,
    };
    return {
        member: {
            kind: 'cbt',
            id: 'mek-1',
            summary: { entityType: 'Mek', type: 'Mek', subtype: 'BattleMek', moveType: 'Biped' },
            force,
        } as unknown as CBTMekForceMember,
        dispatch,
        set: (snapshot: MekTurnPanelSnapshot) => {
            current = snapshot;
            changed.next();
        },
    };
}

function turnSnapshot(options: {
    readonly rulesFlavor?: 'core-2026' | 'total-warfare';
    readonly immobile?: boolean;
    readonly selectedMode?: MekMovementModeV2;
    readonly distance?: number;
    readonly attempts?: number;
} = {}): MekTurnPanelSnapshot {
    const rulesFlavor = options.rulesFlavor ?? 'core-2026';
    const attempts = options.attempts ?? 0;
    const movement = options.selectedMode === undefined ? null : {
        schemaVersion: 1 as const,
        mode: options.selectedMode,
        distance: options.distance ?? 0,
        boosterComponentIds: [],
    };
    const actions = [
        { kind: 'stationary' as const, legal: true, minimumMp: 0, maximumMp: 0, reasons: [], warnings: [] },
        ...(options.selectedMode === 'run'
            ? [{ kind: 'run' as const, legal: false, minimumMp: 0, maximumMp: 0, reasons: [], warnings: [] }]
            : []),
        ...(attempts > 0
            ? [{ kind: 'get-up' as const, legal: true, reasons: [], warnings: [] }]
            : []),
    ];
    return {
        entityUuid: 'entity:mek-1',
        stateRevision: 1,
        movement: {
            kind: 'supported',
            rulesFlavor,
            immobile: options.immobile ?? false,
            actions,
            permanentPsrModifiers: [],
            standing: {
                attempts,
                carefulStand: false,
                movementPointsSpent: attempts * 2,
                movementMode: 'walk',
                requiresPilotCheck: true,
                targetNumber: 7,
                standingModifier: rulesFlavor === 'core-2026' ? -1 : 0,
                supportsCarefulStand: rulesFlavor === 'total-warfare',
                canCarefulStand: rulesFlavor === 'total-warfare',
                attemptLimit: null,
            },
        },
        movementState: {
            ...createPristineMekMovementPsrStateV2(),
            movement,
            standAttempts: attempts,
        },
        activeBoosterComponentIds: [],
        attackMovementModifiers: { stationary: 0, walk: 1, run: 2, jump: 3, UMU: 3 },
        defenseModifierBreakdown: [],
        defenseModifierTotal: { modifier: 0 },
        spottingModifier: 1,
        turn: createPristineMekTurnStateV2(),
        cover: { partiallyUnderwater: false, submerged: false, building: { level: null, modifier: 0 } },
        heat: createPristineMekHeatStateV2(),
        heatProjection: { kind: 'unsupported', blockers: ['fixture'] },
        conditions: attempts > 0 ? ['prone'] : [],
    } as unknown as MekTurnPanelSnapshot;
}
