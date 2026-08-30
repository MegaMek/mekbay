// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary } from '../models/unit-summary.model';
import { getProperty, getUnitComponentData, getUnitCountableFilterData } from './unit-search-shared.util';

export interface AdvOptionsContextSnapshot {
    unitIds?: Set<string>;
    forcePackNames?: Set<string>;
    namesByFilterKey: Map<string, string[]>;
    availabilityNamesByFilterKey: Map<string, Set<string>>;
    countsByFilterKey?: Map<string, Map<string, number>>;
}

export function getAdvOptionsContextSnapshot(
    cache: WeakMap<UnitSummary[], AdvOptionsContextSnapshot>,
    units: UnitSummary[],
): AdvOptionsContextSnapshot {
    let snapshot = cache.get(units);
    if (!snapshot) {
        snapshot = {
            namesByFilterKey: new Map<string, string[]>(),
            availabilityNamesByFilterKey: new Map<string, Set<string>>(),
            countsByFilterKey: new Map<string, Map<string, number>>(),
        };
        cache.set(units, snapshot);
    }
    return snapshot;
}

export function getSnapshotUnitIds(snapshot: AdvOptionsContextSnapshot, units: UnitSummary[]): Set<string> {
    if (!snapshot.unitIds) {
        snapshot.unitIds = new Set(units.map(unit => unit.uuid));
    }
    return snapshot.unitIds;
}

export function getSnapshotForcePackNames(
    snapshot: AdvOptionsContextSnapshot,
    units: UnitSummary[],
    getForcePacksForUnit: (unit: UnitSummary) => Iterable<string>,
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
    units: UnitSummary[],
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
    units: UnitSummary[],
    isComponentFilter: boolean,
): string[] {
    ensureSnapshotFilterNames(snapshot, filterKey, units, isComponentFilter);
    return snapshot.namesByFilterKey.get(filterKey) ?? [];
}

export function getSnapshotAvailabilityNames(
    snapshot: AdvOptionsContextSnapshot,
    filterKey: string,
    units: UnitSummary[],
    isComponentFilter: boolean,
): Set<string> {
    ensureSnapshotFilterNames(snapshot, filterKey, units, isComponentFilter);
    return snapshot.availabilityNamesByFilterKey.get(filterKey) ?? new Set<string>();
}

export function getSnapshotCountableValues(
    snapshot: AdvOptionsContextSnapshot,
    filterKey: string,
    units: UnitSummary[],
): Map<string, number> {
    snapshot.countsByFilterKey ??= new Map<string, Map<string, number>>();
    let counts = snapshot.countsByFilterKey.get(filterKey);
    if (!counts) {
        counts = new Map<string, number>();

        for (const unit of units) {
            const data = getUnitCountableFilterData(unit, filterKey);
            for (const [name, count] of data?.counts ?? []) {
                counts.set(name, (counts.get(name) || 0) + count);
            }
        }

        snapshot.countsByFilterKey.set(filterKey, counts);
    }

    return counts;
}
