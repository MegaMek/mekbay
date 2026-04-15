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

import { Injectable, inject } from '@angular/core';

import type { Era } from '../models/eras.model';
import type { Faction } from '../models/factions.model';
import {
    type MegaMekAvailabilityFromFilter,
    MEGAMEK_AVAILABILITY_FILTERS_USE_ALL_SCOPED_OPTIONS,
    MEGAMEK_AVAILABILITY_UNKNOWN_SCORE,
    MEGAMEK_AVAILABILITY_UNKNOWN,
    MEGAMEK_AVAILABILITY_NOT_AVAILABLE,
    MEGAMEK_AVAILABILITY_ALL_RARITY_OPTIONS,
    MEGAMEK_AVAILABILITY_RARITY_OPTIONS,
    getMegaMekAvailabilityRarityForScore,
    getMegaMekAvailabilityValueForSource,
    isMegaMekAvailabilityValueAvailable,
    MEGAMEK_AVAILABILITY_FROM_OPTIONS,
    type MegaMekAvailabilityFrom,
    type MegaMekAvailabilityRarity,
} from '../models/megamek/availability.model';
import { MULFACTION_EXTINCT } from '../models/mulfactions.model';
import type { AvailabilitySource } from '../models/options.model';
import type { Unit } from '../models/units.model';
import type { ForceAvailabilityContext } from '../utils/force-availability.util';
import { DataService } from './data.service';
import { OptionsService } from './options.service';

interface MegaMekUnitAvailabilityEntry {
    eraId: number;
    factionId: number;
    production: number;
    salvage: number;
}

interface MulMembershipPair {
    eraId: number;
    factionId: number;
}

export interface MegaMekAvailabilityFilterContext {
    eraIds?: ReadonlySet<number>;
    factionIds?: ReadonlySet<number>;
    availabilityFrom?: ReadonlySet<MegaMekAvailabilityFrom>;
    availabilityRarities?: ReadonlySet<MegaMekPositiveAvailabilityRarity>;
    bridgeThroughMulMembership?: boolean;
}

type AvailabilityUnitKey = string;
type MegaMekPositiveAvailabilityRarity = typeof MEGAMEK_AVAILABILITY_RARITY_OPTIONS[number];

export interface MegaMekUnitAvailabilityDetail {
    source: MegaMekAvailabilityFromFilter;
    score: number;
    rarity: MegaMekAvailabilityRarity;
}

interface MegaMekScopedAvailabilityBlock {
    membershipUnitIds: ReadonlySet<AvailabilityUnitKey>;
    knownUnitIds: ReadonlySet<AvailabilityUnitKey>;
    unknownUnitIds: ReadonlySet<AvailabilityUnitKey>;
    sourceScores: Record<MegaMekAvailabilityFrom, ReadonlyMap<AvailabilityUnitKey, number>>;
    sourceAvailableUnitIds: Record<MegaMekAvailabilityFrom, ReadonlySet<AvailabilityUnitKey>>;
    sourceRarityUnitIds: Record<MegaMekAvailabilityFrom, ReadonlyMap<MegaMekPositiveAvailabilityRarity, ReadonlySet<AvailabilityUnitKey>>>;
    combinedPositiveScoreCache: Map<string, ReadonlyMap<AvailabilityUnitKey, number>>;
    combinedAvailableUnitIdsCache: Map<string, ReadonlySet<AvailabilityUnitKey>>;
    combinedRarityUnitIdsCache: Map<string, ReadonlyMap<MegaMekPositiveAvailabilityRarity, ReadonlySet<AvailabilityUnitKey>>>;
}

interface MegaMekScopedMatchHandlers {
    pair: (eraId: number, factionId: number) => boolean;
    era: (eraId: number) => boolean;
    faction: (factionId: number) => boolean;
    any: () => boolean;
}

const MEGAMEK_AVAILABILITY_FROM_LOOKUP = new Map(
    MEGAMEK_AVAILABILITY_FROM_OPTIONS.map((availabilityFrom) => [availabilityFrom.toLowerCase(), availabilityFrom] as const),
);

const MEGAMEK_SCOPED_AVAILABILITY_BLOCK_CACHE_LIMIT = 48;
const MEGAMEK_SCOPED_UNIT_SCORE_CACHE_LIMIT = 48;

function createMegaMekSourceScoreMaps(): Record<MegaMekAvailabilityFrom, Map<AvailabilityUnitKey, number>> {
    return {
        Production: new Map<AvailabilityUnitKey, number>(),
        Salvage: new Map<AvailabilityUnitKey, number>(),
    };
}

function createMegaMekSourceUnitIdSets(): Record<MegaMekAvailabilityFrom, Set<AvailabilityUnitKey>> {
    return {
        Production: new Set<AvailabilityUnitKey>(),
        Salvage: new Set<AvailabilityUnitKey>(),
    };
}

function createMegaMekRarityUnitIdSets(): Map<MegaMekPositiveAvailabilityRarity, Set<AvailabilityUnitKey>> {
    const unitIdsByRarity = new Map<MegaMekPositiveAvailabilityRarity, Set<AvailabilityUnitKey>>();

    for (const rarity of MEGAMEK_AVAILABILITY_RARITY_OPTIONS) {
        unitIdsByRarity.set(rarity, new Set<AvailabilityUnitKey>());
    }

    return unitIdsByRarity;
}

function createMegaMekSourceRarityUnitIdSets(): Record<MegaMekAvailabilityFrom, Map<MegaMekPositiveAvailabilityRarity, Set<AvailabilityUnitKey>>> {
    return {
        Production: createMegaMekRarityUnitIdSets(),
        Salvage: createMegaMekRarityUnitIdSets(),
    };
}

function createMegaMekSourceRaritySets(): Record<MegaMekAvailabilityFrom, Set<MegaMekPositiveAvailabilityRarity>> {
    return {
        Production: new Set<MegaMekPositiveAvailabilityRarity>(),
        Salvage: new Set<MegaMekPositiveAvailabilityRarity>(),
    };
}

function getOrCreateMapValue<K, V>(map: Map<K, V>, key: K, createValue: () => V): V {
    const existing = map.get(key);
    if (existing) {
        return existing;
    }

    const created = createValue();
    map.set(key, created);
    return created;
}

function addUnitKeys(target: Set<AvailabilityUnitKey>, source: ReadonlySet<AvailabilityUnitKey> | undefined): void {
    if (!source || source.size === 0) {
        return;
    }

    for (const unitKey of source) {
        target.add(unitKey);
    }
}

@Injectable({
    providedIn: 'root'
})
export class UnitAvailabilitySourceService {
    private readonly dataService = inject(DataService);
    private readonly optionsService = inject(OptionsService);
    private readonly forceAvailabilityContextBySource = new Map<AvailabilitySource, ForceAvailabilityContext>();

