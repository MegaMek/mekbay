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

import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, signal } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { ActivatedRoute, Router } from '@angular/router';
import type { Unit, UnitTagEntry } from '../../models/units.model';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { GameService } from '../../services/game.service';
import { TagsService } from '../../services/tags.service';
import { TAG_MAX_LENGTH, TaggingService, validateTagName } from '../../services/tagging.service';
import { ToastService } from '../../services/toast.service';
import { UserStateService } from '../../services/userState.service';
import { UnitDetailsDialogComponent, type UnitDetailsDialogData } from '../unit-details-dialog/unit-details-dialog.component';
import { matchesSearch, parseSearchQuery } from '../../utils/search.util';
import { compareUnitsByName } from '../../utils/sort.util';
import { shareUrlWithClipboardFallback } from '../../utils/clipboard.util';
import { buildPublicTagSearchQueryParameters } from '../../utils/unit-search-public-tags-url.util';

type CollectionRowType = 'chassis' | 'name';

interface CollectionTagEntry extends UnitTagEntry {
    lowerTag: string;
    removalKey: string;
    pendingRemoval: boolean;
}

interface CollectionRow {
    key: string;
    rowType: CollectionRowType;
    unit: Unit;
    title: string;
    subtitle: string;
    tags: CollectionTagEntry[];
}

interface ChassisOption {
    label: string;
    inputLabel: string;
    key: string;
    unit: Unit;
    unitCount: number;
}

interface PendingRemovedTag {
    key: string;
    rowKey: string;
    rowType: CollectionRowType;
    unit: Unit;
    title: string;
    subtitle: string;
    tag: string;
    lowerTag: string;
    quantity: number;
}

interface QuickAddQuantityConflict {
    chassis: string;
    tag: string;
    currentQuantity: number;
    nextQuantity: number;
}

@Component({
    selector: 'collection-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'fullscreen-dialog-host nopadding fullheight'
    },
    templateUrl: './collection-dialog.component.html',
    styleUrl: './collection-dialog.component.scss'
})
export class CollectionDialogComponent {
    private readonly hostElement = inject(ElementRef<HTMLElement>);
    private readonly dialogRef = inject(DialogRef<void>);
    private readonly router = inject(Router);
    private readonly route = inject(ActivatedRoute);
    private readonly dataService = inject(DataService);
    private readonly dialogsService = inject(DialogsService);
    private readonly gameService = inject(GameService);
    private readonly tagsService = inject(TagsService);
    private readonly taggingService = inject(TaggingService);
    private readonly toastService = inject(ToastService);
    private readonly userStateService = inject(UserStateService);
    private interactingWithChassisSuggestions = false;
    private suppressEmptyHeaderTagChange = false;
    private readonly createdTagOptions = signal<string[]>([]);

    readonly addNewTagOptionValue = '__add_new_tag__';

    readonly tagFilter = signal('');
    readonly unitTextFilter = signal('');
    readonly selectedRows = signal<Set<string>>(new Set<string>());
    readonly massTag = signal('');
    readonly massQuantity = signal(1);
    readonly addChassisText = signal('');
    readonly addTag = signal('');
    readonly addQuantity = signal(1);
    readonly quickAddOpen = signal(false);
    readonly showChassisSuggestions = signal(false);
    readonly statusMessage = signal('');
    readonly pendingRemovedTags = signal<Record<string, PendingRemovedTag>>({});

