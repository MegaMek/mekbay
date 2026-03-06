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
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    ElementRef,
    inject,
    signal,
    viewChild,
} from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { LoadForceEntry } from '../../models/load-force-entry.model';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { LayoutService } from '../../services/layout.service';
import { FactionImgPipe } from '../../pipes/faction-img.pipe';
import { FormationNamerUtil } from '../../utils/formation-namer.util';
import { GameSystem } from '../../models/common.model';

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.0;

const CARD_WIDTH = 220;
const CARD_HEIGHT = 70;
const CARD_GAP = 12;
const GROUP_PADDING = 24;
const GROUP_HEADER_HEIGHT = 48;

interface Rect { x: number; y: number; width: number; height: number }
interface GroupPreview extends Rect { orgName: string; totals: string; factionId: number | undefined }

type ForceDropAction =
    | { type: 'join-group'; groupId: string }
    | { type: 'new-group'; other: PlacedForce }
    | { type: 'leave-group' };

type GroupDropAction =
    | { type: 'join-parent'; groupId: string }
    | { type: 'create-parent'; other: OrgGroup }
    | { type: 'rearrange'; parentId: string };

/** A force card placed in the main canvas */
interface PlacedForce {
    force: LoadForceEntry;
    x: number;
    y: number;
    zIndex: number;
    groupId: string | null;
}

/** An organizational group containing forces or other groups */
interface OrgGroup {
    id: string;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
    parentGroupId: string | null;
    anchorX: number;
    anchorY: number;
}

@Component({
    selector: 'force-org-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FactionImgPipe],
    host: {
        class: 'fullscreen-dialog-host fullheight tv-fade',
    },
    templateUrl: './force-org-dialog.component.html',
    styleUrls: ['./force-org-dialog.component.scss']
})
export class ForceOrgDialogComponent {
    private dialogRef = inject(DialogRef<void>);
    private dataService = inject(DataService);
    private dialogsService = inject(DialogsService);
    private destroyRef = inject(DestroyRef);
    protected layoutService = inject(LayoutService);
    private svgCanvas = viewChild<ElementRef<SVGSVGElement>>('svgCanvas');

    protected readonly CARD_WIDTH = CARD_WIDTH;
    protected readonly CARD_HEIGHT = CARD_HEIGHT;
    protected readonly GROUP_PADDING = GROUP_PADDING;
    protected readonly GROUP_HEADER_HEIGHT = GROUP_HEADER_HEIGHT;
    protected readonly GameSystem = GameSystem;

    // Sidebar
    protected sidebarOpen = signal(false);
    protected sidebarSearchText = signal('');
    protected sidebarGameTypeFilter = signal<'all' | GameSystem.CLASSIC | GameSystem.ALPHA_STRIKE>('all');
    protected sidebarAnimated = signal(false);
    protected loading = signal(true);

    // All forces from hangar
    protected allForces = signal<LoadForceEntry[]>([]);

    // Placed forces on canvas
    protected placedForces = signal<PlacedForce[]>([]);

    // Groups
    protected groups = signal<OrgGroup[]>([]);

    // Pan/zoom state
    protected viewOffset = signal({ x: 0, y: 0 });
    protected zoom = signal(1);
    private lastPanPoint: { x: number; y: number } | null = null;
    private pendingMoveEvent: PointerEvent | null = null;
    private moveRafId: number | null = null;
    private hasGlobalPointerListeners = false;
    private pinchStartDistance = 0;
    private pinchStartZoom = 1;
    private activeTouches = new Map<number, PointerEvent>();

    // Drag state for forces
    protected draggedForce = signal<PlacedForce | null>(null);
    private dragStartPos = { x: 0, y: 0 };
    private forceStartPos = { x: 0, y: 0 };
    protected isDragging = signal(false);
    private forceDragged = false;

    // Drag from sidebar state
    protected sidebarDragForce = signal<LoadForceEntry | null>(null);
    protected sidebarDragActive = signal(false);
    protected sidebarDragPos = signal({ x: 0, y: 0 });

    // Drag state for groups
    private draggedGroup = signal<OrgGroup | null>(null);
    private groupDragStartPos = { x: 0, y: 0 };
    private groupStartPos = { x: 0, y: 0 };
    private groupDragged = false;

    // Hover state
    protected hoveredForceId = signal<string | null>(null);

    // Drop preview state
    protected dropTargetGroupId = signal<string | null>(null);
    protected dropPreviewRect = signal<GroupPreview | null>(null);
    protected previewGroupInfo = signal<Map<string, { orgName: string; totals: string; factionId: number | undefined }>>(new Map());

    /** Forces available in sidebar (not yet placed) */
    protected sidebarForces = computed(() => {
        const placedIds = new Set(this.placedForces().map(p => p.force.instanceId));
        const typeFilter = this.sidebarGameTypeFilter();
        const tokens = this.sidebarSearchText().trim().toLowerCase().split(/\s+/).filter(Boolean);
        return this.allForces().filter(f => {
            if (placedIds.has(f.instanceId)) return false;
            if (typeFilter !== 'all' && (f.type || GameSystem.CLASSIC) !== typeFilter) return false;
            if (tokens.length > 0) {
                const hay = f._searchText || '';
                if (!tokens.every(t => hay.indexOf(t) !== -1)) return false;
            }
            return true;
        }).sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    });

    protected svgTransform = computed(() => {
        const offset = this.viewOffset();
        return `translate(${offset.x}, ${offset.y}) scale(${this.zoom()})`;
    });

    protected sortedPlacedForces = computed(() =>
        [...this.placedForces()].sort((a, b) => a.zIndex - b.zIndex)
    );

