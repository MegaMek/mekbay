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

import { Component, inject, signal, ChangeDetectionStrategy, viewChild, ElementRef, Injector, afterNextRender, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogRef } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { DataService } from '../../services/data.service';
import { GameService } from '../../services/game.service';
import { DialogsService } from '../../services/dialogs.service';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { PackUnitEntry, ResolvedPack, resolveForcePacks } from '../../utils/force-pack.util';
import { CustomizeForcePackDialogComponent, CustomizeForcePackDialogData, CustomizeForcePackDialogResult } from '../customize-force-pack-dialog/customize-force-pack-dialog.component';

/*
 * Author: Drake
 */

/** Result type returned when dialog closes with units to add */
export type ForcePackDialogResult = PackUnitEntry[] | null;

@Component({
    selector: 'force-pack-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, BaseDialogComponent, UnitIconComponent],
    templateUrl: './force-pack-dialog.component.html',
    styleUrls: ['./force-pack-dialog.component.css']
})
export class ForcePackDialogComponent {
    dialogRef = inject(DialogRef<ForcePackDialogResult>);
    dataService = inject(DataService);
    gameService = inject(GameService);
    dialogsService = inject(DialogsService);
    injector = inject(Injector);

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
        (async () => {
            this.packs.set(resolveForcePacks(this.dataService));
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

    async onAdd() {
        const pack = this.selectedPack();
        if (!pack) return;

        // Open the customize dialog as a sub-dialog
        const ref = this.dialogsService.createDialog<CustomizeForcePackDialogResult | null>(
            CustomizeForcePackDialogComponent,
            {
                data: { pack } as CustomizeForcePackDialogData
            }
        );

        const result = await firstValueFrom(ref.closed);
        if (result?.units) {
            // User confirmed - close with the customized units
            this.dialogRef.close(result.units);
        }
        // If dismissed (null), stay on this dialog
    }

    onClose() {
        this.dialogRef.close();
    }
}