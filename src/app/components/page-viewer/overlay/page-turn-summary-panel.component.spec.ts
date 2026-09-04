// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import { Overlay } from '@angular/cdk/overlay';
import { Subject } from 'rxjs';

import type { CBTForceMember, CBTMekForceMember } from '../../../models/force-member.model';
import {
    TestAeroSpaceFighterEntity,
    TestBattleArmorEntity,
    TestBipedMekEntity,
    TestTankEntity,
} from '../../../models/entity/testing/test-entities';
import { buildNonMekRuntimeIndex } from '../../../models/runtime/non-mek-runtime-index';
import { componentIdForMount } from '../../../models/runtime/non-mek-runtime-index';
import {
    createPristineNonMekUnitState,
    projectNonMekEscalatingFailureInteractions,
} from '../../../models/runtime/non-mek-unit-instance';
import { ESCALATING_FAILURE_HANDLER_ID } from '../../../models/runtime/component-escalating-failure';
import { addTestEquipmentWithFlags } from '../../../models/entity/testing/test-mounted-equipment';
import {
    createPristineMekHeatStateV2,
    type MekHeatSourceV2,
} from '../../../models/runtime/mek-heat-state-v2';
import {
    createPristineMekMovementPsrStateV2,
    type MekMovementModeV2,
} from '../../../models/runtime/mek-movement-psr-v2';
import { createPristineMekTurnStateV2 } from '../../../models/runtime/mek-turn-state-v2';
import type { MekTurnPanelSnapshot } from '../../../models/runtime/mek-turn-panel';
import { OptionsService } from '../../../services/options.service';
import { DialogsService } from '../../../services/dialogs.service';
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
            .map(button => button.textContent?.replace(/\s+/gu, ' ').trim())).toEqual(['', 'Run+2']);
        expect(fixture.nativeElement.querySelector('.move-button.selected')?.textContent.replace(/\s+/gu, ' ').trim())
            .toBe('Run+2');
        expect(fixture.nativeElement.querySelector('.move-allowance')).toBeNull();
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

    it('marks a movement row as crowded when more than four modes are visible', () => {
        const base = turnSnapshot();
        if (base.movement.kind !== 'supported') throw new Error('Turn fixture movement must be supported');
        const template = base.movement.actions[0];
        const crowded = {
            ...base,
            movement: {
                ...base.movement,
                actions: (['stationary', 'walk', 'run', 'sprint', 'jump'] as const).map(kind => ({
                    ...template,
                    kind,
                    legal: true,
                    minimumMp: 0,
                    maximumMp: kind === 'stationary' ? 0 : 5,
                })),
            },
        } as MekTurnPanelSnapshot;
        const fixture = createComponent(turnMember(crowded).member, overlayManager());

        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.move-mode-row.crowded')).not.toBeNull();
        expect(fixture.nativeElement.querySelectorAll('.move-mode-row .move-button').length).toBe(5);
    });

    it('shows the current and all-unit phase/turn scopes only while they are actionable', () => {
        const harness = turnMember(turnSnapshot(), 2);
        const fixture = createComponent(harness.member, overlayManager());
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.phase-actions')).toBeNull();
        expect(fixture.nativeElement.querySelectorAll('.turn-actions button').length).toBe(0);

        const dirty = turnSnapshot({ selectedMode: 'run', distance: 2 });
        harness.set({
            ...dirty,
            hasPendingCombat: true,
            hasPendingPhaseChanges: true,
            movementState: {
                ...dirty.movementState,
                damageThisPhase: 1,
            },
        } as MekTurnPanelSnapshot);
        fixture.detectChanges();

        const phaseActions = Array.from<HTMLButtonElement>(
            fixture.nativeElement.querySelectorAll('.phase-actions button'),
        );
        const turnActions = Array.from<HTMLButtonElement>(
            fixture.nativeElement.querySelectorAll('.turn-actions button'),
        );
        expect(phaseActions.map(button => button.textContent?.trim())).toEqual([
            'End Phase',
            'All Units',
        ]);
        expect(turnActions.map(button => button.textContent?.trim())).toEqual([
            'End Turn',
            'All Units',
        ]);
        expect([...phaseActions, ...turnActions].every(button =>
            button.querySelector('.turn-action-icon') !== null)).toBeTrue();
    });

    it('keeps End Turn actionable while a cancelled workflow is resumable', () => {
        const harness = turnMember(turnSnapshot());
        const fixture = createComponent(harness.member, overlayManager());
        fixture.detectChanges();

        harness.setPendingEndTurn(true);
        fixture.detectChanges();

        const turnActions = Array.from<HTMLButtonElement>(
            fixture.nativeElement.querySelectorAll('.turn-actions button'),
        );
        expect(turnActions.map(button => button.textContent?.trim())).toEqual([
            'End Turn',
        ]);
    });

    it('shows End Turn for an otherwise idle immobile Core 2026 unit', () => {
        const harness = turnMember(turnSnapshot({ immobile: true }));
        const fixture = createComponent(harness.member, overlayManager());
        fixture.detectChanges();

        const turnActions = Array.from<HTMLButtonElement>(
            fixture.nativeElement.querySelectorAll('.turn-actions button'),
        );
        expect(turnActions.map(button => button.textContent?.trim())).toEqual(['End Turn']);
    });

    it('dispatches selected and force-wide phase boundaries through the V2 owner', async () => {
        const base = turnSnapshot({ selectedMode: 'run', distance: 2 });
        const harness = turnMember({
            ...base,
            hasPendingCombat: true,
            hasPendingPhaseChanges: true,
            movementState: { ...base.movementState, damageThisPhase: 1 },
        } as MekTurnPanelSnapshot);
        const manager = overlayManager();
        const fixture = createComponent(harness.member, manager);
        fixture.detectChanges();
        const event = jasmine.createSpyObj<MouseEvent>('event', ['stopPropagation']);

        await fixture.componentInstance.endPhase(event);

        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        expect(harness.dispatch).toHaveBeenCalledOnceWith('mek-1', jasmine.objectContaining({
            type: 'end-phase',
        }));
        expect(manager.closeManagedOverlay).toHaveBeenCalledWith('turnSummary-mek-1');

        harness.dispatch.calls.reset();
        manager.closeManagedOverlay.calls.reset();
        const dialogs = TestBed.inject(DialogsService) as jasmine.SpyObj<DialogsService>;
        await fixture.componentInstance.endPhaseForAll(event);

        expect(dialogs.requestConfirmation).toHaveBeenCalledWith(
            'Are you sure you want to end the phase for all units?',
            'End Phase',
            'info',
        );
        expect(manager.blockCloseUntil).toHaveBeenCalledWith('turnSummary-mek-1');
        expect(manager.unblockClose).toHaveBeenCalledWith('turnSummary-mek-1');
        expect(manager.closeManagedOverlay).toHaveBeenCalledWith('turnSummary-mek-1');
        expect(harness.member.force.endPhaseForAllUnits).toHaveBeenCalledTimes(1);
    });

    it('keeps the Mek PSR modifier breakdown in the turn-summary overlay', () => {
        const base = turnSnapshot();
        if (base.movement.kind !== 'supported') throw new Error('Turn fixture movement must be supported');
        const withPsrModifier = {
            ...base,
            movement: {
                ...base.movement,
                permanentPsrModifiers: [{ modifier: 1, reason: 'Torso-mounted cockpit' }],
            },
        } as MekTurnPanelSnapshot;
        const fixture = createComponent(turnMember(withPsrModifier).member, overlayManager());
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.control-roll-section')?.textContent)
            .toContain('Torso-mounted cockpit');
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
        expect(fixture.nativeElement.querySelector('.spotting-button')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.cover-control')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('[aria-label="Defense"]')).not.toBeNull();

        fixture.componentInstance.toggleSpotting();
        expect(harness.dispatch).toHaveBeenCalledOnceWith('tank-1', {
            kind: 'set-spotting',
            spotting: true,
        });
        harness.dispatch.calls.reset();

        fixture.componentInstance.selectCover('heavy');
        expect(harness.dispatch).toHaveBeenCalledOnceWith('tank-1', {
            kind: 'set-cover',
            cover: 'heavy',
        });
        harness.dispatch.calls.reset();

        fixture.componentInstance.selectMove('walk');

        expect(harness.dispatch).toHaveBeenCalledOnceWith('tank-1', {
            kind: 'set-movement',
            movement: { mode: 'walk', distance: 0, boosterComponentIds: [] },
        });
    });

    it('renders and dispatches origin/next escalating-equipment controls for non-Meks', () => {
        const harness = entityTurnMember([], true);
        const fixture = createComponent(harness.member, overlayManager());
        fixture.detectChanges();

        const row = fixture.nativeElement.querySelector('.equipment-track-row') as HTMLElement;
        expect(row.querySelector('.equipment-track-label')?.textContent?.trim())
            .toBe('Test F_MASC:S_SUPERCHARGER');
        const buttons = Array.from<HTMLButtonElement>(row.querySelectorAll('.equipment-track-button'));
        expect(buttons.map(button => button.textContent?.trim())).toEqual([
            '3+', '5+', '7+', '10+', '11+', '✖',
        ]);

        buttons[0]!.click();

        expect(harness.dispatchEquipmentChoice).toHaveBeenCalledOnceWith({
            instanceId: 'tank-1',
            entityUuid: harness.member.entity.uuid(),
            componentId: harness.boosterComponentId,
            handlerId: ESCALATING_FAILURE_HANDLER_ID,
            value: 0,
        });
    });

    it('uses origin/next DSR labels and Entity-derived vehicle control modifiers', () => {
        const harness = entityTurnMember(['commander_hit', 'motive_system_hit_2']);
        const fixture = createComponent(harness.member, overlayManager());
        fixture.detectChanges();
        const component = fixture.componentInstance;

        expect(component.controlRollShortLabel()).toBe('DSR');
        expect(component.controlRollFullLabel()).toBe('Driving Skill Rolls');
        expect(component.psrModifiers()).toEqual([
            { modifier: 1, reason: 'Commander hit' },
            { modifier: 2, reason: 'Motive system hit' },
        ]);
        const section = Array.from<HTMLElement>(
            fixture.nativeElement.querySelectorAll('.summary-section'),
        ).find(candidate => candidate.querySelector('.section-title')?.textContent?.trim()
            === 'DSR Modifiers');
        expect(section?.textContent?.replace(/\s+/gu, ' ').trim())
            .toContain('Commander hit +1');
        expect(section?.textContent?.replace(/\s+/gu, ' ').trim())
            .toContain('Motive system hit +2');
    });

    it('uses Entity movement capacity and the Battle Armor defense modifier', () => {
        const harness = battleArmorTurnMember();
        const fixture = createComponent(harness.member, overlayManager());
        fixture.detectChanges();
        const component = fixture.componentInstance;

        expect(component.moveCapacity()).toBe(3);
        expect(component.moveMin()).toBe(1);
        expect(component.moveMax()).toBe(3);
        expect(component.getTotalTargetModifierAsDefender()).toBe('+2');
        expect(component.defenseTargetModifierTooltip()).toContain(
            jasmine.objectContaining({ label: 'Jumped', value: '+1' }),
        );
        expect(component.defenseTargetModifierTooltip()).toContain(
            jasmine.objectContaining({ label: 'Battle Armor', value: '+1' }),
        );
    });

    it('shows direct aerospace heat as the same contextual source rows as origin/next', () => {
        const harness = aeroTurnMember();
        const fixture = createComponent(harness.member, overlayManager());
        fixture.detectChanges();
        const text = (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/gu, ' ') ?? '';

        expect(fixture.componentInstance.tracksHeat()).toBeTrue();
        expect(text).toContain('Weapons: +7');
        expect(text).not.toContain('Current:');
        expect(text).not.toContain('Dissipation:');
    });

    it('shows contextual Mek heat with detailed equipment sources only when nonzero', () => {
        const projected = (sources: readonly MekHeatSourceV2[]): MekTurnPanelSnapshot => ({
            ...turnSnapshot(),
            heatProjection: {
                kind: 'supported',
                projection: {
                    current: 0,
                    sources,
                    committedSources: sources,
                    capacity: 10,
                    underwaterBonus: 0,
                    previouslyConsumedDissipation: 0,
                    remainingDissipation: 10,
                    generated: sources.reduce((total, source) => total + source.value, 0),
                    dissipated: 0,
                    projected: sources.reduce((total, source) => total + source.value, 0),
                    delta: sources.reduce((total, source) => total + source.value, 0),
                    hasPendingResolution: sources.some(source => source.value !== 0),
                    hasPendingSettlement: sources.some(source => source.value !== 0),
                },
            },
        } as MekTurnPanelSnapshot);
        const harness = turnMember(projected([
            { id: 'movement', label: 'Movement', value: 0 },
        ]));
        const fixture = createComponent(harness.member, overlayManager());
        fixture.detectChanges();
        const heatTitle = () => Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('.section-title'))
            .find(title => title.textContent?.trim() === 'Heat');

        expect(heatTitle()).toBeUndefined();

        harness.set(projected([
            { id: 'stealth', label: 'Stealth', value: 10, group: 'Equipment' },
            { id: 'nova', label: 'Nova CEWS', value: 2, group: 'Equipment' },
        ]));
        fixture.detectChanges();
        const text = heatTitle()?.parentElement?.textContent?.replace(/\s+/gu, ' ') ?? '';
        expect(text).toContain('Stealth: +10');
        expect(text).toContain('Nova CEWS: +2');
        expect(text).not.toContain('Equipment');
    });
});

