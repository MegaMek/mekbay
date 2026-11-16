// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Force } from '../../models/force.model';
import { CrewSlotComponent } from './crew-slot.component';
import type { CrewLayout } from './crew-card.component';

@Component({
    selector: 'force-unit-crew',
    imports: [CrewSlotComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="unit-crew" [class.slots]="layout() === 'slots'" [class.strip]="layout() === 'compact'"
            [class.seats]="layout() === 'seats'" [class.sheet]="layout() === 'sheet'" [class.joined]="joined()"
            (click)="$event.stopPropagation()">
            @for (position of policy().positions; track position.positionId) {
                <crew-slot [force]="force()" [unitId]="unitId()" [positionId]="position.positionId"
                    [label]="position.label" [layout]="layout()" />
            }
            @if (policy().kind === 'none' && layout() !== 'seats') { <span class="crew-reason">{{ policy().reason || 'This unit has no crew.' }}</span> }
            @if (policy().kind === 'integrated' && layout() !== 'compact') { <span class="crew-reason">Integrated crew</span> }
        </div>
    `,
    styles: [`
        :host { display: block; min-width: 0; }
        .unit-crew { display: flex; flex-direction: column; gap: 5px; }
        .slots { flex-flow: row wrap; gap: 8px; justify-content: var(--crew-justify-content, flex-start); }
        .slots crew-slot { flex: 0 1 var(--crew-slot-width, 220px); max-width: var(--crew-slot-width, 220px); }
        /* Slots stacked in one column, sharing the border between neighbours. */
        .slots.joined { flex-direction: column; gap: 0; }
        .slots.joined crew-slot { flex: none; max-width: none; }
        .slots.joined crew-slot + crew-slot { margin-top: -1px; }
        .strip { flex-flow: row var(--crew-wrap, wrap); align-items: center; gap: 4px; }
        .strip crew-slot { flex: 1 1 var(--crew-slot-basis, 150px); max-width: var(--crew-slot-width, 220px); min-width: 0; }
        /* One frame around every seat; it is only as wide as its seats, up to the container. */
        .seats { flex-flow: row nowrap; gap: 0; width: fit-content; max-width: 100%; border: 1px solid var(--border-color); background: #0003; }
        .seats crew-slot { flex: 0 1 280px; width: 280px; min-width: 0; }
        .seats crew-slot + crew-slot { border-left: 1px solid var(--border-color); }
        .seats:empty { display: none; }
        /* Record-sheet warrior blocks side by side, wrapping when the crew outgrows the line. */
        .sheet { flex-flow: row wrap; gap: 8px 16px; }
        .sheet crew-slot { flex: 0 1 440px; min-width: 0; }
        .crew-reason { color: var(--text-color-secondary); font-size: .75em; padding: 4px; }
    `],
})
export class ForceUnitCrewComponent {
    readonly force = input.required<Force>();
    readonly unitId = input.required<string>();
    readonly layout = input<CrewLayout>('rows');
    /** Stacks `slots` into one full-width column without gaps. */
    readonly joined = input(false);
    readonly policy = computed(() => this.force().getUnitCrewPolicy(this.unitId()));
}
