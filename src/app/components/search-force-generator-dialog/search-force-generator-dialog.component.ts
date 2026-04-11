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
import { MAX_UNITS as FORCE_MAX_UNITS } from '../../models/force.model';
import type { LoadForceEntry } from '../../models/load-force-entry.model';
import type { AvailabilitySource } from '../../models/options.model';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { LoadForcePreviewPanelComponent } from '../load-force-preview-panel/load-force-preview-panel.component';
import { MultiSelectDropdownComponent, type MultiStateSelection } from '../multi-select-dropdown/multi-select-dropdown.component';
import { DataService } from '../../services/data.service';
import { ForceGeneratorService } from '../../services/force-generator.service';
import { GameService } from '../../services/game.service';
import { OptionsService } from '../../services/options.service';
import type { AdvFilterOptions, DropdownFilterOptions } from '../../services/unit-search-filters.model';
import { UnitSearchFiltersService } from '../../services/unit-search-filters.service';

export interface SearchForceGeneratorDialogConfig {
    gameSystem: GameSystem;
    availabilitySource: AvailabilitySource;
    budgetRange: {
        min: number;
        max: number;
    };
    minUnitCount: number;
    maxUnitCount: number;
}

export interface SearchForceGeneratorDialogResult {
    forceEntry: LoadForceEntry;
    config: SearchForceGeneratorDialogConfig;
    totalCost: number;
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
    readonly MAX_UNITS = FORCE_MAX_UNITS;
    private readonly dialogRef = inject(DialogRef<SearchForceGeneratorDialogResult | null>);
    readonly dataService = inject(DataService);
    private readonly forceGeneratorService = inject(ForceGeneratorService);
    readonly gameService = inject(GameService);
    private readonly optionsService = inject(OptionsService);
    readonly filtersService = inject(UnitSearchFiltersService);
    private readonly initialBudgetDefaults = this.forceGeneratorService.resolveInitialBudgetDefaults(
        this.optionsService.options(),
        this.filtersService.bvPvLimit(),
        this.gameService.currentGameSystem(),
    );
    private readonly initialUnitCountDefaults = this.forceGeneratorService.resolveInitialUnitCountDefaults(
        this.optionsService.options(),
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

        const generationContext = this.resolvedGenerationContext();
        const contextParts = [generationContext.forceFaction?.name, generationContext.forceEra?.name].filter(Boolean);
        if (contextParts.length > 0) {
            lines.push(`Generation Context: ${contextParts.join(' - ')}.`);
        }

        return lines;
    });
    readonly classicBudgetMin = signal(this.initialBudgetDefaults.classic.min);
    readonly classicBudgetMax = signal(this.initialBudgetDefaults.classic.max);
    readonly alphaStrikeBudgetMin = signal(this.initialBudgetDefaults.alphaStrike.min);
    readonly alphaStrikeBudgetMax = signal(this.initialBudgetDefaults.alphaStrike.max);
    readonly budgetRange = computed(() => this.gameSystem() === GameSystem.ALPHA_STRIKE
        ? { min: this.alphaStrikeBudgetMin(), max: this.alphaStrikeBudgetMax() }
        : { min: this.classicBudgetMin(), max: this.classicBudgetMax() });
    readonly minUnitCount = signal(this.initialUnitCountDefaults.min);
    readonly maxUnitCount = signal(this.initialUnitCountDefaults.max);
    readonly rerollRevision = signal(0);
    readonly collapsedHowPicksWhereChosen = signal(false);
    readonly generationSettings = computed(() => {
        const gameSystem = this.gameSystem();
        return {
            gameSystem,
            budgetRange: gameSystem === GameSystem.ALPHA_STRIKE
                ? { min: this.alphaStrikeBudgetMin(), max: this.alphaStrikeBudgetMax() }
                : { min: this.classicBudgetMin(), max: this.classicBudgetMax() },
            gunnery: this.pilotGunnerySkill(),
            piloting: this.pilotPilotingSkill(),
            minUnitCount: this.minUnitCount(),
            maxUnitCount: this.maxUnitCount(),
        };
    });
    readonly resolvedGenerationContext = computed(() => {
        this.rerollRevision();
        return this.forceGeneratorService.resolveGenerationContext(this.eligibleUnits());
    });
    readonly preview = computed(() => {
        const generationContext = this.resolvedGenerationContext();
        const settings = this.generationSettings();

        return this.forceGeneratorService.buildPreview({
            eligibleUnits: this.eligibleUnits(),
            context: generationContext,
            gameSystem: settings.gameSystem,
            budgetRange: settings.budgetRange,
            minUnitCount: settings.minUnitCount,
            maxUnitCount: settings.maxUnitCount,
            gunnery: settings.gunnery,
            piloting: settings.piloting,
        });
    });
    readonly previewEntry = computed(() => {
        const preview = this.preview();
        return this.forceGeneratorService.createForceEntry(preview);
    });

    budgetMinimumFieldLabel(): string {
        return this.gameSystem() === GameSystem.ALPHA_STRIKE ? 'Min PV' : 'Min BV';
    }

    budgetMaximumFieldLabel(): string {
        return this.gameSystem() === GameSystem.ALPHA_STRIKE ? 'Max PV' : 'Max BV';
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

    onBudgetMinChange(event: Event): void {
        this.setBudgetRangeForSystem(
            this.gameSystem(),
            this.forceGeneratorService.resolveBudgetRangeForEditedMin(
                this.budgetRange(),
                this.parseNumericValue(event, this.budgetRange().min),
            ),
        );
    }

    onBudgetMaxChange(event: Event): void {
        this.setBudgetRangeForSystem(
            this.gameSystem(),
            this.forceGeneratorService.resolveBudgetRangeForEditedMax(
                this.budgetRange(),
                this.parseNumericValue(event, this.budgetRange().max),
            ),
        );
    }

    onMinUnitCountChange(event: Event): void {
        this.setUnitCountRange(this.forceGeneratorService.resolveUnitCountRangeForEditedMin(
            {
                min: this.minUnitCount(),
                max: this.maxUnitCount(),
            },
            this.parseNumericValue(event, this.minUnitCount()),
        ));
    }

    onMaxUnitCountChange(event: Event): void {
        this.setUnitCountRange(this.forceGeneratorService.resolveUnitCountRangeForEditedMax(
            {
                min: this.minUnitCount(),
                max: this.maxUnitCount(),
            },
            this.parseNumericValue(event, this.maxUnitCount()),
        ));
    }

    onMinUnitCountBlur(event: Event): void {
        this.syncInputValue(event, this.minUnitCount());
    }

    onMaxUnitCountBlur(event: Event): void {
        this.syncInputValue(event, this.maxUnitCount());
    }

    reroll(): void {
        this.rerollRevision.update((value) => value + 1);
    }

    toggleHowPicksWereChosen(): void {
        this.collapsedHowPicksWhereChosen.update((value) => !value);
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
                budgetRange: this.budgetRange(),
                minUnitCount: this.minUnitCount(),
                maxUnitCount: this.maxUnitCount(),
            },
            totalCost: preview.totalCost,
        });
    }

    dismiss(): void {
        this.dialogRef.close(null);
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

    private setBudgetRangeForSystem(gameSystem: GameSystem, range: { min: number; max: number }): void {
        const nextMin = Math.max(0, Math.floor(range.min));
        const nextMax = Math.max(0, Math.floor(range.max));
        const optionKeys = this.forceGeneratorService.getStoredBudgetOptionKeys(gameSystem);

        if (gameSystem === GameSystem.ALPHA_STRIKE) {
            const didChangeMin = this.alphaStrikeBudgetMin() !== nextMin;
            const didChangeMax = this.alphaStrikeBudgetMax() !== nextMax;
            if (!didChangeMin && !didChangeMax) {
                return;
            }

            this.alphaStrikeBudgetMin.set(nextMin);
            this.alphaStrikeBudgetMax.set(nextMax);

            if (didChangeMin) {
                void this.optionsService.setOption(optionKeys.min, nextMin);
            }
            if (didChangeMax) {
                void this.optionsService.setOption(optionKeys.max, nextMax);
            }
        } else {
            const didChangeMin = this.classicBudgetMin() !== nextMin;
            const didChangeMax = this.classicBudgetMax() !== nextMax;
            if (!didChangeMin && !didChangeMax) {
                return;
            }

            this.classicBudgetMin.set(nextMin);
            this.classicBudgetMax.set(nextMax);

            if (didChangeMin) {
                void this.optionsService.setOption(optionKeys.min, nextMin);
            }
            if (didChangeMax) {
                void this.optionsService.setOption(optionKeys.max, nextMax);
            }
        }
    }

    private setUnitCountRange(range: { min: number; max: number }): void {
        const nextMin = Math.max(1, Math.floor(range.min));
        const nextMax = Math.max(nextMin, Math.floor(range.max));
        const optionKeys = this.forceGeneratorService.getStoredUnitCountOptionKeys();
        const didChangeMin = this.minUnitCount() !== nextMin;
        const didChangeMax = this.maxUnitCount() !== nextMax;

        if (!didChangeMin && !didChangeMax) {
            return;
        }

        this.minUnitCount.set(nextMin);
        this.maxUnitCount.set(nextMax);

        if (didChangeMin) {
            void this.optionsService.setOption(optionKeys.min, nextMin);
        }
        if (didChangeMax) {
            void this.optionsService.setOption(optionKeys.max, nextMax);
        }
    }

    private parseNumericValue(event: Event, fallback: number): number {
        const value = Number.parseInt((event.target as HTMLInputElement).value, 10);
        return Number.isFinite(value) ? value : fallback;
    }

    private syncInputValue(event: Event, value: number): void {
        const input = event.target as HTMLInputElement | null;
        if (!input) {
            return;
        }

        input.value = `${value}`;
    }
}