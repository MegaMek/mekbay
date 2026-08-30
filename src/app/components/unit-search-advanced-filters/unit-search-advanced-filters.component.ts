// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { CommonModule } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, Injector, input, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { FormatNumberPipe } from '../../pipes/format-number.pipe';
import { GameSystem } from '../../models/common.model';
import { DialogsService } from '../../services/dialogs.service';
import { ForceWorkspaceStateService } from '../../services/force-workspace-state.service';
import { isCBTForceMember } from '../../models/force-member.model';
import { OptionsService } from '../../services/options.service';
import { BOOLEAN_FILTERS, DROPDOWN_FILTERS, RANGE_FILTERS, type RangeFilterConfig } from '../../services/unit-search-filters.model';
import { UnitSearchFiltersService } from '../../services/unit-search-filters.service';
import type { FormationSearchTarget } from '../../utils/formation-requirement.model';
import { LanceTypeIdentifierUtil } from '../../utils/lance-type-identifier.util';
import { isFilterAvailableForAvailabilitySource } from '../../utils/unit-search-filter-config.util';
import { normalizeUnitSearchRange, rangeFilterAllowsFloatingValues } from '../../utils/unit-search-range-dialog.util';
import { isBaseRulesRef } from '../../utils/rules-ref.util';
import { MultiSelectDropdownComponent, type DropdownOption, type MultiStateSelection } from '../multi-select-dropdown/multi-select-dropdown.component';
import { RangeSliderComponent } from '../range-slider/range-slider.component';
import { SemanticGuideComponent } from '../semantic-guide/semantic-guide.component';
import { TriStateFilterCheckboxComponent } from '../tri-state-filter-checkbox/tri-state-filter-checkbox.component';
import {
    type RangeModel,
    UnitSearchFilterRangeDialogComponent,
    type UnitSearchFilterRangeDialogData,
} from '../unit-search-filter-range-dialog/unit-search-filter-range-dialog.component';

