// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    Component,
    ChangeDetectionStrategy,
    computed,
} from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { type CriticalHitsVariant, getLayoutForUnitType } from '../card-layout.config';
import {
    AsCriticalHitsMekComponent,
    AsCriticalHitsVehicleComponent,
    AsCriticalHitsProtomekComponent,
    AsCriticalHitsAerofighterComponent,
    AsCriticalHitsEmplacementComponent,
    criticalHitsHeight,
} from '../critical-hits';
import { AsLayoutBaseComponent, type PipState } from './layout-base.component';
import { formatMovement, isAerospace } from '../../../utils/as-common.util';

/*
 *
 * Standard layout component for Alpha Strike cards.
 */

@Component({
    selector: 'g[as-layout-standard]',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        UpperCasePipe,
        AsCriticalHitsMekComponent,
        AsCriticalHitsProtomekComponent,
        AsCriticalHitsVehicleComponent,
        AsCriticalHitsAerofighterComponent,
        AsCriticalHitsEmplacementComponent,
    ],
    templateUrl: './layout-standard.component.html',
    styleUrl: './layout-standard.component.scss',
    host: {
        '[class.interactive]': 'interactive()',
        '[class.monochrome]': 'cardStyle() === "default"',
    }
})
export class AsLayoutStandardComponent extends AsLayoutBaseComponent {
    private static nextId = 0;
    protected readonly svgId = `as-standard-${AsLayoutStandardComponent.nextId++}`;
    protected readonly leftWidth = 611.8;
    protected readonly rightWidth = 446.88;

    // Critical hits variant from layout config (override for standard units)
    override criticalHitsVariant = computed<CriticalHitsVariant>(() => {
        const config = getLayoutForUnitType(this.asStats().TP);
        return config.cards[0]?.criticalHits ?? 'none';
    });

    verticallyCenterImage = computed<boolean>(() => {
        return this.criticalHitsVariant() !== 'mek';
    });

    reducedHeightImage = computed<boolean>(() => {
        return this.criticalHitsVariant() === 'vehicle' || this.criticalHitsVariant() === 'aerofighter';
    });

    // Sprint movement (x1.5 of ground movement)
    sprintMove = computed<string | null>(() => {
        const fu = this.forceUnit();
        if (!fu) return null;

        const effectiveMv = fu.effectiveMovement();
        const entries = this.getMovementEntries(effectiveMv);
        const groundEntries = entries.filter(([mode]) => mode !== 'j');
        if (groundEntries.length === 0) return null;

        const defaultGround = groundEntries.find(([mode]) => mode === '') ?? groundEntries[0];
        const groundMoveInches = defaultGround[1];
        if (groundMoveInches <= 0) return formatMovement(0, '', this.useHex());

        const sprintInches = Math.ceil(groundMoveInches * 1.5);
        return this.formatSprintMovementDisplay('', sprintInches);
    });

    tmmDisplay = computed<string>(() => {
        const fu = this.forceUnit();
        if (!fu) {
            const tmm = this.asStats().TMM;
            return tmm !== undefined && tmm !== null ? tmm.toString() : '';
        }
        return this.formatTmm(fu.effectiveTmm());
    });

    private formatTmm(tmm: { [mode: string]: number }): string {
        const isBM = this.asStats().TP === 'BM';
        const entries = Object.entries(tmm)
            .filter(([mode]) => !isBM || (mode !== 'a' && mode !== 'g'));
        if (entries.length === 0) return '';
        return entries
            .map(([mode, value]) => `${value}${mode}`)
            .join('/');
    }

    // Range distances
    rangeShort = computed<string>(() => this.useHex() ? '0~3' : '0"~6"');
    rangeMedium = computed<string>(() => this.useHex() ? '4~12' : '>6"~24"');
    rangeLong = computed<string>(() => this.useHex() ? '13~21' : '>24"~42"');
    rangeExtreme = computed<string>(() => this.useHex() ? '22+' : '>42"');

    // Pending heat change (delta: 0 = no change)
    pendingHeat = computed<number>(() => {
        return this.forceUnit()?.getState().pendingHeat() ?? 0;
    });

    heatTrackLevels = computed<number[]>(() => {
        return this.forceUnit()?.heatTrackLevels('committed') ?? [0, 1, 2, 3];
    });

    shutdownHeatThreshold = computed<number>(() => {
        return this.forceUnit()?.shutdownHeatThreshold('committed') ?? 4;
    });

    hasExtendedHeatTrack = computed<boolean>(() => {
        return this.heatTrackLevels().length > 4;
    });

