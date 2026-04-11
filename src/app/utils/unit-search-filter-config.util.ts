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

import type { AvailabilitySource } from '../models/options.model';
import {
    ADVANCED_FILTERS,
    type AdvFilterConfig,
    type DropdownAvailabilitySource,
    type DropdownFilterConfig,
    type DropdownOptionSource,
    type DropdownPropertyShape,
} from '../services/unit-search-filters.model';

const advancedFilterConfigByKey = new Map<string, AdvFilterConfig>();
const advancedFilterConfigBySemanticField = new Map<string, AdvFilterConfig>();

for (const config of ADVANCED_FILTERS) {
    advancedFilterConfigByKey.set(config.key, config);

    const semanticField = config.semanticKey || config.key;
    if (!advancedFilterConfigBySemanticField.has(semanticField)) {
        advancedFilterConfigBySemanticField.set(semanticField, config);
    }
}

export function getAdvancedFilterConfigByKey(key: string): AdvFilterConfig | undefined {
    return advancedFilterConfigByKey.get(key);
}

export function getAdvancedFilterConfigBySemanticField(field: string): AdvFilterConfig | undefined {
    return advancedFilterConfigBySemanticField.get(field);
}

export function isFilterAvailableForAvailabilitySource(
    config: Pick<AdvFilterConfig, 'availabilitySources'> | undefined,
    availabilitySource: AvailabilitySource,
): boolean {
    if (!config?.availabilitySources || config.availabilitySources.length === 0) {
        return true;
    }

    return config.availabilitySources.includes(availabilitySource);
}

export function isDropdownFilterConfig(config: AdvFilterConfig | undefined): config is AdvFilterConfig & DropdownFilterConfig {
    return config?.type === 'dropdown';
}

export function getDropdownOptionSource(config: AdvFilterConfig | undefined): DropdownOptionSource {
    if (!isDropdownFilterConfig(config)) {
        return 'context';
    }

    if (config.optionSource) {
        return config.optionSource;
    }

    return config.external ? 'external' : 'context';
}

export function getDropdownAvailabilitySource(config: AdvFilterConfig | undefined): DropdownAvailabilitySource {
    if (!isDropdownFilterConfig(config)) {
        return 'context';
    }

    return config.availabilitySource ?? 'context';
}

export function getDropdownPropertyShape(config: AdvFilterConfig | undefined): DropdownPropertyShape {
    if (!isDropdownFilterConfig(config)) {
        return 'scalar';
    }

    return config.propertyShape ?? 'scalar';
}

export function usesIndexedDropdownUniverse(config: AdvFilterConfig | undefined): boolean {
    return getDropdownOptionSource(config) === 'indexed';
}

export function usesIndexedDropdownAvailability(config: AdvFilterConfig | undefined): boolean {
    return getDropdownAvailabilitySource(config) === 'indexed';
}

export function isArrayBackedDropdown(config: AdvFilterConfig | undefined): boolean {
    const shape = getDropdownPropertyShape(config);
    return shape === 'array' || shape === 'component';
}

export function isComponentBackedDropdown(config: AdvFilterConfig | undefined): boolean {
    return getDropdownPropertyShape(config) === 'component';
}

export function getDropdownCapabilityMetadataErrors(configs: readonly AdvFilterConfig[] = ADVANCED_FILTERS): string[] {
    const errors: string[] = [];

    for (const config of configs) {
        if (!isDropdownFilterConfig(config)) {
            continue;
        }

        if (config.optionSource === undefined) {
            errors.push(`${config.key}: missing optionSource`);
        }
        if (config.availabilitySource === undefined) {
            errors.push(`${config.key}: missing availabilitySource`);
        }
        if (config.propertyShape === undefined) {
            errors.push(`${config.key}: missing propertyShape`);
        }
    }

    return errors;
}

const dropdownCapabilityMetadataErrors = getDropdownCapabilityMetadataErrors();

if (dropdownCapabilityMetadataErrors.length > 0) {
    throw new Error(
        `Dropdown filter capability metadata is incomplete:\n${dropdownCapabilityMetadataErrors.join('\n')}`,
    );
}