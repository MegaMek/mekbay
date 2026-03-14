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

import { Component, ChangeDetectionStrategy } from '@angular/core';
import { AsCriticalHitsBase, CRITICAL_HITS_SHARED_STYLES } from './critical-hits-base';

const PROTOMEK_CRITICAL_HITS_STYLES = `
    :host {
        display: block;
        width: 100%;
    }

    .critical-hits-svg-shell {
        --crit-viewbox-height: 105;
        --crit-roll-width: 32;
        --critical-name-font-size: 12px;
        --critical-desc-font-size: 13.5px;
    }

    ${CRITICAL_HITS_SHARED_STYLES}
`;

/*
 * Author: Drake
 * 
 * Critical Hits component for Protomek (PM).
 */

@Component({
    selector: 'as-critical-hits-protomek',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '[class.monochrome]': 'cardStyle() === "monochrome"',
    },
    template: `
        <div class="critical-hits-svg-shell">
            @if (interactive()) {
                <button class="crit-roll-button" (click)="onRollCriticalClick($event)" aria-label="Roll critical hit">
                    <svg class="crit-roll-icon-svg" [attr.viewBox]="critRollIconViewBox" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                        <path class="crit-roll-icon-path" [attr.d]="critRollIconPath"></path>
                    </svg>
                </button>
            }
            <svg class="critical-hits-svg" viewBox="0 0 262 105" preserveAspectRatio="xMidYMid meet">
                <defs>
                    <linearGradient [attr.id]="titleGradientId" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stop-color="#5B504E" stop-opacity="0"></stop>
                        <stop offset="6.25%" stop-color="#5B504E" stop-opacity="1"></stop>
                        <stop offset="93.75%" stop-color="#5B504E" stop-opacity="1"></stop>
                        <stop offset="100%" stop-color="#5B504E" stop-opacity="0"></stop>
                    </linearGradient>
                </defs>
                <rect x="1.5" y="1.5" width="259" height="102" rx="7" ry="7" [attr.fill]="criticalHitsFill()" stroke="#221F20" stroke-width="1.5"></rect>
                @if (showCriticalTitleBar()) {
                    <rect x="50" y="6" width="162" height="22" [attr.fill]="'url(#' + titleGradientId + ')'" aria-hidden="true"></rect>
                }
                <text x="131" y="24" text-anchor="middle" class="critical-title-svg" [attr.fill]="criticalTitleFill()">CRITICAL HITS</text>

                @for (row of rows; track row.key) {
                    <g class="critical-row-svg" [attr.data-crit]="row.key" [attr.transform]="'translate(11,' + row.y + ')'">
                        <text x="68" y="13" text-anchor="end" class="critical-name-svg" [attr.fill]="criticalNameFill()">{{ row.name }}</text>

                        @if (showNumeric(row.key, row.maxPips)) {
                            <text x="81" y="14" class="critical-count-svg" [attr.fill]="pipCountFill(row.key)">{{ committedHits(row.key) }}@if (pendingChange(row.key) !== 0) {<tspan [attr.fill]="pendingDeltaFill(row.key)">{{ pendingDelta(row.key) }}</tspan>}</text>
                            <circle cx="115" cy="8" r="6.35" class="critical-pip-circle pip damaged"></circle>
                        } @else {
                            @for (pipIndex of pipIndices(row.maxPips); track pipIndex) {
                                <circle
                                    [attr.cx]="85 + (pipIndex * 16)"
                                    cy="8"
                                    r="6.35"
                                    class="critical-pip-circle pip"
                                    [class.damaged]="isDamaged(row.key, pipIndex)"
                                    [class.pending-damage]="isPendingDamage(row.key, pipIndex)"
                                    [class.pending-heal]="isPendingHeal(row.key, pipIndex)">
                                </circle>
                            }
                        }

                        <text [attr.x]="descX(row.key, row.maxPips)" y="13" class="critical-desc-svg">{{ row.description }}</text>
                    </g>
                }
            </svg>
        </div>
    `,
    styles: [PROTOMEK_CRITICAL_HITS_STYLES]
})
export class AsCriticalHitsProtomekComponent extends AsCriticalHitsBase {
    protected readonly rows = [
        { key: 'fire-control', name: 'FIRE CONTROL', description: '+2 To-Hit Each', maxPips: 4, y: 37 },
        { key: 'mp', name: 'MP', description: '½ MV Each', maxPips: 4, y: 58 },
        { key: 'weapons', name: 'WEAPONS', description: '-1 Damage Each', maxPips: 4, y: 79 },
    ] as const;

}
