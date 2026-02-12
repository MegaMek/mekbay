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
import { ForceBuilderService } from '../../services/force-builder.service';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastService } from '../../services/toast.service';
import { copyTextToClipboard } from '../../utils/clipboard.util';
import { Force } from '../../models/force.model';
import { GameSystem } from '../../models/common.model';
import { buildForceQueryParams } from '../../utils/force-url.util';
import { firstValueFrom } from 'rxjs';
import { DialogsService } from '../../services/dialogs.service';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { CleanModelStringPipe } from '../force-load-dialog/force-load-dialog.component';
import { OptionsService } from '../../services/options.service';

/*
 * Author: Drake
 */

export interface ShareForceDialogData {
    force: Force;
}

@Component({
    selector: 'share-force-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [UnitIconComponent, CleanModelStringPipe],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    @let unitDisplayName = optionsService.options().unitDisplayName;
    <div class="dialog-wrapper">
        <h2 dialog-title>SHARE FORCE</h2>
        <div class="dialog-body">

        <div class="force-preview">
            <div class="force-preview-header">
                <span class="force-preview-name">{{ force.name }}</span>
                <span class="force-preview-info">
                    <span class="game-type-badge" [class.as]="force.gameSystem === GameSystem.ALPHA_STRIKE">
                        {{ force.gameSystem === GameSystem.ALPHA_STRIKE ? 'AS' : 'CBT' }}
                    </span>
                    @if (force.gameSystem === GameSystem.ALPHA_STRIKE) {
                        <span class="force-bv">PV: {{ force.totalBv() }}</span>
                    } @else {
                        <span class="force-bv">BV: {{ force.totalBv() }}</span>
                    }
                </span>
            </div>
            <div class="unit-scroll">
                @for (group of force.groups(); track group.id) {
                    <div class="unit-group">
                        <div class="group-name">{{ group.name() }}</div>
                        <div class="units">
                            @for (fu of group.units(); track fu.id) {
                                <div class="unit-square compact-mode" [class.destroyed]="fu.destroyed">
                                    <unit-icon [unit]="fu.getUnit()" [size]="32"></unit-icon>
                                    @if (unitDisplayName === 'chassisModel'
                                        || unitDisplayName === 'both'
                                        || !fu.alias()) {
                                        <div class="unit-model">{{ fu.getUnit().model | cleanModelString }}</div>
                                        <div class="unit-chassis">{{ fu.getUnit().chassis }}</div>
                                    }
                                    @if (unitDisplayName === 'alias' || unitDisplayName === 'both') {
                                        <div class="unit-alias"
                                            [class.thin]="unitDisplayName === 'both'">{{ fu.alias() }}</div>
                                    }
                                </div>
                            }
                        </div>
                    </div>
                }
            </div>
        </div>

        <div dialog-content class="share-content">
            @let shareLiveUrlString = shareLiveUrl();
            @if (shareLiveUrlString != null) {
                <label class="description"><strong>Live battle record:</strong> share the current deployment as a read-only field report — includes damage, pilots, and status conditions. <strong>Share this link for multiplayer games.</strong></label>
                <div class="row">
                    <input readonly class="bt-input url" (click)="selectAndCopy($event)" [value]="shareLiveUrlString"/>
                    <button class="bt-button" (click)="share(shareLiveUrlString)">SHARE</button>
                </div>
            }
            @let cleanUrlString = cleanUrl();
            @if (cleanUrlString != null) {
                <label class="description"><strong>Clean roster:</strong> share a pristine copy of the force — no damage, pilots, or status conditions.</label>
                <div class="row">
                    <input readonly class="bt-input url" (click)="selectAndCopy($event)" [value]="cleanUrlString"/>
                    <button class="bt-button" (click)="share(cleanUrlString)">SHARE</button>
                </div>
            }
            
            <div class="export-section">
                <label class="description">Or export the force to a file.</label>
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

        </div>
        <div dialog-actions>
            <button class="bt-button" (click)="close(null)">DISMISS</button>
        </div>
    </div>
    `,
    styles: [`
        .dialog-wrapper {
            display: flex;
            flex-direction: column;
            width: 100%;
            max-width: 1000px;
            max-height: calc(100svh - 32px);
            align-items: center;
        }

        .dialog-body {
            flex: 1 1 auto;
            overflow-y: auto;
            scrollbar-width: thin;
            display: flex;
            flex-direction: column;
            gap: 16px;
            width: 100%;
            align-items: center;
            min-height: 0;
        }

        .share-content {
            display: flex;
            flex-direction: column;
            gap: 16px;
            width: 100%;
            max-width: 1000px;
            align-items: center;
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

        .url {
            flex-grow: 1;
        }

        /* Force preview */
        .force-preview {
            width: 100%;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--border-color, #333);
            padding: 8px 12px;
            box-sizing: border-box;
        }

        .force-preview-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 6px;
        }

        .force-preview-name {
            font-weight: 600;
            font-size: 1.1em;
        }

        .force-preview-info {
            display: flex;
            gap: 8px;
            align-items: center;
            font-size: 0.85em;
            color: var(--text-color-secondary);
        }

        .game-type-badge {
            font-size: 0.8em;
            font-weight: bold;
            padding: 2px 6px;
            background: #a2792c;
            color: #fff;
            text-transform: uppercase;
            flex-shrink: 0;
            align-self: baseline;
        }

        .game-type-badge.as {
            background: #811313;
        }

        .force-bv {
            font-weight: 600;
        }

        .unit-scroll {
            display: flex;
            flex-direction: row;
            gap: 4px;
            overflow-x: auto;
            scrollbar-width: thin;
        }

        .unit-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
            border-right: 2px solid var(--border-color, #333);
            padding-right: 4px;
            justify-content: flex-end;
        }

        .unit-group:last-child {
            border-right: none;
            padding-right: 0;
        }

        .unit-group .group-name {
            font-size: 0.8em;
            color: var(--text-color-secondary);
        }

        .unit-group .units {
            display: flex;
            flex-direction: row;
            gap: 2px;
        }

        .unit-square.compact-mode {
            width: 86px;
            height: 80px;
            max-height: 105px;
            min-width: 86px;
            background: #0003;
            padding: 2px;
            display: flex;
            flex-direction: column;
            align-items: center;
            overflow: hidden;
            box-sizing: border-box;
        }

        .unit-square.compact-mode.destroyed {
            background-image: repeating-linear-gradient(
                140deg,
                #500B 0px,
                #500B 12px,
                #300A 12px,
                #300A 24px
            );
        }

        .unit-square.compact-mode.destroyed unit-icon {
            filter: grayscale(1) brightness(0.7) sepia(1) hue-rotate(-30deg) saturate(6) contrast(1.2);
        }

        .unit-square.compact-mode .unit-model {
            color: var(--text-color-secondary);
            font-size: 0.6em;
            text-align: center;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            max-width: 100%;
            display: block;
        }

        .unit-square.compact-mode .unit-alias,
        .unit-square.compact-mode .unit-chassis {
            font-size: 0.7em;
            color: var(--text-color);
            word-break: break-word;
            text-align: center;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .unit-square.compact-mode .unit-alias {
            font-weight: bold;
        }

        .unit-square.compact-mode .unit-alias.thin {
            font-size: 0.6em;
            font-weight: normal;
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

export class ShareForceDialogComponent {
    public dialogRef: DialogRef<string | number | null, ShareForceDialogComponent> = inject(DialogRef);
    private data: ShareForceDialogData = inject(DIALOG_DATA);
    forceBuilderService = inject(ForceBuilderService);
    optionsService = inject(OptionsService);
    toastService = inject(ToastService);
    readonly GameSystem = GameSystem;
    private dialogsService = inject(DialogsService);
    private router = inject(Router);
    private route = inject(ActivatedRoute);
    instanceId = signal<string | null>(null);
    shareLiveUrl = signal<string | null>(null);
    cleanUrl = signal<string | null>(null);
    force: Force;
    isExporting = signal(false);

    constructor() {
        this.force = this.data.force;
        this.buildUrls();
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
        const forceUnits = this.force.units();
        if (!forceUnits || forceUnits.length === 0) {
            this.toastService.showToast('No units to export.', 'error');
            return;
        }

        const accepted = await this.confirmDataExportLicense();
        if (!accepted) {
            return;
        }

        this.isExporting.set(true);
        try {
            const { exportForceToExcel } = await import('../../utils/excel-export.util');
            await exportForceToExcel(this.force);
            this.toastService.showToast(`Exported ${forceUnits.length} units to Excel.`, 'success');
        } catch (err) {
            console.error('Failed to export to Excel:', err);
            this.toastService.showToast('Failed to export to Excel.', 'error');
        } finally {
            this.isExporting.set(false);
        }
    }

    async exportToCSV() {
        const forceUnits = this.force.units();
        if (!forceUnits || forceUnits.length === 0) {
            this.toastService.showToast('No units to export.', 'error');
            return;
        }

        const accepted = await this.confirmDataExportLicense();
        if (!accepted) {
            return;
        }

        this.isExporting.set(true);
        try {
            const { exportForceToCSV } = await import('../../utils/excel-export.util');
            await exportForceToCSV(this.force);
            this.toastService.showToast(`Exported ${forceUnits.length} units to CSV.`, 'success');
        } catch (err) {
            console.error('Failed to export to CSV:', err);
            this.toastService.showToast('Failed to export to CSV.', 'error');
        } finally {
            this.isExporting.set(false);
        }
    }

    private buildUrls() {
        const origin = window.location.origin || '';
        // Single-force clean URL (units-based, for sharing without instance IDs)
        const singleForceParams = buildForceQueryParams(this.force);

        // Instance ID of the current force
        this.instanceId.set(this.force.instanceId() || null);

        const instanceTree = this.router.createUrlTree([], {
            relativeTo: this.route,
            queryParams: {
                instance: this.force.instanceId() || null
            }
        });
        const shareLiveUrl = this.router.serializeUrl(instanceTree);
        this.shareLiveUrl.set(shareLiveUrl.length > 1 ? origin + shareLiveUrl : null);

        const cleanTree = this.router.createUrlTree([], {
            relativeTo: this.route,
            queryParams: {
                gs: singleForceParams.gs || null,
                units: singleForceParams.units,
                name: singleForceParams.name || null
            }
        });
        const cleanUrl = this.router.serializeUrl(cleanTree);
        this.cleanUrl.set(cleanUrl.length > 1 ? origin + cleanUrl : null);
    }

    async share(url: string) {
        if (navigator.share) {
            navigator.share({
                title: this.force.name || 'Shared MekBay Force',
                url: url
            }).catch(() => {
                // fallback if user cancels or error
                copyTextToClipboard(url);
                this.toastService.showToast('Link copied to clipboard.', 'success');
            });
        } else {
            copyTextToClipboard(url);
            this.toastService.showToast('Link copied to clipboard.', 'success');
        }
    }

    shareText(text: string) {
        if (navigator.share) {
            navigator.share({
                title: this.force.name || 'MekBay Force',
                text: text
            }).catch(() => {
                copyTextToClipboard(text);
                this.toastService.showToast('Copied to clipboard.', 'success');
            });
        } else {
            copyTextToClipboard(text);
            this.toastService.showToast('Copied to clipboard.', 'success');
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