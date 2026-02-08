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

import { Component, computed, Injector, ElementRef, effect, inject, ChangeDetectionStrategy, viewChild, viewChildren, input, signal, afterNextRender, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ForceBuilderService } from '../../services/force-builder.service';
import { LayoutService } from '../../services/layout.service';
import { Force, UnitGroup } from '../../models/force.model';
import { ForceSlot } from '../../models/force-slot.model';
import { ForceUnit } from '../../models/force-unit.model';
import { DragDropModule, CdkDragDrop, moveItemInArray, CdkDragMove, transferArrayItem } from '@angular/cdk/drag-drop'
import { DialogsService } from '../../services/dialogs.service';
import { UnitDetailsDialogComponent, UnitDetailsDialogData } from '../unit-details-dialog/unit-details-dialog.component';
import { UnitBlockComponent } from '../unit-block/unit-block.component';
import { CompactModeService } from '../../services/compact-mode.service';
import { ToastService } from '../../services/toast.service';


/*
 * Author: Drake
 */
@Component({
    selector: 'force-builder-viewer',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, DragDropModule, UnitBlockComponent],
    templateUrl: './force-builder-viewer.component.html',
    styleUrls: ['./force-builder-viewer.component.scss']
})
export class ForceBuilderViewerComponent {
    protected forceBuilderService = inject(ForceBuilderService);
    protected toastService = inject(ToastService);
    protected layoutService = inject(LayoutService);
    compactModeService = inject(CompactModeService);
    private dialogsService = inject(DialogsService);
    private injector = inject(Injector);
    private scrollableContent = viewChild<ElementRef<HTMLDivElement>>('scrollableContent');
    private newGroupDropzone = viewChild<ElementRef<HTMLElement>>('newGroupDropzone');
    forceUnitItems = viewChildren<ElementRef<HTMLElement>>('forceUnitItem');
    private forceSlotHeaders = viewChildren<ElementRef<HTMLElement>>('forceSlotHeader');

    miniMode = input<boolean>(false);

    loadedSlots = computed(() => this.forceBuilderService.filteredLoadedForces());

    compactMode = computed(() => {
        return this.compactModeService.compactMode();
    });

    /**
     * Alignment styling (friendly/enemy) is shown on non-owned forces only when:
     * - at least one owned force is loaded, OR
     * - both friendly and enemy forces are loaded
     * Uses unfiltered loadedForces so coloring persists even when filtering by alignment.
     */
    showAlignmentStyling = computed<boolean>(() => {
        const slots = this.forceBuilderService.loadedForces();
        if (slots.length < 2) return false;
        const hasOwned = slots.some(s => !s.force.readOnly());
        if (hasOwned) return true;
        const alignments = new Set(slots.map(s => s.alignment));
        return alignments.has('friendly') && alignments.has('enemy');
    });

    hasOwnedForce = computed<boolean>(() => this.forceBuilderService.loadedForces().some(s => !s.force.readOnly()));

    hasEmptyGroups = this.forceBuilderService.hasEmptyGroups;

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
            const selected = this.forceBuilderService.selectedUnit();
            // Also track filter changes so we scroll even when the unit stays the same
            this.forceBuilderService.alignmentFilter();
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

