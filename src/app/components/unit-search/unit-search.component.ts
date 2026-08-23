// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { CommonModule } from '@angular/common';
import { Component, signal, type ElementRef, computed, effect, afterNextRender, Injector, inject, ChangeDetectionStrategy, viewChild, ChangeDetectorRef, DestroyRef, untracked, type ComponentRef, type TemplateRef } from '@angular/core';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ScrollingModule, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { UnitSearchAdvancedFiltersComponent } from '../unit-search-advanced-filters/unit-search-advanced-filters.component';
import {
    isMegaMekRaritySortKey,
    SORT_OPTIONS,
    type SortOption,
    type SerializedSearchFilter,
} from '../../services/unit-search-filters.model';
import { getMegaMekAvailabilityRarityForScore, MEGAMEK_AVAILABILITY_UNKNOWN_SCORE } from '../../models/megamek/availability.model';
import { type HighlightToken, tokenizeForHighlight } from '../../utils/semantic-filter-ast.util';
import { isFilterAvailableForAvailabilitySource } from '../../utils/unit-search-filter-config.util';
import type { UnitSummary } from '../../models/unit-summary.model';
import { DEFAULT_CLASSIC_BV_NORMALIZATION_MAX, DEFAULT_ALPHA_STRIKE_PV_NORMALIZATION_MAX, getNormalizationGunnery, getNormalizationPiloting, type UnitSearchNormalizationMatch, type UnitSearchBudgetMode } from '../../models/unit-search-result.model';
import { ForceBuilderService } from '../../services/force-builder.service';
import { Overlay, OverlayModule, type ConnectedPosition, type OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { UnitDetailsDialogComponent, type UnitDetailsDialogData } from '../unit-details-dialog/unit-details-dialog.component';
import { firstValueFrom } from 'rxjs';
import { LayoutService } from '../../services/layout.service';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { FormatNumberPipe } from '../../pipes/format-number.pipe';
import { LongPressDirective } from '../../directives/long-press.directive';
import { TooltipDirective } from '../../directives/tooltip.directive';
import { SearchFavoritesMenuComponent } from '../search-favorites-menu/search-favorites-menu.component';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { ShareSearchDialogComponent } from './share-search.component';
import { SemanticGuideDialogComponent } from '../semantic-guide-dialog/semantic-guide-dialog.component';
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
import { formatASDamageValue, isASDamageFilterKey } from '../../utils/as-damage.util';
import { SavedSearchesService } from '../../services/saved-searches.service';
import { GameSystem } from '../../models/common.model';
import { AS_TYPE_DISPLAY_NAMES, DROPDOWN_FILTERS, RANGE_FILTERS } from '../../services/unit-search-filters.model';
import { KeyboardShortcutService } from '../../services/keyboard-shortcut.service';
import { UnitDetailsPanelComponent } from '../unit-details-panel/unit-details-panel.component';
import { UnitCardExpandedComponent } from '../unit-card-expanded/unit-card-expanded.component';
import { AlphaStrikeCardComponent } from '../alpha-strike-card/alpha-strike-card.component';
import type { UnitType } from '../../models/unit-summary.model';
import { BVCalculatorUtil } from '../../utils/bv-calculator.util';
import { updateNumericRangeBound } from '../../utils/unit-search-normalization-range.util';
import { DataTableComponent, type DataTableCellContext, type DataTableColumn, type DataTableRowClickEvent, type DataTableRowLongPressEvent, type DataTableRowPointerEnterEvent, type DataTableRowPointerMoveEvent, type DataTableSortEvent } from '../data-table/data-table.component';
import { UnitSearchFiltersService } from '../../services/unit-search-filters.service';
import { getUnitVariantGroupIdentity, getUnitVariantGroupKey, type UnitVariantGroupIdentity, unitMatchesVariantGroup } from '../../utils/unit-variant.util';
import { DropdownPointerActivationGuard, type DropdownPointerHoverEvent } from '../../utils/dropdown-interaction.utils';
import { uuidv7 } from '../../utils/uuid.util';
import { formatBvPv } from '../../utils/force-viewer-bv-pv-display.util';
import { adjustPointValueForSkill } from '../../utils/pv-skill-adjustment.util';
import { normalizeUnitSearchRange, rangeFilterAllowsFloatingValues } from '../../utils/unit-search-range-dialog.util';
import { VariableSizeVirtualScrollDirective } from '../../directives/variable-size-virtual-scroll.directive';
import type { UnitSearchViewMode } from '../../models/options.model';
import { RangeSliderComponent } from '../range-slider/range-slider.component';
import { SimpleSliderComponent } from '../simple-slider/simple-slider.component';
import { normalizeBoundedInteger, normalizeBoundedIntegerInput } from '../../utils/bounded-integer-input.util';
import {
    buildUnitDataTableColumns,
    formatAlphaStrikeUnitMovement,
    formatClassicUnitMovement,
    formatUnitDataTableSortSlotValue,
    getUnitDataTableSortSlotHeader,
    isUnitDataTableSortActive,
} from '../../utils/unit-data-table.util';

/** Grouped chassis entry for compact view */
export interface ChassisGroup extends UnitVariantGroupIdentity {
    key: string;
    chassis: string;
    type: UnitType;
    displayType: string;
    icon: string;
    /** A representative unit (first encountered) for icon display */
    representativeUnit: UnitSummary;
    variantCount: number;
    minBV: number;
    maxBV: number;
    minPV: number;
    maxPV: number;
    units: UnitSummary[];
}

interface ViewModeOptionConfig {
    mode: UnitSearchViewMode;
    label: string;
    caption: string;
    gameSystem?: GameSystem;
    requiresExpanded?: boolean;
}

interface ViewModeOption extends ViewModeOptionConfig {
    disabled: boolean;
    disabledReason: string | null;
    willExpand: boolean;
}

interface ActiveVariantGroupFilter extends UnitVariantGroupIdentity {
    key: string;
    representativeUnit: UnitSummary;
}

@Component({
    selector: 'unit-search',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, ScrollingModule, OverlayModule, LongPressDirective, TooltipDirective, UnitIconComponent, UnitTagsComponent, SyntaxInputComponent, UnitSearchAdvancedFiltersComponent, UnitDetailsPanelComponent, UnitCardExpandedComponent, AlphaStrikeCardComponent, DataTableComponent, VariableSizeVirtualScrollDirective, RangeSliderComponent, SimpleSliderComponent],
    templateUrl: './unit-search.component.html',
    styleUrls: [
        './unit-search.component.scss',
        './unit-search-advanced-controls.component.scss',
        './unit-search-table.component.scss',
    ],
    host: {
        '(keydown)': 'onKeydown($event)',
        '(document:keydown)': 'onDocumentKeydown($event)'
    }
})
export class UnitSearchComponent {
    readonly maximumNormalizedPv = DEFAULT_ALPHA_STRIKE_PV_NORMALIZATION_MAX;
    readonly forceBvLimitTooltip = [
        { value: 'Filters search results to units whose adjusted BV or PV fits within the remaining force budget.' },
        { value: 'The remaining budget is the Force BV/PV Limit minus the BV/PV already in the current force. Pilot skill adjustments are included.' },
    ];
    readonly bvNormalizationTooltip = [
        { value: 'Finds a Gunnery/Piloting combination within the selected ranges that places each unit inside the Target BV range.' },
        { value: 'With a constrained Target BV maximum, selects the highest adjusted BV that does not exceed it.' },
        { value: 'Max Delta limits the absolute difference between the effective Gunnery and Piloting values.' },
        { value: 'Units with fixed Piloting ignore the Piloting range and Max Delta; only Gunnery is adjusted.' },
        { value: 'Matching results keep their selected skills and adjusted BV when viewed or added to a force.' },
    ];
    readonly pvNormalizationTooltip = [
        { value: 'Finds a Skill value within the selected range that places each unit inside the Target PV range.' },
        { value: 'With a constrained Target PV maximum, selects the highest adjusted PV that does not exceed it.' },
        { value: 'Matching results keep their selected Skill and adjusted PV when viewed or added to a force.' },
    ];
    readonly normalizationMaxDeltaTooltip = [
        { value: 'Limits the absolute difference between effective Gunnery and Piloting for eligible skill combinations.' },
        { value: 'A value of 0 requires equal skills. A value of 8 allows every combination.' },
        { value: 'This limit does not apply to units with fixed Piloting.' },
    ];
    private static supportsCssAnchorPositioning(): boolean {
        const css = globalThis.CSS;
        return !!css?.supports
            && css.supports('position-anchor: --unit-searchbar')
            && css.supports('top: anchor(bottom)')
            && css.supports('width: anchor-size(width)');
    }

