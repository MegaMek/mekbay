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

import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { FormatNumberPipe } from '../../pipes/format-number.pipe';
import { GameSystem } from '../../models/common.model';
import { DialogsService } from '../../services/dialogs.service';
import { OptionsService } from '../../services/options.service';
import { DROPDOWN_FILTERS, RANGE_FILTERS } from '../../services/unit-search-filters.model';
import { UnitSearchFiltersService } from '../../services/unit-search-filters.service';
import { isFilterAvailableForAvailabilitySource } from '../../utils/unit-search-filter-config.util';
import { MultiSelectDropdownComponent } from '../multi-select-dropdown/multi-select-dropdown.component';
import { RangeSliderComponent } from '../range-slider/range-slider.component';
import { SemanticGuideComponent } from '../semantic-guide/semantic-guide.component';
import {
    type RangeModel,
    UnitSearchFilterRangeDialogComponent,
    type UnitSearchFilterRangeDialogData,
} from '../unit-search-filter-range-dialog/unit-search-filter-range-dialog.component';

@Component({
    selector: 'unit-search-advanced-filters',
    imports: [
        CommonModule,
        FormatNumberPipe,
        MultiSelectDropdownComponent,
        RangeSliderComponent,
        SemanticGuideComponent,
    ],
    templateUrl: './unit-search-advanced-filters.component.html',
    styleUrl: './unit-search-advanced-filters.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnitSearchAdvancedFiltersComponent {
    readonly filterGameSystem = input.required<GameSystem>();
    readonly excludedFilterKeys = input<readonly string[]>([]);
    readonly columnsCount = input<number>(1);
    readonly showAvailabilitySourceDisclaimer = input(true);

    readonly filtersService = inject(UnitSearchFiltersService);
    private readonly optionsService = inject(OptionsService);
    private readonly dialogsService = inject(DialogsService);

    readonly isComplexQuery = this.filtersService.isComplexQuery;
    readonly megaMekAvailabilitySourceSelected = computed(() => this.optionsService.options().availabilitySource === 'megamek');
    readonly gridTemplateColumns = computed(() => this.columnsCount() === 2 ? '1fr 1fr' : '1fr');

    private readonly excludedKeySet = computed(() => new Set(this.excludedFilterKeys()));

    readonly dropdownFilters = computed(() => {
        const gameSystem = this.filterGameSystem();
        const availabilitySource = this.optionsService.options().availabilitySource;
        const excludedKeys = this.excludedKeySet();

        return DROPDOWN_FILTERS.filter((filter) => (
            (!filter.game || filter.game === gameSystem)
            && isFilterAvailableForAvailabilitySource(filter, availabilitySource)
            && !excludedKeys.has(filter.key)
        ));
    });

    readonly rangeFilters = computed(() => {
        const gameSystem = this.filterGameSystem();
        const availabilitySource = this.optionsService.options().availabilitySource;
        const excludedKeys = this.excludedKeySet();

        return RANGE_FILTERS.filter((filter) => (
            (!filter.game || filter.game === gameSystem)
            && isFilterAvailableForAvailabilitySource(filter, availabilitySource)
            && !excludedKeys.has(filter.key)
        ));
    });

    setAdvFilter(key: string, value: unknown): void {
        this.filtersService.setFilter(key, value);
    }

    async openRangeValueDialog(filterKey: string, currentValue: number[], availableRange: [number, number]): Promise<void> {
        const currentFilter = this.filtersService.advOptions()[filterKey];
        if (!currentFilter || currentFilter.type !== 'range') {
            return;
        }

        const filterName = currentFilter.label || filterKey;
        const ref = this.dialogsService.createDialog<RangeModel | null>(UnitSearchFilterRangeDialogComponent, {
            data: {
                title: filterName,
                message: `Enter the ${filterName} range values:`,
                range: {
                    from: currentValue[0],
                    to: currentValue[1],
                },
            } as UnitSearchFilterRangeDialogData,
        });
        const newValues = await firstValueFrom(ref.closed);
        if (newValues === undefined || newValues === null) {
            return;
        }

        if (newValues.from === null && newValues.to === null) {
            this.filtersService.unsetFilter(filterKey);
            return;
        }

        let newFrom = newValues.from ?? 0;
        let newTo = newValues.to ?? Number.MAX_SAFE_INTEGER;
        if (newFrom < availableRange[0]) {
            newFrom = availableRange[0];
        } else if (newTo > availableRange[1]) {
            newTo = availableRange[1];
        }

        const currentRange = [...currentFilter.value] as [number, number];
        if (newFrom > currentRange[1]) {
            newFrom = currentRange[1];
        }
        currentRange[0] = newFrom;
        if (newTo < currentRange[0]) {
            newTo = currentRange[0];
        }
        currentRange[1] = newTo;

        this.setAdvFilter(filterKey, currentRange);
    }
}