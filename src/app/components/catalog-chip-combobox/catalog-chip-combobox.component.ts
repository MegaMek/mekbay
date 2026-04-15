import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface CatalogChipComboboxOption {
    readonly value: string;
    readonly label: string;
    readonly badge?: string;
    readonly description?: string;
    readonly searchTerms?: readonly string[];
}

function normalizeInputValue(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
}

function normalizeSearchValue(value: string): string {
    return normalizeInputValue(value).toLowerCase();
}

function scoreSuggestion(option: CatalogChipComboboxOption, normalizedQuery: string): number {
    if (!normalizedQuery) {
        return 10;
    }

    const candidates = [
        option.value,
        option.label,
        option.badge ?? '',
        option.description ?? '',
        ...(option.searchTerms ?? []),
    ]
        .map(normalizeSearchValue)
        .filter(Boolean);

    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
        if (candidate === normalizedQuery) {
            bestScore = Math.min(bestScore, 0);
            continue;
        }

        if (candidate.startsWith(normalizedQuery)) {
            bestScore = Math.min(bestScore, 1);
            continue;
        }

        if (candidate.split(' ').some((word) => word.startsWith(normalizedQuery))) {
            bestScore = Math.min(bestScore, 2);
            continue;
        }

        if (candidate.includes(normalizedQuery)) {
            bestScore = Math.min(bestScore, 3);
        }
    }

    return bestScore;
}

function dedupeValues(values: readonly string[], normalizeValue: (value: string) => string): string[] {
    const result: string[] = [];
    const seen = new Set<string>();

    for (const value of values) {
        const normalizedValue = normalizeValue(normalizeInputValue(value));
        const dedupeKey = normalizeSearchValue(normalizedValue);
        if (!dedupeKey || seen.has(dedupeKey)) {
            continue;
        }

        seen.add(dedupeKey);
        result.push(normalizedValue);
    }

    return result;
}

