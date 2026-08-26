// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable } from '@angular/core';
import type { UnitSummary, UnitComponent } from '../models/unit-summary.model';
import { type Faction } from '../models/factions.model';
import type { Era } from '../models/eras.model';
import type { BucketStatSummary, MinMaxStatsRange, UnitSubtypeMaxStats } from './data.service';
import { removeAccents } from '../utils/string.util';
import { naturalCompare } from '../utils/sort.util';
import { getMergedTags, getUnitSearchIdentityKey, getUnitSourceFilterValues } from '../utils/unit-search-shared.util';
import { calculateWeightedMaxRange, getMaxRangeFromComponents } from '../utils/unit-range.util';
import { parseASDamageValue } from '../utils/as-damage.util';
import { AS_MOVEMENT_MODE_DISPLAY_NAMES, BOOLEAN_FILTERS, getBooleanFilterUnitValue } from './unit-search-filters.model';
import type { UnitSearchWorkerFactionEraSnapshot, UnitSearchWorkerIndexSnapshot } from '../utils/unit-search-worker-protocol.util';
import { MULFACTION_EXTINCT } from '../models/mulfactions.model';
import { WeaponEquipment } from '../models/equipment.model';
import { WEAPON_TYPES, type WeaponType } from '../models/weapon-types.model';
import type { EquipmentRegistry } from '../models/equipment-lookup';

interface ASUnitTypeMaxStats {
    [asUnitType: string]: MinMaxStatsRange;
}

/**
 * Fully built search state for one exact Units/dependency activation.
 *
 * All maps and statistics are allocated while the activation is still
 * invisible. The final catalog switch only assigns these references, so a
 * failed or superseded build cannot expose a partially rebuilt index.
 */
export interface PreparedUnitSearchIndexes {
    readonly unitSubtypeMaxStats: UnitSubtypeMaxStats;
    readonly unitAsTypeMaxStats: ASUnitTypeMaxStats;
    readonly searchFilterIndex: Map<string, Map<string, Set<string>>>;
    readonly componentCountIndex: Map<string, Map<string, number>>;
    readonly searchFilterValues: Map<string, string[]>;
    readonly dropdownOptionUniverse: Map<string, Array<{ name: string; img?: string }>>;
    readonly unitIdentityKeysByName: Map<string, readonly string[]>;
    readonly factionEraSnapshot: UnitSearchWorkerFactionEraSnapshot;
    readonly preparationTimings: {
        readonly unitDerivativesMs: number;
        readonly filterIndexesMs: number;
        readonly identityMapMs: number;
        readonly unitFiltersMs: number;
        readonly componentIndexesMs: number;
        readonly eraMembershipsMs: number;
        readonly factionMembershipsMs: number;
        readonly finalizationMs: number;
    };
    readonly indexStats: {
        readonly filterKeys: number;
        readonly filterValues: number;
        readonly memberships: number;
    };
}

interface TrackedStatAccumulator {
    min: number;
    max: number;
    total: number;
    count: number;
}

function createBucketStatSummary(min = 0, max = 0, average = 0): BucketStatSummary {
    return { min, max, average };
}

function createTrackedStatAccumulator(): TrackedStatAccumulator {
    return {
        min: Infinity,
        max: -Infinity,
        total: 0,
        count: 0,
    };
}

function updateTrackedStat(stat: TrackedStatAccumulator, value: number): void {
    if (value < stat.min) {
        stat.min = value;
    }

    if (value > stat.max) {
        stat.max = value;
    }

    stat.total += value;
    stat.count += 1;
}

function normalizeTrackedStat(stat: TrackedStatAccumulator): BucketStatSummary {
    if (stat.count === 0) {
        return createBucketStatSummary();
    }

    return createBucketStatSummary(
        stat.min === Infinity ? 0 : stat.min,
        stat.max === -Infinity ? 0 : Math.max(stat.max, 0),
        stat.total / stat.count,
    );
}

