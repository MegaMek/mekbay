// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { createQrCodeSvgDataUrl } from '../../utils/print-roster-branding.util';



export interface QrDialogData {
    url: string;
}

@Component({
    selector: 'qr-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    <div class="wide-dialog">
        <div class="wide-dialog-body">
            <div class="qr-content">
                <div class="qr-card">
                    @if (qrImageUrl(); as imageUrl) {
                        <img
                            class="qr-image"
                            [src]="imageUrl"
                            alt="QR code for shared force URL"
                            data-allow-native-context-menu="true" />
                    }
                </div>
            </div>
        </div>
        <div class="wide-dialog-actions">
            <button class="bt-button" (click)="close()">DISMISS</button>
        </div>
    </div>
    `,
    styles: [`
        .qr-content {
            display: flex;
            flex-direction: column;
            gap: 18px;
            width: 100%;
            align-items: center;
        }

        .qr-card {
            width: min(320px, calc(100vw - 48px));
            max-width: 100%;
            display: flex;
            justify-content: center;
            background: #fff;
            padding: 8px;
            box-sizing: border-box;
        }

        .qr-image {
            display: block;
            width: 100%;
            max-width: 384px;
            height: auto;
            image-rendering: crisp-edges;
        }
    `]
})
export class QrDialogComponent {
    private dialogRef = inject(DialogRef<void, QrDialogComponent>);
    private data: QrDialogData = inject(DIALOG_DATA);

    readonly url = this.data.url;
    readonly qrImageUrl = signal<string | null>(null);

    constructor() {
        void this.loadQrImageUrl();
    }

    close(): void {
        this.dialogRef.close();
    }

    private async loadQrImageUrl(): Promise<void> {
        try {
            this.qrImageUrl.set(await createQrCodeSvgDataUrl(this.url, 384));
        } catch (error) {
            console.error('Failed to generate QR dialog image.', error);
            this.qrImageUrl.set(null);
        }
    }
}