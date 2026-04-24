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

import { Component, inject, signal, effect, ChangeDetectionStrategy, computed, viewChild, viewChildren, type ElementRef, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkMenuModule, CdkMenuTrigger, MenuTracker } from '@angular/cdk/menu';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { firstValueFrom, map, race } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { MeasureClampOverflowDirective } from '../../directives/measure-clamp-overflow.directive';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { Pipe, type PipeTransform } from "@angular/core";
import { getForcePreviewUnitPilotStats } from '../../models/force-preview.model';
import type { LoadForceEntry, LoadForceGroup } from '../../models/load-force-entry.model';
import type { LoadOperationEntry } from '../../models/operation.model';
import type { SerializedOperation } from '../../models/operation.model';
import type { LoadOrganizationEntry } from '../../models/organization.model';
import { ConfirmDialogComponent, type ConfirmDialogData } from '../confirm-dialog/confirm-dialog.component';
import { SaveOperationDialogComponent, type OperationDialogData, type OperationDialogResult } from '../save-operation-dialog/save-operation-dialog.component';
import { OpPreviewComponent } from '../op-preview/op-preview.component';
import { OptionsService } from '../../services/options.service';
import { GameService } from '../../services/game.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { GameSystem } from '../../models/common.model';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { type ResolvedPack, resolveForcePacks } from '../../utils/force-pack.util';
import { CustomizeForcePackDialogComponent, type CustomizeForcePackDialogData, type CustomizeForcePackDialogResult } from '../customize-force-pack-dialog/customize-force-pack-dialog.component';
import type { ForceAlignment } from '../../models/force-slot.model';
import { ForceAddModePickerDialogComponent, type ForceAddModePickerData, type ForceAddModePickerResult } from '../force-add-mode-picker-dialog/force-add-mode-picker-dialog.component';
import { FactionImgPipe } from '../../pipes/faction-img.pipe';
import { CleanModelStringPipe } from '../../pipes/clean-model-string.pipe';
import { sanitizeForceTags } from '../../models/force-serialization';
import { LanceTypeIdentifierUtil } from '../../utils/lance-type-identifier.util';
import {
    NOTE_PREVIEW_LINE_COUNT,
    hasVisibleNoteText,
} from '../../utils/note-preview.util';
import { NO_FORMATION_ID } from '../../utils/formation-type.model';
import { SessionPersistenceService } from '../../services/session-persistence.service';

/*
 * Author: Drake
 */

@Pipe({
    name: 'formatTimestamp',
    pure: true // Pure pipes are only called when the input changes
})
export class FormatTimestamp implements PipeTransform {
    transform(timestamp: string | number | undefined): string {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
}

export type ForceLoadMode = 'load' | 'add' | 'insert' | 'operation';

export interface ForceLoadDialogEnvelope {
    result: LoadForceEntry | ResolvedPack | LoadOperationEntry;
    mode: ForceLoadMode;
    alignment: ForceAlignment;
}

export type ForceLoadDialogResult = ForceLoadDialogEnvelope | null;

export interface ForceLoadDialogData {
    initialTab?: string;
}

type SortDirection = 'asc' | 'desc';
type SortOption = { key: string; label: string };
type HangarTagRecord = { id: string; label: string; count: number; ownedCount: number };

const HANGAR_SORT_SESSION_KEY = 'mekbay:force-load-dialog:hangar-sort';
const HANGAR_SORT_DIRECTION_SESSION_KEY = 'mekbay:force-load-dialog:hangar-sort-direction';
const HANGAR_TAG_FILTER_SESSION_KEY = 'mekbay:force-load-dialog:hangar-tag-filter';
const HANGAR_FILTER_ALL = 'all';
const HANGAR_FILTER_UNFILED = 'unfiled';
const HANGAR_FILTER_CLASSIC = 'game-type:cbt';
const HANGAR_FILTER_ALPHA_STRIKE = 'game-type:as';
const HANGAR_FILTER_TAG_PREFIX = 'tag:';
const PACK_SORT_SESSION_KEY = 'mekbay:force-load-dialog:pack-sort';
const PACK_SORT_DIRECTION_SESSION_KEY = 'mekbay:force-load-dialog:pack-sort-direction';
const ORGANIZATION_SORT_SESSION_KEY = 'mekbay:force-load-dialog:organization-sort';
const ORGANIZATION_SORT_DIRECTION_SESSION_KEY = 'mekbay:force-load-dialog:organization-sort-direction';
const OPERATION_SORT_SESSION_KEY = 'mekbay:force-load-dialog:operation-sort';
const OPERATION_SORT_DIRECTION_SESSION_KEY = 'mekbay:force-load-dialog:operation-sort-direction';
const DEFAULT_HANGAR_SORT_KEY = 'timestamp';
const DEFAULT_HANGAR_SORT_DIRECTION: SortDirection = 'desc';
const DEFAULT_PACK_SORT_KEY = 'name';
const DEFAULT_PACK_SORT_DIRECTION: SortDirection = 'asc';
const DEFAULT_ORGANIZATION_SORT_KEY = 'timestamp';
const DEFAULT_ORGANIZATION_SORT_DIRECTION: SortDirection = 'desc';
const DEFAULT_OPERATION_SORT_KEY = 'timestamp';
const DEFAULT_OPERATION_SORT_DIRECTION: SortDirection = 'desc';

@Component({
    selector: 'force-load-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, CdkMenuModule, BaseDialogComponent, CleanModelStringPipe, FormatTimestamp, MeasureClampOverflowDirective, UnitIconComponent, OpPreviewComponent, FactionImgPipe],
    templateUrl: './force-load-dialog.component.html',
    styleUrls: ['./force-load-dialog.component.css']
})
export class ForceLoadDialogComponent {
    private dialogRef = inject(DialogRef<ForceLoadDialogResult>);
    private dialogData: ForceLoadDialogData | null = inject(DIALOG_DATA, { optional: true });
    private dataService = inject(DataService);
    private destroyRef = inject(DestroyRef);
    private sessionPersistenceService = inject(SessionPersistenceService);
    forceBuilderService = inject(ForceBuilderService);
    optionsService = inject(OptionsService);
    gameService = inject(GameService);
    private dialogsService = inject(DialogsService);
    readonly hangarAllFilter = HANGAR_FILTER_ALL;
    readonly hangarUnfiledFilter = HANGAR_FILTER_UNFILED;
    readonly hangarClassicFilter = HANGAR_FILTER_CLASSIC;
    readonly hangarAlphaStrikeFilter = HANGAR_FILTER_ALPHA_STRIKE;
    searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
    menuTriggers = viewChildren<CdkMenuTrigger>(CdkMenuTrigger);

