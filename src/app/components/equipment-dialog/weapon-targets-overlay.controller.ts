import { type DestroyRef, type Injector, type ComponentRef } from '@angular/core';
import { type Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import type { DialogsService } from '../../services/dialogs.service';
import type { OverlayManagerService } from '../../services/overlay-manager.service';
import { WeaponTargetsMenuComponent, type WeaponTargetUpdateRequest } from './weapon-targets-menu.component';
import { TnCalculatorDialogComponent, type TnCalculatorDialogData, type TnCalculatorDialogResult } from './tn-calculator-dialog.component';

const WEAPON_TARGET_OVERLAY_POSITIONS = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
];

export interface WeaponTargetsOverlayControllerDeps {
    overlay: Overlay;
    overlayManager: OverlayManagerService;
    injector: Injector;
    destroyRef: DestroyRef;
    dialogsService: DialogsService;
}

export interface WeaponTargetsOverlayOpenOptions {
    overlayKey: string;
    target: HTMLElement;
    unit: CBTForceUnit;
    readOnly?: () => boolean;
    sensitiveAreaReferenceElement?: HTMLElement;
    afterTargetUpdate?: (unit: CBTForceUnit) => void;
}

export class WeaponTargetsOverlayController {
    private targetsCompRef: ComponentRef<WeaponTargetsMenuComponent> | null = null;

    constructor(private readonly deps: WeaponTargetsOverlayControllerDeps) {}

    has(overlayKey: string): boolean {
        return this.deps.overlayManager.has(overlayKey);
    }

    close(overlayKey: string): void {
        this.deps.overlayManager.closeManagedOverlay(overlayKey);
        this.targetsCompRef = null;
    }

    clearRef(): void {
        this.targetsCompRef = null;
    }

    open(options: WeaponTargetsOverlayOpenOptions): void {
        const portal = new ComponentPortal(WeaponTargetsMenuComponent, null, this.deps.injector);
        const { componentRef, closed } = this.deps.overlayManager.createManagedOverlay(options.overlayKey, options.target, portal, {
            hasBackdrop: false,
            panelClass: 'weapon-targets-overlay-panel',
            closeOnOutsideClick: false,
            closeOnOutsideClickOnly: true,
            sensitiveAreaReferenceElement: options.sensitiveAreaReferenceElement,
            scrollStrategy: this.deps.overlay.scrollStrategies.reposition(),
            positions: WEAPON_TARGET_OVERLAY_POSITIONS
        });
        this.targetsCompRef = componentRef;
        this.syncInputs(options);

        outputToObservable(componentRef.instance.addRequest).pipe(takeUntilDestroyed(this.deps.destroyRef)).subscribe(() => {
            options.unit.createInventoryControlTarget();
            this.syncAfterTargetUpdate(options);
        });
        outputToObservable(componentRef.instance.resetRequest).pipe(takeUntilDestroyed(this.deps.destroyRef)).subscribe(() => {
            options.unit.resetInventoryControlTargets();
            this.syncAfterTargetUpdate(options);
        });
        outputToObservable(componentRef.instance.updateRequest).pipe(takeUntilDestroyed(this.deps.destroyRef)).subscribe((request: WeaponTargetUpdateRequest) => {
            options.unit.updateInventoryControlTarget(request.targetId, request.patch);
            this.syncAfterTargetUpdate(options);
        });
        outputToObservable(componentRef.instance.calculatorRequest).pipe(takeUntilDestroyed(this.deps.destroyRef)).subscribe(targetId => {
            this.openTnCalculator(options, targetId);
        });
        outputToObservable(componentRef.instance.deleteRequest).pipe(takeUntilDestroyed(this.deps.destroyRef)).subscribe(targetId => {
            options.unit.deleteInventoryControlTarget(targetId);
            this.syncAfterTargetUpdate(options);
        });
        outputToObservable(componentRef.instance.colorPickerOpened).pipe(takeUntilDestroyed(this.deps.destroyRef)).subscribe(() => {
            this.deps.overlayManager.blockCloseUntil(options.overlayKey);
        });
        outputToObservable(componentRef.instance.colorPickerClosed).pipe(takeUntilDestroyed(this.deps.destroyRef)).subscribe(() => {
            this.deps.overlayManager.unblockClose(options.overlayKey);
        });
        closed.pipe(takeUntilDestroyed(this.deps.destroyRef)).subscribe(() => {
            if (this.targetsCompRef === componentRef) {
                this.targetsCompRef = null;
            }
        });
    }

    private syncAfterTargetUpdate(options: WeaponTargetsOverlayOpenOptions): void {
        options.afterTargetUpdate?.(options.unit);
        this.syncInputs(options);
    }

    private syncInputs(options: WeaponTargetsOverlayOpenOptions): void {
        if (!this.targetsCompRef) return;
        this.targetsCompRef.setInput('targets', options.unit.getInventoryControlTargets());
        this.targetsCompRef.setInput('readOnly', options.readOnly ? options.readOnly() : options.unit.readOnly());
        this.targetsCompRef.setInput('unassignedMovement', options.unit.turnState().moveMode() === null);
        this.targetsCompRef.changeDetectorRef.detectChanges();
        this.deps.overlayManager.repositionAll();
    }

    private openTnCalculator(options: WeaponTargetsOverlayOpenOptions, targetId: string): void {
        const target = options.unit.getInventoryControlTarget(targetId);
        if (!target) return;

        this.deps.overlayManager.blockCloseUntil(options.overlayKey);
        const ref = this.deps.dialogsService.createDialog<TnCalculatorDialogResult | null, TnCalculatorDialogComponent, TnCalculatorDialogData>(TnCalculatorDialogComponent, {
            data: { target }
        });
        ref.closed.pipe(takeUntilDestroyed(this.deps.destroyRef)).subscribe(result => {
            window.setTimeout(() => this.deps.overlayManager.unblockClose(options.overlayKey), 100);
            if (result) {
                options.unit.updateInventoryControlTarget(result.targetId, result.patch);
                this.syncAfterTargetUpdate(options);
            }
        });
    }
}