    private mulEraUnitIdsCache = new WeakMap<Era, Set<AvailabilityUnitKey>>();
    private mulFactionUnitIdsCache = new WeakMap<Faction, Set<AvailabilityUnitKey>>();
    private mulFactionEraUnitIdsCache = new WeakMap<Faction, Map<number, Set<AvailabilityUnitKey>>>();
    private mulMembershipPairsByUnitId = new Map<number, readonly MulMembershipPair[]>();
    private mulCacheVersion = -1;

    private megaMekIndexVersion = '';
    private megaMekExtinctEraUnitIds = new Map<number, Set<AvailabilityUnitKey>>();
    private megaMekAvailabilityEntriesByUnitKey = new Map<AvailabilityUnitKey, readonly MegaMekUnitAvailabilityEntry[]>();
    private megaMekAllUnitIds = new Set<AvailabilityUnitKey>();
    private megaMekKnownUnitIds = new Set<AvailabilityUnitKey>();
    private megaMekUnitIdByName = new Map<AvailabilityUnitKey, number>();
    private megaMekUnitNameById = new Map<number, AvailabilityUnitKey>();
    private megaMekExtinctAllUnitIds = new Set<AvailabilityUnitKey>();
    private megaMekScopedAvailabilityBlocks = new Map<string, MegaMekScopedAvailabilityBlock>();
    private megaMekScopedUnitScoreCache = new Map<string, Map<AvailabilityUnitKey, number>>();

    public getVisibleEraUnitIds(era: Era, availabilitySource?: AvailabilitySource): Set<AvailabilityUnitKey> {
        this.ensureMulCacheVersion();

        if (!this.useMegaMekAvailability(availabilitySource)) {
            return this.getMulVisibleEraUnitIds(era);
        }

        return new Set(this.getMegaMekMembershipUnitIds({
            eraIds: new Set([era.id]),
        }));
    }

    public getFactionEraUnitIds(
        faction: Faction,
        era: Era,
        availabilitySource?: AvailabilitySource,
    ): Set<AvailabilityUnitKey> {
        this.ensureMulCacheVersion();

        if (!this.useMegaMekAvailability(availabilitySource)) {
            return new Set(this.getMulFactionEraUnitIds(faction, era.id));
        }

        return new Set(this.getMegaMekMembershipUnitIds({
            eraIds: new Set([era.id]),
            factionIds: new Set([faction.id]),
        }));
    }

    public getFactionUnitIds(
        faction: Faction,
        contextEraIds?: ReadonlySet<number>,
        availabilitySource?: AvailabilitySource,
    ): Set<AvailabilityUnitKey> {
        this.ensureMulCacheVersion();
        const singleEraId = this.getSingleScopedEraId(contextEraIds);

        if (!this.useMegaMekAvailability(availabilitySource)) {
            if (singleEraId !== null) {
                return new Set(this.getMulFactionEraUnitIds(faction, singleEraId));
            }

            return this.getMulFactionUnitIds(faction, contextEraIds);
        }

        return new Set(this.getMegaMekMembershipUnitIds({
            ...(contextEraIds ? { eraIds: contextEraIds } : {}),
            factionIds: new Set([faction.id]),
        }));
    }

    public unitBelongsToEra(unit: Unit, era: Era, availabilitySource?: AvailabilitySource): boolean {
        return this.getVisibleEraUnitIds(era, availabilitySource).has(this.getUnitAvailabilityKey(unit, availabilitySource));
    }

    public unitBelongsToFaction(
        unit: Unit,
        faction: Faction,
        contextEraIds?: ReadonlySet<number>,
        availabilitySource?: AvailabilitySource,
    ): boolean {
        return this.getFactionUnitIds(faction, contextEraIds, availabilitySource).has(this.getUnitAvailabilityKey(unit, availabilitySource));
    }

    public getUnitAvailabilityKey(unit: Pick<Unit, 'id' | 'name'>, availabilitySource?: AvailabilitySource): AvailabilityUnitKey {
        return this.useMegaMekAvailability(availabilitySource) ? unit.name : String(unit.id);
    }

    public getMegaMekAvailabilityScore(
        unit: Pick<Unit, 'name'>,
        context?: MegaMekAvailabilityFilterContext,
    ): number {
        return this.getMegaMekAvailabilityScoreResolver(context)(unit);
    }

    public getMegaMekAvailabilityScoreResolver(
        context?: MegaMekAvailabilityFilterContext,
    ): (unit: Pick<Unit, 'name'>) => number {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        if (this.hasEmptyMegaMekScope(context)) {
            return (unit: Pick<Unit, 'name'>): number => this.megaMekKnownUnitIds.has(unit.name)
                ? 0
                : MEGAMEK_AVAILABILITY_UNKNOWN_SCORE;
        }

        if (context?.availabilityRarities && context.availabilityRarities.size > 0) {
            const scoreCache = this.getOrCreateMegaMekScopedUnitScoreCache(context);
            const availabilityFrom = this.getRequestedAvailabilitySources(context);

            return (unit: Pick<Unit, 'name'>): number => {
                const cached = scoreCache.get(unit.name);
                if (cached !== undefined) {
                    return cached;
                }

                const score = this.computeMegaMekAvailabilityScore(unit.name, context, availabilityFrom);
                scoreCache.set(unit.name, score);
                return score;
            };
        }

        const availabilityBlock = this.getMegaMekScopedAvailabilityBlock(context);
        const availabilityFrom = this.getRequestedAvailabilitySources(context);

        return (unit: Pick<Unit, 'name'>): number => {
            return this.getMegaMekAvailabilityScoreFromBlock(unit.name, availabilityBlock, availabilityFrom);
        };
    }

    public unitHasMegaMekAvailability(unit: Unit): boolean {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        return this.megaMekKnownUnitIds.has(unit.name);
    }

    public getMegaMekAvailabilityUnitIds(
        context?: MegaMekAvailabilityFilterContext,
    ): ReadonlySet<AvailabilityUnitKey> {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        if (this.hasEmptyMegaMekScope(context)) {
            return new Set<AvailabilityUnitKey>();
        }

        const availabilityBlock = this.getMegaMekScopedAvailabilityBlock(context);
        const selectedSources = this.getRequestedAvailabilitySources(context);
        return this.getMegaMekAvailableUnitIdsFromBlock(availabilityBlock, selectedSources);
    }

    public getMegaMekMembershipUnitIds(
        context?: MegaMekAvailabilityFilterContext,
    ): ReadonlySet<AvailabilityUnitKey> {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        if (this.hasEmptyMegaMekScope(context)) {
            return new Set<AvailabilityUnitKey>();
        }

        return this.getMegaMekScopedAvailabilityBlock(context).membershipUnitIds;
    }

