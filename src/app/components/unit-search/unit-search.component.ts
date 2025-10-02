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
import { Component, signal, ViewChild, ElementRef, OnDestroy, computed, HostListener, effect, afterNextRender, Injector, inject, ChangeDetectionStrategy, Host, input } from '@angular/core';
import { ScrollingModule, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { RangeSliderComponent } from '../range-slider/range-slider.component';
import { MultiSelectDropdownComponent } from '../multi-select-dropdown/multi-select-dropdown.component';
import { UnitSearchFiltersService, ADVANCED_FILTERS, SORT_OPTIONS, AdvFilterType, SortOption } from '../../services/unit-search-filters.service';
import { Unit } from '../../models/units.model';
import { ForceBuilderService } from '../../services/force-builder.service';
import { Dialog } from '@angular/cdk/dialog';
import { UnitDetailsDialogComponent } from '../unit-details-dialog/unit-details-dialog.component';
import { InputDialogComponent, InputDialogData } from '../input-dialog/input-dialog.component';
import { firstValueFrom } from 'rxjs';

/*
 * Author: Drake
 */
@Component({
    selector: 'unit-search',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, ScrollingModule, RangeSliderComponent, MultiSelectDropdownComponent],
    templateUrl: './unit-search.component.html',
    styleUrl: './unit-search.component.css',
})
export class UnitSearchComponent implements OnDestroy {
    public filtersService = inject(UnitSearchFiltersService);
    private forceBuilderService = inject(ForceBuilderService);
    private injector = inject(Injector);
    private dialog = inject(Dialog);
    
    public readonly ADVANCED_FILTERS = ADVANCED_FILTERS;
    public readonly AdvFilterType = AdvFilterType;
    public readonly SORT_OPTIONS = SORT_OPTIONS;

    @ViewChild(CdkVirtualScrollViewport) viewport?: CdkVirtualScrollViewport;
    @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
    @ViewChild('advBtn') advBtn?: ElementRef<HTMLButtonElement>;
    @ViewChild('advPanel') advPanel?: ElementRef<HTMLElement>;
    @ViewChild('resultsDropdown') resultsDropdown?: ElementRef<HTMLElement>;

    autoFocus = input(false);
    advOpen = signal(false);
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
    
    overlayVisible = computed(() => this.advOpen() || this.resultsVisible());

    resultsVisible = computed(() => {
        return (this.focused() || this.advOpen() || this.unitDetailsDialogOpen()) &&
            (this.filtersService.search() || this.isAdvActive());
    });

    private resizeObserver?: ResizeObserver;

    constructor() {
        effect(() => {
            if (this.advOpen()) {
                this.updateAdvPanelPosition();  
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
                this.searchInput?.nativeElement) {
                setTimeout(() => {
                    this.searchInput?.nativeElement.focus();
                }, 0);
            }
        });
    }

    ngOnDestroy() {
        this.resizeObserver?.disconnect();
    }
    
    closeAllPanels() {
        this.focused.set(false);
        this.advOpen.set(false);
        this.activeIndex.set(null);
        this.searchInput?.nativeElement.blur();
    }

    onOverlayClick() {
        this.closeAllPanels();
    }

    trackByUnitId(index: number, unit: Unit) {
        return unit.name;
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
            this.searchInput?.nativeElement.focus();
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
        const container = document.querySelector('.searchbar-container') as HTMLElement;
        if (!container) return;

        const containerRect = container.getBoundingClientRect();
        const gap = 5;
        const dropdownWidth = containerRect.width;

        // Calculate TOTAL dropdown height
        const top = containerRect.bottom + gap + window.scrollY;
        let height;
        if (this.filtersService.filteredUnits().length > 0) {
            const availableHeight = window.innerHeight - top - (window.innerHeight > 600 ? 50 : 10); // variable bottom based on vertical estate
            height = `${availableHeight}px`;
        } else {
            height = 'auto';
        }

        this.resultsDropdownStyle.set({
            top: `${top}px`,
            width: `${dropdownWidth}px`,
            height: height
        });
        afterNextRender(() => {
            this.viewport?.checkViewportSize();
        }, { injector: this.injector });
}

    updateAdvPanelPosition() {
        if (!this.advBtn) return;

        const buttonRect = this.advBtn.nativeElement.getBoundingClientRect();
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
            availableHeight = window.innerHeight - top - 10;
        } else {
            // Display UNDER the button, aligned to the right
            left = buttonRect.right - panelWidth + window.scrollX;
            top = buttonRect.bottom + gap + window.scrollY;
            availableHeight = window.innerHeight - top - 10;
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

    onKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            if (this.advOpen()) {
                this.closeAdvPanel();
                this.searchInput?.nativeElement.focus();
                return;
            } else {
                this.focused.set(false);
                this.searchInput?.nativeElement.blur();
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
                        this.searchInput?.nativeElement.focus();
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
        this.viewport?.scrollToIndex(index, 'smooth');
    }

    highlight(text: string): string {
        const search = this.filtersService.search().trim();
        if (!search) return this.escapeHtml(text);

        // Unique, non-empty words sorted by length desc to prefer longer matches
        const words = Array.from(new Set(search.split(/\s+/).filter(Boolean)));
        if (words.length === 0) return this.escapeHtml(text);

        const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = words.map(escapeRegExp).sort((a, b) => b.length - a.length).join('|');
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
                hideAddButton: false
            }
        });
        this.unitDetailsDialogOpen.set(true);

        ref.closed.subscribe(() => {
            this.unitDetailsDialogOpen.set(false);
        });

        ref.componentInstance?.add.subscribe(unit => {
            this.forceBuilderService.addUnit(unit);
            ref.close();
            this.searchInput?.nativeElement.blur();
            this.unitDetailsDialogOpen.set(false);
        });
        
        this.advOpen.set(false);
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
        if (key === 'name' || key === 'bv' || key === 'tons' || key === 'year' || key === 'role') {
            return '';
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
}