// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    effect,
    type ElementRef,
    inject,
    signal,
    untracked,
    viewChild,
    type WritableSignal,
} from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import type { LoadForceEntry } from '../../models/load-force-entry.model';
import { createForcePreviewEntryData } from '../../models/force-preview.model';
import { DataService } from '../../services/data.service';
import { ForcePersistenceService } from '../../services/force-persistence.service';
import { OrganizationStorageService } from '../../services/organization-storage.service';
import { DialogsService } from '../../services/dialogs.service';
import { ForceWorkspaceStateService } from '../../services/force-workspace-state.service';
import { LayoutService } from '../../services/layout.service';
import { UrlService } from '../../services/url.service';
import { FactionImgPipe } from '../../pipes/faction-img.pipe';
import type { GroupSizeResult, OrgSizeResult } from '../../utils/org/org-types';
import { GameSystem } from '../../models/common.model';
import type { LoadedOrganization, SerializedOrganization, OrgPlacedForce, OrgGroupData } from '../../models/organization.model';
import { ForceEntryPreviewDialogComponent } from '../force-entry-preview-dialog/force-entry-preview-dialog.component';
import { ShareForceOrgDialogComponent } from '../share-force-org-dialog/share-force-org-dialog.component';
import { getOrgFromForce } from '../../utils/org/org-namer.util';
import { FactionId, getFactionImg } from '../../models/factions.model';
import { CompactFilterMenuComponent } from '../compact-filter-menu/compact-filter-menu.component';
import { uuidv4 } from '../../utils/uuid.util';
import type { ForceListSession } from '../../models/force-list-session';
import { ForceListPagingDirective } from '../../directives/force-list-paging.directive';
import {
    CARD_HEIGHT, CARD_WIDTH, GRID_SNAP_SIZE, GROUP_HEADER_HEIGHT, GROUP_PADDING,
    enclosingGroupBounds, getOverlapArea, rectContainsPoint, rectsOverlap, resolveCollisionPosition,
    snapGroupXToGrid, snapGroupYToGrid, snapToGrid, snapUpToGrid, type Rect,
} from './force-org-layout';

import {
    SIDEBAR_FILTER_ALL, SIDEBAR_FILTER_UNTAGGED, buildSidebarTags, countSidebarFilters,
    sortForces, computeSearchText, matchesSidebarSearch, matchesSidebarFilter,
    matchesSidebarFactionFilter, matchesSidebarEraFilter, buildSidebarFactionOptions, buildSidebarEraOptions,
    type SidebarTagRecord,
} from './force-org-sidebar';

import { deriveCollectionMetadata, deriveOrganizationMetadata, type PreviewOrgExtras } from './force-org-metadata';

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.0;

const GROUP_EMBED_OVERLAP_THRESHOLD = 0.2;
const COLLISION_RESOLVE_MAX_ITERATIONS = 50;
const READONLY_PREVIEW_MOVE_THRESHOLD = 6;
const AUTO_FIT_MAX_RETRIES = 24;
const UNSAVED_ORGANIZATION_WARNING = 'This TO&E has uncommitted changes. If you leave now, those changes will be discarded.';

interface GroupPreview extends Rect { orgName: string; totals: string; factionId: FactionId | undefined }

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
    placementId: string;
    force: LoadForceEntry;
    x: WritableSignal<number>;
    y: WritableSignal<number>;
    zIndex: WritableSignal<number>;
    groupId: string | null;
}

/** An organizational group containing forces or other groups */
type OrgGroup = ReturnType<typeof createOrgGroupState>;

function createOrgGroupState(params: {
    id?: string;
    name?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    zIndex: number;
    parentGroupId?: string | null;
}) {
    return {
        id: params.id ?? uuidv4(),
        name: signal(params.name ?? ''),
        x: signal(params.x ?? 0),
        y: signal(params.y ?? 0),
        width: signal(params.width ?? 0),
        height: signal(params.height ?? 0),
        zIndex: signal(params.zIndex),
        parentGroupId: params.parentGroupId ?? null,
    };
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
    return createForcePreviewEntryData({
        instanceId,
        name: 'Missing Force',
        missing: true,
        groups: [],
    });
}

@Component({
    selector: 'force-org-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FactionImgPipe, CompactFilterMenuComponent, ForceListPagingDirective],
    host: {
        class: 'fullscreen-dialog-host fullheight tv-fade',
        '(window:beforeunload)': 'onBeforeUnload($event)',
    },
    templateUrl: './force-org-dialog.component.html',
    styleUrl: './force-org-dialog.component.scss'
})
export class ForceOrgDialogComponent {
    private dialogRef = inject(DialogRef<void>);
    private dataService = inject(DataService);
    private readonly forcePersistence = inject(ForcePersistenceService);
    private organizationStorage = inject(OrganizationStorageService);
    private dialogsService = inject(DialogsService);
    private readonly forceWorkspace = inject(ForceWorkspaceStateService);
    private destroyRef = inject(DestroyRef);
    private urlService = inject(UrlService);
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

    getFactionImg = getFactionImg;

    /** Instance ID of the currently selected workspace force. */
    protected selectedForceInstanceId = computed(() => {
        const unit = this.forceWorkspace.selectedUnit();
        return unit?.force?.instanceId() ?? null;
    });

    /** Map of loaded force instanceId → alignment ('friendly' | 'enemy'). */
    protected loadedForceAlignments = computed<Map<string, 'friendly' | 'enemy'>>(() => {
        const map = new Map<string, 'friendly' | 'enemy'>();
        for (const slot of this.forceWorkspace.loadedForces()) {
            const id = slot.force.instanceId();
            if (id) map.set(id, slot.alignment);
        }
        return map;
    });

