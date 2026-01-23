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

/*
 * Author: Drake
 */

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';

@Component({
    selector: 'data-export-license-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    <div class="content">
        <h2 dialog-title>MekBay Data Export - License Notice</h2>

        <div dialog-content class="body">
            <div class="text">
                <p>
                    This export contains MegaMek Data (© 2025 The MegaMek Team), licensed under the
                    Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License (CC BY-NC-SA 4.0).
                </p>

                <p>By exporting this data, you acknowledge and agree that:</p>

                <ul>
                    <li>This data may be used for non-commercial purposes only</li>
                    <li>Attribution to The MegaMek Team must be provided</li>
                    <li>Any modified or derived works must be distributed under the same license</li>
                    <li>This data is provided by a non-profit, volunteer-run project, without warranty</li>
                </ul>

                <p>
                    BattleTech®, MechWarrior®, and BattleMechs® are trademarks of Topps, Inc.
                    Used under applicable content usage rules. MegaMek and its data are not endorsed by or affiliated with Topps, Inc.,
                    Catalyst Game Labs, InMediaRes Productions, LLC, or Microsoft Corporation.
                </p>
            </div>

            <label class="agree">
                <input
                    type="checkbox"
                    class="bt-checkbox"
                    [checked]="accepted()"
                    (change)="onToggle($event)"
                />
                <span>I have read and agree to the above terms</span>
            </label>
        </div>

        <div dialog-actions>
            <button class="bt-button" [disabled]="!accepted()" (click)="continue()">CONTINUE</button>
            <button class="bt-button" (click)="dismiss()">DISMISS</button>
        </div>
    </div>
    `,
    styles: [`
        .content {
            display: flex;
            flex-direction: column;
            width: 100%;
            max-width: 1000px;
            justify-content: center;
            align-items: center;
            container-type: inline-size;
        }

        h2 {
            margin-top: 8px;
            margin-bottom: 8px;
            text-align: center;
        }

        .body {
            width: 100%;
            max-width: 1000px;
            display: flex;
            flex-direction: column;
            padding: 12px;
            font-size: 0.8em;
            flex-shrink: 1;
            box-sizing: border-box;
            overflow-y: auto;
            border: 1px solid var(--border-color);
        }

        .text {
            width: 100%;
            box-sizing: border-box;
        }

        .text p {
            margin: 0 0 12px 0;
        }

        .text ul {
            margin: 0 0 12px 20px;
        }

        .agree {
            display: flex;
            align-items: center;
            gap: 8px;
            -webkit-user-select: none;
            user-select: none;
            cursor: pointer;
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

        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
    `]
})
export class DataExportLicenseDialogComponent {
    private dialogRef: DialogRef<boolean, DataExportLicenseDialogComponent> = inject(DialogRef);

    accepted = signal(false);

    onToggle(event: Event) {
        const input = event.target as HTMLInputElement | null;
        this.accepted.set(!!input?.checked);
    }

    dismiss() {
        this.dialogRef.close(false);
    }

    continue() {
        if (!this.accepted()) return;
        this.dialogRef.close(true);
    }
}
