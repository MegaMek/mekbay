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

import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

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
                    <span class="adjusted-value">{{ valueLabel() }}: {{ entry.adjustedValue }}</span>
                    <span class="delta" [class.positive]="entry.delta > 0" [class.negative]="entry.delta < 0">
                        @if (entry.delta !== 0) {
                            {{ entry.delta > 0 ? '+' : '' }}{{ entry.delta }}
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
            container-type: inline-size;
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
            padding: 8px 6px;
            cursor: pointer;
            display: grid;
            grid-template-columns: 1.5em auto 3em;
            align-items: center;
            gap: 4px;
            border-left: 3px solid transparent;
            white-space: nowrap;
        }

        .skill-value {
            font-weight: 700;
            font-size: 1.1em;
            text-align: left;
            color: var(--text-color);
        }

        @container (min-width: 200px) {
            .skill-option {
                padding: 8px 16px;
                grid-template-columns: 2em auto 3.5em;
                gap: 8px;
            }
        }

        @container (min-width: 300px) {
            .skill-option {
                justify-content: space-between;
            }
            .skill-value {
                text-align: center;
            }
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

        .adjusted-value {
            text-align: right;
            font-size: 0.9em;
            color: var(--text-color-secondary);
        }

        .delta {
            min-width: 36px;
            text-align: right;
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
