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
    effect,
    type ElementRef,
    inject,
    signal,
    viewChild,
    type WritableSignal,
} from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { LoadForceEntry } from '../../models/load-force-entry.model';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { LayoutService } from '../../services/layout.service';
import { UrlStateService } from '../../services/url-state.service';
import { FactionImgPipe } from '../../pipes/faction-img.pipe';
import type { GroupSizeResult, OrgSizeResult } from '../../utils/org/org-types';
import { GameSystem } from '../../models/common.model';
import { getUnitsAverageTechBase, type TechBase } from '../../models/tech.model';
import type { LoadedOrganization, SerializedOrganization, OrgPlacedForce, OrgGroupData } from '../../models/organization.model';
import { ForceEntryPreviewDialogComponent } from '../force-entry-preview-dialog/force-entry-preview-dialog.component';
import type { Era } from '../../models/eras.model';
import { getOrgFromForce, getOrgFromForceCollection } from '../../utils/org/org-namer.util';
import { Faction } from '../../models/factions.model';

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.0;

const GRID_SNAP_SIZE = 20;
const CARD_WIDTH = 220;
const CARD_HEIGHT = 70;
const GROUP_PADDING = 20;
const GROUP_HEADER_HEIGHT = 64;
const GROUP_EMBED_OVERLAP_THRESHOLD = 0.2;
const COLLISION_EDGE_PADDING = 8;
const COLLISION_RESOLVE_MAX_ITERATIONS = 50;
const READONLY_PREVIEW_MOVE_THRESHOLD = 6;

function snapToGrid(value: number): number {
    return Math.round(value / GRID_SNAP_SIZE) * GRID_SNAP_SIZE;
}

function snapDownToGrid(value: number): number {
    return Math.floor(value / GRID_SNAP_SIZE) * GRID_SNAP_SIZE;
}

function snapUpToGrid(value: number): number {
    return Math.ceil(value / GRID_SNAP_SIZE) * GRID_SNAP_SIZE;
}

function snapGroupXToGrid(value: number): number {
    return snapToGrid(value + GROUP_PADDING) - GROUP_PADDING;
}

function snapGroupYToGrid(value: number): number {
    return snapToGrid(value + GROUP_HEADER_HEIGHT + GROUP_PADDING) - GROUP_HEADER_HEIGHT - GROUP_PADDING;
}

function snapGroupXDownToGrid(value: number): number {
    return snapDownToGrid(value + GROUP_PADDING) - GROUP_PADDING;
}

function snapGroupXUpToGrid(value: number): number {
    return snapUpToGrid(value + GROUP_PADDING) - GROUP_PADDING;
}

function snapGroupYDownToGrid(value: number): number {
    return snapDownToGrid(value + GROUP_HEADER_HEIGHT + GROUP_PADDING) - GROUP_HEADER_HEIGHT - GROUP_PADDING;
}

function snapGroupYUpToGrid(value: number): number {
    return snapUpToGrid(value + GROUP_HEADER_HEIGHT + GROUP_PADDING) - GROUP_HEADER_HEIGHT - GROUP_PADDING;
}

/** Compute total BV and PV for a force by summing base unit values.
 *  Only sums BV for Classic forces and PV for Alpha Strike forces. */
function computeForceUnitTotals(force: LoadForceEntry): { totalBv: number; totalPv: number } {
    let totalBv = 0, totalPv = 0;
    const isAS = force.type === GameSystem.ALPHA_STRIKE;
    for (const g of force.groups ?? []) {
        for (const ue of g.units ?? []) {
            if (ue.unit) {
                if (isAS) {
                    totalPv += ue.unit.pv ?? 0;
                } else {
                    totalBv += ue.unit.bv ?? 0;
                }
            }
        }
    }
    return { totalBv, totalPv };
}

/** Get the dominance value for a force by summing unit.bv (common scale across game systems). */
function getForceValue(force: LoadForceEntry): number {
    let total = 0;
    for (const g of force.groups ?? []) {
        for (const ue of g.units ?? []) {
            if (ue.unit) total += ue.unit.bv ?? 0;
        }
    }
    return total;
}

function getLoadForceFactionId(force: LoadForceEntry): number | undefined {
    return force.faction?.id;
}

/** Format BV/PV totals for a set of entries as a display string. */
function formatTotals(entries: LoadForceEntry[]): string {
    let totalBv = 0, totalPv = 0;
    for (const e of entries) {
        const t = computeForceUnitTotals(e);
        totalBv += t.totalBv;
        totalPv += t.totalPv;
    }
    const parts: string[] = [];
    if (totalBv > 0) parts.push(`BV: ${totalBv.toLocaleString()}`);
    if (totalPv > 0) parts.push(`PV: ${totalPv.toLocaleString()}`);
    return parts.join(' · ');
}

/** Determine the dominant faction ID from a set of entries, using computed unit totals. */
function getDominantFactionId(entries: LoadForceEntry[]): number | undefined {
    const withFaction = entries.filter(e => getLoadForceFactionId(e) !== undefined);
    if (withFaction.length === 0) return undefined;
    const valueSums = new Map<number, number>();
    const counts = new Map<number, number>();
    for (const e of withFaction) {
        const fid = getLoadForceFactionId(e)!;
        valueSums.set(fid, (valueSums.get(fid) ?? 0) + getForceValue(e));
        counts.set(fid, (counts.get(fid) ?? 0) + 1);
    }
    let bestValue = -1, bestId: number | undefined;
    for (const [fid, total] of valueSums) {
        if (total > bestValue) { bestValue = total; bestId = fid; }
    }
    if (bestValue > 0 && bestId !== undefined) return bestId;
    let maxCount = 0, mostFreqId: number | undefined;
    for (const [fid, count] of counts) {
        if (count > maxCount) { maxCount = count; mostFreqId = fid; }
    }
    return mostFreqId ?? getLoadForceFactionId(withFaction[0]);
}

interface Rect { x: number; y: number; width: number; height: number }
interface GroupPreview extends Rect { orgName: string; totals: string; factionId: number | undefined }

interface PreviewOrgExtras {
    targetGroupId: string;
    entries: LoadForceEntry[];
    childGroupResults?: GroupSizeResult[];
}

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
    x: WritableSignal<number>;
    y: WritableSignal<number>;
    zIndex: WritableSignal<number>;
    groupId: string | null;
}

/** An organizational group containing forces or other groups */
class OrgGroup {
    readonly id: string;
    readonly name: WritableSignal<string>;
    readonly x: WritableSignal<number>;
    readonly y: WritableSignal<number>;
    readonly width: WritableSignal<number>;
    readonly height: WritableSignal<number>;
    readonly zIndex: WritableSignal<number>;
    parentGroupId: string | null;

    /** Descendant forces — set externally, drives totals computation. */
    readonly descendants = signal<LoadForceEntry[]>([]);
    /** Computed org size name (not serialized). */
    readonly orgName = signal('');
    /** Computed dominant faction ID (not serialized). */
    readonly factionId = signal<number | undefined>(undefined);
    /** Computed dominant faction (not serialized). */
    readonly faction = signal<Faction | undefined>(undefined);
    /** Computed BV/PV totals string (not serialized). */
    readonly totals = computed(() => {
        const desc = this.descendants();
        return desc.length > 0 ? formatTotals(desc) : '';
    });

    constructor(params: {
        id?: string;
        name?: string;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        zIndex: number;
        parentGroupId?: string | null;
    }) {
        this.id = params.id ?? crypto.randomUUID();
        this.name = signal(params.name ?? '');
        this.x = signal(params.x ?? 0);
        this.y = signal(params.y ?? 0);
        this.width = signal(params.width ?? 0);
        this.height = signal(params.height ?? 0);
        this.zIndex = signal(params.zIndex);
        this.parentGroupId = params.parentGroupId ?? null;
    }
}

/** Dialog input data for loading a saved organization */
export interface ForceOrgDialogData {
    organizationId?: string;
}

interface ForceMetadata {
    org: OrgSizeResult;
    bvString: string;
    totalBv: number;
    totalPv: number;
}

