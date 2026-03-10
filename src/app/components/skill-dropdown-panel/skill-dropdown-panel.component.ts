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

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { GameSystem } from '../../models/common.model';

/*
 * Author: Drake
 */

export interface SkillPreviewEntry {
    skill: number;
    adjustedValue: number;
    delta: number;
}

@Component({
    selector: 'skill-dropdown-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    template: `
        <div class="dropdown-panel glass has-shadow framed-borders" data-scroll-container>
            @if (title()) {
                <div class="panel-title">{{ title() }}</div>
            }
            @for (entry of entries(); track entry.skill) {
                <div class="skill-option"
                     [class.active]="entry.skill === selectedSkill()"
                     (click)="onSelect(entry.skill)">
                    <span class="skill-value">{{ entry.skill }}</span>
                    <span class="skill-detail">
                        <span class="adjusted-value">{{ valueLabel() }}: {{ entry.adjustedValue }}</span>
                        @if (entry.delta !== 0) {
                            <span class="delta" [class.positive]="entry.delta > 0" [class.negative]="entry.delta < 0">
                                {{ entry.delta > 0 ? '+' : '' }}{{ entry.delta }}
                            </span>
                        }
                    </span>
                </div>
            }
        </div>
    `,
    styles: [`
        :host {
            display: block;
            width: 100%;
        }

        .dropdown-panel {
            box-sizing: border-box;
            overflow-y: auto;
        }

        .panel-title {
            padding: 8px 12px 4px;
            font-size: 0.75em;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--text-color-tertiary);
        }

        .skill-option {
            padding: 8px 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 12px;
            border-left: 3px solid transparent;
        }

        .skill-option:hover {
            background: rgba(255, 255, 255, 0.08);
        }

        .skill-option.active {
            background: var(--bt-yellow-background-transparent);
            border-left: 3px solid var(--bt-yellow);
        }

        .skill-option.active:hover {
            background: var(--bt-yellow-background-bright-transparent);
        }

        .skill-value {
            font-weight: 700;
            font-size: 1.1em;
            min-width: 20px;
            text-align: center;
            color: var(--text-color);
        }

        .skill-detail {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.9em;
        }

        .adjusted-value {
            color: var(--text-color-secondary);
        }

        .delta {
            font-weight: 600;
            font-size: 0.85em;
        }

        .delta.positive {
            color: #4caf50;
        }

        .delta.negative {
            color: #f44336;
        }
    `]
})
export class SkillDropdownPanelComponent {
    entries = input.required<SkillPreviewEntry[]>();
    selectedSkill = input<number>(4);
    valueLabel = input<string>('BV');
    title = input<string>('');

    selected = output<number>();

    onSelect(skill: number): void {
        this.selected.emit(skill);
    }
}
