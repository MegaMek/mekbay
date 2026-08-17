// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    Component,
    ChangeDetectionStrategy,
    inject,
    Injector,
    input,
    computed,
    ElementRef,
    DestroyRef,
    effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OptionsService } from '../../../services/options.service';
import { DialogsService } from '../../../services/dialogs.service';
import { LoggerService } from '../../../services/logger.service';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { DataService } from '../../../services/data.service';
import { createHandlerCommandContext, createHandlerQueryContext, EquipmentInteractionRegistryService } from '../../../services/equipment-interaction-registry.service';
import { ForceBuilderService } from '../../../services/force-builder.service';
import { ToastService } from '../../../services/toast.service';
import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import type { CBTForce } from '../../../models/cbt-force.model';
import { togglePsrWarningOverlay } from './page-psr-warning-panel.component';
import { PageTurnSummaryPanelComponent } from './page-turn-summary-panel.component';
import { countActionablePsrChecks } from './page-turn-summary.util';
import { PageViewerStateService } from '../internal/page-viewer-state.service';
import { EquipmentDialogComponent } from '../../equipment-dialog/equipment-dialog.component';
import type { EquipmentDialogContext, EquipmentDialogData } from '../../equipment-dialog/equipment-dialog.model';
import { WeaponTargetsOverlayController } from '../../equipment-dialog/weapon-targets-overlay.controller';

const PAGE_TARGETS_OVERLAY_PREFIX = 'page-viewer-targets';

/*
 * 
 * PageInteractionOverlayComponent - Interaction overlay for a single page in the page viewer.
 * 
 * This component provides turn tracking UI controls placed on each page/unit.
 */

@Component({
    selector: 'page-interaction-overlay',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    templateUrl: './page-interaction-overlay.component.html',
    host: {
        '[class.fixed-mode]': 'mode() === "fixed"'
    },
    styleUrls: [`./page-interaction-overlay.component.scss`]
})
export class PageInteractionOverlayComponent {
    private logger = inject(LoggerService);
    private injector = inject(Injector);
    private destroyRef = inject(DestroyRef);
    private dialogsService = inject(DialogsService);
    private overlayManager = inject(OverlayManagerService);
    private optionsService = inject(OptionsService);
    private overlay = inject(Overlay);
    private host = inject(ElementRef<HTMLElement>);
    private pageViewerState = inject(PageViewerStateService);
    private dataService = inject(DataService);
    private equipmentRegistryService = inject(EquipmentInteractionRegistryService);
    private forceBuilderService = inject(ForceBuilderService);
    private toastService = inject(ToastService);
    private targetsOverlay = new WeaponTargetsOverlayController({
        overlay: this.overlay,
        overlayManager: this.overlayManager,
        injector: this.injector,
        destroyRef: this.destroyRef
    });

    // Inputs
    unit = input<CBTForceUnit | null>(null);
    force = input<CBTForce | null>(null);
    
    /**
     * When 'fixed', the overlay is bound to the container and stays stable during zoom/pan.
     * When 'page', the overlay is bound to the page-wrapper and moves with zoom/pan.
     * Default is 'page' for backwards compatibility and multi-page mode.
     */
    mode = input<'fixed' | 'page'>('page');
    
    get nativeElement(): HTMLElement {
        return this.host.nativeElement;
    }

