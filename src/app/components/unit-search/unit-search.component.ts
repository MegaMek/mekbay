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

import { CommonModule } from '@angular/common';
import { Component, signal, type ElementRef, computed, effect, afterNextRender, Injector, inject, ChangeDetectionStrategy, type input, viewChild, ChangeDetectorRef, DestroyRef, untracked, type ComponentRef, type TemplateRef } from '@angular/core';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ScrollingModule, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { RangeSliderComponent } from '../range-slider/range-slider.component';
import { MultiSelectDropdownComponent } from '../multi-select-dropdown/multi-select-dropdown.component';
import { SORT_OPTIONS, type SortOption, type SerializedSearchFilter } from '../../services/unit-search-filters.model';
import { type HighlightToken, tokenizeForHighlight } from '../../utils/semantic-filter-ast.util';
import { isFilterAvailableForAvailabilitySource } from '../../utils/unit-search-filter-config.util';
import type { Unit } from '../../models/units.model';
import { ForceBuilderService } from '../../services/force-builder.service';
import { Overlay, type OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { UnitDetailsDialogComponent, type UnitDetailsDialogData } from '../unit-details-dialog/unit-details-dialog.component';
import { firstValueFrom } from 'rxjs';
import { LayoutService } from '../../services/layout.service';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { FormatNumberPipe } from '../../pipes/format-number.pipe';
import { AdjustedPV } from '../../pipes/adjusted-pv.pipe';
import { LongPressDirective } from '../../directives/long-press.directive';
import { TooltipDirective } from '../../directives/tooltip.directive';
import { SearchFavoritesMenuComponent } from '../search-favorites-menu/search-favorites-menu.component';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { ShareSearchDialogComponent } from './share-search.component';
import { SemanticGuideDialogComponent } from '../semantic-guide-dialog/semantic-guide-dialog.component';
import { SemanticGuideComponent } from '../semantic-guide/semantic-guide.component';
import { highlightMatches } from '../../utils/search.util';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { UnitTagsComponent, type TagClickEvent } from '../unit-tags/unit-tags.component';
import { type RangeModel, UnitSearchFilterRangeDialogComponent, type UnitSearchFilterRangeDialogData } from '../unit-search-filter-range-dialog/unit-search-filter-range-dialog.component';
import { GameService } from '../../services/game.service';
import { OptionsService } from '../../services/options.service';
import { TaggingService } from '../../services/tagging.service';
import { AsAbilityLookupService } from '../../services/as-ability-lookup.service';
import { AbilityInfoDialogComponent, type AbilityInfoDialogData } from '../ability-info-dialog/ability-info-dialog.component';
import { SyntaxInputComponent } from '../syntax-input/syntax-input.component';
import { SavedSearchesService } from '../../services/saved-searches.service';
import { generateUUID } from '../../services/ws.service';
import { GameSystem } from '../../models/common.model';
import { AS_TYPE_DISPLAY_NAMES, DROPDOWN_FILTERS, RANGE_FILTERS } from '../../services/unit-search-filters.model';
import { UnitDetailsPanelComponent } from '../unit-details-panel/unit-details-panel.component';
import { UnitCardExpandedComponent } from '../unit-card-expanded/unit-card-expanded.component';
import { AlphaStrikeCardComponent } from '../alpha-strike-card/alpha-strike-card.component';
import { formatMovement } from '../../utils/as-common.util';
import type { UnitType } from '../../models/units.model';
import { BVCalculatorUtil } from '../../utils/bv-calculator.util';
import { DataTableComponent, type DataTableCellContext, type DataTableColumn, type DataTableRowClickEvent, type DataTableRowLongPressEvent, type DataTableRowPointerEnterEvent, type DataTableSortEvent } from '../data-table/data-table.component';
import { UnitSearchFiltersService } from '../../services/unit-search-filters.service';

/** Grouped chassis entry for compact view */
export interface ChassisGroup {
    chassis: string;
    type: UnitType;
    displayType: string;
    icon: string;
    /** A representative unit (first encountered) for icon display */
    representativeUnit: Unit;
    variantCount: number;
    minBV: number;
    maxBV: number;
    minPV: number;
    maxPV: number;
    units: Unit[];
}

@Component({
    selector: 'unit-search',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, ScrollingModule, RangeSliderComponent, LongPressDirective, TooltipDirective, MultiSelectDropdownComponent, AdjustedPV, FormatNumberPipe, UnitIconComponent, UnitTagsComponent, SyntaxInputComponent, SemanticGuideComponent, UnitDetailsPanelComponent, UnitCardExpandedComponent, AlphaStrikeCardComponent, DataTableComponent],
    templateUrl: './unit-search.component.html',
    styleUrl: './unit-search.component.scss',
    host: {
        '(keydown)': 'onKeydown($event)',
        '(document:keydown)': 'onDocumentKeydown($event)'
    }
})
export class UnitSearchComponent {
    readonly gameSystemEnum = GameSystem;
    layoutService = inject(LayoutService);
    filtersService = inject(UnitSearchFiltersService);
    dataService = inject(DataService);
    forceBuilderService = inject(ForceBuilderService);
    gameService = inject(GameService);
    overlayManager = inject(OverlayManagerService);

    private destroyRef = inject(DestroyRef);
    private injector = inject(Injector);
    private dialogsService = inject(DialogsService);
    private overlay = inject(Overlay);
    private cdr = inject(ChangeDetectorRef);
    private abilityLookup = inject(AsAbilityLookupService);
    private optionsService = inject(OptionsService);
    private taggingService = inject(TaggingService);
    private savedSearchesService = inject(SavedSearchesService);

    readonly useHex = computed(() => this.optionsService.options().ASUseHex);
    readonly cardStyle = computed(() => this.optionsService.options().ASCardStyle);
    /** Whether the layout is filters-list-panel (filters on left) */
    readonly filtersOnLeft = computed(() => this.optionsService.options().unitSearchExpandedViewLayout === 'filters-list-panel');

    public readonly SORT_OPTIONS = SORT_OPTIONS;
    readonly unitTypeDisplayNames = AS_TYPE_DISPLAY_NAMES;

    readonly advPanelFilterGameSystem = signal<GameSystem>(this.gameService.currentGameSystem());
    readonly dropdownFilters = computed(() => {
        const gameSystem = this.advPanelFilterGameSystem();
        const availabilitySource = this.optionsService.options().availabilitySource;
        return DROPDOWN_FILTERS.filter(f => (
            (!f.game || f.game === gameSystem)
            && isFilterAvailableForAvailabilitySource(f, availabilitySource)
        ));
    });
    readonly rangeFilters = computed(() => {
        const gameSystem = this.advPanelFilterGameSystem();
        const availabilitySource = this.optionsService.options().availabilitySource;
        return RANGE_FILTERS.filter(f => (
            (!f.game || f.game === gameSystem)
            && isFilterAvailableForAvailabilitySource(f, availabilitySource)
        ));
    });
    readonly otherAdvPanelFilterGameSystem = computed(() => this.getOtherGameSystem(this.advPanelFilterGameSystem()));
    readonly otherAdvPanelFilterGameSystemHasActiveFilters = computed(() => {
        const filterState = this.filtersService.effectiveFilterState();
        const otherGameSystem = this.otherAdvPanelFilterGameSystem();

        return [...DROPDOWN_FILTERS, ...RANGE_FILTERS].some(filter => (
            filter.game === otherGameSystem && filterState[filter.key]?.interactedWith
        ));
    });

    private searchDebounceTimer: any;
    private heightTrackingDebounceTimer: any;
    private readonly SEARCH_DEBOUNCE_MS = 300;

    private static readonly CHORD_ACTIVATE_KEY = 'f';
    private static readonly CHORD_TIMEOUT_MS = 1500;
    private static readonly FILTER_CHORD_BINDINGS: { key: string; filterKey: string }[] = [
        // Alpha Strike
        { key: 'p', filterKey: 'as.PV' },
        { key: 'm', filterKey: 'as._mv' },
        { key: 't', filterKey: 'as.TMM' },
        { key: 'o', filterKey: 'as.OV' },
        { key: 'a', filterKey: 'as.Arm' },
        { key: 's', filterKey: 'as.Str' },
        { key: 'z', filterKey: 'as.SZ' },
        { key: 'h', filterKey: 'as.Th' },
        { key: '1', filterKey: 'as.dmg._dmgS' },
        { key: '2', filterKey: 'as.dmg._dmgM' },
        { key: '3', filterKey: 'as.dmg._dmgL' },
        // Classic
        { key: 'b', filterKey: 'bv' },
        { key: 't', filterKey: 'tons' },
        { key: 'a', filterKey: 'armor' },
        { key: 's', filterKey: 'internal' },
        { key: 'f', filterKey: '_mdSumNoPhysical' },
        { key: 'd', filterKey: 'dpt' },
        { key: 'h', filterKey: 'heat' },
        { key: 'i', filterKey: 'dissipation' },
        { key: 'e', filterKey: '_dissipationEfficiency' },
        { key: 'r', filterKey: '_maxRange' },
        { key: 'w', filterKey: 'walk' },
        { key: 'u', filterKey: 'run' },
        { key: 'j', filterKey: 'jump' },
        { key: 'c', filterKey: 'cost' },
        // Both
        { key: 'y', filterKey: 'year' },
    ];
    private resolveChordBinding(key: string, gameSystem: GameSystem): { key: string; filterKey: string } | undefined {
        return UnitSearchComponent.FILTER_CHORD_BINDINGS.find(b => {
            if (b.key !== key) return false;
            const config = RANGE_FILTERS.find(f => f.key === b.filterKey);
            return config && (!config.game || config.game === gameSystem);
        });
    }

    readonly filterChordActive = signal(false);
    private filterChordTimer: any;
    /** Reference to the favorites overlay component for in-place updates. */
    private favoritesCompRef: ComponentRef<SearchFavoritesMenuComponent> | null = null;
    /** Flag to track when a favorites dialog (rename/delete) is in progress. */
    private favoritesDialogActive = false;
    /** Immediate input value for instant highlighting (not debounced). */
    readonly immediateSearchText = signal('');

    syntaxInput = viewChild<SyntaxInputComponent>('syntaxInput');
    advBtn = viewChild.required<ElementRef<HTMLButtonElement>>('advBtn');
    favBtn = viewChild.required<ElementRef<HTMLButtonElement>>('favBtn');
    advPanel = viewChild<ElementRef<HTMLElement>>('advPanel');
    resultsDropdown = viewChild<ElementRef<HTMLElement>>('resultsDropdown');
    resultsDataTable = viewChild<DataTableComponent<Unit>>(DataTableComponent);
    private readonly tableIconCell = viewChild<TemplateRef<DataTableCellContext<Unit>>>('tableIconCell');
    private readonly tableNameCell = viewChild<TemplateRef<DataTableCellContext<Unit>>>('tableNameCell');
    private readonly tableYearCell = viewChild<TemplateRef<DataTableCellContext<Unit>>>('tableYearCell');
    private readonly tableTypeCell = viewChild<TemplateRef<DataTableCellContext<Unit>>>('tableTypeCell');
    private readonly tableBvCell = viewChild<TemplateRef<DataTableCellContext<Unit>>>('tableBvCell');
    private readonly tableTonsCell = viewChild<TemplateRef<DataTableCellContext<Unit>>>('tableTonsCell');
    private readonly tablePvCell = viewChild<TemplateRef<DataTableCellContext<Unit>>>('tablePvCell');
    private readonly tableMovementCell = viewChild<TemplateRef<DataTableCellContext<Unit>>>('tableMovementCell');
    private readonly tableClassicMovementCell = viewChild<TemplateRef<DataTableCellContext<Unit>>>('tableClassicMovementCell');
    private readonly tableSpecialsCell = viewChild<TemplateRef<DataTableCellContext<Unit>>>('tableSpecialsCell');
    private readonly tableTagsCell = viewChild<TemplateRef<DataTableCellContext<Unit>>>('tableTagsCell');

