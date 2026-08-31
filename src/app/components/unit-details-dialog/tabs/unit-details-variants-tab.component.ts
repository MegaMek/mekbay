// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, ChangeDetectionStrategy, input, inject, computed, output } from '@angular/core';
import type { UnitSummary } from '../../../models/unit-summary.model';
import { DataService } from '../../../services/data.service';
import { compareUnitsByName, naturalCompare } from '../../../utils/sort.util';
import { UnitCardExpandedComponent } from '../../unit-card-expanded/unit-card-expanded.component';
import type { TagClickEvent } from '../../unit-tags/unit-tags.component';
import { isMegaMekRaritySortKey, SORT_OPTIONS } from '../../../services/unit-search-filters.model';
import { GameService } from '../../../services/game.service';
import { OptionsService } from '../../../services/options.service';
import { isSameVariantGroup } from '../../../utils/unit-variant.util';

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
 * Component for the "Variants" tab in the Unit Details Dialog.
 */
@Component({
    selector: 'unit-details-variants-tab',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [UnitCardExpandedComponent],
    templateUrl: './unit-details-variants-tab.component.html',
    styleUrl: './unit-details-variants-tab.component.css'
})
export class UnitDetailsVariantsTabComponent {
    private dataService = inject(DataService);
    private gameService = inject(GameService);
    private optionsService = inject(OptionsService);

    /** Sort options available for the current game system (excluding Relevance) */
    readonly SORT_OPTIONS = SORT_OPTIONS.filter(opt => opt.key !== '' && !isMegaMekRaritySortKey(opt.key));

    /** The current unit to find variants for */
    unit = input.required<UnitSummary>();

    /** Gunnery skill for BV/PV adjustment */
    gunnerySkill = input<number | undefined>(undefined);

    /** Piloting skill for BV adjustment */
    pilotingSkill = input<number | undefined>(undefined);

    /** Emitted when a variant card is clicked */
    variantClick = output<{ variant: UnitSummary, variants: UnitSummary[] }>();

    /** Emitted when the info button is clicked on a variant */
    variantInfoClick = output<UnitSummary>();

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
    readonly useHex = computed<boolean>(() => this.optionsService.options().ASUseHex);

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

    /** All variants of the same chassis (same type, subtype and chassis name) */
    variants = computed<UnitSummary[]>(() => {
        const currentUnit = this.unit();
        if (!currentUnit) return [];

        const sortKey = this.selectedSort();
        const sortDir = this.selectedSortDirection();

        const filtered = this.dataService.getUnits()
            .filter(u => isSameVariantGroup(u, currentUnit));

        // Sort based on selected key
        return filtered.sort((a, b) => {
            let result = 0;
            const valA = this.getNestedProperty(a, sortKey);
            const valB = this.getNestedProperty(b, sortKey);
            if (typeof valA === 'number' && typeof valB === 'number') {
                result = valA - valB;
            } else if (typeof valA === 'string' && typeof valB === 'string') {
                result = naturalCompare(valA, valB);
            } else {
                result = naturalCompare(String(valA ?? ''), String(valB ?? ''));
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
    isCurrentUnit(variant: UnitSummary): boolean {
        return variant.name === this.unit()?.name;
    }

    onVariantClick(variant: UnitSummary, variants: UnitSummary[]): void {
        this.variantClick.emit({ variant, variants });
    }

    onTagClick(event: TagClickEvent): void {
        this.tagClick.emit(event);
    }
}
