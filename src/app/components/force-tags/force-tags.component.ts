// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { sanitizeForceTags } from '../../models/force-serialization';
import { naturalCompare } from '../../utils/sort.util';

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
        const tags = sanitizeForceTags(this.force().tags ?? []);
        return tags.sort(naturalCompare);
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