function createEmptyMinMaxStatsRange(): MinMaxStatsRange {
    return {
        armor: createBucketStatSummary(),
        internal: createBucketStatSummary(),
        heat: createBucketStatSummary(),
        dissipation: createBucketStatSummary(),
        dissipationEfficiency: createBucketStatSummary(),
        runMP: createBucketStatSummary(),
        run2MP: createBucketStatSummary(),
        umuMP: createBucketStatSummary(),
        jumpMP: createBucketStatSummary(),
        alphaNoPhysical: createBucketStatSummary(),
        alphaNoPhysicalNoOneshots: createBucketStatSummary(),
        maxRange: createBucketStatSummary(),
        weightedMaxRange: createBucketStatSummary(),
        dpt: createBucketStatSummary(),
        asTmm: createBucketStatSummary(),
        asArm: createBucketStatSummary(),
        asStr: createBucketStatSummary(),
        asDmgS: createBucketStatSummary(),
        asDmgM: createBucketStatSummary(),
        asDmgL: createBucketStatSummary(),
        dropshipCapacity: createBucketStatSummary(),
        escapePods: createBucketStatSummary(),
        lifeBoats: createBucketStatSummary(),
        gravDecks: createBucketStatSummary(),
        sailIntegrity: createBucketStatSummary(),
        kfIntegrity: createBucketStatSummary(),
    };
}

@Injectable({
    providedIn: 'root'
})
export class UnitSearchIndexService {
    private unitSubtypeMaxStats: UnitSubtypeMaxStats = {};
    private unitAsTypeMaxStats: ASUnitTypeMaxStats = {};
    private searchFilterIndex = new Map<string, Map<string, Set<string>>>();
    private componentCountIndex = new Map<string, Map<string, number>>();
    private searchFilterValues = new Map<string, string[]>();
    private dropdownOptionUniverse = new Map<string, Array<{ name: string; img?: string }>>();
    private unitIdentityKeysByName = new Map<string, readonly string[]>();
    private indexStats: PreparedUnitSearchIndexes['indexStats'] = Object.freeze({
        filterKeys: 0,
        filterValues: 0,
        memberships: 0,
    });
    private filterIndexTimings: Pick<
        PreparedUnitSearchIndexes['preparationTimings'],
        'identityMapMs' | 'unitFiltersMs' | 'componentIndexesMs' | 'eraMembershipsMs' | 'factionMembershipsMs' | 'finalizationMs'
    > = Object.freeze({
        identityMapMs: 0,
        unitFiltersMs: 0,
        componentIndexesMs: 0,
        eraMembershipsMs: 0,
        factionMembershipsMs: 0,
        finalizationMs: 0,
    });
    private factionEraSnapshot: UnitSearchWorkerFactionEraSnapshot = Object.freeze({
        unitIdentityKeysByMulId: Object.freeze({}),
        referenceIdsByEraAndFaction: Object.freeze({}),
    });
    /**
     * Pure-build every search/index derivative without touching live state.
     * A detached service instance is safe here because this builder has no
     * injected collaborators; its only inputs are the exact candidate arrays.
     */
    public prepareCatalogIndexes(
        units: UnitSummary[],
        eras: Era[],
        factions: Faction[],
        extinctFaction?: Faction,
        equipmentRegistry?: EquipmentRegistry,
    ): PreparedUnitSearchIndexes {
        const builder = new UnitSearchIndexService();
        const unitDerivativesStartedAt = Date.now();
        builder.prepareUnits(units);
        const unitDerivativesMs = Math.max(0, Date.now() - unitDerivativesStartedAt);
        const filterIndexesStartedAt = Date.now();
        builder.rebuildIndexes(
            units,
            eras,
            factions,
            extinctFaction,
            equipmentRegistry,
        );
        const filterIndexesMs = Math.max(0, Date.now() - filterIndexesStartedAt);
        const prepared = builder.capturePreparedIndexes({
            unitDerivativesMs,
            filterIndexesMs,
            ...builder.filterIndexTimings,
        });
        return prepared;
    }

    /** Final no-build switch. Angular observers cannot interleave the assignments. */
    public commitPreparedCatalogIndexes(candidate: PreparedUnitSearchIndexes): void {
        this.unitSubtypeMaxStats = candidate.unitSubtypeMaxStats;
        this.unitAsTypeMaxStats = candidate.unitAsTypeMaxStats;
        this.searchFilterIndex = candidate.searchFilterIndex;
        this.componentCountIndex = candidate.componentCountIndex;
        this.searchFilterValues = candidate.searchFilterValues;
        this.dropdownOptionUniverse = candidate.dropdownOptionUniverse;
        this.unitIdentityKeysByName = candidate.unitIdentityKeysByName;
        this.factionEraSnapshot = candidate.factionEraSnapshot;
    }

