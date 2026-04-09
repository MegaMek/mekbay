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
import type { Unit } from '../models/units.model';
import type {
    UnitSearchWorkerMegaMekAvailabilityBucketSnapshot,
    UnitSearchWorkerMegaMekAvailabilitySnapshot,
} from '../utils/unit-search-worker-protocol.util';
import { DataService } from './data.service';
import { OptionsService } from './options.service';

interface MegaMekUnitAvailabilityEntry {
    eraId: number;
    factionId: number;
    production: number;
    salvage: number;
}

interface MegaMekAvailabilityFilterContext {
    eraIds?: ReadonlySet<number>;
    factionIds?: ReadonlySet<number>;
    availabilityFrom?: ReadonlySet<MegaMekAvailabilityFrom>;
}

type AvailabilityUnitKey = string;

interface MegaMekAvailabilityBucketIndexes {
    unitIds: Set<AvailabilityUnitKey>;
    sourceUnitIds: Map<MegaMekAvailabilityFrom, Set<AvailabilityUnitKey>>;
    rarityUnitIdsBySource: Map<MegaMekAvailabilityFrom, Map<MegaMekAvailabilityRarity, Set<AvailabilityUnitKey>>>;
}

export interface MegaMekUnitAvailabilityDetail {
    source: MegaMekAvailabilityFrom;
    score: number;
    rarity: typeof MEGAMEK_AVAILABILITY_RARITY_OPTIONS[number];
}

const MEGAMEK_AVAILABILITY_FROM_LOOKUP = new Map(
    MEGAMEK_AVAILABILITY_FROM_OPTIONS.map((availabilityFrom) => [availabilityFrom.toLowerCase(), availabilityFrom] as const),
);

