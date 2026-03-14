/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import {
    Component,
    ChangeDetectionStrategy,
    computed,
    signal,
    inject,
    ElementRef,
    DestroyRef,
    afterNextRender,
    viewChild,
} from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { type CriticalHitsVariant, getLayoutForUnitType } from '../card-layout.config';
import {
    AsCriticalHitsMekComponent,
    AsCriticalHitsVehicleComponent,
    AsCriticalHitsProtomekComponent,
    AsCriticalHitsAerofighterComponent,
    AsCriticalHitsEmplacementComponent,
} from '../critical-hits';
import { AsLayoutBaseComponent, type PipState } from './layout-base.component';
import { formatMovement, isAerospace } from '../../../utils/as-common.util';

/*
 * Author: Drake
 *
 * Standard layout component for Alpha Strike cards.
 */

@Component({
    selector: 'as-layout-standard',
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
    styleUrls: ['./layout-standard.component.scss'],
    host: {
        '[class.interactive]': 'interactive()',
        '[class.monochrome]': 'cardStyle() === "monochrome"',
    }
})
export class AsLayoutStandardComponent extends AsLayoutBaseComponent {
    private static nextDamageGradientId = 0;
    private static nextHeatGradientId = 0;

    private readonly elRef = inject(ElementRef<HTMLElement>);
    private readonly destroyRef = inject(DestroyRef);
    private readonly statsContainerRef = viewChild('statsContainer', { read: ElementRef<HTMLElement> });
    private readonly damageGradientIdPrefix = `damage-range-header-${AsLayoutStandardComponent.nextDamageGradientId++}`;
    private readonly heatGradientId = `heat-scale-title-${AsLayoutStandardComponent.nextHeatGradientId++}`;

    private readonly statsToHostHeightThreshold = 0.67;
    private resizeObserver: ResizeObserver | null = null;
    chassisSmall = signal(false);

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
        return formatMovement(sprintInches, '', this.useHex());
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

    protected damageRanges = computed(() => {
        const hasExtremeRange = this.hasExtremeRange();
        const leftMargin = 74;
        const rightMargin = 16;
        const width = this.damageBoxViewBoxWidth() - leftMargin - rightMargin;
        const columns = hasExtremeRange ? 4 : 3;
        const columnWidth = width / columns;

        const ranges = [
            { key: 'short', label: 'S', modifier: '0', toHit: this.toHitShort(), value: this.effectiveDamageS(), distance: this.rangeShort() },
            { key: 'medium', label: 'M', modifier: '+2', toHit: this.toHitMedium(), value: this.effectiveDamageM(), distance: this.rangeMedium() },
            { key: 'long', label: 'L', modifier: '+4', toHit: this.toHitLong(), value: this.effectiveDamageL(), distance: this.rangeLong() },
        ];

        if (hasExtremeRange) {
            ranges.push({ key: 'extreme', label: 'E', modifier: '+6', toHit: this.toHitExtreme(), value: this.effectiveDamageE(), distance: this.rangeExtreme() });
        }

        return ranges.map((range, index) => {
            const centerX = leftMargin + (columnWidth * index) + (columnWidth / 2);
            const isFirst = index === 0;
            const isLast = index === ranges.length - 1;
            const isThin = isFirst ? hasExtremeRange : isLast;

            return {
                key: range.key,
                header: `${range.label} (${range.modifier} | ${range.toHit}+)`,
                value: range.value,
                distance: range.distance,
                centerX,
                headerWidth: columnWidth + (isFirst || isLast ? 8 : 0),
                headerGradient: this.damageHeaderGradientStops(isFirst, isLast, isThin),
            };
        });
    });

    protected damageBoxViewBoxWidth = computed<number>(() => {
        return this.hasExtremeRange() ? 430 : 345;
    });

    protected armorBoxViewBoxWidth = computed<number>(() => {
        return 345;
    });

    protected armorPipRows = computed(() => {
        return this.buildArmorPipRows(this.armorPipStates(), 0);
    });

    protected structurePipRows = computed(() => {
        return this.buildArmorPipRows(this.structurePipStates(), this.armorPipRows().length);
    });

    protected armorBoxViewBoxHeight = computed<number>(() => {
        const allRows = [...this.armorPipRows(), ...this.structurePipRows()];
        const lastRowY = allRows.at(-1)?.centerY ?? 40;
        return Math.max(58, lastRowY + 17);
    });

    protected heatBoxViewBoxWidth = computed<number>(() => {
        return 345;
    });

    protected heatBoxViewBoxHeight = computed<number>(() => {
        return 40;
    });

    protected heatTrackStartX = computed<number>(() => {
        return 212;
    });

    protected heatTrackStartY = computed<number>(() => {
        return 8;
    });

