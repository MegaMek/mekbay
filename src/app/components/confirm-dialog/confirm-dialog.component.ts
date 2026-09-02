// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';


export interface ConfirmDialogButton<T = unknown> {
    label: string;
    value: T;
    class?: string; // e.g. 'primary', 'warn', etc.
}

export interface ConfirmDialogData<T = unknown> {
    title: string;
    message?: string;
    messageHtml?: string;
    buttons: ConfirmDialogButton<T>[];
}

@Component({
    selector: 'confirm-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
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
                    class="bt-button" [class]="btn.class"
                    >{{ btn.label }}</button>
            }
        </div>
    </div>
    `,
    styles: [`
        .cdk-overlay-pane.danger :host {
            background-color: #4d0400;
        }

        .cdk-overlay-pane.warning :host {
            background-color: #4a3100;
        }

        .content {
            display: block;
            max-width: 500px;
        }

        h2 {
            margin-top: 4px;
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

        [dialog-actions] button.square {
            min-width: unset;
        }
    `]
})
export class ConfirmDialogComponent<T = unknown> {
    public dialogRef = inject<DialogRef<T, ConfirmDialogComponent<T>>>(DialogRef);
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
