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

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import type { Unit, UnitTagEntry } from '../../models/units.model';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { GameService } from '../../services/game.service';
import { TagsService } from '../../services/tags.service';
import { TAG_MAX_LENGTH, TaggingService, validateTagName } from '../../services/tagging.service';
import { ToastService } from '../../services/toast.service';
import { UserStateService } from '../../services/userState.service';
import { UnitDetailsDialogComponent, type UnitDetailsDialogData } from '../unit-details-dialog/unit-details-dialog.component';
import { getChassisTagTargetUnits } from '../../utils/chassis-tag-target.util';
import { matchesSearch, parseSearchQuery } from '../../utils/search.util';
import { compareUnitsByName, naturalCompare } from '../../utils/sort.util';
import { shareUrlWithClipboardFallback } from '../../utils/clipboard.util';
import { buildShareUrl } from '../../utils/share-url.util';
import { buildPublicTagSearchQueryParameters } from '../../utils/unit-search-public-tags-url.util';
import { getUnitVariantGroupIdentity } from '../../utils/unit-variant.util';

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

interface ModelOption {
    label: string;
    key: string;
    unit: Unit;
}

interface QuickAddTarget {
    rowType: CollectionRowType;
    unit: Unit;
    label: string;
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
    targetLabel: string;
    tag: string;
    currentQuantity: number;
    nextQuantity: number;
}

@Component({
    selector: 'collection-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'fullscreen-dialog-host nopadding fullheight tv-fade'
    },
    templateUrl: './collection-dialog.component.html',
    styleUrl: './collection-dialog.component.scss'
})
export class CollectionDialogComponent {
    private readonly dialogRef = inject(DialogRef<void>);
    private readonly dataService = inject(DataService);
    private readonly dialogsService = inject(DialogsService);
    private readonly gameService = inject(GameService);
    private readonly tagsService = inject(TagsService);
    private readonly taggingService = inject(TaggingService);
    private readonly toastService = inject(ToastService);
    private readonly userStateService = inject(UserStateService);
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
    readonly selectedAddChassisKey = signal('');
    readonly selectedAddModelNames = signal<Set<string>>(new Set<string>());
    readonly selectedQuickAddTargetType = signal<CollectionRowType | null>(null);
    readonly statusMessage = signal('');
    readonly pendingRemovedTags = signal<Record<string, PendingRemovedTag>>({});

