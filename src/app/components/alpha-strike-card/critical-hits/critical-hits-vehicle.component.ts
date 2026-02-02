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
import { AsCritPipsComponent } from './crit-pips.component';

/*
 * Author: Drake
 * 
 * Critical Hits component for Combat Vehicles (CV).
 */

@Component({
    selector: 'as-critical-hits-vehicle',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [AsCritPipsComponent],
    host: {
        '[class.monochrome]': 'cardStyle() === "monochrome"',
    },
    template: `
        <div class="critical-hits-box frame">
            <div class="frame-background"></div>
            @if (interactive()) {
                <button class="crit-roll-button" (click)="onRollCriticalClick($event)" aria-label="Roll critical hit"></button>
            }
            <div class="frame-content">
                <div class="critical-title frame-title-background">CRITICAL HITS</div>

                <div class="critical-row" data-crit="engine">
                    <span class="critical-name">ENGINE</span>
                    <div class="critical-pips">
                        <as-crit-pips [forceUnit]="forceUnit()" critKey="engine" [maxPips]="2" />
                    </div>
                    <span class="critical-desc">½ MV and Damage</span>
                </div>

                <div class="critical-row" data-crit="fire-control">
                    <span class="critical-name">FIRE CONTROL</span>
                    <div class="critical-pips">
                        <as-crit-pips [forceUnit]="forceUnit()" critKey="fire-control" [maxPips]="4" />
                    </div>
                    <span class="critical-desc">+2 To-Hit Each</span>
                </div>

                <div class="critical-row" data-crit="weapons">
                    <span class="critical-name">WEAPONS</span>
                    <div class="critical-pips">
                        <as-crit-pips [forceUnit]="forceUnit()" critKey="weapons" [maxPips]="4" />
                    </div>
                    <span class="critical-desc">-1 Damage Each</span>
                </div>
                
                <div class="critical-row centered-row">
                    <span class="critical-name">MOTIVE</span>
                    <div class="critical-row centered-row" data-crit="motive1">
                        <div class="critical-pips">
                            <as-crit-pips [forceUnit]="forceUnit()" critKey="motive1" [maxPips]="2" />
                        </div>
                        <span class="critical-desc" [innerHTML]="useHex() ? '-1<span class=&quot;hex-symbol&quot;>⬢</span> MV' : '-2&quot; MV'"></span>
                    </div>
                    <div class="critical-row centered-row" data-crit="motive2">
                        <div class="critical-pips">
                            <as-crit-pips [forceUnit]="forceUnit()" critKey="motive2" [maxPips]="2" />
                        </div>
                        <span class="critical-desc">½ MV</span>
                    </div>
                    <div class="critical-row centered-row" data-crit="motive3">
                        <div class="critical-pips">
                            <as-crit-pips [forceUnit]="forceUnit()" critKey="motive3" [maxPips]="1" />
                        </div>
                        <span class="critical-desc">0 MV</span>
                    </div>
                </div>
            </div>
        </div>
    `,
    styleUrl: './../common.scss'
})
export class AsCriticalHitsVehicleComponent extends AsCriticalHitsBase { }