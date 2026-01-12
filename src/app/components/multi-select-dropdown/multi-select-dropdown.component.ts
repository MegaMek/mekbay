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

import { Component, ElementRef, computed, input, signal, output, inject, ChangeDetectionStrategy, viewChild, afterNextRender, Injector, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
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

export interface MultiStateOption {
    name: string;
    state: MultiState;
    count: number;
}

export interface MultiStateSelection {
  [key: string]: MultiStateOption;
}

@Component({
    selector: 'multi-select-dropdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    templateUrl: './multi-select-dropdown.component.html',
    styleUrls: ['./multi-select-dropdown.component.css']
})
export class MultiSelectDropdownComponent {
    private elementRef = inject(ElementRef);
    private injector = inject(Injector);
    private layoutService = inject(LayoutService);
    filterInput = viewChild<ElementRef<HTMLInputElement>>('filterInput');
    optionsEl = viewChild<ElementRef<HTMLDivElement>>('optionsEl');
    
    label = input<string>('');
    multiselect = input<boolean>(true);
    multistate = input<boolean>(false);
    countable = input<boolean>(false);
    disabled = input<boolean>(false);
    displayText = input<string | undefined>();  // Text to display instead of pills when in semantic-only mode
    options = input<readonly DropdownOption[]>([]);
    selected = input<MultiStateSelection | string[]>([]);
    
    selectionChange = output<MultiStateSelection | readonly string[]>();

    showUnavailable = signal(false);
    showUnavailableToggle = computed(() => this.multistate() && this.options().some(o => o.available === false));
    isOpen = signal(false);
    filterText = signal('');

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

    maxHeightOptions = computed(() => {
        const windowHeight = this.layoutService.windowHeight();
        const el = this.optionsEl()?.nativeElement;
        if (!el) return 248;
        const rect = el.getBoundingClientRect();
        const spaceBelow = windowHeight - rect.bottom - 32;
        return Math.max(spaceBelow, 248);
    });

    filteredOptions = computed(() => {
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

    toggleDropdown() {
        if (this.disabled()) return;
        this.isOpen.set(!this.isOpen());
        if (this.isOpen()) {
            // notify other instances
            document.dispatchEvent(new CustomEvent('multi-select-dropdown-open', { detail: this }));
        }
        this.filterText.set('');
        afterNextRender(() => {
            if (this.isOpen()) {
                const inputEl = this.filterInput()?.nativeElement;
                if (inputEl) {
                    inputEl.focus();
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
            const container = this.optionsEl()?.nativeElement;
            if (!container) return;

            const items = Array.from(container.querySelectorAll<HTMLElement>('.option-item'));
            for (const item of items) {
                if (item.getAttribute('data-option-name') === optionName) {
                    // scrollIntoView on the found item; prefer nearest block to avoid excessive scrolling
                    try {
                        item.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    } catch {
                        // fallback for environments that don't support options
                        item.scrollIntoView();
                    }
                    break;
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
        const container = this.optionsEl()?.nativeElement;

        // Preserve the item's visible top within the container viewport (pixels from container top)
        let preservedVisibleTop: number | null = null;
        if (container) {
            const item = container.querySelector<HTMLElement>('.option-item[data-option-name="' + CSS.escape(optionName) + '"]');
            if (item) {
                const containerRect = container.getBoundingClientRect();
                const itemRect = item.getBoundingClientRect();
                preservedVisibleTop = itemRect.top - containerRect.top;
            }
        }

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
        
        this.restoreScrollPosition(optionName, preservedVisibleTop);
    }

    restoreScrollPosition(optionName: string, preservedVisibleTop: number | null) {
        // restore the preserved scroll after the DOM updates
        afterNextRender(() => {
            const container = this.optionsEl()?.nativeElement;
            if (!container || preservedVisibleTop === null) {
                return;
            }

            // find the same item after update
            const itemAfter = container.querySelector<HTMLElement>('.option-item[data-option-name="' + CSS.escape(optionName) + '"]');
            if (!itemAfter) {
                return;
            }

            const containerRect = container.getBoundingClientRect();
            const itemRect = itemAfter.getBoundingClientRect();

            // item offset within the scrollable content (distance from content top)
            const itemAfterOffsetTop = (itemRect.top - containerRect.top) + container.scrollTop;

            // desired visible top within container is the preservedVisibleTop
            let newScrollTop = itemAfterOffsetTop - preservedVisibleTop;
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
        const container = this.optionsEl()?.nativeElement;
        // Preserve the item's visible top within the container viewport (pixels from container top)
        let preservedVisibleTop: number | null = null;
        if (container) {
            const item = container.querySelector<HTMLElement>('.option-item[data-option-name="' + CSS.escape(optionName) + '"]');
            if (item) {
                const containerRect = container.getBoundingClientRect();
                const itemRect = item.getBoundingClientRect();
                preservedVisibleTop = itemRect.top - containerRect.top;
            }
        }

        
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
        this.restoreScrollPosition(optionName, preservedVisibleTop);
    }
 
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

    isSelected(optionName: string): MultiState | boolean {
        if (this.multistate()) {
            const sel = this.selected() as MultiStateSelection;
            return sel[optionName]?.state || false;
        }
        return this.selectedOptions().some(o => o.name === optionName);
    }
}