    /** Query the active dropdown element directly from DOM to avoid viewChild retention */
    private getActiveDropdownElement(): HTMLElement | null {
        return document.querySelector('.results-dropdown') as HTMLElement | null;
    }

    /** viewChild for CdkVirtualScrollViewport - only used for scrolling operations!!! */
    private viewport = viewChild(CdkVirtualScrollViewport);

    gameSystem = computed(() => this.gameService.currentGameSystem());
    buttonOnly = signal(false);
    expandedView = this.filtersService.expandedView;
    advOpen = this.filtersService.advOpen;
    advPanelDocked = computed(() => this.expandedView() && this.advOpen() && this.layoutService.windowWidth() >= 900);
    advPanelUserColumns = signal<1 | 2 | null>(null);
    focused = signal(false);
    activeIndex = signal<number | null>(null);
    selectedUnits = signal<Set<string>>(new Set());
    private unitDetailsDialogOpen = signal(false);

     /**
      * Current results view mode.
      * - 'list'    : default list view
      * - 'card'    : AS card grid (Alpha Strike only)
      * - 'chassis' : compact chassis-grouped view
      * - 'table'   : expanded table view
      */
     viewMode = signal<'list' | 'card' | 'chassis' | 'table'>(this.optionsService.options().unitSearchViewMode);



    /** Unit currently selected for inline details panel in expanded view */
    inlinePanelUnit = signal<Unit | null>(null);

    /** Minimum window width to show the inline details panel */
    private readonly INLINE_PANEL_MIN_WIDTH = 2100;

    /** Whether to show the inline details panel (expanded view + sufficient screen width) */
    showInlinePanel = computed(() => {
        return this.expandedView() && this.layoutService.windowWidth() >= this.INLINE_PANEL_MIN_WIDTH;
    });

    readonly isTableMode = computed(() => this.viewMode() === 'table');
    private readonly cardViewMinWidthPx = 300;
    private readonly cardViewGapPx = 4;
    private readonly cardViewRowPaddingPx = 4;
    private readonly resultsDropdownWidth = signal(0);
    readonly cardViewColumnCount = computed(() => {
        const measuredWidth = this.resultsDropdownWidth();
        const availableWidth = Math.max(0, measuredWidth - (this.cardViewRowPaddingPx * 2));
        return Math.max(1, Math.floor((availableWidth + this.cardViewGapPx) / (this.cardViewMinWidthPx + this.cardViewGapPx)));
    });
    readonly cardViewRows = computed(() => {
        const units = this.filtersService.filteredUnits();
        const columnCount = this.cardViewColumnCount();
        const rows: Unit[][] = [];

        for (let index = 0; index < units.length; index += columnCount) {
            rows.push(units.slice(index, index + columnCount));
        }

        return rows;
    });

    readonly currentViewModeTitle = computed(() => {
        const mode = this.viewMode();
        if (mode === 'chassis') return 'Chassis View';
        if (mode === 'card') return 'Card View';
        if (mode === 'table') return 'Table View';
        return 'List View';
    });

    /**
     * Units grouped by chassis+type for compact view.
     * Each group contains summary info (BV range, tonnage, year range, variant count).
     */
    readonly groupedUnits = computed((): ChassisGroup[] => {
        const units = this.filtersService.filteredUnits();
        if (units.length === 0) return [];

        const isAS = this.gameService.isAlphaStrike();
        const map = new Map<string, ChassisGroup>();

        for (const unit of units) {
            const key = `${unit.type}|||${unit.chassis}`;
            let group = map.get(key);
            if (!group) {
                group = {
                    chassis: unit.chassis,
                    type: unit.type,
                    displayType: unit._displayType,
                    icon: unit.icon,
                    /** Store a representative unit for the icon component */
                    representativeUnit: unit,
                    variantCount: 0,
                    minBV: Infinity,
                    maxBV: -Infinity,
                    minPV: Infinity,
                    maxPV: -Infinity,
                    units: [],
                };
                map.set(key, group);
            }
            group.variantCount++;
            group.units.push(unit);
            if (unit.bv < group.minBV) group.minBV = unit.bv;
            if (unit.bv > group.maxBV) group.maxBV = unit.bv;
            if (unit.pv < group.minPV) group.minPV = unit.pv;
            if (unit.pv > group.maxPV) group.maxPV = unit.pv;
        }

        return Array.from(map.values());
    });

    /** Index of the currently selected unit in the filtered list */
    private inlinePanelIndex = computed(() => {
        const unit = this.inlinePanelUnit();
        if (!unit) return -1;
        return this.filtersService.filteredUnits().findIndex(u => u.name === unit.name);
    });

    /** Whether there is a previous unit to navigate to in the inline panel */
    inlinePanelHasPrev = computed(() => this.inlinePanelIndex() > 0);

    /** Whether there is a next unit to navigate to in the inline panel */
    inlinePanelHasNext = computed(() => {
        const index = this.inlinePanelIndex();
        return index >= 0 && index < this.filtersService.filteredUnits().length - 1;
    });

    /** Keys already visible in the chassis view (PV for AS, BV for CBT) */
    private static readonly CHASSIS_VIEW_VISIBLE_KEYS = ['as.PV', 'bv'];

    /**
     * For chassis view: returns the sort slot header label if the current sort
     * is numerical and not already visible (PV/BV), otherwise null.
     */
    readonly chassisSortSlotHeader = computed((): string | null => {
        const key = this.filtersService.selectedSort();
        if (!key) return null;

        // PV and BV are already visible in the value column
        if (UnitSearchComponent.CHASSIS_VIEW_VISIBLE_KEYS.includes(key)) return null;

        // Check if the sort key produces numerical values
        const units = this.filtersService.filteredUnits();
        if (units.length === 0) return null;
        const sample = this.getNestedProperty(units[0], key);
        if (typeof sample !== 'number') return null;

        const opt: SortOption | undefined = this.SORT_OPTIONS.find(o => o.key === key);
        return opt?.slotLabel || opt?.label || key;
    });

    /**
     * For AS table view: returns the sort slot header label if the current sort
     * is not already visible in the table columns, otherwise null.
     */
    readonly asTableSortSlotHeader = computed((): string | null => {
        const key = this.filtersService.selectedSort();
        if (!key) return null;

        // Check if key is directly in table columns
        if (UnitSearchComponent.AS_TABLE_VISIBLE_KEYS.includes(key)) return null;

        // Check if key is in a group that's in table columns
        for (const groupName of UnitSearchComponent.AS_TABLE_VISIBLE_GROUPS) {
            const group = UnitSearchComponent.SORT_KEY_GROUPS[groupName];
            if (group && group.includes(key)) return null;
        }

        // Key is not displayed in table - return the label
        const opt: SortOption | undefined = this.SORT_OPTIONS.find(o => o.key === key);
        return opt?.slotLabel || opt?.label || key;
    });

    readonly cbtTableSortSlotHeader = computed((): string | null => {
        const key = this.filtersService.selectedSort();
        if (!key) return null;

        if (UnitSearchComponent.CBT_TABLE_VISIBLE_KEYS.includes(key)) return null;

        for (const groupName of UnitSearchComponent.CBT_TABLE_VISIBLE_GROUPS) {
            const group = UnitSearchComponent.SORT_KEY_GROUPS[groupName];
            if (group && group.includes(key)) return null;
        }

        const opt: SortOption | undefined = this.SORT_OPTIONS.find(o => o.key === key);
        return opt?.slotLabel || opt?.label || key;
    });

    readonly unitSearchTableMinWidth = computed(() => {
        if (this.gameService.isAlphaStrike()) {
            return this.asTableSortSlotHeader() ? '1534px' : '1446px';
        }

        return this.cbtTableSortSlotHeader() ? '1878px' : '1782px';
    });