    readonly allRows = computed(() => {
        this.tagsService.version();
        this.dataService.tagsVersion();
        const pendingRemovedTags = this.pendingRemovedTags();

        const rows = new Map<string, CollectionRow>();

        for (const unit of this.dataService.getUnits()) {
            if (unit._chassisTags?.length) {
                const chassisKey = TagsService.getChassisTagKey(unit);
                const rowKey = this.getRowKey('chassis', unit);
                if (!rows.has(rowKey)) {
                    rows.set(rowKey, {
                        key: rowKey,
                        rowType: 'chassis',
                        unit,
                        title: unit.chassis,
                        subtitle: unit.type,
                        tags: this.toCollectionTags(unit._chassisTags, rowKey, pendingRemovedTags)
                    });
                }
            }

            if (unit._nameTags?.length) {
                const rowKey = this.getRowKey('name', unit);
                rows.set(rowKey, {
                    key: rowKey,
                    rowType: 'name',
                    unit,
                    title: this.getUnitDisplayName(unit),
                    subtitle: unit.type,
                    tags: this.toCollectionTags(unit._nameTags, rowKey, pendingRemovedTags)
                });
            }
        }

        for (const pendingTag of Object.values(pendingRemovedTags)) {
            let row = rows.get(pendingTag.rowKey);
            if (!row) {
                row = {
                    key: pendingTag.rowKey,
                    rowType: pendingTag.rowType,
                    unit: pendingTag.unit,
                    title: pendingTag.title,
                    subtitle: pendingTag.subtitle,
                    tags: []
                };
                rows.set(pendingTag.rowKey, row);
            }

            if (!row.tags.some(tag => tag.lowerTag === pendingTag.lowerTag)) {
                row.tags.push({
                    tag: pendingTag.tag,
                    lowerTag: pendingTag.lowerTag,
                    quantity: pendingTag.quantity,
                    removalKey: pendingTag.key,
                    pendingRemoval: true
                });
            }
        }

        for (const row of rows.values()) {
            row.tags.sort((left, right) => left.tag.toLowerCase().localeCompare(right.tag.toLowerCase()));
        }

        return Array.from(rows.values())
            .sort((left, right) => left.title.localeCompare(right.title) || left.rowType.localeCompare(right.rowType));
    });

    readonly allTags = computed(() => {
        const tags = new Map<string, string>();
        for (const row of this.allRows()) {
            for (const tag of row.tags) {
                if (!tags.has(tag.lowerTag)) {
                    tags.set(tag.lowerTag, tag.tag);
                }
            }
        }

        return Array.from(tags.values()).sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
    });

    readonly filteredRows = computed(() => {
        const tagFilter = this.tagFilter().trim().toLowerCase();
        const unitTextFilter = this.unitTextFilter().trim();
        const textTokens = parseSearchQuery(unitTextFilter);

        let rows = this.allRows();
        if (tagFilter) {
            rows = rows.filter(row => row.tags.some(tag => tag.lowerTag === tagFilter));
        }

        if (textTokens.length > 0) {
            rows = rows.filter(row => matchesSearch(this.getRowSearchText(row), textTokens, true));
        }

        return rows;
    });

    readonly selectedCount = computed(() => {
        const selected = this.selectedRows();
        return this.filteredRows().filter(row => selected.has(row.key)).length;
    });

    readonly allFilteredSelected = computed(() => {
        const rows = this.filteredRows();
        if (rows.length === 0) {
            return false;
        }
        const selected = this.selectedRows();
        return rows.every(row => selected.has(row.key));
    });

    readonly chassisOptions = computed(() => {
        const options = new Map<string, ChassisOption>();
        const counts = new Map<string, number>();

        for (const unit of this.dataService.getUnits()) {
            const key = TagsService.getChassisTagKey(unit);
            counts.set(key, (counts.get(key) ?? 0) + 1);
            if (!options.has(key)) {
                options.set(key, {
                    label: unit.chassis,
                    inputLabel: unit.chassis,
                    key,
                    unit,
                    unitCount: 0
                });
            }
        }

        const labelCounts = new Map<string, number>();
        for (const option of options.values()) {
            const lowerLabel = option.label.toLowerCase();
            labelCounts.set(lowerLabel, (labelCounts.get(lowerLabel) ?? 0) + 1);
        }

        for (const option of options.values()) {
            option.unitCount = counts.get(option.key) ?? 1;
            if ((labelCounts.get(option.label.toLowerCase()) ?? 0) > 1) {
                option.inputLabel = `${option.label} [${option.unit.type}]`;
            }
        }

        return Array.from(options.values())
            .sort((left, right) => left.label.localeCompare(right.label) || left.unit.type.localeCompare(right.unit.type));
    });

    readonly chassisSuggestions = computed(() => {
        const text = this.addChassisText().trim().toLowerCase();
        if (!text) {
            return this.chassisOptions().slice(0, 10);
        }

        return this.chassisOptions()
            .filter(option => option.inputLabel.toLowerCase().includes(text))
            .slice(0, 10);
    });

    readonly selectedAddChassisOption = computed(() => {
        const text = this.addChassisText().trim().toLowerCase();
        if (!text) {
            return null;
        }

        return this.chassisOptions().find(option => option.inputLabel.toLowerCase() === text) ?? null;
    });

