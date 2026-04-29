/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { Force } from '../../models/force.model';
import { GameSystem } from '../../models/common.model';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { CleanModelStringPipe } from '../../pipes/clean-model-string.pipe';
import { OptionsService } from '../../services/options.service';
import { CommonModule } from '@angular/common';
import { getFactionImg } from '../../models/factions.model';

/*
 * Author: Drake
 *
 * Reusable force preview component that displays a force's header (name, faction icon,
 * game type badge, BV/PV) and a scrollable row of unit thumbnails grouped by unit group.
 */
@Component({
    selector: 'force-preview',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, UnitIconComponent, CleanModelStringPipe],
    template: `
    @let unitDisplayName = optionsService.options().unitDisplayName;
    @let f = force();
    @let era = f.era();
    <div class="force-preview-header">
        <div class="faction-name-wrapper">
            @if (factionImg(); as factionImgUrl) {
                <img [src]="factionImgUrl" class="faction-icon" />
            }
            @if (era?.img || era?.icon; as eraImg) {
                <img [src]="eraImg" class="era-icon" [alt]="era?.name || 'Era'" [title]="era?.name || 'Era'" />
            }
            <span class="force-preview-name">{{ f.displayName() }}</span>
        </div>
        <span class="force-preview-info">
            <span class="game-type-badge" [class.as]="f.gameSystem === GameSystem.ALPHA_STRIKE">
                {{ f.gameSystem === GameSystem.ALPHA_STRIKE ? 'AS' : 'CBT' }}
            </span>
            @if (f.gameSystem === GameSystem.ALPHA_STRIKE) {
                <span class="force-bv">PV: {{ f.totalBv() | number }}</span>
            } @else {
                <span class="force-bv">BV: {{ f.totalBv() | number }}</span>
            }
        </span>
    </div>
    <div class="unit-scroll">
        @for (group of f.groups(); track group.id) {
            <div class="unit-group">
                <div class="group-name">{{ group.groupDisplayName() }}</div>
                <div class="units">
                    @for (fu of group.units(); track fu.id) {
                        <div class="unit-square compact-mode" [class.destroyed]="fu.destroyed">
                            @if (fu.commander()) {
                                <div class="group-commander-indicator" aria-hidden="true">
                                    <svg class="group-commander-icon" width="42.08" height="51.88" viewBox="0 0 21.04 25.94" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" focusable="false">
                                        <g transform="translate(-.02)">
                                            <g transform="matrix(.265 0 0 .265 -21.1 0)" fill="currentColor">
                                                <path d="m79.7 70 39.3-70 40 70.1h-27l-13-22.1-13 22.1z" />
                                                <path d="m81.4 97.9 11.3-21.6h52.3l12 21.6z" />
                                            </g>
                                        </g>
                                    </svg>
                                </div>
                            }
                            <div class="unit-content">
                                <unit-icon [unit]="fu.getUnit()" [size]="32"></unit-icon>
                                @if (unitDisplayName === 'chassisModel'
                                    || unitDisplayName === 'both'
                                    || !fu.alias()) {
                                    <div class="unit-model">{{ fu.getUnit().model | cleanModelString }}</div>
                                    <div class="unit-chassis">{{ fu.getUnit().chassis }}</div>
                                }
                                @if (unitDisplayName === 'alias' || unitDisplayName === 'both') {
                                    <div class="unit-alias"
                                        [class.thin]="unitDisplayName === 'both'">{{ fu.alias() }}</div>
                                }
                                <div class="pilot-info info-slot numeric slim">
                                    <span class="value">{{ fu.getPilotStats() }}</span>
                                </div>
                            </div>
                        </div>
                    }
                </div>
            </div>
        }
    </div>
    `,
    styles: [`
        :host {
            display: block;
            width: 100%;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--border-color, #333);
            padding: 8px 12px;
            box-sizing: border-box;
        }

        .force-preview-header {
            display: flex;
            justify-content: space-between;
            align-items: first baseline;
            margin-bottom: 8px;
        }

        .faction-name-wrapper {
            display: flex;
            align-items: first baseline;
            gap: 4px;
            flex-direction: row;
            flex: 1 1 0;
        }

        .faction-icon,
        .era-icon {
            width: 1.2em;
            height: 1.2em;
            object-fit: contain;
            flex-shrink: 0;
            align-self: flex-start;
        }

        .force-preview-name {
            font-weight: 600;
            font-size: 1em;
            text-align: left;
        }

        .force-preview-info {
            display: flex;
            gap: 8px;
            align-items: first baseline;
            font-size: 0.85em;
            color: var(--text-color-secondary);
        }

        .game-type-badge {
            font-size: 0.7em;
            font-weight: bold;
            padding: 1px 5px;
            background: #a2792c;
            border: 1px solid #a2792c;
            color: #fff;
            text-transform: uppercase;
            flex-shrink: 0;
            align-self: center;
        }

        .game-type-badge.as {
            background: #811313;
            border: 1px solid #811313;
        }

        .force-bv {
            font-weight: 600;
        }

        .unit-scroll {
            display: flex;
            flex-direction: row;
            gap: 4px;
            overflow-x: auto;
        }

        .unit-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
            border-right: 2px solid var(--border-color, #333);
            padding-right: 4px;
            justify-content: flex-end;
        }

        .unit-group:last-child {
            border-right: none;
            padding-right: 0;
        }

        .unit-group .group-name {
            font-size: 0.8em;
            color: var(--text-color-secondary);
            text-align: left;
        }

        .unit-group .units {
            display: flex;
            flex-direction: row;
            gap: 2px;
        }

        .unit-square.compact-mode {
            width: 86px;
            height: 80px;
            max-height: 105px;
            min-width: 86px;
            background: #0003;
            padding: 2px;
            display: flex;
            flex-direction: column;
            align-items: center;
            overflow: hidden;
            box-sizing: border-box;
            position: relative;
        }

        .group-commander-indicator {
            position: absolute;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: var(--bt-yellow);
            pointer-events: none;
            z-index: 1;
            opacity: 0.5;
            top: 3px;
            left: 3px;
        }

        .group-commander-icon {
            width: 16px;
            height: auto;
            transform: rotate(180deg);
            flex-shrink: 0;
        }

        .unit-content {
            width: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            position: relative;
            z-index: 2;
        }

        .unit-square.compact-mode.destroyed {
            background-image: repeating-linear-gradient(
                140deg,
                #500B 0px,
                #500B 12px,
                #300A 12px,
                #300A 24px
            );
        }

        .unit-square.compact-mode.destroyed unit-icon {
            filter: grayscale(1) brightness(0.7) sepia(1) hue-rotate(-30deg) saturate(6) contrast(1.2);
        }

        .unit-square.compact-mode .unit-model {
            color: var(--text-color-secondary);
            font-size: 0.6em;
            text-align: center;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            max-width: 100%;
            display: block;
        }

        .unit-square.compact-mode .unit-alias,
        .unit-square.compact-mode .unit-chassis {
            font-size: 0.7em;
            color: var(--text-color);
            word-break: break-word;
            text-align: center;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .unit-square.compact-mode .unit-alias {
            font-weight: bold;
        }

        .unit-square.compact-mode .unit-alias.thin {
            font-size: 0.6em;
            font-weight: normal;
        }

        .info-slot {
            padding: 0 2px;
            gap: 1px;
            justify-content: start;
            font-size: 0.7em;
            position: absolute;
        }

        .info-slot.numeric {
            justify-content: end;
        }

        .pilot-info {
            top: 3px;
            right: 3px;
        }
    `]
})
export class ForcePreviewComponent {
    optionsService = inject(OptionsService);
    readonly GameSystem = GameSystem;

    /** The force to display. */
    force = input.required<Force>();

    /** Resolved faction image URL, if available. */
    factionImg = computed<string | undefined>(() => {
        const faction = this.force().faction();
        if (!faction) {
            return undefined;
        }
        return getFactionImg(faction);
    });
}