    readonly unitSearchTableColumns = computed<readonly DataTableColumn<Unit>[]>(() => {
        const iconCell = this.tableIconCell();
        const nameCell = this.tableNameCell();
        const yearCell = this.tableYearCell();
        const typeCell = this.tableTypeCell();
        const bvCell = this.tableBvCell();
        const tonsCell = this.tableTonsCell();
        const pvCell = this.tablePvCell();
        const movementCell = this.tableMovementCell();
        const classicMovementCell = this.tableClassicMovementCell();
        const specialsCell = this.tableSpecialsCell();
        const tagsCell = this.tableTagsCell();

        if (!iconCell || !nameCell || !yearCell || !tagsCell) {
            return [];
        }

        if (!this.gameService.isAlphaStrike()) {
            if (!bvCell || !tonsCell || !classicMovementCell) {
                return [];
            }

            const columns: DataTableColumn<Unit>[] = [
                {
                    id: 'icon',
                    header: '',
                    track: '40px',
                    cellTemplate: iconCell,
                    align: 'center',
                },
                {
                    id: 'name',
                    header: 'Name',
                    track: 'minmax(320px, 1.35fr)',
                    cellTemplate: nameCell,
                    sortKey: 'name',
                    sortActive: this.isSortActive('name'),
                },
                {
                    id: 'type',
                    header: 'Type',
                    track: '100px',
                    value: unit => unit.type,
                    sortKey: 'type',
                    sortActive: this.isSortActive('type'),
                    cellClass: this.tableCellClass('cbt-td-type', this.isSortActive('type')),
                },
                {
                    id: 'subtype',
                    header: 'Subtype',
                    track: '130px',
                    value: unit => this.formatClassicSubtype(unit),
                    sortKey: 'subtype',
                    sortActive: this.isSortActive('subtype'),
                    cellClass: this.tableCellClass('cbt-td-subtype', this.isSortActive('subtype')),
                },
                {
                    id: 'role',
                    header: 'Role',
                    track: '130px',
                    value: unit => unit.role !== 'None' ? unit.role : '',
                    sortKey: 'role',
                    sortActive: this.isSortActive('role'),
                    cellClass: this.tableCellClass('as-td-role', this.isSortActive('role')),
                },
                {
                    id: 'bv',
                    header: 'BV',
                    track: '78px',
                    cellTemplate: bvCell,
                    sortKey: 'bv',
                    sortActive: this.isSortActive('bv'),
                    cellClass: this.tableCellClass('cbt-td-bv is-bold', this.isSortActive('bv')),
                    align: 'right',
                },
                {
                    id: 'tons',
                    header: 'Tons',
                    track: '64px',
                    cellTemplate: tonsCell,
                    sortKey: 'tons',
                    sortActive: this.isSortActive('tons'),
                    cellClass: this.tableCellClass('cbt-td-tons', this.isSortActive('tons')),
                    align: 'right',
                },
                {
                    id: 'year',
                    header: 'Year',
                    track: '72px',
                    cellTemplate: yearCell,
                    sortKey: 'year',
                    sortActive: this.isSortActive('year'),
                    cellClass: this.tableCellClass('as-td-year', this.isSortActive('year')),
                    align: 'center',
                },
                {
                    id: 'rules',
                    header: 'Rules',
                    track: '108px',
                    value: unit => unit.level,
                    sortKey: 'level',
                    sortActive: this.isSortActive('level'),
                    cellClass: this.tableCellClass('cbt-td-rules', this.isSortActive('level')),
                },
                {
                    id: 'tech',
                    header: 'Tech',
                    track: '100px',
                    value: unit => unit.techBase,
                    sortKey: 'techBase',
                    sortActive: this.isSortActive('techBase'),
                    cellClass: this.tableCellClass('cbt-td-tech', this.isSortActive('techBase')),
                },
                {
                    id: 'movement',
                    header: 'Move',
                    track: '96px',
                    cellTemplate: classicMovementCell,
                    sortKey: 'walk',
                    sortGroupKey: 'movement',
                    sortActive: this.isSortActive('movement'),
                    cellClass: this.tableCellClass('cbt-td-mv', this.isSortActive('movement')),
                },
                {
                    id: 'armor',
                    header: 'Armor',
                    track: '72px',
                    value: unit => unit.armor,
                    sortKey: 'armor',
                    sortActive: this.isSortActive('armor'),
                    cellClass: this.tableCellClass('cbt-td-armor', this.isSortActive('armor')),
                    align: 'right',
                },
                {
                    id: 'structure',
                    header: 'Structure',
                    track: '86px',
                    value: unit => unit.internal,
                    sortKey: 'internal',
                    sortActive: this.isSortActive('internal'),
                    cellClass: this.tableCellClass('cbt-td-structure', this.isSortActive('internal')),
                    align: 'right',
                },
                {
                    id: 'firepower',
                    header: 'Firepower',
                    track: '88px',
                    value: unit => this.formatClassicStat(unit._mdSumNoPhysical),
                    sortKey: '_mdSumNoPhysical',
                    sortActive: this.isSortActive('_mdSumNoPhysical'),
                    cellClass: this.tableCellClass('cbt-td-firepower', this.isSortActive('_mdSumNoPhysical')),
                    align: 'right',
                },
                {
                    id: 'damage-per-turn',
                    header: 'Dmg/Turn',
                    track: '92px',
                    value: unit => this.formatClassicStat(unit.dpt),
                    sortKey: 'dpt',
                    sortActive: this.isSortActive('dpt'),
                    cellClass: this.tableCellClass('cbt-td-dpt', this.isSortActive('dpt')),
                    align: 'right',
                },
                {
                    id: 'network',
                    header: 'Network',
                    track: '96px',
                    value: unit => unit.c3 ?? '',
                    sortKey: 'c3',
                    sortActive: this.isSortActive('c3'),
                    cellClass: this.tableCellClass('cbt-td-network', this.isSortActive('c3')),
                },
                {
                    id: 'cost',
                    header: 'Cost',
                    track: '110px',
                    value: unit => unit.cost ? FormatNumberPipe.formatValue(unit.cost, true, false) : '',
                    sortKey: 'cost',
                    sortActive: this.isSortActive('cost'),
                    cellClass: this.tableCellClass('cbt-td-cost', this.isSortActive('cost')),
                    align: 'right',
                },
            ];

            if (this.cbtTableSortSlotHeader()) {
                columns.push({
                    id: 'sort-slot',
                    header: this.cbtTableSortSlotHeader() ?? '',
                    track: '100px',
                    value: unit => this.getClassicTableSortSlot(unit) ?? '',
                    headerClass: 'as-th-sort-slot',
                    cellClass: 'as-td-sort-slot sort-slot',
                    align: 'center',
                });
            }

            columns.push({
                id: 'tags',
                header: 'Tags',
                track: '120px',
                cellTemplate: tagsCell,
                headerClass: 'as-th-tags',
                cellClass: 'as-td-tags',
                align: 'right',
            });

            return columns;
        }

        if (!typeCell || !pvCell || !movementCell || !specialsCell) {
            return [];
        }

        const columns: DataTableColumn<Unit>[] = [
            {
                id: 'icon',
                header: '',
                track: '40px',
                cellTemplate: iconCell,
                align: 'center',
            },
            {
                id: 'name',
                header: 'Name',
                track: 'minmax(320px, 1.35fr)',
                cellTemplate: nameCell,
                sortKey: 'name',
                sortActive: this.isSortActive('name'),
            },
            {
                id: 'year',
                header: 'Year',
                track: '72px',
                cellTemplate: yearCell,
                sortKey: 'year',
                sortActive: this.isSortActive('year'),
                cellClass: this.tableCellClass('as-td-year', this.isSortActive('year')),
                align: 'center',
            },
            {
                id: 'type',
                header: 'Type',
                track: '50px',
                cellTemplate: typeCell,
                sortKey: 'as.TP',
                sortActive: this.isSortActive('as.TP'),
                cellClass: this.tableCellClass('as-td-type', this.isSortActive('as.TP')),
                align: 'center',
            },
            {
                id: 'role',
                header: 'Role',
                track: '130px',
                value: unit => unit.role !== 'None' ? unit.role : '',
                sortKey: 'role',
                sortActive: this.isSortActive('role'),
                cellClass: this.tableCellClass('as-td-role', this.isSortActive('role')),
            },
            {
                id: 'pv',
                header: 'PV',
                track: '45px',
                cellTemplate: pvCell,
                sortKey: 'as.PV',
                sortActive: this.isSortActive('as.PV'),
                cellClass: this.tableCellClass('as-td-pv is-bold', this.isSortActive('as.PV')),
                align: 'right',
            },
            {
                id: 'sz',
                header: 'SZ',
                track: '30px',
                value: unit => unit.as.SZ,
                sortKey: 'as.SZ',
                sortActive: this.isSortActive('as.SZ'),
                cellClass: this.tableCellClass('as-td-sz', this.isSortActive('as.SZ')),
                align: 'center',
            },
            {
                id: 'mv',
                header: 'MV',
                track: '65px',
                cellTemplate: movementCell,
                sortKey: 'as._mv',
                sortActive: this.isSortActive('as._mv'),
                cellClass: this.tableCellClass('as-td-mv', this.isSortActive('as._mv')),
                align: 'center',
            },
            {
                id: 'tmm',
                header: 'TMM',
                track: '40px',
                value: unit => unit.as.TMM ?? '—',
                sortKey: 'as.TMM',
                sortActive: this.isSortActive('as.TMM'),
                cellClass: this.tableCellClass('as-td-tmm', this.isSortActive('as.TMM')),
                align: 'center',
            },
            {
                id: 'damage',
                header: 'S/M/L',
                track: '60px',
                value: unit => !unit.as.usesArcs ? `${unit.as.dmg.dmgS}/${unit.as.dmg.dmgM}/${unit.as.dmg.dmgL}` : '',
                sortKey: 'as.dmg._dmgS',
                sortGroupKey: 'as.damage',
                sortActive: this.isSortActive('as.damage'),
                cellClass: this.tableCellClass('as-td-dmg', this.isSortActive('as.damage')),
                align: 'center',
            },
            {
                id: 'arm',
                header: 'A',
                track: '40px',
                value: unit => unit.as.Arm,
                sortKey: 'as.Arm',
                sortActive: this.isSortActive('as.Arm'),
                cellClass: this.tableCellClass('as-td-arm', this.isSortActive('as.Arm')),
                align: 'center',
            },
            {
                id: 'str',
                header: 'S',
                track: '40px',
                value: unit => unit.as.Str,
                sortKey: 'as.Str',
                sortActive: this.isSortActive('as.Str'),
                cellClass: this.tableCellClass('as-td-str', this.isSortActive('as.Str')),
                align: 'center',
            },
            {
                id: 'ov',
                header: 'OV',
                track: '30px',
                value: unit => unit.as.usesOV ? unit.as.OV : '',
                sortKey: 'as.OV',
                sortActive: this.isSortActive('as.OV'),
                cellClass: this.tableCellClass('as-td-ov', this.isSortActive('as.OV')),
                align: 'center',
            },
        ];

        if (this.asTableSortSlotHeader()) {
            columns.push({
                id: 'sort-slot',
                header: this.asTableSortSlotHeader() ?? '',
                track: '80px',
                value: unit => this.getAsTableSortSlot(unit) ?? '',
                headerClass: 'as-th-sort-slot',
                cellClass: 'as-td-sort-slot sort-slot',
                align: 'center',
            });
        }

        columns.push(
            {
                id: 'specials',
                header: 'Special',
                track: 'minmax(220px, 1fr)',
                cellTemplate: specialsCell,
            },
            {
                id: 'tags',
                header: 'Tags',
                track: '120px',
                cellTemplate: tagsCell,
                headerClass: 'as-th-tags',
                cellClass: 'as-td-tags',
                align: 'right',
            },
        );

        return columns;
    });

    /** Current sort key for expanded card highlighting */
    readonly currentSortKey = computed(() => this.filtersService.selectedSort());

    /** Current sort slot label for expanded card (when sort key not visible) */
    readonly currentSortSlotLabel = computed(() => {
        const key = this.filtersService.selectedSort();
        if (!key) return null;
        const opt = this.SORT_OPTIONS.find(o => o.key === key);
        return opt?.slotLabel ?? null;
    });

    advPanelStyle = signal<{ left: string, top: string, width: string, height: string, columnsCount: number }>({
        left: '0px',
        top: '0px',
        width: '100%',
        height: '100%',
        columnsCount: 1,
    });
    resultsDropdownStyle = signal<{ top: string, width: string, height: string }>({
        top: '0px',
        width: '100%',
        height: '100%',
    });

    /** Style for the expanded results wrapper when advanced panel is docked */
    expandedWrapperStyle = computed(() => {
        const { top: safeTop, bottom: safeBottom, right: safeRight } = this.layoutService.getSafeAreaInsets();
        const gap = 4;
        const top = safeTop + 4 + 40 + gap; // top margin + searchbar height + gap
        const bottom = Math.max(4, safeBottom);
        const filtersOnLeft = this.filtersOnLeft();

        let left = 4;
        let right = 4;
        if (this.advPanelDocked()) {
            const advPanelWidth = parseInt(this.advPanelStyle().width, 10) || 300;
            if (filtersOnLeft) {
                left = advPanelWidth + 8;
            } else {
                right = advPanelWidth + 8;
            }
        }

        return {
            top: `${top}px`,
            left: `${left}px`,
            right: `${right}px`,
            bottom: `${bottom}px`,
            flexDirection: filtersOnLeft ? 'row-reverse' : 'row' as 'row' | 'row-reverse',
        };
    });

    overlayVisible = computed(() => {
        return this.advOpen() || this.resultsVisible();
    });

    /**
     * Non-reactive flag tracking whether the results panel was visible on the last check.
     * Used to avoid flickering: when the panel is already visible, we keep showing
     * (possibly stale) results while the worker processes instead of hiding/showing.
     */
    private wasResultsVisible = false;

    public readonly resultsVisible = computed(() => {
        if (this.expandedView()) {
            return true;
        }
        const wantsVisible = (this.focused() || this.advOpen() || this.unitDetailsDialogOpen()) &&
            (this.filtersService.searchText() || this.isAdvActive());
        if (!wantsVisible) return false;
        // If search results are current, show immediately
        if (this.filtersService.isSearchSettled()) return true;
        // Search pending: only show if panel was already visible (avoid flash on first show)
        return this.wasResultsVisible;
    });

    /**
     * Tokenized search text for syntax highlighting.
     * Uses the AST lexer to produce tokens with type info.
     * Uses immediateSearchText for instant feedback (no debounce).
     */
    readonly highlightTokens = computed((): HighlightToken[] => {
        const text = this.immediateSearchText();
        if (!text) return [];
        return tokenizeForHighlight(text, this.gameService.currentGameSystem());
    });

