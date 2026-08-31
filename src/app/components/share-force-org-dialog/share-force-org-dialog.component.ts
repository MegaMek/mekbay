// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ToastService } from '../../services/toast.service';
import { copyTextToClipboard } from '../../utils/clipboard.util';

export interface ShareForceOrgDialogData {
    shareUrl: string;
    organizationName: string;
}

@Component({
    selector: 'share-force-org-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    <div class="content">
        <h2 dialog-title>Share TO&amp;E</h2>
        <div dialog-content class="content">
            <label class="description">Share {{ data.organizationName || 'this organization' }} with others using the link below.</label>
            <div class="row">
                <input readonly class="bt-input url" (click)="selectAndCopy($event)" [value]="data.shareUrl"/>
                <button class="bt-button" (click)="share(data.shareUrl)">SHARE</button>
            </div>
        </div>
        <div dialog-actions>
            <button class="bt-button" (click)="close()">DISMISS</button>
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
export class ShareForceOrgDialogComponent {
    public dialogRef = inject(DialogRef) as DialogRef<string | number | null, ShareForceOrgDialogComponent>;
    readonly data: ShareForceOrgDialogData = inject(DIALOG_DATA) as ShareForceOrgDialogData;
    private toastService = inject(ToastService);

    async share(url: string): Promise<void> {
        const shareTitle = this.data.organizationName
            ? `Shared MekBay TO&E: ${this.data.organizationName}`
            : 'Shared MekBay TO&E';

        if (navigator.share) {
            navigator.share({
                title: shareTitle,
                url,
            }).catch(async () => {
                await this.copyUrl(url, 'Links copied to clipboard.');
            });
            return;
        }

        await this.copyUrl(url, 'Links copied to clipboard.');
    }

    async selectAndCopy(event: MouseEvent): Promise<void> {
        const target = event.currentTarget as HTMLInputElement | null;
        if (!target) return;
        try {
            target.focus();
            target.select();
            target.setSelectionRange(0, target.value.length);
        } catch {
            // Ignore selection errors.
        }

        if (!target.value) {
            return;
        }

        await this.copyUrl(target.value, 'Link copied to clipboard.');
    }

    close(): void {
        this.dialogRef.close(null);
    }

    private async copyUrl(url: string, successMessage: string): Promise<void> {
        try {
            await copyTextToClipboard(url);
            this.toastService.showToast(successMessage, 'success');
        } catch {
            this.toastService.showToast('Failed to copy link.', 'error');
        }
    }
}
