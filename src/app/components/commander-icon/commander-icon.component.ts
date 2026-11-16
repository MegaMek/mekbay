// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component } from '@angular/core';

/** The commander mark; consumers set its width and color. */
@Component({
    selector: 'commander-icon',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { 'aria-hidden': 'true' },
    template: `
        <svg viewBox="0 0 21.04 25.94" xmlns="http://www.w3.org/2000/svg" focusable="false">
            <g transform="translate(-.02)">
                <g transform="matrix(.265 0 0 .265 -21.1 0)" fill="currentColor">
                    <path d="m79.7 70 39.3-70 40 70.1h-27l-13-22.1-13 22.1z" />
                    <path d="m81.4 97.9 11.3-21.6h52.3l12 21.6z" />
                </g>
            </g>
        </svg>
    `,
    styles: `
        :host { display: inline-flex; flex-shrink: 0; width: 21px; aspect-ratio: 21.04 / 25.94; transform: rotate(180deg); }
        svg { display: block; width: 100%; height: 100%; }
    `,
})
export class CommanderIconComponent {}
