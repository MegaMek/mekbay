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
import { Component, signal, ElementRef, computed, effect, afterNextRender, Injector, inject, ChangeDetectionStrategy, input, viewChild, ChangeDetectorRef, Pipe, PipeTransform, DestroyRef } from '@angular/core';
import { ScrollingModule, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { RangeSliderComponent } from '../range-slider/range-slider.component';
import { MultiSelectDropdownComponent } from '../multi-select-dropdown/multi-select-dropdown.component';
import { UnitSearchFiltersService, ADVANCED_FILTERS, SORT_OPTIONS, AdvFilterType, SortOption, SerializedSearchFilter } from '../../services/unit-search-filters.service';
import { Unit, UnitComponent } from '../../models/units.model';
import { ForceBuilderService } from '../../services/force-builder.service';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { UnitDetailsDialogComponent, UnitDetailsDialogData } from '../unit-details-dialog/unit-details-dialog.component';
import { firstValueFrom } from 'rxjs';
import { LayoutService } from '../../services/layout.service';
import { getWeaponTypeCSSClass, weaponTypes } from '../../utils/equipment.util';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { StatBarSpecsPipe } from '../../pipes/stat-bar-specs.pipe';
import { FilterAmmoPipe } from '../../pipes/filter-ammo.pipe';
import { FormatNumberPipe } from '../../pipes/format-number.pipe';
import { FormatTonsPipe } from '../../pipes/format-tons.pipe';
import { AdjustedBV } from '../../pipes/adjusted-bv.pipe';
import { AdjustedPV } from '../../pipes/adjusted-pv.pipe';
import { UnitComponentItemComponent } from '../unit-component-item/unit-component-item.component';
import { LongPressDirective } from '../../directives/long-press.directive';
import { SearchFavoritesMenuComponent } from '../search-favorites-menu/search-favorites-menu.component';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { ShareSearchDialogComponent } from './share-search.component';
import { highlightMatches } from '../../utils/search.util';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { UnitTagsComponent, TagClickEvent } from '../unit-tags/unit-tags.component';
import { RangeModel, UnitSearchFilterRangeDialogComponent, UnitSearchFilterRangeDialogData } from '../unit-search-filter-range-dialog/unit-search-filter-range-dialog.component';
import { GameService } from '../../services/game.service';
import { OptionsService } from '../../services/options.service';
import { TaggingService } from '../../services/tagging.service';
import { AsAbilityLookupService } from '../../services/as-ability-lookup.service';
import { AbilityInfoDialogComponent, AbilityInfoDialogData } from '../ability-info-dialog/ability-info-dialog.component';



@Pipe({
    name: 'expandedComponents',
    pure: true // Pure pipes are only called when the input changes
})
export class ExpandedComponentsPipe implements PipeTransform {
    transform(components: UnitComponent[]): UnitComponent[] {
        if (!components) return [];
        if (components.length === 0) return [];
        const aggregated = new Map<string, UnitComponent>();
        for (const comp of components) {
            if (comp.t === 'HIDDEN') continue; // Hide hidden components
            if (comp.t === 'X') continue; // Hide Ammo
            const key = comp.n || '';
            if (aggregated.has(key)) {
                const existing = aggregated.get(key)!;
                existing.q = (existing.q || 1) + (comp.q || 1);
            } else {
                aggregated.set(key, { ...comp });
            }
        }
        return Array.from(aggregated.values())
            .sort((a, b) => (a.n ?? '').localeCompare(b.n ?? ''));
    }
}

@Component({
    selector: 'unit-search',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, ScrollingModule, RangeSliderComponent, LongPressDirective, MultiSelectDropdownComponent, UnitComponentItemComponent, AdjustedBV, AdjustedPV, FormatNumberPipe, FormatTonsPipe, ExpandedComponentsPipe, FilterAmmoPipe, StatBarSpecsPipe, UnitIconComponent, UnitTagsComponent],
    templateUrl: './unit-search.component.html',
    styleUrl: './unit-search.component.css',
    host: {
        '(keydown)': 'onKeydown($event)'
    }
})
export class UnitSearchComponent {
    layoutService = inject(LayoutService);
    filtersService = inject(UnitSearchFiltersService);
    dataService = inject(DataService);
    forceBuilderService = inject(ForceBuilderService);
    gameService = inject(GameService);
    overlayManager = inject(OverlayManagerService);