    protected organizationFactionId = computed(() => this.organizationMetadata().factionId);

    // Sidebar
    protected sidebarOpen = signal(false);
    protected sidebarSearchText = signal('');
    protected readonly sidebarAllFilter = SIDEBAR_FILTER_ALL;
    protected readonly sidebarUntaggedFilter = SIDEBAR_FILTER_UNTAGGED;
    protected sidebarFilter = signal<string>(SIDEBAR_FILTER_ALL);
    protected sidebarFactionFilter = signal<number | null>(null);
    protected sidebarEraFilter = signal<number | null>(null);
    protected sidebarAnimated = signal(false);
    protected sidebarLoading = signal(false);
    protected sidebarComplete = signal(false);
    protected sidebarPending = signal<'next' | 'all' | null>(null);
    protected sidebarLoadError = signal('');
    protected sidebarVisible = computed(() => !this.readOnly() && (!this.layoutService.isMobile() || this.sidebarOpen()));
    private sidebarSession?: ForceListSession;
    private sidebarLoadGeneration = 0;
    protected sidebarRequiresComplete = computed(() => this.sidebarSearchText().trim().length > 0
        || this.sidebarFilter() !== SIDEBAR_FILTER_ALL || this.sidebarFactionFilter() !== null
        || this.sidebarEraFilter() !== null || this.sidebarSort() !== 'timestamp' || this.sidebarSortDirection() !== 'desc');
    protected loading = signal(false);

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
    protected shadowCloneLabels = computed<Map<string, string>>(() => {
        const labels = new Map<string, string>();
        const counts = new Map<string, number>();

        for (const pf of this.placedForces()) {
            const count = counts.get(pf.force.instanceId) ?? 0;
            if (count > 0) {
                labels.set(pf.placementId, `Shadow ${count}`);
            }
            counts.set(pf.force.instanceId, count + 1);
        }

        return labels;
    });

    // Groups
    protected groups = signal<OrgGroup[]>([]);
    // Values are the authoritative group objects; parent walks also see in-progress reparenting.
    private groupsById = computed(() => new Map(this.groups().map(group => [group.id, group])));
    private parentGroupIds = computed(() => new Set(this.groups().map(group => group.parentGroupId)));
    private currentOrganizationSnapshot = computed(() => this.captureOrganizationSnapshot());
    private savedOrganizationSnapshot = signal(this.currentOrganizationSnapshot());
    protected dirty = computed(() => this.currentOrganizationSnapshot() !== this.savedOrganizationSnapshot());

    // Pan/zoom state
    protected viewOffset = signal({ x: 0, y: 0 });
    protected zoom = signal(1);
    private lastPanPoint: { x: number; y: number } | null = null;
    private pendingMoveEvent: PointerEvent | null = null;
    private moveRafId: number | null = null;
    private autoFitRafId: number | null = null;
    private hasGlobalPointerListeners = false;
    private pinchStartDistance = 0;
    private pinchStartZoom = 1;
    private activeTouches = new Map<number, PointerEvent>();
    private pendingReadonlyPreview: { pointerId: number; startX: number; startY: number; force: LoadForceEntry; placementId: string } | null = null;
    private pendingReadonlyClickPlacementId: string | null = null;

    // Drag state for forces
    protected draggedForce = signal<PlacedForce | null>(null);
    private dragStartPos = { x: 0, y: 0 };
    private forceStartPos = { x: 0, y: 0 };
    protected isDragging = signal(false);
    private forceDragged = false;
    private closeConfirmationOpen = false;

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
    protected hoveredForceInstanceId = computed<string | null>(() => {
        const hoveredPlacementId = this.hoveredForceId();
        if (!hoveredPlacementId) return null;

        return this.placedForces().find(pf => pf.placementId === hoveredPlacementId)?.force.instanceId ?? null;
    });

    // Drop preview state
    protected dropTargetGroupId = signal<string | null>(null);
    protected dropPreviewRect = signal<GroupPreview | null>(null);
    private previewExtraForces = signal<PreviewOrgExtras | null>(null);
    /** Identity of the "other" target in the current new-group/create-parent preview. */
    private previewOtherId: string | null = null;
    /** Cached org metadata for the current preview (orgName, totals, factionId). */
    private previewOrgCache: { orgName: string; totals: string; factionId: FactionId | undefined } | null = null;

    /** Forces available in sidebar before tag/text filtering. */
    protected sidebarBaseForces = computed(() => {
        const placedIds = new Set(this.placedForces().map(p => p.force.instanceId));
        return this.allForces().filter(f => !placedIds.has(f.instanceId));
    });

    /** Forces available in sidebar after text search, before tag/system filtering. */
    private sidebarCountSourceForces = computed(() => {
        const tokens = this.sidebarSearchText().trim().toLowerCase().split(/\s+/).filter(Boolean);
        return this.sidebarBaseForces().filter(force => matchesSidebarSearch(force, tokens));
    });

    private sidebarFacetSourceForces = computed(() => {
        const filter = this.sidebarFilter();
        return this.sidebarCountSourceForces().filter(force => matchesSidebarFilter(force, filter));
    });

    protected sidebarFactionOptions = computed(() => !this.sidebarComplete() ? [] :
        buildSidebarFactionOptions(
            this.sidebarFacetSourceForces().filter(force => matchesSidebarEraFilter(force, this.sidebarEraFilter())),
        ),
    );

    protected sidebarEraOptions = computed(() => !this.sidebarComplete() ? [] :
        buildSidebarEraOptions(
            this.sidebarFacetSourceForces().filter(force => matchesSidebarFactionFilter(force, this.sidebarFactionFilter())),
        ),
    );

    private sidebarDisplayCounts = computed(() => countSidebarFilters(this.sidebarCountSourceForces()).counts);

