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
import { LoadForceEntry, type LoadForceGroup } from '../../models/load-force-entry.model';
import type { AvailabilitySource } from '../../models/options.model';
import type { Unit } from '../../models/units.model';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { LoadForcePreviewPanelComponent } from '../load-force-preview-panel/load-force-preview-panel.component';
import { MultiSelectDropdownComponent, type DropdownOption, type MultiStateSelection } from '../multi-select-dropdown/multi-select-dropdown.component';
import { DataService } from '../../services/data.service';
import { GameService } from '../../services/game.service';
import { OptionsService } from '../../services/options.service';
import { AS_TYPE_DISPLAY_NAMES } from '../../services/unit-search-filters.model';
import { UnitSearchFiltersService } from '../../services/unit-search-filters.service';
import { UnitAvailabilitySourceService } from '../../services/unit-availability-source.service';
import { BVCalculatorUtil } from '../../utils/bv-calculator.util';
import { getEffectivePilotingSkill } from '../../utils/cbt-common.util';
import { ForceNamerUtil } from '../../utils/force-namer.util';
import { PVCalculatorUtil } from '../../utils/pv-calculator.util';
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

function getBudgetMetric(unit: Unit, gameSystem: GameSystem, gunnery: number, piloting: number): number {
    if (gameSystem === GameSystem.ALPHA_STRIKE) {
        return Math.max(0, PVCalculatorUtil.calculateAdjustedPV(unit.as.PV, gunnery));
    }

    return Math.max(0, BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, gunnery, getEffectivePilotingSkill(unit, piloting)));
}

function matchesTagFilter(unit: Unit, tags: readonly string[]): boolean {
    if (tags.length === 0) {
        return true;
    }

    const unitTags = new Set(getMergedTags(unit).map(normalizeTagToken));
    return tags.every((tag) => unitTags.has(tag));
}

function getMinimumMetricTotal(
    units: readonly Unit[],
    count: number,
    gameSystem: GameSystem,
    gunnery: number,
    piloting: number,
): number {
    if (count <= 0) {
        return 0;
    }

    return [...units]
        .map((unit) => getBudgetMetric(unit, gameSystem, gunnery, piloting))
        .sort((left, right) => left - right)
        .slice(0, count)
        .reduce((sum, value) => sum + value, 0);
}

function pickWeightedRandomUnit(units: readonly Unit[], getWeight: (unit: Unit) => number): Unit {
    const weights = units.map((unit) => Math.max(0, getWeight(unit)));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

    if (totalWeight <= 0) {
        return units[Math.floor(Math.random() * units.length)];
    }

    let cursor = Math.random() * totalWeight;
    for (let index = 0; index < units.length; index++) {
        cursor -= weights[index];
        if (cursor <= 0) {
            return units[index];
        }
    }

    return units[units.length - 1];
}

function pickDefaultFaction(factions: readonly Faction[]): Faction | null {
    const nonExtinctFactions = factions.filter((faction) => faction.id !== MULFACTION_EXTINCT);
    const defaultPool = nonExtinctFactions.length > 0 ? nonExtinctFactions : factions;
    return defaultPool[Math.floor(Math.random() * defaultPool.length)] ?? null;
}

