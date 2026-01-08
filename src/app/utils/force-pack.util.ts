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

import { Unit } from '../models/units.model';
import { getForcePacks } from '../models/forcepacks.model';
import { DataService } from '../services/data.service';

export type PackUnitEntry = {
    chassis: string;
    model?: string;
    unit?: Unit | null;
};

export type ResolvedPack = {
    name: string;
    units: PackUnitEntry[];
    _searchText: string;
    bv: number;
    pv: number;
    variantName?: string;
};

export function resolveForcePackUnits(
    unitList: Array<{ name: string }>,
    dataService: DataService
): PackUnitEntry[] {
    return unitList.map(u => {
        const found = dataService.getUnitByName(u.name);

        return {
            chassis: found?.chassis ?? 'NOT FOUND',
            model: found?.model ?? u.name,
            unit: found ?? null
        } as PackUnitEntry;
    });
}

export function resolveForcePacks(dataService: DataService): ResolvedPack[] {
    const resolved: ResolvedPack[] = [];

    for (const p of getForcePacks()) {
        const baseEntries = resolveForcePackUnits(p.units, dataService);
        resolved.push({
            name: p.name,
            units: baseEntries,
            bv: baseEntries.reduce((sum, e) => sum + (e.unit?.bv || 0), 0),
            pv: baseEntries.reduce((sum, e) => sum + (e.unit?.as.PV || 0), 0),
            _searchText: p.name.toLowerCase() + ' ' + baseEntries.map(e => [e.chassis, e.model].filter(Boolean).join(' ')).join(' ').toLowerCase()
        });

        if (p.variants && p.variants.length > 0) {
            for (const variant of p.variants) {
                const variantEntries = resolveForcePackUnits(variant.units, dataService);
                resolved.push({
                    name: p.name,
                    variantName: variant.name,
                    units: variantEntries,
                    bv: variantEntries.reduce((sum, e) => sum + (e.unit?.bv || 0), 0),
                    pv: variantEntries.reduce((sum, e) => sum + (e.unit?.as.PV || 0), 0),
                    _searchText: `${p.name} ${variant.name}`.toLowerCase() + ' ' + variantEntries.map(e => [e.chassis, e.model].filter(Boolean).join(' ')).join(' ').toLowerCase()
                });
            }
        }
    }

    return resolved;
}
