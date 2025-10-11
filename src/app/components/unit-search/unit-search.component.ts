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
import { Component, signal, ElementRef, OnDestroy, computed, HostListener, effect, afterNextRender, Injector, inject, ChangeDetectionStrategy, input, viewChild, untracked, ChangeDetectorRef } from '@angular/core';
import { ScrollingModule, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { RangeSliderComponent } from '../range-slider/range-slider.component';
import { MultiSelectDropdownComponent } from '../multi-select-dropdown/multi-select-dropdown.component';
import { UnitSearchFiltersService, ADVANCED_FILTERS, SORT_OPTIONS, AdvFilterType, SortOption } from '../../services/unit-search-filters.service';
import { Unit, UnitComponent } from '../../models/units.model';
import { ForceBuilderService } from '../../services/force-builder.service';
import { Dialog } from '@angular/cdk/dialog';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { UnitDetailsDialogComponent } from '../unit-details-dialog/unit-details-dialog.component';
import { InputDialogComponent, InputDialogData } from '../input-dialog/input-dialog.component';
import { TagSelectorComponent } from '../tag-selector/tag-selector.component';
import { firstValueFrom } from 'rxjs';
import { LayoutService } from '../../services/layout.service';
import { getWeaponTypeCSSClass, weaponTypes } from '../../utils/equipment.util';
import { DataService, DOES_NOT_TRACK } from '../../services/data.service';

@Component({
    selector: 'unit-search',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, ScrollingModule, RangeSliderComponent, MultiSelectDropdownComponent],
    templateUrl: './unit-search.component.html',
    styleUrl: './unit-search.component.css',
})
export class UnitSearchComponent implements OnDestroy {
    public layoutService = inject(LayoutService);
    public filtersService = inject(UnitSearchFiltersService);
    public dataService = inject(DataService);
    private forceBuilderService = inject(ForceBuilderService);
    private injector = inject(Injector);
    private dialog = inject(Dialog);
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
    advOpen = signal(false);
    advPanelDocked = computed(() => this.expandedView() && this.advOpen() && this.layoutService.windowWidth() >= 900);
    focused = signal(false);
    activeIndex = signal<number | null>(null);
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

    overlayVisible = computed(() => this.advOpen() || this.resultsVisible() || this.expandedView());

    resultsVisible = computed(() => {
        if (this.expandedView()) {
            return true;
        }
        return (this.focused() || this.advOpen() || this.unitDetailsDialogOpen()) &&
            (this.filtersService.search() || this.isAdvActive());
    });

    itemSize = computed(() => {
        return (this.expandedView() && this.layoutService.isMobile()) ? 75 : 75;
    });

    private resizeObserver?: ResizeObserver;
    private tagSelectorOverlayRef?: OverlayRef;

