/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

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
    type ComponentRef
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
import { EquipmentInteractionRegistryService } from '../../../services/equipment-interaction-registry.service';
import { ForceBuilderService } from '../../../services/force-builder.service';
import { ToastService } from '../../../services/toast.service';
import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import type { CBTForce } from '../../../models/cbt-force.model';
import { PageTurnSummaryPanelComponent } from './page-turn-summary.component';
import { PageViewerStateService } from '../internal/page-viewer-state.service';
import { EquipmentDialogComponent } from '../../equipment-dialog/equipment-dialog.component';
import type { EquipmentDialogContext, EquipmentDialogData } from '../../equipment-dialog/equipment-dialog.model';
import { WeaponTargetsMenuComponent, type WeaponTargetUpdateRequest } from '../../equipment-dialog/weapon-targets-menu.component';

const PAGE_TARGETS_OVERLAY_PREFIX = 'page-viewer-targets';

/*
 * Author: Drake
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
    private targetsCompRef: ComponentRef<WeaponTargetsMenuComponent> | null = null;

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

    hasPSRChecks = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().PSRRollsCount() > 0;
    });

    psrCount = computed<number>(() => {
        const unit = this.unit();
        if (!unit) return 0;
        return unit.turnState().PSRRollsCount();
    });

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

    openTargets(event: MouseEvent): void {
        event.stopPropagation();
        if (!this.turnTrackerVisible()) return;

        const unit = this.unit();
        if (!unit) return;

        const overlayKey = this.targetsOverlayKey(unit.id);
        if (this.overlayManager.has(overlayKey)) {
            this.overlayManager.closeManagedOverlay(overlayKey);
            this.targetsCompRef = null;
            return;
        }

        this.closeAllOverlays();

        const target = event.currentTarget as HTMLElement;
        const portal = new ComponentPortal(WeaponTargetsMenuComponent, null, this.injector);
        const { componentRef, closed } = this.overlayManager.createManagedOverlay(overlayKey, target, portal, {
            hasBackdrop: false,
            panelClass: 'weapon-targets-overlay-panel',
            closeOnOutsideClick: false,
            closeOnOutsideClickOnly: true,
            sensitiveAreaReferenceElement: this.nativeElement,
            scrollStrategy: this.overlay.scrollStrategies.reposition(),
            positions: [
                { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
                { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
                { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
                { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
            ]
        });
        this.targetsCompRef = componentRef;
        this.syncTargetsOverlayInputs(unit);

        outputToObservable(componentRef.instance.addRequest).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            unit.createInventoryControlTarget();
            this.syncTargetsAfterUpdate(unit);
        });
        outputToObservable(componentRef.instance.resetRequest).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            unit.resetInventoryControlTargets();
            this.syncTargetsAfterUpdate(unit);
        });
        outputToObservable(componentRef.instance.updateRequest).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((request: WeaponTargetUpdateRequest) => {
            unit.updateInventoryControlTarget(request.targetId, request.patch);
            this.syncTargetsAfterUpdate(unit);
        });
        outputToObservable(componentRef.instance.deleteRequest).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(targetId => {
            unit.deleteInventoryControlTarget(targetId);
            this.syncTargetsAfterUpdate(unit);
        });
        outputToObservable(componentRef.instance.colorPickerOpened).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.overlayManager.blockCloseUntil(overlayKey);
        });
        outputToObservable(componentRef.instance.colorPickerClosed).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.overlayManager.unblockClose(overlayKey);
        });
        closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.targetsCompRef = null;
        });
    }

    openWeaponEquipmentDialog(event: MouseEvent): void {
        event.stopPropagation();
        if (!this.turnTrackerVisible()) return;

        const unit = this.unit();
        if (!unit) return;

        this.closeAllOverlays();
        const unitList = this.pageViewerState.forceUnits().length > 0 ? this.pageViewerState.forceUnits() : [unit];
        const context: EquipmentDialogContext = {
            toastService: this.toastService,
            dialogsService: this.dialogsService,
            dataService: this.dataService,
            registry: this.equipmentRegistryService.getRegistry()
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

    private syncTargetsAfterUpdate(unit: CBTForceUnit): void {
        unit.syncInventoryControlSelectionSvg();
        this.syncTargetsOverlayInputs(unit);
    }

    private syncTargetsOverlayInputs(unit: CBTForceUnit): void {
        if (!this.targetsCompRef) return;
        this.targetsCompRef.setInput('targets', unit.getInventoryControlTargets());
        this.targetsCompRef.setInput('readOnly', unit.readOnly());
        this.targetsCompRef.changeDetectorRef.detectChanges();
        this.overlayManager.repositionAll();
    }

    private targetsOverlayKey(unitId: string): string {
        return `${PAGE_TARGETS_OVERLAY_PREFIX}-${unitId}`;
    }

    async endTurnForAll() {
        const confirm = await this.dialogsService.requestConfirmation(
            'Are you sure you want to end the turn for all units?',
            'End Turn',
            'info'
        );
        if (!confirm) return;
        const force = this.force();
        if (!force) return;
        force.units().forEach(unit => {
            unit.endTurn();
        });
    }

    async endPhase(event: MouseEvent) {
        event.stopPropagation();
        this.unit()?.endPhase();
    }

    async endTurn(event: MouseEvent) {
        event.stopPropagation();
        this.unit()?.endTurn();
    }

    /**
     * Closes all currently managed overlays.
     */
    closeAllOverlays(): void {
        this.overlayManager.closeAllManagedOverlays();
        this.targetsCompRef = null;
    }
}
