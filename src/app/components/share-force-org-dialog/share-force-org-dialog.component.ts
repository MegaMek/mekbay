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
    imports: [],
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
    public dialogRef: DialogRef<string | number | null, ShareForceOrgDialogComponent> = inject(DialogRef);
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