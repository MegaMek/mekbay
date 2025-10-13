/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
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

import { inject, Pipe, PipeTransform } from "@angular/core";
import { DataService, DOES_NOT_TRACK } from "../services/data.service";
import { Unit } from "../models/units.model";

/*
 * Author: Drake
 */
interface statBarSpec {
    label: string;
    value: number;
    max: number;
    percent: number;
}

@Pipe({
    name: 'statBarSpecs',
    pure: true // Pure pipes are only called when the input changes
})
export class StatBarSpecsPipe implements PipeTransform {
    private dataService = inject(DataService);

    transform(unit: Unit): statBarSpec[] {
        const maxStats = this.dataService.getUnitTypeMaxStats(unit.type);
        // const armorLabel = unit.armorType ? `Armor (${unit.armorType.replace(/armor/i,'').trim()})` : 'Armor';
        const armorLabel = 'Armor';
        let structureLabel;
        if (unit.type === 'Infantry') {
            structureLabel = 'Squad size';
        } else {
            // structureLabel = unit.structureType ? `Structure (${unit.structureType.replace(/structure/i,'').trim()})` : 'Structure';
            structureLabel = 'Structure';
        }
        const statDefs = [
            { key: 'armor', label: armorLabel, value: unit.armor, max: maxStats.armor[1] },
            { key: 'internal', label: structureLabel, value: unit.internal, max: maxStats.internal[1] },
            { key: 'alphaNoPhysical', label: 'Firepower', value: unit._mdSumNoPhysical, max: maxStats.alphaNoPhysicalNoOneshots[1] },
            { key: 'dpt', label: 'Damage/Turn', value: unit.dpt, max: maxStats.dpt[1] },
            { key: 'maxRange', label: 'Range', value: unit._maxRange, max: maxStats.maxRange[1] },
            { key: 'heat', label: 'Heat', value: unit.heat, max: maxStats.heat[1] },
            { key: 'dissipation', label: 'Dissipation', value: unit.dissipation, max: maxStats.dissipation[1] },
            { key: 'runMP', label: 'Top Speed', value: unit.run2, max: maxStats.run2MP[1] },
            { key: 'jumpMP', label: 'Jump', value: unit.jump, max: maxStats.jumpMP[1] },
        ];

        const filteredStats: statBarSpec[] = statDefs.filter(def => {
            const statMaxArr = maxStats[def.key as keyof typeof maxStats] as [number, number];
            if (def.value === undefined || def.value === null || def.value === -1) return false;
            if (!statMaxArr) return false;
            if (statMaxArr[0] === statMaxArr[1]) return false;
            if (statMaxArr[0] === 0 && DOES_NOT_TRACK === statMaxArr[1] && DOES_NOT_TRACK === def.value) return false;
            return true;
        }).map(def => ({ label: def.label, value: def.value, max: def.max, percent: this.getStatPercent(def.value, def.max) }) );
        return filteredStats;
    }

    private getStatPercent(value: number, max: number): number {
        if (max === 0) return 0;
        return Math.min((value / max) * 100, 100);
    }
}