    /**
     * Whether there are any parse errors.
     */
    readonly hasParseErrors = computed((): boolean => {
        return this.highlightTokens().some(t => t.type === 'error');
    });

    /**
     * Tooltip text for the search input when there are parse errors.
     * Shows all error messages joined by newlines.
     */
    readonly errorTooltip = computed((): string => {
        const errors = this.highlightTokens().filter(t => t.type === 'error' && t.errorMessage);
        if (errors.length === 0) return '';
        return errors.map(e => e.errorMessage).join('\n');
    });

    /**
     * Whether the query is too complex to represent in flat UI filters.
     * When true, filter dropdowns are hidden in favor of the query.
     */
    readonly isComplexQuery = computed(() => this.filtersService.isComplexQuery());

    private readonly listItemSize = signal(75);
    readonly cardItemHeight = signal(220);
    readonly itemSize = computed(() => {
        if (this.viewMode() === 'card' && this.gameService.isAlphaStrike()) {
            return this.cardItemHeight();
        }

        return this.listItemSize();
    });

    private resizeObserver?: ResizeObserver;
    private resultsResizeObserver?: ResizeObserver;
    private advPanelDragStartX = 0;
    private advPanelDragStartWidth = 0;

    constructor() {
        // Track panel visibility for flicker prevention (must be a plain boolean, not a signal,
        // so the computed reads it as a snapshot without creating a reactive dependency)
        effect(() => {
            this.wasResultsVisible = this.resultsVisible();
        });
        effect(() => {
            const currentGameSystem = this.gameSystem();
            untracked(() => this.advPanelFilterGameSystem.set(currentGameSystem));
        });
        // Sync immediateSearchText when searchText changes externally (favorites, etc.)
        // We use untracked to avoid re-triggering when we set immediateSearchText
        effect(() => {
            const text = this.filtersService.searchText();
            untracked(() => {
                if (this.immediateSearchText() !== text) {
                    this.immediateSearchText.set(text);
                }
            });
        });
        // Keep the filters service in sync with the current force total BV/PV
        effect(() => {
            const force = this.forceBuilderService.smartCurrentForce();
            const total = force ? force.totalBv() : 0;
            untracked(() => this.filtersService.forceTotalBvPv.set(total));
        });
        // Auto-refresh favorites overlay when saved searches change (e.g., from cloud sync)
        effect(() => {
            this.savedSearchesService.version(); // Subscribe to changes
            untracked(() => this.refreshFavoritesOverlay());
        });
        // Card view is AS-only, so drop it when the game system changes away from AS.
        effect(() => {
            const isAS = this.gameService.isAlphaStrike();
            untracked(() => {
                if (!isAS && this.viewMode() === 'card') {
                    this.setViewMode('list');
                }
            });
        });
        effect(() => {
            const isExpanded = this.expandedView();
            untracked(() => {
                if (!isExpanded && this.viewMode() === 'table') {
                    this.setViewMode('list');
                }
            });
        });
        effect(() => {
            const savedViewMode = this.optionsService.options().unitSearchViewMode;
            const normalizedViewMode = this.normalizeViewMode(savedViewMode);
            untracked(() => {
                if (this.viewMode() !== normalizedViewMode) {
                    this.viewMode.set(normalizedViewMode);
                }
                if (savedViewMode !== normalizedViewMode) {
                    void this.optionsService.setOption('unitSearchViewMode', normalizedViewMode);
                }
            });
        });
        effect(() => {
            if (this.advOpen()) {
                this.layoutService.windowWidth();
                this.layoutService.windowHeight();
                this.advPanelUserColumns();
                this.updateAdvPanelPosition();
                this.updateResultsDropdownPosition();
            }
        });
        effect(() => {
            this.advPanelUserColumns();
            this.expandedView();
            if (this.resultsVisible()) {
                this.layoutService.windowWidth();
                this.layoutService.windowHeight();
                this.updateResultsDropdownPosition();
            }
        });
        effect((cleanup) => {
            const dropdown = this.resultsDropdown()?.nativeElement;
            if (!dropdown) {
                this.resultsDropdownWidth.set(0);
                return;
            }

            this.resultsResizeObserver?.disconnect();
            this.resultsResizeObserver = new ResizeObserver(entries => {
                const width = entries[0]?.contentRect.width ?? dropdown.clientWidth;
                this.resultsDropdownWidth.set(width);
            });
            this.resultsResizeObserver.observe(dropdown);
            this.resultsDropdownWidth.set(dropdown.clientWidth);

            cleanup(() => {
                this.resultsResizeObserver?.disconnect();
                this.resultsResizeObserver = undefined;
            });
        });
        // Track pending afterNextRender callbacks to cancel on effect re-run or destroy
        let pendingResizeObserverRef: { destroy: () => void } | null = null;

        pendingResizeObserverRef = afterNextRender(() => {
            pendingResizeObserverRef = null;
            // We use a ResizeObserver to track changes to the search bar container size,
            // so we can update the dropdown/panel positions accordingly.
            const container = document.querySelector('.searchbar-container') as HTMLElement;
            if (container) {
                this.resizeObserver = new ResizeObserver(() => {
                    if (this.advOpen()) {
                        this.updateAdvPanelPosition();
                    }
                    if (this.resultsVisible() && !this.expandedView()) {
                        this.updateResultsDropdownPosition();
                    }
                });
                this.resizeObserver.observe(container);
            }
        }, { injector: this.injector });

        const visualViewport = window.visualViewport;
        if (visualViewport) {
            const onViewportChange = () => {
                if (this.advOpen()) {
                    this.updateAdvPanelPosition();
                }
                if (this.resultsVisible() && !this.expandedView()) {
                    this.updateResultsDropdownPosition();
                }
            };
            visualViewport.addEventListener('resize', onViewportChange);
            visualViewport.addEventListener('scroll', onViewportChange);
            this.destroyRef.onDestroy(() => {
                visualViewport.removeEventListener('resize', onViewportChange);
                visualViewport.removeEventListener('scroll', onViewportChange);
            });
        }
        this.setupItemHeightTracking();
        inject(DestroyRef).onDestroy(() => {
            pendingResizeObserverRef?.destroy();
            if (this.searchDebounceTimer) {
                clearTimeout(this.searchDebounceTimer);
            }
            if (this.heightTrackingDebounceTimer) {
                clearTimeout(this.heightTrackingDebounceTimer);
            }
            clearTimeout(this.filterChordTimer);
            this.resizeObserver?.disconnect();
            this.resultsResizeObserver?.disconnect();
            this.overlayManager.closeAllManagedOverlays();
        });
    }

    trackCardRow = (index: number, row: Unit[]) => row[0]?.name ?? index;

    getCardUnitIndex(rowIndex: number, columnIndex: number): number {
        return rowIndex * this.cardViewColumnCount() + columnIndex;
    }

    private getViewportItemIndex(index: number): number {
        if (this.viewMode() === 'card' && this.gameService.isAlphaStrike()) {
            return Math.floor(index / this.cardViewColumnCount());
        }
        return index;
    }

    private getDefaultListItemSize(): number {
        return 75;
    }

    private getDefaultCardItemHeight(): number {
        return 220;
    }

    private setupItemHeightTracking() {
        const DEBOUNCE_MS = 100;
        /** Max consecutive gap-correction attempts to prevent infinite loops */
        const MAX_GAP_CORRECTIONS = 3;
        let prevLayoutKey: string | undefined;
        let gapCorrectionPending: { destroy: () => void } | null = null;
        let gapCorrectionCount = 0;

        /**
         * Detect and fix blank-space gaps in the virtual scroll viewport.
         *
         * The CDK FixedSizeVirtualScrollStrategy calculates total content height as
         * `dataLength * itemSize`. When items have variable heights and the average
         * doesn't match, two gap scenarios occur:
         *
         * 1. Mid-scroll gap: Average overestimates = fewer items rendered than
         *    needed to fill the viewport. Fix: nudge scroll offset backward.
         *
         * 2. End-of-list gap: Average overestimates = total spacer height exceeds
         *    the real sum of item heights. At the bottom, rendered items end but spacer
         *    continues. Fix: set the correct total content size directly on the viewport.
         */
        const detectAndFixGap = () => {
            const vp = this.viewport();
            if (!vp || !this.resultsVisible()) {
                return;
            }

            const vpEl = vp.elementRef.nativeElement;
            const contentWrapper = vpEl.querySelector('.cdk-virtual-scroll-content-wrapper') as HTMLElement;
            if (!contentWrapper) {
                return;
            }

            const vpRect = vpEl.getBoundingClientRect();
            const contentRect = contentWrapper.getBoundingClientRect();
            const gap = vpRect.bottom - contentRect.bottom;
            const renderedRange = vp.getRenderedRange();
            const dataLength = vp.getDataLength();
            const isAtDataEnd = renderedRange.end >= dataLength;

            if (gap <= 1) {
                // No gap, reset and exit
                gapCorrectionCount = 0;
                return;
            }

            if (isAtDataEnd) {
                // End-of-list gap: all items are rendered but the spacer is too tall.
                // Read the actual CSS transform offset applied by the CDK, add the
                // real content height, that's the true total content size.
                // Use setTotalContentSize() directly instead of changing itemSize,
                // which avoids the cascading offset-shift problem.
                const renderedContentHeight = contentWrapper.offsetHeight;

                // Parse the actual translateY from the CDK's inline transform
                const transform = contentWrapper.style.transform || '';
                const match = transform.match(/translateY\((\d+(?:\.\d+)?)px\)/);
                const actualOffset = match ? parseFloat(match[1]) : renderedRange.start * this.itemSize();

                const realTotalHeight = actualOffset + renderedContentHeight;
                const currentTotalHeight = dataLength * this.itemSize();

                if (realTotalHeight < currentTotalHeight) {
                    vp.setTotalContentSize(realTotalHeight);
                }
            } else {
                // Mid-scroll gap: not all items rendered but content doesn't fill viewport.
                // Nudge scroll offset backward to force CDK to expand the rendered range.
                const currentOffset = vp.measureScrollOffset();
                const correctedOffset = Math.max(0, currentOffset - gap - 1);
                vp.scrollToOffset(correctedOffset);
            }

            // Schedule a follow-up check in case one correction isn't enough
            if (gapCorrectionCount < MAX_GAP_CORRECTIONS) {
                gapCorrectionCount++;
                gapCorrectionPending?.destroy();
                gapCorrectionPending = afterNextRender(() => {
                    gapCorrectionPending = null;
                    detectAndFixGap();
                }, { injector: this.injector });
            }
        };

        const measureHeights = () => {
            // Query DOM directly
            const dropdown = this.getActiveDropdownElement();
            if (!dropdown) return;

            if (this.viewMode() === 'card' && this.gameService.isAlphaStrike()) {
                const cardRow = dropdown.querySelector('.card-view-row') as HTMLElement | null;
                if (!cardRow) return;

                const measuredHeight = Math.round(cardRow.offsetHeight);
                if (measuredHeight > 0 && this.cardItemHeight() !== measuredHeight) {
                    this.cardItemHeight.set(measuredHeight);
                }

                return;
            }

            const items = dropdown.querySelectorAll('.results-dropdown-item:not(.no-results)');
            if (items.length === 0) return;

            const heights = Array.from(items).slice(0, 100).map(el => (el as HTMLElement).offsetHeight);
            const avg = Math.round(heights.reduce((a, b) => a + b, 0) / heights.length);
            const currentAvg = this.listItemSize();
            if (currentAvg !== avg) {
                this.listItemSize.set(avg);
            }

            // Always schedule a gap check after measurement, regardless of whether
            // itemSize changed: the gap can exist even with a stable average.
            gapCorrectionCount = 0;
            gapCorrectionPending?.destroy();
            gapCorrectionPending = afterNextRender(() => {
                gapCorrectionPending = null;
                detectAndFixGap();
            }, { injector: this.injector });
        };

        const debouncedUpdateHeights = (debounceMs = DEBOUNCE_MS) => {
            if (this.heightTrackingDebounceTimer) {
                clearTimeout(this.heightTrackingDebounceTimer);
            }
            this.heightTrackingDebounceTimer = setTimeout(() => {
                // Early exit if results are no longer visible
                if (!this.resultsVisible()) return;
                measureHeights();
            }, debounceMs);
        };

        effect(() => {
            const currentExpandedView = this.expandedView();
            const currentViewMode = this.viewMode();
            const currentLayoutKey = `${currentExpandedView}:${currentViewMode}`;

            // Cancel any pending timer and reset itemSize when view mode changes
            untracked(() => {
                if (this.heightTrackingDebounceTimer) {
                    clearTimeout(this.heightTrackingDebounceTimer);
                    this.heightTrackingDebounceTimer = undefined;
                }
                gapCorrectionPending?.destroy();
                gapCorrectionPending = null;
                gapCorrectionCount = 0;
                // Reset to defaults on view mode change (will be refined by height tracking)
                if (prevLayoutKey !== undefined && prevLayoutKey !== currentLayoutKey) {
                    this.listItemSize.set(this.getDefaultListItemSize());
                    this.cardItemHeight.set(this.getDefaultCardItemHeight());
                }
                prevLayoutKey = currentLayoutKey;
            });

            if (!this.resultsVisible()) return;
            this.layoutService.isMobile();
            this.gameService.currentGameSystem();
            this.resultsDropdownWidth();
            if (currentExpandedView) {
                this.layoutService.windowWidth();
                this.filtersService.advOpen();
                this.advPanelUserColumns();
            }
            this.filtersService.filteredUnits();
            debouncedUpdateHeights();
        });

        // Subscribe to viewport scroll events to detect end-of-list gaps on scroll.
        // The measurement-based gap detection only runs on data/layout changes,
        // but the user can scroll to the bottom at any time after that.
        let scrollGapTimer: any;
        const SCROLL_GAP_DEBOUNCE = 150;
        const onViewportScroll = () => {
            const vp = this.viewport();
            if (!vp || !this.resultsVisible()) return;

            // Only check when near the bottom of the scroll (within 2 viewports)
            const scrollOffset = vp.measureScrollOffset();
            const viewportSize = vp.getViewportSize();
            const totalContentSize = vp.getDataLength() * this.itemSize();
            const distanceFromEnd = totalContentSize - scrollOffset - viewportSize;

            if (distanceFromEnd < viewportSize * 2) {
                // Near the bottom: debounce a gap check
                if (scrollGapTimer) clearTimeout(scrollGapTimer);
                scrollGapTimer = setTimeout(() => {
                    gapCorrectionCount = 0;
                    detectAndFixGap();
                }, SCROLL_GAP_DEBOUNCE);
            }
        };

        // Attach/detach the scroll listener reactively based on viewport availability
        let currentVpEl: HTMLElement | null = null;
        effect(() => {
            const vp = this.viewport();
            const visible = this.resultsVisible();
            untracked(() => {
                const newVpEl = (vp && visible) ? vp.elementRef.nativeElement : null;
                if (newVpEl === currentVpEl) return;

                // Detach from old
                if (currentVpEl) {
                    currentVpEl.removeEventListener('scroll', onViewportScroll);
                }
                currentVpEl = newVpEl;
                // Attach to new
                if (currentVpEl) {
                    currentVpEl.addEventListener('scroll', onViewportScroll, { passive: true });
                }
            });
        });

        this.destroyRef.onDestroy(() => {
            if (scrollGapTimer) clearTimeout(scrollGapTimer);
            if (currentVpEl) {
                currentVpEl.removeEventListener('scroll', onViewportScroll);
                currentVpEl = null;
            }
            gapCorrectionPending?.destroy();
        });
    }

