// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { BaseEntity } from '../../models/entity/base-entity';
import { constructionSummary } from '../domain/construction-summary';

@Component({
    selector: 'construction-summary',
    imports: [DecimalPipe],
    template: `
        <h2>Summary</h2>
        @if (summary(); as data) {
            <div class="summary-table"><table>
                <thead><tr><th scope="col">Item</th><th scope="col">Tonnage</th>@if (data.showCriticals) { <th scope="col">Crits</th> }<th scope="col">Availability</th></tr></thead>
                <tbody>@for (row of data.rows; track row.key) {
                    <tr><th scope="row">{{ row.label }}</th><td>{{ row.weight === null ? '—' : (row.weight | number:'1.0-3') }}</td>
                        @if (data.showCriticals) { <td>{{ row.criticals ?? '—' }}</td> }<td>{{ row.availability }}</td></tr>
                }</tbody>
                <tfoot><tr><th scope="row">Total</th><td [class.danger]="data.free < 0">{{ data.total | number:'1.0-3' }}</td>
                    @if (data.showCriticals) { <td></td> }<td>{{ data.free | number:'1.0-3' }} t free</td></tr></tfoot>
            </table></div>
            <p>Earliest possible year: <strong>{{ data.earliestYear ?? '—' }}</strong></p>
        } @else { <p>Summary unavailable for this chassis configuration.</p> }
    `,
    styles: [`
        :host { display: block; min-width: 0; }
        h2 { font-size: 14px; margin: 0 0 14px; }
        .summary-table { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; }
        th, td { padding: 5px 4px; border-bottom: 1px solid var(--border-color); text-align: right; white-space: nowrap; }
        th:first-child { text-align: left; white-space: normal; }
        tbody th { font-weight: 400; }
        thead, p { color: var(--text-color-secondary); }
        tfoot { font-weight: 600; }
        p { margin: 12px 0 0; font-size: 12px; }
        .danger { color: #ff8080; }
    `],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConstructionSummaryComponent {
    readonly entity = input.required<BaseEntity>();
    readonly summary = computed(() => { try { return constructionSummary(this.entity()); } catch { return null; } });
}
