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
        @if (hasReserves()) {
        <section class="reserves" aria-label="Reserve crew" (click)="$event.stopPropagation()">
            <div class="reserve-heading">
                <span>Reserves <span class="count">{{ people().length }}</span></span>
                @if (canEdit()) { <button class="bt-button add" type="button" (click)="crew.create(force())">＋ ADD CREW</button> }
            </div>
            <div class="reserve-list" [class.cards]="layout() === 'cards'" [class.compact]="layout() === 'compact'"
                cdkDropList [id]="dropId" [cdkDropListConnectedTo]="connectedLists()" [cdkDropListDisabled]="!canEdit()"
                [cdkDropListSortingDisabled]="true" [cdkDropListEnterPredicate]="canDrop" (cdkDropListDropped)="drop($event)">
                @for (person of people(); track person.id) {
                    <crew-card [force]="force()" [person]="person" [layout]="layout()" [canEdit]="canEdit()" [canMove]="canEdit()"
                        (edited)="crew.edit(force(), person.id)" (deleted)="crew.delete(force(), person.id)" />
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
        .reserve-list { display: flex; flex-direction: column; gap: 5px; min-height: 4px; }
        .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
        .compact { display: flex; flex-flow: row wrap; }
        .compact { gap: 2px; }
        .compact crew-card { flex: 0 0 36px; }
        .cdk-drop-list-receiving { outline: 1px dashed var(--bt-yellow); }
    `],
})
export class ForceReserveCrewComponent {
    readonly force = input.required<Force>();
    readonly layout = input<CrewLayout>('rows');
    readonly crew = inject(CrewAssignmentService);
    readonly dropId = `crew-reserves-${uuidv7()}`;
    readonly people = computed(() => this.crew.reserves(this.force()));
    readonly hasReserves = computed(() => this.people().length > 0);
    readonly canEdit = computed(() => this.force().canEditPersonnel());
    readonly connectedLists = computed(() => [...this.crew.connectedDropLists(this.force())]);
    readonly canDrop = (drag: CdkDrag<CrewDragData>): boolean => this.canEdit()
        && drag.data?.kind === 'force-person' && drag.data.force === this.force();

    constructor() {
        effect(onCleanup => {
            if (this.hasReserves()) onCleanup(this.crew.registerDropList(this.force(), this.dropId));
        });
    }

    drop(event: CdkDragDrop<unknown, unknown, CrewDragData>): void {
        if (this.canDrop(event.item)) void this.crew.moveToReserves(this.force(), event.item.data.personId);
    }
}
