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
    signal,
} from '@angular/core';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { OptionsService } from '../../../services/options.service';
import { DialogsService } from '../../../services/dialogs.service';
import { LoggerService } from '../../../services/logger.service';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { ToastService } from '../../../services/toast.service';
import type { CBTForce } from '../../../models/cbt-force.model';
import type { PageViewerMember } from '../internal/types';
import { isCBTMekForceMember } from '../../../models/force-member.model';
import {
    hasNonMekAirborneTurnSelection,
    hasPendingNonMekChanges,
} from '../../../models/runtime/non-mek-unit-instance';
import { PageTurnSummaryPanelComponent } from './page-turn-summary-panel.component';
import { PageRuntimeHistoryPanelComponent } from './page-runtime-history-panel.component';
import { PageViewerStateService } from '../internal/page-viewer-state.service';
import { ForceWorkspaceStateService } from '../../../services/force-workspace-state.service';
import { EquipmentDialogComponent } from '../../equipment-dialog/equipment-dialog.component';
import type { EquipmentDialogData } from '../../equipment-dialog/equipment-dialog.model';
import { WeaponTargetsOverlayController } from '../../equipment-dialog/weapon-targets-overlay.controller';
import { togglePsrWarningOverlay } from './page-psr-warning-panel.component';
import {
    isMekTurnPanelDirty,
    isMekTurnPanelDirtyPhase,
    mekTurnPanelPhase,
} from '../../../models/runtime/mek-turn-panel';
import { hasNonMekRuntime } from '../../../models/cbt-unit-snapshot';
import { getTurnMovementIndicator } from '../../../utils/turn-movement-indicator.util';
import {
    UnitNotificationBadgesComponent,
    type UnitNotificationActivation,
} from '../../unit-notification-badges/unit-notification-badges.component';
import { CBTUnitViewModeService } from '../../../services/cbt-unit-view-mode.service';
import { CBTAutomationToastService } from '../../../services/cbt-automation-toast.service';

const PAGE_TARGETS_OVERLAY_PREFIX = 'page-viewer-targets';
const PAGE_RUNTIME_HISTORY_OVERLAY_PREFIX = 'page-viewer-runtime-history';

/*
 * 
 * PageInteractionOverlayComponent - Interaction overlay for a single page in the page viewer.
 * 
 * This component provides turn tracking UI controls placed on each page/unit.
 */