    protected sortedGroups = computed(() => {
        const groups = [...this.groups()];
        // Sort: parents first (rendered below), then by zIndex
        const depth = (g: OrgGroup): number => {
            let d = 0;
            const visited = new Set<string>();
            let current: OrgGroup | undefined = g;
            while (current?.parentGroupId) {
                if (visited.has(current.id)) break;
                visited.add(current.id);
                d++;
                current = groups.find(p => p.id === current!.parentGroupId);
            }
            return d;
        };
        return groups.sort((a, b) => {
            const da = depth(a), db = depth(b);
            return da !== db ? da - db : a.zIndex - b.zIndex;
        });
    });

    /** Org size name for each LoadForceEntry, keyed by instanceId. */
    protected forceOrgNames = computed(() => {
        const all = this.allForces();
        const result = new Map<string, string>();
        for (const force of all) {
            const factionName = this.getFactionName(force.factionId);
            result.set(force.instanceId, FormationNamerUtil.getForceSizeName(force, factionName));
        }
        return result;
    });

    /** BV/PV display value for each LoadForceEntry, keyed by instanceId. */
    protected forceValues = computed(() => {
        const result = new Map<string, string>();
        for (const force of this.allForces()) {
            if (force.type === 'as' && force.pv && force.pv > 0) {
                result.set(force.instanceId, `PV: ${force.pv}`);
            } else if (force.bv && force.bv > 0) {
                result.set(force.instanceId, `BV: ${force.bv.toLocaleString()}`);
            }
        }
        return result;
    });

    /** Descendant forces for each OrgGroup, keyed by group id. */
    private descendantForcesMap = computed(() => {
        const placed = this.placedForces();
        const groups = this.groups();
        const map = new Map<string, LoadForceEntry[]>();
        for (const group of groups) {
            map.set(group.id, this.collectDescendantForces(group.id, placed, groups));
        }
        return map;
    });

    /** Org size name for each OrgGroup, keyed by group id. */
    protected orgGroupOrgNames = computed(() => {
        const descendants = this.descendantForcesMap();
        const result = new Map<string, string>();
        for (const [groupId, entries] of descendants) {
            if (entries.length === 0) continue;
            const factionName = FormationNamerUtil.getDominantFactionName(
                entries,
                (id) => this.getFactionName(id),
            );
            result.set(groupId, FormationNamerUtil.getOrgGroupSizeName(entries, factionName));
        }
        return result;
    });

    /** Dominant faction ID for each OrgGroup, keyed by group id. */
    protected orgGroupFactionIds = computed(() => {
        const descendants = this.descendantForcesMap();
        const result = new Map<string, number | undefined>();
        for (const [groupId, entries] of descendants) {
            if (entries.length === 0) continue;
            result.set(groupId, this.getDominantFactionId(entries));
        }
        return result;
    });

    /** Total BV/PV for each OrgGroup, keyed by group id. */
    protected orgGroupTotals = computed(() => {
        const descendants = this.descendantForcesMap();
        const result = new Map<string, string>();
        for (const [groupId, entries] of descendants) {
            if (entries.length === 0) continue;
            let totalBv = 0;
            let totalPv = 0;
            for (const e of entries) {
                if (e.bv && e.bv > 0) totalBv += e.bv;
                if (e.pv && e.pv > 0) totalPv += e.pv;
            }
            const parts: string[] = [];
            if (totalBv > 0) parts.push(`BV: ${totalBv.toLocaleString()}`);
            if (totalPv > 0) parts.push(`PV: ${totalPv.toLocaleString()}`);
            if (parts.length > 0) result.set(groupId, parts.join(' · '));
        }
        return result;
    });

    /** Collect all forces that are descendants of a group (direct + through child groups). */
    private collectDescendantForces(groupId: string, placed: PlacedForce[], groups: OrgGroup[], visited = new Set<string>()): LoadForceEntry[] {
        if (visited.has(groupId)) return [];
        visited.add(groupId);
        const result: LoadForceEntry[] = [];
        for (const pf of placed) {
            if (pf.groupId === groupId) result.push(pf.force);
        }
        for (const child of groups) {
            if (child.parentGroupId === groupId) {
                result.push(...this.collectDescendantForces(child.id, placed, groups, visited));
            }
        }
        return result;
    }

    protected isParentGroup(group: OrgGroup): boolean {
        return this.groups().some(g => g.parentGroupId === group.id);
    }

    private nextZIndex = 0;
    private nextGroupZIndex = 0;

    constructor() {
        this.destroyRef.onDestroy(() => this.cleanupGlobalPointerState());
        this.loadForces();
    }

    // ==================== Data Loading ====================

    private async loadForces(): Promise<void> {
        this.loading.set(true);
        try {
            const result = await this.dataService.listForces();
            for (const f of result || []) {
                f._searchText = this.computeSearchText(f);
            }
            this.allForces.set(result || []);
        } catch {
            // Error loading forces; allForces remains empty
        } finally {
            this.loading.set(false);
        }
    }

    // ==================== Sidebar ====================

    protected toggleSidebar(): void {
        this.sidebarAnimated.set(true);
        this.sidebarOpen.set(!this.sidebarOpen());
    }

    protected onSidebarSearch(text: string): void {
        this.sidebarSearchText.set(text);
    }

    protected onSidebarGameTypeFilter(type: 'all' | GameSystem.CLASSIC | GameSystem.ALPHA_STRIKE): void {
        this.sidebarGameTypeFilter.set(type);
    }

    private computeSearchText(force: LoadForceEntry): string {
        let s = '';
        if (force.name) s += force.name + ' ';
        for (const g of (force.groups || [])) {
            if (g.name) s += g.name + ' ';
            for (const ue of (g.units || [])) {
                if (ue.alias) s += ue.alias + ' ';
                if (ue.unit) {
                    if (ue.unit.model) s += ue.unit.model + ' ';
                    if (ue.unit.chassis) s += ue.unit.chassis + ' ';
                }
            }
        }
        return s.trim().toLowerCase();
    }

    private getFactionName(factionId: number | undefined): string {
        if (factionId === undefined) return 'Mercenary';
        return this.dataService.getFactionById(factionId)?.name ?? 'Mercenary';
    }

