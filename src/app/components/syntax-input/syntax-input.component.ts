// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    type ElementRef,
    input,
    output,
    type signal,
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
