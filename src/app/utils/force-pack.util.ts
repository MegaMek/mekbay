// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Unit } from '../models/units.model';
import { getForcePacks } from '../models/forcepacks.model';
import type { DataService } from '../services/data.service';
import { getUnitVariantGroupKey } from './unit-variant.util';

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
