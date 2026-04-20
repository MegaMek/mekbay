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
import { MULFACTION_EXTINCT } from '../../../models/mulfactions.model';
import {
    getMegaMekAvailabilityRarityForScore,
    getMegaMekAvailabilityValueForSource,
    isMegaMekAvailabilityValueAvailable,
    MEGAMEK_AVAILABILITY_RARITY_ICON_COLORS,
    MEGAMEK_AVAILABILITY_FROM_OPTIONS,
    MEGAMEK_PRODUCTION_ICON_PATH,
    type MegaMekAvailabilityFrom,
    MEGAMEK_AVAILABILITY_RARITY_OPTIONS,
    MEGAMEK_SALVAGE_ICON_PATH,
    type MegaMekWeightedAvailabilityRecord,
    type MegaMekWeightedAvailabilityValue,
    MEGAMEK_AVAILABILITY_NOT_AVAILABLE,
} from '../../../models/megamek/availability.model';
import type { Unit } from '../../../models/units.model';
import { DataService } from '../../../services/data.service';
import { UnitAvailabilitySourceService } from '../../../services/unit-availability-source.service';

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

interface FactionNameWrapParts {
    first: string;
    middle: string;
    last: string;
    hasMultipleWords: boolean;
}

interface FactionAvailabilityItem {
    name: string;
    img: string;
    megaMekAvailability: FactionMegaMekAvailability[];
    megaMekTooltip: TooltipLine[] | null;
    isCatchAll?: boolean;
    collapsedFactions?: FactionAvailabilityItem[];
}

interface FactionAvailabilityCandidate extends FactionAvailabilityItem {
    group: string;
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
    private factionNameWrapPartsCache = new Map<string, FactionNameWrapParts>();

    readonly megaMekProductionIconPath = MEGAMEK_PRODUCTION_ICON_PATH;
    readonly megaMekSalvageIconPath = MEGAMEK_SALVAGE_ICON_PATH;

    unit = input.required<Unit>();

