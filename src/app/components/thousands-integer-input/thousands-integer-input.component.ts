// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, ElementRef, effect, input, output, signal, viewChild } from '@angular/core';
import { normalizeBoundedInteger } from '../../utils/bounded-integer-input.util';

@Component({
    selector: 'thousands-integer-input',
    template: `
        <input
            #inputElement
            class="bt-input field-input thousands-integer-input"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            [attr.aria-label]="ariaLabel() || null"
            [attr.min]="min() ?? null"
            [attr.max]="max() ?? null"
            [attr.step]="step()"
            [placeholder]="placeholder()"
            [value]="displayValue()"
            (focus)="onFocus()"
            (blur)="onBlur()"
            (keydown)="onKeydown($event)"
            (input)="onInput($event)" />
    `,
    styles: [`
        :host {
            display: block;
            min-width: 0;
        }

        .thousands-integer-input {
            width: 100%;
            min-width: 0;
            box-sizing: border-box;
            font: inherit;
        }
    `],
})
export class ThousandsIntegerInputComponent {
    readonly value = input<number | null | undefined>(undefined);
    readonly min = input<number | null>(null);
    readonly max = input<number | null>(null);
    readonly step = input(1);
    readonly placeholder = input('');
    readonly ariaLabel = input('');
    readonly emptyWhenZero = input(false);
    readonly valueChange = output<number>();
    readonly valueCommit = output<number>();

    private readonly inputElement = viewChild<ElementRef<HTMLInputElement>>('inputElement');

    readonly displayValue = signal('');
    private readonly focused = signal(false);

    private readonly syncDisplayValue = effect(() => {
        const value = this.value();
        const emptyWhenZero = this.emptyWhenZero();
        if (!this.focused()) {
            this.displayValue.set(this.formatNumberValue(value, emptyWhenZero));
        }
    });

    onFocus(): void {
        this.focused.set(true);
    }

    onBlur(): void {
        const input = this.inputElement()?.nativeElement;
        const value = this.clampValue(this.parseFormattedValue(input?.value ?? this.displayValue()));
        this.focused.set(false);
        this.valueCommit.emit(value);
        this.displayValue.set(this.formatNumberValue(value, this.emptyWhenZero()));
    }

    onInput(event: Event): void {
        const input = event.target as HTMLInputElement | null;
        if (!input) {
            return;
        }

        const caretDigitOffset = this.countDigitsBefore(input.value, input.selectionStart ?? input.value.length);
        this.applyDigits(input, this.extractDigits(input.value), caretDigitOffset);
    }

    onKeydown(event: KeyboardEvent): void {
        const input = event.target as HTMLInputElement | null;
        if (!input || event.altKey || event.ctrlKey || event.metaKey) {
            return;
        }

        const start = input.selectionStart ?? 0;
        const end = input.selectionEnd ?? start;
        if (start !== end) {
            return;
        }

        if (event.key === 'Backspace' && input.value[start - 1] === ',') {
            event.preventDefault();
            this.deleteDigitAt(input, this.countDigitsBefore(input.value, start - 1) - 1);
        } else if (event.key === 'Delete' && input.value[start] === ',') {
            event.preventDefault();
            this.deleteDigitAt(input, this.countDigitsBefore(input.value, start));
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            this.stepValue(input, event.key === 'ArrowUp' ? 1 : -1);
        }
    }

    private stepValue(input: HTMLInputElement, direction: 1 | -1): void {
        const step = Math.max(1, Math.floor(this.step()));
        const currentValue = this.parseFormattedValue(input.value);
        const nextValue = this.clampValue(currentValue + (step * direction));
        const nextDigits = `${nextValue}`;
        this.applyDigits(input, nextDigits, nextDigits.length);
    }

    private clampValue(value: number): number {
        return normalizeBoundedInteger(value, {
            min: this.min() ?? 0,
            max: this.max() ?? Number.MAX_SAFE_INTEGER,
        });
    }

    private deleteDigitAt(input: HTMLInputElement, digitIndex: number): void {
        const digits = this.extractDigits(input.value);
        if (digitIndex < 0 || digitIndex >= digits.length) {
            return;
        }

        const nextDigits = `${digits.slice(0, digitIndex)}${digits.slice(digitIndex + 1)}`;
        this.applyDigits(input, nextDigits, Math.min(digitIndex, nextDigits.length));
    }

    private applyDigits(input: HTMLInputElement, digits: string, caretDigitOffset: number): void {
        const formatted = this.formatDigits(digits);
        const normalizedCaretDigitOffset = Math.min(caretDigitOffset, this.countDigitsBefore(formatted, formatted.length));
        input.value = formatted;
        this.displayValue.set(formatted);
        this.valueChange.emit(this.parseDigits(digits));
        this.setCaret(input, this.findCaretPositionAfterDigits(formatted, normalizedCaretDigitOffset));
    }

    private extractDigits(value: string): string {
        return value.replace(/\D/g, '');
    }

    private formatNumberValue(value: number | null | undefined, emptyWhenZero: boolean): string {
        if (value === null || value === undefined || !Number.isFinite(value)) {
            return '';
        }

        const integerValue = this.clampValue(value);
        return integerValue === 0 && emptyWhenZero ? '' : this.formatDigits(`${integerValue}`);
    }

    private formatDigits(digits: string): string {
        if (!digits) {
            return '';
        }

        return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    private parseFormattedValue(value: string): number {
        return this.parseDigits(this.extractDigits(value));
    }

    private parseDigits(digits: string): number {
        if (!digits) {
            return 0;
        }

        const value = Number.parseInt(digits, 10);
        return Number.isFinite(value) ? value : 0;
    }

    private countDigitsBefore(value: string, caretPosition: number): number {
        let digitCount = 0;
        const limit = Math.max(0, Math.min(caretPosition, value.length));
        for (let index = 0; index < limit; index++) {
            if (/\d/.test(value[index])) {
                digitCount++;
            }
        }

        return digitCount;
    }

    private findCaretPositionAfterDigits(value: string, digitCount: number): number {
        if (digitCount <= 0) {
            return 0;
        }

        let seenDigits = 0;
        for (let index = 0; index < value.length; index++) {
            if (/\d/.test(value[index])) {
                seenDigits++;
                if (seenDigits >= digitCount) {
                    return index + 1;
                }
            }
        }

        return value.length;
    }

    private setCaret(input: HTMLInputElement, caretPosition: number): void {
        queueMicrotask(() => input.setSelectionRange(caretPosition, caretPosition));
    }
}
