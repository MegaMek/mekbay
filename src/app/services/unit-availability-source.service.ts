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
    MEGAMEK_AVAILABILITY_UNKNOWN_SCORE,
    MEGAMEK_AVAILABILITY_UNKNOWN,
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

export interface MegaMekAvailabilityFilterContext {
    eraIds?: ReadonlySet<number>;
    factionIds?: ReadonlySet<number>;
    availabilityFrom?: ReadonlySet<MegaMekAvailabilityFrom>;
}

type AvailabilityUnitKey = string;

export interface MegaMekUnitAvailabilityDetail {
    source: MegaMekAvailabilityFrom;
    score: number;
    rarity: typeof MEGAMEK_AVAILABILITY_RARITY_OPTIONS[number];
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

const MEGAMEK_SCOPED_UNIT_IDS_CACHE_LIMIT = 128;
const MEGAMEK_SCOPED_UNIT_SCORE_CACHE_LIMIT = 48;

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
    private mulCacheVersion = -1;

    private megaMekIndexVersion = '';
    private megaMekExtinctEraUnitIds = new Map<number, Set<AvailabilityUnitKey>>();
    private megaMekAvailabilityEntriesByUnitKey = new Map<AvailabilityUnitKey, readonly MegaMekUnitAvailabilityEntry[]>();
    private megaMekAllUnitIds = new Set<AvailabilityUnitKey>();
    private megaMekKnownUnitIds = new Set<AvailabilityUnitKey>();
    private megaMekExtinctAllUnitIds = new Set<AvailabilityUnitKey>();
    private megaMekScopedUnitIdsCache = new Map<string, ReadonlySet<AvailabilityUnitKey>>();
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

        const scopeCache = this.getOrCreateMegaMekScopedUnitScoreCache(context);
        const availabilityFrom = this.getRequestedAvailabilitySources(context);
        const eraIds = context?.eraIds;
        const factionIds = context?.factionIds;

        return (unit: Pick<Unit, 'name'>): number => {
            const cached = scopeCache.get(unit.name);
            if (cached !== undefined) {
                return cached;
            }

            const score = this.computeMegaMekAvailabilityScore(unit.name, eraIds, factionIds, availabilityFrom);
            scopeCache.set(unit.name, score);
            return score;
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

        const cacheKey = this.buildMegaMekScopedCacheKey('available', context);
        const cached = this.getMegaMekScopedUnitIdsFromCache(cacheKey);
        if (cached) {
            return cached;
        }

        const selectedSources = this.getRequestedAvailabilitySources(context);
        const unitIds = this.collectMegaMekAvailabilityUnitIdsForSources(selectedSources, context);
        this.setMegaMekScopedUnitIdsCache(cacheKey, unitIds);
        return unitIds;
    }

    public getMegaMekMembershipUnitIds(
        context?: MegaMekAvailabilityFilterContext,
    ): ReadonlySet<AvailabilityUnitKey> {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        const cacheKey = this.buildMegaMekScopedCacheKey('membership', context);
        const cached = this.getMegaMekScopedUnitIdsFromCache(cacheKey);
        if (cached) {
            return cached;
        }

        const unitIds = this.collectMegaMekMembershipUnitIds(context);
        this.setMegaMekScopedUnitIdsCache(cacheKey, unitIds);
        return unitIds;
    }

    public getMegaMekRarityUnitIds(
        rarity: MegaMekAvailabilityRarity,
        context?: MegaMekAvailabilityFilterContext,
    ): ReadonlySet<AvailabilityUnitKey> {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        const cacheKey = this.buildMegaMekScopedCacheKey('rarity', context, [rarity]);
        const cached = this.getMegaMekScopedUnitIdsFromCache(cacheKey);
        if (cached) {
            return cached;
        }

        const selectedSources = this.getRequestedAvailabilitySources(context);
        const unitIds = rarity === MEGAMEK_AVAILABILITY_UNKNOWN
            ? this.collectMegaMekUnknownUnitIds()
            : rarity === 'Not Available'
                ? this.collectMegaMekUnavailableUnitIds(selectedSources, context)
                : this.collectMegaMekRarityUnitIds(rarity, selectedSources, context);
        this.setMegaMekScopedUnitIdsCache(cacheKey, unitIds);
        return unitIds;
    }

    public getMegaMekUnknownUnitIds(): ReadonlySet<AvailabilityUnitKey> {
        this.ensureMulCacheVersion();
        this.ensureMegaMekIndexes();

        const cacheKey = this.buildMegaMekScopedCacheKey('unknown');
        const cached = this.getMegaMekScopedUnitIdsFromCache(cacheKey);
        if (cached) {
            return cached;
        }

        const unitIds = this.collectMegaMekUnknownUnitIds();
        this.setMegaMekScopedUnitIdsCache(cacheKey, unitIds);
        return unitIds;
    }

