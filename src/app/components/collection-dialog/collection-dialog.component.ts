import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, signal } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import type { Unit, UnitTagEntry } from '../../models/units.model';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { TagsService } from '../../services/tags.service';
import { TAG_MAX_LENGTH, validateTagName } from '../../services/tagging.service';
import { UnitDetailsDialogComponent, type UnitDetailsDialogData } from '../unit-details-dialog/unit-details-dialog.component';
import { matchesSearch, parseSearchQuery } from '../../utils/search.util';
import { compareUnitsByName } from '../../utils/sort.util';

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
        class: 'fullscreen-dialog-host fullheight glass'
    },
    templateUrl: './collection-dialog.component.html',
    styleUrl: './collection-dialog.component.scss'
})
export class CollectionDialogComponent {
    private readonly hostElement = inject(ElementRef<HTMLElement>);
    private readonly dialogRef = inject(DialogRef<void>);
    private readonly dataService = inject(DataService);
    private readonly dialogsService = inject(DialogsService);
    private readonly tagsService = inject(TagsService);
    private interactingWithChassisSuggestions = false;
    private readonly quickAddCreatedTags = signal<string[]>([]);

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

    readonly quickAddTagOptions = computed(() => {
        const tags = this.allTags();
        const lowerTags = new Set(tags.map(tag => tag.toLowerCase()));
        const createdTags = this.quickAddCreatedTags()
            .filter(tag => !lowerTags.has(tag.toLowerCase()));

        return [...createdTags, ...tags];
    });

    readonly selectedQuickAddTagValue = computed(() => {
        const selectedTag = this.addTag();
        if (!selectedTag) {
            return '';
        }

        return this.quickAddTagOptions().find(tag => tag.toLowerCase() === selectedTag.toLowerCase()) ?? selectedTag;
    });

    readonly canAddChassis = computed(() => {
        return !!this.selectedAddChassisOption() && this.addTag().trim().length > 0;
    });

    readonly canApplyMassChange = computed(() => this.selectedCount() > 0 && this.massTag().trim().length > 0);

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
        this.tagFilter.set((event.target as HTMLSelectElement).value);
        this.clearMissingSelections();
    }

    onUnitTextFilterInput(event: Event): void {
        this.unitTextFilter.set((event.target as HTMLInputElement).value);
        this.clearMissingSelections();
    }

    onMassTagChange(event: Event): void {
        this.massTag.set((event.target as HTMLSelectElement).value);
    }

    onMassQuantityInput(event: Event): void {
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
        select.value = previousTag;
        const newTag = await this.dialogsService.prompt(
            'Enter the new tag name:',
            'Add New Tag',
            '',
            `Maximum ${TAG_MAX_LENGTH} characters.`
        );

        const trimmedTag = newTag?.trim() ?? '';
        if (!trimmedTag) {
            this.addTag.set(previousTag);
            return;
        }

        const validationError = validateTagName(trimmedTag);
        if (validationError) {
            this.addTag.set(previousTag);
            await this.dialogsService.showError(validationError, 'Invalid Tag');
            return;
        }

        const selectedTag = this.allTags().find(tag => tag.toLowerCase() === trimmedTag.toLowerCase()) ?? trimmedTag;
        this.quickAddCreatedTags.update(tags => this.addUniqueTag(tags, selectedTag));
        this.addTag.set(selectedTag);
        select.value = selectedTag;
    }

    onAddQuantityInput(event: Event): void {
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

        try {
            await this.tagsService.modifyTag([row.unit], tag.tag, row.rowType, 'add', quantity);
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
            await this.tagsService.modifyTag(units, tag, rowType, 'add', quantity);
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

        await this.tagsService.modifyTag([option.unit], tag, 'chassis', 'add', this.addQuantity());
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

    private getUnitDisplayName(unit: Unit): string {
        return unit.model ? `${unit.chassis} ${unit.model}` : unit.chassis;
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