    readonly quickAddQuantityConflict = computed((): QuickAddQuantityConflict | null => {
        this.tagsService.version();
        this.dataService.tagsVersion();
        const option = this.selectedAddChassisOption();
        const tag = this.addTag().trim();
        if (!option || !tag) {
            return null;
        }

        const existingTag = this.findChassisTag(option.unit, tag);
        const nextQuantity = this.addQuantity();
        if (!existingTag || existingTag.quantity === nextQuantity) {
            return null;
        }

        return {
            chassis: option.inputLabel,
            tag: existingTag.tag,
            currentQuantity: existingTag.quantity,
            nextQuantity
        };
    });

    readonly tagOptions = computed(() => {
        const tags = this.allTags();
        const lowerTags = new Set(tags.map(tag => tag.toLowerCase()));
        const createdTags = this.createdTagOptions()
            .filter(tag => !lowerTags.has(tag.toLowerCase()));

        return [...createdTags, ...tags];
    });

    readonly titleTagOptions = computed(() => {
        const tags = this.allTags();
        const selectedTag = this.tagFilter().trim();
        if (!selectedTag || tags.some(tag => tag.toLowerCase() === selectedTag.toLowerCase())) {
            return tags;
        }

        return [...tags, selectedTag]
            .sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
    });

    readonly selectedMassTagValue = computed(() => this.resolveSelectedTagValue(this.massTag()));

    readonly selectedQuickAddTagValue = computed(() => {
        return this.resolveSelectedTagValue(this.addTag());
    });

    readonly selectedHeaderTag = computed(() => this.tagFilter().trim());

    readonly selectedHeaderTagLower = computed(() => this.selectedHeaderTag().toLowerCase());

    readonly canUseHeaderTagActions = computed(() => this.selectedHeaderTag().length > 0);

    readonly canAddChassis = computed(() => {
        return !!this.selectedAddChassisOption() && this.addTag().trim().length > 0;
    });

    readonly canApplyMassChange = computed(() => this.selectedCount() > 0 && this.massTag().trim().length > 0);

    readonly canRemoveMassTag = computed(() => {
        const lowerTag = this.massTag().trim().toLowerCase();
        if (!lowerTag || this.selectedCount() === 0) {
            return false;
        }

        return this.getSelectedVisibleRows()
            .some(row => row.tags.some(tag => tag.lowerTag === lowerTag && !tag.pendingRemoval));
    });

    close(): void {
        this.dialogRef.close();
    }

    toggleQuickAdd(): void {
        const nextOpen = !this.quickAddOpen();
        this.quickAddOpen.set(nextOpen);
        if (!nextOpen) {
            this.showChassisSuggestions.set(false);
        }
    }

    onTagFilterChange(event: Event): void {
        const value = (event.target as HTMLSelectElement).value;
        if (this.suppressEmptyHeaderTagChange && !value) {
            return;
        }

        this.tagFilter.set(value);
        this.clearMissingSelections();
    }

    onUnitTextFilterInput(event: Event): void {
        this.unitTextFilter.set((event.target as HTMLInputElement).value);
        this.clearMissingSelections();
    }

    async shareSelectedTagLink(): Promise<void> {
        const tag = this.selectedHeaderTag();
        if (!tag) {
            return;
        }

        const publicId = this.userStateService.publicId();
        if (!publicId) {
            this.toastService.showToast('You need to be registered to share tags', 'error');
            return;
        }

        const shareUrl = this.buildTagShareUrl(publicId, tag);
        const shareTitle = `MekBay tag: ${tag}`;

        const result = await shareUrlWithClipboardFallback({ title: shareTitle, url: shareUrl });
        if (result === 'copied') {
            this.toastService.showToast('Tag link copied to clipboard.', 'success');
        }
    }

    async renameSelectedTag(): Promise<void> {
        const oldTag = this.selectedHeaderTag();
        if (!oldTag) {
            return;
        }

        this.suppressEmptyHeaderTagChange = true;
        try {
            const renamedTag = await this.taggingService.renameTag(oldTag);
            if (!renamedTag) {
                return;
            }

            this.replaceSelectedTagReferences(oldTag, renamedTag);
            this.statusMessage.set(`Renamed "${oldTag}" to "${renamedTag}".`);
        } finally {
            setTimeout(() => {
                this.suppressEmptyHeaderTagChange = false;
            }, 0);
        }
    }