    public getMegaMekRarityUnitIds(
        rarity: MegaMekAvailabilityRarity,
        context?: MegaMekAvailabilityFilterContext,
    ): ReadonlySet<AvailabilityUnitKey> {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        if (this.hasEmptyMegaMekScope(context)) {
            return new Set<AvailabilityUnitKey>();
        }

        const availabilityBlock = this.getMegaMekScopedAvailabilityBlock(context);
        const selectedSources = this.getRequestedAvailabilitySources(context);

        if (rarity === MEGAMEK_AVAILABILITY_UNKNOWN) {
            return availabilityBlock.unknownUnitIds;
        }

        if (rarity === MEGAMEK_AVAILABILITY_NOT_AVAILABLE) {
            return this.getMegaMekUnavailableUnitIdsFromBlock(availabilityBlock, selectedSources);
        }

        return this.getMegaMekRarityUnitIdsFromBlock(availabilityBlock, rarity, selectedSources);
    }

    public getMegaMekUnknownUnitIds(
        context?: MegaMekAvailabilityFilterContext,
    ): ReadonlySet<AvailabilityUnitKey> {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        if (this.hasEmptyMegaMekScope(context)) {
            return new Set<AvailabilityUnitKey>();
        }

        return this.getMegaMekScopedAvailabilityBlock(context).unknownUnitIds;
    }

    public unitMatchesAvailabilityFrom(
        unit: Unit,
        availabilityFromName: string,
        context?: MegaMekAvailabilityFilterContext,
    ): boolean {
        if (availabilityFromName.trim().toLowerCase() === MEGAMEK_AVAILABILITY_UNKNOWN.toLowerCase()) {
            return this.getMegaMekUnknownUnitIds(context).has(unit.name);
        }

        const availabilityFrom = this.resolveMegaMekAvailabilityFrom(availabilityFromName);
        if (!availabilityFrom) {
            return false;
        }

        return this.getMegaMekAvailabilityUnitIds({
            ...context,
            availabilityFrom: new Set([availabilityFrom]),
        }).has(unit.name);
    }

    public unitMatchesAvailabilityRarity(
        unit: Unit,
        rarityName: string,
        context?: MegaMekAvailabilityFilterContext,
    ): boolean {
        const rarity = this.resolveMegaMekAvailabilityRarity(rarityName);
        if (!rarity) {
            return false;
        }

        if (rarity === MEGAMEK_AVAILABILITY_UNKNOWN) {
            return this.getMegaMekUnknownUnitIds(context).has(unit.name);
        }

        return this.getMegaMekRarityUnitIds(rarity, context).has(unit.name);
    }

    public getForceAvailabilityContext(availabilitySource?: AvailabilitySource): ForceAvailabilityContext {
        const resolvedSource = availabilitySource ?? this.optionsService.options().availabilitySource;
        const existing = this.forceAvailabilityContextBySource.get(resolvedSource);
        if (existing) {
            return existing;
        }

        const context: ForceAvailabilityContext = {
            source: resolvedSource,
            getUnitKey: (unit) => this.getUnitAvailabilityKey(unit, resolvedSource),
            getVisibleEraUnitIds: (era) => this.getVisibleEraUnitIds(era, resolvedSource),
            getFactionUnitIds: (faction, contextEraIds) => this.getFactionUnitIds(faction, contextEraIds, resolvedSource),
            getFactionEraUnitIds: (faction, era) => this.getFactionEraUnitIds(faction, era, resolvedSource),
        };

        this.forceAvailabilityContextBySource.set(resolvedSource, context);
        return context;
    }

    public collectFastMulUnknownOptionIds(
        contextUnits: readonly Pick<Unit, 'id' | 'name'>[],
        target: 'era' | 'faction',
        selectedEraIds?: ReadonlySet<number>,
        selectedFactionIds?: ReadonlySet<number>,
    ): ReadonlySet<number> {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        const availableIds = new Set<number>();
        const maxAvailableIds = target === 'era'
            ? selectedEraIds?.size ?? this.dataService.getEras().length
            : selectedFactionIds?.size
                ?? this.dataService.getFactions().filter((faction) => faction.id !== MULFACTION_EXTINCT).length;

        for (const unit of contextUnits) {
            const availabilityEntriesByEra = this.dataService.getMegaMekAvailabilityRecordForUnit(unit)?.e;

            for (const membershipPair of this.getMulMembershipPairsByUnitId(unit.id)) {
                if (selectedEraIds && !selectedEraIds.has(membershipPair.eraId)) {
                    continue;
                }

                if (selectedFactionIds && !selectedFactionIds.has(membershipPair.factionId)) {
                    continue;
                }

                const eraAvailability = availabilityEntriesByEra?.[membershipPair.eraId];
                if (eraAvailability?.[membershipPair.factionId] !== undefined) {
                    continue;
                }

                availableIds.add(target === 'era' ? membershipPair.eraId : membershipPair.factionId);
                if (availableIds.size === maxAvailableIds) {
                    return availableIds;
                }
            }
        }

        return availableIds;
    }

    public useMegaMekAvailability(availabilitySource?: AvailabilitySource): boolean {
        return (availabilitySource ?? this.optionsService.options().availabilitySource) === 'megamek';
    }

    private ensureMulCacheVersion(): void {
        const nextVersion = this.dataService.searchCorpusVersion();
        if (this.mulCacheVersion === nextVersion) {
            return;
        }

        this.mulCacheVersion = nextVersion;
        this.mulEraUnitIdsCache = new WeakMap<Era, Set<AvailabilityUnitKey>>();
        this.mulFactionUnitIdsCache = new WeakMap<Faction, Set<AvailabilityUnitKey>>();
        this.mulFactionEraUnitIdsCache = new WeakMap<Faction, Map<number, Set<AvailabilityUnitKey>>>();
        this.mulMembershipPairsByUnitId.clear();
        this.megaMekIndexVersion = '';
        this.resetMegaMekIndexes();
    }

    private getMulVisibleEraUnitIds(era: Era): Set<AvailabilityUnitKey> {
        const cached = this.mulEraUnitIdsCache.get(era);
        if (cached) {
            return cached;
        }

        const extinctFaction = this.dataService.getFactionById(MULFACTION_EXTINCT);
        const extinctUnitIdsForEra = extinctFaction?.eras[era.id] as Set<number> | undefined;
        const visibleUnitIds = new Set<AvailabilityUnitKey>();

        for (const unitId of era.units as Set<number>) {
            if (!extinctUnitIdsForEra?.has(unitId)) {
                visibleUnitIds.add(String(unitId));
            }
        }

        this.mulEraUnitIdsCache.set(era, visibleUnitIds);
        return visibleUnitIds;
    }

    private getSingleScopedEraId(contextEraIds?: ReadonlySet<number>): number | null {
        if (!contextEraIds || contextEraIds.size !== 1) {
            return null;
        }

        const firstEntry = contextEraIds.values().next();
        return firstEntry.done ? null : firstEntry.value;
    }

