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

import { ChangeDetectionStrategy, Component, output, signal } from '@angular/core';


/*
 * Author: Drake
 */

/** Event data for tag selection with type information */
export interface TagSelectionEvent {
    tag: string;
    tagType: 'name' | 'chassis';
}

@Component({
    selector: 'tag-selector',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    templateUrl: './tag-selector.component.html',
    styleUrl: './tag-selector.component.css'
})
export class TagSelectorComponent {
    /** All unique tags available for unit-specific tagging */
    nameTags = signal<string[]>([]);
    /** All unique tags available for chassis-wide tagging */
    chassisTags = signal<string[]>([]);
    /** Tags assigned to ALL selected units via name */
    assignedNameTags = signal<string[]>([]);
    /** Tags assigned to SOME (but not all) selected units via name */
    partialNameTags = signal<string[]>([]);
    /** Tags assigned to ALL selected units via chassis */
    assignedChassisTags = signal<string[]>([]);
    /** Tags assigned to SOME (but not all) selected units via chassis */
    partialChassisTags = signal<string[]>([]);
    
    tagSelected = output<TagSelectionEvent>();
    tagRemoved = output<TagSelectionEvent>();

    onNameTagClick(tag: string) {
        // Don't allow clicking if covered by chassis tag or already fully assigned
        if (this.isNameTagCoveredByChassis(tag) || this.isNameTagFullyAssigned(tag)) {
            return;
        }
        this.tagSelected.emit({ tag, tagType: 'name' });
    }

    onChassisTagClick(tag: string) {
        // Allow clicking if not fully assigned (adds to all units)
        if (!this.isChassisTagFullyAssigned(tag)) {
            this.tagSelected.emit({ tag, tagType: 'chassis' });
        }
    }

    onRemoveNameTag(tag: string, event: MouseEvent) {
        event.stopPropagation();
        this.tagRemoved.emit({ tag, tagType: 'name' });
    }

    onRemoveChassisTag(tag: string, event: MouseEvent) {
        event.stopPropagation();
        this.tagRemoved.emit({ tag, tagType: 'chassis' });
    }

    onAddNewNameTag() {
        this.tagSelected.emit({ tag: '__new__', tagType: 'name' });
    }

    onAddNewChassisTag() {
        this.tagSelected.emit({ tag: '__new__', tagType: 'chassis' });
    }

    /** Tag is assigned to ALL selected units */
    isNameTagFullyAssigned(tag: string): boolean {
        return this.assignedNameTags().some(t => t.toLowerCase() === tag.toLowerCase());
    }

    /** Tag is assigned to SOME but not all selected units */
    isNameTagPartiallyAssigned(tag: string): boolean {
        return this.partialNameTags().some(t => t.toLowerCase() === tag.toLowerCase());
    }

    /** Tag is assigned to at least one unit (show remove button) */
    isNameTagAssignedToAny(tag: string): boolean {
        return this.isNameTagFullyAssigned(tag) || this.isNameTagPartiallyAssigned(tag);
    }

    /** Tag is already covered by a chassis tag (should be grayed out and not clickable) */
    isNameTagCoveredByChassis(tag: string): boolean {
        const lowerTag = tag.toLowerCase();
        return this.assignedChassisTags().some(t => t.toLowerCase() === lowerTag) ||
               this.partialChassisTags().some(t => t.toLowerCase() === lowerTag);
    }

    /** Tag is assigned to ALL selected units */
    isChassisTagFullyAssigned(tag: string): boolean {
        return this.assignedChassisTags().some(t => t.toLowerCase() === tag.toLowerCase());
    }

    /** Tag is assigned to SOME but not all selected units */
    isChassisTagPartiallyAssigned(tag: string): boolean {
        return this.partialChassisTags().some(t => t.toLowerCase() === tag.toLowerCase());
    }

    /** Tag is assigned to at least one unit (show remove button) */
    isChassisTagAssignedToAny(tag: string): boolean {
        return this.isChassisTagFullyAssigned(tag) || this.isChassisTagPartiallyAssigned(tag);
    }
}