    /** Get the dominant faction ID from a set of entries (by value, then frequency). */
    private getDominantFactionId(entries: LoadForceEntry[]): number | undefined {
        const withFaction = entries.filter(e => e.factionId !== undefined);
        if (withFaction.length === 0) return undefined;
        let bestValue = -1, bestId: number | undefined;
        for (const e of withFaction) {
            const v = (e.bv && e.bv > 0) ? e.bv : (e.pv ?? 0);
            if (v > bestValue) { bestValue = v; bestId = e.factionId; }
        }
        if (bestValue > 0 && bestId !== undefined) {
            const tied = withFaction.filter(e => ((e.bv && e.bv > 0) ? e.bv : (e.pv ?? 0)) === bestValue);
            if (tied.length === 1) return bestId;
        }
        const counts = new Map<number, number>();
        for (const e of withFaction) counts.set(e.factionId!, (counts.get(e.factionId!) ?? 0) + 1);
        let maxCount = 0, mostFreqId: number | undefined;
        for (const [fid, count] of counts) {
            if (count > maxCount) { maxCount = count; mostFreqId = fid; }
        }
        return mostFreqId ?? withFaction[0].factionId;
    }

    protected async previewForce(force: LoadForceEntry): Promise<void> {
        const { ForceEntryPreviewDialogComponent } = await import('../force-entry-preview-dialog/force-entry-preview-dialog.component');
        this.dialogsService.createDialog(ForceEntryPreviewDialogComponent, {
            data: { force }
        });
    }

    // ==================== Sidebar Drag ====================

    protected onSidebarForcePointerDown(event: PointerEvent, force: LoadForceEntry): void {
        event.preventDefault();
        event.stopPropagation();
        this.sidebarDragForce.set(force);
        this.sidebarDragActive.set(true);
        this.sidebarDragPos.set({ x: event.clientX, y: event.clientY });
        this.addGlobalPointerListeners();
    }

    // ==================== Canvas Force Drag ====================

    protected onForcePointerDown(event: PointerEvent, pf: PlacedForce): void {
        event.preventDefault();
        event.stopPropagation();
        this.draggedForce.set(pf);
        this.isDragging.set(true);
        this.forceDragged = false;
        this.dragStartPos = { x: event.clientX, y: event.clientY };
        this.forceStartPos = { x: pf.x, y: pf.y };
        this.bringForceToFront(pf);
        this.addGlobalPointerListeners();
    }

    private bringForceToFront(pf: PlacedForce): void {
        const forces = this.placedForces();
        const currentZ = pf.zIndex;
        for (const f of forces) {
            if (f.zIndex > currentZ) f.zIndex--;
        }
        pf.zIndex = forces.length - 1;
        this.nextZIndex = forces.length;
        this.placedForces.set([...forces]);
    }

    // ==================== Group Drag ====================

    protected onGroupPointerDown(event: PointerEvent, group: OrgGroup): void {
        event.preventDefault();
        event.stopPropagation();
        this.draggedGroup.set(group);
        this.groupDragged = false;
        this.groupDragStartPos = { x: event.clientX, y: event.clientY };
        this.groupStartPos = { x: group.x, y: group.y };
        this.addGlobalPointerListeners();
    }

    // ==================== Remove Force ====================

    protected removeForce(pf: PlacedForce): void {
        // Remove group membership
        if (pf.groupId) {
            const group = this.groups().find(g => g.id === pf.groupId);
            pf.groupId = null;
            if (group) this.recalcGroupBounds(group);
        }
        this.placedForces.set(this.placedForces().filter(f => f !== pf));
        // Clean up empty groups
        this.cleanupEmptyGroups();
    }

    // ==================== Group Management ====================

    protected async renameGroup(group: OrgGroup): Promise<void> {
        if (this.groupDragged) return;
        const newName = await this.dialogsService.prompt(
            'Enter a name for this group:',
            'Rename Group',
            group.name
        );
        if (newName !== null) {
            group.name = newName.trim();
            this.groups.set([...this.groups()]);
        }
    }

    protected removeGroup(group: OrgGroup): void {
        if (this.groupDragged) return;
        // Ungroup all direct force members
        for (const pf of this.placedForces()) {
            if (pf.groupId === group.id) {
                pf.groupId = group.parentGroupId;
            }
        }
        // Reparent child groups
        for (const g of this.groups()) {
            if (g.parentGroupId === group.id) {
                g.parentGroupId = group.parentGroupId;
            }
        }
        this.groups.set(this.groups().filter(g => g.id !== group.id));
        this.placedForces.set([...this.placedForces()]);
        // Relayout parent if exists
        if (group.parentGroupId) {
            const parent = this.groups().find(g => g.id === group.parentGroupId);
            if (parent) this.layoutGroup(parent);
        }
    }

    private cleanupEmptyGroups(): void {
        const placed = this.placedForces();
        const allGroups = this.groups();
        // A group is empty if it has no direct force members AND no child groups
        const nonEmpty = allGroups.filter(g =>
            placed.some(pf => pf.groupId === g.id) ||
            allGroups.some(child => child.parentGroupId === g.id)
        );
        if (nonEmpty.length !== allGroups.length) {
            this.groups.set(nonEmpty);
        }
    }

    private recalcGroupBounds(group: OrgGroup): void {
        const members = this.placedForces().filter(pf => pf.groupId === group.id);
        const childGroups = this.groups().filter(g => g.parentGroupId === group.id);
        if (members.length === 0 && childGroups.length === 0) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const m of members) {
            minX = Math.min(minX, m.x);
            minY = Math.min(minY, m.y);
            maxX = Math.max(maxX, m.x + CARD_WIDTH);
            maxY = Math.max(maxY, m.y + CARD_HEIGHT);
        }
        for (const cg of childGroups) {
            minX = Math.min(minX, cg.x);
            minY = Math.min(minY, cg.y);
            maxX = Math.max(maxX, cg.x + cg.width);
            maxY = Math.max(maxY, cg.y + cg.height);
        }