    private getMulFactionEraUnitIds(faction: Faction, eraId: number): Set<AvailabilityUnitKey> {
        let factionEraUnitIds = this.mulFactionEraUnitIdsCache.get(faction);
        if (!factionEraUnitIds) {
            factionEraUnitIds = new Map<number, Set<AvailabilityUnitKey>>();
            this.mulFactionEraUnitIdsCache.set(faction, factionEraUnitIds);
        }

        const cached = factionEraUnitIds.get(eraId);
        if (cached) {
            return cached;
        }

        const unitIds = new Set<AvailabilityUnitKey>();
        const eraUnitIds = faction.eras[eraId] as Set<number> | undefined;
        if (eraUnitIds) {
            for (const unitId of eraUnitIds) {
                unitIds.add(String(unitId));
            }
        }

        factionEraUnitIds.set(eraId, unitIds);
        return unitIds;
    }

    private getMulFactionUnitIds(faction: Faction, contextEraIds?: ReadonlySet<number>): Set<AvailabilityUnitKey> {
        if (!contextEraIds) {
            const cached = this.mulFactionUnitIdsCache.get(faction);
            if (cached) {
                return cached;
            }
        }

        const unitIds = new Set<AvailabilityUnitKey>();
        for (const [eraIdText, eraUnitIds] of Object.entries(faction.eras) as Array<[string, Set<number>]>) {
            const eraId = Number(eraIdText);
            if (contextEraIds && !contextEraIds.has(eraId)) {
                continue;
            }

            for (const unitId of eraUnitIds) {
                unitIds.add(String(unitId));
            }
        }

        if (!contextEraIds) {
            this.mulFactionUnitIdsCache.set(faction, unitIds);
        }

        return unitIds;
    }

    private ensureMegaMekIndexes(): void {
        const nextIndexVersion = `${this.dataService.searchCorpusVersion()}:${this.dataService.megaMekAvailabilityVersion()}`;
        if (this.megaMekIndexVersion === nextIndexVersion) {
            return;
        }

        this.megaMekIndexVersion = nextIndexVersion;
        this.resetMegaMekIndexes();

        const units = this.dataService.getUnits();
        const availableUnitIdsByEra = new Map<number, Set<AvailabilityUnitKey>>();

        for (const unit of units) {
            this.megaMekAllUnitIds.add(unit.name);
            this.megaMekUnitIdByName.set(unit.name, unit.id);
            this.megaMekUnitNameById.set(unit.id, unit.name);

            const availabilityRecord = this.dataService.getMegaMekAvailabilityRecordForUnit(unit);
            if (!availabilityRecord) {
                continue;
            }

            this.megaMekKnownUnitIds.add(unit.name);

            const unitKey = unit.name;
            const entries: MegaMekUnitAvailabilityEntry[] = [];

            for (const [eraIdText, eraAvailability] of Object.entries(availabilityRecord.e)) {
                const eraId = Number(eraIdText);
                if (Number.isNaN(eraId)) {
                    continue;
                }

                for (const [factionIdText, weights] of Object.entries(eraAvailability)) {
                    const factionId = Number(factionIdText);
                    if (Number.isNaN(factionId)) {
                        continue;
                    }

                    const value = [weights[0] ?? 0, weights[1] ?? 0] as const;
                    entries.push({
                        eraId,
                        factionId,
                        production: value[0],
                        salvage: value[1],
                    });

                    if (isMegaMekAvailabilityValueAvailable(value as [number, number])) {
                        getOrCreateMapValue(availableUnitIdsByEra, eraId, () => new Set<AvailabilityUnitKey>()).add(unitKey);
                    }
                }
            }

            if (entries.length > 0) {
                this.megaMekAvailabilityEntriesByUnitKey.set(unitKey, entries);
            }
        }

        this.buildMegaMekExtinctIndexes(availableUnitIdsByEra);
    }

    private buildMegaMekExtinctIndexes(availableUnitIdsByEra: ReadonlyMap<number, ReadonlySet<AvailabilityUnitKey>>): void {
        const previouslyAvailableUnitIds = new Set<AvailabilityUnitKey>();
        this.megaMekExtinctAllUnitIds.clear();

        for (const era of this.dataService.getEras()) {
            const currentlyAvailableUnitIds = availableUnitIdsByEra.get(era.id) ?? new Set<AvailabilityUnitKey>();
            const extinctUnitIds = new Set<AvailabilityUnitKey>();

            for (const unitId of previouslyAvailableUnitIds) {
                if (!currentlyAvailableUnitIds.has(unitId)) {
                    extinctUnitIds.add(unitId);
                }
            }

            if (extinctUnitIds.size > 0) {
                this.megaMekExtinctEraUnitIds.set(era.id, extinctUnitIds);
                addUnitKeys(this.megaMekExtinctAllUnitIds, extinctUnitIds);
            }

            for (const unitId of currentlyAvailableUnitIds) {
                previouslyAvailableUnitIds.add(unitId);
            }
        }
    }

    private buildMegaMekScopedAvailabilityBlockKey(
        context?: MegaMekAvailabilityFilterContext,
    ): string {
        const eraKey = context?.eraIds
            ? [...context.eraIds].sort((left, right) => left - right).join(',')
            : '*';
        const factionKey = context?.factionIds
            ? [...context.factionIds].sort((left, right) => left - right).join(',')
            : '*';
        const bridgeKey = context?.bridgeThroughMulMembership ? 'mul' : 'megamek';

        return `${bridgeKey}|e=${eraKey}|f=${factionKey}`;
    }

    private getMegaMekScopedAvailabilityBlock(
        context?: MegaMekAvailabilityFilterContext,
    ): MegaMekScopedAvailabilityBlock {
        const cacheKey = this.buildMegaMekScopedAvailabilityBlockKey(context);
        const cached = this.megaMekScopedAvailabilityBlocks.get(cacheKey);
        if (cached) {
            this.megaMekScopedAvailabilityBlocks.delete(cacheKey);
            this.megaMekScopedAvailabilityBlocks.set(cacheKey, cached);
            return cached;
        }

        const block = this.createMegaMekScopedAvailabilityBlock(context);
        this.megaMekScopedAvailabilityBlocks.set(cacheKey, block);
        while (this.megaMekScopedAvailabilityBlocks.size > MEGAMEK_SCOPED_AVAILABILITY_BLOCK_CACHE_LIMIT) {
            const oldestKey = this.megaMekScopedAvailabilityBlocks.keys().next().value;
            if (oldestKey === undefined) {
                break;
            }

            this.megaMekScopedAvailabilityBlocks.delete(oldestKey);
        }

        return block;
    }

