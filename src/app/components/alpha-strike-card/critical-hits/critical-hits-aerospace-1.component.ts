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
import { AsCriticalHitsBase } from './critical-hits-base';

/*
 * Author: Drake
 * 
 * Critical Hits component for large aerospace units (Card 1).
 */

@Component({
    selector: 'as-critical-hits-aerospace-1',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '[class.monochrome]': 'cardStyle() === "monochrome"',
    },
    template: `
        <div class="critical-hits-box autoheight frame">
            <div class="frame-background"></div>
            <div class="frame-content">
                <div class="critical-title frame-title-background">CRITICAL HITS</div>

                <div class="critical-row" data-crit="crew">
                    <span class="critical-name">CREW</span>
                    <div class="critical-pips">
                        @for (i of range(2); track i) {
                        <svg class="pip" 
                             [class.damaged]="isCritPipDamaged('crew', i)"
                             [class.pending-damage]="isCritPipPendingDamage('crew', i)"
                             [class.pending-heal]="isCritPipPendingHeal('crew', i)"
                             viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg>
                        }
                    </div>
                    <div class="desc-group">
                        <span class="brace">&#123;</span>
                        <span class="critical-desc">+2 Weapon To-Hit Each</span>
                        <span class="critical-desc">+2 Control Roll Each</span>
                    </div>
                </div>

                <div class="critical-row" data-crit="engine">
                    <span class="critical-name">ENGINE</span>
                    <div class="critical-pips">
                        @for (i of range(3); track i) {
                        <svg class="pip" 
                             [class.damaged]="isCritPipDamaged('engine', i)"
                             [class.pending-damage]="isCritPipPendingDamage('engine', i)"
                             [class.pending-heal]="isCritPipPendingHeal('engine', i)"
                             viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg>
                        }
                    </div>
                    <span class="critical-desc">-25%/-50%/-100% THR</span>
                </div>

                <div class="critical-row" data-crit="fire-control">
                    <span class="critical-name">FIRE CONTROL</span>
                    <div class="critical-pips">
                        @for (i of range(4); track i) {
                        <svg class="pip" 
                             [class.damaged]="isCritPipDamaged('fire-control', i)"
                             [class.pending-damage]="isCritPipPendingDamage('fire-control', i)"
                             [class.pending-heal]="isCritPipPendingHeal('fire-control', i)"
                             viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg>
                        }
                    </div>
                    <span class="critical-desc">+2 To-Hit Each</span>
                </div>

                <div class="critical-row" data-crit="thruster">
                    <span class="critical-name">THRUSTER</span>
                    <div class="critical-pips">
                        @for (i of range(1); track i) {
                        <svg class="pip" 
                             [class.damaged]="isCritPipDamaged('thruster', i)"
                             [class.pending-damage]="isCritPipPendingDamage('thruster', i)"
                             [class.pending-heal]="isCritPipPendingHeal('thruster', i)"
                             viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg>
                        }
                    </div>
                    <span class="critical-desc">-1 Thrust (THR)</span>
                </div>
                
                <div class="critical-row">
                    <span class="critical-name">WEAPONS</span>
                    <span class="critical-desc">See Back...</span>
                </div>
            </div>
        </div>
    `,
    styleUrl: './../common.scss',
    styles: [`
        :host {
            flex: 1;
        }
    `],
})
export class AsCriticalHitsAerospace1Component extends AsCriticalHitsBase {}
