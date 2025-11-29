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

import { ChangeDetectionStrategy, Component, Directive, ElementRef, HostListener, inject, Input, signal } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { Field, form } from '@angular/forms/signals';

/*
 * Author: Drake
 */

export interface RangeModel {
    from: number | null;
    to: number | null;
}

export interface RangeFormState {
    from: string;
    to: string;
}

export interface UnitSearchFilterRangeDialogData {
    title: string;
    message: string;
    range: RangeModel;
    allowFloatingValues?: boolean;
}

/**
 * Directive to handle numeric input formatting, validation, and keyboard interaction.
 */
@Directive({
    selector: 'input[numericInput]',
    standalone: true
})
export class NumericInputDirective {
    @Input() allowFloatingValues = false;
    private el: HTMLInputElement;

    constructor(private elementRef: ElementRef) {
        this.el = this.elementRef.nativeElement;
    }

    @HostListener('keydown', ['$event'])
    onKeyDown(event: KeyboardEvent) {
        const key = event.key;
        const value = this.el.value;
        const cursorStart = this.el.selectionStart ?? 0;

        // Navigation & Control Keys (Allow always)
        if (['Tab', 'End', 'Home', 'Delete', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(key) ||
            (event.ctrlKey || event.metaKey)) {
            return;
        }

        // Handle Backspace special case when deleting a comma, we move the cursor instead.
        if (key === 'Backspace') {
            if (cursorStart > 0 && value[cursorStart - 1] === ',') {
                event.preventDefault();
                this.el.setSelectionRange(cursorStart - 1, cursorStart - 1);
            }
            return;
        }

        // Handle Arrow Keys (Increment/Decrement)
        if (key === 'ArrowUp' || key === 'ArrowDown') {
            event.preventDefault();
            this.adjustValue(key === 'ArrowUp' ? 1 : -1, event);
            return;
        }

        // Handle Negative Sign
        if (key === '-') {
            if (cursorStart === 0 && !value.includes('-')) {
                return; 
            }
            event.preventDefault();
            return;
        }

        // Handle Decimal Point
        if (key === '.') {
            if (this.allowFloatingValues && !value.includes('.')) {
                return;
            }
            event.preventDefault();
            return;
        }

        // Block non-numeric keys
        if (!/^[0-9]$/.test(key)) {
            event.preventDefault();
        }
    }

    @HostListener('input', ['$event'])
    onInput(event: Event) {
        // Logic to maintain cursor position relative to "logical" digits
        // This prevents the cursor from jumping wildly when commas are added/removed.
        const input = this.el;
        const originalValue = input.value;
        const cursorPosition = input.selectionStart ?? 0;

        // Count how many "logical" characters (digits, -, .) were before the cursor
        let logicalCharsBefore = 0;
        for (let i = 0; i < cursorPosition; i++) {
            if (/[0-9.\-]/.test(originalValue[i])) {
                logicalCharsBefore++;
            }
        }

        const cleanValue = this.parseToCleanString(originalValue);
        const formattedValue = this.formatString(cleanValue);

        // Update view if changed
        if (originalValue !== formattedValue) {
            input.value = formattedValue;

            // Restore cursor position
            let newCursorPos = 0;
            let logicalCharsSeen = 0;
            for (let i = 0; i < formattedValue.length; i++) {
                if (logicalCharsSeen >= logicalCharsBefore) break;
                if (/[0-9.\-]/.test(formattedValue[i])) {
                    logicalCharsSeen++;
                }
                newCursorPos++;
            }
            input.setSelectionRange(newCursorPos, newCursorPos);
            
            input.dispatchEvent(new Event('input', event));
        }
    }

    private adjustValue(delta: number, event: KeyboardEvent) {
        const currentClean = this.parseToCleanString(this.el.value);
        // If empty or just "-", treat as 0
        const num = currentClean === '' || currentClean === '-' ? 0 : parseFloat(currentClean);
        
        if (!isNaN(num)) {
            const newValue = num + delta;
            // Format specifically to standard US locale for the separators
            this.el.value = newValue.toLocaleString('en-US', { maximumFractionDigits: 10 });
            this.el.dispatchEvent(new Event('input', event));
        }
    }

    // Removes commas, keeps digits, dot, and minus
    private parseToCleanString(val: string): string {
        if (!this.allowFloatingValues) {
            const dotIndex = val.indexOf('.');
            if (dotIndex !== -1) {
                val = val.substring(0, dotIndex);
            }
        }
        return val.replace(/[^0-9.\-]/g, '');
    }

    // Adds commas to the integer part
    private formatString(cleanVal: string): string {
        if (cleanVal === '') return '';
        if (cleanVal === '-') return '-'; 
        
        const parts = cleanVal.split('.');
        const integerPart = parts[0];
        const decimalPart = parts.length > 1 ? '.' + parts[1] : '';

        // Allow "0." or "-0." to exist while typing
        if (integerPart === '' && decimalPart) return decimalPart; 

        // Regex to add commas to integer part (handles negative sign correctly naturally)
        const formattedInt = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        
        return formattedInt + decimalPart;
    }
}

@Component({
    selector: 'unit-search-filter-range-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [Field, NumericInputDirective],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    templateUrl: './unit-search-filter-range-dialog.component.html',
    styleUrls: ['./unit-search-filter-range-dialog.component.scss']
})
export class UnitSearchFilterRangeDialogComponent {
    public dialogRef: DialogRef<RangeModel | null, UnitSearchFilterRangeDialogComponent> = inject(DialogRef);
    readonly data: UnitSearchFilterRangeDialogData = inject(DIALOG_DATA);

