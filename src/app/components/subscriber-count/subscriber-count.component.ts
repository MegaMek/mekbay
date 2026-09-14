// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
    selector: 'subscriber-count',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'subscriber-count',
        role: 'img',
        title: 'Number of subscribers',
        '[attr.aria-label]': "count() + (count() === 1 ? ' subscriber' : ' subscribers')",
        '[style.display]': "count() > 0 ? null : 'none'",
    },
    template: `
        {{ count() }}
        <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
        </svg>`,
    styles: `
        :host {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 3px;
            min-height: 24px;
            padding: 0 8px;
            border: 1px solid var(--primary-focus-color);
            border-radius: 999px;
            color: var(--primary-focus-color);
            font-size: 0.75rem;
            font-weight: 700;
            flex-shrink: 0;
        }
        svg { width: 14px; height: 14px; flex-shrink: 0; }
    `,
})
export class SubscriberCountComponent {
    readonly count = input(0);
}