    async onMassTagChange(event: Event): Promise<void> {
        const select = event.target as HTMLSelectElement;
        if (select.value !== this.addNewTagOptionValue) {
            this.massTag.set(select.value);
            return;
        }

        const previousTag = this.massTag();
        select.value = this.resolveSelectedTagValue(previousTag);
        const newTag = await this.promptForNewTag();
        if (!newTag) {
            this.massTag.set(previousTag);
            return;
        }

        this.massTag.set(newTag);
        select.value = newTag;
    }

    onMassQuantityInput(event: Event): void {
        if (this.isEmptyQuantityInput(event)) {
            return;
        }

        this.massQuantity.set(this.parseQuantity(event));
    }

    onMassQuantityBlur(event: Event): void {
        this.massQuantity.set(this.parseQuantity(event));
    }

    onAddChassisInput(event: Event): void {
        this.addChassisText.set((event.target as HTMLInputElement).value);
        this.showChassisSuggestions.set(true);
    }

    onAddChassisFocus(): void {
        this.showChassisSuggestions.set(true);
    }

    onAddChassisBlur(event: FocusEvent): void {
        if (this.interactingWithChassisSuggestions || this.isInChassisSuggestionArea(event.relatedTarget)) {
            return;
        }

        this.showChassisSuggestions.set(false);
    }

    onChassisSuggestionsPointerDown(): void {
        this.interactingWithChassisSuggestions = true;
    }

    @HostListener('document:pointerdown', ['$event'])
    onDocumentPointerDown(event: PointerEvent): void {
        if (!this.showChassisSuggestions() || this.isInChassisSuggestionArea(event.target)) {
            return;
        }

        this.showChassisSuggestions.set(false);
    }

    @HostListener('document:pointerup')
    @HostListener('document:pointercancel')
    onDocumentPointerEnd(): void {
        this.interactingWithChassisSuggestions = false;
    }

    async onAddTagChange(event: Event): Promise<void> {
        const select = event.target as HTMLSelectElement;
        if (select.value !== this.addNewTagOptionValue) {
            this.addTag.set(select.value);
            return;
        }

        const previousTag = this.addTag();
        select.value = this.resolveSelectedTagValue(previousTag);
        const newTag = await this.promptForNewTag();
        if (!newTag) {
            this.addTag.set(previousTag);
            return;
        }

        this.addTag.set(newTag);
        select.value = newTag;
    }

    onAddQuantityInput(event: Event): void {
        if (this.isEmptyQuantityInput(event)) {
            return;
        }

        this.addQuantity.set(this.parseQuantity(event));
    }

    onAddQuantityBlur(event: Event): void {
        this.addQuantity.set(this.parseQuantity(event));
    }

    onRowQuantityInput(row: CollectionRow, tag: CollectionTagEntry, event: Event): void {
        if (tag.pendingRemoval) {
            return;
        }

        const quantity = this.parseQuantity(event);
        void this.tagsService.setTagQuantity([row.unit], tag.tag, row.rowType, quantity);
    }

    async removeTag(row: CollectionRow, tag: CollectionTagEntry): Promise<void> {
        if (tag.pendingRemoval) {
            return;
        }

        const pendingTag = this.createPendingRemovedTag(row, tag);
        this.addPendingRemovedTags([pendingTag]);

        try {
            await this.tagsService.modifyTag([row.unit], tag.tag, row.rowType, 'remove');
            this.statusMessage.set(`Marked ${tag.tag} for removal from ${row.title}.`);
        } catch {
            this.clearPendingRemovedTags([pendingTag.key]);
            this.statusMessage.set(`Could not remove ${tag.tag} from ${row.title}.`);
        }
    }

    async restoreTag(row: CollectionRow, tag: CollectionTagEntry): Promise<void> {
        const pendingTag = this.pendingRemovedTags()[tag.removalKey];
        const quantity = pendingTag?.quantity ?? tag.quantity;
        const unitsToTag = row.rowType === 'chassis' ? this.getChassisTagTargetUnits([row.unit]) : [row.unit];

        try {
            await this.tagsService.modifyTag(unitsToTag, tag.tag, row.rowType, 'add', quantity);
            this.clearPendingRemovedTags([tag.removalKey]);
            this.statusMessage.set(`Restored "${tag.tag}" to "${row.title}".`);
        } catch {
            this.statusMessage.set(`Could not restore "${tag.tag}" to "${row.title}".`);
        }
    }