function buildGeneratedPreview(options: {
    candidateUnits: readonly Unit[];
    gameSystem: GameSystem;
    budgetLimit: number;
    minUnitCount: number;
    maxUnitCount: number;
    gunnery: number;
    piloting: number;
    getWeight: (unit: Unit) => number;
}): ForceGeneratorPreview {
    const minUnitCount = Math.max(1, Math.floor(options.minUnitCount));
    const maxUnitCount = Math.max(minUnitCount, Math.floor(options.maxUnitCount));

    if (options.candidateUnits.length < minUnitCount) {
        return {
            units: [],
            totalCost: 0,
            error: `Only ${options.candidateUnits.length} eligible units match the current filters.`,
        };
    }

    const budgetLimit = options.budgetLimit > 0 ? options.budgetLimit : Number.POSITIVE_INFINITY;
    if (Number.isFinite(budgetLimit)) {
        const minimumMetricTotal = getMinimumMetricTotal(
            options.candidateUnits,
            minUnitCount,
            options.gameSystem,
            options.gunnery,
            options.piloting,
        );
        if (minimumMetricTotal > budgetLimit) {
            return {
                units: [],
                totalCost: 0,
                error: 'The selected BV/PV limit is too low to satisfy the minimum unit count.',
            };
        }
    }

    const remainingUnits = [...options.candidateUnits];
    const selectedUnits: Unit[] = [];
    let budgetRemaining = budgetLimit;

    while (selectedUnits.length < minUnitCount) {
        const affordableUnits = Number.isFinite(budgetRemaining)
            ? remainingUnits.filter((unit) => getBudgetMetric(unit, options.gameSystem, options.gunnery, options.piloting) <= budgetRemaining)
            : remainingUnits;
        if (affordableUnits.length === 0) {
            break;
        }

        const requiredAfterSelection = minUnitCount - selectedUnits.length - 1;
        const viableUnits = requiredAfterSelection > 0 && Number.isFinite(budgetRemaining)
            ? affordableUnits.filter((candidateUnit) => {
                const candidateMetric = getBudgetMetric(candidateUnit, options.gameSystem, options.gunnery, options.piloting);
                const remainingAfterPick = remainingUnits.filter((unit) => unit !== candidateUnit);
                return getMinimumMetricTotal(
                    remainingAfterPick,
                    requiredAfterSelection,
                    options.gameSystem,
                    options.gunnery,
                    options.piloting,
                )
                    <= budgetRemaining - candidateMetric;
            })
            : affordableUnits;

        const nextPool = viableUnits.length > 0 ? viableUnits : affordableUnits;
        const nextUnit = pickWeightedRandomUnit(nextPool, options.getWeight);
        selectedUnits.push(nextUnit);
        budgetRemaining -= getBudgetMetric(nextUnit, options.gameSystem, options.gunnery, options.piloting);
        remainingUnits.splice(remainingUnits.indexOf(nextUnit), 1);
    }

    if (selectedUnits.length < minUnitCount) {
        return {
            units: selectedUnits,
            totalCost: selectedUnits.reduce((sum, unit) => sum + getBudgetMetric(unit, options.gameSystem, options.gunnery, options.piloting), 0),
            error: 'Unable to build a force that satisfies the minimum unit count with the current budget.',
        };
    }

    while (selectedUnits.length < maxUnitCount) {
        const affordableUnits = Number.isFinite(budgetRemaining)
            ? remainingUnits.filter((unit) => getBudgetMetric(unit, options.gameSystem, options.gunnery, options.piloting) <= budgetRemaining)
            : remainingUnits;
        if (affordableUnits.length === 0) {
            break;
        }

        const nextUnit = pickWeightedRandomUnit(affordableUnits, options.getWeight);
        selectedUnits.push(nextUnit);
        budgetRemaining -= getBudgetMetric(nextUnit, options.gameSystem, options.gunnery, options.piloting);
        remainingUnits.splice(remainingUnits.indexOf(nextUnit), 1);
    }

    return {
        units: selectedUnits,
        totalCost: selectedUnits.reduce((sum, unit) => sum + getBudgetMetric(unit, options.gameSystem, options.gunnery, options.piloting), 0),
        error: null,
    };
}

