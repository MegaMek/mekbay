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

import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { DragDropModule, CdkDragDrop, CdkDragMove, moveItemInArray } from '@angular/cdk/drag-drop';
import { Force, UnitGroup } from '../../models/force.model';
import { ForceUnit } from '../../models/force-unit.model';
import { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { ASForceUnit } from '../../models/as-force-unit.model';
import { Unit } from '../../models/units.model';
import { GameService } from '../../services/game.service';
import { LayoutService } from '../../services/layout.service';
import { DialogsService } from '../../services/dialogs.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { ToastService } from '../../services/toast.service';
import { OptionsService } from '../../services/options.service';
import { AsAbilityLookupService } from '../../services/as-ability-lookup.service';
import { UnitCardExpandedComponent } from '../unit-card-expanded/unit-card-expanded.component';
import { UnitBlockComponent } from '../unit-block/unit-block.component';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { UnitTagsComponent, TagClickEvent } from '../unit-tags/unit-tags.component';
import { AbilityInfoDialogComponent, AbilityInfoDialogData } from '../ability-info-dialog/ability-info-dialog.component';
import { SORT_OPTIONS } from '../../services/unit-search-filters.service';
import { TaggingService } from '../../services/tagging.service';
import { UnitDetailsDialogComponent, UnitDetailsDialogData } from '../unit-details-dialog/unit-details-dialog.component';
import { AdjustedPV } from '../../pipes/adjusted-pv.pipe';
import { FormatNumberPipe } from '../../pipes/format-number.pipe';

export interface ForceOverviewDialogData {
    force: Force;
}

/** View model for displaying units in the force */
interface ForceUnitViewModel {
    forceUnit: ForceUnit;
    unit: Unit;
}

/**
 * State for the overview that can be persisted.
 */
export interface OverviewState {
    viewMode: 'expanded' | 'compact';
    sortKey: string;
    sortDirection: 'asc' | 'desc';
}

/** Default state for the overview */
export const DEFAULT_OVERVIEW_STATE: OverviewState = {
    viewMode: 'compact',
    sortKey: '',
    sortDirection: 'asc'
};

/**
 * Force Overview Dialog
 * Displays all units in a force with sorting and view mode options.
 */
@Component({
    selector: 'force-overview-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, DragDropModule, UnitCardExpandedComponent, UnitBlockComponent, UnitIconComponent, AdjustedPV, FormatNumberPipe],
    host: {
        class: 'fullscreen-dialog-host fullheight tv-fade'
    },
    templateUrl: './force-overview-dialog.component.html',
    styleUrls: ['./force-overview-dialog.component.scss']
})
export class ForceOverviewDialogComponent {
    private dialogRef = inject<DialogRef<void>>(DialogRef);
    protected data = inject<ForceOverviewDialogData>(DIALOG_DATA);
    protected gameService = inject(GameService);
    protected layoutService = inject(LayoutService);
    private dialogsService = inject(DialogsService);
    private forceBuilderService = inject(ForceBuilderService);
    private toastService = inject(ToastService);
    private optionsService = inject(OptionsService);
    private abilityLookup = inject(AsAbilityLookupService);
    private taggingService = inject(TaggingService);

    /** Reference to new group dropzone */
    private newGroupDropzone = viewChild<ElementRef<HTMLElement>>('newGroupDropzone');

    /** Reference to scrollable units list */
    private scrollContainer = viewChild<ElementRef<HTMLElement>>('scrollContainer');

    /** Flag for unit drag/sorting */
    readonly isUnitDragging = signal<boolean>(false);

    // --- Autoscroll State ---
    private autoScrollVelocity = signal<number>(0);
    private autoScrollRafId?: number;
    private lastAutoScrollTs?: number;
    private readonly AUTOSCROLL_EDGE = 64;   // px threshold from edge
    private readonly AUTOSCROLL_MAX = 600;   // px/sec max scroll speed
    private readonly AUTOSCROLL_MIN = 40;    // px/sec min scroll speed

    /** Sort options available - Custom is the default order by the user */
    readonly SORT_OPTIONS = SORT_OPTIONS.map(opt => 
        opt.key === '' ? { ...opt, label: 'Custom' } : opt
    );

    /** Current view mode */
    viewMode = signal<'expanded' | 'compact'>(DEFAULT_OVERVIEW_STATE.viewMode);

    /** Current sort key */
    selectedSort = signal<string>(DEFAULT_OVERVIEW_STATE.sortKey);

    /** Current sort direction */
    selectedSortDirection = signal<'asc' | 'desc'>(DEFAULT_OVERVIEW_STATE.sortDirection);

    /** Get the label for the currently selected sort option */
    selectedSortLabel = computed(() => {
        const key = this.selectedSort();
        const opt = this.SORT_OPTIONS.find(o => o.key === key);
        return opt?.slotLabel ?? opt?.label ?? null;
    });

    /** Get the current game system for filtering sort options */
    gameSystem = computed(() => this.gameService.currentGameSystem());

    /** Force name for display */
    forceName = computed(() => this.data.force.name);

    /** Total unit count */
    unitCount = computed(() => this.units().length);

    /** Whether this is an Alpha Strike force */
    isAlphaStrike = computed(() => this.gameService.isAlphaStrike());

    /** Whether table mode is active (AS + expanded view + wide enough viewport) */
    readonly isTableMode = computed(() => 
        this.viewMode() === 'expanded' && 
        this.isAlphaStrike() && 
        this.layoutService.windowWidth() >= 1100
    );

    /** Whether to use hex movement */
    readonly useHex = computed(() => this.optionsService.options().ASUseHex);

    /** Keys always visible in the AS table row */
    private readonly AS_TABLE_VISIBLE_KEYS = ['as.PV', 'as.TP', 'role', 'as.SZ', 'as._mv', 'as.TMM', 'as.damage', 'as.Arm', 'as.Str', 'as.OV'];

    /** Keys that are grouped together in the UI display */
    private readonly SORT_KEY_GROUPS: Record<string, string[]> = {
        'as.damage': ['as.dmg.dmgS', 'as.dmg.dmgM', 'as.dmg.dmgL', 'as.dmg.dmgE']
    };

    /** Total BV/PV of the force */
    totalBv = computed(() => this.data.force.totalBv());

    /** Whether the force is read-only */
    isReadOnly = computed(() => this.data.force.readOnly());

    /** All groups in the force */
    groups = computed(() => this.data.force.groups());

    /** Whether there's only one group */
    hasSingleGroup = computed(() => this.groups().length === 1);

    /** Whether any group is empty */
    hasEmptyGroups = computed(() => this.groups().some(g => g.units().length === 0));

    /** Whether force has max groups */
    hasMaxGroups = computed(() => this.data.force.hasMaxGroups());

    /** For AS table view: returns the sort slot header label if the current sort is not already visible in the table columns */
    readonly asTableSortSlotHeader = computed((): string | null => {
        const sortKey = this.selectedSort();
        if (!sortKey || !this.isAlphaStrike()) return null;
        
        // Check if already visible in table
        if (this.AS_TABLE_VISIBLE_KEYS.includes(sortKey)) return null;
        for (const [groupKey, members] of Object.entries(this.SORT_KEY_GROUPS)) {
            if (this.AS_TABLE_VISIBLE_KEYS.includes(groupKey) && members.includes(sortKey)) return null;
        }
        
        const opt = this.SORT_OPTIONS.find(o => o.key === sortKey);
        return opt?.slotLabel ?? opt?.label ?? null;
    });

    /** Whether drag-drop is allowed (compact mode + default sort + not read-only) */
    canDragDrop = computed(() => 
        this.viewMode() === 'compact' && 
        this.selectedSort() === '' && 
        !this.isReadOnly()
    );

    /** All units in the force with their view model data */
    units = computed<ForceUnitViewModel[]>(() => {
        const force = this.data.force;
        const forceUnits = force.units();
        const sortKey = this.selectedSort();
        const sortDirection = this.selectedSortDirection();

        // Build view models - ForceUnit now contains all needed data
        const viewModels: ForceUnitViewModel[] = forceUnits.map(fu => {
            const unit = fu.getUnit();
            return {
                forceUnit: fu,
                unit
            };
        }).filter(vm => vm.unit != null) as ForceUnitViewModel[];

        // Sort the units (skip if no sort key - show default order)
        if (sortKey) {
            viewModels.sort((a, b) => {
                const valA = this.getNestedProperty(a.unit, sortKey);
                const valB = this.getNestedProperty(b.unit, sortKey);

                let cmp = 0;
                if (valA == null && valB == null) cmp = 0;
                else if (valA == null) cmp = 1;
                else if (valB == null) cmp = -1;
                else if (typeof valA === 'number' && typeof valB === 'number') {
                    cmp = valA - valB;
                } else {
                    cmp = String(valA).localeCompare(String(valB));
                }

                return sortDirection === 'asc' ? cmp : -cmp;
            });
        }

        return viewModels;
    });

    /** Toggle between expanded and compact view modes */
    toggleViewMode(): void {
        this.viewMode.update(v => v === 'expanded' ? 'compact' : 'expanded');
    }

    /** Set the sort key */
    setSortOrder(key: string): void {
        this.selectedSort.set(key);
    }

    /** Set the sort direction */
    setSortDirection(direction: 'asc' | 'desc'): void {
        this.selectedSortDirection.set(direction);
    }

    /** Handle unit card click - open unit details dialog */
    onUnitClick(vm: ForceUnitViewModel): void {
        const unitList = this.data.force.units();
        const unitIndex = unitList.findIndex(u => u.id === vm.forceUnit.id);
        this.dialogsService.createDialog(UnitDetailsDialogComponent, {
            data: <UnitDetailsDialogData>{
                unitList: unitList,
                unitIndex: unitIndex
            }
        });
    }

    async onTagClick({ unit, event }: TagClickEvent): Promise<void> {
        event.stopPropagation();
        
        // Get anchor element for positioning
        const evtTarget = (event.currentTarget as HTMLElement) || (event.target as HTMLElement);
        const anchorEl = (evtTarget.closest('.add-tag-btn') as HTMLElement) || evtTarget;
        
        await this.taggingService.openTagSelector([unit], anchorEl);
    }

    /** Handle pilot click - open pilot edit dialog */
    async onPilotClick(forceUnit: ForceUnit): Promise<void> {
        if (forceUnit.readOnly()) return;
        const crew = forceUnit.getCrewMembers();
        const pilot = crew.length > 0 ? crew[0] : undefined;
        await this.forceBuilderService.editPilotOfUnit(forceUnit, pilot);
    }

    /** Handle force name click - open rename dialog */
    async onForceNameClick(): Promise<void> {
        if (this.isReadOnly()) return;
        await this.forceBuilderService.promptChangeForceName();
    }

    /** Handle group name click - open rename dialog */
    async onGroupNameClick(group: UnitGroup): Promise<void> {
        if (this.isReadOnly()) return;
        await this.forceBuilderService.promptChangeGroupName(group);
    }

    /** Handle C3 network click - open C3 network dialog */
    async openC3Network(event: MouseEvent, forceUnit: ForceUnit): Promise<void> {
        event.stopPropagation();
        await this.forceBuilderService.openC3Network(this.data.force, forceUnit.readOnly());
    }

    /** Handle remove unit */
    async removeUnit(event: MouseEvent, forceUnit: ForceUnit): Promise<void> {
        event.stopPropagation();
        await this.forceBuilderService.removeUnit(forceUnit);
    }

    /** Handle repair unit */
    async repairUnit(event: MouseEvent, forceUnit: ForceUnit): Promise<void> {
        event.stopPropagation();
        const unit = forceUnit.getUnit();
        const confirmed = await this.dialogsService.requestConfirmation(
            `Are you sure you want to repair the unit "${unit?.chassis} ${unit?.model}"? This will reset all damage and status effects.`,
            `Repair ${unit?.chassis}`,
            'info');
        if (confirmed) {
            forceUnit.repairAll();
            this.toastService.showToast(`Repaired unit ${unit?.chassis} ${unit?.model}.`, 'success');
        }
    }

    /** Handle show unit info */
    showUnitInfo(event: MouseEvent, forceUnit: ForceUnit): void {
        event.stopPropagation();
        const unitList = this.data.force.units();
        const unitIndex = unitList.findIndex(u => u.id === forceUnit.id);
        this.dialogsService.createDialog(UnitDetailsDialogComponent, {
            data: <UnitDetailsDialogData>{
                unitList: unitList,
                unitIndex: unitIndex
            }
        });
    }

    /** Get sorted units for a group */
    getSortedUnitsForGroup(group: UnitGroup): ForceUnitViewModel[] {
        const sortKey = this.selectedSort();
        const sortDirection = this.selectedSortDirection();

        const viewModels: ForceUnitViewModel[] = group.units().map(fu => {
            const unit = fu.getUnit();
            return { forceUnit: fu, unit };
        }).filter(vm => vm.unit != null) as ForceUnitViewModel[];

        // Skip sorting if no sort key - show default order
        if (sortKey) {
            viewModels.sort((a, b) => {
                const valA = this.getNestedProperty(a.unit, sortKey);
                const valB = this.getNestedProperty(b.unit, sortKey);

                let cmp = 0;
                if (valA == null && valB == null) cmp = 0;
                else if (valA == null) cmp = 1;
                else if (valB == null) cmp = -1;
                else if (typeof valA === 'number' && typeof valB === 'number') {
                    cmp = valA - valB;
                } else {
                    cmp = String(valA).localeCompare(String(valB));
                }

                return sortDirection === 'asc' ? cmp : -cmp;
            });
        }

        return viewModels;
    }

    /** Close the dialog */
    close(): void {
        this.dialogRef.close();
    }

    /** Get a nested property value using dot notation (e.g., 'as.PV') */
    private getNestedProperty(obj: any, key: string): any {
        if (!obj || !key) return undefined;
        if (!key.includes('.')) return obj[key];
        const parts = key.split('.');
        let cur: any = obj;
        for (const p of parts) {
            if (cur == null) return undefined;
            cur = cur[p];
        }
        return cur;
    }

    // --- Drag and Drop ---

    /** Called when drag starts */
    onUnitDragStart(): void {
        if (this.isReadOnly()) return;
        this.isUnitDragging.set(true);
    }

    /** Called when dragging moves */
    onUnitDragMoved(event: CdkDragMove<any>): void {
        if (this.isReadOnly()) return;

        const scrollRef = this.scrollContainer?.();
        if (!scrollRef) {
            this.stopAutoScrollLoop();
            return;
        }
        const container = scrollRef.nativeElement as HTMLElement;
        const rect = container.getBoundingClientRect();

        const pointerY = (event.event as PointerEvent)?.clientY ?? event.pointerPosition?.y;
        if (pointerY == null) {
            this.stopAutoScrollLoop();
            return;
        }

        const topDist = pointerY - rect.top;
        const bottomDist = rect.bottom - pointerY;

        let ratio = 0;
        if (topDist < this.AUTOSCROLL_EDGE) {
            ratio = (this.AUTOSCROLL_EDGE - topDist) / this.AUTOSCROLL_EDGE;
            ratio = Math.max(0, Math.min(1, ratio));
            ratio = ratio * ratio;
            this.autoScrollVelocity.set(-Math.max(this.AUTOSCROLL_MIN, ratio * this.AUTOSCROLL_MAX));
        } else if (bottomDist < this.AUTOSCROLL_EDGE) {
            ratio = (this.AUTOSCROLL_EDGE - bottomDist) / this.AUTOSCROLL_EDGE;
            ratio = Math.max(0, Math.min(1, ratio));
            ratio = ratio * ratio;
            this.autoScrollVelocity.set(Math.max(this.AUTOSCROLL_MIN, ratio * this.AUTOSCROLL_MAX));
        } else {
            this.autoScrollVelocity.set(0);
        }

        if (Math.abs(this.autoScrollVelocity()) > 0.5) {
            this.startAutoScrollLoop();
        } else {
            this.stopAutoScrollLoop();
        }
    }

    /** Called when drag ends */
    onUnitDragEnd(): void {
        this.stopAutoScrollLoop();
        this.isUnitDragging.set(false);
    }

    private startAutoScrollLoop(): void {
        if (this.autoScrollRafId) return;
        this.lastAutoScrollTs = performance.now();
        const step = (ts: number) => {
            if (!this.autoScrollRafId) return;
            const last = this.lastAutoScrollTs ?? ts;
            const dt = Math.min(100, ts - last) / 1000;
            this.lastAutoScrollTs = ts;

            const v = this.autoScrollVelocity();
            if (Math.abs(v) > 0.5) {
                const scrollRef = this.scrollContainer?.();
                if (scrollRef) {
                    const el = scrollRef.nativeElement as HTMLElement;
                    const delta = v * dt;
                    el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + delta));
                }
                this.autoScrollRafId = requestAnimationFrame(step);
            } else {
                this.stopAutoScrollLoop();
            }
        };
        this.autoScrollRafId = requestAnimationFrame(step);
    }

    private stopAutoScrollLoop(): void {
        if (this.autoScrollRafId) {
            cancelAnimationFrame(this.autoScrollRafId);
            this.autoScrollRafId = undefined;
        }
        this.autoScrollVelocity.set(0);
        this.lastAutoScrollTs = undefined;
    }

    /** Get connected drop lists for drag-drop */
    connectedDropLists(): string[] {
        const groups = this.groups();
        const ids = groups.map(g => `group-${g.id}`);
        if (this.newGroupDropzone()?.nativeElement) {
            ids.push('new-group-dropzone');
        }
        return ids;
    }

    /** Handle drop within or between groups */
    drop(event: CdkDragDrop<ForceUnit[]>): void {
        if (this.isReadOnly()) return;

        const force = this.data.force;
        const groups = force.groups();

        const groupIdFromContainer = (id?: string) => id && id.startsWith('group-') ? id.substring('group-'.length) : null;

        const fromGroupId = groupIdFromContainer(event.previousContainer?.id);
        const toGroupId = groupIdFromContainer(event.container?.id);

        if (!fromGroupId || !toGroupId) return;

        const fromGroup = groups.find(g => g.id === fromGroupId);
        const toGroup = groups.find(g => g.id === toGroupId);
        if (!fromGroup || !toGroup) return;

        // No-op if same group and same index
        if (fromGroup === toGroup && event.previousIndex === event.currentIndex) {
            return;
        }

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

        force.removeEmptyGroups();
        force.emitChanged();
    }

    /** Handle drop to create a new group */
    dropForNewGroup(event: CdkDragDrop<any>): void {
        if (this.isReadOnly()) return;

        const force = this.data.force;
        const newGroup = force.addGroup('New Group');
        if (!newGroup) return;

        const prevId = event.previousContainer?.id;
        if (!prevId || !prevId.startsWith('group-')) return;

        const sourceGroupId = prevId.substring('group-'.length);
        const sourceGroup = force.groups().find(g => g.id === sourceGroupId);
        if (!sourceGroup) return;

        const sourceUnits = [...sourceGroup.units()];
        const [moved] = sourceUnits.splice(event.previousIndex, 1);
        if (!moved) return;

        const targetUnits = [...newGroup.units(), moved];
        sourceGroup.units.set(sourceUnits);
        newGroup.units.set(targetUnits);
        this.forceBuilderService.generateGroupNameIfNeeded(sourceGroup);
        this.forceBuilderService.generateGroupNameIfNeeded(newGroup);
        force.removeEmptyGroups();
        force.emitChanged();
    }

    /** Handle click on empty group to remove it */
    onEmptyGroupClick(group: UnitGroup): void {
        if (this.isReadOnly()) return;
        if (group.units().length === 0) {
            this.forceBuilderService.removeGroup(group);
        }
    }

    // --- AS Table View Helpers ---

    /** Check if the current sort key matches any of the provided keys or groups */
    isSortActive(...keysOrGroups: string[]): boolean {
        const currentSort = this.selectedSort();
        if (!currentSort) return false;
        
        for (const keyOrGroup of keysOrGroups) {
            if (currentSort === keyOrGroup) return true;
            const groupMembers = this.SORT_KEY_GROUPS[keyOrGroup];
            if (groupMembers?.includes(currentSort)) return true;
        }
        return false;
    }

    /** Get the sort slot value for AS table row view */
    getAsTableSortSlot(vm: ForceUnitViewModel): string | null {
        const sortKey = this.selectedSort();
        if (!sortKey || !this.isAlphaStrike()) return null;
        
        // Check if already visible in table
        if (this.AS_TABLE_VISIBLE_KEYS.includes(sortKey)) return null;
        for (const [groupKey, members] of Object.entries(this.SORT_KEY_GROUPS)) {
            if (this.AS_TABLE_VISIBLE_KEYS.includes(groupKey) && members.includes(sortKey)) return null;
        }
        
        const val = this.getNestedProperty(vm.unit, sortKey);
        if (val == null) return null;
        return typeof val === 'number' ? String(val) : String(val);
    }

    /** Format movement value for Alpha Strike table view */
    formatASMovement(unit: Unit): string {
        const mvm = unit.as.MVm;
        if (!mvm) return unit.as.MV ?? '';

        const entries = Object.entries(mvm)
            .filter(([, value]) => typeof value === 'number' && value > 0) as Array<[string, number]>;

        if (entries.length === 0) return unit.as.MV ?? '';

        entries.sort((a, b) => {
            if (a[0] === '') return -1;
            if (b[0] === '') return 1;
            return 0;
        });

        return entries
            .map(([mode, inches]) => {
                if (this.useHex()) {
                    return Math.ceil(inches / 2) + mode;
                }
                return inches + '"' + mode;
            })
            .join('/');
    }

    /** Show ability info dialog for an Alpha Strike special ability */
    showAbilityInfoDialog(abilityText: string): void {
        const parsedAbility = this.abilityLookup.parseAbility(abilityText);
        this.dialogsService.createDialog<void>(AbilityInfoDialogComponent, {
            data: { parsedAbility } as AbilityInfoDialogData
        });
    }

    /** Get pilot skill for AS table display */
    getPilotSkill(vm: ForceUnitViewModel): number {
        const fu = vm.forceUnit;
        if (fu instanceof ASForceUnit) {
            return fu.pilotSkill();
        }
        return 4; // Default
    }
}
