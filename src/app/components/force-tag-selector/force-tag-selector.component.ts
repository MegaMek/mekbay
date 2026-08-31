// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, output, signal } from '@angular/core';

export const FORCE_TAG_SELECTOR_NEW_TAG = '__new__';

@Component({
    selector: 'force-tag-selector',
    changeDetection: ChangeDetectionStrategy.OnPush,
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
