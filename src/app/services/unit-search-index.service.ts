// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable } from '@angular/core';
import type { UnitSummary, UnitComponent, UnitType } from '../models/unit-summary.model';
import { type Faction } from '../models/factions.model';
import type { Era } from '../models/eras.model';
import { removeAccents } from '../utils/string.util';
import { compareUnitsByName, naturalCompare } from '../utils/sort.util';
import { getMergedTags, getUnitSourceFilterValues } from '../utils/unit-search-shared.util';
import { calculateWeightedMaxRange, getMaxRangeFromComponents } from '../utils/unit-range.util';
import { getUnitStatBucketKey, getUnitStatValues } from '../utils/unit-stat-values.util';
import { parseASDamageValue } from '../utils/as-damage.util';
import { AS_MOVEMENT_MODE_DISPLAY_NAMES, BOOLEAN_FILTERS, getBooleanFilterUnitValue } from './unit-search-filters.model';
import { MULFACTION_EXTINCT } from '../models/mulfactions.model';
import { WeaponEquipment } from '../models/equipment.model';
import { WEAPON_TYPES, type WeaponType } from '../models/weapon-types.model';
import type { EquipmentRegistry } from '../models/equipment-lookup';
import {
    buildASSpecialsByUnitIndex,
    getASSpecialMinimumFieldLabels,
    type ParsedASSpecials,
} from '../utils/as-special-filter.util';
import type { UnitUuid } from './unit-catalog/unit-catalog.types';

export const DOES_NOT_TRACK = 999;

export interface BucketStatSummary {
    readonly min: number;
    readonly max: number;
    readonly average: number;
    /** Nearest-rank 95th percentile of supported measurements. */
    readonly p95: number;
    readonly count: number;
}

export interface MinMaxStatsRange {
    readonly mobility: BucketStatSummary;
    readonly endurance: BucketStatSummary;
    readonly asEndurance: BucketStatSummary;
    readonly armor: BucketStatSummary;
    readonly internal: BucketStatSummary;
    readonly heat: BucketStatSummary;
    readonly dissipation: BucketStatSummary;
    readonly dissipationEfficiency: BucketStatSummary;
    readonly runMP: BucketStatSummary;
    readonly run2MP: BucketStatSummary;
    readonly umuMP: BucketStatSummary;
    readonly jumpMP: BucketStatSummary;
    readonly alphaNoPhysical: BucketStatSummary;
    readonly alphaNoPhysicalNoOneshots: BucketStatSummary;
    readonly maxRange: BucketStatSummary;
    readonly weightedMaxRange: BucketStatSummary;
    readonly dpt: BucketStatSummary;
    readonly asTmm: BucketStatSummary;
    readonly asArm: BucketStatSummary;
    readonly asStr: BucketStatSummary;
    readonly asDmgS: BucketStatSummary;
    readonly asDmgM: BucketStatSummary;
    readonly asDmgL: BucketStatSummary;
    readonly dropshipCapacity: BucketStatSummary;
    readonly escapePods: BucketStatSummary;
    readonly lifeBoats: BucketStatSummary;
    readonly gravDecks: BucketStatSummary;
    readonly sailIntegrity: BucketStatSummary;
    readonly kfIntegrity: BucketStatSummary;
}

export interface UnitSearchDropdownOption {
    name: string;
    img?: string;
    minimumFieldLabels?: readonly string[];
}

export interface UnitOrdinalLookup {
    readonly unitUuids: readonly UnitUuid[];
    readonly ordinalsByUnitUuid: ReadonlyMap<UnitUuid, number>;
}

class IndexedUnitUuidSet implements ReadonlySet<UnitUuid> {
    public readonly [Symbol.toStringTag] = 'Set';

    public constructor(
        private readonly ordinals: Uint32Array,
        private readonly lookup: UnitOrdinalLookup,
    ) {}

    public get size(): number {
        return this.ordinals.length;
    }

    public has(unitUuid: UnitUuid): boolean {
        const ordinal = this.lookup.ordinalsByUnitUuid.get(unitUuid);
        return ordinal !== undefined && hasSortedOrdinal(this.ordinals, ordinal);
    }

