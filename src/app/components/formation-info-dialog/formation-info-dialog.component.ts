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
import { FormationTypeDefinition } from '../../utils/formation-type.model';
import { FormationInfoComponent } from '../formation-info/formation-info.component';

/*
 * Author: Drake
 *
 * Dialog that shows full formation details and abilities.
 * Opened from the (i) icon in the force-builder-viewer group header.
 */

export interface FormationInfoDialogData {
    formation: FormationTypeDefinition;
    /** Optional composed formation name for display (e.g. "Fire Support Lance") */
    formationDisplayName?: string;
    /** Optional unit count for concrete distribution labels */
    unitCount?: number;
}

@Component({
    selector: 'formation-info-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormationInfoComponent],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
        <div class="content">
            <h2 dialog-title>{{ data.formationDisplayName || data.formation.name }}</h2>
            <div dialog-content>
                <formation-info [formation]="data.formation" [unitCount]="data.unitCount"></formation-info>
            </div>
            <div dialog-actions>
                <button (click)="close()" class="bt-button">DISMISS</button>
            </div>
        </div>
    `,
    styles: [`
        .content {
            display: block;
            max-width: 600px;
            text-align: center;
        }

        h2 {
            margin-top: 8px;
            margin-bottom: 8px;
        }

        [dialog-content] {
            width: 90vw;
            max-width: 600px;
            max-height: 70vh;
            overflow-y: auto;
            text-align: left;
            padding: 0 4px;
        }

        [dialog-actions] {
            padding-top: 12px;
            display: flex;
            gap: 8px;
            justify-content: center;
        }

        [dialog-actions] button {
            padding: 8px;
            min-width: 100px;
        }
    `]
})
export class FormationInfoDialogComponent {
    public dialogRef = inject(DialogRef);
    readonly data: FormationInfoDialogData = inject(DIALOG_DATA) as FormationInfoDialogData;

    close(): void {
        this.dialogRef.close();
    }
}
