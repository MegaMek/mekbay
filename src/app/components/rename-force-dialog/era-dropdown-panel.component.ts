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

import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { Era } from '../../models/eras.model';

export interface EraDisplayInfo {
    era: Era;
    matchPercentage: number;
}

@Component({
    selector: 'era-dropdown-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="dropdown-panel glass has-shadow framed-borders" data-scroll-container>
            <!-- Any option -->
            <div class="dropdown-option none-option"
                 [class.active]="!selectedEraId()"
                 (click)="onSelectNone()">
                <div class="era-icon-spacer" aria-hidden="true"></div>
                <div class="none-option-details">
                    <div class="era-header">
                        <span class="era-name">Any</span>
                    </div>
                    <div class="era-summary">Explicitly opt out of any era warning and constraint</div>
                </div>
            </div>
            <hr class="divider"/>

            @for (item of eras(); track item.era.id) {
                <div class="dropdown-option"
                     [class.active]="selectedEraId() === item.era.id"
                     [class.unavailable]="item.matchPercentage < 1"
                     (click)="onSelect(item.era)">
                    @if (item.era.icon) {
                        <img [src]="item.era.icon" class="era-icon" [alt]="item.era.name" />
                    } @else {
                        <div class="era-icon-spacer" aria-hidden="true"></div>
                    }
                    <div class="era-details">
                        <div class="era-header">
                            <span class="era-name">{{ item.era.name }}</span>
                            <span class="match-badge">{{ (item.matchPercentage * 100) | number:'1.0-0' }}% match</span>
                        </div>
                        <span class="era-years">{{ item.era.years.from ?? '?' }}\u2013{{ item.era.years.to ?? 'present' }}</span>
                    </div>
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

        .dropdown-option {
            padding: 8px 12px;
            cursor: pointer;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            display: flex;
            align-items: center;
            gap: 10px;
            border-left: 3px solid transparent;
        }

        .dropdown-option:last-child {
            border-bottom: none;
        }

        .dropdown-option:hover {
            background: rgba(255, 255, 255, 0.1);
        }

        .dropdown-option.active {
            background: var(--bt-yellow-background-transparent);
            border-left: 3px solid var(--bt-yellow);

            &:hover {
                background: var(--bt-yellow-background-bright-transparent);
            }
        }

        .dropdown-option.unavailable {
            border-left-color: rgba(255, 60, 60, 0.4);
        }

        .dropdown-option.unavailable:hover {
            background: rgba(255, 60, 60, 0.06);
        }

        .none-option {
            padding: 8px 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 10px;
            background: rgba(255, 255, 255, 0.03);
            border-left: 3px solid transparent;
        }

        .none-option-details {
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
            flex: 1;
        }

        .era-icon-spacer {
            width: 2.4em;
            height: 2.4em;
            flex-shrink: 0;
        }

        .none-option:hover {
            background: rgba(255, 255, 255, 0.08);
        }

        .era-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .era-details {
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 0;
            flex: 1;
        }

        .era-icon {
            width: 2.4em;
            height: 2.4em;
            object-fit: contain;
            flex-shrink: 0;
        }

        .era-name {
            font-weight: 600;
            color: var(--text-color);
        }

        .match-badge {
            font-size: 0.8em;
            color: var(--bt-yellow);
            padding: 2px 6px;
            background: rgba(240, 192, 64, 0.15);
            white-space: nowrap;
        }

        .era-years {
            font-size: 0.8em;
            color: var(--text-color-secondary);
            white-space: nowrap;
        }

        .era-summary {
            font-size: 0.85em;
            color: var(--text-color-secondary);
            line-height: 1.3;
        }
    `],
    imports: [DecimalPipe]
})
export class EraDropdownPanelComponent {
    eras = input.required<EraDisplayInfo[]>();
    selectedEraId = input<number | null>(null);

    selected = output<Era | null>();

    onSelect(era: Era): void {
        this.selected.emit(era);
    }

    onSelectNone(): void {
        this.selected.emit(null);
    }
}
