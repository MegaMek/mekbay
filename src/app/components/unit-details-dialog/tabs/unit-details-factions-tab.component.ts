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

import { Component, ChangeDetectionStrategy, input, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Era } from '../../../models/eras.model';
import type { Faction } from '../../../models/factions.model';
import {
    type MegaMekAvailabilityFrom,
    MEGAMEK_AVAILABILITY_RARITY_OPTIONS,
} from '../../../models/megamek/availability.model';
import type { Unit } from '../../../models/units.model';
import { DataService } from '../../../services/data.service';
import {
    type MegaMekUnitAvailabilityDetail,
    UnitAvailabilitySourceService,
} from '../../../services/unit-availability-source.service';

const CATCH_ALL_FACTIONS: Record<string, string> = {
    'Inner Sphere General': 'Inner Sphere',
    'IS Clan General': 'IS Clan',
    'HW Clan General': 'HW Clan',
    'Periphery General': 'Periphery',
};

const PREFIX_CATCH_ALL = 'Star League General';
const PREFIX_CATCH_ALL_PREFIX = 'Star League';

export const MEGAMEK_AVAILABILITY_RARITY_ICON_COLORS: Record<typeof MEGAMEK_AVAILABILITY_RARITY_OPTIONS[number], string> = {
    'Very Rare': '#b5443c',
    'Rare': '#d67c34',
    'Uncommon': '#c0a548',
    'Common': '#6a9d42',
    'Very Common': '#2f8b57',
};

const MEGAMEK_PRODUCTION_ICON_PATH = 'M32.45,8.44,22,15.3V9.51a1,1,0,0,0-1.63-.78L14.07,14H10V4.06L4,2.71V14H2V31a1,1,0,0,0,1,1H33a1,1,0,0,0,1-1V9.27A1,1,0,0,0,32.45,8.44ZM14,29H6V27h8Zm0-4H6V23h8Zm0-4H6V19h8Zm8,8H20V26h2Zm0-6H20V20h2Zm4,6H24V26h2Zm0-6H24V20h2Zm4,6H28V26h2Zm0-6H28V20h2Z';
const MEGAMEK_SALVAGE_ICON_PATH = 'M92.4,192.7c-6.3,6.4-12.9,12.9-18.3,18.3l34.2,41l34.2-41c-6-6.2-12.4-12.1-18.3-18.3H92.4z M62.1,169.9l12.3,12.3l-2.7,2.7l-12.3-12.3L62.1,169.9z M110.2,157.8v17.4h-3.8v-17.4H110.2z M154.4,169.9l-12.3,12.3l2.7,2.7l12.3-12.3L154.4,169.9z M220.9,89.3c-2.4,4.7-4.8,9.5-7.1,14.5L191,176.3c-1.1,6.6-6.9,11.7-13.8,11.7c-7.7,0-14-6.3-14-14c0-0.8,0.1-1.6,0.2-2.3l-0.2-0.1l3.3-13.3c2.6-14.1,12.6-36.7-18.3-42.5c-32.2-6.1-63.5,21.5-63.5,21.5c-11.9,8.8-23.6,20.1-32.9,34.8c-2.3,3.6-6.1,5.5-10.1,5.5c-2.2,0-4.4-0.6-6.4-1.9c-5.6-3.5-7.2-10.9-3.7-16.5c15.3-24,35.7-40.4,53.9-51.1c0.2-0.1,0.3-0.2,0.4-0.3c0.4-0.4,0-1.1-0.6-1.1c-0.2,0-0.3,0-0.5,0.1c-32.9,13.5-60.6,29.6-61,29.8c-1.9,1.1-4,1.6-6,1.6c-4.1,0-8.1-2.1-10.3-5.9c-3.3-5.7-1.4-13,4.3-16.4c1.5-0.9,26.8-15.6,58.5-29c0.4-0.2,0.5-0.3,0.6-0.5c0.1-0.3,0-0.7-0.2-0.9c-0.4-0.3-0.8-0.1-0.8-0.1l-43.2,6.8c-0.6,0.1-1.3,0.1-1.9,0.1C19,92.4,14,88.2,13,82.3c-1-6.5,3.4-12.6,9.9-13.7l42.7-6.8l-0.5-0.1c0,0,36.3-5.3,78.3-21.9c23.5-9.3,38-26.5,49.6-39.8h63v39.5L220.9,89.3z';

interface FactionMegaMekAvailability {
    source: MegaMekAvailabilityFrom;
    rarity: typeof MEGAMEK_AVAILABILITY_RARITY_OPTIONS[number];
    color: string;
    label: string;
}

interface FactionAvailabilityItem {
    name: string;
    img: string;
    megaMekAvailability: FactionMegaMekAvailability[];
    isCatchAll?: boolean;
    collapsedFactions?: FactionAvailabilityItem[];
}

export interface FactionAvailability {
    eraName: string;
    eraImg?: string;
    eraYearFrom?: number;
    eraYearTo?: number;
    factions: FactionAvailabilityItem[];
}