    public *values(): SetIterator<UnitUuid> {
        for (const ordinal of this.ordinals) yield this.lookup.unitUuids[ordinal];
    }

    public keys(): SetIterator<UnitUuid> {
        return this.values();
    }

    public *entries(): SetIterator<[UnitUuid, UnitUuid]> {
        for (const unitUuid of this.values()) yield [unitUuid, unitUuid];
    }

    public forEach(
        callbackfn: (value: UnitUuid, value2: UnitUuid, set: ReadonlySet<UnitUuid>) => void,
        thisArg?: unknown,
    ): void {
        for (const unitUuid of this.values()) callbackfn.call(thisArg, unitUuid, unitUuid, this);
    }

    public [Symbol.iterator](): SetIterator<UnitUuid> {
        return this.values();
    }
}

function findSortedOrdinal(ordinals: Uint32Array, target: number): number {
    let low = 0;
    let high = ordinals.length - 1;
    while (low <= high) {
        const middle = (low + high) >>> 1;
        const value = ordinals[middle];
        if (value === target) return middle;
        if (value < target) low = middle + 1;
        else high = middle - 1;
    }
    return -1;
}

function hasSortedOrdinal(ordinals: Uint32Array, target: number): boolean {
    return findSortedOrdinal(ordinals, target) !== -1;
}

function toSortedUniqueOrdinals(values: number[]): Uint32Array {
    values.sort((left, right) => left - right);
    let uniqueCount = 0;
    for (const value of values) {
        if (uniqueCount === 0 || values[uniqueCount - 1] !== value) {
            values[uniqueCount++] = value;
        }
    }
    const result = new Uint32Array(uniqueCount);
    for (let index = 0; index < uniqueCount; index++) result[index] = values[index];
    return result;
}

/** MUL membership references retained by the synchronous search index. */
export interface FactionEraMembershipSnapshot {
    readonly unitUuidsByMulId: ReadonlyMap<number, readonly UnitUuid[]>;
    readonly referenceIdsByEraAndFaction: ReadonlyMap<
        string,
        ReadonlyMap<string, ReadonlySet<number>>
    >;
}

/**
 * Fully built search state for one exact Units/dependency activation.
 *
 * All maps and statistics are allocated while the activation is still
 * invisible. The final catalog switch only assigns these references, so a
 * failed or superseded build cannot expose a partially rebuilt index.
 */
export interface PreparedUnitSearchIndexes {
    readonly unitStats: Readonly<Record<string, MinMaxStatsRange>>;
    readonly searchFilterIndex: Map<string, Map<string, ReadonlySet<UnitUuid>>>;
    readonly unitOrdinalLookup: UnitOrdinalLookup;
    readonly searchFilterValues: Map<string, string[]>;
    readonly dropdownOptionUniverse: Map<string, UnitSearchDropdownOption[]>;
    readonly asSpecialFieldCounts: Map<string, number>;
    readonly asSpecialsByUnit: readonly ParsedASSpecials[];
    readonly factionEraSnapshot: FactionEraMembershipSnapshot;
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

type StatSamples = Partial<Record<keyof MinMaxStatsRange, number[]>>;

function summarizeStat(values: number[] = []): BucketStatSummary {
    if (values.length === 0) return { min: 0, max: 0, average: 0, p95: 0, count: 0 };
    values.sort((left, right) => left - right);
    return {
        min: values[0],
        max: values[values.length - 1],
        average: values.reduce((sum, value) => sum + value, 0) / values.length,
        p95: values[Math.ceil(values.length * 0.95) - 1],
        count: values.length,
    };
}

@Injectable({
    providedIn: 'root'
})
export class UnitSearchIndexService {
    private unitStats: Readonly<Record<string, MinMaxStatsRange>> = {};
    private searchFilterIndex = new Map<string, Map<string, ReadonlySet<UnitUuid>>>();
    private unitOrdinalLookup: UnitOrdinalLookup = {
        unitUuids: [],
        ordinalsByUnitUuid: new Map(),
    };
    private searchFilterIndexBuilder: Map<string, Map<string, number[]>> | null = null;
    private searchFilterValues = new Map<string, string[]>();
    private dropdownOptionUniverse = new Map<string, UnitSearchDropdownOption[]>();
    private asSpecialFieldCounts = new Map<string, number>();
    private asSpecialsByUnit: readonly ParsedASSpecials[] = [];
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
    private factionEraSnapshot: FactionEraMembershipSnapshot = {
        unitUuidsByMulId: new Map(),
        referenceIdsByEraAndFaction: new Map(),
    };
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
        this.unitStats = candidate.unitStats;
        this.searchFilterIndex = candidate.searchFilterIndex;
        this.unitOrdinalLookup = candidate.unitOrdinalLookup;
        this.searchFilterValues = candidate.searchFilterValues;
        this.dropdownOptionUniverse = candidate.dropdownOptionUniverse;
        this.asSpecialFieldCounts = candidate.asSpecialFieldCounts;
        this.asSpecialsByUnit = candidate.asSpecialsByUnit;
        this.factionEraSnapshot = candidate.factionEraSnapshot;
    }

