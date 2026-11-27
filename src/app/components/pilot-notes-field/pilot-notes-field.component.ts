// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, model } from '@angular/core';
import { FORCE_PERSON_NOTES_MAX_LENGTH } from '../../models/force-personnel';

/** Notes are edited here and never included in a crew card or selector. */
@Component({
    selector: 'pilot-notes-field',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <div class="form-fields">
        <label class="field-label">
            Notes
            <textarea class="field-input" rows="2" autocomplete="off"
                [value]="value()" [attr.maxlength]="limit" placeholder="Add notes about this crew member..."
                (input)="onInput($event)"></textarea>
        </label>
        @if (showCounter()) {
            <div class="field-meta">
                <span class="field-limit">Max {{ limit }} characters</span>
                <span class="field-counter">{{ value().length }}/{{ limit }}</span>
            </div>
        }
    </div>
    `,
    styles: [`
        :host { display: block; width: 100%; }
        label { display: flex; flex-direction: column; gap: 6px; }
        textarea { box-sizing: border-box; width: 100%; resize: vertical; min-height: 52px; }
        .notes-meta { display: flex; justify-content: space-between; gap: 12px; margin-top: 4px;
            color: var(--text-color-secondary); font-size: .75em; }
            

        .field-meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 1rem;
            margin-top: 0.35rem;
            font-size: 0.78em;
            opacity: 0.72;
        }

        .field-counter {
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
        }
    `],
})
export class PilotNotesFieldComponent {
    readonly value = model('');
    readonly limit = FORCE_PERSON_NOTES_MAX_LENGTH;
    readonly showCounter = computed(() => this.value().length >= this.limit * .9);

    onInput(event: Event): void {
        const input = event.target as HTMLTextAreaElement;
        const value = input.value.slice(0, this.limit);
        if (input.value !== value) input.value = value;
        this.value.set(value);
    }
}
