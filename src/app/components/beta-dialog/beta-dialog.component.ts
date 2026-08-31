// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { APP_VERSION_STRING } from '../../build-meta';


@Component({
    selector: 'beta-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
    BaseDialogComponent
],
    template: `
    <base-dialog [autoHeight]="true">
        <div dialog-header><div class="title">Beta Notice</div></div>
        <div dialog-body>
            <p>Version: 
            <span class="build-info allow-select">{{ appVersionString }}</span></p>
            <p>This is a development and public beta version of MekBay.</p>
            <p>It may contain bugs and issues that need to be resolved, and things might break unexpectedly.</p>
            <p>Features are subject to change, and some functionality may be incomplete or experimental.</p>
            <p>Thank you for testing MekBay and helping us build a better experience for the BattleTech community!</p>

            <hr />
            <p>Get involved, report issues, or chat with the team:</p>
            <ul>
                <li><a href="https://github.com/MegaMek/mekbay" target="_blank" rel="noopener noreferrer">GitHub Repository</a></li>
                <li><a href="https://github.com/MegaMek/mekbay/issues" target="_blank" rel="noopener noreferrer">Issues & Feature Requests</a></li>
                <li><a href="https://discord.gg/RcAV6kmJzz" target="_blank" rel="noopener noreferrer">MegaMek Discord</a></li>
            </ul>
        </div>
        <div dialog-footer>
            <button class="modal-btn bt-button" (click)="onClose();">DISMISS</button>
        </div>
    </base-dialog>
    `,
    styles: [`
    .build-info {
        font-weight: bold;
    }
    `],
})
export class BetaDialogComponent {
    private dialogRef = inject(DialogRef<void>);
    data = inject(DIALOG_DATA, { optional: true });
    appVersionString = APP_VERSION_STRING;

    onClose() {
        this.dialogRef.close();
    }
}