    // Keep tag labels stable during search, while counts reflect the searched list.
    private sidebarTagData = computed(() => countSidebarFilters(this.sidebarBaseForces()));
    protected sidebarTags = computed(() => buildSidebarTags(this.sidebarTagData().labels, this.sidebarDisplayCounts()));

    protected activeSidebarTagRecord = computed<SidebarTagRecord | null>(() => {
        const filter = this.sidebarFilter();
        if (
            filter === SIDEBAR_FILTER_ALL
            || filter === SIDEBAR_FILTER_UNTAGGED
            || filter === GameSystem.CBT
            || filter === GameSystem.AS
        ) {
            return null;
        }
        return this.sidebarTags().find(tag => tag.id === filter) ?? null;
    });

    /** Forces available in sidebar (not yet placed) */
    protected sidebarForces = computed(() => {
        const factionFilter = this.sidebarFactionFilter();
        const eraFilter = this.sidebarEraFilter();
        const sortKey = this.sidebarSort();
        const sortDir = this.sidebarSortDirection();
        const filtered = this.sidebarFacetSourceForces().filter(f =>
            matchesSidebarFactionFilter(f, factionFilter)
            && matchesSidebarEraFilter(f, eraFilter),
        );
        return sortForces(filtered, sortKey, sortDir);
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
                current = this.groupsById().get(current!.parentGroupId!);
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

    private organizationMetadata = computed(() => deriveOrganizationMetadata(
        this.groupsById(), this.placedForces(), this.dataService.getFactions(), this.dataService.getEras(),
    ));
    protected groupMetadata = computed(() => this.organizationMetadata().groups);

    /** Only the target and its ancestors display hypothetical drop metadata. */
    protected previewGroupInfo = computed(() => {
        const extra = this.previewExtraForces();
        if (!extra) return new Map<string, { orgName: string; totals: string; factionId: FactionId | undefined }>();
        const groups = this.groupsById();
        const preview = deriveOrganizationMetadata(
            groups, this.placedForces(), this.dataService.getFactions(), this.dataService.getEras(), extra,
        );
        const result = new Map<string, { orgName: string; totals: string; factionId: FactionId | undefined }>();
        const visited = new Set<string>();
        let currentId: string | null = extra.targetGroupId;
        while (currentId && !visited.has(currentId)) {
            visited.add(currentId);
            const metadata = preview.groups.get(currentId);
            if (metadata?.descendants.length) {
                result.set(currentId, { orgName: metadata.org.name, totals: metadata.totals, factionId: metadata.factionId });
            }
            currentId = groups.get(currentId)?.parentGroupId ?? null;
        }
        return result;
    });

    protected isParentGroup(group: OrgGroup): boolean {
        return this.parentGroupIds().has(group.id);
    }

    private nextZIndex = 0;
    private nextGroupZIndex = 0;

    constructor() {
        effect(() => {
            if (this.sidebarVisible() && !this.loading() && !this.sidebarLoading() && !this.sidebarPending()
                && !this.sidebarComplete() && !this.sidebarLoadError() && this.sidebarRequiresComplete()) {
                untracked(() => { void this.loadSidebarPage('all', true); });
            }
        });
        effect(() => {
            this.ensureSidebarFilterIsValid();
        });
        effect(() => {
            this.ensureSidebarFacetFiltersAreValid();
        });
        effect(() => {
            this.dialogRef.disableClose = this.hasPendingUnsavedChanges();
        });
        this.dialogRef.backdropClick.subscribe(() => {
            if (!this.hasPendingUnsavedChanges()) return;
            void this.close();
        });
        this.dialogRef.keydownEvents.subscribe((event) => {
            if (event.key !== 'Escape') return;
            if (!this.hasPendingUnsavedChanges()) return;
            event.preventDefault();
            event.stopPropagation();
            void this.close();
        });
        this.destroyRef.onDestroy(() => {
            this.sidebarSession?.dispose();
            this.cleanupGlobalPointerState();
            this.urlService.setQueryParams({ toe: null });
        });
        effect(() => {
            this.urlService.setQueryParams({ toe: this.organizationId() });
        });
        if (this.dialogData?.organizationId) {
            this.loadOrganization(this.dialogData.organizationId);
        } else {
            this.loadForces();
            this.resetDirtyTracking();
        }
    }

    // ==================== Data Loading ====================

    private async loadForces(): Promise<void> {
        const generation = ++this.sidebarLoadGeneration;
        this.sidebarSession?.dispose();
        this.sidebarSession = undefined;
        this.sidebarLoading.set(true);
        this.sidebarComplete.set(false);
        this.sidebarLoadError.set('');
        this.sidebarPending.set(null);
        try {
            const session = await this.forcePersistence.openForceList();
            if (this.destroyRef.destroyed || generation !== this.sidebarLoadGeneration) { session.dispose(); return; }
            this.sidebarSession = session;
            await session.loadNext();
            if (this.destroyRef.destroyed || generation !== this.sidebarLoadGeneration) return;
            this.publishSidebarForces();
            if (this.layoutService.isMobile() && this.placedForces().length === 0) {
                this.sidebarOpen.set(true);
            }
        } catch (error) {
            if (this.destroyRef.destroyed || generation !== this.sidebarLoadGeneration) return;
            this.publishSidebarForces();
            this.sidebarLoadError.set(String(error));
        } finally {
            if (!this.destroyRef.destroyed && generation === this.sidebarLoadGeneration) this.sidebarLoading.set(false);
        }
    }

    private publishSidebarForces(): void {
        const session = this.sidebarSession;
        if (!session || this.destroyRef.destroyed) return;
        const entries = session.getEntries();
        this.primeForceSearchText(entries);
        // Keep directly resolved organization entries beyond the cursor, including
        // those the user has since moved from the canvas back into the sidebar.
        this.applyAvailableForces(entries);
        this.sidebarComplete.set(session.complete);
    }

    protected async loadSidebarPage(mode: 'next' | 'all' = 'next', automatic = false): Promise<void> {
        if (this.sidebarLoading() || this.sidebarPending() || this.sidebarComplete() || this.readOnly()) return;
        const session = this.sidebarSession;
        if (!session) { await this.loadForces(); return; }
        this.sidebarPending.set(mode);
        this.sidebarLoadError.set('');
        try {
            if (mode === 'all') {
                await session.loadAll(() => !automatic || (this.sidebarVisible() && this.sidebarRequiresComplete()));
            } else {
                await session.loadNext();
            }
            if (this.sidebarSession === session) this.publishSidebarForces();
        } catch (error) {
            if (!this.destroyRef.destroyed && this.sidebarSession === session) {
                this.publishSidebarForces();
                this.sidebarLoadError.set(String(error));
            }
        } finally {
            if (!this.destroyRef.destroyed && this.sidebarSession === session) this.sidebarPending.set(null);
        }
    }

    private buildForceMap(forces: readonly LoadForceEntry[]): Map<string, LoadForceEntry> {
        const forceMap = new Map<string, LoadForceEntry>();
        for (const force of forces) {
            if (!force.instanceId) continue;
            forceMap.set(force.instanceId, force);
        }
        return forceMap;
    }

    private getLoadForceTimestamp(force: LoadForceEntry): number {
        if (typeof force.timestamp === 'number') return force.timestamp;
        if (force.timestamp) return new Date(force.timestamp).getTime();
        return 0;
    }

    private mergeAvailableForces(...collections: ReadonlyArray<readonly LoadForceEntry[]>): LoadForceEntry[] {
        const forceMap = new Map<string, LoadForceEntry>();

        for (const collection of collections) {
            for (const force of collection) {
                if (!force.instanceId) continue;
                const existing = forceMap.get(force.instanceId);
                if (!existing || this.getLoadForceTimestamp(force) > this.getLoadForceTimestamp(existing)) {
                    forceMap.set(force.instanceId, force);
                }
            }
        }

        return Array.from(forceMap.values()).sort((a, b) => this.getLoadForceTimestamp(b) - this.getLoadForceTimestamp(a));
    }

    private primeForceSearchText(forces: readonly LoadForceEntry[]): void {
        for (const force of forces) {
            force._searchText = computeSearchText(force);
        }
    }

    private createPlacedForceState(
        force: LoadForceEntry,
        params: {
            placementId?: string;
            x: number;
            y: number;
            zIndex: number;
            groupId: string | null;
        },
    ): PlacedForce {
        const placementId = params.placementId?.trim();
        return {
            placementId: placementId && placementId.length > 0 ? placementId : uuidv4(),
            force,
            x: signal(snapToGrid(params.x)),
            y: signal(snapToGrid(params.y)),
            zIndex: signal(params.zIndex),
            groupId: params.groupId,
        };
    }

    private buildPlacedForces(orgForces: readonly OrgPlacedForce[], forceMap?: ReadonlyMap<string, LoadForceEntry>): PlacedForce[] {
        return orgForces.map((pf) => this.createPlacedForceState(
            forceMap?.get(pf.instanceId) ?? createMissingForceEntry(pf.instanceId),
            {
                placementId: pf.placementId,
                x: pf.x,
                y: pf.y,
                zIndex: pf.zIndex,
                groupId: pf.groupId,
            },
        ));
    }

    private buildGroups(groupData: readonly OrgGroupData[]): OrgGroup[] {
        return groupData.map((group) => createOrgGroupState({
            id: group.id,
            name: group.name,
            x: snapGroupXToGrid(group.x),
            y: snapGroupYToGrid(group.y),
            width: Math.max(GRID_SNAP_SIZE, snapUpToGrid(group.width)),
            height: Math.max(GRID_SNAP_SIZE, snapUpToGrid(group.height)),
            zIndex: group.zIndex,
            parentGroupId: group.parentGroupId,
        }));
    }

    private updateZIndexCounters(placed: readonly PlacedForce[], groups: readonly OrgGroup[]): void {
        this.nextZIndex = placed.reduce((max, pf) => Math.max(max, pf.zIndex() + 1), 0);
        this.nextGroupZIndex = groups.reduce((max, group) => Math.max(max, group.zIndex() + 1), 0);
    }

    private captureOrganizationSnapshot(): string {
        const snapshot = {
            name: this.organizationName(),
            forces: this.placedForces()
                .map((pf) => ({
                    placementId: pf.placementId,
                    instanceId: pf.force.instanceId,
                    x: pf.x(),
                    y: pf.y(),
                    groupId: pf.groupId,
                }))
                .sort((left, right) =>
                    left.instanceId.localeCompare(right.instanceId) || left.placementId.localeCompare(right.placementId),
                ),
            groups: this.groups()
                .map((group) => ({
                    id: group.id,
                    name: group.name(),
                    x: group.x(),
                    y: group.y(),
                    width: group.width(),
                    height: group.height(),
                    parentGroupId: group.parentGroupId,
                }))
                .sort((left, right) => left.id.localeCompare(right.id)),
        };

        return JSON.stringify(snapshot);
    }

    private resetDirtyTracking(): void {
        this.savedOrganizationSnapshot.set(this.currentOrganizationSnapshot());
    }

    private restoreOrganizationShell(org: LoadedOrganization, forceMap?: ReadonlyMap<string, LoadForceEntry>): void {
        const placed = this.buildPlacedForces(org.forces, forceMap);
        const groups = this.buildGroups(org.groups);

        this.placedForces.set(placed);
        this.groups.set(groups);
        this.normalizeLoadedLayout();

        this.organizationId.set(org.organizationId);
        this.organizationName.set(org.name);
        this.resetDirtyTracking();

        this.updateZIndexCounters(this.placedForces(), this.groups());

        this.scheduleAutoFitView();
    }

    private scheduleAutoFitView(maxRetries = AUTO_FIT_MAX_RETRIES): void {
        if (this.autoFitRafId !== null) {
            cancelAnimationFrame(this.autoFitRafId);
            this.autoFitRafId = null;
        }

        let attempts = 0;
        const tryFit = () => {
            this.autoFitRafId = null;
            if (this.autoFitView()) return;
            if (attempts >= maxRetries) return;

            attempts++;
            this.autoFitRafId = requestAnimationFrame(tryFit);
        };

        this.autoFitRafId = requestAnimationFrame(tryFit);
    }

    private applyAvailableForces(forces: readonly LoadForceEntry[]): void {
        const mergedForces = this.mergeAvailableForces(forces, this.allForces());
        this.allForces.set(mergedForces);

        const forceMap = this.buildForceMap(mergedForces);
        const placed = this.placedForces();
        let changed = false;

        for (const pf of placed) {
            const hydratedForce = forceMap.get(pf.force.instanceId);
            if (!hydratedForce || hydratedForce === pf.force) continue;
            pf.force = hydratedForce;
            changed = true;
        }

        if (changed) {
            this.placedForces.set([...placed]);
        }
    }

    private async loadOrganizationForceEntries(instanceIds: readonly string[]): Promise<LoadForceEntry[]> {
        if (instanceIds.length === 0) return [];

        const forces = await this.forcePersistence.getLoadForceEntriesByIds(instanceIds);
        this.primeForceSearchText(forces);
        return forces;
    }

    // ==================== Sidebar ====================

    protected toggleSidebar(): void {
        this.sidebarAnimated.set(true);
        this.sidebarOpen.set(!this.sidebarOpen());
    }

    protected onSidebarSearch(text: string): void {
        this.sidebarSearchText.set(text);
    }

    protected setSidebarFilter(filter: string): void {
        this.sidebarFilter.set(filter);
    }

    protected toggleSidebarFilter(filter: string): void {
        this.setSidebarFilter(this.sidebarFilter() === filter ? SIDEBAR_FILTER_ALL : filter);
    }

    protected setSidebarFactionFilter(filter: number | null): void {
        this.sidebarFactionFilter.set(filter);
    }

    protected setSidebarEraFilter(filter: number | null): void {
        this.sidebarEraFilter.set(filter);
    }

    protected getSidebarTagCount(filter: string): number {
        return this.sidebarDisplayCounts().get(filter) ?? 0;
    }

    protected getSidebarFilterCount(filter: string): number {
        return this.sidebarDisplayCounts().get(filter) ?? 0;
    }

    protected getSidebarEmptyStateMessage(): string {
        if (this.sidebarSearchText().trim().length > 0) {
            return 'No forces match the current search.';
        }

        if (this.sidebarFactionFilter() !== null || this.sidebarEraFilter() !== null) {
            return 'No forces match the selected filters.';
        }

        const activeTag = this.activeSidebarTagRecord();
        if (activeTag) {
            return 'No forces with this tag available.';
        }

        if (this.sidebarFilter() === SIDEBAR_FILTER_UNTAGGED) {
            return 'No untagged forces available.';
        }

        if (this.sidebarFilter() === GameSystem.CBT) {
            return 'No BattleTech forces available.';
        }

        if (this.sidebarFilter() === GameSystem.AS) {
            return 'No Alpha Strike forces available.';
        }

        if (this.allForces().length === 0 && this.placedForces().length === 0) {
            return 'No saved forces found.';
        }

        return 'All forces placed. Drag them back here to remove.';
    }

    private ensureSidebarFilterIsValid(): void {
        if (!this.sidebarComplete()) return;
        if (this.sidebarFilter() !== SIDEBAR_FILTER_UNTAGGED) {
            return;
        }
        if (this.getSidebarTagCount(SIDEBAR_FILTER_UNTAGGED) === 0) {
            this.sidebarFilter.set(SIDEBAR_FILTER_ALL);
        }
    }

    private ensureSidebarFacetFiltersAreValid(): void {
        if (!this.sidebarComplete()) return;
        if (this.sidebarLoading()) {
            return;
        }

        const factionFilter = this.sidebarFactionFilter();
        if (factionFilter !== null && !this.sidebarFactionOptions().some(option => option.id === factionFilter)) {
            this.sidebarFactionFilter.set(null);
        }

        const eraFilter = this.sidebarEraFilter();
        if (eraFilter !== null && !this.sidebarEraOptions().some(option => option.id === eraFilter)) {
            this.sidebarEraFilter.set(null);
        }
    }

    protected setSidebarSort(key: string): void {
        this.sidebarSort.set(key);
    }

    protected setSidebarSortDirection(dir: 'asc' | 'desc'): void {
        this.sidebarSortDirection.set(dir);
    }

    protected async previewForce(force: LoadForceEntry): Promise<void> {
        this.dialogsService.createDialog(ForceEntryPreviewDialogComponent, {
            data: {
                force,
                unitDisplayNameOverride: 'both',
            }
        });
    }

    protected onReadonlyForceClick(event: MouseEvent, pf: PlacedForce): void {
        if (!this.readOnly() || pf.force.missing) return;
        if (this.pendingReadonlyClickPlacementId !== pf.placementId) return;

        this.pendingReadonlyClickPlacementId = null;
        event.preventDefault();
        event.stopPropagation();
        void this.previewForce(pf.force);
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
        this.pendingReadonlyClickPlacementId = null;
        if (this.readOnly()) {
            this.pendingReadonlyPreview = pf.force.missing ? null : {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                force: pf.force,
                placementId: pf.placementId,
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
        this.addGlobalPointerListeners();
    }

    private bringForceToFront(pf: PlacedForce): void {
        const forces = this.placedForces();
        const topZ = forces.length - 1;
        const currentZ = pf.zIndex();
        if (currentZ >= topZ) return;
        for (const f of forces) {
            if (f.zIndex() > currentZ) f.zIndex.update(v => v - 1);
        }
        pf.zIndex.set(topZ);
        this.nextZIndex = forces.length;
        this.placedForces.set([...forces]);
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
        this.addGlobalPointerListeners();
    }

    private bringGroupToFront(group: OrgGroup): void {
        const groups = this.groups();
        const topZ = groups.length - 1;
        const currentZ = group.zIndex();
        if (currentZ >= topZ) return;
        for (const other of groups) {
            if (other.zIndex() > currentZ) other.zIndex.update(v => v - 1);
        }
        group.zIndex.set(topZ);
        this.nextGroupZIndex = groups.length;
        this.groups.set([...groups]);
    }

    // ==================== Remove Force ====================

    protected shadowCloneForce(pf: PlacedForce): void {
        if (this.readOnly()) return;

        const cloned = this.createPlacedForceState(pf.force, {
            x: pf.x() + GRID_SNAP_SIZE * 2,
            y: pf.y() + GRID_SNAP_SIZE * 2,
            zIndex: this.nextZIndex++,
            groupId: pf.groupId,
        });

        this.placedForces.set([...this.placedForces(), cloned]);
        this.resolveForceSiblingCollisions(cloned);

        if (cloned.groupId) {
            const group = this.getGroupById(cloned.groupId);
            if (group) {
                this.recalcGroupBounds(group);
                this.resolveAncestorGroupCollisionsFrom(group);
            }
        }
    }

    protected removeForce(pf: PlacedForce): void {
        if (this.readOnly()) return;
        // Remove group membership
        if (pf.groupId) {
            const group = this.groupsById().get(pf.groupId);
            pf.groupId = null;
            if (group) this.recalcGroupBounds(group);
        }
        this.placedForces.update(forces => forces.filter(f => f !== pf));
        // Clean up empty groups
        this.cleanupEmptyGroups();
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
        }
    }

    protected removeGroup(group: OrgGroup): void {
        if (this.readOnly()) return;
        if (this.groupDragged) return;
        this.dissolveGroup(group);
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
        this.groups.update(groups => groups.filter(g => g.id !== group.id));
        this.placedForces.set([...this.placedForces()]);
        // Resize parent if exists
        if (group.parentGroupId) {
            const parent = this.groupsById().get(group.parentGroupId);
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
            ? this.groupsById().get(group.parentGroupId)
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
        const bounds = enclosingGroupBounds([
            ...members.map(member => this.forceRect(member)),
            ...childGroups.map(child => this.groupRect(child)),
        ]);
        if (!bounds) return;
        group.x.set(bounds.x);
        group.y.set(bounds.y);
        group.width.set(bounds.width);
        group.height.set(bounds.height);

        // Recurse up so ancestor bounds continue to wrap their children.
        if (group.parentGroupId) {
            const parent = this.groupsById().get(group.parentGroupId);
            if (parent) this.recalcGroupBounds(parent);
        }
    }

    private getGroupById(groupId: string | null | undefined): OrgGroup | null {
        if (!groupId) return null;
        return this.groupsById().get(groupId) ?? null;
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

    private resolveSiblingCollisions(
        getRect: () => Rect,
        moveTo: (x: number, y: number) => void,
        containerGroupId: string | null,
        excludedForce?: PlacedForce,
        excludedGroup?: OrgGroup,
    ): void {
        // Group movement can snap a retained off-grid axis; check the actual
        // resulting bounds again instead of assuming the requested move is exact.
        for (let iteration = 0; iteration < COLLISION_RESOLVE_MAX_ITERATIONS; iteration++) {
            const rect = getRect();
            const nextPosition = resolveCollisionPosition(
                rect,
                this.getSiblingCollisionRects(containerGroupId, excludedForce, excludedGroup),
                excludedGroup ? 'group' : 'force',
            );
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

    private getPreferredGroupTarget(
        rect: Rect,
        groups: readonly OrgGroup[],
        excludedGroupId?: string | null,
        focusPoint?: { x: number; y: number },
    ): { group: OrgGroup; overlap: number } | null {
        const candidates: Array<{ group: OrgGroup; overlap: number; containsFocus: boolean }> = [];

        for (const group of groups) {
            if (group.id === excludedGroupId) continue;

            const overlap = getOverlapArea(rect, this.groupRect(group));
            if (overlap <= 0) continue;

            candidates.push({
                group,
                overlap,
                containsFocus: focusPoint ? rectContainsPoint(this.groupRect(group), focusPoint) : false,
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
        const metadata = deriveCollectionMetadata(entries, this.dataService.getFactions(), this.dataService.getEras(), childGroupResults);
        this.previewOrgCache = metadata;
        return { ...enclosingGroupBounds([a, b])!, ...metadata };
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
            const overlap = getOverlapArea(pfRect, this.forceRect(other));
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
            const parent = this.groupsById().get(grp.parentGroupId);
            if (parent) {
                bestOverlap = getOverlapArea(grpRect, this.groupRect(parent));
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
            const overlap = getOverlapArea(rect, this.forceRect(pf));
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
            if (this.previewOtherId === bestForce.placementId && this.previewOrgCache) {
                this.dropPreviewRect.set({ ...enclosingGroupBounds([rect, this.forceRect(bestForce)])!, ...this.previewOrgCache });
            } else {
                this.previewOtherId = bestForce.placementId;
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
                    ? (action as { type: 'new-group'; other: PlacedForce }).other.placementId
                    : (action as { type: 'create-parent'; other: OrgGroup }).other.id;
                if (this.dropTargetGroupId() !== null) this.dropTargetGroupId.set(null);
                if (this.previewExtraForces() !== null) this.previewExtraForces.set(null);
                if (this.previewOtherId === otherId && this.previewOrgCache) {
                    // Same target — only update geometry
                    this.dropPreviewRect.set({ ...enclosingGroupBounds([draggedRect, otherRect!])!, ...this.previewOrgCache });
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
                const group = createOrgGroupState({
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
            current = this.groupsById().get(current!.parentGroupId!);
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
            current = this.groupsById().get(current!.parentGroupId!);
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
        const group = this.groupsById().get(groupId);
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
                const parentGroup = createOrgGroupState({
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
        const isReadonlyMouseTapCandidate = event.pointerType === 'mouse'
            && this.pendingReadonlyPreview?.pointerId === event.pointerId;
        if (!isReadonlyMouseTapCandidate) {
            this.setPointerCaptureIfAvailable(event);
        }
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
        if (this.autoFitRafId !== null) {
            cancelAnimationFrame(this.autoFitRafId);
            this.autoFitRafId = null;
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
            this.pendingReadonlyClickPlacementId = null;
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
            const newX = snapToGrid(this.forceStartPos.x + dx);
            const newY = snapToGrid(this.forceStartPos.y + dy);
            if (!this.forceDragged && (newX !== this.forceStartPos.x || newY !== this.forceStartPos.y)) {
                this.forceDragged = true;
                this.bringForceToFront(dragged);
            }
            dragged.x.set(newX);
            dragged.y.set(newY);
            // Update drop preview
            const forceAction = this.detectForceDrop(dragged, worldPos);
            if (!forceAction && dragged.groupId) {
                const ownGroup = this.groupsById().get(dragged.groupId);
                if (ownGroup && getOverlapArea(this.forceRect(dragged), this.groupRect(ownGroup)) > 0) {
                    this.setExistingGroupDropPreview(ownGroup.id);
                    return;
                }
            }
            const otherRect = forceAction?.type === 'new-group' ? this.forceRect(forceAction.other) : undefined;
            // Skip building entries if still overlapping the same target
            const forceOtherId = forceAction?.type === 'new-group' ? forceAction.other.placementId
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
            const newX = snapGroupXToGrid(this.groupStartPos.x + dx);
            const newY = snapGroupYToGrid(this.groupStartPos.y + dy);
            if (!this.groupDragged && (newX !== this.groupStartPos.x || newY !== this.groupStartPos.y)) {
                this.groupDragged = true;
                this.bringGroupToFront(draggedGrp);
            }
            const moveDx = newX - draggedGrp.x();
            const moveDy = newY - draggedGrp.y();

            // Move group and all descendants
            this.translateGroupRecursive(draggedGrp, moveDx, moveDy);

            // Update drop preview
            const grpAction = this.detectGroupDrop(draggedGrp, worldPos);
            if (!grpAction && draggedGrp.parentGroupId) {
                const parent = this.groupsById().get(draggedGrp.parentGroupId);
                if (parent && getOverlapArea(this.groupRect(draggedGrp), this.groupRect(parent)) > 0) {
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
                const metadata = this.groupMetadata();
                const dragged = metadata.get(draggedGrp.id)!;
                if (grpAction?.type === 'create-parent') {
                    const other = metadata.get(grpAction.other.id)!;
                    grpEntries = [...dragged.descendants, ...other.descendants];
                    grpChildGroupResults = [
                        ...(dragged.descendants.length ? dragged.org.groups : []),
                        ...(other.descendants.length ? other.org.groups : []),
                    ];
                } else if (grpAction?.type === 'join-parent') {
                    grpEntries = dragged.descendants;
                    if (grpEntries.length) grpChildGroupResults = [...dragged.org.groups];
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
        } else {
            this.pendingReadonlyClickPlacementId = null;
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
                            const newPlaced = this.createPlacedForceState(force, {
                                x: worldPos.x - CARD_WIDTH / 2,
                                y: worldPos.y - CARD_HEIGHT / 2,
                                zIndex: this.nextZIndex++,
                                groupId: null,
                            });
                            this.placedForces.set([...this.placedForces(), newPlaced]);
                            // Try grouping with nearby forces
                            this.tryFormGroup(newPlaced, worldPos);
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
                    const parent = this.groupsById().get(dragEndGroup.parentGroupId);
                    const overlapsParent = parent && rectsOverlap(this.groupRect(dragEndGroup), this.groupRect(parent));
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
                    const parent = this.groupsById().get(dragEndGroup.parentGroupId);
                    if (parent) this.recalcGroupBounds(parent);
                }
            } else if (this.titleDragGroupId === dragEndGroup.id) {
                void this.renameGroup(dragEndGroup);
            }
            this.draggedGroup.set(null);
        }

        if (this.activeTouches.size === 0) this.cleanupGlobalPointerState();

        if (readonlyPreview) {
            this.pendingReadonlyClickPlacementId = readonlyPreview.placementId;
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
        }
    }

    protected async shareOrganization(event?: MouseEvent): Promise<void> {
        event?.stopPropagation();
        if (this.saving()) return;

        if (!this.readOnly() && (this.dirty() || !this.organizationId())) {
            try {
                await this.saveOrganization();
            } catch {
                await this.dialogsService.showError('Failed to save organization before sharing.', 'Share TO&E');
                return;
            }
        }

        const organizationId = this.organizationId();
        if (!organizationId) {
            await this.dialogsService.showError('Save the organization before sharing it.', 'Share TO&E');
            return;
        }

        this.dialogsService.createDialog(ShareForceOrgDialogComponent, {
            data: {
                organizationName: this.organizationName(),
                shareUrl: this.buildShareUrl(organizationId),
            },
        });
    }

    protected async saveOrganization(): Promise<void> {
        if (this.readOnly() || this.saving()) return;
        this.saving.set(true);
        try {
            const orgId = this.organizationId() ?? uuidv4();
            this.organizationId.set(orgId);

            const serialized: SerializedOrganization = {
                organizationId: orgId,
                name: this.organizationName(),
                timestamp: Date.now(),
                factionId: this.organizationFactionId(),
                forces: this.placedForces().map(pf => ({
                    placementId: pf.placementId,
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

            await this.organizationStorage.saveOrganization(serialized);
            this.resetDirtyTracking();
        } finally {
            this.saving.set(false);
        }
    }

    private async loadOrganization(organizationId: string): Promise<void> {
        ++this.sidebarLoadGeneration;
        this.sidebarSession?.dispose();
        this.sidebarSession = undefined;
        this.loading.set(true);
        this.sidebarLoading.set(false);
        try {
            const org = await this.organizationStorage.getOrganization(organizationId);
            if (!org) {
                this.organizationId.set(null);
                this.organizationOwned.set(true);
                await this.dialogsService.showError('Organization not found.', 'Load Error');
                this.loading.set(false);
                await this.loadForces();
                return;
            }

            this.applyLoadedOrganizationMetadata(org);

            const orgForceIds = Array.from(new Set(org.forces.map((pf) => pf.instanceId).filter(Boolean)));

            this.restoreOrganizationShell(org);

            const sidebarForcesPromise = org.owned === false
                ? Promise.resolve()
                : this.loadForces();

            try {
                const orgForces = await this.loadOrganizationForceEntries(orgForceIds);
                this.applyAvailableForces(orgForces);
            } catch {
                // Keep placeholder cards so the saved layout is still visible while force data is unavailable.
            } finally {
                this.loading.set(false);
            }

            if (org.owned !== false) {
                await sidebarForcesPromise;
            }
        } catch {
            this.organizationId.set(null);
            this.organizationOwned.set(true);
            this.loading.set(false);
            await this.dialogsService.showError('Failed to load organization.', 'Load Error');
            await this.loadForces();
        }
    }

    private applyLoadedOrganizationMetadata(org: LoadedOrganization): void {
        this.organizationOwned.set(org.owned ?? true);
    }

    private hasPendingUnsavedChanges(): boolean {
        return !this.readOnly() && this.dirty();
    }

    private async confirmDiscardPendingChanges(): Promise<boolean> {
        if (!this.hasPendingUnsavedChanges()) return true;
        if (this.closeConfirmationOpen) return false;

        this.closeConfirmationOpen = true;
        try {
            const result = await this.dialogsService.choose(
                'Unsaved TO&E Changes',
                UNSAVED_ORGANIZATION_WARNING,
                [
                    { label: 'DISCARD', value: 'discard', class: 'danger' },
                    { label: 'CANCEL', value: 'cancel' },
                ],
                'cancel',
                { panelClass: 'danger' },
            );

            return result === 'discard';
        } finally {
            this.closeConfirmationOpen = false;
        }
    }

    protected onBeforeUnload(event: BeforeUnloadEvent): string | void {
        if (!this.hasPendingUnsavedChanges()) return undefined;

        event.preventDefault();
        event.returnValue = '';
        return UNSAVED_ORGANIZATION_WARNING;
    }

    protected async close(): Promise<void> {
        if (!(await this.confirmDiscardPendingChanges())) return;
        this.dialogRef.close();
    }

    private buildShareUrl(organizationId: string): string {
        const shareUrl = new URL(window.location.href);
        shareUrl.search = '';
        shareUrl.searchParams.set('toe', organizationId);
        return shareUrl.toString();
    }

    /**
     * Auto-fit the viewport so all placed forces and groups are centered
     * in the SVG canvas. Zoom is capped at 1.0 (no zoom-in past 100%).
     */
    private autoFitView(): boolean {
        const svg = this.svgCanvas()?.nativeElement;
        if (!svg) return false;

        const forces = this.placedForces();
        const groups = this.groups();
        if (forces.length === 0 && groups.length === 0) {
            this.viewOffset.set({ x: 0, y: 0 });
            this.zoom.set(1);
            return true;
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
    if (contentWidth <= 0 || contentHeight <= 0) return false;

    const svgRect = svg.getBoundingClientRect();
    const canvasWidth = svg.clientWidth || svgRect.width;
    const canvasHeight = svg.clientHeight || svgRect.height;
        const padding = 40;
    const availableWidth = canvasWidth - padding * 2;
    const availableHeight = canvasHeight - padding * 2;
    if (availableWidth <= 0 || availableHeight <= 0) return false;

        // Scale to fit, but never zoom in above 1.0
        const scaleX = availableWidth / contentWidth;
        const scaleY = availableHeight / contentHeight;
        const fitZoom = Math.min(scaleX, scaleY, 1.0);
        const clampedZoom = Math.max(MIN_ZOOM, fitZoom);

        // Center content in the viewport
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const offsetX = canvasWidth / 2 - centerX * clampedZoom;
        const offsetY = canvasHeight / 2 - centerY * clampedZoom;

        this.zoom.set(clampedZoom);
        this.viewOffset.set({ x: offsetX, y: offsetY });
        return true;
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
