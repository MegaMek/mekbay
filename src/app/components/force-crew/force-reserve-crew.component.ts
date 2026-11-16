// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { CdkDropList, type CdkDrag, type CdkDragDrop } from '@angular/cdk/drag-drop';
import type { Force } from '../../models/force.model';
import { CrewAssignmentService, type CrewDragData } from '../../services/crew-assignment.service';
import { uuidv7 } from '../../utils/uuid.util';
import { CrewCardComponent, type CrewLayout } from './crew-card.component';

@Component({
    selector: 'force-reserve-crew',
    imports: [CdkDropList, CrewCardComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (visible()) {
        <section class="reserves" [class.none]="people().length === 0" aria-label="Reserve crew" (click)="$event.stopPropagation()">
            <div class="reserve-heading">
                <span class="title">Reserves <span class="count">{{ people().length }}</span></span>
                @if (canEdit()) { <button class="bt-button add" type="button" (click)="crew.create(force())">＋ ADD CREW</button> }
            </div>
            <div class="reserve-list" [class.cards]="layout() === 'cards'"
                cdkDropList [id]="dropId" [cdkDropListConnectedTo]="connectedLists()" [cdkDropListDisabled]="!canEdit()"
                [cdkDropListOrientation]="layout() === 'rows' ? 'vertical' : 'mixed'"
                [cdkDropListEnterPredicate]="canDrop" (cdkDropListDropped)="drop($event)">
                @for (person of people(); track person.id) {
                    <crew-card [force]="force()" [person]="person" [layout]="layout()" [canEdit]="canEdit()" [canMove]="canEdit()"
                        [wounds]="crew.reserveWounds(force(), person)"
                        (edited)="crew.edit(force(), person.id)" (deleted)="crew.delete(force(), person.id)" />
                } @empty {
                    <p class="empty">No reserve crew &mdash; drop a pilot here to take them off their unit.</p>
                }
            </div>
        </section>
        }
    `,
    styles: [`
        :host { display: block; min-width: 0; }
        .reserve-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
        .count { color: var(--text-color-secondary); margin-left: 6px; }
        .add { font-size: .75em; padding: 4px 8px; margin-left: auto; }
        .reserve-list { display: flex; flex-direction: column; gap: 4px; min-height: 36px; }
        .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(272px, 100%), 1fr)); gap: 6px; }
        /* Without reserves the section is one row: the drop strip beside the add button. */
        .none { display: flex; align-items: center; gap: 8px; }
        .none .reserve-heading { order: 1; margin: 0; }
        .none .title { display: none; }
        .none .reserve-list { flex: 1; min-width: 0; min-height: 0; }
        .empty { grid-column: 1 / -1; margin: 0; padding: 6px 10px; border: 1px dashed var(--border-color);
            color: var(--text-color-secondary); font-size: .8em; text-align: center; }
        .cdk-drop-list-receiving { outline: 1px dashed var(--bt-yellow); }
        .cdk-drop-list-dragging { outline-style: solid; background: var(--bt-yellow-background); }
        .cdk-drop-list-dragging .empty { visibility: hidden; }
    `],
})
export class ForceReserveCrewComponent {
    readonly force = input.required<Force>();
    readonly layout = input<CrewLayout>('rows');
    /** Keeps an editable force's empty reserve list available as the place to unassign crew. */
    readonly showEmpty = input(false);
    readonly crew = inject(CrewAssignmentService);
    readonly dropId = `crew-reserves-${uuidv7()}`;
    readonly people = computed(() => this.crew.reserves(this.force()));
    readonly canEdit = computed(() => this.force().canEditPersonnel());
    readonly visible = computed(() => this.people().length > 0 || (this.showEmpty() && this.canEdit()));
    readonly connectedLists = computed(() => [...this.crew.connectedDropLists()]);
    readonly canDrop = (drag: CdkDrag<CrewDragData>): boolean => this.crew.canDropPerson(drag.data, this.force());

    constructor() {
        effect(onCleanup => {
            if (this.visible()) onCleanup(this.crew.registerDropList(this.force(), this.dropId));
        });
    }

    drop(event: CdkDragDrop<unknown, unknown, CrewDragData>): void {
        if (event.isPointerOverContainer && this.canDrop(event.item))
            void this.crew.dropInReserves(this.force(), event.item.data, event.currentIndex);
    }
}
