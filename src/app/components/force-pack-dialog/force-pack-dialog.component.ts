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

import { Component, inject, signal, ChangeDetectionStrategy, output, viewChild, ElementRef, Injector, afterNextRender, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogRef } from '@angular/cdk/dialog';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { DataService } from '../../services/data.service';
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


@Component({
    selector: 'force-pack-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, BaseDialogComponent],
    templateUrl: './force-pack-dialog.component.html',
    styleUrls: ['./force-pack-dialog.component.css']
})
export class ForcePackDialogComponent {
    dialogRef = inject(DialogRef<unknown>);
    dataService = inject(DataService);
    injector = inject(Injector);

    add = output<ResolvedPack | null>();

    packs = signal<ResolvedPack[]>([]);
    selectedPack = signal<ResolvedPack | null>(null);

    searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
    searchText = signal<string>('');

    
    filteredPacks = computed<ResolvedPack[]>(() => {
        const tokens = this.searchText().trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return this.packs();
        return this.packs().filter(pack => {
            const hay = pack._searchText || '';
            return tokens.every(t => hay.indexOf(t) !== -1);
        });
    });

    constructor() {
        // Resolve pack units against the available units from dataService
        (async () => {
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
                        _searchText: entries.map(e => p.name + ' ' + [e.chassis, e.model].filter(Boolean).join(' ')).join(' ').toLowerCase() }
                return resolved;
            });

            this.packs.set(resolved);

            // focus search if present
            afterNextRender(() => this.searchInput()?.nativeElement?.focus(), { injector: this.injector });
        })();
    }

    onSearchForcePack(text: string) {
        this.searchText.set(text);
        // if selected force is filtered out, clear selection
        const sel = this.selectedPack();
        if (sel && !this.filteredPacks().includes(sel)) {
            this.selectedPack.set(null);
        }
    }

    selectPack(p: ResolvedPack) {
        this.selectedPack.set(p);
    }

    onAdd() {
        const p = this.selectedPack();
        this.add.emit(p ?? null);
    }

    onClose() {
        this.dialogRef.close();
    }
}