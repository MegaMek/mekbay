// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { UnitNameService } from '../../services/unit-name.service';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    type ElementRef,
    inject,
    Injector,
    signal,
    viewChild,
} from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';

import {
    SwipeDirective,
    type SwipeEndEvent,
    type SwipeMoveEvent,
    type SwipeStartEvent,
} from '../../directives/swipe.directive';
import {
    isCBTForceMember,
    isCBTMekForceMember,
    type CBTForceMember,
} from '../../models/force-member.model';
import {
    isMekTurnPanelDirty,
    mekTurnPanelPhase,
    type MekTurnPanelSnapshot,
} from '../../models/runtime/mek-turn-panel';
import { KeyboardShortcutService } from '../../services/keyboard-shortcut.service';
import { OptionsService } from '../../services/options.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { ToastService } from '../../services/toast.service';
import { DialogsService } from '../../services/dialogs.service';
import { PageTurnSummaryPanelComponent } from '../page-viewer/overlay/page-turn-summary-panel.component';
import { AmmoLoadoutPanelComponent } from './ammo-loadout-panel.component';
import type { EquipmentDialogData, EquipmentDialogTab } from './equipment-dialog.model';
import { EquipmentDialogRuntimeController } from './equipment-dialog-runtime.controller';
import { WeaponTargetsOverlayController } from './weapon-targets-overlay.controller';
import { WeaponsEquipmentPanelComponent } from './weapons-equipment-panel.component';
import { getTurnMovementIndicator } from '../../utils/turn-movement-indicator.util';

const WEAPON_TARGETS_OVERLAY_KEY = 'weapon-equipment-targets';
const WEAPON_TARGET_CHOICE_OVERLAY_KEY = 'weapon-equipment-target-choice';

