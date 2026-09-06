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
        <div class="unit-crew" [class.cards]="layout() === 'cards'" (click)="$event.stopPropagation()">
            @for (position of policy().positions; track position.positionId) {
                <crew-slot [force]="force()" [unitId]="unitId()" [positionId]="position.positionId"
                    [label]="position.label" [layout]="layout()" />
            }
            @if (policy().kind === 'none') { <span class="crew-reason">{{ policy().reason || 'This unit has no crew.' }}</span> }
            @if (policy().kind === 'integrated') { <span class="crew-reason">Integrated crew</span> }
        </div>
    `,
    styles: [`
        :host { display: block; min-width: 0; }
        .unit-crew { display: flex; flex-direction: column; gap: 5px; }
        .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px; }
        .crew-reason { color: var(--text-color-secondary); font-size: .75em; padding: 4px; }
    `],
})
export class ForceUnitCrewComponent {
    readonly force = input.required<Force>();
    readonly unitId = input.required<string>();
    readonly layout = input<CrewLayout>('rows');
    readonly policy = computed(() => this.force().getUnitCrewPolicy(this.unitId()));
}
