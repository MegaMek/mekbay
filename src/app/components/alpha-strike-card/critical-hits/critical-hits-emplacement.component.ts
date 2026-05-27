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

const EMPLACEMENT_CRITICAL_HITS_STYLES = `
    :host {
        display: block;
        width: 100%;
    }

    .critical-hits-svg-shell {
        --crit-viewbox-height: 62;
        --crit-roll-width: 32;
        --critical-name-font-size: 12px;
        --critical-desc-font-size: 13.5px;
    }

    ${CRITICAL_HITS_SHARED_STYLES}
`;

/*
 * Author: Drake
 * 
 * Critical Hits component for Emplacement (BD).
 */

@Component({
    selector: 'as-critical-hits-emplacement',
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
            <svg class="critical-hits-svg" viewBox="0 0 262 62" preserveAspectRatio="xMidYMid meet">
                <defs>
                    <linearGradient [attr.id]="titleGradientId" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stop-color="#5B504E" stop-opacity="0"></stop>
                        <stop offset="6.25%" stop-color="#5B504E" stop-opacity="1"></stop>
                        <stop offset="93.75%" stop-color="#5B504E" stop-opacity="1"></stop>
                        <stop offset="100%" stop-color="#5B504E" stop-opacity="0"></stop>
                    </linearGradient>
                </defs>
                <rect x="1.5" y="1.5" width="259" height="59" rx="7" ry="7" [attr.fill]="criticalHitsFill()" stroke="#221F20" stroke-width="1.5"></rect>
                @if (showCriticalTitleBar()) {
                    <rect x="50" y="6" width="162" height="22" [attr.fill]="'url(#' + titleGradientId + ')'" aria-hidden="true"></rect>
                }
                <text x="131" y="24" text-anchor="middle" class="critical-title-svg" [attr.fill]="criticalTitleFill()">CRITICAL HITS</text>

                <g class="critical-row-svg" data-crit="weapons" transform="translate(11,37)">
                    <text x="68" y="13" text-anchor="end" class="critical-name-svg" [attr.fill]="criticalNameFill()">WEAPONS</text>

                    @if (showNumeric('weapons', 4)) {
                        <text x="81" y="14" class="critical-count-svg" [attr.fill]="pipCountFill('weapons')">{{ committedHits('weapons') }}@if (pendingChange('weapons') !== 0) {<tspan [attr.fill]="pendingDeltaFill('weapons')">{{ pendingDelta('weapons') }}</tspan>}</text>
                        <circle cx="115" cy="8" r="6.35" class="critical-pip-circle pip damaged"></circle>
                    } @else {
                        @for (pipIndex of pipIndices(4); track pipIndex) {
                            <circle
                                [attr.cx]="85 + (pipIndex * 16)"
                                cy="8"
                                r="6.35"
                                class="critical-pip-circle pip"
                                [class.damaged]="isDamaged('weapons', pipIndex)"
                                [class.pending-damage]="isPendingDamage('weapons', pipIndex)"
                                [class.pending-heal]="isPendingHeal('weapons', pipIndex)">
                            </circle>
                        }
                    }

                    <text x="145.5" y="13" class="critical-desc-svg">-1 Damage Each</text>
                </g>
            </svg>
        </div>
    `,
    styles: [EMPLACEMENT_CRITICAL_HITS_STYLES]
})
export class AsCriticalHitsEmplacementComponent extends AsCriticalHitsBase {
}
