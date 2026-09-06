// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, PendingTasks, computed, effect, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { PORTRAIT_SETS, type PortraitSet } from '../../models/portrait.model';
import { PortraitService } from '../../services/portrait.service';
import { CrewPortraitComponent } from '../crew-portrait/crew-portrait.component';

export interface PortraitPickerDialogData { readonly portrait?: string; }

@Component({
    selector: 'portrait-picker-dialog',
    imports: [CrewPortraitComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { class: 'fullscreen-dialog-host glass' },
    template: `
        <div class="wide-dialog">
            <h2 class="wide-dialog-title">Select Portrait</h2>
            <div class="portrait-tabs tab-header" role="tablist" aria-label="Portrait sets">
                @for (set of sets; track set) {
                    <button type="button" role="tab" [id]="'portrait-tab-' + set"
                        [attr.aria-controls]="'portrait-panel-' + set" [attr.aria-selected]="activeSet() === set"
                        [attr.tabindex]="activeSet() === set ? 0 : -1" [class.active]="activeSet() === set"
                        (click)="activeSet.set(set)" (keydown)="navigateTabs($event)">{{ set }}</button>
                }
            </div>
            <div class="wide-dialog-body" role="tabpanel" [id]="'portrait-panel-' + activeSet()"
                [attr.aria-labelledby]="'portrait-tab-' + activeSet()" tabindex="0">
                @if (loading() || sheetLoading()) {
                    <p role="status">Loading portraits…</p>
                } @else if (error()) {
                    <p role="alert">Portraits could not be loaded. Please try again.</p>
                    <button class="bt-button" type="button" (click)="load()">RETRY</button>
                } @else if (sheetError()) {
                    <p role="alert">The portrait sheet could not be loaded. Please try again.</p>
                    <button class="bt-button" type="button" (click)="retrySheets()">RETRY</button>
                } @else {
                    @for (category of categories(); track category.name) {
                        <section class="category">
                            <button class="category-title" type="button" [id]="'portrait-category-' + $index"
                                [attr.aria-expanded]="isOpen(category.name)" [attr.aria-controls]="'portrait-choices-' + $index"
                                (click)="toggleCategory(category.name)">
                                <svg class="chevron" width="12px" height="12px" fill="currentColor" viewBox="0 0 10 10"
                                    xmlns="http://www.w3.org/2000/svg" [class.collapsed]="!isOpen(category.name)" aria-hidden="true">
                                    <path d="M0 2l5 6 5-6z" />
                                </svg>
                                <span>{{ category.name }}</span><span class="count">{{ category.portraits.length }}</span>
                            </button>
                            @if (isOpen(category.name)) {
                                <div class="portrait-grid" [id]="'portrait-choices-' + $index" role="group"
                                    [attr.aria-labelledby]="'portrait-category-' + $index">
                                    @for (name of category.portraits; track name) {
                                        <button type="button" class="portrait-choice" [class.selected]="data.portrait === name"
                                            [attr.aria-label]="name" [attr.aria-pressed]="data.portrait === name" [title]="name"
                                            (click)="dialogRef.close(name)"><crew-portrait [name]="name" /></button>
                                    }
                                </div>
                            }
                        </section>
                    }
                }
            </div>
            <div class="wide-dialog-actions">
                <button class="bt-button danger" type="button" (click)="dialogRef.close(null)">NO PORTRAIT</button>
                <button class="bt-button" type="button" (click)="dialogRef.close()">DISMISS</button>
            </div>
        </div>
    `,
    styles: `
        .wide-dialog { width: min(720px, 100dvw); }
        .wide-dialog-body { min-height: 240px; gap: 0; }
        .portrait-tabs { display: flex; flex-shrink: 0; }
        .portrait-tabs button { flex: 1; padding: 12px; border: 0; border-bottom: 2px solid transparent;
            background: #0002; color: var(--text-color-secondary); cursor: pointer; font: inherit; }
        .portrait-tabs button.active { border-bottom-color: var(--bt-yellow); color: var(--text-color); background: #ffffff0a; }
        .category { border-bottom: 1px solid var(--border-color, #ffffff25); }
        .category-title { display: flex; align-items: center; gap: 10px; width: 100%; padding: 14px 8px;
            border: 0; background: transparent; color: var(--text-color); cursor: pointer; text-align: left; font: inherit; }
        .category-title:hover { background: #ffffff0a; }
        .chevron { color: var(--text-color-secondary); transition: transform 0.15s ease; flex-shrink: 0; }
        .chevron.collapsed { transform: rotate(-90deg); }
        .count { margin-left: auto; color: var(--text-color-secondary); font-size: .8em; }
        .portrait-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 8px; padding: 8px 0 16px; }
        .portrait-choice { display: flex; align-items: center; justify-content: center; padding: 3px; cursor: pointer;
            border: 2px solid transparent; background: #0003; }
        .portrait-choice:hover, .portrait-choice.selected { border-color: var(--bt-yellow); background: #ffffff12; }
        button:focus-visible { outline: 2px solid var(--bt-yellow); outline-offset: -2px; }
    `,
})
export class PortraitPickerDialogComponent {
    readonly data = inject<PortraitPickerDialogData>(DIALOG_DATA);
    readonly dialogRef = inject(DialogRef<string | null>);
    readonly portraits = inject(PortraitService);
    readonly sets = PORTRAIT_SETS;
    readonly activeSet = signal<PortraitSet>('Male');
    readonly openCategories = signal<ReadonlySet<string>>(new Set());
    readonly loading = signal(true);
    readonly error = signal(false);
    readonly sheetLoading = signal(false);
    readonly sheetError = signal(false);
    private readonly sheetAttempt = signal(0);
    private readonly pendingTasks = inject(PendingTasks);
    readonly categories = computed(() => {
        const groups = new Map<string, string[]>();
        for (const [name, portrait] of Object.entries(this.portraits.manifest()?.portraits ?? {})) {
            if (portrait.set !== this.activeSet()) continue;
            const names = groups.get(portrait.category) ?? [];
            names.push(name);
            groups.set(portrait.category, names);
        }
        return [...groups].sort(([left], [right]) => left.localeCompare(right)).map(([name, portraits]) => ({
            name, portraits: portraits.sort((left, right) => left.localeCompare(right, undefined, { numeric: true })),
        }));
    });

    constructor() {
        void this.pendingTasks.run(() => this.load());
        effect(onCleanup => {
            if (this.loading() || this.error()) return;
            this.sheetAttempt();
            const set = this.activeSet();
            const sheets = new Set(Object.values(this.portraits.manifest()?.portraits ?? {})
                .filter(portrait => portrait.set === set).map(portrait => portrait.sheet));
            let current = true;
            onCleanup(() => { current = false; });
            this.sheetLoading.set(true);
            this.sheetError.set(false);
            void this.pendingTasks.run(() => Promise.all([...sheets].map(id => this.portraits.loadSheet(id)))
                .catch(() => { if (current) this.sheetError.set(true); })
                .finally(() => { if (current) this.sheetLoading.set(false); }));
        });
    }

    retrySheets(): void { this.sheetAttempt.update(value => value + 1); }

    async load(): Promise<void> {
        this.loading.set(true);
        this.error.set(false);
        try {
            await this.portraits.initialize();
            const portraits = this.portraits.manifest()?.portraits;
            const selected = this.data.portrait && portraits && Object.hasOwn(portraits, this.data.portrait)
                ? portraits[this.data.portrait] : undefined;
            if (selected) this.activeSet.set(selected.set);
            this.openCategories.set(new Set(PORTRAIT_SETS.map(set => {
                const first = Object.values(this.portraits.manifest()?.portraits ?? {}).find(portrait => portrait.set === set);
                return `${set}/${selected?.set === set ? selected.category : first?.category}`;
            })));
        } catch { this.error.set(true); }
        finally { this.loading.set(false); }
    }

    isOpen(category: string): boolean { return this.openCategories().has(`${this.activeSet()}/${category}`); }

    toggleCategory(category: string): void {
        const key = `${this.activeSet()}/${category}`;
        const open = new Set(this.openCategories());
        if (!open.delete(key)) open.add(key);
        this.openCategories.set(open);
    }

    navigateTabs(event: KeyboardEvent): void {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        this.activeSet.set(event.key === 'Home' ? 'Male' : event.key === 'End' ? 'Female' : this.activeSet() === 'Male' ? 'Female' : 'Male');
        const tablist = (event.currentTarget as HTMLElement).parentElement;
        tablist?.querySelector<HTMLButtonElement>(`#portrait-tab-${this.activeSet()}`)?.focus();
    }
}