    private createMegaMekScopedAvailabilityBlock(
        context?: MegaMekAvailabilityFilterContext,
    ): MegaMekScopedAvailabilityBlock {
        const membershipUnitIds = new Set<AvailabilityUnitKey>();
        const knownUnitIds = new Set<AvailabilityUnitKey>();
        const unknownUnitIds = new Set<AvailabilityUnitKey>();
        const sourceScores = createMegaMekSourceScoreMaps();
        const sourceAvailableUnitIds = createMegaMekSourceUnitIdSets();
        const sourceRarityUnitIds = createMegaMekSourceRarityUnitIdSets();
        const bridgeThroughMulMembership = context?.bridgeThroughMulMembership === true;
        const hasScopedMembershipFilters = context?.eraIds !== undefined || context?.factionIds !== undefined;

        for (const unitKey of this.megaMekAllUnitIds) {
            const unitId = this.megaMekUnitIdByName.get(unitKey);
            const entries = this.getMegaMekEntries(unitKey);
            const hasMegaMekRecord = this.megaMekKnownUnitIds.has(unitKey);

            if (bridgeThroughMulMembership) {
                if (!this.matchesMulMembershipScope(unitId, context)) {
                    continue;
                }

                membershipUnitIds.add(unitKey);

                if (!hasMegaMekRecord) {
                    unknownUnitIds.add(unitKey);
                    continue;
                }

                const hasScopedMegaMekEntries = this.hasScopedMegaMekEntries(unitId, entries, context);
                if (hasScopedMembershipFilters && this.hasUnknownMulAvailabilityInScope(unitId, entries, context)) {
                    unknownUnitIds.add(unitKey);
                }

                if (!hasScopedMegaMekEntries) {
                    continue;
                }
            } else if (hasScopedMembershipFilters) {
                if (this.matchesMegaMekMembership(unitKey, entries, context)) {
                    membershipUnitIds.add(unitKey);
                }

                if (!hasMegaMekRecord || !this.hasScopedMegaMekEntries(unitId, entries, context)) {
                    continue;
                }
            } else {
                if (!hasMegaMekRecord) {
                    unknownUnitIds.add(unitKey);
                    continue;
                }

                if (entries.some((entry) => this.entryHasAnyAvailability(entry))) {
                    membershipUnitIds.add(unitKey);
                }
            }

            knownUnitIds.add(unitKey);

            const scopedScores = this.computeScopedSourceScoresForUnit(unitId, entries, context);
            const scopedSourceRarities = MEGAMEK_AVAILABILITY_FILTERS_USE_ALL_SCOPED_OPTIONS
                ? this.collectScopedSourceRaritiesForUnit(unitId, entries, context)
                : null;
            for (const source of MEGAMEK_AVAILABILITY_FROM_OPTIONS) {
                const score = scopedScores[source];
                if (score <= 0) {
                    continue;
                }

                sourceScores[source].set(unitKey, score);
                sourceAvailableUnitIds[source].add(unitKey);

                if (MEGAMEK_AVAILABILITY_FILTERS_USE_ALL_SCOPED_OPTIONS && scopedSourceRarities) {
                    for (const rarity of scopedSourceRarities[source]) {
                        sourceRarityUnitIds[source].get(rarity)?.add(unitKey);
                    }
                    continue;
                }

                const rarity = getMegaMekAvailabilityRarityForScore(score);
                if (rarity !== MEGAMEK_AVAILABILITY_NOT_AVAILABLE) {
                    sourceRarityUnitIds[source].get(rarity)?.add(unitKey);
                }
            }
        }

        return {
            membershipUnitIds,
            knownUnitIds,
            unknownUnitIds,
            sourceScores,
            sourceAvailableUnitIds,
            sourceRarityUnitIds,
            combinedPositiveScoreCache: new Map<string, ReadonlyMap<AvailabilityUnitKey, number>>(),
            combinedAvailableUnitIdsCache: new Map<string, ReadonlySet<AvailabilityUnitKey>>(),
            combinedRarityUnitIdsCache: new Map<string, ReadonlyMap<MegaMekPositiveAvailabilityRarity, ReadonlySet<AvailabilityUnitKey>>>(),
        };
    }

    private getMegaMekAvailabilityScoreFromBlock(
        unitKey: AvailabilityUnitKey,
        availabilityBlock: MegaMekScopedAvailabilityBlock,
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
    ): number {
        if (!this.megaMekKnownUnitIds.has(unitKey)) {
            return MEGAMEK_AVAILABILITY_UNKNOWN_SCORE;
        }

        return this.getMegaMekCombinedPositiveScoreMap(availabilityBlock, availabilityFrom).get(unitKey) ?? 0;
    }

    private getMegaMekAvailableUnitIdsFromBlock(
        availabilityBlock: MegaMekScopedAvailabilityBlock,
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
    ): ReadonlySet<AvailabilityUnitKey> {
        const sourceKey = this.buildMegaMekAvailabilitySourceKey(availabilityFrom);
        const cached = availabilityBlock.combinedAvailableUnitIdsCache.get(sourceKey);
        if (cached) {
            return cached;
        }

        const unitIds = new Set<AvailabilityUnitKey>();
        for (const source of availabilityFrom) {
            addUnitKeys(unitIds, availabilityBlock.sourceAvailableUnitIds[source]);
        }

        availabilityBlock.combinedAvailableUnitIdsCache.set(sourceKey, unitIds);
        return unitIds;
    }

    private getMegaMekUnavailableUnitIdsFromBlock(
        availabilityBlock: MegaMekScopedAvailabilityBlock,
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
    ): ReadonlySet<AvailabilityUnitKey> {
        const availableUnitIds = this.getMegaMekAvailableUnitIdsFromBlock(availabilityBlock, availabilityFrom);
        const unitIds = new Set<AvailabilityUnitKey>();

        for (const unitKey of availabilityBlock.knownUnitIds) {
            if (!availableUnitIds.has(unitKey)) {
                unitIds.add(unitKey);
            }
        }

        return unitIds;
    }

    private getMegaMekRarityUnitIdsFromBlock(
        availabilityBlock: MegaMekScopedAvailabilityBlock,
        rarity: MegaMekPositiveAvailabilityRarity,
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
    ): ReadonlySet<AvailabilityUnitKey> {
        const sourceKey = this.buildMegaMekAvailabilitySourceKey(availabilityFrom);
        let rarityUnitIds = availabilityBlock.combinedRarityUnitIdsCache.get(sourceKey);
        if (!rarityUnitIds) {
            if (availabilityFrom.length === 1) {
                rarityUnitIds = availabilityBlock.sourceRarityUnitIds[availabilityFrom[0]];
            } else {
                const combinedRarityUnitIds = createMegaMekRarityUnitIdSets();

                for (const source of availabilityFrom) {
                    const sourceRarityUnitIds = availabilityBlock.sourceRarityUnitIds[source];
                    for (const sourceRarity of MEGAMEK_AVAILABILITY_RARITY_OPTIONS) {
                        const combinedUnitIds = combinedRarityUnitIds.get(sourceRarity);
                        if (!combinedUnitIds) {
                            continue;
                        }

                        addUnitKeys(combinedUnitIds, sourceRarityUnitIds.get(sourceRarity));
                    }
                }

                rarityUnitIds = combinedRarityUnitIds;
            }

            availabilityBlock.combinedRarityUnitIdsCache.set(sourceKey, rarityUnitIds);
        }

        return rarityUnitIds.get(rarity) ?? new Set<AvailabilityUnitKey>();
    }

