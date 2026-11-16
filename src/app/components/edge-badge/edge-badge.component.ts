// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** A person's Edge points; nothing is rendered without any. */
@Component({
    selector: 'edge-badge',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '[hidden]': '!value()',
        '[attr.title]': '"Edge: " + value()',
        '[attr.aria-label]': '"Edge " + value()',
        role: 'img',
    },
    template: `<span class="label" aria-hidden="true">Edge</span><span aria-hidden="true">{{ value() }}</span>`,
    styles: `
        :host {
            display: inline-flex;
            align-items: center;
            flex-shrink: 0;
            gap: 4px;
            box-sizing: border-box;
            height: 16px;
            padding: 0 5px;
            border: 1px solid #35b8b0aa;
            background: #35b8b033;
            color: #a5f3ec;
            font-size: 11px;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
            line-height: 1;
            white-space: nowrap;
        }
        :host([hidden]) { display: none; }
        .label { font-size: 9px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; opacity: .85; }
    `,
})
export class EdgeBadgeComponent {
    readonly value = input(0);
}