    private capturePreparedIndexes(
        preparationTimings: PreparedUnitSearchIndexes['preparationTimings'],
    ): PreparedUnitSearchIndexes {
        return Object.freeze({
            unitSubtypeMaxStats: this.unitSubtypeMaxStats,
            unitAsTypeMaxStats: this.unitAsTypeMaxStats,
            searchFilterIndex: this.searchFilterIndex,
            componentCountIndex: this.componentCountIndex,
            searchFilterValues: this.searchFilterValues,
            dropdownOptionUniverse: this.dropdownOptionUniverse,
            unitIdentityKeysByName: this.unitIdentityKeysByName,
            factionEraSnapshot: this.factionEraSnapshot,
            preparationTimings: Object.freeze(preparationTimings),
            indexStats: this.indexStats,
        });
    }

    public prepareUnits(units: UnitSummary[]): void {
        this.unitSubtypeMaxStats = {};
        this.unitAsTypeMaxStats = {};

        const createStatsAccumulator = () => ({
            armor: createTrackedStatAccumulator(),
            internal: createTrackedStatAccumulator(),
            heat: createTrackedStatAccumulator(),
            dissipation: createTrackedStatAccumulator(),
            dissipationEfficiency: createTrackedStatAccumulator(),
            runMP: createTrackedStatAccumulator(),
            run2MP: createTrackedStatAccumulator(),
            jumpMP: createTrackedStatAccumulator(),
            umuMP: createTrackedStatAccumulator(),
            alphaNoPhysical: createTrackedStatAccumulator(),
            alphaNoPhysicalNoOneshots: createTrackedStatAccumulator(),
            maxRange: createTrackedStatAccumulator(),
            weightedMaxRange: createTrackedStatAccumulator(),
            dpt: createTrackedStatAccumulator(),
            asTmm: createTrackedStatAccumulator(),
            asArm: createTrackedStatAccumulator(),
            asStr: createTrackedStatAccumulator(),
            asDmgS: createTrackedStatAccumulator(),
            asDmgM: createTrackedStatAccumulator(),
            asDmgL: createTrackedStatAccumulator(),
            dropshipCapacity: createTrackedStatAccumulator(),
            escapePods: createTrackedStatAccumulator(),
            lifeBoats: createTrackedStatAccumulator(),
            sailIntegrity: createTrackedStatAccumulator(),
            kfIntegrity: createTrackedStatAccumulator(),
            gravDecks: createTrackedStatAccumulator(),
        });

        const updateTrackedStats = (stats: ReturnType<typeof createStatsAccumulator>, unit: UnitSummary): void => {
            updateTrackedStat(stats.armor, unit.armor || 0);
            updateTrackedStat(stats.internal, unit.internal || 0);
            updateTrackedStat(stats.heat, unit.heat || 0);
            updateTrackedStat(stats.dissipation, unit.dissipation || 0);
            updateTrackedStat(stats.dissipationEfficiency, unit._dissipationEfficiency || 0);
            updateTrackedStat(stats.runMP, unit.run || 0);
            updateTrackedStat(stats.run2MP, unit.run2 || 0);
            updateTrackedStat(stats.jumpMP, unit.jump || 0);
            updateTrackedStat(stats.umuMP, unit.umu || 0);
            updateTrackedStat(stats.alphaNoPhysical, unit._mdSumNoPhysical || 0);
            updateTrackedStat(stats.alphaNoPhysicalNoOneshots, unit._mdSumNoPhysicalNoOneshots || 0);
            updateTrackedStat(stats.maxRange, unit._maxRange || 0);
            updateTrackedStat(stats.weightedMaxRange, unit._weightedMaxRange || 0);
            updateTrackedStat(stats.dpt, unit.dpt || 0);
            updateTrackedStat(stats.asTmm, unit.as?.TMM || 0);
            updateTrackedStat(stats.asArm, unit.as?.Arm || 0);
            updateTrackedStat(stats.asStr, unit.as?.Str || 0);
            updateTrackedStat(stats.asDmgS, parseASDamageValue(unit.as?.dmg.dmgS) ?? 0);
            updateTrackedStat(stats.asDmgM, parseASDamageValue(unit.as?.dmg.dmgM) ?? 0);
            updateTrackedStat(stats.asDmgL, parseASDamageValue(unit.as?.dmg.dmgL) ?? 0);

            if (unit.capital) {
                updateTrackedStat(stats.dropshipCapacity, unit.capital.dropshipCapacity || 0);
                updateTrackedStat(stats.escapePods, unit.capital.escapePods || 0);
                updateTrackedStat(stats.lifeBoats, unit.capital.lifeBoats || 0);
                updateTrackedStat(stats.sailIntegrity, unit.capital.sailIntegrity || 0);
                updateTrackedStat(stats.kfIntegrity, unit.capital.kfIntegrity || 0);
                updateTrackedStat(stats.gravDecks, unit.capital.gravDecks?.length || 0);
            }
        };

        const toNormalizedStats = (stats: ReturnType<typeof createStatsAccumulator>): MinMaxStatsRange => ({
            armor: normalizeTrackedStat(stats.armor),
            internal: normalizeTrackedStat(stats.internal),
            heat: normalizeTrackedStat(stats.heat),
            dissipation: normalizeTrackedStat(stats.dissipation),
            dissipationEfficiency: normalizeTrackedStat(stats.dissipationEfficiency),
            runMP: normalizeTrackedStat(stats.runMP),
            run2MP: normalizeTrackedStat(stats.run2MP),
            jumpMP: normalizeTrackedStat(stats.jumpMP),
            umuMP: normalizeTrackedStat(stats.umuMP),
            alphaNoPhysical: normalizeTrackedStat(stats.alphaNoPhysical),
            alphaNoPhysicalNoOneshots: normalizeTrackedStat(stats.alphaNoPhysicalNoOneshots),
            maxRange: normalizeTrackedStat(stats.maxRange),
            weightedMaxRange: normalizeTrackedStat(stats.weightedMaxRange),
            dpt: normalizeTrackedStat(stats.dpt),
            asTmm: normalizeTrackedStat(stats.asTmm),
            asArm: normalizeTrackedStat(stats.asArm),
            asStr: normalizeTrackedStat(stats.asStr),
            asDmgS: normalizeTrackedStat(stats.asDmgS),
            asDmgM: normalizeTrackedStat(stats.asDmgM),
            asDmgL: normalizeTrackedStat(stats.asDmgL),
            dropshipCapacity: normalizeTrackedStat(stats.dropshipCapacity),
            escapePods: normalizeTrackedStat(stats.escapePods),
            lifeBoats: normalizeTrackedStat(stats.lifeBoats),
            sailIntegrity: normalizeTrackedStat(stats.sailIntegrity),
            kfIntegrity: normalizeTrackedStat(stats.kfIntegrity),
            gravDecks: normalizeTrackedStat(stats.gravDecks),
        });

        const statsBySubtype: { [subtype: string]: ReturnType<typeof createStatsAccumulator> } = {};
        const statsByAsType: { [asUnitType: string]: ReturnType<typeof createStatsAccumulator> } = {};

        for (const unit of units) {
            const chassis = removeAccents(unit.chassis?.toLowerCase() || '');
            const model = removeAccents(unit.model?.toLowerCase() || '');
            unit._searchKey = `${chassis} ${model}`;
            unit._searchKeyAlphanumeric = unit._searchKey.replace(/[^a-z0-9]/g, '');
            unit._displayType = this.formatUnitType(unit.type);
            unit._mdSumNoPhysical = unit.comp ? this.sumWeaponDamageNoPhysical(unit, unit.comp) : 0;
            unit._mdSumNoPhysicalNoOneshots = unit.comp ? this.sumWeaponDamageNoPhysical(unit, unit.comp, true) : 0;
            unit._maxRange = unit.comp ? getMaxRangeFromComponents(unit.comp) : 0;
            unit._weightedMaxRange = unit.comp ? calculateWeightedMaxRange(unit) : 0;
            unit._dissipationEfficiency = (unit.heat && unit.dissipation) ? unit.dissipation - unit.heat : 0;

            if (unit.as) {
                unit.as.dmg._dmgS = parseASDamageValue(unit.as.dmg.dmgS) ?? 0;
                unit.as.dmg._dmgM = parseASDamageValue(unit.as.dmg.dmgM) ?? 0;
                unit.as.dmg._dmgL = parseASDamageValue(unit.as.dmg.dmgL) ?? 0;
                unit.as.dmg._dmgE = parseASDamageValue(unit.as.dmg.dmgE) ?? 0;
                if (unit.as.MVm['j'] !== undefined && unit.as.MVm[''] === undefined) {
                    const mvmKeys = Object.keys(unit.as.MVm);
                    if (unit.as.TP === 'BM' || (mvmKeys.length === 1 && mvmKeys[0] === 'j')) {
                        unit.as.MVm = { '': unit.as.MVm['j'], ...unit.as.MVm };
                    }
                }
            }

            const subtype = unit.subtype;
            statsBySubtype[subtype] ??= createStatsAccumulator();
            updateTrackedStats(statsBySubtype[subtype], unit);

            const asUnitType = unit.as?.TP;
            if (asUnitType) {
                statsByAsType[asUnitType] ??= createStatsAccumulator();
                updateTrackedStats(statsByAsType[asUnitType], unit);
            }
        }

        for (const [subtype, stats] of Object.entries(statsBySubtype)) {
            this.unitSubtypeMaxStats[subtype] = toNormalizedStats(stats);
        }

        for (const [asUnitType, stats] of Object.entries(statsByAsType)) {
            this.unitAsTypeMaxStats[asUnitType] = toNormalizedStats(stats);
        }
    }

