// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { UnitSummary, PublicTagInfo, UnitTagEntry } from '../../models/unit-summary.model';
import { PublicTagsService } from '../../services/public-tags.service';
import { PlayerNamesService } from '../../services/player-names.service';
import { LayoutService } from '../../services/layout.service';
import { TagsService } from '../../services/tags.service';
import { DataService } from '../../services/data.service';
import { naturalCompare } from '../../utils/sort.util';

/** Event data emitted when the tag button is clicked */
export interface TagClickEvent {
    unit: UnitSummary;
    event: MouseEvent;
}

/** One pill of the row mode; chassis tags first, then this unit's, then other players'. */
interface RowTag {
    readonly key: string;
    readonly kind: 'chassis' | 'name' | 'public';
    readonly tag: string;
    readonly quantity: number;
    readonly title: string;
    readonly subscribed?: boolean;
}

/** Row tags shown on a phone before the rest fold into "+N". */
const PHONE_ROW_TAG_LIMIT = 2;

/**
 * A component for displaying and managing unit tags.
 *
 * Display modes:
 * - Compact: Shows a tag icon with count badge (for dense lists)
 * - Full: Shows all tag names as pills (for expanded views)
 * - Row: A labelled "Tags" button followed by the pills; on a phone one line, the rest behind "+N"
 */
@Component({
    selector: 'unit-tags',
    imports: [NgTemplateOutlet],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './unit-tags.component.html',
    styleUrl: './unit-tags.component.scss'
})
export class UnitTagsComponent {
    private publicTagsService = inject(PublicTagsService);
    private playerNames = inject(PlayerNamesService);
    private tagsService = inject(TagsService);
    private dataService = inject(DataService);
    private layout = inject(LayoutService);
    unit = input.required<UnitSummary>();
    readonly tagPath = 'M3 4v7.6a1 1 0 0 0 .3.7l8.4 8.4a1 1 0 0 0 1.4 0l7.6-7.6a1 1 0 0 0 0-1.4L12.3 3.3a1 1 0 0 0-.7-.3H4a1 1 0 0 0-1 1z';
    readonly tagHolePath = 'M7.6 6a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z';

    /** 
     * Display mode:
     * - 'compact': Shows tag icon with count badge
     * - 'full': Shows all tag names as pills
     */
    mode = input<'compact' | 'full' | 'row'>('compact');

    enableTagsEditing = input(true);

    /** Emitted when the add/edit tag button is clicked. Passes both the unit and MouseEvent for overlay positioning. */
    tagClick = output<TagClickEvent>();

    /** Tag state lives on the catalog entry; details and force views pass copies whose tags never update. */
    private readonly taggedUnit = computed(() => this.dataService.getUnitByUuid(this.unit().uuid) ?? this.unit());

    /** Quantity-aware unit tags for full-mode rendering */
    nameTagEntries = computed((): UnitTagEntry[] => {
        this.tagsService.version();
        const tags = [...(this.taggedUnit()._nameTags ?? [])];
        return this.mode() === 'full' ? tags.sort((left, right) => naturalCompare(left.tag, right.tag)) : tags;
    });

    /** Quantity-aware chassis tags for full-mode rendering */
    chassisTagEntries = computed((): UnitTagEntry[] => {
        this.tagsService.version();
        const tags = [...(this.taggedUnit()._chassisTags ?? [])];
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

    private readonly rowTags = computed((): RowTag[] => [
        ...this.chassisTagEntries().map(entry => ({ key: 'c:' + entry.tag.toLowerCase(), kind: 'chassis' as const, tag: entry.tag,
            quantity: entry.quantity, title: `On every ${this.unit().chassis} variant` })),
        ...this.nameTagEntries().map(entry => ({ key: 'n:' + entry.tag.toLowerCase(), kind: 'name' as const, tag: entry.tag,
            quantity: entry.quantity, title: entry.tag })),
        ...this.publicTags().map(tag => ({ key: `p:${tag.publicId}:${tag.tag}`, kind: 'public' as const, tag: tag.tag,
            quantity: 1, title: this.publicTagTitle(tag), subscribed: tag.subscribed })),
    ]);
    readonly visibleRowTags = computed(() => this.layout.isPhone() ? this.rowTags().slice(0, PHONE_ROW_TAG_LIMIT) : this.rowTags());
    readonly hiddenRowTagCount = computed(() => this.rowTags().length - this.visibleRowTags().length);
    hasTags = computed(() => this.totalTagCount() > 0);

    onTagClick(event: MouseEvent): void {
        event.stopPropagation();
        this.tagClick.emit({ unit: this.unit(), event });
    }

    /** Names are not unique, so the tooltip also carries the creator's publicId. */
    publicTagTitle(tag: PublicTagInfo): string {
        return `From ${this.playerNames.label(tag.publicId)} (${tag.publicId})`;
    }

    formatTagEntry(entry: UnitTagEntry): string {
        return entry.quantity > 1 ? `${entry.tag} (${entry.quantity})` : entry.tag;
    }
}
