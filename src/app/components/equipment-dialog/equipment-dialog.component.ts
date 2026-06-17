import { ChangeDetectionStrategy, Component, computed, type ComponentRef, DestroyRef, type ElementRef, inject, Injector, isSignal, signal, viewChild } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { getAmmoControlEntriesForUnitWeapons } from '../../utils/ammo-interaction.util';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { KeyboardShortcutService } from '../../services/keyboard-shortcut.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { SwipeDirective, type SwipeEndEvent, type SwipeMoveEvent, type SwipeStartEvent } from '../../directives/swipe.directive';
import { WeaponsEquipmentPanelComponent } from './weapons-equipment-panel.component';
import { AmmoLoadoutPanelComponent, type AmmoLoadoutPanelData } from './ammo-loadout-panel.component';
import type { EquipmentDialogData, EquipmentDialogTab } from './equipment-dialog.model';
import { PageInteractionOverlayComponent } from '../page-viewer/overlay/page-interaction-overlay.component';
import { PageTurnSummaryPanelComponent } from '../page-viewer/overlay/page-turn-summary.component';
import { WeaponTargetsMenuComponent, type WeaponTargetUpdateRequest } from '../equipment-dialog/weapon-targets-menu.component';

const WEAPON_TARGETS_OVERLAY_KEY = 'weapon-equipment-targets';
const WEAPON_TARGET_CHOICE_OVERLAY_KEY = 'weapon-equipment-target-choice';

