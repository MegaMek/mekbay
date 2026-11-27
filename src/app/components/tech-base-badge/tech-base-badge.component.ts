// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Equipment } from '../../models/equipment.model';

@Component({
    selector: 'tech-base-badge',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `{{ techBase() === 'Clan' ? 'C' : 'IS' }}`,
    host: {
        class: 'tech-base',
        '[class.tech-is]': "techBase() === 'IS'",
        '[class.tech-clan]': "techBase() === 'Clan'",
        '[attr.title]': "techBase() === 'Clan' ? 'Clan' : 'Inner Sphere'",
        '[attr.aria-label]': "techBase() === 'Clan' ? 'Clan technology' : 'Inner Sphere technology'",
        '[style.display]': "techBase() === 'All' ? 'none' : null",
    },
    styles: `
        :host {
            box-sizing: border-box;
            width: 16px;
            height: 16px;
            margin: 0;
            display: inline-flex;
            align-self: center;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            border-radius: 3px;
            padding: 0;
            color: #fff;
            font-size: 12px;
            font-weight: bold;
            line-height: 1;
        }
        :host(.tech-is) { background-color: rgb(0, 63, 208); }
        :host(.tech-clan) { background-color: rgb(155, 0, 0); }
    `,
})
export class TechBaseBadgeComponent {
    readonly techBase = input.required<Equipment['techBase']>();
}
