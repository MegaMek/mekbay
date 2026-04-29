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

import { ChangeDetectionStrategy, Component, output, signal } from '@angular/core';

export const FORCE_TAG_SELECTOR_NEW_TAG = '__new__';

@Component({
    selector: 'force-tag-selector',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    templateUrl: './force-tag-selector.component.html',
    styleUrl: './force-tag-selector.component.css'
})
export class ForceTagSelectorComponent {
    /** All unique force tags available for hangar tagging. */
    tags = signal<string[]>([]);
    /** Tags assigned to ALL selected forces. */
    assignedTags = signal<string[]>([]);
    /** Tags assigned to SOME but not all selected forces. */
    partialTags = signal<string[]>([]);

    tagSelected = output<string>();
    tagRemoved = output<string>();

    onTagClick(tag: string): void {
        if (this.isTagFullyAssigned(tag)) {
            return;
        }

        this.tagSelected.emit(tag);
    }

    onRemoveTag(tag: string, event: MouseEvent): void {
        event.stopPropagation();
        this.tagRemoved.emit(tag);
    }

    onAddNewTag(): void {
        this.tagSelected.emit(FORCE_TAG_SELECTOR_NEW_TAG);
    }

    isTagFullyAssigned(tag: string): boolean {
        return this.assignedTags().some(t => t.toLowerCase() === tag.toLowerCase());
    }

    isTagPartiallyAssigned(tag: string): boolean {
        return this.partialTags().some(t => t.toLowerCase() === tag.toLowerCase());
    }

    isTagAssignedToAny(tag: string): boolean {
        return this.isTagFullyAssigned(tag) || this.isTagPartiallyAssigned(tag);
    }
}