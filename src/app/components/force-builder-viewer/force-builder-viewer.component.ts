// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, computed, Injector, type ElementRef, effect, inject, ChangeDetectionStrategy, viewChild, viewChildren, input, signal, afterNextRender, DestroyRef } from '@angular/core';
import type { Subscription } from 'rxjs';
import { ForceBuilderService } from '../../services/force-builder.service';
import { ForceWorkspaceStateService } from '../../services/force-workspace-state.service';
import { ForceDialogsService } from '../../services/force-dialogs.service';
import { ForceRemoteSyncService } from '../../services/force-remote-sync.service';
import { ForceWorkspaceCommandsService } from '../../services/force-workspace-commands.service';
import { ASForceUnit } from '../../models/as-force-unit.model';
import { ASForce } from '../../models/as-force.model';
import { ForceFormationService } from '../../services/force-formation.service';
import { ForcePilotEditorService } from '../../services/force-pilot-editor.service';
import { LayoutService } from '../../services/layout.service';
import { OptionsService } from '../../services/options.service';
import { buildEraWarningMessage, type Force, UnitGroup } from '../../models/force.model';
import type { ForceSlot } from '../../models/force-slot.model';
import type { ForceUnit } from '../../models/force-unit.model';
import { DragDropModule, type CdkDragDrop } from '@angular/cdk/drag-drop'
import { DialogsService } from '../../services/dialogs.service';
import { UnitDetailsDialogComponent, type UnitDetailsDialogData } from '../unit-details-dialog/unit-details-dialog.component';
import { UnitBlockComponent, type UnitBlockPilotEditEvent } from '../unit-block/unit-block.component';
import { CompactModeService } from '../../services/compact-mode.service';
import { ToastService } from '../../services/toast.service';
import { formatSummaryMovement } from '../../models/pilot-abilities.model';
import { getFormationDefinition } from '../../utils/formation-blueprints';
import { formationInheritsParentEffects } from '../../utils/formation-type.model';
import { DataService } from '../../services/data.service';
import { UnitAvailabilitySourceService } from '../../services/unit-availability-source.service';
import { LobbyService } from '../../services/lobby.service';
import { TooltipDirective } from '../../directives/tooltip.directive';
import { MULFACTION_EXTINCT } from '../../models/mulfactions.model';
import {
    isCBTForceMember,
    type CBTForceMember,
    type ForceMember,
} from '../../models/force-member.model';
import { CBTForce } from '../../models/cbt-force.model';
import { ForceMemberValueComponent } from './force-member-value.component';
import { ForceReserveCrewComponent } from '../force-crew/force-reserve-crew.component';



@Component({
    selector: 'force-builder-viewer',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DragDropModule, UnitBlockComponent, TooltipDirective, ForceMemberValueComponent, ForceReserveCrewComponent],
    host: {
        '(window:keydown)': 'onKeyDown($event)',
        '(window:keyup)': 'onKeyUp($event)',
        '(window:blur)': 'onWindowBlur()',
    },
    templateUrl: './force-builder-viewer.component.html',
    styleUrl: './force-builder-viewer.component.scss'
})
export class ForceBuilderViewerComponent {
    protected forceBuilderService = inject(ForceBuilderService);
    protected readonly forceWorkspace = inject(ForceWorkspaceStateService);
    private readonly forceDialogs = inject(ForceDialogsService);
    private readonly remoteSync = inject(ForceRemoteSyncService);

    protected readonly forceCommands = inject(ForceWorkspaceCommandsService);
    private readonly formations = inject(ForceFormationService);
    private readonly pilotEditor = inject(ForcePilotEditorService);
    protected toastService = inject(ToastService);
    protected layoutService = inject(LayoutService);
    compactModeService = inject(CompactModeService);
    private dialogsService = inject(DialogsService);
    protected optionsService = inject(OptionsService);
    private injector = inject(Injector);
    private dataService = inject(DataService);
    protected readonly lobbyService = inject(LobbyService);
    private unitAvailabilitySource = inject(UnitAvailabilitySourceService);
    private scrollableContent = viewChild<ElementRef<HTMLDivElement>>('scrollableContent');
    protected readonly newGroupDropData: ForceMember[] = [];

    forceUnitItems = viewChildren<ElementRef<HTMLElement>>('forceUnitItem');
    private forceSlotHeaders = viewChildren<ElementRef<HTMLElement>>('forceSlotHeader');

    miniMode = input<boolean>(false);

    loadedSlots = computed(() => this.forceWorkspace.filteredLoadedForces());

    compactMode = computed(() => {
        return this.compactModeService.compactMode();
    });

    /**
     * Alignment styling (friendly/enemy) is shown on non-owned forces only when:
     * - at least one owned force is loaded, OR
     * - both friendly and enemy forces are loaded
     * Uses unfiltered loadedForces so coloring persists even when filtering by alignment.
     */
    // showAlignmentStyling = computed<boolean>(() => {
    //     const slots = this.forceWorkspace.loadedForces();
    //     if (slots.length < 2) return false;
    //     const hasOwned = slots.some(s => !s.force.readOnly());
    //     if (hasOwned) return true;
    //     const alignments = new Set(slots.map(s => s.alignment));
    //     return alignments.has('friendly') && alignments.has('enemy');
    // });

    hasOwnedForce = computed<boolean>(() => this.forceWorkspace.loadedForces().some(s => !s.force.readOnly()));

    forceEraWarning(force: Force): string | null {
        const eras = this.dataService.getEras();
        const summaries = force.members().flatMap(member => {
            if (!isCBTForceMember(member)) return [member.getSummary()];
            const uuid = member.force.getUnitUuid(member.id);
            const summary = uuid
                ? this.dataService.getUnitByUuid(uuid)
                : undefined;
            return summary ? [summary] : [];
        });
        const availabilityContext = this.unitAvailabilitySource.createForceAvailabilityContextForUnits(
            summaries,
            eras,
        );
        const extinctFaction = this.dataService.getFactionById(MULFACTION_EXTINCT) ?? null;

        return buildEraWarningMessage(
            summaries,
            force.era(),
            force.faction(),
            eras,
            extinctFaction,
            availabilityContext,
            (faction, era) => this.unitAvailabilitySource.factionExistsInEra(faction, era, availabilityContext.source),
        );
    }

