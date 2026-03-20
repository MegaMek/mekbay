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

import type { Unit } from '../models/units.model';
import { getProperty, getUnitComponentData } from './unit-search-shared.util';

export interface AdvOptionsContextSnapshot {
    unitIds?: Set<string>;
    forcePackNames?: Set<string>;
    namesByFilterKey: Map<string, string[]>;
    availabilityNamesByFilterKey: Map<string, Set<string>>;
    componentCounts?: Map<string, number>;
}

export function getAdvOptionsContextSnapshot(
    cache: WeakMap<Unit[], AdvOptionsContextSnapshot>,
    units: Unit[],
): AdvOptionsContextSnapshot {
    let snapshot = cache.get(units);
    if (!snapshot) {
        snapshot = {
            namesByFilterKey: new Map<string, string[]>(),
            availabilityNamesByFilterKey: new Map<string, Set<string>>(),
        };
        cache.set(units, snapshot);
    }
    return snapshot;
}

export function getSnapshotUnitIds(snapshot: AdvOptionsContextSnapshot, units: Unit[]): Set<string> {
    if (!snapshot.unitIds) {
        snapshot.unitIds = new Set(units.map(unit => unit.name));
    }
    return snapshot.unitIds;
}

export function getSnapshotForcePackNames(
    snapshot: AdvOptionsContextSnapshot,
    units: Unit[],
    getForcePacksForUnit: (unit: Unit) => Iterable<string>,
): Set<string> {
    if (!snapshot.forcePackNames) {
        const packNames = new Set<string>();
        for (const unit of units) {
            for (const packName of getForcePacksForUnit(unit)) {
                packNames.add(packName);
            }
        }
        snapshot.forcePackNames = packNames;
    }
    return snapshot.forcePackNames;
}

function ensureSnapshotFilterNames(
    snapshot: AdvOptionsContextSnapshot,
    filterKey: string,
    units: Unit[],
    isComponentFilter: boolean,
): void {
    if (snapshot.namesByFilterKey.has(filterKey) && snapshot.availabilityNamesByFilterKey.has(filterKey)) {
        return;
    }

    if (isComponentFilter) {
        const originalNamesByNormalized = new Map<string, string>();
        for (const unit of units) {
            for (const component of unit.comp) {
                const normalizedName = component.n.toLowerCase();
                if (!originalNamesByNormalized.has(normalizedName)) {
                    originalNamesByNormalized.set(normalizedName, component.n);
                }
            }
        }

        snapshot.namesByFilterKey.set(filterKey, Array.from(originalNamesByNormalized.values()));
        snapshot.availabilityNamesByFilterKey.set(filterKey, new Set(originalNamesByNormalized.keys()));
        return;
    }

    const names: string[] = [];
    const availableNames = new Set<string>();

    for (const unit of units) {
        const propValue = getProperty(unit, filterKey);
        const values = Array.isArray(propValue) ? propValue : [propValue];
        for (const value of values) {
            if (value == null || value === '') {
                continue;
            }

            const stringValue = String(value);
            if (!availableNames.has(stringValue)) {
                availableNames.add(stringValue);
                names.push(stringValue);
            }
        }
    }

    snapshot.namesByFilterKey.set(filterKey, names);
    snapshot.availabilityNamesByFilterKey.set(filterKey, availableNames);
}

export function getSnapshotAvailableNames(
    snapshot: AdvOptionsContextSnapshot,
    filterKey: string,
    units: Unit[],
    isComponentFilter: boolean,
): string[] {
    ensureSnapshotFilterNames(snapshot, filterKey, units, isComponentFilter);
    return snapshot.namesByFilterKey.get(filterKey) ?? [];
}

export function getSnapshotAvailabilityNames(
    snapshot: AdvOptionsContextSnapshot,
    filterKey: string,
    units: Unit[],
    isComponentFilter: boolean,
): Set<string> {
    ensureSnapshotFilterNames(snapshot, filterKey, units, isComponentFilter);
    return snapshot.availabilityNamesByFilterKey.get(filterKey) ?? new Set<string>();
}

export function getSnapshotComponentCounts(snapshot: AdvOptionsContextSnapshot, units: Unit[]): Map<string, number> {
    if (!snapshot.componentCounts) {
        const counts = new Map<string, number>();

        for (const unit of units) {
            const cached = getUnitComponentData(unit);
            for (const [name, count] of cached.counts) {
                counts.set(name, (counts.get(name) || 0) + count);
            }
        }

        snapshot.componentCounts = counts;
    }

    return snapshot.componentCounts;
}