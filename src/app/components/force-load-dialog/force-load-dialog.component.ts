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

import { Component, inject, signal, effect, ChangeDetectionStrategy, computed, viewChild, ElementRef, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { firstValueFrom, map, race } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { Pipe, PipeTransform } from "@angular/core";
import { LoadForceEntry, LoadForceGroup } from '../../models/load-force-entry.model';
import { LoadOperationEntry } from '../../models/operation.model';
import { SerializedOperation } from '../../models/operation.model';
import { LoadOrganizationEntry } from '../../models/organization.model';
import { SaveOperationDialogComponent, OperationDialogData, OperationDialogResult } from '../save-operation-dialog/save-operation-dialog.component';
import { OpPreviewComponent } from '../op-preview/op-preview.component';
import { OptionsService } from '../../services/options.service';
import { GameService } from '../../services/game.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { GameSystem } from '../../models/common.model';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { ResolvedPack, resolveForcePacks } from '../../utils/force-pack.util';
import { CustomizeForcePackDialogComponent, CustomizeForcePackDialogData, CustomizeForcePackDialogResult } from '../customize-force-pack-dialog/customize-force-pack-dialog.component';
import { ForceAlignment } from '../../models/force-slot.model';
import { ForceAddModePickerDialogComponent, ForceAddModePickerData, ForceAddModePickerResult } from '../force-add-mode-picker-dialog/force-add-mode-picker-dialog.component';
import { FactionImgPipe } from '../../pipes/faction-img.pipe';
import { CleanModelStringPipe } from '../../pipes/clean-model-string.pipe';
import { LanceTypeIdentifierUtil } from '../../utils/lance-type-identifier.util';
import { NO_FORMATION_ID } from '../../utils/formation-type.model';

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

@Component({
    selector: 'force-load-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, BaseDialogComponent, CleanModelStringPipe, FormatTimestamp, UnitIconComponent, OpPreviewComponent, FactionImgPipe],
    templateUrl: './force-load-dialog.component.html',
    styleUrls: ['./force-load-dialog.component.css']
})
export class ForceLoadDialogComponent {
    private dialogRef = inject(DialogRef<ForceLoadDialogResult>);
    private dialogData: ForceLoadDialogData | null = inject(DIALOG_DATA, { optional: true });
    private dataService = inject(DataService);
    private destroyRef = inject(DestroyRef);
    forceBuilderService = inject(ForceBuilderService);
    optionsService = inject(OptionsService);
    gameService = inject(GameService);
    private dialogsService = inject(DialogsService);
    searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

    readonly GameSystem = GameSystem;

    readonly HANGAR_SORT_OPTIONS: { key: string; label: string }[] = [
        { key: 'timestamp', label: 'Date' },
        { key: 'name', label: 'Name' },
        { key: 'value', label: 'Value' },
        { key: 'faction', label: 'Faction' },
        { key: 'size', label: 'Size' },
    ];
    readonly PACK_SORT_OPTIONS: { key: string; label: string }[] = [
        { key: 'name', label: 'Name' },
        { key: 'value', label: 'Value' },
        { key: 'size', label: 'Size' },
    ];

    hangarSort = signal<string>('timestamp');
    hangarSortDirection = signal<'asc' | 'desc'>('desc');
    packSort = signal<string>('name');
    packSortDirection = signal<'asc' | 'desc'>('asc');

    /** Active sort options/state based on the current tab */
    activeSortOptions = computed(() =>
        this.activeTab() === 'Force Packs' ? this.PACK_SORT_OPTIONS : this.HANGAR_SORT_OPTIONS
    );
    activeSort = computed(() =>
        this.activeTab() === 'Force Packs' ? this.packSort() : this.hangarSort()
    );
    activeSortDirection = computed(() =>
        this.activeTab() === 'Force Packs' ? this.packSortDirection() : this.hangarSortDirection()
    );

    forces = signal<LoadForceEntry[]>([]);
    selectedForce = signal<LoadForceEntry | null>(null);
    loading = signal<boolean>(true);

    tabs = ['Hangar', 'Force Packs', 'Operations', 'TO&E'];
    activeTab = signal(this.dialogData?.initialTab ?? this.tabs[0]);

    searchText = signal<string>('');

    /** Check if the currently selected force is already loaded */
    isSelectedForceLoaded = computed<boolean>(() => {
        const sel = this.selectedForce();
        if (!sel?.instanceId) return false;
        return this.forceBuilderService.loadedForces().some(s => s.force.instanceId() === sel.instanceId);
    });
    gameTypeFilter = signal<'all' | GameSystem.CLASSIC | GameSystem.ALPHA_STRIKE>('all');
    
    filteredForces = computed<LoadForceEntry[]>(() => {
        const tokens = this.searchText().trim().toLowerCase().split(/\s+/).filter(Boolean);
        const typeFilter = this.gameTypeFilter();
        
        const sortKey = this.hangarSort();
        const sortDir = this.hangarSortDirection();

        const filtered = this.forces().filter(force => {
            // Game type filter (forces with no type are considered CBT)
            const forceType = force.type || GameSystem.CLASSIC;
            if (typeFilter !== 'all' && forceType !== typeFilter) {
                return false;
            }
            // Text search filter
            if (tokens.length === 0) return true;
            const hay = force._searchText || '';
            return tokens.every(t => hay.indexOf(t) !== -1);
        });

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

    // Organizations
    organizations = signal<LoadOrganizationEntry[]>([]);
    selectedOrganization = signal<LoadOrganizationEntry | null>(null);
    organizationsLoading = signal<boolean>(false);
    private organizationsLoaded = signal<boolean>(false);
    filteredOperations = computed<LoadOperationEntry[]>(() => {
        const tokens = this.searchText().trim().toLowerCase().split(/\s+/).filter(Boolean);
        const typeFilter = this.gameTypeFilter();
        return this.operations().filter(op => {
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
    });

    constructor() {
        // Load forces on init
        this.loadForces();
        
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
        } finally {
            this.loading.set(false);
        }
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
                        fi.factionId = entry.factionId;
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
    }

    setSortOrder(key: string) {
        if (this.activeTab() === 'Force Packs') {
            this.packSort.set(key);
        } else {
            this.hangarSort.set(key);
        }
    }

    setSortDirection(dir: 'asc' | 'desc') {
        if (this.activeTab() === 'Force Packs') {
            this.packSortDirection.set(dir);
        } else {
            this.hangarSortDirection.set(dir);
        }
    }

    /** Shared sort comparator for forces and packs */
    private sortItems<T extends { name?: string; type?: GameSystem; bv?: number; pv?: number; factionId?: number; timestamp?: string; groups?: { units?: any[] }[]; units?: any[] }>(items: T[], sortKey: string, sortDir: 'asc' | 'desc'): T[] {
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

    async onLoad() {
        if (this.activeTab() === 'Operations') {
            await this.onLoadOperation();
            return;
        }
        if (this.activeTab() === 'TO&E') {
            this.onOpenOrganization();
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
        return this.organizations().filter(org => {
            if (tokens.length === 0) return true;
            const hay = (org.name || '').toLowerCase();
            return tokens.every(t => hay.indexOf(t) !== -1);
        });
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
            this.organizations.set(result || []);
            this.selectedOrganization.set(null);
        } finally {
            this.organizationsLoading.set(false);
        }
    }
}