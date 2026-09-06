// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { OptionsService } from '../../services/options.service';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import { ToastService } from '../../services/toast.service';
import { copyTextToClipboard, shareUrlWithClipboardFallback } from '../../utils/clipboard.util';
import { buildShareUrl } from '../../utils/share-url.util';
import { UnitSearchFiltersService } from '../../services/unit-search-filters.service';
import { GameService } from '../../services/game.service';
import { GameSystem } from '../../models/common.model';
import { DialogsService } from '../../services/dialogs.service';



@Component({
    selector: 'share-search-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
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

            @media (max-width: 380px) {
                flex-direction: column;
            }
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
    private readonly optionsService = inject(OptionsService);
    public dialogRef = inject<DialogRef<string | number | null, ShareSearchDialogComponent>>(DialogRef);
    unitSearchFilters = inject(UnitSearchFiltersService);
    toastService = inject(ToastService);
    private dialogsService = inject(DialogsService);
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
        queryParameters.gs = this.gameService.currentGameSystem(); // Ensure game system is included in shared URL

        this.shareUrl = buildShareUrl(origin, queryParameters);
    }

    private async confirmDataExportLicense(): Promise<boolean> {
        const { DataExportLicenseDialogComponent } = await import('../data-export-license-dialog/data-export-license-dialog.component');
        const ref = this.dialogsService.createDialog<boolean>(DataExportLicenseDialogComponent, {
            disableClose: true
        });
        const accepted = await firstValueFrom(ref.closed);
        return accepted === true;
    }

    async exportToExcel() {
        const units = this.unitSearchFilters.filteredUnits();
        if (!units || units.length === 0) {
            this.toastService.showToast('No units to export.', 'error');
            return;
        }

        const accepted = await this.confirmDataExportLicense();
        if (!accepted) {
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
            
            await exportUnitsToExcel(units, gameSystem, filename, this.optionsService.options().displayUnitNameFormat);
            this.toastService.showToast(`Exported ${units.length} units to Excel.`, 'success');
        } catch (err) {
            console.error('Failed to export to Excel:', err);
            this.toastService.showToast('Failed to export to Excel.', 'error');
        } finally {
            this.isExporting.set(false);
        }
    }

    async exportToCSV() {
        const units = this.unitSearchFilters.filteredUnits();
        if (!units || units.length === 0) {
            this.toastService.showToast('No units to export.', 'error');
            return;
        }

        const accepted = await this.confirmDataExportLicense();
        if (!accepted) {
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
            
            await exportUnitsToCSV(units, gameSystem, filename, this.optionsService.options().displayUnitNameFormat);
            this.toastService.showToast(`Exported ${units.length} units to CSV.`, 'success');
        } catch (err) {
            console.error('Failed to export to CSV:', err);
            this.toastService.showToast('Failed to export to CSV.', 'error');
        } finally {
            this.isExporting.set(false);
        }
    }

    async share(url: string) {
        const shareTitle = 'Shared MekBay Search Results';

        const result = await shareUrlWithClipboardFallback({ title: shareTitle, url });
        if (result === 'copied') {
            this.toastService.showToast('Links copied to clipboard.', 'success');
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
            this.toastService.showToast('Link copied to clipboard.', 'success');
        } catch (err) {
            this.toastService.showToast('Failed to copy link.', 'error');
        }
    }

    close(value: null) {
        this.dialogRef.close(value);
    }
}
