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


import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';

/*
 * Author: Drake
 */
export interface InputDialogData {
    title: string;
    message: string;
    inputType?: 'text' | 'number'; // default: text
    minimumValue?: number; // for number input
    maximumValue?: number; // for number input
    placeholder?: string;
    defaultValue?: string | number;
    hint?: string;
    buttons?: { label: string; value: 'ok' | 'cancel'; class?: string }[];
}

@Component({
    selector: 'input-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    <div class="wide-dialog">
        <h2 class="wide-dialog-title">{{ data.title }}</h2>
        <div class="wide-dialog-body">
            <p class="message">{{ data.message }}</p>
            <div class="form-fields">
                <input
                    #inputRef
                    class="field-input"
                    [type]="data.inputType || 'text'"
                    [placeholder]="data.placeholder ?? ''"
                    [value]="data.defaultValue ?? ''"
                    autocomplete="off"
                    [attr.min]="data.inputType === 'number' ? (data.minimumValue ?? 0) : null"
                    [attr.max]="data.inputType === 'number' && data.maximumValue !== undefined ? data.maximumValue : null"
                    (keydown.enter)="$event.preventDefault(); $event.stopPropagation(); submit()"
                    (input)="onInputChange($event)"
                    required
                />
                @if (data.hint) {
                    <p class="hint">{{ data.hint }}</p>
                }
            </div>
        </div>
        <div class="wide-dialog-actions">
            @for (btn of buttons; track btn.label) {
                <button
                    (click)="btn.value === 'ok' ? submit() : close(null)"
                    [disabled]="btn.value === 'ok' && !isInputValid()"
                    class="bt-button {{ btn.class }}"
                >{{ btn.label }}</button>
            }
        </div>
    </div>
    `,
    styles: [`
        .message {
            margin: 0;
            font-size: 0.95em;
            color: var(--text-color-secondary);
        }

        .hint {
            font-size: 0.85em;
            color: var(--text-color-tertiary);
            margin-top: 2px;
        }

        input[type="number"].field-input {
            max-width: 200px;
            -webkit-appearance: none;
            -moz-appearance: textfield;
            appearance: textfield;
        }

        .form-fields {
            align-items: center;
        }

        input[type="number"].field-input::-webkit-outer-spin-button,
        input[type="number"].field-input::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }
    `]
})

export class InputDialogComponent {
    inputRef = viewChild.required<ElementRef<HTMLInputElement>>('inputRef');
    public dialogRef: DialogRef<string | number | null, InputDialogComponent> = inject(DialogRef);
    readonly data: InputDialogData = inject(DIALOG_DATA);
    buttons: { label: string; value: 'ok' | 'cancel'; class?: string }[];
    
    /** Track input value for validation */
    private inputValue = signal<string>(String(this.data.defaultValue ?? ''));

    constructor() {
        this.buttons = this.data.buttons ?? [
            { label: 'CONFIRM', value: 'ok' },
            { label: 'DISMISS', value: 'cancel' }
        ];
    }

    onInputChange(event: Event) {
        const value = (event.target as HTMLInputElement).value;
        this.inputValue.set(value);
    }

    isInputValid(): boolean {
        const value = this.inputValue();
        if (this.data.inputType === 'number') {
            return value.trim().length > 0 && !isNaN(Number(value));
        }
        return value.trim().length > 0;
    }

    submit() {
        const value = this.inputRef().nativeElement.value;
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