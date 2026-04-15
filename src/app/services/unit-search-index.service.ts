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

import { Injectable } from '@angular/core';
import type { Unit, UnitComponent } from '../models/units.model';
import { type Faction } from '../models/factions.model';
import type { Era } from '../models/eras.model';
import type { BucketStatSummary, MinMaxStatsRange, UnitSubtypeMaxStats } from './data.service';
import { removeAccents } from '../utils/string.util';
import { naturalCompare } from '../utils/sort.util';
import { getMergedTags } from '../utils/unit-search-shared.util';
import { calculateWeightedMaxRange, getMaxRangeFromComponents } from '../utils/unit-range.util';
import { AS_MOVEMENT_MODE_DISPLAY_NAMES } from './unit-search-filters.model';
import type { UnitSearchWorkerFactionEraSnapshot, UnitSearchWorkerIndexSnapshot } from '../utils/unit-search-worker-protocol.util';
import { MULFACTION_EXTINCT } from '../models/mulfactions.model';

interface ASUnitTypeMaxStats {
    [asUnitType: string]: MinMaxStatsRange;
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
    private factionEraSnapshot: UnitSearchWorkerFactionEraSnapshot = {};

    public prepareUnits(units: Unit[]): void {
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

        const updateTrackedStats = (stats: ReturnType<typeof createStatsAccumulator>, unit: Unit): void => {
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
            updateTrackedStat(stats.asDmgS, unit.as?.dmg._dmgS || 0);
            updateTrackedStat(stats.asDmgM, unit.as?.dmg._dmgM || 0);
            updateTrackedStat(stats.asDmgL, unit.as?.dmg._dmgL || 0);

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
            unit._displayType = this.formatUnitType(unit.type);
            unit._mdSumNoPhysical = unit.comp ? this.sumWeaponDamageNoPhysical(unit, unit.comp) : 0;
            unit._mdSumNoPhysicalNoOneshots = unit.comp ? this.sumWeaponDamageNoPhysical(unit, unit.comp, true) : 0;
            unit._maxRange = unit.comp ? getMaxRangeFromComponents(unit.comp) : 0;
            unit._weightedMaxRange = unit.comp ? calculateWeightedMaxRange(unit) : 0;
            unit._dissipationEfficiency = (unit.heat && unit.dissipation) ? unit.dissipation - unit.heat : 0;

            if (unit.as) {
                if (unit.as.dmg) {
                    unit.as.dmg._dmgS = parseFloat(unit.as.dmg.dmgS) || 0;
                    unit.as.dmg._dmgM = parseFloat(unit.as.dmg.dmgM) || 0;
                    unit.as.dmg._dmgL = parseFloat(unit.as.dmg.dmgL) || 0;
                    unit.as.dmg._dmgE = parseFloat(unit.as.dmg.dmgE) || 0;
                }

                if (unit.as.MVm && unit.as.MVm['j'] !== undefined && unit.as.MVm[''] === undefined) {
                    const mvmKeys = Object.keys(unit.as.MVm);
                    if (unit.as.TP === 'BM' || (mvmKeys.length === 1 && mvmKeys[0] === 'j')) {
                        unit.as.MVm = { '': unit.as.MVm['j'], ...unit.as.MVm };
                    }
                }
            }

            if (unit.comp) {
                if (unit.armorType) {
                    let armorName = unit.armorType;
                    if (!armorName.endsWith(' Armor')) {
                        armorName += ' Armor';
                    }
                    this.ensureSyntheticComponent(unit.comp, armorName, 'Armor');
                }
                if (unit.structureType) {
                    let structureName = unit.structureType;
                    if (!structureName.endsWith(' Structure')) {
                        structureName += ' Structure';
                    }
                    this.ensureSyntheticComponent(unit.comp, structureName, 'Structure');
                }
                if (unit.engine) {
                    let engineName = unit.engine;
                    if (!engineName.endsWith(' Engine')) {
                        engineName += ' Engine';
                    }
                    this.ensureSyntheticComponent(unit.comp, engineName, 'Engine');
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

    public rebuildIndexes(units: Unit[], eras: Era[], factions: Faction[], extinctFaction?: Faction): void {
        this.searchFilterIndex = new Map<string, Map<string, Set<string>>>();
        this.componentCountIndex = new Map<string, Map<string, number>>();
        this.searchFilterValues = new Map<string, string[]>();

        const unitNamesByMulId = this.createUnitNamesByMulId(units);

        for (const unit of units) {
            this.addSearchIndexValue('type', unit.type, unit.name);
            this.addSearchIndexValue('subtype', unit.subtype, unit.name);
            this.addSearchIndexValue('techBase', unit.techBase, unit.name);
            this.addSearchIndexValue('role', unit.role, unit.name);
            this.addSearchIndexValue('weightClass', unit.weightClass, unit.name);
            this.addSearchIndexValue('level', String(unit.level), unit.name);
            this.addSearchIndexValue('c3', unit.c3, unit.name);
            this.addSearchIndexValue('moveType', unit.moveType, unit.name);
            this.addSearchIndexValue('as.TP', unit.as?.TP, unit.name);
            this.addSearchIndexValues('as.specials', unit.as?.specials ?? [], unit.name);
            this.addSearchIndexValues('as._motive', this.getASMotiveDisplayNames(unit), unit.name);
            this.addSearchIndexValues('source', unit.source ?? [], unit.name);
            this.addSearchIndexValues('componentName', unit.comp.map(component => component.n), unit.name);
            this.addComponentCountValues(unit);
            this.addSearchIndexValues('features', unit.features ?? [], unit.name);
            this.addSearchIndexValues('quirks', unit.quirks ?? [], unit.name);
            this.addSearchIndexValues('_tags', getMergedTags(unit), unit.name);
        }

        for (const era of eras) {
            const extinctReferenceIdsForEra = extinctFaction?.id === MULFACTION_EXTINCT
                ? extinctFaction.eras[era.id] as Set<number> | undefined
                : undefined;
            for (const referenceId of era.units as Set<number>) {
                if (!extinctReferenceIdsForEra?.has(referenceId)) {
                    for (const unitName of unitNamesByMulId.get(referenceId) ?? []) {
                        this.addSearchIndexValue('era', era.name, unitName);
                    }
                }
            }
        }

        for (const faction of factions) {
            for (const referenceIds of Object.values(faction.eras) as Set<number>[]) {
                for (const referenceId of referenceIds) {
                    for (const unitName of unitNamesByMulId.get(referenceId) ?? []) {
                        this.addSearchIndexValue('faction', faction.name, unitName);
                    }
                }
            }
        }

        for (const [filterKey, values] of this.searchFilterIndex.entries()) {
            this.searchFilterValues.set(filterKey, Array.from(values.keys()).sort((left, right) => naturalCompare(left, right)));
        }

        this.rebuildDropdownOptionUniverse(eras, factions);
        this.factionEraSnapshot = this.createFactionEraSnapshot(unitNamesByMulId, eras, factions);
    }

    public rebuildTagSearchIndex(units: Unit[]): void {
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
                unitIds.add(unit.name);
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

    public getSearchWorkerIndexSnapshot(): UnitSearchWorkerIndexSnapshot {
        const snapshot: UnitSearchWorkerIndexSnapshot = {};

        for (const [filterKey, valueMap] of this.searchFilterIndex.entries()) {
            snapshot[filterKey] = {};
            for (const [value, unitNames] of valueMap.entries()) {
                snapshot[filterKey][value] = Array.from(unitNames);
            }
        }

        return snapshot;
    }

    public getSearchWorkerFactionEraSnapshot(): UnitSearchWorkerFactionEraSnapshot {
        return Object.fromEntries(
            Object.entries(this.factionEraSnapshot).map(([eraName, factionMap]) => [eraName, { ...factionMap }])
        );
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
            'techBase',
            'role',
            'weightClass',
            'level',
            'c3',
            'moveType',
            'as._motive',
            'source',
            'componentName',
            'features',
            'quirks',
            '_tags',
        ]) {
            this.dropdownOptionUniverse.set(filterKey, this.getIndexedFilterValues(filterKey).map(name => ({ name })));
        }

        this.dropdownOptionUniverse.set('era', eras.map(era => ({ name: era.name, img: era.img })));
        this.dropdownOptionUniverse.set('faction', factions.map(faction => ({ name: faction.name, img: faction.img })));
    }

    private createFactionEraSnapshot(unitNamesByMulId: Map<number, string[]>, eras: Era[], factions: Faction[]): UnitSearchWorkerFactionEraSnapshot {
        const snapshot: UnitSearchWorkerFactionEraSnapshot = {};
        const erasById = new Map<number, Era>(eras.map(era => [era.id, era]));

        for (const era of eras) {
            snapshot[era.name] = {};
        }

        for (const faction of factions) {
            for (const [eraIdKey, referenceIds] of Object.entries(faction.eras) as Array<[string, Set<number>]>) {
                const era = erasById.get(Number(eraIdKey));
                if (!era) {
                    continue;
                }

                const unitNames: string[] = [];
                for (const referenceId of referenceIds) {
                    unitNames.push(...(unitNamesByMulId.get(referenceId) ?? []));
                }

                snapshot[era.name] ??= {};
                snapshot[era.name][faction.name] = unitNames;
            }
        }

        return snapshot;
    }

    private createUnitNamesByMulId(units: Unit[]): Map<number, string[]> {
        const unitNamesByMulId = new Map<number, string[]>();

        for (const unit of units) {
            const names = unitNamesByMulId.get(unit.id);
            if (names) {
                names.push(unit.name);
            } else {
                unitNamesByMulId.set(unit.id, [unit.name]);
            }
        }

        return unitNamesByMulId;
    }

    private addSearchIndexValue(filterKey: string, value: string | undefined, unitName: string): void {
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

        unitIds.add(unitName);
    }

    private addSearchIndexValues(filterKey: string, values: Iterable<string>, unitName: string): void {
        for (const value of values) {
            this.addSearchIndexValue(filterKey, value, unitName);
        }
    }

    private addComponentCountValues(unit: Unit): void {
        for (const component of unit.comp) {
            const normalizedName = component.n.toLowerCase();
            let unitCounts = this.componentCountIndex.get(normalizedName);
            if (!unitCounts) {
                unitCounts = new Map<string, number>();
                this.componentCountIndex.set(normalizedName, unitCounts);
            }

            unitCounts.set(unit.name, (unitCounts.get(unit.name) || 0) + component.q);
        }
    }

    private getASMotiveDisplayNames(unit: Unit): string[] {
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

    private ensureSyntheticComponent(components: UnitComponent[], id: string, location: string): void {
        if (components.some(component => component.id === id && component.t === 'HIDDEN' && component.l === location && component.p === -1)) {
            return;
        }

        components.push({ q: 1, n: id, id, l: location, t: 'HIDDEN', p: -1 });
    }

    private sumWeaponDamageNoPhysical(unit: Unit, components: UnitComponent[], ignoreOneshots = false): number {
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