    // Form State is Strings to handle the Visual formatting
    rangeFormState = signal<RangeFormState>({
        from: this.toDisplay(
            this.data.range.from !== null && !this.data.allowFloatingValues
                ? Math.floor(this.data.range.from)
                : this.data.range.from
        ),
        to: this.toDisplay(
            this.data.range.to !== null && !this.data.allowFloatingValues
                ? Math.ceil(this.data.range.to)
                : this.data.range.to
        )
    });
    rangeForm = form(this.rangeFormState);

    constructor() {}

    onFromBlur() {
        const { from, to } = this.rangeFormState();
        const fromNum = this.parseToNumber(from, false);
        const toNum = this.parseToNumber(to, true);

        if (fromNum !== null && toNum !== null && fromNum > toNum) {
            this.rangeFormState.update(state => ({ ...state, to: from }));
        }
    }

    onToBlur() {
        const { from, to } = this.rangeFormState();
        const fromNum = this.parseToNumber(from, false);
        const toNum = this.parseToNumber(to, true);

        if (fromNum !== null && toNum !== null && toNum < fromNum) {
            this.rangeFormState.update(state => ({ ...state, from: to }));
        }
    }

    submit() {
        const formValues = this.rangeFormState();
        
        // Convert strings back to numbers for the result
        const result: RangeModel = {
            from: this.parseToNumber(formValues.from, false),
            to: this.parseToNumber(formValues.to, true)
        };

        this.dialogRef.close(result);
    }
    
    submitEmpty() {
        this.dialogRef.close({ from: null, to: null });
    }

    close(value: null = null) {
        this.dialogRef.close(value);
    }

    // Number -> String (1000 -> "1,000")
    toDisplay(val: number | null): string {
        if (val === null || val === undefined) return '';
        return val.toLocaleString('en-US');
    }

    // String -> Number ("1,000" -> 1000)
    parseToNumber(val: string, ceil: boolean): number | null {
        if (!val) return null;
        const num = parseFloat(val.replace(/,/g, ''));
        if (isNaN(num)) {
            return null;
        }
        if (this.data.allowFloatingValues) {
            return num;
        }
        return ceil ? Math.ceil(num) : Math.floor(num);
    }
}