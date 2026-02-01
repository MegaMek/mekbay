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
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/*
 * Author: Drake
 */
export interface ConfirmDialogButton<T = any> {
    label: string;
    value: T;
    class?: string; // e.g. 'primary', 'warn', etc.
}

export interface ConfirmDialogData<T = any> {
    title: string;
    message?: string;
    messageHtml?: string;
    buttons: ConfirmDialogButton<T>[];
}

@Component({
    selector: 'confirm-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    <div class="content">
        <h2 dialog-title>{{ data.title }}</h2>
        <div dialog-content>
            @if (safeMessageHtml) {
                <div [innerHTML]="safeMessageHtml"></div>
            } @else {
                <p>{{ data.message }}</p>
            }
        </div>
        <div dialog-actions>
            @for (btn of data.buttons; track btn.label) {
                <button
                    (click)="close(btn.value)"
                    class="bt-button" [ngClass]="btn.class"
                    >{{ btn.label }}</button>
            }
        </div>
    </div>
    `,
    styles: [`
        .cdk-overlay-pane.danger :host {
            background-color: #4d0400;
        }

        .content {
            display: block;
            max-width: 500px;
        }

        h2 {
            margin-top: 8px;
            margin-bottom: 8px;
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
export class ConfirmDialogComponent<T = any> {
    public dialogRef: DialogRef<T, ConfirmDialogComponent<T>> = inject(DialogRef);
    readonly data: ConfirmDialogData<T> = inject(DIALOG_DATA);
    private sanitizer = inject(DomSanitizer);
    safeMessageHtml: SafeHtml | null = null;

    constructor() {
        if (this.data.messageHtml) {
            this.safeMessageHtml = this.sanitizer.bypassSecurityTrustHtml(this.data.messageHtml);
        }
    }

    close(value: T) {
        this.dialogRef.close(value);
    }
}