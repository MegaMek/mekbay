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
        <p>
            Original MekBay source code is licensed under the GNU General Public License, version 3 or later (GPL-3.0-or-later).
            Read the <a href="/legal/NOTICE" target="_blank" rel="noopener">NOTICE</a>,
            <a href="/legal/LICENSE" target="_blank" rel="noopener">GPL license</a>, and
            <a href="/legal/THIRD-PARTY-NOTICES.md" target="_blank" rel="noopener">third-party notices</a>.
            License texts for bundled npm dependencies are available in
            <a href="/3rdpartylicenses.txt" target="_blank" rel="noopener">3rdpartylicenses.txt</a>.
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
            Catalog and game data generated from the <a href="https://github.com/MegaMek/mm-data" target="_blank" rel="noopener"><strong>MegaMek mm-data</strong></a> project are not covered by MekBay's GPL license. They are licensed under the
            <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License</a>.
        </p>
        <p>
            This software is provided “as is”, without warranty of any kind, express or implied.
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