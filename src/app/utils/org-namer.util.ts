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
import { resolveFromGroups, resolveFromUnits, EMPTY_RESULT } from './org-solver.util';
import type { GroupSizeResult } from './org-types';
import { type Force, UnitGroup } from '../models/force.model';
import { LoadForceEntry, type LoadForceGroup } from '../models/load-force-entry.model';
import type { Unit } from '../models/units.model';
import { getUnitsAverageTechBase, TechBase } from '../models/tech.model';

/*
 * Author: Drake
 *
 * Utility class to deteremine organization names.
 */

export function getOrgFromGroup(group: UnitGroup): GroupSizeResult[];
export function getOrgFromGroup(group: LoadForceGroup, factionName: string, techBase: TechBase): GroupSizeResult[];
export function getOrgFromGroup(group: UnitGroup | LoadForceGroup, factionName?: string, techBase?: TechBase): GroupSizeResult[] {
        if (group instanceof UnitGroup) {
            const force = group.force;
            const fn = force.faction()?.name ?? 'Mercenary';
            const allUnits = group.units().map(u => u.getUnit()).filter((u): u is Unit => u !== undefined);
            return resolveFromUnits(allUnits, force.techBase(), fn);
        }
        const units = group.units
            .filter((u): u is typeof u & { unit: Unit } => u.unit !== undefined)
            .map(u => u.unit);
        return resolveFromUnits(units, techBase!, factionName!);
    }

export function getOrgFromForce(force: Force): GroupSizeResult[];
export function getOrgFromForce(entry: LoadForceEntry, factionName: string): GroupSizeResult[];
export function getOrgFromForce(forceOrEntry: Force | LoadForceEntry, factionName?: string): GroupSizeResult[] {
    if (forceOrEntry instanceof LoadForceEntry) {
        const fn = factionName || '';
        const techBase = resolveTechBase(forceOrEntry.groups.flatMap(g => g.units), fn);
        const groupResults = forceOrEntry.groups
            .filter(g => g.units.some(u => u.unit !== undefined))
            .flatMap(g => getOrgFromGroup(g, fn, techBase));
        return resolveFromGroups(techBase, fn, groupResults);
    }
    const fn = forceOrEntry.faction()?.name ?? 'Mercenary';
    const techBase = forceOrEntry.techBase();
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
export function getOrgFromForceCollection(
        entries: LoadForceEntry[],
        factionName: string,
        childGroupResults?: GroupSizeResult[],
    ): GroupSizeResult[] {
        if (entries.length === 0) return [EMPTY_RESULT];
        const techBase = resolveTechBaseFromEntries(entries, factionName);
        const groupResults = childGroupResults
            ?? entries.flatMap(e => getOrgFromForce(e, factionName));
        return resolveFromGroups(techBase, factionName, groupResults);
    }

// ===== Utility =====

/** Resolve tech base from a flat array of LoadForceUnit-like objects. */
function resolveTechBase(units: { unit: Unit | undefined }[], factionName: string): TechBase {
    if (factionName.includes('ComStar') || factionName.includes('Word of Blake')) return 'Inner Sphere'; // not important
    const realUnits = units.filter((u): u is { unit: Unit } => u.unit !== undefined).map(u => u.unit);
    return getUnitsAverageTechBase(realUnits);
}

/** Resolve tech base from a set of LoadForceEntry instances. */
function resolveTechBaseFromEntries(entries: LoadForceEntry[], factionName: string): TechBase {
    return resolveTechBase(entries.flatMap(e => e.groups.flatMap(g => g.units)), factionName);
}