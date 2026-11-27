// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component } from '@angular/core';

/** The remove/delete cross; consumers set its width and color. */
@Component({
    selector: 'remove-icon',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { 'aria-hidden': 'true' },
    template: `
        <svg viewBox="0 0 1200 1200" fill="currentColor" xmlns="http://www.w3.org/2000/svg" focusable="false">
            <path
                d="M0,264.84L335.16,600L0,935.16L264.84,1200L600,864.84L935.16,1200L1200,935.16L864.84,600L1200,264.84L935.16,0L600,335.16L264.84,0L0,264.84z" />
        </svg>
    `,
    styles: `
        :host { display: inline-flex; flex-shrink: 0; width: 14px; aspect-ratio: 1; }
        svg { display: block; width: 100%; height: 100%; }
    `,
})
export class RemoveIconComponent {}
