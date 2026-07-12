import { type DestroyRef, Injector, type ComponentRef } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { type Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import type { OverlayManagerService } from '../../services/overlay-manager.service';
import { WeaponTargetsMenuComponent, type WeaponTargetCalculatorRequest, type WeaponTargetUpdateRequest } from './weapon-targets-menu.component';
import { TnCalculatorDialogComponent, type TnCalculatorDialogData, type TnCalculatorDialogResult } from './tn-calculator-dialog.component';

const WEAPON_TARGET_OVERLAY_POSITIONS = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
];
const TN_CALCULATOR_OVERLAY_POSITIONS = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'center', overlayX: 'end', overlayY: 'center', offsetX: -4 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
    { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center', offsetX: 4 },
];
const TN_CALCULATOR_FULLSCREEN_QUERY = '(max-width: 600px)';

export interface WeaponTargetsOverlayControllerDeps {
    overlay: Overlay;
    overlayManager: OverlayManagerService;
    injector: Injector;
    destroyRef: DestroyRef;
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
    private tnCalculatorTargetId: string | null = null;

    constructor(private readonly deps: WeaponTargetsOverlayControllerDeps) {}

    has(overlayKey: string): boolean {
        return this.deps.overlayManager.has(overlayKey);
    }

    close(overlayKey: string): void {
        this.closeTnCalculator(overlayKey);
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
        outputToObservable(componentRef.instance.calculatorRequest).pipe(takeUntilDestroyed(this.deps.destroyRef)).subscribe(request => {
            this.openTnCalculator(options, request);
        });
        outputToObservable(componentRef.instance.deleteRequest).pipe(takeUntilDestroyed(this.deps.destroyRef)).subscribe(targetId => {
            options.unit.deleteInventoryControlTarget(targetId);
            this.syncAfterTargetUpdate(options);
        });
        closed.pipe(takeUntilDestroyed(this.deps.destroyRef)).subscribe(() => {
            this.closeTnCalculator(options.overlayKey);
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
        this.targetsCompRef.setInput('unassignedMovement', options.unit.turnState().missingAttackMovementModifier());
        this.targetsCompRef.setInput('showC3Distance', this.showC3Distance(options.unit));
        this.targetsCompRef.changeDetectorRef.detectChanges();
        this.deps.overlayManager.repositionAll();
    }

    private openTnCalculator(options: WeaponTargetsOverlayOpenOptions, request: WeaponTargetCalculatorRequest): void {
        const overlayKey = this.tnCalculatorOverlayKey(options.overlayKey);
        if (this.deps.overlayManager.has(overlayKey)) {
            const sameTarget = this.tnCalculatorTargetId === request.targetId;
            this.closeTnCalculator(options.overlayKey);
            if (sameTarget) return;
        }

        const target = options.unit.getInventoryControlTarget(request.targetId);
        if (!target) return;

        const closeWithResult = (result?: TnCalculatorDialogResult | null) => {
            this.closeTnCalculator(options.overlayKey);
            if (result) {
                options.unit.updateInventoryControlTarget(result.targetId, result.patch);
                this.syncAfterTargetUpdate(options);
            }
        };
        const portal = new ComponentPortal(TnCalculatorDialogComponent, null, Injector.create({
            providers: [
                { provide: DIALOG_DATA, useValue: { target, showC3Distance: this.showC3Distance(options.unit), indirectFireBaseModifier: options.unit.rules.getSpottingModifier() } satisfies TnCalculatorDialogData },
                { provide: DialogRef, useValue: { close: closeWithResult } },
            ],
            parent: this.deps.injector,
        }));

        this.deps.overlayManager.blockCloseUntil(options.overlayKey);
        const fullscreen = this.tnCalculatorFullscreen();
        const overlayOrigin = fullscreen ? null : request.origin;
        const { closed } = this.deps.overlayManager.createManagedOverlay(overlayKey, overlayOrigin, portal, {
            hasBackdrop: fullscreen,
            backdropClass: fullscreen ? 'cdk-overlay-dark-backdrop' : undefined,
            panelClass: 'tn-calculator-overlay-panel',
            closeOnOutsideClick: false,
            closeOnOutsideClickOnly: true,
            scrollStrategy: this.deps.overlay.scrollStrategies.reposition(),
            positions: TN_CALCULATOR_OVERLAY_POSITIONS
        });
        this.tnCalculatorTargetId = request.targetId;
        closed.pipe(takeUntilDestroyed(this.deps.destroyRef)).subscribe(() => {
            this.tnCalculatorTargetId = null;
            this.deps.overlayManager.unblockClose(options.overlayKey);
        });
    }

    private closeTnCalculator(parentOverlayKey: string): void {
        this.deps.overlayManager.closeManagedOverlay(this.tnCalculatorOverlayKey(parentOverlayKey));
        this.tnCalculatorTargetId = null;
        this.deps.overlayManager.unblockClose(parentOverlayKey);
    }

    private tnCalculatorOverlayKey(parentOverlayKey: string): string {
        return `${parentOverlayKey}:tn-calculator`;
    }

    private tnCalculatorFullscreen(): boolean {
        return typeof window !== 'undefined' && window.matchMedia(TN_CALCULATOR_FULLSCREEN_QUERY).matches;
    }

    private showC3Distance(unit: CBTForceUnit): boolean {
        return unit.hasLinkedC3Network?.() ?? false;
    }
}