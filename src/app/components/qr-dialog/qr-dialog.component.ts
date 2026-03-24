/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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
import { QRCodeComponent } from 'angularx-qrcode';

/*
 * Author: Drake
 */

export interface QrDialogData {
    url: string;
}

@Component({
    selector: 'qr-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [QRCodeComponent],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    <div class="wide-dialog">
        <div class="wide-dialog-body">
            <div class="qr-content">
                <div class="qr-card">
                    <qrcode
                        [qrdata]="url"
                        [width]="384"
                        [errorCorrectionLevel]="'L'"
                        [margin]="2"
                        [ariaLabel]="''"
                        [title]="''"
                    ></qrcode>
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
        }

        .qr-card qrcode {
            display: block;
            line-height: 0;
            width: 100%;
            max-width: 384px;
        }

        .qr-card qrcode ::ng-deep canvas,
        .qr-card qrcode ::ng-deep img,
        .qr-card qrcode ::ng-deep svg {
            display: block;
            width: 100% !important;
            max-width: 384px;
            height: auto !important;
        }
    `]
})
export class QrDialogComponent {
    private dialogRef = inject(DialogRef<void, QrDialogComponent>);
    private data: QrDialogData = inject(DIALOG_DATA);

    readonly url = this.data.url;

    close(): void {
        this.dialogRef.close();
    }
}