    /** Set of Force instances whose headers are currently blinking (remote update on visible force). */
    blinkingForces = signal<Set<Force>>(new Set());
    private blinkTimeouts = new Map<Force, ReturnType<typeof setTimeout>>();
    private remoteUpdateSub: Subscription | null = null;

    /** Combined CBT members across all visible loaded forces. */
    combinedBvMembers = computed(() => this.loadedSlots()
            .filter(slot => slot.force.gameSystem !== 'as')
            .flatMap(slot => slot.force.members()));

    /** Combined Alpha Strike members across all visible loaded forces. */
    combinedPvMembers = computed(() => this.loadedSlots()
            .filter(slot => slot.force.gameSystem === 'as')
            .flatMap(slot => slot.force.members()));

    // --- Collapsed/Expanded State ---
    /** Set of group IDs that are currently collapsed. */
    private collapsedGroups = signal<Set<string>>(new Set());

    /** Returns true when ALL groups in the force are collapsed. */
    isForceCollapsed(force: Force): boolean {
        const groups = force.groups();
        if (groups.length === 0) return false;
        const set = this.collapsedGroups();
        return groups.every(g => set.has(g.id));
    }

    isGroupCollapsed(groupId: string): boolean {
        return this.collapsedGroups().has(groupId);
    }

    /** Toggle all groups in the force: if all collapsed -> expand all, otherwise collapse all. */
    toggleForceCollapsed(event: MouseEvent, force: Force) {
        event.stopPropagation();
        const groups = force.groups();
        const allCollapsed = this.isForceCollapsed(force);
        this.collapsedGroups.update(set => {
            const next = new Set(set);
            for (const g of groups) {
                if (allCollapsed) next.delete(g.id); else next.add(g.id);
            }
            return next;
        });
    }

    toggleGroupCollapsed(event: MouseEvent, groupId: string) {
        event.stopPropagation();
        this.collapsedGroups.update(set => {
            const next = new Set(set);
            if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
            return next;
        });
    }

    // --- Gesture State ---
    public readonly isUnitDragging = signal<boolean>(false); // Flag for unit drag/sorting
    public readonly isGroupDragging = signal<boolean>(false); // Flag for group drag/reorder
    public readonly isForceDragging = signal<boolean>(false); // Flag for force-slot reorder
    public readonly ctrlHeld = signal<boolean>(false);
    private headerResizeObserver?: ResizeObserver;

    //Units autoscroll
    private autoScrollVelocity = signal<number>(0);     // px/sec (+ down, - up)
    private autoScrollRafId?: number;
    private lastAutoScrollTs?: number;
    private readonly AUTOSCROLL_EDGE = 80;   // px threshold from edge to start scrolling
    private readonly AUTOSCROLL_MAX = 800;  // px/sec max scroll speed (deepest in edge zone)
    private readonly AUTOSCROLL_MIN = 10;   // px/sec at the outer boundary of the edge zone

    constructor() {
        // Track pending afterNextRender to clean up on effect re-run or destroy
        let pendingScrollRef: { destroy: () => void } | null = null;
        
        effect(() => {
            const selected = this.forceWorkspace.selectedUnit();
            // Also track filter changes so we scroll even when the unit stays the same
            this.forceWorkspace.alignmentFilter();
            // Cancel any previous pending scroll callback
            pendingScrollRef?.destroy();
            pendingScrollRef = null;
            
            if (selected) {
                pendingScrollRef = afterNextRender(() => {
                    pendingScrollRef = null;
                    this.scrollToUnit(selected.id);
                }, { injector: this.injector });
            }
        });
        
        // Observe force-slot-header heights for two-level sticky positioning
        effect(() => {
            const headers = this.forceSlotHeaders();
            this.setupHeaderObserver(headers);
        });

        // Subscribe to remote force updates for header blink
        this.remoteUpdateSub = this.remoteSync.remoteForceUpdated$.subscribe(({ force, alignment }) => {
            if (!this.forceWorkspace.hasMixedAlignments()) return;
            const filter = this.forceWorkspace.alignmentFilter();
            // Blink header when the updated force IS visible (filter matches or filter is 'all')
            const isVisible = filter === 'all' || filter === alignment;
            if (isVisible) {
                // Clear any existing timeout for this force
                const existing = this.blinkTimeouts.get(force);
                if (existing) clearTimeout(existing);
                // Add to blinking set
                this.blinkingForces.update(set => { const next = new Set(set); next.add(force); return next; });
                // Remove after 2 seconds
                const timeout = setTimeout(() => {
                    this.blinkingForces.update(set => { const next = new Set(set); next.delete(force); return next; });
                    this.blinkTimeouts.delete(force);
                }, 2000);
                this.blinkTimeouts.set(force, timeout);
            }
        });

        inject(DestroyRef).onDestroy(() => {
            pendingScrollRef?.destroy();
            this.stopAutoScrollLoop();
            this.headerResizeObserver?.disconnect();
            this.remoteUpdateSub?.unsubscribe();
            for (const timeout of this.blinkTimeouts.values()) clearTimeout(timeout);
            this.blinkTimeouts.clear();
        });
    }

    onKeyDown(event: KeyboardEvent) {
        if (event.key === 'Control') this.ctrlHeld.set(true);
    }

    onKeyUp(event: KeyboardEvent) {
        if (event.key === 'Control') this.ctrlHeld.set(false);
    }

    onWindowBlur() {
        this.ctrlHeld.set(false);
    }