    selectSuggestion(option: ChassisOption): void {
        this.addChassisText.set(option.inputLabel);
        this.showChassisSuggestions.set(false);
    }

    isSelectedAddChassisOption(option: ChassisOption): boolean {
        return this.selectedAddChassisOption()?.key === option.key;
    }

    toggleRow(row: CollectionRow, event: Event): void {
        const checked = (event.target as HTMLInputElement).checked;
        this.selectedRows.update(current => {
            const next = new Set(current);
            if (checked) {
                next.add(row.key);
            } else {
                next.delete(row.key);
            }
            return next;
        });
    }

    toggleAllFiltered(event: Event): void {
        const checked = (event.target as HTMLInputElement).checked;
        const rows = this.filteredRows();
        this.selectedRows.update(current => {
            const next = new Set(current);
            for (const row of rows) {
                if (checked) {
                    next.add(row.key);
                } else {
                    next.delete(row.key);
                }
            }
            return next;
        });
    }

    isRowSelected(row: CollectionRow): boolean {
        return this.selectedRows().has(row.key);
    }

    showUnitDetails(row: CollectionRow): void {
        const unitList = row.rowType === 'chassis'
            ? this.getChassisUnitList(row.unit)
            : [row.unit];

        this.dialogsService.createDialog(UnitDetailsDialogComponent, {
            data: {
                unitList,
                unitIndex: 0
            } satisfies UnitDetailsDialogData
        });
    }

    async addTagToSelected(): Promise<void> {
        const tag = this.massTag().trim();
        if (!this.validateLocalTag(tag)) {
            return;
        }

        const selectedRows = this.getSelectedVisibleRows();
        const quantity = this.massQuantity();
        for (const [rowType, units] of this.groupRowsByType(selectedRows)) {
            const unitsToTag = rowType === 'chassis' ? this.getChassisTagTargetUnits(units) : units;
            await this.tagsService.modifyTag(unitsToTag, tag, rowType, 'add', quantity);
        }

        this.clearPendingRemovalsForRows(selectedRows, tag);

        this.statusMessage.set(`Added "${tag}" to ${selectedRows.length} selected entries.`);
    }

    async removeTagFromSelected(): Promise<void> {
        const tag = this.massTag().trim();
        if (!tag) {
            return;
        }

        const selectedRows = this.getSelectedVisibleRows();
        const pendingTags = this.createPendingRemovedTagsForRows(selectedRows, tag);
        if (pendingTags.length === 0) {
            this.statusMessage.set(`No selected entries have "${tag}".`);
            return;
        }

        this.addPendingRemovedTags(pendingTags);

        try {
            for (const [rowType, units] of this.groupRowsByType(selectedRows)) {
                await this.tagsService.modifyTag(units, tag, rowType, 'remove');
            }

            this.statusMessage.set(`Marked "${tag}" for removal from ${pendingTags.length} selected entries.`);
        } catch {
            this.clearPendingRemovedTags(pendingTags.map(pendingTag => pendingTag.key));
            this.statusMessage.set(`Could not remove "${tag}" from the selected entries.`);
        }
    }

    async addChassisTag(): Promise<void> {
        const option = this.selectedAddChassisOption();
        const tag = this.addTag().trim();
        const quantityConflict = this.quickAddQuantityConflict();
        if (!option || !this.validateLocalTag(tag)) {
            return;
        }

        if (quantityConflict) {
            const confirmed = await this.dialogsService.requestConfirmation(
                `${quantityConflict.chassis} already has "${quantityConflict.tag}" with quantity ${quantityConflict.currentQuantity}. Adding it again will change quantity to ${quantityConflict.nextQuantity}.`,
                'Update Tag Quantity',
                'info'
            );
            if (!confirmed) {
                this.statusMessage.set(`No changes made to "${quantityConflict.tag}" on ${option.inputLabel}.`);
                return;
            }
        }

        await this.tagsService.modifyTag(this.getChassisTagTargetUnits([option.unit]), tag, 'chassis', 'add', this.addQuantity());
        this.clearPendingRemovedTags([this.getRemovalKey(this.getRowKey('chassis', option.unit), tag)]);
        if (quantityConflict) {
            this.statusMessage.set(`Updated "${quantityConflict.tag}" on ${option.inputLabel} from ${quantityConflict.currentQuantity} to ${quantityConflict.nextQuantity}.`);
        } else {
            this.statusMessage.set(`Added "${tag}" to ${option.inputLabel}.`);
        }
        this.addChassisText.set('');
    }

