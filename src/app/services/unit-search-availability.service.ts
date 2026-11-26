// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { AvailabilityFilterScope } from '../models/megamek/availability.model';

import { Injectable, inject } from '@angular/core';
import type { Era } from '../models/eras.model';
import type { UnitSummary } from '../models/unit-summary.model';
import {
    MEGAMEK_AVAILABILITY_ALL_RARITY_OPTIONS,
    MEGAMEK_AVAILABILITY_FROM_FILTER_OPTIONS,
    MEGAMEK_AVAILABILITY_FROM_OPTIONS,
    MEGAMEK_AVAILABILITY_UNKNOWN,
    MEGAMEK_AVAILABILITY_NOT_AVAILABLE,
    getMegaMekAvailabilityRarityForScore,
    type MegaMekAvailabilityFrom,
    type MegaMekAvailabilityRarity,
} from '../models/megamek/availability.model';
import { DataService } from './data.service';
import { UnitSearchIndexService } from './unit-search-index.service';
import { UnitAvailabilitySourceService, type MegaMekAvailabilityFilterContext, type MegaMekUnitAvailabilityDetail } from './unit-availability-source.service';
import type { UnitUuid } from './unit-catalog/unit-catalog.types';
import { hasResolvedDropdownNames, type ResolvedDropdownNames } from '../utils/filter-name-resolution.util';

/** Availability queries use explicit scopes; URL, panel and formation state belong to the caller. */
@Injectable({ providedIn: 'root' })
export class UnitSearchAvailabilityService {
    private readonly dataService = inject(DataService);
    private readonly searchIndex = inject(UnitSearchIndexService);
    private readonly unitAvailabilitySource = inject(UnitAvailabilitySourceService);
    private readonly contextCache = new WeakMap<AvailabilityFilterScope, {
        corpusVersion: number;
        useMegaMek: boolean;
        useAllScopedOptions: boolean;
        context: MegaMekAvailabilityFilterContext | null;
    }>();

    resolveContext(scope: AvailabilityFilterScope | undefined, useAllScopedOptions = false): MegaMekAvailabilityFilterContext | null {
        if (!scope) {
            return {
                bridgeThroughMulMembership: !this.unitAvailabilitySource.useMegaMekAvailability(),
            };
        }
        const corpusVersion = this.dataService.searchCorpusVersion();
        const useMegaMek = this.unitAvailabilitySource.useMegaMekAvailability();
        const cached = this.contextCache.get(scope);
        if (cached && cached.corpusVersion === corpusVersion && cached.useMegaMek === useMegaMek
            && cached.useAllScopedOptions === useAllScopedOptions) {
            return cached.context;
        }
        const remember = (context: MegaMekAvailabilityFilterContext | null) => {
            this.contextCache.set(scope, { corpusVersion, useMegaMek, useAllScopedOptions, context });
            return context;
        };

        const context: MegaMekAvailabilityFilterContext = {
            bridgeThroughMulMembership: !this.unitAvailabilitySource.useMegaMekAvailability()
                && (scope.bridgeThroughMulMembership ?? true),
        };

        if (scope.eraNames !== undefined) {
            const eraIds = new Set(
                scope.eraNames
                    .map((eraName) => this.dataService.getEraByName(eraName)?.id)
                    .filter((eraId): eraId is number => eraId !== undefined),
            );
            if (eraIds.size === 0) {
                return remember(null);
            }
            context.eraIds = eraIds;
        }

        if (scope.factionNames !== undefined) {
            const factionIds = new Set(
                scope.factionNames
                    .map((factionName) => this.dataService.getFactionByName(factionName)?.id)
                    .filter((factionId): factionId is number => factionId !== undefined),
            );
            if (factionIds.size === 0) {
                return remember(null);
            }
            context.factionIds = factionIds;
        }

        if (scope.availabilityFromNames !== undefined) {
            const availabilityFrom = new Set(
                scope.availabilityFromNames
                    .filter((value): value is MegaMekAvailabilityFrom => (
                        value === 'Requisition' || value === 'Salvage'
                    )),
            );
            if (availabilityFrom.size > 0) {
                context.availabilityFrom = availabilityFrom;
            }
        }

        if (useAllScopedOptions && scope.availabilityRarityNames !== undefined) {
            const availabilityRarities = new Set(
                scope.availabilityRarityNames.filter((rarity): rarity is Exclude<MegaMekAvailabilityRarity, typeof MEGAMEK_AVAILABILITY_UNKNOWN | typeof MEGAMEK_AVAILABILITY_NOT_AVAILABLE> => (
                    rarity !== MEGAMEK_AVAILABILITY_UNKNOWN && rarity !== MEGAMEK_AVAILABILITY_NOT_AVAILABLE
                )),
            );
            if (availabilityRarities.size > 0) {
                context.availabilityRarities = availabilityRarities;
            }
        }

        return remember(context);
    }

