// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Force } from '../../models/force.model';
import { CrewSlotComponent } from './crew-slot.component';
import type { CrewLayout } from './crew-card.component';

@Component({
    selector: 'force-unit-crew',
    /* Crew cards size to their container, so a host that lays the strip out sizes it from the count. */
    host: { '[style.--crew-count]': 'policy().positions.length' },
    imports: [CrewSlotComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="unit-crew" [class.slots]="layout() === 'slots'" [class.strip]="layout() === 'compact'"
            [class.joined]="joined()"
            (click)="$event.stopPropagation()">
            @for (position of policy().positions; track position.positionId) {
                <crew-slot [force]="force()" [unitId]="unitId()" [positionId]="position.positionId"
                    [label]="position.label" [layout]="layout()" />
            }
            @if (policy().kind === 'none') { <span class="crew-reason">{{ policy().reason || 'This unit has no crew.' }}</span> }
            @if (policy().kind === 'integrated' && layout() !== 'compact') { <span class="crew-reason">Integrated crew</span> }
        </div>
    `,
    styles: [`
        :host { display: block; min-width: 0; }
        .unit-crew { display: flex; flex-direction: column; gap: 5px; }
        .slots { flex-flow: row wrap; gap: 8px; justify-content: var(--crew-justify-content, flex-start); }
        .slots crew-slot { flex: 0 1 var(--crew-slot-width, 220px); max-width: var(--crew-slot-width, 220px); }
        /* Slots joined into one strip that shares the border between neighbours: a column, unless the
           host sets --crew-joined-direction: row with --crew-joined-slot and --crew-joined-overlap. */
        .slots.joined { flex-flow: var(--crew-joined-direction, column) nowrap; gap: 0; }
        .slots.joined crew-slot { flex: var(--crew-joined-slot, none); min-width: 0; max-width: none; }
        .slots.joined crew-slot + crew-slot { margin: var(--crew-joined-overlap, -1px 0 0); }
        .strip { flex-flow: row var(--crew-wrap, wrap); align-items: center; gap: 4px; }
        .strip crew-slot { flex: 1 1 var(--crew-slot-basis, 150px); max-width: var(--crew-slot-width, 220px); min-width: 0; }
        .crew-reason { color: var(--text-color-secondary); font-size: .75em; padding: 4px; }
    `],
})
export class ForceUnitCrewComponent {
    readonly force = input.required<Force>();
    readonly unitId = input.required<string>();
    readonly layout = input<CrewLayout>('rows');
    /** Joins `slots` into one gapless strip: a column by default, a row where the host's CSS asks. */
    readonly joined = input(false);
    readonly policy = computed(() => this.force().getUnitCrewPolicy(this.unitId()));
}