    public unitMatchesAvailabilityFrom(
        unit: Unit,
        availabilityFromName: string,
        context?: MegaMekAvailabilityFilterContext,
    ): boolean {
        if (availabilityFromName.trim().toLowerCase() === MEGAMEK_AVAILABILITY_UNKNOWN.toLowerCase()) {
            return this.getMegaMekUnknownUnitIds().has(unit.name);
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
            return this.getMegaMekUnknownUnitIds().has(unit.name);
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
        const suffix = extras.length > 0 ? `|${extras.join('|')}` : '';

        return `${kind}|e=${eraKey}|f=${factionKey}|from=${availabilityFromKey}${suffix}`;
    }

    private resetMegaMekIndexes(): void {
        this.megaMekExtinctEraUnitIds.clear();
        this.megaMekAvailabilityEntriesByUnitKey.clear();
        this.megaMekAllUnitIds.clear();
        this.megaMekKnownUnitIds.clear();
        this.megaMekExtinctAllUnitIds.clear();
        this.megaMekScopedUnitIdsCache.clear();
        this.megaMekScopedUnitScoreCache.clear();
    }

    private getMegaMekScopedUnitIdsFromCache(cacheKey: string): ReadonlySet<AvailabilityUnitKey> | undefined {
        const cached = this.megaMekScopedUnitIdsCache.get(cacheKey);
        if (!cached) {
            return undefined;
        }

        this.megaMekScopedUnitIdsCache.delete(cacheKey);
        this.megaMekScopedUnitIdsCache.set(cacheKey, cached);
        return cached;
    }

    private setMegaMekScopedUnitIdsCache(cacheKey: string, unitIds: ReadonlySet<AvailabilityUnitKey>): void {
        if (this.megaMekScopedUnitIdsCache.has(cacheKey)) {
            this.megaMekScopedUnitIdsCache.delete(cacheKey);
        }

        this.megaMekScopedUnitIdsCache.set(cacheKey, unitIds);
        while (this.megaMekScopedUnitIdsCache.size > MEGAMEK_SCOPED_UNIT_IDS_CACHE_LIMIT) {
            const oldestKey = this.megaMekScopedUnitIdsCache.keys().next().value;
            if (oldestKey === undefined) {
                break;
            }

            this.megaMekScopedUnitIdsCache.delete(oldestKey);
        }
    }

    private getMegaMekEntries(unitKey: AvailabilityUnitKey): readonly MegaMekUnitAvailabilityEntry[] {
        return this.megaMekAvailabilityEntriesByUnitKey.get(unitKey) ?? [];
    }

    private collectMegaMekKnownUnitIds(
        predicate: (unitKey: AvailabilityUnitKey, entries: readonly MegaMekUnitAvailabilityEntry[]) => boolean,
    ): ReadonlySet<AvailabilityUnitKey> {
        const unitIds = new Set<AvailabilityUnitKey>();

        for (const unitKey of this.megaMekKnownUnitIds) {
            const entries = this.getMegaMekEntries(unitKey);
            if (predicate(unitKey, entries)) {
                unitIds.add(unitKey);
            }
        }

        return unitIds;
    }

    private collectMegaMekMembershipUnitIds(
        context?: MegaMekAvailabilityFilterContext,
    ): ReadonlySet<AvailabilityUnitKey> {
        return this.collectMegaMekKnownUnitIds((unitKey, entries) => {
            return this.matchesMegaMekMembership(unitKey, entries, context);
        });
    }

    private collectMegaMekAvailabilityUnitIdsForSources(
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
        context?: MegaMekAvailabilityFilterContext,
    ): ReadonlySet<AvailabilityUnitKey> {
        return this.collectMegaMekKnownUnitIds((unitKey, entries) => {
            return this.matchesMegaMekAvailabilityPredicate(entries, context, (entry) => {
                return this.entryHasSelectedAvailability(entry, availabilityFrom);
            });
        });
    }

    private collectMegaMekRarityUnitIds(
        rarity: MegaMekAvailabilityRarity,
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
        context?: MegaMekAvailabilityFilterContext,
    ): ReadonlySet<AvailabilityUnitKey> {
        return this.collectMegaMekKnownUnitIds((unitKey, entries) => {
            return this.matchesMegaMekAvailabilityPredicate(entries, context, (entry) => {
                return this.entryMatchesSelectedRarity(entry, rarity, availabilityFrom);
            });
        });
    }

    private collectMegaMekUnavailableUnitIds(
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
        context?: MegaMekAvailabilityFilterContext,
    ): ReadonlySet<AvailabilityUnitKey> {
        return this.collectMegaMekKnownUnitIds((unitKey, entries) => {
            return this.matchesMegaMekUnavailable(unitKey, entries, context, availabilityFrom);
        });
    }

    private collectMegaMekUnknownUnitIds(): ReadonlySet<AvailabilityUnitKey> {
        const unitIds = new Set<AvailabilityUnitKey>();

        for (const unitKey of this.megaMekAllUnitIds) {
            if (!this.megaMekKnownUnitIds.has(unitKey)) {
                unitIds.add(unitKey);
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
        eraIds: ReadonlySet<number> | undefined,
        factionIds: ReadonlySet<number> | undefined,
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
    ): number {
        const entries = this.megaMekAvailabilityEntriesByUnitKey.get(unitName);
        if (!entries || entries.length === 0) {
            return MEGAMEK_AVAILABILITY_UNKNOWN_SCORE;
        }

        let maxScore = 0;

        for (const entry of entries) {
            if (eraIds && !eraIds.has(entry.eraId)) {
                continue;
            }
            if (factionIds && !factionIds.has(entry.factionId)) {
                continue;
            }

            const score = this.getEntryMaxSelectedAvailabilityScore(entry, availabilityFrom);
            if (score > maxScore) {
                maxScore = score;
            }
        }

        return maxScore;
    }

    private getEntryMaxSelectedAvailabilityScore(
        entry: MegaMekUnitAvailabilityEntry,
        availabilityFrom: readonly MegaMekAvailabilityFrom[],
    ): number {
        let maxScore = 0;

        for (const source of availabilityFrom) {
            const score = source === 'Production'
                ? entry.production
                : entry.salvage;
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