    unitMatchesAvailabilityFrom(unit: UnitSummary, availabilityFromName: string, scope: AvailabilityFilterScope | undefined, useAllScopedOptions: boolean): boolean {
        const context = this.resolveContext(scope, useAllScopedOptions);
        if (context === null) {
            return false;
        }

        return this.unitAvailabilitySource.unitMatchesAvailabilityFrom(unit, availabilityFromName, context);
    }

    unitMatchesAvailabilityRarity(unit: UnitSummary, rarityName: string, scope: AvailabilityFilterScope | undefined, useAllScopedOptions: boolean): boolean {
        const context = this.resolveContext(scope, useAllScopedOptions);
        if (context === null) {
            return false;
        }

        return this.unitAvailabilitySource.unitMatchesAvailabilityRarity(unit, rarityName, context);
    }

    getCandidateUnitIds(
        scope: AvailabilityFilterScope,
        availabilityFromNames: readonly string[],
        availabilityRarityNames: readonly MegaMekAvailabilityRarity[],
    ): ReadonlySet<string> {
        const baseContext = this.buildMegaMekAvailabilityBaseContext(scope);
        if (baseContext === null) {
            return new Set<string>();
        }

        const selectedPositiveSources = availabilityFromNames.filter((value): value is MegaMekAvailabilityFrom => (
            value === 'Requisition' || value === 'Salvage'
        ));
        const includesUnknownSource = availabilityFromNames.includes(MEGAMEK_AVAILABILITY_UNKNOWN);
        const hasSourceFilter = availabilityFromNames.length > 0;
        const hasRarityFilter = availabilityRarityNames.length > 0;

        if (!hasSourceFilter && !hasRarityFilter) {
            return this.unitAvailabilitySource.getMegaMekMembershipUnitIds(baseContext);
        }

        const unitIds = new Set<string>();

        if (!hasRarityFilter) {
            if (includesUnknownSource) {
                for (const unitId of this.unitAvailabilitySource.getMegaMekUnknownUnitIds(baseContext)) {
                    unitIds.add(unitId);
                }
            }

            if (selectedPositiveSources.length > 0) {
                const sourceContext = {
                    ...baseContext,
                    availabilityFrom: new Set(selectedPositiveSources),
                };
                for (const unitId of this.unitAvailabilitySource.getMegaMekAvailabilityUnitIds(sourceContext)) {
                    unitIds.add(unitId);
                }
            }

            return hasSourceFilter
                ? unitIds
                : this.unitAvailabilitySource.getMegaMekMembershipUnitIds(baseContext);
        }

        if (!hasSourceFilter) {
            for (const rarityName of availabilityRarityNames) {
                for (const unitId of this.unitAvailabilitySource.getMegaMekRarityUnitIds(rarityName, baseContext)) {
                    unitIds.add(unitId);
                }
            }

            return unitIds;
        }

        if (includesUnknownSource && availabilityRarityNames.includes(MEGAMEK_AVAILABILITY_UNKNOWN)) {
            for (const unitId of this.unitAvailabilitySource.getMegaMekUnknownUnitIds(baseContext)) {
                unitIds.add(unitId);
            }
        }

        if (selectedPositiveSources.length > 0) {
            const sourceContext = {
                ...baseContext,
                availabilityFrom: new Set(selectedPositiveSources),
            };
            for (const rarityName of availabilityRarityNames) {
                if (rarityName === MEGAMEK_AVAILABILITY_UNKNOWN) {
                    continue;
                }

                for (const unitId of this.unitAvailabilitySource.getMegaMekRarityUnitIds(rarityName, sourceContext)) {
                    unitIds.add(unitId);
                }
            }
        }

        return unitIds;
    }

    private buildMegaMekAvailabilityBaseContext(
        scope: AvailabilityFilterScope,
    ): MegaMekAvailabilityFilterContext | null {
        const baseScope: AvailabilityFilterScope = {
            eraNames: scope.eraNames,
            factionNames: scope.factionNames,
            bridgeThroughMulMembership: scope.bridgeThroughMulMembership,
        };
        return this.resolveContext(baseScope);
    }

