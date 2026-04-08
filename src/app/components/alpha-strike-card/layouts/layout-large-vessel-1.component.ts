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

import { Component, ChangeDetectionStrategy, computed } from '@angular/core';
import { type CriticalHitsVariant, getLayoutForUnitType } from '../card-layout.config';
import { AsLayoutBaseComponent, type SpecialAbilityState } from './layout-base.component';

interface CriticalRowLayout {
    key: string;
    name: string;
    description: string;
    maxPips: number;
    y: number;
}

interface CriticalLayoutConfig {
    nameX: number;
    crewY: number;
    crewLineOneY: number;
    crewLineTwoY: number;
    crewTextY: number;
    noteY: number;
    noteTextY: number;
    rows: ReadonlyArray<CriticalRowLayout>;
}

interface PositionedTextRun<T> {
    item: T;
    text: string;
    x: number;
    y: number;
}

/*
 * Author: Drake
 *
 * Large Vessel Card 1 layout component for Alpha Strike cards.
 */

@Component({
    selector: 'as-layout-large-vessel-1',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './layout-large-vessel-1.component.html',
    styleUrls: ['./layout-large-vessel-1.component.scss'],
    host: {
        '[class.interactive]': 'interactive()',
        '[class.monochrome]': 'cardStyle() === "monochrome"',
    }
})
export class AsLayoutLargeVessel1Component extends AsLayoutBaseComponent {
    private static nextSvgId = 0;

    protected readonly cardViewBoxWidth = 1120;
    protected readonly cardViewBoxHeight = 800;
    protected readonly frameStrokeWidth = 1.5;
    protected readonly frameRadius = 7;

    protected readonly leftColumnX = 28;
    protected readonly leftColumnWidth = 600;
    protected readonly rightColumnX = 665;
    protected readonly rightColumnWidth = 427;

    protected readonly statsBox = { x: 28, y: 154, width: 600, height: 70 } as const;
    protected readonly armorBox = { x: 28, y: 236, width: 600, height: 153 } as const;
    protected readonly thresholdBox = { x: 665, y: 236, width: 427, height: 70 } as const;
    protected readonly criticalBox = { x: 42, y: 406, width: 560, height: 316 } as const;
    protected readonly imageBox = { x: 665, y: 318, width: 427, height: 246 } as const;
    protected readonly specialsBox = { x: 665, y: 578, width: 427, height: 116 } as const;

    protected readonly critTitleGradientId = `large-vessel-1-crit-title-${AsLayoutLargeVessel1Component.nextSvgId}`;
    protected readonly imageClipPathId = `large-vessel-1-image-clip-${AsLayoutLargeVessel1Component.nextSvgId++}`;

    // Critical hits variant from layout config (first card for large vessels)
    override criticalHitsVariant = computed<CriticalHitsVariant>(() => {
        const config = getLayoutForUnitType(this.asStats().TP);
        return config.cards[0]?.criticalHits ?? 'none';
    });

    protected readonly critLayout = computed<CriticalLayoutConfig>(() => {
        if (this.criticalHitsVariant() === 'aerospace-1') {
            return {
                nameX: 73,
                crewY: 33.5,
                crewLineOneY: 2.5,
                crewLineTwoY: 14.5,
                crewTextY: 10.5,
                noteY: 124.5,
                noteTextY: 10.5,
                rows: [
                    { key: 'engine', name: 'ENGINE', description: '-25%/-50%/-100% THR', maxPips: 3, y: 58.5 },
                    { key: 'fire-control', name: 'FIRE CONTROL', description: '+2 To-Hit Each', maxPips: 4, y: 80.5 },
                    { key: 'thruster', name: 'THRUSTER', description: '-1 Thrust (THR)', maxPips: 1, y: 102.5 },
                ],
            };
        }

        return {
            nameX: 68,
            crewY: 33,
            crewLineOneY: 3.5,
            crewLineTwoY: 13.5,
            crewTextY: 11,
            noteY: 132,
            noteTextY: 11,
            rows: [
                { key: 'engine', name: 'ENGINE', description: '-25%/-50%/-100% THR', maxPips: 3, y: 52 },
                { key: 'fire-control', name: 'FIRE CONTROL', description: '+2 To-Hit Each', maxPips: 4, y: 68 },
                { key: 'kf-boom', name: 'KF BOOM', description: 'Cannot transport via JumpShip', maxPips: 1, y: 84 },
                { key: 'dock-collar', name: 'DOCK COLLAR', description: 'DropShip only; cannot dock', maxPips: 1, y: 100 },
                { key: 'thruster', name: 'THRUSTER', description: '-1 Thrust (THR)', maxPips: 1, y: 116 },
            ],
        };
    });

