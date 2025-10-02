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
import { ChangeDetectionStrategy, Component, ElementRef, inject, Inject, ViewChild } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';

/*
 * Author: Drake
 */
export interface InputDialogData {
    title: string;
    message: string;
    inputType?: 'text' | 'number'; // default: text
    placeholder?: string;
    defaultValue?: string | number;
    buttons?: { label: string; value: 'ok' | 'cancel'; class?: string }[];
}

@Component({
    selector: 'input-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    template: `
    <div class="content">
        <h2 dialog-title>{{ data.title }}</h2>
        <div dialog-content>
            <p>{{ data.message }}</p>
            <input
                #inputRef
                [type]="data.inputType || 'text'"
                [placeholder]="data.placeholder"
                [value]="data.defaultValue ?? ''"
                [attr.min]="data.inputType === 'number' ? 0 : null"
                (keydown.enter)="submit()"
                required
            />
        </div>
        <div dialog-actions>
            <button
                *ngFor="let btn of buttons"
                (click)="btn.value === 'ok' ? submit() : close(null)"
                class="bt-button {{ btn.class }}"
            >
                {{ btn.label }}
            </button>
        </div>
    </div>
    `,
    styles: [`
        :host {
            display: flex;
            justify-content: center;
            box-sizing: border-box;
            background-color: rgba(45, 45, 45, 0.8);
            backdrop-filter: blur(5px);
            width: 100vw;
            pointer-events: auto;
            padding: 16px;
        }

        :host-context(.cdk-overlay-pane) {
            transform: translateY(-10vh);
        }

        .content {
            display: block;
            max-width: 1000px;
            text-align: center;
        }

        h2 {
            margin-top: 8px;
            margin-bottom: 8px;
        }

        [dialog-content] input {
            width: 90vw;
            max-width: 500px;
            margin-bottom: 16px;
            font-size: 1.5em;
            background: var(--background-input);
            color: white;
            border: 0;
            border-bottom: 1px solid #666;
            text-align: center;
            outline: none;
            transition: all 0.2s ease-in-out;    
        }

        [dialog-content] input:focus {
            border-bottom: 1px solid #fff;
            outline: none;
        }

        [dialog-content] input[type="number"] {
            max-width: 200px;
            -webkit-appearance: none;
            -moz-appearance: textfield;
            appearance: textfield;
        }

        [dialog-content] input[type="number"]::-webkit-outer-spin-button,
        [dialog-content] input[type="number"]::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
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
    `]
})

export class InputDialogComponent {
    @ViewChild('inputRef') inputRef!: ElementRef<HTMLInputElement>;
    public dialogRef: DialogRef<string | number | null, InputDialogComponent> = inject(DialogRef);
    readonly data: InputDialogData = inject(DIALOG_DATA);
    buttons: { label: string; value: 'ok' | 'cancel'; class?: string }[];

    constructor() {
        this.buttons = this.data.buttons ?? [
            { label: 'OK', value: 'ok' },
            { label: 'CANCEL', value: 'cancel' }
        ];
    }

    submit() {
        const value = this.inputRef.nativeElement.value;
        if (this.data.inputType === 'number') {
            const num = Number(value);
            if (isNaN(num)) return;
            this.dialogRef.close(num);
        } else {
            this.dialogRef.close(value);
        }
    }

    close(value: null) {
        this.dialogRef.close(value);
    }
}