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

import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import type { ASForceUnit } from '../../../models/as-force-unit.model';

export const CRITICAL_HITS_SHARED_STYLES = `
    .critical-hits-svg-shell {
        position: relative;
        width: 100%;
    }

    .critical-hits-svg {
        display: block;
        width: 100%;
        height: auto;
        overflow: visible;
    }

    .critical-title-svg {
        font-family: 'Roboto', sans-serif;
        font-size: 20px;
        font-weight: 700;
        letter-spacing: 0.2px;
    }

    .critical-name-svg {
        font-family: 'Roboto Condensed', sans-serif;
        font-size: var(--critical-name-font-size);
        font-weight: 900;
        letter-spacing: -0.2px;
    }

    .critical-desc-svg {
        fill: #000;
        font-family: 'Roboto Condensed', sans-serif;
        font-size: var(--critical-desc-font-size);
        font-weight: 600;
        letter-spacing: -0.2px;
        white-space: pre;
    }

    .critical-count-svg {
        font-family: 'Roboto Condensed', sans-serif;
        font-size: 15px;
        font-weight: 700;
    }

    .critical-pip-circle {
        fill: #fff;
        stroke: #000;
        stroke-width: 1.4;
    }

    .critical-pip-circle.damaged {
        fill: var(--damage-color);
    }

    .critical-pip-circle.pending-damage {
        fill: orange;
    }

    .critical-pip-circle.pending-heal {
        fill: #03a9f4;
    }

    .critical-row-svg {
        cursor: pointer;
    }

    .crit-roll-button {
        position: absolute;
        top: calc(100% * 4 / var(--crit-viewbox-height));
        right: calc(100% * 6 / 262);
        width: calc(100% * var(--crit-roll-width) / 262);
        height: auto;
        aspect-ratio: 1 / 1;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: none;
        background: transparent;
        cursor: pointer;
        z-index: 2;
        font-size: 0;
    }

    .crit-roll-icon-svg {
        display: block;
        width: 100%;
        height: 100%;
    }

    .crit-roll-icon-path {
        fill: #000;
    }
`;

/*
 * Author: Drake
 * 
 * Critical Hits base component.
 */
@Component({
    selector: 'as-critical-hits-base',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: ``,
})
export class AsCriticalHitsBase {
    private static nextTitleGradientId = 0;
    protected readonly critRollIconViewBox = '0 0 32 32';
    protected readonly critRollIconPath = 'M15.676 17.312h0.048c-0.114-0.273-0.263-0.539-0.436-0.78l-11.114-6.346c-0.37 0.13-0.607 0.519-0.607 1.109v9.84c0 1.034 0.726 2.291 1.621 2.808l9.168 5.294c0.544 0.314 1.026 0.282 1.32-0.023v-11.902h-0zM10.049 24.234l-1.83-1.057v-1.918l1.83 1.057v1.918zM11.605 19.993c-0.132 0.2-0.357 0.369-0.674 0.505l-0.324 0.12c-0.23 0.090-0.38 0.183-0.451 0.278-0.071 0.092-0.106 0.219-0.106 0.38v0.242l-1.83-1.056v-0.264c0-0.294 0.056-0.523 0.167-0.685 0.111-0.165 0.346-0.321 0.705-0.466l0.324-0.125c0.193-0.076 0.333-0.171 0.421-0.285 0.091-0.113 0.137-0.251 0.137-0.417 0-0.251-0.081-0.494-0.243-0.728-0.162-0.237-0.389-0.44-0.679-0.608-0.274-0.158-0.569-0.268-0.887-0.329-0.318-0.065-0.649-0.078-0.994-0.040v-1.691c0.409 0.085 0.782 0.19 1.12 0.313s0.664 0.276 0.978 0.457c0.825 0.476 1.453 1.019 1.886 1.627 0.433 0.605 0.649 1.251 0.649 1.937 0 0.352-0.066 0.63-0.198 0.834zM27.111 8.247l-9.531-5.514c-0.895-0.518-2.346-0.518-3.241 0l-9.531 5.514c-0.763 0.442-0.875 1.117-0.336 1.628l10.578 6.040c0.583 0.146 1.25 0.145 1.832-0.003l10.589-6.060c0.512-0.508 0.392-1.17-0.36-1.605zM16.305 10.417l-0.23-0.129c-0.257-0.144-0.421-0.307-0.492-0.488-0.074-0.183-0.062-0.474 0.037-0.874l0.095-0.359c0.055-0.214 0.061-0.389 0.016-0.525-0.041-0.139-0.133-0.248-0.277-0.329-0.219-0.123-0.482-0.167-0.788-0.133-0.309 0.033-0.628 0.141-0.958 0.326-0.31 0.174-0.592 0.391-0.846 0.653-0.257 0.26-0.477 0.557-0.661 0.892l-1.476-0.827c0.332-0.333 0.658-0.625 0.978-0.875s0.659-0.474 1.015-0.674c0.934-0.524 1.803-0.835 2.607-0.934 0.8-0.101 1.5 0.016 2.098 0.352 0.307 0.172 0.508 0.368 0.603 0.589 0.092 0.219 0.097 0.507 0.016 0.865l-0.1 0.356c-0.066 0.255-0.080 0.438-0.041 0.55 0.035 0.11 0.124 0.205 0.265 0.284l0.212 0.118-2.074 1.162zM18.674 11.744l-1.673-0.937 2.074-1.162 1.673 0.937-2.074 1.162zM27.747 10.174l-11.060 6.329c-0.183 0.25-0.34 0.527-0.459 0.813v11.84c0.287 0.358 0.793 0.414 1.37 0.081l9.168-5.294c0.895-0.517 1.621-1.774 1.621-2.808v-9.84c0-0.608-0.251-1.003-0.641-1.121zM23.147 23.68l-1.83 1.056v-1.918l1.83-1.057v1.918zM24.703 17.643c-0.132 0.353-0.357 0.78-0.674 1.284l-0.324 0.494c-0.23 0.355-0.38 0.622-0.451 0.799-0.071 0.174-0.106 0.342-0.106 0.503v0.242l-1.83 1.056v-0.264c0-0.294 0.056-0.587 0.167-0.878 0.111-0.294 0.346-0.721 0.705-1.279l0.324-0.5c0.193-0.298 0.333-0.555 0.421-0.771 0.091-0.218 0.137-0.409 0.137-0.575 0-0.251-0.081-0.4-0.243-0.447-0.162-0.050-0.389 0.009-0.679 0.177-0.274 0.158-0.569 0.39-0.887 0.695-0.318 0.302-0.649 0.671-0.994 1.107v-1.692c0.409-0.387 0.782-0.714 1.12-0.981s0.664-0.491 0.978-0.673c0.825-0.476 1.453-0.659 1.886-0.55 0.433 0.106 0.649 0.502 0.649 1.188 0 0.352-0.066 0.706-0.198 1.062z';

