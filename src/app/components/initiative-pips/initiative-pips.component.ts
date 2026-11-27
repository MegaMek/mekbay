// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import type { InitiativePip } from '../../services/initiative.service';

/** Dots to a compact row. The rows are cut here, not by the container's width, so they always nest. */
const COMPACT_ROW = 7;

/**
 * A step's acting order as pips: one per unit, friendly circles and opposing diamonds, greyed once acted, the
 * unit to act ringed. Compact for the turn tracker, large in dialogs. Interactive pips are one control that
 * picks the unit to act.
 */
@Component({
    selector: 'initiative-pips',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '[class.large]': 'size() === "large"',
        '[class.interactive]': 'interactive()',
        '[attr.role]': 'interactive() ? "button" : "list"',
        '[attr.tabindex]': 'interactive() ? 0 : null',
        '[attr.aria-label]': 'interactive() ? "Select the unit that acts now" : "Acting order"',
        '[attr.title]': 'interactive() ? "Select the unit that acts now" : null',
        '(click)': 'interactive() && activate.emit()',
        '(keydown.enter)': 'interactive() && activate.emit()',
        '(keydown.space)': 'interactive() && activate.emit(); $event.preventDefault()',
    },
    template: `
        @for (row of rows(); track $index) {
            <span class="row" role="none">
                @for (pip of row; track $index) {
                    <span class="dot" [attr.role]="interactive() ? null : 'listitem'" [class.hostile]="!pip.friendly"
                        [class.done]="pip.done" [class.next]="pip.next" [attr.title]="interactive() ? null : title(pip)"></span>
                }
            </span>
        }
    `,
    styleUrl: './initiative-pips.component.scss',
})
export class InitiativePipsComponent {
    readonly pips = input.required<readonly InitiativePip[]>();
    readonly size = input<'compact' | 'large'>('compact');
    /** The pips together pick the unit to act. */
    readonly interactive = input(false);
    readonly activate = output<void>();

    /** Large pips wrap in one row; compact ones in rows of {@link COMPACT_ROW}. */
    protected readonly rows = computed(() => {
        const pips = this.pips();
        if (this.size() === 'large') return [pips];
        const rows: (readonly InitiativePip[])[] = [];
        for (let start = 0; start < pips.length; start += COMPACT_ROW) rows.push(pips.slice(start, start + COMPACT_ROW));
        return rows;
    });

    protected title(pip: InitiativePip): string {
        return `${pip.friendly ? 'Friendly' : 'Opposing'} · ${pip.done ? 'acted' : pip.next ? 'acts now' : 'waiting'}`;
    }
}
