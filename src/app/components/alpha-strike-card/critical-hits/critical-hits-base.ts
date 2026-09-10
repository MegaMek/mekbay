// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Directive, ElementRef, DestroyRef, afterNextRender, afterRenderEffect, computed, inject, input, output, signal, viewChild, viewChildren } from '@angular/core';
import type { ASForceUnit } from '../../../models/as-force-unit.model';
import type { ColorScheme } from '../../../models/options.model';
import type { CriticalHitsVariant } from '../card-layout.config';
import { AsCritPipsComponent } from './crit-pips.component';

type CriticalTableVariant = Exclude<CriticalHitsVariant, 'none' | 'aerospace-2' | 'dropship-2'>;

interface CriticalHitRow {
    key?: string;
    name: string;
    maxPips?: number;
    description?: string;
    secondDescription?: string;
    motive?: boolean;
}

const FIRE_CONTROL: CriticalHitRow = { key: 'fire-control', name: 'FIRE CONTROL', maxPips: 4, description: '+2 To-Hit Each' };
const WEAPONS: CriticalHitRow = { key: 'weapons', name: 'WEAPONS', maxPips: 4, description: '-1 Damage Each' };
const MP: CriticalHitRow = { key: 'mp', name: 'MP', maxPips: 4, description: '½ MV Each' };
const CREW: CriticalHitRow = { key: 'crew', name: 'CREW', maxPips: 2, description: '+2 Weapon To-Hit Each', secondDescription: '+2 Control Roll Each' };
const VESSEL_ENGINE: CriticalHitRow = { key: 'engine', name: 'ENGINE', maxPips: 3, description: '-25%/-50%/-100% THR' };
const THRUSTER: CriticalHitRow = { key: 'thruster', name: 'THRUSTER', maxPips: 1, description: '-1 Thrust (THR)' };
const BACK_WEAPONS: CriticalHitRow = { name: 'WEAPONS', description: 'See Back...' };

const CRITICAL_HITS_ROWS: Record<CriticalTableVariant, readonly CriticalHitRow[]> = {
    mek: [
        { key: 'engine', name: 'ENGINE', maxPips: 2, description: '+1 Heat/Firing Weapons' },
        { ...FIRE_CONTROL, description: '+2 TN Each' }, MP, WEAPONS,
    ],
    vehicle: [
        { key: 'engine', name: 'ENGINE', maxPips: 2, description: '½ MV and Damage' },
        FIRE_CONTROL, WEAPONS, { name: 'MOTIVE', motive: true },
    ],
    protomek: [FIRE_CONTROL, MP, WEAPONS],
    aerofighter: [
        { key: 'engine', name: 'ENGINE', maxPips: 2, description: '½ THR (Minimum 1)' },
        FIRE_CONTROL, WEAPONS,
    ],
    emplacement: [WEAPONS],
    'aerospace-1': [CREW, VESSEL_ENGINE, FIRE_CONTROL, THRUSTER, BACK_WEAPONS],
    'dropship-1': [
        CREW, VESSEL_ENGINE, FIRE_CONTROL,
        { key: 'kf-boom', name: 'KF BOOM', maxPips: 1, description: 'Cannot transport via JumpShip' },
        { key: 'dock-collar', name: 'DOCK COLLAR', maxPips: 1, description: 'DropShip only; cannot dock' },
        THRUSTER, BACK_WEAPONS,
    ],
};

// Geometry preserves the original card's em-based typography at a 1120px viewBox.
const EM = 11.2;
const TITLE_HEIGHT = 3.497;
const ROW_HEIGHT = 2.72;
const PADDING_HEIGHT = 1.7;

function isVessel(variant: CriticalTableVariant): boolean {
    return variant === 'aerospace-1' || variant === 'dropship-1';
}

/** Natural SVG height shared with the layout that stacks this table. */
export function criticalHitsHeight(variant: CriticalHitsVariant): number {
    if (variant === 'none' || variant === 'aerospace-2' || variant === 'dropship-2') return 0;
    const rows = CRITICAL_HITS_ROWS[variant];
    const rowHeight = rows.reduce((total, row) => total + ROW_HEIGHT * (row.secondDescription ? 2 : 1), 0);
    return EM * (PADDING_HEIGHT + TITLE_HEIGHT + rowHeight + rows.length * (isVessel(variant) ? 0.1 : 0.8));
}