    private capturePreparedIndexes(
        preparationTimings: PreparedUnitSearchIndexes['preparationTimings'],
    ): PreparedUnitSearchIndexes {
        return Object.freeze({
            unitStats: this.unitStats,
            searchFilterIndex: this.searchFilterIndex,
            unitOrdinalLookup: this.unitOrdinalLookup,
            searchFilterValues: this.searchFilterValues,
            dropdownOptionUniverse: this.dropdownOptionUniverse,
            asSpecialFieldCounts: this.asSpecialFieldCounts,
            asSpecialsByUnit: this.asSpecialsByUnit,
            factionEraSnapshot: this.factionEraSnapshot,
            preparationTimings: Object.freeze(preparationTimings),
            indexStats: this.indexStats,
        });
    }

    private prepareUnits(units: UnitSummary[]): void {
        const unitStats: Record<string, MinMaxStatsRange> = {};
        const samplesByBucket: Record<string, StatSamples> = {};

        for (let unitOrdinal = 0; unitOrdinal < units.length; unitOrdinal++) {
            const unit = units[unitOrdinal];
            const chassis = removeAccents(unit.chassis?.toLowerCase() || '');
            const model = removeAccents(unit.model?.toLowerCase() || '');
            const chassisAlphanumeric = chassis.replace(/[^a-z0-9]/g, '');
            const modelAlphanumeric = model.replace(/[^a-z0-9]/g, '');
            unit._searchOrdinal = unitOrdinal;
            unit._searchKey = `${chassis} ${model}`;
            unit._searchKeyAlphanumeric = chassisAlphanumeric + modelAlphanumeric;
            unit._searchChassisLength = chassis.length;
            unit._searchChassisAlphanumericLength = chassisAlphanumeric.length;
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

            const key = getUnitStatBucketKey(unit);
            const samples = samplesByBucket[key] ??= {};
            for (const [statKey, value] of Object.entries(getUnitStatValues(unit))) {
                if (value !== null) (samples[statKey as keyof MinMaxStatsRange] ??= []).push(value);
                else samples[statKey as keyof MinMaxStatsRange] ??= [];
            }
        }

        for (const [key, samples] of Object.entries(samplesByBucket)) {
            unitStats[key] = Object.fromEntries(
                Object.entries(samples).map(([statKey, values]) => [statKey, summarizeStat(values)]),
            ) as unknown as MinMaxStatsRange;
        }
        this.unitStats = unitStats;

        const unitsByName = [...units].sort(compareUnitsByName);
        for (let rank = 0; rank < unitsByName.length; rank++) {
            unitsByName[rank]._searchNameRank = rank;
        }
    }