    private static readonly VIEW_MODE_MENU_POSITIONS: ConnectedPosition[] = [
        { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
        { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
        { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
        { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
    ];

    private static readonly VIEW_MODE_OPTIONS: readonly ViewModeOptionConfig[] = [
        { mode: 'list', label: 'List View', caption: 'Result cards' },
        { mode: 'card', label: 'Card View', caption: 'Alpha Strike cards', gameSystem: GameSystem.ALPHA_STRIKE },
        { mode: 'chassis', label: 'Chassis View', caption: 'Grouped chassis' },
        { mode: 'table', label: 'Table View', caption: 'Expanded table', requiresExpanded: true },
    ];

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
    protected optionsService = inject(OptionsService);
    private taggingService = inject(TaggingService);
    private savedSearchesService = inject(SavedSearchesService);
    private keyboardShortcutService = inject(KeyboardShortcutService);

    readonly useHex = computed(() => this.optionsService.options().ASUseHex);
    readonly cardStyle = computed(() => this.optionsService.options().colorScheme);
    readonly megaMekAvailabilitySourceSelected = computed(() => this.optionsService.options().availabilitySource === 'megamek');
    /** Whether the layout is filters-list-panel (filters on left) */
    readonly filtersOnLeft = computed(() => this.optionsService.options().unitSearchExpandedViewLayout === 'filters-list-panel');
    readonly supportsCssAnchorPositioning = UnitSearchComponent.supportsCssAnchorPositioning();

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

    private searchDebounceTimer?: ReturnType<typeof setTimeout>;
    private heightTrackingDebounceTimer?: ReturnType<typeof setTimeout>;
    private readonly resultPointerActivationGuard = new DropdownPointerActivationGuard();
    private readonly SEARCH_DEBOUNCE_MS = 300;
    private pendingSearchText: string | null = null;

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
    private filterChordTimer?: ReturnType<typeof setTimeout>;
    /** Reference to the favorites overlay component for in-place updates. */
    private favoritesCompRef: ComponentRef<SearchFavoritesMenuComponent> | null = null;
    /** Flag to track when a favorites dialog (rename/delete) is in progress. */
    private favoritesDialogActive = false;
    /** Immediate input value for instant highlighting (not debounced). */
    readonly immediateSearchText = signal('');
    private readonly searchCommitPending = signal(false);
    private readonly pendingResultOpenRequest = signal(false);

    syntaxInput = viewChild<SyntaxInputComponent>('syntaxInput');
    private readonly searchbarContainer = viewChild<ElementRef<HTMLElement>>('searchbarContainer');
    advBtn = viewChild.required<ElementRef<HTMLButtonElement>>('advBtn');
    favBtn = viewChild.required<ElementRef<HTMLButtonElement>>('favBtn');
    advPanel = viewChild<ElementRef<HTMLElement>>('advPanel');
    resultsDropdown = viewChild<ElementRef<HTMLElement>>('resultsDropdown');
    resultsDataTable = viewChild<DataTableComponent<UnitSummary>>(DataTableComponent);
    private readonly tableIconCell = viewChild<TemplateRef<DataTableCellContext<UnitSummary>>>('tableIconCell');
    private readonly tableNameCell = viewChild<TemplateRef<DataTableCellContext<UnitSummary>>>('tableNameCell');
    private readonly tableYearCell = viewChild<TemplateRef<DataTableCellContext<UnitSummary>>>('tableYearCell');
    private readonly tableTypeCell = viewChild<TemplateRef<DataTableCellContext<UnitSummary>>>('tableTypeCell');
    private readonly tableBvCell = viewChild<TemplateRef<DataTableCellContext<UnitSummary>>>('tableBvCell');
    private readonly tablePvCell = viewChild<TemplateRef<DataTableCellContext<UnitSummary>>>('tablePvCell');
    private readonly tableMovementCell = viewChild<TemplateRef<DataTableCellContext<UnitSummary>>>('tableMovementCell');
    private readonly tableClassicMovementCell = viewChild<TemplateRef<DataTableCellContext<UnitSummary>>>('tableClassicMovementCell');
    private readonly tableSpecialsCell = viewChild<TemplateRef<DataTableCellContext<UnitSummary>>>('tableSpecialsCell');
    private readonly tableTagsCell = viewChild<TemplateRef<DataTableCellContext<UnitSummary>>>('tableTagsCell');

    /** Query the active dropdown element directly from DOM to avoid viewChild retention */
    private getActiveDropdownElement(): HTMLElement | null {
        return this.resultsDropdown()?.nativeElement ?? null;
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
    viewModeMenuOpen = signal(false);
    activeIndex = signal<number | null>(null);
    selectedUnits = signal<Set<string>>(new Set());
    private readonly selectedUnitContexts = new Map<string, UnitSearchNormalizationMatch>();
    readonly activeVariantGroupFilter = signal<ActiveVariantGroupFilter | null>(null);
    private unitDetailsDialogOpen = signal(false);

     /**
      * Current results view mode.
      * - 'list'    : default list view
      * - 'card'    : AS card grid (Alpha Strike only)
      * - 'chassis' : compact chassis-grouped view
      * - 'table'   : expanded table view
      */
    readonly viewMode = this.filtersService.viewMode;



    /** Unit currently selected for inline details panel in expanded view */
    inlinePanelUnit = signal<UnitSummary | null>(null);

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
    readonly displayedUnits = computed(() => {
        const units = this.filtersService.filteredUnits();
        const variantGroupFilter = this.activeVariantGroupFilter();
        if (!variantGroupFilter) return units;

        return units.filter(unit => unitMatchesVariantGroup(unit, variantGroupFilter));
    });
    readonly displayedUnitKeys = computed(() => this.displayedUnits().map(unit => unit.name));
    readonly activeVariantGroupRepresentativeUnit = computed(() => {
        return this.displayedUnits()[0] ?? this.activeVariantGroupFilter()?.representativeUnit ?? null;
    });
    readonly activeVariantGroupTitle = computed(() => {
        const variantGroupFilter = this.activeVariantGroupFilter();
        return variantGroupFilter ? this.formatVariantGroupTitle(variantGroupFilter) : '';
    });
    readonly activeVariantGroupMeta = computed(() => {
        const variantGroupFilter = this.activeVariantGroupFilter();
        return variantGroupFilter ? this.formatVariantGroupMeta(variantGroupFilter, this.displayedUnits().length) : '';
    });
    readonly cardViewColumnCount = computed(() => {
        const measuredWidth = this.resultsDropdownWidth();
        const availableWidth = Math.max(0, measuredWidth - (this.cardViewRowPaddingPx * 2));
        return Math.max(1, Math.floor((availableWidth + this.cardViewGapPx) / (this.cardViewMinWidthPx + this.cardViewGapPx)));
    });
    readonly cardViewRows = computed(() => {
        const units = this.displayedUnits();
        const columnCount = this.cardViewColumnCount();
        const rows: UnitSummary[][] = [];

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

    readonly viewModeMenuPositions = UnitSearchComponent.VIEW_MODE_MENU_POSITIONS;
    readonly viewModeMenuScrollStrategy = this.overlay.scrollStrategies.reposition();

    readonly viewModeOptions = computed((): ViewModeOption[] => {
        const gameSystem = this.gameSystem();
        const expanded = this.expandedView();

        return UnitSearchComponent.VIEW_MODE_OPTIONS.map(option => {
            const disabled = option.gameSystem != null && option.gameSystem !== gameSystem;
            return {
                ...option,
                disabled,
                disabledReason: disabled ? `${option.label} is unavailable in the current game system` : null,
                willExpand: !disabled && !!option.requiresExpanded && !expanded,
            };
        });
    });

    /**
     * Units grouped by chassis+Alpha Strike type+omni status for compact view.
     * Each group contains summary info (BV range, tonnage, year range, variant count).
     */
    readonly groupedUnits = computed((): ChassisGroup[] => {
        const units = this.filtersService.filteredUnits();
        if (units.length === 0) return [];

        const map = new Map<string, ChassisGroup>();

        for (const unit of units) {
            const key = getUnitVariantGroupKey(unit);
            let group = map.get(key);
            if (!group) {
                const identity = getUnitVariantGroupIdentity(unit);
                group = {
                    key,
                    ...identity,
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
            if (unit.as.PV < group.minPV) group.minPV = unit.as.PV;
            if (unit.as.PV > group.maxPV) group.maxPV = unit.as.PV;
        }

        return Array.from(map.values());
    });

    formatChassisGroupBvPv(group: ChassisGroup): string {
        const isAlphaStrike = this.gameService.isAlphaStrike();
        const gunnery = this.filtersService.pilotGunnerySkill();
        const piloting = this.filtersService.pilotPilotingSkill();
        const baseValues = group.units.map(unit => isAlphaStrike ? unit.as.PV : unit.bv);
        const adjustedValues = group.units.map(unit => isAlphaStrike
            ? this.filtersService.activePvNormalization()
                ? this.getSearchResultContext(unit).adjustedValue
                : adjustPointValueForSkill(unit.as.PV, gunnery)
            : this.filtersService.activeBvNormalization()
                ? this.getSearchResultContext(unit).adjustedValue
                : BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, gunnery, piloting));
        const formatRange = (values: number[]) => {
            const min = Math.min(...values);
            const max = Math.max(...values);
            const format = (value: number) => FormatNumberPipe.formatValue(value, true, false);
            return min === max ? format(min) : `${format(min)}–${format(max)}`;
        };
        const base = formatRange(baseValues);
        const adjusted = formatRange(adjustedValues);

        if (adjusted !== base) return `${adjusted} (${base})`;
        return adjusted;
    }

    /** Index of the currently selected unit in the filtered list */
    private inlinePanelIndex = computed(() => {
        const unit = this.inlinePanelUnit();
        if (!unit) return -1;
        return this.displayedUnits().findIndex(u => u.name === unit.name);
    });

    /** Whether there is a previous unit to navigate to in the inline panel */
    inlinePanelHasPrev = computed(() => this.inlinePanelIndex() > 0);

    /** Previous unit preview for the inline details panel */
    inlinePanelPrevUnit = computed(() => {
        const index = this.inlinePanelIndex();
        return index > 0 ? this.displayedUnits()[index - 1] ?? null : null;
    });

    /** Whether there is a next unit to navigate to in the inline panel */
    inlinePanelHasNext = computed(() => {
        const index = this.inlinePanelIndex();
        return index >= 0 && index < this.displayedUnits().length - 1;
    });

    /** Next unit preview for the inline details panel */
    inlinePanelNextUnit = computed(() => {
        const index = this.inlinePanelIndex();
        const units = this.displayedUnits();
        return index >= 0 && index < units.length - 1 ? units[index + 1] ?? null : null;
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
        const sample = this.getUnitSortRawValue(units[0], key);
        if (typeof sample !== 'number') return null;

        const opt: SortOption | undefined = this.SORT_OPTIONS.find(o => o.key === key);
        return opt?.slotLabel || opt?.label || key;
    });

    /** Label for a selected sort that is not represented by a standard table column. */
    readonly unitTableSortSlotHeader = computed(() => getUnitDataTableSortSlotHeader(
        this.gameService.currentGameSystem(),
        this.filtersService.selectedSort(),
        this.SORT_OPTIONS,
    ));

    readonly unitSearchTableColumns = computed<readonly DataTableColumn<UnitSummary>[]>(() => {
        const iconCell = this.tableIconCell();
        const nameCell = this.tableNameCell();
        const yearCell = this.tableYearCell();
        const typeCell = this.tableTypeCell();
        const bvCell = this.tableBvCell();
        const pvCell = this.tablePvCell();
        const movementCell = this.tableMovementCell();
        const classicMovementCell = this.tableClassicMovementCell();
        const specialsCell = this.tableSpecialsCell();
        const tagsCell = this.tableTagsCell();
        const gameSystem = this.gameService.currentGameSystem();
        const isAlphaStrike = gameSystem === GameSystem.ALPHA_STRIKE;
        const valueCell = isAlphaStrike ? pvCell : bvCell;
        const selectedMovementCell = isAlphaStrike ? movementCell : classicMovementCell;

        if (!iconCell || !nameCell || !yearCell || !valueCell || !selectedMovementCell || !tagsCell) {
            return [];
        }
        if (isAlphaStrike && (!typeCell || !specialsCell)) {
            return [];
        }

        const afterValueColumns: DataTableColumn<UnitSummary>[] = [];
        if (isAlphaStrike && this.filtersService.activePvNormalization()) {
            afterValueColumns.push({
                id: 'normalized-skill',
                header: 'Skill',
                track: 45,
                value: unit => getNormalizationGunnery(this.getSearchResultContext(unit)),
                cellTone: 'focus',
                align: 'center',
            });
        } else if (!isAlphaStrike && this.filtersService.activeBvNormalization()) {
            afterValueColumns.push({
                id: 'normalized-skills',
                header: 'G/P',
                track: 56,
                value: unit => this.formatNormalizedSkills(unit),
                cellTone: 'focus',
                align: 'center',
            });
        }

        const sortSlotHeader = this.unitTableSortSlotHeader();
        return buildUnitDataTableColumns({
            gameSystem,
            getUnit: unit => unit,
            isSortActive: keyOrGroup => this.isSortActive(keyOrGroup),
            templates: {
                icon: iconCell,
                name: nameCell,
                year: yearCell,
                value: valueCell,
                movement: selectedMovementCell,
                type: typeCell,
                specials: specialsCell,
            },
            valueTrack: isAlphaStrike
                ? (this.filtersService.activePvNormalization() ? 82 : 45)
                : (this.filtersService.activeBvNormalization() ? 128 : 78),
            afterValueColumns,
            sortSlot: sortSlotHeader ? {
                header: sortSlotHeader,
                value: unit => this.getUnitTableSortSlot(unit) ?? '',
            } : null,
            trailingColumns: [{
                id: 'tags',
                header: 'Tags',
                track: 230,
                cellTemplate: tagsCell,
                headerClass: 'as-th-tags',
                cellClass: 'as-td-tags',
                align: 'right',
            }],
        });
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
    readonly advPanelAnchoredBelow = signal(false);
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
            (this.filtersService.searchText() || this.isAdvActive() || this.activeVariantGroupFilter());
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

    private readonly compactListItemSize = 75;
    readonly cardItemHeight = signal(220);
    readonly itemSize = computed(() => {
        if (this.viewMode() === 'card' && this.gameService.isAlphaStrike()) {
            return this.cardItemHeight();
        }

        return this.compactListItemSize;
    });

    private resizeObserver?: ResizeObserver;
    private resultsResizeObserver?: ResizeObserver;
    private advPanelDragStartX = 0;
    private advPanelDragStartWidth = 0;

    constructor() {
        this.keyboardShortcutService.register({
            id: 'unit-search-results',
            active: () => this.resultsVisible() && this.displayedUnits().length > 0,
            handle: (event) => this.handleSearchResultsShortcutKeyDown(event),
        }, this.destroyRef);

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
                if (this.pendingSearchText !== null) {
                    this.cancelPendingSearchCommit();
                    this.pendingResultOpenRequest.set(false);
                }
                if (this.immediateSearchText() !== text) {
                    this.immediateSearchText.set(text);
                }
            });
        });
        effect(() => {
            const displayedNames = new Set(this.displayedUnits().map(unit => unit.name));
            untracked(() => {
                const selected = this.selectedUnits();
                if (![...selected].every(name => displayedNames.has(name))) {
                    this.selectedUnits.set(new Set([...selected].filter(name => displayedNames.has(name))));
                }
                const inlineUnit = this.inlinePanelUnit();
                if (inlineUnit && !displayedNames.has(inlineUnit.name)) {
                    this.inlinePanelUnit.set(null);
                }
            });
        });
        effect(() => {
            this.filtersService.activeNormalization();
            untracked(() => this.clearSelection());
        });
        effect(() => {
            const closeRequest = this.filtersService.closePanelsRequest();
            if (closeRequest.requestId === 0) {
                return;
            }

            untracked(() => {
                this.closeAllPanels();
                if (closeRequest.exitExpandedView) {
                    this.expandedView.set(false);
                }
            });
        });
        effect(() => {
            if (!this.pendingResultOpenRequest()) return;
            if (this.isResultOpenBlockedByPendingSearch()) return;

            const items = this.displayedUnits();
            untracked(() => {
                this.pendingResultOpenRequest.set(false);
                this.openCurrentSearchResult(items);
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
        // Keep externally applied and restored modes compatible with the current UI state.
        effect(() => {
            const viewMode = this.viewMode();
            const normalizedViewMode = this.normalizeViewMode(viewMode);
            if (normalizedViewMode !== viewMode) {
                untracked(() => this.filtersService.setViewMode(normalizedViewMode));
            }
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
            const container = this.searchbarContainer()?.nativeElement;
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
        this.setupVirtualViewportSizeTracking();
        this.setupItemHeightTracking();
        this.destroyRef.onDestroy(() => {
            pendingResizeObserverRef?.destroy();
            this.cancelPendingSearchCommit();
            if (this.heightTrackingDebounceTimer) {
                clearTimeout(this.heightTrackingDebounceTimer);
            }
            clearTimeout(this.filterChordTimer);
            this.removeAdvPanelDragListeners();
            this.resizeObserver?.disconnect();
            this.resultsResizeObserver?.disconnect();
            this.closeFavorites();
        });
    }

    trackCardRow = (index: number, row: UnitSummary[]) => row[0]?.name ?? index;

    getCardUnitIndex(rowIndex: number, columnIndex: number): number {
        return rowIndex * this.cardViewColumnCount() + columnIndex;
    }

    private getViewportItemIndex(index: number): number {
        if (this.viewMode() === 'card' && this.gameService.isAlphaStrike()) {
            return Math.floor(index / this.cardViewColumnCount());
        }
        return index;
    }

    private getDefaultCardItemHeight(): number {
        return 220;
    }

    /**
     * Keeps the active CDK viewport's cached dimensions synchronized with its
     * rendered dimensions. CDK can initialize the viewport while the results
     * container is hidden, caching a height of zero until explicitly checked.
     */
    private setupVirtualViewportSizeTracking(): void {
        let observedElement: HTMLElement | null = null;
        let viewportResizeObserver: ResizeObserver | null = null;
        let pendingVisibilityCheck: { destroy: () => void } | null = null;

        const checkViewportSize = () => {
            const viewport = this.currentViewport();
            const viewportElement = viewport?.elementRef.nativeElement ?? null;
            if (!viewport
                || !viewportElement
                || !this.resultsVisible()
                || viewportElement !== observedElement
                || viewportElement.clientWidth <= 0
                || viewportElement.clientHeight <= 0) {
                return;
            }

            viewport.checkViewportSize();
        };

        effect(() => {
            const visible = this.resultsVisible();
            const directViewport = this.viewport();
            const tableViewport = this.resultsDataTable()?.getViewport();
            const activeViewport = tableViewport ?? directViewport;

            untracked(() => {
                const nextElement = visible
                    ? activeViewport?.elementRef.nativeElement ?? null
                    : null;

                if (nextElement !== observedElement) {
                    viewportResizeObserver?.disconnect();
                    viewportResizeObserver = null;
                    observedElement = nextElement;

                    if (observedElement) {
                        viewportResizeObserver = new ResizeObserver(checkViewportSize);
                        viewportResizeObserver.observe(observedElement);
                    }
                }

                pendingVisibilityCheck?.destroy();
                pendingVisibilityCheck = null;
                if (observedElement) {
                    pendingVisibilityCheck = afterNextRender(() => {
                        pendingVisibilityCheck = null;
                        checkViewportSize();
                    }, { injector: this.injector });
                }
            });
        });

        this.destroyRef.onDestroy(() => {
            pendingVisibilityCheck?.destroy();
            viewportResizeObserver?.disconnect();
            observedElement = null;
        });
    }

    private setupItemHeightTracking(): void {
        const DEBOUNCE_MS = 100;
        const measureCardRowHeight = () => {
            if (this.viewMode() !== 'card' || !this.gameService.isAlphaStrike()) return;

            const dropdown = this.getActiveDropdownElement();
            if (!dropdown) return;

            const cardRow = dropdown.querySelector('.card-view-row') as HTMLElement | null;
            if (!cardRow) return;

            const measuredHeight = Math.round(cardRow.offsetHeight);
            if (measuredHeight > 0 && this.cardItemHeight() !== measuredHeight) {
                this.cardItemHeight.set(measuredHeight);
            }
        };

        const debouncedMeasureCardRow = (debounceMs = DEBOUNCE_MS) => {
            if (this.heightTrackingDebounceTimer) {
                clearTimeout(this.heightTrackingDebounceTimer);
            }
            this.heightTrackingDebounceTimer = setTimeout(() => {
                if (!this.resultsVisible()) return;
                measureCardRowHeight();
            }, debounceMs);
        };

        effect(() => {
            const currentViewMode = this.viewMode();

            untracked(() => {
                if (this.heightTrackingDebounceTimer) {
                    clearTimeout(this.heightTrackingDebounceTimer);
                    this.heightTrackingDebounceTimer = undefined;
                }
                if (currentViewMode !== 'card') {
                    this.cardItemHeight.set(this.getDefaultCardItemHeight());
                }
            });

            if (!this.resultsVisible() || currentViewMode !== 'card' || !this.gameService.isAlphaStrike()) return;
            this.resultsDropdownWidth();
            this.displayedUnits();
            debouncedMeasureCardRow();
        });
    }

    public closeAllPanels() {
        this.pendingResultOpenRequest.set(false);
        this.focused.set(false);
        this.advOpen.set(false);
        this.viewModeMenuOpen.set(false);
        this.activeIndex.set(null);
        this.blurInput();
    }

    onOverlayClick() {
        if (this.expandedView()) return;
        this.closeAllPanels();
    }

    trackByUnitId(index: number, unit: UnitSummary) {
        // Track by index to force position-based recycling in virtual scroll
        // Tracking by unit.name causes orphaned DOM nodes for who knows what reason...
        return index;
    }

    readonly unitTableRowClass = (unit: UnitSummary, index: number) => ({
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
        this.activeIndex.set(null);
        this.pendingResultOpenRequest.set(false);
        // Debounce the actual search/filtering
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
        }
        this.pendingSearchText = val;
        this.searchCommitPending.set(true);
        this.searchDebounceTimer = setTimeout(() => this.flushPendingSearch(), this.SEARCH_DEBOUNCE_MS);
    }

    private cancelPendingSearchCommit(): void {
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
            this.searchDebounceTimer = undefined;
        }
        this.pendingSearchText = null;
        this.searchCommitPending.set(false);
    }

    private flushPendingSearch() {
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
            this.searchDebounceTimer = undefined;
        }

        if (this.pendingSearchText === null) {
            this.searchCommitPending.set(false);
            return;
        }

        const nextSearchText = this.pendingSearchText;
        this.pendingSearchText = null;
        this.filtersService.setSearchText(nextSearchText);
        this.activeIndex.set(null);
        this.searchCommitPending.set(false);
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
        if (this.supportsCssAnchorPositioning && !this.expandedView()) {
            return;
        }

        const gap = 4;

        const { top: safeTop, bottom: safeBottom } = this.layoutService.getSafeAreaInsets();
        const visualViewport = window.visualViewport;
        const viewportOffsetTop = visualViewport?.offsetTop ?? 0;
        const viewportHeight = visualViewport?.height ?? window.innerHeight;
        let dropdownWidth: number;
        let top: number;
        let baseTop: number;

        if (this.expandedView()) {
            // When expanded, container is fixed at top with 4px margins
            // Calculate position based on the expanded state, not current DOM position
            dropdownWidth = window.innerWidth - 8; // 4px left + 4px right margin
            baseTop = safeTop + 4 + 40 + gap; // top margin + searchbar height + gap
            top = baseTop + viewportOffsetTop;
        } else {
            // Normal mode: use actual container position
            const container = this.searchbarContainer()?.nativeElement;
            if (!container) return;

            const containerRect = container.getBoundingClientRect();
            dropdownWidth = containerRect.width;
            baseTop = containerRect.bottom + gap;
            top = baseTop + viewportOffsetTop;
        }

        let height;
        if (this.displayedUnits().length > 0) {
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

        const { bottom: safeBottom } = this.layoutService.getSafeAreaInsets();
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
        const opensBelow = !this.advPanelDocked() && spaceAvailable < panelWidth;

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
        this.advPanelAnchoredBelow.set(opensBelow);
    }

    setAdvFilter(key: string, value: unknown) {
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
        return Object.values(state).some(s => s.interactedWith)
            || this.filtersService.budgetMode() !== null
            || this.filtersService.bvPvLimit() > 0;
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
            this.pendingResultOpenRequest.set(false);
            if (this.viewModeMenuOpen()) {
                this.closeViewModeMenu();
                return;
            } else if (this.advOpen()) {
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
        if (event.key === 'Enter') {
            if (this.isResultNavigationBlockedForTarget(event.target)) return;
            if (this.requestOpenCurrentSearchResult()) {
                event.preventDefault();
            }
            return;
        }
        if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            if (this.isResultNavigationBlockedForTarget(event.target)) return;
            const items = this.displayedUnits();
            if (items.length === 0) return;
            switch (event.key) {
                case 'ArrowDown':
                    event.preventDefault();
                    this.navigateSearchResults('next', items);
                    break;
                case 'ArrowUp':
                    event.preventDefault();
                    this.navigateSearchResults('previous', items);
                    break;
            }
        }
    }

    private isResultNavigationBlockedForTarget(target: EventTarget | null): boolean {
        if (!(target instanceof HTMLElement)) return false;

        const interactiveElement = target.closest('input, textarea, select, button, [contenteditable]');
        if (!interactiveElement) return false;

        return !(interactiveElement.matches('input.syntax-input') && interactiveElement.closest('syntax-input'));
    }

    private isResultOpenBlockedByPendingSearch(): boolean {
        return this.searchCommitPending() || !this.filtersService.isSearchSettled();
    }

    private requestOpenCurrentSearchResult(): boolean {
        this.flushPendingSearch();

        if (this.isResultOpenBlockedByPendingSearch()) {
            this.pendingResultOpenRequest.set(true);
            return true;
        }

        return this.openCurrentSearchResult();
    }

    private openCurrentSearchResult(items = this.displayedUnits()): boolean {
        if (items.length === 0) return false;

        const currentActiveIndex = this.activeIndex();
        const index = currentActiveIndex !== null && currentActiveIndex >= 0 && currentActiveIndex < items.length
            ? currentActiveIndex
            : 0;
        this.showUnitDetails(items[index]);
        return true;
    }

    private handleSearchResultsShortcutKeyDown(event: KeyboardEvent): boolean {
        if (event.ctrlKey || event.altKey || event.metaKey) return false;
        if (this.isResultNavigationBlockedForTarget(event.target)) return false;

        if (event.key === 'ArrowDown') {
            return this.navigateSearchResults('next');
        } else if (event.key === 'ArrowUp') {
            return this.navigateSearchResults('previous');
        }

        return false;
    }

    private navigateSearchResults(direction: 'next' | 'previous', items = this.displayedUnits()): boolean {
        if (items.length === 0) return false;

        this.resultPointerActivationGuard.suppress();
        const currentActiveIndex = this.activeIndex();
        if (direction === 'next') {
            const nextIndex = currentActiveIndex !== null ? Math.min(currentActiveIndex + 1, items.length - 1) : 0;
            if (nextIndex === currentActiveIndex) return true;

            this.selectResultIndex(nextIndex, items, 'auto');
            return true;
        }

        if (currentActiveIndex !== null && currentActiveIndex > 0) {
            const prevIndex = currentActiveIndex - 1;
            this.selectResultIndex(prevIndex, items, 'auto');
        } else {
            if (currentActiveIndex !== null) {
                this.setActiveResultIndex(null, items);
            }
            this.focusInput();
        }
        return true;
    }

    onResultPointerHover(index: number, event: DropdownPointerHoverEvent): void {
        if (this.resultPointerActivationGuard.shouldIgnore(event)) return;

        this.activeIndex.set(index);
    }

    private selectResultIndex(index: number, items = this.displayedUnits(), behavior: ScrollBehavior = 'smooth'): void {
        this.resultPointerActivationGuard.suppress();
        this.setActiveResultIndex(index, items);
        this.scrollToMakeVisible(index, behavior);
    }

    private setActiveResultIndex(index: number | null, items = this.displayedUnits()): void {
        this.activeIndex.set(index);

        if (index !== null) {
            const unit = items[index];
            if (unit) {
                this.inlinePanelUnit.set(unit);
            }
        }
    }

    /**
     * Scroll to make the item at the given index visible, but only if it's not already visible.
     * If scrolling is needed, positions the item at the nearest edge (top or bottom).
     */
    private scrollToMakeVisible(index: number, behavior: ScrollBehavior = 'smooth') {
        const vp = this.currentViewport();
        if (!vp) return;
        const viewportIndex = this.getViewportItemIndex(index);

        const vpElement = vp.elementRef.nativeElement;
        const renderedRange = vp.getRenderedRange();

        // Check if the item is within the rendered range
        if (viewportIndex < renderedRange.start || viewportIndex >= renderedRange.end) {
            // Item is not rendered at all, need to scroll to it
            vp.scrollToIndex(viewportIndex, behavior);
            return;
        }

        // Find the rendered items
        const items = vpElement.querySelectorAll('.results-dropdown-item:not(.no-results), .mb-data-table-row-item, .card-view-row');
        const localIndex = viewportIndex - renderedRange.start;

        if (localIndex < 0 || localIndex >= items.length) {
            // Safety fallback
            vp.scrollToIndex(viewportIndex, behavior);
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
            vp.scrollToOffset(currentOffset - scrollAmount, behavior);
        } else {
            // Item is below the visible area - scroll down by the exact amount needed
            const scrollAmount = itemRect.bottom - vpRect.bottom;
            vp.scrollToOffset(currentOffset + scrollAmount, behavior);
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
        const filterConfig = RANGE_FILTERS.find(filter => filter.key === filterKey);
        const filterName = currentFilter.label || filterKey;
        const message = `Enter the ${filterName} range values:`;

        const ref = this.dialogsService.createDialog<RangeModel | null>(UnitSearchFilterRangeDialogComponent, {
            data: {
                title: filterName,
                message: message,
                range: {
                    from: currentValue[0],
                    to: currentValue[1]
                },
                allowFloatingValues: rangeFilterAllowsFloatingValues(filterConfig),
            } as UnitSearchFilterRangeDialogData
        });
        let newValues = await firstValueFrom(ref.closed);
        if (newValues === undefined || newValues === null) return;

        // Unset: both null means user explicitly cleared the filter
        if (newValues.from === null && newValues.to === null) {
            this.filtersService.unsetFilter(filterKey);
            return;
        }

        this.setAdvFilter(filterKey, normalizeUnitSearchRange(newValues, totalRange));
    }

    showUnitDetails(unit: UnitSummary) {
        const filteredUnits = this.displayedUnits();
        const filteredUnitIndex = filteredUnits.findIndex(u => u.name === unit.name);
        const searchResultContexts = new Map(
            filteredUnits.map(resultUnit => [resultUnit.name, this.getSearchResultContext(resultUnit)]),
        );
        const ref = this.dialogsService.createDialog(UnitDetailsDialogComponent, {
            data: <UnitDetailsDialogData>{
                unitList: filteredUnits,
                unitIndex: filteredUnitIndex,
                gunnerySkill: this.filtersService.pilotGunnerySkill(),
                pilotingSkill: this.filtersService.pilotPilotingSkill(),
                searchResultContexts,
            }
        });
        this.unitDetailsDialogOpen.set(true);

        // Track navigation within the dialog to keep activeIndex in sync
        const indexChangeSub = ref.componentInstance?.indexChange.subscribe((newIndex: number) => {
            this.selectResultIndex(newIndex, this.displayedUnits(), 'auto');
        });

        const addSub = ref.componentInstance?.add.subscribe(() => {
            if (this.forceBuilderService.smartCurrentForce()?.units().length === 1) {
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
     * Check if the current sort key matches any of the provided keys or groups.
     * Use in templates: [class.sort-slot]="isSortActive('as.PV')" or isSortActive('as.damage')
     */
    onHeaderSort(sortKey: string, groupKey?: string): void {
        this.resetActiveResult();
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

    onSortOrderChange(sortKey: string): void {
        this.resetActiveResult();
        this.filtersService.setSortOrder(sortKey);
    }

    toggleSortDirection(): void {
        this.resetActiveResult();
        const current = this.filtersService.selectedSortDirection();
        this.filtersService.setSortDirection(current === 'asc' ? 'desc' : 'asc');
    }

    private resetActiveResult(): void {
        this.activeIndex.set(null);
        this.inlinePanelUnit.set(null);
    }

    onUnitTableRowClick(event: DataTableRowClickEvent<UnitSummary>): void {
        this.onUnitCardClick(event.row, event.event);
    }

    onUnitTableRowLongPress(event: DataTableRowLongPressEvent<UnitSummary>): void {
        this.multiSelectUnit(event.row, event.event);
    }

    onUnitTableRowPointerEnter(event: DataTableRowPointerEnterEvent<UnitSummary>): void {
        this.onResultPointerHover(event.index, event.event);
    }

    onUnitTableRowPointerMove(event: DataTableRowPointerMoveEvent<UnitSummary>): void {
        this.onResultPointerHover(event.index, event.event);
    }

    isSortActive(...keysOrGroups: string[]): boolean {
        return isUnitDataTableSortActive(this.filtersService.selectedSort(), ...keysOrGroups);
    }

    getUnitTableSortSlot(unit: UnitSummary): string | null {
        const key = this.filtersService.selectedSort();
        if (!key || !this.unitTableSortSlotHeader()) {
            return null;
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
            const raw = this.getUnitSortRawValue(unit, key);
            if (typeof raw === 'number') {
                isNumeric = true;
                if (raw < min) min = raw;
                if (raw > max) max = raw;
            }
        }

        if (!isNumeric) return null;

        if (isMegaMekRaritySortKey(key)) {
            const fmtMin = this.formatMegaMekRaritySortScore(min);
            const fmtMax = this.formatMegaMekRaritySortScore(max);
            return min === max ? fmtMin : `${fmtMin}–${fmtMax}`;
        }

        if (isASDamageFilterKey(key)) {
            const fmtMin = formatASDamageValue(min);
            const fmtMax = formatASDamageValue(max);
            return min === max ? fmtMin : `${fmtMin}–${fmtMax}`;
        }

        const fmtMin = FormatNumberPipe.formatValue(min, true, false);
        const fmtMax = FormatNumberPipe.formatValue(max, true, false);
        return min === max ? fmtMin : `${fmtMin}–${fmtMax}`;
    }

    /** Get a nested property value using dot notation (e.g., 'as.PV') */
    private getNestedProperty(obj: unknown, key: string): unknown {
        if (obj == null || typeof obj !== 'object' || !key) return undefined;
        const parts = key.split('.');
        let cur: unknown = obj;
        for (const p of parts) {
            if (cur == null || typeof cur !== 'object') return undefined;
            cur = (cur as Record<string, unknown>)[p];
        }
        return cur;
    }

    formatClassicMovement(unit: UnitSummary): string {
        return formatClassicUnitMovement(unit);
    }

    formatArmorType(armorType: string | undefined): string {
        if (!armorType) return '';
        return armorType.endsWith(' Armor') ? armorType.slice(0, -6) : armorType;
    }

    formatStructureType(structureType: string | undefined): string {
        if (!structureType) return '';
        return structureType.endsWith(' Structure') ? structureType.slice(0, -10) : structureType;
    }

    private formatTableSortSlotValue(unit: UnitSummary, key: string): string {
        if (isMegaMekRaritySortKey(key)) {
            return this.formatMegaMekRaritySortScore(this.filtersService.getMegaMekRaritySortScore(unit));
        }

        return formatUnitDataTableSortSlotValue(unit, key, (candidate, sortKey) =>
            this.getUnitSortRawValue(candidate, sortKey)
        );
    }

    getSearchResultMegaMekRarity(unit: UnitSummary): string {
        return this.formatMegaMekRaritySortScore(this.filtersService.getMegaMekRaritySortScore(unit));
    }

    getSearchResultMegaMekAvailability(unit: UnitSummary) {
        return this.filtersService.getMegaMekAvailabilityBadges(unit);
    }

    getCardSortSlotOverride(unit: UnitSummary): { value: string; numeric?: boolean } | null {
        if (!isMegaMekRaritySortKey(this.filtersService.selectedSort())) {
            return null;
        }

        return {
            value: this.getSearchResultMegaMekRarity(unit),
            numeric: false,
        };
    }

    private formatMegaMekRaritySortScore(score: number): string {
        if (score === MEGAMEK_AVAILABILITY_UNKNOWN_SCORE) {
            return '—';
        }

        return getMegaMekAvailabilityRarityForScore(score);
    }

    private getUnitSortRawValue(unit: UnitSummary, key: string): unknown {
        if (isMegaMekRaritySortKey(key)) {
            return this.filtersService.getMegaMekRaritySortScore(unit);
        }

        return this.getNestedProperty(unit, key);
    }

    formatClassicBv(unit: UnitSummary, gunnery: number, piloting: number): string {
        if (this.filtersService.activeBvNormalization()) {
            return formatBvPv(
                this.getSearchResultContext(unit).adjustedValue,
                unit.bv,
                'both',
            );
        }
        return formatBvPv(
            BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, gunnery, piloting),
            unit.bv,
            'both',
        );
    }

    formatNormalizedSkills(unit: UnitSummary): string {
        const context = this.getSearchResultContext(unit);
        return context.kind === 'pv' ? `${context.skill}` : `${context.gunnery}/${context.piloting}`;
    }

    formatAlphaStrikePv(unit: UnitSummary, gunnery: number): string {
        return formatBvPv(
            this.filtersService.activePvNormalization()
                ? this.getSearchResultContext(unit).adjustedValue
                : adjustPointValueForSkill(unit.as.PV, gunnery),
            unit.as.PV,
            'both',
        );
    }

    async onAddTag({ unit, event }: TagClickEvent) {
        event.stopPropagation();

        // Determine which units to tag: selected units if any.
        const selectedNames = this.selectedUnits();
        const allUnits = this.displayedUnits();
        let unitsToTag: UnitSummary[];
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

    onBvPvLimitInput(event: Event): void {
        const normalizedValue = normalizeBoundedIntegerInput(event, {
            min: 0,
            max: Number.MAX_SAFE_INTEGER,
            emptyWhenZero: true,
        });
        this.setBvPvLimit(normalizedValue);
    }

    setSearchBudgetMode(mode: UnitSearchBudgetMode): void {
        this.filtersService.setBudgetMode(mode);
        this.activeIndex.set(null);
    }

    toggleSearchBudgetMode(mode: Exclude<UnitSearchBudgetMode, null>): void {
        this.setSearchBudgetMode(this.filtersService.budgetMode() === mode ? null : mode);
    }

    setNormalizationTargetBvBound(bound: 'min' | 'max', value: number): void {
        const current = this.filtersService.classicBvNormalizationSettings();
        if (!Number.isFinite(value)) return;

        const normalizedValue = normalizeBoundedInteger(value, {
            min: 0,
            max: DEFAULT_CLASSIC_BV_NORMALIZATION_MAX,
        });

        this.filtersService.setBvNormalizationSettings({
            ...current,
            targetBv: updateNumericRangeBound(current.targetBv, bound, normalizedValue),
        });
        this.activeIndex.set(null);
    }

    onNormalizationTargetBvBoundChange(bound: 'min' | 'max', event: Event): void {
        const value = normalizeBoundedIntegerInput(event, {
            min: 0,
            max: DEFAULT_CLASSIC_BV_NORMALIZATION_MAX,
        });
        this.setNormalizationTargetBvBound(bound, value);
        const input = event.target as HTMLInputElement | null;
        if (input) {
            input.value = `${this.filtersService.classicBvNormalizationSettings().targetBv[bound]}`;
        }
    }

    setNormalizationMaxDelta(value: number): void {
        if (!Number.isInteger(value) || value < 0 || value > 8) {
            return;
        }

        this.filtersService.setBvNormalizationSettings({
            ...this.filtersService.classicBvNormalizationSettings(),
            maxDelta: value,
        });
        this.activeIndex.set(null);
    }

    setNormalizationSkillRange(range: 'gunnery' | 'piloting', value: [number, number]): void {
        const [min, max] = value;
        if (!Number.isInteger(min) || !Number.isInteger(max)
            || min < 0 || max > 8 || min > max) {
            return;
        }

        this.filtersService.setBvNormalizationSettings({
            ...this.filtersService.classicBvNormalizationSettings(),
            [range]: { min, max },
        });
        this.activeIndex.set(null);
    }

    setPvNormalizationTargetBound(bound: 'min' | 'max', value: number): void {
        if (!Number.isFinite(value)) return;
        const current = this.filtersService.alphaStrikePvNormalizationSettings();
        const normalizedValue = normalizeBoundedInteger(value, {
            min: 0,
            max: DEFAULT_ALPHA_STRIKE_PV_NORMALIZATION_MAX,
        });
        this.filtersService.setPvNormalizationSettings({
            ...current,
            targetPv: updateNumericRangeBound(current.targetPv, bound, normalizedValue),
        });
        this.activeIndex.set(null);
    }

    onPvNormalizationTargetBoundChange(bound: 'min' | 'max', event: Event): void {
        const value = normalizeBoundedIntegerInput(event, {
            min: 0,
            max: DEFAULT_ALPHA_STRIKE_PV_NORMALIZATION_MAX,
        });
        this.setPvNormalizationTargetBound(bound, value);
        const input = event.target as HTMLInputElement | null;
        if (input) input.value = `${this.filtersService.alphaStrikePvNormalizationSettings().targetPv[bound]}`;
    }

    setPvNormalizationSkillRange(value: [number, number]): void {
        const [min, max] = value;
        if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max > 8 || min > max) return;
        this.filtersService.setPvNormalizationSettings({
            ...this.filtersService.alphaStrikePvNormalizationSettings(),
            skill: { min, max },
        });
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
        this.removeAdvPanelDragListeners();
    };

    private removeAdvPanelDragListeners(): void {
        window.removeEventListener('pointermove', this.onAdvPanelDragMove);
        window.removeEventListener('pointerup', this.onAdvPanelDragEnd);
        window.removeEventListener('pointercancel', this.onAdvPanelDragEnd);
    }

    multiSelectUnit(unit: UnitSummary, event?: Event) {
        event?.stopPropagation();
        const selected = new Set(this.selectedUnits());
        if (selected.has(unit.name)) {
            selected.delete(unit.name);
            this.selectedUnitContexts.delete(unit.name);
        } else {
            selected.add(unit.name);
            this.selectedUnitContexts.set(unit.name, this.getSearchResultContext(unit));
        }
        this.selectedUnits.set(selected);
    }

    // Multi-select logic: click with Ctrl/Cmd or Shift to select multiple units
    onUnitCardClick(unit: UnitSummary, event?: MouseEvent) {
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
            const filteredUnits = this.displayedUnits();
            const index = filteredUnits.findIndex(u => u.name === unit.name);
            if (index >= 0) {
                this.activeIndex.set(index);
            }
        } else {
            this.showUnitDetails(unit);
        }
    }

    onUnitInfoClick(unit: UnitSummary) {
        this.showUnitDetails(unit);
    }

    /** Handle unit added from inline panel */
    onInlinePanelAdd(): void {
        if (this.forceBuilderService.smartCurrentForce()?.units().length === 1) {
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
            this.selectResultIndex(index - 1, this.displayedUnits(), 'auto');
        }
    }

    /** Navigate to next unit in inline panel */
    onInlinePanelNext(): void {
        const index = this.inlinePanelIndex();
        const filteredUnits = this.displayedUnits();
        if (index >= 0 && index < filteredUnits.length - 1) {
            this.selectResultIndex(index + 1, filteredUnits, 'auto');
        }
    }

    isUnitSelected(unit: UnitSummary): boolean {
        return this.selectedUnits().has(unit.name);
    }

    clearSelection() {
        if (this.selectedUnits().size > 0) {
            this.selectedUnits.set(new Set());
            this.selectedUnitContexts.clear();
        }
    }

    selectAll() {
        const allUnits = this.displayedUnits();
        const allNames = new Set(allUnits.map(u => u.name));
        this.selectedUnits.set(allNames);
        this.selectedUnitContexts.clear();
        for (const unit of allUnits) {
            this.selectedUnitContexts.set(unit.name, this.getSearchResultContext(unit));
        }
    }

    async addSelectedUnits() {
        const selectedUnits = this.selectedUnits();
        for (let selectedUnit of selectedUnits) {
            const unit = this.dataService.getUnitByName(selectedUnit);
            if (unit) {
                const context = this.selectedUnitContexts.get(selectedUnit)
                    ?? this.getSearchResultContext(unit);
                if (!await this.forceBuilderService.addUnit(
                    unit,
                    getNormalizationGunnery(context),
                    getNormalizationPiloting(context),
                )) {
                    break;
                }
            }
        };
        this.clearSelection();
        this.closeAllPanels();
    }

    getSearchResultContext(unit: UnitSummary): UnitSearchNormalizationMatch {
        return this.filtersService.getSearchResultPilotContext(unit);
    }

    getSearchResultGunnery(unit: UnitSummary): number {
        return getNormalizationGunnery(this.getSearchResultContext(unit));
    }

    getSearchResultPiloting(unit: UnitSummary): number {
        return getNormalizationPiloting(this.getSearchResultContext(unit));
    }

    showGenerateForceDialog(): void {
        void this.forceBuilderService.showSearchForceGeneratorDialog();
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
    formatASMovement(unit: UnitSummary): string {
        return formatAlphaStrikeUnitMovement(unit, this.optionsService.options().ASUseHex);
    }

    private currentViewport(): CdkVirtualScrollViewport | undefined {
        return this.resultsDataTable()?.getViewport() ?? this.viewport();
    }

    private normalizeViewMode(viewMode: UnitSearchViewMode): UnitSearchViewMode {
        if (viewMode === 'chassis' && this.activeVariantGroupFilter()) {
            return 'list';
        }
        if (!this.gameService.isAlphaStrike() && viewMode === 'card') {
            return 'list';
        }
        return viewMode;
    }

    private setViewMode(viewMode: UnitSearchViewMode) {
        const normalizedViewMode = this.normalizeViewMode(viewMode);
        this.filtersService.setViewMode(normalizedViewMode);
    }

    toggleViewModeMenu(event: MouseEvent) {
        event.stopPropagation();
        this.viewModeMenuOpen.update(open => !open);
    }

    closeViewModeMenu() {
        this.viewModeMenuOpen.set(false);
    }

    selectViewMode(viewMode: UnitSearchViewMode, event?: MouseEvent) {
        event?.stopPropagation();
        const option = this.viewModeOptions().find(item => item.mode === viewMode);
        if (!option || option.disabled) return;

        if (viewMode === 'chassis' && this.activeVariantGroupFilter()) {
            this.clearVariantGroupFilter();
            this.closeViewModeMenu();
            return;
        }

        if (option.requiresExpanded && !this.expandedView()) {
            this.expandedView.set(true);
        }

        this.setViewMode(viewMode);
        void this.optionsService.setOption('unitSearchViewMode', this.viewMode());
        this.closeViewModeMenu();
    }

    openExpandedSearch(event: MouseEvent): void {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
            return;
        }

        event.preventDefault();
        if (!this.expandedView()) {
            this.toggleExpandedView();
        }
    }

    toggleExpandedView(): void {
        const isExpanded = this.expandedView();

        if (isExpanded) {
            if (this.forceBuilderService.hasForces()) {
                this.closeAllPanels();
                this.blurInput();
            }
            if (this.viewMode() === 'table') {
                this.setViewMode('list');
            }
        } else if (this.optionsService.options().unitSearchViewMode === 'table') {
            this.setViewMode('table');
        }
        this.expandedView.set(!isExpanded);
    }

    clearSearch() {
        this.cancelPendingSearchCommit();
        this.pendingResultOpenRequest.set(false);
        this.immediateSearchText.set('');
        this.filtersService.setSearchText('');
        this.activeIndex.set(null);
    }

    formatVariantGroupType(group: Pick<UnitVariantGroupIdentity, 'asType'>): string {
        return AS_TYPE_DISPLAY_NAMES[group.asType] ?? group.asType;
    }

    formatVariantGroupTitle(group: UnitVariantGroupIdentity): string {
        return group.chassis;
    }

    formatVariantGroupMeta(group: UnitVariantGroupIdentity, variantCount: number): string {
        const omniSuffix = group.omni ? ' (omni)' : '';
        return `${this.formatVariantGroupType(group)}${omniSuffix} · ${variantCount} variant${variantCount === 1 ? '' : 's'}`;
    }

    /** Handle click on a compact chassis group to drill down into its variants. */
    onCompactGroupClick(group: ChassisGroup) {
        this.activeVariantGroupFilter.set({
            key: group.key,
            chassis: group.chassis,
            asType: group.asType,
            omni: group.omni,
            representativeUnit: group.representativeUnit,
        });
        this.activeIndex.set(null);
        this.inlinePanelUnit.set(null);
        this.viewMode.set('list');
    }

    clearVariantGroupFilter(): void {
        const groupKey = this.activeVariantGroupFilter()?.key;
        if (!groupKey) return;

        this.activeVariantGroupFilter.set(null);
        this.activeIndex.set(null);
        this.inlinePanelUnit.set(null);
        this.setViewMode('chassis');
        this.scrollToVariantsGroup(groupKey);
    }

    private scrollToVariantsGroup(groupKey: string): void {
        afterNextRender(() => {
            const dropdown = this.resultsDropdown()?.nativeElement;
            const rows = dropdown
                ? Array.from(dropdown.querySelectorAll<HTMLElement>('.chassis-view-row'))
                : [];
            const row = rows.find(element => element.dataset['variantGroupKey'] === groupKey);
            if (!row) return;

            row.scrollIntoView({ block: 'center', behavior: 'instant' });
            row.classList.add('restored');
            window.setTimeout(() => row.classList.remove('restored'), 900);
        }, { injector: this.injector });
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

        componentRef.setInput('canSave', this.filtersService.hasBookmarkableSearchState());

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
            if (!this.filtersService.hasBookmarkableSearchState()) {
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
            const id = uuidv7();
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

            this.favoritesCompRef.setInput('canSave', this.filtersService.hasBookmarkableSearchState());
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
