// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Overlay } from '@angular/cdk/overlay';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import { CBTEndTurnService } from '../../../services/cbt-end-turn.service';
import { CBTPhaseResolutionService } from '../../../services/cbt-phase-resolution.service';
import { DataService } from '../../../services/data.service';
import { DialogsService } from '../../../services/dialogs.service';
import { EquipmentInteractionRegistryService } from '../../../services/equipment-interaction-registry.service';
import { ForceBuilderService } from '../../../services/force-builder.service';
import { LoggerService } from '../../../services/logger.service';
import { OptionsService } from '../../../services/options.service';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { ToastService } from '../../../services/toast.service';
import { PageViewerStateService } from '../internal/page-viewer-state.service';
import { PageInteractionOverlayComponent } from './page-interaction-overlay.component';

describe('PageInteractionOverlayComponent pending work', () => {
    let fixture: ComponentFixture<PageInteractionOverlayComponent>;
    let resumePendingChain: jasmine.Spy;
    let resolvePhase: jasmine.Spy;
    let closeAllManagedOverlays: jasmine.Spy;
    let unit: CBTForceUnit;

    beforeEach(async () => {
        resumePendingChain = jasmine.createSpy('resumePendingChain').and.resolveTo(true);
        resolvePhase = jasmine.createSpy('endPhase').and.resolveTo(true);
        closeAllManagedOverlays = jasmine.createSpy('closeAllManagedOverlays');
        const turnState = {
            dirty: () => false,
            dirtyPhase: () => false,
            moveMode: () => null,
            autoFall: () => false,
            actionablePSRRollsCount: () => 0,
            PSRRollsCount: () => 0,
            getPSRChecks: () => [],
            getPSROutcome: () => undefined,
            pendingCriticalChanceCount: () => 0,
            pendingCriticalHitCount: () => 0,
            getPendingCriticalChances: () => [],
            getPendingCriticalHits: () => [],
            getPendingEvents: () => [],
            pendingUnitCheckCount: () => 0,
            actionablePendingUnitChecks: () => [],
        };
        unit = {
            id: 'unit-a',
            gameRules: { aggregatedEndPhaseConsciousRolls: true },
            rules: { controlRollFullLabel: 'Piloting Skill Rolls' },
            turnState: () => turnState,
            pendingFallCount: () => 0,
            PSRTargetRoll: () => 7,
        } as unknown as CBTForceUnit;

        await TestBed.configureTestingModule({
            imports: [PageInteractionOverlayComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: LoggerService, useValue: {} },
                { provide: DialogsService, useValue: {} },
                { provide: OverlayManagerService, useValue: { closeAllManagedOverlays } },
                { provide: OptionsService, useValue: { options: () => ({ trackPhaseAndTurn: true }) } },
                { provide: Overlay, useValue: {} },
                {
                    provide: PageViewerStateService,
                    useValue: { inventoryDialogOpen: signal(false), forceUnits: signal([]) },
                },
                { provide: DataService, useValue: {} },
                { provide: EquipmentInteractionRegistryService, useValue: {} },
                { provide: ForceBuilderService, useValue: {} },
                { provide: ToastService, useValue: {} },
                { provide: CBTEndTurnService, useValue: {} },
                {
                    provide: CBTPhaseResolutionService,
                    useValue: { endPhase: resolvePhase, resumePendingChain },
                },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(PageInteractionOverlayComponent);
        fixture.componentRef.setInput('unit', unit);
        fixture.detectChanges();
    });

    it('routes a pending-work activation through the shared resolver', async () => {
        const event = jasmine.createSpyObj<Event>('event', ['stopPropagation']);

        fixture.componentInstance.openNotification({ kind: 'unit-check', event });
        await fixture.whenStable();

        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        expect(closeAllManagedOverlays).toHaveBeenCalledTimes(1);
        expect(resumePendingChain).toHaveBeenCalledOnceWith(unit);
    });

    it('delegates phase completion to the shared phase resolver', async () => {
        const event = jasmine.createSpyObj<MouseEvent>('event', ['stopPropagation']);

        await fixture.componentInstance.endPhase(event);

        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        expect(resolvePhase).toHaveBeenCalledOnceWith(unit);
    });
});
