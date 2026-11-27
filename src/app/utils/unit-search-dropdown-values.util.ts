// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary } from '../models/unit-summary.model';
import type { AdvFilterConfig } from '../services/unit-search-filters.model';
import { usesIndexedDropdownUniverse } from './unit-search-filter-config.util';

export interface UnitSearchDropdownValuesDependencies {
    getDropdownOptionUniverse: (filterKey: string) => readonly string[];
    getExternalDropdownValues: (filterKey: string) => readonly string[];
    units: readonly UnitSummary[];
    getProperty: (unit: UnitSummary, key?: string) => unknown;
}

function getAvailableDropdownValues(
    conf: AdvFilterConfig,
    dependencies: UnitSearchDropdownValuesDependencies,
): Set<string> {
    if (usesIndexedDropdownUniverse(conf)) {
        return new Set(dependencies.getDropdownOptionUniverse(conf.key));
    }

    const values = new Set<string>();

    if (conf.external) {
        for (const value of dependencies.getExternalDropdownValues(conf.key)) {
            values.add(value);
        }
        return values;
    }

    for (const unit of dependencies.units) {
        const propValue = dependencies.getProperty(unit, conf.key);
        const unitValues = Array.isArray(propValue) ? propValue : [propValue];
        for (const value of unitValues) {
            if (value != null && value !== '') {
                values.add(String(value));
            }
        }
    }

    return values;
}

export function getAvailableDropdownValuesMap(
    conf: AdvFilterConfig,
    dependencies: UnitSearchDropdownValuesDependencies,
): Map<string, string> {
    const values = getAvailableDropdownValues(conf, dependencies);
    const map = new Map<string, string>();
    for (const value of values) {
        map.set(value.toLowerCase(), value);
    }
    return map;
}
