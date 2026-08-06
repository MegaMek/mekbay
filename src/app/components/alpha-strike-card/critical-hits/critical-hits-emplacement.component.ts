// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, ChangeDetectionStrategy } from '@angular/core';
import { AsCriticalHitsBase } from './critical-hits-base';
import { AsCritPipsComponent } from './crit-pips.component';

/*
 * 
 * Critical Hits component for Emplacement (BD).
 */

@Component({
    selector: 'as-critical-hits-emplacement',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [AsCritPipsComponent],
    host: {
        '[class.monochrome]': 'cardStyle() === "default"',
    },
    template: `
        <div class="critical-hits-box frame">
            <div class="frame-background"></div>
            @if (interactive()) {
                <button class="crit-roll-button" (click)="onRollCriticalClick($event)" aria-label="Roll critical hit"></button>
            }
            <div class="frame-content">
                <div class="critical-title frame-title-background">CRITICAL HITS</div>

                <div class="critical-row" data-crit="weapons">
                    <span class="critical-name">WEAPONS</span>
                    <div class="critical-pips">
                        <as-crit-pips [forceUnit]="forceUnit()" critKey="weapons" [maxPips]="4" />
                    </div>
                    <span class="critical-desc">-1 Damage Each</span>
                </div>
            </div>
        </div>
    `,
    styleUrl: './../common.scss'
})
export class AsCriticalHitsEmplacementComponent extends AsCriticalHitsBase {}