@Component({
    selector: 'equipment-dialog',
    imports: [SwipeDirective, WeaponsEquipmentPanelComponent, AmmoLoadoutPanelComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { class: 'fullscreen-dialog-host glass' },
    templateUrl: './equipment-dialog.component.html',
    styleUrl: './equipment-dialog.component.scss',
})
export class EquipmentDialogComponent {
    readonly unitNames = inject(UnitNameService);
    readonly data = inject<EquipmentDialogData>(DIALOG_DATA);
    private readonly dialogRef = inject<DialogRef<void, EquipmentDialogComponent>>(DialogRef);
    private readonly keyboardShortcuts = inject(KeyboardShortcutService);
    private readonly overlay = inject(Overlay);
    private readonly overlayManager = inject(OverlayManagerService);
    private readonly injector = inject(Injector);
    private readonly destroyRef = inject(DestroyRef);
    private readonly options = inject(OptionsService);
    private readonly toast = inject(ToastService);
    private readonly dialogs = inject(DialogsService);
    private readonly targetsOverlay = new WeaponTargetsOverlayController({
        overlay: this.overlay,
        overlayManager: this.overlayManager,
        injector: this.injector,
        destroyRef: this.destroyRef,
    });

    readonly runtime = signal(this.createRuntime(this.data.member));
    readonly tabs: readonly { id: EquipmentDialogTab; label: string }[] = [
        { id: 'weapons', label: 'Weapons & Equipment' },
        { id: 'ammo', label: 'Ammo Loadout' },
    ];
    readonly activeTab = signal<EquipmentDialogTab>(this.data.initialTab ?? 'weapons');
    readonly unitIndex = signal(this.initialUnitIndex());
    readonly unitList = computed(() => this.data.member.force.members().filter(isCBTForceMember));
    readonly unit = computed(() => this.runtime().member);
    readonly hasPrev = computed(() => this.unitIndex() > 0);
    readonly hasNext = computed(() => this.unitIndex() < this.unitList().length - 1);
    readonly prevUnit = computed(() => this.hasPrev() ? this.unitList()[this.unitIndex() - 1] ?? null : null);
    readonly nextUnit = computed(() => this.hasNext() ? this.unitList()[this.unitIndex() + 1] ?? null : null);
    readonly prevUnitLabel = computed(() => this.formatUnitLabel(this.prevUnit()));
    readonly nextUnitLabel = computed(() => this.formatUnitLabel(this.nextUnit()));
    readonly incomingRuntime = signal<EquipmentDialogRuntimeController | null>(null);
    readonly isSwipeAnimating = signal(false);
    readonly isSwiping = signal(false);
    readonly swipeDeltaX = signal(0);
    readonly currentPanelOffset = signal('0');
    readonly incomingPanelOffset = signal('100%');
    readonly currentWeaponsPanel = viewChild<WeaponsEquipmentPanelComponent>('currentWeaponsPanel');
    readonly incomingPanelRef = viewChild<ElementRef<HTMLElement>>('incomingPanel');

    constructor() {
        this.keyboardShortcuts.register({
            id: 'equipment-dialog',
            dialogRef: this.dialogRef,
            handle: event => this.handleShortcutKeyDown(event),
        }, this.destroyRef);
        this.destroyRef.onDestroy(() => {
            this.closeUnitOverlays(this.unit().id);
            this.runtime().dispose();
            this.incomingRuntime()?.dispose();
        });
    }

    unitTitle(unit: CBTForceMember | null = this.unit()): string {
        return this.formatUnitLabel(unit);
    }

    unitModel(unit: CBTForceMember | null): string {
        return unit?.entity.model() ?? '';
    }

    unitChassis(unit: CBTForceMember | null): string {
        return this.unitNames.chassis(unit?.entity);
    }

    readOnly(unit: CBTForceMember = this.unit()): boolean {
        return unit.force.readOnly();
    }

    selectTab(tab: EquipmentDialogTab): void {
        this.activeTab.set(tab);
    }

    turnSummaryDirty(): boolean {
        const snapshot = this.turnSnapshot();
        return snapshot !== null && isMekTurnPanelDirty(snapshot);
    }

    turnSummaryFalling(): boolean {
        return (this.turnSnapshot()?.movementState.automaticFalls.length ?? 0) > 0;
    }

    turnSummaryHasPsrChecks(): boolean {
        return this.turnSummaryPsrCount() > 0;
    }

    turnSummaryPsrCount(): number {
        return this.turnSnapshot()?.movementState.checks
            .filter(check => check.status === 'pending').length ?? 0;
    }

    turnSummaryPhase(): string {
        const snapshot = this.turnSnapshot();
        return snapshot === null ? '' : mekTurnPanelPhase(snapshot);
    }

    turnSummaryMovement() {
        const snapshot = this.turnSnapshot();
        return getTurnMovementIndicator(
            snapshot?.movementState.movement?.mode,
            snapshot?.defenseModifierTotal?.modifier ?? 0,
        );
    }

    openTurnSummary(event: MouseEvent): void {
        event.stopPropagation();
        if (this.readOnly() || !isCBTMekForceMember(this.unit())) return;

        const overlayKey = this.turnSummaryOverlayKey();
        if (this.overlayManager.has(overlayKey)) {
            this.overlayManager.closeManagedOverlay(overlayKey);
            return;
        }

        const portal = new ComponentPortal(PageTurnSummaryPanelComponent, null, this.injector);
        const { componentRef } = this.overlayManager.createManagedOverlay<PageTurnSummaryPanelComponent>(
            overlayKey,
            event.currentTarget as HTMLElement,
            portal,
            {
                hasBackdrop: false,
                panelClass: 'turn-summary-overlay-panel',
                closeOnOutsideClick: false,
                closeOnOutsideClickOnly: true,
                scrollStrategy: this.overlay.scrollStrategies.reposition(),
            },
        );
        componentRef?.setInput('member', this.unit());
    }

    openTargets(event: MouseEvent): void {
        event.stopPropagation();
        const member = this.unit();
        if (!this.runtime().supportsTargetingTools()) return;
        if (this.targetsOverlay.has(WEAPON_TARGETS_OVERLAY_KEY)) {
            this.targetsOverlay.close(WEAPON_TARGETS_OVERLAY_KEY);
            return;
        }
        this.targetsOverlay.open({
            overlayKey: WEAPON_TARGETS_OVERLAY_KEY,
            target: event.currentTarget as HTMLElement,
            member,
            readOnly: () => this.readOnly(),
        });
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
        return !this.hasPrev() && !this.hasNext();
    };

    onSwipeStart(_event: SwipeStartEvent): void {
        if (this.isSwipeAnimating()) return;
        this.isSwiping.set(true);
        this.swipeDeltaX.set(0);
        this.currentPanelOffset.set('0');
        this.setIncomingUnit(null);
        this.closeUnitOverlays(this.unit().id);
    }

    onSwipeMove(event: SwipeMoveEvent): void {
        if (this.isSwipeAnimating()) return;

        const deltaX = event.deltaX;
        this.swipeDeltaX.set(deltaX);
        if (deltaX > 0 && this.hasPrev()) {
            this.setIncomingUnit(this.prevUnit());
            this.currentPanelOffset.set(`${deltaX}px`);
            this.incomingPanelOffset.set(`calc(-100% + ${deltaX}px)`);
        } else if (deltaX < 0 && this.hasNext()) {
            this.setIncomingUnit(this.nextUnit());
            this.currentPanelOffset.set(`${deltaX}px`);
            this.incomingPanelOffset.set(`calc(100% + ${deltaX}px)`);
        } else {
            this.currentPanelOffset.set(`${deltaX * 0.3}px`);
            this.setIncomingUnit(null);
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
        } else if (event.direction === 'left' && this.hasNext()) {
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
        }
        if (event.key === 'ArrowRight') {
            this.onNext();
            return true;
        }
        return false;
    }

    private async animateSwipeCancel(): Promise<void> {
        this.isSwipeAnimating.set(true);
        this.currentPanelOffset.set('0');
        const incoming = this.incomingRuntime()?.member;
        if (incoming) {
            const incomingIndex = this.unitList().findIndex(unit => unit.id === incoming.id);
            this.incomingPanelOffset.set(incomingIndex < this.unitIndex() ? '-100%' : '100%');
        }
        await this.waitForTransitionEnd();
        this.resetSwipeState();
    }

    private async completeSwipeAnimation(direction: 'left' | 'right', newIndex: number): Promise<void> {
        this.isSwipeAnimating.set(true);
        this.currentPanelOffset.set(direction === 'left' ? '-100%' : '100%');
        this.incomingPanelOffset.set('0');
        await this.waitForTransitionEnd();

        const promoted = this.incomingRuntime();
        this.incomingRuntime.set(null);
        this.setActiveUnitIndex(newIndex, promoted);
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
                if (event.propertyName !== 'transform' || event.target !== panel) return;
                panel.removeEventListener('transitionend', handler);
                requestAnimationFrame(() => resolve());
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
        this.setIncomingUnit(null);
    }

    private initialUnitIndex(): number {
        const index = this.resolveUnitList().findIndex(unit => unit.id === this.data.member.id);
        return index >= 0 ? index : 0;
    }

    private setActiveUnitIndex(
        index: number,
        preparedRuntime: EquipmentDialogRuntimeController | null = null,
    ): void {
        const nextUnit = this.resolveUnitList()[index];
        if (!nextUnit) {
            preparedRuntime?.dispose();
            return;
        }

        const current = this.runtime();
        if (current.member.id === nextUnit.id) {
            this.unitIndex.set(index);
            preparedRuntime?.dispose();
            return;
        }

        const nextRuntime = preparedRuntime?.member.id === nextUnit.id
            ? preparedRuntime
            : this.createRuntime(nextUnit);
        if (preparedRuntime && preparedRuntime !== nextRuntime) preparedRuntime.dispose();

        this.closeUnitOverlays(current.member.id);
        this.unitIndex.set(index);
        this.runtime.set(nextRuntime);
        current.dispose();
        this.data.onMemberChange?.(nextUnit, index);
    }

    private setIncomingUnit(member: CBTForceMember | null): void {
        const current = this.incomingRuntime();
        if (current?.member.id === member?.id) return;
        current?.dispose();
        this.incomingRuntime.set(member ? this.createRuntime(member) : null);
    }

    private resolveUnitList(): readonly CBTForceMember[] {
        const members = this.data.member.force.members().filter(isCBTForceMember);
        return members.length > 0 ? members : [this.data.member];
    }

    private createRuntime(member: CBTForceMember): EquipmentDialogRuntimeController {
        return new EquipmentDialogRuntimeController(member, this.options, this.toast, this.dialogs);
    }

    private formatUnitLabel(unit: CBTForceMember | null): string {
        if (!unit) return '';
        return this.unitNames.name(unit.entity);
    }

    private closeUnitOverlays(unitId: string): void {
        this.overlayManager.closeManagedOverlay(this.turnSummaryOverlayKey(unitId));
        this.overlayManager.closeManagedOverlay(this.psrWarningOverlayKey(unitId));
        this.overlayManager.closeManagedOverlay(WEAPON_TARGETS_OVERLAY_KEY);
        this.overlayManager.closeManagedOverlay(WEAPON_TARGET_CHOICE_OVERLAY_KEY);
        this.targetsOverlay.clearRef();
    }

    private turnSummaryOverlayKey(unitId: string = this.unit().id): string {
        return `turnSummary-${unitId}`;
    }

    private psrWarningOverlayKey(unitId: string = this.unit().id): string {
        return `psrWarning-${unitId}`;
    }

    private turnSnapshot(): MekTurnPanelSnapshot | null {
        const member = this.unit();
        if (!isCBTMekForceMember(member)) return null;
        return member.force.getMekTurnPanelSnapshot(
            member.id,
            this.options.cbtAutomationMode('heatAndDissipationResolution') === 'yes'
                ? 'automatic'
                : 'manual',
        );
    }
}