        group.x = minX - GROUP_PADDING;
        group.y = minY - GROUP_PADDING - GROUP_HEADER_HEIGHT;
        group.width = (maxX - minX) + GROUP_PADDING * 2;
        group.height = (maxY - minY) + GROUP_PADDING * 2 + GROUP_HEADER_HEIGHT;
        this.groups.set([...this.groups()]);

        // Recurse up: re-layout parent so siblings are repositioned
        if (group.parentGroupId) {
            const parent = this.groups().find(g => g.id === group.parentGroupId);
            if (parent) this.layoutGroup(parent);
        }
    }

    private rectsOverlap(a: Rect, b: Rect): boolean {
        return !(a.x + a.width < b.x || b.x + b.width < a.x ||
                 a.y + a.height < b.y || b.y + b.height < a.y);
    }

    private forceRect(pf: PlacedForce): Rect {
        return { x: pf.x, y: pf.y, width: CARD_WIDTH, height: CARD_HEIGHT };
    }

    /** Compute the preview rect + header info for a new group encompassing two rects. */
    private computeGroupPreview(a: Rect, b: Rect, entries: LoadForceEntry[]): GroupPreview {
        const minX = Math.min(a.x, b.x);
        const minY = Math.min(a.y, b.y);
        const maxX = Math.max(a.x + a.width, b.x + b.width);
        const maxY = Math.max(a.y + a.height, b.y + b.height);
        const factionName = FormationNamerUtil.getDominantFactionName(entries, id => this.getFactionName(id));
        const orgName = FormationNamerUtil.getOrgGroupSizeName(entries, factionName);
        let totalBv = 0, totalPv = 0;
        for (const e of entries) {
            if (e.bv && e.bv > 0) totalBv += e.bv;
            if (e.pv && e.pv > 0) totalPv += e.pv;
        }
        const parts: string[] = [];
        if (totalBv > 0) parts.push(`BV: ${totalBv.toLocaleString()}`);
        if (totalPv > 0) parts.push(`PV: ${totalPv.toLocaleString()}`);
        return {
            x: minX - GROUP_PADDING,
            y: minY - GROUP_PADDING - GROUP_HEADER_HEIGHT,
            width: (maxX - minX) + GROUP_PADDING * 2,
            height: (maxY - minY) + GROUP_PADDING * 2 + GROUP_HEADER_HEIGHT,
            orgName,
            totals: parts.join(' · '),
            factionId: this.getDominantFactionId(entries),
        };
    }

    /** Detect what would happen if the dragged force were dropped now. */
    private detectForceDrop(pf: PlacedForce): ForceDropAction | null {
        const pfRect = this.forceRect(pf);
        // Check overlap with existing groups (except own)
        for (const group of this.groups()) {
            if (pf.groupId === group.id) continue;
            if (this.rectsOverlap(pfRect, group)) {
                return { type: 'join-group', groupId: group.id };
            }
        }
        // Check if leaving own group
        const leavingGroup = pf.groupId
            ? (() => { const g = this.groups().find(g => g.id === pf.groupId); return g && !this.rectsOverlap(pfRect, g); })()
            : false;
        // Check overlap with ungrouped forces (always, not just when ungrouped)
        if (!pf.groupId || leavingGroup) {
            for (const other of this.placedForces()) {
                if (other === pf || other.groupId) continue;
                if (this.rectsOverlap(pfRect, this.forceRect(other))) {
                    return { type: 'new-group', other };
                }
            }
        }
        if (leavingGroup) {
            return { type: 'leave-group' };
        }
        return null;
    }

    /** Detect what would happen if the dragged group were dropped now. */
    private detectGroupDrop(grp: OrgGroup): GroupDropAction | null {
        for (const other of this.groups()) {
            if (other.id === grp.id) continue;
            if (this.isDescendantOf(other, grp.id)) continue;
            if (other.id === grp.parentGroupId) continue;
            if (!this.rectsOverlap(grp, other)) continue;
            const otherHasChildren = this.groups().some(g => g.parentGroupId === other.id);
            if (otherHasChildren && grp.parentGroupId !== other.id) {
                return { type: 'join-parent', groupId: other.id };
            }
        }
        for (const other of this.groups()) {
            if (other.id === grp.id) continue;
            if (other.parentGroupId !== grp.parentGroupId) continue;
            if (this.isDescendantOf(other, grp.id)) continue;
            if (this.isDescendantOf(grp, other.id)) continue;
            if (!this.rectsOverlap(grp, other)) continue;
            if (grp.parentGroupId !== null) {
                return { type: 'rearrange', parentId: grp.parentGroupId };
            }
            return { type: 'create-parent', other };
        }
        return null;
    }

    private clearDropPreview(): void {
        this.dropTargetGroupId.set(null);
        this.dropPreviewRect.set(null);
        this.previewGroupInfo.set(new Map());
    }

    /**
     * Compute preview org names, totals and faction IDs for a target group and all its
     * ancestors, as if extraEntries were added to the target group.
     */
    private computeGroupChainPreview(targetGroupId: string, extraEntries: LoadForceEntry[]): Map<string, { orgName: string; totals: string; factionId: number | undefined }> {
        const result = new Map<string, { orgName: string; totals: string; factionId: number | undefined }>();
        const groups = this.groups();
        const placed = this.placedForces();
        const visited = new Set<string>();

        // Walk the chain from the target group upward
        let currentId: string | null = targetGroupId;
        while (currentId && !visited.has(currentId)) {
            visited.add(currentId);
            // Extra entries added to the target bubble up through ancestors naturally
            const entries = [...this.collectDescendantForces(currentId, placed, groups), ...extraEntries];
            if (entries.length === 0) break;

            const factionName = FormationNamerUtil.getDominantFactionName(entries, id => this.getFactionName(id));
            const orgName = FormationNamerUtil.getOrgGroupSizeName(entries, factionName);
            const factionId = this.getDominantFactionId(entries);
            let totalBv = 0, totalPv = 0;
            for (const e of entries) {
                if (e.bv && e.bv > 0) totalBv += e.bv;
                if (e.pv && e.pv > 0) totalPv += e.pv;
            }
            const parts: string[] = [];
            if (totalBv > 0) parts.push(`BV: ${totalBv.toLocaleString()}`);
            if (totalPv > 0) parts.push(`PV: ${totalPv.toLocaleString()}`);
            result.set(currentId, { orgName, totals: parts.join(' · '), factionId });

            const group = groups.find(g => g.id === currentId);
            currentId = group?.parentGroupId ?? null;
        }
        return result;
    }

    /** Update preview state for a sidebar drag at the given world-space rect. */
    private updateSidebarDragPreview(rect: Rect, sidebarForce: LoadForceEntry): void {
        for (const group of this.groups()) {
            if (this.rectsOverlap(rect, group)) {
                this.dropTargetGroupId.set(group.id);
                this.dropPreviewRect.set(null);
                this.previewGroupInfo.set(this.computeGroupChainPreview(group.id, [sidebarForce]));
                return;
            }
        }
        for (const pf of this.placedForces()) {
            if (pf.groupId) continue;
            if (this.rectsOverlap(rect, this.forceRect(pf))) {
                this.dropTargetGroupId.set(null);
                this.dropPreviewRect.set(this.computeGroupPreview(rect, this.forceRect(pf), [sidebarForce, pf.force]));
                this.previewGroupInfo.set(new Map());
                return;
            }
        }
        this.clearDropPreview();
    }

    /** Update preview for a force or group drag action. */
    private updateDropPreview(action: ForceDropAction | GroupDropAction | null, draggedRect: Rect, otherRect?: Rect, entries?: LoadForceEntry[]): void {
        if (!action) {
            this.clearDropPreview();
            return;
        }
        switch (action.type) {
            case 'join-group':
            case 'join-parent':
                this.dropTargetGroupId.set(action.groupId);
                this.dropPreviewRect.set(null);
                this.previewGroupInfo.set(this.computeGroupChainPreview(action.groupId, entries ?? []));
                break;
            case 'rearrange':
                this.dropTargetGroupId.set(action.parentId);
                this.dropPreviewRect.set(null);
                this.previewGroupInfo.set(new Map());
                break;
            case 'new-group':
            case 'create-parent':
                this.dropTargetGroupId.set(null);
                this.dropPreviewRect.set(this.computeGroupPreview(draggedRect, otherRect!, entries ?? []));
                this.previewGroupInfo.set(new Map());
                break;
            default:
                this.clearDropPreview();
        }
    }

    /** Execute the force drop action detected by detectForceDrop. */
    private tryFormGroup(draggedPf: PlacedForce): void {
        const action = this.detectForceDrop(draggedPf);
        const placed = this.placedForces();

        switch (action?.type) {
            case 'join-group': {
                const oldGroup = draggedPf.groupId ? this.groups().find(g => g.id === draggedPf.groupId) : null;
                draggedPf.groupId = action.groupId;
                const group = this.groups().find(g => g.id === action.groupId)!;
                this.recalcGroupBounds(group);
                if (oldGroup) {
                    this.recalcGroupBounds(oldGroup);
                    this.cleanupEmptyGroups();
                }
                this.placedForces.set([...placed]);
                return;
            }
            case 'new-group': {
                const oldGroup = draggedPf.groupId ? this.groups().find(g => g.id === draggedPf.groupId) : null;
                const anchorX = Math.min(draggedPf.x, action.other.x);
                const anchorY = Math.min(draggedPf.y, action.other.y);
                const group: OrgGroup = {
                    id: crypto.randomUUID(),
                    name: '',
                    x: 0, y: 0,
                    width: 0, height: 0,
                    zIndex: this.nextGroupZIndex++,
                    parentGroupId: null,
                    anchorX,
                    anchorY,
                };
                draggedPf.groupId = group.id;
                action.other.groupId = group.id;
                this.groups.set([...this.groups(), group]);
                this.recalcGroupBounds(group);
                if (oldGroup) {
                    this.recalcGroupBounds(oldGroup);
                    this.cleanupEmptyGroups();
                }
                this.placedForces.set([...placed]);
                return;
            }
            case 'leave-group': {
                const group = this.groups().find(g => g.id === draggedPf.groupId)!;
                draggedPf.groupId = null;
                this.recalcGroupBounds(group);
                this.cleanupEmptyGroups();
                this.placedForces.set([...placed]);
                return;
            }
            default: {
                if (draggedPf.groupId) {
                    const group = this.groups().find(g => g.id === draggedPf.groupId);
                    if (group) this.recalcGroupBounds(group);
                }
            }
        }
    }

    /** A generic layout item: either a force card or a child group. */
    private getLayoutItems(group: OrgGroup): { x: number; y: number; w: number; h: number; apply: (x: number, y: number) => void }[] {
        const items: { x: number; y: number; w: number; h: number; apply: (x: number, y: number) => void }[] = [];
        // Direct force members
        for (const pf of this.placedForces().filter(f => f.groupId === group.id)) {
            items.push({ x: pf.x, y: pf.y, w: CARD_WIDTH, h: CARD_HEIGHT, apply: (nx, ny) => { pf.x = nx; pf.y = ny; } });
        }
        // Direct child groups
        for (const cg of this.groups().filter(g => g.parentGroupId === group.id)) {
            const capturedGroup = cg;
            items.push({ x: cg.x, y: cg.y, w: cg.width, h: cg.height, apply: (nx, ny) => { this.moveGroupTo(capturedGroup, nx, ny); } });
        }
        return items;
    }

    /** Move a group and all its descendants by the delta from old to new position. */
    private moveGroupTo(group: OrgGroup, newX: number, newY: number): void {
        const dx = newX - group.x;
        const dy = newY - group.y;
        if (dx === 0 && dy === 0) return;
        this.translateGroupRecursive(group, dx, dy);
    }

    /** Recursively translate a group and all descendants. */
    private translateGroupRecursive(group: OrgGroup, dx: number, dy: number): void {
        group.x += dx;
        group.y += dy;
        group.anchorX += dx;
        group.anchorY += dy;
        for (const pf of this.placedForces()) {
            if (pf.groupId === group.id) {
                pf.x += dx;
                pf.y += dy;
            }
        }
        for (const child of this.groups()) {
            if (child.parentGroupId === group.id) {
                this.translateGroupRecursive(child, dx, dy);
            }
        }
    }

    /**
     * Layout all direct children (force cards and child groups) of a group
     * into a grid. Items are sorted into rows by Y then columns by X,
     * then reflowed so no row exceeds MAX_ROW_ITEMS items wide.
     */
    private layoutGroup(group: OrgGroup): void {
        const items = this.getLayoutItems(group);
        if (items.length === 0) return;

        const MAX_ROW_ITEMS = 4;

        // Cluster items into rows by Y proximity
        const baseRowH = CARD_HEIGHT + CARD_GAP;
        const rowThreshold = baseRowH / 2;
        const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
        const rows: typeof items[] = [];
        let currentRow = [sorted[0]];
        let rowY = sorted[0].y;

        for (let i = 1; i < sorted.length; i++) {
            if (Math.abs(sorted[i].y - rowY) <= rowThreshold) {
                currentRow.push(sorted[i]);
            } else {
                rows.push(currentRow);
                currentRow = [sorted[i]];
                rowY = sorted[i].y;
            }
        }
        rows.push(currentRow);

        // Sort each row by X
        for (const row of rows) {
            row.sort((a, b) => a.x - b.x);
        }

        // Reflow: split any row that exceeds MAX_ROW_ITEMS
        const reflowed: typeof items[] = [];
        for (const row of rows) {
            for (let i = 0; i < row.length; i += MAX_ROW_ITEMS) {
                reflowed.push(row.slice(i, i + MAX_ROW_ITEMS));
            }
        }

        // Use group anchor as layout origin
        const anchorX = group.anchorX;
        const anchorY = group.anchorY;

        // Assign grid positions row by row
        let currentY = anchorY;
        for (const row of reflowed) {
            let currentX = anchorX;
            let maxH = 0;
            for (const item of row) {
                item.apply(currentX, currentY);
                currentX += item.w + CARD_GAP;
                maxH = Math.max(maxH, item.h);
            }
            currentY += maxH + CARD_GAP;
        }

        this.placedForces.set([...this.placedForces()]);
        this.recalcGroupBounds(group);
    }

    /** Check if a group is a descendant of another. */
    private isDescendantOf(group: OrgGroup, ancestorId: string): boolean {
        const visited = new Set<string>();
        let current: OrgGroup | undefined = group;
        while (current) {
            if (current.parentGroupId === ancestorId) return true;
            if (visited.has(current.id)) break;
            visited.add(current.id);
            current = this.groups().find(g => g.id === current!.parentGroupId);
        }
        return false;
    }

    /** Execute the group drop action detected by detectGroupDrop. */
    private tryMergeGroups(draggedGrp: OrgGroup): void {
        const action = this.detectGroupDrop(draggedGrp);

        switch (action?.type) {
            case 'join-parent': {
                const oldParent = draggedGrp.parentGroupId
                    ? this.groups().find(g => g.id === draggedGrp.parentGroupId)
                    : null;
                draggedGrp.parentGroupId = action.groupId;
                this.groups.set([...this.groups()]);
                if (oldParent) {
                    this.recalcGroupBounds(oldParent);
                    this.cleanupEmptyGroups();
                }
                const target = this.groups().find(g => g.id === action.groupId)!;
                this.layoutGroup(target);
                return;
            }
            case 'rearrange': {
                const parent = this.groups().find(g => g.id === action.parentId);
                if (parent) this.layoutGroup(parent);
                return;
            }
            case 'create-parent': {
                const anchorX = Math.min(draggedGrp.x, action.other.x) + GROUP_PADDING;
                const anchorY = Math.min(draggedGrp.y, action.other.y) + GROUP_PADDING + GROUP_HEADER_HEIGHT;
                const parentGroup: OrgGroup = {
                    id: crypto.randomUUID(),
                    name: '',
                    x: 0, y: 0,
                    width: 0, height: 0,
                    zIndex: this.nextGroupZIndex++,
                    parentGroupId: draggedGrp.parentGroupId,
                    anchorX,
                    anchorY,
                };
                draggedGrp.parentGroupId = parentGroup.id;
                action.other.parentGroupId = parentGroup.id;
                this.groups.set([...this.groups(), parentGroup]);
                this.layoutGroup(parentGroup);
                return;
            }
        }
    }

    // ==================== Pan / Zoom ====================

    protected onCanvasPointerDown(event: PointerEvent): void {
        this.setPointerCaptureIfAvailable(event);
        this.activeTouches.set(event.pointerId, event);
        this.lastPanPoint = this.getEffectivePanPoint();
        if (this.activeTouches.size === 2) this.startPinchGesture();
        this.addGlobalPointerListeners();
    }

    protected onWheel(event: WheelEvent): void {
        event.preventDefault();
        const delta = event.deltaY > 0 ? 0.9 : 1.1;
        const oldZoom = this.zoom();
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * delta));

        const svg = this.svgCanvas()?.nativeElement;
        if (svg && newZoom !== oldZoom) {
            const rect = svg.getBoundingClientRect();
            const mouseX = event.clientX - rect.left, mouseY = event.clientY - rect.top;
            const offset = this.viewOffset();
            const zoomRatio = newZoom / oldZoom;
            this.viewOffset.set({
                x: mouseX - (mouseX - offset.x) * zoomRatio,
                y: mouseY - (mouseY - offset.y) * zoomRatio
            });
        }
        this.zoom.set(newZoom);
    }

    private getEffectivePanPoint(): { x: number; y: number } {
        const touches = Array.from(this.activeTouches.values());
        if (touches.length === 0) return { x: 0, y: 0 };
        if (touches.length === 1) return { x: touches[0].clientX, y: touches[0].clientY };
        return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2
        };
    }

    private startPinchGesture(): void {
        const touches = Array.from(this.activeTouches.values());
        if (touches.length !== 2) return;
        this.pinchStartDistance = Math.hypot(
            touches[1].clientX - touches[0].clientX,
            touches[1].clientY - touches[0].clientY
        );
        this.pinchStartZoom = this.zoom();
    }

    private screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
        const svg = this.svgCanvas()?.nativeElement;
        if (!svg) return { x: screenX, y: screenY };
        const rect = svg.getBoundingClientRect();
        const offset = this.viewOffset();
        const scale = this.zoom();
        return {
            x: (screenX - rect.left - offset.x) / scale,
            y: (screenY - rect.top - offset.y) / scale
        };
    }

    // ==================== Global Pointer Handlers ====================

    private addGlobalPointerListeners(): void {
        if (this.hasGlobalPointerListeners) return;
        document.addEventListener('pointermove', this.onGlobalPointerMove);
        document.addEventListener('pointerup', this.onGlobalPointerUp);
        this.hasGlobalPointerListeners = true;
    }

    private cleanupGlobalPointerState(): void {
        if (this.moveRafId !== null) {
            cancelAnimationFrame(this.moveRafId);
            this.moveRafId = null;
        }
        this.pendingMoveEvent = null;
        this.activeTouches.clear();
        this.lastPanPoint = null;
        this.draggedForce.set(null);
        this.draggedGroup.set(null);
        this.sidebarDragForce.set(null);
        this.sidebarDragActive.set(false);
        this.isDragging.set(false);
        this.clearDropPreview();

        if (this.hasGlobalPointerListeners) {
            document.removeEventListener('pointermove', this.onGlobalPointerMove);
            document.removeEventListener('pointerup', this.onGlobalPointerUp);
            this.hasGlobalPointerListeners = false;
        }
    }

    private setPointerCaptureIfAvailable(event: PointerEvent): void {
        try {
            (event.currentTarget as Element)?.setPointerCapture(event.pointerId);
        } catch { /* best-effort */ }
    }

    private onGlobalPointerMove = (event: PointerEvent): void => {
        this.activeTouches.set(event.pointerId, event);

        // Cancel drags on multi-touch
        if (this.activeTouches.size >= 2 && (this.draggedForce() || this.draggedGroup() || this.sidebarDragActive())) {
            this.draggedForce.set(null);
            this.draggedGroup.set(null);
            this.sidebarDragForce.set(null);
            this.sidebarDragActive.set(false);
            this.isDragging.set(false);
            this.startPinchGesture();
            this.lastPanPoint = this.getEffectivePanPoint();
        }

        this.pendingMoveEvent = event;
        if (this.moveRafId !== null) return;
        this.moveRafId = requestAnimationFrame(() => {
            this.moveRafId = null;
            if (this.pendingMoveEvent) this.processPointerMove(this.pendingMoveEvent);
        });
    };

    private getScaledDelta(event: PointerEvent, startPos: { x: number; y: number }): { dx: number; dy: number } {
        const scale = this.zoom();
        return {
            dx: (event.clientX - startPos.x) / scale,
            dy: (event.clientY - startPos.y) / scale,
        };
    }

    private processPointerMove(event: PointerEvent): void {
        // Sidebar drag
        if (this.sidebarDragActive()) {
            this.sidebarDragPos.set({ x: event.clientX, y: event.clientY });
            // Show drop preview for sidebar drag
            const worldPos = this.screenToWorld(event.clientX, event.clientY);
            const sidebarRect: Rect = {
                x: worldPos.x - CARD_WIDTH / 2,
                y: worldPos.y - CARD_HEIGHT / 2,
                width: CARD_WIDTH,
                height: CARD_HEIGHT,
            };
            this.updateSidebarDragPreview(sidebarRect, this.sidebarDragForce()!);
            return;
        }

        // Canvas force drag
        const dragged = this.draggedForce();
        if (dragged) {
            const { dx, dy } = this.getScaledDelta(event, this.dragStartPos);
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.forceDragged = true;
            dragged.x = this.forceStartPos.x + dx;
            dragged.y = this.forceStartPos.y + dy;
            this.placedForces.set([...this.placedForces()]);
            // Update drop preview
            const forceAction = this.detectForceDrop(dragged);
            const otherRect = forceAction?.type === 'new-group' ? this.forceRect(forceAction.other) : undefined;
            const entries = forceAction?.type === 'new-group'
                ? [dragged.force, forceAction.other.force]
                : forceAction?.type === 'join-group'
                    ? [dragged.force]
                    : undefined;
            this.updateDropPreview(forceAction, this.forceRect(dragged), otherRect, entries);
            return;
        }

        // Group drag
        const draggedGrp = this.draggedGroup();
        if (draggedGrp) {
            const { dx, dy } = this.getScaledDelta(event, this.groupDragStartPos);
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.groupDragged = true;
            const newX = this.groupStartPos.x + dx;
            const newY = this.groupStartPos.y + dy;
            const moveDx = newX - draggedGrp.x;
            const moveDy = newY - draggedGrp.y;

            // Move group and all descendants
            this.translateGroupRecursive(draggedGrp, moveDx, moveDy);

            this.groups.set([...this.groups()]);
            this.placedForces.set([...this.placedForces()]);
            // Update drop preview
            const grpAction = this.detectGroupDrop(draggedGrp);
            const grpOtherRect = grpAction?.type === 'create-parent' ? grpAction.other as Rect : undefined;
            const grpEntries = grpAction?.type === 'create-parent'
                ? [...this.collectDescendantForces(draggedGrp.id, this.placedForces(), this.groups()), ...this.collectDescendantForces(grpAction.other.id, this.placedForces(), this.groups())]
                : (grpAction?.type === 'join-parent'
                    ? this.collectDescendantForces(draggedGrp.id, this.placedForces(), this.groups())
                    : undefined);
            this.updateDropPreview(grpAction, draggedGrp, grpOtherRect, grpEntries);
            return;
        }

        // Pan
        if (this.activeTouches.size > 0 && this.lastPanPoint) {
            const currentPanPoint = this.getEffectivePanPoint();
            let newOffsetX = this.viewOffset().x + currentPanPoint.x - this.lastPanPoint.x;
            let newOffsetY = this.viewOffset().y + currentPanPoint.y - this.lastPanPoint.y;

            if (this.activeTouches.size === 2) {
                const touches = Array.from(this.activeTouches.values());
                const currentDistance = Math.hypot(
                    touches[1].clientX - touches[0].clientX,
                    touches[1].clientY - touches[0].clientY
                );
                const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM,
                    this.pinchStartZoom * currentDistance / this.pinchStartDistance
                ));
                const oldZoom = this.zoom();

                if (newZoom !== oldZoom) {
                    const svg = this.svgCanvas()?.nativeElement;
                    if (svg) {
                        const rect = svg.getBoundingClientRect();
                        const centerX = currentPanPoint.x - rect.left;
                        const centerY = currentPanPoint.y - rect.top;
                        const zoomRatio = newZoom / oldZoom;
                        newOffsetX = centerX - (centerX - newOffsetX) * zoomRatio;
                        newOffsetY = centerY - (centerY - newOffsetY) * zoomRatio;
                    }
                }
                this.zoom.set(newZoom);
            }

            this.viewOffset.set({ x: newOffsetX, y: newOffsetY });
            this.lastPanPoint = currentPanPoint;
        }
    }

    private onGlobalPointerUp = (event: PointerEvent): void => {
        this.activeTouches.delete(event.pointerId);
        this.pendingMoveEvent = null;

        if (this.activeTouches.size > 0) {
            this.lastPanPoint = this.getEffectivePanPoint();
            if (this.activeTouches.size === 2) this.startPinchGesture();
        }

        // Handle sidebar drag drop
        if (this.sidebarDragActive()) {
            const force = this.sidebarDragForce();
            if (force) {
                // Only place if dropped outside the sidebar (on the canvas)
                const dropTarget = document.elementFromPoint(event.clientX, event.clientY);
                const isOverSidebar = dropTarget?.closest('.forces-sidebar') != null;
                if (!isOverSidebar) {
                    const worldPos = this.screenToWorld(event.clientX, event.clientY);
                    const svg = this.svgCanvas()?.nativeElement;
                    if (svg) {
                        const rect = svg.getBoundingClientRect();
                        if (event.clientX >= rect.left && event.clientX <= rect.right &&
                            event.clientY >= rect.top && event.clientY <= rect.bottom) {
                            const newPlaced: PlacedForce = {
                                force,
                                x: worldPos.x - CARD_WIDTH / 2,
                                y: worldPos.y - CARD_HEIGHT / 2,
                                zIndex: this.nextZIndex++,
                                groupId: null
                            };
                            this.placedForces.set([...this.placedForces(), newPlaced]);
                            // Try grouping with nearby forces
                            this.tryFormGroup(newPlaced);
                            if (newPlaced.groupId) {
                                const group = this.groups().find(g => g.id === newPlaced.groupId);
                                if (group) this.layoutGroup(group);
                            }
                        }
                    }
                }
            }
            this.sidebarDragForce.set(null);
            this.sidebarDragActive.set(false);
        }

        // Handle canvas force drag end
        const dragged = this.draggedForce();
        if (dragged) {
            if (this.forceDragged) {
                this.tryFormGroup(dragged);
                if (dragged.groupId) {
                    const group = this.groups().find(g => g.id === dragged.groupId);
                    if (group) this.layoutGroup(group);
                }
            }
            this.draggedForce.set(null);
            this.isDragging.set(false);
        }

        // Handle group drag end
        const dragEndGroup = this.draggedGroup();
        if (dragEndGroup) {
            if (this.groupDragged) {
                // Check if dragged out of parent
                if (dragEndGroup.parentGroupId) {
                    const parent = this.groups().find(g => g.id === dragEndGroup.parentGroupId);
                    const dropWorld = this.screenToWorld(event.clientX, event.clientY);
                    const pointerOutside = parent && (
                        dropWorld.x < parent.x || dropWorld.x > parent.x + parent.width ||
                        dropWorld.y < parent.y || dropWorld.y > parent.y + parent.height
                    );
                    if (parent && pointerOutside) {
                        dragEndGroup.parentGroupId = null;
                        this.groups.set([...this.groups()]);
                        // Re-layout old parent (and clean up if empty)
                        this.recalcGroupBounds(parent);
                        this.cleanupEmptyGroups();
                    } else {
                        this.tryMergeGroups(dragEndGroup);
                    }
                } else {
                    this.tryMergeGroups(dragEndGroup);
                }
                // Re-layout parent if it still has one
                if (dragEndGroup.parentGroupId) {
                    const parent = this.groups().find(g => g.id === dragEndGroup.parentGroupId);
                    if (parent) this.layoutGroup(parent);
                }
            }
            this.draggedGroup.set(null);
        }

        if (this.activeTouches.size === 0) this.cleanupGlobalPointerState();
    };

    // ==================== Dialog Actions ====================

    protected close(): void {
        this.dialogRef.close();
    }
}