    private hasMegaMekAvailabilityCandidateUnit(
        contextUnits: readonly UnitSummary[],
        baseContext: MegaMekAvailabilityFilterContext,
        availabilityFromNames: readonly string[],
        availabilityRarityNames: readonly MegaMekAvailabilityRarity[],
    ): boolean {
        const selectedPositiveSources = availabilityFromNames.filter((value): value is MegaMekAvailabilityFrom => (
            value === 'Requisition' || value === 'Salvage'
        ));
        const includesUnknownSource = availabilityFromNames.includes(MEGAMEK_AVAILABILITY_UNKNOWN);
        const hasSourceFilter = availabilityFromNames.length > 0;
        const hasRarityFilter = availabilityRarityNames.length > 0;

        if (!hasSourceFilter && !hasRarityFilter) {
            const membershipUnitIds = this.unitAvailabilitySource.getMegaMekMembershipUnitIds(baseContext);
            return contextUnits.some(unit => membershipUnitIds.has(unit.uuid));
        }

        // Names and scope are resolved once per option, not once per unit.
        const source = this.unitAvailabilitySource;
        const unknownMatcher = () => source.getAvailabilityFromMatcher(MEGAMEK_AVAILABILITY_UNKNOWN, baseContext);
        let matchers: Array<(unit: UnitSummary) => boolean>;
        if (!hasRarityFilter) {
            matchers = [
                ...(includesUnknownSource ? [unknownMatcher()] : []),
                ...selectedPositiveSources.map(name => source.getAvailabilityFromMatcher(name, baseContext)),
            ];
        } else if (!hasSourceFilter) {
            matchers = availabilityRarityNames.map(name => source.getAvailabilityRarityMatcher(name, baseContext));
        } else {
            const sourceContext = { ...baseContext, availabilityFrom: new Set(selectedPositiveSources) };
            matchers = [
                ...(includesUnknownSource && availabilityRarityNames.includes(MEGAMEK_AVAILABILITY_UNKNOWN)
                    ? [unknownMatcher()]
                    : []),
                ...(selectedPositiveSources.length > 0
                    ? availabilityRarityNames
                        .filter(name => name !== MEGAMEK_AVAILABILITY_UNKNOWN)
                        .map(name => source.getAvailabilityRarityMatcher(name, sourceContext))
                    : []),
            ];
        }

        return contextUnits.some(unit => matchers.some(matches => matches(unit)));
    }

