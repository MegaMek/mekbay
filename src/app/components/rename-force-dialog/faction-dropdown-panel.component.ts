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
import type { Faction } from '../../models/factions.model';
import type { FactionDisplayInfo } from '../../utils/force-namer.util';
import { buildFactionEraTitle, getFactionEraIconFilter } from './faction-era-visuals.util';

/*
 * Author: Drake
 */
@Component({
    selector: 'faction-dropdown-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="dropdown-shell glass has-shadow framed-borders">
            <div class="dropdown-panel" data-scroll-container>
                <!-- None option -->
                <div class="dropdown-option none-option"
                     [class.active]="!selectedFactionId()"
                     (click)="onSelectNone()">
                    <div class="faction-icon-spacer" aria-hidden="true"></div>
                    <div class="none-option-details">
                        <div class="faction-header">
                            <span class="faction-name">None</span>
                        </div>
                        <div class="faction-summary">Explicitly opt out of any faction</div>
                    </div>
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
                        @if (item.faction.img) {
                            <img [src]="item.faction.img" class="faction-icon" [alt]="item.faction.name" />
                        } @else {
                            <div class="faction-icon-spacer" aria-hidden="true"></div>
                        }
                        <div class="faction-details">
                            <div class="faction-header">
                                <span class="faction-name">{{ item.faction.name }}</span>
                                <span class="match-badge">{{ (item.matchPercentage * 100) | number:'1.0-0' }}% match</span>
                            </div>
                            <div class="era-icons">
                                @for (eraItem of item.eraAvailability; track eraItem.era.id) {
                                    @if (eraItem.era.icon) {
                                        <span class="era-chip"
                                            [class.past-era]="eraItem.isBeforeReferenceYear"
                                              [title]="getEraTitle(eraItem)">
                                            <img class="era-icon"
                                                 [src]="eraItem.era.icon"
                                                [alt]="eraItem.era.name"
                                                [class.unavailable]="!eraItem.isAvailable"
                                                [style.filter]="getEraIconFilter(eraItem)" />
                                        </span>
                                    }
                                }
                            </div>
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
                        @if (item.faction.img) {
                            <img [src]="item.faction.img" class="faction-icon" [alt]="item.faction.name" />
                        } @else {
                            <div class="faction-icon-spacer" aria-hidden="true"></div>
                        }
                        <div class="faction-details">
                            <div class="faction-header">
                                <span class="faction-name">{{ item.faction.name }}</span>
                                <span class="match-badge">{{ (item.matchPercentage * 100) | number:'1.0-0' }}% match</span>
                            </div>
                            <div class="era-icons">
                                @for (eraItem of item.eraAvailability; track eraItem.era.id) {
                                    @if (eraItem.era.icon) {
                                        <span class="era-chip"
                                            [class.past-era]="eraItem.isBeforeReferenceYear"
                                              [title]="getEraTitle(eraItem)">
                                            <img class="era-icon"
                                                 [src]="eraItem.era.icon"
                                                [alt]="eraItem.era.name"
                                                [class.unavailable]="!eraItem.isAvailable"
                                                [style.filter]="getEraIconFilter(eraItem)" />
                                        </span>
                                    }
                                }
                            </div>
                        </div>
                    </div>
                    }
                }
            </div>

            <div class="legend-footer">
                <div class="legend-icons">
                    <div class="legend-icon-card">
                        <span class="era-chip legend-era-chip past-era-example">
                            <img class="era-icon legend-era-icon"
                                 [src]="legendEraIcon"
                                 alt="Clan Invasion past era example" />
                        </span>
                        <span class="legend-label">Era predates this force</span>
                    </div>
                    <div class="legend-icon-card">
                        <span class="era-chip legend-era-chip">
                            <img class="era-icon legend-era-icon unavailable"
                                 [src]="legendEraIcon"
                                 alt="Clan Invasion unavailable example" />
                        </span>
                        <span class="legend-label">Faction doesn't exist in this era</span>
                    </div>
                    <div class="legend-icon-card">
                        <span class="era-chip legend-era-chip">
                            <img class="era-icon legend-era-icon"
                                 [src]="legendEraIcon"
                                 alt="Clan Invasion normal example" />
                        </span>
                        <span class="legend-label">Faction available in this era</span>
                    </div>
                    <div class="legend-icon-card">
                        <span class="era-chip legend-era-chip">
                            <img class="era-icon legend-era-icon glowing"
                                 [src]="legendEraIcon"
                                 alt="Clan Invasion glowing example" />
                        </span>
                        <span class="legend-label">Faction and force matching this era</span>
                    </div>
                </div>
            </div>
        </div>
    `,
    styles: [`
        :host {
            display: block;
            width: 100%;
            min-height: 0;
        }

        .dropdown-shell {
            display: flex;
            flex-direction: column;
            min-height: 0;
        }

        .dropdown-panel {
            box-sizing: border-box;
            overflow-y: auto;
            flex: 1 1 auto;
            min-height: 0;
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

        .faction-icon-spacer {
            width: 2.4em;
            height: 2.4em;
            flex-shrink: 0;
        }

        .none-option:hover {
            background: rgba(255, 255, 255, 0.08);
        }

        .faction-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .faction-details {
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
            flex: 1;
        }

        .faction-icon {
            width: 2.4em;
            height: 2.4em;
            object-fit: contain;
            flex-shrink: 0;
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
            display: flex;
            flex-direction: row;
            align-items: center;
        }

        .era-chip {
            position: relative;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 2px; 
        }

        .era-chip.past-era::before {
            content: '';
            position: absolute;
            left: -2px;
            top: -1px;
            width: 100%;
            height: 100%;
            background-color: rgba(255, 0, 0, 0.2);
            pointer-events: none;
        }

        .era-icon {
            width: 1.2em;
            height: 1.2em;
            object-fit: contain;
        }

        .era-icon.unavailable {
            opacity: 0.18;
        }

        .legend-footer {
            flex: 0 0 auto;
            padding: 10px 12px 12px;
            border-top: 1px solid var(--border-color);
        }

        .legend-icons {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 10px;
        }

        .legend-icon-card {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 2px;
            text-align: center;
        }

        .legend-label {
            font-size: 0.8em;
            line-height: 1.25;
            color: var(--text-color-secondary);
        }

        .legend-era-chip {
            min-width: 1.75em;
            min-height: 1.75em;
        }

        .legend-era-icon {
            width: 1.2em;
            height: 1.2em;
        }

        .legend-era-chip.past-era-example::before {
            content: '';
            position: absolute;
            left: 0px;
            top: 0px;
            width: 100%;
            height: 100%;
            background-color: rgba(255, 0, 0, 0.2);
            pointer-events: none;
        }

        .legend-era-icon.glowing {
            filter: sepia(1) saturate(10) hue-rotate(344deg) drop-shadow(0 0 2px rgba(214, 162, 74, 1));
        }

        @media (max-width: 560px) {
            .legend-footer {
                padding: 4px;
            }

            .legend-icons {
                gap: 4px;
            }

            .legend-label {
                font-size: 0.6em;
            }
        }

        @media (max-width: 400px) {
            .era-chip {
                padding: 0;
            }
        }

        @media (max-width: 340px) {
            .era-icon {
                height: 1.05em;
                width: 1.05em;
            }
        }
    `],
    imports: [
        DecimalPipe
    ]
})
export class FactionDropdownPanelComponent {
    readonly legendEraIcon = '/images/eras/era03-clan-invasion.png';

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

    getEraTitle = buildFactionEraTitle;

    getEraIconFilter = getFactionEraIconFilter;
}
