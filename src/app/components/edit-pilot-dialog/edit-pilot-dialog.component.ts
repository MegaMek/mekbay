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
    <div class="content">
        <h2 dialog-title>Warrior Data</h2>
        <div dialog-content>
            <p>Name</p>
            <div class="input-wrapper">
                <input #nameInput type="text" class="input" [value]="data.name || ''" (keydown.enter)="submit()" />
            </div>
            <div class="stats">
                <div class="stat">
                    <p>{{ data.labelGunnery || 'Gunnery Skill' }}</p>
                    <div class="input-wrapper">
                        <input #gunneryInput type="number" class="input" [value]="data.gunnery" [placeholder]="data.gunnery" min="0" max="8" (keydown.enter)="submit()" />
                    </div>
                </div>
                <div class="stat">
                    @if (!data.disablePiloting) {
                        <p>{{ data.labelPiloting || 'Piloting Skill' }}</p>
                        <div class="input-wrapper">
                            <input #pilotingInput type="number" class="input" [value]="data.piloting" [placeholder]="data.piloting" min="0" max="8" (keydown.enter)="submit()" />
                        </div>
                    }
                    </div>
            </div>
        </div>
        <div dialog-actions>
            <button (click)="submit()" class="bt-button">CONFIRM</button>
            <button (click)="close()" class="bt-button">DISMISS</button>
        </div>
    </div>
    `,
    styles: [`
        .content {
            width: 100%;
            max-width: 500px;
            text-align: center;
            container-type: inline-size;
        }

        h2 {
            margin-top: 8px;
            margin-bottom: 0;
        }

        p {
            margin: 8px;
        }

        [dialog-content] {
            width: 90vw;
            max-width: 500px;
            margin-bottom: 16px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .input {
            width: 100%;
            max-width: 500px;
            font-size: 1.5em;
            background: var(--background-input);
            color: white;
            border: 0;
            border-bottom: 1px solid #666;
            text-align: center;
            outline: none;
            transition: all 0.2s ease-in-out;
            white-space: normal;
            overflow-wrap: break-word;
            word-break: break-word;
            flex: 1;
        }

        .input:focus {
            border-bottom: 1px solid #fff;
            outline: none;
        }

        .input-wrapper {
            position: relative;
            display: inline-flex;
            align-items: center;
            box-sizing: border-box;
            flex: 1;
            width: 100%;
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

        .stats {
            display: flex;
            justify-content: center;
            gap: 16px;
        }

        @container (max-width: 400px) {
            .stats {
                flex-direction: column;
                gap: 8px;
            }
        }

        .stat {
            display: flex;
            flex-direction: row;
            gap: 16px;
            flex: 1;
        }
    `]
})
export class EditPilotDialogComponent {
    nameInput = viewChild.required<ElementRef<HTMLInputElement>>('nameInput');
    gunneryInput = viewChild.required<ElementRef<HTMLInputElement>>('gunneryInput');
    pilotingInput = viewChild<ElementRef<HTMLInputElement>>('pilotingInput');

    public dialogRef = inject(DialogRef<EditPilotResult | null, EditPilotDialogComponent>);
    readonly data: EditPilotDialogData = inject(DIALOG_DATA) as EditPilotDialogData;

    constructor() { }

    submit() {
        const name = this.nameInput().nativeElement.value.trim();
        const gunneryValue = this.gunneryInput().nativeElement.value;
        const gunnery = Number(gunneryValue === "" ? this.data.gunnery : gunneryValue);
        let piloting = this.data.piloting;
        if (!this.data.disablePiloting) {
            const pv = this.pilotingInput()?.nativeElement.value ?? '';
            piloting = Number(pv === '' ? this.data.piloting : pv);
        }
        this.dialogRef.close({ name, gunnery, piloting });
    }

    close(value: null = null) {
        this.dialogRef.close(value);
    }
}