function createGeneratedForceEntry(options: {
    name: string;
    units: readonly Unit[];
    gameSystem: GameSystem;
    faction: Faction;
    era: Era;
    gunnery: number;
    piloting: number;
    totalCost: number;
}): LoadForceEntry {
    const previewGroup: LoadForceGroup = {
        units: options.units.map((unit) => ({
            unit,
            alias: undefined,
            destroyed: false,
            gunnery: options.gameSystem === GameSystem.CLASSIC ? options.gunnery : undefined,
            piloting: options.gameSystem === GameSystem.CLASSIC ? getEffectivePilotingSkill(unit, options.piloting) : undefined,
            skill: options.gameSystem === GameSystem.ALPHA_STRIKE ? options.gunnery : undefined,
        })),
    };

    return new LoadForceEntry({
        instanceId: `generated-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`,
        timestamp: new Date().toISOString(),
        type: options.gameSystem,
        owned: true,
        cloud: false,
        local: false,
        missing: false,
        name: options.name,
        faction: options.faction,
        era: options.era,
        bv: options.gameSystem === GameSystem.CLASSIC ? options.totalCost : undefined,
        pv: options.gameSystem === GameSystem.ALPHA_STRIKE ? options.totalCost : undefined,
        groups: [previewGroup],
    });
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
    readonly gameService = inject(GameService);
    private readonly optionsService = inject(OptionsService);
    private readonly unitSearchFilters = inject(UnitSearchFiltersService);
    private readonly unitAvailabilitySource = inject(UnitAvailabilitySourceService);

    readonly availabilitySource = signal<AvailabilitySource>(this.optionsService.options().availabilitySource);
    readonly gameSystem = this.gameService.currentGameSystem;
    readonly eraId = signal<number | null>(null);
    readonly factionId = signal<number | null>(null);
    readonly bvPvLimit = signal(0);
    readonly selectedUnitTypes = signal<string[]>([DEFAULT_FORCE_GENERATOR_UNIT_TYPE]);
    readonly selectedTags = signal<string[]>([]);
    readonly minUnitCount = signal(4);
    readonly maxUnitCount = signal(8);
    readonly rerollRevision = signal(0);
    readonly pilotGunnerySkill = computed(() => this.unitSearchFilters.pilotGunnerySkill());
    readonly pilotPilotingSkill = computed(() => this.unitSearchFilters.pilotPilotingSkill());

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
            ?? eras.find((era) => era.name.trim().toLowerCase() === DEFAULT_FORCE_GENERATOR_ERA_NAME)
            ?? eras[eras.length - 1]
            ?? null;
    });
    readonly selectedEraId = computed(() => this.selectedEra()?.id ?? null);
    readonly availableFactions = computed(() => {
        const era = this.selectedEra();
        if (!era) {
            return [];
        }

        const availabilitySource = this.availabilitySource();
        return this.dataService.getFactions().filter(
            (faction) => this.unitAvailabilitySource.getFactionEraUnitIds(faction, era, availabilitySource).size > 0,
        );
    });
    readonly selectedFaction = computed(() => {
        const availableFactions = this.availableFactions();
        if (availableFactions.length === 0) {
            return null;
        }

        const factionId = this.factionId();
        return availableFactions.find((faction) => faction.id === factionId) ?? pickDefaultFaction(availableFactions);
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

        const availabilitySource = this.availabilitySource();
        const availableUnitIds = this.unitAvailabilitySource.getFactionEraUnitIds(faction, era, availabilitySource);
        const unitTypes = this.parsedUnitTypeFilter();
        const tags = this.parsedTagFilter();
        const gunnery = this.pilotGunnerySkill();
        const piloting = this.pilotPilotingSkill();

        return this.dataService.getUnits().filter((unit) => {
            if (!availableUnitIds.has(this.unitAvailabilitySource.getUnitAvailabilityKey(unit, availabilitySource))) {
                return false;
            }

            if (getBudgetMetric(unit, this.gameSystem(), gunnery, piloting) <= 0) {
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

        const era = this.selectedEra();
        const faction = this.selectedFaction();
        if (!era || !faction) {
            return {
                units: [],
                totalCost: 0,
                error: 'Select an era and faction to generate a preview roster.',
            } satisfies ForceGeneratorPreview;
        }

        return buildGeneratedPreview({
            candidateUnits: this.candidateUnits(),
            gameSystem: this.gameSystem(),
            budgetLimit: this.bvPvLimit(),
            minUnitCount: this.minUnitCount(),
            maxUnitCount: this.maxUnitCount(),
            gunnery: this.pilotGunnerySkill(),
            piloting: this.pilotPilotingSkill(),
            getWeight: (unit) => this.unitAvailabilitySource.getUnitAvailabilityWeight(unit, faction, era, this.availabilitySource()) ?? 1,
        });
    });
    readonly previewEntry = computed(() => {
        const era = this.selectedEra();
        const faction = this.selectedFaction();
        const preview = this.preview();
        if (!era || !faction || preview.error || preview.units.length === 0) {
            return null;
        }

        return createGeneratedForceEntry({
            name: ForceNamerUtil.generateForceNameForFaction(faction),
            units: preview.units,
            gameSystem: this.gameSystem(),
            faction,
            era,
            gunnery: this.pilotGunnerySkill(),
            piloting: this.pilotPilotingSkill(),
            totalCost: preview.totalCost,
        });
    });

    onAvailabilitySourceChange(event: Event): void {
        const value = (event.target as HTMLSelectElement).value;
        this.availabilitySource.set(value === 'megamek' ? 'megamek' : 'mul');
    }

    onBudgetLimitChange(event: Event): void {
        this.bvPvLimit.set(this.parseNumericValue(event, 0));
    }

    onEraChange(event: Event): void {
        this.eraId.set(this.parseNumericValue(event, this.selectedEraId() ?? 0));
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

    private parseNumericValue(event: Event, fallback: number): number {
        const value = Number.parseInt((event.target as HTMLInputElement | HTMLSelectElement).value, 10);
        return Number.isFinite(value) ? value : fallback;
    }
}