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


import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';

/*
 * Author: Drake
 */

export interface EditPilotDialogData {
    name: string;
    gunnery: number;
    piloting: number;
    labelGunnery?: string;
    labelPiloting?: string;
    disablePiloting?: boolean;
}

export interface EditPilotResult {
    name: string;
    gunnery: number;
    piloting: number;
}

@Component({
    selector: 'edit-pilot-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    <div class="wide-dialog">
        <h2 class="wide-dialog-title">Warrior Data</h2>
        <div class="wide-dialog-body">
            <div class="form-fields">
                <label class="field-label">Name</label>
                <input #nameInput type="text" class="field-input" autocomplete="off" [value]="data.name || ''" maxlength="32" (keydown.enter)="submit()" />
            </div>
            <div class="form-row no-stack">
                <div class="form-fields">
                    <label class="field-label">{{ data.labelGunnery || 'Gunnery Skill' }}</label>
                    <select #gunneryInput class="field-input centered">
                        @for (v of skillValues; track v) {
                            <option [value]="v" [selected]="v === data.gunnery">{{ v }}</option>
                        }
                    </select>
                </div>
                <div class="form-fields" [class.disabled]="!!data.disablePiloting">
                    <label class="field-label">{{ data.labelPiloting || 'Piloting Skill' }}</label>
                    <select #pilotingInput class="field-input centered" [disabled]="!!data.disablePiloting">
                        @for (v of skillValues; track v) {
                            <option [value]="v" [selected]="v === data.piloting">{{ v }}</option>
                        }
                    </select>
                </div>
            </div>
        </div>
        <div class="wide-dialog-actions">
            <button (click)="submit()" class="bt-button">CONFIRM</button>
            <button (click)="close()" class="bt-button">DISMISS</button>
        </div>
    </div>
    `,
    styles: `
        .centered { text-align: center; }
    `,
})
export class EditPilotDialogComponent {
    nameInput = viewChild.required<ElementRef<HTMLInputElement>>('nameInput');
    gunneryInput = viewChild.required<ElementRef<HTMLSelectElement>>('gunneryInput');
    pilotingInput = viewChild.required<ElementRef<HTMLSelectElement>>('pilotingInput');

    readonly skillValues = [0, 1, 2, 3, 4, 5, 6, 7, 8];

    public dialogRef = inject(DialogRef<EditPilotResult | null, EditPilotDialogComponent>);
    readonly data: EditPilotDialogData = inject(DIALOG_DATA) as EditPilotDialogData;

    constructor() { }

    submit() {
        const name = this.nameInput().nativeElement.value.trim();
        const gunnery = Number(this.gunneryInput().nativeElement.value);
        let piloting = this.data.piloting;
        if (!this.data.disablePiloting) {
            piloting = Number(this.pilotingInput().nativeElement.value);
        }
        this.dialogRef.close({ name, gunnery, piloting });
    }

    close(value: null = null) {
        this.dialogRef.close(value);
    }
}