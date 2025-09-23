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

import { Component, HostListener, ElementRef, computed, input, signal, ViewChild, output, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

/*
 * Author: Drake
 */
export interface DropdownOption {
    name: string;
    img?: string;
    available?: boolean;
}

export type MultiState = 'off' | 'or' | 'and' | 'not';
export type MultiStateSelection = { [option: string]: MultiState };

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
    @ViewChild('filterInput') filterInputRef?: ElementRef<HTMLInputElement>;
    
    label = input<string>('');
    multiselect = input<boolean>(true);
    multistate = input<boolean>(false);
    options = input<readonly DropdownOption[]>([]);
    selected = input<MultiStateSelection | string[]>([]);
    
    selectionChange = output<MultiStateSelection | readonly string[]>();

    isOpen = signal(false);
    filterText = signal('');

    selectedOptions = computed(() => {
        if (this.multistate()) {
            const sel = (this.selected() as MultiStateSelection) || {};
            return Object.entries(sel)
                .filter(([_, state]) => state !== 'off')
                .map(([name, state]) => ({ name, state }));
        }
        return (this.selected() as readonly string[] || []).map((name: string) => ({ name, state: 'or' }));
    });

    filteredOptions = computed(() => {
        const filter = this.filterText().toLowerCase().replace(/[^a-z0-9]/gi, '');
        // Normalize filter for smart matching (e.g. "AC/5" matches "ac5" or "AC 5")
        function normalize(str: string) {
            return str.toLowerCase().replace(/[^a-z0-9]/gi, '');
        }
        if (!filter) {
            return this.options();
        }
        return this.options().filter(option => normalize(option.name).includes(filter));
    });

    constructor() {}

    @HostListener('document:click', ['$event'])
    onDocumentClick(event: MouseEvent) {
        if (this.isOpen() && !this.elementRef.nativeElement.contains(event.target)) {
            this.isOpen.set(false);
            this.filterText.set('');
        }
    }

    toggleDropdown() {
        this.isOpen.set(!this.isOpen());
        this.filterText.set('');        
        setTimeout(() => {
            if (this.isOpen() && this.filterInputRef?.nativeElement) {
                this.filterInputRef.nativeElement.focus();
            }
        });
    }

    onFilterInput(event: Event) {
        const inputElement = event.target as HTMLInputElement;
        this.filterText.set(inputElement.value);
    }

    onOptionToggle(optionName: string) {
        if (this.multistate()) {
            const sel = this.selected();
            const currentSelection: MultiStateSelection = (sel && !Array.isArray(sel)) ? { ...sel } : {};
            const currentState: MultiState = currentSelection[optionName] || 'off';
            let nextState: MultiState;
            switch (currentState) {
                case 'off': nextState = 'or'; break;
                case 'or': nextState = 'and'; break;
                case 'and': nextState = 'not'; break;
                case 'not': nextState = 'off'; break;
                default: nextState = 'or';
            }
            if (nextState === 'off') {
                delete currentSelection[optionName];
            } else {
                currentSelection[optionName] = nextState;
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
            const sel = this.selected();
            const currentSelection: MultiStateSelection = (sel && !Array.isArray(sel)) ? { ...sel } : {};
            return currentSelection[optionName] || 'off';
        }
        return this.selectedOptions().some(o => o.name === optionName);
    }

    trackByName(index: number, option: DropdownOption): string {
        return option.name;
    }
}