    readonly GameSystem = GameSystem;
    readonly getUnitPilotStats = getForcePreviewUnitPilotStats;

    readonly HANGAR_SORT_OPTIONS: { key: string; label: string }[] = [
        { key: 'timestamp', label: 'Date' },
        { key: 'name', label: 'Name' },
        { key: 'value', label: 'Value' },
        { key: 'faction', label: 'Faction' },
        { key: 'size', label: 'Size' },
    ];
    readonly PACK_SORT_OPTIONS: SortOption[] = [
        { key: 'name', label: 'Name' },
        { key: 'value', label: 'Value' },
        { key: 'size', label: 'Size' },
    ];
    readonly ORGANIZATION_SORT_OPTIONS: SortOption[] = [
        { key: 'timestamp', label: 'Date' },
        { key: 'name', label: 'Name' },
        { key: 'faction', label: 'Faction' },
        { key: 'forces', label: 'Forces' },
    ];
    readonly OPERATION_SORT_OPTIONS: SortOption[] = [
        { key: 'timestamp', label: 'Date' },
        { key: 'name', label: 'Name' },
        { key: 'forces', label: 'Forces' },
    ];

    hangarSort = signal<string>(this.getStoredSortKey(HANGAR_SORT_SESSION_KEY, this.HANGAR_SORT_OPTIONS, DEFAULT_HANGAR_SORT_KEY));
    hangarSortDirection = signal<SortDirection>(this.getStoredSortDirection(HANGAR_SORT_DIRECTION_SESSION_KEY, DEFAULT_HANGAR_SORT_DIRECTION));
    packSort = signal<string>(this.getStoredSortKey(PACK_SORT_SESSION_KEY, this.PACK_SORT_OPTIONS, DEFAULT_PACK_SORT_KEY));
    packSortDirection = signal<SortDirection>(this.getStoredSortDirection(PACK_SORT_DIRECTION_SESSION_KEY, DEFAULT_PACK_SORT_DIRECTION));
    organizationSort = signal<string>(this.getStoredSortKey(ORGANIZATION_SORT_SESSION_KEY, this.ORGANIZATION_SORT_OPTIONS, DEFAULT_ORGANIZATION_SORT_KEY));
    organizationSortDirection = signal<SortDirection>(this.getStoredSortDirection(ORGANIZATION_SORT_DIRECTION_SESSION_KEY, DEFAULT_ORGANIZATION_SORT_DIRECTION));
    operationSort = signal<string>(this.getStoredSortKey(OPERATION_SORT_SESSION_KEY, this.OPERATION_SORT_OPTIONS, DEFAULT_OPERATION_SORT_KEY));
    operationSortDirection = signal<SortDirection>(this.getStoredSortDirection(OPERATION_SORT_DIRECTION_SESSION_KEY, DEFAULT_OPERATION_SORT_DIRECTION));

    /** Active sort options/state based on the current tab */
    activeSortOptions = computed(() => {
        switch (this.activeTab()) {
            case 'Force Packs':
                return this.PACK_SORT_OPTIONS;
            case 'TO&E':
                return this.ORGANIZATION_SORT_OPTIONS;
            case 'Operations':
                return this.OPERATION_SORT_OPTIONS;
            default:
                return this.HANGAR_SORT_OPTIONS;
        }
    });
    activeSort = computed(() => {
        switch (this.activeTab()) {
            case 'Force Packs':
                return this.packSort();
            case 'TO&E':
                return this.organizationSort();
            case 'Operations':
                return this.operationSort();
            default:
                return this.hangarSort();
        }
    });
    activeSortDirection = computed(() => {
        switch (this.activeTab()) {
            case 'Force Packs':
                return this.packSortDirection();
            case 'TO&E':
                return this.organizationSortDirection();
            case 'Operations':
                return this.operationSortDirection();
            default:
                return this.hangarSortDirection();
        }
    });

    forces = signal<LoadForceEntry[]>([]);
    selectedForce = signal<LoadForceEntry | null>(null);
    loading = signal<boolean>(true);
    activeHangarMenuForce = signal<LoadForceEntry | null>(null);

    tabs = ['Hangar', 'Force Packs', 'TO&E', 'Operations'];
    activeTab = signal(this.dialogData?.initialTab ?? this.tabs[0]);

    searchText = signal<string>('');

    /** Check if the currently selected force is already loaded */
    isSelectedForceLoaded = computed<boolean>(() => {
        const sel = this.selectedForce();
        if (!sel?.instanceId) return false;
        return this.forceBuilderService.loadedForces().some(s => s.force.instanceId() === sel.instanceId);
    });
    gameTypeFilter = signal<'all' | GameSystem.CLASSIC | GameSystem.ALPHA_STRIKE>('all');
    hangarTagFilter = signal<string>(this.getStoredHangarTagFilter());

    private hangarCountSourceForces = computed(() => {
        const tokens = this.searchText().trim().toLowerCase().split(/\s+/).filter(Boolean);
        return this.forces().filter(force => this.matchesHangarSearch(force, tokens));
    });

    hangarGameTypeCounts = computed(() => {
        const counts = new Map<string, number>([
            [HANGAR_FILTER_ALL, 0],
            [GameSystem.CLASSIC, 0],
            [GameSystem.ALPHA_STRIKE, 0],
        ]);

        for (const force of this.hangarCountSourceForces()) {
            counts.set(HANGAR_FILTER_ALL, (counts.get(HANGAR_FILTER_ALL) ?? 0) + 1);
            const forceType = force.type || GameSystem.CLASSIC;
            counts.set(forceType, (counts.get(forceType) ?? 0) + 1);
        }

        return counts;
    });

    hangarTagData = computed(() => {
        const counts = new Map<string, number>([
            [HANGAR_FILTER_UNFILED, 0],
        ]);
        const labels = new Map<string, string>();
        const ownedCounts = new Map<string, number>();

        for (const force of this.forces()) {
            const forceTags = this.getForceTags(force);
            if (forceTags.length === 0) {
                counts.set(HANGAR_FILTER_UNFILED, (counts.get(HANGAR_FILTER_UNFILED) ?? 0) + 1);
                continue;
            }

            const seen = new Set<string>();
            for (const tag of forceTags) {
                const tagId = this.getHangarTagFilterId(tag);
                if (seen.has(tagId)) {
                    continue;
                }

                seen.add(tagId);
                if (!labels.has(tagId)) {
                    labels.set(tagId, tag);
                }
                counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
                if (force.owned) {
                    ownedCounts.set(tagId, (ownedCounts.get(tagId) ?? 0) + 1);
                }
            }
        }

        return { counts, labels, ownedCounts };
    });