@Component({
    selector: 'page-interaction-overlay',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [UnitNotificationBadgesComponent],
    templateUrl: './page-interaction-overlay.component.html',
    host: {
        '[class.fixed-mode]': 'mode() === "fixed"'
    },
    styleUrl: './page-interaction-overlay.component.scss'
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
    private forceWorkspace = inject(ForceWorkspaceStateService);
    private toastService = inject(ToastService);
    private readonly automationToasts = inject(CBTAutomationToastService);
    private readonly automationToastVisibilityOwner = {};
    protected readonly unitViewMode = inject(CBTUnitViewModeService);
    private targetsOverlay = new WeaponTargetsOverlayController({
        overlay: this.overlay,
        overlayManager: this.overlayManager,
        injector: this.injector,
        destroyRef: this.destroyRef
    });

    // Inputs
    member = input<PageViewerMember | null>(null);
    force = input<CBTForce | null>(null);
    private readonly runtimeVersion = signal(0);
    readonly isMek = computed(() => isCBTMekForceMember(this.member()));
    readonly supportsTargeting = computed(() => {
        this.runtimeVersion();
        const member = this.member();
        return member !== null && member.force.getAttackerTargeting(member.id) !== null;
    });
    canUndo(): boolean {
        return this.force()?.getRuntimeUndoState().canUndo === true
            && this.force()?.readOnly() !== true;
    }

    canRedo(): boolean {
        return this.force()?.getRuntimeUndoState().canRedo === true
            && this.force()?.readOnly() !== true;
    }
    readonly turn = computed(() => {
        this.runtimeVersion();
        const member = this.member();
        return isCBTMekForceMember(member) ? member.force.getMekTurnPanelSnapshot(
            member.id,
            this.optionsService.cbtAutomationMode('heatAndDissipationResolution') === 'yes'
                ? 'automatic'
                : 'manual',
        ) : null;
    });
    private readonly entityTurn = computed(() => {
        this.runtimeVersion();
        const member = this.member();
        if (!member || isCBTMekForceMember(member)) return null;
        const snapshot = member.force.getUnitSnapshot(member.id);
        return snapshot && hasNonMekRuntime(snapshot) ? snapshot : null;
    });
    /**
     * When 'fixed', the overlay is bound to the container and stays stable during zoom/pan.
     * When 'page', the overlay is bound to the page-wrapper and moves with zoom/pan.
     * Page mode is the normal multi-page layout; fixed mode is opt-in.
     */
    mode = input<'fixed' | 'page'>('page');
    
    get nativeElement(): HTMLElement {
        return this.host.nativeElement;
    }

    dirty = computed(() => {
        const turn = this.turn();
        if (turn !== null) return isMekTurnPanelDirty(turn);
        const entitySnapshot = this.entityTurn();
        const entity = entitySnapshot?.state;
        const member = this.member();
        return entitySnapshot !== null && entity !== undefined && (
            hasPendingNonMekChanges(entity)
            || hasNonMekAirborneTurnSelection(entitySnapshot.entity, entity)
            || entity.turn.movement !== null
            || member?.force.hasRuntimeHistoryForUnitTurn(
                member.id,
                entity.turn.turnCounter + 1,
            ) === true
        );
    });

    dirtyPhase = computed(() => {
        const turn = this.turn();
        if (turn !== null) return isMekTurnPanelDirtyPhase(turn);
        const entity = this.entityTurn();
        return entity !== null && entity !== undefined && hasPendingNonMekChanges(entity.state);
    });

    currentPhase = computed(() => {
        const turn = this.turn();
        return turn ? mekTurnPanelPhase(turn) : this.entityTurn() ? 'T' : 'M';
    });

    readonly movementIndicator = computed(() => {
        const turn = this.turn();
        return getTurnMovementIndicator(
            turn?.movementState.movement?.mode,
            turn?.defenseModifierTotal?.modifier ?? 0,
        );
    });

    turnTrackerVisible = computed(() => !this.pageViewerState.inventoryDialogOpen());

    constructor() {
        effect(() => {
            const member = this.member();
            this.automationToasts.setVisibleUnitIds(
                this.automationToastVisibilityOwner,
                member ? [member.id] : [],
            );
        });
        this.destroyRef.onDestroy(() => this.automationToasts.clearVisibleUnitIds(
            this.automationToastVisibilityOwner,
        ));
        effect(onCleanup => {
            const member = this.member();
            if (!member) return;
            const subscription = member.force.changed.subscribe(changedUnitIds => {
                if (changedUnitIds?.includes(member.id) ?? true) {
                    this.runtimeVersion.update(value => value + 1);
                }
            });
            onCleanup(() => subscription.unsubscribe());
        });
        effect(() => {
            if (this.pageViewerState.inventoryDialogOpen()) {
                this.closeAllOverlays();
            }
        });
    }

    openTurnSummary(event: Event): void {
        event.stopPropagation();
        if (!this.turnTrackerVisible()) return;

        const member = this.member();
        if (!member) return;
        const overlayKey = `turnSummary-${member.id}`;

        // Toggle: close if already open
        if (this.overlayManager.has(overlayKey)) {
            this.overlayManager.closeManagedOverlay(overlayKey);
            return;
        }

        this.closeAllOverlays();

        const target = event.currentTarget as HTMLElement || (event.target as HTMLElement);

        const portal = new ComponentPortal(PageTurnSummaryPanelComponent, null, this.injector);

        const { componentRef } = this.overlayManager.createManagedOverlay<PageTurnSummaryPanelComponent>(overlayKey, target, portal, {
            hasBackdrop: false,
            panelClass: 'turn-summary-overlay-panel',
            closeOnOutsideClick: false,
            closeOnOutsideClickOnly: true,
            sensitiveAreaReferenceElement: this.nativeElement,
            scrollStrategy: this.overlay.scrollStrategies.reposition()
        });

        if (componentRef) {
            componentRef.setInput('member', member);
        }
    }

    openPsrWarning(event: Event): void {
        event.stopPropagation();
        if (!this.turnTrackerVisible()) return;
        const member = this.member();
        togglePsrWarningOverlay(
            isCBTMekForceMember(member) ? member : null,
            this.overlayManager,
            this.injector,
            this.overlay,
            () => this.closeAllOverlays(),
        );
    }

    openNotification({ event }: UnitNotificationActivation): void {
        this.openPsrWarning(event);
    }

    toggleUnitView(event: Event): void {
        event.stopPropagation();
        this.closeAllOverlays();
        this.unitViewMode.toggle();
    }

    openTargets(event: MouseEvent): void {
        event.stopPropagation();
        if (!this.turnTrackerVisible()) return;

        const member = this.member();
        if (!member || !this.supportsTargeting()) return;

        const overlayKey = this.targetsOverlayKey(member.id);
        if (this.targetsOverlay.has(overlayKey)) {
            this.targetsOverlay.close(overlayKey);
            return;
        }

        this.closeAllOverlays();

        const target = event.currentTarget as HTMLElement;
        this.targetsOverlay.open({
            overlayKey,
            target,
            member,
            sensitiveAreaReferenceElement: this.nativeElement
        });
    }

    openRuntimeHistory(event: MouseEvent): void {
        event.stopPropagation();
        if (!this.turnTrackerVisible()) return;
        const force = this.force();
        if (!force) return;
        const overlayKey = `${PAGE_RUNTIME_HISTORY_OVERLAY_PREFIX}-${force.instanceId() ?? 'force'}`;
        if (this.overlayManager.has(overlayKey)) {
            this.overlayManager.closeManagedOverlay(overlayKey);
            return;
        }
        this.closeAllOverlays();
        const portal = new ComponentPortal(PageRuntimeHistoryPanelComponent, null, this.injector);
        const { componentRef } = this.overlayManager.createManagedOverlay<PageRuntimeHistoryPanelComponent>(
            overlayKey,
            event.currentTarget as HTMLElement,
            portal,
            {
                hasBackdrop: false,
                panelClass: 'runtime-history-overlay-panel',
                closeOnOutsideClick: false,
                closeOnOutsideClickOnly: true,
                sensitiveAreaReferenceElement: this.nativeElement,
                scrollStrategy: this.overlay.scrollStrategies.reposition(),
            },
        );
        componentRef?.setInput('force', force);
        componentRef?.setInput('activeUnitId', this.member()?.id ?? null);
        componentRef?.setInput('selectUnit', (instanceId: string) => {
            const unit = force.members().find(candidate => candidate.id === instanceId);
            if (unit) this.forceWorkspace.selectUnit(unit);
        });
        componentRef?.setInput('close', () => this.overlayManager.closeManagedOverlay(overlayKey));
    }

    async undoRuntimeCommand(event: MouseEvent): Promise<void> {
        event.stopPropagation();
        const force = this.force();
        if (!force || !this.canUndo()) return;
        const result = await force.undoRuntimeCommand();
        if (!result.accepted) this.toastService.showToast(`Undo failed: ${result.reason}`, 'error');
    }

    async redoRuntimeCommand(event: MouseEvent): Promise<void> {
        event.stopPropagation();
        const force = this.force();
        if (!force || !this.canRedo()) return;
        const result = await force.redoRuntimeCommand();
        if (!result.accepted) this.toastService.showToast(`Redo failed: ${result.reason}`, 'error');
    }

    openWeaponEquipmentDialog(event: Event, initialTab: 'weapons' | 'ammo' = 'weapons'): void {
        event.stopPropagation();
        if (!this.turnTrackerVisible()) return;

        const member = this.member();
        if (!member) return;

        this.closeAllOverlays();
        this.pageViewerState.beginInventoryDialog();
        const ref = this.dialogsService.createDialog<void>(EquipmentDialogComponent, {
            panelClass: 'fullscreen-dialog',
            data: {
                member,
                initialTab,
                onMemberChange: selected => this.forceWorkspace.selectUnit(selected),
            } satisfies EquipmentDialogData,
        });
        ref.closed.subscribe(() => this.pageViewerState.endInventoryDialog());
    }

    private targetsOverlayKey(unitId: string): string {
        return `${PAGE_TARGETS_OVERLAY_PREFIX}-${unitId}`;
    }

    async endPhase(event: MouseEvent) {
        event.stopPropagation();
        this.closeAllOverlays();
        await this.dispatchTurnBoundary('end-phase');
    }

    async endTurn(event: MouseEvent) {
        event.stopPropagation();
        await this.dispatchTurnBoundary('end-turn');
    }

    private async dispatchTurnBoundary(type: 'end-phase' | 'end-turn'): Promise<void> {
        const member = this.member();
        const snapshot = this.turn();
        if (!member) return;
        try {
            const result = isCBTMekForceMember(member) && snapshot
                ? await member.force.dispatchMekUnitCommand(member.id, type === 'end-turn'
                    ? {
                        type,
                        policy: this.optionsService.cbtAutomationMode('heatAndDissipationResolution') === 'yes'
                            ? 'automatic'
                            : 'manual',
                    }
                    : {
                        type,
                    })
                : type === 'end-phase'
                    ? await this.dispatchEntityTurnBoundary(member, 'end-phase')
                    : await this.dispatchEntityTurnBoundary(member, 'end-turn');
            if (result === null) return;
            if (!result.accepted) {
                this.toastService.showToast('This force is read-only.', 'error');
            }
        } catch (error) {
            this.toastService.showToast(
                `Turn action failed: ${error instanceof Error ? error.message : 'unexpected error'}`,
                'error',
            );
        }
    }

    private dispatchEntityTurnBoundary(
        member: PageViewerMember,
        kind: 'end-phase' | 'end-turn',
    ) {
        const snapshot = member.force.getUnitSnapshot(member.id);
        if (!snapshot || !hasNonMekRuntime(snapshot)) return Promise.resolve(null);
        return member.force.dispatchNonMekUnitCommand(member.id, {
            kind,
        });
    }

    /**
     * Closes all currently managed overlays.
     */
    closeAllOverlays(): void {
        this.overlayManager.closeAllManagedOverlays();
        this.targetsOverlay.clearRef();
    }
}