    /**
     * The era or faction ids that still have a candidate unit, found in one pass
     * over the units with the candidate rules of getCandidateUnitIds.
     */
    collectAvailableOptionIds(
        contextUnits: readonly UnitSummary[],
        scope: AvailabilityFilterScope,
        target: 'era' | 'faction',
        useAllScopedOptions: boolean,
    ): ReadonlySet<number> {
        const { eraNames = [], factionNames = [], availabilityFromNames = [], availabilityRarityNames = [] } = scope;
        const useMegaMekAvailability = this.unitAvailabilitySource.useMegaMekAvailability();
        const selectedEraIds = target === 'faction'
            ? this.resolveAvailabilityScopeIds(eraNames, 'era')
            : undefined;
        const selectedFactionIds = target === 'era'
            ? this.resolveAvailabilityScopeIds(factionNames, 'faction')
            : undefined;
        const hasSourceFilter = availabilityFromNames.length > 0;
        const hasRarityFilter = availabilityRarityNames.length > 0;

        if (!useMegaMekAvailability && !hasSourceFilter && !hasRarityFilter) {
            return this.collectMulMembershipOptionIds(contextUnits, target, selectedEraIds, selectedFactionIds);
        }

        const selectedSources = availabilityFromNames.filter((value): value is MegaMekAvailabilityFrom => (
            value === 'Requisition' || value === 'Salvage'
        ));
        const activeSources = hasSourceFilter ? selectedSources : MEGAMEK_AVAILABILITY_FROM_OPTIONS;
        const selectedRarities = new Set<string>(availabilityRarityNames.filter((rarity) => (
            rarity !== MEGAMEK_AVAILABILITY_UNKNOWN && rarity !== MEGAMEK_AVAILABILITY_NOT_AVAILABLE
        )));
        const includesUnknownSource = availabilityFromNames.includes(MEGAMEK_AVAILABILITY_UNKNOWN);
        const includesUnknownRarity = availabilityRarityNames.includes(MEGAMEK_AVAILABILITY_UNKNOWN);
        // A scoped option is only ever Unknown through MUL membership that MegaMek has no entry for.
        const matchesUnknown = !useMegaMekAvailability && (hasSourceFilter && hasRarityFilter
            ? includesUnknownSource && includesUnknownRarity
            : includesUnknownSource || includesUnknownRarity);
        const matchesNotAvailable = availabilityRarityNames.includes(MEGAMEK_AVAILABILITY_NOT_AVAILABLE);
        const matchesEachScopedValue = useAllScopedOptions && selectedRarities.size > 0;
        const matchesEntries = activeSources.length > 0
            && (!hasRarityFilter || matchesNotAvailable || selectedRarities.size > 0);
        const tracksMaxScores = !hasRarityFilter || matchesNotAvailable || !matchesEachScopedValue;
        const context: MegaMekAvailabilityFilterContext = { bridgeThroughMulMembership: !useMegaMekAvailability };
        const isInScope = (pair: { eraId: number; factionId: number }): boolean => (
            (!selectedEraIds || selectedEraIds.has(pair.eraId))
            && (!selectedFactionIds || selectedFactionIds.has(pair.factionId))
        );
        const matchesSelectedRarity = (score: number): boolean => (
            selectedRarities.has(getMegaMekAvailabilityRarityForScore(score))
        );
        const availableIds = new Set<number>();

        for (const unit of contextUnits) {
            if (matchesUnknown) {
                for (const pair of this.unitAvailabilitySource.getUnknownMulPairs(unit)) {
                    if (isInScope(pair)) {
                        availableIds.add(target === 'faction' ? pair.factionId : pair.eraId);
                    }
                }
            }

            if (!matchesEntries) {
                continue;
            }

            const maxScoresByOptionId = tracksMaxScores
                ? new Map<number, Record<MegaMekAvailabilityFrom, number>>()
                : null;
            for (const entry of this.unitAvailabilitySource.getMegaMekAvailabilityEntries(unit, context)) {
                if (!isInScope(entry)) {
                    continue;
                }

                const optionId = target === 'faction' ? entry.factionId : entry.eraId;
                let maxScores = maxScoresByOptionId?.get(optionId);
                if (maxScoresByOptionId && !maxScores) {
                    maxScores = { Requisition: 0, Salvage: 0 };
                    maxScoresByOptionId.set(optionId, maxScores);
                }

                for (const source of activeSources) {
                    const score = source === 'Requisition' ? entry.requisition : entry.salvage;
                    if (maxScores && score > maxScores[source]) {
                        maxScores[source] = score;
                    }
                    if (matchesEachScopedValue && matchesSelectedRarity(score)) {
                        availableIds.add(optionId);
                    }
                }
            }

            if (!maxScoresByOptionId) {
                continue;
            }

            for (const [optionId, maxScores] of maxScoresByOptionId) {
                const isAvailable = activeSources.some((source) => maxScores[source] > 0);
                if (!hasRarityFilter
                    ? isAvailable
                    : (matchesNotAvailable && !isAvailable)
                        || (!matchesEachScopedValue && activeSources.some((source) => matchesSelectedRarity(maxScores[source])))) {
                    availableIds.add(optionId);
                }
            }
        }

        return availableIds;
    }

    private resolveAvailabilityScopeIds(
        names: readonly string[],
        kind: 'era' | 'faction',
    ): ReadonlySet<number> | undefined {
        if (names.length === 0) {
            return undefined;
        }

        const ids = new Set(
            names
                .map((name) => kind === 'era'
                    ? this.dataService.getEraByName(name)?.id
                    : this.dataService.getFactionByName(name)?.id)
                .filter((id): id is number => id !== undefined),
        );

        return ids.size > 0 ? ids : new Set<number>();
    }

    private collectMulMembershipOptionIds(
        contextUnits: readonly UnitSummary[],
        target: 'era' | 'faction',
        selectedEraIds?: ReadonlySet<number>,
        selectedFactionIds?: ReadonlySet<number>,
    ): ReadonlySet<number> {
        const availableIds = new Set<number>();
        const unitUuids = contextUnits.map(unit => unit.uuid);
        const index = this.dataService.getMulAvailabilityIndex();
        for (const faction of this.dataService.getFactions()) {
            if (target === 'era' && selectedFactionIds && !selectedFactionIds.has(faction.id)) continue;
            for (const era of this.dataService.getEras()) {
                if (target === 'faction' && selectedEraIds && !selectedEraIds.has(era.id)) continue;
                const members = index.getFactionEraUnitUuids(faction.id, era.id);
                if (unitUuids.some(uuid => members.has(uuid))) {
                    availableIds.add(target === 'era' ? era.id : faction.id);
                }
            }
        }
        return availableIds;
    }