    public rebuildIndexes(
        units: UnitSummary[],
        eras: Era[],
        factions: Faction[],
        extinctFaction?: Faction,
        equipmentRegistry?: EquipmentRegistry,
    ): void {
        this.searchFilterIndex = new Map<string, Map<string, Set<string>>>();
        this.componentCountIndex = new Map<string, Map<string, number>>();
        this.searchFilterValues = new Map<string, string[]>();
        const identityMapStartedAt = Date.now();
        const {
            identityKeys,
            unitIdentityKeysByMulId,
            unitIdentityKeysByName,
        } = this.createUnitIdentityIndexes(units);
        const identityMapMs = Math.max(0, Date.now() - identityMapStartedAt);

        const unitFiltersStartedAt = Date.now();
        for (let unitIndex = 0; unitIndex < units.length; unitIndex++) {
            const unit = units[unitIndex];
            const unitIdentityKey = identityKeys[unitIndex];
            this.addSearchIndexValue('type', unit.type, unitIdentityKey);
            this.addSearchIndexValue('subtype', unit.subtype, unitIdentityKey);
            this.addSearchIndexValue('_techBaseDisplay', unit._techBaseDisplay, unitIdentityKey);
            this.addSearchIndexValue('role', unit.role, unitIdentityKey);
            this.addSearchIndexValue('weightClass', unit.weightClass, unitIdentityKey);
            this.addSearchIndexValue('level', String(unit.level), unitIdentityKey);
            this.addSearchIndexValue('c3', unit.c3, unitIdentityKey);
            this.addSearchIndexValue('moveType', unit.moveType, unitIdentityKey);
            this.addSearchIndexValue('as.TP', unit.as?.TP, unitIdentityKey);
            this.addSearchIndexValues('as.specials', unit.as?.specials ?? [], unitIdentityKey);
            this.addSearchIndexValues('as._motive', this.getASMotiveDisplayNames(unit), unitIdentityKey);
            this.addSearchIndexValues('source', getUnitSourceFilterValues(unit), unitIdentityKey);
            this.addSearchIndexValues('features', unit.features ?? [], unitIdentityKey);
            this.addSearchIndexValues('quirks', unit.quirks ?? [], unitIdentityKey);
            this.addSearchIndexValues('_tags', getMergedTags(unit), unitIdentityKey);
            for (const filter of BOOLEAN_FILTERS) {
                this.addSearchIndexValue(filter.key, getBooleanFilterUnitValue(filter, unit[filter.key as keyof UnitSummary]) ? 'yes' : 'no', unitIdentityKey);
            }
        }
        const unitFiltersMs = Math.max(0, Date.now() - unitFiltersStartedAt);

        const componentIndexesStartedAt = Date.now();
        for (let unitIndex = 0; unitIndex < units.length; unitIndex++) {
            this.prepareUnitComponentIndexes(units[unitIndex], identityKeys[unitIndex], equipmentRegistry);
        }
        const componentIndexesMs = Math.max(0, Date.now() - componentIndexesStartedAt);

        const eraMembershipsStartedAt = Date.now();
        for (const era of eras) {
            const extinctReferenceIdsForEra = extinctFaction?.id === MULFACTION_EXTINCT
                ? extinctFaction.eras[era.id] as Set<number> | undefined
                : undefined;
            for (const referenceId of era.units as Set<number>) {
                if (!extinctReferenceIdsForEra?.has(referenceId)) {
                    for (const unitIdentityKey of unitIdentityKeysByMulId.get(referenceId) ?? []) {
                        this.addSearchIndexValue('era', era.name, unitIdentityKey);
                    }
                }
            }
        }
        const eraMembershipsMs = Math.max(0, Date.now() - eraMembershipsStartedAt);

        const factionMembershipsStartedAt = Date.now();
        for (const faction of factions) {
            for (const referenceIds of Object.values(faction.eras) as Set<number>[]) {
                for (const referenceId of referenceIds) {
                    for (const unitIdentityKey of unitIdentityKeysByMulId.get(referenceId) ?? []) {
                        this.addSearchIndexValue('faction', faction.name, unitIdentityKey);
                    }
                }
            }
        }
        const factionMembershipsMs = Math.max(0, Date.now() - factionMembershipsStartedAt);

        const finalizationStartedAt = Date.now();
        let filterValues = 0;
        let memberships = 0;
        for (const [filterKey, values] of this.searchFilterIndex.entries()) {
            filterValues += values.size;
            for (const identityKeys of values.values()) {
                memberships += identityKeys.size;
            }
            this.searchFilterValues.set(filterKey, Array.from(values.keys()).sort((left, right) => naturalCompare(left, right)));
        }
        this.indexStats = Object.freeze({
            filterKeys: this.searchFilterIndex.size,
            filterValues,
            memberships,
        });

        this.rebuildDropdownOptionUniverse(eras, factions);
        this.unitIdentityKeysByName = unitIdentityKeysByName;
        this.factionEraSnapshot = this.createFactionEraSnapshot(unitIdentityKeysByMulId, eras, factions);
        const finalizationMs = Math.max(0, Date.now() - finalizationStartedAt);
        this.filterIndexTimings = Object.freeze({
            identityMapMs,
            unitFiltersMs,
            componentIndexesMs,
            eraMembershipsMs,
            factionMembershipsMs,
            finalizationMs,
        });
    }

