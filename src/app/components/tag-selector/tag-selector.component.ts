// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, output, signal } from '@angular/core';
import type { PublicTagInfo } from '../../models/units.model';

/** Event data for tag selection with type information */
export interface TagSelectionEvent {
    tag: string;
    tagType: 'name' | 'chassis';
}

/** Event data for tag quantity edits */
export interface TagQuantityChangeEvent {
    tag: string;
    tagType: 'name' | 'chassis';
    quantity: number;
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
    /** Public tags from other users (read-only) */
    publicTags = signal<PublicTagInfo[]>([]);
    /** Per-tag quantity values for unit-specific tags, keyed by lowercase tag id */
    nameTagQuantities = signal<Record<string, number>>({});
    /** Per-tag quantity values for chassis-wide tags, keyed by lowercase tag id */
    chassisTagQuantities = signal<Record<string, number>>({});
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
    unsubscribeRequested = output<PublicTagInfo>();
    quantityChanged = output<TagQuantityChangeEvent>();

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

    onUnsubscribe(pt: PublicTagInfo, event: MouseEvent) {
        event.stopPropagation();
        this.unsubscribeRequested.emit(pt);
    }

    getNameTagQuantity(tag: string): number {
        return this.nameTagQuantities()[tag.toLowerCase()] ?? 1;
    }

    getChassisTagQuantity(tag: string): number {
        return this.chassisTagQuantities()[tag.toLowerCase()] ?? 1;
    }

    onNameTagQuantityInput(tag: string, event: Event): void {
        const quantity = this.parseQuantityFromEvent(event, false);
        if (quantity == null) {
            return;
        }

        this.setNameTagQuantity(tag, quantity);
    }

    onChassisTagQuantityInput(tag: string, event: Event): void {
        const quantity = this.parseQuantityFromEvent(event, false);
        if (quantity == null) {
            return;
        }

        this.setChassisTagQuantity(tag, quantity);
    }

    onNameTagQuantityBlur(tag: string, event: Event): void {
        const quantity = this.parseQuantityFromEvent(event, true);
        if (quantity == null) {
            return;
        }

        this.setNameTagQuantity(tag, quantity);
        this.quantityChanged.emit({ tag, tagType: 'name', quantity });
    }

    onChassisTagQuantityBlur(tag: string, event: Event): void {
        const quantity = this.parseQuantityFromEvent(event, true);
        if (quantity == null) {
            return;
        }

        this.setChassisTagQuantity(tag, quantity);
        this.quantityChanged.emit({ tag, tagType: 'chassis', quantity });
    }

    onNameTagQuantityChange(tag: string, event: Event): void {
        this.onNameTagQuantityBlur(tag, event);
    }

    onChassisTagQuantityChange(tag: string, event: Event): void {
        this.onChassisTagQuantityBlur(tag, event);
    }

    private setNameTagQuantity(tag: string, quantity: number): void {
        const key = tag.toLowerCase();
        this.nameTagQuantities.update(current => ({ ...current, [key]: quantity }));
    }

    private setChassisTagQuantity(tag: string, quantity: number): void {
        const key = tag.toLowerCase();
        this.chassisTagQuantities.update(current => ({ ...current, [key]: quantity }));
    }

    private parseQuantityFromEvent(event: Event, normalizeEmpty: boolean): number | null {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
            return null;
        }

        if (target.value.trim() === '' && !normalizeEmpty) {
            return null;
        }

        const parsed = Number.parseInt(target.value, 10);
        const quantity = Number.isFinite(parsed) ? Math.max(1, parsed) : 1;
        if (target.value !== String(quantity)) {
            target.value = String(quantity);
        }

        return quantity;
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