    public unitBelongsToEra(unit: UnitSummary, eraName: string, scope?: AvailabilityFilterScope): boolean {
        const era = this.dataService.getEraByName(eraName);
        if (!era) return false;

        return this.unitBelongsToEraInScope(unit, era, scope);
    }

    public unitBelongsToFaction(unit: UnitSummary, factionName: string, eraNames?: readonly string[]): boolean {
        if (!this.unitAvailabilitySource.useMegaMekAvailability()) {
            if (eraNames !== undefined) {
                return this.dataService.getMulAvailabilityIndex().unitBelongsToNamedFactionEra(unit.uuid, eraNames, [factionName]);
            }

            return this.searchIndex.getIndexedUnitIds('faction', factionName)?.has(unit.uuid) ?? false;
        }

        const faction = this.dataService.getFactionByName(factionName);
        if (!faction) return false;

        if (eraNames !== undefined) {
            if (eraNames.length === 0) {
                return false;
            }

            const contextEraIds = new Set(
                eraNames
                    .map((eraName) => this.dataService.getEraByName(eraName)?.id)
                    .filter((eraId): eraId is number => eraId !== undefined),
            );
            return this.unitAvailabilitySource.unitBelongsToFaction(unit, faction, contextEraIds);
        }

        return this.unitAvailabilitySource.unitBelongsToFaction(unit, faction);
    }

    private unitBelongsToEraInScope(unit: UnitSummary, era: Era, scope?: AvailabilityFilterScope): boolean {
        if (!this.unitAvailabilitySource.useMegaMekAvailability()) {
            if (scope?.factionNames === undefined) {
                return this.searchIndex.getIndexedUnitIds('era', era.name)?.has(unit.uuid) ?? false;
            }

            return this.dataService.getMulAvailabilityIndex().unitBelongsToNamedFactionEra(unit.uuid, [era.name], scope.factionNames);
        }

        if (scope?.factionNames === undefined) {
            return this.unitAvailabilitySource.unitBelongsToEra(unit, era);
        }

        const context = this.resolveContext({
            eraNames: [era.name],
            factionNames: scope.factionNames,
        });
        if (context === null) {
            return false;
        }

        if (!context.factionIds) {
            return this.unitAvailabilitySource.unitBelongsToEra(unit, era);
        }

        return this.unitAvailabilitySource.unitMatchesMegaMekMembership(unit, context);
    }

    private combineResolvedUnitIds(
        resolved: ResolvedDropdownNames,
        getUnitIds: (name: string) => ReadonlySet<string>,
        createBaseUnitIds: () => Set<string>,
    ): ReadonlySet<string> | null {
        if (!hasResolvedDropdownNames(resolved)) {
            return null;
        }

        // A single included name needs no combining: share its set instead of copying it.
        if (resolved.or.length + resolved.and.length === 1 && resolved.not.length === 0) {
            return getUnitIds(resolved.or[0] ?? resolved.and[0]);
        }

        let resultSet: Set<string> | null = null;

        if (resolved.or.length > 0) {
            resultSet = new Set<string>();
            for (const name of resolved.or) {
                for (const unitId of getUnitIds(name)) {
                    resultSet.add(unitId);
                }
            }
        }

        for (const name of resolved.and) {
            const unitIds = getUnitIds(name);
            if (resultSet === null) {
                resultSet = new Set(unitIds);
                continue;
            }

            for (const unitId of resultSet) {
                if (!unitIds.has(unitId)) {
                    resultSet.delete(unitId);
                }
            }
        }

        if (resolved.not.length > 0) {
            if (resultSet === null) {
                resultSet = createBaseUnitIds();
            }

            for (const name of resolved.not) {
                for (const unitId of getUnitIds(name)) {
                    resultSet.delete(unitId);
                }
            }
        }

        return resultSet;
    }

    private getUnitIdsForEraNames(selectedEraNames: string[]): Set<string> | null {
        if (!selectedEraNames || selectedEraNames.length === 0) return null;
        const unitIds = new Set<string>();

        for (const eraName of selectedEraNames) {
            const era = this.dataService.getEraByName(eraName);
            if (era) {
                this.getUnitIdsForEra(era).forEach((id) => unitIds.add(id));
            }
        }
        return unitIds;
    }

    private getUnitIdsForSelectedEras(resolvedEras: ResolvedDropdownNames): ReadonlySet<string> | null {
        return this.combineResolvedUnitIds(
            resolvedEras,
            (eraName) => {
                const era = this.dataService.getEraByName(eraName);
                return era
                    ? this.getUnitIdsForEra(era)
                    : new Set<string>();
            },
            () => this.getAllUnitIdsInContext(),
        );
    }

