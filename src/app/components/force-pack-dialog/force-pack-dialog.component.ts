// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, inject, signal, ChangeDetectionStrategy, viewChild, type ElementRef, type afterNextRender, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogRef } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { DataService } from '../../services/data.service';
import { GameService } from '../../services/game.service';
import { DialogsService } from '../../services/dialogs.service';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { type PackUnitEntry, type ResolvedPack, resolveForcePacks } from '../../utils/force-pack.util';
import { CustomizeForcePackDialogComponent, type CustomizeForcePackDialogData, type CustomizeForcePackDialogResult } from '../customize-force-pack-dialog/customize-force-pack-dialog.component';

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
    private dialogRef = inject(DialogRef<ForcePackDialogResult>);
    private dataService = inject(DataService);
    gameService = inject(GameService);
    private dialogsService = inject(DialogsService);

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
        this.packs.set(resolveForcePacks(this.dataService));
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