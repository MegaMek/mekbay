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


import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, ElementRef, inject, viewChild } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ForceBuilderService } from '../../services/force-builder.service';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastService } from '../../services/toast.service';
import { copyTextToClipboard } from '../../utils/clipboard.util';

/*
 * Author: Drake
 */

@Component({
    selector: 'share-force-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    template: `
    <div class="content">
        <h2 dialog-title>{{ forceBuilderService.force.name }}</h2>
        <div dialog-content class="content">
            <label class="description">Live battle record: share the current deployment as a read-only field report — includes damage, pilots, and status conditions.</label>
            <div class="row">
                <input readonly class="bt-input url" (click)="selectAndCopy($event)" [value]="shareUrl"/>
                <button class="bt-button" (click)="share(shareUrl)">SHARE</button>
            </div>

            <label class="description">Clean roster: share a pristine copy of the force — no damage, pilots, or status conditions.</label>
            <div class="row">
                <input readonly class="bt-input url" (click)="selectAndCopy($event)" [value]="cleanUrl"/>
                <button class="bt-button" (click)="share(cleanUrl)">SHARE</button>
            </div>
        </div>
        <div dialog-actions>
            <button class="bt-button" (click)="close(null)">DISMISS</button>
        </div>
    </div>
    `,
    styles: [`
        :host {
            display: flex;
            justify-content: center;
            box-sizing: border-box;
            background-color: rgba(45, 45, 45, 0.8);
            backdrop-filter: blur(5px);
            width: 100vw;
            pointer-events: auto;
            padding: 16px;
        }

        :host-context(.cdk-overlay-pane) {
            transform: translateY(-10vh);
        }

        .content {
            display: flex;
            flex-direction: column;
            gap: 16px;
            width: 100%;
            max-width: 1000px;
            justify-content: center;
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

export class ShareForceDialogComponent {
    inputRef = viewChild.required<ElementRef<HTMLInputElement>>('inputRef');
    public dialogRef: DialogRef<string | number | null, ShareForceDialogComponent> = inject(DialogRef);
    forceBuilderService = inject(ForceBuilderService);
    toastService = inject(ToastService);
    private router = inject(Router);
    private route = inject(ActivatedRoute);
    instanceId: string = '';
    shareUrl: string = '';
    cleanUrl: string = '';

    constructor() {
        this.buildUrls();
    }


    private buildUrls() {
        const origin = window.location.origin || '';
        // We get the query Parameters from the force builder
        const queryParameters = this.forceBuilderService.queryParameters();

        this.instanceId = queryParameters.instance || '';

        const instanceTree = this.router.createUrlTree([], {
            relativeTo: this.route,
            queryParams: {
                units: queryParameters.units,
                instance: queryParameters.instance || null,
                name: queryParameters.name || null
            }
        });
        this.shareUrl = origin + this.router.serializeUrl(instanceTree);

        const cleanTree = this.router.createUrlTree([], {
            relativeTo: this.route,
            queryParams: {
                units: queryParameters.units,
                name: queryParameters.name || null
            }
        });
        this.cleanUrl = origin + this.router.serializeUrl(cleanTree);
    }

    async share(url: string) {
        if (navigator.share) {
            navigator.share({
                title: this.forceBuilderService.force.name || 'Shared MekBay Force',
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