    // Shared read-only memberships: the availability source's own getters hand out caller-owned copies.
    private getUnitIdsForEra(era: Era): ReadonlySet<string> {
        return this.unitAvailabilitySource.useMegaMekAvailability()
            ? this.unitAvailabilitySource.getMegaMekMembershipUnitIds({ eraIds: new Set([era.id]) })
            : this.dataService.getMulAvailabilityIndex().getEraUnitUuids(era.id);
    }

    private getUnitIdsForFaction(factionName: string, contextEraIds?: Set<number>): ReadonlySet<string> {
        const faction = this.dataService.getFactionByName(factionName);
        if (!faction) {
            return new Set<string>();
        }

        return this.unitAvailabilitySource.useMegaMekAvailability()
            ? this.unitAvailabilitySource.getMegaMekMembershipUnitIds({
                ...(contextEraIds ? { eraIds: contextEraIds } : {}),
                factionIds: new Set([faction.id]),
            })
            : this.dataService.getMulAvailabilityIndex().getFactionUnitUuids(faction.id, contextEraIds);
    }

    getIndexedUnitIds(
        filterKey: string,
        value: string,
        scope: AvailabilityFilterScope | undefined, useAllScopedOptions: boolean,
    ): ReadonlySet<UnitUuid> | undefined {
        if (!this.unitAvailabilitySource.useMegaMekAvailability()) {
            if (filterKey === 'era' && scope?.factionNames !== undefined) {
                return this.searchIndex.getFactionEraUnitUuids([value], scope.factionNames);
            }

            if (filterKey === 'faction' && scope?.eraNames !== undefined) {
                const faction = this.dataService.getFactionByName(value);
                if (!faction) {
                    return undefined;
                }

                return this.searchIndex.getFactionEraUnitUuids(scope.eraNames, [faction.name]);
            }

            return this.searchIndex.getIndexedUnitIds(filterKey, value);
        }

        if (filterKey === 'era') {
            const era = this.dataService.getEraByName(value);
            if (!era) {
                return undefined;
            }

            if (scope?.factionNames === undefined) {
                return this.unitAvailabilitySource.getMegaMekMembershipUnitIds({ eraIds: new Set([era.id]) });
            }

            const context = this.resolveContext({
                eraNames: [era.name],
                factionNames: scope.factionNames,
            });
            const availabilityKeys = context === null
                ? new Set<UnitUuid>()
                : this.unitAvailabilitySource.getMegaMekMembershipUnitIds(context);
            return availabilityKeys;
        }

        if (filterKey === 'faction') {
            const faction = this.dataService.getFactionByName(value);
            if (!faction) {
                return undefined;
            }

            if (scope?.eraNames === undefined) {
                return this.unitAvailabilitySource.getMegaMekMembershipUnitIds({ factionIds: new Set([faction.id]) });
            }

            const contextEraIds = new Set(
                scope.eraNames
                    .map((eraName) => this.dataService.getEraByName(eraName)?.id)
                    .filter((eraId): eraId is number => eraId !== undefined),
            );
            const availabilityKeys = contextEraIds.size === 0
                ? new Set<UnitUuid>()
                : this.unitAvailabilitySource.getMegaMekMembershipUnitIds({
                    factionIds: new Set([faction.id]), eraIds: contextEraIds,
                });
            return availabilityKeys;
        }

        if (filterKey === 'availabilityFrom') {
            const context = this.resolveContext(scope, useAllScopedOptions);
            if (context === null) {
                return new Set<UnitUuid>();
            }

            if (value === MEGAMEK_AVAILABILITY_UNKNOWN) {
                return this.unitAvailabilitySource.getMegaMekUnknownUnitIds(context);
            }

            return this.unitAvailabilitySource.getMegaMekAvailabilityUnitIds({
                ...context,
                availabilityFrom: new Set([value as MegaMekAvailabilityFrom]),
            });
        }

        if (filterKey === 'availabilityRarity') {
            const context = this.resolveContext(scope, useAllScopedOptions);
            if (context === null) {
                return new Set<UnitUuid>();
            }

            const availabilityKeys = value === MEGAMEK_AVAILABILITY_UNKNOWN
                ? this.unitAvailabilitySource.getMegaMekUnknownUnitIds(context)
                : this.unitAvailabilitySource.getMegaMekRarityUnitIds(value as MegaMekAvailabilityRarity, context);
            return availabilityKeys;
        }

        return this.searchIndex.getIndexedUnitIds(filterKey, value);
    }

