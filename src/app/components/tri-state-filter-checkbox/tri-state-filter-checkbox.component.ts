/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { normalizeTriStateBooleanFilterValue, type TriStateBooleanFilterValue } from '../../services/unit-search-filters.model';


/**
 * Author: Drake
 * 
 * A tri-state checkbox component.
 */
@Component({
    selector: 'tri-state-filter-checkbox',
    standalone: true,
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