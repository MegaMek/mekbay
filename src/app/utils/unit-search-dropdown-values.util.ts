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
import type { AdvFilterConfig } from '../services/unit-search-filters.model';

export interface UnitSearchDropdownValuesDependencies {
    isIndexedUniverseKey: (filterKey: string) => boolean;
    getIndexedUniverseNames: (filterKey: string) => readonly string[];
    getExternalDropdownValues: (filterKey: string) => readonly string[];
    units: readonly Unit[];
    getProperty: (unit: Unit, key?: string) => unknown;
}

function getAvailableDropdownValues(
    conf: AdvFilterConfig,
    dependencies: UnitSearchDropdownValuesDependencies,
): Set<string> {
    if (dependencies.isIndexedUniverseKey(conf.key)) {
        return new Set(dependencies.getIndexedUniverseNames(conf.key));
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