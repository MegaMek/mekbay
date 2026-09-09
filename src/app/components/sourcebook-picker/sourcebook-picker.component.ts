// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { Sourcebook, SourcebookReference } from '../../models/sourcebook.model';
import { SourcebooksCatalogService } from '../../services/catalogs/sourcebooks-catalog.service';
import { DialogsService } from '../../services/dialogs.service';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { SourcebookInfoDialogComponent } from '../sourcebook-info-dialog/sourcebook-info-dialog.component';

interface SourcebookPickerData { title: string; selected: readonly SourcebookReference[] }

/** Shared catalog selection for design sources and record-sheet publications. */
@Component({
    selector: 'sourcebook-picker',
    template: `
        <div class="heading"><span>{{ label() }}</span>
            <button type="button" class="bt-button" [disabled]="disabled()" [attr.aria-label]="'Choose ' + label() + ' sourcebooks'" (click)="choose()">Choose sources</button>
        </div>
        <div class="selected-sources">
            @for (source of value(); track source.abbrev) {
                <div class="source">
                    <button type="button" class="source-info" (click)="inspect(source)" [title]="book(source)?.title ?? source.abbrev">
                        <strong>{{ source.abbrev }}</strong>
                        @if (book(source); as known) { <span>{{ known.title }}</span> }
                        @else { <span>Custom reference</span> }
                    </button>
                    <button type="button" class="remove" [disabled]="disabled()" (click)="remove(source)" [attr.aria-label]="'Remove ' + source.abbrev">×</button>
                </div>
            } @empty { <span class="empty">No sources selected</span> }
        </div>
    `,
    styles: `
        :host { display: grid; gap: 8px; min-width: 0; }
        .heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; }
        .bt-button { font-size: 10px; padding: 6px 10px; text-transform: uppercase; }
        .selected-sources { display: grid; gap: 6px; }
        .source { display: flex; align-items: center; gap: 6px; border-left: 2px solid var(--bt-yellow); background-color: #ffffff08; }
        .source-info { display: grid; gap: 3px; text-align: left; flex: 1; min-width: 0; padding: 8px; background: none; border: 0; color: inherit; cursor: pointer; }
        strong { font-size: 12px; color: var(--bt-yellow); overflow-wrap: anywhere; }
        .source-info span, .empty { font-size: 11px; color: var(--text-color-secondary); }
        .empty { padding-block: 6px; }
        .remove { flex: 0 0 28px; border: 0; background: none; color: inherit; font-size: 20px; cursor: pointer; }
        button:focus-visible { outline: 2px solid var(--bt-yellow); }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourcebookPickerComponent {
    readonly label = input.required<string>();
    readonly value = input.required<readonly SourcebookReference[]>();
    readonly disabled = input(false);
    readonly valueChange = output<SourcebookReference[]>();
    private readonly catalog = inject(SourcebooksCatalogService);
    private readonly dialogs = inject(DialogsService);

    book(source: SourcebookReference): Sourcebook | undefined {
        return findBook(this.catalog.getSourcebooks(), source.abbrev);
    }

    async choose(): Promise<void> {
        const ref = this.dialogs.createDialog<SourcebookReference[], SourcebookPickerDialogComponent, SourcebookPickerData>(
            SourcebookPickerDialogComponent, {
                data: { title: this.label(), selected: this.value() }, width: '720px', autoFocus: 'input[type="search"]',
            });
        const result = await firstValueFrom(ref.closed);
        if (result) this.valueChange.emit(result);
    }

    remove(source: SourcebookReference): void {
        this.valueChange.emit(this.value().filter(item => item.abbrev !== source.abbrev));
    }

    inspect(source: SourcebookReference): void {
        inspectSource(this.dialogs, this.book(source), source.abbrev);
    }
}

@Component({
    selector: 'sourcebook-picker-dialog',
    imports: [FormsModule, BaseDialogComponent],
    host: { class: 'fullscreen-dialog-host' },
    template: `
        <base-dialog [autoHeight]="true">
            <div dialog-header><div class="title">{{ data.title }} · SOURCEBOOKS</div></div>
            <div dialog-body class="picker-body">
                <input class="bt-input" type="search" aria-label="Search sourcebooks" placeholder="Search title, abbreviation, or product code…"
                    [ngModel]="query()" (ngModelChange)="query.set($event)">
                <div class="count">{{ selected().length }} selected · {{ books().length }} sourcebooks</div>
                <div class="book-list">
                    @for (book of books(); track book.id) {
                        <div class="book-row" [class.selected]="has(book.abbrev)">
                            <label><input class="bt-checkbox" type="checkbox" [checked]="has(book.abbrev)" (change)="toggle(book)">
                                <span><strong>{{ book.abbrev }}</strong><span>{{ book.title }}</span>
                                    <small>{{ book.sku }}{{ book.canon ? '' : ' · Non-canon' }}</small>
                                </span>
                            </label>
                            <button class="bt-button" type="button" (click)="inspect(book)" [attr.aria-label]="'Inspect ' + book.title">Info</button>
                        </div>
                    } @empty { <p>No matching sourcebooks.</p> }
                </div>
                <div class="custom-references">
                    @for (source of custom(); track source.abbrev) {
                        <div><span>{{ source.abbrev }}</span><button class="bt-button" (click)="toggle(source)" [attr.aria-label]="'Remove ' + source.abbrev">Remove</button></div>
                    }
                    <label>Custom source or page reference</label>
                    <div><input class="bt-input" aria-label="Custom source reference" placeholder="e.g. TRO: 3050 p. 12" [ngModel]="manual()"
                        (ngModelChange)="manual.set($event)" (keydown.enter)="addManual(); $event.preventDefault()">
                        <button class="bt-button" [disabled]="!manual().trim()" (click)="addManual()">Add</button></div>
                </div>
            </div>
            <div dialog-footer class="picker-footer">
                <button class="bt-button" [disabled]="!selected().length" (click)="selected.set([])">Clear</button>
                <span></span><button class="bt-button" (click)="dialogRef.close()">Cancel</button>
                <button class="bt-button primary" (click)="apply()">Apply</button>
            </div>
        </base-dialog>
    `,
    styles: `
        .picker-body { display: grid; gap: 12px; min-height: 0; }
        .bt-input { width: 100%; min-width: 0; font-size: 13px; }
        .count { color: var(--text-color-secondary); font-size: 12px; }
        .book-list { overflow-y: auto; max-height: 45dvh; min-height: 160px; border-block: 1px solid var(--border-color); }
        .book-row { display: flex; align-items: center; gap: 12px; padding: 10px 6px; border-bottom: 1px solid #ffffff12; }
        .book-row.selected { background-color: #ffffff08; }
        .book-row label { display: flex; align-items: center; gap: 12px; flex: 1; cursor: pointer; min-width: 0; }
        .book-row label > span { display: grid; gap: 4px; font-size: 13px; }
        strong { color: var(--bt-yellow); }
        small { color: var(--text-color-secondary); }
        .bt-button { font-size: 11px; padding: 6px 10px; text-transform: uppercase; }
        .custom-references { display: grid; gap: 8px; font-size: 12px; }
        .custom-references > div { display: flex; align-items: center; gap: 8px; }
        .custom-references span { flex: 1; overflow-wrap: anywhere; }
        .picker-footer { display: flex; gap: 8px; width: 100%; }
        .picker-footer > span { flex: 1; }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourcebookPickerDialogComponent {
    readonly data = inject<SourcebookPickerData>(DIALOG_DATA);
    readonly dialogRef = inject<DialogRef<SourcebookReference[]>>(DialogRef);
    private readonly catalog = inject(SourcebooksCatalogService);
    private readonly dialogs = inject(DialogsService);
    readonly selected = signal([...this.data.selected]);
    readonly query = signal('');
    readonly manual = signal('');
    readonly books = computed(() => {
        const terms = this.query().toLowerCase().trim().split(/\s+/).filter(Boolean);
        return [...this.catalog.getSourcebooks().values()]
            .filter(book => this.has(book.abbrev) || terms.every(term => `${book.abbrev} ${book.title} ${book.sku}`.toLowerCase().includes(term)))
            .sort((a, b) => Number(this.has(b.abbrev)) - Number(this.has(a.abbrev)) || a.abbrev.localeCompare(b.abbrev));
    });
    readonly custom = computed(() => this.selected().filter(source => !this.catalog.getSourcebooks().has(source.abbrev)));

    has(abbrev: string): boolean { return this.selected().some(source => source.abbrev === abbrev); }

    toggle(source: SourcebookReference): void {
        this.selected.update(values => this.has(source.abbrev) ? values.filter(item => item.abbrev !== source.abbrev) : [...values, source]);
    }

    addManual(): void {
        for (const abbrev of this.manual().split(',').map(value => value.trim()).filter(Boolean)) {
            const exact = [...this.catalog.getSourcebooks().values()].find(book => book.abbrev.toLowerCase() === abbrev.toLowerCase());
            const source: SourcebookReference = exact ?? { abbrev, canon: false, unresolved: true };
            if (!this.has(source.abbrev)) this.selected.update(values => [...values, source]);
        }
        this.manual.set('');
    }

    inspect(book: Sourcebook): void { inspectSource(this.dialogs, book, book.abbrev); }
    apply(): void { this.addManual(); this.dialogRef.close(this.selected()); }
}

function findBook(catalog: ReadonlyMap<string, Sourcebook>, reference: string): Sourcebook | undefined {
    const key = reference.toLowerCase();
    return catalog.get(reference) ?? [...catalog.values()].filter(book => {
        const abbrev = book.abbrev.toLowerCase();
        return key === abbrev || key.startsWith(abbrev + ' ') || key.startsWith(abbrev + ':');
    }).sort((a, b) => b.abbrev.length - a.abbrev.length)[0];
}

function inspectSource(dialogs: DialogsService, book: Sourcebook | undefined, reference: string): void {
    dialogs.createDialog(SourcebookInfoDialogComponent, { data: {
        sourcebooks: book ? [{ ...book, sourceAnnotations: book.abbrev === reference ? [] : [reference] }] : [],
        unknownSources: book ? [] : [{ abbrev: reference }], selectedIndex: 0,
    } });
}
