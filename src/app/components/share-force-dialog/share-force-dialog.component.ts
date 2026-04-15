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
import type { Force } from '../../models/force.model';
import { buildForceQueryParams } from '../../utils/force-url.util';
import { firstValueFrom } from 'rxjs';
import { DialogsService } from '../../services/dialogs.service';
import { ForcePreviewComponent } from '../force-preview/force-preview.component';
import { RestrictionListsService } from '../../services/restriction-lists.service';

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
    imports: [ForcePreviewComponent],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    <div class="wide-dialog">
        <h2 class="wide-dialog-title">SHARE FORCE</h2>
        <div class="wide-dialog-body">

        <force-preview [force]="force"></force-preview>

        <div class="share-content">
            @let shareLiveUrlString = shareLiveUrl();
            @if (shareLiveUrlString != null) {
                <div class="form-fields">
                    <label class="field-label">Live battle record</label>
                    <div class="row">
                        <input readonly class="bt-input url" (click)="selectAndCopy($event)" [value]="shareLiveUrlString"/>
                        <button class="bt-button qr-btn" (click)="showLiveBattleRecordQr(shareLiveUrlString)" title="Show Live Battle Record QR" aria-label="Show Live Battle Record QR">
                            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                <path d="M3,11H5v2H3V11m8-6h2V9H11V5M9,11h4v4H11V13H9V11m6,0h2v2h2V11h2v2H19v2h2v4H19v2H17V19H13v2H11V17h4V15h2V13H15V11m4,8V15H17v4h2M15,3h6V9H15V3m2,2V7h2V5H17M3,3H9V9H3V3M5,5V7H7V5H5M3,15H9v6H3V15m2,2v2H7V17Z"/>
                                <rect width="24" height="24" fill="none"/>
                            </svg>
                        </button>
                        <button class="bt-button" (click)="share(shareLiveUrlString)">SHARE</button>
                    </div>
                    <div class="field-note">Share the current deployment as a read-only field report — includes damage, pilots, and status conditions. <strong>Share this link for multiplayer games.</strong></div>
                </div>
            }
            @let cleanUrlString = cleanUrl();
            @if (cleanUrlString != null) {
                <div class="form-fields">
                    <label class="field-label">Clean roster</label>
                    <div class="row">
                        <input readonly class="bt-input url" (click)="selectAndCopy($event)" [value]="cleanUrlString"/>
                        <button class="bt-button" (click)="share(cleanUrlString)">SHARE</button>
                    </div>
                    <div class="field-note">Share a pristine copy of the force — no damage, pilots, or status conditions.</div>
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
        <div class="wide-dialog-actions">
            <button class="bt-button" (click)="close(null)">DISMISS</button>
        </div>
    </div>
    `,
    styles: [`
        .share-content {
            display: flex;
            flex-direction: column;
            gap: 16px;
            width: 100%;
            max-width: 1000px;
            align-items: center;
        }

        .form-fields {
            width: 100%;
        }

        .description {
            font-size: 0.9em;
            color: var(--text-color-secondary);
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

        .qr-btn svg {
            width: 22px;
            height: 22px;
            fill: currentColor;
        }

        .url {
            flex-grow: 1;
        }

        force-preview {
            width: 100%;
        }
    `]
})

export class ShareForceDialogComponent {
    public dialogRef: DialogRef<string | number | null, ShareForceDialogComponent> = inject(DialogRef);
    private data: ShareForceDialogData = inject(DIALOG_DATA);
    forceBuilderService = inject(ForceBuilderService);
    toastService = inject(ToastService);
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
    private restrictionListsService = inject(RestrictionListsService);

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
                instance: this.force.instanceId() || null,
                rl: this.restrictionListsService.restrictionListsParam(),
            }
        });
        const shareLiveUrl = this.router.serializeUrl(instanceTree);
        this.shareLiveUrl.set(shareLiveUrl.length > 1 ? origin + shareLiveUrl : null);

        const cleanTree = this.router.createUrlTree([], {
            relativeTo: this.route,
            queryParams: {
                gs: singleForceParams.gs || null,
                units: singleForceParams.units,
                name: singleForceParams.name || null,
                factionId: singleForceParams.factionId || null,
                rl: this.restrictionListsService.restrictionListsParam(),
            }
        });
        const cleanUrl = this.router.serializeUrl(cleanTree);
        this.cleanUrl.set(cleanUrl.length > 1 ? origin + cleanUrl : null);
    }

    async share(url: string) {
        const shareTitle = this.force.name || 'Shared MekBay Force';

        if (navigator.share) {
            navigator.share({
                title: shareTitle,
                url: url
            }).catch(() => {
                // fallback if user cancels or error
                copyTextToClipboard(url);
                this.toastService.showToast('Links copied to clipboard.', 'success');
            });
        } else {
            copyTextToClipboard(url);
            this.toastService.showToast('Links copied to clipboard.', 'success');
        }
    }

    async showLiveBattleRecordQr(url: string): Promise<void> {
        const { QrDialogComponent } = await import('../qr-dialog/qr-dialog.component');
        this.dialogsService.createDialog<void>(QrDialogComponent, {
            data: { url },
            disableClose: false,
        });
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