export const CRITICAL_HITS_TEMPLATE = `
    <svg:g transform="scale(11.2)">
        <svg:defs>
            <svg:linearGradient [attr.id]="titleGradientId">
                <svg:stop offset="0" stop-color="#5B504E" stop-opacity="0" />
                <svg:stop offset="6.09%" stop-color="#5B504E" />
                <svg:stop offset="93.91%" stop-color="#5B504E" />
                <svg:stop offset="100%" stop-color="#5B504E" stop-opacity="0" />
            </svg:linearGradient>
        </svg:defs>
        <svg:rect class="critical-frame" x="0.15" y="0.15" [attr.width]="localWidth() - 0.3"
            [attr.height]="localHeight() - 0.3" rx="1.45" [attr.fill]="cardStyle() === 'default' ? '#fff' : '#E3ECED'" />
        @if (cardStyle() !== 'default') {
            <svg:rect [attr.x]="localWidth() / 2 - 11.7413" y="0.7" width="23.4826" height="3.497"
                [attr.fill]="'url(#' + titleGradientId + ')'" />
        }
        <svg:text [attr.x]="localWidth() / 2" y="3.4259" text-anchor="middle" class="critical-title"
            [attr.fill]="cardStyle() === 'default' ? '#000' : '#fff'">CRITICAL HITS</svg:text>

        @for (row of positionedRows(); track $index) {
            <svg:g [attr.transform]="'translate(0,' + row.y + ')'">
                @if (row.motive) {
                    <svg:g [attr.transform]="'translate(' + (localWidth() - motiveWidth()) / 2 + ',0)'">
                        <svg:text #motiveText x="0" y="0.68359375" class="critical-name">MOTIVE</svg:text>
                        <svg:g data-crit="motive1" [class.interactive]="interactive()" [attr.transform]="'translate(' + motiveX(0) + ',0)'">
                            <svg:rect x="-0.2" y="-1.36" [attr.width]="motiveX(1) - motiveX(0) - 0.3" height="2.72" fill="transparent" />
                            <svg:g as-crit-pips #motiveOne [forceUnit]="forceUnit()" critKey="motive1" [maxPips]="2" />
                            <svg:text #motiveText [attr.x]="motiveOne.width() + 0.46" y="0.7861328125" class="critical-desc">@if (useHex()) {-1<svg:tspan class="hex-symbol" dy="-0.552">⬢</svg:tspan><svg:tspan dy="0.552"> MV</svg:tspan>} @else {-2″ MV}</svg:text>
                        </svg:g>
                        <svg:g data-crit="motive2" [class.interactive]="interactive()"
                            [attr.transform]="'translate(' + motiveX(1) + ',0)'">
                            <svg:rect x="-0.2" y="-1.36" [attr.width]="motiveX(2) - motiveX(1) - 0.3" height="2.72" fill="transparent" />
                            <svg:g as-crit-pips #motiveTwo [forceUnit]="forceUnit()" critKey="motive2" [maxPips]="2" />
                            <svg:text #motiveText [attr.x]="motiveTwo.width() + 0.46" y="0.7861328125" class="critical-desc">½ MV</svg:text>
                        </svg:g>
                        <svg:g data-crit="motive3" [class.interactive]="interactive()"
                            [attr.transform]="'translate(' + motiveX(2) + ',0)'">
                            <svg:rect x="-0.2" y="-1.36" [attr.width]="motiveWidth() - motiveX(2) + 0.2" height="2.72" fill="transparent" />
                            <svg:g as-crit-pips #motiveThree [forceUnit]="forceUnit()" critKey="motive3" [maxPips]="1" />
                            <svg:text #motiveText [attr.x]="motiveThree.width() + 0.46" y="0.7861328125" class="critical-desc">0 MV</svg:text>
                        </svg:g>
                    </svg:g>
                } @else {
                    <svg:g [attr.data-crit]="row.key ?? null" [class.interactive]="interactive() && row.key">
                        @if (row.key) {
                            <svg:rect x="1.2" [attr.y]="row.secondDescription ? -2.72 : -1.36"
                                [attr.width]="localWidth() - 2.4" [attr.height]="row.secondDescription ? 5.44 : 2.72" fill="transparent" />
                        }
                        <svg:text x="12.8" y="0.68359375" text-anchor="end" class="critical-name">{{ row.name }}</svg:text>
                        @if (row.key) {
                            <svg:g as-crit-pips #pips transform="translate(13.2,0)"
                                [forceUnit]="forceUnit()" [critKey]="row.key" [maxPips]="row.maxPips ?? 0" />
                            @if (row.secondDescription) {
                                <svg:text [attr.x]="13.2 + pips.width() + 0.48" y="1.3671875" class="critical-brace">&#123;</svg:text>
                                <svg:text [attr.x]="13.2 + pips.width() + 2.06" y="-0.5738671875" class="critical-desc">{{ row.description }}</svg:text>
                                <svg:text [attr.x]="13.2 + pips.width() + 2.06" y="2.1461328125" class="critical-desc">{{ row.secondDescription }}</svg:text>
                            } @else {
                                <svg:text [attr.x]="13.2 + pips.width() + 0.46" y="0.7861328125" class="critical-desc">{{ row.description }}</svg:text>
                            }
                        } @else {
                            <svg:text x="13.66" y="0.7861328125" class="critical-desc">{{ row.description }}</svg:text>
                        }
                    </svg:g>
                }
            </svg:g>
        }
        @if (interactive()) {
            <svg:g class="crit-roll-button screen-only" data-screen-only="true" role="button" tabindex="0" aria-label="Roll critical hit"
                (click)="onRollCriticalClick($event)" (keydown.enter)="onRollCriticalClick($event)" (keydown.space)="onRollCriticalClick($event)"
                [attr.transform]="'translate(' + (localWidth() - 5.2) + ',0.2)'">
                <svg:image href="/images/random-black.svg" width="5" height="5" />
                <svg:rect width="5" height="5" fill="transparent" />
            </svg:g>
        }
    </svg:g>
`;