    private injector = inject(Injector);
    private dialogsService = inject(DialogsService);
    private overlay = inject(Overlay);
    private cdr = inject(ChangeDetectorRef);
    private abilityLookup = inject(AsAbilityLookupService);
    private optionsService = inject(OptionsService);
    private taggingService = inject(TaggingService);

    readonly useHex = computed(() => this.optionsService.options().ASUseHex);

    public readonly ADVANCED_FILTERS = ADVANCED_FILTERS;
    public readonly AdvFilterType = AdvFilterType;
    public readonly SORT_OPTIONS = SORT_OPTIONS;

    private searchDebounceTimer: any;
    private readonly SEARCH_DEBOUNCE_MS = 300;

    viewport = viewChild(CdkVirtualScrollViewport);
    searchInput = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');
    advBtn = viewChild.required<ElementRef<HTMLButtonElement>>('advBtn');
    favBtn = viewChild.required<ElementRef<HTMLButtonElement>>('favBtn');
    advPanel = viewChild<ElementRef<HTMLElement>>('advPanel');
    resultsDropdown = viewChild<ElementRef<HTMLElement>>('resultsDropdown');

    gameSystem = computed(() => this.gameService.currentGameSystem());
    autoFocus = input(false);
    buttonOnly = signal(false);
    expandedView = this.filtersService.expandedView;
    advOpen = this.filtersService.advOpen;
    advPanelDocked = computed(() => this.expandedView() && this.advOpen() && this.layoutService.windowWidth() >= 900);
    advPanelUserColumns = signal<1 | 2 | null>(null);
    focused = signal(false);
    activeIndex = signal<number | null>(null);
    selectedUnits = signal<Set<string>>(new Set());
    private unitDetailsDialogOpen = signal(false);
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

    overlayVisible = computed(() => {
        return this.advOpen() || this.resultsVisible();
    });

    public readonly resultsVisible = computed(() => {
        if (this.expandedView()) {
            return true;
        }
        return (this.focused() || this.advOpen() || this.unitDetailsDialogOpen()) &&
            (this.filtersService.searchText() || this.isAdvActive());
    });

    itemSize = signal(75);

    private resizeObserver?: ResizeObserver;
    private advPanelDragStartX = 0;
    private advPanelDragStartWidth = 0;