    private getMegaMekCombinedPositiveScoreMap(
        availabilityBlock: MegaMekScopedAvailabilityBlock,
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
    ): ReadonlyMap<AvailabilityUnitKey, number> {
        const sourceKey = this.buildMegaMekAvailabilitySourceKey(availabilityFrom);
        const cached = availabilityBlock.combinedPositiveScoreCache.get(sourceKey);
        if (cached) {
            return cached;
        }

        if (availabilityFrom.length === 1) {
            const sourceScores = availabilityBlock.sourceScores[availabilityFrom[0]];
            availabilityBlock.combinedPositiveScoreCache.set(sourceKey, sourceScores);
            return sourceScores;
        }

        const scores = new Map<AvailabilityUnitKey, number>();
        for (const unitKey of availabilityBlock.knownUnitIds) {
            let maxScore = 0;
            for (const source of availabilityFrom) {
                const score = availabilityBlock.sourceScores[source].get(unitKey) ?? 0;
                if (score > maxScore) {
                    maxScore = score;
                }
            }

            if (maxScore > 0) {
                scores.set(unitKey, maxScore);
            }
        }

        availabilityBlock.combinedPositiveScoreCache.set(sourceKey, scores);
        return scores;
    }

    private buildMegaMekAvailabilitySourceKey(
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
    ): string {
        const selectedSources = new Set(availabilityFrom);
        return MEGAMEK_AVAILABILITY_FROM_OPTIONS
            .filter((source) => selectedSources.has(source))
            .join(',');
    }

    private hasScopedMegaMekEntries(
        unitId: number | undefined,
        entries: readonly MegaMekUnitAvailabilityEntry[],
        context?: MegaMekAvailabilityFilterContext,
    ): boolean {
        return entries.some((entry) => this.entryMatchesMegaMekScopeForUnit(unitId, entry, context));
    }

    private hasUnknownMulAvailabilityInScope(
        unitId: number | undefined,
        entries: readonly MegaMekUnitAvailabilityEntry[],
        context?: MegaMekAvailabilityFilterContext,
    ): boolean {
        if (unitId === undefined) {
            return false;
        }

        const scopedEntryKeys = new Set<string>();
        for (const entry of entries) {
            if (!this.entryMatchesMegaMekScopeForUnit(unitId, entry, context)) {
                continue;
            }

            scopedEntryKeys.add(`${entry.eraId}:${entry.factionId}`);
        }

        for (const membershipPair of this.getMulMembershipPairsByUnitId(unitId)) {
            if (context?.eraIds && !context.eraIds.has(membershipPair.eraId)) {
                continue;
            }

            if (context?.factionIds && !context.factionIds.has(membershipPair.factionId)) {
                continue;
            }

            if (!scopedEntryKeys.has(`${membershipPair.eraId}:${membershipPair.factionId}`)) {
                return true;
            }
        }

        return false;
    }

    private computeScopedSourceScoresForUnit(
        unitId: number | undefined,
        entries: readonly MegaMekUnitAvailabilityEntry[],
        context?: MegaMekAvailabilityFilterContext,
    ): Record<MegaMekAvailabilityFrom, number> {
        let production = 0;
        let salvage = 0;

        for (const entry of entries) {
            if (!this.entryMatchesMegaMekScopeForUnit(unitId, entry, context)) {
                continue;
            }

            if (entry.production > production) {
                production = entry.production;
            }
            if (entry.salvage > salvage) {
                salvage = entry.salvage;
            }
        }

        return {
            Production: production,
            Salvage: salvage,
        };
    }

    private collectScopedSourceRaritiesForUnit(
        unitId: number | undefined,
        entries: readonly MegaMekUnitAvailabilityEntry[],
        context?: MegaMekAvailabilityFilterContext,
    ): Record<MegaMekAvailabilityFrom, Set<MegaMekPositiveAvailabilityRarity>> {
        const raritiesBySource = createMegaMekSourceRaritySets();

        for (const entry of entries) {
            if (!this.entryMatchesMegaMekScopeForUnit(unitId, entry, context)) {
                continue;
            }

            const value = [entry.production, entry.salvage] as [number, number];
            for (const source of MEGAMEK_AVAILABILITY_FROM_OPTIONS) {
                const score = getMegaMekAvailabilityValueForSource(value, source);
                if (score <= 0) {
                    continue;
                }

                const rarity = getMegaMekAvailabilityRarityForScore(score);
                if (rarity !== MEGAMEK_AVAILABILITY_NOT_AVAILABLE) {
                    raritiesBySource[source].add(rarity);
                }
            }
        }

        return raritiesBySource;
    }

    private entryMatchesMegaMekScopeForUnit(
        unitId: number | undefined,
        entry: MegaMekUnitAvailabilityEntry,
        context?: MegaMekAvailabilityFilterContext,
    ): boolean {
        if (context?.eraIds && !context.eraIds.has(entry.eraId)) {
            return false;
        }

        if (context?.bridgeThroughMulMembership) {
            if (unitId === undefined || !this.matchesMulFactionMembershipInEra(unitId, entry.factionId, entry.eraId)) {
                return false;
            }

            return !context.factionIds || context.factionIds.has(entry.factionId);
        }

        return !context?.factionIds || context.factionIds.has(entry.factionId);
    }

    private matchesMulMembershipScope(
        unitId: number | undefined,
        context?: MegaMekAvailabilityFilterContext,
    ): boolean {
        if (unitId === undefined) {
            return false;
        }

        const unitKey = String(unitId);
        return this.matchesMegaMekScope(context, {
            pair: (eraId, factionId) => this.getMulFactionEraUnitIdsById(factionId, eraId).has(unitKey),
            era: (eraId) => this.getMulVisibleEraUnitIdsById(eraId).has(unitKey),
            faction: (factionId) => this.getMulFactionUnitIdsById(factionId).has(unitKey),
            any: () => true,
        });
    }

    private matchesMulFactionMembershipInEra(unitId: number, factionId: number, eraId: number): boolean {
        return this.getMulFactionEraUnitIdsById(factionId, eraId).has(String(unitId));
    }

    private getMulVisibleEraUnitIdsById(eraId: number): Set<AvailabilityUnitKey> {
        const era = this.dataService.getEras().find((candidate) => candidate.id === eraId);
        if (era) {
            const visibleUnitIds = this.getMulVisibleEraUnitIds(era);
            const eraUnitCount = Array.isArray(era.units)
                ? era.units.length
                : era.units.size;
            if (visibleUnitIds.size > 0 || eraUnitCount > 0) {
                return visibleUnitIds;
            }
        }

        const unitIds = new Set<AvailabilityUnitKey>();
        for (const faction of this.dataService.getFactions()) {
            if (faction.id === MULFACTION_EXTINCT) {
                continue;
            }

            addUnitKeys(unitIds, this.getMulFactionEraUnitIds(faction, eraId));
        }

        return unitIds;
    }

    private getMulFactionEraUnitIdsById(factionId: number, eraId: number): Set<AvailabilityUnitKey> {
        const faction = this.dataService.getFactionById(factionId);
        return faction ? this.getMulFactionEraUnitIds(faction, eraId) : new Set<AvailabilityUnitKey>();
    }

