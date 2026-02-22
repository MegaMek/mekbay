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

import { Component, inject, signal, effect, ChangeDetectionStrategy, computed, viewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { Pipe, PipeTransform } from "@angular/core";
import { LoadForceEntry, LoadForceGroup } from '../../models/load-force-entry.model';
import { LoadOperationEntry } from '../../models/operation.model';
import { SerializedOperation } from '../../models/operation.model';
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
    forceBuilderService = inject(ForceBuilderService);
    optionsService = inject(OptionsService);
    gameService = inject(GameService);
    private dialogsService = inject(DialogsService);
    searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

    readonly GameSystem = GameSystem;

    readonly SORT_OPTIONS: { key: string; label: string }[] = [
        { key: 'timestamp', label: 'Date' },
        { key: 'name', label: 'Name' },
        { key: 'value', label: 'Value' },
    ];
    selectedSort = signal<string>('timestamp');
    selectedSortDirection = signal<'asc' | 'desc'>('desc');

    forces = signal<LoadForceEntry[]>([]);
    selectedForce = signal<LoadForceEntry | null>(null);
    loading = signal<boolean>(true);

    tabs = ['Hangar', 'Force Packs', 'Operations'];
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
        
        const sortKey = this.selectedSort();
        const sortDir = this.selectedSortDirection();

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

        const dir = sortDir === 'asc' ? 1 : -1;
        return filtered.sort((a, b) => {
            switch (sortKey) {
                case 'name':
                    return dir * (a.name || '').localeCompare(b.name || '');
                case 'value': {
                    const aVal = a.pv || a.bv || 0;
                    const bVal = b.pv || b.bv || 0;
                    return dir * (aVal - bVal);
                }
                case 'timestamp':
                default:
                    return dir * ((a.timestamp || '').localeCompare(b.timestamp || ''));
            }
        });
    });
    
    // Force Packs
    packs = signal<ResolvedPack[]>([]);
    selectedPack = signal<ResolvedPack | null>(null);
    filteredPacks = computed<ResolvedPack[]>(() => {
        const tokens = this.searchText().trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return this.packs();
        return this.packs().filter(pack => {
            const hay = pack._searchText || '';
            return tokens.every(t => hay.indexOf(t) !== -1);
        });
    });

    // Operations
    operations = signal<LoadOperationEntry[]>([]);
    selectedOperation = signal<LoadOperationEntry | null>(null);
    operationsLoading = signal<boolean>(false);
    private operationsLoaded = signal<boolean>(false);
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
        this.selectedOperation.set(op);
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
        this.selectedSort.set(key);
    }

    setSortDirection(dir: 'asc' | 'desc') {
        this.selectedSortDirection.set(dir);
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
}