    getIndexedFilterValues(filterKey: string): readonly string[] {
        if (!this.unitAvailabilitySource.useMegaMekAvailability()) {
            return this.searchIndex.getIndexedFilterValues(filterKey);
        }

        if (filterKey === 'era') {
            return this.dataService.getEras().map((era) => era.name);
        }

        if (filterKey === 'faction') {
            return this.dataService.getFactions().map((faction) => faction.name);
        }

        if (filterKey === 'availabilityFrom') {
            return [...MEGAMEK_AVAILABILITY_FROM_FILTER_OPTIONS];
        }

        if (filterKey === 'availabilityRarity') {
            return [...MEGAMEK_AVAILABILITY_ALL_RARITY_OPTIONS];
        }

        return this.searchIndex.getIndexedFilterValues(filterKey);
    }

    private getAllUnitIdsInContext(contextEraIds?: Set<number>): Set<string> {
        const units = this.dataService.isDataReady() ? this.dataService.getUnits() : [];
        if (!contextEraIds || contextEraIds.size === 0) {
            if (this.unitAvailabilitySource.useMegaMekAvailability()) {
                return new Set(
                    units
                        .filter(unit => this.unitAvailabilitySource.unitHasMegaMekAvailability(unit))
                        .map(unit => this.unitAvailabilitySource.getUnitAvailabilityKey(unit)),
                );
            }

            return new Set(units.map(unit => this.unitAvailabilitySource.getUnitAvailabilityKey(unit)));
        }

        // Era filter is present. We can reuse the logic from getUnitIdsForSelectedEras
        const contextEraNames = this.dataService.getEras()
            .filter(e => contextEraIds.has(e.id))
            .map(e => e.name);

        return this.getUnitIdsForEraNames(contextEraNames) || new Set<string>();
    }

    private getUnitIdsForSelectedFactions(resolved: ResolvedDropdownNames, contextEraNames?: string[]): ReadonlySet<string> | null {
        const contextEraIds = contextEraNames && contextEraNames.length > 0
            ? new Set(contextEraNames
                .map(name => this.dataService.getEraByName(name)?.id)
                .filter((id): id is number => id !== undefined))
            : undefined;
        return this.combineResolvedUnitIds(
            resolved,
            name => this.getUnitIdsForFaction(name, contextEraIds),
            () => this.getAllUnitIdsInContext(contextEraIds),
        );
    }

    getUnitIdsForSelection(
        resolvedEras: ResolvedDropdownNames,
        resolvedFactions: ResolvedDropdownNames,
    ): ReadonlySet<string> | null {
        const hasEraFilter = hasResolvedDropdownNames(resolvedEras);
        const hasFactionFilter = hasResolvedDropdownNames(resolvedFactions);

        if (!hasEraFilter) {
            if (!hasFactionFilter) {
                return null;
            }

            return this.getUnitIdsForSelectedFactions(resolvedFactions);
        }

        if (!hasFactionFilter) {
            return this.getUnitIdsForSelectedEras(resolvedEras);
        }

        const positiveEraNames = [...resolvedEras.or, ...resolvedEras.and];
        const relevantEraNames = positiveEraNames.length > 0
            ? Array.from(new Set([...positiveEraNames, ...resolvedEras.not]))
            : this.dataService.getEras().map((era) => era.name);
        const perEraFactionUnitIds = new Map<string, ReadonlySet<string>>();

        for (const eraName of relevantEraNames) {
            perEraFactionUnitIds.set(
                eraName,
                this.getUnitIdsForSelectedFactions(resolvedFactions, [eraName]) ?? new Set<string>(),
            );
        }

        return this.combineResolvedUnitIds(
            resolvedEras,
            (eraName) => perEraFactionUnitIds.get(eraName) ?? new Set<string>(),
            () => {
                const unitIds = new Set<string>();
                for (const ids of perEraFactionUnitIds.values()) {
                    for (const unitId of ids) {
                        unitIds.add(unitId);
                    }
                }
                return unitIds;
            },
        );
    }

