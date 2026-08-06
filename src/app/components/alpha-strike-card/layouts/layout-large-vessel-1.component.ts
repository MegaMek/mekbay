// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, ChangeDetectionStrategy, computed } from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { type CriticalHitsVariant, getLayoutForUnitType } from '../card-layout.config';
import {
    AsCriticalHitsAerospace1Component,
    AsCriticalHitsDropship1Component,
} from '../critical-hits';
import { AsLayoutBaseComponent } from './layout-base.component';

/*
 *
 * Large Vessel Card 1 layout component for Alpha Strike cards.
 */

@Component({
    selector: 'as-layout-large-vessel-1',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        AsCriticalHitsAerospace1Component,
        AsCriticalHitsDropship1Component,
        UpperCasePipe,
    ],
    templateUrl: './layout-large-vessel-1.component.html',
    styleUrls: ['./layout-large-vessel-1.component.scss'],
    host: {
        '[class.interactive]': 'interactive()',
        '[class.monochrome]': 'cardStyle() === "default"',
    }
})
export class AsLayoutLargeVessel1Component extends AsLayoutBaseComponent {
    // Critical hits variant from layout config (first card for large vessels)
    override criticalHitsVariant = computed<CriticalHitsVariant>(() => {
        const config = getLayoutForUnitType(this.asStats().TP);
        return config.cards[0]?.criticalHits ?? 'none';
    });
}
