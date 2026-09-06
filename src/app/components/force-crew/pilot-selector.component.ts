// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { ComponentPortal } from '@angular/cdk/portal';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { takeUntil } from 'rxjs';
import type { Force } from '../../models/force.model';
import { GameSystem } from '../../models/common.model';
import { CrewAssignmentService } from '../../services/crew-assignment.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { DropdownPointerActivationGuard, scrollActiveOptionIntoView } from '../../utils/dropdown-interaction.utils';
import { uuidv7 } from '../../utils/uuid.util';

export type PilotSelection = { readonly kind: 'create' }
    | { readonly kind: 'assign' | 'delete'; readonly personId: string };

@Component({
    selector: 'pilot-selector-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="dropdown-shell glass has-shadow framed-borders" (keydown)="onKeydown($event)">
            <input #searchInput class="bt-input search" type="search" placeholder="Search reserve crew..."
                aria-label="Search reserve crew" role="combobox" aria-autocomplete="list" aria-expanded="true"
                [attr.aria-controls]="optionsId" [attr.aria-activedescendant]="optionId(activeIndex())"
                [value]="search()" (input)="search.set($any($event.target).value); activeIndex.set(0)" />
            <div class="dropdown-options" data-scroll-container role="listbox" [id]="optionsId" aria-label="Assign crew">
                <button class="dropdown-option create-option" type="button" role="option" [id]="optionId(0)"
                    [class.keyboard-active]="activeIndex() === 0" aria-selected="false"
                    (focus)="activeIndex.set(0)"
                    (pointermove)="hover(0, $event)" (click)="selected.emit({kind: 'create'})">
                    <span aria-hidden="true">＋</span><span>Create standard {{ isAS() ? 'pilot' : 'crew member' }}
                        <small>{{ isAS() ? 'Skill 4' : 'Gunnery 4 / Piloting 5' }}</small></span>
                </button>
                @for (person of people(); track person.id; let index = $index) {
                    <div class="option-row">
                        <button class="dropdown-option" type="button" role="option" [id]="optionId(index + 1)"
                            [class.keyboard-active]="activeIndex() === index + 1" aria-selected="false"
                            (focus)="activeIndex.set(index + 1)"
                            (pointermove)="hover(index + 1, $event)" (click)="selected.emit({kind: 'assign', personId: person.id})">
                            <img src="/images/helmet.svg" width="24" height="24" alt="" />
                            <span>{{ person.name || 'Unnamed crew' }}<small>{{ isAS() ? 'Skill ' : 'Gunnery ' }}{{ person.gunnery ?? 4 }}
                                @if (!isAS()) { / Piloting {{ person.piloting ?? 5 }} }</small></span>
                        </button>
                        <button class="delete" type="button" [attr.aria-label]="'Delete ' + (person.name || 'unnamed crew')"
                            title="Delete crew member" (click)="selected.emit({kind: 'delete', personId: person.id})">×</button>
                    </div>
                }
                @if (people().length === 0) { <p class="empty">No reserve crew{{ search() ? ' matches your search' : ' available' }}.</p> }
            </div>
        </div>
    `,
    styles: [`
        :host { display: block; width: min(340px, calc(100dvw - 24px)); }
        .dropdown-shell { display: flex; flex-direction: column; max-height: min(420px, 65dvh); }
        .search { box-sizing: border-box; width: calc(100% - 16px); margin: 8px; }
        .dropdown-options { overflow: auto; }
        .option-row { display: flex; }
        .dropdown-option { display: flex; align-items: center; gap: 10px; flex: 1; width: 100%; padding: 10px 12px;
            border: 0; border-left: 3px solid transparent; background: transparent; color: var(--text-color); text-align: left; cursor: pointer; }
        .dropdown-option:hover, .keyboard-active { background: var(--bt-yellow-background-transparent); border-left-color: var(--bt-yellow); }
        .create-option { border-bottom: 1px solid var(--border-color); }
        small { display: block; color: var(--text-color-secondary); font-size: .8em; margin-top: 3px; }
        .delete { width: 36px; flex-shrink: 0; color: var(--text-color-secondary); background: transparent; border: 0; cursor: pointer; }
        .delete:hover { color: #ff6868; }
        .empty { color: var(--text-color-secondary); font-size: .8em; padding: 8px 14px; }
    `],
})
export class PilotSelectorPanelComponent {
    readonly force = input.required<Force>();
    readonly selected = output<PilotSelection>();
    readonly dismissed = output<void>();
    readonly search = signal('');
    readonly activeIndex = signal(0);
    readonly optionsId = `pilot-options-${uuidv7()}`;
    readonly searchInput = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');
    private readonly element = inject(ElementRef<HTMLElement>);
    private readonly crew = inject(CrewAssignmentService);
    private readonly pointerGuard = new DropdownPointerActivationGuard();
    readonly isAS = computed(() => this.force().gameSystem === GameSystem.AS);
    readonly people = computed(() => {
        const search = this.search().trim().toLocaleLowerCase();
        return this.crew.reserves(this.force()).filter(person => !search || (person.name ?? '').toLocaleLowerCase().includes(search));
    });

    constructor() {
        afterNextRender(() => this.searchInput().nativeElement.focus());
        effect(() => {
            if (this.activeIndex() > this.people().length) this.activeIndex.set(this.people().length);
        });
    }

    optionId(index: number): string { return `${this.optionsId}-${index}`; }

    hover(index: number, event: PointerEvent): void {
        if (!this.pointerGuard.shouldIgnore(event)) this.activeIndex.set(index);
    }

    onKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.dismissed.emit(); return; }
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const search = this.searchInput().nativeElement;
        const isSearch = event.target === search;
        if (event.key === 'Enter' && isSearch) {
            event.preventDefault();
            const person = this.people()[this.activeIndex() - 1];
            this.selected.emit(person ? { kind: 'assign', personId: person.id } : { kind: 'create' });
            return;
        }
        if (!isSearch && (event.target as HTMLElement).getAttribute('role') !== 'option') return;
        // Home/End and modified arrows retain normal caret/selection behavior in the search field.
        if (isSearch && (event.key === 'Home' || event.key === 'End')) return;
        const count = this.people().length + 1;
        const next = event.key === 'ArrowDown' ? (this.activeIndex() + 1) % count
            : event.key === 'ArrowUp' ? (this.activeIndex() + count - 1) % count
            : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : undefined;
        if (next === undefined) return;
        event.preventDefault();
        this.pointerGuard.suppress();
        this.activeIndex.set(next);
        // Arrow navigation uses the combobox's active descendant. Native Enter
        // on a previously tab-focused option must not activate a different row.
        search.focus();
        queueMicrotask(() => scrollActiveOptionIntoView(this.element.nativeElement, '[data-scroll-container]', '.keyboard-active'));
    }
}

@Component({
    selector: 'pilot-selector',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <button #trigger type="button" class="vacancy" [disabled]="disabled()" aria-haspopup="listbox"
            [attr.aria-expanded]="open()" [attr.aria-label]="'Assign ' + label()"
            (click)="$event.stopPropagation(); toggle()" (keydown.arrowdown)="$event.preventDefault(); show()">
            <img src="/images/helmet.svg" width="24" height="24" alt="" />
            <span>{{ label() }}<small>Vacant · Assign crew</small></span><span aria-hidden="true">＋</span>
        </button>
    `,
    styles: [`
        :host { display: block; width: 100%; }
        .vacancy { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px; cursor: pointer;
            border: 1px dashed var(--border-color, #ffffff40); color: var(--text-color-secondary); background: #0002; text-align: left; }
        .vacancy:disabled { cursor: default; opacity: .65; }
        .vacancy > span:first-of-type { flex: 1; }
        small { display: block; font-size: .75em; margin-top: 2px; }
    `],
})
export class PilotSelectorComponent {
    readonly force = input.required<Force>();
    readonly unitId = input.required<string>();
    readonly positionId = input.required<string>();
    readonly label = input('Pilot');
    readonly disabled = input(false);
    readonly open = signal(false);
    readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
    private readonly overlay = inject(OverlayManagerService);
    private readonly injector = inject(Injector);
    private readonly destroyRef = inject(DestroyRef);
    private readonly crew = inject(CrewAssignmentService);
    private readonly overlayId = `pilot-selector-${uuidv7()}`;

    constructor() { this.destroyRef.onDestroy(() => this.close(false)); }

    toggle(): void { this.open() ? this.close() : this.show(); }

    show(): void {
        if (this.disabled() || this.open()) return;
        this.open.set(true);
        const { componentRef, closed } = this.overlay.createManagedOverlay(this.overlayId, this.trigger(),
            new ComponentPortal(PilotSelectorPanelComponent, null, this.injector), { closeOnOutsideClick: true });
        componentRef.setInput('force', this.force());
        outputToObservable(componentRef.instance.selected).pipe(takeUntil(closed), takeUntilDestroyed(this.destroyRef))
            .subscribe(selection => {
                if (selection.kind === 'delete') { void this.crew.delete(this.force(), selection.personId); return; }
                this.close();
                if (selection.kind === 'create') void this.crew.create(this.force(), this.unitId(), this.positionId());
                else void this.crew.assign(this.force(), selection.personId, this.unitId(), this.positionId());
            });
        outputToObservable(componentRef.instance.dismissed).pipe(takeUntil(closed), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.close());
        closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.open.set(false));
    }

    private close(restoreFocus = true): void {
        this.overlay.closeManagedOverlay(this.overlayId);
        this.open.set(false);
        if (restoreFocus) this.trigger().nativeElement.focus();
    }
}
