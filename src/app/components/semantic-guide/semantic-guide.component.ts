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

import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameService } from '../../services/game.service';
import { ADVANCED_FILTERS, AdvFilterType } from '../../services/unit-search-filters.service';
import { GameSystem } from '../../models/common.model';

/*
 * Author: Drake
 */

interface FilterInfo {
    key: string;
    label: string;
    type: 'dropdown' | 'range' | 'semantic';
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

    /** Whether to show a compact version (fewer examples, collapsible sections) */
    compact = input(false);

    gameSystem = this.gameService.currentGameSystem;
    isAlphaStrike = this.gameService.isAlphaStrike;

    /** Get filters for a specific game system */
    private getFiltersForSystem(gs: GameSystem | null): FilterInfo[] {
        return ADVANCED_FILTERS
            .filter(f => !f.game || f.game === gs)
            .map(f => {
                let type: 'dropdown' | 'range' | 'semantic';
                if (f.type === AdvFilterType.RANGE) {
                    type = 'range';
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
    cbtDropdownFilters = computed(() => this.cbtFilters().filter(f => f.type === 'dropdown'));
    cbtRangeFilters = computed(() => this.cbtFilters().filter(f => f.type === 'range'));

    /** Filters available for Alpha Strike */
    asFilters = computed<FilterInfo[]>(() => this.getFiltersForSystem(GameSystem.ALPHA_STRIKE));
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
