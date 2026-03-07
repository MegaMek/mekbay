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

import { ForceUnit } from '../models/force-unit.model';
import { Faction } from '../models/factions.model';
import { GameSystem } from '../models/common.model';
import { FormationTypeDefinition, FormationMatch } from './formation-type.model';
import { LanceTypeIdentifierUtil } from './lance-type-identifier.util';
import { getForceSizeName, getForceSizeNameForUnits, getForceSizeResultForUnits, getGroupSizeResult, getGroupSizeResultForUnits, GroupSizeResult } from './org-solver.util';
import { Force, UnitGroup } from '../models/force.model';
import { LoadForceEntry, LoadForceGroup } from '../models/load-force-entry.model';
import { Unit } from '../models/units.model';

/*
 * Author: Drake
 *
 * Formation (group-level) naming utilities.
 * Extracted from force-namer.util.ts for separate evolution.
 */

export interface FormationNameOptions {
    units: ForceUnit[];
    allUnits: ForceUnit[];
    faction: Faction | null;
    gameSystem: GameSystem;
}
export class FormationNamerUtil {

    /**
     * Returns the list of valid formation definitions for a group of units.
     * Each result includes whether it was matched via the Nova rule.
     */
    public static getAvailableFormationDefinitions(group: UnitGroup): FormationMatch[] {
         const targetForce = group.force;
         if (!targetForce) return [];
        const factionName = targetForce.faction()?.name ?? 'Mercenary';
        const isNova = group.sizeName()?.toLowerCase().includes('nova') ?? false;
        return LanceTypeIdentifierUtil.identifyFormations(group.units(), targetForce.techBase(), factionName, targetForce.gameSystem, isNova);
    }

    public static getFormationSizeResult(group: UnitGroup): GroupSizeResult;
    public static getFormationSizeResult(group: LoadForceGroup, factionName: string, techBase: string): GroupSizeResult;
    public static getFormationSizeResult(group: UnitGroup | LoadForceGroup, factionName?: string, techBase?: string): GroupSizeResult {
        if (group instanceof UnitGroup) {
            const force = group.force;
            const fn = force.faction()?.name ?? 'Mercenary';
            const isComStarOrWoB = fn.includes('ComStar') || fn.includes('Word of Blake');
            const tb = isComStarOrWoB ? '' : force.techBase();
            return getGroupSizeResult(group.units(), tb, fn);
        }
        const units = group.units
            .filter((u): u is typeof u & { unit: Unit } => u.unit !== undefined)
            .map(u => u.unit);
        return getGroupSizeResultForUnits(units, techBase!, factionName!);
    }

    public static getFormationSizeName(group: UnitGroup): string {
        return FormationNamerUtil.getFormationSizeResult(group).name;
    }

    public static getForceSizeResult(entry: LoadForceEntry, factionName: string): GroupSizeResult {
        const fn = factionName;
        const isComStarOrWoB = fn.includes('ComStar') || fn.includes('Word of Blake');
        const allUnits = entry.groups
            .flatMap(g => g.units)
            .filter((u): u is typeof u & { unit: Unit } => u.unit !== undefined)
            .map(u => u.unit);
        const techBase = isComStarOrWoB ? '' : FormationNamerUtil.deriveTechBase(allUnits);
        const groupResults = entry.groups
            .filter(g => g.units.some(u => u.unit !== undefined))
            .map(g => FormationNamerUtil.getFormationSizeResult(g, fn, techBase));
        return getForceSizeResultForUnits(allUnits, techBase, fn, groupResults);
    }

    public static getForceSizeName(force: Force): string;
    public static getForceSizeName(entry: LoadForceEntry, factionName: string): string;
    public static getForceSizeName(forceOrEntry: Force | LoadForceEntry, factionName?: string): string {
        if (forceOrEntry instanceof LoadForceEntry) {
            return FormationNamerUtil.getForceSizeResult(forceOrEntry, factionName!).name;
        }
        const fn = forceOrEntry.faction()?.name ?? 'Mercenary';
        const isComStarOrWoB = fn.includes('ComStar') || fn.includes('Word of Blake');
        const techBase = isComStarOrWoB ? '' : forceOrEntry.techBase();
        const groupResults = forceOrEntry.groups()
            .filter(g => g.units().length > 0)
            .map(g => g.sizeResult());
        return getForceSizeName(forceOrEntry.units(), techBase, fn, groupResults);
    }

    /**
     * Evaluate the org size result for an OrgGroup: a collection of LoadForceEntry instances
     * treated as sub-groups under one umbrella formation.
     */
    public static getOrgGroupSizeResult(entries: LoadForceEntry[], factionName: string): GroupSizeResult {
        if (entries.length === 0) return { name: 'Force', type: null, countsAsType: null };
        const isComStarOrWoB = factionName.includes('ComStar') || factionName.includes('Word of Blake');
        const allUnits = entries
            .flatMap(e => e.groups.flatMap(g => g.units))
            .filter((u): u is typeof u & { unit: Unit } => u.unit !== undefined)
            .map(u => u.unit);
        const techBase = isComStarOrWoB ? '' : FormationNamerUtil.deriveTechBase(allUnits);
        const forceResults = entries
            .map(e => FormationNamerUtil.getForceSizeResult(e, factionName));
        return getForceSizeResultForUnits(allUnits, techBase, factionName, forceResults);
    }