function createMegaMekAvailabilityBucket(): MegaMekAvailabilityBucketIndexes {
    const sourceUnitIds = new Map<MegaMekAvailabilityFrom, Set<AvailabilityUnitKey>>();
    const rarityUnitIdsBySource = new Map<MegaMekAvailabilityFrom, Map<MegaMekAvailabilityRarity, Set<AvailabilityUnitKey>>>();

    for (const availabilityFrom of MEGAMEK_AVAILABILITY_FROM_OPTIONS) {
        sourceUnitIds.set(availabilityFrom, new Set<AvailabilityUnitKey>());

        const rarityUnitIds = new Map<MegaMekAvailabilityRarity, Set<AvailabilityUnitKey>>();
        for (const rarity of MEGAMEK_AVAILABILITY_RARITY_OPTIONS) {
            rarityUnitIds.set(rarity, new Set<AvailabilityUnitKey>());
        }
        rarityUnitIdsBySource.set(availabilityFrom, rarityUnitIds);
    }

    return {
        unitIds: new Set<AvailabilityUnitKey>(),
        sourceUnitIds,
        rarityUnitIdsBySource,
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

function serializeMegaMekAvailabilityBucket(
    bucket: MegaMekAvailabilityBucketIndexes | undefined,
): UnitSearchWorkerMegaMekAvailabilityBucketSnapshot {
    const bySource: Partial<Record<MegaMekAvailabilityFrom, string[]>> = {};
    const byRarity: Partial<Record<MegaMekAvailabilityFrom, Partial<Record<MegaMekAvailabilityRarity, string[]>>>> = {};

    if (bucket) {
        for (const availabilityFrom of MEGAMEK_AVAILABILITY_FROM_OPTIONS) {
            const sourceUnitIds = bucket.sourceUnitIds.get(availabilityFrom);
            if (sourceUnitIds && sourceUnitIds.size > 0) {
                bySource[availabilityFrom] = Array.from(sourceUnitIds);
            }

            const rarityMap = bucket.rarityUnitIdsBySource.get(availabilityFrom);
            if (!rarityMap) {
                continue;
            }

            const raritySnapshot: Partial<Record<MegaMekAvailabilityRarity, string[]>> = {};
            for (const rarity of MEGAMEK_AVAILABILITY_RARITY_OPTIONS) {
                const rarityUnitIds = rarityMap.get(rarity);
                if (rarityUnitIds && rarityUnitIds.size > 0) {
                    raritySnapshot[rarity] = Array.from(rarityUnitIds);
                }
            }

            if (Object.keys(raritySnapshot).length > 0) {
                byRarity[availabilityFrom] = raritySnapshot;
            }
        }
    }

    return {
        unitNames: Array.from(bucket?.unitIds ?? []),
        bySource,
        byRarity,
    };
}

function serializeMegaMekMembershipBucket(
    unitIds: ReadonlySet<AvailabilityUnitKey> | undefined,
): UnitSearchWorkerMegaMekAvailabilityBucketSnapshot {
    return {
        unitNames: Array.from(unitIds ?? []),
        bySource: {},
        byRarity: {},
    };
}

@Injectable({
    providedIn: 'root'
})
export class UnitAvailabilitySourceService {
    private readonly dataService = inject(DataService);
    private readonly optionsService = inject(OptionsService);

    private mulEraUnitIdsCache = new WeakMap<Era, Set<AvailabilityUnitKey>>();
    private mulFactionUnitIdsCache = new WeakMap<Faction, Set<AvailabilityUnitKey>>();
    private mulCacheVersion = -1;

    private megaMekUnitsVersion = -1;
    private megaMekAvailabilityRecordsRef: readonly unknown[] | null = null;
    private megaMekEraUnitIds = new Map<number, Set<AvailabilityUnitKey>>();
    private megaMekFactionEraUnitIds = new Map<number, Map<number, Set<AvailabilityUnitKey>>>();
    private megaMekExtinctEraUnitIds = new Map<number, Set<AvailabilityUnitKey>>();
    private megaMekAvailabilityEntriesByUnitKey = new Map<AvailabilityUnitKey, readonly MegaMekUnitAvailabilityEntry[]>();
    private megaMekAllUnitIds = new Set<AvailabilityUnitKey>();
    private megaMekExtinctAllUnitIds = new Set<AvailabilityUnitKey>();
    private megaMekAvailabilityBucket = createMegaMekAvailabilityBucket();
    private megaMekAvailabilityBucketsByEra = new Map<number, MegaMekAvailabilityBucketIndexes>();
    private megaMekAvailabilityBucketsByFaction = new Map<number, MegaMekAvailabilityBucketIndexes>();
    private megaMekAvailabilityBucketsByEraFaction = new Map<number, Map<number, MegaMekAvailabilityBucketIndexes>>();
    private megaMekScopedUnitIdsCache = new Map<string, ReadonlySet<AvailabilityUnitKey>>();

    public getVisibleEraUnitIds(era: Era): Set<AvailabilityUnitKey> {
        this.ensureMulCacheVersion();

        if (!this.useMegaMekAvailability()) {
            return this.getMulVisibleEraUnitIds(era);
        }

        this.ensureMegaMekIndexes();

        const indexedUnitIds = this.megaMekEraUnitIds.get(era.id);
        return indexedUnitIds ? new Set(indexedUnitIds) : new Set<AvailabilityUnitKey>();
    }

    public getFactionEraUnitIds(faction: Faction, era: Era): Set<AvailabilityUnitKey> {
        return this.getFactionUnitIds(faction, new Set([era.id]));
    }

    public getFactionUnitIds(faction: Faction, contextEraIds?: ReadonlySet<number>): Set<AvailabilityUnitKey> {
        this.ensureMulCacheVersion();

        if (!this.useMegaMekAvailability()) {
            return this.getMulFactionUnitIds(faction, contextEraIds);
        }

        this.ensureMegaMekIndexes();

        if (faction.id === MULFACTION_EXTINCT) {
            return this.getMegaMekExtinctUnitIds(contextEraIds);
        }

        const factionEraUnitIds = this.megaMekFactionEraUnitIds.get(faction.id);
        if (!factionEraUnitIds) {
            return new Set<AvailabilityUnitKey>();
        }

        const unitIds = new Set<AvailabilityUnitKey>();
        for (const [eraId, eraUnitIds] of factionEraUnitIds.entries()) {
            if (contextEraIds && !contextEraIds.has(eraId)) {
                continue;
            }

            for (const unitId of eraUnitIds) {
                unitIds.add(unitId);
            }
        }

        return unitIds;
    }

    public unitBelongsToEra(unit: Unit, era: Era): boolean {
        return this.getVisibleEraUnitIds(era).has(this.getUnitAvailabilityKey(unit));
    }

    public unitBelongsToFaction(unit: Unit, faction: Faction, contextEraIds?: ReadonlySet<number>): boolean {
        return this.getFactionUnitIds(faction, contextEraIds).has(this.getUnitAvailabilityKey(unit));
    }

    public getUnitAvailabilityKey(unit: Pick<Unit, 'id' | 'name'>): AvailabilityUnitKey {
        return this.useMegaMekAvailability() ? unit.name : String(unit.id);
    }

    public getUnitAvailabilityWeight(unit: Unit, faction: Faction, era: Era): number | null {
        if (!this.useMegaMekAvailability()) {
            return null;
        }

        const value = this.getMegaMekAvailabilityValue(unit, era.id, faction.id);
        if (!value) {
            return null;
        }

        return Math.max(value[0] ?? 0, value[1] ?? 0);
    }

    public getMegaMekAvailabilityDetails(
        unit: Pick<Unit, 'name'>,
        faction: Pick<Faction, 'id'>,
        era: Pick<Era, 'id'>,
    ): MegaMekUnitAvailabilityDetail[] {
        const value = this.getMegaMekAvailabilityValue(unit, era.id, faction.id);
        if (!value) {
            return [];
        }

        const details: MegaMekUnitAvailabilityDetail[] = [];
        for (const source of MEGAMEK_AVAILABILITY_FROM_OPTIONS) {
            const score = getMegaMekAvailabilityValueForSource(value, source);
            if (score <= 0) {
                continue;
            }

            const rarity = getMegaMekAvailabilityRarityForScore(score);
            if (rarity === 'Not Available') {
                continue;
            }

            details.push({ source, score, rarity });
        }

        return details;
    }

    public unitHasMegaMekAvailability(unit: Unit): boolean {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        return this.megaMekAvailabilityBucket.unitIds.has(unit.name);
    }

    public getMegaMekAvailabilityUnitIds(
        context?: MegaMekAvailabilityFilterContext,
    ): ReadonlySet<AvailabilityUnitKey> {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        const cacheKey = this.buildMegaMekScopedCacheKey('available', context);
        const cached = this.megaMekScopedUnitIdsCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const selectedSources = this.getRequestedAvailabilitySources(context);
        const unitIds = this.collectMegaMekAvailabilityUnitIdsForSources(selectedSources, context);
        this.megaMekScopedUnitIdsCache.set(cacheKey, unitIds);
        return unitIds;
    }

    public getMegaMekMembershipUnitIds(
        context?: MegaMekAvailabilityFilterContext,
    ): ReadonlySet<AvailabilityUnitKey> {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        const cacheKey = this.buildMegaMekScopedCacheKey('membership', context);
        const cached = this.megaMekScopedUnitIdsCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const unitIds = this.collectMegaMekMembershipUnitIds(context);
        this.megaMekScopedUnitIdsCache.set(cacheKey, unitIds);
        return unitIds;
    }

    public getMegaMekRarityUnitIds(
        rarity: MegaMekAvailabilityRarity,
        context?: MegaMekAvailabilityFilterContext,
    ): ReadonlySet<AvailabilityUnitKey> {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        const cacheKey = this.buildMegaMekScopedCacheKey('rarity', context, [rarity]);
        const cached = this.megaMekScopedUnitIdsCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const selectedSources = this.getRequestedAvailabilitySources(context);
        const unitIds = rarity === 'Not Available'
            ? this.collectMegaMekUnavailableUnitIds(selectedSources, context)
            : this.collectMegaMekRarityUnitIds(rarity, selectedSources, context);
        this.megaMekScopedUnitIdsCache.set(cacheKey, unitIds);
        return unitIds;
    }

    public getSearchWorkerMegaMekAvailabilitySnapshot(): UnitSearchWorkerMegaMekAvailabilitySnapshot {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        const eras = this.dataService.getEras();
        const factions = this.dataService.getFactions();
        const extinctFactionName = this.dataService.getFactionById(MULFACTION_EXTINCT)?.name;

        const erasSnapshot = Object.fromEntries(
            eras.map((era) => [era.name, serializeMegaMekAvailabilityBucket(this.megaMekAvailabilityBucketsByEra.get(era.id))]),
        );
        const factionsSnapshot = Object.fromEntries(
            factions.map((faction) => [
                faction.name,
                faction.id === MULFACTION_EXTINCT
                    ? serializeMegaMekMembershipBucket(this.megaMekExtinctAllUnitIds)
                    : serializeMegaMekAvailabilityBucket(this.megaMekAvailabilityBucketsByFaction.get(faction.id)),
            ]),
        );
        const eraFactionsSnapshot = Object.fromEntries(
            eras.map((era) => {
                const eraFactionBuckets = this.megaMekAvailabilityBucketsByEraFaction.get(era.id) ?? new Map<number, MegaMekAvailabilityBucketIndexes>();
                return [
                    era.name,
                    Object.fromEntries(
                        factions.map((faction) => [
                            faction.name,
                            faction.id === MULFACTION_EXTINCT
                                ? serializeMegaMekMembershipBucket(this.megaMekExtinctEraUnitIds.get(era.id))
                                : serializeMegaMekAvailabilityBucket(eraFactionBuckets.get(faction.id)),
                        ]),
                    ),
                ];
            }),
        );
        const extinctByEra = Object.fromEntries(
            eras.map((era) => [era.name, Array.from(this.megaMekExtinctEraUnitIds.get(era.id) ?? [])]),
        );

        return {
            all: serializeMegaMekAvailabilityBucket(this.megaMekAvailabilityBucket),
            eras: erasSnapshot,
            factions: factionsSnapshot,
            eraFactions: eraFactionsSnapshot,
            extinctFactionName,
            extinctUnitNames: Array.from(this.megaMekExtinctAllUnitIds),
            extinctByEra,
        };
    }

    public unitMatchesAvailabilityFrom(
        unit: Unit,
        availabilityFromName: string,
        context?: MegaMekAvailabilityFilterContext,
    ): boolean {
        if (!this.useMegaMekAvailability()) {
            return false;
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
        if (!this.useMegaMekAvailability()) {
            return false;
        }

        const rarity = this.resolveMegaMekAvailabilityRarity(rarityName);
        if (!rarity) {
            return false;
        }

        return this.getMegaMekRarityUnitIds(rarity, context).has(unit.name);
    }

    public useMegaMekAvailability(): boolean {
        return this.optionsService.options().availabilitySource === 'megamek';
    }

    private ensureMulCacheVersion(): void {
        const nextVersion = this.dataService.searchCorpusVersion();
        if (this.mulCacheVersion === nextVersion) {
            return;
        }

        this.mulCacheVersion = nextVersion;
        this.mulEraUnitIdsCache = new WeakMap<Era, Set<AvailabilityUnitKey>>();
        this.mulFactionUnitIdsCache = new WeakMap<Faction, Set<AvailabilityUnitKey>>();
        this.megaMekUnitsVersion = -1;
        this.megaMekAvailabilityRecordsRef = null;
        this.megaMekEraUnitIds.clear();
        this.megaMekFactionEraUnitIds.clear();
        this.megaMekExtinctEraUnitIds.clear();
        this.megaMekAvailabilityEntriesByUnitKey.clear();
        this.megaMekAllUnitIds.clear();
        this.megaMekExtinctAllUnitIds.clear();
        this.megaMekAvailabilityBucket = createMegaMekAvailabilityBucket();
        this.megaMekAvailabilityBucketsByEra.clear();
        this.megaMekAvailabilityBucketsByFaction.clear();
        this.megaMekAvailabilityBucketsByEraFaction.clear();
        this.megaMekScopedUnitIdsCache.clear();
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
        const nextUnitsVersion = this.dataService.searchCorpusVersion();
        const units = this.dataService.getUnits();
        const megaMekAvailabilityRecords = this.dataService.getMegaMekAvailabilityRecords();
        if (
            this.megaMekUnitsVersion === nextUnitsVersion
            && this.megaMekAvailabilityRecordsRef === megaMekAvailabilityRecords
        ) {
            return;
        }

        this.megaMekUnitsVersion = nextUnitsVersion;
        this.megaMekAvailabilityRecordsRef = megaMekAvailabilityRecords;
        this.megaMekEraUnitIds.clear();
        this.megaMekFactionEraUnitIds.clear();
        this.megaMekExtinctEraUnitIds.clear();
        this.megaMekAvailabilityEntriesByUnitKey.clear();
        this.megaMekAllUnitIds.clear();
        this.megaMekExtinctAllUnitIds.clear();
        this.megaMekAvailabilityBucket = createMegaMekAvailabilityBucket();
        this.megaMekAvailabilityBucketsByEra.clear();
        this.megaMekAvailabilityBucketsByFaction.clear();
        this.megaMekAvailabilityBucketsByEraFaction.clear();
        this.megaMekScopedUnitIdsCache.clear();

        for (const unit of units) {
            this.megaMekAllUnitIds.add(unit.name);

            const availabilityRecord = this.dataService.getMegaMekAvailabilityRecordForUnit(unit);
            if (!availabilityRecord) {
                continue;
            }

            const unitKey = unit.name;

            const entries: MegaMekUnitAvailabilityEntry[] = [];

            for (const [eraIdText, eraAvailability] of Object.entries(availabilityRecord.e)) {
                const eraId = Number(eraIdText);
                if (Number.isNaN(eraId)) {
                    continue;
                }

                let unitAvailableInEra = false;

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

                    this.addUnitToMegaMekAvailabilityBucket(this.megaMekAvailabilityBucket, unitKey, value);
                    this.addUnitToMegaMekAvailabilityBucket(
                        getOrCreateMapValue(this.megaMekAvailabilityBucketsByEra, eraId, createMegaMekAvailabilityBucket),
                        unitKey,
                        value,
                    );
                    this.addUnitToMegaMekAvailabilityBucket(
                        getOrCreateMapValue(this.megaMekAvailabilityBucketsByFaction, factionId, createMegaMekAvailabilityBucket),
                        unitKey,
                        value,
                    );
                    const eraFactionBuckets = getOrCreateMapValue(
                        this.megaMekAvailabilityBucketsByEraFaction,
                        eraId,
                        () => new Map<number, MegaMekAvailabilityBucketIndexes>(),
                    );
                    this.addUnitToMegaMekAvailabilityBucket(
                        getOrCreateMapValue(eraFactionBuckets, factionId, createMegaMekAvailabilityBucket),
                        unitKey,
                        value,
                    );

                    if (!isMegaMekAvailabilityValueAvailable(value as [number, number])) {
                        continue;
                    }

                    unitAvailableInEra = true;

                    const factionEraUnitIds = this.megaMekFactionEraUnitIds.get(factionId) ?? new Map<number, Set<AvailabilityUnitKey>>();
                    const factionEraUnits = factionEraUnitIds.get(eraId) ?? new Set<AvailabilityUnitKey>();
                    factionEraUnits.add(unitKey);
                    factionEraUnitIds.set(eraId, factionEraUnits);
                    this.megaMekFactionEraUnitIds.set(factionId, factionEraUnitIds);
                }

                if (unitAvailableInEra) {
                    const eraUnitIds = this.megaMekEraUnitIds.get(eraId) ?? new Set<AvailabilityUnitKey>();
                    eraUnitIds.add(unitKey);
                    this.megaMekEraUnitIds.set(eraId, eraUnitIds);
                }
            }

            if (entries.length > 0) {
                this.megaMekAvailabilityEntriesByUnitKey.set(unitKey, entries);
            }
        }

        this.buildMegaMekExtinctIndexes();
    }

    private buildMegaMekExtinctIndexes(): void {
        const previouslyAvailableUnitIds = new Set<AvailabilityUnitKey>();
        this.megaMekExtinctAllUnitIds.clear();

        for (const era of this.dataService.getEras()) {
            const currentlyAvailableUnitIds = this.megaMekEraUnitIds.get(era.id) ?? new Set<AvailabilityUnitKey>();
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

    private addUnitToMegaMekAvailabilityBucket(
        bucket: MegaMekAvailabilityBucketIndexes,
        unitKey: AvailabilityUnitKey,
        value: readonly [number, number],
    ): void {
        const normalizedValue: [number, number] = [value[0], value[1]];

        if (!isMegaMekAvailabilityValueAvailable(normalizedValue)) {
            return;
        }

        bucket.unitIds.add(unitKey);

        for (const availabilityFrom of MEGAMEK_AVAILABILITY_FROM_OPTIONS) {
            const score = getMegaMekAvailabilityValueForSource(normalizedValue, availabilityFrom);
            if (score <= 0) {
                continue;
            }

            bucket.sourceUnitIds.get(availabilityFrom)?.add(unitKey);
            const rarity = getMegaMekAvailabilityRarityForScore(score);
            if (rarity !== 'Not Available') {
                bucket.rarityUnitIdsBySource.get(availabilityFrom)?.get(rarity)?.add(unitKey);
            }
        }
    }

    private buildMegaMekScopedCacheKey(
        kind: 'available' | 'membership' | 'rarity',
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
        const suffix = extras.length > 0 ? `|${extras.join('|')}` : '';

        return `${kind}|e=${eraKey}|f=${factionKey}|from=${availabilityFromKey}${suffix}`;
    }

    private collectMegaMekMembershipUnitIds(
        context?: MegaMekAvailabilityFilterContext,
    ): ReadonlySet<AvailabilityUnitKey> {
        const unitIds = new Set<AvailabilityUnitKey>();

        if (context?.eraIds && context.factionIds) {
            for (const eraId of context.eraIds) {
                for (const factionId of context.factionIds) {
                    if (factionId === MULFACTION_EXTINCT) {
                        addUnitKeys(unitIds, this.megaMekExtinctEraUnitIds.get(eraId));
                        continue;
                    }

                    addUnitKeys(unitIds, this.megaMekFactionEraUnitIds.get(factionId)?.get(eraId));
                }
            }

            return unitIds;
        }

        if (context?.eraIds) {
            for (const eraId of context.eraIds) {
                addUnitKeys(unitIds, this.megaMekEraUnitIds.get(eraId));
            }

            return unitIds;
        }

        if (context?.factionIds) {
            for (const factionId of context.factionIds) {
                if (factionId === MULFACTION_EXTINCT) {
                    addUnitKeys(unitIds, this.megaMekExtinctAllUnitIds);
                    continue;
                }

                const factionEraUnitIds = this.megaMekFactionEraUnitIds.get(factionId);
                if (!factionEraUnitIds) {
                    continue;
                }

                for (const eraUnitIds of factionEraUnitIds.values()) {
                    addUnitKeys(unitIds, eraUnitIds);
                }
            }

            return unitIds;
        }

        addUnitKeys(unitIds, this.megaMekAvailabilityBucket.unitIds);
        return unitIds;
    }

    private collectMegaMekAvailabilityUnitIdsForSources(
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
        context?: MegaMekAvailabilityFilterContext,
    ): ReadonlySet<AvailabilityUnitKey> {
        const unitIds = new Set<AvailabilityUnitKey>();

        if (context?.eraIds && context.factionIds) {
            for (const eraId of context.eraIds) {
                const eraFactionBuckets = this.megaMekAvailabilityBucketsByEraFaction.get(eraId);
                for (const factionId of context.factionIds) {
                    if (factionId === MULFACTION_EXTINCT) {
                        continue;
                    }

                    const bucket = eraFactionBuckets?.get(factionId);
                    for (const source of availabilityFrom) {
                        addUnitKeys(unitIds, bucket?.sourceUnitIds.get(source));
                    }
                }
            }

            return unitIds;
        }

        if (context?.eraIds) {
            for (const eraId of context.eraIds) {
                const bucket = this.megaMekAvailabilityBucketsByEra.get(eraId);
                for (const source of availabilityFrom) {
                    addUnitKeys(unitIds, bucket?.sourceUnitIds.get(source));
                }
            }

            return unitIds;
        }

        if (context?.factionIds) {
            for (const factionId of context.factionIds) {
                if (factionId === MULFACTION_EXTINCT) {
                    continue;
                }

                const bucket = this.megaMekAvailabilityBucketsByFaction.get(factionId);
                for (const source of availabilityFrom) {
                    addUnitKeys(unitIds, bucket?.sourceUnitIds.get(source));
                }
            }

            return unitIds;
        }

        for (const source of availabilityFrom) {
            addUnitKeys(unitIds, this.megaMekAvailabilityBucket.sourceUnitIds.get(source));
        }

        return unitIds;
    }

    private collectMegaMekRarityUnitIds(
        rarity: MegaMekAvailabilityRarity,
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
        context?: MegaMekAvailabilityFilterContext,
    ): ReadonlySet<AvailabilityUnitKey> {
        const unitIds = new Set<AvailabilityUnitKey>();

        if (context?.eraIds && context.factionIds) {
            for (const eraId of context.eraIds) {
                const eraFactionBuckets = this.megaMekAvailabilityBucketsByEraFaction.get(eraId);
                for (const factionId of context.factionIds) {
                    if (factionId === MULFACTION_EXTINCT) {
                        continue;
                    }

                    const bucket = eraFactionBuckets?.get(factionId);
                    for (const source of availabilityFrom) {
                        addUnitKeys(unitIds, bucket?.rarityUnitIdsBySource.get(source)?.get(rarity));
                    }
                }
            }

            return unitIds;
        }

        if (context?.eraIds) {
            for (const eraId of context.eraIds) {
                const bucket = this.megaMekAvailabilityBucketsByEra.get(eraId);
                for (const source of availabilityFrom) {
                    addUnitKeys(unitIds, bucket?.rarityUnitIdsBySource.get(source)?.get(rarity));
                }
            }

            return unitIds;
        }

        if (context?.factionIds) {
            for (const factionId of context.factionIds) {
                if (factionId === MULFACTION_EXTINCT) {
                    continue;
                }

                const bucket = this.megaMekAvailabilityBucketsByFaction.get(factionId);
                for (const source of availabilityFrom) {
                    addUnitKeys(unitIds, bucket?.rarityUnitIdsBySource.get(source)?.get(rarity));
                }
            }

            return unitIds;
        }

        for (const source of availabilityFrom) {
            addUnitKeys(unitIds, this.megaMekAvailabilityBucket.rarityUnitIdsBySource.get(source)?.get(rarity));
        }

        return unitIds;
    }

    private collectMegaMekUnavailableUnitIds(
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
        context?: MegaMekAvailabilityFilterContext,
    ): ReadonlySet<AvailabilityUnitKey> {
        const unitIds = new Set<AvailabilityUnitKey>();

        if (context?.eraIds && context.factionIds) {
            for (const eraId of context.eraIds) {
                const eraFactionBuckets = this.megaMekAvailabilityBucketsByEraFaction.get(eraId);
                for (const factionId of context.factionIds) {
                    if (factionId === MULFACTION_EXTINCT) {
                        continue;
                    }

                    this.addMegaMekUnavailableUnitsFromBucket(unitIds, eraFactionBuckets?.get(factionId), availabilityFrom);
                }
            }

            return unitIds;
        }

        if (context?.eraIds) {
            for (const eraId of context.eraIds) {
                this.addMegaMekUnavailableUnitsFromBucket(unitIds, this.megaMekAvailabilityBucketsByEra.get(eraId), availabilityFrom);
            }

            return unitIds;
        }

        if (context?.factionIds) {
            for (const factionId of context.factionIds) {
                if (factionId === MULFACTION_EXTINCT) {
                    continue;
                }

                this.addMegaMekUnavailableUnitsFromBucket(unitIds, this.megaMekAvailabilityBucketsByFaction.get(factionId), availabilityFrom);
            }

            return unitIds;
        }

        this.addMegaMekUnavailableUnitsFromBucket(unitIds, this.megaMekAvailabilityBucket, availabilityFrom);
        return unitIds;
    }

    private addMegaMekUnavailableUnitsFromBucket(
        target: Set<AvailabilityUnitKey>,
        bucket: MegaMekAvailabilityBucketIndexes | undefined,
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
    ): void {
        if (!bucket) {
            addUnitKeys(target, this.megaMekAllUnitIds);
            return;
        }

        const availableUnitIds = new Set<AvailabilityUnitKey>();
        for (const source of availabilityFrom) {
            addUnitKeys(availableUnitIds, bucket.sourceUnitIds.get(source));
        }

        for (const unitKey of this.megaMekAllUnitIds) {
            if (!availableUnitIds.has(unitKey)) {
                target.add(unitKey);
            }
        }
    }

    private getMegaMekExtinctUnitIds(contextEraIds?: ReadonlySet<number>): Set<AvailabilityUnitKey> {
        const unitIds = new Set<AvailabilityUnitKey>();

        for (const [eraId, extinctUnitIds] of this.megaMekExtinctEraUnitIds.entries()) {
            if (contextEraIds && !contextEraIds.has(eraId)) {
                continue;
            }

            for (const unitId of extinctUnitIds) {
                unitIds.add(unitId);
            }
        }

        return unitIds;
    }

    private getMegaMekAvailabilityValue(
        unit: Pick<Unit, 'name'>,
        eraId: number,
        factionId: number,
    ): [number, number] | undefined {
        if (factionId === MULFACTION_EXTINCT) {
            return undefined;
        }

        return this.dataService.getMegaMekAvailabilityRecordForUnit(unit)?.e[String(eraId)]?.[String(factionId)];
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

    private matchesMegaMekAvailabilityFrom(
        unit: Unit,
        context?: MegaMekAvailabilityFilterContext,
    ): boolean {
        this.ensureMegaMekIndexes();

        const availabilityFrom = this.getRequestedAvailabilitySources(context);
        if (availabilityFrom.length === 0) {
            return false;
        }

        const entries = this.megaMekAvailabilityEntriesByUnitKey.get(unit.name) ?? [];
        return this.matchesMegaMekAvailabilityPredicate(entries, context, (entry) => {
            return this.entryHasSelectedAvailability(entry, availabilityFrom);
        });
    }

    private matchesMegaMekAvailabilityRarity(
        unit: Unit,
        rarity: MegaMekAvailabilityRarity,
        context?: MegaMekAvailabilityFilterContext,
    ): boolean {
        this.ensureMegaMekIndexes();

        const availabilityFrom = this.getRequestedAvailabilitySources(context);
        if (availabilityFrom.length === 0) {
            return false;
        }

        const entries = this.megaMekAvailabilityEntriesByUnitKey.get(unit.name) ?? [];
        if (rarity === 'Not Available') {
            return this.matchesMegaMekUnavailable(unit.name, entries, context, availabilityFrom);
        }

        return this.matchesMegaMekAvailabilityPredicate(entries, context, (entry) => {
            return this.entryMatchesSelectedRarity(entry, rarity, availabilityFrom);
        });
    }

    private matchesMegaMekAvailabilityPredicate(
        entries: readonly MegaMekUnitAvailabilityEntry[],
        context: MegaMekAvailabilityFilterContext | undefined,
        predicate: (entry: MegaMekUnitAvailabilityEntry) => boolean,
    ): boolean {
        const hasExplicitEraScope = context?.eraIds !== undefined;
        const hasExplicitFactionScope = context?.factionIds !== undefined;

        if (hasExplicitEraScope && context!.eraIds!.size === 0) {
            return false;
        }
        if (hasExplicitFactionScope && context!.factionIds!.size === 0) {
            return false;
        }

        if (context?.eraIds && context.factionIds) {
            for (const eraId of context.eraIds) {
                for (const factionId of context.factionIds) {
                    if (this.matchesMegaMekAvailabilityForPair(entries, eraId, factionId, predicate)) {
                        return true;
                    }
                }
            }
            return false;
        }

        if (context?.eraIds) {
            for (const eraId of context.eraIds) {
                if (this.matchesMegaMekAvailabilityForEra(entries, eraId, predicate)) {
                    return true;
                }
            }
            return false;
        }

        if (context?.factionIds) {
            for (const factionId of context.factionIds) {
                if (this.matchesMegaMekAvailabilityForFaction(entries, factionId, predicate)) {
                    return true;
                }
            }
            return false;
        }

        return entries.some(predicate);
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
        const hasExplicitEraScope = context?.eraIds !== undefined;
        const hasExplicitFactionScope = context?.factionIds !== undefined;

        if (hasExplicitEraScope && context!.eraIds!.size === 0) {
            return false;
        }
        if (hasExplicitFactionScope && context!.factionIds!.size === 0) {
            return false;
        }

        if (context?.eraIds && context.factionIds) {
            for (const eraId of context.eraIds) {
                for (const factionId of context.factionIds) {
                    if (this.isMegaMekUnavailableForPair(unitKey, entries, eraId, factionId, availabilityFrom)) {
                        return true;
                    }
                }
            }
            return false;
        }

        if (context?.eraIds) {
            for (const eraId of context.eraIds) {
                if (this.isMegaMekUnavailableForEra(entries, eraId, availabilityFrom)) {
                    return true;
                }
            }
            return false;
        }

        if (context?.factionIds) {
            for (const factionId of context.factionIds) {
                if (this.isMegaMekUnavailableForFaction(unitKey, entries, factionId, availabilityFrom)) {
                    return true;
                }
            }
            return false;
        }

        return !entries.some((entry) => this.entryHasSelectedAvailability(entry, availabilityFrom));
    }

    private isMegaMekUnavailableForPair(
        unitKey: AvailabilityUnitKey,
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
        unitKey: AvailabilityUnitKey,
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