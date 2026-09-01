// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import type { TooltipLine } from '../../tooltip/tooltip.component';
import type { Era } from '../../../models/eras.model';
import type { Faction } from '../../../models/factions.model';
import {
    getMegaMekAvailabilityRarityForScore,
    getMegaMekAvailabilityValueForSource,
    isMegaMekAvailabilityValueAvailable,
    MEGAMEK_AVAILABILITY_FROM_OPTIONS,
    MEGAMEK_AVAILABILITY_NOT_AVAILABLE,
    MEGAMEK_AVAILABILITY_RARITY_ICON_COLORS,
    type MegaMekWeightedAvailabilityRecord,
    type MegaMekWeightedAvailabilityValue,
} from '../../../models/megamek/availability.model';
import { MULFACTION_EXTINCT } from '../../../models/mulfactions.model';
import type { UnitSummary } from '../../../models/unit-summary.model';
import { DataService } from '../../../services/data.service';
import { UnitAvailabilitySourceService } from '../../../services/unit-availability-source.service';
import { ModeSwitchComponent } from '../../mode-switch/mode-switch.component';
import { UnitDetailsFactionsTabGridComponent } from './unit-details-factions-tab-grid.component';
import { UnitDetailsFactionsTabListComponent } from './unit-details-factions-tab-list.component';
import {
    CATCH_ALL_FACTIONS,
    PREFIX_CATCH_ALL,
    PREFIX_CATCH_ALL_PREFIX,
    isCatchAllFaction,
    type FactionAvailability,
    type FactionAvailabilityItem,
    type FactionMegaMekAvailability,
    type FactionNameWrapParts,
} from './unit-details-factions-tab.models';

type FactionAvailabilityView = 'list' | 'grid';

interface FactionAvailabilityCandidate extends FactionAvailabilityItem {
    group: string;
}

function splitFactionName(name: string): FactionNameWrapParts {
    const firstSpaceIndex = name.indexOf(' ');
    const lastSpaceIndex = name.lastIndexOf(' ');
    return firstSpaceIndex > 0
        ? {
            head: name.slice(0, firstSpaceIndex),
            middle: name.slice(firstSpaceIndex, lastSpaceIndex + 1),
            tail: name.slice(lastSpaceIndex + 1),
            hasMultipleWords: true,
        }
        : {
            head: '',
            middle: '',
            tail: name,
            hasMultipleWords: false,
        };
}

@Component({
    selector: 'unit-details-factions-tab',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModeSwitchComponent, UnitDetailsFactionsTabGridComponent, UnitDetailsFactionsTabListComponent],
    templateUrl: './unit-details-factions-tab.component.html',
    styleUrl: './unit-details-factions-tab.component.css',
})
export class UnitDetailsFactionTabComponent {
    private readonly dataService = inject(DataService);
    private readonly unitAvailabilitySource = inject(UnitAvailabilitySourceService);

    readonly unit = input.required<UnitSummary>();
    readonly selectedView = signal<FactionAvailabilityView>('grid');
    readonly megaMekAvailabilitySourceSelected = computed(() => (
        this.unitAvailabilitySource.useMegaMekAvailability()
    ));

    readonly factionAvailability = computed<FactionAvailability[]>(() => {
        const unit = this.unit();
        const allEras = this.dataService.getEras();
        const allFactions = this.dataService.getFactions();
        const megaMekAvailabilityByEraFaction = this.buildMegaMekAvailabilityByEraFaction(
            this.dataService.getMegaMekAvailabilityRecordForUnit(unit),
        );

        return this.unitAvailabilitySource.useMegaMekAvailability()
            ? this.buildMegaMekFactionAvailability(unit, allEras, allFactions, megaMekAvailabilityByEraFaction)
            : this.buildMulFactionAvailability(unit, allEras, allFactions, megaMekAvailabilityByEraFaction);
    });

    setGridView(selected: boolean): void {
        this.selectedView.set(selected ? 'grid' : 'list');
    }

    private buildMulFactionAvailability(
        unit: UnitSummary,
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
        unit: UnitSummary,
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
                if (
                    !faction
                    || (isCatchAllFaction(faction.name) && !faction.eras[eraId]?.has(unit.id))
                ) {
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
        faction: Pick<Faction, 'id' | 'name' | 'img' | 'group'>,
        megaMekAvailability: readonly FactionMegaMekAvailability[],
    ): FactionAvailabilityCandidate {
        return {
            id: faction.id,
            name: faction.name,
            nameParts: splitFactionName(faction.name),
            img: faction.img,
            group: faction.group,
            megaMekAvailability: [...megaMekAvailability],
            megaMekTooltip: null,
        };
    }

    private createFactionAvailabilityItem(
        faction: FactionAvailabilityCandidate,
    ): FactionAvailabilityItem {
        return {
            id: faction.id,
            name: faction.name,
            nameParts: faction.nameParts,
            img: faction.img,
            megaMekAvailability: faction.megaMekAvailability,
            megaMekTooltip: this.buildFactionMegaMekTooltip(faction),
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
            const matchingFactions = factionAvailabilityByEraId.get(era.id) ?? [];

            availability.push({
                eraId: era.id,
                eraName: era.name,
                eraShortName: era.shortName,
                eraIcon: era.icon ?? era.img,
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
    ): FactionAvailabilityItem[] {
        const activeCatchAllGroups = new Set<string>();
        let hasPrefixCatchAll = false;

        for (const faction of matchingFactions) {
            const catchAllGroup = CATCH_ALL_FACTIONS[faction.name];
            if (catchAllGroup) {
                activeCatchAllGroups.add(catchAllGroup);
            }
            if (faction.name === PREFIX_CATCH_ALL) {
                hasPrefixCatchAll = true;
            }
        }

        const factions: FactionAvailabilityItem[] = [];
        const collapsedByGroup = new Map<string, FactionAvailabilityItem[]>();
        const prefixCollapsed: FactionAvailabilityItem[] = [];

        for (const faction of matchingFactions) {
            const item = this.createFactionAvailabilityItem(faction);
            if (isCatchAllFaction(faction.name)) {
                item.isCatchAll = true;
                factions.push(item);
            } else if (hasPrefixCatchAll && faction.name.startsWith(PREFIX_CATCH_ALL_PREFIX)) {
                prefixCollapsed.push(item);
            } else if (activeCatchAllGroups.has(faction.group)) {
                const groupItems = collapsedByGroup.get(faction.group) ?? [];
                groupItems.push(item);
                collapsedByGroup.set(faction.group, groupItems);
            } else {
                factions.push(item);
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
