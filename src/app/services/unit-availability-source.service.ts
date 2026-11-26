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
import { createMulForceAvailabilityContext, type ForceAvailabilityContext } from '../utils/force-availability.util';
import { DataService } from './data.service';
import { OptionsService } from './options.service';
import type { UnitUuid } from './unit-catalog/unit-catalog.types';

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

type AvailabilityUnitKey = UnitUuid;
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

function addUnitKeys<K extends string>(target: Set<K>, source: ReadonlySet<K> | undefined): void {
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
    private megaMekExtinctAllUnitIds = new Set<AvailabilityUnitKey>();
    private megaMekScopedUnitIdCache = new Map<string, ReadonlySet<AvailabilityUnitKey>>();
    private megaMekScopedUnitScoreCache = new Map<string, Map<AvailabilityUnitKey, number>>();
    /** MUL bridge, resolved once on the first bridged query and never in MegaMek mode. */
    private mulBridgeReady = false;
    private megaMekEntriesInMulByUnitKey = new Map<AvailabilityUnitKey, readonly MegaMekUnitAvailabilityEntry[]>();
    private unknownMulPairsByUnitKey = new Map<AvailabilityUnitKey, MulMembershipPair[]>();

    public getVisibleEraUnitIds(era: Era, availabilitySource?: AvailabilitySource): Set<string> {
        this.ensureMulCacheVersion();

        if (!this.useMegaMekAvailability(availabilitySource)) {
            return new Set(this.getMulVisibleEraUnitIds(era));
        }

        return new Set(this.getMegaMekMembershipUnitIds({
            eraIds: new Set([era.id]),
        }));
    }

    public getFactionEraUnitIds(
        faction: Faction,
        era: Era,
        availabilitySource?: AvailabilitySource,
    ): Set<string> {
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
    ): Set<string> {
        this.ensureMulCacheVersion();
        const singleEraId = this.getSingleScopedEraId(contextEraIds);

        if (!this.useMegaMekAvailability(availabilitySource)) {
            if (singleEraId !== null) {
                return new Set(this.getMulFactionEraUnitIds(faction, singleEraId));
            }

            return new Set(this.getMulFactionUnitIds(faction, contextEraIds));
        }

        return new Set(this.getMegaMekMembershipUnitIds({
            ...(contextEraIds ? { eraIds: contextEraIds } : {}),
            factionIds: new Set([faction.id]),
        }));
    }

    public createForceAvailabilityContextForUnits(
        units: readonly Pick<UnitSummary, 'uuid' | 'name' | 'isCustom' | 'year'>[],
        eras: readonly Era[],
        availabilitySource?: AvailabilitySource,
    ): ForceAvailabilityContext {
        const resolvedSource = availabilitySource ?? this.optionsService.options().availabilitySource;
        if (resolvedSource !== 'megamek') {
            return createMulForceAvailabilityContext(this.dataService.getMulAvailabilityIndex(), units);
        }

        const distinctUnitsByKey = new Map<AvailabilityUnitKey, Pick<UnitSummary, 'uuid' | 'name' | 'isCustom'>>();
        for (const unit of units) {
            if (!distinctUnitsByKey.has(unit.uuid)) {
                distinctUnitsByKey.set(unit.uuid, unit);
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
                    getOrCreateMapValue(eraUnitIdsByFaction, eraId, () => new Set<AvailabilityUnitKey>()).add(unit.uuid);
                }

                if (!isVisibleInEra) {
                    continue;
                }

                availableEraIds.add(eraId);
                getOrCreateMapValue(visibleUnitIdsByEra, eraId, () => new Set<AvailabilityUnitKey>()).add(unit.uuid);
            }

            if (availableEraIds.size > 0) {
                availableEraIdsByUnitKey.set(unit.uuid, availableEraIds);
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
            getUnitKey: (unit) => unit.uuid,
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
            return this.dataService.getMulAvailabilityIndex().factionExistsInEra(faction.id, era.id);
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

        return this.getFactionEraUnitIds(faction, era, 'megamek').size > 0;
    }

    public unitBelongsToEra(unit: UnitSummary, era: Era, availabilitySource?: AvailabilitySource): boolean {
        if (!this.useMegaMekAvailability(availabilitySource)) {
            return this.dataService.getMulAvailabilityIndex().getEraUnitUuids(era.id).has(unit.uuid);
        }

        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        return this.getMegaMekEntries(unit.uuid).some((entry) => (
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
            return this.dataService.getMulAvailabilityIndex().unitBelongsToFaction(unit.uuid, faction.id, contextEraIds);
        }

        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        if (faction.id === MULFACTION_EXTINCT) {
            if (!contextEraIds) {
                return this.megaMekExtinctAllUnitIds.has(unit.uuid);
            }

            for (const eraId of contextEraIds) {
                if (this.megaMekExtinctEraUnitIds.get(eraId)?.has(unit.uuid)) {
                    return true;
                }
            }

            return false;
        }

        return this.getMegaMekEntries(unit.uuid).some((entry) => (
            entry.factionId === faction.id
            && (!contextEraIds || contextEraIds.has(entry.eraId))
            && this.entryHasAnyAvailability(entry)
        ));
    }

    public unitMatchesMegaMekMembership(
        unit: Pick<UnitSummary, 'uuid'>,
        context?: MegaMekAvailabilityFilterContext,
    ): boolean {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        if (this.hasEmptyMegaMekScope(context)) {
            return false;
        }

        if (context?.bridgeThroughMulMembership) {
            return this.matchesMulMembershipScope(unit.uuid, context);
        }

        const entries = this.getMegaMekEntries(unit.uuid);
        const hasScopedMembershipFilters = context?.eraIds !== undefined || context?.factionIds !== undefined;
        if (hasScopedMembershipFilters) {
            return this.matchesMegaMekMembership(unit.uuid, entries, context);
        }

        return entries.some((entry) => this.entryHasAnyAvailability(entry));
    }

    public getUnitAvailabilityKey(unit: Pick<UnitSummary, 'uuid'>, availabilitySource?: AvailabilitySource): string {
        return unit.uuid;
    }

    public getMegaMekAvailabilityScore(
        unit: Pick<UnitSummary, 'uuid'>,
        context?: MegaMekAvailabilityFilterContext,
    ): number {
        return this.getMegaMekAvailabilityScoreResolver(context)(unit);
    }

    public getMegaMekAvailabilityScoreResolver(
        context?: MegaMekAvailabilityFilterContext,
    ): (unit: Pick<UnitSummary, 'uuid'>) => number {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        if (this.hasEmptyMegaMekScope(context)) {
            return (unit: Pick<UnitSummary, 'uuid'>): number => this.megaMekKnownUnitIds.has(unit.uuid)
                ? 0
                : MEGAMEK_AVAILABILITY_UNKNOWN_SCORE;
        }

        const scoreCache = this.getOrCreateMegaMekScopedUnitScoreCache(context);
        const availabilityFrom = this.getRequestedAvailabilitySources(context);

        return (unit: Pick<UnitSummary, 'uuid'>): number => {
            const cached = scoreCache.get(unit.uuid);
            if (cached !== undefined) {
                return cached;
            }

            const score = this.computeMegaMekAvailabilityScore(unit.uuid, context, availabilityFrom);
            scoreCache.set(unit.uuid, score);
            return score;
        };
    }

    public unitHasMegaMekAvailability(unit: UnitSummary): boolean {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        return this.megaMekKnownUnitIds.has(unit.uuid);
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
                this.matchesMulMembershipScope(unitKey, context)
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
            return this.isMegaMekUnitUnknownInScope(unit.uuid, context);
        }

        const availabilityFrom = this.resolveMegaMekAvailabilityFrom(availabilityFromName);
        if (!availabilityFrom) {
            return false;
        }

        return this.unitHasSelectedAvailabilityInScope(unit.uuid, context, [availabilityFrom]);
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
            unit.uuid,
            rarity,
            context,
            this.getRequestedAvailabilitySources(context),
        );
    }

    /** The unit's MegaMek entries; with the MUL bridge, only those inside its MUL faction-era membership. */
    public getMegaMekAvailabilityEntries(
        unit: Pick<UnitSummary, 'uuid'>,
        context?: MegaMekAvailabilityFilterContext,
    ): readonly MegaMekUnitAvailabilityEntry[] {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        return this.getMegaMekEntries(unit.uuid, context);
    }

    /** The unit's MUL faction-era memberships that MegaMek has no entry for. */
    public getUnknownMulPairs(unit: Pick<UnitSummary, 'uuid'>): readonly MulMembershipPair[] {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();
        this.ensureMulBridge();

        return this.unknownMulPairsByUnitKey.get(unit.uuid) ?? [];
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
        this.megaMekIndexVersion = '';
        this.resetMegaMekIndexes();
    }

    private getMulVisibleEraUnitIds(era: Era): ReadonlySet<string> {
        return this.dataService.getMulAvailabilityIndex().getEraUnitUuids(era.id);
    }

    private getSingleScopedEraId(contextEraIds?: ReadonlySet<number>): number | null {
        if (!contextEraIds || contextEraIds.size !== 1) {
            return null;
        }

        const firstEntry = contextEraIds.values().next();
        return firstEntry.done ? null : firstEntry.value;
    }

    private getMulFactionEraUnitIds(faction: Faction, eraId: number): ReadonlySet<string> {
        return this.dataService.getMulAvailabilityIndex().getFactionEraUnitUuids(faction.id, eraId);
    }

    private getMulFactionUnitIds(faction: Faction, contextEraIds?: ReadonlySet<number>): ReadonlySet<string> {
        return this.dataService.getMulAvailabilityIndex().getFactionUnitUuids(faction.id, contextEraIds);
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
            this.megaMekAllUnitIds.add(unit.uuid);


            const availabilityRecord = this.dataService.getMegaMekAvailabilityRecordForUnit(unit);
            if (!availabilityRecord) {
                continue;
            }

            this.megaMekKnownUnitIds.add(unit.uuid);

            const unitKey = unit.uuid;
            const entries: MegaMekUnitAvailabilityEntry[] = [];

            for (const [eraIdText, eraAvailability] of Object.entries(availabilityRecord.e)) {
                const eraId = Number(eraIdText);
                if (Number.isNaN(eraId)) {
                    continue;
                }

                for (const [factionIdText, weights] of Object.entries(eraAvailability)) {
                    const factionId = Number(factionIdText);
                    if (Number.isNaN(factionId) || factionId === MULFACTION_EXTINCT) {
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
        unitKey: AvailabilityUnitKey,
        context?: MegaMekAvailabilityFilterContext,
    ): boolean {
        return this.getMegaMekEntries(unitKey, context).some((entry) => this.pairMatchesMegaMekScope(entry, context));
    }

    private hasUnknownMulAvailabilityInScope(
        unitKey: AvailabilityUnitKey,
        context?: MegaMekAvailabilityFilterContext,
    ): boolean {
        this.ensureMulBridge();

        return this.unknownMulPairsByUnitKey.get(unitKey)
            ?.some((pair) => this.pairMatchesMegaMekScope(pair, context)) ?? false;
    }

    private pairMatchesMegaMekScope(
        pair: MulMembershipPair,
        context?: MegaMekAvailabilityFilterContext,
    ): boolean {
        return (!context?.eraIds || context.eraIds.has(pair.eraId))
            && (!context?.factionIds || context.factionIds.has(pair.factionId));
    }

    private matchesMulMembershipScope(
        unitId: string | null | undefined,
        context?: MegaMekAvailabilityFilterContext,
    ): boolean {
        if (unitId == null) {
            return false;
        }

        const unitKey = unitId;
        return this.matchesMegaMekScope(context, {
            pair: (eraId, factionId) => this.getMulFactionEraUnitIdsById(factionId, eraId).has(unitKey),
            era: (eraId) => this.getMulVisibleEraUnitIdsById(eraId).has(unitKey),
            faction: (factionId) => this.getMulFactionUnitIdsById(factionId).has(unitKey),
            any: () => true,
        });
    }

    private getMulVisibleEraUnitIdsById(eraId: number): ReadonlySet<string> {
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

        const unitIds = new Set<string>();
        for (const faction of this.dataService.getFactions()) {
            if (faction.id === MULFACTION_EXTINCT) {
                continue;
            }

            addUnitKeys(unitIds, this.getMulFactionEraUnitIds(faction, eraId));
        }

        return unitIds;
    }

    private getMulFactionEraUnitIdsById(factionId: number, eraId: number): ReadonlySet<string> {
        const faction = this.dataService.getFactionById(factionId);
        return faction ? this.getMulFactionEraUnitIds(faction, eraId) : new Set<string>();
    }

    private getMulFactionUnitIdsById(factionId: number): ReadonlySet<string> {
        const faction = this.dataService.getFactionById(factionId);
        return faction ? this.getMulFactionUnitIds(faction) : new Set<string>();
    }

    /**
     * Resolves, once per catalog, which MegaMek entries MUL membership keeps
     * and which MUL memberships MegaMek has no entry for.
     */
    private ensureMulBridge(): void {
        if (this.mulBridgeReady) {
            return;
        }

        this.mulBridgeReady = true;
        for (const [unitKey, entries] of this.megaMekAvailabilityEntriesByUnitKey) {
            const entriesInMul = entries.filter((entry) => (
                this.getMulFactionEraUnitIdsById(entry.factionId, entry.eraId).has(unitKey)
            ));
            if (entriesInMul.length > 0) {
                this.megaMekEntriesInMulByUnitKey.set(unitKey, entriesInMul);
            }
        }

        const index = this.dataService.getMulAvailabilityIndex();
        const eras = this.dataService.getEras();
        for (const faction of this.dataService.getFactions()) {
            if (faction.id === MULFACTION_EXTINCT) continue;
            for (const era of eras) {
                for (const unitKey of index.getFactionEraUnitUuids(faction.id, era.id)) {
                    const hasEntry = this.megaMekEntriesInMulByUnitKey.get(unitKey)
                        ?.some((entry) => entry.eraId === era.id && entry.factionId === faction.id);
                    if (!hasEntry) {
                        getOrCreateMapValue(this.unknownMulPairsByUnitKey, unitKey, () => [])
                            .push({ eraId: era.id, factionId: faction.id });
                    }
                }
            }
        }
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

        const entries = this.getMegaMekEntries(unitKey, context);
        if (this.useAllScopedMegaMekAvailabilityOptions()) {
            return entries.some(entry => (
                this.pairMatchesMegaMekScope(entry, context)
                && this.entryMatchesSelectedRarity(entry, rarity, availabilityFrom)
            ));
        }

        for (const source of availabilityFrom) {
            let maxScore = 0;
            for (const entry of entries) {
                if (!this.pairMatchesMegaMekScope(entry, context)) {
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
        return this.getMegaMekEntries(unitKey, context).some(entry => (
            this.pairMatchesMegaMekScope(entry, context)
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

        if (context?.bridgeThroughMulMembership) {
            return this.matchesMulMembershipScope(unitKey, context)
                && this.hasScopedMegaMekEntries(unitKey, context);
        }

        const hasScopedMembershipFilters = context?.eraIds !== undefined || context?.factionIds !== undefined;
        return !hasScopedMembershipFilters || this.hasScopedMegaMekEntries(unitKey, context);
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

        if (!this.matchesMulMembershipScope(unitKey, context)) {
            return false;
        }
        if (!hasMegaMekRecord) {
            return true;
        }

        return hasScopedMembershipFilters && this.hasUnknownMulAvailabilityInScope(unitKey, context);
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
        this.megaMekExtinctAllUnitIds.clear();
        this.megaMekScopedUnitIdCache.clear();
        this.megaMekScopedUnitScoreCache.clear();
        this.mulBridgeReady = false;
        this.megaMekEntriesInMulByUnitKey.clear();
        this.unknownMulPairsByUnitKey.clear();
    }

    private getMegaMekEntries(
        unitKey: AvailabilityUnitKey,
        context?: MegaMekAvailabilityFilterContext,
    ): readonly MegaMekUnitAvailabilityEntry[] {
        // Extinct is derived from era gaps, so a scope of only Extinct has no entries.
        if (context?.factionIds?.size === 1 && context.factionIds.has(MULFACTION_EXTINCT)) {
            return [];
        }

        if (context?.bridgeThroughMulMembership) {
            this.ensureMulBridge();
            return this.megaMekEntriesInMulByUnitKey.get(unitKey) ?? [];
        }

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
        unitUuid: AvailabilityUnitKey,
        context: MegaMekAvailabilityFilterContext | undefined,
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
    ): number {
        const entries = this.megaMekAvailabilityEntriesByUnitKey.get(unitUuid);
        if (!entries || entries.length === 0) {
            return MEGAMEK_AVAILABILITY_UNKNOWN_SCORE;
        }

        let maxScore = 0;

        for (const entry of this.getMegaMekEntries(unitUuid, context)) {
            if (!this.pairMatchesMegaMekScope(entry, context)) {
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
