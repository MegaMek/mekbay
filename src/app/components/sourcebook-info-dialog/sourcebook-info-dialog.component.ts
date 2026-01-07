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
import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { Sourcebook } from '../../models/sourcebook.model';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';

/*
 * Author: Drake
 */
export interface SourcebookInfoDialogData {
    sourcebooks: Sourcebook[];
    unknownSources: string[];
    selectedIndex?: number;
}

@Component({
    selector: 'sourcebook-info-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, BaseDialogComponent],
    host: {
        class: 'fullscreen-dialog-host'
    },
    template: `
    <base-dialog [autoHeight]="true">
        <div dialog-header><div class="title">SOURCES</div></div>
        <div dialog-body class="sourcebook-content" #scrollContainer>
            @for (sourcebook of data.sourcebooks; let i = $index; let last = $last; track sourcebook.id) {
                <div class="sourcebook-entry" [attr.data-index]="i">
                    @if (sourcebook.image) {
                        <div class="sourcebook-image">
                            <img [src]="sourcebook.image" [alt]="sourcebook.title" (error)="onImageError($event)" />
                        </div>
                    }
                    <div class="sourcebook-title">{{ sourcebook.title }}</div>
                    @if (sourcebook.sku) {
                        <div class="sourcebook-sku">
                            <span class="label">SKU:</span>
                            <span class="value allow-select">{{ sourcebook.sku }}</span>
                        </div>
                    }
                    <div class="sourcebook-buttons">
                        @if (sourcebook.url) {
                            <a class="modal-btn bt-button primary" [href]="sourcebook.url" target="_blank" rel="noopener">
                                BUY
                            </a>
                        }
                        @if (sourcebook.mul_url) {
                            <a class="modal-btn bt-button" [href]="sourcebook.mul_url" target="_blank" rel="noopener">
                                MUL
                            </a>
                        }
                    </div>
                </div>
                @if (!last) {
                    <hr class="sourcebook-separator" />
                }
            }
            @for (unknown of data.unknownSources; let last = $last; track unknown) {
                @if (data.sourcebooks.length > 0 || !$first) {
                    <hr class="sourcebook-separator" />
                }
                <div class="sourcebook-entry unknown">
                    <div class="sourcebook-title">{{ unknown }}</div>
                </div>
            }
        </div>
        <div dialog-footer class="footer">
            <button class="modal-btn bt-button" (click)="close()">DISMISS</button>
        </div>
    </base-dialog>
    `,
    styles: [`
        .sourcebook-content {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            padding: 8px;
            max-height: 60vh;
            overflow-y: auto;
        }

        .sourcebook-entry {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            width: 100%;
        }

        .sourcebook-entry.unknown {
            opacity: 0.7;
        }

        .sourcebook-image {
            display: flex;
            justify-content: center;
            width: 100%;
        }

        .sourcebook-image img {
            width: 100%;
            height: auto;
            object-fit: contain;
            border-radius: 4px;
        }

        .sourcebook-title {
            font-weight: 600;
            font-size: 1.1em;
            text-align: center;
        }

        .sourcebook-sku {
            display: flex;
            gap: 8px;
            justify-content: center;
        }

        .sourcebook-sku .label {
            color: var(--text-color-secondary);
        }

        .sourcebook-sku .value {
            font-weight: 500;
        }

        .sourcebook-buttons {
            display: flex;
            gap: 8px;
            justify-content: center;
        }

        .sourcebook-buttons a {
            text-decoration: none;
        }

        .sourcebook-separator {
            width: 80%;
            border: none;
            border-top: 1px solid var(--border-color, #ccc);
            margin: 8px 0;
        }

        .footer {
            width: 100%;
            display: flex;
            justify-content: center;
            flex-direction: row;
            gap: 8px;
        }
    `]
})
export class SourcebookInfoDialogComponent implements AfterViewInit {
    private dialogRef = inject(DialogRef);
    readonly data: SourcebookInfoDialogData = inject(DIALOG_DATA);
    
    private scrollContainer = viewChild<ElementRef<HTMLElement>>('scrollContainer');

    ngAfterViewInit(): void {
        const idx = this.data.selectedIndex;
        if (idx == null || idx < 0) return;
        
        // Small delay to ensure DOM is fully rendered
        requestAnimationFrame(() => {
            const container = this.scrollContainer()?.nativeElement;
            if (!container) return;
            
            const entry = container.querySelector(`[data-index="${idx}"]`) as HTMLElement;
            if (entry) {
                entry.scrollIntoView({ behavior: 'instant', block: 'start' });
            }
        });
    }

    onImageError(event: Event): void {
        const img = event.target as HTMLImageElement;
        img.style.display = 'none';
    }

    close() {
        this.dialogRef.close();
    }
}