    onUnitKeydown(event: KeyboardEvent, _index: number) {
        // Build a flat list of all visible units across all filtered forces
        const slots = this.loadedSlots();
        const allUnits: ForceMember[] = [];
        for (const slot of slots) {
            allUnits.push(...slot.force.members());
        }
        if (allUnits.length === 0) return;

        const selected = this.forceWorkspace.selectedUnit();
        const currentIdx = selected ? allUnits.findIndex(u => u.id === selected.id) : -1;
        const items = this.forceUnitItems();

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            // Wrap to first unit when at the end
            const nextIdx = currentIdx < allUnits.length - 1 ? currentIdx + 1 : 0;
            items?.[nextIdx]?.nativeElement.focus();
            this.selectUnit(allUnits[nextIdx]);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            // Wrap to last unit when at the start
            const prevIdx = currentIdx > 0 ? currentIdx - 1 : allUnits.length - 1;
            items?.[prevIdx]?.nativeElement.focus();
            this.selectUnit(allUnits[prevIdx]);
        }
    }

    selectUnit(unit: ForceMember) {
        this.forceWorkspace.selectUnit(unit);
        if (this.layoutService.isMobile()) {
            this.layoutService.closeMenu();
        }
    }

    async removeUnit(event: MouseEvent, unit: ForceMember) {
        event.stopPropagation();
        await this.forceCommands.removeUnit(unit, event.ctrlKey);
        // If this was the last unit, close the menu (offcanvas OFF mode)
        if (!this.forceWorkspace.hasForces()) {
            this.layoutService.closeMenu();
        }
    }

    async cloneUnit(event: MouseEvent, unit: ForceMember) {
        event.stopPropagation();
        await this.forceCommands.cloneUnit(unit);
    }

    async repairUnit(event: MouseEvent, unit: ForceMember) {
        event.stopPropagation();
        return this.forceCommands.repairUnit(unit);
    }

    showUnitInfo(event: MouseEvent, unit: ForceMember) {
        event.stopPropagation();
        if (isCBTForceMember(unit)) {
            const unitList = unit.force.members();
            const unitIndex = unitList.findIndex(member => member.id === unit.id);
            if (unitIndex < 0) return;
            this.dialogsService.createDialog(UnitDetailsDialogComponent, {
                data: <UnitDetailsDialogData>{
                    unitList: unit.force.members,
                    unitIndex,
                    hideAddButton: true,
                },
            });
            return;
        }
        const force = unit.force;
        const unitList = force.units();
        if (!unitList) return;
        const unitIndex = unitList.findIndex(u => u.id === unit.id);
        this.dialogsService.createDialog(UnitDetailsDialogComponent, {
            data: <UnitDetailsDialogData>{
                unitList: force.units,
                unitIndex: unitIndex
            }
        });

    }

    async openC3Network(event: MouseEvent, unit: ForceMember) {
        event.stopPropagation();
        await this.forceDialogs.openC3Network(
            unit.force,
            isCBTForceMember(unit) ? unit.force.readOnly() : unit.readOnly(),
        );
    }

    async editPilot({ event }: UnitBlockPilotEditEvent, unit: ForceMember) {
        if (unit.force.readOnly()) return;
        event.stopPropagation();
        if (isCBTForceMember(unit)) {
            await this.pilotEditor.editCBTMember(unit.force, unit.id);
        } else if (unit instanceof ASForceUnit) {
            await this.pilotEditor.editAlphaStrikeUnit(unit);
        }
    }


    toggleMenu() {
        this.layoutService.toggleMenu();
    }

    onUnitDragStart(force: Force) {
        if (force.readOnly()) return;
        this.isUnitDragging.set(true);
        // Disable native scroll so it doesn't fight CDK drag
        const el = this.scrollableContent()?.nativeElement;
        if (el) el.style.overflowY = 'hidden';
        // Force CDK to recalculate drop list positions after the new-group-dropzone
        // becomes visible (it transitions from max-height:0 to full size).
        // Without this, CDK uses stale rects and won't accept drops on the dropzone.
        requestAnimationFrame(() => {
            el?.dispatchEvent(new Event('scroll'));
        });
    }

    onUnitDragMoved() {
        const scrollRef = this.scrollableContent?.();
        if (!scrollRef) {
            this.stopAutoScrollLoop();
            return;
        }
        const container = scrollRef.nativeElement as HTMLElement;
        const containerRect = container.getBoundingClientRect();

        // Use the drag preview (ghost) element's edges for distance calculation
        const preview = document.querySelector('.cdk-drag-preview') as HTMLElement;
        if (!preview) {
            this.stopAutoScrollLoop();
            return;
        }
        const previewRect = preview.getBoundingClientRect();

        // Distance from the ghost's top edge to the container's top edge
        const topDist = previewRect.top - containerRect.top;
        // Distance from the ghost's bottom edge to the container's bottom edge
        const bottomDist = containerRect.bottom - previewRect.bottom;

        let ratio = 0;
        if (topDist < this.AUTOSCROLL_EDGE && topDist <= bottomDist) {
            ratio = (this.AUTOSCROLL_EDGE - topDist) / this.AUTOSCROLL_EDGE; // 0..1
            ratio = Math.max(0, Math.min(1, ratio));
            const speed = this.AUTOSCROLL_MIN + ratio * (this.AUTOSCROLL_MAX - this.AUTOSCROLL_MIN);
            this.autoScrollVelocity.set(-speed);
        } else if (bottomDist < this.AUTOSCROLL_EDGE && bottomDist < topDist) {
            ratio = (this.AUTOSCROLL_EDGE - bottomDist) / this.AUTOSCROLL_EDGE;
            ratio = Math.max(0, Math.min(1, ratio));
            const speed = this.AUTOSCROLL_MIN + ratio * (this.AUTOSCROLL_MAX - this.AUTOSCROLL_MIN);
            this.autoScrollVelocity.set(speed);
        } else {
            this.autoScrollVelocity.set(0);
        }

        if (Math.abs(this.autoScrollVelocity()) > 0.5) {
            this.startAutoScrollLoop();
        } else {
            this.stopAutoScrollLoop();
        }
    }

    onUnitDragEnd(force: Force) {
        if (force.readOnly()) return;
        this.stopAutoScrollLoop();
        this.isUnitDragging.set(false);
        // Restore native scroll
        const el = this.scrollableContent()?.nativeElement;
        if (el) el.style.overflowY = 'auto';
    }

    onGroupDragStart(force: Force) {
        if (force.readOnly()) return;
        this.isGroupDragging.set(true);
        const el = this.scrollableContent()?.nativeElement;
        if (el) el.style.overflowY = 'hidden';
    }

    onGroupDragEnd(force: Force) {
        if (force.readOnly()) return;
        this.stopAutoScrollLoop();
        this.isGroupDragging.set(false);
        const el = this.scrollableContent()?.nativeElement;
        if (el) el.style.overflowY = 'auto';
    }


    private startAutoScrollLoop() {
        if (this.autoScrollRafId) return;
        this.lastAutoScrollTs = performance.now();
        const step = (ts: number) => {
            // If RAF was cancelled, abort
            if (!this.autoScrollRafId) return;
            const last = this.lastAutoScrollTs ?? ts;
            // clamp dt to avoid huge jumps
            const dt = Math.min(100, ts - last) / 1000;
            this.lastAutoScrollTs = ts;

            const v = this.autoScrollVelocity();
            if (Math.abs(v) > 0.5) {
                const scrollRef = this.scrollableContent?.();
                if (scrollRef) {
                    const el = scrollRef.nativeElement as HTMLElement;
                    const delta = v * dt;
                    // clamp new scrollTop inside scrollable range
                    el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + delta));
                }
                this.autoScrollRafId = requestAnimationFrame(step);
            } else {
                this.stopAutoScrollLoop();
            }
        };
        this.autoScrollRafId = requestAnimationFrame(step);
    }

    private stopAutoScrollLoop() {
        if (this.autoScrollRafId) {
            cancelAnimationFrame(this.autoScrollRafId);
            this.autoScrollRafId = undefined;
        }
        this.autoScrollVelocity.set(0);
        this.lastAutoScrollTs = undefined;
    }

    /**
     * Sets up a ResizeObserver on force-slot-header elements so that
     * --force-header-height is kept in sync on each .force-slot.
     * Group headers use this variable for their sticky top offset.
     */
    private setupHeaderObserver(headers: readonly ElementRef<HTMLElement>[]) {
        this.headerResizeObserver?.disconnect();
        if (headers.length === 0) return;

        this.headerResizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const el = entry.target as HTMLElement;
                const forceSlot = el.closest('.force-slot') as HTMLElement;
                if (forceSlot) {
                    forceSlot.style.setProperty('--force-header-height', `${el.offsetHeight}px`);
                }
            }
        });

        for (const header of headers) {
            this.headerResizeObserver.observe(header.nativeElement);
        }
    }

    async drop(event: CdkDragDrop<ForceMember[]>) {
        const groupIdFromContainer = (id?: string) => id && id.startsWith('group-') ? id.substring('group-'.length) : null;

        const fromGroupId = groupIdFromContainer(event.previousContainer?.id);
        const toGroupId = groupIdFromContainer(event.container?.id);

        if (!fromGroupId || !toGroupId) return;

        // Find which force contains the source and target groups
        const fromResult = this.findGroupAndForce(fromGroupId);
        const toResult = this.findGroupAndForce(toGroupId);
        if (!fromResult || !toResult) return;

        const { force: fromForce, group: fromGroup } = fromResult;
        const { force: toForce, group: toGroup } = toResult;

        // Prevent drops onto readonly forces
        if (toForce.readOnly()) return;
        
        // No-op if same group and same index
        if (fromGroup === toGroup && event.previousIndex === event.currentIndex) {
            return;
        }

        const movingMember = this.membersInGroup(fromForce, fromGroup)[event.previousIndex];
        if (isCBTForceMember(movingMember)) {
            if (!(fromForce instanceof CBTForce)) return;
            if (!(toForce instanceof CBTForce)) {
                this.toastService.showToast(
                    'Converting a live CBT unit to Alpha Strike is not supported yet.',
                    'error',
                );
                return;
            }
            if (fromForce !== toForce) {
                if (fromForce.readOnly() || !await this.confirmEmptyForceAfterTransfer(fromForce)) return;
                await this.transferMemberBetweenForces(
                    movingMember,
                    fromForce,
                    fromGroup,
                    toForce,
                    toGroup,
                    event.currentIndex,
                );
                return;
            }
            const moved = await fromForce.moveMember(movingMember.id, toGroup.id, event.currentIndex);
            if (!moved.accepted) {
                this.toastService.showToast(`Could not move unit: ${moved.reason}`, 'error');
                return;
            }
            await this.formations.assignFormationIfNeeded(fromGroup);
            if (fromGroup !== toGroup) await this.formations.assignFormationIfNeeded(toGroup);
            this.forceWorkspace.selectUnit(fromForce.getCBTMember(movingMember.id));
            return;
        }

        if (fromForce === toForce) {
            // Same force: reorder within or between groups
            let movedUnit: ForceUnit | undefined;
            if (fromGroup === toGroup) {
                fromGroup.reorderUnit(event.previousIndex, event.currentIndex);
                movedUnit = fromGroup.units()[event.currentIndex];
            } else {
                movedUnit = fromGroup.moveUnitTo(event.previousIndex, toGroup, event.currentIndex) ?? undefined;
                if (!movedUnit) return;
                await this.formations.assignFormationIfNeeded(fromGroup);
                await this.formations.assignFormationIfNeeded(toGroup);
            }
            if (fromForce instanceof ASForce) fromForce.removeEmptyGroups();
            if (fromForce.instanceId()) {
                fromForce.emitChanged();
            }
            // Re-trigger selection so downstream views (e.g. alpha-strike-viewer) refocus
            if (movedUnit) this.forceWorkspace.selectUnit(movingMember);
        } else {
            // Cross-force move: remove from source force, add to target force
            if (fromForce.readOnly()) return; // can't remove from read-only

            // Cross-game-system check: confirm conversion before any mutation
            const crossSystem = fromForce.gameSystem !== toForce.gameSystem;
            if (crossSystem) {
                const fromLabel = fromForce.gameSystem === 'as' ? 'Alpha Strike' : 'Classic BattleTech';
                const toLabel = toForce.gameSystem === 'as' ? 'Alpha Strike' : 'Classic BattleTech';
                const confirmed = await this.dialogsService.requestConfirmation(
                    `The unit will be converted from ${fromLabel} to ${toLabel}. Damage state and game-specific data will not be carried over. Continue?`,
                    'Game System Mismatch',
                    'danger'
                );
                if (!confirmed) return;
            }

            // Check if this move would empty the source force: confirm before mutating
            const wouldEmptyForce = fromForce.units().length === 1;
            if (wouldEmptyForce) {
                const answer = await this.dialogsService.choose(
                    'Remove Empty Force',
                    `Moving this unit will leave "${fromForce.displayName()}" empty. The empty force will be removed. Continue?`,
                    [
                        { label: 'CONFIRM', value: 'confirm' },
                        { label: 'CANCEL', value: 'cancel' }
                    ],
                    'cancel'
                );
                if (answer === 'cancel') return;
            }

            // Conversion may be rejected by the CBT mechanics admission gate.
            // Build it before removing anything so a rejected drag is lossless.
            const sourceUnitToConvert = fromGroup.units()[event.previousIndex];
            const preparedConversion = crossSystem
                ? await this.prepareCrossSystemConversion(
                    sourceUnitToConvert,
                    fromForce,
                    toForce,
                )
                : null;
            if (crossSystem && !preparedConversion) return;
            if (fromGroup.units()[event.previousIndex] !== sourceUnitToConvert) {
                return;
            }

            const unitToInsert = fromGroup.transferUnitTo(
                event.previousIndex,
                toGroup,
                event.currentIndex,
                crossSystem ? preparedConversion! : undefined,
            );
            if (!unitToInsert) {
                return;
            }
            this.formations.generateFactionAndForceNameIfNeeded(fromForce);
            this.formations.generateFactionAndForceNameIfNeeded(toForce);
            await this.formations.assignFormationIfNeeded(fromGroup);
            await this.formations.assignFormationIfNeeded(toGroup);
            toForce.deduplicateIds();
            if (fromForce instanceof ASForce) fromForce.removeEmptyGroups();

            // Select the inserted unit
            this.forceWorkspace.selectUnit(
                toForce.members().find(member => member.id === unitToInsert.id) ?? null,
            );

            if (wouldEmptyForce) {
                if (toForce.instanceId()) toForce.emitChanged();
                this.forceBuilderService.deleteAndRemoveForce(fromForce);
            } else {
                if (fromForce.instanceId()) fromForce.emitChanged();
                if (toForce.instanceId()) toForce.emitChanged();
            }
        }
    }

    private async confirmEmptyForceAfterTransfer(source: CBTForce): Promise<boolean> {
        if (source.members().length !== 1) return true;
        return await this.dialogsService.choose(
            'Remove Empty Force',
            `Moving this unit will leave "${source.displayName()}" empty. The empty force will be removed. Continue?`,
            [
                { label: 'CONFIRM', value: 'confirm' },
                { label: 'CANCEL', value: 'cancel' },
            ],
            'cancel',
        ) === 'confirm';
    }

    private async transferMemberBetweenForces(
        member: CBTForceMember,
        source: CBTForce,
        sourceGroup: UnitGroup,
        target: CBTForce,
        targetGroup: UnitGroup,
        atIndex: number,
    ): Promise<boolean> {
        const removeEmptySource = source.members().length === 1;
        const transferred = await source.transferMemberTo(target, member.id, targetGroup.id, atIndex);
        if (!transferred.accepted) {
            this.toastService.showToast(`Could not move unit: ${transferred.reason}`, 'error');
            return false;
        }

        this.formations.generateFactionAndForceNameIfNeeded(target);
        if (!removeEmptySource) this.formations.generateFactionAndForceNameIfNeeded(source);
        await this.formations.assignFormationIfNeeded(sourceGroup);
        await this.formations.assignFormationIfNeeded(targetGroup);
        this.forceWorkspace.selectUnit(target.getCBTMember(member.id));
        if (removeEmptySource) await this.forceBuilderService.deleteAndRemoveForce(source);
        return true;
    }

    /** Finds a group and its owning force across all loaded forces. */
    private findGroupAndForce(groupId: string): { force: Force; group: UnitGroup } | null {
        for (const slot of this.forceWorkspace.loadedForces()) {
            const group = slot.force.groups().find(g => g.id === groupId);
            if (group) return { force: slot.force, group };
        }
        return null;
    }

    groupsDragDisabled = computed(() => {
        const forces = this.forceWorkspace.filteredLoadedForces();
        // Allow group dragging if there's more than one force, or if the single loaded force has multiple groups (otherwise there's no point in dragging)
        return (forces.length === 1 && forces[0].force.groups().length < 2);
    });

    connectedDropLists = computed(() => {
        const ids: string[] = [];
        const collapsed = this.collapsedGroups();
        const showDropzones = !this.compactMode() && !this.miniMode() && !this.isGroupDragging();
        for (const slot of this.forceWorkspace.filteredLoadedForces()) {
            if (slot.force.readOnly()) continue; // exclude read-only forces from drop targets
            for (const g of slot.force.groups()) {
                if (collapsed.has(g.id)) continue; // collapsed groups have no cdkDropList in DOM
                ids.push(`group-${g.id}`);
            }
            if (showDropzones) {
                ids.push(`new-group-dropzone-${slot.force.instanceId() || slot.force.name}`);
            }
        }
        return ids;
    });

    async dropForNewGroup(event: CdkDragDrop<ForceMember[], ForceMember[], unknown>) {
        // Determine target force from the per-force dropzone container ID
        const containerId = event.container.id;
        const prefix = 'new-group-dropzone-';
        if (!containerId.startsWith(prefix)) return;
        const forceKey = containerId.substring(prefix.length);
        const targetSlot = this.forceWorkspace.loadedForces().find(s =>
            (s.force.instanceId() || s.force.name) === forceKey
        );
        if (!targetSlot || targetSlot.force.readOnly()) return;
        const targetForce = targetSlot.force;

        // Find source group across all loaded forces
        const prevId = event.previousContainer?.id;
        if (!prevId || !prevId.startsWith('group-')) return;
        const sourceGroupId = prevId.substring('group-'.length);
        const sourceResult = this.findGroupAndForce(sourceGroupId);
        if (!sourceResult) return;
        const { force: sourceForce, group: sourceGroup } = sourceResult;

        const movingMember = this.membersInGroup(sourceForce, sourceGroup)[event.previousIndex];
        if (isCBTForceMember(movingMember)) {
            if (!(sourceForce instanceof CBTForce)) return;
            if (!(targetForce instanceof CBTForce)) {
                this.toastService.showToast(
                    'Converting a live CBT unit to Alpha Strike is not supported yet.',
                    'error',
                );
                return;
            }
            if (sourceForce !== targetForce
                && (sourceForce.readOnly() || !await this.confirmEmptyForceAfterTransfer(sourceForce))) return;
            const newGroup = await targetForce.addGroup();
            if (sourceForce !== targetForce) {
                const transferred = await this.transferMemberBetweenForces(
                    movingMember,
                    sourceForce,
                    sourceGroup,
                    targetForce,
                    newGroup,
                    0,
                );
                if (!transferred) await targetForce.removeGroup(newGroup);
                return;
            }
            const moved = await sourceForce.moveMember(movingMember.id, newGroup.id, 0);
            if (!moved.accepted) {
                await targetForce.removeGroup(newGroup);
                this.toastService.showToast(`Could not move unit: ${moved.reason}`, 'error');
                return;
            }
            await this.formations.assignFormationIfNeeded(sourceGroup);
            await this.formations.assignFormationIfNeeded(newGroup);
            this.forceWorkspace.selectUnit(sourceForce.getCBTMember(movingMember.id));
            return;
        }

        const crossForce = sourceForce !== targetForce;
        const crossSystem = crossForce && sourceForce.gameSystem !== targetForce.gameSystem;

        // Cross-game-system confirmation
        if (crossSystem) {
            const fromLabel = sourceForce.gameSystem === 'as' ? 'Alpha Strike' : 'Classic BattleTech';
            const toLabel = targetForce.gameSystem === 'as' ? 'Alpha Strike' : 'Classic BattleTech';
            const confirmed = await this.dialogsService.requestConfirmation(
                `The unit will be converted from ${fromLabel} to ${toLabel}. Damage state and game-specific data will not be carried over. Continue?`,
                'Game System Mismatch',
                'danger'
            );
            if (!confirmed) return;
        }

        // Check if this move would empty the source force
        const wouldEmptyForce = crossForce && sourceForce.units().length === 1;
        if (wouldEmptyForce) {
            const answer = await this.dialogsService.choose(
                'Remove Empty Force',
                `Moving this unit will leave "${sourceForce.displayName()}" empty. The empty force will be removed. Continue?`,
                [
                    { label: 'CONFIRM', value: 'confirm' },
                    { label: 'CANCEL', value: 'cancel' }
                ],
                'cancel'
            );
            if (answer === 'cancel') return;
        }

        // As above, prepare before creating a group or removing the source.
        const sourceUnitToConvert = sourceGroup.units()[event.previousIndex];
        const preparedConversion = crossSystem
            ? await this.prepareCrossSystemConversion(
                sourceUnitToConvert,
                sourceForce,
                targetForce,
            )
            : null;
        if (crossSystem && !preparedConversion) return;
        if (sourceGroup.units()[event.previousIndex] !== sourceUnitToConvert) {
            return;
        }

        // Create the destination group first, then use the atomic two-owner
        // transfer seam so a stale target cannot lose the source unit.
        const newGroup = await targetForce.addGroup();
        if (!newGroup) return;
        const unitToInsert = sourceGroup.transferUnitTo(
            event.previousIndex,
            newGroup,
            undefined,
            crossSystem ? preparedConversion! : undefined,
        );
        if (!unitToInsert) {
            await targetForce.removeGroup(newGroup);
            return;
        }
        if (crossForce) {
            this.formations.generateFactionAndForceNameIfNeeded(targetForce);
            this.formations.generateFactionAndForceNameIfNeeded(sourceForce);
        }
        await this.formations.assignFormationIfNeeded(sourceGroup);
        await this.formations.assignFormationIfNeeded(newGroup);
        if (sourceForce instanceof ASForce) sourceForce.removeEmptyGroups();
        if (crossForce) targetForce.deduplicateIds();

        // Select the moved unit
        this.forceWorkspace.selectUnit(
            targetForce.members().find(member => member.id === unitToInsert.id) ?? null,
        );

        if (wouldEmptyForce) {
            if (targetForce.instanceId()) targetForce.emitChanged();
            this.forceBuilderService.deleteAndRemoveForce(sourceForce);
        } else {
            if (sourceForce.instanceId()) sourceForce.emitChanged();
            if (crossForce && targetForce.instanceId()) targetForce.emitChanged();
        }
    }

    membersInGroup(force: Force, group: UnitGroup): ForceMember[] {
        return force.membersInGroup(group);
    }

    groupMemberCount(force: Force, group: UnitGroup): number {
        return this.membersInGroup(force, group).length;
    }

    private async prepareCrossSystemConversion(
        sourceUnit: ForceUnit | undefined,
        sourceForce: Force,
        targetForce: Force,
    ): Promise<ASForceUnit | null> {
        if (!(sourceUnit instanceof ASForceUnit)) return null;
        try {
            const converted = await this.forceCommands.convertUnitForForce(sourceUnit, sourceForce, targetForce);
            if (!converted) {
                this.toastService.showToast('Could not convert unit: not found in the database.', 'error');
            }
            return converted;
        } catch (error) {
            this.toastService.showToast(
                error instanceof Error ? error.message : 'Could not convert unit.',
                'error',
            );
            return null;
        }
    }

    private async prepareCrossSystemConversions(
        sourceUnits: readonly ForceUnit[],
        sourceForce: Force,
        targetForce: Force,
    ): Promise<ASForceUnit[] | null> {
        const convertedUnits: ASForceUnit[] = [];
        for (const sourceUnit of sourceUnits) {
            const converted = await this.prepareCrossSystemConversion(sourceUnit, sourceForce, targetForce);
            if (converted) {
                convertedUnits.push(converted);
                continue;
            }
            return null;
        }
        return convertedUnits;
    }

    private scrollToUnit(id: string) {
        const scrollContainer = this.scrollableContent()?.nativeElement;
        if (!scrollContainer) return;
        const unitElement = scrollContainer.querySelector(`#unit-${CSS.escape(id)}`) as HTMLElement;
        if (!unitElement) return;

        // Calculate the total height of sticky headers (force-slot-header + group-header)
        // that overlap the scroll area, so we can offset the scroll position.
        const forceSlot = unitElement.closest('.force-slot') as HTMLElement | null;
        let stickyOffset = 0;
        if (forceSlot) {
            const slotHeader = forceSlot.querySelector('.force-slot-header') as HTMLElement | null;
            if (slotHeader) stickyOffset += slotHeader.offsetHeight;
        }
        const groupContainer = unitElement.closest('.group-container') as HTMLElement | null;
        if (groupContainer) {
            const groupHeader = groupContainer.querySelector('.group-header') as HTMLElement | null;
            if (groupHeader) stickyOffset += groupHeader.offsetHeight;
        }

        const containerRect = scrollContainer.getBoundingClientRect();
        const unitRect = unitElement.getBoundingClientRect();

        // If unit is above the visible area (behind sticky headers), scroll up
        const visibleTop = containerRect.top + stickyOffset;
        if (unitRect.top < visibleTop) {
            scrollContainer.scrollBy({ top: unitRect.top - visibleTop, behavior: 'smooth' });
        } else if (unitRect.bottom > containerRect.bottom) {
            // If unit is below the visible area, scroll down
            scrollContainer.scrollBy({ top: unitRect.bottom - containerRect.bottom, behavior: 'smooth' });
        }
    }

    promptChangeForceName(force: Force) {
        if (force.readOnly()) return;
        void this.forceDialogs.promptChangeForceName(force);
    }

    promptChangeGroupName(group: UnitGroup) {
        if (group.force.readOnly()) return;
        void this.forceDialogs.promptChangeGroupName(group);
    }

    showFormationInfo(event: MouseEvent, group: UnitGroup) {
        event.stopPropagation();
        this.formations.showFormationInfo(group);
    }

    /** Build tooltip HTML for a mismatched formation, including formatted requirements if available. */
    getFormationMismatchTitle(group: UnitGroup): string {
        const formation = group.formation();
        if (!formation) return 'Formation does not match group composition';

        const parts: string[] = [];
        const showParentRequirements = formationInheritsParentEffects(formation) && !!formation.parent;

        if (showParentRequirements) {
            const parent = getFormationDefinition(formation.parent!, group.force.gameSystem);
            if (parent?.requirements) {
                const parentReq = parent.requirements;
                if (parentReq) parts.push(this.buildFormationRequirementTooltipLine(parent.name, parentReq));
            }
        }

        if (formation.requirements) {
            const req = formation.requirements;
            if (req) parts.push(this.buildFormationRequirementTooltipLine(showParentRequirements ? formation.name : null, req));
        }

        return parts.length > 0 ? parts.join('') : 'Formation does not match group composition';
    }

    private buildFormationRequirementTooltipLine(label: string | null, requirements: string): string {
        const formattedRequirements = formatSummaryMovement(requirements, this.optionsService.options().ASUseHex);
        return label
            ? `<div><strong>${label}:</strong> ${formattedRequirements}</div>`
            : `<div>${formattedRequirements}</div>`;
    }

    shareForce() {
        this.forceDialogs.shareForce(this.forceWorkspace.currentForce());
    }

    onEmptyGroupClick(group: UnitGroup) {
        const result = this.findGroupAndForce(group.id);
        if (!result || result.force.readOnly()) return;
        if (group.formationUnits().length === 0) {
            this.forceCommands.removeGroup(group);
        }
    }

    async addGroup(force: Force): Promise<void> {
        try {
            await force.addGroup();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.toastService.showToast(`Could not add group: ${message}`, 'error');
        }
    }

    removeGroup(event: MouseEvent, group: UnitGroup) {
        event.stopPropagation();
        this.forceCommands.removeGroup(group);
    }

    /** Connected group drop list IDs for group drag-drop (only non-readonly forces) */
    connectedGroupDropLists(): string[] {
        const ids: string[] = [];
        for (const slot of this.forceWorkspace.filteredLoadedForces()) {
            if (slot.force.readOnly()) continue;
            ids.push(`force-groups-${slot.force.instanceId() || slot.force.name}`);
        }
        return ids;
    }

    /** Handle group drag-drop for reordering within a force or moving between forces */
    async dropGroup(event: CdkDragDrop<UnitGroup[]>) {
        const fromForceId = event.previousContainer.id;
        const toForceId = event.container.id;

        const findForceByContainerId = (containerId: string): Force | undefined => {
            for (const slot of this.forceWorkspace.loadedForces()) {
                const id = `force-groups-${slot.force.instanceId() || slot.force.name}`;
                if (id === containerId) return slot.force;
            }
            return undefined;
        };

        const fromForce = findForceByContainerId(fromForceId);
        const toForce = findForceByContainerId(toForceId);
        if (!fromForce || !toForce) return;
        if (toForce.readOnly()) return;

        if (fromForce === toForce) {
            // Reorder groups within the same force
            await fromForce.reorderGroup(event.previousIndex, event.currentIndex);
            // Re-trigger selection so downstream views refocus
            const selected = this.forceWorkspace.selectedUnit();
            if (selected) this.forceWorkspace.selectUnit(selected);
        } else {
            // Move group between forces
            if (fromForce.readOnly()) return;
            if (fromForce instanceof CBTForce || toForce instanceof CBTForce) {
                this.toastService.showToast(
                    'Moving a live CBT group between forces is not supported yet.',
                    'error',
                );
                return;
            }

            // Cross-game-system check: confirm conversion before any mutation
            const crossSystem = fromForce.gameSystem !== toForce.gameSystem;
            if (crossSystem) {
                const fromLabel = fromForce.gameSystem === 'as' ? 'Alpha Strike' : 'Classic BattleTech';
                const toLabel = toForce.gameSystem === 'as' ? 'Alpha Strike' : 'Classic BattleTech';
                const confirmed = await this.dialogsService.requestConfirmation(
                    `All units in the group will be converted from ${fromLabel} to ${toLabel}. Damage state and game-specific data will not be carried over. Continue?`,
                    'Game System Mismatch',
                    'danger'
                );
                if (!confirmed) return;
            }

            // Check if moving this group would empty the source force: confirm before mutating
            const groupToMove = fromForce.groups()[event.previousIndex];
            const groupUnitCount = groupToMove?.units().length ?? 0;
            const wouldEmptyForce = groupUnitCount > 0 && fromForce.units().length === groupUnitCount;
            if (wouldEmptyForce) {
                const answer = await this.dialogsService.choose(
                    'Remove Empty Force',
                    `Moving this group will leave "${fromForce.displayName()}" empty. The empty force will be removed. Continue?`,
                    [
                        { label: 'CONFIRM', value: 'confirm' },
                        { label: 'CANCEL', value: 'cancel' }
                    ],
                    'cancel'
                );
                if (answer === 'cancel') return;
            }

            const sourceUnits = [...(groupToMove?.units() ?? [])];
            const preparedConversions = crossSystem
                ? await this.prepareCrossSystemConversions(sourceUnits, fromForce, toForce)
                : null;
            if (crossSystem && !preparedConversions) return;
            const groupStillCurrent = fromForce.groups()[event.previousIndex] === groupToMove;
            const unitsStillCurrent = groupToMove?.units().length === sourceUnits.length
                && groupToMove.units().every((unit, index) => unit === sourceUnits[index]);
            if (!groupStillCurrent || !unitsStillCurrent) {
                return;
            }

            if (!groupToMove) {
                return;
            }
            try {
                toForce.adoptGroup(
                    groupToMove,
                    event.currentIndex,
                    crossSystem ? preparedConversions! : undefined,
                );
            } catch {
                return;
            }
            const movedGroup = groupToMove;

            // Re-evaluate the formation for the moved group
            this.formations.generateFactionAndForceNameIfNeeded(fromForce);
            this.formations.generateFactionAndForceNameIfNeeded(toForce);
            await this.formations.assignFormationIfNeeded(movedGroup);

            // Select a unit in the moved group
            const firstUnit = movedGroup.units()[0];
            if (firstUnit) {
                this.forceWorkspace.selectUnit(
                    toForce.members().find(member => member.id === firstUnit.id) ?? null,
                );
            }

            if (wouldEmptyForce) {
                if (toForce.instanceId()) toForce.emitChanged();
                this.forceBuilderService.deleteAndRemoveForce(fromForce);
            } else {
                if (fromForce.instanceId()) fromForce.emitChanged();
                if (toForce.instanceId()) toForce.emitChanged();
            }
        }
    }

    // --- Force-level drag-drop ---
    forceDragDisabled = computed(() => {
        return this.forceWorkspace.filteredLoadedForces().length < 2;
    });

    onForceDragStart() {
        this.isForceDragging.set(true);
        const el = this.scrollableContent()?.nativeElement;
        if (el) el.style.overflowY = 'hidden';
    }

    onForceDragEnd() {
        this.stopAutoScrollLoop();
        this.isForceDragging.set(false);
        const el = this.scrollableContent()?.nativeElement;
        if (el) el.style.overflowY = 'auto';
    }

    dropForce(event: CdkDragDrop<ForceSlot[]>) {
        if (event.previousIndex === event.currentIndex) return;
        // Map filtered indices to the full loadedForces array indices
        const filtered = this.forceWorkspace.filteredLoadedForces();
        const all = this.forceWorkspace.loadedForces();
        const movedSlot = filtered[event.previousIndex];
        const targetSlot = filtered[event.currentIndex];
        if (!movedSlot || !targetSlot) return;
        const fromIdx = all.indexOf(movedSlot);
        const toIdx = all.indexOf(targetSlot);
        if (fromIdx < 0 || toIdx < 0) return;
        this.forceBuilderService.reorderLoadedForces(fromIdx, toIdx);
    }

    /** Remove a force from the loaded forces with confirmation */
    async removeForceFromSlot(event: MouseEvent, force: Force) {
        event.stopPropagation();
        const confirmed = await this.dialogsService.requestConfirmation(
            `Remove "${force.displayName()}" from the loaded forces?`,
            'Remove Force',
            'danger'
        );
        if (confirmed) {
            await this.forceBuilderService.removeLoadedForce(force);
        }
    }
}