    // Damage values affected by weapon critical hits: -1 per hit
    // Uses forceUnit's damage calculations when available

    effectiveDamageS = computed<string>(() => {
        const fu = this.forceUnit();
        if (fu) return fu.effectiveDamageS();
        return this.asStats().dmg.dmgS;
    });

    effectiveDamageM = computed<string>(() => {
        const fu = this.forceUnit();
        if (fu) return fu.effectiveDamageM();
        return this.asStats().dmg.dmgM;
    });

    effectiveDamageL = computed<string>(() => {
        const fu = this.forceUnit();
        if (fu) return fu.effectiveDamageL();
        return this.asStats().dmg.dmgL;
    });

    effectiveDamageE = computed<string>(() => {
        const fu = this.forceUnit();
        if (fu) return fu.effectiveDamageE();
        return this.asStats().dmg.dmgE;
    });

    isAerospace = computed<boolean>(() => {
        const type = this.asStats().TP;
        const movements = this.asStats().MVm;
        return isAerospace(type, movements);
    });

    // Coordinates use the card's 1120 × 800 viewBox. One former em is 11.2 units.
    protected readonly bodyLine = 40.6;
    protected readonly bodyFont = '500 33.6px Roboto';
    protected readonly valueFont = '900 33.6px Roboto';
    protected readonly padding = 13.44;
    protected readonly gap = 5.6;

    protected specialRuns = computed(() => this.layoutTextRuns(
        this.effectiveSpecials(),
        (item, index) => this.specialDisplayText(item, index === this.effectiveSpecials().length - 1),
        this.padding + this.measureText('SPECIAL: ', this.bodyFont), 0,
        1064 - this.padding, this.bodyLine, this.valueFont,
        this.measureText(' ', '400 11.2px Roboto'), this.padding,
    ));
    protected specialsHeight = computed(() => this.specialRuns().length
        ? 15.68 + this.bodyLine + (this.specialRuns().at(-1)?.y ?? 0) : 0);
    protected specialsY = computed(() => 704 - this.specialsHeight());
    protected stackBottom = computed(() => this.specialsHeight() ? this.specialsY() - this.gap : 704);

    protected armorRows = computed(() => this.pipRows(this.armorPipStates()));
    protected structureRows = computed(() => this.pipRows(this.structurePipStates()));
    protected armorRowHeight = computed(() => Math.max(this.bodyLine, this.armorRows().length * 36.96 - this.gap));
    protected structureRowHeight = computed(() => Math.max(this.bodyLine, this.structureRows().length * 36.96 - this.gap));
    protected armorHeight = computed(() => 15.68 + this.armorRowHeight() + this.structureRowHeight());
    protected armorY = computed(() => this.stackBottom() - this.armorHeight());
    protected heatY = computed(() => this.armorY() - this.gap - 66.42);
    protected damageHeight = computed(() => this.cardStyle() === 'default' ? 117.81 : 115.57);
    protected damageValueY = computed(() => this.cardStyle() === 'default' ? 42.12 : 39.88);
    protected damageY = computed(() => (this.asStats().usesOV ? this.heatY() : this.armorY()) - this.gap - this.damageHeight());