function createComponent(member: CBTForceMember, manager: ReturnType<typeof overlayManager>) {
    TestBed.configureTestingModule({
        imports: [PageTurnSummaryPanelComponent],
        providers: [
            { provide: OptionsService, useValue: {
                options: () => ({ trackPhaseAndTurn: true }),
                cbtAutomationMode: () => 'no',
            } },
            { provide: ToastService, useValue: { showToast: jasmine.createSpy('showToast') } },
            { provide: DialogsService, useValue: {
                requestConfirmation: jasmine.createSpy('requestConfirmation').and.resolveTo(true),
            } },
            { provide: OverlayManagerService, useValue: manager },
            { provide: Overlay, useValue: { scrollStrategies: { block: () => ({}) } } },
        ],
    });
    const fixture = TestBed.createComponent(PageTurnSummaryPanelComponent);
    fixture.componentRef.setInput('member', member);
    return fixture;
}

function entityTurnMember(
    damageTrackSheetIds: readonly string[] = [],
    withSupercharger = false,
) {
    const changed = new Subject<void>();
    const entity = new TestTankEntity();
    entity.setTonnage(40);
    entity.originalWalkMP.set(4);
    const boosterComponentId = withSupercharger
        ? componentIdForMount(addTestEquipmentWithFlags(
            entity,
            ['F_MASC', 'S_SUPERCHARGER'],
            { location: entity.locationOrder[0] },
        ))
        : undefined;
    const index = buildNonMekRuntimeIndex(entity);
    const pristine = createPristineNonMekUnitState(entity);
    const damageTracks = new Map(pristine.damageTracks);
    for (const sheetId of damageTrackSheetIds) {
        const track = [...index.damageTracks.values()].find(candidate => candidate.sheetId === sheetId);
        if (!track) throw new Error(`Missing test vehicle damage track ${sheetId}`);
        damageTracks.set(track.id, { hits: 1, hitTimestamps: [damageTracks.size + 1] });
    }
    const snapshot = {
        instanceId: 'tank-1',
        entity,
        index,
        sourceRef: {},
        ruleset: 'core-2026' as const,
        state: { ...pristine, damageTracks },
        query: { hasPendingPhaseChanges: () => false },
    };
    const dispatch = jasmine.createSpy('dispatchNonMekUnitCommand').and.resolveTo({
        accepted: true,
        changed: true,
        state: snapshot.state,
    });
    const dispatchEquipmentChoice = jasmine.createSpy('dispatchEquipmentChoice').and.resolveTo({
        accepted: true,
        changed: true,
    });
    let member!: CBTForceMember;
    const force = {
        changed,
        sessionChanged: new Subject<void>(),
        members: () => [member],
        getUnitSnapshot: () => snapshot,
        getEquipmentPanelSnapshot: () => ({ components: [], physicalAttacks: [] }),
        getEquipmentInteractions: (_instanceId: string, choiceSurface?: 'inventory' | 'turn-summary') =>
            projectNonMekEscalatingFailureInteractions(
                entity,
                index,
                snapshot.state,
                snapshot.ruleset,
                choiceSurface,
            ).map(interaction => ({
                componentId: interaction.componentId,
                componentLabel: interaction.componentLabel,
                choices: interaction.choices.map(choice => ({
                    ...choice,
                    command: {
                        instanceId: 'tank-1',
                        entityUuid: entity.uuid(),
                        componentId: interaction.componentId,
                        handlerId: ESCALATING_FAILURE_HANDLER_ID,
                        value: choice.value,
                    },
                    interactionKind: 'escalating-failure' as const,
                    active: choice.active === true,
                    disabled: choice.disabled === true,
                })),
            })),
        hasRuntimeHistoryForUnitTurn: () => false,
        hasPendingEndTurnForUnit: () => false,
        dispatchNonMekUnitCommand: dispatch,
        dispatchEquipmentChoice,
    };
    member = {
        kind: 'cbt',
        id: 'tank-1',
        entity,
        force,
    } as unknown as CBTForceMember;
    return {
        member,
        dispatch,
        dispatchEquipmentChoice,
        boosterComponentId,
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
        query: { hasPendingPhaseChanges: () => false },
    };
    let member!: CBTForceMember;
    const force = {
        changed,
        sessionChanged: new Subject<void>(),
        members: () => [member],
        getUnitSnapshot: () => snapshot,
        getEquipmentPanelSnapshot: () => ({ components: [], physicalAttacks: [] }),
        getEquipmentInteractions: () => [],
        hasRuntimeHistoryForUnitTurn: () => false,
        dispatchNonMekUnitCommand: jasmine.createSpy('dispatchNonMekUnitCommand'),
        hasPendingEndTurnForUnit: () => false,
    };
    member = {
        kind: 'cbt',
        id: 'battle-armor-1',
        entity,
        force,
    } as unknown as CBTForceMember;
    return { member };
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
            turn: { ...pristine.turn, weaponsHeat: 7 },
        },
        query: { hasPendingPhaseChanges: () => false },
    };
    let member!: CBTForceMember;
    const force = {
        changed,
        sessionChanged: new Subject<void>(),
        members: () => [member],
        getUnitSnapshot: () => snapshot,
        getEquipmentPanelSnapshot: () => ({ components: [], physicalAttacks: [] }),
        getEquipmentInteractions: () => [],
        hasRuntimeHistoryForUnitTurn: () => false,
        hasPendingEndTurnForUnit: () => false,
        dispatchNonMekUnitCommand: jasmine.createSpy('dispatchNonMekUnitCommand'),
    };
    member = {
        kind: 'cbt',
        id: 'aero-1',
        entity,
        force,
    } as unknown as CBTForceMember;
    return { member };
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

