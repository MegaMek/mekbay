// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Overlay } from '@angular/cdk/overlay';
import { Subject } from 'rxjs';
import { CORE_2026_GAME_RULES, TW_GAME_RULES } from '../../../models/rules/game-rules';
import { DataService } from '../../../services/data.service';
import { CBTEndTurnService } from '../../../services/cbt-end-turn.service';
import { CBTPhaseResolutionService } from '../../../services/cbt-phase-resolution.service';
import { DialogsService } from '../../../services/dialogs.service';
import { EquipmentInteractionRegistryService } from '../../../services/equipment-interaction-registry.service';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { ToastService } from '../../../services/toast.service';
import { PageInteractionOverlayComponent } from './page-interaction-overlay.component';
import { STANDING_UP_REVIEW_ONLY } from './page-standing-up-panel.component';
import { PageTurnSummaryPanelComponent } from './page-turn-summary-panel.component';
import type { MotiveModeOption, MotiveModes } from '../../../models/motiveModes.model';

describe('PageTurnSummaryPanelComponent', () => {
    it('hides heat controls for null measurements while retaining measured zero', () => {
        const heat = signal<number | null>(null);
        const unit = { getUnit: () => ({ heat: heat() }) };
        TestBed.configureTestingModule({
            providers: [
                { provide: PageInteractionOverlayComponent, useValue: { unit: signal(unit), force: signal(null) } },
                { provide: OverlayManagerService, useValue: {} },
                { provide: Overlay, useValue: {} },
                { provide: EquipmentInteractionRegistryService, useValue: { getRegistry: () => ({}) } },
                { provide: ToastService, useValue: {} },
                { provide: DialogsService, useValue: {} },
                { provide: DataService, useValue: {} },
                { provide: CBTEndTurnService, useValue: {} },
                { provide: CBTPhaseResolutionService, useValue: {} },
            ],
        });
        const component = TestBed.runInInjectionContext(() => new PageTurnSummaryPanelComponent());
        expect(component.tracksHeat()).toBeFalse();
        heat.set(0);
        expect(component.tracksHeat()).toBeTrue();
    });

    it('distinguishes an Immobile unit from one with only Stationary available', () => {
        const immobile = signal(false);
        const rulesId = signal<'core2026' | 'tw'>('core2026');
        const moveMode = signal<MotiveModes | null>(null);
        const availableMotiveModes = signal<MotiveModeOption[]>([
            { mode: 'stationary', label: 'Stationary', psr: false },
        ]);
        const markPhaseStateChanged = jasmine.createSpy('markPhaseStateChanged');
        const turnState = {
            dirty: signal(false),
            airborne: signal<boolean | null>(false),
            moveMode,
            moveDistance: signal<number | null>(5),
            carefulStand: signal(false),
            applyMovePSR: signal(true),
            markPhaseStateChanged,
        };
        const unit = {
            get gameRules() {
                return rulesId() === 'tw' ? TW_GAME_RULES : CORE_2026_GAME_RULES;
            },
            getCondition: (condition: string) => condition === 'immobile' && immobile(),
            canTakeActiveActions: () => true,
            getUnit: () => ({
                type: 'Mek',
                subtype: 'BattleMek',
                moveType: 'Biped',
                jump: 0,
                umu: 0,
            }),
            rules: {
                getAttackMovementModifier: () => 0,
                getCommittedDamageMovementModePSRCheck: () => null,
            },
            getAvailableMotiveModes: () => availableMotiveModes(),
            turnState: () => turnState,
        };

        TestBed.configureTestingModule({
            imports: [PageTurnSummaryPanelComponent],
            providers: [
                { provide: PageInteractionOverlayComponent, useValue: { unit: signal(unit), force: signal(null) } },
                { provide: OverlayManagerService, useValue: { closeManagedOverlay: () => undefined } },
                { provide: Overlay, useValue: {} },
                { provide: EquipmentInteractionRegistryService, useValue: { getRegistry: () => ({}) } },
                { provide: ToastService, useValue: {} },
                { provide: DialogsService, useValue: {} },
                { provide: DataService, useValue: {} },
            ],
        });
        const fixture = TestBed.createComponent(PageTurnSummaryPanelComponent);
        const component = fixture.componentInstance;
        Object.assign(component, {
            dirty: () => false,
            phaseDirty: () => false,
            damageReceived: () => 0,
            hasPSRChecks: () => false,
            falling: () => false,
            PSRChecksCount: () => 0,
            controlRollShortLabel: () => 'PSR',
            prone: () => false,
            canStandUp: () => false,
            standAttempts: () => 0,
            standUpRequiresPSR: () => false,
            getTotalTargetModifierAsDefender: () => '0',
            defenseTargetModifierTooltip: () => null,
            spotting: () => false,
            cover: () => undefined,
            waterDepth: () => '',
            buildingLevel: () => '',
            coverModifierLabel: () => null,
            spottingModifierLabel: () => null,
            tracksHeat: () => false,
            heatRows: () => [],
            psrModifiers: () => [],
            equipmentTrackControlRows: () => [],
            airborne: () => false,
            canSwitchAirborneMode: () => false,
            moveDistance: () => 5,
            moveCapacity: () => 0,
            moveMin: () => 0,
            moveMax: () => 0,
            moveDistanceTicks: () => [0],
            hasMoveDistance: () => true,
            overDistance: () => true,
        });

        expect(component.immobile()).toBeFalse();
        expect(component.onlyStationaryMoveMode()).toBeTrue();

        component.selectMove('stationary');

        expect(moveMode()).toBe('stationary');
        expect(markPhaseStateChanged).toHaveBeenCalledTimes(1);
        moveMode.set(null);

        fixture.detectChanges();

        expect(fixture.nativeElement.querySelectorAll('.move-button').length).toBe(1);
        expect(fixture.nativeElement.querySelector('.move-button.stationary-only')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.move-mode-row.crowded')).toBeNull();
        expect(fixture.nativeElement.querySelector('.immobile-status')).toBeNull();

        immobile.set(true);
        fixture.detectChanges();

        expect(component.immobile()).toBeTrue();
        expect(fixture.nativeElement.querySelector('.end-turn-action')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.move-button')).toBeNull();
        expect(fixture.nativeElement.querySelector('.immobile-status')?.textContent.trim())
            .toBe('Unit is immobile');

        rulesId.set('tw');
        fixture.detectChanges();

        expect(component.immobile()).toBeTrue();
        expect(component.showImmobileStatus()).toBeFalse();
        expect(fixture.nativeElement.querySelector('.end-turn-action')).toBeNull();
        expect(fixture.nativeElement.querySelector('.immobile-status')).toBeNull();
        expect(fixture.nativeElement.querySelectorAll('.move-button').length).toBe(1);
        expect(fixture.nativeElement.querySelector('.move-button.stationary-only')).not.toBeNull();

        rulesId.set('core2026');
        moveMode.set('run');
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.immobile-status')?.textContent.trim())
            .toBe('Unit is immobile');
        expect(Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('.move-button'))
            .map(button => button.textContent?.trim())).toEqual(['', 'Run']);
        expect(fixture.nativeElement.querySelector('.move-button.selected')?.textContent.trim()).toBe('Run');
        expect(fixture.nativeElement.querySelector('hex-slider')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.hex.danger')?.textContent.trim()).toBe('5');

        availableMotiveModes.set([
            { mode: 'stationary', label: 'Stationary' },
            { mode: 'walk', label: 'Walk' },
            { mode: 'run', label: 'Run' },
            { mode: 'sprint', label: 'Sprint' },
            { mode: 'jump', label: 'Jump' },
        ]);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.move-mode-row.crowded')).not.toBeNull();
        expect(fixture.nativeElement.querySelectorAll('.move-mode-row .move-button').length).toBe(5);
    });

    it('clears attacks and spotting when Sprint is selected', () => {
        const moveMode = signal<MotiveModes | null>(null);
        const spotting = signal(true);
        const clearInventoryControlSelection = jasmine.createSpy('clearInventoryControlSelection');
        const markPhaseStateChanged = jasmine.createSpy('markPhaseStateChanged');
        const turnState = {
            moveMode,
            effectiveMoveMode: () => moveMode(),
            moveDistance: signal<number | null>(null),
            minDistanceCurrentMoveMode: () => 0,
            carefulStand: signal(false),
            spotting,
            applyMovePSR: signal(true),
            markPhaseStateChanged,
        };
        const unit = {
            canTakeActiveActions: () => true,
            clearInventoryControlSelection,
            turnState: () => turnState,
        };

        TestBed.configureTestingModule({
            imports: [PageTurnSummaryPanelComponent],
            providers: [
                { provide: PageInteractionOverlayComponent, useValue: { unit: signal(unit), force: signal(null) } },
                { provide: OverlayManagerService, useValue: { closeManagedOverlay: () => undefined } },
                { provide: Overlay, useValue: {} },
                { provide: EquipmentInteractionRegistryService, useValue: { getRegistry: () => ({}) } },
                { provide: ToastService, useValue: {} },
                { provide: DialogsService, useValue: {} },
                { provide: DataService, useValue: {} },
            ],
        });
        const component = TestBed.createComponent(PageTurnSummaryPanelComponent).componentInstance;
        Object.assign(component, { prone: () => false });

        expect(component.canSpot()).toBeTrue();

        component.selectMove('sprint');

        expect(moveMode()).toBe('sprint');
        expect(spotting()).toBeFalse();
        expect(component.canSpot()).toBeFalse();
        expect(clearInventoryControlSelection).toHaveBeenCalledTimes(1);
        expect(markPhaseStateChanged).toHaveBeenCalledTimes(1);
    });

    it('reports spent stand-attempt MP and reopens the standing dialog without changing the attempt', () => {
        const attempts = signal<number | undefined>(1);
        const getMovementPointsSpent = jasmine.createSpy('getMovementPointsSpent').and.returnValue(2);
        const turnState = { standAttempts: attempts };
        const unit = {
            id: 'unit-1',
            rules: { getMovementPointsSpent },
            turnState: () => turnState,
        };
        const standingOverlayClosed = new Subject<void>();
        const overlayManager = {
            has: jasmine.createSpy('has').and.returnValue(false),
            closeManagedOverlay: jasmine.createSpy('closeManagedOverlay'),
            createManagedOverlay: jasmine.createSpy('createManagedOverlay').and.returnValue({
                closed: standingOverlayClosed,
            }),
            blockCloseUntil: jasmine.createSpy('blockCloseUntil'),
            unblockClose: jasmine.createSpy('unblockClose'),
        };

        TestBed.configureTestingModule({
            imports: [PageTurnSummaryPanelComponent],
            providers: [
                { provide: PageInteractionOverlayComponent, useValue: { unit: signal(unit), force: signal(null) } },
                { provide: OverlayManagerService, useValue: overlayManager },
                { provide: Overlay, useValue: { scrollStrategies: { block: () => ({}) } } },
                { provide: EquipmentInteractionRegistryService, useValue: { getRegistry: () => ({}) } },
                { provide: ToastService, useValue: {} },
                { provide: DialogsService, useValue: {} },
                { provide: DataService, useValue: {} },
            ],
        });
        const component = TestBed.createComponent(PageTurnSummaryPanelComponent).componentInstance;
        const event = { stopPropagation: jasmine.createSpy('stopPropagation') } as unknown as MouseEvent;

        expect(component.standAttempts()).toBe(1);
        expect(component.standAttemptMovementPointsSpent()).toBe(2);

        component.reviewStandAttempts(event);

        expect(event.stopPropagation).toHaveBeenCalled();
        expect(attempts()).toBe(1);
        expect(overlayManager.createManagedOverlay).toHaveBeenCalled();
        expect(overlayManager.createManagedOverlay.calls.mostRecent().args[0]).toBe('standingUp-unit-1');
        const portal = overlayManager.createManagedOverlay.calls.mostRecent().args[2];
        expect(portal.injector.get(STANDING_UP_REVIEW_ONLY)).toBeTrue();
        expect(overlayManager.blockCloseUntil).toHaveBeenCalledOnceWith('turnSummary-unit-1');
        expect(overlayManager.closeManagedOverlay).not.toHaveBeenCalledWith('turnSummary-unit-1');

        standingOverlayClosed.next();

        expect(overlayManager.unblockClose).toHaveBeenCalledOnceWith('turnSummary-unit-1');
        expect(overlayManager.closeManagedOverlay).not.toHaveBeenCalledWith('turnSummary-unit-1');
    });

    it('shows phase actions for dirty phase state and resolves the selected scope', async () => {
        const currentDirty = signal(false);
        const otherDirty = signal(false);
        const currentUnit = {
            id: 'unit-a',
            gameRules: TW_GAME_RULES,
            getCondition: () => false,
            turnState: () => ({
                dirty: currentDirty,
                dirtyPhase: currentDirty,
            }),
        };
        const otherUnit = {
            id: 'unit-b',
            gameRules: TW_GAME_RULES,
            getCondition: () => false,
            turnState: () => ({
                dirty: otherDirty,
                dirtyPhase: otherDirty,
            }),
        };
        const forceUnits = signal([currentUnit]);
        const force = { units: forceUnits };
        const closeManagedOverlay = jasmine.createSpy('closeManagedOverlay');
        const blockCloseUntil = jasmine.createSpy('blockCloseUntil');
        const unblockClose = jasmine.createSpy('unblockClose');
        const resolvePhase = jasmine.createSpy('endPhase').and.resolveTo(true);
        const endTurn = jasmine.createSpy('endTurn').and.resolveTo(undefined);
        const requestConfirmation = jasmine.createSpy('requestConfirmation').and.resolveTo(true);

        TestBed.configureTestingModule({
            imports: [PageTurnSummaryPanelComponent],
            providers: [
                {
                    provide: PageInteractionOverlayComponent,
                    useValue: { unit: signal(currentUnit), force: signal(force) },
                },
                {
                    provide: OverlayManagerService,
                    useValue: { closeManagedOverlay, blockCloseUntil, unblockClose },
                },
                { provide: Overlay, useValue: {} },
                { provide: EquipmentInteractionRegistryService, useValue: { getRegistry: () => ({}) } },
                { provide: ToastService, useValue: {} },
                { provide: DialogsService, useValue: { requestConfirmation } },
                { provide: DataService, useValue: {} },
                { provide: CBTEndTurnService, useValue: { endTurn } },
                { provide: CBTPhaseResolutionService, useValue: { endPhase: resolvePhase } },
            ],
        });
        const fixture = TestBed.createComponent(PageTurnSummaryPanelComponent);
        const component = fixture.componentInstance;
        Object.assign(component, {
            dirty: () => false,
            damageReceived: () => 0,
            hasPSRChecks: () => false,
            falling: () => false,
            PSRChecksCount: () => 0,
            controlRollShortLabel: () => 'PSR',
            showImmobileStatus: () => false,
            showMovementControls: () => true,
            canSwitchAirborneMode: () => false,
            airborne: () => false,
            moveModes: () => [],
            onlyStationaryMoveMode: () => false,
            currentMoveMode: () => null,
            prone: () => false,
            canStandUp: () => false,
            standAttempts: () => 0,
            standUpRequiresPSR: () => false,
            equipmentTrackControlRows: () => [],
            spotting: () => false,
            canSpot: () => false,
            spottingModifierLabel: () => null,
            defenseTargetModifierTooltip: () => null,
            getTotalTargetModifierAsDefender: () => '+0',
            cover: () => undefined,
            waterDepth: () => '',
            buildingLevel: () => '',
            coverModifierLabel: () => null,
            tracksHeat: () => false,
            heatRows: () => [],
            psrModifiers: () => [],
        });

        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.phase-actions')).toBeNull();

        currentDirty.set(true);
        fixture.detectChanges();
        let phaseButtons = fixture.nativeElement.querySelectorAll('.phase-actions button');
        expect(phaseButtons.length).toBe(1);
        expect(phaseButtons[0].textContent.trim().toLowerCase()).toBe('end phase');
        expect(fixture.nativeElement.querySelector('.all-units-action')).toBeNull();

        forceUnits.set([currentUnit, otherUnit]);
        fixture.detectChanges();
        phaseButtons = fixture.nativeElement.querySelectorAll('.phase-actions button');
        expect(phaseButtons.length).toBe(2);
        expect(phaseButtons[0].textContent.trim().toLowerCase()).toBe('end phase');
        expect(phaseButtons[1].textContent.trim().toLowerCase()).toBe('all units');
        expect(fixture.nativeElement.querySelector('.all-units-action')).not.toBeNull();

        const currentEvent = jasmine.createSpyObj<MouseEvent>('event', ['stopPropagation']);
        await component.endPhase(currentEvent);

        expect(currentEvent.stopPropagation).toHaveBeenCalledTimes(1);
        expect(closeManagedOverlay).toHaveBeenCalledWith('turnSummary-unit-a');
        expect(resolvePhase).toHaveBeenCalledOnceWith(currentUnit);

        resolvePhase.calls.reset();
        closeManagedOverlay.calls.reset();
        blockCloseUntil.calls.reset();
        unblockClose.calls.reset();
        currentDirty.set(false);
        otherDirty.set(true);
        fixture.detectChanges();

        const remainingPhaseButtons = fixture.nativeElement.querySelectorAll('.phase-actions button');
        expect(remainingPhaseButtons.length).toBe(1);
        expect(remainingPhaseButtons[0].textContent.trim().toLowerCase()).toBe('all units');

        const allEvent = jasmine.createSpyObj<MouseEvent>('event', ['stopPropagation']);
        await component.endPhaseForAll(allEvent);

        expect(allEvent.stopPropagation).toHaveBeenCalledTimes(1);
        expect(blockCloseUntil).toHaveBeenCalledOnceWith('turnSummary-unit-a');
        expect(unblockClose).toHaveBeenCalledOnceWith('turnSummary-unit-a');
        expect(requestConfirmation).toHaveBeenCalledOnceWith(
            'Are you sure you want to end the phase for all units?',
            'End Phase',
            'info'
        );
        expect(closeManagedOverlay).toHaveBeenCalledWith('turnSummary-unit-a');
        expect(resolvePhase).toHaveBeenCalledOnceWith([currentUnit, otherUnit]);

        requestConfirmation.calls.reset();
        blockCloseUntil.calls.reset();
        unblockClose.calls.reset();
        const endTurnEvent = jasmine.createSpyObj<MouseEvent>('event', ['stopPropagation']);
        await component.endTurnForAll(endTurnEvent);

        expect(endTurnEvent.stopPropagation).toHaveBeenCalledTimes(1);
        expect(requestConfirmation).toHaveBeenCalledOnceWith(
            'Are you sure you want to end the turn for all units?',
            'End Turn',
            'info'
        );
        expect(endTurn).toHaveBeenCalledOnceWith([currentUnit, otherUnit]);
    });
});