function createMissingForceEntry(instanceId: string): LoadForceEntry {
    return new LoadForceEntry({
        instanceId,
        name: 'Missing Force',
        missing: true,
        groups: [],
    });
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
    private forceBuilderService = inject(ForceBuilderService);
    private destroyRef = inject(DestroyRef);
    private urlStateService = inject(UrlStateService);
    protected layoutService = inject(LayoutService);
    private svgCanvas = viewChild<ElementRef<SVGSVGElement>>('svgCanvas');
    private dialogData: ForceOrgDialogData | null = inject(DIALOG_DATA, { optional: true });

    protected readonly CARD_WIDTH = CARD_WIDTH;
    protected readonly CARD_HEIGHT = CARD_HEIGHT;
    protected readonly GROUP_PADDING = GROUP_PADDING;
    protected readonly GROUP_HEADER_HEIGHT = GROUP_HEADER_HEIGHT;
    protected readonly GameSystem = GameSystem;
    protected readonly MISSING_FORCE_SUBTITLE = 'Unavailable offline or not downloaded';

    // Organization state
    protected organizationId = signal<string | null>(this.dialogData?.organizationId ?? null);
    protected organizationName = signal('Unnamed Organization');
    protected organizationOwned = signal(true);
    protected readOnly = computed(() => !this.organizationOwned());
    protected saving = signal(false);
    protected dirty = signal(false);

    /** Instance ID of the currently selected force in ForceBuilderService. */
    protected selectedForceInstanceId = computed(() => {
        const unit = this.forceBuilderService.selectedUnit();
        return unit?.force?.instanceId() ?? null;
    });

    /** Map of loaded force instanceId → alignment ('friendly' | 'enemy'). */
    protected loadedForceAlignments = computed<Map<string, 'friendly' | 'enemy'>>(() => {
        const map = new Map<string, 'friendly' | 'enemy'>();
        for (const slot of this.forceBuilderService.loadedForces()) {
            const id = slot.force.instanceId();
            if (id) map.set(id, slot.alignment);
        }
        return map;
    });

    /** Dominant faction ID computed hierarchically from top-level groups + ungrouped forces. */
    protected organizationFactionId = computed<number | undefined>(() => {
        const placed = this.placedForces();
        const groups = this.groups();
        const factionIds = this.groupFactionIds();
        const descendantsMap = this.descendantForcesMap();
        const valueSums = new Map<number, number>();
        const counts = new Map<number, number>();

        // Top-level groups as single entities
        for (const group of groups) {
            if (group.parentGroupId !== null) continue;
            const fid = factionIds.get(group.id);
            if (fid === undefined) continue;
            let totalValue = 0;
            for (const e of descendantsMap.get(group.id) ?? []) {
                totalValue += getForceValue(e);
            }
            valueSums.set(fid, (valueSums.get(fid) ?? 0) + totalValue);
            counts.set(fid, (counts.get(fid) ?? 0) + 1);
        }

        // Ungrouped forces
        for (const pf of placed) {
            if (pf.groupId !== null) continue;
            const fid = getLoadForceFactionId(pf.force);
            if (fid === undefined) continue;
            valueSums.set(fid, (valueSums.get(fid) ?? 0) + getForceValue(pf.force));
            counts.set(fid, (counts.get(fid) ?? 0) + 1);
        }

        if (valueSums.size === 0 && counts.size === 0) return undefined;
        let bestValue = -1, bestId: number | undefined;
        for (const [fid, total] of valueSums) {
            if (total > bestValue) { bestValue = total; bestId = fid; }
        }
        if (bestValue > 0 && bestId !== undefined) return bestId;
        let maxCount = 0, mostFreqId: number | undefined;
        for (const [fid, count] of counts) {
            if (count > maxCount) { maxCount = count; mostFreqId = fid; }
        }
        return mostFreqId;
    });

    // Sidebar
    protected sidebarOpen = signal(false);
    protected sidebarSearchText = signal('');
    protected sidebarGameTypeFilter = signal<'all' | GameSystem.CLASSIC | GameSystem.ALPHA_STRIKE>('all');
    protected sidebarAnimated = signal(false);
    protected loading = signal(true);

    // Sidebar sort
    protected readonly SORT_OPTIONS: { key: string; label: string }[] = [
        { key: 'timestamp', label: 'Date' },
        { key: 'name', label: 'Name' },
        { key: 'value', label: 'Value' },
        { key: 'faction', label: 'Faction' },
        { key: 'size', label: 'Size' },
    ];
    protected sidebarSort = signal<string>('timestamp');
    protected sidebarSortDirection = signal<'asc' | 'desc'>('desc');

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
    private pendingReadonlyPreview: { pointerId: number; startX: number; startY: number; force: LoadForceEntry } | null = null;

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
    private sidebarHoldTimer: ReturnType<typeof setTimeout> | null = null;
    private sidebarHoldPointerId: number | null = null;

    // Drag state for groups
    private draggedGroup = signal<OrgGroup | null>(null);
    private groupDragStartPos = { x: 0, y: 0 };
    private groupStartPos = { x: 0, y: 0 };
    private groupDragged = false;
    private titleDragGroupId: string | null = null;

    // Hover state
    protected hoveredForceId = signal<string | null>(null);

    // Drop preview state
    protected dropTargetGroupId = signal<string | null>(null);
    protected dropPreviewRect = signal<GroupPreview | null>(null);
    private previewExtraForces = signal<PreviewOrgExtras | null>(null);
    /** Identity of the "other" target in the current new-group/create-parent preview. */
    private previewOtherId: string | null = null;
    /** Cached org metadata for the current preview (orgName, totals, factionId). */
    private previewOrgCache: { orgName: string; totals: string; factionId: number | undefined } | null = null;

    /** Forces available in sidebar (not yet placed) */
    protected sidebarForces = computed(() => {
        const placedIds = new Set(this.placedForces().map(p => p.force.instanceId));
        const typeFilter = this.sidebarGameTypeFilter();
        const tokens = this.sidebarSearchText().trim().toLowerCase().split(/\s+/).filter(Boolean);
        const sortKey = this.sidebarSort();
        const sortDir = this.sidebarSortDirection();
        const filtered = this.allForces().filter(f => {
            if (placedIds.has(f.instanceId)) return false;
            if (typeFilter !== 'all' && (f.type || GameSystem.CLASSIC) !== typeFilter) return false;
            if (tokens.length > 0) {
                const hay = f._searchText || '';
                if (!tokens.every(t => hay.indexOf(t) !== -1)) return false;
            }
            return true;
        });
        return this.sortForces(filtered, sortKey, sortDir);
    });

    protected svgTransform = computed(() => {
        const offset = this.viewOffset();
        return `translate(${offset.x}, ${offset.y}) scale(${this.zoom()})`;
    });

    protected sortedPlacedForces = computed(() =>
        [...this.placedForces()].sort((a, b) => a.zIndex() - b.zIndex())
    );

    protected baseLayerForces = computed(() => {
        const draggedForce = this.draggedForce();
        const draggedGroup = this.draggedGroup();
        if (!draggedForce && !draggedGroup) return this.sortedPlacedForces();

        return this.sortedPlacedForces().filter(force => {
            if (draggedForce && force === draggedForce) return false;
            if (draggedGroup && this.isForceRenderedInDragOverlay(force, draggedGroup.id)) return false;
            return true;
        });
    });

    protected dragOverlayForces = computed(() => {
        const draggedForce = this.draggedForce();
        if (draggedForce) return [draggedForce];

        const draggedGroup = this.draggedGroup();
        if (!draggedGroup) return [];

        return this.sortedPlacedForces().filter(force => this.isForceRenderedInDragOverlay(force, draggedGroup.id));
    });

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
            return da !== db ? da - db : a.zIndex() - b.zIndex();
        });
    });

    protected baseLayerGroups = computed(() => {
        const draggedGroup = this.draggedGroup();
        if (!draggedGroup) return this.sortedGroups();
        return this.sortedGroups().filter(group => !this.isRenderedInDragOverlay(group, draggedGroup.id));
    });

    protected dragOverlayGroups = computed(() => {
        const draggedGroup = this.draggedGroup();
        if (!draggedGroup) return [];
        return this.sortedGroups().filter(group => this.isRenderedInDragOverlay(group, draggedGroup.id));
    });

    /** Org size name for each LoadForceEntry, keyed by instanceId. */
    protected forcesData = computed<Map<string, ForceMetadata>>(() => {
        const all = this.allForces();
        const result = new Map<string, ForceMetadata>();
        for (const force of all) {
            let totalBv = 0;
            let totalPv = 0;
            for (const g of force.groups ?? []) {
                for (const ue of g.units ?? []) {
                    if (ue.unit) {
                        totalBv += ue.unit.bv ?? 0;
                        totalPv += ue.unit.as.PV ?? 0;
                    }
                }
            }
            let bvString = '';
            if (force.bv && force.bv > 0) {
                bvString = `BV: ${force.bv.toLocaleString()}`;
                if (totalBv > 0 && totalBv !== force.bv) bvString += ` (${totalBv.toLocaleString()})`;
            } else if (force.pv && force.pv > 0) {
                bvString = `PV: ${force.pv.toLocaleString()}`;
                if (totalPv > 0 && totalPv !== force.pv) bvString += ` (${totalPv.toLocaleString()})`;
            }
            const org = getOrgFromForce(force, { displayOnlyTopLevel: true });
            result.set(force.instanceId, {
                org,
                bvString,
                totalBv,
                totalPv
            });
        }
        return result;
    });

    /** Descendant forces for each OrgGroup, keyed by group id. */
    private descendantForcesMap = computed<Map<string, LoadForceEntry[]>>(() => {
        const placed = this.placedForces();
        const groups = this.groups();
        const map = new Map<string, LoadForceEntry[]>();
        for (const group of groups) {
            map.set(group.id, this.collectDescendantForces(group.id, placed, groups));
        }
        return map;
    });

    /** Faction IDs for all groups, computed as a signal. */
    private groupFactionIds = computed<Map<string, number | undefined>>(() =>
        this.computeAllGroupFactionIds(this.placedForces(), this.groups(), this.descendantForcesMap()),
    );

    /** Preview descendants map: augments base with extra entries along the chain. */
    private previewDescendantsMap = computed<Map<string, LoadForceEntry[]>>(() => {
        const extra = this.previewExtraForces();
        if (!extra) return this.descendantForcesMap();
        const groups = this.groups();
        const result = new Map(this.descendantForcesMap());
        const visited = new Set<string>();
        let currentId: string | null = extra.targetGroupId;
        while (currentId && !visited.has(currentId)) {
            visited.add(currentId);
            const existing = result.get(currentId) ?? [];
            result.set(currentId, [...existing, ...extra.entries]);
            const group = groups.find(g => g.id === currentId);
            currentId = group?.parentGroupId ?? null;
        }
        return result;
    });

    /** Preview faction IDs: includes extra forces from drag preview. */
    private previewFactionIds = computed<Map<string, number | undefined>>(() => {
        const extra = this.previewExtraForces();
        if (!extra) return this.groupFactionIds();
        return this.computeAllGroupFactionIds(
            this.placedForces(), this.groups(), this.previewDescendantsMap(), extra,
        );
    });

    /** Preview group info for the target group and its ancestor chain. */
    protected previewGroupInfo = computed<Map<string, { orgName: string; totals: string; factionId: number | undefined }>>(() => {
        const extra = this.previewExtraForces();
        if (!extra) return new Map();
        const groups = this.groups();
        const placed = this.placedForces();
        const previewDescendants = this.previewDescendantsMap();
        const previewFactions = this.previewFactionIds();
        const previewChildGroups = new Map<string, PreviewOrgExtras>(extra.childGroupResults ? [[extra.targetGroupId, extra]] : []);
        const result = new Map<string, { orgName: string; totals: string; factionId: number | undefined }>();
        const visited = new Set<string>();
        let currentId: string | null = extra.targetGroupId;
        while (currentId && !visited.has(currentId)) {
            visited.add(currentId);
            const entries = previewDescendants.get(currentId) ?? [];
            const group = groups.find(g => g.id === currentId);
            if (entries.length > 0 && group) {
                const factionId = previewFactions.get(currentId) ?? group.factionId();
                const faction = this.getFactionById(factionId) ?? group.faction();
                const orgResult = this.computeHierarchicalOrgResult(
                    group,
                    entries,
                    groups,
                    placed,
                    previewDescendants,
                    previewFactions,
                    previewChildGroups,
                );
                result.set(currentId, {
                    orgName: orgResult.name,
                    totals: formatTotals(entries),
                    factionId: previewFactions.get(currentId),
                });
            }
            currentId = group?.parentGroupId ?? null;
        }
        return result;
    });

    /** Effect that syncs computed org metadata onto each OrgGroup's signals. */
    private orgGroupDataEffect = effect(() => {
        const placed = this.placedForces();
        const groups = this.groups();
        const descendantsMap = this.descendantForcesMap();
        const factionIds = this.groupFactionIds();

        // First pass: set descendants and factionIds on all groups
        for (const group of groups) {
            group.descendants.set(descendantsMap.get(group.id) ?? []);
            const fid = factionIds.get(group.id);
            group.factionId.set(fid);
            group.faction.set(this.getFactionById(fid));
        }

        // Second pass: compute orgNames after faction objects have been synchronized.
        for (const group of groups) {
            const descendants = group.descendants();
            const faction = group.faction();
            group.orgName.set(descendants.length > 0
                ? this.computeHierarchicalOrgResult(group, descendants, groups, placed).name
                : '');
        }
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

    /** Recursively compute the org size result for a group using pre-computed faction IDs. */
    private computeHierarchicalOrgResult(
        group: OrgGroup,
        allEntries: LoadForceEntry[],
        groups: OrgGroup[],
        placed: PlacedForce[],
        descendantsOverride?: Map<string, LoadForceEntry[]>,
        factionIdsOverride?: Map<string, number | undefined>,
        previewChildGroupsOverride?: Map<string, PreviewOrgExtras>,
    ): OrgSizeResult {
        const childGroups = groups.filter(g => g.parentGroupId === group.id);
        const factionId = factionIdsOverride?.get(group.id) ?? group.factionId();
        const faction = this.getFactionById(factionId) ?? group.faction();

        const childGroupResults: GroupSizeResult[] = [];
        const childEntryIds = new Set<string>();
        for (const child of childGroups) {
            const childEntries = descendantsOverride?.get(child.id)
                ?? this.collectDescendantForces(child.id, placed, groups);
            if (childEntries.length === 0) continue;
            for (const entry of childEntries) {
                childEntryIds.add(entry.instanceId);
            }
            const childOrgResult = this.computeHierarchicalOrgResult(
                child,
                childEntries,
                groups,
                placed,
                descendantsOverride,
                factionIdsOverride,
                previewChildGroupsOverride,
            );
            childGroupResults.push(...childOrgResult.groups);
        }

        const previewChildGroup = previewChildGroupsOverride?.get(group.id);
        if (previewChildGroup?.childGroupResults && previewChildGroup.childGroupResults.length > 0) {
            for (const entry of previewChildGroup.entries) {
                childEntryIds.add(entry.instanceId);
            }
            childGroupResults.push(...previewChildGroup.childGroupResults);
        }

        // Evaluate direct forces with the determined faction
        const directEntries = allEntries.filter(entry => !childEntryIds.has(entry.instanceId));
        for (const entry of directEntries) {
            childGroupResults.push(...this.getForceOrgResults(entry));
        }
        const era = this.deriveCollectionEra(allEntries);
        return this.computeOrgCollectionResult(allEntries, faction, era, childGroupResults);
    }

    private nextZIndex = 0;
    private nextGroupZIndex = 0;

    constructor() {
        this.destroyRef.onDestroy(() => {
            this.cleanupGlobalPointerState();
            this.urlStateService.setExclusiveParams(null);
        });
        effect(() => {
            this.urlStateService.setExclusiveParams({ toe: this.organizationId() });
        });
        if (this.dialogData?.organizationId) {
            this.loadOrganization(this.dialogData.organizationId);
        } else {
            this.loadForces();
        }
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
            if (this.layoutService.isMobile() && this.placedForces().length === 0) {
                this.sidebarOpen.set(true);
            }
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

    protected setSidebarSort(key: string): void {
        this.sidebarSort.set(key);
    }

    protected setSidebarSortDirection(dir: 'asc' | 'desc'): void {
        this.sidebarSortDirection.set(dir);
    }

    private sortForces(items: LoadForceEntry[], sortKey: string, sortDir: 'asc' | 'desc'): LoadForceEntry[] {
        const dir = sortDir === 'asc' ? 1 : -1;
        const forceMetadata = this.forcesData();
        return [...items].sort((a, b) => {
            switch (sortKey) {
                case 'name':
                    return dir * (a.name || '').localeCompare(b.name || '');
                case 'value': {
                    const aVal = (a.type === GameSystem.ALPHA_STRIKE) ? (a.pv ?? 0) : (a.bv ?? 0);
                    const bVal = (b.type === GameSystem.ALPHA_STRIKE) ? (b.pv ?? 0) : (b.bv ?? 0);
                    return dir * (aVal - bVal);
                }
                case 'faction': {
                    const aFaction = a.faction?.name ?? '';
                    const bFaction = b.faction?.name ?? '';
                    return dir * aFaction.localeCompare(bFaction);
                }
                case 'size': {
                    const aSize = a.groups ? a.groups.reduce((sum, g) => sum + (g.units?.length || 0), 0) : 0;
                    const bSize = b.groups ? b.groups.reduce((sum, g) => sum + (g.units?.length || 0), 0) : 0;
                    return dir * (aSize - bSize);
                }
                case 'timestamp':
                default:
                    return dir * ((a.timestamp || '').localeCompare(b.timestamp || ''));
            }
        });
    }

    private computeSearchText(force: LoadForceEntry): string {
        let s = '';
        const orgName = getOrgFromForce(force).name;

        if (force.name) s += force.name + ' ';
        if (force.faction?.name) s += force.faction.name + ' ';
        if (force.era?.name) s += force.era.name + ' ';
        if (orgName) s += orgName + ' ';
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

    private getFactionById(factionId: number | undefined): Faction | undefined {
        return factionId !== undefined ? this.dataService.getFactionById(factionId) : undefined;
    }

    private computeEntriesTechBaseUncached(entries: LoadForceEntry[], factionName: string): TechBase {
        if (factionName.includes('ComStar') || factionName.includes('Word of Blake')) {
            return 'Inner Sphere';
        }

        const units = entries
            .flatMap(entry => entry.groups)
            .flatMap(group => group.units)
            .map(entry => entry.unit)
            .filter((unit): unit is NonNullable<typeof unit> => unit !== undefined);

        return getUnitsAverageTechBase(units);
    }

    private getForceOrgResults(force: LoadForceEntry): GroupSizeResult[] {
        const metadata = this.forcesData().get(force.instanceId);
        return metadata?.org.groups
            ? [...metadata.org.groups]
            : [...getOrgFromForce(force).groups];
    }

    private computeOrgCollectionResult(
        entries: LoadForceEntry[],
        faction: Faction | undefined,
        era: Era | null,
        childGroupResults?: GroupSizeResult[],
    ): OrgSizeResult {
        return getOrgFromForceCollection(entries, faction, era, childGroupResults);
    }

    private deriveCollectionEra(entries: readonly LoadForceEntry[]): Era | null {
        const eras = this.dataService.getEras();
        if (eras.length === 0) {
            return null;
        }

        let referenceYear: number | null = null;
        for (const entry of entries) {
            const entryReferenceYear = entry.era?.years.from ?? this.getLatestEntryUnitYear(entry);
            if (entryReferenceYear === null) {
                continue;
            }
            referenceYear = referenceYear === null ? entryReferenceYear : Math.max(referenceYear, entryReferenceYear);
        }

        if (referenceYear === null) {
            return null;
        }

        return eras.find((era) => {
            const from = era.years.from ?? Number.NEGATIVE_INFINITY;
            const to = era.years.to ?? Number.POSITIVE_INFINITY;
            return from <= referenceYear && referenceYear <= to;
        }) ?? eras[eras.length - 1] ?? null;
    }

    private getLatestEntryUnitYear(entry: LoadForceEntry): number | null {
        let latestYear = Number.NEGATIVE_INFINITY;
        for (const group of entry.groups) {
            for (const unitEntry of group.units) {
                const year = unitEntry.unit?.year;
                if (year !== undefined) {
                    latestYear = Math.max(latestYear, year);
                }
            }
        }

        return Number.isFinite(latestYear) ? latestYear : null;
    }



    /**
     * Compute dominant faction IDs for all groups.
     * Direct forces contribute their own factionId + BV/PV value.
     * Child groups contribute as single entities with their recursively-computed factionId + total value.
     */
    private computeAllGroupFactionIds(
        placed: PlacedForce[],
        groups: OrgGroup[],
        descendantsMap: Map<string, LoadForceEntry[]>,
        extraForces?: { targetGroupId: string; entries: LoadForceEntry[] },
    ): Map<string, number | undefined> {
        const result = new Map<string, number | undefined>();

        // Pre-build lookup maps to avoid repeated full-array scans
        const childGroupsMap = new Map<string, OrgGroup[]>();
        const directForcesMap = new Map<string, PlacedForce[]>();
        for (const group of groups) {
            childGroupsMap.set(group.id, []);
            directForcesMap.set(group.id, []);
        }
        for (const group of groups) {
            if (group.parentGroupId !== null) {
                childGroupsMap.get(group.parentGroupId)?.push(group);
            }
        }
        for (const pf of placed) {
            if (pf.groupId !== null) {
                directForcesMap.get(pf.groupId)?.push(pf);
            }
        }

        const resolve = (groupId: string): number | undefined => {
            if (result.has(groupId)) return result.get(groupId);

            const valueSums = new Map<number, number>();
            const counts = new Map<number, number>();

            // Direct forces in this group
            for (const pf of directForcesMap.get(groupId) ?? []) {
                const fid = getLoadForceFactionId(pf.force);
                if (fid === undefined) continue;
                valueSums.set(fid, (valueSums.get(fid) ?? 0) + getForceValue(pf.force));
                counts.set(fid, (counts.get(fid) ?? 0) + 1);
            }

            // Extra forces (preview: only at the target group)
            if (extraForces && groupId === extraForces.targetGroupId) {
                for (const e of extraForces.entries) {
                    const factionId = getLoadForceFactionId(e);
                    if (factionId === undefined) continue;
                    valueSums.set(factionId, (valueSums.get(factionId) ?? 0) + getForceValue(e));
                    counts.set(factionId, (counts.get(factionId) ?? 0) + 1);
                }
            }

            // Child groups as single entities
            for (const child of childGroupsMap.get(groupId) ?? []) {
                const childFactionId = resolve(child.id);
                if (childFactionId === undefined) continue;
                const childEntries = descendantsMap.get(child.id) ?? [];
                let totalValue = 0;
                for (const e of childEntries) {
                    totalValue += getForceValue(e);
                }
                valueSums.set(childFactionId, (valueSums.get(childFactionId) ?? 0) + totalValue);
                counts.set(childFactionId, (counts.get(childFactionId) ?? 0) + 1);
            }

            let bestValue = -1, bestId: number | undefined;
            for (const [fid, total] of valueSums) {
                if (total > bestValue) { bestValue = total; bestId = fid; }
            }
            if (bestValue > 0 && bestId !== undefined) {
                result.set(groupId, bestId);
                return bestId;
            }
            let maxCount = 0, mostFreqId: number | undefined;
            for (const [fid, count] of counts) {
                if (count > maxCount) { maxCount = count; mostFreqId = fid; }
            }
            const factionId = mostFreqId;
            result.set(groupId, factionId);
            return factionId;
        };

        for (const group of groups) {
            resolve(group.id);
        }
        return result;
    }

    protected async previewForce(force: LoadForceEntry): Promise<void> {
        this.dialogsService.createDialog(ForceEntryPreviewDialogComponent, {
            data: { force }
        });
    }

    // ==================== Sidebar Drag ====================

    private pendingSidebarForce: LoadForceEntry | null = null;
    private sidebarHoldStartPos: { x: number; y: number } | null = null;
    private preventTouchScroll = false;

    protected onSidebarForcePointerDown(event: PointerEvent, force: LoadForceEntry): void {
        if (this.readOnly()) return;
        if (event.pointerType === 'touch') {
            // Touch: hold-to-drag (like force-builder-viewer cdkDragStartDelay)
            this.cancelSidebarHoldTimer();
            this.pendingSidebarForce = force;
            this.sidebarHoldStartPos = { x: event.clientX, y: event.clientY };
            this.sidebarHoldPointerId = event.pointerId;
            document.addEventListener('pointermove', this.onSidebarHoldMove, { passive: false });
            document.addEventListener('pointerup', this.onSidebarHoldEnd);
            document.addEventListener('pointercancel', this.onSidebarHoldEnd);
            this.sidebarHoldTimer = setTimeout(() => {
                this.sidebarHoldTimer = null;
                this.removeSidebarHoldListeners();
                // Block touchmove to prevent browser scroll/pointercancel
                this.preventTouchScroll = true;
                document.addEventListener('touchmove', this.onBlockTouchMove, { passive: false });
                // Hold complete — activate drag
                this.sidebarDragForce.set(this.pendingSidebarForce);
                this.sidebarDragActive.set(true);
                this.sidebarDragPos.set(this.sidebarHoldStartPos!);
                this.pendingSidebarForce = null;
                this.sidebarHoldStartPos = null;
                this.addGlobalPointerListeners();
            }, 200);
            return;
        }
        // Mouse: start immediately
        event.preventDefault();
        event.stopPropagation();
        this.sidebarDragForce.set(force);
        this.sidebarDragActive.set(true);
        this.sidebarDragPos.set({ x: event.clientX, y: event.clientY });
        this.addGlobalPointerListeners();
    }

    private onBlockTouchMove = (event: TouchEvent): void => {
        if (this.preventTouchScroll) event.preventDefault();
    };

    private stopBlockingTouchScroll(): void {
        this.preventTouchScroll = false;
        document.removeEventListener('touchmove', this.onBlockTouchMove);
    }

    private onSidebarHoldMove = (event: PointerEvent): void => {
        if (event.pointerId !== this.sidebarHoldPointerId) return;
        const dx = event.clientX - this.sidebarHoldStartPos!.x;
        const dy = event.clientY - this.sidebarHoldStartPos!.y;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            // Finger moved too much — cancel hold, let browser scroll
            this.cancelSidebarHoldTimer();
        } else {
            // Finger still within threshold — prevent browser from cancelling touch
            event.preventDefault();
        }
    };

    private onSidebarHoldEnd = (event: PointerEvent): void => {
        if (event.pointerId !== this.sidebarHoldPointerId) return;
        this.cancelSidebarHoldTimer();
    };

    private cancelSidebarHoldTimer(): void {
        if (this.sidebarHoldTimer) {
            clearTimeout(this.sidebarHoldTimer);
            this.sidebarHoldTimer = null;
        }
        this.sidebarHoldPointerId = null;
        this.pendingSidebarForce = null;
        this.sidebarHoldStartPos = null;
        this.stopBlockingTouchScroll();
        this.removeSidebarHoldListeners();
    }

    private removeSidebarHoldListeners(): void {
        document.removeEventListener('pointermove', this.onSidebarHoldMove);
        document.removeEventListener('pointerup', this.onSidebarHoldEnd);
        document.removeEventListener('pointercancel', this.onSidebarHoldEnd);
    }

    // ==================== Canvas Force Drag ====================

    protected onForcePointerDown(event: PointerEvent, pf: PlacedForce): void {
        if (this.readOnly()) {
            this.pendingReadonlyPreview = pf.force.missing ? null : {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                force: pf.force,
            };
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.draggedForce.set(pf);
        this.isDragging.set(true);
        this.forceDragged = false;
        this.dragStartPos = { x: event.clientX, y: event.clientY };
        this.forceStartPos = { x: pf.x(), y: pf.y() };
        this.bringForceToFront(pf);
        this.addGlobalPointerListeners();
    }

    private bringForceToFront(pf: PlacedForce): void {
        const forces = this.placedForces();
        const currentZ = pf.zIndex();
        for (const f of forces) {
            if (f.zIndex() > currentZ) f.zIndex.update(v => v - 1);
        }
        pf.zIndex.set(forces.length - 1);
        this.nextZIndex = forces.length;
        this.placedForces.set([...forces]);
        this.dirty.set(true);
    }

    // ==================== Group Drag ====================

    protected onGroupPointerDown(event: PointerEvent, group: OrgGroup): void {
        if (this.readOnly()) return;
        this.startGroupDrag(event, group, false);
    }

    protected onGroupTitlePointerDown(event: PointerEvent, group: OrgGroup): void {
        if (this.readOnly()) return;
        this.startGroupDrag(event, group, true);
    }

    private startGroupDrag(event: PointerEvent, group: OrgGroup, fromTitle: boolean): void {
        if (this.readOnly()) return;
        event.preventDefault();
        event.stopPropagation();
        this.titleDragGroupId = fromTitle ? group.id : null;
        this.draggedGroup.set(group);
        this.groupDragged = false;
        this.groupDragStartPos = { x: event.clientX, y: event.clientY };
        this.groupStartPos = { x: group.x(), y: group.y() };
        this.bringGroupToFront(group);
        this.addGlobalPointerListeners();
    }

    private bringGroupToFront(group: OrgGroup): void {
        const groups = this.groups();
        const currentZ = group.zIndex();
        for (const other of groups) {
            if (other.zIndex() > currentZ) other.zIndex.update(v => v - 1);
        }
        group.zIndex.set(groups.length - 1);
        this.nextGroupZIndex = groups.length;
        this.groups.set([...groups]);
        this.dirty.set(true);
    }

    // ==================== Remove Force ====================

    protected removeForce(pf: PlacedForce): void {
        if (this.readOnly()) return;
        // Remove group membership
        if (pf.groupId) {
            const group = this.groups().find(g => g.id === pf.groupId);
            pf.groupId = null;
            if (group) this.recalcGroupBounds(group);
        }
        this.placedForces.set(this.placedForces().filter(f => f !== pf));
        // Clean up empty groups
        this.cleanupEmptyGroups();
        this.dirty.set(true);
    }

    // ==================== Group Management ====================

    protected async renameGroup(group: OrgGroup): Promise<void> {
        if (this.readOnly()) return;
        if (this.groupDragged) return;
        const newName = await this.dialogsService.prompt(
            'Enter a name for this group:',
            'Rename Group',
            group.name()
        );
        if (newName !== null) {
            group.name.set(newName.trim());
            this.groups.set([...this.groups()]);
            this.dirty.set(true);
        }
    }

    protected removeGroup(group: OrgGroup): void {
        if (this.readOnly()) return;
        if (this.groupDragged) return;
        this.dissolveGroup(group);
        this.dirty.set(true);
    }

    private dissolveGroup(group: OrgGroup): void {
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
        // Resize parent if exists
        if (group.parentGroupId) {
            const parent = this.groups().find(g => g.id === group.parentGroupId);
            if (parent) this.recalcGroupBounds(parent);
        }
    }

    private getDirectChildCount(group: OrgGroup): number {
        const directForceCount = this.placedForces().filter(pf => pf.groupId === group.id).length;
        const directGroupCount = this.groups().filter(child => child.parentGroupId === group.id).length;
        return directForceCount + directGroupCount;
    }

    private dissolveGroupIfUnderpopulated(group: OrgGroup | null | undefined): void {
        if (!group) return;
        if (!this.groups().some(candidate => candidate.id === group.id)) return;
        if (this.getDirectChildCount(group) > 1) return;

        const parent = group.parentGroupId
            ? this.groups().find(candidate => candidate.id === group.parentGroupId)
            : null;
        this.dissolveGroup(group);
        if (parent) this.dissolveGroupIfUnderpopulated(parent);
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
            minX = Math.min(minX, m.x());
            minY = Math.min(minY, m.y());
            maxX = Math.max(maxX, m.x() + CARD_WIDTH);
            maxY = Math.max(maxY, m.y() + CARD_HEIGHT);
        }
        for (const cg of childGroups) {
            minX = Math.min(minX, cg.x());
            minY = Math.min(minY, cg.y());
            maxX = Math.max(maxX, cg.x() + cg.width());
            maxY = Math.max(maxY, cg.y() + cg.height());
        }

        const groupX = minX - GROUP_PADDING;
        const groupY = minY - GROUP_PADDING - GROUP_HEADER_HEIGHT;
        const groupMaxX = maxX + GROUP_PADDING;
        const groupMaxY = maxY + GROUP_PADDING;

        group.x.set(groupX);
        group.y.set(groupY);
        group.width.set(groupMaxX - groupX);
        group.height.set(groupMaxY - groupY);

        // Recurse up so ancestor bounds continue to wrap their children.
        if (group.parentGroupId) {
            const parent = this.groups().find(g => g.id === group.parentGroupId);
            if (parent) this.recalcGroupBounds(parent);
        }
    }

    private rectsOverlap(a: Rect, b: Rect): boolean {
        return !(a.x + a.width < b.x || b.x + b.width < a.x ||
                 a.y + a.height < b.y || b.y + b.height < a.y);
    }

    private getOverlapArea(a: Rect, b: Rect): number {
        const overlapWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (overlapWidth <= 0 || overlapHeight <= 0) return 0;
        return overlapWidth * overlapHeight;
    }

    private expandRect(rect: Rect, padding: number): Rect {
        return {
            x: rect.x - padding,
            y: rect.y - padding,
            width: rect.width + padding * 2,
            height: rect.height + padding * 2,
        };
    }

    private getGroupById(groupId: string | null | undefined): OrgGroup | null {
        if (!groupId) return null;
        return this.groups().find(group => group.id === groupId) ?? null;
    }

    private getParentGroup(group: OrgGroup | null | undefined): OrgGroup | null {
        return this.getGroupById(group?.parentGroupId);
    }

    private getSiblingCollisionRects(
        containerGroupId: string | null,
        excludedForce?: PlacedForce,
        excludedGroup?: OrgGroup,
    ): Rect[] {
        const rects: Rect[] = [];

        for (const force of this.placedForces()) {
            if (force === excludedForce || force.groupId !== containerGroupId) continue;
            rects.push(this.forceRect(force));
        }

        for (const group of this.groups()) {
            if (group === excludedGroup || group.parentGroupId !== containerGroupId) continue;
            rects.push(this.groupRect(group));
        }

        return rects;
    }

    private hasSiblingCollision(
        rect: Rect,
        containerGroupId: string | null,
        excludedForce?: PlacedForce,
        excludedGroup?: OrgGroup,
    ): boolean {
        return this.getSiblingCollisionRects(containerGroupId, excludedForce, excludedGroup)
            .some(obstacle => this.rectsOverlap(rect, this.expandRect(obstacle, COLLISION_EDGE_PADDING)));
    }

    private getResolvedCollisionPosition(
        rect: Rect,
        containerGroupId: string | null,
        excludedForce?: PlacedForce,
        excludedGroup?: OrgGroup,
    ): { x: number; y: number } | null {
        const obstacles = this.getSiblingCollisionRects(containerGroupId, excludedForce, excludedGroup);
        if (obstacles.length === 0) return null;

        const xCandidates = new Set<number>([rect.x]);
        const yCandidates = new Set<number>([rect.y]);

        for (const obstacle of obstacles) {
            if (excludedGroup) {
                xCandidates.add(snapGroupXDownToGrid(obstacle.x - rect.width - COLLISION_EDGE_PADDING));
                xCandidates.add(snapGroupXUpToGrid(obstacle.x + obstacle.width + COLLISION_EDGE_PADDING));
                yCandidates.add(snapGroupYDownToGrid(obstacle.y - rect.height - COLLISION_EDGE_PADDING));
                yCandidates.add(snapGroupYUpToGrid(obstacle.y + obstacle.height + COLLISION_EDGE_PADDING));
            } else {
                xCandidates.add(snapDownToGrid(obstacle.x - rect.width - COLLISION_EDGE_PADDING));
                xCandidates.add(snapUpToGrid(obstacle.x + obstacle.width + COLLISION_EDGE_PADDING));
                yCandidates.add(snapDownToGrid(obstacle.y - rect.height - COLLISION_EDGE_PADDING));
                yCandidates.add(snapUpToGrid(obstacle.y + obstacle.height + COLLISION_EDGE_PADDING));
            }
        }

        const candidates: Array<{ x: number; y: number }> = [];
        for (const x of xCandidates) {
            for (const y of yCandidates) {
                candidates.push({ x, y });
            }
        }

        candidates.sort((a, b) => {
            const aDistance = Math.abs(a.x - rect.x) + Math.abs(a.y - rect.y);
            const bDistance = Math.abs(b.x - rect.x) + Math.abs(b.y - rect.y);
            return aDistance - bDistance;
        });

        for (const candidate of candidates) {
            const candidateRect = { ...rect, x: candidate.x, y: candidate.y };
            const collides = obstacles.some(obstacle => this.rectsOverlap(candidateRect, this.expandRect(obstacle, COLLISION_EDGE_PADDING)));
            if (!collides) {
                return candidate;
            }
        }

        return null;
    }

    private resolveSiblingCollisions(
        getRect: () => Rect,
        moveTo: (x: number, y: number) => void,
        containerGroupId: string | null,
        excludedForce?: PlacedForce,
        excludedGroup?: OrgGroup,
    ): void {
        for (let iteration = 0; iteration < COLLISION_RESOLVE_MAX_ITERATIONS; iteration++) {
            const rect = getRect();
            if (!this.hasSiblingCollision(rect, containerGroupId, excludedForce, excludedGroup)) break;

            const nextPosition = this.getResolvedCollisionPosition(rect, containerGroupId, excludedForce, excludedGroup);
            if (!nextPosition) break;
            if (nextPosition.x === rect.x && nextPosition.y === rect.y) break;

            moveTo(nextPosition.x, nextPosition.y);
        }
    }

    private resolveAncestorGroupCollisionsFrom(group: OrgGroup | null | undefined): void {
        this.resolveAncestorGroupSiblingCollisions(this.getParentGroup(group));
    }

    private resolveForceSiblingCollisions(force: PlacedForce): void {
        this.resolveSiblingCollisions(
            () => this.forceRect(force),
            (x, y) => {
                force.x.set(x);
                force.y.set(y);
            },
            force.groupId,
            force,
        );

        const parent = this.getGroupById(force.groupId);
        if (parent) this.recalcGroupBounds(parent);
    }

    private resolveGroupSiblingCollisions(group: OrgGroup): void {
        this.resolveSiblingCollisions(
            () => this.groupRect(group),
            (x, y) => this.moveGroupTo(group, x, y),
            group.parentGroupId,
            undefined,
            group,
        );

        const parent = this.getParentGroup(group);
        if (parent) this.recalcGroupBounds(parent);
    }

    private resolveAncestorGroupSiblingCollisions(group: OrgGroup | null | undefined): void {
        const visited = new Set<string>();
        let current = group;

        while (current && !visited.has(current.id)) {
            visited.add(current.id);
            this.resolveGroupSiblingCollisions(current);
            current = this.getParentGroup(current) ?? undefined;
        }
    }

    private normalizeLoadedLayout(): void {
        const groupsByDescendingDepth = [...this.groups()].sort((a, b) => {
            const depthDiff = this.getGroupDepth(b) - this.getGroupDepth(a);
            return depthDiff !== 0 ? depthDiff : a.zIndex() - b.zIndex();
        });

        for (const group of groupsByDescendingDepth) {
            this.recalcGroupBounds(group);
        }

        const forcesByDescendingDepth = [...this.placedForces()].sort((a, b) => {
            const depthA = a.groupId ? (this.getGroupDepth(this.getGroupById(a.groupId)!) + 1) : 0;
            const depthB = b.groupId ? (this.getGroupDepth(this.getGroupById(b.groupId)!) + 1) : 0;
            return depthB !== depthA ? depthB - depthA : a.zIndex() - b.zIndex();
        });

        for (const force of forcesByDescendingDepth) {
            this.resolveForceSiblingCollisions(force);
            const parent = this.getGroupById(force.groupId);
            if (parent) {
                this.recalcGroupBounds(parent);
                this.resolveAncestorGroupCollisionsFrom(parent);
            }
        }

        for (const group of groupsByDescendingDepth) {
            this.resolveGroupSiblingCollisions(group);
            this.resolveAncestorGroupCollisionsFrom(group);
        }

        for (const group of groupsByDescendingDepth) {
            this.recalcGroupBounds(group);
        }
    }

    private forceRect(pf: PlacedForce): Rect {
        return { x: pf.x(), y: pf.y(), width: CARD_WIDTH, height: CARD_HEIGHT };
    }

    private groupRect(group: OrgGroup): Rect {
        return { x: group.x(), y: group.y(), width: group.width(), height: group.height() };
    }

    private rectContainsPoint(rect: Rect, point: { x: number; y: number }): boolean {
        return point.x >= rect.x
            && point.x <= rect.x + rect.width
            && point.y >= rect.y
            && point.y <= rect.y + rect.height;
    }

    private getPreferredGroupTarget(
        rect: Rect,
        groups: readonly OrgGroup[],
        excludedGroupId?: string | null,
        focusPoint?: { x: number; y: number },
    ): { group: OrgGroup; overlap: number } | null {
        const candidates: Array<{ group: OrgGroup; overlap: number; containsFocus: boolean }> = [];

        for (const group of groups) {
            if (group.id === excludedGroupId) continue;

            const overlap = this.getOverlapArea(rect, this.groupRect(group));
            if (overlap <= 0) continue;

            candidates.push({
                group,
                overlap,
                containsFocus: focusPoint ? this.rectContainsPoint(this.groupRect(group), focusPoint) : false,
            });
        }

        const relevantCandidates = focusPoint && candidates.some(candidate => candidate.containsFocus)
            ? candidates.filter(candidate => candidate.containsFocus)
            : candidates;

        let best: { group: OrgGroup; overlap: number } | null = null;

        for (const candidate of relevantCandidates) {
            const { group, overlap } = candidate;

            if (!best) {
                best = { group, overlap };
                continue;
            }

            const candidateIsDescendant = this.isDescendantOf(group, best.group.id);
            const bestIsDescendant = this.isDescendantOf(best.group, group.id);
            if (candidateIsDescendant && !bestIsDescendant) {
                best = { group, overlap };
                continue;
            }
            if (bestIsDescendant && !candidateIsDescendant) {
                continue;
            }

            const candidateDepth = this.getGroupDepth(group);
            const bestDepth = this.getGroupDepth(best.group);
            if (candidateDepth !== bestDepth) {
                if (candidateDepth > bestDepth) {
                    best = { group, overlap };
                }
                continue;
            }

            const candidateArea = Math.max(1, group.width() * group.height());
            const bestArea = Math.max(1, best.group.width() * best.group.height());
            const candidateCoverage = overlap / candidateArea;
            const bestCoverage = best.overlap / bestArea;
            if (candidateCoverage !== bestCoverage) {
                if (candidateCoverage > bestCoverage) {
                    best = { group, overlap };
                }
                continue;
            }

            if (overlap > best.overlap || (overlap === best.overlap && group.zIndex() > best.group.zIndex())) {
                best = { group, overlap };
            }
        }

        return best;
    }

    /** Compute the preview rect + header info for a new group encompassing two rects. */
    /** Compute full preview including org metadata (used on first overlap). */
    private computeGroupPreview(a: Rect, b: Rect, entries: LoadForceEntry[], childGroupResults?: GroupSizeResult[]): GroupPreview {
        const factionId = getDominantFactionId(entries);
        const faction = this.getFactionById(factionId);
        const era = this.deriveCollectionEra(entries);
        const aggregateResult = this.computeOrgCollectionResult(
            entries,
            faction,
            era,
            childGroupResults,
        );
        const orgName = aggregateResult.name;
        const totals = formatTotals(entries);
        this.previewOrgCache = { orgName, totals, factionId };
        return { ...this.computeGroupPreviewRect(a, b), orgName, totals, factionId };
    }

    /** Compute only the rect geometry for the preview (used on subsequent frames with same target). */
    private computeGroupPreviewRect(a: Rect, b: Rect): Rect {
        const minX = Math.min(a.x, b.x);
        const minY = Math.min(a.y, b.y);
        const maxX = Math.max(a.x + a.width, b.x + b.width);
        const maxY = Math.max(a.y + a.height, b.y + b.height);
        return {
            x: minX - GROUP_PADDING,
            y: minY - GROUP_PADDING - GROUP_HEADER_HEIGHT,
            width: (maxX - minX) + GROUP_PADDING + GROUP_PADDING,
            height: (maxY - minY) + GROUP_PADDING + GROUP_PADDING + GROUP_HEADER_HEIGHT,
        };
    }

    /** Detect what would happen if the dragged force were dropped now. */
    private detectForceDrop(pf: PlacedForce, focusPoint?: { x: number; y: number }): ForceDropAction | null {
        const pfRect = this.forceRect(pf);
        const bestGroupTarget = this.getPreferredGroupTarget(pfRect, this.groups(), undefined, focusPoint);
        let bestOverlap = bestGroupTarget?.overlap ?? 0;
        let bestAction: ForceDropAction | null;

        if (bestGroupTarget) {
            bestAction = bestGroupTarget.group.id === pf.groupId
                ? null
                : { type: 'join-group', groupId: bestGroupTarget.group.id };
        } else {
            bestAction = pf.groupId ? { type: 'leave-group' } : null;
        }

        // Check overlap with other ungrouped forces
        for (const other of this.placedForces()) {
            if (other === pf || other.groupId) continue;
            const overlap = this.getOverlapArea(pfRect, this.forceRect(other));
            if (overlap > bestOverlap) {
                bestOverlap = overlap;
                bestAction = { type: 'new-group', other };
            }
        }

        return bestAction;
    }

    /** Detect what would happen if the dragged group were dropped now. */
    private detectGroupDrop(grp: OrgGroup, focusPoint?: { x: number; y: number }): GroupDropAction | null {
        const grpRect = this.groupRect(grp);
        let bestOverlap = 0;

        // A child group remains in its parent while it has the largest overlap.
        if (grp.parentGroupId) {
            const parent = this.groups().find(g => g.id === grp.parentGroupId);
            if (parent) {
                bestOverlap = this.getOverlapArea(grpRect, this.groupRect(parent));
            }
        }

        const targetCandidates = this.groups().filter((other) => {
            if (other.id === grp.id) return false;
            if (this.isDescendantOf(grp, other.id)) return false;
            if (this.isDescendantOf(other, grp.id)) return false;
            if (other.id === grp.parentGroupId) return false;
            return true;
        });
        const target = this.getPreferredGroupTarget(grpRect, targetCandidates, grp.id, focusPoint);
        if (!target || target.overlap <= bestOverlap) {
            return null;
        }

        const draggedArea = Math.max(1, grpRect.width * grpRect.height);
        const overlapCoverage = target.overlap / draggedArea;
        if (overlapCoverage >= GROUP_EMBED_OVERLAP_THRESHOLD) {
            return { type: 'join-parent', groupId: target.group.id };
        }

        return { type: 'create-parent', other: target.group };
    }

    private clearDropPreview(): void {
        if (this.dropTargetGroupId() !== null) this.dropTargetGroupId.set(null);
        if (this.dropPreviewRect() !== null) this.dropPreviewRect.set(null);
        if (this.previewExtraForces() !== null) this.previewExtraForces.set(null);
        this.previewOtherId = null;
        this.previewOrgCache = null;
    }

    private setExistingGroupDropPreview(groupId: string): void {
        if (this.dropTargetGroupId() === groupId && this.dropPreviewRect() === null && this.previewExtraForces() === null) {
            return;
        }
        this.dropTargetGroupId.set(groupId);
        this.dropPreviewRect.set(null);
        this.previewExtraForces.set(null);
        this.previewOtherId = null;
        this.previewOrgCache = null;
    }

    /** Update preview state for a sidebar drag at the given world-space rect. */
    private updateSidebarDragPreview(rect: Rect, sidebarForce: LoadForceEntry, focusPoint: { x: number; y: number }): void {
        const bestGroupTarget = this.getPreferredGroupTarget(rect, this.groups(), undefined, focusPoint);
        const bestGroup = bestGroupTarget?.group ?? null;
        const bestGroupOverlap = bestGroupTarget?.overlap ?? 0;

        let bestForce: PlacedForce | null = null;
        let bestForceOverlap = 0;
        for (const pf of this.placedForces()) {
            if (pf.groupId) continue;
            const overlap = this.getOverlapArea(rect, this.forceRect(pf));
            if (overlap > bestForceOverlap) {
                bestForceOverlap = overlap;
                bestForce = pf;
            }
        }

        if (bestGroup && bestGroupOverlap >= bestForceOverlap) {
            if (this.dropTargetGroupId() === bestGroup.id) return;
            this.dropTargetGroupId.set(bestGroup.id);
            this.dropPreviewRect.set(null);
            this.previewExtraForces.set({ targetGroupId: bestGroup.id, entries: [sidebarForce] });
            return;
        }

        if (bestForce) {
            if (this.dropTargetGroupId() !== null) this.dropTargetGroupId.set(null);
            if (this.previewExtraForces() !== null) this.previewExtraForces.set(null);
            if (this.previewOtherId === bestForce.force.instanceId && this.previewOrgCache) {
                this.dropPreviewRect.set({ ...this.computeGroupPreviewRect(rect, this.forceRect(bestForce)), ...this.previewOrgCache });
            } else {
                this.previewOtherId = bestForce.force.instanceId;
                this.dropPreviewRect.set(this.computeGroupPreview(rect, this.forceRect(bestForce), [sidebarForce, bestForce.force]));
            }
            return;
        }

        this.clearDropPreview();
    }

    /** Update preview for a force or group drag action. */
    private updateDropPreview(action: ForceDropAction | GroupDropAction | null, draggedRect: Rect, otherRect?: Rect, entries?: LoadForceEntry[], childGroupResults?: GroupSizeResult[]): void {
        if (!action) {
            this.clearDropPreview();
            return;
        }
        switch (action.type) {
            case 'join-group':
            case 'join-parent':
                // Skip if already previewing the same group
                if (this.dropTargetGroupId() === action.groupId) break;
                this.previewOtherId = null;
                this.previewOrgCache = null;
                this.dropTargetGroupId.set(action.groupId);
                this.dropPreviewRect.set(null);
                this.previewExtraForces.set({
                    targetGroupId: action.groupId,
                    entries: entries ?? [],
                    childGroupResults,
                });
                break;
            case 'rearrange':
                this.previewOtherId = null;
                this.previewOrgCache = null;
                this.dropTargetGroupId.set(action.parentId);
                this.dropPreviewRect.set(null);
                this.previewExtraForces.set(null);
                break;
            case 'new-group':
            case 'create-parent': {
                const otherId = action.type === 'new-group'
                    ? (action as { type: 'new-group'; other: PlacedForce }).other.force.instanceId
                    : (action as { type: 'create-parent'; other: OrgGroup }).other.id;
                if (this.dropTargetGroupId() !== null) this.dropTargetGroupId.set(null);
                if (this.previewExtraForces() !== null) this.previewExtraForces.set(null);
                if (this.previewOtherId === otherId && this.previewOrgCache) {
                    // Same target — only update geometry
                    this.dropPreviewRect.set({ ...this.computeGroupPreviewRect(draggedRect, otherRect!), ...this.previewOrgCache });
                } else {
                    this.previewOtherId = otherId;
                    this.dropPreviewRect.set(this.computeGroupPreview(draggedRect, otherRect!, entries ?? [], childGroupResults));
                }
                break;
            }
            default:
                this.clearDropPreview();
        }
    }

    /** Execute the force drop action detected by detectForceDrop. */
    private tryFormGroup(draggedPf: PlacedForce, focusPoint?: { x: number; y: number }): void {
        const action = this.detectForceDrop(draggedPf, focusPoint);
        const placed = this.placedForces();

        switch (action?.type) {
            case 'join-group': {
                const oldGroup = this.getGroupById(draggedPf.groupId);
                draggedPf.groupId = action.groupId;
                const group = this.getGroupById(action.groupId)!;
                this.resolveForceSiblingCollisions(draggedPf);
                this.resolveAncestorGroupCollisionsFrom(group);
                this.recalcGroupBounds(group);
                if (oldGroup) {
                    this.recalcGroupBounds(oldGroup);
                    this.dissolveGroupIfUnderpopulated(oldGroup);
                    this.cleanupEmptyGroups();
                }
                this.placedForces.set([...placed]);
                return;
            }
            case 'new-group': {
                const oldGroup = this.getGroupById(draggedPf.groupId);
                const group = new OrgGroup({
                    zIndex: this.nextGroupZIndex++,
                });
                draggedPf.groupId = group.id;
                action.other.groupId = group.id;
                this.groups.set([...this.groups(), group]);
                this.resolveForceSiblingCollisions(draggedPf);
                this.recalcGroupBounds(group);
                this.resolveGroupSiblingCollisions(group);
                this.resolveAncestorGroupCollisionsFrom(group);
                if (oldGroup) {
                    this.recalcGroupBounds(oldGroup);
                    this.dissolveGroupIfUnderpopulated(oldGroup);
                    this.cleanupEmptyGroups();
                }
                this.placedForces.set([...placed]);
                return;
            }
            case 'leave-group': {
                const group = this.getGroupById(draggedPf.groupId)!;
                draggedPf.groupId = null;
                this.resolveForceSiblingCollisions(draggedPf);
                this.recalcGroupBounds(group);
                this.resolveAncestorGroupCollisionsFrom(group);
                this.dissolveGroupIfUnderpopulated(group);
                this.cleanupEmptyGroups();
                this.placedForces.set([...placed]);
                return;
            }
            default: {
                this.resolveForceSiblingCollisions(draggedPf);
                if (draggedPf.groupId) {
                    const group = this.getGroupById(draggedPf.groupId);
                    if (group) {
                        this.recalcGroupBounds(group);
                        this.resolveAncestorGroupCollisionsFrom(group);
                    }
                }
            }
        }
    }

    /** Move a group and all its descendants by the delta from old to new position. */
    private moveGroupTo(group: OrgGroup, newX: number, newY: number): void {
        const dx = snapGroupXToGrid(newX) - group.x();
        const dy = snapGroupYToGrid(newY) - group.y();
        if (dx === 0 && dy === 0) return;
        this.translateGroupRecursive(group, dx, dy);
    }

    /** Recursively translate a group and all descendants. */
    private translateGroupRecursive(group: OrgGroup, dx: number, dy: number): void {
        group.x.update(v => v + dx);
        group.y.update(v => v + dy);
        for (const pf of this.placedForces()) {
            if (pf.groupId === group.id) {
                pf.x.update(v => v + dx);
                pf.y.update(v => v + dy);
            }
        }
        for (const child of this.groups()) {
            if (child.parentGroupId === group.id) {
                this.translateGroupRecursive(child, dx, dy);
            }
        }
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

    private getGroupDepth(group: OrgGroup): number {
        let depth = 0;
        const visited = new Set<string>();
        let current: OrgGroup | undefined = group;

        while (current?.parentGroupId) {
            if (visited.has(current.id)) break;
            visited.add(current.id);
            current = this.groups().find(candidate => candidate.id === current!.parentGroupId);
            if (current) depth++;
        }

        return depth;
    }

    private isRenderedInDragOverlay(group: OrgGroup, draggedGroupId: string): boolean {
        return group.id === draggedGroupId || this.isDescendantOf(group, draggedGroupId);
    }

    private isForceRenderedInDragOverlay(force: PlacedForce, draggedGroupId: string): boolean {
        if (force.groupId === null) return false;
        return force.groupId === draggedGroupId || this.isGroupDescendantOfId(force.groupId, draggedGroupId);
    }

    private isGroupDescendantOfId(groupId: string, ancestorId: string): boolean {
        const group = this.groups().find(candidate => candidate.id === groupId);
        return group ? this.isDescendantOf(group, ancestorId) : false;
    }

    /** Execute the group drop action detected by detectGroupDrop. */
    private tryMergeGroups(draggedGrp: OrgGroup, focusPoint?: { x: number; y: number }): void {
        const action = this.detectGroupDrop(draggedGrp, focusPoint);

        switch (action?.type) {
            case 'join-parent': {
                const oldParent = this.getParentGroup(draggedGrp);
                draggedGrp.parentGroupId = action.groupId;
                this.groups.set([...this.groups()]);
                if (oldParent) {
                    this.recalcGroupBounds(oldParent);
                    this.cleanupEmptyGroups();
                }
                const target = this.getGroupById(action.groupId)!;
                this.recalcGroupBounds(target);
                this.resolveGroupSiblingCollisions(draggedGrp);
                this.resolveAncestorGroupCollisionsFrom(target);
                return;
            }
            case 'rearrange': {
                const parent = this.getGroupById(action.parentId);
                if (parent) this.recalcGroupBounds(parent);
                this.resolveGroupSiblingCollisions(draggedGrp);
                this.resolveAncestorGroupCollisionsFrom(parent);
                return;
            }
            case 'create-parent': {
                const oldParent = this.getParentGroup(draggedGrp);
                const targetParent = this.getParentGroup(action.other);
                const parentGroup = new OrgGroup({
                    zIndex: this.nextGroupZIndex++,
                    parentGroupId: action.other.parentGroupId,
                });
                draggedGrp.parentGroupId = parentGroup.id;
                action.other.parentGroupId = parentGroup.id;
                this.groups.set([...this.groups(), parentGroup]);
                if (oldParent) {
                    this.recalcGroupBounds(oldParent);
                    this.dissolveGroupIfUnderpopulated(oldParent);
                    this.cleanupEmptyGroups();
                }
                if (targetParent && targetParent.id !== oldParent?.id) {
                    this.recalcGroupBounds(targetParent);
                }
                this.resolveGroupSiblingCollisions(draggedGrp);
                this.recalcGroupBounds(parentGroup);
                this.resolveGroupSiblingCollisions(parentGroup);
                this.resolveAncestorGroupCollisionsFrom(parentGroup);
                return;
            }
            default:
                this.resolveGroupSiblingCollisions(draggedGrp);
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

    // ==================== Global Pointer Handlers ====================

    private addGlobalPointerListeners(): void {
        if (this.hasGlobalPointerListeners) return;
        document.addEventListener('pointermove', this.onGlobalPointerMove, { passive: false });
        document.addEventListener('pointerup', this.onGlobalPointerUp);
        document.addEventListener('pointercancel', this.onGlobalPointerCancel);
        this.hasGlobalPointerListeners = true;
    }

    private cleanupGlobalPointerState(): void {
        if (this.moveRafId !== null) {
            cancelAnimationFrame(this.moveRafId);
            this.moveRafId = null;
        }
        this.cancelSidebarHoldTimer();
        this.pendingMoveEvent = null;
        this.pendingReadonlyPreview = null;
        this.activeTouches.clear();
        this.lastPanPoint = null;
        this.draggedForce.set(null);
        this.draggedGroup.set(null);
        this.sidebarDragForce.set(null);
        this.sidebarDragActive.set(false);
        this.isDragging.set(false);
        this.groupDragged = false;
        this.titleDragGroupId = null;
        this.clearDropPreview();

        if (this.hasGlobalPointerListeners) {
            document.removeEventListener('pointermove', this.onGlobalPointerMove);
            document.removeEventListener('pointerup', this.onGlobalPointerUp);
            document.removeEventListener('pointercancel', this.onGlobalPointerCancel);
            this.hasGlobalPointerListeners = false;
        }
    }

    private setPointerCaptureIfAvailable(event: PointerEvent): void {
        try {
            (event.currentTarget as Element)?.setPointerCapture(event.pointerId);
        } catch { /* best-effort */ }
    }

    private onGlobalPointerCancel = (event: PointerEvent): void => {
        if (this.pendingReadonlyPreview?.pointerId === event.pointerId) {
            this.pendingReadonlyPreview = null;
        }
        this.activeTouches.delete(event.pointerId);
        // Treat cancel same as pointer up to clean state
        this.onGlobalPointerUp(event);
    };

    private onGlobalPointerMove = (event: PointerEvent): void => {
        // Prevent browser from stealing touch during active drag
        if (event.pointerType === 'touch' && (this.sidebarDragActive() || this.draggedForce() || this.draggedGroup())) {
            event.preventDefault();
        }

        this.activeTouches.set(event.pointerId, event);

        // Cancel drags on multi-touch
        if (this.activeTouches.size >= 2 && (this.draggedForce() || this.draggedGroup() || this.sidebarDragActive())) {
            this.draggedForce.set(null);
            this.draggedGroup.set(null);
            this.sidebarDragForce.set(null);
            this.sidebarDragActive.set(false);
            this.isDragging.set(false);
            this.stopBlockingTouchScroll();
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
        const pendingReadonlyPreview = this.pendingReadonlyPreview;
        if (pendingReadonlyPreview && event.pointerId === pendingReadonlyPreview.pointerId) {
            const moveDistance = Math.hypot(
                event.clientX - pendingReadonlyPreview.startX,
                event.clientY - pendingReadonlyPreview.startY,
            );
            if (this.activeTouches.size > 1 || moveDistance > READONLY_PREVIEW_MOVE_THRESHOLD) {
                this.pendingReadonlyPreview = null;
            }
        }

        // Sidebar drag
        if (this.sidebarDragActive()) {
            const sidebarForce = this.sidebarDragForce();
            if (!sidebarForce) return;
            this.sidebarDragPos.set({ x: event.clientX, y: event.clientY });
            // Only show drop preview when cursor is over the canvas, not the sidebar
            const elementUnderCursor = document.elementFromPoint(event.clientX, event.clientY);
            const isOverSidebar = elementUnderCursor?.closest('.forces-sidebar') != null;
            if (isOverSidebar) {
                this.clearDropPreview();
            } else {
                const worldPos = this.screenToWorld(event.clientX, event.clientY);
                const sidebarRect: Rect = {
                    x: snapToGrid(worldPos.x - CARD_WIDTH / 2),
                    y: snapToGrid(worldPos.y - CARD_HEIGHT / 2),
                    width: CARD_WIDTH,
                    height: CARD_HEIGHT,
                };
                this.updateSidebarDragPreview(sidebarRect, sidebarForce, worldPos);
            }
            return;
        }

        // Canvas force drag
        const dragged = this.draggedForce();
        if (dragged) {
            const worldPos = this.screenToWorld(event.clientX, event.clientY);
            const { dx, dy } = this.getScaledDelta(event, this.dragStartPos);
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.forceDragged = true;
            dragged.x.set(snapToGrid(this.forceStartPos.x + dx));
            dragged.y.set(snapToGrid(this.forceStartPos.y + dy));
            // Update drop preview
            const forceAction = this.detectForceDrop(dragged, worldPos);
            if (!forceAction && dragged.groupId) {
                const ownGroup = this.groups().find(group => group.id === dragged.groupId);
                if (ownGroup && this.getOverlapArea(this.forceRect(dragged), this.groupRect(ownGroup)) > 0) {
                    this.setExistingGroupDropPreview(ownGroup.id);
                    return;
                }
            }
            const otherRect = forceAction?.type === 'new-group' ? this.forceRect(forceAction.other) : undefined;
            // Skip building entries if still overlapping the same target
            const forceOtherId = forceAction?.type === 'new-group' ? forceAction.other.force.instanceId
                : forceAction?.type === 'join-group' ? forceAction.groupId
                : null;
            let entries: LoadForceEntry[] | undefined;
            if (forceOtherId !== this.previewOtherId || !this.previewOrgCache) {
                entries = forceAction?.type === 'new-group'
                    ? [dragged.force, forceAction.other.force]
                    : forceAction?.type === 'join-group'
                        ? [dragged.force]
                        : undefined;
            }
            this.updateDropPreview(forceAction, this.forceRect(dragged), otherRect, entries);
            return;
        }

        // Group drag
        const draggedGrp = this.draggedGroup();
        if (draggedGrp) {
            const worldPos = this.screenToWorld(event.clientX, event.clientY);
            const { dx, dy } = this.getScaledDelta(event, this.groupDragStartPos);
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.groupDragged = true;
            const newX = snapGroupXToGrid(this.groupStartPos.x + dx);
            const newY = snapGroupYToGrid(this.groupStartPos.y + dy);
            const moveDx = newX - draggedGrp.x();
            const moveDy = newY - draggedGrp.y();

            // Move group and all descendants
            this.translateGroupRecursive(draggedGrp, moveDx, moveDy);

            // Update drop preview
            const grpAction = this.detectGroupDrop(draggedGrp, worldPos);
            if (!grpAction && draggedGrp.parentGroupId) {
                const parent = this.groups().find(group => group.id === draggedGrp.parentGroupId);
                if (parent && this.getOverlapArea(this.groupRect(draggedGrp), this.groupRect(parent)) > 0) {
                    this.setExistingGroupDropPreview(parent.id);
                    return;
                }
            }
            const grpOtherRect = grpAction?.type === 'create-parent' ? this.groupRect(grpAction.other) : undefined;
            // Skip expensive org computation if still overlapping the same target
            const grpOtherId = grpAction?.type === 'create-parent' ? grpAction.other.id
                : grpAction?.type === 'join-parent' ? grpAction.groupId
                : null;
            let grpEntries: LoadForceEntry[] | undefined;
            let grpChildGroupResults: GroupSizeResult[] | undefined;
            const needsOrgRecompute = grpOtherId !== this.previewOtherId || !this.previewOrgCache;
            if (needsOrgRecompute) {
                const currentPlaced = this.placedForces();
                const currentGroups = this.groups();
                grpEntries = grpAction?.type === 'create-parent'
                    ? [...this.collectDescendantForces(draggedGrp.id, currentPlaced, currentGroups), ...this.collectDescendantForces(grpAction.other.id, currentPlaced, currentGroups)]
                    : (grpAction?.type === 'join-parent'
                        ? this.collectDescendantForces(draggedGrp.id, currentPlaced, currentGroups)
                        : undefined);
                if (grpAction?.type === 'create-parent') {
                    const draggedEntries = this.collectDescendantForces(draggedGrp.id, currentPlaced, currentGroups);
                    const otherEntries = this.collectDescendantForces(grpAction.other.id, currentPlaced, currentGroups);
                    grpChildGroupResults = [];
                    if (draggedEntries.length > 0) {
                        grpChildGroupResults.push(
                            ...this.computeHierarchicalOrgResult(draggedGrp, draggedEntries, currentGroups, currentPlaced).groups,
                        );
                    }
                    if (otherEntries.length > 0) {
                        grpChildGroupResults.push(
                            ...this.computeHierarchicalOrgResult(grpAction.other, otherEntries, currentGroups, currentPlaced).groups,
                        );
                    }
                } else if (grpAction?.type === 'join-parent' && grpEntries && grpEntries.length > 0) {
                    grpChildGroupResults = [...this.computeHierarchicalOrgResult(
                        draggedGrp,
                        grpEntries,
                        currentGroups,
                        currentPlaced,
                    ).groups];
                }
            }
            this.updateDropPreview(grpAction, this.groupRect(draggedGrp), grpOtherRect, grpEntries, grpChildGroupResults);
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
        const readonlyPreview = this.pendingReadonlyPreview?.pointerId === event.pointerId
            ? this.pendingReadonlyPreview
            : null;
        if (readonlyPreview) {
            this.pendingReadonlyPreview = null;
        }

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
                                x: signal(snapToGrid(worldPos.x - CARD_WIDTH / 2)),
                                y: signal(snapToGrid(worldPos.y - CARD_HEIGHT / 2)),
                                zIndex: signal(this.nextZIndex++),
                                groupId: null
                            };
                            this.placedForces.set([...this.placedForces(), newPlaced]);
                            // Try grouping with nearby forces
                            this.tryFormGroup(newPlaced, worldPos);
                            this.dirty.set(true);
                        }
                    }
                }
            }
            this.sidebarDragForce.set(null);
            this.sidebarDragActive.set(false);
            this.stopBlockingTouchScroll();
        }

        // Handle canvas force drag end
        const dragged = this.draggedForce();
        if (dragged) {
            if (this.forceDragged) {
                this.tryFormGroup(dragged, this.screenToWorld(event.clientX, event.clientY));
                this.dirty.set(true);
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
                    const overlapsParent = parent && this.rectsOverlap(this.groupRect(dragEndGroup), this.groupRect(parent));
                    if (parent && !overlapsParent) {
                        dragEndGroup.parentGroupId = null;
                        this.groups.set([...this.groups()]);
                        // Re-layout old parent (and clean up if empty)
                        this.recalcGroupBounds(parent);
                        this.dissolveGroupIfUnderpopulated(parent);
                        this.cleanupEmptyGroups();
                    } else {
                        this.tryMergeGroups(dragEndGroup, this.screenToWorld(event.clientX, event.clientY));
                    }
                } else {
                    this.tryMergeGroups(dragEndGroup, this.screenToWorld(event.clientX, event.clientY));
                }
                // Re-layout parent if it still has one
                if (dragEndGroup.parentGroupId) {
                    const parent = this.groups().find(g => g.id === dragEndGroup.parentGroupId);
                    if (parent) this.recalcGroupBounds(parent);
                }
                this.dirty.set(true);
            } else if (this.titleDragGroupId === dragEndGroup.id) {
                void this.renameGroup(dragEndGroup);
            }
            this.draggedGroup.set(null);
        }

        if (this.activeTouches.size === 0) this.cleanupGlobalPointerState();

        if (readonlyPreview) {
            void this.previewForce(readonlyPreview.force);
        }
    };

    // ==================== Dialog Actions ====================

    protected async renameOrganization(): Promise<void> {
        if (this.readOnly()) return;
        const newName = await this.dialogsService.prompt(
            'Enter a name for this organization:',
            'Rename Organization',
            this.organizationName()
        );
        if (newName !== null) {
            this.organizationName.set(newName.trim() || 'Unnamed Organization');
            this.dirty.set(true);
        }
    }

    protected async saveOrganization(): Promise<void> {
        if (this.readOnly() || this.saving()) return;
        this.saving.set(true);
        try {
            const orgId = this.organizationId() ?? crypto.randomUUID();
            this.organizationId.set(orgId);

            const serialized: SerializedOrganization = {
                organizationId: orgId,
                name: this.organizationName(),
                timestamp: Date.now(),
                factionId: this.organizationFactionId(),
                forces: this.placedForces().map(pf => ({
                    instanceId: pf.force.instanceId,
                    x: pf.x(),
                    y: pf.y(),
                    zIndex: pf.zIndex(),
                    groupId: pf.groupId,
                } as OrgPlacedForce)),
                groups: this.groups().map(g => ({
                    id: g.id,
                    name: g.name(),
                    x: g.x(),
                    y: g.y(),
                    width: g.width(),
                    height: g.height(),
                    zIndex: g.zIndex(),
                    parentGroupId: g.parentGroupId,
                } as OrgGroupData)),
            };

            await this.dataService.saveOrganization(serialized);
            this.dirty.set(false);
        } finally {
            this.saving.set(false);
        }
    }

    private async loadOrganization(organizationId: string): Promise<void> {
        this.loading.set(true);
        try {
            const org = await this.dataService.getOrganization(organizationId);
            if (!org) {
                this.organizationId.set(null);
                this.organizationOwned.set(true);
                await this.dialogsService.showError('Organization not found.', 'Load Error');
                await this.loadForces();
                return;
            }

            this.applyLoadedOrganizationMetadata(org);

            const orgForceIds = Array.from(new Set(org.forces.map((pf) => pf.instanceId).filter(Boolean)));

            let availableForces: LoadForceEntry[];
            if (org.owned === false) {
                availableForces = await this.dataService.getForceEntriesByIds(orgForceIds);
            } else {
                const result = await this.dataService.listForces();
                const existingIds = new Set((result || []).map((force) => force.instanceId));
                const missingIds = orgForceIds.filter((instanceId) => !existingIds.has(instanceId));
                const missingForces = missingIds.length > 0
                    ? await this.dataService.getForceEntriesByIds(missingIds)
                    : [];
                availableForces = [...(result || []), ...missingForces];
            }

            for (const force of availableForces) {
                force._searchText = this.computeSearchText(force);
            }
            this.allForces.set(availableForces);

            // Build a lookup map
            const forceMap = new Map<string, LoadForceEntry>();
            for (const f of availableForces) {
                forceMap.set(f.instanceId, f);
            }

            // Restore placed forces. Missing references stay as placeholders so saves preserve them.
            const placed: PlacedForce[] = [];
            for (const pf of org.forces) {
                const force = forceMap.get(pf.instanceId) ?? createMissingForceEntry(pf.instanceId);
                placed.push({
                    force,
                    x: signal(snapToGrid(pf.x)),
                    y: signal(snapToGrid(pf.y)),
                    zIndex: signal(pf.zIndex),
                    groupId: pf.groupId,
                });
            }
            this.placedForces.set(placed);

            // Restore groups
            const groups: OrgGroup[] = org.groups.map(g => new OrgGroup({
                id: g.id,
                name: g.name,
                x: snapGroupXToGrid(g.x),
                y: snapGroupYToGrid(g.y),
                width: Math.max(GRID_SNAP_SIZE, snapUpToGrid(g.width)),
                height: Math.max(GRID_SNAP_SIZE, snapUpToGrid(g.height)),
                zIndex: g.zIndex,
                parentGroupId: g.parentGroupId,
            }));
            this.groups.set(groups);
            this.normalizeLoadedLayout();

            // Restore state
            this.organizationId.set(org.organizationId);
            this.organizationName.set(org.name);
            this.dirty.set(false);

            // Update zIndex counters
            this.nextZIndex = placed.reduce((max, pf) => Math.max(max, pf.zIndex() + 1), 0);
            this.nextGroupZIndex = groups.reduce((max, g) => Math.max(max, g.zIndex() + 1), 0);

            // Auto-fit viewport to show all content centered
            requestAnimationFrame(() => this.autoFitView());
        } catch {
            this.organizationId.set(null);
            this.organizationOwned.set(true);
            await this.dialogsService.showError('Failed to load organization.', 'Load Error');
            await this.loadForces();
        } finally {
            this.loading.set(false);
        }
    }

    private applyLoadedOrganizationMetadata(org: LoadedOrganization): void {
        this.organizationOwned.set(org.owned ?? true);
    }

    protected close(): void {
        this.dialogRef.close();
    }

    /**
     * Auto-fit the viewport so all placed forces and groups are centered
     * in the SVG canvas. Zoom is capped at 1.0 (no zoom-in past 100%).
     */
    private autoFitView(): void {
        const svg = this.svgCanvas()?.nativeElement;
        if (!svg) return;

        const forces = this.placedForces();
        const groups = this.groups();
        if (forces.length === 0 && groups.length === 0) {
            this.viewOffset.set({ x: 0, y: 0 });
            this.zoom.set(1);
            return;
        }

        // Calculate bounding box of all content
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const pf of forces) {
            minX = Math.min(minX, pf.x());
            minY = Math.min(minY, pf.y());
            maxX = Math.max(maxX, pf.x() + CARD_WIDTH);
            maxY = Math.max(maxY, pf.y() + CARD_HEIGHT);
        }
        for (const g of groups) {
            minX = Math.min(minX, g.x());
            minY = Math.min(minY, g.y());
            maxX = Math.max(maxX, g.x() + g.width());
            maxY = Math.max(maxY, g.y() + g.height());
        }

        const contentWidth = maxX - minX;
        const contentHeight = maxY - minY;
        if (contentWidth <= 0 || contentHeight <= 0) return;

        const svgRect = svg.getBoundingClientRect();
        const padding = 40;
        const availableWidth = svgRect.width - padding * 2;
        const availableHeight = svgRect.height - padding * 2;
        if (availableWidth <= 0 || availableHeight <= 0) return;

        // Scale to fit, but never zoom in above 1.0
        const scaleX = availableWidth / contentWidth;
        const scaleY = availableHeight / contentHeight;
        const fitZoom = Math.min(scaleX, scaleY, 1.0);
        const clampedZoom = Math.max(MIN_ZOOM, fitZoom);

        // Center content in the viewport
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const offsetX = svgRect.width / 2 - centerX * clampedZoom;
        const offsetY = svgRect.height / 2 - centerY * clampedZoom;

        this.zoom.set(clampedZoom);
        this.viewOffset.set({ x: offsetX, y: offsetY });
    }

    // ==================== Utility ====================

    private getScaledDelta(event: PointerEvent, startPos: { x: number; y: number }): { dx: number; dy: number } {
        const scale = this.zoom();
        return {
            dx: (event.clientX - startPos.x) / scale,
            dy: (event.clientY - startPos.y) / scale,
        };
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
}
