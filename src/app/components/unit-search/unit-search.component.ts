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
import { Component, signal, ElementRef, OnDestroy, computed, HostListener, effect, afterNextRender, Injector, inject, ChangeDetectionStrategy, input, viewChild, ChangeDetectorRef, Pipe, PipeTransform } from '@angular/core';
import { ScrollingModule, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { RangeSliderComponent } from '../range-slider/range-slider.component';
import { MultiSelectDropdownComponent } from '../multi-select-dropdown/multi-select-dropdown.component';
import { UnitSearchFiltersService, ADVANCED_FILTERS, SORT_OPTIONS, AdvFilterType, SortOption } from '../../services/unit-search-filters.service';
import { Unit, UnitComponent } from '../../models/units.model';
import { ForceBuilderService } from '../../services/force-builder.service';
import { Dialog } from '@angular/cdk/dialog';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { UnitDetailsDialogComponent, UnitDetailsDialogData } from '../unit-details-dialog/unit-details-dialog.component';
import { InputDialogComponent, InputDialogData } from '../input-dialog/input-dialog.component';
import { TagSelectorComponent } from '../tag-selector/tag-selector.component';
import { firstValueFrom } from 'rxjs';
import { LayoutService } from '../../services/layout.service';
import { getWeaponTypeCSSClass, weaponTypes } from '../../utils/equipment.util';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { FloatingCompInfoComponent } from '../floating-comp-info/floating-comp-info.component';
import { StatBarSpecsPipe } from '../../pipes/stat-bar-specs.pipe';
import { FilterAmmoPipe } from '../../pipes/filter-ammo.pipe';
import { FormatNumberPipe } from '../../pipes/format-number.pipe';
import { FormatTonsPipe } from '../../pipes/format-tons.pipe';
import { FilterAdjustedBV } from '../../pipes/filter-adjusted-bv.pipe';

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
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, ScrollingModule, RangeSliderComponent, MultiSelectDropdownComponent, FilterAdjustedBV, FormatNumberPipe, FormatTonsPipe, ExpandedComponentsPipe, FilterAmmoPipe, StatBarSpecsPipe, FloatingCompInfoComponent],
    templateUrl: './unit-search.component.html',
    styleUrl: './unit-search.component.css',
})
export class UnitSearchComponent implements OnDestroy {
    layoutService = inject(LayoutService);
    filtersService = inject(UnitSearchFiltersService);
    dataService = inject(DataService);
    forceBuilderService = inject(ForceBuilderService);
    private injector = inject(Injector);
    private dialog = inject(Dialog);
    private dialogsService = inject(DialogsService);
    private overlay = inject(Overlay);
    private cdr = inject(ChangeDetectorRef);

    public readonly ADVANCED_FILTERS = ADVANCED_FILTERS;
    public readonly AdvFilterType = AdvFilterType;
    public readonly SORT_OPTIONS = SORT_OPTIONS;

    viewport = viewChild(CdkVirtualScrollViewport);
    searchInput = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');
    advBtn = viewChild.required<ElementRef<HTMLButtonElement>>('advBtn');
    advPanel = viewChild<ElementRef<HTMLElement>>('advPanel');
    resultsDropdown = viewChild<ElementRef<HTMLElement>>('resultsDropdown');

    autoFocus = input(false);
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

    resultsVisible = computed(() => {
        if (this.expandedView()) {
            return true;
        }
        return (this.focused() || this.advOpen() || this.unitDetailsDialogOpen()) &&
            (this.filtersService.searchText() || this.isAdvActive());
    });

    itemSize = signal(75);

    private resizeObserver?: ResizeObserver;
    private tagSelectorOverlayRef?: OverlayRef;
    private advPanelDragActive = false;
    private advPanelDragStartX = 0;
    private advPanelDragStartWidth = 0;

