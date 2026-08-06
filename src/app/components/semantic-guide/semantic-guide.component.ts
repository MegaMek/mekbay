// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameService } from '../../services/game.service';
import { ADVANCED_FILTERS, AdvFilterType } from '../../services/unit-search-filters.model';
import { GameSystem } from '../../models/common.model';
import { UnitSearchFiltersService } from '../../services/unit-search-filters.service';



interface FilterInfo {
    key: string;
    label: string;
    type: 'dropdown' | 'range' | 'boolean' | 'semantic';
    multistate?: boolean;
    countable?: boolean;
}

/**
 * Standalone semantic guide component that displays filter syntax help.
 * Can be used inside dialogs or embedded directly in other components.
 */
@Component({
    selector: 'semantic-guide',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    templateUrl: './semantic-guide.component.html',
    styleUrl: './semantic-guide.component.scss'
})
export class SemanticGuideComponent {
    private gameService = inject(GameService);
    private filtersService = inject(UnitSearchFiltersService);

    /** Whether to show a compact version (fewer examples, collapsible sections) */
    compact = input(false);

    gameSystem = this.gameService.currentGameSystem;
    isAlphaStrike = this.gameService.isAlphaStrike;

    /**
     * Append an example filter to the current search text.
     */
    appendToSearch(filterText: string): void {
        const current = this.filtersService.searchText().trim();
        const newText = current ? `${current} ${filterText}` : filterText;
        this.filtersService.setSearchText(newText);
    }

    /** Get filters for a specific game system */
    private getFiltersForSystem(gs: GameSystem | null): FilterInfo[] {
        return ADVANCED_FILTERS
            .filter(f => !f.game || f.game === gs)
            .map(f => {
                let type: FilterInfo['type'];
                if (f.type === AdvFilterType.RANGE) {
                    type = 'range';
                } else if (f.type === AdvFilterType.BOOLEAN) {
                    type = 'boolean';
                } else if (f.type === AdvFilterType.SEMANTIC) {
                    type = 'semantic';
                } else {
                    type = 'dropdown';
                }
                return {
                    key: f.semanticKey || f.key,
                    label: f.label,
                    type,
                    multistate: f.multistate,
                    countable: f.countable
                };
            })
            .sort((a, b) => a.key.localeCompare(b.key));
    }

    /** Filters available for Classic BattleTech */
    cbtFilters = computed<FilterInfo[]>(() => this.getFiltersForSystem(GameSystem.CLASSIC));
    cbtBooleanFilters = computed(() => this.cbtFilters().filter(f => f.type === 'boolean'));
    cbtDropdownFilters = computed(() => this.cbtFilters().filter(f => f.type === 'dropdown'));
    cbtRangeFilters = computed(() => this.cbtFilters().filter(f => f.type === 'range'));

    /** Filters available for Alpha Strike */
    asFilters = computed<FilterInfo[]>(() => this.getFiltersForSystem(GameSystem.ALPHA_STRIKE));
    asBooleanFilters = computed(() => this.asFilters().filter(f => f.type === 'boolean'));
    asDropdownFilters = computed(() => this.asFilters().filter(f => f.type === 'dropdown'));
    asRangeFilters = computed(() => {
        const ranges = this.asFilters().filter(f => f.type === 'range');
        // Add virtual 'dmg' filter for damage shorthand (dmg=2/3/1/0)
        ranges.push({
            key: 'dmg',
            label: 'Damage (S/M/L/E)',
            type: 'range'
        });
        return ranges.sort((a, b) => a.key.localeCompare(b.key));
    });

    /** Semantic-only filters (shared across game systems) */
    semanticFilters = computed(() => {
        const all = [...this.asFilters(), ...this.cbtFilters()];
        const seen = new Set<string>();
        return all.filter(f => f.type === 'semantic' && !seen.has(f.key) && seen.add(f.key));
    });

    /** Multistate and countable filters (shared) */
    multistateFilters = computed(() => {
        const all = [...this.asFilters(), ...this.cbtFilters()];
        const seen = new Set<string>();
        return all.filter(f => f.multistate && !seen.has(f.key) && seen.add(f.key));
    });
    countableFilters = computed(() => {
        const all = [...this.asFilters(), ...this.cbtFilters()];
        const seen = new Set<string>();
        return all.filter(f => f.countable && !seen.has(f.key) && seen.add(f.key));
    });
}
