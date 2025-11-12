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
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { Pipe, PipeTransform } from "@angular/core";
import { LoadForceEntry } from '../../models/load-force-entry.model';
import { OptionsService } from '../../services/options.service';
import { FORCE_PACKS } from '../../models/forcepacks.model';
import { Unit } from '../../models/units.model';

/*
 * Author: Drake
 */

type PackUnitEntry = {
    chassis: string;
    model?: string;
    unit?: Unit | null;
};

type ResolvedPack = {
    name: string;
    units: PackUnitEntry[];
    _searchText: string;
    bv: number;
};
        
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
    imports: [CommonModule, BaseDialogComponent, CleanModelStringPipe, FormatTimestamp],
    templateUrl: './force-load-dialog.component.html',
    styleUrls: ['./force-load-dialog.component.css']
})
export class ForceLoadDialogComponent {
    dialogRef = inject(DialogRef<ForceLoadDialogComponent>);
    dataService = inject(DataService);
    optionsService = inject(OptionsService);
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
    filteredForces = computed<LoadForceEntry[]>(() => {
        const tokens = this.searchText().trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return this.forces();
        return this.forces().filter(force => {
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
            const resolved: ResolvedPack[] = FORCE_PACKS.map(p => {
                const entries: PackUnitEntry[] = p.units.map(u => {

                    // We search the unit by "name", should be a straight 1:1 match if we have no issues with the data
                    let found = this.dataService.getUnitByName(u.name);

                    if (!found) {
                        const allUnits = this.dataService.getUnits();
                        // In case we failed, find unit by matching chassis and model (model may be empty, but "" is a valid model)
                        found = allUnits.find(unit => {
                            if ((unit.chassis || '').trim().toLowerCase() !== u.chassis.toLowerCase()) return false;
                            if (u.model === undefined) {
                                return true; // no model defined, we pick the first matching chassis
                            }
                            return (unit.model === u.model);
                        });
                        // fallback: match only on chassis if exact model match not found
                        if (!found) {
                            found = allUnits.find(unit => (unit.chassis || '').trim().toLowerCase() === u.chassis.toLowerCase());
                        }
                    }

                    return { chassis: u.chassis, model: u.model, unit: found ?? null } as PackUnitEntry;
                });
                const resolved: ResolvedPack = { name: p.name, 
                        units: entries, 
                        bv: entries.reduce((sum, e) => sum + (e.unit?.bv || 0), 0),
                        _searchText: p.name.toLowerCase() + ' ' + entries.map(e => [e.chassis, e.model].filter(Boolean).join(' ')).join(' ').toLowerCase() }
                return resolved;
            });

            this.packs.set(resolved);
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

    onLoad() {
        const force = this.selectedForce() || this.selectedPack();
        if (!force) return;
        this.load.emit(force);
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