    protected readonly headerTitle = computed<string>(() => {
        const alias = this.forceUnit()?.alias()?.trim();
        return (alias || this.unit().chassis).toUpperCase();
    });

    protected readonly headerSubtitle = computed<string>(() => {
        const alias = this.forceUnit()?.alias()?.trim();
        return alias
            ? `${this.unit().chassis} ${this.unit().model}`.trim().toUpperCase()
            : this.unit().model.trim().toUpperCase();
    });

    protected readonly headerFontSize = computed<number>(() => {
        const length = this.headerTitle().length;
        if (length > 30) {
            return 46;
        }
        if (length > 23) {
            return 52;
        }
        return 58;
    });

    protected readonly headerBaselineY = computed<number>(() => {
        const fontSize = this.headerFontSize();
        if (fontSize >= 58) {
            return 86;
        }
        if (fontSize >= 52) {
            return 82;
        }
        return 78;
    });

    protected readonly subtitleOnNextLine = computed<boolean>(() => this.headerTitle().length > 24);

    protected readonly subtitleX = computed<number>(() => {
        if (this.subtitleOnNextLine()) {
            return 42;
        }

        return Math.min(42 + (this.headerTitle().length * (this.headerFontSize() * 0.56)), 555);
    });

    protected readonly subtitleY = computed<number>(() => this.subtitleOnNextLine() ? 118 : 88);

    protected readonly eraIconLayouts = computed(() => {
        const eras = this.eraAvailability().filter(item => !!item.era.icon);
        if (eras.length === 0) {
            return [];
        }

        const gap = 10;
        const maxWidth = this.rightColumnWidth - 20;
        const size = Math.min(46, (maxWidth - (gap * (eras.length - 1))) / eras.length);
        const totalWidth = (eras.length * size) + ((eras.length - 1) * gap);
        const startX = this.rightColumnX + this.rightColumnWidth - totalWidth;

        return eras.map((item, index) => ({
            ...item,
            x: startX + (index * (size + gap)),
            y: 167,
            size,
        }));
    });

    protected readonly imageLayout = computed(() => {
        const hasAbilities = this.abilityTextRuns().length > 0;
        const x = this.imageBox.x + 14;
        const y = this.imageBox.y + 16;
        const width = this.imageBox.width - 28;
        const height = hasAbilities ? 150 : 204;

        return { x, y, width, height };
    });

