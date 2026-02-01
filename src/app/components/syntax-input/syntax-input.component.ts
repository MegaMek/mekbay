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
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    ElementRef,
    input,
    output,
    signal,
    viewChild,
} from '@angular/core';

/** Token type for syntax highlighting */
export type HighlightTokenType =
    | 'key'
    | 'operator'
    | 'value'
    | 'keyword'
    | 'paren'
    | 'text'
    | 'whitespace'
    | 'rangeoperator'
    | 'qtyseparator'
    | 'suboperator'
    | 'error';

/** A token with type and value for rendering */
export interface HighlightToken {
    type: HighlightTokenType;
    value: string;
    start: number;
    end: number;
    errorMessage?: string;
}

/**
 * A single-line input with syntax highlighting overlay.
 * Uses the CSS Tricks approach: transparent text input over a pre/code element.
 */
@Component({
    selector: 'syntax-input',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="syntax-input-container">
            <pre #highlighting class="syntax-highlighting" aria-hidden="true"><code>@for (token of tokens(); track token.start) {<span class="hl-{{token.type}}" [title]="token.errorMessage || ''">{{token.value}}</span>}</code></pre>
            <input
                #inputEl
                class="bt-input syntax-input"
                [class.error]="hasErrors()"
                type="text"
                [disabled]="disabled()"
                [title]="errorTooltip()"
                [placeholder]="placeholder()"
                [value]="value()"
                (input)="onInput($event)"
                (scroll)="syncScroll()"
                (focus)="onFocus()"
                (blur)="onBlur()"
                autocomplete="off"
                spellcheck="false"
            />
            @if (showClear()) {
            <button
                class="clear-btn"
                type="button"
                (click)="onClear($event)"
                title="Clear"
                aria-label="Clear"
                tabindex="-1">
                &#10005;
            </button>
            }
        </div>
    `,
    styleUrl: './syntax-input.component.scss',
})
export class SyntaxInputComponent {
    /** The current value of the input */
    readonly value = input<string>('');

    /** Tokens for syntax highlighting */
    readonly tokens = input<HighlightToken[]>([]);

    /** Placeholder text */
    readonly placeholder = input<string>('');

    /** Whether the input is disabled */
    readonly disabled = input<boolean>(false);

    /** Whether to show the clear button (defaults to showing when value is non-empty) */
    readonly showClear = input<boolean, boolean | string>(false, {
        transform: (value: boolean | string) => value === true || value === ''
    });

    /** Emits when the input value changes */
    readonly valueChange = output<string>();

    /** Emits when the clear button is clicked */
    readonly cleared = output<void>();

    /** Emits when the input receives focus */
    readonly focused = output<void>();

    /** Emits when the input loses focus */
    readonly blurred = output<void>();

    private readonly inputEl = viewChild.required<ElementRef<HTMLInputElement>>('inputEl');
    private readonly highlighting = viewChild.required<ElementRef<HTMLPreElement>>('highlighting');

    /** Whether there are any error tokens */
    readonly hasErrors = computed(() => this.tokens().some(t => t.type === 'error'));

    /** Tooltip text for errors */
    readonly errorTooltip = computed(() => {
        const errors = this.tokens().filter(t => t.type === 'error' && t.errorMessage);
        if (errors.length === 0) return '';
        return errors.map(e => e.errorMessage).join('\n');
    });

    constructor() {
        // Sync scroll when tokens change (after DOM update)
        effect(() => {
            this.tokens(); // Track dependency
            requestAnimationFrame(() => this.syncScroll());
        });
    }

    /** Focus the input element (if no overlay/dialog is open) */
    focus() {
        // Don't focus if a CDK overlay/dialog is open - prevents aria-hidden accessibility warning
        const overlayContainer = document.querySelector('.cdk-overlay-container');
        if (overlayContainer && overlayContainer.children.length > 0) {
            return;
        }
        this.inputEl()?.nativeElement.focus();
    }

    /** Blur the input element */
    blur() {
        this.inputEl()?.nativeElement.blur();
    }

    /** Clear the input and focus */
    clear() {
        const input = this.inputEl()?.nativeElement;
        if (input) {
            input.value = '';
            this.valueChange.emit('');
        }
        this.focus();
    }

    onInput(event: Event) {
        const input = event.target as HTMLInputElement;
        this.valueChange.emit(input.value);
    }

    onFocus() {
        this.focused.emit();
    }

    onBlur() {
        this.blurred.emit();
    }

    /** Handle clear button click */
    onClear(event: Event) {
        event.preventDefault();
        event.stopPropagation();
        const input = this.inputEl()?.nativeElement;
        if (input) {
            input.value = '';
            this.valueChange.emit('');
        }
        this.cleared.emit();
        this.focus();
    }

    /** Sync scroll position between input and highlighting */
    syncScroll() {
        const input = this.inputEl()?.nativeElement;
        const pre = this.highlighting()?.nativeElement;
        if (input && pre) {
            const code = pre.querySelector('code');
            if (code) {
                code.scrollLeft = input.scrollLeft;
            }
        }
    }
}
