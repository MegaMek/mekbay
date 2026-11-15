// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, inject, signal, computed, effect } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ForceBuilderService } from '../../services/force-builder.service';
import { ToastService } from '../../services/toast.service';
import { copyTextToClipboard } from '../../utils/clipboard.util';
import { buildShareUrl } from '../../utils/share-url.util';
import type { Force } from '../../models/force.model';
import { buildForceQueryParams } from '../../utils/force-url.util';
import { firstValueFrom } from 'rxjs';
import { DialogsService } from '../../services/dialogs.service';
import { ForcePreviewComponent } from '../force-preview/force-preview.component';
import { GameSystem } from '../../models/common.model';
import type { CBTForce } from '../../models/cbt-force.model';
import type { ForceAlignment } from '../../models/force-slot.model';



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
                    @if (force.gameSystem === GameSystem.CLASSIC) {
                        <button class="bt-button export-btn" (click)="exportToMUL()" [disabled]="isExporting()">
                            @if (isExporting()) {
                                EXPORTING...
                            } @else {
                                MUL
                            }
                        </button>
                    }
                </div>
            </div>
            @if (force.gameSystem === GameSystem.CLASSIC) {
                <div class="export-section battle-report-section">
                    <label class="description">Or export forces in lobby for MekHQ manual resolution</label>
                    <div class="export-buttons">
                        @if (hasMultipleForces()) {
                            <div class="form-fields inline">
                                <label class="field-label">Choose Primary Force</label>
                                <select class="bt-input" [value]="oppositionForceId()" (change)="oppositionForceId.set($any($event.target).value)" [disabled]="!hasMultipleCbtForces()">
                                    @for (slot of forceBuilderService.loadedForces(); track slot.force.instanceId()) {
                                        @if (slot.force.gameSystem === GameSystem.CLASSIC) {
                                            <option [value]="slot.force.instanceId()">
                                                {{ slot.force.name }} ({{ slot.alignment }})
                                            </option>
                                        }
                                    }
                                </select>
                            </div>
                        }
                        <button class="bt-button export-btn" (click)="exportBattleReport()" [disabled]="isExporting()" title="Creates a MUL file with the opposition as salvage for manual battle resolution in MekHQ">
                            @if (isExporting()) {
                                EXPORTING...
                            } @else {
                                BATTLE REPORT
                            }
                        </button>
                    </div>
                </div>
            }
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

            @media (max-width: 600px) {
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

        .battle-report-section {
            margin-top: 16px;
            padding-top: 16px;
            border-top: 1px solid var(--border-color);
            justify-content: flex-start;
        }

        .battle-report-section .export-buttons {
            flex-wrap: wrap;
        }

        .battle-report-section .form-fields.inline {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            margin-right: 12px;
            flex-shrink: 0;
        }

        .battle-report-section .form-fields.inline .field-label {
            margin-bottom: 0;
            white-space: nowrap;
            font-size: 0.9em;
        }

        .battle-report-section .form-fields.inline .bt-input {
            min-width: 150px;
            max-width: 200px;
        }

        .battle-report-section .export-btn {
            flex-shrink: 0;
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
    public dialogRef = inject<DialogRef<string | number | null, ShareForceDialogComponent>>(DialogRef);
    private data: ShareForceDialogData = inject(DIALOG_DATA);
    forceBuilderService = inject(ForceBuilderService);
    toastService = inject(ToastService);
    private dialogsService = inject(DialogsService);
    instanceId = signal<string | null>(null);
    shareLiveUrl = signal<string | null>(null);
    cleanUrl = signal<string | null>(null);
    force: Force;
    isExporting = signal(false);
    readonly GameSystem = GameSystem;

    /** Selected force instance ID to designate as opposition (salvage). */
    oppositionForceId = signal<string | null>(null);

    /** Whether multiple forces are loaded (lobby or operation) for battle report export. */
    hasMultipleForces = computed(() => {
        const loadedForces = this.forceBuilderService.loadedForces();
        const forceInstanceId = this.force.instanceId();

        // Check if there are multiple forces loaded and this force is among them
        const isInLoadedForces = loadedForces.some(slot => {
            const slotInstanceId = slot.force.instanceId();
            return slotInstanceId === forceInstanceId;
        });

        return loadedForces.length > 1 && isInLoadedForces;
    });

    /** Whether there are multiple CBT forces loaded for dropdown selection. */
    hasMultipleCbtForces = computed(() => {
        const loadedForces = this.forceBuilderService.loadedForces();
        const cbtForces = loadedForces.filter(slot => slot.force.gameSystem === GameSystem.CLASSIC);
        return cbtForces.length > 1;
    });

    constructor() {
        this.force = this.data.force;
        this.buildUrls();

        // Initialize primary force selection immediately
        const loadedForces = this.forceBuilderService.loadedForces();
        const friendlyForce = loadedForces.find(slot => slot.alignment === 'friendly' && slot.force.gameSystem === GameSystem.CLASSIC);
        if (friendlyForce && loadedForces.length > 1) {
            this.oppositionForceId.set(friendlyForce.force.instanceId());
        }
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

    async exportToMUL() {
        const forceUnits = this.force.units();
        if (this.force.gameSystem !== GameSystem.CLASSIC) {
            return;
        }
        if (!forceUnits || forceUnits.length === 0) {
            this.toastService.showToast('No units to export.', 'error');
            return;
        }

        this.isExporting.set(true);
        try {
            const { exportForceToMul } = await import('../../utils/mul-file.util');
            await exportForceToMul(this.force as CBTForce);
            this.toastService.showToast(`Exported ${forceUnits.length} units to MUL.`, 'success');
        } catch (err) {
            console.error('Failed to export to MUL:', err);
            this.toastService.showToast('Failed to export to MUL.', 'error');
        } finally {
            this.isExporting.set(false);
        }
    }

    async exportBattleReport() {
        const loadedForces = this.forceBuilderService.loadedForces();
        const cbtForces = loadedForces.filter(slot => slot.force.gameSystem === GameSystem.CLASSIC);

        if (cbtForces.length === 0) {
            this.toastService.showToast('No Classic BattleTech forces loaded.', 'error');
            return;
        }

        const totalUnits = cbtForces.reduce((sum, slot) => sum + (slot.force.units()?.length || 0), 0);
        if (totalUnits === 0) {
            this.toastService.showToast('No units to export.', 'error');
            return;
        }

        this.isExporting.set(true);
        try {
            const { exportOperationToMul } = await import('../../utils/mul-file.util');
            const primaryForceId = this.oppositionForceId();
            const forcesForMul = cbtForces.map(slot => ({
                force: slot.force as CBTForce,
                alignment: slot.alignment,
                // Inverted logic: selected force is primary (survivors), others are opposition (salvage)
                // If no primary selected (single force), all go to survivors
                isOpposition: primaryForceId ? slot.force.instanceId() !== primaryForceId : false
            }));
            // Use a generic name since we're in a lobby, not a named operation
            const reportName = 'Battle Report';
            await exportOperationToMul(forcesForMul, reportName);
            this.toastService.showToast(`Exported battle report with ${totalUnits} units to MUL.`, 'success');
        } catch (err) {
            console.error('Failed to export battle report:', err);
            this.toastService.showToast('Failed to export battle report.', 'error');
        } finally {
            this.isExporting.set(false);
        }
    }

    private buildUrls() {
        const origin = window.location.origin || '';
        // Single-force clean URL (units-based, for sharing without instance IDs)
        const singleForceParams = buildForceQueryParams(this.force);

        // Instance ID of the current force
        const instanceId = this.force.instanceId() || null;
        this.instanceId.set(instanceId);

        this.shareLiveUrl.set(instanceId
            ? buildShareUrl(origin, { instance: instanceId })
            : null);

        this.cleanUrl.set(singleForceParams.units
            ? buildShareUrl(origin, {
                gs: singleForceParams.gs,
                units: singleForceParams.units,
                name: singleForceParams.name,
                factionId: singleForceParams.factionId,
            })
            : null);
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
