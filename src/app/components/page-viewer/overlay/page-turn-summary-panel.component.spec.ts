// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Overlay } from '@angular/cdk/overlay';
import { Subject } from 'rxjs';
import { CORE_2026_GAME_RULES, TW_GAME_RULES } from '../../../models/rules/game-rules';
import { DataService } from '../../../services/data.service';
import { DialogsService } from '../../../services/dialogs.service';
import { EquipmentInteractionRegistryService } from '../../../services/equipment-interaction-registry.service';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { ToastService } from '../../../services/toast.service';
import { PageInteractionOverlayComponent } from './page-interaction-overlay.component';
import { STANDING_UP_REVIEW_ONLY } from './page-standing-up-panel.component';
import { PageTurnSummaryPanelComponent } from './page-turn-summary-panel.component';

describe('PageTurnSummaryPanelComponent', () => {
    it('distinguishes an Immobile unit from one with only Stationary available', () => {
        const immobile = signal(false);
        const rulesId = signal<'core2026' | 'tw'>('core2026');
        const turnState = { airborne: signal<boolean | null>(false) };
        const unit = {
            get gameRules() {
                return rulesId() === 'tw' ? TW_GAME_RULES : CORE_2026_GAME_RULES;
            },
            getCondition: (condition: string) => condition === 'immobile' && immobile(),
            getAvailableMotiveModes: () => [{ mode: 'stationary', label: 'Stationary', psr: false }],
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
            damageReceived: () => 0,
            hasPSRChecks: () => false,
            falling: () => false,
            PSRChecksCount: () => 0,
            controlRollShortLabel: () => 'PSR',
            currentMoveMode: () => null,
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
        });

        expect(component.immobile()).toBeFalse();
        expect(component.onlyStationaryMoveMode()).toBeTrue();
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelectorAll('.move-button').length).toBe(1);
        expect(fixture.nativeElement.querySelector('.move-button.stationary-only')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.immobile-status')).toBeNull();

        immobile.set(true);
        fixture.detectChanges();

        expect(component.immobile()).toBeTrue();
        expect(fixture.nativeElement.querySelector('.move-button')).toBeNull();
        expect(fixture.nativeElement.querySelector('.immobile-status')?.textContent.trim())
            .toBe('Unit is immobile');

        rulesId.set('tw');
        fixture.detectChanges();

        expect(component.immobile()).toBeTrue();
        expect(component.showImmobileStatus()).toBeFalse();
        expect(fixture.nativeElement.querySelector('.immobile-status')).toBeNull();
        expect(fixture.nativeElement.querySelectorAll('.move-button').length).toBe(1);
        expect(fixture.nativeElement.querySelector('.move-button.stationary-only')).not.toBeNull();
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
});
