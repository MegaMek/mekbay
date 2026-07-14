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
import { AsLayoutBaseComponent, type PipState, type PositionedTextRun } from './layout-base.component';
import { formatMovement, isAerospace } from '../../../utils/as-common.util';
import type { SpecialAbilityState } from '../../../models/as-special-ability-state.model';

/*
 * Author: Drake
 *
 * Standard layout component for Alpha Strike cards.
 */

@Component({
    selector: 'as-layout-standard, g[as-layout-standard]',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        UpperCasePipe,
    ],
    templateUrl: './layout-standard.component.html',
    styleUrls: ['./layout-standard.component.scss'],
    host: {
        '[class.interactive]': 'interactive()',
        '[class.night-mode]': 'cardStyle() !== "monochrome"',
    }
})
export class AsLayoutStandardComponent extends AsLayoutBaseComponent {
    private static nextDamageGradientId = 0;
    private static nextHeatGradientId = 0;
    private readonly criticalTableScale = 1.8;
    private readonly stackBottomY = 480;
    private readonly stackGap = 8;
    private readonly statsBoxHeight = 112;
    private readonly damageBoxHeight = 118;
    private readonly specialsBoxX = 20;
    private readonly specialsBoxWidth = 1063;
    private readonly specialsBoxBaseHeight = 49;
    private readonly specialsLineHeight = 32;

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

