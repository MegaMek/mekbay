// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';

import type { ConstructionBreakdownData } from '../domain/construction-breakdowns';

@Component({
    selector: 'construction-breakdown',
    imports: [DecimalPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <header><div><h2>{{ data().title }}</h2><span class="report-total">{{ data().total | number:'1.0-3' }} <small>{{ data().unit }}</small></span></div><button type="button" class="close-button" cdkFocusInitial (click)="closed.emit()" aria-label="Close breakdown"></button></header>
        <div class="report-scroll"><table>
            <colgroup><col class="item-column"><col><col class="value-column"></colgroup>
            <thead><tr><th>Item</th><th>Calculation</th><th>{{ data().unit }}</th></tr></thead>
            <tbody>@for (row of data().rows; track $index) {
                <tr><th [style.padding-left.px]="10 + (row.depth ?? 0) * 16">{{ row.label }}</th>
                    <td>{{ row.calculation }}</td><td>{{ row.value === undefined ? '' : (row.value | number:'1.0-3') }}</td></tr>
            }</tbody>
        </table></div>`,
    styleUrl: './construction-breakdown.component.scss',
})
export class ConstructionBreakdownComponent {
    readonly data = input.required<ConstructionBreakdownData>();
    readonly closed = output<void>();
}
