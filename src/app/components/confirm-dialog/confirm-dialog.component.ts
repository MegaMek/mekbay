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
    <div class="wide-dialog">
        <h2 class="wide-dialog-title">{{ data.title }}</h2>
        <div class="wide-dialog-body">
            @if (safeMessageHtml) {
                <div [innerHTML]="safeMessageHtml"></div>
            } @else {
                <p class="message">{{ data.message }}</p>
            }
        </div>
        <div class="wide-dialog-actions">
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

        .wide-dialog {
            max-width: 500px;
            max-height: var(--mekbay-overlay-height, 100dvh);
            text-align: left;
        }

        .wide-dialog-title {
            margin-top: 4px;
            margin-bottom: 8px;
        }

        .message {
            white-space: pre-wrap;
            overflow-wrap: anywhere;
            margin: 8px 0;
        }

        .wide-dialog-actions {
            border-top: none;
        }

        .wide-dialog-actions button.square {
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
