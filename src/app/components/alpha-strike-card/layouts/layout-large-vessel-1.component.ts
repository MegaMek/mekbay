// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, ChangeDetectionStrategy, computed } from '@angular/core';
import { AsVesselHeaderComponent } from './vessel-header.component';
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
    selector: 'g[as-layout-large-vessel-1]',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        AsCriticalHitsAerospace1Component,
        AsCriticalHitsDropship1Component,
        AsVesselHeaderComponent,
    ],
    templateUrl: './layout-large-vessel-1.component.html',
    styleUrl: './layout-large-vessel-1.component.scss',
    host: {
        '[class.interactive]': 'interactive()',
        '[class.monochrome]': 'cardStyle() === "default"',
    }
})
export class AsLayoutLargeVessel1Component extends AsLayoutBaseComponent {
    protected readonly specialsFont = '900 33.6px Roboto';
    protected readonly rowHeight = 117.44;
    protected readonly armorY = 165.9;
    protected readonly specials = computed(() => this.layoutTextRuns(this.effectiveSpecials(),
        (item, i) => this.specialDisplayText(item, i === this.effectiveSpecials().length - 1),
        576.24 + this.measureText('SPECIAL: ', '500 33.6px Roboto'), 0, 1078.56, 40.6,
        this.specialsFont, this.measureText(' ', '400 11.2px Roboto'), 576.24));
    protected readonly specialsHeight = computed(() => this.specials().length ? this.specials().at(-1)!.y + 56.3 : 0);
    protected readonly specialsY = computed(() => 704 - this.specialsHeight());
    protected readonly specialBaseline = computed(() => this.textBaseline(this.specialsFont, 40.6));
    protected readonly statItems = computed(() => {
        const items = [
            { label: 'TP:', value: this.asStats().TP },
            { label: 'SZ:', value: String(this.asStats().SZ) },
            { label: 'THR:', value: this.movementText() },
            { label: 'SKILL:', value: this.vacant() ? 'VACANT' : String(this.skill()) },
        ].map(item => ({ ...item, width: this.measureText(item.label, '500 33.6px Roboto') + 1.12 + this.measureText(item.value, this.specialsFont) }));
        const gap = 16.8;
        let x = 0;
        return items.map(item => { const result = {...item, x}; x += item.width + gap; return result; });
    });
    protected readonly statWidth = computed(() => this.statItems().at(-1)!.x + this.statItems().at(-1)!.width);
    protected readonly statScale = computed(() => Math.min(1, 502.32 / this.statWidth()));
    protected readonly statStart = computed(() => 28 + (529.2 - this.statWidth() * this.statScale()) / 2);
    protected readonly statBaseline = computed(() => this.textBaseline('500 33.6px Roboto', 40.6));
    protected readonly imageHeight = computed(() => Math.max(0, this.specialsY() - 230.86 - 19.04));
    protected readonly pilotRuns = computed(() => this.layoutAbilityRuns(568.4, 1092));
    // Critical hits variant from layout config (first card for large vessels)
    override criticalHitsVariant = computed<CriticalHitsVariant>(() => {
        const config = getLayoutForUnitType(this.asStats().TP);
        return config.cards[0]?.criticalHits ?? 'none';
    });
}