    public rebuildTagSearchIndex(units: UnitSummary[]): void {
        if (this.searchFilterIndex.size === 0 && this.searchFilterValues.size === 0) {
            return;
        }

        const tagIndex = new Map<string, Set<string>>();
        for (const unit of units) {
            for (const tag of getMergedTags(unit)) {
                let unitIds = tagIndex.get(tag);
                if (!unitIds) {
                    unitIds = new Set<string>();
                    tagIndex.set(tag, unitIds);
                }
                unitIds.add(getUnitSearchIdentityKey(unit));
            }
        }

        if (tagIndex.size > 0) {
            this.searchFilterIndex.set('_tags', tagIndex);
            const values = Array.from(tagIndex.keys()).sort((left, right) => naturalCompare(left, right));
            this.searchFilterValues.set('_tags', values);
            this.dropdownOptionUniverse.set('_tags', values.map(name => ({ name })));
            return;
        }

        this.searchFilterIndex.delete('_tags');
        this.searchFilterValues.delete('_tags');
        this.dropdownOptionUniverse.delete('_tags');
    }

    public getIndexedUnitIds(filterKey: string, value: string): ReadonlySet<string> | undefined {
        return this.searchFilterIndex.get(filterKey)?.get(value);
    }

    public getIndexedFilterValues(filterKey: string): string[] {
        return this.searchFilterValues.get(filterKey) ?? [];
    }