    protected heatTrackHeight = computed<number>(() => {
        return 28;
    });

    protected heatTitleBandX = computed<number>(() => {
        return 74;
    });

    protected heatTitleBandY = computed<number>(() => {
        return 10;
    });

    protected heatTitleBandWidth = computed<number>(() => {
        return 128;
    });

    protected heatTitleBandHeight = computed<number>(() => {
        return 21;
    });

    protected heatTitleCenterX = computed<number>(() => {
        return this.heatTitleBandX() + (this.heatTitleBandWidth() / 2);
    });

    protected heatTitleTextY = computed<number>(() => {
        return 22;
    });

    protected heatCellInset = computed<number>(() => {
        return 1.1;
    });

    protected heatCellInnerHeight = computed<number>(() => {
        return Math.max(0, this.heatTrackHeight() - (this.heatCellInset() * 2));
    });

    protected heatTrackLevels = computed(() => {
        const pendingHeatDelta = this.pendingHeat();
        const currentHeat = this.heatLevel();
        const effectiveHeat = currentHeat + pendingHeatDelta;
        const hotDog = this.forceUnit()?.hasHotDog() ?? false;
        const keys = hotDog ? ['0', '1', '2', '3', '4', 'S'] as const : ['0', '1', '2', '3', 'S'] as const;
        const segmentWidth = hotDog ? 21 : 24;

        return keys.map((key, index) => {
            const isShutdown = key === 'S';
            const heatValue = isShutdown ? (hotDog ? 5 : 4) : Number(key);

            return {
                key,
                label: key,
                x: index * segmentWidth,
                width: segmentWidth,
                active: isShutdown ? currentHeat >= heatValue : currentHeat === heatValue,
                pending: pendingHeatDelta !== 0 && (isShutdown ? effectiveHeat >= heatValue : effectiveHeat === heatValue),
                roundLeft: index === 0,
                roundRight: index === keys.length - 1,
            };
        });
    });

    protected heatTrackTotalWidth = computed<number>(() => {
        const levels = this.heatTrackLevels();
        if (levels.length === 0) {
            return 0;
        }

        const lastLevel = levels[levels.length - 1];
        return lastLevel.x + lastLevel.width;
    });

    protected heatLevelPath(width: number, roundLeft: boolean, roundRight: boolean): string {
        const inset = this.heatCellInset();
        const x = inset;
        const y = inset;
        const innerWidth = Math.max(0, width - (inset * 2));
        const innerHeight = this.heatCellInnerHeight();
        const radius = Math.min(6, innerWidth / 2, innerHeight / 2);

        if (innerWidth <= 0 || innerHeight <= 0) {
            return '';
        }

        if (roundLeft && roundRight) {
            return [
                `M ${x + radius} ${y}`,
                `H ${x + innerWidth - radius}`,
                `A ${radius} ${radius} 0 0 1 ${x + innerWidth} ${y + radius}`,
                `V ${y + innerHeight - radius}`,
                `A ${radius} ${radius} 0 0 1 ${x + innerWidth - radius} ${y + innerHeight}`,
                `H ${x + radius}`,
                `A ${radius} ${radius} 0 0 1 ${x} ${y + innerHeight - radius}`,
                `V ${y + radius}`,
                `A ${radius} ${radius} 0 0 1 ${x + radius} ${y}`,
                'Z'
            ].join(' ');
        }

        if (roundLeft) {
            return [
                `M ${x + radius} ${y}`,
                `H ${x + innerWidth}`,
                `V ${y + innerHeight}`,
                `H ${x + radius}`,
                `A ${radius} ${radius} 0 0 1 ${x} ${y + innerHeight - radius}`,
                `V ${y + radius}`,
                `A ${radius} ${radius} 0 0 1 ${x + radius} ${y}`,
                'Z'
            ].join(' ');
        }

        if (roundRight) {
            return [
                `M ${x} ${y}`,
                `H ${x + innerWidth - radius}`,
                `A ${radius} ${radius} 0 0 1 ${x + innerWidth} ${y + radius}`,
                `V ${y + innerHeight - radius}`,
                `A ${radius} ${radius} 0 0 1 ${x + innerWidth - radius} ${y + innerHeight}`,
                `H ${x}`,
                'Z'
            ].join(' ');
        }

        return [
            `M ${x} ${y}`,
            `H ${x + innerWidth}`,
            `V ${y + innerHeight}`,
            `H ${x}`,
            'Z'
        ].join(' ');
    }

    isAerospace = computed<boolean>(() => {
        const type = this.asStats().TP;
        const movements = this.asStats().MVm;
        return isAerospace(type, movements);
    });