    private getSelectedVisibleRows(): CollectionRow[] {
        const selected = this.selectedRows();
        return this.filteredRows().filter(row => selected.has(row.key));
    }

    private groupRowsByType(rows: CollectionRow[]): Map<CollectionRowType, Unit[]> {
        const grouped = new Map<CollectionRowType, Unit[]>();
        for (const row of rows) {
            const units = grouped.get(row.rowType) ?? [];
            units.push(row.unit);
            grouped.set(row.rowType, units);
        }
        return grouped;
    }

    private clearMissingSelections(): void {
        const visibleKeys = new Set(this.filteredRows().map(row => row.key));
        this.selectedRows.update(current => {
            const next = new Set<string>();
            for (const key of current) {
                if (visibleKeys.has(key)) {
                    next.add(key);
                }
            }
            return next;
        });
    }

    private toCollectionTags(
        tags: UnitTagEntry[],
        rowKey: string,
        pendingRemovedTags: Record<string, PendingRemovedTag>
    ): CollectionTagEntry[] {
        return tags
            .map(tag => {
                const removalKey = this.getRemovalKey(rowKey, tag.tag);
                return {
                    ...tag,
                    lowerTag: tag.tag.toLowerCase(),
                    removalKey,
                    pendingRemoval: !!pendingRemovedTags[removalKey]
                };
            })
            .sort((left, right) => left.tag.toLowerCase().localeCompare(right.tag.toLowerCase()));
    }

    private createPendingRemovedTag(row: CollectionRow, tag: CollectionTagEntry): PendingRemovedTag {
        return {
            key: tag.removalKey,
            rowKey: row.key,
            rowType: row.rowType,
            unit: row.unit,
            title: row.title,
            subtitle: row.subtitle,
            tag: tag.tag,
            lowerTag: tag.lowerTag,
            quantity: tag.quantity
        };
    }

    private createPendingRemovedTagsForRows(rows: CollectionRow[], tag: string): PendingRemovedTag[] {
        const lowerTag = tag.trim().toLowerCase();
        const pendingTags: PendingRemovedTag[] = [];

        for (const row of rows) {
            const rowTag = row.tags.find(entry => entry.lowerTag === lowerTag && !entry.pendingRemoval);
            if (rowTag) {
                pendingTags.push(this.createPendingRemovedTag(row, rowTag));
            }
        }

        return pendingTags;
    }

    private addPendingRemovedTags(tags: PendingRemovedTag[]): void {
        if (tags.length === 0) {
            return;
        }

        this.pendingRemovedTags.update(current => {
            const next = { ...current };
            for (const tag of tags) {
                next[tag.key] = tag;
            }
            return next;
        });
    }

    private clearPendingRemovalsForRows(rows: CollectionRow[], tag: string): void {
        const keys = rows.map(row => this.getRemovalKey(row.key, tag));
        this.clearPendingRemovedTags(keys);
    }

    private clearPendingRemovedTags(keys: string[]): void {
        if (keys.length === 0) {
            return;
        }

        this.pendingRemovedTags.update(current => {
            const next = { ...current };
            for (const key of keys) {
                delete next[key];
            }
            return next;
        });
    }

    private getRowKey(rowType: CollectionRowType, unit: Unit): string {
        if (rowType === 'chassis') {
            return `chassis:${TagsService.getChassisTagKey(unit)}`;
        }

        return `name:${unit.name}`;
    }

    private getRemovalKey(rowKey: string, tag: string): string {
        return `${rowKey}::${tag.trim().toLowerCase()}`;
    }

    private getRowSearchText(row: CollectionRow): string {
        if (row.rowType === 'chassis') {
            return row.unit.chassis ?? row.title;
        }

        return row.unit._searchKey || `${row.unit.chassis ?? ''} ${row.unit.model ?? ''}`;
    }

    private getChassisUnitList(unit: Unit): Unit[] {
        const chassisKey = TagsService.getChassisTagKey(unit);
        return this.dataService.getUnits()
            .filter(candidate => TagsService.getChassisTagKey(candidate) === chassisKey)
            .sort((left, right) => (left.year ?? 0) - (right.year ?? 0) || compareUnitsByName(left, right));
    }