    public getUnitIdentityKeysByName(unitName: string): readonly string[] {
        return this.unitIdentityKeysByName.get(unitName) ?? [];
    }

    public getSearchWorkerIndexSnapshot(): UnitSearchWorkerIndexSnapshot {
        const snapshot: UnitSearchWorkerIndexSnapshot = {};

        for (const [filterKey, valueMap] of this.searchFilterIndex.entries()) {
            snapshot[filterKey] = {};
            for (const [value, unitIdentityKeys] of valueMap.entries()) {
                snapshot[filterKey][value] = Array.from(unitIdentityKeys);
            }
        }

        return snapshot;
    }

    public getSearchWorkerFactionEraSnapshot(): UnitSearchWorkerFactionEraSnapshot {
        return this.factionEraSnapshot;
    }

    public getDropdownOptionUniverse(filterKey: string): Array<{ name: string; img?: string }> {
        return this.dropdownOptionUniverse.get(filterKey)?.map(option => ({ ...option })) ?? [];
    }

    public getIndexedComponentUnitCounts(name: string): ReadonlyMap<string, number> | undefined {
        return this.componentCountIndex.get(name.toLowerCase());
    }

    public getUnitSubtypeMaxStats(subtype: string): MinMaxStatsRange {
        return this.unitSubtypeMaxStats[subtype] || createEmptyMinMaxStatsRange();
    }