    constructor() {
        super();
        const afterRenderRef = afterNextRender(() => {
            const hostEl = this.elRef.nativeElement;
            const statsEl = this.statsContainerRef()?.nativeElement;
            if (!hostEl || !statsEl) return;

            this.resizeObserver?.disconnect();
            this.resizeObserver = new ResizeObserver(() => {
                this.updateChassisSmallClass();
            });

            this.resizeObserver.observe(hostEl);
            this.resizeObserver.observe(statsEl);

            // Initial calculation after layout.
            requestAnimationFrame(() => {
                this.updateChassisSmallClass();
            });
        });

        this.destroyRef.onDestroy(() => {
            afterRenderRef.destroy();
            this.resizeObserver?.disconnect();
        });
    }

    private updateChassisSmallClass(): void {
        const hostEl = this.elRef.nativeElement;
        const statsEl = this.statsContainerRef()?.nativeElement;
        if (!hostEl || !statsEl) {
            this.chassisSmall.set(false);
            return;
        }

        const hostHeight = hostEl.clientHeight;
        if (hostHeight <= 0) {
            this.chassisSmall.set(false);
            return;
        }

        const ratio = statsEl.clientHeight / hostHeight;
        this.chassisSmall.set(ratio > this.statsToHostHeightThreshold);
    }

    protected armorBoxFill(): string {
        return this.cardStyle() === 'monochrome' ? 'rgba(255, 255, 255, 0.7)' : 'rgb(227 236 237 / 0.7)';
    }

    protected isMonochrome(): boolean {
        return this.cardStyle() === 'monochrome';
    }

    protected armorStructurePipX(index: number): number {
        return 40 + (index * 20);
    }

    protected armorBoxThrustLabelX(): number {
        return this.armorBoxViewBoxWidth() - 40;
    }

    protected armorBoxThrustValueX(): number {
        return this.armorBoxViewBoxWidth() - 30;
    }

    protected armorBoxThrustLabelY(): number {
        return Math.max(20, (this.armorBoxViewBoxHeight() / 2) - 10);
    }

    protected armorBoxThrustValueY(): number {
        return this.armorBoxThrustLabelY() + 30;
    }

    protected armorRowHitAreaWidth(pipCount: number): number {
        if (pipCount <= 0) {
            return 60;
        }

        return this.armorStructurePipX(pipCount - 1) + 14;
    }

    protected damageTypeHitAreaY(rows: Array<{ centerY: number }>): number {
        if (rows.length === 0) {
            return 5;
        }

        return rows[0].centerY - 11;
    }

    protected damageTypeHitAreaHeight(rows: Array<{ centerY: number }>): number {
        if (rows.length === 0) {
            return 22;
        }

        return (rows[rows.length - 1].centerY + 11) - (rows[0].centerY - 11);
    }

    protected damageTypeHitAreaWidth(rows: Array<{ pips: PipState[] }>): number {
        if (rows.length === 0) {
            return 60;
        }

        return Math.max(...rows.map((row) => this.armorRowHitAreaWidth(row.pips.length)));
    }

    protected damageHeaderGradientId(key: string): string {
        return `${this.damageGradientIdPrefix}-${key}`;
    }

    protected heatTitleGradientId(): string {
        return this.heatGradientId;
    }

    private damageHeaderGradientStops(isFirst: boolean, isLast: boolean, isThin: boolean): {
        startOffset: string;
        solidStartOffset: string;
        solidEndOffset: string;
        endOffset: string;
    } {
        if (isFirst) {
            return {
                startOffset: '0%',
                solidStartOffset: isThin ? '8%' : '20%',
                solidEndOffset: '100%',
                endOffset: '100%',
            };
        }

        if (isLast) {
            return {
                startOffset: '0%',
                solidStartOffset: '0%',
                solidEndOffset: isThin ? '92%' : '80%',
                endOffset: '100%',
            };
        }

        return {
            startOffset: '0%',
            solidStartOffset: '0%',
            solidEndOffset: '100%',
            endOffset: '100%',
        };
    }

    private buildArmorPipRows(pips: PipState[], rowOffset: number): Array<{
        centerY: number;
        captionY: number;
        pips: PipState[];
    }> {
        const maxPerRow = this.maxArmorPipsPerRow();
        const rows = Math.max(1, Math.ceil(pips.length / maxPerRow));

        return Array.from({ length: rows }, (_, rowIndex) => {
            const start = rowIndex * maxPerRow;
            const end = start + maxPerRow;
            const visualRowIndex = rowOffset + rowIndex;
            const centerY = 16 + (visualRowIndex * 24);

            return {
                centerY,
                captionY: centerY + 7.5,
                pips: pips.slice(start, end),
            };
        });
    }

    private maxArmorPipsPerRow(): number {
        return this.asStats().usesTh ? 11 : 15;
    }
}