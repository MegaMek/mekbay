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

import { Component, ChangeDetectionStrategy, NO_ERRORS_SCHEMA } from '@angular/core';
import { AsCriticalHitsBase, CRITICAL_HITS_SHARED_STYLES } from './critical-hits-base';

const EMPLACEMENT_CRITICAL_HITS_STYLES = `
    :host {
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
    selector: 'g[as-critical-hits-emplacement]',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '[class.monochrome]': 'cardStyle() === "monochrome"',
    },
    schemas: [NO_ERRORS_SCHEMA],
    template: `
                <rect x="1.5" y="1.5" width="259" height="59" rx="7" ry="7" [attr.fill]="criticalHitsFill()" stroke="#221F20" stroke-width="1.5"></rect>
                @if (showCriticalTitleBar()) {
                    <rect x="50" y="6" width="162" height="22" [attr.fill]="titleGradientUrl" aria-hidden="true"></rect>
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
    `,
    styles: [EMPLACEMENT_CRITICAL_HITS_STYLES]
})
export class AsCriticalHitsEmplacementComponent extends AsCriticalHitsBase {
}