    forceUnit = input<ASForceUnit>();
    cardStyle = input<'colored' | 'monochrome'>('colored');
    useHex = input<boolean>(false);
    interactive = input<boolean>(false);
    protected readonly titleGradientId = `critical-hits-title-gradient-${AsCriticalHitsBase.nextTitleGradientId++}`;

    protected criticalHitsFill(): string {
        return this.cardStyle() === 'monochrome' ? 'rgba(255, 255, 255, 0.7)' : 'rgb(227 236 237 / 0.7)';
    }

    protected showCriticalTitleBar(): boolean {
        return this.cardStyle() !== 'monochrome';
    }

    protected criticalTitleFill(): string {
        return this.cardStyle() === 'monochrome' ? '#000' : '#fff';
    }

    protected criticalNameFill(): string {
        return this.cardStyle() === 'monochrome' ? '#000' : '#7b0000';
    }

    protected pipIndices(maxPips: number): number[] {
        return Array.from({ length: maxPips }, (_, index) => index);
    }

    protected committedHits(key: string): number {
        return this.forceUnit()?.getState().getCommittedCritHits(key) ?? 0;
    }

    protected pendingChange(key: string): number {
        return this.forceUnit()?.getState().getPendingCritChange(key) ?? 0;
    }

    protected showNumeric(key: string, maxPips: number): boolean {
        return this.totalDamaged(key) > maxPips;
    }

    protected pendingDelta(key: string): string {
        const change = this.pendingChange(key);
        if (change > 0) {
            return `+${change}`;
        }
        if (change < 0) {
            return `${change}`;
        }
        return '';
    }

    protected descX(key: string, maxPips: number): number {
        if (this.showNumeric(key, maxPips)) {
            return 121;
        }
        return 79 + (maxPips * 16) + 2.5;
    }

    protected pipCountFill(key: string): string {
        return this.isDamaged(key, 0) ? '#7b0000' : '#000';
    }

    protected pendingDeltaFill(key: string): string {
        return this.pendingChange(key) > 0 ? '#ff5722' : '#006797';
    }

    protected isDamaged(key: string, pipIndex: number): boolean {
        return pipIndex < this.committedHits(key);
    }

    protected isPendingDamage(key: string, pipIndex: number): boolean {
        const committed = this.committedHits(key);
        const pending = this.pendingChange(key);
        return pending > 0 && pipIndex >= committed && pipIndex < committed + pending;
    }

    protected isPendingHeal(key: string, pipIndex: number): boolean {
        const committed = this.committedHits(key);
        const pending = this.pendingChange(key);
        if (pending >= 0) {
            return false;
        }

        const healCount = -pending;
        const startHealIndex = Math.max(0, committed - healCount);
        return pipIndex >= startHealIndex && pipIndex < committed;
    }
    
    /** Emits when the random roll button is clicked */
    rollCritical = output<void>();
    
    onRollCriticalClick(event: MouseEvent): void {
        event.stopPropagation();
        this.rollCritical.emit();
    }

    private totalDamaged(key: string): number {
        return this.committedHits(key) + Math.max(0, this.pendingChange(key));
    }
}