    constructor() {
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
            if (this.resultsVisible()) {
                this.layoutService.windowWidth();
                this.layoutService.windowHeight();
                this.updateResultsDropdownPosition();
            }
        });
        effect(() => {
            if (this.autoFocus() &&
                this.filtersService.isDataReady() &&
                this.searchInput().nativeElement) {
                afterNextRender(() => {
                    this.searchInput().nativeElement.focus();
                }, { injector: this.injector });
            }
        });
        afterNextRender(() => {
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
        this.setupItemHeightTracking();
        inject(DestroyRef).onDestroy(() => {
            if (this.searchDebounceTimer) {
                clearTimeout(this.searchDebounceTimer);
            }
            this.resizeObserver?.disconnect();
            this.overlayManager.closeAllManagedOverlays();
        });
    }

    private setupItemHeightTracking() {
        let debounceTimer: any;
        const DEBOUNCE_MS = 80;

        const debouncedUpdateHeights = () => {
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }
            debounceTimer = setTimeout(() => {
                afterNextRender(() => {
                    updateHeights();
                }, { injector: this.injector });
            }, DEBOUNCE_MS);
        };

        const updateHeights = () => {
            const dropdown = this.resultsDropdown()?.nativeElement;
            if (!dropdown) return;
            const items = dropdown.querySelectorAll('.results-dropdown-item:not(.no-results)');
            if (items.length === 0) return;
            const heights = Array.from(items).slice(0, 100).map(el => (el as HTMLElement).offsetHeight);
            let avg = Math.round(heights.reduce((a, b) => a + b, 0) / heights.length);
            const currentAvg = this.itemSize();
            if (currentAvg !== avg) {
                this.itemSize.set(avg);
            }
        };

        effect(() => {
            if (!this.resultsVisible()) return;
            this.layoutService.isMobile();
            if (this.expandedView()) {
                this.layoutService.windowWidth();
                this.filtersService.advOpen();
                this.advPanelUserColumns();
            }
            this.filtersService.filteredUnits();
            debouncedUpdateHeights();
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
        return unit.name;
    }

    focusInput() {
        afterNextRender(() => {
            try { this.searchInput()?.nativeElement.focus(); } catch { /* ignore */ }
        }, { injector: this.injector });
    }

    blurInput() {
        try { this.searchInput()?.nativeElement.blur(); } catch { /* ignore */ }
    }

    setSearch(val: string) {
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
        }
        this.searchDebounceTimer = setTimeout(() => {
            this.filtersService.searchText.set(val);
            this.activeIndex.set(null);
        }, this.SEARCH_DEBOUNCE_MS);
    }

    closeAdvPanel() {
        this.advOpen.set(false);
    }

    toggleAdv() {
        this.advOpen.set(!this.advOpen());
        if (!this.advOpen()) {
            this.searchInput().nativeElement.focus();
        } else {
            this.focused.set(true);
        }
    }

    updateResultsDropdownPosition() {
        const gap = 4;

        const { top: safeTop, bottom: safeBottom, left: safeLeft, right: safeRight } = this.layoutService.getSafeAreaInsets();
        let dropdownWidth: number;
        let top: number;
        let right: string | undefined;

        if (this.expandedView()) {
            // When expanded, container is fixed at top with 4px margins
            // Calculate position based on the expanded state, not current DOM position
            dropdownWidth = window.innerWidth - 8; // 4px left + 4px right margin
            top = safeTop + 4 + 40 + gap; // top margin + searchbar height + gap
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
            top = containerRect.bottom + gap;
        }

        let height;
        if (this.filtersService.filteredUnits().length > 0) {
            const availableHeight = window.innerHeight - top - Math.max(4, safeBottom);
            height = `${availableHeight}px`;
        } else {
            height = 'auto';
        }

        this.resultsDropdownStyle.set({
            top: `${top}px`,
            width: `${dropdownWidth}px`,
            height: height,
            ...(right && { right })
        });

        afterNextRender(() => {
            this.viewport()?.checkViewportSize();
        }, { injector: this.injector });
    }

    updateAdvPanelPosition() {
        const advBtn = this.advBtn();
        if (!advBtn) return;

        const { top: safeTop, bottom: safeBottom, left: safeLeft, right: safeRight } = this.layoutService.getSafeAreaInsets();
        const buttonRect = advBtn.nativeElement.getBoundingClientRect();
        const singlePanelWidth = 300;
        const doublePanelWidth = 600;
        const gap = 4;
        const spaceToRight = window.innerWidth - buttonRect.right - gap - 10;

        // Use user override if set, else auto
        let columns = (spaceToRight >= doublePanelWidth ? 2 : 1);
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

        if (spaceToRight >= panelWidth) {
            left = buttonRect.right + gap;
            top = buttonRect.top;
            availableHeight = window.innerHeight - top - Math.max(4, safeBottom);
        } else {
            left = buttonRect.right - panelWidth;
            top = buttonRect.bottom + gap;
            availableHeight = window.innerHeight - top - Math.max(4, safeBottom);
            left = Math.max(10, left);
        }

        this.advPanelStyle.set({
            left: `${left}px`,
            top: `${top}px`,
            width: `${panelWidth}px`,
            height: `${availableHeight}px`,
            columnsCount: columns
        });
    }

    getSelectedOptions(target: any): string[] {
        if (target instanceof HTMLSelectElement) {
            return Array.from(target.selectedOptions).map(option => option.value);
        }
        return [];
    }

    setAdvFilter(key: string, value: any) {
        this.filtersService.setFilter(key, value);
        this.activeIndex.set(null);
    }

    clearAdvFilters() {
        this.filtersService.resetFilters();
        this.activeIndex.set(null);
    }

    isAdvActive() {
        const state = this.filtersService.filterState();
        return Object.values(state).some(s => s.interactedWith);
    }

    onKeydown(event: KeyboardEvent) {
        const searchInput = this.searchInput();
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
                searchInput.nativeElement.focus();
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
                        searchInput.nativeElement.focus();
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
        this.viewport()?.scrollToIndex(index, 'smooth');
    }

    /**
     * Scroll to make the item at the given index visible, but only if it's not already visible.
     * If scrolling is needed, positions the item at the nearest edge (top or bottom).
     */
    private scrollToMakeVisible(index: number) {
        const vp = this.viewport();
        if (!vp) return;
        
        const itemHeight = this.itemSize();
        const itemTop = index * itemHeight;
        const itemBottom = itemTop + itemHeight;
        
        const scrollOffset = vp.measureScrollOffset();
        const viewportSize = vp.getViewportSize();
        const visibleTop = scrollOffset;
        const visibleBottom = scrollOffset + viewportSize;
        
        if (itemTop < visibleTop) {
            // Item is above the visible area - scroll up to show it at top
            vp.scrollToOffset(itemTop, 'smooth');
        } else if (itemBottom > visibleBottom) {
            // Item is below the visible area - scroll down to show it at bottom
            vp.scrollToOffset(itemBottom - viewportSize, 'smooth');
        }
        // Otherwise it's already visible, do nothing
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



    getUnitDisplayName(unit: any): string {
        return `${unit.chassis} ${unit.model}`;
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

        ref.closed.subscribe(() => {
            this.unitDetailsDialogOpen.set(false);
        });

        // Track navigation within the dialog to keep activeIndex in sync
        ref.componentInstance?.indexChange.subscribe(newIndex => {
            this.activeIndex.set(newIndex);
            this.scrollToMakeVisible(newIndex);
        });

        ref.componentInstance?.add.subscribe(newUnit => {
            if (this.forceBuilderService.currentForce()?.units().length === 1) {
                // If this is the first unit being added, close the search panel
                this.closeAllPanels();
            }
            this.blurInput();
            this.unitDetailsDialogOpen.set(false);
        });

        if (!this.advPanelDocked()) {
            this.advOpen.set(false);
        }
        this.activeIndex.set(null);
        try {
            (document.activeElement as HTMLElement)?.blur();
        } catch { /* ignore */ }
    }

    private getDisplaySortKey(): string {
        const key = this.filtersService.selectedSort();
        // These keys are shown in the main unit card, we don't need to repeat them in the slot
        if (['name', 'bv', 'tons', 'year', 'role'].includes(key)) {
            return '';
        }
        if (this.expandedView()) {
            if (['techBase', 'level'].includes(key)) {
                return '';
            }
        }
        return key;
    }

    getSortSlot(unit: Unit): { key: string; value: string; label?: string; img?: string; alt: string; numeric: boolean } | null {
        const key = this.getDisplaySortKey();
        if (!key) return null;
        const opt: SortOption | undefined = this.SORT_OPTIONS.find(o => o.key === key);

        const raw = (unit as any)[key];
        let numeric = typeof raw === 'number';
        let value: string;

        if (raw == null) {
            value = '—';
            numeric = false;
        } else {
            value = numeric ? FormatNumberPipe.formatValue(raw, true, false) : String(raw);
        }

        return {
            key,
            value,
            label: opt?.slotLabel,
            img: opt?.slotIcon,
            alt: opt?.label || key,
            numeric
        };
    }

    getTypeColor(typeCode: string): string {
        const found = weaponTypes.find(t => t.code === typeCode);
        return found ? found.color : '#ccc';
    }

    getTypeClass(typeCode: string): string {
        return getWeaponTypeCSSClass(typeCode);
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

        // Toggle: close if already open, otherwise open
        if (this.overlayManager.has('tagSelector')) {
            this.overlayManager.closeManagedOverlay('tagSelector');
            return;
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
        const newWidth = this.advPanelDragStartWidth - delta;
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

    multiSelectUnit(unit: Unit) {
        const selected = new Set(this.selectedUnits());
        if (selected.has(unit.name)) {
            selected.delete(unit.name);
        } else {
            selected.add(unit.name);
        }
        this.selectedUnits.set(selected);
    }

    // Multi-select logic: click with Ctrl/Cmd or Shift to select multiple units
    onUnitCardClick(unit: Unit, event: MouseEvent) {
        const multiSelect = event ? (event.ctrlKey || event.metaKey || event.shiftKey) : false;
        if (event && multiSelect) {
            // Multi-select logic
            const selected = new Set(this.selectedUnits());
            if (selected.has(unit.name)) {
                selected.delete(unit.name);
            } else {
                selected.add(unit.name);
            }
            this.selectedUnits.set(selected);
            event.stopPropagation();
            return;
        }
        // Single click: open details and clear selection
        this.showUnitDetails(unit);
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

        // Sort so default movement comes first
        entries.sort((a, b) => {
            if (a[0] === '') return -1;
            if (b[0] === '') return 1;
            return 0;
        });

        return entries
            .map(([mode, inches]) => {
                if (this.useHex()) {
                    return Math.ceil(inches / 2) + mode;
                }
                return inches + '"' + mode;
            })
            .join('/');
    }

    toggleExpandedView() {
        const isExpanded = this.expandedView();
        if (isExpanded) {
            this.closeAllPanels();
            this.blurInput();
        } else {
            this.focusInput();
        }
        this.expandedView.set(!isExpanded);
    }

    clearSearch() {
        this.filtersService.searchText.set('');
        this.activeIndex.set(null);
        this.focusInput();
    }

    openShareSearch(event: MouseEvent) {
        event.stopPropagation();
        this.dialogsService.createDialog(ShareSearchDialogComponent);
    }

    /* ------------------------------------------
     * Favorites overlay/menu
     */

    openFavorites(event: MouseEvent) {
        event.stopPropagation();

        // If already open, close it
        if (this.overlayManager.has('favorites')) {
            this.overlayManager.closeManagedOverlay('favorites');
            return;
        }
        const target = this.favBtn()?.nativeElement || (event.target as HTMLElement);
        const portal = new ComponentPortal(SearchFavoritesMenuComponent, null, this.injector);
        const compRef = this.overlayManager.createManagedOverlay('favorites', target, portal, {
            hasBackdrop: false,
            panelClass: 'favorites-overlay-panel',
            closeOnOutsideClick: true,
            scrollStrategy: this.overlay.scrollStrategies.close()
        });

        const favorites: SerializedSearchFilter[] = [];
        compRef.setInput('favorites', favorites);
        compRef.instance.select.subscribe((favorite: SerializedSearchFilter) => {
            if (favorite) this.applyFavorite(favorite);
            this.overlayManager.closeManagedOverlay('favorites');
        });
        compRef.instance.saveRequest.subscribe(() => {
            this.saveCurrentSearch();
        });
    }

    closeFavorites() {
        this.overlayManager.closeManagedOverlay('favorites');
    }

    private async saveCurrentSearch() {
        const name = await this.dialogsService.prompt('Enter a name for this Tactical Bookmark (e.g. "Clan Raid - 3058")', 'Save Tactical Bookmark', '');
        if (name === null) return; // cancelled
        const trimmed = (name || '').trim();
        if (!trimmed) return;

        const fav = this.filtersService.serializeCurrentSearchFilter(trimmed);
        // DO THE SAVING!
    }

    private applyFavorite(fav: SerializedSearchFilter) {
        this.filtersService.applySerializedSearchFilter(fav);
        // Focus search input after applying
        afterNextRender(() => {
            this.focusInput();
        }, { injector: this.injector });
    }
}