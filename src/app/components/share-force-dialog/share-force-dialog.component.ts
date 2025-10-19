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
import html2canvas from 'html2canvas';

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
            <label class="description">Live battle record: share the current deployment as a read‑only field report — includes damage, heat, and status effects.</label>
            <div class="row">
                <input readonly class="bt-input url" (click)="selectAndCopy($event)" [value]="shareUrl"/>
                <button class="bt-button" (click)="share(shareUrl)">SHARE</button>
            </div>

            <label class="description">Clean roster: share a pristine copy of the force — no damage, heat, pilot wounds, or status conditions.</label>
            <div class="row">
                <input readonly class="bt-input url" (click)="selectAndCopy($event)" [value]="cleanUrl"/>
                <button class="bt-button" (click)="share(cleanUrl)">SHARE</button>
            </div>
        </div>
        <div dialog-actions>
            <button class="bt-button" (click)="downloadAsImage()">SHARE AS IMAGE</button>
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
    shareUrl: string = '';
    cleanUrl: string = '';

    constructor() {
        this.buildUrls();
    }
    
    
    private buildUrls() {
        const origin = window.location.origin || '';
        const basePath = this.router.serializeUrl(this.router.createUrlTree([], { relativeTo: this.route }));
        // We get the query Parameters from the force builder
        const queryParameters = this.forceBuilderService.queryParameters();

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
                navigator.clipboard.writeText(url);
            });
        } else {
            navigator.clipboard.writeText(url);
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
            await navigator.clipboard.writeText(target.value);
            this.toastService.show('Link copied to clipboard.', 'success');
        } catch (err) {
            this.toastService.show('Failed to copy link.', 'error');
        }
    }

    async downloadAsImage() {
        const forceView = document.getElementById('force-view');
        if (!forceView) return;
        const removeElements = ['.modal', '.share-btn', '.menu-overlay', '.burger-lip-btn',
            '.main-content', '.force-viewer-container .header', 
            '.cdk-overlay-container', '.footer .spanner', '.unit-actions'];
        // calculate the height of each force-unit-item
        const unitItems = forceView.querySelectorAll('.force-view .force-unit-item');
        const totalHeight = Array.from(unitItems).reduce((acc, item) => acc + item.scrollHeight + 4, 0);
        const canvas = await html2canvas(forceView, <any>{
            useCORS: true,
            backgroundColor: '#292929',
            height: totalHeight + 96,
            windowHeight: (totalHeight + 96) * 2,
            removeContainer: true,
            onclone: (clonedDoc: Document) => {
                clonedDoc.querySelectorAll('.popup-btn').forEach(el => { el.parentElement?.remove(); });
                removeElements.forEach(selector => {
                    const elements = clonedDoc.querySelectorAll(selector);
                    elements.forEach(el => el.remove());
                });
                const styleEl = clonedDoc.createElement('style');
                styleEl.textContent = `
                    body * { block-size: initial !important; }
                    .force-name { height: 32px !important; min-height: 32px !important; }
                    .primary-info, .secondary-info, .third-info { width: auto !important; }
                    .force-viewer-container { height: auto !important; }
                    .force-view { force-grow: 0 !important; min-height: initial !important; height: 0 !important; }
                    .force-units-list, .unit-card { width: 100% !important; }
                    .scrollable-content { flex-grow: 0; overflow: visible !important; min-height: initial !important; }
                    .footer { justify-content: center !important; height: 32px !important; }
                `;
                clonedDoc.documentElement.appendChild(styleEl);
            }
         });
        const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) {
            this.toastService.show('Failed to create image.', 'error');
            return;
        }
        const baseName = (this.forceBuilderService.force?.name || 'mekbay-force')
            .replace(/[^a-z0-9_\-]/ig, '_')
            .slice(0, 100);
        const filename = `${baseName}.png`;
        const file = new File([blob], filename, { type: 'image/png' });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({
                    title: this.forceBuilderService.force.name || 'MekBay Force',
                    files: [file]
                });
                this.toastService.show('Image shared.', 'success');
                return;
            } catch (err) {
            }
        } else
        // fall through to clipboard/download fallback
        if (window.ClipboardItem) {
            try {
                const item = new ClipboardItem({ 'image/png': blob });
                await navigator.clipboard.write([item]);
                this.toastService.show('Image copied to clipboard.', 'success');
                return;
            } catch (err) {
                // fall through to download fallback
                // const url = URL.createObjectURL(blob);
                // const a = document.createElement('a');
                // a.href = url;
                // a.download = filename;
                // document.body.appendChild(a);
                // a.click();
                // a.remove();
                // URL.revokeObjectURL(url);
                // this.toastService.show('Image downloaded.', 'success');
            }
        }
    };

    close(value: null) {
        this.dialogRef.close(value);
    }
}