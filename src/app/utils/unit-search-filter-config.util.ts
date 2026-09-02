// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

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

    const semanticField = (config.semanticKey || config.key).toLowerCase();
    if (!advancedFilterConfigBySemanticField.has(semanticField)) {
        advancedFilterConfigBySemanticField.set(semanticField, config);
    }
}

const TECH_BASE_INTERNAL_KEY = '_techBaseDisplay';
const TECH_BASE_PUBLIC_KEY = 'tech';

export function normalizeUnitSearchPropertyKey(key: string): string {
    return key === TECH_BASE_PUBLIC_KEY || key === 'techBase' || key === TECH_BASE_INTERNAL_KEY
        ? TECH_BASE_INTERNAL_KEY
        : key;
}

export function getPublicUnitSearchPropertyKey(key: string): string {
    return key === TECH_BASE_INTERNAL_KEY ? TECH_BASE_PUBLIC_KEY : key;
}

export function getAdvancedFilterConfigByKey(key: string): AdvFilterConfig | undefined {
    return advancedFilterConfigByKey.get(key);
}

export function getAdvancedFilterConfigBySemanticField(field: string): AdvFilterConfig | undefined {
    return advancedFilterConfigBySemanticField.get(field.toLowerCase());
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

export function isComponentBackedDropdown(config: AdvFilterConfig | undefined): boolean {
    return getDropdownPropertyShape(config) === 'component';
}

export function isCountableBackedDropdown(config: AdvFilterConfig | undefined): boolean {
    const shape = getDropdownPropertyShape(config);
    return shape === 'component' || shape === 'countable';
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
