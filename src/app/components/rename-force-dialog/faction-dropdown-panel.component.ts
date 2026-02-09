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

import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Faction } from '../../models/factions.model';
import { FactionDisplayInfo } from '../../utils/force-namer.util';

/*
 * Author: Drake
 */
@Component({
    selector: 'faction-dropdown-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="dropdown-panel glass has-shadow framed-borders">
            <!-- None option -->
            <div class="dropdown-option none-option"
                 [class.active]="!selectedFactionId()"
                 (click)="onSelectNone()">
                <div class="faction-header">
                    <span class="faction-name">None</span>
                </div>
                <div class="faction-summary">No faction assigned</div>
            </div>
            <hr class="divider"/>

            @if (hasMatchingFactions()) {
                <div class="section-label">Matching Factions</div>
            }

            @for (item of factions(); track item.faction.id) {
                @if (item.isMatching) {
                <div class="dropdown-option matching"
                     [class.active]="selectedFactionId() === item.faction.id"
                     (click)="onSelect(item.faction)">
                    <div class="faction-header">
                        <div class="faction-identity">
                            @if (item.faction.img) {
                                <img [src]="item.faction.img" class="faction-icon" [alt]="item.faction.name" />
                            }
                            <span class="faction-name">{{ item.faction.name }}</span>
                        </div>
                        <span class="match-badge">{{ (item.matchPercentage * 100) | number:'1.0-0' }}% match</span>
                    </div>
                    <div class="era-icons">
                        @for (eraItem of item.eraAvailability; track eraItem.era.id) {
                            @if (eraItem.era.icon) {
                                <img class="era-icon"
                                     [src]="eraItem.era.icon"
                                     [alt]="eraItem.era.name"
                                     [title]="eraItem.era.name + ' (' + (eraItem.era.years.from ?? '?') + '–' + (eraItem.era.years.to ?? 'present') + ')'"
                                     [class.unavailable]="!eraItem.isAvailable" />
                            }
                        }
                    </div>
                </div>
                }
            }

            @if (hasMatchingFactions() && hasNonMatchingFactions()) {
                <hr class="divider"/>
                <div class="section-label">Other Factions</div>
            }

            @for (item of factions(); track item.faction.id) {
                @if (!item.isMatching) {
                <div class="dropdown-option"
                     [class.active]="selectedFactionId() === item.faction.id"
                     (click)="onSelect(item.faction)">
                    <div class="faction-header">
                        <div class="faction-identity">
                            @if (item.faction.img) {
                                <img [src]="item.faction.img" class="faction-icon" [alt]="item.faction.name" />
                            }
                            <span class="faction-name">{{ item.faction.name }}</span>
                        </div>
                    </div>
                    <div class="era-icons">
                        @for (eraItem of item.eraAvailability; track eraItem.era.id) {
                            @if (eraItem.era.icon) {
                                <img class="era-icon"
                                     [src]="eraItem.era.icon"
                                     [alt]="eraItem.era.name"
                                     [title]="eraItem.era.name + ' (' + (eraItem.era.years.from ?? '?') + '–' + (eraItem.era.years.to ?? 'present') + ')'"
                                     [class.unavailable]="!eraItem.isAvailable" />
                            }
                        }
                    </div>
                </div>
                }
            }
        </div>
    `,
    styles: [`
        :host {
            display: block;
            height: 100%;
        }

        .dropdown-panel {
            height: calc(100vh - 16px);
            box-sizing: border-box;
            margin-top: 8px;
            margin-bottom: 8px;
            overflow-y: auto;
        }

        .section-label {
            padding: 8px 12px 4px;
            font-size: 0.75em;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--text-color-tertiary);
        }

        .dropdown-option {
            padding: 8px 12px;
            cursor: pointer;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
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

        .none-option {
            background: rgba(255, 255, 255, 0.03);
        }

        .none-option:hover {
            background: rgba(255, 255, 255, 0.08);
        }

        .faction-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 6px;
        }

        .faction-identity {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .faction-icon {
            width: 1.6em;
            height: 1.6em;
            object-fit: contain;
        }

        .faction-name {
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

        .faction-summary {
            font-size: 0.85em;
            color: var(--text-color-secondary);
            line-height: 1.3;
        }

        .era-icons {
            align-self: center;
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 2px;
        }

        .era-icon {
            width: 1.2em;
            height: 1.2em;
            object-fit: contain;
            transition: opacity 0.2s ease;
        }

        .era-icon.unavailable {
            opacity: 0.15;
        }

        .divider {
            border: none;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            margin: 0;
        }
    `],
    imports: [
        DecimalPipe
    ]
})
export class FactionDropdownPanelComponent {
    factions = input.required<FactionDisplayInfo[]>();
    selectedFactionId = input<number | null>(null);

    selected = output<Faction | null>();

    hasMatchingFactions(): boolean {
        return this.factions().some(f => f.isMatching);
    }

    hasNonMatchingFactions(): boolean {
        return this.factions().some(f => !f.isMatching);
    }

    onSelect(faction: Faction): void {
        this.selected.emit(faction);
    }

    onSelectNone(): void {
        this.selected.emit(null);
    }
}
