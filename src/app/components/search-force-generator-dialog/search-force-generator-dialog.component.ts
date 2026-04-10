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
import { DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { GameSystem } from '../../models/common.model';
import type { Era } from '../../models/eras.model';
import type { Faction } from '../../models/factions.model';
import { MULFACTION_EXTINCT, MULFACTION_MERCENARY } from '../../models/mulfactions.model';
import type { LoadForceEntry } from '../../models/load-force-entry.model';
import type { AvailabilitySource } from '../../models/options.model';
import type { Unit } from '../../models/units.model';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { LoadForcePreviewPanelComponent } from '../load-force-preview-panel/load-force-preview-panel.component';
import { MultiSelectDropdownComponent, type MultiStateSelection } from '../multi-select-dropdown/multi-select-dropdown.component';
import { DataService } from '../../services/data.service';
import { ForceGeneratorService } from '../../services/force-generator.service';
import { GameService } from '../../services/game.service';
import { OptionsService } from '../../services/options.service';
import type { AdvFilterOptions, DropdownFilterOptions } from '../../services/unit-search-filters.model';
import { UnitSearchFiltersService } from '../../services/unit-search-filters.service';
import { UnitAvailabilitySourceService } from '../../services/unit-availability-source.service';
import { getPositiveFactionNamesFromFilter } from '../../utils/faction-filter.util';

export interface SearchForceGeneratorDialogConfig {
    gameSystem: GameSystem;
    availabilitySource: AvailabilitySource;
    bvPvLimit: number;
    minUnitCount: number;
    maxUnitCount: number;
}

export interface SearchForceGeneratorDialogResult {
    forceEntry: LoadForceEntry;
    config: SearchForceGeneratorDialogConfig;
    totalCost: number;
}

function getDefaultMinUnitCount(eligibleUnitCount: number): number {
    return Math.max(1, Math.min(4, eligibleUnitCount || 1));
}

function getDefaultMaxUnitCount(eligibleUnitCount: number, minUnitCount: number): number {
    return Math.max(minUnitCount, Math.min(8, Math.max(eligibleUnitCount, minUnitCount)));
}

@Component({
    selector: 'search-force-generator-dialog',
    standalone: true,
    imports: [CommonModule, BaseDialogComponent, LoadForcePreviewPanelComponent, MultiSelectDropdownComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './search-force-generator-dialog.component.html',
    styleUrls: ['./search-force-generator-dialog.component.scss'],
})
export class SearchForceGeneratorDialogComponent {
    readonly GameSystem = GameSystem;
    private readonly dialogRef = inject(DialogRef<SearchForceGeneratorDialogResult | null>);
    readonly dataService = inject(DataService);
    private readonly forceGeneratorService = inject(ForceGeneratorService);
    readonly gameService = inject(GameService);
    private readonly optionsService = inject(OptionsService);
    readonly filtersService = inject(UnitSearchFiltersService);
    private readonly unitAvailabilitySource = inject(UnitAvailabilitySourceService);
    private readonly initialBudgetLimits = this.forceGeneratorService.resolveInitialBudgetLimits(
        this.optionsService.options(),
        this.filtersService.bvPvLimit(),
        this.gameService.currentGameSystem(),
    );

    readonly gameSystem = this.gameService.currentGameSystem;
    readonly availabilitySource = computed(() => this.optionsService.options().availabilitySource);
    readonly eligibleUnits = this.filtersService.filteredUnits;
    readonly pilotGunnerySkill = computed(() => this.filtersService.pilotGunnerySkill());
    readonly pilotPilotingSkill = computed(() => this.filtersService.pilotPilotingSkill());
    readonly eraFilter = computed(() => this.getDropdownFilter('era'));
    readonly factionFilter = computed(() => this.getDropdownFilter('faction'));
    readonly tagsFilter = computed(() => this.getDropdownFilter('_tags'));
    readonly selectedEraValues = computed(() => {
        const value = this.eraFilter()?.value;
        return Array.isArray(value) ? [...value] : [];
    });
    readonly selectedFactionValues = computed(() => {
        const value = this.factionFilter()?.value;
        return Array.isArray(value) ? {} : (value as MultiStateSelection | undefined) ?? {};
    });
    readonly selectedTagValues = computed(() => {
        const value = this.tagsFilter()?.value;
        return Array.isArray(value) ? {} : (value as MultiStateSelection | undefined) ?? {};
    });
    readonly descriptionLines = computed(() => {
        const lines = [];
        const query = this.filtersService.searchText().trim();
        if (query.length > 0) {
            lines.push(`Query: ${query}`);
        }

        const filterSummary = this.summarizeActiveFilters();
        if (filterSummary.length > 0) {
            lines.push(`Filters: ${filterSummary}`);
        }

        const skillLabel = this.gameSystem() === GameSystem.ALPHA_STRIKE
            ? `Pilot Skill ${this.pilotGunnerySkill()}`
            : `Gunnery ${this.pilotGunnerySkill()} Piloting ${this.pilotPilotingSkill()}`;
        lines.push(`${skillLabel}`);

        const contextParts = [this.selectedFactionForGeneration()?.name, this.selectedEraForGeneration()?.name].filter(Boolean);
        if (contextParts.length > 0) {
            lines.push(`Generation Context: ${contextParts.join(' - ')}.`);
        }

        return lines;
    });
    readonly classicBudgetLimit = signal(this.initialBudgetLimits.classicLimit);
    readonly alphaStrikeBudgetLimit = signal(this.initialBudgetLimits.alphaStrikeLimit);
    readonly bvPvLimit = computed(() => this.gameSystem() === GameSystem.ALPHA_STRIKE ? this.alphaStrikeBudgetLimit() : this.classicBudgetLimit());
    readonly minUnitCount = signal(getDefaultMinUnitCount(this.eligibleUnits().length));
    readonly maxUnitCount = signal(getDefaultMaxUnitCount(this.eligibleUnits().length, this.minUnitCount()));
    readonly rerollRevision = signal(0);
    readonly generationContext = computed(() => {
        const gameSystem = this.gameSystem();
        return {
            gameSystem,
            budgetLimit: gameSystem === GameSystem.ALPHA_STRIKE ? this.alphaStrikeBudgetLimit() : this.classicBudgetLimit(),
            gunnery: this.pilotGunnerySkill(),
            piloting: this.pilotPilotingSkill(),
            minUnitCount: this.minUnitCount(),
            maxUnitCount: this.maxUnitCount(),
        };
    });
    readonly selectedEraForGeneration = computed(() => {
        const filterState = this.filtersService.effectiveFilterState()['era'];
        if (!filterState?.interactedWith || !Array.isArray(filterState.value) || filterState.value.length === 0) {
            return null;
        }

        return this.dataService.getEraByName(filterState.value[0]) ?? null;
    });
    readonly selectedFactionForGeneration = computed(() => {
        this.rerollRevision();

        const fallbackFaction = this.dataService.getFactionById(MULFACTION_MERCENARY) ?? null;
        const filterState = this.filtersService.effectiveFilterState()['faction'];
        if (!filterState?.interactedWith || !filterState.value) {
            return null;
        }

        const allFactionNames = this.dataService.getFactions().map((faction) => faction.name);
        const selectedFactionNames = getPositiveFactionNamesFromFilter(
            filterState.value as MultiStateSelection,
            allFactionNames,
            filterState.wildcardPatterns,
        );
        const candidateFactions = selectedFactionNames
            .map((name) => this.dataService.getFactionByName(name))
            .filter((faction): faction is Faction => !!faction && faction.id !== MULFACTION_EXTINCT);

        if (candidateFactions.length === 0) {
            return fallbackFaction;
        }

        return candidateFactions[Math.floor(Math.random() * candidateFactions.length)] ?? fallbackFaction;
    });
    readonly preview = computed(() => {
        this.rerollRevision();
        const context = this.generationContext();

        return this.forceGeneratorService.buildPreview({
            eligibleUnits: this.eligibleUnits(),
            gameSystem: context.gameSystem,
            budgetLimit: context.budgetLimit,
            minUnitCount: context.minUnitCount,
            maxUnitCount: context.maxUnitCount,
            gunnery: context.gunnery,
            piloting: context.piloting,
            getWeight: (unit) => this.getUnitWeight(unit),
        });
    });
    readonly previewEntry = computed(() => {
        const context = this.generationContext();
        const preview = this.preview();
        if (preview.error || preview.units.length === 0) {
            return null;
        }

        return this.forceGeneratorService.createForceEntry({
            units: preview.units,
            totalCost: preview.totalCost,
            gameSystem: context.gameSystem,
            faction: this.selectedFactionForGeneration(),
            era: this.selectedEraForGeneration(),
            gunnery: context.gunnery,
            piloting: context.piloting,
        });
    });

    budgetFieldLabel(): string {
        return this.gameSystem() === GameSystem.ALPHA_STRIKE ? 'PV Limit' : 'BV Limit';
    }

    onAvailabilitySourceChange(event: Event): void {
        const value = (event.target as HTMLSelectElement).value;
        void this.optionsService.setOption('availabilitySource', value === 'megamek' ? 'megamek' : 'mul');
    }

    onEraSelectionChange(selection: MultiStateSelection | readonly string[]): void {
        this.filtersService.setFilter('era', Array.isArray(selection) ? [...selection] : []);
    }

    onFactionSelectionChange(selection: MultiStateSelection | readonly string[]): void {
        this.filtersService.setFilter('faction', Array.isArray(selection) ? {} : selection);
    }

    onTagsSelectionChange(selection: MultiStateSelection | readonly string[]): void {
        this.filtersService.setFilter('_tags', Array.isArray(selection) ? {} : selection);
    }

    onBudgetLimitChange(event: Event): void {
        this.setBudgetLimitForSystem(this.gameSystem(), this.parseNumericValue(event, this.bvPvLimit()));
    }

    onMinUnitCountChange(event: Event): void {
        const nextValue = Math.max(1, this.parseNumericValue(event, this.minUnitCount()));
        this.minUnitCount.set(nextValue);
        if (this.maxUnitCount() < nextValue) {
            this.maxUnitCount.set(nextValue);
        }
    }

    onMaxUnitCountChange(event: Event): void {
        const nextValue = Math.max(1, this.parseNumericValue(event, this.maxUnitCount()));
        this.maxUnitCount.set(nextValue);
        if (this.minUnitCount() > nextValue) {
            this.minUnitCount.set(nextValue);
        }
    }

    reroll(): void {
        this.rerollRevision.update((value) => value + 1);
    }

    submit(): void {
        const previewEntry = this.previewEntry();
        const preview = this.preview();
        if (!previewEntry || preview.error) {
            return;
        }

        this.dialogRef.close({
            forceEntry: previewEntry,
            config: {
                gameSystem: this.gameSystem(),
                availabilitySource: this.availabilitySource(),
                bvPvLimit: this.bvPvLimit(),
                minUnitCount: this.minUnitCount(),
                maxUnitCount: this.maxUnitCount(),
            },
            totalCost: preview.totalCost,
        });
    }

    dismiss(): void {
        this.dialogRef.close(null);
    }

    private getUnitWeight(unit: Unit): number {
        const faction = this.selectedFactionForGeneration();
        const era = this.selectedEraForGeneration();
        if (this.availabilitySource() !== 'megamek' || !faction || !era) {
            return 1;
        }

        return this.unitAvailabilitySource.getUnitAvailabilityWeight(
            unit,
            faction,
            era,
            this.availabilitySource(),
        ) ?? 1;
    }

    private getDropdownFilter(key: string): DropdownFilterOptions | null {
        const option = this.filtersService.advOptions()[key];
        return option?.type === 'dropdown' ? option : null;
    }

    private summarizeActiveFilters(): string {
        const summaries = Object.values(this.filtersService.advOptions())
            .filter((option) => option.interacted)
            .map((option) => this.formatFilterSummary(option))
            .filter((summary): summary is string => summary.length > 0);

        if (summaries.length === 0) {
            return '';
        }

        const visibleSummaries = summaries.slice(0, 4);
        const hiddenCount = summaries.length - visibleSummaries.length;
        return hiddenCount > 0
            ? `${visibleSummaries.join(' | ')} | +${hiddenCount} more`
            : visibleSummaries.join(' | ');
    }

    private formatFilterSummary(option: AdvFilterOptions): string {
        if (option.type === 'range') {
            const [min, max] = option.value;
            return `${option.label} ${option.displayText ?? `${min}-${max}`}`;
        }

        if (option.displayText) {
            return `${option.label} ${option.displayText}`;
        }

        if (Array.isArray(option.value)) {
            if (option.value.length === 0) {
                return '';
            }

            const visibleValues = option.value.slice(0, 2);
            const hiddenCount = option.value.length - visibleValues.length;
            return `${option.label} ${visibleValues.join(', ')}${hiddenCount > 0 ? ` +${hiddenCount}` : ''}`;
        }

        const activeSelections = Object.values(option.value as MultiStateSelection)
            .filter((selection) => selection.state !== false)
            .map((selection) => selection.state === 'not' ? `!${selection.name}` : selection.name);
        if (activeSelections.length === 0) {
            return '';
        }

        const visibleSelections = activeSelections.slice(0, 2);
        const hiddenCount = activeSelections.length - visibleSelections.length;
        return `${option.label} ${visibleSelections.join(', ')}${hiddenCount > 0 ? ` +${hiddenCount}` : ''}`;
    }

    private setBudgetLimitForSystem(gameSystem: GameSystem, value: number): void {
        const nextValue = Math.max(0, value);
        if (gameSystem === GameSystem.ALPHA_STRIKE) {
            if (this.alphaStrikeBudgetLimit() === nextValue) {
                return;
            }

            this.alphaStrikeBudgetLimit.set(nextValue);
        } else {
            if (this.classicBudgetLimit() === nextValue) {
                return;
            }

            this.classicBudgetLimit.set(nextValue);
        }

        void this.optionsService.setOption(this.forceGeneratorService.getStoredBudgetOptionKey(gameSystem), nextValue);
    }

    private parseNumericValue(event: Event, fallback: number): number {
        const value = Number.parseInt((event.target as HTMLInputElement).value, 10);
        return Number.isFinite(value) ? value : fallback;
    }
}