    private getMulFactionUnitIdsById(factionId: number): Set<AvailabilityUnitKey> {
        const faction = this.dataService.getFactionById(factionId);
        return faction ? this.getMulFactionUnitIds(faction) : new Set<AvailabilityUnitKey>();
    }

    private membershipContainsUnitId(
        membership: Set<number> | number[] | undefined,
        unitId: number,
    ): boolean {
        if (!membership) {
            return false;
        }

        return membership instanceof Set
            ? membership.has(unitId)
            : membership.includes(unitId);
    }

    private getMulMembershipPairsByUnitId(unitId: number): readonly MulMembershipPair[] {
        const cached = this.mulMembershipPairsByUnitId.get(unitId);
        if (cached) {
            return cached;
        }

        const pairs: MulMembershipPair[] = [];
        for (const faction of this.dataService.getFactions()) {
            if (faction.id === MULFACTION_EXTINCT) {
                continue;
            }

            for (const [eraIdText, membership] of Object.entries(faction.eras) as Array<[string, Set<number> | number[]]>) {
                const eraId = Number(eraIdText);
                if (Number.isNaN(eraId) || !this.membershipContainsUnitId(membership, unitId)) {
                    continue;
                }

                pairs.push({ eraId, factionId: faction.id });
            }
        }

        this.mulMembershipPairsByUnitId.set(unitId, pairs);
        return pairs;
    }

    private buildMegaMekScopedCacheKey(
        kind: 'available' | 'membership' | 'rarity' | 'score' | 'unknown',
        context?: MegaMekAvailabilityFilterContext,
        extras: string[] = [],
    ): string {
        const eraKey = context?.eraIds
            ? [...context.eraIds].sort((left, right) => left - right).join(',')
            : '*';
        const factionKey = context?.factionIds
            ? [...context.factionIds].sort((left, right) => left - right).join(',')
            : '*';
        const availabilityFromKey = context?.availabilityFrom
            ? [...context.availabilityFrom].sort().join(',')
            : '*';
        const availabilityRarityKey = context?.availabilityRarities
            ? [...context.availabilityRarities].sort().join(',')
            : '*';
        const suffix = extras.length > 0 ? `|${extras.join('|')}` : '';

        return `${kind}|e=${eraKey}|f=${factionKey}|from=${availabilityFromKey}|rarity=${availabilityRarityKey}${suffix}`;
    }

    private resetMegaMekIndexes(): void {
        this.megaMekExtinctEraUnitIds.clear();
        this.megaMekAvailabilityEntriesByUnitKey.clear();
        this.megaMekAllUnitIds.clear();
        this.megaMekKnownUnitIds.clear();
        this.megaMekUnitIdByName.clear();
        this.megaMekUnitNameById.clear();
        this.megaMekExtinctAllUnitIds.clear();
        this.megaMekScopedAvailabilityBlocks.clear();
        this.megaMekScopedUnitScoreCache.clear();
    }

    private getMegaMekEntries(unitKey: AvailabilityUnitKey): readonly MegaMekUnitAvailabilityEntry[] {
        return this.megaMekAvailabilityEntriesByUnitKey.get(unitKey) ?? [];
    }

    private getOrCreateMegaMekScopedUnitScoreCache(
        context?: MegaMekAvailabilityFilterContext,
    ): Map<AvailabilityUnitKey, number> {
        const cacheKey = this.buildMegaMekScopedCacheKey('score', context);
        let scopeCache = this.megaMekScopedUnitScoreCache.get(cacheKey);
        if (!scopeCache) {
            scopeCache = new Map<AvailabilityUnitKey, number>();
            this.megaMekScopedUnitScoreCache.set(cacheKey, scopeCache);
            while (this.megaMekScopedUnitScoreCache.size > MEGAMEK_SCOPED_UNIT_SCORE_CACHE_LIMIT) {
                const oldestKey = this.megaMekScopedUnitScoreCache.keys().next().value;
                if (oldestKey === undefined) {
                    break;
                }

                this.megaMekScopedUnitScoreCache.delete(oldestKey);
            }
            return scopeCache;
        }

        this.megaMekScopedUnitScoreCache.delete(cacheKey);
        this.megaMekScopedUnitScoreCache.set(cacheKey, scopeCache);

        return scopeCache;
    }

    private computeMegaMekAvailabilityScore(
        unitName: AvailabilityUnitKey,
        context: MegaMekAvailabilityFilterContext | undefined,
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
    ): number {
        const entries = this.megaMekAvailabilityEntriesByUnitKey.get(unitName);
        if (!entries || entries.length === 0) {
            return MEGAMEK_AVAILABILITY_UNKNOWN_SCORE;
        }

        const unitId = this.megaMekUnitIdByName.get(unitName);
        let maxScore = 0;

        for (const entry of entries) {
            if (!this.entryMatchesMegaMekScopeForUnit(unitId, entry, context)) {
                continue;
            }

            const score = this.getEntryMaxSelectedAvailabilityScore(entry, availabilityFrom, context?.availabilityRarities);
            if (score > maxScore) {
                maxScore = score;
            }
        }

        return maxScore;
    }

    private getEntryMaxSelectedAvailabilityScore(
        entry: MegaMekUnitAvailabilityEntry,
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
        availabilityRarities?: ReadonlySet<MegaMekPositiveAvailabilityRarity>,
    ): number {
        let maxScore = 0;

        for (const source of availabilityFrom) {
            const score = source === 'Production'
                ? entry.production
                : entry.salvage;
            if (score <= 0) {
                continue;
            }

            if (availabilityRarities) {
                const rarity = getMegaMekAvailabilityRarityForScore(score);
                if (rarity === MEGAMEK_AVAILABILITY_NOT_AVAILABLE || !availabilityRarities.has(rarity)) {
                    continue;
                }
            }

            if (score > maxScore) {
                maxScore = score;
            }
        }

        return maxScore;
    }

    private resolveMegaMekAvailabilityFrom(availabilityFromName: string): MegaMekAvailabilityFrom | undefined {
        return MEGAMEK_AVAILABILITY_FROM_LOOKUP.get(availabilityFromName.trim().toLowerCase());
    }

    private resolveMegaMekAvailabilityRarity(rarityName: string): MegaMekAvailabilityRarity | undefined {
        const normalized = rarityName.trim().toLowerCase();
        return MEGAMEK_AVAILABILITY_ALL_RARITY_OPTIONS.find((rarity) => (
            rarity.toLowerCase() === normalized
        )) as MegaMekAvailabilityRarity | undefined;
    }

    private hasEmptyMegaMekScope(context?: MegaMekAvailabilityFilterContext): boolean {
        return (context?.eraIds !== undefined && context.eraIds.size === 0)
            || (context?.factionIds !== undefined && context.factionIds.size === 0);
    }