    public getASUnitTypeMaxStats(asUnitType: string): MinMaxStatsRange {
        return this.unitAsTypeMaxStats[asUnitType] || createEmptyMinMaxStatsRange();
    }

    private rebuildDropdownOptionUniverse(eras: Era[], factions: Faction[]): void {
        this.dropdownOptionUniverse = new Map<string, Array<{ name: string; img?: string }>>();
        for (const filterKey of [
            'type',
            'subtype',
            'as.TP',
            'as.specials',
            '_techBaseDisplay',
            'role',
            'weightClass',
            'level',
            'c3',
            'moveType',
            'as._motive',
            'source',
            'componentName',
            'weaponType',
            'features',
            'quirks',
            '_tags',
        ]) {
            const values = this.searchFilterValues.get(filterKey) ?? [];
            this.dropdownOptionUniverse.set(filterKey, values.map(name => ({ name })));
        }

        this.dropdownOptionUniverse.set('era', eras.map(era => ({ name: era.name, img: era.img })));
        this.dropdownOptionUniverse.set('faction', factions.map(faction => ({ name: faction.name, img: faction.img })));
    }

    private createFactionEraSnapshot(
        unitIdentityKeysByMulId: Map<number, string[]>,
        eras: Era[],
        factions: Faction[],
    ): UnitSearchWorkerFactionEraSnapshot {
        const referenceIdsByEraAndFaction: Record<string, Record<string, readonly number[]>> = {};
        const erasById = new Map<number, Era>(eras.map(era => [era.id, era]));

        for (const era of eras) {
            referenceIdsByEraAndFaction[era.name] = {};
        }

        for (const faction of factions) {
            for (const [eraIdKey, referenceIds] of Object.entries(faction.eras) as Array<[string, Set<number>]>) {
                const era = erasById.get(Number(eraIdKey));
                if (!era) {
                    continue;
                }

                referenceIdsByEraAndFaction[era.name] ??= {};
                referenceIdsByEraAndFaction[era.name][faction.name] = Object.freeze(Array.from(referenceIds));
            }
        }

        const frozenMemberships = Object.freeze(Object.fromEntries(
            Object.entries(referenceIdsByEraAndFaction).map(([eraName, factionMap]) => [
                eraName,
                Object.freeze(factionMap),
            ]),
        ));
        const frozenIdentityKeys = Object.freeze(Object.fromEntries(
            Array.from(unitIdentityKeysByMulId, ([mulId, identityKeys]) => [
                String(mulId),
                Object.freeze([...identityKeys]),
            ]),
        ));
        return Object.freeze({
            unitIdentityKeysByMulId: frozenIdentityKeys,
            referenceIdsByEraAndFaction: frozenMemberships,
        });
    }

    private createUnitIdentityIndexes(units: UnitSummary[]): {
        identityKeys: string[];
        unitIdentityKeysByMulId: Map<number, string[]>;
        unitIdentityKeysByName: Map<string, string[]>;
    } {
        const identityKeys: string[] = [];
        const unitIdentityKeysByMulId = new Map<number, string[]>();
        const unitIdentityKeysByName = new Map<string, string[]>();

        for (const unit of units) {
            const identityKey = getUnitSearchIdentityKey(unit);
            identityKeys.push(identityKey);
            const mulIdentityKeys = unitIdentityKeysByMulId.get(unit.id);
            if (mulIdentityKeys) {
                mulIdentityKeys.push(identityKey);
            } else {
                unitIdentityKeysByMulId.set(unit.id, [identityKey]);
            }

            const nameIdentityKeys = unitIdentityKeysByName.get(unit.name);
            if (nameIdentityKeys) {
                nameIdentityKeys.push(identityKey);
            } else {
                unitIdentityKeysByName.set(unit.name, [identityKey]);
            }
        }

        return { identityKeys, unitIdentityKeysByMulId, unitIdentityKeysByName };
    }

    private addSearchIndexValue(filterKey: string, value: string | undefined, unitIdentityKey: string): void {
        if (!value) {
            return;
        }

        const normalizedValue = String(value);
        let filterIndex = this.searchFilterIndex.get(filterKey);
        if (!filterIndex) {
            filterIndex = new Map<string, Set<string>>();
            this.searchFilterIndex.set(filterKey, filterIndex);
        }

        let unitIds = filterIndex.get(normalizedValue);
        if (!unitIds) {
            unitIds = new Set<string>();
            filterIndex.set(normalizedValue, unitIds);
        }

        unitIds.add(unitIdentityKey);
    }

