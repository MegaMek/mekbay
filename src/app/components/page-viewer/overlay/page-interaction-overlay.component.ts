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
import { DialogsService } from '../../../services/dialogs.service';
import { LoggerService } from '../../../services/logger.service';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { DataService } from '../../../services/data.service';
import { createHandlerCommandContext, createHandlerQueryContext, EquipmentInteractionRegistryService } from '../../../services/equipment-interaction-registry.service';
import { ForceBuilderService } from '../../../services/force-builder.service';
import { ToastService } from '../../../services/toast.service';
import { CBTPhaseResolutionService } from '../../../services/cbt-phase-resolution.service';
import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import type { CBTForce } from '../../../models/cbt-force.model';
import { togglePsrWarningOverlay } from './page-psr-warning-panel.component';
import { PageTurnSummaryPanelComponent } from './page-turn-summary-panel.component';
import { PageViewerStateService } from '../internal/page-viewer-state.service';
import { EquipmentDialogComponent } from '../../equipment-dialog/equipment-dialog.component';
import type { EquipmentDialogContext, EquipmentDialogData } from '../../equipment-dialog/equipment-dialog.model';
import {
    UnitNotificationBadgesComponent,
    type UnitNotificationActivation,
} from '../../unit-notification-badges/unit-notification-badges.component';
import { WeaponTargetsOverlayController } from '../../equipment-dialog/weapon-targets-overlay.controller';
import { getTurnMovementIndicator } from '../../../utils/turn-movement-indicator.util';

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
    imports: [CommonModule, UnitNotificationBadgesComponent],
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
    private overlay = inject(Overlay);
    private host = inject(ElementRef<HTMLElement>);
    private pageViewerState = inject(PageViewerStateService);
    private dataService = inject(DataService);
    private equipmentRegistryService = inject(EquipmentInteractionRegistryService);
    private forceBuilderService = inject(ForceBuilderService);
    private toastService = inject(ToastService);
    private phaseResolution = inject(CBTPhaseResolutionService);
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

    dirtyPhase = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().dirtyPhase();
    });

    movementIndicator = computed(() => {
        const unit = this.unit();
        if (!unit) return null;
        const turnState = unit.turnState();
        return getTurnMovementIndicator(
            turnState.moveMode(),
            turnState.getTotalTargetModifierAsDefender().modifier,
        );
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

        this.overlayManager.createManagedOverlay<PageTurnSummaryPanelComponent>(overlayKey, target, portal, {
            hasBackdrop: false,
            panelClass: 'turn-summary-overlay-panel',
            closeOnOutsideClick: false,
            closeOnOutsideClickOnly: true,
            sensitiveAreaReferenceElement: this.nativeElement,
            scrollStrategy: this.overlay.scrollStrategies.reposition()
        });
    }

    openNotification({ kind, event }: UnitNotificationActivation): void {
        switch (kind) {
            case 'fall':
                if ((this.unit()?.pendingFallCount?.() ?? 0) > 0) {
                    void this.openPendingFalls(event);
                } else {
                    this.openPsrWarning(event);
                }
                break;
            case 'psr':
                void this.openPendingUnitChecks(event);
                break;
            case 'critical-chance':
                void this.openPendingCriticalChances(event);
                break;
            case 'critical-hit':
                void this.openPendingCriticalHits(event);
                break;
            case 'unit-check':
                void this.openPendingUnitChecks(event);
                break;
        }
    }

    openPsrWarning(event: Event): void {
        event.stopPropagation();
        if (!this.turnTrackerVisible()) return;
        togglePsrWarningOverlay(this, this.overlayManager, this.injector, this.overlay, () => this.closeAllOverlays());
    }

    async openPendingCriticalHits(event: Event): Promise<void> {
        event.stopPropagation();
        if (!this.turnTrackerVisible()) return;
        const unit = this.unit();
        if (!unit) return;
        this.closeAllOverlays();
        await this.phaseResolution.resumePendingChain(unit);
    }

    async openPendingCriticalChances(event: Event): Promise<void> {
        event.stopPropagation();
        if (!this.turnTrackerVisible()) return;
        const unit = this.unit();
        if (!unit) return;
        this.closeAllOverlays();
        await this.phaseResolution.resumePendingChain(unit);
    }

    async openPendingUnitChecks(event: Event): Promise<void> {
        event.stopPropagation();
        if (!this.turnTrackerVisible()) return;
        const unit = this.unit();
        if (!unit) return;
        this.closeAllOverlays();
        await this.phaseResolution.resumePendingChain(unit);
    }

    async openPendingFalls(event: Event): Promise<void> {
        event.stopPropagation();
        if (!this.turnTrackerVisible()) return;
        const unit = this.unit();
        if (!unit) return;
        this.closeAllOverlays();
        await this.phaseResolution.resumePendingChain(unit);
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

    async endPhase(event: MouseEvent): Promise<void> {
        event.stopPropagation();
        const unit = this.unit();
        if (!unit) return;

        this.closeAllOverlays();
        await this.phaseResolution.endPhase(unit);
    }

    /**
     * Closes all currently managed overlays.
     */
    closeAllOverlays(): void {
        this.overlayManager.closeAllManagedOverlays();
        this.targetsOverlay.clearRef();
    }
}