function turnMember(initial: MekTurnPanelSnapshot, memberCount = 1) {
    const changed = new Subject<void>();
    const entity = new TestBipedMekEntity();
    let current = initial;
    let pendingEndTurn = false;
    const dispatch = jasmine.createSpy('dispatchMekUnitCommand').and.resolveTo({
        accepted: true,
        changed: false,
        revision: current.stateRevision,
    });
    let member!: CBTMekForceMember;
    const force = {
        changed,
        sessionChanged: new Subject<void>(),
        members: () => Array.from({ length: memberCount }, (_value, index) => index === 0
            ? member
            : { ...member, id: `mek-${index + 1}` }),
        getMekTurnPanelSnapshot: () => current,
        getEquipmentPanelSnapshot: () => ({ components: [], physicalAttacks: [] }),
        getEquipmentInteractions: () => [],
        dispatchMekUnitCommand: dispatch,
        hasRuntimeHistoryForUnitTurn: () => false,
        hasPendingEndTurnForUnit: () => pendingEndTurn,
        endPhaseForAllUnits: jasmine.createSpy('endPhaseForAllUnits').and.resolveTo({
            accepted: true,
            changed: true,
            atomic: false,
            results: [],
        }),
        endTurnForAllUnits: jasmine.createSpy('endTurnForAllUnits').and.resolveTo({
            accepted: true,
            changed: true,
            atomic: false,
            results: [],
        }),
    };
    member = {
        kind: 'cbt',
        id: 'mek-1',
        entity,
        force,
    } as unknown as CBTMekForceMember;
    return {
        member,
        dispatch,
        set: (snapshot: MekTurnPanelSnapshot) => {
            current = snapshot;
            changed.next();
        },
        setPendingEndTurn: (pending: boolean) => {
            pendingEndTurn = pending;
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
        ruleChecks: [],
        activeBoosterComponentIds: [],
        attackMovementModifiers: { stationary: 0, walk: 1, run: 2, sprint: 0, jump: 3, UMU: 3 },
        defenseModifierBreakdown: [],
        defenseModifierTotal: { modifier: 0 },
        canTakeActiveActions: true,
        spottingModifier: 1,
        turn: createPristineMekTurnStateV2(),
        cover: { partiallyUnderwater: false, submerged: false, building: { level: null, modifier: 0 } },
        heat: createPristineMekHeatStateV2(),
        heatProjection: { kind: 'unsupported', blockers: ['fixture'] },
        conditions: attempts > 0 ? ['prone'] : [],
        hasPendingCombat: false,
        hasPendingPhaseChanges: false,
    } as unknown as MekTurnPanelSnapshot;
}
