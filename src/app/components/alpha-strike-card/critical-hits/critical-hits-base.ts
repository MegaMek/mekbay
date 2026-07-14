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
    :host {
        display: contents;
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
        pointer-events: all;
    }


    .interactive {
        pointer-events: all;
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
    forceUnit = input<ASForceUnit>();
    cardStyle = input<'colored' | 'monochrome'>('colored');
    useHex = input<boolean>(false);
    interactive = input<boolean>(false);
    protected readonly titleGradientUrl = 'url(#critical-hits-title-gradient)';

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
