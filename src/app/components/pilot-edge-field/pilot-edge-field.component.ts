// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, model } from '@angular/core';
import { FORCE_PERSON_EDGE_MAX } from '../../models/force-personnel';
import { normalizeBoundedIntegerInput } from '../../utils/bounded-integer-input.util';

/** Edge points belong to the person in both game systems. */
@Component({
    selector: 'pilot-edge-field',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="form-fields">
            <span class="field-label" aria-hidden="true">Edge</span>
            <div class="stepper">
                <button type="button" class="bt-button tiny" aria-label="Remove one Edge point"
                    [disabled]="value() <= 0" (click)="value.set(value() - 1)">−</button>
                <input class="field-input" type="text" inputmode="numeric" autocomplete="off" aria-label="Edge points"
                    [value]="value()" (focus)="$any($event.target).select()" (change)="onChange($event)" />
                <button type="button" class="bt-button tiny" aria-label="Add one Edge point"
                    [disabled]="value() >= max" (click)="value.set(value() + 1)">+</button>
            </div>
        </div>
    `,
    styles: `
        :host { display: block; width: 0; min-width: 100%; }
        .stepper { display: flex; align-items: stretch; gap: 4px; }
        .bt-button { flex: 0 0 26px; min-height: 32px; padding: 0; font-size: 1.1em; }
        .bt-button:disabled { opacity: .4; cursor: default; }
        .field-input { width: 0; height: 32px; padding: 0; font-size: 1em; font-weight: 700; text-align: center; }
    `,
})
export class PilotEdgeFieldComponent {
    readonly value = model(0);
    readonly max = FORCE_PERSON_EDGE_MAX;

    onChange(event: Event): void {
        this.value.set(normalizeBoundedIntegerInput(event, { min: 0, max: this.max }));
    }
}
