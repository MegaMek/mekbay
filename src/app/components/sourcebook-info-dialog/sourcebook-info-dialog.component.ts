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
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { Sourcebook } from '../../models/sourcebook.model';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';

/*
 * Author: Drake
 */
export interface SourcebookInfoDialogData {
    sourcebook: Sourcebook;
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
        <div dialog-header>
            <h2 class="title">{{ data.sourcebook.title }}</h2>
        </div>
        <div dialog-body class="sourcebook-content">
            @if (data.sourcebook.image) {
                <div class="sourcebook-image">
                    <img [src]="data.sourcebook.image" [alt]="data.sourcebook.title" />
                </div>
            }
            @if (data.sourcebook.sku) {
                <div class="sourcebook-sku">
                    <span class="label">SKU:</span>
                    <span class="value">{{ data.sourcebook.sku }}</span>
                </div>
            }
            <div class="sourcebook-links">
            </div>
        </div>
        <div dialog-footer class="footer">
                @if (data.sourcebook.url) {
                    <a class="modal-btn bt-button primary" [href]="data.sourcebook.url" target="_blank" rel="noopener">
                        BUY
                    </a>
                }
                @if (data.sourcebook.mul_url) {
                    <a class="modal-btn bt-button" [href]="data.sourcebook.mul_url" target="_blank" rel="noopener">
                        MUL
                    </a>
                }
            <button class="modal-btn bt-button" (click)="close()">DISMISS</button>
        </div>
    </base-dialog>
    `,
    styles: [`
        .sourcebook-content {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 16px;
            padding: 8px;
        }

        .sourcebook-image {
            display: flex;
            justify-content: center;
            width: 100%;
        }

        .sourcebook-image img {
            width: 100%;
            max-width: 300px;
            height: auto;
            object-fit: contain;
            border-radius: 4px;
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

        .footer {
            width: 100%;
            display: flex;
            justify-content: space-around;
            flex-direction: row;
            gap: 8px;
        }
        
        [dialog-footer] a {
            text-decoration: none;
        }
    `]
})
export class SourcebookInfoDialogComponent {
    private dialogRef = inject(DialogRef);
    readonly data: SourcebookInfoDialogData = inject(DIALOG_DATA);

    close() {
        this.dialogRef.close();
    }
}
