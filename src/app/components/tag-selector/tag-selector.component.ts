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

import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

/*
 * Author: Drake
 */
@Component({
    selector: 'tag-selector',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    templateUrl: './tag-selector.component.html',
    styleUrl: './tag-selector.component.css'
})
export class TagSelectorComponent {
    @Input() tags: string[] = [];
    @Input() assignedTags: string[] = [];
    @Output() tagSelected = new EventEmitter<string>();
    @Output() tagRemoved = new EventEmitter<string>();

    onTagClick(tag: string) {
        // Only emit selection if tag is not already assigned
        if (!this.isTagAssigned(tag)) {
            this.tagSelected.emit(tag);
        }
    }

    onRemoveClick(tag: string, event: MouseEvent) {
        event.stopPropagation();
        this.tagRemoved.emit(tag);
    }

    onAddNewClick() {
        this.tagSelected.emit('__new__');
    }

    isTagAssigned(tag: string): boolean {
        return this.assignedTags.some(t => t.toLowerCase() === tag.toLowerCase());
    }
}