    readonly allRows = computed(() => {
        this.tagsService.version();
        this.dataService.tagsVersion();
        const pendingRemovedTags = this.pendingRemovedTags();

        const rows = new Map<string, CollectionRow>();

        for (const unit of this.dataService.getUnits()) {
            if (unit._chassisTags?.length) {
                const rowKey = this.getRowKey('chassis', unit);
                if (!rows.has(rowKey)) {
                    rows.set(rowKey, {
                        key: rowKey,
                        rowType: 'chassis',
                        unit,
                        title: this.getVariantGroupChassis(unit),
                        subtitle: unit.as.TP,
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
                    subtitle: unit.as.TP,
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
            row.tags.sort((left, right) => naturalCompare(left.tag, right.tag));
        }

        return Array.from(rows.values())
            .sort((left, right) => naturalCompare(left.title, right.title) || naturalCompare(left.rowType, right.rowType));
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

        return Array.from(tags.values()).sort(naturalCompare);
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
                const chassis = this.getVariantGroupChassis(unit);
                options.set(key, {
                    label: chassis,
                    inputLabel: chassis,
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
                option.inputLabel = this.getVariantGroupInputLabel(option.unit);
            }
        }

        return Array.from(options.values())
            .sort((left, right) => naturalCompare(left.label, right.label)
                || naturalCompare(left.unit.as.TP, right.unit.as.TP)
                || Number(!!left.unit.omni) - Number(!!right.unit.omni));
    });

    readonly chassisSuggestions = computed(() => {
        const text = this.addChassisText().trim().toLowerCase();
        const selectedKey = this.selectedAddChassisKey();
        if (!text) {
            return this.chassisOptions().slice(0, 10);
        }

        const suggestions = this.chassisOptions()
            .filter(option => option.inputLabel.toLowerCase().includes(text))
            .slice(0, 10);

        if (selectedKey && !suggestions.some(option => option.key === selectedKey)) {
            const selectedOption = this.chassisOptions().find(option => option.key === selectedKey);
            if (selectedOption) {
                suggestions.unshift(selectedOption);
            }
        }

        return suggestions.slice(0, 10);
    });

    readonly selectedAddChassisOption = computed(() => {
        const selectedKey = this.selectedAddChassisKey();
        if (selectedKey) {
            const option = this.chassisOptions().find(candidate => candidate.key === selectedKey);
            if (option) {
                return option;
            }
        }

        const text = this.addChassisText().trim().toLowerCase();
        if (!text) {
            return null;
        }

        return this.chassisOptions().find(option => option.inputLabel.toLowerCase() === text) ?? null;
    });

    readonly quickAddModelOptions = computed((): ModelOption[] => {
        const option = this.selectedAddChassisOption();
        if (option) {
            return this.dataService.getUnits()
                .filter(unit => TagsService.getChassisTagKey(unit) === option.key)
                .sort(compareUnitsByName)
                .map(unit => this.toModelOption(unit, false));
        }

        if (!this.quickAddModelSearchActive()) {
            return [];
        }

        const searchTokens = parseSearchQuery(this.addChassisText().trim());
        return this.dataService.getUnits()
            .filter(unit => matchesSearch(this.getQuickAddModelSearchText(unit), searchTokens, true))
            .sort(compareUnitsByName)
            .slice(0, 30)
            .map(unit => this.toModelOption(unit, true));
    });

    readonly quickAddModelSearchActive = computed(() => {
        return this.addChassisText().trim().length > 0
            && !this.selectedAddChassisOption()
            && this.chassisSuggestions().length === 0;
    });

    readonly quickAddTargets = computed((): QuickAddTarget[] => {
        if (this.selectedQuickAddTargetType() === 'name') {
            const selectedNames = this.selectedAddModelNames();
            if (selectedNames.size === 0) {
                return [];
            }

            return this.dataService.getUnits()
                .filter(unit => selectedNames.has(unit.name))
                .sort(compareUnitsByName)
                .map(unit => ({
                    rowType: 'name',
                    unit,
                    label: this.getQuickAddUnitDisplayName(unit)
                }));
        }

        const option = this.selectedAddChassisOption();
        if (!option) {
            return [];
        }

        return [{
            rowType: 'chassis',
            unit: option.unit,
            label: option.inputLabel
        }];
    });

    readonly quickAddTarget = computed(() => this.quickAddTargets()[0] ?? null);

    readonly quickAddTargetType = computed((): CollectionRowType | null => {
        return this.quickAddTarget()?.rowType ?? null;
    });

    readonly quickAddTargetTypeLabel = computed(() => {
        const targets = this.quickAddTargets();
        if (targets.length === 0) {
            return '';
        }

        if (targets[0].rowType === 'name') {
            return targets.length === 1 ? 'UNIT TAG' : `UNIT TAGS (${targets.length})`;
        }

        return 'CHASSIS TAG';
    });

    readonly quickAddQuantityConflicts = computed((): QuickAddQuantityConflict[] => {
        this.tagsService.version();
        this.dataService.tagsVersion();
        const targets = this.quickAddTargets();
        const tag = this.addTag().trim();
        if (targets.length === 0 || !tag) {
            return [];
        }

        const nextQuantity = this.addQuantity();
        const conflicts: QuickAddQuantityConflict[] = [];
        for (const target of targets) {
            const existingTag = this.findQuickAddTargetTag(target, tag);
            if (!existingTag || existingTag.quantity === nextQuantity) {
                continue;
            }

            conflicts.push({
                targetLabel: target.label,
                tag: existingTag.tag,
                currentQuantity: existingTag.quantity,
                nextQuantity
            });
        }

        return conflicts;
    });

    readonly tagOptions = computed(() => {
        const tags = this.allTags();
        const lowerTags = new Set(tags.map(tag => tag.toLowerCase()));
        const createdTags = this.createdTagOptions()
            .filter(tag => !lowerTags.has(tag.toLowerCase()));

        return [...createdTags, ...tags].sort(naturalCompare);
    });

    readonly titleTagOptions = computed(() => {
        const tags = this.allTags();
        const selectedTag = this.tagFilter().trim();
        if (!selectedTag || tags.some(tag => tag.toLowerCase() === selectedTag.toLowerCase())) {
            return tags;
        }

        return [...tags, selectedTag]
            .sort(naturalCompare);
    });

    readonly selectedMassTagValue = computed(() => this.resolveSelectedTagValue(this.massTag()));

    readonly selectedQuickAddTagValue = computed(() => {
        return this.resolveSelectedTagValue(this.addTag());
    });

    readonly selectedHeaderTag = computed(() => this.tagFilter().trim());

    readonly selectedHeaderTagLower = computed(() => this.selectedHeaderTag().toLowerCase());

    readonly selectedHeaderTagQuantityTotal = computed(() => {
        const lowerTag = this.selectedHeaderTagLower();
        if (!lowerTag) {
            return 0;
        }

        let total = 0;
        for (const row of this.filteredRows()) {
            for (const tag of row.tags) {
                if (tag.lowerTag === lowerTag && !tag.pendingRemoval) {
                    total += tag.quantity;
                }
            }
        }

        return total;
    });

    readonly canUseHeaderTagActions = computed(() => this.selectedHeaderTag().length > 0);

    readonly canAddQuickTag = computed(() => {
        return this.quickAddTargets().length > 0 && this.addTag().trim().length > 0;
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
        this.clearQuickAddTargetSelection();
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
        const unitsToTag = row.rowType === 'chassis'
            ? getChassisTagTargetUnits([row.unit], this.dataService.getUnits())
            : [row.unit];

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
        this.selectedAddChassisKey.set(option.key);
        this.selectedAddModelNames.set(new Set<string>());
        this.selectedQuickAddTargetType.set('chassis');
    }

    selectAllModels(): void {
        const option = this.selectedAddChassisOption();
        if (!option) {
            return;
        }

        this.addChassisText.set(option.inputLabel);
        this.selectedAddChassisKey.set(option.key);
        this.selectedAddModelNames.set(new Set<string>());
        this.selectedQuickAddTargetType.set('chassis');
    }

    toggleModelSuggestion(option: ModelOption, event: Event): void {
        const checked = (event.target as HTMLInputElement).checked;
        let selectedCount = 0;
        this.selectedAddModelNames.update(current => {
            const next = new Set(current);
            if (checked) {
                next.add(option.key);
            } else {
                next.delete(option.key);
            }
            selectedCount = next.size;
            return next;
        });

        this.selectedQuickAddTargetType.set(selectedCount > 0
            ? 'name'
            : (this.selectedAddChassisOption() ? 'chassis' : null));
    }

    isSelectedAddChassisOption(option: ChassisOption): boolean {
        return this.selectedAddChassisOption()?.key === option.key;
    }

    isAllModelsSelected(): boolean {
        return this.selectedQuickAddTargetType() !== 'name' && !!this.selectedAddChassisOption();
    }

    isSelectedAddModelOption(option: ModelOption): boolean {
        return this.selectedQuickAddTargetType() === 'name' && this.selectedAddModelNames().has(option.key);
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
            const unitsToTag = rowType === 'chassis' ? getChassisTagTargetUnits(units, this.dataService.getUnits()) : units;
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

    async addQuickTag(): Promise<void> {
        const targets = this.quickAddTargets();
        const tag = this.addTag().trim();
        const quantityConflicts = this.quickAddQuantityConflicts();
        if (targets.length === 0 || !this.validateLocalTag(tag)) {
            return;
        }

        if (quantityConflicts.length > 0) {
            const confirmed = await this.dialogsService.requestConfirmation(
                this.getQuickAddQuantityConflictMessage(quantityConflicts, tag),
                'Update Tag Quantity',
                'info'
            );
            if (!confirmed) {
                this.statusMessage.set(targets.length === 1
                    ? `No changes made to "${quantityConflicts[0].tag}" on ${targets[0].label}.`
                    : `No changes made to "${tag}" on ${targets.length} selected units.`);
                return;
            }
        }

        const rowType = targets[0].rowType;
        const unitsToTag = rowType === 'chassis'
            ? getChassisTagTargetUnits([targets[0].unit], this.dataService.getUnits())
            : targets.map(target => target.unit);
        await this.tagsService.modifyTag(unitsToTag, tag, rowType, 'add', this.addQuantity());
        this.clearPendingRemovedTags(targets.map(target => this.getRemovalKey(this.getRowKey(target.rowType, target.unit), tag)));
        if (targets.length > 1) {
            this.statusMessage.set(`Applied "${tag}" to ${targets.length} selected units.`);
        } else if (quantityConflicts.length > 0) {
            this.statusMessage.set(`Updated "${quantityConflicts[0].tag}" on ${targets[0].label} from ${quantityConflicts[0].currentQuantity} to ${quantityConflicts[0].nextQuantity}.`);
        } else {
            this.statusMessage.set(`Added "${tag}" to ${targets[0].label}.`);
        }
        this.addChassisText.set('');
        this.clearQuickAddTargetSelection();
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
            .sort((left, right) => naturalCompare(left.tag, right.tag));
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

    private clearQuickAddTargetSelection(): void {
        this.selectedAddChassisKey.set('');
        this.selectedAddModelNames.set(new Set<string>());
        this.selectedQuickAddTargetType.set(null);
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
            return `${row.unit.chassis ?? row.title} ${row.unit.as.TP} ${row.unit.omni ? 'omni' : ''}`;
        }

        return row.unit._searchKey || `${row.unit.chassis ?? ''} ${row.unit.model ?? ''}`;
    }

    private getQuickAddModelSearchText(unit: Unit): string {
        return `${unit.chassis ?? ''} ${unit.model ?? ''} ${unit.name ?? ''}`;
    }

    private getChassisUnitList(unit: Unit): Unit[] {
        const chassisKey = TagsService.getChassisTagKey(unit);
        return this.dataService.getUnits()
            .filter(candidate => TagsService.getChassisTagKey(candidate) === chassisKey)
            .sort((left, right) => (left.year ?? 0) - (right.year ?? 0) || compareUnitsByName(left, right));
    }

    private getUnitDisplayName(unit: Unit): string {
        return unit.model ? `${unit.chassis} ${unit.model}` : unit.chassis;
    }

    private getQuickAddUnitDisplayName(unit: Unit): string {
        return unit.model ? this.getUnitDisplayName(unit) : `${unit.chassis} (Standard)`;
    }

    private getVariantGroupChassis(unit: Unit): string {
        return getUnitVariantGroupIdentity(unit).chassis;
    }

    private getVariantGroupInputLabel(unit: Unit): string {
        return `${this.getVariantGroupChassis(unit)} [${unit.as.TP}${unit.omni ? ' omni' : ''}]`;
    }

    private toModelOption(unit: Unit, includeChassis: boolean): ModelOption {
        return {
            label: includeChassis ? this.getQuickAddUnitDisplayName(unit) : (unit.model || '(Standard)'),
            key: unit.name,
            unit
        };
    }

    private getQuickAddQuantityConflictMessage(conflicts: QuickAddQuantityConflict[], tag: string): string {
        if (conflicts.length === 1) {
            const conflict = conflicts[0];
            return `${conflict.targetLabel} already has "${conflict.tag}" with quantity ${conflict.currentQuantity}. Adding it again will change quantity to ${conflict.nextQuantity}.`;
        }

        return `${conflicts.length} selected units already have "${tag}" with a different quantity. Adding it again will update them to quantity ${this.addQuantity()}.`;
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

        return buildShareUrl(window.location.origin || '', queryParameters);
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

    private findChassisTag(unit: Unit, tag: string): UnitTagEntry | null {
        const lowerTag = tag.trim().toLowerCase();
        return (unit._chassisTags ?? []).find(entry => entry.tag.trim().toLowerCase() === lowerTag) ?? null;
    }

    private findNameTag(unit: Unit, tag: string): UnitTagEntry | null {
        const lowerTag = tag.trim().toLowerCase();
        return (unit._nameTags ?? []).find(entry => entry.tag.trim().toLowerCase() === lowerTag) ?? null;
    }

    private findQuickAddTargetTag(target: QuickAddTarget, tag: string): UnitTagEntry | null {
        return target.rowType === 'chassis'
            ? this.findChassisTag(target.unit, tag)
            : this.findNameTag(target.unit, tag);
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
