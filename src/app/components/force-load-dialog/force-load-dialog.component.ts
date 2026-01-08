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

import { Component, inject, signal, effect, ChangeDetectionStrategy, computed, output, viewChild, ElementRef, afterNextRender, Injector } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogRef } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { Pipe, PipeTransform } from "@angular/core";
import { LoadForceEntry } from '../../models/load-force-entry.model';
import { OptionsService } from '../../services/options.service';
import { GameService } from '../../services/game.service';
import { GameSystem } from '../../models/common.model';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { PackUnitEntry, ResolvedPack, resolveForcePacks } from '../../utils/force-pack.util';
import { CustomizeForcePackDialogComponent, CustomizeForcePackDialogData, CustomizeForcePackDialogResult } from '../customize-force-pack-dialog/customize-force-pack-dialog.component';

/*
 * Author: Drake
 */
        
@Pipe({
    name: 'cleanModelString',
    pure: true // Pure pipes are only called when the input changes
})
export class CleanModelStringPipe implements PipeTransform {
    transform(model: string | undefined): string {
        if (!model) return '';
        return model.replace(/\s*\(.*?\)\s*/g, '').trim();
    }
}

@Pipe({
    name: 'formatTimestamp',
    pure: true // Pure pipes are only called when the input changes
})
export class FormatTimestamp implements PipeTransform {
    transform(timestamp: string | undefined): string {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
}

@Component({
    selector: 'force-load-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, BaseDialogComponent, CleanModelStringPipe, FormatTimestamp, UnitIconComponent],
    templateUrl: './force-load-dialog.component.html',
    styleUrls: ['./force-load-dialog.component.css']
})
export class ForceLoadDialogComponent {
    dialogRef = inject(DialogRef<ForceLoadDialogComponent>);
    dataService = inject(DataService);
    optionsService = inject(OptionsService);
    gameService = inject(GameService);
    dialogsService = inject(DialogsService);
    injector = inject(Injector);
    load = output<LoadForceEntry | ResolvedPack>();
    searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

    forces = signal<LoadForceEntry[]>([]);
    selectedForce = signal<LoadForceEntry | null>(null);
    loading = signal<boolean>(true);

    tabs = ['Hangar', 'Force Packs'];
    activeTab = signal(this.tabs[0]);

    searchText = signal<string>('');
    gameTypeFilter = signal<'all' | 'cbt' | 'as'>('all');
    
    filteredForces = computed<LoadForceEntry[]>(() => {
        const tokens = this.searchText().trim().toLowerCase().split(/\s+/).filter(Boolean);
        const typeFilter = this.gameTypeFilter();
        
        return this.forces().filter(force => {
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

    constructor() {
        effect(async () => {
            this.loading.set(true);
            const result = await this.dataService.listForces();
            const enriched = (result || []).map(f => {
                f._searchText = this.computeSearchText(f);
                return f;
            });
            this.forces.set(enriched);
            this.loading.set(false);
        });
        effect(() => {
            if (!this.loading()) {
                afterNextRender(() => this.searchInput()?.nativeElement?.focus(), { injector: this.injector });
            }
        });
        effect(() => {
            this.packs.set(resolveForcePacks(this.dataService));
        });
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

    selectForce(force: LoadForceEntry) {
        this.selectedPack.set(null);
        this.selectedForce.set(force);
    }

    selectPack(p: ResolvedPack) {
        this.selectedForce.set(null);
        this.selectedPack.set(p);
    }

    onSearch(text: string) {
        this.searchText.set(text);
        this.clearFilteredOutSelections();
    }

    onGameTypeFilter(type: 'all' | 'cbt' | 'as') {
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
    }

    getGameTypeLabel(type: GameSystem | undefined): string {
        return (type || GameSystem.CLASSIC) === GameSystem.ALPHA_STRIKE ? 'AS' : 'CBT';
    }

    async onLoad() {
        const force = this.selectedForce();
        const pack = this.selectedPack();
        
        if (force) {
            // Loading a saved force - emit directly
            this.load.emit(force);
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
                // User confirmed - emit the customized pack with units
                const customizedPack: ResolvedPack = {
                    ...pack,
                    units: result.units
                };
                this.load.emit(customizedPack);
            }
            // If dismissed (null), stay on this dialog
        }
    }

    async onDelete() {
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