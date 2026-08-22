// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { UnitSummary, PublicTagInfo, UnitTagEntry } from '../../models/unit-summary.model';
import { PublicTagsService } from '../../services/public-tags.service';
import { TagsService } from '../../services/tags.service';
import { naturalCompare } from '../../utils/sort.util';

/** Event data emitted when the tag button is clicked */
export interface TagClickEvent {
    unit: UnitSummary;
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
    styleUrl: './unit-tags.component.scss'
})
export class UnitTagsComponent {
    private publicTagsService = inject(PublicTagsService);
    private tagsService = inject(TagsService);
    unit = input.required<UnitSummary>();

    /** 
     * Display mode:
     * - 'compact': Shows tag icon with count badge
     * - 'full': Shows all tag names as pills
     */
    mode = input<'compact' | 'full'>('compact');

    enableTagsEditing = input(true);

    /** Emitted when the add/edit tag button is clicked. Passes both the unit and MouseEvent for overlay positioning. */
    tagClick = output<TagClickEvent>();

    /** Quantity-aware name tags for full-mode rendering */
    nameTagEntries = computed((): UnitTagEntry[] => {
        this.tagsService.version();
        const tags = [...(this.unit()._nameTags ?? [])];
        return this.mode() === 'full' ? tags.sort((left, right) => naturalCompare(left.tag, right.tag)) : tags;
    });

    /** Quantity-aware chassis tags for full-mode rendering */
    chassisTagEntries = computed((): UnitTagEntry[] => {
        this.tagsService.version();
        const tags = [...(this.unit()._chassisTags ?? [])];
        return this.mode() === 'full' ? tags.sort((left, right) => naturalCompare(left.tag, right.tag)) : tags;
    });

    /** Public tags from other users (temporary or subscribed) */
    publicTags = computed((): PublicTagInfo[] => {
        this.publicTagsService.version(); // dependency for public tags updates
        const tags = this.publicTagsService.getPublicTagsForUnit(this.unit());
        return this.mode() === 'full'
            ? [...tags].sort((left, right) => naturalCompare(left.tag, right.tag) || naturalCompare(left.publicId, right.publicId))
            : tags;
    });

    totalTagCount = computed(() => this.nameTagEntries().length + this.chassisTagEntries().length + this.publicTags().length);
    hasTags = computed(() => this.totalTagCount() > 0);

    onTagClick(event: MouseEvent): void {
        event.stopPropagation();
        this.tagClick.emit({ unit: this.unit(), event });
    }

    formatTagEntry(entry: UnitTagEntry): string {
        return entry.quantity > 1 ? `${entry.tag} (${entry.quantity})` : entry.tag;
    }
}
