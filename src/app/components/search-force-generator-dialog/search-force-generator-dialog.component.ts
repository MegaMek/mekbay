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
import { MAX_UNITS as FORCE_MAX_UNITS } from '../../models/force.model';
import {
    createLoadForceEntryFromSerializedForce,
    type LoadForceEntry,
    type LoadForceUnit,
} from '../../models/load-force-entry.model';
import type { AvailabilitySource } from '../../models/options.model';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { LoadForcePreviewPanelComponent } from '../load-force-preview-panel/load-force-preview-panel.component';
import { LoadForceRadarPanelComponent } from '../load-force-radar-panel/load-force-radar-panel.component';
import { MultiSelectDropdownComponent, type MultiStateSelection } from '../multi-select-dropdown/multi-select-dropdown.component';
import { DataService } from '../../services/data.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { ForceGeneratorService, type ForceGenerationPreview, type GeneratedForceUnit } from '../../services/force-generator.service';
import { GameService } from '../../services/game.service';
import { OptionsService } from '../../services/options.service';
import type { AdvFilterOptions, DropdownFilterOptions } from '../../services/unit-search-filters.model';
import { UnitSearchFiltersService } from '../../services/unit-search-filters.service';
import { normalizeMultiStateSelection } from '../../utils/unit-search-shared.util';

export interface SearchForceGeneratorDialogConfig {
    gameSystem: GameSystem;
    availabilitySource: AvailabilitySource;
    budgetRange: {
        min: number;
        max: number;
    };
    minUnitCount: number;
    maxUnitCount: number;
    preventDuplicateChassis: boolean;
}

export interface SearchForceGeneratorDialogResult {
    forceEntry: LoadForceEntry;
    config: SearchForceGeneratorDialogConfig;
    totalCost: number;
}

type MultiStateFilterKey = 'era' | 'faction' | '_tags';
type UnitTypeFilterKey = 'type' | 'as.TP';

