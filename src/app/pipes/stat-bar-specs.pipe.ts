// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Pipe, type PipeTransform } from "@angular/core";
import { UnitSearchIndexService, type MinMaxStatsRange } from "../services/unit-search-index.service";
import type { UnitSummary } from "../models/unit-summary.model";
import { getUnitStatValues } from "../utils/unit-stat-values.util";


interface statBarSpec {
    label: string;
    value: number;
    valueText?: string; // Optional text to display instead of the raw number
    max: number;
    percent: number;
    description?: string; // Tooltip description for the stat
}

interface StatBarDefinition {
    key: keyof MinMaxStatsRange;
    label: string;
    value: number;
    valueText?: string;
    max: number;
    description?: string;
}

@Pipe({
    name: 'statBarSpecs',
    pure: true // Pure pipes are only called when the input changes
})
export class StatBarSpecsPipe implements PipeTransform {
    private readonly searchIndex = inject(UnitSearchIndexService);

    transform(unit: UnitSummary): statBarSpec[] {
        const bucketStats = this.searchIndex.getUnitStats(unit);
        // const armorLabel = unit.armorType ? `Armor (${unit.armorType.replace(/armor/i,'').trim()})` : 'Armor';
        const armorLabel = 'Armor';
        let structureLabel;
        let internalValue;
        if (unit.type === 'Infantry') {
            structureLabel = 'Squad size';
            internalValue = unit.squads && unit.squads > 1 && unit.squadSize ? `${unit.squadSize}×${unit.squads}` : `${unit.internal}`;
        } else {
            structureLabel = 'Structure';
            internalValue = `${unit.internal}`;
        }
        let armorValue;
        if (unit.subtype === 'Battle Armor') {
            const armorPerUnit = unit.armor / unit.internal;
            armorValue = `${armorPerUnit}×${unit.internal} (${unit.armorPer}%)`;
        } else {
            armorValue = `${unit.armor} (${unit.armorPer}%)`;
        }
        let jumpLabel = 'Jump';
        let jumpValue = unit.jump;
        if (unit.moveType === 'VTOL') {
            jumpLabel = 'VTOL';
        }
        const statDefs: StatBarDefinition[] = [];
        statDefs.push(
            { key: 'armor', label: armorLabel, value: unit.armor, valueText: armorValue, max: bucketStats.armor.p95, description: 'Total armor points protecting the unit from internal damage' },
            { key: 'internal', label: structureLabel, value: unit.internal, valueText: internalValue, max: bucketStats.internal.p95, description: unit.type === 'Infantry' ? 'Number of soldiers in the infantry unit' : 'Internal structure points; unit is destroyed when depleted' },
        );

        if (unit.capital) {
            statDefs.push(
                { key: 'sailIntegrity', label: 'Sail Integrity', value: unit.capital.sailIntegrity, max: bucketStats.sailIntegrity.p95, description: 'Jump sail integrity for interstellar travel' },
                { key: 'kfIntegrity', label: 'KF Integrity', value: unit.capital.kfIntegrity, max: bucketStats.kfIntegrity.p95, description: 'Kearny-Fuchida drive integrity for jump capability' },
                { key: 'dropshipCapacity', label: 'Docking Collars', value: unit.capital.dropshipCapacity, max: bucketStats.dropshipCapacity.p95, description: 'Number of DropShip docking collars available' },
                { key: 'lifeBoats', label: 'Life Boats', value: unit.capital.lifeBoats, max: bucketStats.lifeBoats.p95, description: 'Number of life boats for crew evacuation' },
                { key: 'escapePods', label: 'Escape Pods', value: unit.capital.escapePods, max: bucketStats.escapePods.p95, description: 'Number of escape pods for emergency evacuation' },
            );
        }

        const maxRange = unit._maxRange ?? 0;
        const weightedMaxRange = unit._weightedMaxRange ?? 0;
        const maxRangeValue = maxRange === weightedMaxRange ? `${maxRange}` : `${maxRange} (${weightedMaxRange})`;
        const dissipationValue = (unit.diss?.length === 2 && (unit.diss[0] != unit.diss[1])) ? `${unit.diss[0]} (${unit.diss[1]})` : `${unit.dissipation}`;
        
        statDefs.push(
            { key: 'alphaNoPhysical', label: 'Firepower', value: unit._mdSumNoPhysical ?? 0, max: bucketStats.alphaNoPhysicalNoOneshots.p95, description: 'Total maximum damage from all weapons fired simultaneously' },
            { key: 'dpt', label: 'Damage/Turn', value: unit.dpt, max: bucketStats.dpt.p95, description: 'Average damage per turn over a 10-turn engagement, accounting for heat and ammo limits' },
            { key: 'weightedMaxRange', label: 'Range', value: weightedMaxRange, valueText: maxRangeValue, max: bucketStats.weightedMaxRange.p95, description: 'Maximum weapon range in hexes, and weighted maximum range for effective damage output' },
            { key: 'heat', label: 'Heat', value: unit.heat, max: bucketStats.heat.p95, description: 'Maximum heat generated when firing all weapons and activating all equipment' },
            { key: 'dissipation', label: 'Dissipation', value: unit.dissipation, valueText: dissipationValue, max: bucketStats.dissipation.p95, description: 'Heat dissipation capacity per turn from heat sinks. If two values are present, the first is the minimum and the second is the maximum' },
            { key: 'run2MP', label: 'Top Speed', value: unit.run2, max: bucketStats.run2MP.p95, description: 'Maximum running/cruising speed in hexes per turn' },
            { key: 'jumpMP', label: jumpLabel, value: jumpValue, max: bucketStats.jumpMP.p95, description: jumpLabel === 'VTOL' ? 'VTOL movement capability in hexes' : 'Jump movement capability in hexes' },
        );

        if (unit.umu > 0) {
            statDefs.push({ key: 'umuMP', label: 'UMU', value: unit.umu, max: bucketStats.umuMP.p95, description: 'Underwater Maneuvering Unit movement in hexes' });
        }
        const values = getUnitStatValues(unit);
        const filteredStats: statBarSpec[] = statDefs.filter(def =>
            values[def.key] !== null && bucketStats[def.key].count > 0,
        ).map(def => ({
            label: def.label, value: def.value, valueText: def.valueText, max: def.max,
            percent: this.getStatPercent(def.value, def.max),
            description: `${def.description}. P95 reference: ${def.max}`
                + (def.max === 0 && def.value > 0 ? ' (rare capability)' : ''),
        }));
        return filteredStats;
    }

    private getStatPercent(value: number, max: number): number {
        if (max <= 0) return value > 0 ? 100 : 0;
        return Math.max(0, Math.min((value / max) * 100, 100));
    }
}
