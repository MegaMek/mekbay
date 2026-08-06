// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';


@Component({
    selector: 'license-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
    BaseDialogComponent
],
    template: `
    <base-dialog [autoHeight]="true">
      <div dialog-header><div class="title">License & Legal Notice</div></div>
      <div dialog-body>
        <p>
            <strong>MekBay</strong> is part of <strong>MegaMek</strong>: an open-source, non-profit, fan-made project and is not affiliated with Catalyst Game Labs, The Topps Company, Inc., or Microsoft Corporation.
        </p>
        <ul>
            <li>
            <strong>MechWarrior</strong>, <strong>BattleMech</strong>, <strong>\`Mech</strong>, and <strong>AeroTech</strong> are registered trademarks of The Topps Company, Inc. All rights reserved.
            </li>
            <li>
            <strong>Catalyst Game Labs</strong> and the Catalyst Game Labs logo are trademarks of InMediaRes Productions, LLC.
            </li>
            <li>
            <strong>MechWarrior</strong> Copyright Microsoft Corporation. MekBay was created under Microsoft's <a href="https://www.xbox.com/en-US/developers/rules" target="_blank" rel="noopener">Game Content Usage Rules</a> and is not endorsed by or affiliated with Microsoft.
            </li>
        </ul>
        <p>
            Record sheets and other game data are sourced from <a href="https://www.megamek.org" target="_BLANK"><strong>MegaMek</strong></a> and are provided for personal, non-commercial use only.
        </p>
        <p>
            This software is provided “as is”, without warranty of any kind, express or implied.
        </p>
        <p class="muted">
            <i>This license and legal notice is a draft and may be updated in future releases.</i>
        </p>
      </div>
      <div dialog-footer>
        <button class="modal-btn bt-button" (click)="onClose()">DISMISS</button>
      </div>
    </base-dialog>
    <style>
        ul {
            margin-left: 1.2em;
            list-style-type: disc;
        }
        li {
            margin-bottom: 0.5em;
        }
    </style>
  `
})
export class LicenseDialogComponent {
    private dialogRef = inject(DialogRef<void>);
    data = inject(DIALOG_DATA, { optional: true });

    onClose() {
        this.dialogRef.close();
    }
}