    public closeAllPanels() {
        this.focused.set(false);
        this.advOpen.set(false);
        this.activeIndex.set(null);
        this.blurInput();
    }

    onOverlayClick() {
        if (this.expandedView()) return;
        this.closeAllPanels();
    }

    trackByUnitId(index: number, unit: Unit) {
        // Track by index to force position-based recycling in virtual scroll
        // Tracking by unit.name causes orphaned DOM nodes for who knows what reason...
        return index;
    }

    readonly unitTableRowClass = (unit: Unit, index: number) => ({
        'is-selected': this.isUnitSelected(unit),
        'is-active': this.activeIndex() === index,
        'is-panel-selected': this.showInlinePanel() && this.inlinePanelUnit()?.name === unit.name,
    });

    focusInput() {
        afterNextRender(() => {
            try { this.syntaxInput()?.focus(); } catch { /* ignore */ }
        }, { injector: this.injector });
    }

    blurInput() {
        try { this.syntaxInput()?.blur(); } catch { /* ignore */ }
    }

    setSearch(val: string) {
        // Update immediately for instant highlighting
        this.immediateSearchText.set(val);
        // Debounce the actual search/filtering
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
        }
        this.searchDebounceTimer = setTimeout(() => {
            this.filtersService.setSearchText(val);
            this.activeIndex.set(null);
        }, this.SEARCH_DEBOUNCE_MS);
    }

    closeAdvPanel() {
        this.advOpen.set(false);
    }

    toggleAdv() {
        this.advOpen.set(!this.advOpen());
        if (this.advOpen()) {
            this.focused.set(true);
        }
    }

    updateResultsDropdownPosition() {
        const gap = 4;

        const { top: safeTop, bottom: safeBottom } = this.layoutService.getSafeAreaInsets();
        const visualViewport = window.visualViewport;
        const viewportOffsetTop = visualViewport?.offsetTop ?? 0;
        const viewportHeight = visualViewport?.height ?? window.innerHeight;
        let dropdownWidth: number;
        let top: number;
        let baseTop: number;
        let right: string | undefined;

        if (this.expandedView()) {
            // When expanded, container is fixed at top with 4px margins
            // Calculate position based on the expanded state, not current DOM position
            dropdownWidth = window.innerWidth - 8; // 4px left + 4px right margin
            baseTop = safeTop + 4 + 40 + gap; // top margin + searchbar height + gap
            top = baseTop + viewportOffsetTop;
            if (this.advPanelDocked()) {
                const advPanelWidth = this.advPanelStyle().width;
                right = advPanelWidth ? `${parseInt(advPanelWidth, 10) + 8}px` : `308px`;
            }
        } else {
            // Normal mode: use actual container position
            const container = document.querySelector('.searchbar-container') as HTMLElement;
            if (!container) return;

            const containerRect = container.getBoundingClientRect();
            dropdownWidth = containerRect.width;
            baseTop = containerRect.bottom + gap;
            top = baseTop + viewportOffsetTop;
        }

        let height;
        if (this.filtersService.filteredUnits().length > 0) {
            const availableHeight = viewportHeight - baseTop - Math.max(4, safeBottom);
            height = `${availableHeight}px`;
        } else {
            height = 'auto';
        }

        this.resultsDropdownStyle.set({
            top: `${top}px`,
            width: `${dropdownWidth}px`,
            height: height,
        });
    }

    updateAdvPanelPosition() {
        const advBtn = this.advBtn();
        if (!advBtn) return;

        const { top: safeTop, bottom: safeBottom, left: safeLeft, right: safeRight } = this.layoutService.getSafeAreaInsets();
        const buttonRect = advBtn.nativeElement.getBoundingClientRect();
        const singlePanelWidth = 300;
        const doublePanelWidth = 600;
        const gap = 4;
        const filtersOnLeft = this.filtersOnLeft() && this.expandedView(); // Only applies in expanded view

        // Calculate available space based on layout direction
        const spaceAvailable = filtersOnLeft
            ? buttonRect.left - gap - 10  // Space to the left of button
            : window.innerWidth - buttonRect.right - gap - 10;  // Space to the right of button

        // Use user override if set, else auto
        let columns = (spaceAvailable >= doublePanelWidth ? 2 : 1);
        if (this.expandedView() && this.advPanelDocked()) {
            const columnsCountOverride = this.advPanelUserColumns();
            if (columnsCountOverride) {
                columns = columnsCountOverride;
            }
        }
        let panelWidth = columns === 2 ? doublePanelWidth : singlePanelWidth;

        let left: number;
        let top: number;
        let availableHeight: number;

        if (filtersOnLeft) {
            // Filters on left: panel opens to the left of the button
            if (spaceAvailable >= panelWidth) {
                left = buttonRect.left - panelWidth - gap;
                top = buttonRect.top;
                availableHeight = window.innerHeight - top - Math.max(4, safeBottom);
            } else {
                left = gap;
                top = buttonRect.bottom + gap;
                availableHeight = window.innerHeight - top - Math.max(4, safeBottom);
            }
            left = Math.max(gap, left);
        } else {
            // Default: panel opens to the right of the button
            if (spaceAvailable >= panelWidth) {
                left = buttonRect.right + gap;
                top = buttonRect.top;
                availableHeight = window.innerHeight - top - Math.max(4, safeBottom);
            } else {
                left = buttonRect.right - panelWidth;
                top = buttonRect.bottom + gap;
                availableHeight = window.innerHeight - top - Math.max(4, safeBottom);
                left = Math.max(10, left);
            }
        }

        this.advPanelStyle.set({
            left: `${left}px`,
            top: `${top}px`,
            width: `${panelWidth}px`,
            height: `${availableHeight}px`,
            columnsCount: columns
        });
    }

    setAdvFilter(key: string, value: any) {
        this.filtersService.setFilter(key, value);
        this.activeIndex.set(null);
    }

    setAdvPanelFilterGameSystem(gameSystem: GameSystem) {
        this.advPanelFilterGameSystem.set(gameSystem);
    }

    toggleAdvPanelFilterGameSystem() {
        this.advPanelFilterGameSystem.set(this.otherAdvPanelFilterGameSystem());
    }

    advPanelFilterGameSystemToggleTitle() {
        return this.otherAdvPanelFilterGameSystem() === GameSystem.CLASSIC
            ? 'Show BattleTech filters'
            : 'Show Alpha Strike filters';
    }

    clearAdvFilters() {
        this.currentViewport()?.scrollToIndex(0);
        this.filtersService.resetFilters();
        this.activeIndex.set(null);
    }

    isAdvActive() {
        const state = this.filtersService.filterState();
        return Object.values(state).some(s => s.interactedWith) || this.filtersService.bvPvLimit() > 0;
    }

    private getOtherGameSystem(gameSystem: GameSystem): GameSystem {
        return gameSystem === GameSystem.CLASSIC
            ? GameSystem.ALPHA_STRIKE
            : GameSystem.CLASSIC;
    }

    onDocumentKeydown(event: KeyboardEvent) {
        // FILTER Chord
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === UnitSearchComponent.CHORD_ACTIVATE_KEY) {
            event.preventDefault();
            this.filterChordActive.set(true);
            clearTimeout(this.filterChordTimer);
            this.filterChordTimer = setTimeout(() => this.filterChordActive.set(false), UnitSearchComponent.CHORD_TIMEOUT_MS);
            return;
        }

        // FILTER second key press
        if (this.filterChordActive()) {
            this.filterChordActive.set(false);
            clearTimeout(this.filterChordTimer);

            if (event.ctrlKey || event.metaKey || event.altKey) return;

            const binding = this.resolveChordBinding(event.key.toLowerCase(), this.gameSystem());
            if (!binding) return;

            event.preventDefault();
            this.expandedView.set(true);
            this.advOpen.set(true);
            const currentFilter = this.filtersService.advOptions()[binding.filterKey];
            if (currentFilter && currentFilter.type === 'range') {
                this.openRangeValueDialog(binding.filterKey, currentFilter.value, currentFilter.totalRange);
            }
            return;
        }
    }

    onKeydown(event: KeyboardEvent) {
        // SELECT ALL
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
            const isInInput = event.target instanceof HTMLElement && Boolean(event.target.closest('input, textarea, select, [contenteditable]'));
            if (!isInInput) {
                event.preventDefault();
                this.selectAll();
                return;
            }
        }
        if (event.key === 'Escape') {
            event.stopPropagation();
            if (this.advOpen()) {
                this.closeAdvPanel();
                this.focusInput();
                return;
            } else {
                if (this.expandedView()) {
                    this.expandedView.set(false);
                    return;
                }
                this.focused.set(false);
                this.blurInput();
            }
            return;
        }
        if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
            const items = this.filtersService.filteredUnits();
            if (items.length === 0) return;
            const currentActiveIndex = this.activeIndex();
            switch (event.key) {
                case 'ArrowDown':
                    event.preventDefault();
                    const nextIndex = currentActiveIndex !== null ? Math.min(currentActiveIndex + 1, items.length - 1) : 0;
                    this.activeIndex.set(nextIndex);
                    this.scrollToIndex(nextIndex);
                    break;
                case 'ArrowUp':
                    event.preventDefault();
                    if (currentActiveIndex !== null && currentActiveIndex > 0) {
                        const prevIndex = currentActiveIndex - 1;
                        this.activeIndex.set(prevIndex);
                        this.scrollToIndex(prevIndex);
                    } else {
                        this.activeIndex.set(null);
                        this.focusInput();
                    }
                    break;
                case 'Enter':
                    event.preventDefault();
                    if (currentActiveIndex !== null) {
                        this.showUnitDetails(items[currentActiveIndex]);
                    } else if (items.length > 0) {
                        this.showUnitDetails(items[0]);
                    }
                    break;
            }
        }
    }

    private scrollToIndex(index: number) {
        this.currentViewport()?.scrollToIndex(this.getViewportItemIndex(index), 'smooth');
    }

    /**
     * Scroll to make the item at the given index visible, but only if it's not already visible.
     * If scrolling is needed, positions the item at the nearest edge (top or bottom).
     */
    private scrollToMakeVisible(index: number) {
        const vp = this.currentViewport();
        if (!vp) return;
        const viewportIndex = this.getViewportItemIndex(index);

        const vpElement = vp.elementRef.nativeElement;
        const renderedRange = vp.getRenderedRange();

        // Check if the item is within the rendered range
        if (viewportIndex < renderedRange.start || viewportIndex >= renderedRange.end) {
            // Item is not rendered at all, need to scroll to it
            vp.scrollToIndex(viewportIndex, 'smooth');
            return;
        }

        // Find the rendered items
        const items = vpElement.querySelectorAll('.results-dropdown-item:not(.no-results), .mb-data-table-row-item, .card-view-row');
        const localIndex = viewportIndex - renderedRange.start;

        if (localIndex < 0 || localIndex >= items.length) {
            // Safety fallback
            vp.scrollToIndex(viewportIndex, 'smooth');
            return;
        }

        const itemElement = items[localIndex] as HTMLElement;
        const itemRect = itemElement.getBoundingClientRect();
        const vpRect = vpElement.getBoundingClientRect();

        // Check if item is fully visible within the viewport
        const isAbove = itemRect.top < vpRect.top;
        const isBelow = itemRect.bottom > vpRect.bottom;

        if (!isAbove && !isBelow) {
            // Item is fully visible, no scrolling needed
            return;
        }

        const currentOffset = vp.measureScrollOffset();

        if (isAbove) {
            // Item is above the visible area - scroll up by the exact amount needed
            const scrollAmount = vpRect.top - itemRect.top;
            vp.scrollToOffset(currentOffset - scrollAmount, 'smooth');
        } else {
            // Item is below the visible area - scroll down by the exact amount needed
            const scrollAmount = itemRect.bottom - vpRect.bottom;
            vp.scrollToOffset(currentOffset + scrollAmount, 'smooth');
        }
    }

    highlight(text: string): string {
        const searchGroups = this.filtersService.searchTokens();
        return highlightMatches(text, searchGroups, true);
    }

    async openRangeValueDialog(filterKey: string, currentValue: number[], totalRange: [number, number]) {
        const currentFilter = this.filtersService.advOptions()[filterKey];
        if (!currentFilter || currentFilter.type !== 'range') {
            return;
        }
        const filterName = currentFilter?.label || filterKey;
        const message = `Enter the ${filterName} range values:`;

        const ref = this.dialogsService.createDialog<RangeModel | null>(UnitSearchFilterRangeDialogComponent, {
            data: {
                title: filterName,
                message: message,
                range: {
                    from: currentValue[0],
                    to: currentValue[1]
                }
            } as UnitSearchFilterRangeDialogData
        });
        let newValues = await firstValueFrom(ref.closed);
        if (newValues === undefined || newValues === null) return;

        // Unset: both null means user explicitly cleared the filter
        if (newValues.from === null && newValues.to === null) {
            this.filtersService.unsetFilter(filterKey);
            return;
        }

        let newFrom = newValues.from ?? 0;
        let newTo = newValues.to ?? Number.MAX_SAFE_INTEGER;
        if (newFrom < totalRange[0]) {
            newFrom = totalRange[0];
        } else if (newTo > totalRange[1]) {
            newTo = totalRange[1];
        }

        const currentRange = [...currentFilter.value] as [number, number];
        if (newFrom > currentRange[1]) {
            newFrom = currentRange[1];
        }
        currentRange[0] = newFrom;
        if (newTo < currentRange[0]) {
            newTo = currentRange[0];
        }
        currentRange[1] = newTo;

        this.setAdvFilter(filterKey, currentRange);
    }

    showUnitDetails(unit: Unit) {
        const filteredUnits = this.filtersService.filteredUnits();
        const filteredUnitIndex = filteredUnits.findIndex(u => u.name === unit.name);
        const ref = this.dialogsService.createDialog(UnitDetailsDialogComponent, {
            data: <UnitDetailsDialogData>{
                unitList: filteredUnits,
                unitIndex: filteredUnitIndex,
                gunnerySkill: this.filtersService.pilotGunnerySkill(),
                pilotingSkill: this.filtersService.pilotPilotingSkill()
            }
        });
        this.unitDetailsDialogOpen.set(true);

        // Track navigation within the dialog to keep activeIndex in sync
        const indexChangeSub = ref.componentInstance?.indexChange.subscribe((newIndex: number) => {
            this.activeIndex.set(newIndex);
            this.scrollToMakeVisible(newIndex);
            // Fetch fresh to avoid closure over stale filteredUnits
            const currentFilteredUnits = this.filtersService.filteredUnits();
            if (newIndex < currentFilteredUnits.length) {
                this.inlinePanelUnit.set(currentFilteredUnits[newIndex]);
            }
        });

        const addSub = ref.componentInstance?.add.subscribe(() => {
            if (this.forceBuilderService.smartCurrentForce()?.units().length == 1) {
                this.expandedView.set(false);
                queueMicrotask(() => {
                    this.closeAllPanels();
                });
            }
            this.blurInput();
            this.unitDetailsDialogOpen.set(false);
        });

        firstValueFrom(ref.closed).then(() => {
            this.unitDetailsDialogOpen.set(false);
            indexChangeSub?.unsubscribe();
            addSub?.unsubscribe();
        });

        if (!this.advPanelDocked()) {
            this.advOpen.set(false);
        }
        this.activeIndex.set(null);
        try {
            (document.activeElement as HTMLElement)?.blur();
        } catch { /* ignore */ }
    }

    /**
     * Keys that are grouped together in the UI display.
     * When any key in a group is displayed, sorting by any other key in the group
     * should highlight that display (not create a separate sort slot).
     */
    private static readonly SORT_KEY_GROUPS: Record<string, readonly string[]> = {
        // AS damage displayed as S/M/L composite
        'as.damage': ['as.dmg._dmgS', 'as.dmg._dmgM', 'as.dmg._dmgL', 'as.dmg._dmgE'],
        // CBT movement displayed as "walk / run / jump / umu"
        'movement': ['walk', 'run', 'jump', 'umu'],
    };

    /**
     * Check if the current sort key matches any of the provided keys or groups.
     * Use in templates: [class.sort-slot]="isSortActive('as.PV')" or isSortActive('as.damage')
     */
    onHeaderSort(sortKey: string, groupKey?: string): void {
        const isActive = groupKey ? this.isSortActive(groupKey) : this.isSortActive(sortKey);
        if (isActive) {
            const current = this.filtersService.selectedSortDirection();
            this.filtersService.setSortDirection(current === 'asc' ? 'desc' : 'asc');
        } else {
            this.filtersService.setSortOrder(sortKey);
            this.filtersService.setSortDirection('asc');
        }
    }

    onUnitTableSort(event: DataTableSortEvent): void {
        this.onHeaderSort(event.sortKey, event.groupKey);
    }

    onUnitTableRowClick(event: DataTableRowClickEvent<Unit>): void {
        this.onUnitCardClick(event.row, event.event);
    }

    onUnitTableRowLongPress(event: DataTableRowLongPressEvent<Unit>): void {
        this.multiSelectUnit(event.row, event.event);
    }

    onUnitTableRowPointerEnter(event: DataTableRowPointerEnterEvent<Unit>): void {
        this.activeIndex.set(event.index);
    }

    isSortActive(...keysOrGroups: string[]): boolean {
        const currentSort = this.filtersService.selectedSort();
        if (!currentSort) return false;

        for (const keyOrGroup of keysOrGroups) {
            // Check if it's a group name
            const group = UnitSearchComponent.SORT_KEY_GROUPS[keyOrGroup];
            if (group) {
                if (group.includes(currentSort)) return true;
            } else if (keyOrGroup === currentSort) {
                return true;
            }
        }
        return false;
    }

    /**
     * Keys always visible in the AS table row.
     * Used by both asTableSortSlotHeader and getAsTableSortSlot.
     */
    private static readonly AS_TABLE_VISIBLE_KEYS = ['name', 'year', 'as.TP', 'role', 'as.PV', 'as.SZ', 'as._mv', 'as.TMM', 'as.Arm', 'as.Str', 'as.OV'];
    private static readonly AS_TABLE_VISIBLE_GROUPS = ['as.damage'];
    private static readonly CBT_TABLE_VISIBLE_KEYS = ['name', 'type', 'subtype', 'role', 'bv', 'tons', 'year', 'level', 'techBase', 'moveType', 'armor', 'internal', '_mdSumNoPhysical', 'dpt', 'c3', 'cost'];
    private static readonly CBT_TABLE_VISIBLE_GROUPS = ['movement'];

    /**
     * Get the sort slot value for AS table row view.
     * Returns null if the sort key is already visible in the table columns.
     */
    getAsTableSortSlot(unit: Unit): string | null {
        const key = this.filtersService.selectedSort();
        if (!key) return null;

        // Check if key is directly in table columns
        if (UnitSearchComponent.AS_TABLE_VISIBLE_KEYS.includes(key)) return null;

        // Check if key is in a group that's in table columns
        for (const groupName of UnitSearchComponent.AS_TABLE_VISIBLE_GROUPS) {
            const group = UnitSearchComponent.SORT_KEY_GROUPS[groupName];
            if (group && group.includes(key)) return null;
        }

        return this.formatTableSortSlotValue(unit, key);
    }

    getClassicTableSortSlot(unit: Unit): string | null {
        const key = this.filtersService.selectedSort();
        if (!key) return null;

        if (UnitSearchComponent.CBT_TABLE_VISIBLE_KEYS.includes(key)) return null;

        for (const groupName of UnitSearchComponent.CBT_TABLE_VISIBLE_GROUPS) {
            const group = UnitSearchComponent.SORT_KEY_GROUPS[groupName];
            if (group && group.includes(key)) return null;
        }

        return this.formatTableSortSlotValue(unit, key);
    }

    /**
     * Get the sort slot display for a chassis group.
     * Returns a formatted min–max range (or single value) for the current sort key, or null.
     */
    getChassisGroupSortSlot(group: ChassisGroup): string | null {
        const key = this.filtersService.selectedSort();
        if (!key || UnitSearchComponent.CHASSIS_VIEW_VISIBLE_KEYS.includes(key)) return null;

        let min = Infinity;
        let max = -Infinity;
        let isNumeric = false;

        for (const unit of group.units) {
            const raw = this.getNestedProperty(unit, key);
            if (typeof raw === 'number') {
                isNumeric = true;
                if (raw < min) min = raw;
                if (raw > max) max = raw;
            }
        }

        if (!isNumeric) return null;

        const fmtMin = FormatNumberPipe.formatValue(min, true, false);
        const fmtMax = FormatNumberPipe.formatValue(max, true, false);
        return min === max ? fmtMin : `${fmtMin}–${fmtMax}`;
    }

    /** Get a nested property value using dot notation (e.g., 'as.PV') */
    private getNestedProperty(obj: any, key: string): any {
        if (!obj || !key) return undefined;
        if (!key.includes('.')) return obj[key];
        const parts = key.split('.');
        let cur: any = obj;
        for (const p of parts) {
            if (cur == null) return undefined;
            cur = cur[p];
        }
        return cur;
    }

    formatClassicMovement(unit: Unit): string {
        if (!unit.walk) return '';

        let movement = `${unit.walk} / ${unit.run}`;
        if (unit.run2 && unit.run2 !== unit.run) {
            movement += ` [${unit.run2}]`;
        }
        if (unit.jump) {
            movement += ` / ${unit.jump}`;
        }
        if (unit.umu) {
            movement += ` / ${unit.umu}`;
        }

        return movement;
    }

    formatClassicSubtype(unit: Unit): string {
        return unit.subtype && unit.subtype !== unit.type ? unit.subtype : '';
    }

    formatArmorType(armorType: string | undefined): string {
        if (!armorType) return '';
        return armorType.endsWith(' Armor') ? armorType.slice(0, -6) : armorType;
    }

    formatStructureType(structureType: string | undefined): string {
        if (!structureType) return '';
        return structureType.endsWith(' Structure') ? structureType.slice(0, -10) : structureType;
    }

    private formatTableSortSlotValue(unit: Unit, key: string): string {
        if (UnitSearchComponent.SORT_KEY_GROUPS['movement'].includes(key)) {
            return this.formatClassicMovement(unit) || '—';
        }

        if (key === 'subtype') {
            return this.formatClassicSubtype(unit) || '—';
        }

        const raw = this.getNestedProperty(unit, key);
        if (raw == null) return '—';

        return typeof raw === 'number' ? FormatNumberPipe.formatValue(raw, true, false) : String(raw);
    }

    formatClassicStat(value: number | undefined): string {
        if (value === undefined || value === null) {
            return '—';
        }
        return FormatNumberPipe.formatValue(value, true, false);
    }

    formatClassicBv(unit: Unit, gunnery: number, piloting: number): string {
        return FormatNumberPipe.formatValue(BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, gunnery, piloting), true, false);
    }

    formatTons(tons: number | undefined): string {
        if (tons === undefined) return '';

        const format = (value: number) => Math.round(value * 100) / 100;
        if (tons < 1000) {
            return `${format(tons)}`;
        }
        if (tons < 1000000) {
            return `${format(tons / 1000)}k`;
        }
        return `${format(tons / 1000000)}M`;
    }

    async onAddTag({ unit, event }: TagClickEvent) {
        event.stopPropagation();

        // Determine which units to tag: selected units if any.
        const selectedNames = this.selectedUnits();
        const allUnits = this.filtersService.filteredUnits();
        let unitsToTag: Unit[];
        if (selectedNames.size > 0) {
            // Always include the clicked unit, even if not in the selection
            const selectedSet = new Set(selectedNames);
            selectedSet.add(unit.name);
            unitsToTag = allUnits.filter(u => selectedSet.has(u.name));
        } else {
            unitsToTag = [unit];
        }

        // Get anchor element for positioning
        const evtTarget = (event.currentTarget as HTMLElement) || (event.target as HTMLElement);
        const anchorEl = (evtTarget.closest('.add-tag-btn') as HTMLElement) || evtTarget;

        await this.taggingService.openTagSelector(unitsToTag, anchorEl);
        this.cdr.markForCheck();
    }

    setPilotSkill(type: 'gunnery' | 'piloting', value: number) {
        const currentGunnery = this.filtersService.pilotGunnerySkill();
        const currentPiloting = this.filtersService.pilotPilotingSkill();
        if (type === 'gunnery') {
            this.filtersService.setPilotSkills(value, currentPiloting);
        } else {
            this.filtersService.setPilotSkills(currentGunnery, value);
        }

        this.activeIndex.set(null);
    }

    setBvPvLimit(value: number) {
        this.filtersService.bvPvLimit.set(value >= 0 ? value : 0);
        this.activeIndex.set(null);
    }

    openSelect(event: Event, select: HTMLSelectElement) {
        event.preventDefault();
        event.stopPropagation();
        select.showPicker?.() ?? select.focus();
    }

    /* Adv Panel Dragging */
    onAdvPanelDragStart(event: PointerEvent) {
        if (!this.advPanelDocked() || !this.expandedView()) return;
        event.preventDefault();
        event.stopPropagation();
        this.advPanelDragStartX = event.clientX;
        this.advPanelDragStartWidth = parseInt(this.advPanelStyle().width, 10) || 300;

        window.addEventListener('pointermove', this.onAdvPanelDragMove);
        window.addEventListener('pointerup', this.onAdvPanelDragEnd);
        window.addEventListener('pointercancel', this.onAdvPanelDragEnd);
        try {
            (event.target as HTMLElement).setPointerCapture(event.pointerId);
        } catch (e) { /* ignore */ }
    }

    onAdvPanelDragMove = (event: PointerEvent) => {
        const delta = event.clientX - this.advPanelDragStartX;
        // When filters are on left, dragging right increases width; otherwise dragging left increases width
        const newWidth = this.filtersOnLeft()
            ? this.advPanelDragStartWidth + delta
            : this.advPanelDragStartWidth - delta;
        // Snap to 1 or 2 columns
        if (newWidth > 450) {
            this.advPanelUserColumns.set(2);
        } else {
            this.advPanelUserColumns.set(1);
        }
    };

    onAdvPanelDragEnd = (event: PointerEvent) => {
        try {
            (event.target as HTMLElement).releasePointerCapture(event.pointerId);
        } catch (e) { /* ignore */ }
        window.removeEventListener('pointermove', this.onAdvPanelDragMove);
        window.removeEventListener('pointerup', this.onAdvPanelDragEnd);
        window.removeEventListener('pointercancel', this.onAdvPanelDragEnd);
    };

    multiSelectUnit(unit: Unit, event?: Event) {
        event?.stopPropagation();
        const selected = new Set(this.selectedUnits());
        if (selected.has(unit.name)) {
            selected.delete(unit.name);
        } else {
            selected.add(unit.name);
        }
        this.selectedUnits.set(selected);
    }

    // Multi-select logic: click with Ctrl/Cmd or Shift to select multiple units
    onUnitCardClick(unit: Unit, event?: MouseEvent) {
        const multiSelect = event ? (event.ctrlKey || event.metaKey || event.shiftKey) : false;
        if (event && multiSelect) {
            // Multi-select logic
            this.multiSelectUnit(unit, event);
            return;
        }
        // Single click: show inline panel if available, otherwise open dialog
        this.inlinePanelUnit.set(unit);
        if (this.showInlinePanel()) {
            // Update activeIndex to match clicked unit
            const filteredUnits = this.filtersService.filteredUnits();
            const index = filteredUnits.findIndex(u => u.name === unit.name);
            if (index >= 0) {
                this.activeIndex.set(index);
            }
        } else {
            this.showUnitDetails(unit);
        }
    }

    onUnitInfoClick(unit: Unit) {
        this.showUnitDetails(unit);
    }

    /** Handle unit added from inline panel */
    onInlinePanelAdd(): void {
        if (this.forceBuilderService.smartCurrentForce()?.units().length == 1) {
            // If this is the first unit being added, close the search panel
            this.closeAllPanels();
            this.expandedView.set(false);
        }
        this.blurInput();
    }

    /** Navigate to previous unit in inline panel */
    onInlinePanelPrev(): void {
        const index = this.inlinePanelIndex();
        if (index > 0) {
            const prevUnit = this.filtersService.filteredUnits()[index - 1];
            this.inlinePanelUnit.set(prevUnit);
            this.activeIndex.set(index - 1);
            this.scrollToMakeVisible(index - 1);
        }
    }

    /** Navigate to next unit in inline panel */
    onInlinePanelNext(): void {
        const index = this.inlinePanelIndex();
        const filteredUnits = this.filtersService.filteredUnits();
        if (index >= 0 && index < filteredUnits.length - 1) {
            const nextUnit = filteredUnits[index + 1];
            this.inlinePanelUnit.set(nextUnit);
            this.activeIndex.set(index + 1);
            this.scrollToMakeVisible(index + 1);
        }
    }

    isUnitSelected(unit: Unit): boolean {
        return this.selectedUnits().has(unit.name);
    }

    clearSelection() {
        if (this.selectedUnits().size > 0) {
            this.selectedUnits.set(new Set());
        }
    }

    selectAll() {
        const allUnits = this.filtersService.filteredUnits();
        const allNames = new Set(allUnits.map(u => u.name));
        this.selectedUnits.set(allNames);
    }

    async addSelectedUnits() {
        const gunnery = this.filtersService.pilotGunnerySkill();
        const piloting = this.filtersService.pilotPilotingSkill();
        const selectedUnits = this.selectedUnits();
        for (let selectedUnit of selectedUnits) {
            const unit = this.dataService.getUnitByName(selectedUnit);
            if (unit) {
                if (!await this.forceBuilderService.addUnit(unit, gunnery, piloting)) {
                    break;
                }
            }
        };
        this.clearSelection();
        this.closeAllPanels();
    }

    /**
     * Show ability info dialog for an Alpha Strike special ability.
     * @param abilityText The original ability text (e.g., "ECM", "LRM1/2/2")
     */
    showAbilityInfoDialog(abilityText: string): void {
        const parsedAbility = this.abilityLookup.parseAbility(abilityText);
        this.dialogsService.createDialog<void>(AbilityInfoDialogComponent, {
            data: { parsedAbility } as AbilityInfoDialogData
        });
    }

    /**
     * Format movement value for Alpha Strike expanded view.
     * Converts inches to hexes if hex mode is enabled.
     * Handles different movement modes (j for jump, etc.)
     */
    formatASMovement(unit: Unit): string {
        const mvm = unit.as.MVm;
        if (!mvm) return unit.as.MV ?? '';

        const entries = Object.entries(mvm)
            .filter(([, value]) => typeof value === 'number' && value > 0) as Array<[string, number]>;

        if (entries.length === 0) return unit.as.MV ?? '';

        return entries
            .sort((a, b) => {
                if (a[0] === '') return -1;
                if (b[0] === '') return 1;
                return 0;
            })
            .map(([mode, inches]) => formatMovement(inches, mode, this.optionsService.options().ASUseHex))
            .join('/');
    }

    private tableCellClass(base: string, active: boolean): string {
        return active ? `${base} sort-slot` : base;
    }

    private currentViewport(): CdkVirtualScrollViewport | undefined {
        return this.resultsDataTable()?.getViewport() ?? this.viewport();
    }

    private normalizeViewMode(viewMode: 'list' | 'card' | 'chassis' | 'table'): 'list' | 'card' | 'chassis' | 'table' {
        if (!this.gameService.isAlphaStrike() && viewMode === 'card') {
            return 'list';
        }
        if (!this.expandedView() && viewMode === 'table') {
            return 'list';
        }
        return viewMode;
    }

    private setViewMode(viewMode: 'list' | 'card' | 'chassis' | 'table') {
        const normalizedViewMode = this.normalizeViewMode(viewMode);
        this.viewMode.set(normalizedViewMode);
        void this.optionsService.setOption('unitSearchViewMode', normalizedViewMode);
    }

    toggleExpandedView() {
        const isExpanded = this.expandedView();

        if (isExpanded) {
            if (this.forceBuilderService.hasForces()) {
                this.closeAllPanels();
                this.blurInput();
            }
        }
        this.expandedView.set(!isExpanded);
    }

    clearSearch() {
        this.immediateSearchText.set('');
        this.filtersService.searchText.set('');
        this.activeIndex.set(null);
    }

    /**
     * Cycle through view modes.
     * AS:  list → card → chassis → table → list
        * CBT: list → chassis → table → list
     */
    cycleViewMode() {
        const current = this.viewMode();
        const isAS = this.gameService.isAlphaStrike();
        const isExpanded = this.expandedView();
        if (isAS) {
            // Compact: list → card → chassis → list
            // Expanded: list → card → chassis → table → list
            if (!isExpanded) {
                this.setViewMode(
                    current === 'list'
                        ? 'card'
                        : current === 'card'
                            ? 'chassis'
                            : 'list'
                );
                return;
            }

            // list → card → chassis → table → list
            this.setViewMode(
                current === 'list'
                    ? 'card'
                    : current === 'card'
                        ? 'chassis'
                        : current === 'chassis'
                            ? 'table'
                            : 'list'
            );
        } else {
            if (!isExpanded) {
                this.setViewMode(current === 'list' ? 'chassis' : 'list');
                return;
            }

            this.setViewMode(
                current === 'list'
                    ? 'chassis'
                    : current === 'chassis'
                        ? 'table'
                        : 'list'
            );
        }
    }

    /**
     * Handle click on a compact chassis group.
     * Appends a chassis filter to the current search to drill down into variants.
     */
    onCompactGroupClick(group: ChassisGroup) {
        // Build a chassis= filter and set it as the search text
        const chassisFilter = `chassis="${group.chassis}"`;
        const typeFilter = group.type ? ` type="${group.type}"` : '';
        const fullFilter = chassisFilter + typeFilter;
        const current = this.filtersService.searchText().trim();
        const newSearch = current ? `${current} ${fullFilter}` : fullFilter;
        this.immediateSearchText.set(newSearch);
        this.filtersService.searchText.set(newSearch);
        // Switch back to list view to show variants
        this.setViewMode('list');
    }

    openShareSearch(event: MouseEvent) {
        event.stopPropagation();
        this.dialogsService.createDialog(ShareSearchDialogComponent);
    }

    openSemanticGuide(event: MouseEvent) {
        event.stopPropagation();
        this.dialogsService.createDialog(SemanticGuideDialogComponent);
    }

    /* ------------------------------------------
     * Favorites overlay/menu
     */

    openFavorites(event: MouseEvent) {
        event.stopPropagation();

        // If already open, close it
        if (this.overlayManager.has('favorites')) {
            this.overlayManager.closeManagedOverlay('favorites');
            this.favoritesCompRef = null;
            return;
        }
        const target = this.favBtn()?.nativeElement || (event.target as HTMLElement);
        const portal = new ComponentPortal(SearchFavoritesMenuComponent, null, this.injector);
        const { componentRef } = this.overlayManager.createManagedOverlay('favorites', target, portal, {
            hasBackdrop: false,
            panelClass: 'favorites-overlay-panel',
            closeOnOutsideClick: true,
            scrollStrategy: this.overlay.scrollStrategies.reposition()
        });
        this.favoritesCompRef = componentRef;

        // Get favorites - filter by game system only if a force is loaded
        const hasForces = this.forceBuilderService.hasForces();
        const favorites = hasForces
            ? this.savedSearchesService.getSearchesForGameSystem(this.gameService.currentGameSystem())
            : this.savedSearchesService.getAllSearches();
        componentRef.setInput('favorites', favorites);

        // Determine if saving is allowed (has search text or filters)
        const hasSearchText = (this.filtersService.searchText() ?? '').trim().length > 0;
        const filterState = this.filtersService.filterState();
        const hasActiveFilters = Object.values(filterState).some(s => s.interactedWith);
        componentRef.setInput('canSave', hasSearchText || hasActiveFilters);

        outputToObservable(componentRef.instance.select).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((favorite: SerializedSearchFilter) => {
            if (favorite) this.applyFavorite(favorite);
            this.overlayManager.closeManagedOverlay('favorites');
            this.favoritesCompRef = null;
        });
        outputToObservable(componentRef.instance.rename).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((favorite: SerializedSearchFilter) => {
            this.renameSearch(favorite);
        });
        outputToObservable(componentRef.instance.delete).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((favorite: SerializedSearchFilter) => {
            this.deleteSearch(favorite);
        });
        outputToObservable(componentRef.instance.saveRequest).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.saveCurrentSearch();
        });
        outputToObservable(componentRef.instance.menuOpened).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.overlayManager.blockCloseUntil('favorites');
        });
        outputToObservable(componentRef.instance.menuClosed).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            // Delay unblock to allow menu item click to process first
            // But don't unblock if a dialog operation is in progress
            setTimeout(() => {
                if (!this.favoritesDialogActive) {
                    this.overlayManager.unblockClose('favorites');
                }
            }, 50);
        });
    }

    closeFavorites() {
        this.overlayManager.closeManagedOverlay('favorites');
        this.favoritesCompRef = null;
    }

    private async saveCurrentSearch() {
        // Block favorites overlay from closing while dialog is open
        this.favoritesDialogActive = true;
        this.overlayManager.blockCloseUntil('favorites');
        try {
            // Check if there's anything to save (text or filters)
            const hasSearchText = (this.filtersService.searchText() ?? '').trim().length > 0;
            const filterState = this.filtersService.filterState();
            const hasActiveFilters = Object.values(filterState).some(s => s.interactedWith);

            if (!hasSearchText && !hasActiveFilters) {
                await this.dialogsService.showNotice(
                    'Please enter a search query or set some filters before saving a bookmark.',
                    'Nothing to Save'
                );
                return;
            }

            const name = await this.dialogsService.prompt(
                'Enter a name for this Tactical Bookmark (e.g. "Clan Raid 3052")',
                'Save Tactical Bookmark',
                ''
            );
            if (name === null) return; // cancelled
            const trimmed = (name || '').trim();
            if (!trimmed) return;

            const gameSystem = this.gameService.currentGameSystem();
            const gsKey = gameSystem === GameSystem.ALPHA_STRIKE ? 'as' : 'cbt';
            const id = generateUUID();
            const filter = this.filtersService.serializeCurrentSearchFilter(id, trimmed, gsKey);

            await this.savedSearchesService.saveSearch(filter);
            // Refresh the overlay with the new bookmark
            this.refreshFavoritesOverlay();
        } finally {
            this.favoritesDialogActive = false;
            // Unblock after small delay to prevent immediate close from residual events
            setTimeout(() => this.overlayManager.unblockClose('favorites'), 100);
        }
    }

    private async renameSearch(favorite: SerializedSearchFilter) {
        // Block favorites overlay from closing while dialog is open
        this.favoritesDialogActive = true;
        this.overlayManager.blockCloseUntil('favorites');
        try {
            const newName = await this.dialogsService.prompt(
                'Enter a new name for this bookmark:',
                'Rename Tactical Bookmark',
                favorite.name
            );
            if (newName === null) return; // cancelled
            const trimmed = (newName || '').trim();
            if (!trimmed || trimmed === favorite.name) return;

            await this.savedSearchesService.renameSearch(favorite.id, trimmed);
            // Refresh the overlay with updated data
            this.refreshFavoritesOverlay();
        } finally {
            this.favoritesDialogActive = false;
            // Unblock after small delay to prevent immediate close from residual events
            setTimeout(() => this.overlayManager.unblockClose('favorites'), 100);
        }
    }

    private async deleteSearch(favorite: SerializedSearchFilter) {
        // Block favorites overlay from closing while dialog is open
        this.favoritesDialogActive = true;
        this.overlayManager.blockCloseUntil('favorites');
        try {
            const confirmed = await this.dialogsService.requestConfirmation(
                `Delete "${favorite.name}"?`,
                'Delete Tactical Bookmark',
                'danger'
            );
            if (!confirmed) return;

            await this.savedSearchesService.deleteSearch(favorite.id);
            // Refresh the overlay with updated data
            this.refreshFavoritesOverlay();
        } finally {
            this.favoritesDialogActive = false;
            // Unblock after small delay to prevent immediate close from residual events
            setTimeout(() => this.overlayManager.unblockClose('favorites'), 100);
        }
    }

    private refreshFavoritesOverlay() {
        // Update favorites data in-place without closing overlay
        if (this.favoritesCompRef && this.overlayManager.has('favorites')) {
            // Get favorites - filter by game system only if a force is loaded
            const hasForces = this.forceBuilderService.hasForces();
            const favorites = hasForces
                ? this.savedSearchesService.getSearchesForGameSystem(this.gameService.currentGameSystem())
                : this.savedSearchesService.getAllSearches();
            this.favoritesCompRef.setInput('favorites', favorites);

            // Also update canSave state
            const hasSearchText = (this.filtersService.searchText() ?? '').trim().length > 0;
            const filterState = this.filtersService.filterState();
            const hasActiveFilters = Object.values(filterState).some(s => s.interactedWith);
            this.favoritesCompRef.setInput('canSave', hasSearchText || hasActiveFilters);
        }
    }

    private applyFavorite(fav: SerializedSearchFilter) {
        // Switch game mode only if the saved search has a specific game system
        // Game-agnostic searches (no gameSystem) don't switch the mode
        if (fav.gameSystem) {
            const currentGs = this.gameService.currentGameSystem();
            const favGs = fav.gameSystem === 'as' ? GameSystem.ALPHA_STRIKE : GameSystem.CLASSIC;
            if (favGs !== currentGs) {
                this.gameService.setMode(favGs);
            }
        }
        this.filtersService.applySerializedSearchFilter(fav);
    }
}
