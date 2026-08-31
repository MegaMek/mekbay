// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { normalizeTriStateBooleanFilterValue, type TriStateBooleanFilterValue } from '../../services/unit-search-filters.model';

/**
 * 
 * A tri-state checkbox component.
 */
@Component({
    selector: 'tri-state-filter-checkbox',
    templateUrl: './tri-state-filter-checkbox.component.html',
    styleUrl: './tri-state-filter-checkbox.component.css',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TriStateFilterCheckboxComponent {
    readonly label = input.required<string>();
    readonly value = input<TriStateBooleanFilterValue>(null);
    readonly semanticOnly = input(false);
    readonly valueChange = output<TriStateBooleanFilterValue>();

    readonly normalizedValue = computed(() => normalizeTriStateBooleanFilterValue(this.value()));
    readonly stateLabel = computed(() => {
        switch (this.normalizedValue()) {
            case 'or':
                return 'Yes';
            case 'not':
                return 'No';
            default:
                return 'Any';
        }
    });
    readonly ariaChecked = computed(() => {
        switch (this.normalizedValue()) {
            case 'or':
                return 'true';
            case 'not':
                return 'mixed';
            default:
                return 'false';
        }
    });

    toggle(): void {
        if (this.semanticOnly()) {
            return;
        }

        const nextValue: TriStateBooleanFilterValue = this.normalizedValue() === null
            ? 'or'
            : this.normalizedValue() === 'or'
                ? 'not'
                : null;

        this.valueChange.emit(nextValue);
    }
}