    protected damageRanges = computed(() => {
        const hasExtremeRange = this.hasExtremeRange();
        const leftMargin = 132;
        const rightMargin = 28;
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
                headerWidth: columnWidth + (isFirst || isLast ? 14 : 0),
                headerGradient: this.damageHeaderGradientStops(isFirst, isLast, isThin),
            };
        });
    });

    protected damageBoxViewBoxWidth = computed<number>(() => {
        return 612;
    });

    protected armorBoxViewBoxWidth = computed<number>(() => {
        return 612;
    });

    protected armorPipRows = computed(() => {
        return this.buildArmorPipRows(this.armorPipStates(), 0);
    });

    protected structurePipRows = computed(() => {
        return this.buildArmorPipRows(this.structurePipStates(), this.armorPipRows().length);
    });

    protected armorBoxViewBoxHeight = computed<number>(() => {
        const allRows = [...this.armorPipRows(), ...this.structurePipRows()];
        const lastRowY = allRows.at(-1)?.centerY ?? 65;
        return Math.max(94, lastRowY + 28);
    });

    protected heatBoxViewBoxWidth = computed<number>(() => {
        return 612;
    });

    protected heatBoxViewBoxHeight = computed<number>(() => {
        return 65;
    });

    protected readonly specialTextRuns = computed<PositionedTextRun<SpecialAbilityState>[]>(() => {
        const specials = this.effectiveSpecials();
        if (specials.length === 0) {
            return [];
        }

        return this.layoutTextRuns(
            specials.map((state, index) => ({
                state,
                text: this.specialDisplayText(state, index === specials.length - 1),
            })),
            this.specialsBoxX + 190,
            this.specialsBoxY() + 37,
            this.specialsBoxX + this.specialsBoxWidth - 16,
            this.specialsLineHeight,
            17,
            12,
            this.specialsBoxX + 16,
        ).map(run => ({
            item: run.item.state,
            text: run.item.text,
            x: run.x,
            y: run.y,
        }));
    });

    protected statsBoxY(): number {
        return this.damageBoxY() - this.stackGap - this.statsBoxHeight;
    }

    protected damageBoxY(): number {
        const nextBoxY = this.asStats().usesOV ? this.heatBoxY() : this.armorBoxY();
        return nextBoxY - this.stackGap - this.damageBoxHeight;
    }

    protected heatBoxY(): number {
        return this.armorBoxY() - this.stackGap - this.heatBoxViewBoxHeight();
    }

    protected armorBoxY(): number {
        return this.mainStackBottomY() - this.armorBoxViewBoxHeight();
    }

    protected criticalTableY(): number {
        return this.mainStackBottomY() - this.criticalTableHeight();
    }

    protected specialsBoxY(): number {
        return this.stackBottomY - this.specialsBoxHeight();
    }

    protected specialsBoxHeight(): number {
        if (this.effectiveSpecials().length === 0) {
            return 0;
        }

        return this.specialsBoxBaseHeight + ((this.specialsLineCount() - 1) * this.specialsLineHeight);
    }

    private mainStackBottomY(): number {
        return this.effectiveSpecials().length > 0 ? this.specialsBoxY() - this.stackGap : this.stackBottomY;
    }

    private specialsLineCount(): number {
        const specials = this.effectiveSpecials();
        if (specials.length === 0) {
            return 0;
        }

        const runs = this.layoutTextRuns(
            specials.map((state, index) => ({
                state,
                text: this.specialDisplayText(state, index === specials.length - 1),
            })),
            this.specialsBoxX + 190,
            0,
            this.specialsBoxX + this.specialsBoxWidth - 16,
            this.specialsLineHeight,
            17,
            12,
            this.specialsBoxX + 16,
        );

        return Math.max(1, new Set(runs.map(run => run.y)).size);
    }

    protected heatTrackStartX = computed<number>(() => {
        return 377;
    });

    protected heatTrackStartY = computed<number>(() => {
        return 13;
    });

    protected heatTrackHeight = computed<number>(() => {
        return 45;
    });

    protected heatTitleBandX = computed<number>(() => {
        return 132;
    });

    protected heatTitleBandY = computed<number>(() => {
        return 16;
    });

    protected heatTitleBandWidth = computed<number>(() => {
        return 228;
    });

    protected heatTitleBandHeight = computed<number>(() => {
        return 34;
    });

    protected heatTitleCenterX = computed<number>(() => {
        return this.heatTitleBandX() + (this.heatTitleBandWidth() / 2);
    });

    protected heatTitleTextY = computed<number>(() => {
        return 36;
    });

    protected heatCellInset = computed<number>(() => {
        return 1.1;
    });

    protected heatCellInnerHeight = computed<number>(() => {
        return Math.max(0, this.heatTrackHeight() - (this.heatCellInset() * 2));
    });

    protected heatTrackSegments = computed(() => {
        const pendingHeatDelta = this.pendingHeat();
        const currentHeat = this.heatLevel();
        const effectiveHeat = currentHeat + pendingHeatDelta;
        const heatLevels = this.heatTrackLevels();
        const shutdownHeatThreshold = this.shutdownHeatThreshold();
        const heatSegments = [
            ...heatLevels.map((heatValue) => ({ key: heatValue.toString(), label: heatValue.toString(), heatValue, isShutdown: false })),
            { key: 'S', label: 'S', heatValue: shutdownHeatThreshold, isShutdown: true },
        ];
        const segmentWidth = Math.min(43, 224 / heatSegments.length);

        return heatSegments.map((segment, index) => {
            return {
                key: segment.key,
                label: segment.label,
                heatValue: segment.heatValue,
                x: index * segmentWidth,
                width: segmentWidth,
                active: segment.isShutdown ? currentHeat >= segment.heatValue : currentHeat === segment.heatValue,
                pending: pendingHeatDelta !== 0 && (segment.isShutdown ? effectiveHeat >= segment.heatValue : effectiveHeat === segment.heatValue),
                roundLeft: index === 0,
                roundRight: index === heatSegments.length - 1,
            };
        });
    });

    protected heatTrackTotalWidth = computed<number>(() => {
        const levels = this.heatTrackSegments();
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

    protected heatLevelFill(level: { active: boolean; key: string; heatValue: number }): string {
        if (!level.active || level.key === '0') {
            return 'transparent';
        }

        if (level.key === '1') {
            return 'rgb(255, 200, 0)';
        }

        if (level.key === '2') {
            return 'rgb(255, 150, 0)';
        }

        if (level.key === '3') {
            return 'rgb(255, 100, 0)';
        }

        return 'rgb(255, 0, 0)';
    }

    protected isSpecialExhausted(item: SpecialAbilityState): boolean {
        return item.isExhausted || !!(item.maxCount && (item.consumedCount ?? 0) >= item.maxCount);
    }

    protected criticalTableHeight(): number {
        switch (this.criticalHitsVariant()) {
            case 'mek':
            case 'vehicle':
                return this.critical(123);
            case 'protomek':
            case 'aerofighter':
                return this.critical(102);
            case 'emplacement':
                return this.critical(59);
            default:
                return 0;
        }
    }

    protected criticalRows = computed(() => {
        switch (this.criticalHitsVariant()) {
            case 'mek':
                return [
                    { key: 'engine', name: 'ENGINE', description: '+1 Heat/Firing Weapons', maxPips: 2, y: 37 },
                    { key: 'fire-control', name: 'FIRE CONTROL', description: '+2 TN Each', maxPips: 4, y: 58 },
                    { key: 'mp', name: 'MP', description: '1/2 MV Each', maxPips: 4, y: 79 },
                    { key: 'weapons', name: 'WEAPONS', description: '-1 Damage Each', maxPips: 4, y: 100 },
                ];
            case 'vehicle':
                return [
                    { key: 'engine', name: 'ENGINE', description: '1/2 MV and Damage', maxPips: 2, y: 37 },
                    { key: 'fire-control', name: 'FIRE CONTROL', description: '+2 To-Hit Each', maxPips: 4, y: 58 },
                    { key: 'weapons', name: 'WEAPONS', description: '-1 Damage Each', maxPips: 4, y: 79 },
                ];
            case 'protomek':
                return [
                    { key: 'fire-control', name: 'FIRE CONTROL', description: '+2 To-Hit Each', maxPips: 4, y: 37 },
                    { key: 'mp', name: 'MP', description: '1/2 MV Each', maxPips: 4, y: 58 },
                    { key: 'weapons', name: 'WEAPONS', description: '-1 Damage Each', maxPips: 4, y: 79 },
                ];
            case 'aerofighter':
                return [
                    { key: 'engine', name: 'ENGINE', description: '1/2 THR (Minimum 1)', maxPips: 2, y: 37 },
                    { key: 'fire-control', name: 'FIRE CONTROL', description: '+2 To-Hit Each', maxPips: 4, y: 58 },
                    { key: 'weapons', name: 'WEAPONS', description: '-1 Damage Each', maxPips: 4, y: 79 },
                ];
            case 'emplacement':
                return [
                    { key: 'weapons', name: 'WEAPONS', description: '-1 Damage Each', maxPips: 4, y: 37 },
                ];
            default:
                return [];
        }
    });

    protected vehicleMotiveRows = [
        { key: 'motive1', x: 85, maxPips: 2, firstPipX: 0, descX: 24, numericCircleX: 34, numericDescX: 47 },
        { key: 'motive2', x: 149, maxPips: 2, firstPipX: 0, descX: 25, numericCircleX: 34, numericDescX: 47 },
        { key: 'motive3', x: 210, maxPips: 1, firstPipX: 0, descX: 9, numericCircleX: 18, numericDescX: 31 },
    ] as const;

    protected critical(value: number): number {
        return value * this.criticalTableScale;
    }

    protected criticalPipIndices(maxPips: number): number[] {
        return Array.from({ length: maxPips }, (_, index) => index);
    }

    protected criticalHitsFill(): string {
        return this.armorBoxFill();
    }

    protected showCriticalTitleBar(): boolean {
        return !this.isMonochrome();
    }

    protected criticalTitleFill(): string {
        return this.isMonochrome() ? '#000' : '#fff';
    }

    protected criticalNameFill(): string {
        return this.asValueFill();
    }

    protected committedCriticalHits(key: string): number {
        return this.forceUnit()?.getState().getCommittedCritHits(key) ?? 0;
    }

    protected pendingCriticalChange(key: string): number {
        return this.forceUnit()?.getState().getPendingCritChange(key) ?? 0;
    }

    protected showCriticalNumeric(key: string, maxPips: number): boolean {
        return this.committedCriticalHits(key) + Math.max(0, this.pendingCriticalChange(key)) > maxPips;
    }

    protected criticalPendingDelta(key: string): string {
        const change = this.pendingCriticalChange(key);
        if (change > 0) {
            return `+${change}`;
        }
        if (change < 0) {
            return `${change}`;
        }
        return '';
    }

    protected criticalDescX(key: string, maxPips: number): number {
        if (this.showCriticalNumeric(key, maxPips)) {
            return this.critical(121);
        }
        return this.critical(79 + (maxPips * 16) + 2.5);
    }

    protected criticalPipCountFill(key: string): string {
        return this.isCriticalDamaged(key, 0) ? '#7b0000' : '#000';
    }

    protected criticalPendingDeltaFill(key: string): string {
        return this.pendingCriticalChange(key) > 0 ? '#ff5722' : '#006797';
    }

    protected isCriticalDamaged(key: string, pipIndex: number): boolean {
        return pipIndex < this.committedCriticalHits(key);
    }

    protected isCriticalPendingDamage(key: string, pipIndex: number): boolean {
        const committed = this.committedCriticalHits(key);
        const pending = this.pendingCriticalChange(key);
        return pending > 0 && pipIndex >= committed && pipIndex < committed + pending;
    }

    protected isCriticalPendingHeal(key: string, pipIndex: number): boolean {
        const committed = this.committedCriticalHits(key);
        const pending = this.pendingCriticalChange(key);
        if (pending >= 0) {
            return false;
        }

        const healCount = -pending;
        const startHealIndex = Math.max(0, committed - healCount);
        return pipIndex >= startHealIndex && pipIndex < committed;
    }

    protected motiveDescription(key: string): string {
        switch (key) {
            case 'motive1':
                return this.useHex() ? '-1 hex MV' : '-2\" MV';
            case 'motive2':
                return '1/2 MV';
            case 'motive3':
                return '0 MV';
            default:
                return '';
        }
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

    protected asValueFill(): string {
        return this.isMonochrome() ? '#000' : '#7b0000';
    }

    protected nightModeImageFilter(): string {
        return this.cardStyle() === 'monochrome' ? 'none' : 'saturate(0) invert(1) brightness(1.25)';
    }

    protected pilotAbilityY(index: number): number {
        return Math.floor(index / 4) * 28;
    }

    protected armorPipRadius(): number {
        return 14;
    }

    protected armorStructurePipX(index: number): number {
        return 71 + (index * 36);
    }

    protected armorBoxThrustLabelX(): number {
        return this.armorBoxViewBoxWidth() - 71;
    }

    protected armorBoxThrustValueX(): number {
        return this.armorBoxViewBoxWidth() - 53;
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

        return this.armorStructurePipX(pipCount - 1) + 17;
    }

    protected damageTypeHitAreaY(rows: Array<{ centerY: number }>): number {
        if (rows.length === 0) {
            return 5;
        }

        return rows[0].centerY - 17;
    }

    protected damageTypeHitAreaHeight(rows: Array<{ centerY: number }>): number {
        if (rows.length === 0) {
            return 34;
        }

        return (rows[rows.length - 1].centerY + 17) - (rows[0].centerY - 17);
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
            const centerY = 26 + (visualRowIndex * 39);

            return {
                centerY,
                captionY: centerY + 12,
                pips: pips.slice(start, end),
            };
        });
    }

    private maxArmorPipsPerRow(): number {
        return this.asStats().usesTh ? 11 : 15;
    }
}