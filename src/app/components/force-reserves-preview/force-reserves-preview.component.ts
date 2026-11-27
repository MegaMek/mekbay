// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** A count-only line; reserves are people, never synthetic force units. */
@Component({
    selector: 'force-reserves-preview',
    imports: [DecimalPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <img src="/images/helmet.svg" width="14" height="14" alt="" aria-hidden="true" />
        <span>{{ count() | number }} in reserve</span>
    `,
    styles: `
        :host {
            display: inline-flex;
            flex: 0 0 auto;
            align-items: center;
            align-self: flex-start;
            gap: 6px;
            padding: 3px 8px;
            background: #0003;
            color: var(--text-color-secondary);
            font-size: 0.8em;
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
        }

        img {
            opacity: 0.7;
        }
    `,
})
export class ForceReservesPreviewComponent {
    readonly count = input.required<number>();
}
