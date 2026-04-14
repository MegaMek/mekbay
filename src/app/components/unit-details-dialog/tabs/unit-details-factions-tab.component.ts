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
import { TooltipDirective } from '../../../directives/tooltip.directive';
import type { TooltipLine } from '../../tooltip/tooltip.component';
import type { Era } from '../../../models/eras.model';
import type { Faction } from '../../../models/factions.model';
import {
    MEGAMEK_AVAILABILITY_RARITY_ICON_COLORS,
    MEGAMEK_PRODUCTION_ICON_PATH,
    type MegaMekAvailabilityFrom,
    MEGAMEK_AVAILABILITY_RARITY_OPTIONS,
    MEGAMEK_SALVAGE_ICON_PATH,
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
    megaMekTooltip: TooltipLine[] | null;
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
    imports: [CommonModule, TooltipDirective],
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
                        megaMekTooltip: null,
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
                    const megaMekTooltip = this.buildFactionMegaMekTooltip(f);
                    if (CATCH_ALL_FACTIONS[f.name] || f.name === PREFIX_CATCH_ALL) {
                        factions.push({
                            name: f.name,
                            img: f.img,
                            megaMekAvailability: f.megaMekAvailability,
                            megaMekTooltip,
                            isCatchAll: true,
                        });
                    } else if (hasPrefixCatchAll && f.name.startsWith(PREFIX_CATCH_ALL_PREFIX)) {
                        prefixCollapsed.push({
                            name: f.name,
                            img: f.img,
                            megaMekAvailability: f.megaMekAvailability,
                            megaMekTooltip,
                        });
                    } else if (activeCatchAllGroups.has(f.group)) {
                        if (!collapsedByGroup.has(f.group)) {
                            collapsedByGroup.set(f.group, []);
                        }
                        collapsedByGroup.get(f.group)!.push({
                            name: f.name,
                            img: f.img,
                            megaMekAvailability: f.megaMekAvailability,
                            megaMekTooltip,
                        });
                    } else {
                        factions.push({
                            name: f.name,
                            img: f.img,
                            megaMekAvailability: f.megaMekAvailability,
                            megaMekTooltip,
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

    private buildFactionMegaMekTooltip(
        faction: Pick<FactionAvailabilityItem, 'name' | 'img' | 'megaMekAvailability'>,
    ): TooltipLine[] | null {
        if (faction.megaMekAvailability.length === 0) {
            return null;
        }

        return [
            {
                value: faction.name,
                ...(faction.img ? { iconSrc: faction.img, iconAlt: faction.name } : {}),
                isHeader: true,
            },
            ...faction.megaMekAvailability.map((availability) => ({
                label: availability.source,
                value: availability.rarity,
            })),
        ];
    }
}