    private matchesMegaMekScope(
        context: MegaMekAvailabilityFilterContext | undefined,
        handlers: MegaMekScopedMatchHandlers,
    ): boolean {
        if (this.hasEmptyMegaMekScope(context)) {
            return false;
        }

        if (context?.eraIds && context.factionIds) {
            for (const eraId of context.eraIds) {
                for (const factionId of context.factionIds) {
                    if (handlers.pair(eraId, factionId)) {
                        return true;
                    }
                }
            }

            return false;
        }

        if (context?.eraIds) {
            for (const eraId of context.eraIds) {
                if (handlers.era(eraId)) {
                    return true;
                }
            }

            return false;
        }

        if (context?.factionIds) {
            for (const factionId of context.factionIds) {
                if (handlers.faction(factionId)) {
                    return true;
                }
            }

            return false;
        }

        return handlers.any();
    }

    private matchesMegaMekMembership(
        unitKey: AvailabilityUnitKey,
        entries: readonly MegaMekUnitAvailabilityEntry[],
        context?: MegaMekAvailabilityFilterContext,
    ): boolean {
        const hasAvailability = (entry: MegaMekUnitAvailabilityEntry) => this.entryHasAnyAvailability(entry);

        return this.matchesMegaMekScope(context, {
            pair: (eraId, factionId) => factionId === MULFACTION_EXTINCT
                ? this.megaMekExtinctEraUnitIds.get(eraId)?.has(unitKey) === true
                : this.matchesMegaMekAvailabilityForPair(entries, eraId, factionId, hasAvailability),
            era: (eraId) => this.matchesMegaMekAvailabilityForEra(entries, eraId, hasAvailability),
            faction: (factionId) => factionId === MULFACTION_EXTINCT
                ? this.megaMekExtinctAllUnitIds.has(unitKey)
                : this.matchesMegaMekAvailabilityForFaction(entries, factionId, hasAvailability),
            any: () => entries.some(hasAvailability),
        });
    }

    private matchesMegaMekAvailabilityPredicate(
        entries: readonly MegaMekUnitAvailabilityEntry[],
        context: MegaMekAvailabilityFilterContext | undefined,
        predicate: (entry: MegaMekUnitAvailabilityEntry) => boolean,
    ): boolean {
        return this.matchesMegaMekScope(context, {
            pair: (eraId, factionId) => this.matchesMegaMekAvailabilityForPair(entries, eraId, factionId, predicate),
            era: (eraId) => this.matchesMegaMekAvailabilityForEra(entries, eraId, predicate),
            faction: (factionId) => this.matchesMegaMekAvailabilityForFaction(entries, factionId, predicate),
            any: () => entries.some(predicate),
        });
    }

    private matchesMegaMekAvailabilityForPair(
        entries: readonly MegaMekUnitAvailabilityEntry[],
        eraId: number,
        factionId: number,
        predicate: (entry: MegaMekUnitAvailabilityEntry) => boolean,
    ): boolean {
        if (factionId === MULFACTION_EXTINCT) {
            return false;
        }

        const entry = entries.find((candidate) => candidate.eraId === eraId && candidate.factionId === factionId);
        if (!entry) {
            return false;
        }

        return predicate(entry);
    }

    private matchesMegaMekAvailabilityForEra(
        entries: readonly MegaMekUnitAvailabilityEntry[],
        eraId: number,
        predicate: (entry: MegaMekUnitAvailabilityEntry) => boolean,
    ): boolean {
        return entries.some((entry) => entry.eraId === eraId && predicate(entry));
    }

    private matchesMegaMekAvailabilityForFaction(
        entries: readonly MegaMekUnitAvailabilityEntry[],
        factionId: number,
        predicate: (entry: MegaMekUnitAvailabilityEntry) => boolean,
    ): boolean {
        if (factionId === MULFACTION_EXTINCT) {
            return false;
        }

        return entries.some((entry) => entry.factionId === factionId && predicate(entry));
    }

    private matchesMegaMekUnavailable(
        unitKey: AvailabilityUnitKey,
        entries: readonly MegaMekUnitAvailabilityEntry[],
        context: MegaMekAvailabilityFilterContext | undefined,
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
    ): boolean {
        return this.matchesMegaMekScope(context, {
            pair: (eraId, factionId) => this.isMegaMekUnavailableForPair(entries, eraId, factionId, availabilityFrom),
            era: (eraId) => this.isMegaMekUnavailableForEra(entries, eraId, availabilityFrom),
            faction: (factionId) => this.isMegaMekUnavailableForFaction(entries, factionId, availabilityFrom),
            any: () => !entries.some((entry) => this.entryHasSelectedAvailability(entry, availabilityFrom)),
        });
    }

    private isMegaMekUnavailableForPair(
        entries: readonly MegaMekUnitAvailabilityEntry[],
        eraId: number,
        factionId: number,
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
    ): boolean {
        if (factionId === MULFACTION_EXTINCT) {
            return false;
        }

        const entry = entries.find((candidate) => candidate.eraId === eraId && candidate.factionId === factionId);
        return !entry || !this.entryHasSelectedAvailability(entry, availabilityFrom);
    }

    private isMegaMekUnavailableForEra(
        entries: readonly MegaMekUnitAvailabilityEntry[],
        eraId: number,
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
    ): boolean {
        return !entries.some((entry) => (
            entry.eraId === eraId && this.entryHasSelectedAvailability(entry, availabilityFrom)
        ));
    }

    private isMegaMekUnavailableForFaction(
        entries: readonly MegaMekUnitAvailabilityEntry[],
        factionId: number,
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
    ): boolean {
        if (factionId === MULFACTION_EXTINCT) {
            return false;
        }

        return !entries.some((entry) => (
            entry.factionId === factionId && this.entryHasSelectedAvailability(entry, availabilityFrom)
        ));
    }

    private getRequestedAvailabilitySources(
        context?: MegaMekAvailabilityFilterContext,
    ): readonly MegaMekAvailabilityFrom[] {
        if (!context?.availabilityFrom) {
            return MEGAMEK_AVAILABILITY_FROM_OPTIONS;
        }

        return Array.from(context.availabilityFrom);
    }

    private entryHasSelectedAvailability(
        entry: MegaMekUnitAvailabilityEntry,
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
    ): boolean {
        const value = [entry.production, entry.salvage] as [number, number];
        return availabilityFrom.some((source) => getMegaMekAvailabilityValueForSource(value, source) > 0);
    }

    private entryHasAnyAvailability(entry: MegaMekUnitAvailabilityEntry): boolean {
        return entry.production > 0 || entry.salvage > 0;
    }

    private entryMatchesSelectedRarity(
        entry: MegaMekUnitAvailabilityEntry,
        rarity: MegaMekAvailabilityRarity,
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
    ): boolean {
        const value = [entry.production, entry.salvage] as [number, number];
        return availabilityFrom.some((source) => {
            const score = getMegaMekAvailabilityValueForSource(value, source);
            return getMegaMekAvailabilityRarityForScore(score) === rarity;
        });
    }

}