    /**
     * Evaluate the org name for an OrgGroup: a collection of LoadForceEntry instances
     * treated as sub-groups under one umbrella formation.
     */
    public static getOrgGroupSizeName(entries: LoadForceEntry[], factionName: string): string {
        return FormationNamerUtil.getOrgGroupSizeResult(entries, factionName).name;
    }

    /**
     * Evaluate the org name for a parent OrgGroup that contains child OrgGroups
     * and/or direct forces. Uses child group evaluations as intermediate
     * groupResults so that, e.g., 3 Companies => Battalion rather than
     * treating all descendant forces as individual Lances.
     */
    public static getOrgGroupSizeNameHierarchical(
        allEntries: LoadForceEntry[],
        childGroupResults: GroupSizeResult[],
        factionName: string,
    ): string {
        if (allEntries.length === 0) return 'Force';
        const isComStarOrWoB = factionName.includes('ComStar') || factionName.includes('Word of Blake');
        const allUnits = allEntries
            .flatMap(e => e.groups.flatMap(g => g.units))
            .filter((u): u is typeof u & { unit: Unit } => u.unit !== undefined)
            .map(u => u.unit);
        const techBase = isComStarOrWoB ? '' : FormationNamerUtil.deriveTechBase(allUnits);
        return getForceSizeNameForUnits(allUnits, techBase, factionName, childGroupResults);
    }

    /**
     * Determine the dominant faction name for a set of LoadForceEntry instances.
     * Priority: biggest BV (or PV if BV is 0), then most frequent, then first.
     */
    public static getDominantFactionName(
        entries: LoadForceEntry[],
        getFactionName: (factionId: number) => string | undefined,
    ): string {
        const entriesWithFaction = entries.filter(e => e.factionId !== undefined);
        if (entriesWithFaction.length === 0) return 'Mercenary';

        // Find the entry with the highest value (BV, or PV if BV is 0)
        let bestValue = -1;
        let bestFactionId: number | undefined;
        for (const e of entriesWithFaction) {
            const value = (e.bv && e.bv > 0) ? e.bv : (e.pv ?? 0);
            if (value > bestValue) {
                bestValue = value;
                bestFactionId = e.factionId;
            }
        }

        // If there's a clear value winner, use it
        if (bestValue > 0 && bestFactionId !== undefined) {
            // Check if there's a tie
            const tiedEntries = entriesWithFaction.filter(e => {
                const v = (e.bv && e.bv > 0) ? e.bv : (e.pv ?? 0);
                return v === bestValue;
            });
            if (tiedEntries.length === 1) {
                return getFactionName(bestFactionId) ?? 'Mercenary';
            }
            // Tie — fall through to frequency
        }

        // Count faction frequency
        const counts = new Map<number, number>();
        for (const e of entriesWithFaction) {
            counts.set(e.factionId!, (counts.get(e.factionId!) ?? 0) + 1);
        }
        let maxCount = 0;
        let mostFrequentId: number | undefined;
        let tied = false;
        for (const [fid, count] of counts) {
            if (count > maxCount) {
                maxCount = count;
                mostFrequentId = fid;
                tied = false;
            } else if (count === maxCount) {
                tied = true;
            }
        }
        if (!tied && mostFrequentId !== undefined) {
            return getFactionName(mostFrequentId) ?? 'Mercenary';
        }

        // Still tied — pick first
        return getFactionName(entriesWithFaction[0].factionId!) ?? 'Mercenary';
    }

    /** Derive the majority tech base from a set of raw Unit objects. */
    static deriveTechBase(units: Unit[]): string {
        const counts: Record<string, number> = {};
        for (const u of units) {
            if (u.techBase === 'Mixed') {
                counts['Clan'] = (counts['Clan'] || 0) + 1;
                counts['Inner Sphere'] = (counts['Inner Sphere'] || 0) + 1;
            } else {
                counts[u.techBase] = (counts[u.techBase] || 0) + 1;
            }
        }
        let majority = 'Inner Sphere';
        let max = 0;
        for (const [tb, count] of Object.entries(counts)) {
            if (count > max) { majority = tb; max = count; }
        }
        return majority;
    }

    /**
     * Composes the display name for a formation definition given the group context.
     * When `novaFiltered` is true, appends a `*` to indicate the Nova rule was applied.
     */
    public static composeFormationDisplayName(
        definition: FormationTypeDefinition,
        group: UnitGroup,
        novaFiltered: boolean = false,
    ): string {
        const sizeName = group.sizeName();
        const suffix = novaFiltered ? ' *' : '';
        if (sizeName && definition.name.includes(sizeName)) {
            return definition.name + suffix;
        }
        if (sizeName?.includes('Level')) {
            return sizeName + ' - ' + definition.name + suffix;
        }
        return definition.name + ' ' + sizeName + suffix;
    }
}