    factionAvailability = computed<FactionAvailability[]>(() => {
        const u = this.unit();
        if (!u) return [];

        const allEras = this.dataService.getEras();
        const allFactions = this.dataService.getFactions();
        const megaMekAvailabilityByEraFaction = this.buildMegaMekAvailabilityByEraFaction(
            this.dataService.getMegaMekAvailabilityRecordForUnit(u),
        );

        return this.unitAvailabilitySource.useMegaMekAvailability()
            ? this.buildMegaMekFactionAvailability(allEras, allFactions, megaMekAvailabilityByEraFaction)
            : this.buildMulFactionAvailability(u, allEras, allFactions, megaMekAvailabilityByEraFaction);
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

    getFactionNameWrapParts(name: string): FactionNameWrapParts {
        const cached = this.factionNameWrapPartsCache.get(name);
        if (cached) {
            return cached;
        }

        const firstSpaceIndex = name.indexOf(' ');
        const parts = firstSpaceIndex > 0
            ? {
                first: name.slice(0, firstSpaceIndex),
                middle: name.slice(firstSpaceIndex, name.lastIndexOf(' ') + 1),
                last: name.slice(name.lastIndexOf(' ') + 1),
                hasMultipleWords: true,
            }
            : {
                first: '',
                middle: '',
                last: name,
                hasMultipleWords: false,
            };

        this.factionNameWrapPartsCache.set(name, parts);
        return parts;
    }

    private buildMulFactionAvailability(
        unit: Unit,
        eras: readonly Era[],
        factions: readonly Faction[],
        megaMekAvailabilityByEraFaction: ReadonlyMap<number, ReadonlyMap<number, readonly FactionMegaMekAvailability[]>>,
    ): FactionAvailability[] {
        const factionAvailabilityByEraId = new Map<number, FactionAvailabilityCandidate[]>();

        for (const faction of factions) {
            for (const [eraIdText, unitIds] of Object.entries(faction.eras) as Array<[string, Set<number>]>) {
                if (!unitIds.has(unit.id)) {
                    continue;
                }

                const eraId = Number(eraIdText);
                if (Number.isNaN(eraId)) {
                    continue;
                }

                this.getOrCreateCandidates(factionAvailabilityByEraId, eraId).push(
                    this.createFactionAvailabilityCandidate(
                        faction,
                        megaMekAvailabilityByEraFaction.get(eraId)?.get(faction.id) ?? [],
                    ),
                );
            }
        }

        return this.buildFactionAvailabilityView(eras, factionAvailabilityByEraId);
    }

    private buildMegaMekFactionAvailability(
        eras: readonly Era[],
        factions: readonly Faction[],
        megaMekAvailabilityByEraFaction: ReadonlyMap<number, ReadonlyMap<number, readonly FactionMegaMekAvailability[]>>,
    ): FactionAvailability[] {
        const factionAvailabilityByEraId = new Map<number, FactionAvailabilityCandidate[]>();
        const factionById = new Map(factions.map((faction) => [faction.id, faction] as const));
        const availableEraIds = new Set<number>();

        for (const [eraId, eraAvailability] of megaMekAvailabilityByEraFaction.entries()) {
            availableEraIds.add(eraId);

            for (const [factionId, details] of eraAvailability.entries()) {
                const faction = factionById.get(factionId);
                if (!faction) {
                    continue;
                }

                this.getOrCreateCandidates(factionAvailabilityByEraId, eraId).push(
                    this.createFactionAvailabilityCandidate(faction, details),
                );
            }
        }

        const extinctFaction = factionById.get(MULFACTION_EXTINCT);
        if (extinctFaction) {
            let wasPreviouslyAvailable = false;

            for (const era of eras) {
                const isAvailableInEra = availableEraIds.has(era.id);

                if (!isAvailableInEra && wasPreviouslyAvailable) {
                    this.getOrCreateCandidates(factionAvailabilityByEraId, era.id).push(
                        this.createFactionAvailabilityCandidate(extinctFaction, []),
                    );
                }

                if (isAvailableInEra) {
                    wasPreviouslyAvailable = true;
                }
            }
        }

        return this.buildFactionAvailabilityView(eras, factionAvailabilityByEraId);
    }

    private buildMegaMekAvailabilityByEraFaction(
        availabilityRecord: MegaMekWeightedAvailabilityRecord | undefined,
    ): Map<number, Map<number, readonly FactionMegaMekAvailability[]>> {
        const availabilityByEraFaction = new Map<number, Map<number, readonly FactionMegaMekAvailability[]>>();
        if (!availabilityRecord) {
            return availabilityByEraFaction;
        }

        for (const [eraIdText, eraAvailability] of Object.entries(availabilityRecord.e)) {
            const eraId = Number(eraIdText);
            if (Number.isNaN(eraId)) {
                continue;
            }

            const factionAvailability = new Map<number, readonly FactionMegaMekAvailability[]>();
            for (const [factionIdText, value] of Object.entries(eraAvailability)) {
                const factionId = Number(factionIdText);
                if (Number.isNaN(factionId) || !isMegaMekAvailabilityValueAvailable(value)) {
                    continue;
                }

                factionAvailability.set(factionId, this.buildFactionMegaMekAvailability(value));
            }

            if (factionAvailability.size > 0) {
                availabilityByEraFaction.set(eraId, factionAvailability);
            }
        }

        return availabilityByEraFaction;
    }

    private buildFactionMegaMekAvailability(value: MegaMekWeightedAvailabilityValue): FactionMegaMekAvailability[] {
        const availability: FactionMegaMekAvailability[] = [];

        for (const source of MEGAMEK_AVAILABILITY_FROM_OPTIONS) {
            const score = getMegaMekAvailabilityValueForSource(value, source);
            if (score <= 0) {
                continue;
            }

            const rarity = getMegaMekAvailabilityRarityForScore(score);
            if (rarity === MEGAMEK_AVAILABILITY_NOT_AVAILABLE) {
                continue;
            }

            availability.push({
                source,
                rarity,
                color: MEGAMEK_AVAILABILITY_RARITY_ICON_COLORS[rarity],
                label: `${source}: ${rarity}`,
            });
        }

        return availability;
    }

    private createFactionAvailabilityCandidate(
        faction: Pick<Faction, 'name' | 'img' | 'group'>,
        megaMekAvailability: readonly FactionMegaMekAvailability[],
    ): FactionAvailabilityCandidate {
        return {
            name: faction.name,
            img: faction.img,
            group: faction.group,
            megaMekAvailability: [...megaMekAvailability],
            megaMekTooltip: null,
        };
    }

    private getOrCreateCandidates(
        map: Map<number, FactionAvailabilityCandidate[]>,
        eraId: number,
    ): FactionAvailabilityCandidate[] {
        const existing = map.get(eraId);
        if (existing) {
            return existing;
        }

        const created: FactionAvailabilityCandidate[] = [];
        map.set(eraId, created);
        return created;
    }

    private buildFactionAvailabilityView(
        eras: readonly Era[],
        factionAvailabilityByEraId: ReadonlyMap<number, readonly FactionAvailabilityCandidate[]>,
    ): FactionAvailability[] {
        const availability: FactionAvailability[] = [];

        for (const era of eras) {
            const matchingFactions = factionAvailabilityByEraId.get(era.id);
            if (!matchingFactions || matchingFactions.length === 0) {
                continue;
            }

            availability.push({
                eraName: era.name,
                eraImg: era.img,
                eraYearFrom: era.years.from,
                eraYearTo: !era.years.to || era.years.to >= 9999 ? undefined : era.years.to,
                factions: this.buildEraFactionItems(matchingFactions),
            });
        }

        return availability;
    }

    private buildEraFactionItems(
        matchingFactions: readonly FactionAvailabilityCandidate[],
    ): FactionAvailability['factions'] {
        const activeCatchAllGroups = new Set<string>();
        let hasPrefixCatchAll = false;

        for (const faction of matchingFactions) {
            if (CATCH_ALL_FACTIONS[faction.name]) {
                activeCatchAllGroups.add(CATCH_ALL_FACTIONS[faction.name]);
            }
            if (faction.name === PREFIX_CATCH_ALL) {
                hasPrefixCatchAll = true;
            }
        }

        const factions: FactionAvailability['factions'] = [];
        const collapsedByGroup = new Map<string, FactionAvailabilityItem[]>();
        const prefixCollapsed: FactionAvailabilityItem[] = [];

        for (const faction of matchingFactions) {
            const megaMekTooltip = this.buildFactionMegaMekTooltip(faction);
            if (CATCH_ALL_FACTIONS[faction.name] || faction.name === PREFIX_CATCH_ALL) {
                factions.push({
                    name: faction.name,
                    img: faction.img,
                    megaMekAvailability: faction.megaMekAvailability,
                    megaMekTooltip,
                    isCatchAll: true,
                });
            } else if (hasPrefixCatchAll && faction.name.startsWith(PREFIX_CATCH_ALL_PREFIX)) {
                prefixCollapsed.push({
                    name: faction.name,
                    img: faction.img,
                    megaMekAvailability: faction.megaMekAvailability,
                    megaMekTooltip,
                });
            } else if (activeCatchAllGroups.has(faction.group)) {
                const groupItems = collapsedByGroup.get(faction.group);
                if (groupItems) {
                    groupItems.push({
                        name: faction.name,
                        img: faction.img,
                        megaMekAvailability: faction.megaMekAvailability,
                        megaMekTooltip,
                    });
                } else {
                    collapsedByGroup.set(faction.group, [{
                        name: faction.name,
                        img: faction.img,
                        megaMekAvailability: faction.megaMekAvailability,
                        megaMekTooltip,
                    }]);
                }
            } else {
                factions.push({
                    name: faction.name,
                    img: faction.img,
                    megaMekAvailability: faction.megaMekAvailability,
                    megaMekTooltip,
                });
            }
        }

        for (const faction of factions) {
            if (!faction.isCatchAll) {
                continue;
            }

            if (faction.name === PREFIX_CATCH_ALL) {
                if (prefixCollapsed.length > 0) {
                    prefixCollapsed.sort((left, right) => left.name.localeCompare(right.name));
                    faction.collapsedFactions = prefixCollapsed;
                }
                continue;
            }

            const group = CATCH_ALL_FACTIONS[faction.name];
            const collapsed = group ? collapsedByGroup.get(group) : undefined;
            if (collapsed) {
                collapsed.sort((left, right) => left.name.localeCompare(right.name));
                faction.collapsedFactions = collapsed;
            }
        }

        factions.sort((left, right) => left.name.localeCompare(right.name));
        return factions;
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