    public rebuildIndexes(
        units: UnitSummary[],
        eras: Era[],
        factions: Faction[],
        extinctFaction?: Faction,
        equipmentRegistry?: EquipmentRegistry,
    ): void {
        const unitUuids = units.map(unit => unit.uuid);
        this.unitOrdinalLookup = {
            unitUuids,
            ordinalsByUnitUuid: new Map(unitUuids.map((unitUuid, ordinal) => [unitUuid, ordinal])),
        };
        this.searchFilterIndexBuilder = new Map<string, Map<string, number[]>>();
        this.searchFilterIndex = new Map<string, Map<string, ReadonlySet<UnitUuid>>>();
        this.searchFilterValues = new Map<string, string[]>();
        this.asSpecialFieldCounts = new Map<string, number>();
        const parsedSpecialsByUnitUuid = buildASSpecialsByUnitIndex(
            units,
            unit => unit.uuid,
            unit => unit.as?.specials,
        );
        this.asSpecialsByUnit = units.map(unit => parsedSpecialsByUnitUuid.get(unit.uuid)!);
        const identityMapStartedAt = Date.now();
        const unitUuidsByMulId = this.createUnitUuidsByMulId(units);
        const identityMapMs = Math.max(0, Date.now() - identityMapStartedAt);

        const unitFiltersStartedAt = Date.now();
        for (const unit of units) {
            this.addSearchIndexValue('type', unit.type, unit.uuid);
            this.addSearchIndexValue('subtype', unit.subtype, unit.uuid);
            this.addSearchIndexValue('_techBaseDisplay', unit._techBaseDisplay, unit.uuid);
            this.addSearchIndexValue('role', unit.role, unit.uuid);
            this.addSearchIndexValue('weightClass', unit.weightClass, unit.uuid);
            this.addSearchIndexValue('level', String(unit.level), unit.uuid);
            this.addSearchIndexValue('c3', unit.c3, unit.uuid);
            this.addSearchIndexValue('moveType', unit.moveType, unit.uuid);
            this.addSearchIndexValue('as.TP', unit.as?.TP, unit.uuid);
            this.addASSpecialIndexValues(this.getIndexedASSpecials(unit.uuid), unit.uuid);
            this.addSearchIndexValues('as._motive', this.getASMotiveDisplayNames(unit), unit.uuid);
            this.addSearchIndexValues('source', getUnitSourceFilterValues(unit), unit.uuid);
            this.addSearchIndexValues('rulesRefs', unit.rulesRefs?.flat() ?? [], unit.uuid);
            this.addSearchIndexValues('features', unit.features ?? [], unit.uuid);
            this.addSearchIndexValues('quirks', unit.quirks ?? [], unit.uuid);
            this.addSearchIndexValues('_tags', getMergedTags(unit), unit.uuid);
            for (const filter of BOOLEAN_FILTERS) {
                this.addSearchIndexValue(filter.key, getBooleanFilterUnitValue(filter, unit[filter.key as keyof UnitSummary]) ? 'yes' : 'no', unit.uuid);
            }
        }
        const unitFiltersMs = Math.max(0, Date.now() - unitFiltersStartedAt);

        const componentIndexesStartedAt = Date.now();
        for (const unit of units) {
            this.prepareUnitComponentIndexes(unit, unit.uuid, equipmentRegistry);
        }
        const componentIndexesMs = Math.max(0, Date.now() - componentIndexesStartedAt);

        const eraMembershipsStartedAt = Date.now();
        for (const era of eras) {
            const extinctReferenceIdsForEra = extinctFaction?.id === MULFACTION_EXTINCT
                ? extinctFaction.eras[era.id] as Set<number> | undefined
                : undefined;
            for (const referenceId of era.units as Set<number>) {
                if (!extinctReferenceIdsForEra?.has(referenceId)) {
                    for (const unitUuid of unitUuidsByMulId.get(referenceId) ?? []) {
                        this.addSearchIndexValue('era', era.name, unitUuid);
                    }
                }
            }
        }
        const eraMembershipsMs = Math.max(0, Date.now() - eraMembershipsStartedAt);

        const factionMembershipsStartedAt = Date.now();
        for (const faction of factions) {
            for (const referenceIds of Object.values(faction.eras) as Set<number>[]) {
                for (const referenceId of referenceIds) {
                    for (const unitUuid of unitUuidsByMulId.get(referenceId) ?? []) {
                        this.addSearchIndexValue('faction', faction.name, unitUuid);
                    }
                }
            }
        }
        const factionMembershipsMs = Math.max(0, Date.now() - factionMembershipsStartedAt);

        const finalizationStartedAt = Date.now();
        let filterValues = 0;
        let memberships = 0;
        for (const [filterKey, valueBuilders] of this.searchFilterIndexBuilder.entries()) {
            const values = new Map<string, ReadonlySet<UnitUuid>>();
            for (const [value, ordinals] of valueBuilders) {
                const posting = new IndexedUnitUuidSet(toSortedUniqueOrdinals(ordinals), this.unitOrdinalLookup);
                values.set(value, posting);
                memberships += posting.size;
            }
            filterValues += values.size;
            this.searchFilterIndex.set(filterKey, values);
            this.searchFilterValues.set(filterKey, Array.from(values.keys()).sort((left, right) => naturalCompare(left, right)));
        }
        this.searchFilterIndexBuilder = null;
        this.indexStats = Object.freeze({
            filterKeys: this.searchFilterIndex.size,
            filterValues,
            memberships,
        });

        this.rebuildDropdownOptionUniverse(eras, factions);
        this.factionEraSnapshot = this.createFactionEraSnapshot(unitUuidsByMulId, eras, factions);
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

        const tagOrdinals = new Map<string, number[]>();
        for (const unit of units) {
            const ordinal = this.unitOrdinalLookup.ordinalsByUnitUuid.get(unit.uuid);
            if (ordinal === undefined) continue;
            for (const tag of getMergedTags(unit)) {
                const ordinals = tagOrdinals.get(tag);
                if (ordinals) ordinals.push(ordinal);
                else tagOrdinals.set(tag, [ordinal]);
            }
        }

        if (tagOrdinals.size > 0) {
            const tagIndex = new Map<string, ReadonlySet<UnitUuid>>();
            for (const [tag, ordinals] of tagOrdinals) {
                tagIndex.set(tag, new IndexedUnitUuidSet(
                    toSortedUniqueOrdinals(ordinals),
                    this.unitOrdinalLookup,
                ));
            }
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

    public getIndexedUnitIds(filterKey: string, value: string): ReadonlySet<UnitUuid> | undefined {
        return this.searchFilterIndex.get(filterKey)?.get(value);
    }

    public getIndexedFilterValues(filterKey: string): string[] {
        return this.searchFilterValues.get(filterKey) ?? [];
    }

    public getIndexedASSpecials(unitUuid: UnitUuid): ParsedASSpecials | undefined {
        const ordinal = this.unitOrdinalLookup.ordinalsByUnitUuid.get(unitUuid);
        return ordinal === undefined ? undefined : this.asSpecialsByUnit[ordinal];
    }

    public getFactionEraUnitUuids(
        eraNames: readonly string[],
        factionNames: readonly string[],
    ): ReadonlySet<UnitUuid> {
        const unitUuids = new Set<UnitUuid>();
        for (const eraName of eraNames) {
            const factionMap = this.factionEraSnapshot.referenceIdsByEraAndFaction.get(eraName);
            for (const factionName of factionNames) {
                for (const referenceId of factionMap?.get(factionName) ?? []) {
                    for (const unitUuid of this.factionEraSnapshot.unitUuidsByMulId.get(referenceId) ?? []) {
                        unitUuids.add(unitUuid);
                    }
                }
            }
        }
        return unitUuids;
    }

    public getDropdownOptionUniverse(filterKey: string): UnitSearchDropdownOption[] {
        return this.dropdownOptionUniverse.get(filterKey)?.map(option => ({ ...option })) ?? [];
    }

    public getUnitStats(unit: UnitSummary): MinMaxStatsRange {
        return this.unitStats[getUnitStatBucketKey(unit)] ?? Object.fromEntries(
            Object.keys(getUnitStatValues(unit)).map(key => [key, summarizeStat()]),
        ) as unknown as MinMaxStatsRange;
    }

    private rebuildDropdownOptionUniverse(eras: Era[], factions: Faction[]): void {
        this.dropdownOptionUniverse = new Map<string, UnitSearchDropdownOption[]>();
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
            'rulesRefs',
            'componentName',
            'weaponType',
            'features',
            'quirks',
            '_tags',
        ]) {
            this.dropdownOptionUniverse.set(filterKey, this.getIndexedFilterValues(filterKey).map(name => ({
                name,
                ...(filterKey === 'as.specials' && (this.asSpecialFieldCounts.get(name) ?? 0) > 0
                    ? {
                        minimumFieldLabels: getASSpecialMinimumFieldLabels(
                            name,
                            this.asSpecialFieldCounts.get(name) ?? 0,
                        ),
                    }
                    : {}),
            })));
        }

        this.dropdownOptionUniverse.set('era', eras.map(era => ({ name: era.name, img: era.img })));
        this.dropdownOptionUniverse.set('faction', factions.map(faction => ({ name: faction.name, img: faction.img })));
    }

