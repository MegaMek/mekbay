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

import { Component, ChangeDetectionStrategy, input, inject, computed, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Unit } from '../../../models/units.model';
import { DataService } from '../../../services/data.service';
import { compareUnitsByName } from '../../../utils/sort.util';
import { UnitCardExpandedComponent } from '../../unit-card-expanded/unit-card-expanded.component';
import { TagClickEvent } from '../../unit-tags/unit-tags.component';
import { SORT_OPTIONS } from '../../../services/unit-search-filters.service';
import { GameService } from '../../../services/game.service';

/**
 * State for the variants tab that can be persisted by parent components.
 */
export interface VariantsTabState {
    viewMode: 'expanded' | 'compact';
    sortKey: string;
    sortDirection: 'asc' | 'desc';
}

/** Default state for the variants tab */
export const DEFAULT_VARIANTS_TAB_STATE: VariantsTabState = {
    viewMode: 'expanded',
    sortKey: 'year',
    sortDirection: 'asc'
};

/**
 * Author: Drake
 * Component for the "Variants" tab in the Unit Details Dialog.
 */
@Component({
    selector: 'unit-details-variants-tab',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, UnitCardExpandedComponent],
    templateUrl: './unit-details-variants-tab.component.html',
    styleUrls: ['./unit-details-variants-tab.component.css']
})
export class UnitDetailsVariantsTabComponent {
    private dataService = inject(DataService);
    private gameService = inject(GameService);

    /** Sort options available for the current game system (excluding Relevance) */
    readonly SORT_OPTIONS = SORT_OPTIONS.filter(opt => opt.key !== '');

    /** The current unit to find variants for */
    unit = input.required<Unit>();

    /** Gunnery skill for BV/PV adjustment */
    gunnerySkill = input<number | undefined>(undefined);

    /** Piloting skill for BV adjustment */
    pilotingSkill = input<number | undefined>(undefined);

    /** Emitted when a variant card is clicked */
    variantClick = output<{ variant: Unit, variants: Unit[] }>();

    /** Emitted when the info button is clicked on a variant */
    variantInfoClick = output<Unit>();

    /** Emitted when a tag is clicked */
    tagClick = output<TagClickEvent>();

    /** Tab state passed from parent (view mode, sort key, sort direction) */
    state = input<VariantsTabState>(DEFAULT_VARIANTS_TAB_STATE);

    /** Emitted when any state property changes */
    stateChange = output<VariantsTabState>();

    /** Convenience getters for template */
    viewMode = computed(() => this.state().viewMode);
    selectedSort = computed(() => this.state().sortKey);
    selectedSortDirection = computed(() => this.state().sortDirection);

    /** Get the label for the currently selected sort option */
    selectedSortLabel = computed(() => {
        const key = this.selectedSort();
        const opt = this.SORT_OPTIONS.find(o => o.key === key);
        return opt?.label ?? null;
    });

    /** Toggle between expanded and compact view modes */
    toggleViewMode(): void {
        const newMode = this.viewMode() === 'expanded' ? 'compact' : 'expanded';
        this.stateChange.emit({ ...this.state(), viewMode: newMode });
    }

    /** Set the sort key */
    setSortOrder(key: string): void {
        this.stateChange.emit({ ...this.state(), sortKey: key });
    }

    /** Set the sort direction */
    setSortDirection(direction: 'asc' | 'desc'): void {
        this.stateChange.emit({ ...this.state(), sortDirection: direction });
    }

    /** Get the current game system for filtering sort options */
    gameSystem = computed(() => this.gameService.currentGameSystem());

    /** All variants of the same chassis (same type and chassis name) */
    variants = computed<Unit[]>(() => {
        const currentUnit = this.unit();
        if (!currentUnit) return [];

        const targetType = currentUnit.type;
        const targetChassis = currentUnit.chassis;
        const sortKey = this.selectedSort();
        const sortDir = this.selectedSortDirection();

        const filtered = this.dataService.getUnits()
            .filter(u => u.type === targetType && u.chassis === targetChassis);

        // Sort based on selected key
        return filtered.sort((a, b) => {
            let result = 0;
            const valA = this.getNestedProperty(a, sortKey);
            const valB = this.getNestedProperty(b, sortKey);
            if (typeof valA === 'number' && typeof valB === 'number') {
                result = valA - valB;
            } else if (typeof valA === 'string' && typeof valB === 'string') {
                result = valA.localeCompare(valB);
            } else {
                result = String(valA ?? '').localeCompare(String(valB ?? ''));
            }
            if (result == 0) {
                // Tiebreaker: sort by name
                result = compareUnitsByName(a, b);
            }
            return sortDir === 'desc' ? -result : result;
        });
    });

    /** Get a nested property value using dot notation (e.g., 'as.PV') */
    private getNestedProperty(obj: any, key: string): any {
        if (!obj || !key) return undefined;
        if (!key.includes('.')) return obj[key];
        const parts = key.split('.');
        let cur = obj;
        for (const p of parts) {
            if (cur == null) return undefined;
            cur = cur[p];
        }
        return cur;
    }

    /** Check if a variant is the current unit */
    isCurrentUnit(variant: Unit): boolean {
        return variant.name === this.unit()?.name;
    }

    onVariantClick(variant: Unit, variants: Unit[]): void {
        this.variantClick.emit({ variant, variants });
    }

    onTagClick(event: TagClickEvent): void {
        this.tagClick.emit(event);
    }
}
