// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, inject } from '@angular/core';

import type { Era } from '../models/eras.model';
import type { Faction } from '../models/factions.model';
import { isMegaMekFactionActiveInYearRange } from '../models/megamek/factions.model';
import {
    type MegaMekAvailabilityFromFilter,
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
import type { UnitSummary } from '../models/unit-summary.model';
import type { ForceAvailabilityContext } from '../utils/force-availability.util';
import { DataService } from './data.service';
import { OptionsService } from './options.service';

interface MegaMekUnitAvailabilityEntry {
    eraId: number;
    factionId: number;
    requisition: number;
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

interface MegaMekScopedMatchHandlers {
    pair: (eraId: number, factionId: number) => boolean;
    era: (eraId: number) => boolean;
    faction: (factionId: number) => boolean;
    any: () => boolean;
}

const MEGAMEK_AVAILABILITY_FROM_LOOKUP = new Map(
    MEGAMEK_AVAILABILITY_FROM_OPTIONS.map((availabilityFrom) => [availabilityFrom.toLowerCase(), availabilityFrom] as const),
);

const MEGAMEK_SCOPED_UNIT_ID_CACHE_LIMIT = 24;
const MEGAMEK_SCOPED_UNIT_SCORE_CACHE_LIMIT = 24;

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

function mulMembershipHasUnitId(
    membership: readonly number[] | ReadonlySet<number> | undefined,
    unitId: number,
): boolean {
    if (!membership) {
        return false;
    }

    return 'has' in membership
        ? membership.has(unitId)
        : membership.includes(unitId);
}

@Injectable({
    providedIn: 'root'
})
export class UnitAvailabilitySourceService {
    private readonly dataService = inject(DataService);
    private readonly optionsService = inject(OptionsService);

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
    private megaMekMembershipUnitIds = new Set<AvailabilityUnitKey>();
    private megaMekMembershipUnitIdsByEra = new Map<number, Set<AvailabilityUnitKey>>();
    private megaMekMembershipUnitIdsByFaction = new Map<number, Set<AvailabilityUnitKey>>();
    private megaMekMembershipUnitIdsByEraAndFaction = new Map<number, Map<number, Set<AvailabilityUnitKey>>>();
    private megaMekUnitIdByName = new Map<AvailabilityUnitKey, number>();
    private megaMekExtinctAllUnitIds = new Set<AvailabilityUnitKey>();
    private megaMekScopedUnitIdCache = new Map<string, ReadonlySet<AvailabilityUnitKey>>();
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

    public createForceAvailabilityContextForUnits(
        units: readonly Pick<UnitSummary, 'id' | 'name'>[],
        eras: readonly Era[],
        availabilitySource?: AvailabilitySource,
    ): ForceAvailabilityContext {
        const resolvedSource = availabilitySource ?? this.optionsService.options().availabilitySource;
        if (resolvedSource !== 'megamek') {
            const distinctUnitIds = [...new Set(units.map(unit => unit.id))];
            const scopedUnitIds = (
                membership: readonly number[] | ReadonlySet<number> | undefined,
            ): ReadonlySet<AvailabilityUnitKey> => {
                const matches = new Set<AvailabilityUnitKey>();
                for (const unitId of distinctUnitIds) {
                    if (mulMembershipHasUnitId(membership, unitId)) {
                        matches.add(String(unitId));
                    }
                }
                return matches;
            };

            return {
                source: 'mul',
                getUnitKey: unit => String(unit.id),
                getVisibleEraUnitIds: era => scopedUnitIds(
                    era.units as readonly number[] | ReadonlySet<number> | undefined,
                ),
                getFactionUnitIds: (faction, contextEraIds) => {
                    const matches = new Set<AvailabilityUnitKey>();
                    for (const unitId of distinctUnitIds) {
                        const belongsToFaction = Object.entries(faction.eras).some(([eraIdText, membership]) => (
                            (!contextEraIds || contextEraIds.has(Number(eraIdText)))
                            && mulMembershipHasUnitId(
                                membership as readonly number[] | ReadonlySet<number> | undefined,
                                unitId,
                            )
                        ));
                        if (belongsToFaction) {
                            matches.add(String(unitId));
                        }
                    }
                    return matches;
                },
                getFactionEraUnitIds: (faction, era) => scopedUnitIds(
                    faction.eras[era.id] as readonly number[] | ReadonlySet<number> | undefined,
                ),
            };
        }

        const distinctUnitsByKey = new Map<AvailabilityUnitKey, Pick<UnitSummary, 'id' | 'name'>>();
        for (const unit of units) {
            if (!distinctUnitsByKey.has(unit.name)) {
                distinctUnitsByKey.set(unit.name, unit);
            }
        }

        const visibleUnitIdsByEra = new Map<number, Set<AvailabilityUnitKey>>();
        const factionEraUnitIds = new Map<number, Map<number, Set<AvailabilityUnitKey>>>();
        const availableEraIdsByUnitKey = new Map<AvailabilityUnitKey, Set<number>>();

        for (const unit of distinctUnitsByKey.values()) {
            const availabilityRecord = this.dataService.getMegaMekAvailabilityRecordForUnit(unit);
            if (!availabilityRecord) {
                continue;
            }

            const availableEraIds = new Set<number>();

            for (const [eraIdText, eraAvailability] of Object.entries(availabilityRecord.e)) {
                const eraId = Number(eraIdText);
                if (Number.isNaN(eraId)) {
                    continue;
                }

                let isVisibleInEra = false;
                for (const [factionIdText, value] of Object.entries(eraAvailability)) {
                    const factionId = Number(factionIdText);
                    if (Number.isNaN(factionId) || !isMegaMekAvailabilityValueAvailable(value)) {
                        continue;
                    }

                    isVisibleInEra = true;
                    const eraUnitIdsByFaction = getOrCreateMapValue(
                        factionEraUnitIds,
                        factionId,
                        () => new Map<number, Set<AvailabilityUnitKey>>(),
                    );
                    getOrCreateMapValue(eraUnitIdsByFaction, eraId, () => new Set<AvailabilityUnitKey>()).add(unit.name);
                }

                if (!isVisibleInEra) {
                    continue;
                }

                availableEraIds.add(eraId);
                getOrCreateMapValue(visibleUnitIdsByEra, eraId, () => new Set<AvailabilityUnitKey>()).add(unit.name);
            }

            if (availableEraIds.size > 0) {
                availableEraIdsByUnitKey.set(unit.name, availableEraIds);
            }
        }

        const extinctUnitIdsByEra = new Map<number, Set<AvailabilityUnitKey>>();
        for (const [unitKey, availableEraIds] of availableEraIdsByUnitKey.entries()) {
            let wasPreviouslyAvailable = false;

            for (const era of eras) {
                if (availableEraIds.has(era.id)) {
                    wasPreviouslyAvailable = true;
                    continue;
                }

                if (wasPreviouslyAvailable) {
                    getOrCreateMapValue(extinctUnitIdsByEra, era.id, () => new Set<AvailabilityUnitKey>()).add(unitKey);
                }
            }
        }

        return {
            source: 'megamek',
            getUnitKey: (unit) => unit.name,
            getVisibleEraUnitIds: (era) => new Set(visibleUnitIdsByEra.get(era.id) ?? []),
            getFactionUnitIds: (faction, contextEraIds) => {
                const unitIds = new Set<AvailabilityUnitKey>();

                if (faction.id === MULFACTION_EXTINCT) {
                    if (contextEraIds) {
                        for (const eraId of contextEraIds) {
                            addUnitKeys(unitIds, extinctUnitIdsByEra.get(eraId));
                        }
                        return unitIds;
                    }

                    for (const era of eras) {
                        addUnitKeys(unitIds, extinctUnitIdsByEra.get(era.id));
                    }
                    return unitIds;
                }

                const eraUnitIdsByFaction = factionEraUnitIds.get(faction.id);
                if (!eraUnitIdsByFaction) {
                    return unitIds;
                }

                if (contextEraIds) {
                    for (const eraId of contextEraIds) {
                        addUnitKeys(unitIds, eraUnitIdsByFaction.get(eraId));
                    }
                    return unitIds;
                }

                for (const eraUnitIds of eraUnitIdsByFaction.values()) {
                    addUnitKeys(unitIds, eraUnitIds);
                }
                return unitIds;
            },
            getFactionEraUnitIds: (faction, era) => {
                if (faction.id === MULFACTION_EXTINCT) {
                    return new Set(extinctUnitIdsByEra.get(era.id) ?? []);
                }

                return new Set(factionEraUnitIds.get(faction.id)?.get(era.id) ?? []);
            },
        };
    }

    public factionExistsInEra(
        faction: Faction,
        era: Era,
        availabilitySource?: AvailabilitySource,
    ): boolean {
        if (!this.useMegaMekAvailability(availabilitySource)) {
            return this.getFactionEraUnitIds(faction, era, availabilitySource).size > 0;
        }

        if (faction.id === MULFACTION_EXTINCT) {
            return false;
        }

        const megaMekFactions = this.dataService.getMegaMekFactionsByMulId(faction.id);
        if (megaMekFactions.length > 0) {
            return megaMekFactions.some((megaMekFaction) => isMegaMekFactionActiveInYearRange(
                megaMekFaction,
                era.years.from,
                era.years.to,
            ));
        }

        return this.getFactionEraUnitIds(faction, era, 'mul').size > 0;
    }

    public unitBelongsToEra(unit: UnitSummary, era: Era, availabilitySource?: AvailabilitySource): boolean {
        if (!this.useMegaMekAvailability(availabilitySource)) {
            return this.getVisibleEraUnitIds(era, availabilitySource).has(this.getUnitAvailabilityKey(unit, availabilitySource));
        }

        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        return this.getMegaMekEntries(unit.name).some((entry) => (
            entry.eraId === era.id && this.entryHasAnyAvailability(entry)
        ));
    }

    public unitBelongsToFaction(
        unit: UnitSummary,
        faction: Faction,
        contextEraIds?: ReadonlySet<number>,
        availabilitySource?: AvailabilitySource,
    ): boolean {
        if (!this.useMegaMekAvailability(availabilitySource)) {
            return this.getFactionUnitIds(faction, contextEraIds, availabilitySource).has(this.getUnitAvailabilityKey(unit, availabilitySource));
        }

        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        if (faction.id === MULFACTION_EXTINCT) {
            if (!contextEraIds) {
                return this.megaMekExtinctAllUnitIds.has(unit.name);
            }

            for (const eraId of contextEraIds) {
                if (this.megaMekExtinctEraUnitIds.get(eraId)?.has(unit.name)) {
                    return true;
                }
            }

            return false;
        }

        return this.getMegaMekEntries(unit.name).some((entry) => (
            entry.factionId === faction.id
            && (!contextEraIds || contextEraIds.has(entry.eraId))
            && this.entryHasAnyAvailability(entry)
        ));
    }

    public unitMatchesMegaMekMembership(
        unit: Pick<UnitSummary, 'id' | 'name'>,
        context?: MegaMekAvailabilityFilterContext,
    ): boolean {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        if (this.hasEmptyMegaMekScope(context)) {
            return false;
        }

        if (context?.bridgeThroughMulMembership) {
            return this.matchesMulMembershipScope(unit.id, context);
        }

        const entries = this.getMegaMekEntries(unit.name);
        const hasScopedMembershipFilters = context?.eraIds !== undefined || context?.factionIds !== undefined;
        if (hasScopedMembershipFilters) {
            return this.matchesMegaMekMembership(unit.name, entries, context);
        }

        return entries.some((entry) => this.entryHasAnyAvailability(entry));
    }

    public getUnitAvailabilityKey(unit: Pick<UnitSummary, 'id' | 'name'>, availabilitySource?: AvailabilitySource): AvailabilityUnitKey {
        return this.useMegaMekAvailability(availabilitySource) ? unit.name : String(unit.id);
    }

    public getMegaMekAvailabilityScore(
        unit: Pick<UnitSummary, 'name'>,
        context?: MegaMekAvailabilityFilterContext,
    ): number {
        return this.getMegaMekAvailabilityScoreResolver(context)(unit);
    }

    public getMegaMekAvailabilityScoreResolver(
        context?: MegaMekAvailabilityFilterContext,
    ): (unit: Pick<UnitSummary, 'name'>) => number {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        if (this.hasEmptyMegaMekScope(context)) {
            return (unit: Pick<UnitSummary, 'name'>): number => this.megaMekKnownUnitIds.has(unit.name)
                ? 0
                : MEGAMEK_AVAILABILITY_UNKNOWN_SCORE;
        }

        const scoreCache = this.getOrCreateMegaMekScopedUnitScoreCache(context);
        const availabilityFrom = this.getRequestedAvailabilitySources(context);

        return (unit: Pick<UnitSummary, 'name'>): number => {
            const cached = scoreCache.get(unit.name);
            if (cached !== undefined) {
                return cached;
            }

            const score = this.computeMegaMekAvailabilityScore(unit.name, context, availabilityFrom);
            scoreCache.set(unit.name, score);
            return score;
        };
    }

    public unitHasMegaMekAvailability(unit: UnitSummary): boolean {
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

        const selectedSources = this.getRequestedAvailabilitySources(context);
        return this.getOrCreateMegaMekScopedUnitIdSet('available', context, [], unitKey => (
            this.unitHasSelectedAvailabilityInScope(unitKey, context, selectedSources)
        ));
    }

    public getMegaMekMembershipUnitIds(
        context?: MegaMekAvailabilityFilterContext,
    ): ReadonlySet<AvailabilityUnitKey> {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        if (this.hasEmptyMegaMekScope(context)) {
            return new Set<AvailabilityUnitKey>();
        }

        if (context?.bridgeThroughMulMembership) {
            return this.getOrCreateMegaMekScopedUnitIdSet('membership', context, [], unitKey => (
                this.matchesMulMembershipScope(this.megaMekUnitIdByName.get(unitKey), context)
            ));
        }

        const eraIds = context?.eraIds;
        const factionIds = context?.factionIds;
        if (eraIds !== undefined && factionIds !== undefined) {
            const unitIds = new Set<AvailabilityUnitKey>();
            for (const eraId of eraIds) {
                for (const factionId of factionIds) {
                    addUnitKeys(
                        unitIds,
                        factionId === MULFACTION_EXTINCT
                            ? this.megaMekExtinctEraUnitIds.get(eraId)
                            : this.megaMekMembershipUnitIdsByEraAndFaction.get(eraId)?.get(factionId),
                    );
                }
            }
            return unitIds;
        }

        if (eraIds !== undefined) {
            if (eraIds.size === 1) {
                return this.megaMekMembershipUnitIdsByEra.get(eraIds.values().next().value!)
                    ?? new Set<AvailabilityUnitKey>();
            }

            const unitIds = new Set<AvailabilityUnitKey>();
            for (const eraId of eraIds) {
                addUnitKeys(unitIds, this.megaMekMembershipUnitIdsByEra.get(eraId));
            }
            return unitIds;
        }

        if (factionIds !== undefined) {
            if (factionIds.size === 1) {
                const factionId = factionIds.values().next().value!;
                return factionId === MULFACTION_EXTINCT
                    ? this.megaMekExtinctAllUnitIds
                    : this.megaMekMembershipUnitIdsByFaction.get(factionId) ?? new Set<AvailabilityUnitKey>();
            }

            const unitIds = new Set<AvailabilityUnitKey>();
            for (const factionId of factionIds) {
                addUnitKeys(
                    unitIds,
                    factionId === MULFACTION_EXTINCT
                        ? this.megaMekExtinctAllUnitIds
                        : this.megaMekMembershipUnitIdsByFaction.get(factionId),
                );
            }
            return unitIds;
        }

        return this.megaMekMembershipUnitIds;
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

        const selectedSources = this.getRequestedAvailabilitySources(context);
        return this.getOrCreateMegaMekScopedUnitIdSet('rarity', context, [rarity], unitKey => (
            this.unitMatchesResolvedAvailabilityRarity(unitKey, rarity, context, selectedSources)
        ));
    }

    public getMegaMekUnknownUnitIds(
        context?: MegaMekAvailabilityFilterContext,
    ): ReadonlySet<AvailabilityUnitKey> {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        if (this.hasEmptyMegaMekScope(context)) {
            return new Set<AvailabilityUnitKey>();
        }

        return this.getOrCreateMegaMekScopedUnitIdSet('unknown', context, [], unitKey => (
            this.isMegaMekUnitUnknownInScope(unitKey, context)
        ));
    }

    public unitMatchesAvailabilityFrom(
        unit: UnitSummary,
        availabilityFromName: string,
        context?: MegaMekAvailabilityFilterContext,
    ): boolean {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();
        if (this.hasEmptyMegaMekScope(context)) {
            return false;
        }

        if (availabilityFromName.trim().toLowerCase() === MEGAMEK_AVAILABILITY_UNKNOWN.toLowerCase()) {
            return this.isMegaMekUnitUnknownInScope(unit.name, context);
        }

        const availabilityFrom = this.resolveMegaMekAvailabilityFrom(availabilityFromName);
        if (!availabilityFrom) {
            return false;
        }

        return this.unitHasSelectedAvailabilityInScope(unit.name, context, [availabilityFrom]);
    }

    public unitMatchesAvailabilityRarity(
        unit: UnitSummary,
        rarityName: string,
        context?: MegaMekAvailabilityFilterContext,
    ): boolean {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();
        if (this.hasEmptyMegaMekScope(context)) {
            return false;
        }

        const rarity = this.resolveMegaMekAvailabilityRarity(rarityName);
        if (!rarity) {
            return false;
        }

        return this.unitMatchesResolvedAvailabilityRarity(
            unit.name,
            rarity,
            context,
            this.getRequestedAvailabilitySources(context),
        );
    }

    public collectFastMulUnknownOptionIds(
        contextUnits: readonly Pick<UnitSummary, 'id' | 'name'>[],
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

    private useAllScopedMegaMekAvailabilityOptions(): boolean {
        return this.optionsService.options().megaMekAvailabilityFiltersUseAllScopedOptions;
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
                        requisition: value[0],
                        salvage: value[1],
                    });

                    if (isMegaMekAvailabilityValueAvailable(value as [number, number])) {
                        getOrCreateMapValue(availableUnitIdsByEra, eraId, () => new Set<AvailabilityUnitKey>()).add(unitKey);
                        this.megaMekMembershipUnitIds.add(unitKey);
                        getOrCreateMapValue(
                            this.megaMekMembershipUnitIdsByEra,
                            eraId,
                            () => new Set<AvailabilityUnitKey>(),
                        ).add(unitKey);
                        getOrCreateMapValue(
                            this.megaMekMembershipUnitIdsByFaction,
                            factionId,
                            () => new Set<AvailabilityUnitKey>(),
                        ).add(unitKey);
                        const factionUnitIds = getOrCreateMapValue(
                            this.megaMekMembershipUnitIdsByEraAndFaction,
                            eraId,
                            () => new Map<number, Set<AvailabilityUnitKey>>(),
                        );
                        getOrCreateMapValue(
                            factionUnitIds,
                            factionId,
                            () => new Set<AvailabilityUnitKey>(),
                        ).add(unitKey);
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
        const bridgeKey = context?.bridgeThroughMulMembership ? 'mul' : 'megamek';
        const modeKey = this.useAllScopedMegaMekAvailabilityOptions() ? 'all' : 'max';
        const suffix = extras.length > 0 ? `|${extras.join('|')}` : '';

        return `${kind}|${bridgeKey}|${modeKey}|e=${eraKey}|f=${factionKey}|from=${availabilityFromKey}|rarity=${availabilityRarityKey}${suffix}`;
    }

    private getOrCreateMegaMekScopedUnitIdSet(
        kind: 'available' | 'membership' | 'rarity' | 'unknown',
        context: MegaMekAvailabilityFilterContext | undefined,
        extras: string[],
        matches: (unitKey: AvailabilityUnitKey) => boolean,
    ): ReadonlySet<AvailabilityUnitKey> {
        const cacheKey = this.buildMegaMekScopedCacheKey(kind, context, extras);
        const cached = this.megaMekScopedUnitIdCache.get(cacheKey);
        if (cached) {
            this.megaMekScopedUnitIdCache.delete(cacheKey);
            this.megaMekScopedUnitIdCache.set(cacheKey, cached);
            return cached;
        }

        const unitIds = new Set<AvailabilityUnitKey>();
        for (const unitKey of this.megaMekAllUnitIds) {
            if (matches(unitKey)) {
                unitIds.add(unitKey);
            }
        }

        this.megaMekScopedUnitIdCache.set(cacheKey, unitIds);
        while (this.megaMekScopedUnitIdCache.size > MEGAMEK_SCOPED_UNIT_ID_CACHE_LIMIT) {
            const oldestKey = this.megaMekScopedUnitIdCache.keys().next().value;
            if (oldestKey === undefined) {
                break;
            }
            this.megaMekScopedUnitIdCache.delete(oldestKey);
        }

        return unitIds;
    }

    private unitMatchesResolvedAvailabilityRarity(
        unitKey: AvailabilityUnitKey,
        rarity: MegaMekAvailabilityRarity,
        context: MegaMekAvailabilityFilterContext | undefined,
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
    ): boolean {
        if (rarity === MEGAMEK_AVAILABILITY_UNKNOWN) {
            return this.isMegaMekUnitUnknownInScope(unitKey, context);
        }

        if (rarity === MEGAMEK_AVAILABILITY_NOT_AVAILABLE) {
            return this.isMegaMekUnitKnownInScope(unitKey, context)
                && !this.unitHasSelectedAvailabilityInScope(unitKey, context, availabilityFrom);
        }

        const entries = this.getMegaMekEntries(unitKey);
        const unitId = this.megaMekUnitIdByName.get(unitKey);
        if (this.useAllScopedMegaMekAvailabilityOptions()) {
            return entries.some(entry => (
                this.entryMatchesMegaMekScopeForUnit(unitId, entry, context)
                && this.entryMatchesSelectedRarity(entry, rarity, availabilityFrom)
            ));
        }

        for (const source of availabilityFrom) {
            let maxScore = 0;
            for (const entry of entries) {
                if (!this.entryMatchesMegaMekScopeForUnit(unitId, entry, context)) {
                    continue;
                }

                const score = source === 'Requisition' ? entry.requisition : entry.salvage;
                if (score > maxScore) {
                    maxScore = score;
                }
            }

            if (getMegaMekAvailabilityRarityForScore(maxScore) === rarity) {
                return true;
            }
        }

        return false;
    }

    private unitHasSelectedAvailabilityInScope(
        unitKey: AvailabilityUnitKey,
        context: MegaMekAvailabilityFilterContext | undefined,
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
    ): boolean {
        const unitId = this.megaMekUnitIdByName.get(unitKey);
        return this.getMegaMekEntries(unitKey).some(entry => (
            this.entryMatchesMegaMekScopeForUnit(unitId, entry, context)
            && this.entryHasSelectedAvailability(entry, availabilityFrom)
        ));
    }

    private isMegaMekUnitKnownInScope(
        unitKey: AvailabilityUnitKey,
        context?: MegaMekAvailabilityFilterContext,
    ): boolean {
        if (!this.megaMekKnownUnitIds.has(unitKey)) {
            return false;
        }

        const entries = this.getMegaMekEntries(unitKey);
        const unitId = this.megaMekUnitIdByName.get(unitKey);
        if (context?.bridgeThroughMulMembership) {
            return this.matchesMulMembershipScope(unitId, context)
                && this.hasScopedMegaMekEntries(unitId, entries, context);
        }

        const hasScopedMembershipFilters = context?.eraIds !== undefined || context?.factionIds !== undefined;
        return !hasScopedMembershipFilters || this.hasScopedMegaMekEntries(unitId, entries, context);
    }

    private isMegaMekUnitUnknownInScope(
        unitKey: AvailabilityUnitKey,
        context?: MegaMekAvailabilityFilterContext,
    ): boolean {
        const hasMegaMekRecord = this.megaMekKnownUnitIds.has(unitKey);
        const hasScopedMembershipFilters = context?.eraIds !== undefined || context?.factionIds !== undefined;
        if (!context?.bridgeThroughMulMembership) {
            return !hasScopedMembershipFilters && !hasMegaMekRecord;
        }

        const unitId = this.megaMekUnitIdByName.get(unitKey);
        if (!this.matchesMulMembershipScope(unitId, context)) {
            return false;
        }
        if (!hasMegaMekRecord) {
            return true;
        }

        return hasScopedMembershipFilters
            && this.hasUnknownMulAvailabilityInScope(unitId, this.getMegaMekEntries(unitKey), context);
    }

    private resetMegaMekIndexes(): void {
        this.megaMekExtinctEraUnitIds.clear();
        this.megaMekAvailabilityEntriesByUnitKey.clear();
        this.megaMekAllUnitIds.clear();
        this.megaMekKnownUnitIds.clear();
        this.megaMekMembershipUnitIds.clear();
        this.megaMekMembershipUnitIdsByEra.clear();
        this.megaMekMembershipUnitIdsByFaction.clear();
        this.megaMekMembershipUnitIdsByEraAndFaction.clear();
        this.megaMekUnitIdByName.clear();
        this.megaMekExtinctAllUnitIds.clear();
        this.megaMekScopedUnitIdCache.clear();
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
            const score = source === 'Requisition'
                ? entry.requisition
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
        const value = [entry.requisition, entry.salvage] as [number, number];
        return availabilityFrom.some((source) => getMegaMekAvailabilityValueForSource(value, source) > 0);
    }

    private entryHasAnyAvailability(entry: MegaMekUnitAvailabilityEntry): boolean {
        return entry.requisition > 0 || entry.salvage > 0;
    }

    private entryMatchesSelectedRarity(
        entry: MegaMekUnitAvailabilityEntry,
        rarity: MegaMekAvailabilityRarity,
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
    ): boolean {
        const value = [entry.requisition, entry.salvage] as [number, number];
        return availabilityFrom.some((source) => {
            const score = getMegaMekAvailabilityValueForSource(value, source);
            return getMegaMekAvailabilityRarityForScore(score) === rarity;
        });
    }

}