    hangarDisplayCounts = computed(() => {
        const counts = new Map<string, number>([
            [HANGAR_FILTER_ALL, 0],
            [GameSystem.CLASSIC, 0],
            [GameSystem.ALPHA_STRIKE, 0],
            [HANGAR_FILTER_UNFILED, 0],
        ]);

        for (const force of this.hangarCountSourceForces()) {
            counts.set(HANGAR_FILTER_ALL, (counts.get(HANGAR_FILTER_ALL) ?? 0) + 1);

            const forceType = force.type || GameSystem.CLASSIC;
            counts.set(forceType, (counts.get(forceType) ?? 0) + 1);

            const forceTags = this.getForceTags(force);
            if (forceTags.length === 0) {
                counts.set(HANGAR_FILTER_UNFILED, (counts.get(HANGAR_FILTER_UNFILED) ?? 0) + 1);
                continue;
            }

            const seen = new Set<string>();
            for (const tag of forceTags) {
                const tagId = this.getHangarTagFilterId(tag);
                if (seen.has(tagId)) {
                    continue;
                }

                seen.add(tagId);
                counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
            }
        }

        return counts;
    });

    hangarTags = computed<HangarTagRecord[]>(() => {
        const { labels, ownedCounts } = this.hangarTagData();
        const counts = this.hangarDisplayCounts();
        return Array.from(labels.entries())
            .map(([id, label]) => ({
                id,
                label,
                count: counts.get(id) ?? 0,
                ownedCount: ownedCounts.get(id) ?? 0,
            }))
            .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    });

    activeHangarTagRecord = computed<HangarTagRecord | null>(() => {
        const filter = this.hangarTagFilter();
        if (filter === HANGAR_FILTER_ALL || filter === HANGAR_FILTER_UNFILED || this.isVirtualHangarTagFilter(filter)) {
            return null;
        }
        return this.hangarTags().find(tag => tag.id === filter) ?? null;
    });
    
    filteredForces = computed<LoadForceEntry[]>(() => {
        const tagFilter = this.hangarTagFilter();
        
        const sortKey = this.hangarSort();
        const sortDir = this.hangarSortDirection();

        const filtered = this.hangarCountSourceForces().filter(force => this.matchesHangarTagFilter(force, tagFilter));

        return this.sortItems(filtered, sortKey, sortDir);
    });
    
    // Force Packs
    packs = signal<ResolvedPack[]>([]);
    selectedPack = signal<ResolvedPack | null>(null);
    filteredPacks = computed<ResolvedPack[]>(() => {
        const tokens = this.searchText().trim().toLowerCase().split(/\s+/).filter(Boolean);
        const sortKey = this.packSort();
        const sortDir = this.packSortDirection();

        const filtered = tokens.length === 0
            ? [...this.packs()]
            : this.packs().filter(pack => {
                const hay = pack._searchText || '';
                return tokens.every(t => hay.indexOf(t) !== -1);
            });

        return this.sortItems(filtered, sortKey, sortDir);
    });

    // Operations
    operations = signal<LoadOperationEntry[]>([]);
    selectedOperation = signal<LoadOperationEntry | null>(null);
    operationsLoading = signal<boolean>(false);
    private operationsLoaded = signal<boolean>(false);
    expandedForceNotes = signal<ReadonlySet<string>>(new Set<string>());
    expandedOperationNotes = signal<ReadonlySet<string>>(new Set<string>());
    overflowingForceNotes = signal<ReadonlySet<string>>(new Set<string>());
    overflowingOperationNotes = signal<ReadonlySet<string>>(new Set<string>());
    readonly notePreviewLineCount = NOTE_PREVIEW_LINE_COUNT;

    // Organizations
    organizations = signal<LoadOrganizationEntry[]>([]);
    selectedOrganization = signal<LoadOrganizationEntry | null>(null);
    organizationsLoading = signal<boolean>(false);
    private organizationsLoaded = signal<boolean>(false);
    filteredOperations = computed<LoadOperationEntry[]>(() => {
        const tokens = this.searchText().trim().toLowerCase().split(/\s+/).filter(Boolean);
        const typeFilter = this.gameTypeFilter();
        const sortKey = this.operationSort();
        const sortDir = this.operationSortDirection();

        const filtered = this.operations().filter(op => {
            // Game type filter: check if any of the operation's game types match
            if (typeFilter !== 'all') {
                const types = op.gameTypes;
                if (types.length > 0 && !types.includes(typeFilter)) return false;
            }
            // Text search filter
            if (tokens.length === 0) return true;
            const hay = [
                op.name || '',
                op.note || '',
                ...op.forces.map(f => f.name || ''),
            ].join(' ').toLowerCase();
            return tokens.every(t => hay.indexOf(t) !== -1);
        });

        return this.sortOperations(filtered, sortKey, sortDir);
    });

    constructor() {
        // Load forces on init
        this.loadForces();

        effect(() => {
            this.ensureHangarTagFilterIsValid();
        });

        effect(() => {
            this.persistSortState(HANGAR_SORT_SESSION_KEY, HANGAR_SORT_DIRECTION_SESSION_KEY, this.hangarSort(), this.hangarSortDirection());
        });

        effect(() => {
            this.sessionPersistenceService.setItem(HANGAR_TAG_FILTER_SESSION_KEY, this.hangarTagFilter());
        });

        effect(() => {
            this.persistSortState(PACK_SORT_SESSION_KEY, PACK_SORT_DIRECTION_SESSION_KEY, this.packSort(), this.packSortDirection());
        });

        effect(() => {
            this.persistSortState(ORGANIZATION_SORT_SESSION_KEY, ORGANIZATION_SORT_DIRECTION_SESSION_KEY, this.organizationSort(), this.organizationSortDirection());
        });

        effect(() => {
            this.persistSortState(OPERATION_SORT_SESSION_KEY, OPERATION_SORT_DIRECTION_SESSION_KEY, this.operationSort(), this.operationSortDirection());
        });
        
        // Resolve force packs
        effect(() => {
            this.packs.set(resolveForcePacks(this.dataService));
        });

        // Load operations when tab changes to Operations
        effect(() => {
            if (this.activeTab() === 'Operations' && !this.operationsLoaded() && !this.operationsLoading()) {
                this.loadOperations();
            }
        });

        // Load organizations when tab changes to Organizations
        effect(() => {
            if (this.activeTab() === 'TO&E' && !this.organizationsLoaded() && !this.organizationsLoading()) {
                this.loadOrganizations();
            }
        });

        this.ensureHangarTagFilterIsValid();
        this.destroyRef.onDestroy(() => this.cleanupMenuTriggers());
    }