@Component({
    selector: 'unit-details-factions-tab',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    templateUrl: './unit-details-factions-tab.component.html',
    styleUrls: ['./unit-details-factions-tab.component.css']
})
export class UnitDetailsFactionTabComponent {
    private dataService = inject(DataService);
    private unitAvailabilitySource = inject(UnitAvailabilitySourceService);

    readonly megaMekProductionIconPath = MEGAMEK_PRODUCTION_ICON_PATH;
    readonly megaMekSalvageIconPath = MEGAMEK_SALVAGE_ICON_PATH;

    unit = input.required<Unit>();

    factionAvailability = computed<FactionAvailability[]>(() => {
        const u = this.unit();
        if (!u) return [];

        const unitAvailabilityKey = this.unitAvailabilitySource.getUnitAvailabilityKey(u);
        const allEras = this.dataService.getEras();
        const allFactions = this.dataService.getFactions();
        const availability: FactionAvailability[] = [];

        for (const era of allEras) {
            const matchingFactions: Array<FactionAvailabilityItem & { group: string }> = [];
            for (const faction of allFactions) {
                if (this.unitAvailabilitySource.getFactionEraUnitIds(faction, era).has(unitAvailabilityKey)) {
                    matchingFactions.push({
                        name: faction.name,
                        img: faction.img,
                        group: faction.group,
                        megaMekAvailability: this.getFactionMegaMekAvailability(u, faction, era),
                    });
                }
            }

            if (matchingFactions.length > 0) {
                const activeCatchAllGroups = new Set<string>();
                let hasPrefixCatchAll = false;
                for (const f of matchingFactions) {
                    if (CATCH_ALL_FACTIONS[f.name]) {
                        activeCatchAllGroups.add(CATCH_ALL_FACTIONS[f.name]);
                    }
                    if (f.name === PREFIX_CATCH_ALL) {
                        hasPrefixCatchAll = true;
                    }
                }

                const factions: FactionAvailability['factions'] = [];
                const collapsedByGroup = new Map<string, FactionAvailabilityItem[]>();
                const prefixCollapsed: FactionAvailabilityItem[] = [];

                for (const f of matchingFactions) {
                    if (CATCH_ALL_FACTIONS[f.name] || f.name === PREFIX_CATCH_ALL) {
                        factions.push({
                            name: f.name,
                            img: f.img,
                            megaMekAvailability: f.megaMekAvailability,
                            isCatchAll: true,
                        });
                    } else if (hasPrefixCatchAll && f.name.startsWith(PREFIX_CATCH_ALL_PREFIX)) {
                        prefixCollapsed.push({
                            name: f.name,
                            img: f.img,
                            megaMekAvailability: f.megaMekAvailability,
                        });
                    } else if (activeCatchAllGroups.has(f.group)) {
                        if (!collapsedByGroup.has(f.group)) {
                            collapsedByGroup.set(f.group, []);
                        }
                        collapsedByGroup.get(f.group)!.push({
                            name: f.name,
                            img: f.img,
                            megaMekAvailability: f.megaMekAvailability,
                        });
                    } else {
                        factions.push({
                            name: f.name,
                            img: f.img,
                            megaMekAvailability: f.megaMekAvailability,
                        });
                    }
                }

                for (const f of factions) {
                    if (f.isCatchAll) {
                        if (f.name === PREFIX_CATCH_ALL) {
                            if (prefixCollapsed.length > 0) {
                                prefixCollapsed.sort((a, b) => a.name.localeCompare(b.name));
                                f.collapsedFactions = prefixCollapsed;
                            }
                        } else {
                            const group = CATCH_ALL_FACTIONS[f.name];
                            const collapsed = collapsedByGroup.get(group);
                            if (collapsed) {
                                collapsed.sort((a, b) => a.name.localeCompare(b.name));
                                f.collapsedFactions = collapsed;
                            }
                        }
                    }
                }

                factions.sort((a, b) => a.name.localeCompare(b.name));
                availability.push({
                    eraName: era.name,
                    eraImg: era.img,
                    eraYearFrom: era.years.from,
                    eraYearTo: !era.years.to || era.years.to >= 9999 ? undefined : era.years.to,
                    factions
                });
            }
        }
        return availability;
    });

    expandedCatchAlls = signal(new Set<string>());

    toggleCatchAll(eraIndex: number, factionName: string): void {
        const key = `${eraIndex}:${factionName}`;
        this.expandedCatchAlls.update(set => {
            const next = new Set(set);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    }

    isCatchAllExpanded(eraIndex: number, factionName: string): boolean {
        return this.expandedCatchAlls().has(`${eraIndex}:${factionName}`);
    }

    private getFactionMegaMekAvailability(unit: Unit, faction: Faction, era: Era): FactionMegaMekAvailability[] {
        return this.unitAvailabilitySource.getMegaMekAvailabilityDetails(unit, faction, era)
            .map((detail) => this.mapMegaMekAvailabilityDetail(detail));
    }

    private mapMegaMekAvailabilityDetail(detail: MegaMekUnitAvailabilityDetail): FactionMegaMekAvailability {
        return {
            source: detail.source,
            rarity: detail.rarity,
            color: MEGAMEK_AVAILABILITY_RARITY_ICON_COLORS[detail.rarity],
            label: `${detail.source}: ${detail.rarity}`,
        };
    }
}
