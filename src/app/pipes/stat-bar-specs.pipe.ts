// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Pipe, type PipeTransform } from "@angular/core";
import { UnitSearchIndexService } from "../services/unit-search-index.service";
import type { UnitSummary } from "../models/unit-summary.model";
import { UNIT_STAT_READERS, type UnitStatKey } from "../models/unit-statistics";


interface statBarSpec {
    label: string;
    value: number;
    valueText?: string; // Optional text to display instead of the raw number
    max: number;
    percent: number;
    description?: string; // Tooltip description for the stat
}

interface StatBarDefinition {
    key: UnitStatKey;
    referenceKey?: UnitStatKey;
    label: string;
    valueText?: string;
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
        if (unit.moveType === 'VTOL') {
            jumpLabel = 'VTOL';
        }
        const statDefs: StatBarDefinition[] = [];
        statDefs.push(
            { key: 'armor', label: armorLabel, valueText: armorValue, description: 'Total armor points protecting the unit from internal damage' },
            { key: 'internal', label: structureLabel, valueText: internalValue, description: unit.type === 'Infantry' ? 'Number of soldiers in the infantry unit' : 'Internal structure points; unit is destroyed when depleted' },
        );

        if (unit.capital) {
            statDefs.push(
                { key: 'sailIntegrity', label: 'Sail Integrity', description: 'Jump sail integrity for interstellar travel' },
                { key: 'kfIntegrity', label: 'KF Integrity', description: 'Kearny-Fuchida drive integrity for jump capability' },
                { key: 'dropshipCapacity', label: 'Docking Collars', description: 'Number of DropShip docking collars available' },
                { key: 'lifeBoats', label: 'Life Boats', description: 'Number of life boats for crew evacuation' },
                { key: 'escapePods', label: 'Escape Pods', description: 'Number of escape pods for emergency evacuation' },
            );
        }

        const maxRange = unit._maxRange ?? 0;
        const weightedMaxRange = unit._weightedMaxRange ?? 0;
        const maxRangeValue = maxRange === weightedMaxRange ? `${maxRange}` : `${maxRange} (${weightedMaxRange})`;
        const dissipationValue = (unit.diss?.length === 2 && (unit.diss[0] != unit.diss[1])) ? `${unit.diss[0]} (${unit.diss[1]})` : `${unit.dissipation}`;
        
        statDefs.push(
            { key: 'alphaNoPhysical', referenceKey: 'alphaNoPhysicalNoOneshots', label: 'Firepower', description: 'Total maximum damage from all weapons fired simultaneously' },
            { key: 'dpt', label: 'Damage/Turn', description: 'Average damage per turn over a 10-turn engagement, accounting for heat and ammo limits' },
            { key: 'weightedMaxRange', label: 'Range', valueText: maxRangeValue, description: 'Maximum weapon range in hexes, and weighted maximum range for effective damage output' },
            { key: 'heat', label: 'Heat', description: 'Maximum heat generated when firing all weapons and activating all equipment' },
            { key: 'dissipation', label: 'Dissipation', valueText: dissipationValue, description: 'Heat dissipation capacity per turn from heat sinks. If two values are present, the first is the minimum and the second is the maximum' },
            { key: 'run2MP', label: 'Top Speed', description: 'Maximum running/cruising speed in hexes per turn' },
            { key: 'jumpMP', label: jumpLabel, description: jumpLabel === 'VTOL' ? 'VTOL movement capability in hexes' : 'Jump movement capability in hexes' },
        );

        if (unit.umu > 0) {
            statDefs.push({ key: 'umuMP', label: 'UMU', description: 'Underwater Maneuvering Unit movement in hexes' });
        }
        return statDefs.flatMap(def => {
            const value = UNIT_STAT_READERS[def.key](unit);
            const reference = bucketStats[def.referenceKey ?? def.key];
            if (value === null || reference.count === 0) return [];
            return [{
                label: def.label, value, valueText: def.valueText, max: reference.p95,
                percent: this.getStatPercent(value, reference.p95),
                description: def.description + '. P95 reference: ' + reference.p95
                    + (reference.p95 === 0 && value > 0 ? ' (rare capability)' : ''),
            }];
        });
    }

    private getStatPercent(value: number, max: number): number {
        if (max <= 0) return value > 0 ? 100 : 0;
        return Math.max(0, Math.min((value / max) * 100, 100));
    }
}