    private addSearchIndexValues(filterKey: string, values: Iterable<string>, unitIdentityKey: string): void {
        for (const value of values) {
            this.addSearchIndexValue(filterKey, value, unitIdentityKey);
        }
    }

    private prepareUnitComponentIndexes(
        unit: UnitSummary,
        unitIdentityKey: string,
        equipmentRegistry?: EquipmentRegistry,
    ): void {
        const counts: Partial<Record<WeaponType, number>> = {};

        const addWeaponTypes = (components: readonly UnitComponent[]): void => {
            for (const component of components) {
                if (component.bay?.length) {
                    addWeaponTypes(component.bay);
                    continue;
                }

                const equipment = component.eq ?? equipmentRegistry?.findEquipment(component.id) ?? undefined;
                if (!(equipment instanceof WeaponEquipment) || !Number.isFinite(component.q) || component.q <= 0) {
                    continue;
                }

                for (const weaponType of equipment.getWeaponTypes()) {
                    counts[weaponType] = (counts[weaponType] ?? 0) + component.q;
                }
            }
        };

        for (const component of unit.comp) {
            this.addSearchIndexValue('componentName', component.n, unitIdentityKey);
            this.addComponentUnitCount(component.n, unit.name, component.q);
        }
        for (const name of this.getSyntheticComponentNames(unit)) {
            this.addSearchIndexValue('componentName', name, unitIdentityKey);
            this.addComponentUnitCount(name, unit.name, 1);
        }

        addWeaponTypes(unit.comp);
        unit._weaponTypeCounts = counts;
        unit._weaponTypes = WEAPON_TYPES.filter(weaponType => (counts[weaponType] ?? 0) > 0);
        this.addSearchIndexValues('weaponType', unit._weaponTypes, unitIdentityKey);
    }

    private addComponentUnitCount(name: string, unitName: string, quantity: number): void {
        const normalizedName = name.toLowerCase();
        let unitCounts = this.componentCountIndex.get(normalizedName);
        if (!unitCounts) {
            unitCounts = new Map<string, number>();
            this.componentCountIndex.set(normalizedName, unitCounts);
        }

        unitCounts.set(unitName, (unitCounts.get(unitName) || 0) + quantity);
    }

    private getASMotiveDisplayNames(unit: UnitSummary): string[] {
        const movementModes = unit.as?.MVm;
        if (!movementModes) {
            return [];
        }

        const result: string[] = [];
        for (const mode of Object.keys(AS_MOVEMENT_MODE_DISPLAY_NAMES)) {
            if (mode in movementModes) {
                result.push(AS_MOVEMENT_MODE_DISPLAY_NAMES[mode]);
            }
        }

        for (const mode of Object.keys(movementModes)) {
            if (!(mode in AS_MOVEMENT_MODE_DISPLAY_NAMES)) {
                result.push(mode);
            }
        }

        return result;
    }

    private formatUnitType(type: string): string {
        if (type === 'Handheld Weapon') {
            return 'Weapon';
        }

        return type;
    }

    private getSyntheticComponentNames(unit: UnitSummary): string[] {
        const names: string[] = [];
        if (unit.armorType) names.push(unit.armorType.endsWith(' Armor') ? unit.armorType : `${unit.armorType} Armor`);
        if (unit.structureType) {
            names.push(unit.structureType.endsWith(' Structure') ? unit.structureType : `${unit.structureType} Structure`);
        }
        if (unit.engine) names.push(unit.engine.endsWith(' Engine') ? unit.engine : `${unit.engine} Engine`);
        return names;
    }

    private sumWeaponDamageNoPhysical(unit: UnitSummary, components: UnitComponent[], ignoreOneshots = false): number {
        let sum = 0;
        for (const weapon of components) {
            if (ignoreOneshots && weapon.os && weapon.os > 0) {
                continue;
            }
            if (weapon.md && weapon.t !== 'P') {
                let maxDamage = parseFloat(weapon.md) || 0;
                if (unit.subtype === 'Battle Armor' && weapon.l !== 'SSW' && weapon.p < 1) {
                    maxDamage *= unit.internal;
                }
                sum += maxDamage * (weapon.q || 1);
            }
            if (weapon.bay && Array.isArray(weapon.bay)) {
                sum += this.sumWeaponDamageNoPhysical(unit, weapon.bay, ignoreOneshots);
            }
        }

        return Math.round(sum);
    }

}