    private addASSpecialIndexValues(parsedSpecials: ParsedASSpecials | undefined, unitUuid: UnitUuid): void {
        for (const occurrence of parsedSpecials?.occurrences ?? []) {
            if (!occurrence.token) continue;
            this.addSearchIndexValue('as.specials', occurrence.token, unitUuid);
            const currentFieldCount = this.asSpecialFieldCounts.get(occurrence.token) ?? 0;
            if (occurrence.values.length > currentFieldCount) {
                this.asSpecialFieldCounts.set(occurrence.token, occurrence.values.length);
            }
        }
    }

    private createFactionEraSnapshot(
        unitUuidsByMulId: Map<number, UnitUuid[]>,
        eras: Era[],
        factions: Faction[],
    ): FactionEraMembershipSnapshot {
        const referenceIdsByEraAndFaction = new Map<string, Map<string, ReadonlySet<number>>>();
        const erasById = new Map<number, Era>(eras.map(era => [era.id, era]));

        for (const era of eras) {
            referenceIdsByEraAndFaction.set(era.name, new Map());
        }

        for (const faction of factions) {
            for (const [eraIdKey, referenceIds] of Object.entries(faction.eras) as Array<[string, Set<number>]>) {
                const era = erasById.get(Number(eraIdKey));
                if (!era) {
                    continue;
                }

                let factionMap = referenceIdsByEraAndFaction.get(era.name);
                if (!factionMap) {
                    factionMap = new Map();
                    referenceIdsByEraAndFaction.set(era.name, factionMap);
                }
                factionMap.set(faction.name, referenceIds);
            }
        }

        return {
            unitUuidsByMulId,
            referenceIdsByEraAndFaction,
        };
    }