    dirty = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().dirty();
    });

    dirtyPhase = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().dirtyPhase();
    });

    falling = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().autoFall();
    });

    private pendingPSRChecks = computed(() => {
        const unit = this.unit();
        if (!unit) return [];
        const turnState = unit.turnState();
        return turnState.getPSRChecks().filter(check =>
            check.fallCheck !== undefined
            && check.id !== undefined
            && turnState.getPSROutcome(check.id) === undefined
        );
    });

    actionablePSRCount = computed<number>(() => {
        return countActionablePsrChecks(this.pendingPSRChecks(), this.falling());
    });

    hasActionablePSRChecks = computed(() => this.actionablePSRCount() > 0);

    currentPhase = computed(() => {
        const unit = this.unit();
        if (!unit) return '';
        return unit.turnState().currentPhase();
    });

    endTurnButtonVisible = computed(() => {
        const force = this.force();
        if (!force) return false;
        const units = force.units();
        return units.some(u => u.turnState().dirty());
    });

    turnTrackerVisible = computed(() => !this.pageViewerState.inventoryDialogOpen());

    constructor() {
        effect(() => {
            if (this.pageViewerState.inventoryDialogOpen()) {
                this.closeAllOverlays();
            }
        });
    }

    openTurnSummary(event: MouseEvent) {
        event.stopPropagation();
        if (!this.turnTrackerVisible()) return;

        const unitId = this.unit()?.id;
        const overlayKey = `turnSummary-${unitId}`;

        // Toggle: close if already open
        if (this.overlayManager.has(overlayKey)) {
            this.overlayManager.closeManagedOverlay(overlayKey);
            return;
        }

        this.closeAllOverlays();

        const target = event.currentTarget as HTMLElement || (event.target as HTMLElement);

        // Create a custom injector that provides this component as the parent
        const customInjector = Injector.create({
            providers: [
                { provide: PageInteractionOverlayComponent, useValue: this }
            ],
            parent: this.injector
        });

        const portal = new ComponentPortal(PageTurnSummaryPanelComponent, null, customInjector);

        const { componentRef } = this.overlayManager.createManagedOverlay<PageTurnSummaryPanelComponent>(overlayKey, target, portal, {
            hasBackdrop: false,
            panelClass: 'turn-summary-overlay-panel',
            closeOnOutsideClick: false,
            closeOnOutsideClickOnly: true,
            sensitiveAreaReferenceElement: this.nativeElement,
            scrollStrategy: this.overlay.scrollStrategies.reposition()
        });

        if (componentRef) {
            componentRef.setInput('endTurnForAllButtonVisible', this.endTurnButtonVisible());
            outputToObservable(componentRef.instance.endTurnForAllClicked).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
                this.endTurnForAll();
            });
        }
    }

    openPsrWarning(event: MouseEvent): void {
        event.stopPropagation();
        if (!this.turnTrackerVisible()) return;
        togglePsrWarningOverlay(this, this.overlayManager, this.injector, this.overlay, () => this.closeAllOverlays());
    }

    openTargets(event: MouseEvent): void {
        event.stopPropagation();
        if (!this.turnTrackerVisible()) return;

        const unit = this.unit();
        if (!unit) return;

        const overlayKey = this.targetsOverlayKey(unit.id);
        if (this.targetsOverlay.has(overlayKey)) {
            this.targetsOverlay.close(overlayKey);
            return;
        }

        this.closeAllOverlays();

        const target = event.currentTarget as HTMLElement;
        this.targetsOverlay.open({
            overlayKey,
            target,
            unit,
            sensitiveAreaReferenceElement: this.nativeElement,
            afterTargetUpdate: updatedUnit => updatedUnit.syncInventoryControlSelectionSvg()
        });
    }

    openWeaponEquipmentDialog(event: MouseEvent): void {
        event.stopPropagation();
        if (!this.turnTrackerVisible()) return;

        const unit = this.unit();
        if (!unit) return;

        this.closeAllOverlays();
        const unitList = this.pageViewerState.forceUnits().length > 0 ? this.pageViewerState.forceUnits() : [unit];
        const equipmentCatalog = this.dataService.getEquipmentRegistry();
        const context: EquipmentDialogContext = {
            registry: this.equipmentRegistryService.getRegistry(),
            queryContext: createHandlerQueryContext(equipmentCatalog),
            commandContext: createHandlerCommandContext(equipmentCatalog, this.toastService, this.dialogsService),
        };
        this.pageViewerState.beginInventoryDialog();
        const ref = this.dialogsService.createDialog<void>(EquipmentDialogComponent, {
            data: {
                unitList,
                unitIndex: Math.max(0, unitList.findIndex(candidate => candidate.id === unit.id)),
                onUnitChange: (selectedUnit) => this.forceBuilderService.selectUnit(selectedUnit),
                context,
                initialTab: 'weapons'
            } as EquipmentDialogData,
        });
        ref.closed.subscribe(() => this.pageViewerState.endInventoryDialog());
    }

    private targetsOverlayKey(unitId: string): string {
        return `${PAGE_TARGETS_OVERLAY_PREFIX}-${unitId}`;
    }

    async endTurnForAll() {
        const force = this.force();
        if (!force) return;
        const confirm = await this.dialogsService.requestConfirmation(
            'Are you sure you want to end the turn for all units?',
            'End Turn',
            'info'
        );
        if (!confirm) return;
        const units = force.units();
        units.forEach(unit => unit.endTurn());
    }

    endPhase(event: MouseEvent): void {
        event.stopPropagation();
        this.unit()?.endPhase();
    }

    endTurn(event: MouseEvent): void {
        event.stopPropagation();
        this.unit()?.endTurn();
    }

    /**
     * Closes all currently managed overlays.
     */
    closeAllOverlays(): void {
        this.overlayManager.closeAllManagedOverlays();
        this.targetsOverlay.clearRef();
    }
}