@Component({
    selector: 'search-force-generator-dialog',
    standalone: true,
    imports: [
        CommonModule,
        BaseDialogComponent,
        LoadForcePreviewPanelComponent,
        LoadForceRadarPanelComponent,
        MultiSelectDropdownComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './search-force-generator-dialog.component.html',
    styleUrls: ['./search-force-generator-dialog.component.scss'],
})
export class SearchForceGeneratorDialogComponent {
    readonly GameSystem = GameSystem;
    readonly MAX_UNITS = FORCE_MAX_UNITS;
    private readonly dialogRef = inject(DialogRef<SearchForceGeneratorDialogResult | null>);
    readonly dataService = inject(DataService);
    private readonly forceBuilderService = inject(ForceBuilderService);
    private readonly forceGeneratorService = inject(ForceGeneratorService);
    private readonly gameService = inject(GameService);
    private readonly optionsService = inject(OptionsService);
    readonly filtersService = inject(UnitSearchFiltersService);
    private readonly initialGameSystem = this.gameService.currentGameSystem();
    private readonly selectedGameSystem = signal<GameSystem>(this.initialGameSystem);
    private readonly initialBudgetDefaults = this.forceGeneratorService.resolveInitialBudgetDefaults(
        this.optionsService.options(),
        this.filtersService.bvPvLimit(),
        this.initialGameSystem,
    );
    private readonly initialUnitCountDefaults = this.forceGeneratorService.resolveInitialUnitCountDefaults(
        this.optionsService.options(),
    );

    readonly gameSystem = this.selectedGameSystem.asReadonly();
    readonly isAlphaStrike = computed(() => this.gameSystem() === GameSystem.ALPHA_STRIKE);
    readonly availabilitySource = computed(() => this.optionsService.options().availabilitySource);
    readonly eligibleUnits = this.filtersService.filteredUnits;
    readonly pilotGunnerySkill = computed(() => this.filtersService.pilotGunnerySkill());
    readonly pilotPilotingSkill = computed(() => this.filtersService.pilotPilotingSkill());
    readonly eraFilter = computed(() => this.getDropdownFilter('era'));
    readonly factionFilter = computed(() => this.getDropdownFilter('faction'));
    readonly unitTypeFilterKey = computed<UnitTypeFilterKey | null>(() => this.resolveUnitTypeFilterKey());
    readonly unitTypeFilter = computed(() => {
        const filterKey = this.unitTypeFilterKey();
        return filterKey ? this.getDropdownFilter(filterKey) : null;
    });
    readonly subtypeFilter = computed(() => this.getDropdownFilter('subtype'));
    readonly tagsFilter = computed(() => this.getDropdownFilter('_tags'));
    readonly selectedEraValues = computed(() => this.getSelectedMultiStateValues(this.eraFilter()));
    readonly selectedFactionValues = computed(() => this.getSelectedMultiStateValues(this.factionFilter()));
    readonly selectedUnitTypeValues = computed(() => this.getSelectedDropdownValues(this.unitTypeFilter()));
    readonly selectedSubtypeValues = computed(() => this.getSelectedDropdownValues(this.subtypeFilter()));
    readonly selectedTagValues = computed(() => this.getSelectedMultiStateValues(this.tagsFilter()));
    readonly currentForce = this.forceBuilderService.smartCurrentForce;
    readonly canImportCurrentForce = computed(() => (this.currentForce()?.units().length ?? 0) > 0);
    readonly preventDuplicateChassis = signal(false);
    private readonly lockedUnits = signal<GeneratedForceUnit[]>([]);
    readonly lockedUnitKeys = computed(() => {
        return new Set(
            this.lockedUnits()
                .map((unit) => unit.lockKey)
                .filter((lockKey): lockKey is string => !!lockKey),
        );
    });
    readonly previewLockToggle = (unitEntry: LoadForceUnit): void => {
        this.togglePreviewUnitLock(unitEntry);
    };
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

        // if (this.lockedUnits().length > 0) {
        //     lines.push(`Locked Units: ${this.lockedUnits().length}.`);
        // }
        // if (this.preventDuplicateChassis()) {
        //     lines.push('Prevent Duplicate Chassis: On.');
        // }

        // const generationContext = this.resolvedGenerationContext();
        // const contextParts = [generationContext.forceFaction?.name, generationContext.forceEra?.name].filter(Boolean);
        // if (contextParts.length > 0) {
        //     lines.push(`Generation Context: ${contextParts.join(' - ')}.`);
        // }

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
    private readonly previewState = signal<ForceGenerationPreview>(this.buildGeneratedPreview());
    readonly preview = computed(() => this.projectPreviewForCurrentSettings(this.previewState()));
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

    setGameSystem(gameSystem: GameSystem): void {
        if (!this.dataService.isDataReady() || this.gameSystem() === gameSystem) {
            return;
        }

        this.selectedGameSystem.set(gameSystem);
    }

    toggleGameSystem(): void {
        this.setGameSystem(this.isAlphaStrike() ? GameSystem.CLASSIC : GameSystem.ALPHA_STRIKE);
    }

    onEraSelectionChange(selection: MultiStateSelection | readonly string[]): void {
        this.setMultiStateFilter('era', selection);
    }

    onFactionSelectionChange(selection: MultiStateSelection | readonly string[]): void {
        this.setMultiStateFilter('faction', selection);
    }

    onUnitTypeSelectionChange(selection: MultiStateSelection | readonly string[]): void {
        const filterKey = this.unitTypeFilterKey();
        if (!filterKey) {
            return;
        }

        this.setArrayFilter(filterKey, selection);
    }

    onSubtypeSelectionChange(selection: MultiStateSelection | readonly string[]): void {
        this.setArrayFilter('subtype', selection);
    }

    onTagsSelectionChange(selection: MultiStateSelection | readonly string[]): void {
        this.setMultiStateFilter('_tags', selection);
    }

    onPreventDuplicateChassisChange(event: Event): void {
        this.preventDuplicateChassis.set((event.target as HTMLInputElement).checked);
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
        this.previewState.set(this.buildGeneratedPreview());
    }

    importCurrentForce(): void {
        const currentForce = this.currentForce();
        if (!currentForce) {
            return;
        }

        const importedForceEntry = createLoadForceEntryFromSerializedForce(currentForce.serialize(), this.dataService);
        const importedUnits = importedForceEntry.groups
            .flatMap((group) => group.units)
            .map((unitEntry, index) => this.toLockedGeneratedUnit(unitEntry, index))
            .filter((unit): unit is GeneratedForceUnit => unit !== null);

        this.lockedUnits.set(importedUnits);
        this.previewState.set(this.createPreviewFromUnits(importedUnits, {
            faction: importedForceEntry.faction,
            era: importedForceEntry.era,
            explanationLines: ['Imported current force into preview. Press REROLL to generate a new result for the current settings.'],
            error: importedUnits.length === 0 ? 'No units from the current force could be loaded into the preview.' : null,
        }));
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
                preventDuplicateChassis: this.preventDuplicateChassis(),
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

    private getSelectedMultiStateValues(option: DropdownFilterOptions | null): MultiStateSelection {
        return normalizeMultiStateSelection(option?.value);
    }

    private getSelectedDropdownValues(option: DropdownFilterOptions | null): string[] {
        return Array.isArray(option?.value) ? [...option.value] : [];
    }

    private buildGeneratedPreview(): ForceGenerationPreview {
        const settings = this.generationSettings();
        const eligibleUnits = this.eligibleUnits();
        const lockedUnits = this.resolvePreviewUnits(
            this.lockedUnits(),
            settings.gameSystem,
            settings.gunnery,
            settings.piloting,
        );

        return this.forceGeneratorService.buildPreview({
            eligibleUnits,
            context: this.forceGeneratorService.resolveGenerationContext(eligibleUnits),
            gameSystem: settings.gameSystem,
            budgetRange: settings.budgetRange,
            minUnitCount: settings.minUnitCount,
            maxUnitCount: settings.maxUnitCount,
            gunnery: settings.gunnery,
            piloting: settings.piloting,
            lockedUnits,
            preventDuplicateChassis: this.preventDuplicateChassis(),
        });
    }

    private projectPreviewForCurrentSettings(storedPreview: ForceGenerationPreview): ForceGenerationPreview {
        const settings = this.generationSettings();
        const units = this.resolvePreviewUnits(
            storedPreview.units,
            settings.gameSystem,
            settings.gunnery,
            settings.piloting,
        );
        const totalCost = units.reduce((sum, unit) => sum + unit.cost, 0);

        return {
            gameSystem: settings.gameSystem,
            units,
            totalCost,
            error: units.length === 0
                ? storedPreview.error
                : this.resolvePreviewValidationError(units.length, totalCost, settings),
            faction: storedPreview.faction,
            era: storedPreview.era,
            explanationLines: storedPreview.explanationLines,
        };
    }

    private createPreviewFromUnits(
        units: readonly GeneratedForceUnit[],
        options: {
            faction?: Faction | null;
            era?: Era | null;
            explanationLines?: readonly string[];
            error?: string | null;
        } = {},
    ): ForceGenerationPreview {
        const settings = this.generationSettings();
        const resolvedUnits = this.resolvePreviewUnits(
            units,
            settings.gameSystem,
            settings.gunnery,
            settings.piloting,
        );

        return {
            gameSystem: settings.gameSystem,
            units: resolvedUnits,
            totalCost: resolvedUnits.reduce((sum, unit) => sum + unit.cost, 0),
            error: options.error ?? null,
            faction: options.faction ?? null,
            era: options.era ?? null,
            explanationLines: [...(options.explanationLines ?? [])],
        };
    }

    private resolvePreviewValidationError(
        unitCount: number,
        totalCost: number,
        settings: {
            gameSystem: GameSystem;
            budgetRange: { min: number; max: number };
            minUnitCount: number;
            maxUnitCount: number;
        },
    ): string | null {
        if (unitCount < settings.minUnitCount || unitCount > settings.maxUnitCount) {
            const unitLabel = unitCount === 1 ? 'unit' : 'units';
            const unitRange = settings.minUnitCount === settings.maxUnitCount
                ? `${settings.minUnitCount}`
                : `${settings.minUnitCount}-${settings.maxUnitCount}`;
            return `Current preview has ${unitCount} ${unitLabel}, outside the current unit range of ${unitRange}. Press REROLL to generate a force for the updated settings.`;
        }

        const budgetRange = this.normalizePreviewBudgetRange(settings.budgetRange);
        if (totalCost < budgetRange.min || totalCost > budgetRange.max) {
            const budgetLabel = settings.gameSystem === GameSystem.ALPHA_STRIKE ? 'PV' : 'BV';
            return `Current preview totals ${totalCost.toLocaleString()} ${budgetLabel}, outside the current target of ${this.formatBudgetTarget(budgetRange, budgetLabel)}. Press REROLL to generate a force for the updated settings.`;
        }

        return null;
    }

    private normalizePreviewBudgetRange(range: { min: number; max: number }): { min: number; max: number } {
        const min = Math.max(0, Math.floor(range.min));
        const rawMax = Math.max(0, Math.floor(range.max));
        return {
            min,
            max: rawMax > 0 ? Math.max(min, rawMax) : Number.POSITIVE_INFINITY,
        };
    }

    private formatBudgetTarget(range: { min: number; max: number }, budgetLabel: 'BV' | 'PV'): string {
        if (!Number.isFinite(range.max)) {
            return `at least ${range.min.toLocaleString()} ${budgetLabel}`;
        }
        if (range.min === 0) {
            return `at most ${range.max.toLocaleString()} ${budgetLabel}`;
        }
        if (range.min === range.max) {
            return `${range.min.toLocaleString()} ${budgetLabel}`;
        }

        return `${range.min.toLocaleString()}-${range.max.toLocaleString()} ${budgetLabel}`;
    }

    private resolvePreviewUnits(
        lockedUnits: readonly GeneratedForceUnit[],
        gameSystem: GameSystem,
        gunnery: number,
        piloting: number,
    ): GeneratedForceUnit[] {
        return lockedUnits.map((lockedUnit) => {
            const skill = gameSystem === GameSystem.ALPHA_STRIKE
                ? lockedUnit.skill ?? lockedUnit.gunnery ?? gunnery
                : undefined;
            const resolvedGunnery = gameSystem === GameSystem.CLASSIC
                ? lockedUnit.gunnery ?? lockedUnit.skill ?? gunnery
                : undefined;
            const resolvedPiloting = gameSystem === GameSystem.CLASSIC
                ? lockedUnit.piloting ?? piloting
                : undefined;

            return {
                unit: lockedUnit.unit,
                cost: this.forceGeneratorService.getBudgetMetric(
                    lockedUnit.unit,
                    gameSystem,
                    skill ?? resolvedGunnery ?? gunnery,
                    resolvedPiloting ?? piloting,
                ),
                skill,
                gunnery: resolvedGunnery,
                piloting: resolvedPiloting,
                alias: lockedUnit.alias,
                commander: lockedUnit.commander,
                lockKey: lockedUnit.lockKey,
            };
        });
    }

    private resolveUnitTypeFilterKey(): UnitTypeFilterKey | null {
        if (this.getDropdownFilter('type')) {
            return 'type';
        }
        if (this.getDropdownFilter('as.TP')) {
            return 'as.TP';
        }
        return null;
    }

    private setMultiStateFilter(key: MultiStateFilterKey, selection: MultiStateSelection | readonly string[]): void {
        this.filtersService.setFilter(key, normalizeMultiStateSelection(selection));
    }

    private setArrayFilter(key: string, selection: MultiStateSelection | readonly string[]): void {
        if (Array.isArray(selection)) {
            this.filtersService.setFilter(key, [...selection]);
            return;
        }

        const selectedValues = Object.values(selection)
            .filter((option) => option.state !== false)
            .map((option) => option.name);
        this.filtersService.setFilter(key, selectedValues);
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

    private togglePreviewUnitLock(unitEntry: LoadForceUnit): void {
        const lockKey = unitEntry.lockKey;
        if (!lockKey) {
            return;
        }

        this.lockedUnits.update((lockedUnits) => {
            if (lockedUnits.some((unit) => unit.lockKey === lockKey)) {
                return lockedUnits.filter((unit) => unit.lockKey !== lockKey);
            }

            const previewUnit = this.preview().units.find((unit) => unit.lockKey === lockKey);
            return previewUnit ? [...lockedUnits, { ...previewUnit }] : lockedUnits;
        });
    }

    private toLockedGeneratedUnit(unitEntry: LoadForceUnit, index: number): GeneratedForceUnit | null {
        if (!unitEntry.unit) {
            return null;
        }

        const gameSystem = this.gameSystem();
        const skill = gameSystem === GameSystem.ALPHA_STRIKE
            ? unitEntry.skill ?? this.pilotGunnerySkill()
            : undefined;
        const gunnery = gameSystem === GameSystem.CLASSIC
            ? unitEntry.gunnery ?? this.pilotGunnerySkill()
            : undefined;
        const piloting = gameSystem === GameSystem.CLASSIC
            ? unitEntry.piloting ?? this.pilotPilotingSkill()
            : undefined;

        return {
            unit: unitEntry.unit,
            cost: this.forceGeneratorService.getBudgetMetric(
                unitEntry.unit,
                gameSystem,
                skill ?? gunnery ?? this.pilotGunnerySkill(),
                piloting ?? this.pilotPilotingSkill(),
            ),
            skill,
            gunnery,
            piloting,
            alias: unitEntry.alias,
            commander: unitEntry.commander,
            lockKey: unitEntry.lockKey ?? `imported:${index}:${unitEntry.unit.name}`,
        };
    }
}