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
import { resolveFromGroups, resolveFromUnits } from './org-solver.util';
import type { GroupSizeResult } from './org-types';
import { type Force, UnitGroup } from '../models/force.model';
import { LoadForceEntry, type LoadForceGroup } from '../models/load-force-entry.model';
import type { Unit } from '../models/units.model';

/*
 * Author: Drake
 *
 * Utility class to deteremine organization names.
 */

export class OrgNamerUtil {

    private static readonly EMPTY_RESULT: GroupSizeResult = { name: 'Force', type: null, countsAsType: null, tier: 0 };

    public static getOrgFromGroup(group: UnitGroup): GroupSizeResult[];
    public static getOrgFromGroup(group: LoadForceGroup, factionName: string, techBase: string): GroupSizeResult[];
    public static getOrgFromGroup(group: UnitGroup | LoadForceGroup, factionName?: string, techBase?: string): GroupSizeResult[] {
        if (group instanceof UnitGroup) {
            const force = group.force;
            const fn = force.faction()?.name ?? 'Mercenary';
            const isComStarOrWoB = fn.includes('ComStar') || fn.includes('Word of Blake');
            const tb = isComStarOrWoB ? '' : force.techBase();
            const allUnits = group.units().map(u => u.getUnit()).filter((u): u is Unit => u !== undefined);
            return resolveFromUnits(allUnits, tb, fn);
        }
        const units = group.units
            .filter((u): u is typeof u & { unit: Unit } => u.unit !== undefined)
            .map(u => u.unit);
        return resolveFromUnits(units, techBase!, factionName!);
    }

    public static getOrgFromForce(force: Force): GroupSizeResult[];
    public static getOrgFromForce(entry: LoadForceEntry, factionName: string): GroupSizeResult[];
    public static getOrgFromForce(forceOrEntry: Force | LoadForceEntry, factionName?: string): GroupSizeResult[] {
        if (forceOrEntry instanceof LoadForceEntry) {
            const fn = factionName || '';
            const techBase = this.resolveTechBase(forceOrEntry.groups.flatMap(g => g.units), fn);
            const groupResults = forceOrEntry.groups
                .filter(g => g.units.some(u => u.unit !== undefined))
                .flatMap(g => this.getOrgFromGroup(g, fn, techBase));
            return resolveFromGroups(techBase, fn, groupResults);
        }
        const fn = forceOrEntry.faction()?.name ?? 'Mercenary';
        const isComStarOrWoB = fn.includes('ComStar') || fn.includes('Word of Blake');
        const techBase = isComStarOrWoB ? '' : forceOrEntry.techBase();
        const groupResults = forceOrEntry.groups()
            .filter(g => g.units().length > 0)
            .flatMap(g => g.sizeResult() ?? []);
        return resolveFromGroups(techBase, fn, groupResults);
    }

    /**
     * Evaluate the org size result for a collection of LoadForceEntry instances.
     * If childGroupResults are provided, they are used as pre-computed sub-group
     * results (hierarchical mode). Otherwise, each entry is evaluated individually
     * and their results are used as sub-groups (flat mode).
     */
    public static getOrgFromForceCollection(
        entries: LoadForceEntry[],
        factionName: string,
        childGroupResults?: GroupSizeResult[],
    ): GroupSizeResult[] {
        if (entries.length === 0) return [this.EMPTY_RESULT];
        const techBase = this.resolveTechBaseFromEntries(entries, factionName);
        const groupResults = childGroupResults
            ?? entries.flatMap(e => this.getOrgFromForce(e, factionName));
        return resolveFromGroups(techBase, factionName, groupResults);
    }

    // ===== Utility methods =====

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

    /** Resolve tech base from a flat array of LoadForceUnit-like objects. */
    private static resolveTechBase(units: { unit: Unit | undefined }[], factionName: string): string {
        if (factionName.includes('ComStar') || factionName.includes('Word of Blake')) return '';
        const realUnits = units.filter((u): u is { unit: Unit } => u.unit !== undefined).map(u => u.unit);
        return this.deriveTechBase(realUnits);
    }

    /** Resolve tech base from a set of LoadForceEntry instances. */
    static resolveTechBaseFromEntries(entries: LoadForceEntry[], factionName: string): string {
        return this.resolveTechBase(entries.flatMap(e => e.groups.flatMap(g => g.units)), factionName);
    }
}