    protected statItems = computed(() => {
        const items = [
            { caption: 'TP:', value: this.asStats().TP },
            { caption: 'SZ:', value: String(this.asStats().SZ) },
            ...(!this.isAerospace() ? [{ caption: 'TMM:', value: this.tmmDisplay() }] : []),
            { caption: this.isAerospace() ? 'THR:' : 'MV:', value: this.movementText() },
        ].map(item => ({ ...item, width: this.measureText(item.caption, this.bodyFont) + 5.04 + this.measureText(item.value, this.valueFont) }));
        const available = this.leftWidth - 2 * this.padding;
        const total = items.reduce((sum, item) => sum + item.width, 0);
        const wraps = total + this.gap * (items.length - 1) > available;
        const firstRow = wraps ? items.slice(0, -1) : items;
        const spacing = firstRow.length > 1
            ? Math.max(this.gap, (available - firstRow.reduce((sum, item) => sum + item.width, 0)) / (firstRow.length - 1)) : 0;
        let x = this.padding;
        return items.map((item, index) => {
            const wrapped = wraps && index === items.length - 1;
            const positioned = { ...item, x: wrapped ? this.leftWidth - this.padding - item.width : x,
                y: wrapped ? this.bodyLine + this.gap : 0 };
            x += item.width + spacing;
            return positioned;
        });
    });
    protected statsHeight = computed(() => 15.68 + this.bodyLine * 2 + (this.statItems().at(-1)?.y ?? 0) + (this.sprintMove() ? 22.4 : 0));
    protected statsY = computed(() => this.damageY() - this.gap - this.statsHeight());
    protected chassisSmall = computed(() => 704 - this.statsY() > 536);
    protected chassisLabel = computed(() => this.forceUnit()?.alias() || this.chassis().toUpperCase());
    protected modelLabel = computed(() => this.forceUnit()?.alias()
        ? `${this.chassis()} ${this.model()}`.toUpperCase() : this.model().toUpperCase());
    protected modelSize = computed(() => this.chassisSmall() ? 36.96 : 44.8);
    protected chassisSize = computed(() => this.chassisSmall() ? 56 : this.chassisLabel().length > 20 ? 67.2 : 78.4);
    protected chassisBaseline = computed(() => 31.36 + this.modelSize() * 1.2
        + this.textBaseline(`700 ${this.chassisSize()}px "Roboto Condensed"`, this.chassisSize() * 0.95));
    protected chassisTextWidth = computed(() => {
        const width = this.measureText(this.chassisLabel().toUpperCase(), `700 ${this.chassisSize()}px "Roboto Condensed"`)
            + this.chassisLabel().length * this.chassisSize() * 0.05;
        return width > 850 ? 850 : null;
    });
    protected modelTextWidth = computed(() => {
        const available = 800 - (this.unit().isCustom ? this.customBadge().width + 14 : 0);
        return this.measureText(this.modelLabel(), `400 ${this.modelSize()}px Roboto`) > available ? available : null;
    });
    protected modelBaseline = computed(() => 31.36 + this.textBaseline(`400 ${this.modelSize()}px Roboto`, this.modelSize() * 1.2));
    protected customBadgeX = computed(() => 31.36 + (this.modelTextWidth() ?? this.measureText(this.modelLabel(), `400 ${this.modelSize()}px Roboto`)) + 14);

    protected damageRanges = computed(() => {
        const ranges = [
            { key: 'short', header: `S (0 | ${this.toHitShort()}+)`, value: this.effectiveDamageS(), distance: this.rangeShort() },
            { key: 'medium', header: `M (+2 | ${this.toHitMedium()}+)`, value: this.effectiveDamageM(), distance: this.rangeMedium() },
            { key: 'long', header: `L (+4 | ${this.toHitLong()}+)`, value: this.effectiveDamageL(), distance: this.rangeLong() },
        ];
        if (this.hasExtremeRange()) ranges.push({ key: 'extreme', header: `E (+6 | ${this.toHitExtreme()}+)`, value: this.effectiveDamageE(), distance: this.rangeExtreme() });
        const width = (this.leftWidth - 79.36 - this.padding) / ranges.length;
        return ranges.map((range, index) => ({ ...range, x: 79.36 + width * index, width, center: 79.36 + width * (index + 0.5) }));
    });

    protected heatSegments = computed(() => {
        const committed = this.heatLevel();
        const pending = committed + this.pendingHeat();
        return [...this.heatTrackLevels(), this.shutdownHeatThreshold()].map((level, index, levels) => {
            const shutdown = index === levels.length - 1;
            return { level, label: shutdown ? 'S' : String(level), shutdown,
                active: shutdown ? committed >= level : committed === level,
                pending: this.pendingHeat() !== 0 && (shutdown ? pending >= level : pending === level) };
        });
    });
    protected heatCellWidth = computed(() => this.hasExtendedHeatTrack() ? 40.768 : 49.392);
    protected heatTrackWidth = computed(() => this.heatCellWidth() * this.heatSegments().length + 3.136);
    protected heatTrackX = computed(() => this.leftWidth - this.padding - this.heatTrackWidth());
    protected heatLabelX = computed(() => {
        const ovWidth = this.measureText(`OV: ${this.asStats().OV}`, this.bodyFont);
        return (this.padding + ovWidth + this.heatTrackX()) / 2;
    });

    protected criticalHeight = computed(() => criticalHitsHeight(this.criticalHitsVariant()));
    protected criticalY = computed(() => this.stackBottom() - this.criticalHeight());
    protected abilityRuns = computed(() => this.layoutAbilityRuns(5.6, this.rightWidth));

    private pipRows(pips: PipState[]): PipState[][] {
        const available = this.leftWidth - 2 * this.padding - 33.6 - this.gap - (this.asStats().usesTh ? 67.2 : 0);
        const count = Math.max(1, Math.floor((available + this.gap) / 36.96));
        const rows: PipState[][] = [];
        for (let i = 0; i < pips.length; i += count) rows.push(pips.slice(i, i + count));
        return rows;
    }
}
