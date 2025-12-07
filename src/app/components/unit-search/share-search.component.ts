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



import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastService } from '../../services/toast.service';
import { copyTextToClipboard } from '../../utils/clipboard.util';
import { UnitSearchFiltersService } from '../../services/unit-search-filters.service';
import { GameService } from '../../services/game.service';
import { GameSystem } from '../../models/common.model';

/*
 * Author: Drake
 */

@Component({
    selector: 'share-search-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    <div class="content">
        <h2 dialog-title>Share Search Results</h2>
        <div dialog-content class="content">
            <label class="description">Share your search results with others using the link below.</label>
            <div class="row">
                <input readonly class="bt-input url" (click)="selectAndCopy($event)" [value]="shareUrl"/>
                <button class="bt-button" (click)="share(shareUrl)">SHARE</button>
            </div>
            <div class="export-section">
                <label class="description">Or export the filtered units to a file.</label>
                <div class="export-buttons">
                    <button class="bt-button export-btn" (click)="exportToCSV()" [disabled]="isExporting()">
                        @if (isExporting()) {
                            EXPORTING...
                        } @else {
                            CSV
                        }
                    </button>
                    <button class="bt-button export-btn" (click)="exportToExcel()" [disabled]="isExporting()">
                        @if (isExporting()) {
                            EXPORTING...
                        } @else {
                            EXCEL
                        }
                    </button>
                </div>
            </div>
        </div>
        <div dialog-actions>
            <button class="bt-button" (click)="close(null)">DISMISS</button>
        </div>
    </div>
    `,
    styles: [`
        .content {
            display: flex;
            flex-direction: column;
            gap: 16px;
            width: 100%;
            max-width: 1000px;
            justify-content: center;
            align-items: center;
            container-type: inline-size;
        }

        .description {
            font-size: 0.9em;
            color: var(--text-color-secondary);
        }

        h2 {
            margin-top: 8px;
            margin-bottom: 8px;
        }

        .row {
            width: 100%;
            display: flex;
            gap: 8px;
            justify-content: center;
            align-items: center;
        }

        .url {
            flex-grow: 1;
        }

        .export-section {
            display: flex;
            flex-direction: row;
            gap: 8px;
            align-items: center;
            justify-content: space-between;
            width: 100%;
        }

        .export-buttons {
            display: flex;
            gap: 8px;
        }

        .export-btn {
            min-width: 100px;
        }

        .export-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        [dialog-actions] {
            padding-top: 8px;
            display: flex;
            gap: 8px;
            justify-content: center;
            flex-wrap: wrap;
        }

        [dialog-actions] button {
            padding: 8px;
            min-width: 100px;
        }
    `]
})

export class ShareSearchDialogComponent {
    public dialogRef: DialogRef<string | number | null, ShareSearchDialogComponent> = inject(DialogRef);
    unitSearchFilters = inject(UnitSearchFiltersService);
    toastService = inject(ToastService);
    private router = inject(Router);
    private route = inject(ActivatedRoute);
    private gameService = inject(GameService);
    
    shareUrl: string = '';
    isExporting = signal(false);

    constructor() {
        this.buildUrls();
    }

    private buildUrls() {
        const origin = window.location.origin || '';
        // We get the query Parameters from the force builder
        const queryParameters = this.unitSearchFilters.queryParameters();

        const instanceTree = this.router.createUrlTree([], {
            relativeTo: this.route,
            queryParams: queryParameters
        });
        this.shareUrl = origin + this.router.serializeUrl(instanceTree);
    }

    async exportToExcel() {
        const units = this.unitSearchFilters.filteredUnits();
        if (!units || units.length === 0) {
            this.toastService.show('No units to export.', 'error');
            return;
        }

        this.isExporting.set(true);
        try {
            // Dynamically import the export utility to keep bundle size small
            const { exportUnitsToExcel } = await import('../../utils/excel-export.util');
            const gameSystem = this.gameService.currentGameSystem();
            const timestamp = new Date().toISOString().slice(0, 10);
            const systemLabel = gameSystem === GameSystem.AS ? 'alpha-strike' : 'battletech';
            const filename = `mekbay-${systemLabel}-units-${timestamp}`;
            
            await exportUnitsToExcel(units, gameSystem, filename);
            this.toastService.show(`Exported ${units.length} units to Excel.`, 'success');
        } catch (err) {
            console.error('Failed to export to Excel:', err);
            this.toastService.show('Failed to export to Excel.', 'error');
        } finally {
            this.isExporting.set(false);
        }
    }

    async exportToCSV() {
        const units = this.unitSearchFilters.filteredUnits();
        if (!units || units.length === 0) {
            this.toastService.show('No units to export.', 'error');
            return;
        }

        this.isExporting.set(true);
        try {
            // Dynamically import the export utility to keep bundle size small
            const { exportUnitsToCSV } = await import('../../utils/excel-export.util');
            const gameSystem = this.gameService.currentGameSystem();
            const timestamp = new Date().toISOString().slice(0, 10);
            const systemLabel = gameSystem === GameSystem.AS ? 'alpha-strike' : 'battletech';
            const filename = `mekbay-${systemLabel}-units-${timestamp}`;
            
            await exportUnitsToCSV(units, gameSystem, filename);
            this.toastService.show(`Exported ${units.length} units to CSV.`, 'success');
        } catch (err) {
            console.error('Failed to export to CSV:', err);
            this.toastService.show('Failed to export to CSV.', 'error');
        } finally {
            this.isExporting.set(false);
        }
    }

    async share(url: string) {
        if (navigator.share) {
            navigator.share({
                title: 'Shared MekBay Search Results',
                url: url
            }).catch(() => {
                // fallback if user cancels or error
                copyTextToClipboard(url);
                this.toastService.show('Link copied to clipboard.', 'success');
            });
        } else {
            copyTextToClipboard(url);
            this.toastService.show('Link copied to clipboard.', 'success');
        }
    }

    async selectAndCopy(event: MouseEvent) {
        const target = event.currentTarget as HTMLInputElement | null;
        if (!target) return;
        try {
            target.focus();
            target.select();
            target.setSelectionRange(0, target.value.length);
        } catch { /* ignore selection errors */ }

        if (!target.value) {
            return;
        }

        try {
            copyTextToClipboard(target.value);
            this.toastService.show('Link copied to clipboard.', 'success');
        } catch (err) {
            this.toastService.show('Failed to copy link.', 'error');
        }
    }

    close(value: null) {
        this.dialogRef.close(value);
    }
}