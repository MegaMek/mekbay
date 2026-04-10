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
import { MULFACTION_EXTINCT } from '../../models/mulfactions.model';
import type { LoadForceEntry } from '../../models/load-force-entry.model';
import type { AvailabilitySource } from '../../models/options.model';
import type { Unit } from '../../models/units.model';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { LoadForcePreviewPanelComponent } from '../load-force-preview-panel/load-force-preview-panel.component';
import { MultiSelectDropdownComponent, type DropdownOption, type MultiStateSelection } from '../multi-select-dropdown/multi-select-dropdown.component';
import { DataService } from '../../services/data.service';
import { ForceGeneratorService } from '../../services/force-generator.service';
import { GameService } from '../../services/game.service';
import { OptionsService } from '../../services/options.service';
import { AS_TYPE_DISPLAY_NAMES } from '../../services/unit-search-filters.model';
import { UnitSearchFiltersService } from '../../services/unit-search-filters.service';
import { UnitAvailabilitySourceService } from '../../services/unit-availability-source.service';
import { getMergedTags } from '../../utils/unit-search-shared.util';

export interface ForceGeneratorDialogConfig {
    gameSystem: GameSystem;
    availabilitySource: AvailabilitySource;
    bvPvLimit: number;
    unitTypes: string[];
    tags: string[];
    eraId: number;
    factionId: number;
    minUnitCount: number;
    maxUnitCount: number;
}

export interface ForceGeneratorDialogResult {
    forceEntry: LoadForceEntry;
    config: ForceGeneratorDialogConfig;
    totalCost: number;
}

interface ForceGeneratorPreview {
    units: Unit[];
    totalCost: number;
    error: string | null;
}

const DEFAULT_FORCE_GENERATOR_UNIT_TYPE = 'BM';
const DEFAULT_FORCE_GENERATOR_ERA_NAME = 'ilclan';

function normalizeTagToken(value: string): string {
    return value.trim().toLowerCase();
}

function normalizeTagFilter(values: readonly string[]): string[] {
    return Array.from(new Set(values.map(normalizeTagToken).filter(Boolean)));
}

function matchesTagFilter(unit: Unit, tags: readonly string[]): boolean {
    if (tags.length === 0) {
        return true;
    }

    const unitTags = new Set(getMergedTags(unit).map(normalizeTagToken));
    return tags.every((tag) => unitTags.has(tag));
}

function pickDefaultFaction(factions: readonly Faction[]): Faction | null {
    const nonExtinctFactions = factions.filter((faction) => faction.id !== MULFACTION_EXTINCT);
    const defaultPool = nonExtinctFactions.length > 0 ? nonExtinctFactions : factions;
    return defaultPool[Math.floor(Math.random() * defaultPool.length)] ?? null;
}

