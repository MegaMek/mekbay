// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { AsLayoutBaseComponent } from './layout-base.component';

@Component({
    selector: 'g[as-vessel-header]',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <svg viewBox="0 0 1120 800" width="1120" height="800" xmlns="http://www.w3.org/2000/svg">
        @if (showPv() && isCommander()) {
            <svg class="commander" x="31.36" y="31.2" width="94.08" height="115.99" viewBox="0 0 21.04 25.94"><g transform="rotate(180 10.52 12.97) translate(-.02)"><g transform="matrix(.265 0 0 .265 -21.1 0)"><path d="m79.7 70 39.3-70 40 70.1h-27l-13-22.1-13 22.1z"/><path d="m81.4 97.9 11.3-21.6h52.3l12 21.6z"/></g></g></svg>
        }
        <text x="31.36" [attr.y]="titleY()" class="vessel-title" [attr.font-size]="titleSize()"
            [attr.textLength]="displayTitleWidth() < titleWidth() ? displayTitleWidth() : null" lengthAdjust="spacingAndGlyphs">{{ title() }}</text>
        <text [attr.x]="subtitleX()" [attr.y]="titleY()" [attr.font-size]="subtitleSize()" class="vessel-subtitle"
            [attr.textLength]="displaySubtitleWidth() < subtitleWidth() ? displaySubtitleWidth() : null" lengthAdjust="spacingAndGlyphs">{{ subtitle() }}</text>
        @if (unit().isCustom) {
            <g [attr.transform]="'translate(' + (subtitleX() + displaySubtitleWidth() + 14) + ' ' + customBadgeTop(titleY(), subtitleSize() + 'px Roboto') + ')'">
                <rect class="custom-badge-frame" x=".56" y=".56" [attr.width]="customBadge().width - 1.12" [attr.height]="customBadge().height - 1.12" />
                <text class="custom-badge-text" x="14" [attr.y]="customBadge().baseline">CUSTOM</text>
            </g>
        }
        @if (showPv()) {
            <path d="M857.6 16.016H1103.984V100.016H902.4Z" fill="#000" />
            <text x="1004.64" [attr.y]="pvBaseline" class="pv" text-anchor="middle">{{ adjustedPV() }}</text>
            @if (basePV() !== adjustedPV()) {
                <text x="1004.64" y="133" class="base-pv" text-anchor="middle">Base PV: {{ basePV() }}</text>
            }
        }
        </svg>
    `,
    styles: `
        .vessel-title { font-family: 'Roboto Condensed', sans-serif; font-weight: 900; letter-spacing: .05em; fill: #000; stroke: #fff; stroke-width: .1em; paint-order: stroke fill; }
        .vessel-subtitle { font-family: Roboto, sans-serif; fill: #ECD24B; }
        .pv { fill: #fff; font: 900 60.48px Roboto, sans-serif; letter-spacing: .1em; }
        .base-pv { fill:#000; stroke:#fff; stroke-width:3px; paint-order:stroke fill; font:700 24.64px Roboto,sans-serif; }
        .commander { fill: #ECD24B; opacity:.6; }
        .custom-badge-frame { fill:var(--bt-yellow-background-transparent); stroke:var(--bt-yellow); stroke-width:1.12px; }
        .custom-badge-text { fill:var(--bt-yellow); font:700 28px Roboto,sans-serif; letter-spacing:1.68px; }
        :host(.monochrome) .vessel-title { font-weight:700; stroke:none; }
        :host(.monochrome) .vessel-subtitle { fill:#000; }
        :host(.monochrome) .commander { fill:#000; opacity:.3; }
    `,
    host: { '[class.monochrome]': 'cardStyle() === "default"' },
})
export class AsVesselHeaderComponent extends AsLayoutBaseComponent {
    showPv = input(true);
    protected title = computed(() => (this.forceUnit()?.alias() || this.chassis()).toUpperCase());
    protected subtitle = computed(() => [this.forceUnit()?.alias() ? this.chassis() : '', this.model()].filter(Boolean).join(' ').toUpperCase());
    protected titleSize = computed(() => this.title().length > 30 ? 39.2 : 44.8);
    protected subtitleSize = computed(() => this.forceUnit()?.alias() ? 22.4 : 33.6);
    protected availableWidth = computed(() => this.showPv() ? 820 : 1055);
    protected titleWidth = computed(() => this.measureText(this.title(), `${this.cardStyle() === 'default' ? 700 : 900} ${this.titleSize()}px "Roboto Condensed"`) + this.title().length * this.titleSize() * .05);
    protected subtitleWidth = computed(() => this.measureText(this.subtitle(), `${this.subtitleSize()}px Roboto`));
    protected badgeSpace = computed(() => this.unit().isCustom ? this.customBadge().width + 14 : 0);
    protected inlineScale = computed(() => Math.min(1,
        (this.availableWidth() - this.badgeSpace()) / (this.titleWidth() + 16.8 + this.subtitleWidth())));
    protected displayTitleWidth = computed(() => Math.min(this.titleWidth() * this.inlineScale(), this.availableWidth()));
    protected displaySubtitleWidth = computed(() => Math.min(this.subtitleWidth() * this.inlineScale(), this.availableWidth() - this.badgeSpace()));
    protected titleY = computed(() => 31.2 + this.textBaseline(`${this.titleSize()}px "Roboto Condensed"`, this.titleSize() * 1.2));
    protected subtitleX = computed(() => 31.36 + this.displayTitleWidth() + 16.8 * this.inlineScale());
    protected readonly pvBaseline = 79;
}