    private getChassisTagTargetUnits(units: Unit[]): Unit[] {
        const unitsByName = new Map<string, Unit>();

        for (const unit of units) {
            for (const chassisUnit of this.getChassisUnitList(unit)) {
                unitsByName.set(chassisUnit.name, chassisUnit);
            }
            unitsByName.set(unit.name, unit);
        }

        return Array.from(unitsByName.values());
    }

    private getUnitDisplayName(unit: Unit): string {
        return unit.model ? `${unit.chassis} ${unit.model}` : unit.chassis;
    }

    private async promptForNewTag(): Promise<string | null> {
        const newTag = await this.dialogsService.prompt(
            'Enter the new tag name:',
            'Add New Tag',
            '',
            `Maximum ${TAG_MAX_LENGTH} characters.`
        );

        const trimmedTag = newTag?.trim() ?? '';
        if (!trimmedTag) {
            return null;
        }

        const validationError = validateTagName(trimmedTag);
        if (validationError) {
            await this.dialogsService.showError(validationError, 'Invalid Tag');
            return null;
        }

        const selectedTag = this.allTags().find(tag => tag.toLowerCase() === trimmedTag.toLowerCase()) ?? trimmedTag;
        this.createdTagOptions.update(tags => this.addUniqueTag(tags, selectedTag));
        return selectedTag;
    }

    private resolveSelectedTagValue(tag: string): string {
        if (!tag) {
            return '';
        }

        return this.tagOptions().find(option => option.toLowerCase() === tag.toLowerCase()) ?? tag;
    }

    private buildTagShareUrl(publicId: string, tag: string): string {
        const queryParameters = buildPublicTagSearchQueryParameters({
            publicId,
            tagName: tag,
            gameSystem: this.gameService.currentGameSystem(),
        });

        const tree = this.router.createUrlTree([], {
            relativeTo: this.route,
            queryParams: queryParameters,
        });
        return (window.location.origin || '') + this.router.serializeUrl(tree);
    }

    private replaceSelectedTagReferences(oldTag: string, newTag: string): void {
        this.tagFilter.set(newTag);
        this.massTag.update(tag => this.replaceMatchingTag(tag, oldTag, newTag));
        this.addTag.update(tag => this.replaceMatchingTag(tag, oldTag, newTag));
        this.createdTagOptions.update(tags => this.addUniqueTag(
            tags.filter(tag => tag.toLowerCase() !== oldTag.toLowerCase()),
            newTag
        ));
    }

    private replaceMatchingTag(tag: string, oldTag: string, newTag: string): string {
        return tag.trim().toLowerCase() === oldTag.toLowerCase() ? newTag : tag;
    }

    private addUniqueTag(tags: string[], tag: string): string[] {
        if (tags.some(existingTag => existingTag.toLowerCase() === tag.toLowerCase())) {
            return tags;
        }

        return [tag, ...tags];
    }

    private isInChassisSuggestionArea(target: EventTarget | null): boolean {
        if (!(target instanceof Node)) {
            return false;
        }

        const element = target instanceof Element ? target : target.parentElement;
        if (!element || !this.hostElement.nativeElement.contains(element)) {
            return false;
        }

        return !!element.closest('.chassis-field, .chassis-suggestions');
    }

    private findChassisTag(unit: Unit, tag: string): UnitTagEntry | null {
        const lowerTag = tag.trim().toLowerCase();
        return (unit._chassisTags ?? []).find(entry => entry.tag.trim().toLowerCase() === lowerTag) ?? null;
    }

    private parseQuantity(event: Event): number {
        const input = event.target as HTMLInputElement;
        const parsed = Number.parseInt(input.value, 10);
        const quantity = Number.isFinite(parsed) ? Math.max(1, parsed) : 1;
        if (input.value !== String(quantity)) {
            input.value = String(quantity);
        }
        return quantity;
    }

    private isEmptyQuantityInput(event: Event): boolean {
        return (event.target as HTMLInputElement).value.trim().length === 0;
    }

    private validateLocalTag(tag: string): boolean {
        const validationError = validateTagName(tag);
        if (validationError) {
            this.statusMessage.set(validationError);
            return false;
        }

        if (tag.length > TAG_MAX_LENGTH) {
            this.statusMessage.set(`Tag is too long. Maximum length is ${TAG_MAX_LENGTH} characters.`);
            return false;
        }

        return true;
    }
}