@Component({
    selector: 'unit-search-advanced-filters',
    imports: [
        CommonModule,
        MultiSelectDropdownComponent,
        RangeSliderComponent,
        SemanticGuideComponent,
        TriStateFilterCheckboxComponent,
    ],
    templateUrl: './unit-search-advanced-filters.component.html',
    styleUrl: './unit-search-advanced-filters.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnitSearchAdvancedFiltersComponent {
    private static readonly CONTROL_RENDER_BATCH_SIZE = 4;

    readonly filterGameSystem = input.required<GameSystem>();
    readonly excludedFilterKeys = input<readonly string[]>([]);
    readonly columnsCount = input<number>(1);
    readonly showAvailabilitySourceDisclaimer = input(true);
    readonly showFormationTargetFilter = input(false);

    readonly filtersService = inject(UnitSearchFiltersService);
    private readonly forceWorkspace = inject(ForceWorkspaceStateService);
    private readonly optionsService = inject(OptionsService);
    private readonly dialogsService = inject(DialogsService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly injector = inject(Injector);
    private renderFrameId: number | null = null;
    private destroyed = false;

    /**
     * Keep the first panel paint cheap. Building option availability and
     * constructing every dropdown/slider in the button's click task caused a
     * multi-second freeze under mobile CPU throttling. The template reserves
     * every control's final grid slot, then these counts hydrate those slots in
     * place so batching never changes the visible order.
     */
    readonly filtersReady = signal(false);
    readonly renderedDropdownCount = signal(0);
    readonly renderedRangeCount = signal(0);

    readonly isComplexQuery = this.filtersService.isComplexQuery;
    readonly megaMekAvailabilitySourceSelected = computed(() => this.optionsService.options().availabilitySource === 'megamek');
    readonly gridTemplateColumns = computed(() => this.columnsCount() === 2 ? '1fr 1fr' : '1fr');
    readonly formationTargetOptions = computed<DropdownOption[]>(() => this.filtersService.getFormationTargetOptions(this.filterGameSystem()));
    readonly rulesRefOptionSection = (option: DropdownOption): string => isBaseRulesRef(option.name) ? 'base' : 'non-base';
    readonly selectedFormationTarget = computed<string[]>(() => {
        const options = this.formationTargetOptions();
        const semanticTargetId = this.filtersService.semanticFormationTargetId();
        if (semanticTargetId && options.some((option) => option.name === semanticTargetId)) {
            return [semanticTargetId];
        }

        const target = this.filtersService.formationTarget();
        if (!target) {
            return [];
        }

        return options.some((option) => option.name === target.formationId)
            ? [target.formationId]
            : [];
    });

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

    readonly booleanFilters = computed(() => {
        const gameSystem = this.filterGameSystem();
        const options = this.optionsService.options();
        const availabilitySource = options.availabilitySource;
        const excludedKeys = this.excludedKeySet();

        return BOOLEAN_FILTERS.filter((filter) => (
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

    constructor() {
        this.destroyRef.onDestroy(() => {
            this.destroyed = true;
            if (this.renderFrameId !== null) {
                cancelAnimationFrame(this.renderFrameId);
                this.renderFrameId = null;
            }
        });

        afterNextRender(() => {
            if (this.destroyed) {
                return;
            }

            // Populate the memoized option projection only after the empty
            // panel shell has reached the screen.
            this.filtersService.advOptions();
            this.filtersReady.set(true);
            this.renderNextControlBatch();
        }, { injector: this.injector });

        effect(() => {
            const dropdownCount = this.dropdownFilters().length;
            const rangeCount = this.rangeFilters().length;
            if (!this.filtersReady()
                || (this.renderedDropdownCount() >= dropdownCount
                    && this.renderedRangeCount() >= rangeCount)) {
                return;
            }

            this.scheduleNextControlBatch();
        });

        effect(() => {
            if (!this.showFormationTargetFilter()) {
                return;
            }

            const existingUnits = this.selectedFormationTargetGroupUnits();
            untracked(() => this.filtersService.setFormationTargetExistingUnits(existingUnits));
        });

        effect(() => {
            if (!this.showFormationTargetFilter()) {
                return;
            }

            const currentTarget = this.filtersService.formationTarget();
            if (!currentTarget) {
                return;
            }

            const nextTarget = this.buildFormationSearchTarget(currentTarget.formationId);
            if (!this.formationTargetsEqual(currentTarget, nextTarget)) {
                untracked(() => this.filtersService.setFormationTarget(nextTarget));
            }
        });
    }

    private scheduleNextControlBatch(): void {
        if (this.destroyed || this.renderFrameId !== null) {
            return;
        }

        this.renderFrameId = requestAnimationFrame(() => {
            this.renderFrameId = null;
            this.renderNextControlBatch();
        });
    }

    private renderNextControlBatch(): void {
        if (this.destroyed) {
            return;
        }

        const dropdownTotal = this.dropdownFilters().length;
        if (this.renderedDropdownCount() < dropdownTotal) {
            this.renderedDropdownCount.update(count => Math.min(
                dropdownTotal,
                count + UnitSearchAdvancedFiltersComponent.CONTROL_RENDER_BATCH_SIZE,
            ));
            this.scheduleNextControlBatch();
            return;
        }

        const rangeTotal = this.rangeFilters().length;
        if (this.renderedRangeCount() < rangeTotal) {
            this.renderedRangeCount.update(count => Math.min(
                rangeTotal,
                count + UnitSearchAdvancedFiltersComponent.CONTROL_RENDER_BATCH_SIZE,
            ));
            this.scheduleNextControlBatch();
        }
    }

    setAdvFilter(key: string, value: unknown): void {
        this.filtersService.setFilter(key, value);
    }

    onFormationTargetSelectionChange(selection: MultiStateSelection | readonly string[]): void {
        const formationId = this.getSelectedFormationId(selection);
        this.filtersService.selectFormationTarget(formationId ? this.buildFormationSearchTarget(formationId) : null);
    }

    private getSelectedFormationId(selection: MultiStateSelection | readonly string[]): string {
        if (Array.isArray(selection)) {
            return selection[0] ?? '';
        }

        return Object.values(selection).find((option) => option.state !== false)?.name ?? '';
    }

    private buildFormationSearchTarget(formationId: string): FormationSearchTarget | null {
        if (!formationId || !this.formationTargetOptions().some((option) => option.name === formationId)) {
            return null;
        }

        const gameSystem = this.filterGameSystem();
        const definition = LanceTypeIdentifierUtil.getDefinitionById(formationId, gameSystem);
        if (!definition) {
            return null;
        }

        return {
            formationId,
            existingUnits: this.selectedFormationTargetGroupUnits(),
            gameSystem,
            minUnits: definition.minUnits,
            maxUnits: definition.maxUnits,
        };
    }

    private selectedFormationTargetGroupUnits() {
        const selectedUnit = this.forceWorkspace.selectedUnit();
        return !selectedUnit || isCBTForceMember(selectedUnit)
            ? []
            : selectedUnit.getGroup()?.units() ?? [];
    }

    private formationTargetsEqual(left: FormationSearchTarget | null, right: FormationSearchTarget | null): boolean {
        if (left === right) {
            return true;
        }

        if (!left || !right) {
            return false;
        }

        return left.formationId === right.formationId
            && left.gameSystem === right.gameSystem
            && left.minUnits === right.minUnits
            && left.maxUnits === right.maxUnits
            && left.existingUnits.length === right.existingUnits.length
            && left.existingUnits.every((unit, index) => unit === right.existingUnits[index]);
    }

    async openRangeValueDialog(filterKey: string, currentValue: number[], availableRange: [number, number]): Promise<void> {
        const currentFilter = this.filtersService.advOptions()[filterKey];
        if (!currentFilter || currentFilter.type !== 'range') {
            return;
        }

        const filterConfig = RANGE_FILTERS.find(filter => filter.key === filterKey);
        const filterName = currentFilter.label || filterKey;
        const ref = this.dialogsService.createDialog<RangeModel | null>(UnitSearchFilterRangeDialogComponent, {
            data: {
                title: filterName,
                message: `Enter the ${filterName} range values:`,
                range: {
                    from: currentValue[0],
                    to: currentValue[1],
                },
                allowFloatingValues: rangeFilterAllowsFloatingValues(filterConfig),
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

        this.setAdvFilter(filterKey, normalizeUnitSearchRange(newValues, availableRange));
    }

    formatRangeValue(conf: RangeFilterConfig, value: number | undefined): string {
        if (value === undefined) {
            return '';
        }

        return conf.formatValue?.(value) ?? FormatNumberPipe.formatValue(value, false, true);
    }
}
