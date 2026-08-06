// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, ChangeDetectionStrategy } from '@angular/core';
import { AsCriticalHitsBase } from './critical-hits-base';
import { AsCritPipsComponent } from './crit-pips.component';

/*
 * 
 * Critical Hits component for large aerospace units (Card 1).
 */

@Component({
    selector: 'as-critical-hits-aerospace-1',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [AsCritPipsComponent],
    host: {
        '[class.monochrome]': 'cardStyle() === "default"',
    },
    template: `
        <div class="critical-hits-box autoheight frame">
            <div class="frame-background"></div>
            @if (interactive()) {
                <button class="crit-roll-button" (click)="onRollCriticalClick($event)" aria-label="Roll critical hit"></button>
            }
            <div class="frame-content">
                <div class="critical-title frame-title-background">CRITICAL HITS</div>

                <div class="critical-row" data-crit="crew">
                    <span class="critical-name">CREW</span>
                    <div class="critical-pips">
                        <as-crit-pips [forceUnit]="forceUnit()" critKey="crew" [maxPips]="2" />
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
                        <as-crit-pips [forceUnit]="forceUnit()" critKey="engine" [maxPips]="3" />
                    </div>
                    <span class="critical-desc">-25%/-50%/-100% THR</span>
                </div>

                <div class="critical-row" data-crit="fire-control">
                    <span class="critical-name">FIRE CONTROL</span>
                    <div class="critical-pips">
                        <as-crit-pips [forceUnit]="forceUnit()" critKey="fire-control" [maxPips]="4" />
                    </div>
                    <span class="critical-desc">+2 To-Hit Each</span>
                </div>

                <div class="critical-row" data-crit="thruster">
                    <span class="critical-name">THRUSTER</span>
                    <div class="critical-pips">
                        <as-crit-pips [forceUnit]="forceUnit()" critKey="thruster" [maxPips]="1" />
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
