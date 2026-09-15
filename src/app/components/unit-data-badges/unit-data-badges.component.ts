// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TooltipDirective } from '../../directives/tooltip.directive';
import type { UnitSummary } from '../../models/unit-summary.model';
import type { TooltipLine } from '../tooltip/tooltip.component';

@Component({
    selector: 'unit-data-badges',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TooltipDirective],
    template: `
        @if (loadIssues().length) {
            <span class="load-issue-badge" [tooltip]="loadIssuesTooltip()" tooltipType="error"
                role="img" aria-label="Unit has data issues">!</span>
        }
        @if (updateAvailable()) {
            <span class="unit-update-badge" tooltip="A newer version of this custom unit is available."
                role="img" aria-label="Unit update available">↻</span>
        }
    `,
    styleUrl: './unit-data-badges.component.scss',
})
export class UnitDataBadgesComponent {
    readonly loadIssues = input<UnitSummary['loadIssues']>([]);
    readonly updateAvailable = input(false);
    readonly loadIssuesTooltip = computed<TooltipLine[]>(() => this.loadIssues().map(issue => ({
        value: `${issue.severity === 'error' ? 'Error' : 'Warning'}: ${issue.message}`,
    })));
}
