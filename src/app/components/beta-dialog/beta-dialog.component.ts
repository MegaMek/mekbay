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
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';

/*
 * Author: Drake
 */
@Component({
    selector: 'beta-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        CommonModule,
        BaseDialogComponent,
    ],
    template: `
    <base-dialog>
        <div dialog-header><div class="title">Beta Notice</div></div>
        <div dialog-body>
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
    `
})
export class BetaDialogComponent {
    dialogRef = inject(DialogRef<BetaDialogComponent>);
    data = inject(DIALOG_DATA, { optional: true });

    onClose() {
        this.dialogRef.close();
    }
}