@Component({
    selector: 'force-generator-dialog',
    standalone: true,
    imports: [CommonModule, BaseDialogComponent, LoadForcePreviewPanelComponent, MultiSelectDropdownComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './force-generator-dialog.component.html',
    styleUrls: ['./force-generator-dialog.component.scss'],
})
export class ForceGeneratorDialogComponent {
    readonly GameSystem = GameSystem;
    private readonly dialogRef = inject(DialogRef<ForceGeneratorDialogResult | null>);
    readonly dataService = inject(DataService);
    private readonly forceGeneratorService = inject(ForceGeneratorService);
    readonly gameService = inject(GameService);
    private readonly optionsService = inject(OptionsService);
    private readonly unitSearchFilters = inject(UnitSearchFiltersService);
    private readonly unitAvailabilitySource = inject(UnitAvailabilitySourceService);
    private readonly initialBudgetLimits = this.forceGeneratorService.resolveInitialBudgetLimits(
        this.optionsService.options(),
        this.unitSearchFilters.bvPvLimit(),
        this.gameService.currentGameSystem(),
    );

    readonly availabilitySource = signal<AvailabilitySource>(this.optionsService.options().availabilitySource);
    readonly gameSystem = this.gameService.currentGameSystem;
    readonly eraId = signal<number | null>(this.getDefaultEra(this.dataService.getEras())?.id ?? null);
    readonly factionId = signal<number | null>(
        this.pickDefaultFactionId(
            this.getAvailableFactionsFor(this.getDefaultEra(this.dataService.getEras()), this.availabilitySource()),
        ),
    );
    readonly classicBudgetLimit = signal(this.initialBudgetLimits.classicLimit);
    readonly alphaStrikeBudgetLimit = signal(this.initialBudgetLimits.alphaStrikeLimit);
    readonly bvPvLimit = computed(() => this.gameSystem() === GameSystem.ALPHA_STRIKE ? this.alphaStrikeBudgetLimit() : this.classicBudgetLimit());
    readonly selectedUnitTypes = signal<string[]>([DEFAULT_FORCE_GENERATOR_UNIT_TYPE]);
    readonly selectedTags = signal<string[]>([]);
    readonly minUnitCount = signal(4);
    readonly maxUnitCount = signal(8);
    readonly rerollRevision = signal(0);
    readonly pilotGunnerySkill = computed(() => this.unitSearchFilters.pilotGunnerySkill());
    readonly pilotPilotingSkill = computed(() => this.unitSearchFilters.pilotPilotingSkill());
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

    readonly eras = computed(() => this.dataService.getEras());
    readonly unitTypeOptions = computed<DropdownOption[]>(() => {
        return [...this.dataService.getDropdownOptionUniverse('as.TP')]
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((option) => ({
                name: option.name,
                displayName: AS_TYPE_DISPLAY_NAMES[option.name] ? `${option.name} - ${AS_TYPE_DISPLAY_NAMES[option.name]}` : option.name,
                img: option.img,
            }));
    });
    readonly tagOptions = computed<DropdownOption[]>(() => {
        return [...this.dataService.getDropdownOptionUniverse('_tags')]
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((option) => ({ name: option.name, displayName: option.name, img: option.img }));
    });
    readonly selectedEra = computed(() => {
        const eras = this.eras();
        if (eras.length === 0) {
            return null;
        }

        const eraId = this.eraId();
        return eras.find((era) => era.id === eraId)
            ?? this.getDefaultEra(eras)
            ?? eras[eras.length - 1]
            ?? null;
    });
    readonly selectedEraId = computed(() => this.selectedEra()?.id ?? null);
    readonly availableFactions = computed(() => this.getAvailableFactionsFor(this.selectedEra(), this.availabilitySource()));
    readonly selectedFaction = computed(() => {
        const availableFactions = this.availableFactions();
        if (availableFactions.length === 0) {
            return null;
        }

        const factionId = this.factionId();
        return availableFactions.find((faction) => faction.id === factionId) ?? null;
    });
    readonly selectedFactionId = computed(() => this.selectedFaction()?.id ?? null);
    readonly parsedUnitTypeFilter = computed(() => Array.from(new Set(this.selectedUnitTypes().filter(Boolean))));
    readonly parsedTagFilter = computed(() => normalizeTagFilter(this.selectedTags()));
    readonly candidateUnits = computed(() => {
        const era = this.selectedEra();
        const faction = this.selectedFaction();
        if (!era || !faction) {
            return [];
        }

        const context = this.generationContext();
        const availabilitySource = this.availabilitySource();
        const availableUnitIds = this.unitAvailabilitySource.getFactionEraUnitIds(faction, era, availabilitySource);
        const unitTypes = this.parsedUnitTypeFilter();
        const tags = this.parsedTagFilter();

        return this.dataService.getUnits().filter((unit) => {
            if (!availableUnitIds.has(this.unitAvailabilitySource.getUnitAvailabilityKey(unit, availabilitySource))) {
                return false;
            }

            if (this.forceGeneratorService.getBudgetMetric(unit, context.gameSystem, context.gunnery, context.piloting) <= 0) {
                return false;
            }

            if (unitTypes.length > 0 && !unitTypes.includes(unit.as.TP)) {
                return false;
            }

            return matchesTagFilter(unit, tags);
        });
    });
    readonly preview = computed(() => {
        this.rerollRevision();
        const context = this.generationContext();

        const era = this.selectedEra();
        const faction = this.selectedFaction();
        if (!era || !faction) {
            return {
                units: [],
                totalCost: 0,
                error: 'Select an era and faction to generate a preview roster.',
            } satisfies ForceGeneratorPreview;
        }

        return this.forceGeneratorService.buildPreview({
            eligibleUnits: this.candidateUnits(),
            gameSystem: context.gameSystem,
            budgetLimit: context.budgetLimit,
            minUnitCount: context.minUnitCount,
            maxUnitCount: context.maxUnitCount,
            gunnery: context.gunnery,
            piloting: context.piloting,
            getWeight: (unit) => this.unitAvailabilitySource.getUnitAvailabilityWeight(unit, faction, era, this.availabilitySource()) ?? 1,
        });
    });
    readonly previewEntry = computed(() => {
        const context = this.generationContext();
        const era = this.selectedEra();
        const faction = this.selectedFaction();
        const preview = this.preview();
        if (!era || !faction || preview.error || preview.units.length === 0) {
            return null;
        }

        return this.forceGeneratorService.createForceEntry({
            units: preview.units,
            gameSystem: context.gameSystem,
            faction,
            era,
            gunnery: context.gunnery,
            piloting: context.piloting,
            totalCost: preview.totalCost,
        });
    });

    onAvailabilitySourceChange(event: Event): void {
        const value = (event.target as HTMLSelectElement).value;
        this.availabilitySource.set(value === 'megamek' ? 'megamek' : 'mul');
        this.resetFactionSelection();
    }

    onBudgetLimitChange(event: Event): void {
        this.setBudgetLimitForSystem(this.gameSystem(), this.parseNumericValue(event, this.bvPvLimit()));
    }

    onEraChange(event: Event): void {
        this.eraId.set(this.parseNumericValue(event, this.selectedEraId() ?? 0));
        this.resetFactionSelection();
    }

    onFactionChange(event: Event): void {
        const value = (event.target as HTMLSelectElement).value;
        this.factionId.set(value ? Number(value) : null);
    }

    onUnitTypeSelectionChange(selection: MultiStateSelection | readonly string[]): void {
        this.selectedUnitTypes.set(Array.isArray(selection) ? [...selection] : []);
    }

    onTagsSelectionChange(selection: MultiStateSelection | readonly string[]): void {
        this.selectedTags.set(Array.isArray(selection) ? [...selection] : []);
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

    budgetFieldLabel(): string {
        return this.gameSystem() === GameSystem.ALPHA_STRIKE ? 'PV Limit' : 'BV Limit';
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
                unitTypes: this.parsedUnitTypeFilter(),
                tags: this.parsedTagFilter(),
                eraId: previewEntry.era?.id ?? 0,
                factionId: previewEntry.faction?.id ?? 0,
                minUnitCount: this.minUnitCount(),
                maxUnitCount: this.maxUnitCount(),
            },
            totalCost: preview.totalCost,
        });
    }

    dismiss(): void {
        this.dialogRef.close(null);
    }

    private getDefaultEra(eras: readonly Era[]): Era | null {
        return eras.find((era) => era.name.trim().toLowerCase() === DEFAULT_FORCE_GENERATOR_ERA_NAME) ?? eras[eras.length - 1] ?? null;
    }

    private getAvailableFactionsFor(era: Era | null, availabilitySource: AvailabilitySource): Faction[] {
        if (!era) {
            return [];
        }

        return this.dataService.getFactions().filter(
            (faction) => this.unitAvailabilitySource.getFactionEraUnitIds(faction, era, availabilitySource).size > 0,
        );
    }

    private pickDefaultFactionId(factions: readonly Faction[]): number | null {
        return pickDefaultFaction(factions)?.id ?? null;
    }

    private resetFactionSelection(): void {
        const availableFactions = this.getAvailableFactionsFor(this.selectedEra(), this.availabilitySource());
        if (availableFactions.some((faction) => faction.id === this.factionId())) {
            return;
        }

        this.factionId.set(this.pickDefaultFactionId(availableFactions));
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
        const value = Number.parseInt((event.target as HTMLInputElement | HTMLSelectElement).value, 10);
        return Number.isFinite(value) ? value : fallback;
    }
}