        inject(DestroyRef).onDestroy(() => {
            pendingScrollRef?.destroy();
            this.stopAutoScrollLoop();
            this.headerResizeObserver?.disconnect();
        });
    }

    onUnitKeydown(event: KeyboardEvent, index: number) {
        const units = this.forceBuilderService.forceUnitsOrEmpty();
        if (units.length === 0) return;
        if (event.key === 'ArrowDown') {
            if (index < units.length - 1) {
                event.preventDefault();
                const next = this.forceUnitItems()?.[index + 1];
                next?.nativeElement.focus();
                this.selectUnit(units[index + 1]);
            }
        } else if (event.key === 'ArrowUp') {
            if (index > 0) {
                event.preventDefault();
                const prev = this.forceUnitItems()?.[index - 1];
                prev?.nativeElement.focus();
                this.selectUnit(units[index - 1]);
            }
        }
    }

    selectUnit(unit: ForceUnit) {
        this.forceBuilderService.selectUnit(unit);
        if (this.layoutService.isMobile()) {
            this.layoutService.closeMenu();
        }
    }

    async removeUnit(event: MouseEvent, unit: ForceUnit) {
        event.stopPropagation();
        await this.forceBuilderService.removeUnit(unit);
        // If this was the last unit, close the menu (offcanvas OFF mode)
        if (!this.forceBuilderService.hasUnits()) {
            this.layoutService.closeMenu();
        }
    }

    async repairUnit(event: MouseEvent, unit: ForceUnit) {
        event.stopPropagation();
        const confirmed = await this.dialogsService.requestConfirmation(
            `Are you sure you want to repair the unit "${unit.getUnit()?.chassis} ${unit.getUnit()?.model}"? This will reset all damage and status effects.`,
            `Repair ${unit.getUnit()?.chassis}`,
            'info');
        if (confirmed) {
            unit.repairAll();
            this.toastService.showToast(`Repaired unit ${unit.getUnit()?.chassis} ${unit.getUnit()?.model}.`, 'success');
            return true;
        };
        return false;
    }

    showUnitInfo(event: MouseEvent, unit: ForceUnit) {
        event.stopPropagation();
        const force = this.findForceOfUnit(unit);
        if (!force) return;
        const unitList = force.units();
        if (!unitList) return;
        const unitIndex = unitList.findIndex(u => u.id === unit.id);
        const ref = this.dialogsService.createDialog(UnitDetailsDialogComponent, {
            data: <UnitDetailsDialogData>{
                unitList: force.units,
                unitIndex: unitIndex
            }
        });

    }

    async openC3Network(event: MouseEvent, unit: ForceUnit) {
        event.stopPropagation();
        const force = this.findForceOfUnit(unit);
        if (!force) return;
        await this.forceBuilderService.openC3Network(force, unit.readOnly());
    }

    /**
     * Finds which loaded force contains a given unit.
     */
    private findForceOfUnit(unit: ForceUnit): Force | undefined {
        for (const slot of this.forceBuilderService.loadedForces()) {
            if (slot.force.units().some(u => u.id === unit.id)) {
                return slot.force;
            }
        }
        return this.forceBuilderService.currentForce() ?? undefined;
    }

    async editPilot(event: MouseEvent, unit: ForceUnit) {
        if (unit.readOnly()) return;
        event.stopPropagation();
        const crew = unit.getCrewMembers();
        const pilot = crew.length > 0 ? crew[0] : undefined;
        await this.forceBuilderService.editPilotOfUnit(unit, pilot);
    }


    toggleMenu() {
        this.layoutService.toggleMenu();
    }

    onUnitDragStart() {
        if (this.forceBuilderService.readOnlyForce()) return;
        this.isUnitDragging.set(true);
        // Disable native scroll so it doesn't fight CDK drag
        const el = this.scrollableContent()?.nativeElement;
        if (el) el.style.overflowY = 'hidden';
    }

    onUnitDragMoved(event: CdkDragMove<any>) {
        if (this.forceBuilderService.readOnlyForce()) return;

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

    onUnitDragEnd() {
        if (this.forceBuilderService.readOnlyForce()) return;
        this.stopAutoScrollLoop();
        this.isUnitDragging.set(false);
        // Restore native scroll
        const el = this.scrollableContent()?.nativeElement;
        if (el) el.style.overflowY = 'auto';
    }

    onGroupDragStart() {
        if (this.forceBuilderService.readOnlyForce()) return;
        this.isGroupDragging.set(true);
        const el = this.scrollableContent()?.nativeElement;
        if (el) el.style.overflowY = 'hidden';
    }

    onGroupDragEnd() {
        if (this.forceBuilderService.readOnlyForce()) return;
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

    async drop(event: CdkDragDrop<ForceUnit[]>) {
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

        if (fromForce === toForce) {
            // Same force: reorder within or between groups
            if (fromGroup === toGroup) {
                const units = [...fromGroup.units()];
                moveItemInArray(units, event.previousIndex, event.currentIndex);
                fromGroup.units.set(units);
            } else {
                const fromUnits = [...fromGroup.units()];
                const toUnits = [...toGroup.units()];
                const [moved] = fromUnits.splice(event.previousIndex, 1);
                if (!moved) return;
                const insertIndex = Math.min(Math.max(0, event.currentIndex), toUnits.length);
                toUnits.splice(insertIndex, 0, moved);
                fromGroup.units.set(fromUnits);
                toGroup.units.set(toUnits);
                this.forceBuilderService.generateGroupNameIfNeeded(fromGroup);
                this.forceBuilderService.generateGroupNameIfNeeded(toGroup);
            }
            fromForce.removeEmptyGroups();
            if (fromForce.instanceId()) {
                fromForce.emitChanged();
            }
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

            // Check if this move would empty the source force — confirm before mutating
            const wouldEmptyForce = fromForce.units().length === 1;
            if (wouldEmptyForce) {
                const answer = await this.dialogsService.choose(
                    'Remove Empty Force',
                    `Moving this unit will leave "${fromForce.name}" empty. The empty force will be removed. Continue?`,
                    [
                        { label: 'CONFIRM', value: 'confirm' },
                        { label: 'CANCEL', value: 'cancel' }
                    ],
                    'cancel'
                );
                if (answer === 'cancel') return;
            }

            const fromUnits = [...fromGroup.units()];
            const [moved] = fromUnits.splice(event.previousIndex, 1);
            if (!moved) return;

            // Convert unit if different game systems
            let unitToInsert: ForceUnit;
            if (crossSystem) {
                const converted = this.forceBuilderService.convertUnitForForce(moved, fromForce, toForce);
                if (!converted) {
                    this.toastService.showToast(`Could not convert unit — not found in the database.`, 'error');
                    return;
                }
                moved.destroy();
                unitToInsert = converted;
            } else {
                unitToInsert = moved;
            }

            const toUnits = [...toGroup.units()];
            const insertIndex = Math.min(Math.max(0, event.currentIndex), toUnits.length);
            toUnits.splice(insertIndex, 0, unitToInsert);
            fromGroup.units.set(fromUnits);
            toGroup.units.set(toUnits);
            toForce.deduplicateIds();
            fromForce.removeEmptyGroups();
            if (wouldEmptyForce) {
                if (toForce.instanceId()) toForce.emitChanged();
                this.forceBuilderService.setActiveForce(toForce);
                this.forceBuilderService.deleteAndRemoveForce(fromForce);
            } else {
                if (fromForce.instanceId()) fromForce.emitChanged();
                if (toForce.instanceId()) toForce.emitChanged();
            }
        }
    }

    /**
     * Finds a group and its owning force across all loaded forces.
     */
    private findGroupAndForce(groupId: string): { force: Force; group: UnitGroup } | null {
        for (const slot of this.forceBuilderService.loadedForces()) {
            const group = slot.force.groups().find(g => g.id === groupId);
            if (group) return { force: slot.force, group };
        }
        return null;
    }

    groupsDragDisabled = computed(() => {
        const forces = this.forceBuilderService.filteredLoadedForces();
        // Allow group dragging if there's more than one force, or if the single loaded force has multiple groups (otherwise there's no point in dragging)
        return (forces.length === 1 && forces[0].force.groups().length < 2);
    });

    connectedDropLists = computed(() => {
        const ids: string[] = [];
        for (const slot of this.forceBuilderService.loadedForces()) {
            if (slot.force.readOnly()) continue; // exclude read-only forces from drop targets
            for (const g of slot.force.groups()) {
                ids.push(`group-${g.id}`);
            }
        }
        if (this.newGroupDropzone()?.nativeElement) {
            ids.push('new-group-dropzone');
        }
        return ids;
    });

    dropForNewGroup(event: CdkDragDrop<any, any, any>) {
        const currentForce = this.forceBuilderService.currentForce();
        if (!currentForce || currentForce.readOnly()) return;

        // Create the group first (force.addGroup already updates force.groups())
        const newGroup = currentForce.addGroup('New Group');
        if (!newGroup) return;

        const prevId = event.previousContainer?.id;
        if (!prevId || !prevId.startsWith('group-')) {
            // previous container isn't a group (nothing to move)
            return;
        }

        const sourceGroupId = prevId.substring('group-'.length);
        const sourceGroup = currentForce.groups().find(g => g.id === sourceGroupId);
        if (!sourceGroup) return;

        // Move the item from source to the new group
        const sourceUnits = [...sourceGroup.units()];
        const [moved] = sourceUnits.splice(event.previousIndex, 1);
        if (!moved) return;

        const targetUnits = [...newGroup.units(), moved]; // append to end
        sourceGroup.units.set(sourceUnits);
        newGroup.units.set(targetUnits);
        this.forceBuilderService.generateGroupNameIfNeeded(sourceGroup);
        this.forceBuilderService.generateGroupNameIfNeeded(newGroup);
        currentForce.removeEmptyGroups();

        // Only emit change (trigger save) if force already has an instanceId
        if (currentForce.instanceId()) {
            currentForce.emitChanged();
        }

        // Select the moved unit
        this.forceBuilderService.selectUnit(moved);
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

    promptChangeForceName(force?: Force) {
        if (force?.readOnly()) return;
        if (!force && this.forceBuilderService.readOnlyForce()) return;
        this.forceBuilderService.promptChangeForceName();
    }

    promptChangeGroupName(group: UnitGroup) {
        if (this.forceBuilderService.readOnlyForce()) return;
        this.forceBuilderService.promptChangeGroupName(group);
    }

    setActiveForce(force: Force) {
        this.forceBuilderService.setActiveForce(force);
    }

    shareForce() {
        this.forceBuilderService.shareForce();
    }

    onEmptyGroupClick(group: UnitGroup) {
        const result = this.findGroupAndForce(group.id);
        if (!result || result.force.readOnly()) return;
        if (group.units().length === 0) {
            this.forceBuilderService.removeGroup(group);
        }
    }

    /** Connected group drop list IDs for group drag-drop (only non-readonly forces) */
    connectedGroupDropLists(): string[] {
        const ids: string[] = [];
        for (const slot of this.forceBuilderService.loadedForces()) {
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
            for (const slot of this.forceBuilderService.loadedForces()) {
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
            if (event.previousIndex === event.currentIndex) return;
            const groups = [...fromForce.groups()];
            moveItemInArray(groups, event.previousIndex, event.currentIndex);
            fromForce.groups.set(groups);
            if (fromForce.instanceId()) fromForce.emitChanged();
        } else {
            // Move group between forces
            if (fromForce.readOnly()) return;

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

            const fromGroups = [...fromForce.groups()];
            const toGroups = [...toForce.groups()];

            // Check if moving this group would empty the source force — confirm before mutating
            const groupToMove = fromGroups[event.previousIndex];
            const groupUnitCount = groupToMove?.units().length ?? 0;
            const wouldEmptyForce = groupUnitCount > 0 && fromForce.units().length === groupUnitCount;
            if (wouldEmptyForce) {
                const answer = await this.dialogsService.choose(
                    'Remove Empty Force',
                    `Moving this group will leave "${fromForce.name}" empty. The empty force will be removed. Continue?`,
                    [
                        { label: 'CONFIRM', value: 'confirm' },
                        { label: 'CANCEL', value: 'cancel' }
                    ],
                    'cancel'
                );
                if (answer === 'cancel') return;
            }

            transferArrayItem(fromGroups, toGroups, event.previousIndex, event.currentIndex);
            // Re-parent the moved group
            const movedGroup = toGroups[event.currentIndex];
            if (movedGroup) {
                (movedGroup as any).force = toForce; // update parent reference
                if (crossSystem) {
                    // Convert all units in the group to the target game system
                    const convertedUnits: ForceUnit[] = [];
                    for (const u of movedGroup.units()) {
                        const converted = this.forceBuilderService.convertUnitForForce(u, fromForce, toForce);
                        if (converted) {
                            convertedUnits.push(converted);
                        } else {
                            this.toastService.showToast(`Could not convert "${u.getUnit()?.chassis}" — unit data not found.`, 'error');
                        }
                        u.destroy();
                    }
                    movedGroup.units.set(convertedUnits);
                }
            }
            fromForce.groups.set(fromGroups);
            toForce.groups.set(toGroups);
            toForce.deduplicateIds();

            if (wouldEmptyForce) {
                if (toForce.instanceId()) toForce.emitChanged();
                this.forceBuilderService.setActiveForce(toForce);
                this.forceBuilderService.deleteAndRemoveForce(fromForce);
            } else {
                if (fromForce.instanceId()) fromForce.emitChanged();
                if (toForce.instanceId()) toForce.emitChanged();
            }
        }
    }

    // --- Force-level drag-drop ---
    forceDragDisabled = computed(() => {
        return this.forceBuilderService.filteredLoadedForces().length < 2;
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
        const filtered = this.forceBuilderService.filteredLoadedForces();
        const all = this.forceBuilderService.loadedForces();
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
            `Remove "${force.name}" from the loaded forces?`,
            'Remove Force',
            'danger'
        );
        if (confirmed) {
            this.forceBuilderService.removeLoadedForce(force);
        }
    }
}