    protected readonly abilityTextRuns = computed<PositionedTextRun<string>[]>(() => {
        const abilities = this.pilotAbilities().map(selection => this.formatPilotAbility(selection));
        const startY = this.imageUrl() && !this.imageLoadFailed() ? this.imageBox.y + 192 : this.imageBox.y + 38;
        return this.layoutTextRuns(
            abilities,
            this.imageBox.x + 16,
            startY,
            this.imageBox.x + this.imageBox.width - 18,
            24,
            8.8,
            14,
        );
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
            this.specialsBox.x + 122,
            this.specialsBox.y + 34,
            this.specialsBox.x + this.specialsBox.width - 18,
            26,
            10.4,
            16,
            this.specialsBox.x + 18,
        ).map(run => ({
            item: run.item.state,
            text: run.item.text,
            x: run.x,
            y: run.y,
        }));
    });

    protected readonly showImage = computed<boolean>(() => !!this.imageUrl() && !this.imageLoadFailed());

    protected readonly critRollIconViewBox = '0 0 32 32';
    protected readonly critRollIconPath = 'M15.676 17.312h0.048c-0.114-0.273-0.263-0.539-0.436-0.78l-11.114-6.346c-0.37 0.13-0.607 0.519-0.607 1.109v9.84c0 1.034 0.726 2.291 1.621 2.808l9.168 5.294c0.544 0.314 1.026 0.282 1.32-0.023v-11.902h-0zM10.049 24.234l-1.83-1.057v-1.918l1.83 1.057v1.918zM11.605 19.993c-0.132 0.2-0.357 0.369-0.674 0.505l-0.324 0.12c-0.23 0.090-0.38 0.183-0.451 0.278-0.071 0.092-0.106 0.219-0.106 0.38v0.242l-1.83-1.056v-0.264c0-0.294 0.056-0.523 0.167-0.685 0.111-0.165 0.346-0.321 0.705-0.466l0.324-0.125c0.193-0.076 0.333-0.171 0.421-0.285 0.091-0.113 0.137-0.251 0.137-0.417 0-0.251-0.081-0.494-0.243-0.728-0.162-0.237-0.389-0.44-0.679-0.608-0.274-0.158-0.569-0.268-0.887-0.329-0.318-0.065-0.649-0.078-0.994-0.040v-1.691c0.409 0.085 0.782 0.19 1.12 0.313s0.664 0.276 0.978 0.457c0.825 0.476 1.453 1.019 1.886 1.627 0.433 0.605 0.649 1.251 0.649 1.937 0 0.352-0.066 0.63-0.198 0.834zM27.111 8.247l-9.531-5.514c-0.895-0.518-2.346-0.518-3.241 0l-9.531 5.514c-0.763 0.442-0.875 1.117-0.336 1.628l10.578 6.04c0.583 0.146 1.25 0.145 1.832-0.003l10.589-6.06c0.512-0.508 0.392-1.17-0.36-1.605zM16.305 10.417l-0.23-0.129c-0.257-0.144-0.421-0.307-0.492-0.488-0.074-0.183-0.062-0.474 0.037-0.874l0.095-0.359c0.055-0.214 0.061-0.389 0.016-0.525-0.041-0.139-0.133-0.248-0.277-0.329-0.219-0.123-0.482-0.167-0.788-0.133-0.309 0.033-0.628 0.141-0.958 0.326-0.31 0.174-0.592 0.391-0.846 0.653-0.257 0.26-0.477 0.557-0.661 0.892l-1.476-0.827c0.332-0.333 0.658-0.625 0.978-0.875s0.659-0.474 1.015-0.674c0.934-0.524 1.803-0.835 2.607-0.934 0.8-0.101 1.5 0.016 2.098 0.352 0.307 0.172 0.508 0.368 0.603 0.589 0.092 0.219 0.097 0.507 0.016 0.865l-0.1 0.356c-0.066 0.255-0.08 0.438-0.041 0.55 0.035 0.11 0.124 0.205 0.265 0.284l0.212 0.118-2.074 1.162zM18.674 11.744l-1.673-0.937 2.074-1.162 1.673 0.937-2.074 1.162zM27.747 10.174l-11.06 6.329c-0.183 0.25-0.34 0.527-0.459 0.813v11.84c0.287 0.358 0.793 0.414 1.37 0.081l9.168-5.294c0.895-0.517 1.621-1.774 1.621-2.808v-9.84c0-0.608-0.251-1.003-0.641-1.121zM23.147 23.68l-1.83 1.056v-1.918l1.83-1.057v1.918zM24.703 17.643c-0.132 0.353-0.357 0.78-0.674 1.284l-0.324 0.494c-0.23 0.355-0.38 0.622-0.451 0.799-0.071 0.174-0.106 0.342-0.106 0.503v0.242l-1.83 1.056v-0.264c0-0.294 0.056-0.587 0.167-0.878 0.111-0.294 0.346-0.721 0.705-1.279l0.324-0.5c0.193-0.298 0.333-0.555 0.421-0.771 0.091-0.218 0.137-0.409 0.137-0.575 0-0.251-0.081-0.4-0.243-0.447-0.162-0.05-0.389 0.009-0.679 0.177-0.274 0.158-0.569 0.39-0.887 0.695-0.318 0.302-0.649 0.671-0.994 1.107v-1.692c0.409-0.387 0.782-0.714 1.12-0.981s0.664-0.491 0.978-0.673c0.825-0.476 1.453-0.659 1.886-0.55 0.433 0.106 0.649 0.502 0.649 1.188 0 0.352-0.066 0.706-0.198 1.062z';

    protected vesselFrameFill(): string {
        return this.cardStyle() === 'monochrome' ? 'rgba(255, 255, 255, 0.7)' : 'rgb(227 236 237 / 0.7)';
    }

    protected headerTitleFill(): string {
        return this.cardStyle() === 'monochrome' ? '#000' : '#d22027';
    }

    protected headerTitleStroke(): string {
        return this.cardStyle() === 'monochrome' ? 'none' : '#fff';
    }

    protected accentTextFill(): string {
        return this.cardStyle() === 'monochrome' ? '#000' : '#ECD24B';
    }

    protected critTitleFill(): string {
        return this.cardStyle() === 'monochrome' ? '#000' : '#fff';
    }

    protected critNameFill(): string {
        return this.cardStyle() === 'monochrome' ? '#000' : '#7b0000';
    }

    protected movementSvgText(): string {
        return this.movementDisplay().replace(/<span[^>]*>(.*?)<\/span>/g, '$1');
    }

    protected critCommittedHits(key: string): number {
        return this.forceUnit()?.getState().getCommittedCritHits(key) ?? 0;
    }

    protected critPendingChange(key: string): number {
        return this.forceUnit()?.getState().getPendingCritChange(key) ?? 0;
    }

    protected critTotalDamaged(key: string): number {
        return this.critCommittedHits(key) + Math.max(0, this.critPendingChange(key));
    }

    protected critShowNumeric(key: string, maxPips: number): boolean {
        return this.critTotalDamaged(key) > maxPips;
    }

    protected critPendingDelta(key: string): string {
        const change = this.critPendingChange(key);
        if (change > 0) {
            return `+${change}`;
        }
        if (change < 0) {
            return `${change}`;
        }
        return '';
    }

    protected critPendingDeltaFill(key: string): string {
        return this.critPendingChange(key) > 0 ? '#ff5722' : '#006797';
    }

    protected critCountFill(key: string): string {
        return this.isCritPipDamaged(key, 0) ? '#7b0000' : '#000';
    }

    protected critDescX(key: string, maxPips: number): number {
        return this.critShowNumeric(key, maxPips) ? 121 : 79 + (maxPips * 16) + 2.5;
    }

    protected vesselDamageValue(track: 'armor' | 'structure'): string {
        return track === 'armor'
            ? `${this.committedArmorDamage()}`
            : `${this.committedInternalDamage()}`;
    }

    protected vesselPendingValue(track: 'armor' | 'structure'): string {
        const value = track === 'armor' ? this.pendingArmorChange() : this.pendingInternalChange();
        if (value === 0) {
            return '';
        }
        return value > 0 ? `+${value}` : `${value}`;
    }

    protected hasVesselDamageDisplay(track: 'armor' | 'structure'): boolean {
        const committed = track === 'armor' ? this.committedArmorDamage() : this.committedInternalDamage();
        const pending = track === 'armor' ? this.pendingArmorChange() : this.pendingInternalChange();
        return committed > 0 || pending > 0;
    }

    private specialDisplayText(state: SpecialAbilityState, isLast: boolean): string {
        const remaining = state.maxCount && state.consumedCount ? `[${state.maxCount - state.consumedCount}]` : '';
        return `${state.effective}${remaining}${isLast ? '' : ','}`;
    }

    private layoutTextRuns<T>(
        items: ReadonlyArray<T>,
        startX: number,
        startY: number,
        rightX: number,
        lineHeight: number,
        charWidth: number,
        gap: number,
        wrapX: number = startX,
    ): PositionedTextRun<T>[] {
        const result: PositionedTextRun<T>[] = [];
        let x = startX;
        let y = startY;

        for (const item of items) {
            const text = typeof item === 'string' ? item : (item as { text: string }).text;
            const estimatedWidth = Math.max(24, text.length * charWidth);
            if (x + estimatedWidth > rightX) {
                x = wrapX;
                y += lineHeight;
            }

            result.push({ item, text, x, y });
            x += estimatedWidth + gap;
        }

        return result;
    }
}
