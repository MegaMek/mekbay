// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** A count-only display group; reserves are people, never synthetic force units. */
@Component({
    selector: 'force-reserves-preview',
    imports: [DecimalPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="group-name">Reserves</div>
        <div class="reserve-count" role="img"
            [attr.aria-label]="count() === 1 ? '1 person in reserve' : count() + ' people in reserve'">
            <img src="/images/helmet.svg" width="32" height="32" alt="" aria-hidden="true" />
            <span aria-hidden="true">{{ count() | number }}</span>
        </div>
    `,
    styles: `
        :host {
            display: flex;
            flex: 0 0 auto;
            flex-direction: column;
            justify-content: flex-end;
            gap: 4px;
        }

        .group-name {
            font-size: 0.8em;
            color: var(--text-color-secondary);
            text-align: left;
        }

        .reserve-count {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 6px;
            width: 86px;
            height: 80px;
            background: #0003;
            color: var(--text-color);
            font-variant-numeric: tabular-nums;
        }
    `,
})
export class ForceReservesPreviewComponent {
    readonly count = input.required<number>();
}