    constructor() {
        effect(() => {
            if (this.advOpen()) {
                this.updateAdvPanelPosition();
                this.updateResultsDropdownPosition();
            }
        });
        effect(() => {
            if (this.resultsVisible()) {
                this.updateResultsDropdownPosition();
            }
        });
        effect(() => {
            if (this.autoFocus() &&
                this.filtersService.isDataReady() &&
                this.searchInput().nativeElement) {
                setTimeout(() => {
                    this.searchInput().nativeElement.focus();
                }, 0);
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
    }

    ngOnDestroy() {
        this.resizeObserver?.disconnect();
        this.tagSelectorOverlayRef?.dispose();
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
        this.filtersService.search.set(val);
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
        if (this.filtersService.search().length > 0 || this.isAdvActive()) {
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
                right = `308px`;
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
        const hasSpaceForDouble = spaceToRight >= doublePanelWidth;

        let panelWidth = singlePanelWidth;
        let columns = 1;
        if (hasSpaceForDouble) {
            panelWidth = doublePanelWidth;
            columns = 2;
        }

        let left: number;
        let top: number;
        let availableHeight: number;

        if (spaceToRight >= panelWidth) {
            // Display on the RIGHT side of the button
            left = buttonRect.right + gap;
            top = buttonRect.top + window.scrollY;
            availableHeight = window.innerHeight - top - 4;
        } else {
            // Display UNDER the button, aligned to the right
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
                        this.onUnitClick(items[currentActiveIndex]);
                    } else if (items.length > 0) {
                        this.onUnitClick(items[0]);
                    }
                    break;
            }
        }
    }

    private scrollToIndex(index: number) {
        this.viewport()?.scrollToIndex(index, 'smooth');
    }

    highlight(text: string): string {
        const search = this.filtersService.search().trim();
        if (!search) return this.escapeHtml(text);

        // Split by commas or semicolons to get OR groups
        const orGroups = search.split(/[,;]/).map(g => g.trim()).filter(Boolean);
        
        // Collect all words from all OR groups
        const allWords = new Set<string>();
        for (const group of orGroups) {
            group.split(/\s+/).filter(Boolean).forEach(word => allWords.add(word));
        }

        if (allWords.size === 0) return this.escapeHtml(text);

        const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = Array.from(allWords)
            .map(escapeRegExp)
            .sort((a, b) => b.length - a.length)
            .join('|');
        const regex = new RegExp(`(${pattern})`, 'gi');

        // Split on matches, then escape each part; wrap only the matches
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

    onUnitClick(unit: Unit) {
        const filteredUnits = this.filtersService.filteredUnits();
        const filteredUnitIndex = filteredUnits.findIndex(u => u.name === unit.name);
        const ref = this.dialog.open(UnitDetailsDialogComponent, {
            data: {
                unitList: filteredUnits,
                unitIndex: filteredUnitIndex,
                hideAddButton: false,
                gunnerySkill: this.filtersService.pilotGunnerySkill(),
                pilotingSkill: this.filtersService.pilotPilotingSkill()
            }
        });
        this.unitDetailsDialogOpen.set(true);

        ref.closed.subscribe(() => {
            this.unitDetailsDialogOpen.set(false);
        });

        ref.componentInstance?.add.subscribe(unit => {
            if (!this.forceBuilderService.hasUnits()) {
                // If this is the first unit being added, close the search panel
                this.closeAllPanels();
            }
            this.forceBuilderService.addUnit(
                unit,
                this.filtersService.pilotGunnerySkill(),
                this.filtersService.pilotPilotingSkill()
            );
            ref.close();
            this.searchInput().nativeElement.blur();
            this.unitDetailsDialogOpen.set(false);
        });

        if (!this.advPanelDocked()) {
            this.advOpen.set(false);
        }
        this.activeIndex.set(null);
        (document.activeElement as HTMLElement)?.blur();
    }

    formatValue(val: number, formatThousands: boolean = false, compress: boolean = false): string {
        let postfix = '';
        if (compress) {
            if (val >= 10_000_000_000) {
                postfix = 'kkk';
                val = Math.round(val / 1_000_000_000);
            } else if (val >= 10_000_000) {
                postfix = 'kk';
                val = Math.round(val / 1_000_000);
            } else if (val >= 10_000) {
                postfix = 'k';
                val = Math.round(val / 1_000);
            }
        }
        const rounded = Math.round(val);
        if (formatThousands) {
            return rounded.toLocaleString() + postfix;
        }
        return rounded.toString() + postfix;
    }

    formatTons(tons: number): string {
        const format = (num: number) => Math.round(num * 100) / 100;
        if (tons < 1000) {
            return `${format(tons)}`;
        } else if (tons < 1000000) {
            return `${format(tons / 1000)}k`;
        } else {
            return `${format(tons / 1000000)}M`;
        }
    }

    getEraImg(unit: Unit): string | undefined {
        return unit._era?.img;
    }

    getUnitImg(unit: Unit): string | undefined {
        return `https://db.mekbay.com/images/units/${unit.icon}`;
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
            value = numeric ? this.formatValue(raw, true, false) : String(raw);
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

    getExpandedComponents(unit: Unit): UnitComponent[] {
        if (!unit?.comp) return [];
        // Filter out HIDDEN components and aggregate by name
        const aggregated = new Map<string, UnitComponent>();
        for (const comp of unit.comp) {
            if (comp.t === 'HIDDEN') continue;
            const key = comp.n || '';
            if (aggregated.has(key)) {
                const existing = aggregated.get(key)!;
                existing.q = (existing.q || 1) + (comp.q || 1);
            } else {
                aggregated.set(key, { ...comp });
            }
        }
        return Array.from(aggregated.values())
            .sort((a, b) => {
                if (a.n === b.n) return 0;
                if (a.n === undefined) return 1;
                if (b.n === undefined) return -1;
                return a.n.localeCompare(b.n);
            });
    }
    
    getTypeColor(typeCode: string): string {
        const found = weaponTypes.find(t => t.code === typeCode);
        return found ? found.color : '#ccc';
    }

    getTypeClass(typeCode: string): string {
        return getWeaponTypeCSSClass(typeCode);
    }

    getStatBarSpecs(unit: Unit): Array<{ label: string, value: number, max: number }> {
    const maxStats = this.dataService.getUnitTypeMaxStats(unit.type);

    const statDefs = [
        { key: 'armor', label: 'Armor', value: unit.armor, max: maxStats.armor[1] },
        { key: 'internal', label: unit.type === 'Infantry' ? 'Squad size' : 'Structure', value: unit.internal, max: maxStats.internal[1] },
        { key: 'alphaNoPhysical', label: 'Firepower', value: unit._mdSumNoPhysical, max: maxStats.alphaNoPhysicalNoOneshots[1] },
        { key: 'dpt', label: 'Damage/Turn', value: unit.dpt, max: maxStats.dpt[1] },
        { key: 'maxRange', label: 'Range', value: unit._maxRange, max: maxStats.maxRange[1] },
        { key: 'heat', label: 'Heat', value: unit.heat, max: maxStats.heat[1] },
        { key: 'dissipation', label: 'Dissipation', value: unit.dissipation, max: maxStats.dissipation[1] },
        { key: 'runMP', label: 'Speed', value: unit.run, max: maxStats.runMP[1] },
        { key: 'jumpMP', label: 'Jump', value: unit.jump, max: maxStats.jumpMP[1] },
    ];

    return statDefs.filter(def => {
        const statMaxArr = maxStats[def.key as keyof typeof maxStats] as [number, number];
        if (def.value === undefined || def.value === null || def.value === -1) return false;
        if (!statMaxArr) return false;
        if (statMaxArr[0] === statMaxArr[1]) return false;
        if (statMaxArr[0] === 0 && DOES_NOT_TRACK === statMaxArr[1] && DOES_NOT_TRACK === def.value) return false;
        return true;
    });
    }

    getStatPercent(value: number, max: number): number {
        if (max === 0) return 0;
        return Math.min((value / max) * 100, 100);
    }

    async onAddTag(unit: Unit, event: MouseEvent) {
        event.stopPropagation();
        
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
        componentRef.instance.assignedTags = unit._tags || [];
        
        // Handle backdrop click to close
        this.tagSelectorOverlayRef.backdropClick().subscribe(() => {
            this.tagSelectorOverlayRef?.dispose();
            this.tagSelectorOverlayRef = undefined;
        });

        // Handle tag removal
        componentRef.instance.tagRemoved.subscribe(async (tagToRemove: string) => {
            if (unit._tags) {
                const index = unit._tags.findIndex(t => t.toLowerCase() === tagToRemove.toLowerCase());
                if (index !== -1) {
                    unit._tags.splice(index, 1);
                    // Update the component's assigned tags
                    componentRef.instance.assignedTags = unit._tags || [];
                    
                    await this.filtersService.saveTagsToStorage();
                    this.filtersService.invalidateTagsCache();
                    this.cdr.markForCheck();
                }
            }
        });

        // Handle tag selection
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
                    // Limit tag length to 16 characters
                    alert('Tag is too long. Maximum length is 16 characters.');
                    return;
                }
                
                selectedTag = newTag;
            }
            
            const trimmedTag = selectedTag.trim();
            
            // Initialize tags array if it doesn't exist
            if (!unit._tags) {
                unit._tags = [];
            }
            
            // Check if tag already exists (case-insensitive)
            if (unit._tags.some(tag => tag.toLowerCase() === trimmedTag.toLowerCase())) {
                // Tag already exists, don't add duplicate
                return;
            }
            
            // Add the tag
            unit._tags.push(trimmedTag);
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

    getDisplayBV(unit: Unit): number {
        return this.filtersService.getAdjustedBV(unit);
    }
}