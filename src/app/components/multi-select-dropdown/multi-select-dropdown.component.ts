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

import { Component, ElementRef, computed, input, signal, output, inject, ChangeDetectionStrategy, viewChild, afterNextRender, Injector, effect, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { LayoutService } from '../../services/layout.service';
import { highlightMatches, matchesSearch, parseSearchQuery } from '../../utils/search.util';

/*
 * Author: Drake
 */
export interface DropdownOption {
    name: string;
    displayName?: string;
    img?: string;
    available?: boolean;
    count?: number;
}

export type MultiState = false | 'or' | 'and' | 'not';

/** Operators for quantity constraints on countable filters */
export type CountOperator = '=' | '!=' | '>' | '<' | '>=' | '<=';

export interface MultiStateOption {
    name: string;
    state: MultiState;
    count: number;
    /** Operator for quantity constraint (default is '=' for exact match) */
    countOperator?: CountOperator;
    /** Max value for range constraints (e.g., count=2, countMax=5 means 2-5) */
    countMax?: number;
    /** Include ranges for quantity (merged from multiple constraints) */
    countIncludeRanges?: [number, number][];
    /** Exclude ranges for quantity (merged from multiple constraints) */
    countExcludeRanges?: [number, number][];
}

export interface MultiStateSelection {
  [key: string]: MultiStateOption;
}

type ScrollRestoreState =
        | { kind: 'virtual'; optionName: string; scrollOffset: number; optionVisibleTop?: number }
        | { kind: 'dom'; optionName: string; visibleTop: number };

@Component({
    selector: 'multi-select-dropdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, ScrollingModule],
    templateUrl: './multi-select-dropdown.component.html',
    styleUrls: ['./multi-select-dropdown.component.css']
})
export class MultiSelectDropdownComponent {
    private elementRef = inject(ElementRef);
    private injector = inject(Injector);
    private layoutService = inject(LayoutService);
    private destroyRef = inject(DestroyRef);
    private destroyed = false;
    private lastPointerType = '';
    filterInput = viewChild<ElementRef<HTMLInputElement>>('filterInput');
    optionsEl = viewChild<ElementRef<HTMLDivElement>>('optionsEl');
    optionsDropdownEl = viewChild<ElementRef<HTMLDivElement>>('optionsDropdown');
    optionsViewport = viewChild<CdkVirtualScrollViewport>('optionsViewport');
    
    label = input<string>('');
    multiselect = input<boolean>(true);
    multistate = input<boolean>(false);
    countable = input<boolean>(false);
    semanticOnly = input<boolean>(false);
    displayText = input<string | undefined>();  // Text to display instead of pills when in semantic-only mode (fallback)
    displayItems = input<{ text: string; state: 'or' | 'and' | 'not' }[] | undefined>();  // Structured display items with state
    options = input<readonly DropdownOption[]>([]);
    selected = input<MultiStateSelection | string[]>([]);
    
    selectionChange = output<MultiStateSelection | readonly string[]>();

    showUnavailable = signal(false);
    showUnavailableToggle = computed(() => this.multistate() && this.options().some(o => o.available === false));
    isOpen = signal(false);
    filterText = signal('');
    /** Bumped after dropdown renders to force height recalculation */
    private layoutVersion = signal(0);
    readonly virtualScrollThreshold = 80;
    readonly optionItemSize = 44;

    private displayNameMap = computed(() => {
        const map = new Map<string, string>();
        for (const opt of this.options()) {
            if (opt.displayName) {
                map.set(opt.name, opt.displayName);
            }
        }
        return map;
    });

    getDisplayName(name: string): string {
        return this.displayNameMap().get(name) ?? name;
    }

    selectedOptions = computed(() => {
        if (this.multistate()) {
            const sel = (this.selected() as MultiStateSelection) || {};
            return Object.entries(sel)
                .filter(([_, selection]) => selection.state !== false)
                .map(([name, selection]) => ({ name, state: selection.state, count: selection.count }));
        }
        return (this.selected() as readonly string[] || []).map((name: string) => ({ name, state: 'or' as MultiState, count: 1 }));
    });

    /** When more than 5 pills, compress into summary pills grouped by state */
    private static readonly COMPRESS_THRESHOLD = 5;
    compressedPills = computed<{ state: MultiState; count: number }[] | null>(() => {
        const opts = this.selectedOptions();
        if (opts.length <= MultiSelectDropdownComponent.COMPRESS_THRESHOLD) return null;
        const counts = new Map<MultiState, number>();
        for (const o of opts) {
            counts.set(o.state, (counts.get(o.state) || 0) + 1);
        }
        const order: MultiState[] = ['or', 'and', 'not'];
        return order
            .filter(s => counts.has(s))
            .map(s => ({ state: s, count: counts.get(s)! }));
    });

    maxHeightOptions = computed(() => {
        const windowHeight = this.layoutService.windowHeight();
        const isOpen = this.isOpen();
        this.layoutVersion(); // Force recalc after render
        
        // Default when closed or elements not ready
        if (!isOpen) return 248;
        
        const dropdown = this.optionsDropdownEl()?.nativeElement;
        if (!dropdown) return 248;
        
        const rect = dropdown.getBoundingClientRect();
        
        // If dropdown isn't visible yet (hidden attribute still applied), use default
        if (rect.height === 0) return 248;
        
        // Check if filter row is visible
        const hasFilterRow = this.options().length > 20 || this.showUnavailableToggle();
        const filterRowHeight = hasFilterRow ? 50 : 0;
        const bottomPadding = 16;
        
        // Calculate available height from dropdown top to viewport bottom
        const availableForList = windowHeight - rect.top - filterRowHeight - bottomPadding;
        
        // Minimum height of 200px to ensure usability
        return Math.max(200, availableForList);
    });

    filteredOptions = computed(() => {
        // Return empty array when closed
        if (!this.isOpen()) return [];
        
        const searchTokens = parseSearchQuery(this.filterText());
        const nameFiltered = this.options().filter(option => 
            matchesSearch(option.name, searchTokens, true) || 
            (option.displayName && matchesSearch(option.displayName, searchTokens, true))
        );

        // if the toggle is off, hide unavailable items
        if (!this.showUnavailable()) {
            return nameFiltered.filter(option => option.available !== false || this.isSelected(option.name));
        }
        return nameFiltered;
    });

    useVirtualScroll = computed(() => this.filteredOptions().length >= this.virtualScrollThreshold);

    highlight(text: string): string {
        const searchTokens = parseSearchQuery(this.filterText());
        return highlightMatches(text, searchTokens, true);
    }

    toggleUnavailable(event: MouseEvent) {
        // prevent the click from closing the dropdown
        event.stopPropagation();
        this.showUnavailable.set(!this.showUnavailable());
    }

    private openListener = (ev: Event) => {
        const ce = ev as CustomEvent;
        // if another instance opened, close this one
        if (ce.detail !== this && this.isOpen()) {
            this.isOpen.set(false);
            this.filterText.set('');
        }
    };

    private onOutsideDocumentClick = (event: MouseEvent) => {
        if (!this.isOpen()) return;
        const target = event.target;
        if (!(target instanceof Node)) return;

        if (!this.elementRef.nativeElement.contains(target)) {
            this.isOpen.set(false);
            this.filterText.set('');
        }
    };

    constructor() {
        this.destroyRef.onDestroy(() => {
            this.destroyed = true;
            this.isOpen.set(false);
        });
        effect((cleanup) => {
            document.addEventListener('multi-select-dropdown-open', this.openListener as EventListener);
            cleanup(() => {
                document.removeEventListener('multi-select-dropdown-open', this.openListener as EventListener);
            });
        });

        effect((cleanup) => {
            if (!this.isOpen()) return;

            document.addEventListener('click', this.onOutsideDocumentClick, true);

            cleanup(() => {
                document.removeEventListener('click', this.onOutsideDocumentClick, true);
            });
        });
    }

    onPointerDown(event: PointerEvent) {
        this.lastPointerType = event.pointerType;
    }

    toggleDropdown(event?: MouseEvent) {
        if (this.semanticOnly()) return;
        const wasMouse = this.lastPointerType === 'mouse';
        this.lastPointerType = '';
        this.isOpen.set(!this.isOpen());
        if (this.isOpen()) {
            // notify other instances
            document.dispatchEvent(new CustomEvent('multi-select-dropdown-open', { detail: this }));
        }
        this.filterText.set('');
        afterNextRender(() => {
            if (this.destroyed) return;
            if (this.isOpen()) {
                // Bump layout version to recalculate max height now that dropdown is visible
                this.layoutVersion.update(v => v + 1);
                if (wasMouse) {
                    const inputEl = this.filterInput()?.nativeElement;
                    if (inputEl) {
                        inputEl.focus();
                    }
                }
            }
        }, { injector: this.injector });
    }

    openAndScrollTo(optionName: string, event: MouseEvent) {
        document.dispatchEvent(new CustomEvent('multi-select-dropdown-open', { detail: this }));
        event.stopPropagation();
        this.isOpen.set(true);
        this.filterText.set('');
        afterNextRender(() => {
            if (this.destroyed) return;
            // Bump layout version to recalculate max height now that dropdown is visible
            this.layoutVersion.update(v => v + 1);
            
            const options = this.filteredOptions();
            const optionIndex = options.findIndex(option => option.name === optionName);
            if (this.useVirtualScroll()) {
                const viewport = this.optionsViewport();
                if (viewport && optionIndex >= 0) {
                    viewport.scrollToIndex(optionIndex, 'smooth');
                }
            } else {
                const container = this.optionsEl()?.nativeElement;
                if (container) {
                    const items = Array.from(container.querySelectorAll<HTMLElement>('.option-item'));
                    for (const item of items) {
                        if (item.getAttribute('data-option-name') === optionName) {
                            try {
                                item.scrollIntoView({ block: 'center', behavior: 'smooth' });
                            } catch {
                                item.scrollIntoView();
                            }
                            break;
                        }
                    }
                }
            }

            const inputEl = this.filterInput()?.nativeElement;
            if (inputEl) {
                inputEl.focus();
            }
        }, { injector: this.injector });
    }

    onFilterInput(event: Event) {
        const inputElement = event.target as HTMLInputElement;
        this.filterText.set(inputElement.value);
    }

    onOptionToggle(optionName: string, event?: MouseEvent) {
        const restoreState = this.captureScrollRestoreState(optionName);

        if (this.multistate()) {
            const sel = this.selected();
            const currentSelection: MultiStateSelection = (sel && !Array.isArray(sel)) ? { ...sel } : {};
            const current = currentSelection[optionName] || { state: false as MultiState, count: 1 };
            let nextState: MultiState;
            switch (current.state) {
                case false: nextState = 'or'; break;
                case 'or': nextState = 'and'; break;
                case 'and': nextState = 'not'; break;
                case 'not': nextState = false; break;
                default: nextState = 'or';
            }
            if (nextState === false) {
                delete currentSelection[optionName];
            } else {
                const count = nextState === 'not' ? 1 : current.count;
                currentSelection[optionName] = { name: optionName, state: nextState, count };
            }
            this.selectionChange.emit(currentSelection);
        } else {
            const currentSelection = this.selectedOptions().map(o => o.name);
            const newSelection = [...currentSelection];
            const index = newSelection.indexOf(optionName);

            if (index > -1) {
                newSelection.splice(index, 1);
            } else {
                newSelection.push(optionName);
            }
            this.selectionChange.emit(newSelection);
        }
        
        this.restoreScrollPosition(restoreState);
    }

    private captureScrollRestoreState(optionName: string): ScrollRestoreState | null {
        if (this.useVirtualScroll()) {
            const viewport = this.optionsViewport();
            const scrollOffset = viewport?.measureScrollOffset('top');
            if (!viewport || scrollOffset === undefined) {
                return null;
            }

            const optionIndex = this.filteredOptions().findIndex(option => option.name === optionName);
            return {
                kind: 'virtual',
                optionName,
                scrollOffset,
                ...(optionIndex >= 0 ? { optionVisibleTop: optionIndex * this.optionItemSize - scrollOffset } : {}),
            };
        }

        const container = this.optionsEl()?.nativeElement;
        if (!container) {
            return null;
        }

        const item = container.querySelector<HTMLElement>('.option-item[data-option-name="' + CSS.escape(optionName) + '"]');
        if (!item) {
            return null;
        }

        const containerRect = container.getBoundingClientRect();
        const itemRect = item.getBoundingClientRect();
        return {
            kind: 'dom',
            optionName,
            visibleTop: itemRect.top - containerRect.top,
        };
    }

    restoreScrollPosition(restoreState: ScrollRestoreState | null) {
        // restore the preserved scroll after the DOM updates
        afterNextRender(() => {
            if (!restoreState) {
                return;
            }

            if (restoreState.kind === 'virtual') {
                const viewport = this.optionsViewport();
                if (!viewport) {
                    return;
                }

                let nextOffset = restoreState.scrollOffset;
                if (restoreState.optionVisibleTop !== undefined) {
                    const optionIndex = this.filteredOptions().findIndex(option => option.name === restoreState.optionName);
                    if (optionIndex >= 0) {
                        nextOffset = optionIndex * this.optionItemSize - restoreState.optionVisibleTop;
                    }
                }

                const maxOffset = Math.max(0, viewport.getDataLength() * this.optionItemSize - viewport.getViewportSize());
                viewport.scrollToOffset(Math.max(0, Math.min(maxOffset, nextOffset)));
                return;
            }

            const container = this.optionsEl()?.nativeElement;
            if (!container) {
                return;
            }

            // find the same item after update
            const itemAfter = container.querySelector<HTMLElement>('.option-item[data-option-name="' + CSS.escape(restoreState.optionName) + '"]');
            if (!itemAfter) {
                return;
            }

            const containerRect = container.getBoundingClientRect();
            const itemRect = itemAfter.getBoundingClientRect();

            // item offset within the scrollable content (distance from content top)
            const itemAfterOffsetTop = (itemRect.top - containerRect.top) + container.scrollTop;

            // desired visible top within container is the preservedVisibleTop
            let newScrollTop = itemAfterOffsetTop - restoreState.visibleTop;
            newScrollTop = Math.max(0, Math.min(container.scrollHeight - container.clientHeight, newScrollTop));

            // apply only if it meaningfully changes the scroll to avoid jitter
            if (Math.abs(container.scrollTop - newScrollTop) > 0.5) {
                container.scrollTop = newScrollTop;
            }
        }, { injector: this.injector });
    }

    getState(optionName: string): MultiState {
        if (this.multistate()) {
            const sel = this.selected() as MultiStateSelection;
            return sel[optionName]?.state || false;
        }
        return this.isSelected(optionName) ? 'or' : false;
    }

    getCount(optionName: string): number {
        if (this.multistate()) {
            const sel = this.selected() as MultiStateSelection;
            return sel[optionName]?.count || 1;
        }
        return 1;
    }

    setCount(optionName: string, count: number) {
        if (!this.countable() || !this.multistate()) return;
        const restoreState = this.captureScrollRestoreState(optionName);

        
        const sel = this.selected() as MultiStateSelection;
        const currentSelection: MultiStateSelection = { ...sel };
        const current = currentSelection[optionName];
        
        if (current && (current.state === 'and' || current.state === 'or')) {
            currentSelection[optionName] = { 
                name: optionName,
                state: current.state, 
                count: Math.max(1, count) 
            };
            this.selectionChange.emit(currentSelection);
        }
        this.restoreScrollPosition(restoreState);
    }

    trackOptionName = (_index: number, option: DropdownOption) => option.name;
 
    onQuantityInput(optionName: string, event: Event) {
        const inputElement = event.target as HTMLInputElement;
        const value = parseInt(inputElement.value, 10);
        if (!isNaN(value)) {
            this.setCount(optionName, value);
        }
    }

    onQuantityWheel(optionName: string, event: WheelEvent) {
        // stop the wheel from scrolling the outer container
        event.preventDefault();
        event.stopPropagation();

        // Adjust the count by 1 step per wheel event (wheel down -> decrease)
        const delta = event.deltaY;
        if (delta === 0) return;

        const step = delta > 0 ? -1 : 1;
        const current = this.getCount(optionName) || 1;
        const next = Math.max(1, current + step);
        if (next !== current) {
            this.setCount(optionName, next);
        }
    }

    onSingleSelect(optionName: string) {
        if (!this.multiselect()) {
            this.selectionChange.emit([optionName]);
            this.isOpen.set(false);
            this.filterText.set('');
        }
    }

    removeOption(option: string, event: MouseEvent) {
        event.stopPropagation();
        if (this.multistate()) {
            const sel = this.selected();
            const currentSelection: MultiStateSelection = (sel && !Array.isArray(sel)) ? { ...sel } : {};
            delete currentSelection[option];
            this.selectionChange.emit(currentSelection);
        } else {
            this.onOptionToggle(option);
        }
    }

    removeCompressedState(state: MultiState, event: MouseEvent) {
        event.stopPropagation();

        if (this.multistate()) {
            const sel = this.selected();
            const currentSelection: MultiStateSelection = (sel && !Array.isArray(sel)) ? { ...sel } : {};
            for (const [optionName, selection] of Object.entries(currentSelection)) {
                if (selection.state === state) {
                    delete currentSelection[optionName];
                }
            }
            this.selectionChange.emit(currentSelection);
            return;
        }

        const remainingSelection = this.selectedOptions()
            .filter(option => option.state !== state)
            .map(option => option.name);
        this.selectionChange.emit(remainingSelection);
    }

    isSelected(optionName: string): MultiState | boolean {
        if (this.multistate()) {
            const sel = this.selected() as MultiStateSelection;
            return sel[optionName]?.state || false;
        }
        return this.selectedOptions().some(o => o.name === optionName);
    }
}