@Component({
    selector: 'catalog-chip-combobox',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './catalog-chip-combobox.component.html',
    styleUrls: ['./catalog-chip-combobox.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogChipComboboxComponent {
    @Input({ required: true }) label = '';
    @Input({ required: true }) values: readonly string[] = [];
    @Input({ required: true }) options: readonly CatalogChipComboboxOption[] = [];
    @Input() placeholder = 'Search or add values';
    @Input() placeholderWhenPopulated = 'Add another value';
    @Input() emptySelectionText = 'Any value';
    @Input() allSelectedText = 'All available values are already selected.';
    @Input() filterHintText = 'Type to filter the live catalog values.';
    @Input() entryHintText = 'Enter selects the highlighted match. Comma adds the typed value.';
    @Input() optionActionText = 'Add';
    @Input() allowCustomValues = true;
    @Input() maxVisibleSuggestions = 8;
    @Input() normalizeValue: (value: string) => string = normalizeInputValue;

    @Output() readonly valuesChange = new EventEmitter<string[]>();

    @ViewChild('inputEl') inputElement?: ElementRef<HTMLInputElement>;

    query = '';
    isOpen = false;
    activeSuggestionIndex = -1;

    onInput(value: string): void {
        this.query = value;
        this.open();
    }

    onFocus(): void {
        this.open();
    }

    onFocusOut(event: FocusEvent): void {
        const currentTarget = event.currentTarget;
        const relatedTarget = event.relatedTarget;
        if (!(currentTarget instanceof HTMLElement)) {
            this.close();
            return;
        }

        if (relatedTarget instanceof Node && currentTarget.contains(relatedTarget)) {
            return;
        }

        this.close();
    }

    onShellMouseDown(event: MouseEvent): void {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        if (target.closest('button') || target.tagName === 'INPUT') {
            return;
        }

        event.preventDefault();
        this.focusInput();
    }

    onKeydown(event: KeyboardEvent): void {
        const suggestions = this.filteredSuggestions();

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                if (!this.isOpen) {
                    this.open();
                    return;
                }

                if (suggestions.length > 0) {
                    const nextIndex = this.activeSuggestionIndex < 0
                        ? 0
                        : (this.activeSuggestionIndex + 1) % suggestions.length;
                    this.activeSuggestionIndex = nextIndex;
                }
                return;
            case 'ArrowUp':
                event.preventDefault();
                if (!this.isOpen) {
                    this.open();
                    return;
                }

                if (suggestions.length > 0) {
                    const currentIndex = this.activeSuggestionIndex < 0 ? 0 : this.activeSuggestionIndex;
                    const nextIndex = (currentIndex - 1 + suggestions.length) % suggestions.length;
                    this.activeSuggestionIndex = nextIndex;
                }
                return;
            case 'Enter':
                if (!this.query.trim() && !this.isOpen) {
                    return;
                }

                event.preventDefault();
                if (this.isOpen && suggestions.length > 0 && this.activeSuggestionIndex >= 0) {
                    this.selectSuggestion(suggestions[this.activeSuggestionIndex].value);
                    return;
                }

                this.commitQuery();
                return;
            case ',':
                if (!this.query.trim()) {
                    return;
                }

                event.preventDefault();
                this.commitQuery();
                return;
            case 'Escape':
                if (!this.isOpen) {
                    return;
                }

                event.preventDefault();
                this.close();
                return;
            case 'Backspace':
                if (this.query.trim()) {
                    return;
                }

                this.removeLastValue();
                return;
        }
    }

    toggleOpen(): void {
        if (this.isOpen) {
            this.close();
            return;
        }

        this.focusInput();
    }

    selectSuggestion(value: string): void {
        this.commitValue(value);
        this.focusInput();
    }

    removeValue(value: string): void {
        const normalizedTarget = normalizeSearchValue(value);
        const nextValues = this.values.filter((entry) => normalizeSearchValue(entry) !== normalizedTarget);
        this.valuesChange.emit([...nextValues]);
    }

    setActiveSuggestion(index: number): void {
        this.activeSuggestionIndex = index;
    }

    isActiveSuggestion(index: number): boolean {
        return this.activeSuggestionIndex === index;
    }

    getListboxId(): string {
        return `${this.label.replace(/\s+/g, '-').toLowerCase()}-catalog-chip-combobox-listbox`;
    }

    getOptionId(index: number): string {
        return `${this.getListboxId()}-option-${index}`;
    }

    getActiveDescendantId(): string | null {
        if (!this.isOpen) {
            return null;
        }

        const activeIndex = this.activeSuggestionIndex;
        const suggestions = this.filteredSuggestions();
        if (activeIndex < 0 || activeIndex >= suggestions.length) {
            return null;
        }

        return this.getOptionId(activeIndex);
    }

    getHintText(): string {
        return this.query.trim().length > 0 ? this.entryHintText : this.filterHintText;
    }

    getChipLabel(value: string): string {
        return this.getOptionMap().get(normalizeSearchValue(value))?.label ?? value;
    }

    getChipBadge(value: string): string | null {
        return this.getOptionMap().get(normalizeSearchValue(value))?.badge ?? null;
    }

    previewQuery(): string {
        return normalizeInputValue(this.query);
    }

    filteredSuggestions(): CatalogChipComboboxOption[] {
        const normalizedQuery = normalizeSearchValue(this.query);
        const selected = new Set(this.values.map((value) => normalizeSearchValue(value)));

        return this.options
            .filter((option) => !selected.has(normalizeSearchValue(option.value)))
            .map((option) => ({ option, score: scoreSuggestion(option, normalizedQuery) }))
            .filter(({ score }) => normalizedQuery.length === 0 || Number.isFinite(score))
            .sort((left, right) => left.score - right.score
                || left.option.label.localeCompare(right.option.label, undefined, { sensitivity: 'base' }))
            .slice(0, Math.max(this.maxVisibleSuggestions, 1))
            .map(({ option }) => option);
    }

    summaryText(): string {
        if (this.values.length === 0) {
            return this.emptySelectionText;
        }

        return `${this.values.length} selected`;
    }

    private open(): void {
        this.isOpen = true;
        const suggestions = this.filteredSuggestions();
        this.activeSuggestionIndex = suggestions.length > 0 ? 0 : -1;
    }

    private close(): void {
        this.isOpen = false;
        this.activeSuggestionIndex = -1;
    }

    private focusInput(): void {
        this.open();
        queueMicrotask(() => this.inputElement?.nativeElement.focus());
    }

    private commitQuery(): void {
        if (!this.query.trim() || !this.allowCustomValues) {
            return;
        }

        this.commitValue(this.query);
    }

    private commitValue(value: string): void {
        const normalizedValue = normalizeInputValue(value);
        if (!normalizedValue) {
            return;
        }

        const nextValues = dedupeValues([
            ...this.values,
            this.normalizeValue(normalizedValue),
        ], this.normalizeValue);

        this.valuesChange.emit([...nextValues]);
        this.query = '';

        const suggestions = this.filteredSuggestions();
        this.activeSuggestionIndex = suggestions.length > 0 ? 0 : -1;
    }

    private removeLastValue(): void {
        const lastValue = this.values.at(-1);
        if (!lastValue) {
            return;
        }

        this.removeValue(lastValue);
    }

    private getOptionMap(): Map<string, CatalogChipComboboxOption> {
        const map = new Map<string, CatalogChipComboboxOption>();
        for (const option of this.options) {
            map.set(normalizeSearchValue(option.value), option);
        }

        return map;
    }
}