    getFacetOptions(
        kind: 'availabilityFrom' | 'availabilityRarity',
        contextUnits: readonly UnitSummary[],
        scope: AvailabilityFilterScope,
    ): { name: string; available: boolean }[] {
        const availabilityFromNames = scope.availabilityFromNames ?? [];
        const availabilityRarityNames = (scope.availabilityRarityNames ?? []) as readonly MegaMekAvailabilityRarity[];
        const baseContext = this.buildMegaMekAvailabilityBaseContext(scope);
        if (baseContext === null) {
            return kind === 'availabilityFrom'
                ? MEGAMEK_AVAILABILITY_FROM_FILTER_OPTIONS.map((availabilityFromName) => ({ name: availabilityFromName, available: false }))
                : MEGAMEK_AVAILABILITY_ALL_RARITY_OPTIONS.map((rarityName) => ({ name: rarityName, available: false }));
        }

        if (kind === 'availabilityFrom') {
            return MEGAMEK_AVAILABILITY_FROM_FILTER_OPTIONS.map((availabilityFromName) => ({
                name: availabilityFromName,
                available: this.hasMegaMekAvailabilityCandidateUnit(
                    contextUnits,
                    baseContext,
                    [availabilityFromName],
                    availabilityRarityNames,
                ),
            }));
        }

        return MEGAMEK_AVAILABILITY_ALL_RARITY_OPTIONS.map((rarityName) => ({
            name: rarityName,
            available: this.hasMegaMekAvailabilityCandidateUnit(
                contextUnits,
                baseContext,
                availabilityFromNames,
                [rarityName],
            ),
        }));
    }

    getBadges(unit: UnitSummary, selectionScope: AvailabilityFilterScope, useAllScopedOptions: boolean): readonly MegaMekUnitAvailabilityDetail[] {
        const baseScope = {
            eraNames: selectionScope.eraNames,
            factionNames: selectionScope.factionNames,
            bridgeThroughMulMembership: selectionScope.bridgeThroughMulMembership,
        };
        const baseContext = this.resolveContext(baseScope);
        if (baseContext === null) {
            return [];
        }

        const selectedAvailabilityFromNames = selectionScope.availabilityFromNames ?? [];
        const selectedAvailabilityRarityNames = (selectionScope.availabilityRarityNames ?? []) as readonly MegaMekAvailabilityRarity[];
        const selectedPositiveSources = selectedAvailabilityFromNames.filter((value): value is MegaMekAvailabilityFrom => (
            value === 'Requisition' || value === 'Salvage'
        ));
        const selectedPositiveRarities = new Set(
            selectedAvailabilityRarityNames.filter((rarity): rarity is Exclude<MegaMekAvailabilityRarity, typeof MEGAMEK_AVAILABILITY_UNKNOWN | typeof MEGAMEK_AVAILABILITY_NOT_AVAILABLE> => (
                rarity !== MEGAMEK_AVAILABILITY_UNKNOWN && rarity !== MEGAMEK_AVAILABILITY_NOT_AVAILABLE
            )),
        );
        const includesUnknownSelection = selectedAvailabilityFromNames.includes(MEGAMEK_AVAILABILITY_UNKNOWN)
            || selectedAvailabilityRarityNames.includes(MEGAMEK_AVAILABILITY_UNKNOWN);
        const badges: MegaMekUnitAvailabilityDetail[] = [];
        const activeSources = selectedPositiveSources.length > 0
            ? selectedPositiveSources
            : selectedAvailabilityFromNames.length === 0
                ? MEGAMEK_AVAILABILITY_FROM_OPTIONS
                : [];

        for (const source of activeSources) {
            const context = this.resolveContext({
                ...(baseScope ?? {}),
                availabilityFromNames: [source],
                ...(useAllScopedOptions && selectedPositiveRarities.size > 0
                    ? { availabilityRarityNames: [...selectedPositiveRarities] }
                    : {}),
            }, useAllScopedOptions);
            const score = context === null ? 0 : this.unitAvailabilitySource.getMegaMekAvailabilityScore(unit, context);
            if (score <= 0) {
                continue;
            }

            const rarity = getMegaMekAvailabilityRarityForScore(score);
            if (rarity === MEGAMEK_AVAILABILITY_NOT_AVAILABLE) {
                continue;
            }

            if (selectedAvailabilityRarityNames.length > 0 && !selectedPositiveRarities.has(rarity)) {
                continue;
            }

            badges.push({
                source,
                score,
                rarity,
            });
        }

        if (
            this.unitAvailabilitySource.unitMatchesAvailabilityFrom(unit, MEGAMEK_AVAILABILITY_UNKNOWN, baseContext)
            && (includesUnknownSelection || badges.length === 0)
        ) {
            badges.unshift({
                source: MEGAMEK_AVAILABILITY_UNKNOWN,
                score: -1,
                rarity: MEGAMEK_AVAILABILITY_UNKNOWN,
            });
        }

        return badges;
    }
}
