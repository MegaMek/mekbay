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
    AfterViewInit
} from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { LoadForceEntry } from '../../models/load-force-entry.model';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { LayoutService } from '../../services/layout.service';
import { FactionImgPipe } from '../../pipes/faction-img.pipe';
import { FormationNamerUtil } from '../../utils/formation-namer.util';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3.0;

const CARD_WIDTH = 220;
const CARD_HEIGHT = 70;
const CARD_GAP = 12;
const GROUP_PADDING = 24;
const GROUP_HEADER_HEIGHT = 36;

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
export class ForceOrgDialogComponent implements AfterViewInit {
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

    // Sidebar
    protected sidebarOpen = signal(false);
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

    /** Forces available in sidebar (not yet placed) */
    protected sidebarForces = computed(() => {
        const placedIds = new Set(this.placedForces().map(p => p.force.instanceId));
        return this.allForces().filter(f => !placedIds.has(f.instanceId));
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
            let current: OrgGroup | undefined = g;
            while (current?.parentGroupId) {
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
        const placed = this.placedForces();
        const result = new Map<string, string>();
        for (const pf of placed) {
            const factionName = this.getFactionName(pf.force.factionId);
            result.set(pf.force.instanceId, FormationNamerUtil.getForceSizeName(pf.force, factionName));
        }
        return result;
    });

    /** Org size name for each OrgGroup, keyed by group id. */
    protected orgGroupOrgNames = computed(() => {
        const placed = this.placedForces();
        const groups = this.groups();
        const result = new Map<string, string>();
        for (const group of groups) {
            const entries = this.collectDescendantForces(group.id, placed, groups);
            if (entries.length === 0) continue;
            const factionName = FormationNamerUtil.getDominantFactionName(
                entries,
                (id) => this.getFactionName(id),
            );
            result.set(group.id, FormationNamerUtil.getOrgGroupSizeName(entries, factionName));
        }
        return result;
    });

    /** Collect all forces that are descendants of a group (direct + through child groups). */
    private collectDescendantForces(groupId: string, placed: PlacedForce[], groups: OrgGroup[]): LoadForceEntry[] {
        const result: LoadForceEntry[] = [];
        for (const pf of placed) {
            if (pf.groupId === groupId) result.push(pf.force);
        }
        for (const child of groups) {
            if (child.parentGroupId === groupId) {
                result.push(...this.collectDescendantForces(child.id, placed, groups));
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

    ngAfterViewInit() {
        // Nothing to initialize since we start with an empty canvas
    }

    // ==================== Data Loading ====================

    private async loadForces(): Promise<void> {
        this.loading.set(true);
        try {
            const result = await this.dataService.listForces();
            this.allForces.set(result || []);
        } finally {
            this.loading.set(false);
        }
    }

    // ==================== Sidebar ====================

    protected toggleSidebar(): void {
        this.sidebarAnimated.set(true);
        this.sidebarOpen.set(!this.sidebarOpen());
    }

    protected getForceValue(force: LoadForceEntry): string {
        if (force.type === 'as' && force.pv && force.pv > 0) {
            return `PV: ${force.pv}`;
        }
        if (force.bv && force.bv > 0) {
            return `BV: ${force.bv.toLocaleString()}`;
        }
        return '';
    }

    private getFactionName(factionId: number | undefined): string {
        if (factionId === undefined) return 'Mercenary';
        return this.dataService.getFactionById(factionId)?.name ?? 'Mercenary';
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
        pf.zIndex = this.nextZIndex++;
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
        if (newName !== null && newName.trim() !== '') {
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

        // Recurse up
        if (group.parentGroupId) {
            const parent = this.groups().find(g => g.id === group.parentGroupId);
            if (parent) this.recalcGroupBounds(parent);
        }
    }

    /** Try to merge two overlapping ungrouped forces into a group, or add to existing group */
    private tryFormGroup(draggedPf: PlacedForce): void {
        const placed = this.placedForces();

        // Check if dragged force overlaps with a leaf group (no child groups)
        for (const group of this.groups()) {
            if (draggedPf.groupId === group.id) continue;
            if (this.forceOverlapsGroup(draggedPf, group)) {
                // Only join leaf groups directly
                const hasChildGroups = this.groups().some(g => g.parentGroupId === group.id);
                if (hasChildGroups) continue;
                // Remove from old group if any
                const oldGroup = draggedPf.groupId ? this.groups().find(g => g.id === draggedPf.groupId) : null;
                draggedPf.groupId = group.id;
                this.recalcGroupBounds(group);
                if (oldGroup) {
                    this.recalcGroupBounds(oldGroup);
                    this.cleanupEmptyGroups();
                }
                this.placedForces.set([...placed]);
                return;
            }
        }

        // Check if dragged ungrouped force overlaps another ungrouped force
        if (!draggedPf.groupId) {
            for (const other of placed) {
                if (other === draggedPf || other.groupId) continue;
                if (this.forcesOverlap(draggedPf, other)) {
                    const anchorX = Math.min(draggedPf.x, other.x);
                    const anchorY = Math.min(draggedPf.y, other.y);
                    const group: OrgGroup = {
                        id: crypto.randomUUID(),
                        name: 'New Group',
                        x: 0, y: 0,
                        width: 0, height: 0,
                        zIndex: this.nextGroupZIndex++,
                        parentGroupId: null,
                        anchorX,
                        anchorY,
                    };
                    draggedPf.groupId = group.id;
                    other.groupId = group.id;
                    this.groups.set([...this.groups(), group]);
                    this.recalcGroupBounds(group);
                    this.placedForces.set([...placed]);
                    return;
                }
            }
        }

        // If dragged force was in a group, check if still within group bounds
        if (draggedPf.groupId) {
            const group = this.groups().find(g => g.id === draggedPf.groupId);
            if (group && !this.forceOverlapsGroup(draggedPf, group)) {
                draggedPf.groupId = null;
                this.recalcGroupBounds(group);
                this.cleanupEmptyGroups();
                this.placedForces.set([...placed]);
            } else if (group) {
                this.recalcGroupBounds(group);
            }
        }
    }

    private forcesOverlap(a: PlacedForce, b: PlacedForce): boolean {
        return !(a.x + CARD_WIDTH < b.x || b.x + CARD_WIDTH < a.x ||
                 a.y + CARD_HEIGHT < b.y || b.y + CARD_HEIGHT < a.y);
    }

    private forceOverlapsGroup(pf: PlacedForce, group: OrgGroup): boolean {
        const cx = pf.x + CARD_WIDTH / 2;
        const cy = pf.y + CARD_HEIGHT / 2;
        return cx >= group.x && cx <= group.x + group.width &&
               cy >= group.y && cy <= group.y + group.height;
    }

    /** Snap a force's position to align with siblings in the same group. */
    private snapToGroupGrid(_pf: PlacedForce): void {
        // Snapping is now handled entirely by layoutGroup
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

    /** Check if two groups overlap (bounding box intersection). */
    private groupsOverlap(a: OrgGroup, b: OrgGroup): boolean {
        return !(a.x + a.width < b.x || b.x + b.width < a.x ||
                 a.y + a.height < b.y || b.y + b.height < a.y);
    }

    /** Check if a group is a descendant of another. */
    private isDescendantOf(group: OrgGroup, ancestorId: string): boolean {
        let current: OrgGroup | undefined = group;
        while (current) {
            if (current.parentGroupId === ancestorId) return true;
            current = this.groups().find(g => g.id === current!.parentGroupId);
        }
        return false;
    }

    /**
     * After a group drag ends, check if it overlaps another top-level or
     * sibling group and merge them into a parent group.
     */
    private tryMergeGroups(draggedGroup: OrgGroup): void {
        for (const other of this.groups()) {
            if (other.id === draggedGroup.id) continue;
            if (other.parentGroupId !== draggedGroup.parentGroupId) continue;
            if (this.isDescendantOf(other, draggedGroup.id)) continue;
            if (this.isDescendantOf(draggedGroup, other.id)) continue;
            if (!this.groupsOverlap(draggedGroup, other)) continue;

            // Create parent group containing both
            const anchorX = Math.min(draggedGroup.x, other.x) + GROUP_PADDING;
            const anchorY = Math.min(draggedGroup.y, other.y) + GROUP_PADDING + GROUP_HEADER_HEIGHT;
            const parentGroup: OrgGroup = {
                id: crypto.randomUUID(),
                name: 'New Group',
                x: 0, y: 0,
                width: 0, height: 0,
                zIndex: this.nextGroupZIndex++,
                parentGroupId: draggedGroup.parentGroupId,
                anchorX,
                anchorY,
            };
            draggedGroup.parentGroupId = parentGroup.id;
            other.parentGroupId = parentGroup.id;
            this.groups.set([...this.groups(), parentGroup]);
            this.layoutGroup(parentGroup);
            return;
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

        if (this.hasGlobalPointerListeners) {
            document.removeEventListener('pointermove', this.onGlobalPointerMove);
            document.removeEventListener('pointerup', this.onGlobalPointerUp);
            this.hasGlobalPointerListeners = false;
        }
    }

    private setPointerCaptureIfAvailable(event: PointerEvent): void {
        const el = event.currentTarget as Element | null;
        try {
            (el as unknown as { setPointerCapture?: (pointerId: number) => void })?.setPointerCapture?.(event.pointerId);
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

    private processPointerMove(event: PointerEvent): void {
        // Sidebar drag
        if (this.sidebarDragActive()) {
            this.sidebarDragPos.set({ x: event.clientX, y: event.clientY });
            return;
        }

        // Canvas force drag
        const dragged = this.draggedForce();
        if (dragged) {
            const scale = this.zoom();
            const deltaX = (event.clientX - this.dragStartPos.x) / scale;
            const deltaY = (event.clientY - this.dragStartPos.y) / scale;
            dragged.x = this.forceStartPos.x + deltaX;
            dragged.y = this.forceStartPos.y + deltaY;
            this.placedForces.set([...this.placedForces()]);
            return;
        }

        // Group drag
        const draggedGrp = this.draggedGroup();
        if (draggedGrp) {
            const scale = this.zoom();
            const deltaX = (event.clientX - this.groupDragStartPos.x) / scale;
            const deltaY = (event.clientY - this.groupDragStartPos.y) / scale;
            if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) this.groupDragged = true;
            const newX = this.groupStartPos.x + deltaX;
            const newY = this.groupStartPos.y + deltaY;
            const dx = newX - draggedGrp.x;
            const dy = newY - draggedGrp.y;

            // Move group and all descendants
            this.translateGroupRecursive(draggedGrp, dx, dy);

            this.groups.set([...this.groups()]);
            this.placedForces.set([...this.placedForces()]);
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
                const worldPos = this.screenToWorld(event.clientX, event.clientY);
                // Only place if dropped on the canvas area (not back on sidebar)
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
            this.sidebarDragForce.set(null);
            this.sidebarDragActive.set(false);
        }

        // Handle canvas force drag end
        const dragged = this.draggedForce();
        if (dragged) {
            this.tryFormGroup(dragged);
            if (dragged.groupId) {
                const group = this.groups().find(g => g.id === dragged.groupId);
                if (group) this.layoutGroup(group);
            }
            this.draggedForce.set(null);
            this.isDragging.set(false);
        }

        // Handle group drag end
        const dragEndGroup = this.draggedGroup();
        if (dragEndGroup) {
            if (this.groupDragged) {
                this.tryMergeGroups(dragEndGroup);
                // Re-layout parent if it has one
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