@Component({
    selector: 'equipment-dialog',
    standalone: true,
    imports: [SwipeDirective, WeaponsEquipmentPanelComponent, AmmoLoadoutPanelComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    templateUrl: './equipment-dialog.component.html',
    styleUrl: './equipment-dialog.component.scss'
})
export class EquipmentDialogComponent {
    readonly data: EquipmentDialogData = inject(DIALOG_DATA);
    private readonly dialogRef: DialogRef<void, EquipmentDialogComponent> = inject(DialogRef);
    private readonly keyboardShortcutService = inject(KeyboardShortcutService);
    private readonly overlay = inject(Overlay);
    private readonly overlayManager = inject(OverlayManagerService);
    private readonly injector = inject(Injector);
    private readonly destroyRef = inject(DestroyRef);
    private readonly revision = signal(0);
    private readonly turnSummaryParent = {
        unit: () => this.unit(),
        force: () => null
    };
    private targetsCompRef: ComponentRef<WeaponTargetsMenuComponent> | null = null;
    readonly tabs: ReadonlyArray<{ id: EquipmentDialogTab; label: string }> = [
        { id: 'weapons', label: 'Weapons & Equipment' },
        { id: 'ammo', label: 'Ammo Loadout' }
    ];
    readonly activeTab = signal<EquipmentDialogTab>(this.data.initialTab ?? 'weapons');
    readonly unitIndex = signal(this.initialUnitIndex());
    readonly unitList = computed(() => this.resolveUnitList());
    readonly unit = computed(() => this.unitList()[this.unitIndex()] ?? this.requiredUnit());
    readonly targets = computed(() => {
        this.revision();
        return this.unit().getInventoryControlTargets();
    });
    readonly hasPrev = computed(() => this.unitIndex() > 0);
    readonly hasNext = computed(() => this.unitIndex() < this.unitList().length - 1);
    readonly prevUnit = computed(() => this.hasPrev() ? this.unitList()[this.unitIndex() - 1] ?? null : null);
    readonly nextUnit = computed(() => this.hasNext() ? this.unitList()[this.unitIndex() + 1] ?? null : null);
    readonly prevUnitLabel = computed(() => this.formatUnitLabel(this.prevUnit()));
    readonly nextUnitLabel = computed(() => this.formatUnitLabel(this.nextUnit()));
    readonly incomingUnit = signal<CBTForceUnit | null>(null);
    readonly isSwipeAnimating = signal(false);
    readonly isSwiping = signal(false);
    readonly swipeDeltaX = signal(0);
    readonly currentPanelOffset = signal('0');
    readonly incomingPanelOffset = signal('100%');
    readonly currentWeaponsPanel = viewChild<WeaponsEquipmentPanelComponent>('currentWeaponsPanel');
    readonly incomingPanelRef = viewChild<ElementRef<HTMLElement>>('incomingPanel');

    constructor() {
        this.keyboardShortcutService.register({
            id: 'equipment-dialog',
            dialogRef: this.dialogRef,
            handle: (event) => this.handleShortcutKeyDown(event),
        }, this.destroyRef);
        this.setActiveUnitIndex(this.unitIndex(), false);
        this.destroyRef.onDestroy(() => {
            this.closeUnitOverlays(this.unit().id);
        });
    }

    unitTitle(unit: CBTForceUnit | null = this.unit()): string {
        return this.formatUnitLabel(unit);
    }

    unitModel(unit: CBTForceUnit | null): string {
        return unit?.getUnit().model ?? '';
    }

    unitChassis(unit: CBTForceUnit | null): string {
        return unit?.getUnit().chassis ?? '';
    }

    readOnly(unit = this.unit()): boolean {
        if (this.data.unitList) return unit.readOnly();
        return this.data.readOnly ?? unit.readOnly();
    }

    selectTab(tab: EquipmentDialogTab): void {
        this.activeTab.set(tab);
    }

    turnSummaryDirty(): boolean {
        return this.callTurnState('dirty', false);
    }

    turnSummaryFalling(): boolean {
        return this.callTurnState('autoFall', false);
    }

    turnSummaryHasPsrChecks(): boolean {
        return this.turnSummaryPsrCount() > 0;
    }

    turnSummaryPsrCount(): number {
        return this.callTurnState('PSRRollsCount', 0);
    }

    turnSummaryPhase(): string {
        return this.callTurnState('currentPhase', '');
    }

    openTurnSummary(event: MouseEvent): void {
        event.stopPropagation();
        if (this.readOnly()) return;

        const overlayKey = this.turnSummaryOverlayKey();
        if (this.overlayManager.has(overlayKey)) {
            this.overlayManager.closeManagedOverlay(overlayKey);
            return;
        }

        const target = event.currentTarget as HTMLElement;
        const customInjector = Injector.create({
            providers: [
                { provide: PageInteractionOverlayComponent, useValue: this.turnSummaryParent }
            ],
            parent: this.injector
        });
        const portal = new ComponentPortal(PageTurnSummaryPanelComponent, null, customInjector);
        const { componentRef } = this.overlayManager.createManagedOverlay<PageTurnSummaryPanelComponent>(overlayKey, target, portal, {
            hasBackdrop: false,
            panelClass: 'turn-summary-overlay-panel',
            closeOnOutsideClick: false,
            closeOnOutsideClickOnly: true,
            scrollStrategy: this.overlay.scrollStrategies.reposition()
        });

        componentRef?.setInput('endTurnForAllButtonVisible', false);
    }

    openTargets(event: MouseEvent): void {
        event.stopPropagation();

        if (this.overlayManager.has(WEAPON_TARGETS_OVERLAY_KEY)) {
            this.overlayManager.closeManagedOverlay(WEAPON_TARGETS_OVERLAY_KEY);
            this.targetsCompRef = null;
            return;
        }

        const target = event.currentTarget as HTMLElement;
        const portal = new ComponentPortal(WeaponTargetsMenuComponent, null, this.injector);
        const { componentRef, closed } = this.overlayManager.createManagedOverlay(WEAPON_TARGETS_OVERLAY_KEY, target, portal, {
            hasBackdrop: false,
            panelClass: 'weapon-targets-overlay-panel',
            closeOnOutsideClick: false,
            closeOnOutsideClickOnly: true,
            scrollStrategy: this.overlay.scrollStrategies.reposition(),
            positions: [
                { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
                { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
                { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
                { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
            ]
        });
        this.targetsCompRef = componentRef;
        this.syncTargetsOverlayInputs();

        outputToObservable(componentRef.instance.addRequest).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.unit().createInventoryControlTarget();
            this.refresh();
            this.syncTargetsOverlayInputs();
        });
        outputToObservable(componentRef.instance.resetRequest).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.unit().resetInventoryControlTargets();
            this.refresh();
            this.syncTargetsOverlayInputs();
        });
        outputToObservable(componentRef.instance.updateRequest).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((request: WeaponTargetUpdateRequest) => {
            this.unit().updateInventoryControlTarget(request.targetId, request.patch);
            this.refresh();
            this.syncTargetsOverlayInputs();
        });
        outputToObservable(componentRef.instance.deleteRequest).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(targetId => {
            this.unit().deleteInventoryControlTarget(targetId);
            this.refresh();
            this.syncTargetsOverlayInputs();
        });
        outputToObservable(componentRef.instance.colorPickerOpened).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.overlayManager.blockCloseUntil(WEAPON_TARGETS_OVERLAY_KEY);
        });
        outputToObservable(componentRef.instance.colorPickerClosed).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.overlayManager.unblockClose(WEAPON_TARGETS_OVERLAY_KEY);
        });
        closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.targetsCompRef = null;
        });
    }

    ammoPanelData(unit: CBTForceUnit): AmmoLoadoutPanelData {
        this.revision();
        return {
            entries: this.ammoEntries(unit),
            context: this.data.context,
            readOnly: this.readOnly(unit),
            getEntries: () => this.ammoEntries(unit)
        };
    }

    onPrev(): void {
        if (this.hasPrev() && !this.isSwipeAnimating() && !this.isSwiping()) {
            this.setActiveUnitIndex(this.unitIndex() - 1);
        }
    }

    onNext(): void {
        if (this.hasNext() && !this.isSwipeAnimating() && !this.isSwiping()) {
            this.setActiveUnitIndex(this.unitIndex() + 1);
        }
    }

    readonly shouldBlockSwipe = (): boolean => {
        if (this.isSwiping()) return false;
        if (this.isSwipeAnimating()) return true;
        const index = this.unitIndex();
        return (index === 0 && !this.hasNext()) || (index === this.unitList().length - 1 && !this.hasPrev());
    };

    onSwipeStart(event: SwipeStartEvent): void {
        if (this.isSwipeAnimating()) return;
        this.isSwiping.set(true);
        this.swipeDeltaX.set(0);
        this.currentPanelOffset.set('0');
        this.incomingUnit.set(null);
        this.closeUnitOverlays(this.unit().id);
    }

    onSwipeMove(event: SwipeMoveEvent): void {
        if (this.isSwipeAnimating()) return;

        const deltaX = event.deltaX;
        this.swipeDeltaX.set(deltaX);
        if (deltaX > 0 && this.hasPrev()) {
            const previousUnit = this.unitList()[this.unitIndex() - 1];
            if (this.incomingUnit() !== previousUnit) {
                this.incomingUnit.set(previousUnit);
            }
            this.currentPanelOffset.set(`${deltaX}px`);
            this.incomingPanelOffset.set(`calc(-100% + ${deltaX}px)`);
        } else if (deltaX < 0 && this.hasNext()) {
            const nextUnit = this.unitList()[this.unitIndex() + 1];
            if (this.incomingUnit() !== nextUnit) {
                this.incomingUnit.set(nextUnit);
            }
            this.currentPanelOffset.set(`${deltaX}px`);
            this.incomingPanelOffset.set(`calc(100% + ${deltaX}px)`);
        } else {
            this.currentPanelOffset.set(`${deltaX * 0.3}px`);
            this.incomingUnit.set(null);
        }
    }

    onSwipeEnd(event: SwipeEndEvent): void {
        if (this.isSwipeAnimating()) {
            this.isSwiping.set(false);
            return;
        }

        this.isSwiping.set(false);
        if (!event.success) {
            void this.animateSwipeCancel();
            return;
        }

        if (event.direction === 'left' && this.hasNext()) {
            void this.completeSwipeAnimation('left', this.unitIndex() + 1);
        } else if (event.direction === 'right' && this.hasPrev()) {
            void this.completeSwipeAnimation('right', this.unitIndex() - 1);
        } else {
            void this.animateSwipeCancel();
        }
    }

    close(): void {
        this.dialogRef.close();
    }

    private handleShortcutKeyDown(event: KeyboardEvent): boolean {
        if (event.ctrlKey || event.altKey || event.metaKey) return false;

        if (event.key === 'ArrowLeft') {
            this.onPrev();
            return true;
        } else if (event.key === 'ArrowRight') {
            this.onNext();
            return true;
        }

        return false;
    }

    private async animateSwipeCancel(): Promise<void> {
        this.isSwipeAnimating.set(true);
        this.currentPanelOffset.set('0');
        const incoming = this.incomingUnit();
        if (incoming) {
            const incomingIndex = this.unitList().findIndex(unit => unit.id === incoming.id);
            this.incomingPanelOffset.set(incomingIndex < this.unitIndex() ? '-100%' : '100%');
        }
        await this.waitForTransitionEnd();
        this.resetSwipeState();
    }

    private async completeSwipeAnimation(swipeDirection: 'left' | 'right', newIndex: number): Promise<void> {
        this.isSwipeAnimating.set(true);
        this.currentPanelOffset.set(swipeDirection === 'left' ? '-100%' : '100%');
        this.incomingPanelOffset.set('0');
        await this.waitForTransitionEnd();
        this.setActiveUnitIndex(newIndex);
        setTimeout(() => this.resetSwipeState(), 100);
    }

    private waitForTransitionEnd(): Promise<void> {
        return new Promise(resolve => {
            const panel = this.incomingPanelRef()?.nativeElement;
            if (!panel) {
                setTimeout(resolve, 320);
                return;
            }

            const handler = (event: TransitionEvent) => {
                if (event.propertyName === 'transform' && event.target === panel) {
                    panel.removeEventListener('transitionend', handler);
                    requestAnimationFrame(() => resolve());
                }
            };
            panel.addEventListener('transitionend', handler);
            setTimeout(() => {
                panel.removeEventListener('transitionend', handler);
                resolve();
            }, 400);
        });
    }

    private resetSwipeState(): void {
        this.isSwipeAnimating.set(false);
        this.isSwiping.set(false);
        this.swipeDeltaX.set(0);
        this.currentPanelOffset.set('0');
        this.incomingPanelOffset.set('100%');
        this.incomingUnit.set(null);
    }

    private initialUnitIndex(): number {
        const units = this.resolveUnitList();
        if (this.data.unitIndex !== undefined && this.data.unitIndex >= 0 && this.data.unitIndex < units.length) {
            return this.data.unitIndex;
        }
        const fallbackUnit = this.data.unit;
        const index = fallbackUnit ? units.findIndex(unit => unit.id === fallbackUnit.id) : -1;
        return index >= 0 ? index : 0;
    }

    private setActiveUnitIndex(index: number, refresh = true): void {
        const units = this.resolveUnitList();
        const nextUnit = units[index];
        if (!nextUnit) return;

        const previousUnitId = this.unit().id;
        this.unitIndex.set(index);
        nextUnit.syncInventoryControlSelectionSvg();
        if (previousUnitId !== nextUnit.id) {
            this.closeUnitOverlays(previousUnitId);
        }
        this.data.onUnitChange?.(nextUnit, index);
        if (refresh) {
            this.revision.update(value => value + 1);
        }
    }

    private resolveUnitList(): CBTForceUnit[] {
        const units = this.data.unitList;
        if (!units) return this.data.unit ? [this.data.unit] : [];
        const resolvedUnits = isSignal(units) ? units() : units;
        return resolvedUnits.length > 0 ? resolvedUnits : (this.data.unit ? [this.data.unit] : []);
    }

    private requiredUnit(): CBTForceUnit {
        const unit = this.data.unit;
        if (unit) return unit;
        const units = this.data.unitList;
        const resolvedUnits = units ? (isSignal(units) ? units() : units) : [];
        const resolvedUnit = resolvedUnits[this.data.unitIndex ?? 0] ?? resolvedUnits[0];
        if (resolvedUnit) return resolvedUnit;
        throw new Error('EquipmentDialogComponent requires a unit or unitList.');
    }

    private formatUnitLabel(unit: CBTForceUnit | null): string {
        if (!unit) return '';
        const baseUnit = unit.getUnit();
        return [baseUnit.chassis, baseUnit.model].filter(Boolean).join(' ') || baseUnit.name;
    }

    private ammoEntries(unit: CBTForceUnit) {
        return getAmmoControlEntriesForUnitWeapons(unit, this.data.context.dataService.getEquipments());
    }

    private callTurnState<T>(methodName: string, fallback: T): T {
        const turnState = this.unit().turnState() as unknown as Record<string, unknown>;
        const method = turnState[methodName];
        return typeof method === 'function' ? method.call(turnState) as T : fallback;
    }

    private refresh(): void {
        this.revision.update(value => value + 1);
    }

    private syncTargetsOverlayInputs(): void {
        if (!this.targetsCompRef) return;
        this.targetsCompRef.setInput('targets', this.targets());
        this.targetsCompRef.setInput('readOnly', this.readOnly());
        this.targetsCompRef.changeDetectorRef.detectChanges();
        this.overlayManager.repositionAll();
    }

    private closeUnitOverlays(unitId: string): void {
        this.overlayManager.closeManagedOverlay(this.turnSummaryOverlayKey(unitId));
        this.overlayManager.closeManagedOverlay(this.psrWarningOverlayKey(unitId));
        this.overlayManager.closeManagedOverlay(WEAPON_TARGETS_OVERLAY_KEY);
        this.overlayManager.closeManagedOverlay(WEAPON_TARGET_CHOICE_OVERLAY_KEY);
        this.targetsCompRef = null;
    }

    private turnSummaryOverlayKey(unitId = this.unit().id): string {
        return `turnSummary-${unitId}`;
    }

    private psrWarningOverlayKey(unitId = this.unit().id): string {
        return `psrWarning-${unitId}`;
    }
}