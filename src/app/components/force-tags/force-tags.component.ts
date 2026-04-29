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

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { sanitizeForceTags } from '../../models/force-serialization';

export interface ForceTaggableEntry {
    instanceId?: string | null;
    owned?: boolean;
    cloud?: boolean;
    name?: string;
    tags?: string[];
}

/** Event data emitted when the force tag button is clicked. */
export interface ForceTagClickEvent {
    force: ForceTaggableEntry;
    event: MouseEvent;
}

@Component({
    selector: 'force-tags',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    templateUrl: './force-tags.component.html',
    styleUrl: './force-tags.component.css'
})
export class ForceTagsComponent {
    force = input.required<ForceTaggableEntry>();

    /**
     * Display mode:
     * - 'compact': Shows tag icon with count badge
     * - 'full': Shows all tag names as pills
     */
    mode = input<'compact' | 'full'>('compact');

    /** Overrides the default owned/saved editability check when supplied. */
    editable = input<boolean | null>(null);

    /** External invalidation hook for mutable force entries. */
    tagsVersion = input(0);

    tagClick = output<ForceTagClickEvent>();

    forceTags = computed(() => {
        this.tagsVersion();
        return sanitizeForceTags(this.force().tags ?? []);
    });

    totalTagCount = computed(() => this.forceTags().length);
    hasTags = computed(() => this.totalTagCount() > 0);
    canEdit = computed(() => {
        const editable = this.editable();
        if (editable !== null) {
            return editable;
        }

        const force = this.force();
        return force.owned !== false && !!force.instanceId;
    });
    shouldRender = computed(() => this.hasTags() || this.canEdit());

    onTagClick(event: MouseEvent): void {
        event.stopPropagation();
        if (!this.canEdit()) {
            return;
        }

        this.tagClick.emit({ force: this.force(), event });
    }
}