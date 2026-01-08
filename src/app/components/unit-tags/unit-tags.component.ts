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

import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Unit } from '../../models/units.model';
import { UnitSearchFiltersService } from '../../services/unit-search-filters.service';

/** Event data emitted when the tag button is clicked */
export interface TagClickEvent {
    unit: Unit;
    event: MouseEvent;
}

/**
 * A component for displaying and managing unit tags.
 * 
 * Two display modes:
 * - Compact: Shows a tag icon with count badge (for dense lists)
 * - Full: Shows all tag names as pills (for expanded views)
 */
@Component({
    selector: 'unit-tags',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    templateUrl: './unit-tags.component.html',
    styleUrl: './unit-tags.component.css'
})
export class UnitTagsComponent {
    private filtersService = inject(UnitSearchFiltersService);

    /** The unit whose tags to display */
    unit = input.required<Unit>();

    /** 
     * Display mode:
     * - 'compact': Shows tag icon with count badge
     * - 'full': Shows all tag names as pills
     */
    mode = input<'compact' | 'full'>('compact');

    /**
     * Icon size:
     * - 'normal': 24px icons (default)
     * - 'small': 16px icons (for dense table views)
     */
    size = input<'normal' | 'small'>('normal');

    /** Emitted when the add/edit tag button is clicked. Passes both the unit and MouseEvent for overlay positioning. */
    tagClick = output<TagClickEvent>();

    /** Internal signal that holds a copy of the name tags array */
    private _nameTags = signal<string[]>([]);
    /** Internal signal that holds a copy of the chassis tags array */
    private _chassisTags = signal<string[]>([]);

    /** Exposed name tags for template */
    nameTags = this._nameTags.asReadonly();
    /** Exposed chassis tags for template */
    chassisTags = this._chassisTags.asReadonly();

    /** Total tag count for compact mode */
    totalTagCount = computed(() => this._nameTags().length + this._chassisTags().length);

    /** Whether the unit has any tags */
    hasTags = computed(() => this.totalTagCount() > 0);

    constructor() {
        // Update local tags signals when unit changes or tagsVersion changes
        effect(() => {
            // Read dependencies
            const unit = this.unit();
            this.filtersService.tagsVersion();
            // Create new array copies to ensure change detection sees them as new
            this._nameTags.set([...(unit._nameTags ?? [])]);
            this._chassisTags.set([...(unit._chassisTags ?? [])]);
        });
    }

    onTagClick(event: MouseEvent): void {
        event.stopPropagation();
        this.tagClick.emit({ unit: this.unit(), event });
    }
}