    private createUnitUuidsByMulId(units: UnitSummary[]): Map<number, UnitUuid[]> {
        const unitUuidsByMulId = new Map<number, UnitUuid[]>();
        for (const unit of units) {
            const unitUuids = unitUuidsByMulId.get(unit.id);
            if (unitUuids) {
                unitUuids.push(unit.uuid);
            } else {
                unitUuidsByMulId.set(unit.id, [unit.uuid]);
            }
        }
        return unitUuidsByMulId;
    }

    private addSearchIndexValue(filterKey: string, value: string | undefined, unitUuid: UnitUuid): void {
        if (!value) {
            return;
        }

        const ordinal = this.unitOrdinalLookup.ordinalsByUnitUuid.get(unitUuid);
        if (ordinal === undefined || !this.searchFilterIndexBuilder) return;

        const normalizedValue = String(value);
        let filterIndex = this.searchFilterIndexBuilder.get(filterKey);
        if (!filterIndex) {
            filterIndex = new Map<string, number[]>();
            this.searchFilterIndexBuilder.set(filterKey, filterIndex);
        }

        const ordinals = filterIndex.get(normalizedValue);
        if (ordinals) ordinals.push(ordinal);
        else filterIndex.set(normalizedValue, [ordinal]);
    }

    private addSearchIndexValues(filterKey: string, values: Iterable<string>, unitUuid: UnitUuid): void {
        for (const value of values) {
            this.addSearchIndexValue(filterKey, value, unitUuid);
        }
    }

    private prepareUnitComponentIndexes(
        unit: UnitSummary,
        unitUuid: UnitUuid,
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
            this.addSearchIndexValue('componentName', component.n, unitUuid);
        }
        for (const name of this.getSyntheticComponentNames(unit)) {
            this.addSearchIndexValue('componentName', name, unitUuid);
        }

        addWeaponTypes(unit.comp);
        unit._weaponTypeCounts = counts;
        unit._weaponTypes = WEAPON_TYPES.filter(weaponType => (counts[weaponType] ?? 0) > 0);
        this.addSearchIndexValues('weaponType', unit._weaponTypes, unitUuid);
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

    private formatUnitType(type: UnitType): string {
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