    private async loadForces(): Promise<void> {
        this.loading.set(true);
        try {
            const result = await this.dataService.listForces();
            const enriched = (result || []).map(f => {
                f._searchText = this.computeSearchText(f);
                return f;
            });
            this.forces.set(enriched);
            this.ensureHangarTagFilterIsValid();
        } finally {
            this.loading.set(false);
        }
    }

    private computeSearchText(force: LoadForceEntry): string {
        let s = '';
        if (force.name) s += force.name + ' ';
        if (force.note) s += force.note + ' ';
        if (force.tags?.length) s += force.tags.join(' ') + ' ';
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

    private async loadOperations(): Promise<void> {
        this.operationsLoading.set(true);
        try {
            const result = await this.dataService.listOperations();

            // Build a local force lookup from the already-loaded forces list
            const forceMap = new Map<string, LoadForceEntry>();
            for (const f of this.forces()) {
                if (f.instanceId) forceMap.set(f.instanceId, f);
            }

            // First pass: enrich all operations with local force data
            for (const op of (result || [])) {
                for (const fi of op.forces) {
                    if (!fi.name && forceMap.has(fi.instanceId)) {
                        const entry = forceMap.get(fi.instanceId)!;
                        fi.name = entry.name;
                        fi.type = entry.type;
                        fi.factionId = entry.faction?.id;
                        fi.eraId = entry.era?.id;
                        fi.bv = entry.bv;
                        fi.pv = entry.pv;
                        fi.forceTimestamp = entry.timestamp;
                        fi.exists = true;
                    }
                }
            }

            // Second pass: for local-only operations, collect force instanceIds
            // that are still missing metadata and request them from the cloud.
            const missingInstanceIds = new Set<string>();
            const localOnlyOps = (result || []).filter(op => op.local && !op.cloud);
            for (const op of localOnlyOps) {
                for (const fi of op.forces) {
                    if (!fi.name) {
                        missingInstanceIds.add(fi.instanceId);
                    }
                }
            }

            if (missingInstanceIds.size > 0) {
                const cloudInfo = await this.dataService.getForceInfoBulk(Array.from(missingInstanceIds));
                if (cloudInfo.size > 0) {
                    // Apply cloud enrichment to the still-missing forces
                    for (const op of localOnlyOps) {
                        for (const fi of op.forces) {
                            if (!fi.name && cloudInfo.has(fi.instanceId)) {
                                const info = cloudInfo.get(fi.instanceId)!;
                                fi.name = info.name;
                                fi.type = info.type;
                                fi.factionId = info.factionId;
                                fi.eraId = info.eraId;
                                fi.bv = info.bv;
                                fi.pv = info.pv;
                                fi.forceTimestamp = info.forceTimestamp;
                                fi.exists = true;
                            }
                        }
                    }
                }
            }

            this.operations.set(result || []);
        } finally {
            this.operationsLoading.set(false);
            this.operationsLoaded.set(true);
        }
    }

    selectForce(force: LoadForceEntry) {
        this.selectedPack.set(null);
        this.selectedOperation.set(null);
        this.selectedForce.set(force);
    }

    selectPack(p: ResolvedPack) {
        this.selectedForce.set(null);
        this.selectedOperation.set(null);
        this.selectedPack.set(p);
    }

    selectOperation(op: LoadOperationEntry) {
        this.selectedForce.set(null);
        this.selectedPack.set(null);
        this.selectedOrganization.set(null);
        this.selectedOperation.set(op);
    }

    hasVisibleNote(note: string | null | undefined): boolean {
        return hasVisibleNoteText(note);
    }

    isForceNoteExpandable(force: LoadForceEntry): boolean {
        return this.overflowingForceNotes().has(this.getForceNoteKey(force));
    }

    onForceNoteOverflowChange(force: LoadForceEntry, isOverflowing: boolean): void {
        const noteKey = this.getForceNoteKey(force);

        this.overflowingForceNotes.update((current) => {
            if (current.has(noteKey) === isOverflowing) {
                return current;
            }

            const next = new Set(current);
            if (isOverflowing) {
                next.add(noteKey);
            } else {
                next.delete(noteKey);
            }
            return next;
        });

        if (!isOverflowing) {
            this.expandedForceNotes.update((current) => {
                if (!current.has(noteKey)) {
                    return current;
                }

                const next = new Set(current);
                next.delete(noteKey);
                return next;
            });
        }
    }

    isForceNoteExpanded(force: LoadForceEntry): boolean {
        return this.expandedForceNotes().has(this.getForceNoteKey(force));
    }

    toggleForceNote(force: LoadForceEntry, event?: Event): void {
        event?.stopPropagation();
        const noteKey = this.getForceNoteKey(force);
        this.expandedForceNotes.update((current) => {
            const next = new Set(current);
            if (next.has(noteKey)) {
                next.delete(noteKey);
            } else {
                next.add(noteKey);
            }
            return next;
        });
    }

    isOperationNoteExpanded(op: LoadOperationEntry): boolean {
        return this.expandedOperationNotes().has(this.getOperationNoteKey(op));
    }

    isOperationNoteExpandable(op: LoadOperationEntry): boolean {
        return this.overflowingOperationNotes().has(this.getOperationNoteKey(op));
    }

    onOperationNoteOverflowChange(op: LoadOperationEntry, isOverflowing: boolean): void {
        const noteKey = this.getOperationNoteKey(op);

        this.overflowingOperationNotes.update((current) => {
            if (current.has(noteKey) === isOverflowing) {
                return current;
            }

            const next = new Set(current);
            if (isOverflowing) {
                next.add(noteKey);
            } else {
                next.delete(noteKey);
            }
            return next;
        });

        if (!isOverflowing) {
            this.expandedOperationNotes.update((current) => {
                if (!current.has(noteKey)) {
                    return current;
                }

                const next = new Set(current);
                next.delete(noteKey);
                return next;
            });
        }
    }

    toggleOperationNote(op: LoadOperationEntry, event?: Event): void {
        event?.stopPropagation();
        const noteKey = this.getOperationNoteKey(op);
        this.expandedOperationNotes.update((current) => {
            const next = new Set(current);
            if (next.has(noteKey)) {
                next.delete(noteKey);
            } else {
                next.add(noteKey);
            }
            return next;
        });
    }

    selectOrganization(org: LoadOrganizationEntry) {
        this.selectedForce.set(null);
        this.selectedPack.set(null);
        this.selectedOperation.set(null);
        this.selectedOrganization.set(org);
    }

    onSearch(text: string) {
        this.searchText.set(text);
        this.clearFilteredOutSelections();
    }

    onGameTypeFilter(type: 'all' | GameSystem.CLASSIC | GameSystem.ALPHA_STRIKE) {
        this.gameTypeFilter.set(type);
        this.clearFilteredOutSelections();
    }

    getHangarGameTypeCount(type: 'all' | GameSystem.CLASSIC | GameSystem.ALPHA_STRIKE): number {
        return this.hangarGameTypeCounts().get(type) ?? 0;
    }

    setHangarTagFilter(filter: string) {
        this.hangarTagFilter.set(filter);
        this.clearFilteredOutSelections();
    }

    toggleHangarTagFilter(filter: string) {
        this.setHangarTagFilter(this.hangarTagFilter() === filter ? HANGAR_FILTER_ALL : filter);
    }

    getHangarTagCount(filter: string): number {
        return this.hangarDisplayCounts().get(filter) ?? 0;
    }

    getForceTagNames(force: LoadForceEntry): string[] {
        return this.getForceTags(force);
    }

    getHangarEmptyStateMessage(): string {
        if (this.searchText().trim().length > 0) {
            return 'No forces match the current search.';
        }

        const activeTag = this.activeHangarTagRecord();
        if (activeTag) {
            return 'No forces with this tag yet.';
        }

        if (this.hangarTagFilter() === HANGAR_FILTER_CLASSIC) {
            return 'No BattleTech forces found.';
        }

        if (this.hangarTagFilter() === HANGAR_FILTER_ALPHA_STRIKE) {
            return 'No Alpha Strike forces found.';
        }

        if (this.hangarTagFilter() === HANGAR_FILTER_UNFILED) {
            return 'No untagged forces found.';
        }

        return 'No saved forces found.';
    }

    onHangarMenuOpen(force: LoadForceEntry, event: MouseEvent): void {
        event.stopPropagation();
        this.selectForce(force);
        this.activeHangarMenuForce.set(force);
    }

    onHangarMenuClosed(): void {
        this.activeHangarMenuForce.set(null);
    }

    activeHangarMenuForceIsEditable(): boolean {
        const force = this.activeHangarMenuForce();
        return !!force?.instanceId && !!force.owned;
    }

    activeHangarMenuHasAssignableTags(): boolean {
        const force = this.activeHangarMenuForce();
        if (!force?.instanceId || !force.owned) {
            return false;
        }

        const currentTagIds = new Set(this.getForceTags(force).map(tag => this.getHangarTagFilterId(tag)));
        return this.hangarTags().some(tag => !currentTagIds.has(tag.id));
    }

    activeHangarAssignableTags = computed(() => {
        const force = this.activeHangarMenuForce();
        if (!force?.instanceId || !force.owned) {
            return [] as HangarTagRecord[];
        }

        const currentTagIds = new Set(this.getForceTags(force).map(tag => this.getHangarTagFilterId(tag)));
        return this.hangarTags().filter(tag => !currentTagIds.has(tag.id));
    });

    activeHangarRemovableTags = computed(() => {
        const force = this.activeHangarMenuForce();
        if (!force?.instanceId) {
            return [] as HangarTagRecord[];
        }

        return this.getForceTags(force).map(tag => {
            const tagId = this.getHangarTagFilterId(tag);
            const existing = this.hangarTags().find(record => record.id === tagId);
            return existing ?? {
                id: tagId,
                label: tag,
                count: 1,
                ownedCount: force.owned ? 1 : 0,
            };
        });
    });

    async onCreateTagFromMenu(): Promise<void> {
        const force = this.activeHangarMenuForce();
        this.closeAllMenus();
        if (!force) return;

        const tag = await this.promptCreateHangarTag(force);
        if (!tag) return;

        await this.persistForceTags(force, [...this.getForceTags(force), tag]);
    }

    async onAssignActiveMenuForceToTag(tagId: string): Promise<void> {
        const force = this.activeHangarMenuForce();
        if (!force?.instanceId) return;

        const tag = this.hangarTags().find(record => record.id === tagId);
        if (!tag) return;

        await this.persistForceTags(force, [...this.getForceTags(force), tag.label]);
        this.closeAllMenus();
    }

    async onClearActiveMenuForceTag(tagId: string): Promise<void> {
        const force = this.activeHangarMenuForce();
        if (!force?.instanceId) return;

        const nextTags = this.getForceTags(force).filter(tag => this.getHangarTagFilterId(tag) !== tagId);
        await this.persistForceTags(force, nextTags);
        this.closeAllMenus();
    }

    private clearFilteredOutSelections() {
        // if selected force is filtered out, clear selection
        const selForce = this.selectedForce();
        if (selForce && !this.filteredForces().includes(selForce)) {
            this.selectedForce.set(null);
        }
        // if selected pack is filtered out, clear selection
        const selPack = this.selectedPack();
        if (selPack && !this.filteredPacks().includes(selPack)) {
            this.selectedPack.set(null);
        }
        // if selected operation is filtered out, clear selection
        const selOp = this.selectedOperation();
        if (selOp && !this.filteredOperations().includes(selOp)) {
            this.selectedOperation.set(null);
        }
        // if selected organization is filtered out, clear selection
        const selOrg = this.selectedOrganization();
        if (selOrg && !this.filteredOrganizations().includes(selOrg)) {
            this.selectedOrganization.set(null);
        }
    }

    setSortOrder(key: string) {
        switch (this.activeTab()) {
            case 'Force Packs':
                this.packSort.set(key);
                break;
            case 'TO&E':
                this.organizationSort.set(key);
                break;
            case 'Operations':
                this.operationSort.set(key);
                break;
            default:
                this.hangarSort.set(key);
                break;
        }
    }

    setSortDirection(dir: SortDirection) {
        switch (this.activeTab()) {
            case 'Force Packs':
                this.packSortDirection.set(dir);
                break;
            case 'TO&E':
                this.organizationSortDirection.set(dir);
                break;
            case 'Operations':
                this.operationSortDirection.set(dir);
                break;
            default:
                this.hangarSortDirection.set(dir);
                break;
        }
    }

    private getStoredSortKey(storageKey: string, options: readonly SortOption[], defaultKey: string): string {
        const stored = this.sessionPersistenceService.getItem(storageKey)?.trim();
        if (!stored) {
            return defaultKey;
        }
        return options.some(option => option.key === stored)
            ? stored
            : defaultKey;
    }

    private getStoredSortDirection(storageKey: string, defaultDirection: SortDirection): SortDirection {
        const stored = this.sessionPersistenceService.getItem(storageKey)?.trim();
        return stored === 'asc' || stored === 'desc'
            ? stored
            : defaultDirection;
    }

    private persistSortState(sortKeyStorage: string, sortDirectionStorage: string, sortKey: string, sortDirection: SortDirection): void {
        this.sessionPersistenceService.setItem(sortKeyStorage, sortKey);
        this.sessionPersistenceService.setItem(sortDirectionStorage, sortDirection);
    }

    /** Shared sort comparator for forces and packs */
    private sortItems<T extends { name?: string; type?: GameSystem; bv?: number; pv?: number; factionId?: number; timestamp?: string; groups?: { units?: any[] }[]; units?: any[] }>(items: T[], sortKey: string, sortDir: SortDirection): T[] {
        const dir = sortDir === 'asc' ? 1 : -1;
        return items.sort((a, b) => {
            switch (sortKey) {
                case 'name':
                    return dir * (a.name || '').localeCompare(b.name || '');
                case 'value': {
                    const aVal = this.getForceValue(a);
                    const bVal = this.getForceValue(b);
                    return dir * (aVal - bVal);
                }
                case 'faction': {
                    const aFaction = a.factionId != null ? (this.dataService.getFactionById(a.factionId)?.name ?? '') : '';
                    const bFaction = b.factionId != null ? (this.dataService.getFactionById(b.factionId)?.name ?? '') : '';
                    return dir * aFaction.localeCompare(bFaction);
                }
                case 'size': {
                    const aSize = a.groups
                        ? a.groups.reduce((sum, g) => sum + (g.units?.length || 0), 0)
                        : (a.units?.length || 0);
                    const bSize = b.groups
                        ? b.groups.reduce((sum, g) => sum + (g.units?.length || 0), 0)
                        : (b.units?.length || 0);
                    return dir * (aSize - bSize);
                }
                case 'timestamp':
                default:
                    return dir * ((a.timestamp || '').localeCompare(b.timestamp || ''));
            }
        });
    }

    private sortOperations(items: LoadOperationEntry[], sortKey: string, sortDir: SortDirection): LoadOperationEntry[] {
        const dir = sortDir === 'asc' ? 1 : -1;
        return items.sort((a, b) => {
            switch (sortKey) {
                case 'name':
                    return dir * (a.name || '').localeCompare(b.name || '');
                case 'forces':
                    return dir * (a.forces.length - b.forces.length);
                case 'timestamp':
                default:
                    return dir * (a.timestamp - b.timestamp);
            }
        });
    }

    private sortOrganizations(items: LoadOrganizationEntry[], sortKey: string, sortDir: SortDirection): LoadOrganizationEntry[] {
        const dir = sortDir === 'asc' ? 1 : -1;
        return items.sort((a, b) => {
            switch (sortKey) {
                case 'name':
                    return dir * (a.name || '').localeCompare(b.name || '');
                case 'faction': {
                    const aFaction = a.factionId != null ? (this.dataService.getFactionById(a.factionId)?.name ?? '') : '';
                    const bFaction = b.factionId != null ? (this.dataService.getFactionById(b.factionId)?.name ?? '') : '';
                    return dir * aFaction.localeCompare(bFaction);
                }
                case 'forces':
                    return dir * (a.forceCount - b.forceCount);
                case 'timestamp':
                default:
                    return dir * (a.timestamp - b.timestamp);
            }
        });
    }

    /** Pick the right point value: for hangar forces use per-entry type, for packs use current game system */
    private getForceValue(item: { type?: GameSystem; pv?: number; bv?: number }): number {
        const isAS = item.type != null
            ? item.type === GameSystem.ALPHA_STRIKE   // Hangar: each force knows its own type
            : this.gameService.isAlphaStrike();       // Packs: use current game system
        return isAS ? (item.pv ?? 0) : (item.bv ?? 0);
    }

    getGameTypeLabel(type: GameSystem | undefined): string {
        return (type || GameSystem.CLASSIC) === GameSystem.ALPHA_STRIKE ? 'AS' : 'CBT';
    }

    getGroupName(group: LoadForceGroup): string {
        if (!group.name) {
            return LanceTypeIdentifierUtil.getFormationName(group.formationId) || '';
        }
        return group.name;
    }

    getGroupFormationName(group: LoadForceGroup): string | null {
        if (!group.formationId) return null;
        if (group.formationId === NO_FORMATION_ID) return null;
        if (!group.name) return null; // We handle it in getGroupName
        const formationName = LanceTypeIdentifierUtil.getFormationName(group.formationId);
        if (formationName && group.name.includes(formationName)) {
            return null;
        }
        return formationName;
    }

    private matchesGameTypeFilter(item: { type?: GameSystem }, typeFilter: 'all' | GameSystem.CLASSIC | GameSystem.ALPHA_STRIKE): boolean {
        const itemType = item.type || GameSystem.CLASSIC;
        return typeFilter === 'all' || itemType === typeFilter;
    }

    private matchesHangarSearch(force: LoadForceEntry, tokens: readonly string[]): boolean {
        if (tokens.length === 0) {
            return true;
        }

        const tagText = this.getForceTags(force).join(' ').toLowerCase();
        const hay = `${force._searchText || ''} ${tagText}`.trim();
        return tokens.every(t => hay.indexOf(t) !== -1);
    }

    private matchesHangarTagFilter(force: LoadForceEntry, filter: string): boolean {
        const forceType = force.type || GameSystem.CLASSIC;
        const forceTags = this.getForceTags(force);

        switch (filter) {
            case HANGAR_FILTER_ALL:
                return true;
            case HANGAR_FILTER_CLASSIC:
                return forceType === GameSystem.CLASSIC;
            case HANGAR_FILTER_ALPHA_STRIKE:
                return forceType === GameSystem.ALPHA_STRIKE;
            case HANGAR_FILTER_UNFILED:
                return forceTags.length === 0;
            default:
                return forceTags.some(tag => this.getHangarTagFilterId(tag) === filter);
        }
    }

    private getForceNoteKey(force: LoadForceEntry): string {
        return force.instanceId || `${force.name || 'force'}::${force.timestamp || ''}`;
    }

    private getOperationNoteKey(op: LoadOperationEntry): string {
        return String(op.operationId || `${op.name || 'operation'}::${op.timestamp || ''}`);
    }

    private getStoredHangarTagFilter(): string {
        const stored = this.sessionPersistenceService.getItem(HANGAR_TAG_FILTER_SESSION_KEY)?.trim();
        if (!stored) {
            return HANGAR_FILTER_ALL;
        }
        if (stored === GameSystem.CLASSIC) {
            return HANGAR_FILTER_CLASSIC;
        }
        if (stored === GameSystem.ALPHA_STRIKE) {
            return HANGAR_FILTER_ALPHA_STRIKE;
        }
        return stored;
    }

    private ensureHangarTagFilterIsValid(): void {
        const activeTag = this.hangarTagFilter();
        if (activeTag === HANGAR_FILTER_ALL || this.isVirtualHangarTagFilter(activeTag)) {
            return;
        }
        if (activeTag === HANGAR_FILTER_UNFILED) {
            if (this.getHangarTagCount(HANGAR_FILTER_UNFILED) === 0) {
                this.hangarTagFilter.set(HANGAR_FILTER_ALL);
            }
            return;
        }
        if (!this.hangarTags().some(tag => tag.id === activeTag)) {
            this.hangarTagFilter.set(HANGAR_FILTER_ALL);
        }
    }

    private isVirtualHangarTagFilter(filter: string): boolean {
        return filter === HANGAR_FILTER_CLASSIC || filter === HANGAR_FILTER_ALPHA_STRIKE;
    }

    private getHangarTagFilterId(tag: string): string {
        return `${HANGAR_FILTER_TAG_PREFIX}${tag.toLocaleLowerCase()}`;
    }

    private getForceTags(force: LoadForceEntry): string[] {
        return sanitizeForceTags(force.tags ?? []);
    }

    private findExistingHangarTagLabel(tag: string): string | null {
        const tagId = this.getHangarTagFilterId(tag);
        return this.hangarTags().find(record => record.id === tagId)?.label ?? null;
    }

    private normalizeHangarTagLabel(tag: string): string {
        const normalized = sanitizeForceTags([tag])[0];
        if (!normalized) {
            throw new Error('Tag names cannot be empty.');
        }
        return this.findExistingHangarTagLabel(normalized) ?? normalized;
    }

    private async promptCreateHangarTag(force?: LoadForceEntry): Promise<string | null> {
        if (force && (!force.instanceId || !force.owned)) {
            await this.dialogsService.showError('Shared forces cannot be retagged.', 'New Tag');
            return null;
        }

        const name = await this.dialogsService.prompt(
            force
                ? `Create a new tag for "${force.name}".`
                : 'Create a new hangar tag for the selected force.',
            'New Tag',
            '',
            'Tags are saved on the force itself and can be shared across multiple forces.'
        );

        if (name == null) {
            return null;
        }

        try {
            return this.normalizeHangarTagLabel(name);
        } catch (error) {
            await this.dialogsService.showError((error as Error).message, 'New Tag');
            return null;
        }
    }

    private async persistForceTags(forceEntry: LoadForceEntry, nextTags: readonly string[]): Promise<boolean> {
        if (!forceEntry.instanceId) {
            return false;
        }

        if (!forceEntry.owned) {
            await this.dialogsService.showError('Shared forces cannot be retagged.', 'Force Tags');
            return false;
        }

        try {
            const normalizedTags = await this.dataService.updateForceTags(forceEntry.instanceId, nextTags, forceEntry.cloud);

            forceEntry.tags = normalizedTags.length > 0 ? normalizedTags : undefined;
            forceEntry._searchText = this.computeSearchText(forceEntry);

            for (const loadedForce of this.forceBuilderService.loadedForces()) {
                if (loadedForce.force.instanceId() === forceEntry.instanceId) {
                    loadedForce.force.setTags(normalizedTags, false);
                }
            }

            this.forces.set([...this.forces()]);
            this.ensureHangarTagFilterIsValid();
            this.clearFilteredOutSelections();
            return true;
        } catch (error) {
            await this.dialogsService.showError((error as Error).message, 'Force Tags');
            return false;
        }
    }

    private closeAllMenus(): void {
        const triggers = this.menuTriggers();
        if (!triggers) return;

        triggers.forEach(trigger => {
            try {
                if (trigger.isOpen()) {
                    trigger.close();
                }
            } catch {}
        });
    }

    private cleanupMenuTriggers(): void {
        const triggers = this.menuTriggers();
        if (!triggers) return;

        triggers.forEach(trigger => {
            try {
                if (trigger.isOpen()) {
                    trigger.close();
                }
                const tracker = MenuTracker as unknown as { _openMenuTrigger?: CdkMenuTrigger };
                if (tracker._openMenuTrigger === trigger) {
                    tracker._openMenuTrigger = undefined;
                }
            } catch {}
        });
    }

    async onLoad() {
        if (this.activeTab() === 'Operations') {
            await this.onLoadOperation();
            return;
        }
        if (this.activeTab() === 'TO&E') {
            this.onOpenOrganization();
            return;
        }
        // If forces are already loaded, ask the user whether to replace or append
        if (this.forceBuilderService.loadedForces().length > 0) {
            const ref = this.dialogsService.createDialog<string>(ConfirmDialogComponent, {
                disableClose: true,
                data: <ConfirmDialogData<string>>{
                    title: 'Deploy Force',
                    message: 'You already have forces deployed. Would you like to replace them or add this force alongside them?',
                    buttons: [
                        { label: 'REPLACE', value: 'replace' },
                        { label: 'ADD', value: 'add' },
                        { label: 'CANCEL', value: 'cancel' },
                    ]
                }
            });
            const answer = await firstValueFrom(ref.closed);
            if (answer === 'replace') {
                await this.closeWithMode('load', 'friendly');
            } else if (answer === 'add') {
                await this.onAdd();
            }
            return;
        }
        await this.closeWithMode('load', 'friendly');
    }

    async onAdd() {
        const currentForce = this.forceBuilderService.smartCurrentForce();
        const showInsert = !!currentForce && currentForce.owned();
        const ref = this.dialogsService.createDialog<ForceAddModePickerResult>(
            ForceAddModePickerDialogComponent,
            {
                data: {
                    showInsert,
                    currentForceName: currentForce?.name,
                } as ForceAddModePickerData
            }
        );
        const result = await firstValueFrom(ref.closed);
        if (!result) return;
        if (result === 'insert') {
            await this.closeWithMode('insert', 'friendly');
        } else {
            await this.closeWithMode('add', result);
        }
    }

    async onLoadOperation() {
        const op = this.selectedOperation();
        if (!op) return;
        this.dialogRef.close({ result: op, mode: 'operation', alignment: 'friendly' });
    }

    async onDeleteOperation() {
        const op = this.selectedOperation();
        if (!op) return;
        const confirmed = await this.dialogsService.requestConfirmation(
            'Are you sure you want to delete this operation? This action cannot be undone.',
            'Delete Operation',
            'danger'
        );
        if (confirmed) {
            await this.dataService.deleteOperation(op.operationId);
            this.operations.set(this.operations().filter(o => o !== op));
            this.selectedOperation.set(null);
        }
    }

    async onEditOperation(op: LoadOperationEntry, event: Event) {
        event.stopPropagation();

        const dialogData: OperationDialogData = {
            title: 'Edit Operation',
            name: op.name || '',
            note: op.note || '',
            forces: op.forces,
        };

        const ref = this.dialogsService.createDialog<OperationDialogResult | null>(
            SaveOperationDialogComponent,
            { data: dialogData }
        );
        const result = await firstValueFrom(ref.closed);
        if (!result) return;

        // Remove forces that no longer exist (not enriched)
        const existingForces = (result.forces || op.forces).filter(f => f.exists);

        // Reconstruct SerializedOperation with updated name/note
        const updatedOp: SerializedOperation = {
            operationId: op.operationId,
            name: result.name,
            note: result.note,
            timestamp: op.timestamp,
            forces: existingForces.map(f => {
                const originalForce = op.forces.find(of => of.instanceId === f.instanceId);
                return {
                    instanceId: f.instanceId,
                    alignment: f.alignment,
                    timestamp: originalForce?.timestamp || new Date().toISOString(),
                };
            }),
        };

        await this.dataService.saveOperation(updatedOp);

        // Update the local list reactively
        op.name = result.name;
        op.note = result.note;
        op.forces = existingForces.map(f => {
            const originalForce = op.forces.find(of => of.instanceId === f.instanceId);
            return {
                ...f,
                timestamp: originalForce?.timestamp || new Date().toISOString(),
            };
        }) as any;
        this.operations.set([...this.operations()]);
    }

    private async closeWithMode(mode: ForceLoadMode, alignment: ForceAlignment) {
        const force = this.selectedForce();
        const pack = this.selectedPack();
        
        if (force) {
            this.dialogRef.close({ result: force, mode, alignment });
            return;
        }
        
        if (pack) {
            // Loading a force pack - open customize dialog first
            const ref = this.dialogsService.createDialog<CustomizeForcePackDialogResult | null>(
                CustomizeForcePackDialogComponent,
                {
                    data: { pack } as CustomizeForcePackDialogData
                }
            );

            const result = await firstValueFrom(ref.closed);
            if (result?.units) {
                const customizedPack: ResolvedPack = {
                    ...pack,
                    units: result.units
                };
                this.dialogRef.close({ result: customizedPack, mode, alignment });
            }
            // If dismissed (null), stay on this dialog
        }
    }

    async onDelete() {
        if (this.activeTab() === 'Operations') {
            await this.onDeleteOperation();
            return;
        }
        if (this.activeTab() === 'TO&E') {
            await this.onDeleteOrganization();
            return;
        }
        const force = this.selectedForce();
        if (!force) return;
        if (!force.instanceId) return;

        const confirmed = await this.dialogsService.requestConfirmation(
            `Are you sure you want to delete "${force.name}"? This action cannot be undone.`,
            'Delete Force',
            'danger'
        );
        if (confirmed) {
            if (force.instanceId) {
                await this.dataService.deleteForce(force.instanceId);
            }
            this.forces.set(this.forces().filter(f => f !== force));
            this.ensureHangarTagFilterIsValid();
            this.selectedForce.set(null);
        }
    }

    onClose() {
        this.dialogRef.close();
    }

    // ==================== Organizations ====================

    private async loadOrganizations(): Promise<void> {
        this.organizationsLoading.set(true);
        try {
            const result = await this.dataService.listOrganizations();
            this.organizations.set(result || []);
        } finally {
            this.organizationsLoading.set(false);
            this.organizationsLoaded.set(true);
        }
    }

    filteredOrganizations = computed<LoadOrganizationEntry[]>(() => {
        const tokens = this.searchText().trim().toLowerCase().split(/\s+/).filter(Boolean);
        const sortKey = this.organizationSort();
        const sortDir = this.organizationSortDirection();

        const filtered = this.organizations().filter(org => {
            if (tokens.length === 0) return true;
            const hay = (org.name || '').toLowerCase();
            return tokens.every(t => hay.indexOf(t) !== -1);
        });

        return this.sortOrganizations(filtered, sortKey, sortDir);
    });

    async onOpenOrganization() {
        const org = this.selectedOrganization();
        if (!org) return;
        const ref = await this.forceBuilderService.showForceOrgDialog(org.organizationId);
        await this.awaitOrgDialogOrForceLoad(ref);
    }

    async onNewOrganization() {
        const ref = await this.forceBuilderService.showForceOrgDialog();
        await this.awaitOrgDialogOrForceLoad(ref);
    }

    /**
     * Waits for the org dialog to close, but also closes the load dialog
     * immediately if a force is loaded/added while the org dialog is open.
     */
    private async awaitOrgDialogOrForceLoad(ref: { closed: import('rxjs').Observable<any> }): Promise<void> {
        const reason = await firstValueFrom(
            race([
                ref.closed.pipe(map(() => 'closed' as const)),
                this.forceBuilderService.forceLoaded$.pipe(map(() => 'loaded' as const)),
            ]).pipe(takeUntilDestroyed(this.destroyRef))
        ).catch(() => null);
        // If forceLoaded$ fired, close the load dialog so the user
        // lands on the loaded forces when the org dialog is dismissed.
        if (reason === 'loaded') {
            this.dialogRef.close(null);
            return;
        }
        if (reason === 'closed') {
            await this.reloadOrganizations();
        }
    }

    async onDeleteOrganization() {
        const org = this.selectedOrganization();
        if (!org) return;
        const confirmed = await this.dialogsService.requestConfirmation(
            `Are you sure you want to delete "${org.name || 'Unnamed Organization'}"? This action cannot be undone.`,
            'Delete Organization',
            'danger'
        );
        if (confirmed) {
            await this.dataService.deleteOrganization(org.organizationId);
            this.organizations.set(this.organizations().filter(o => o !== org));
            this.selectedOrganization.set(null);
        }
    }

    private async reloadOrganizations(): Promise<void> {
        this.organizationsLoading.set(true);
        try {
            const result = await this.dataService.listOrganizations();
            const orgs = result || [];
            this.organizations.set(orgs);
            const prev = this.selectedOrganization();
            if (prev) {
                const match = orgs.find(o => o.organizationId === prev.organizationId);
                this.selectedOrganization.set(match ?? null);
            }
        } finally {
            this.organizationsLoading.set(false);
        }
    }
}