    /* Hover state for component info popup */
    hoveredUnit = signal<Unit | null>(null);
    hoveredComp = signal<UnitComponent | null>(null);
    hoverRect = signal<DOMRect | null>(null);
    viewportScrollOffset = signal<number>(0);
    private isCompHovered = false;
    private isFloatingHovered = false;

    constructor() {
        effect((cleanup) => {
            const viewport = this.viewport();
            if (!viewport) return;
            const elScrolledSub = viewport.elementScrolled().subscribe(() => {
                const offset = viewport.measureScrollOffset();
                this.viewportScrollOffset.set(offset);
            });
            cleanup(() => {
                elScrolledSub.unsubscribe();
            });
        });
        effect(() => {
            this.viewportScrollOffset();
            if (this.isCompHovered || this.isFloatingHovered) {
                this.isCompHovered = false;
                this.isFloatingHovered = false;
                this.updateFloatingVisibility();
            }
        });
        effect(() => {
            if (this.advOpen()) {
                this.advPanelUserColumns();
                this.updateAdvPanelPosition();
                this.updateResultsDropdownPosition();
            }
        });
        effect(() => {
            this.advPanelUserColumns();
            if (this.resultsVisible()) {
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
    }

    ngOnDestroy() {
        this.resizeObserver?.disconnect();
        this.tagSelectorOverlayRef?.dispose();
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

    closeAllPanels() {
        this.focused.set(false);
        this.advOpen.set(false);
        this.activeIndex.set(null);
        this.searchInput().nativeElement.blur();
    }

    onOverlayClick() {
        if (this.expandedView()) return;
        this.closeAllPanels();
    }

    trackByUnitId(index: number, unit: Unit) {
        return unit.name;
    }

    focusInput() {
        this.searchInput().nativeElement.focus();
    }

    setSearch(val: string) {
        this.filtersService.searchText.set(val);
        this.activeIndex.set(null);
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

    @HostListener('window:resize')
    onWindowResize() {
        if (this.advOpen()) {
            this.updateAdvPanelPosition();
        }
        if (this.filtersService.searchText().length > 0 || this.isAdvActive()) {
            this.updateResultsDropdownPosition();
        }
    }

    updateResultsDropdownPosition() {
        const gap = 5;
        let dropdownWidth: number;
        let top: number;
        let right: string | undefined;

        if (this.expandedView()) {
            // When expanded, container is fixed at top with 4px margins
            // Calculate position based on the expanded state, not current DOM position
            dropdownWidth = window.innerWidth - 8; // 4px left + 4px right margin
            top = 4 + 40 + gap; // top margin + searchbar height + gap
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
            top = containerRect.bottom + gap + window.scrollY;
        }

        let height;
        if (this.filtersService.filteredUnits().length > 0) {
            if (this.expandedView()) {
                const availableHeight = window.innerHeight - top - 4;
                height = `${availableHeight}px`;
            } else {
                const availableHeight = window.innerHeight - top - (window.innerHeight > 600 ? 50 : 10);
                height = `${availableHeight}px`;
            }
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

        const buttonRect = advBtn.nativeElement.getBoundingClientRect();
        const singlePanelWidth = 300;
        const doublePanelWidth = 600;
        const gap = 5;
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
            top = buttonRect.top + window.scrollY;
            availableHeight = window.innerHeight - top - 4;
        } else {
            left = buttonRect.right - panelWidth + window.scrollX;
            top = buttonRect.bottom + gap + window.scrollY;
            availableHeight = window.innerHeight - top - 4;
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
        this.filtersService.clearFilters();
        this.activeIndex.set(null);
    }

    isAdvActive() {
        const state = this.filtersService.filterState();
        return Object.values(state).some(s => s.interactedWith);
    }

    @HostListener('keydown', ['$event'])
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
                searchInput.nativeElement.blur();
            }
            return;
        }
        if (event.key in ['ArrowDown', 'ArrowUp', 'Enter']) {
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

    highlight(text: string): string {
        const searchGroups = this.filtersService.searchTokens();
        if (!searchGroups || searchGroups.length === 0) return this.escapeHtml(text);

        // Flatten tokens across all OR groups, preserve exact tokens (prefer exact over partial on same string)
        const tokenMap = new Map<string, 'exact' | 'partial'>();
        for (const group of searchGroups) {
            for (const t of group.tokens) {
                const existing = tokenMap.get(t.token);
                if (!existing) {
                    tokenMap.set(t.token, t.mode);
                } else if (existing === 'partial' && t.mode === 'exact') {
                    // prefer exact if same token appears as exact and partial
                    tokenMap.set(t.token, 'exact');
                }
            }
        }

        const tokens = Array.from(tokenMap.keys())
            .sort((a, b) => b.length - a.length) // longest first to avoid partial overlaps
            .filter(Boolean);

        if (tokens.length === 0) return this.escapeHtml(text);

        const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = tokens.map(escapeRegExp).join('|');
        if (!pattern) return this.escapeHtml(text);

        const regex = new RegExp(`(${pattern})`, 'gi');

        // Split on matches, escape parts and wrap matches in <b>
        const parts = text.split(regex);
        return parts
            .map((part, idx) => (idx % 2 === 1)
                ? `<b>${this.escapeHtml(part)}</b>`
                : this.escapeHtml(part)
            )
            .join('');
    }

    async openRangeValueDialog(filterKey: string, type: 'min' | 'max', currentValue: number, totalRange: [number, number]) {
        const isMin = type === 'min';
        const currentFilter = this.filtersService.advOptions()[filterKey];
        const filterName = currentFilter?.label || filterKey;
        const message = `Enter the ${isMin ? 'minimum' : 'maximum'} ${filterName} value (${totalRange[0]} - ${totalRange[1]}):`;

        const ref = this.dialog.open<number | null>(InputDialogComponent, {
            data: {
                title: filterName,
                message: message,
                inputType: 'number',
                defaultValue: currentValue,
                placeholder: currentValue.toString()
            } as InputDialogData
        });
        let newValue = await firstValueFrom(ref.closed);
        if (newValue === undefined || newValue === null || isNaN(Number(newValue))) return;

        if (newValue < totalRange[0]) {
            newValue = totalRange[0];
        } else if (newValue > totalRange[1]) {
            newValue = totalRange[1];
        }

        if (currentFilter && currentFilter.type === 'range') {
            const currentRange = [...currentFilter.value] as [number, number];

            if (isMin) {
                if (newValue > currentRange[1]) {
                    newValue = currentRange[1];
                }
                currentRange[0] = newValue;
            } else {
                if (newValue < currentRange[0]) {
                    newValue = currentRange[0];
                }
                currentRange[1] = newValue;
            }

            this.setAdvFilter(filterKey, currentRange);
        }
    }

    private escapeHtml(s: string): string {
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    getUnitDisplayName(unit: any): string {
        return `${unit.chassis} ${unit.model}`;
    }

    showUnitDetails(unit: Unit) {
        const filteredUnits = this.filtersService.filteredUnits();
        const filteredUnitIndex = filteredUnits.findIndex(u => u.name === unit.name);
        const ref = this.dialog.open(UnitDetailsDialogComponent, {
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

        ref.componentInstance?.add.subscribe(newUnit => {
            if (!this.forceBuilderService.hasUnits()) {
                // If this is the first unit being added, close the search panel
                this.closeAllPanels();
            }
            this.searchInput().nativeElement.blur();
            this.unitDetailsDialogOpen.set(false);
        });

        if (!this.advPanelDocked()) {
            this.advOpen.set(false);
        }
        this.activeIndex.set(null);
        (document.activeElement as HTMLElement)?.blur();
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

    async onAddTag(unit: Unit, event: MouseEvent) {
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

        // Collect all unique tags from all units
        const tagOptions = this.filtersService.getAllTags();

        // Create overlay positioned near the click
        const target = event.target as HTMLElement;
        const positionStrategy = this.overlay.position()
            .flexibleConnectedTo(target)
            .withPositions([
                {
                    originX: 'start',
                    originY: 'bottom',
                    overlayX: 'start',
                    overlayY: 'top',
                    offsetY: 4
                },
                {
                    originX: 'start',
                    originY: 'top',
                    overlayX: 'start',
                    overlayY: 'bottom',
                    offsetY: -4
                }
            ]);

        this.tagSelectorOverlayRef = this.overlay.create({
            positionStrategy,
            scrollStrategy: this.overlay.scrollStrategies.reposition(),
            hasBackdrop: true,
            backdropClass: 'cdk-overlay-transparent-backdrop'
        });

        const portal = new ComponentPortal(TagSelectorComponent, null, this.injector);
        const componentRef = this.tagSelectorOverlayRef.attach(portal);

        // Pass data to the component
        componentRef.instance.tags = tagOptions;

        // Show tags that are common to all selected units
        const commonTags = unitsToTag
            .map(u => u._tags || [])
            .reduce((a, b) => a.filter(tag => b.includes(tag)), unitsToTag[0]._tags || []);
        componentRef.instance.assignedTags = commonTags;

        // Handle backdrop click to close
        this.tagSelectorOverlayRef.backdropClick().subscribe(() => {
            this.tagSelectorOverlayRef?.dispose();
            this.tagSelectorOverlayRef = undefined;
        });

        // Handle tag removal for all selected units
        componentRef.instance.tagRemoved.subscribe(async (tagToRemove: string) => {
            for (const u of unitsToTag) {
                if (u._tags) {
                    const index = u._tags.findIndex(t => t.toLowerCase() === tagToRemove.toLowerCase());
                    if (index !== -1) {
                        u._tags.splice(index, 1);
                    }
                }
            }
            // Update the component's assigned tags
            const updatedCommon = unitsToTag
                .map(u => u._tags || [])
                .reduce((a, b) => a.filter(tag => b.includes(tag)), unitsToTag[0]._tags || []);
            componentRef.instance.assignedTags = updatedCommon;

            await this.filtersService.saveTagsToStorage();
            this.filtersService.invalidateTagsCache();
            this.cdr.markForCheck();
        });

        // Handle tag selection for all selected units
        componentRef.instance.tagSelected.subscribe(async (selectedTag: string) => {
            this.tagSelectorOverlayRef?.dispose();
            this.tagSelectorOverlayRef = undefined;

            // If "Add new tag..." was selected, show text input dialog
            if (selectedTag === '__new__') {
                const newTagRef = this.dialog.open<string | null>(InputDialogComponent, {
                    data: {
                        title: 'Add New Tag',
                        inputType: 'text',
                        defaultValue: '',
                        placeholder: 'Enter tag...'
                    } as InputDialogData
                });

                const newTag = await firstValueFrom(newTagRef.closed);

                // User cancelled or entered empty string
                if (!newTag || newTag.trim().length === 0) {
                    return;
                }
                if (newTag.length > 16) {
                    await this.dialogsService.showError('Tag is too long. Maximum length is 16 characters.', 'Invalid Tag');
                    return;
                }

                selectedTag = newTag;
            }

            const trimmedTag = selectedTag.trim();

            for (const u of unitsToTag) {
                if (!u._tags) {
                    u._tags = [];
                }
                if (!u._tags.some(tag => tag.toLowerCase() === trimmedTag.toLowerCase())) {
                    u._tags.push(trimmedTag);
                }
            }
            this.cdr.markForCheck();

            await this.filtersService.saveTagsToStorage();
            this.filtersService.invalidateTagsCache();
            this.cdr.markForCheck();
        });
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

    /* Adv Panel Dragging */
    onAdvPanelDragHandleClick(event: MouseEvent) {
        event.stopPropagation();
        event.preventDefault();
        if (!this.advPanelDocked() || !this.expandedView()) return;
        // Toggle between 1 and 2 columns
        const current = this.advPanelUserColumns() || 1;
        const next = current === 1 ? 2 : 1;
        this.advPanelUserColumns.set(next);
    }

    onAdvPanelDragStart(event: MouseEvent) {
        if (!this.advPanelDocked() || !this.expandedView()) return;
        event.preventDefault();
        this.advPanelDragActive = true;
        this.advPanelDragStartX = event.clientX;
        this.advPanelDragStartWidth = parseInt(this.advPanelStyle().width, 10) || 300;

        window.addEventListener('mousemove', this.onAdvPanelDragMove);
        window.addEventListener('mouseup', this.onAdvPanelDragEnd);
    }

    onAdvPanelDragMove = (event: MouseEvent) => {
        if (!this.advPanelDragActive) return;
        const delta = event.clientX - this.advPanelDragStartX;
        const newWidth = this.advPanelDragStartWidth - delta;
        // Snap to 1 or 2 columns
        if (newWidth > 450) {
            this.advPanelUserColumns.set(2);
        } else {
            this.advPanelUserColumns.set(1);
        }
    };

    onAdvPanelDragEnd = () => {
        this.advPanelDragActive = false;
        window.removeEventListener('mousemove', this.onAdvPanelDragMove);
        window.removeEventListener('mouseup', this.onAdvPanelDragEnd);
    };

    /* Component Hovering for Expanded View */
    onCompMouseEnter(unit: Unit, comp: UnitComponent, event: MouseEvent) {
        this.isCompHovered = true;
        if (this.hoveredComp() !== comp) {
            this.hoveredUnit.set(unit);
            this.hoveredComp.set(comp);
            const container = event.currentTarget as HTMLElement;
            this.hoverRect.set(container.getBoundingClientRect());
        }
    }

    onCompPointerDown(unit: Unit, comp: UnitComponent, event: MouseEvent) {
        if (this.hoveredComp() === comp) {
            this.isCompHovered = false;
            this.onCompMouseLeave();
        } else {
            this.onCompMouseEnter(unit, comp, event);
        }
    }

    onCompClick(unit: Unit, comp: UnitComponent, event: MouseEvent) {
        event.stopPropagation();
        event.preventDefault();
    }

    onCompMouseLeave() {
        this.isCompHovered = false;
        // Defer to next tick to allow floating window mouseenter to fire first if moving to it
        afterNextRender(() => {
            this.updateFloatingVisibility();
        }, { injector: this.injector });
    }

    onFloatingMouseEnter() {
        this.isFloatingHovered = true;
    }

    onFloatingMouseLeave() {
        this.isFloatingHovered = false;
            // Defer to next tick to allow comp mouseenter to fire first if moving to it
        afterNextRender(() => {
            this.updateFloatingVisibility();
        }, { injector: this.injector });
    }

    private updateFloatingVisibility() {
        if (!this.isCompHovered && !this.isFloatingHovered) {
            this.hoveredUnit.set(null);
            this.hoveredComp.set(null);
            this.hoverRect.set(null);
        }
    }

    // Multi-select logic: click with Ctrl/Cmd or Shift to select multiple units
    onUnitCardClick(unit: Unit, event?: MouseEvent, forceMultiSelect = false) {
        const multiSelect = event ? (event.ctrlKey || event.metaKey || event.shiftKey) : false;
        if (event && (multiSelect || forceMultiSelect)) {
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

    addSelectedUnits() {
        const gunnery = this.filtersService.pilotGunnerySkill();
        const piloting = this.filtersService.pilotPilotingSkill();
        const selectedUnits = this.selectedUnits();
        for (let selectedUnit of selectedUnits) {
            const unit = this.dataService.getUnitByName(selectedUnit);
            if (unit) {
                if (!this.forceBuilderService.addUnit(unit, gunnery, piloting)) {
                    break;
                }
            }
        };
        this.clearSelection();
        this.closeAllPanels();
    }
}