export const CRITICAL_HITS_STYLES = `
    .critical-frame { stroke: #221F20; stroke-width: 0.3; opacity: 0.7; }
    .critical-title { font-family: 'Roboto', sans-serif; font-size: 2.86px; font-weight: 700; }
    .critical-name { font-family: 'Roboto Condensed', sans-serif; font-size: 2px; font-weight: 900; letter-spacing: -0.06px; fill: #7b0000; }
    .critical-desc { font-family: 'Roboto Condensed', sans-serif; font-size: 2.3px; font-weight: 600; letter-spacing: -0.115px; fill: #000; white-space: pre; }
    .critical-brace { font-family: 'Roboto Condensed', sans-serif; font-size: 4px; fill: #000; }
    .hex-symbol { font-size: 1.84px; }
    .interactive, .crit-roll-button { cursor: pointer; }
    .crit-roll-button:hover, .crit-roll-button:focus { filter: invert(0.4); }
    @media print { .screen-only { display: none; } .critical-name { fill: #000; } }
`;

let nextCriticalTableId = 0;

@Directive()
export abstract class AsCriticalHitsBase {
    forceUnit = input<ASForceUnit>();
    cardStyle = input<ColorScheme>('default');
    useHex = input(false);
    interactive = input(false);
    width = input(446.88);
    height = input<number>();
    rollCritical = output<void>();

    protected abstract readonly variant: CriticalTableVariant;
    protected readonly titleGradientId = `critical-hits-title-${nextCriticalTableId++}`;
    private readonly motiveTexts = viewChildren<ElementRef<SVGTextElement>>('motiveText');
    private readonly motivePipsOne = viewChild<AsCritPipsComponent>('motiveOne');
    private readonly motivePipsTwo = viewChild<AsCritPipsComponent>('motiveTwo');
    private readonly motivePipsThree = viewChild<AsCritPipsComponent>('motiveThree');
    private readonly motiveTextWidths = signal([6.4, 6, 5, 5]);
    protected readonly localWidth = computed(() => this.width() / EM);
    protected readonly localHeight = computed(() => (this.height() ?? criticalHitsHeight(this.variant)) / EM);
    protected readonly positionedRows = computed(() => {
        const rows = CRITICAL_HITS_ROWS[this.variant];
        const contentsHeight = rows.reduce((total, row) => total + ROW_HEIGHT * (row.secondDescription ? 2 : 1), 0);
        const gap = isVessel(this.variant)
            ? Math.max(0.1, (this.localHeight() - PADDING_HEIGHT - TITLE_HEIGHT - contentsHeight) / rows.length)
            : 0.8;
        let y = 0.7 + TITLE_HEIGHT;
        return rows.map(row => {
            const height = ROW_HEIGHT * (row.secondDescription ? 2 : 1);
            y += gap + height;
            return { ...row, y: y - height / 2 };
        });
    });

    constructor() {
        const destroyRef = inject(DestroyRef);
        afterRenderEffect(() => {
            this.useHex();
            this.measureMotiveText();
        });
        afterNextRender(() => {
            void document.fonts.ready.then(() => {
                if (!destroyRef.destroyed) this.measureMotiveText();
            });
        });
    }

    private measureMotiveText(): void {
        const elements = this.motiveTexts();
        if (elements.length) this.motiveTextWidths.set(elements.map(element => element.nativeElement.getComputedTextLength()));
    }

    private motivePipWidth(index: number): number {
        return [this.motivePipsOne(), this.motivePipsTwo(), this.motivePipsThree()][index]?.width() ?? (index === 2 ? 2.14 : 4.58);
    }

    protected motiveX(index: number): number {
        const widths = this.motiveTextWidths();
        let x = widths[0] + 0.4;
        for (let i = 0; i < index; i++) x += this.motivePipWidth(i) + 0.46 + widths[i + 1] + 0.5;
        return x;
    }

    // Center the complete motive line, including an overflow count or hex symbol.
    protected motiveWidth(): number {
        return this.motiveX(2) + this.motivePipWidth(2) + 0.46 + this.motiveTextWidths()[3];
    }

    onRollCriticalClick(event: Event): void {
        event.preventDefault();
        event.stopPropagation();
        this.rollCritical.emit();
    }
}
