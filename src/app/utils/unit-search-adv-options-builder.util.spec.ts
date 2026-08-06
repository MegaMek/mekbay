// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem } from '../models/common.model';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { ADVANCED_FILTERS } from '../services/unit-search-filters.model';
import { buildUnitSearchAdvOptions } from './unit-search-adv-options-builder.util';

describe('buildUnitSearchAdvOptions', () => {
    it('marks canonical weapon types available from derived unit fields', () => {
        const weaponTypeFilter = ADVANCED_FILTERS.find(filter => filter.key === 'weaponType');
        expect(weaponTypeFilter).toBeDefined();

        const unit = createEmptyUnit({
            name: 'Anti-Infantry Unit',
            _weaponTypes: ['AI'],
            _weaponTypeCounts: { AI: 2 },
        });
        const result = buildUnitSearchAdvOptions({
            advancedFilters: [weaponTypeFilter!],
            state: {
                weaponType: {
                    value: {
                        AI: { name: 'AI', state: 'or', count: 1, countOperator: '>=' },
                    },
                    interactedWith: true,
                },
            },
            units: [unit],
            queryText: '',
            textSearch: '',
            isComplexQuery: false,
            totalRanges: {},
            dynamicInternalLabel: 'Internal',
            gameSystem: GameSystem.CLASSIC,
            getUnitFilterKernelDependencies: () => ({
                getProperty: () => undefined,
                getAdjustedBV: () => 0,
                getAdjustedPV: () => 0,
                getUnitIdsForExternalFilters: () => null,
                getPositiveFactionNames: () => [],
                unitMatchesAvailabilityFrom: () => false,
                unitMatchesAvailabilityRarity: () => false,
                getForcePackLookupSet: () => undefined,
                getAvailabilityLookupKey: () => '',
            }),
            buildIndexedDropdownOptions: () => [
                { name: 'AI', displayName: 'Anti-Infantry', available: true },
            ],
            buildForcePackDropdownOptions: () => [],
            getIndexedUniverseNames: () => ['AI'],
            getSortedIndexedUniverseNames: () => ['AI'],
            collectIndexedAvailabilityNames: () => new Set<string>(),
            collectConstrainedMultistateAvailabilityNames: () => null,
            getAvailableRangeForUnits: () => [0, 0],
            getDisplayName: () => 'Anti-Infantry',
        });

        expect(result.options['weaponType'].options).toEqual([
            jasmine.objectContaining({
                name: 'AI',
                displayName: 'Anti-Infantry',
                available: true,
                count: 2,
            }),
        ]);
    });

    it('keeps wildcard-only multistate semantic filters visible in dropdown display items', () => {
        const factionFilter = ADVANCED_FILTERS.find(filter => filter.key === 'faction');
        expect(factionFilter).toBeDefined();

        const result = buildUnitSearchAdvOptions({
            advancedFilters: [factionFilter!],
            state: {
                faction: {
                    value: {},
                    interactedWith: true,
                    wildcardPatterns: [{ pattern: 'Capellan *', state: 'or' }],
                    semanticOnly: true,
                    exclusive: true,
                },
            },
            units: [],
            queryText: 'faction=="Capellan *"',
            textSearch: '',
            isComplexQuery: false,
            totalRanges: {},
            dynamicInternalLabel: 'Internal',
            gameSystem: GameSystem.CLASSIC,
            getUnitFilterKernelDependencies: () => ({
                getProperty: () => undefined,
                getAdjustedBV: () => 0,
                getAdjustedPV: () => 0,
                getUnitIdsForExternalFilters: () => null,
                getPositiveFactionNames: () => [],
                unitMatchesAvailabilityFrom: () => false,
                unitMatchesAvailabilityRarity: () => false,
                getForcePackLookupSet: () => undefined,
                getAvailabilityLookupKey: () => '',
            }),
            buildIndexedDropdownOptions: () => [
                { name: 'Capellan Confederation', available: false },
            ],
            buildForcePackDropdownOptions: () => [],
            getIndexedUniverseNames: () => ['Capellan Confederation'],
            getSortedIndexedUniverseNames: () => ['Capellan Confederation'],
            collectIndexedAvailabilityNames: () => new Set<string>(),
            collectConstrainedMultistateAvailabilityNames: () => null,
            getAvailableRangeForUnits: () => [0, 0],
            getDisplayName: () => undefined,
        });

        expect(result.options['faction']).toEqual(jasmine.objectContaining({
            semanticOnly: true,
            displayText: '==Capellan *',
            displayItems: [
                { text: '==Capellan *', state: 'or' },
            ],
        }));
    });

    it('keeps wildcard-only multistate semantic filters visible when options come from a custom builder path', () => {
        const factionFilter = ADVANCED_FILTERS.find(filter => filter.key === 'faction');
        expect(factionFilter).toBeDefined();

        const result = buildUnitSearchAdvOptions({
            advancedFilters: [factionFilter!],
            state: {
                faction: {
                    value: {},
                    interactedWith: true,
                    wildcardPatterns: [{ pattern: 'Capellan *', state: 'or' }],
                    semanticOnly: true,
                    exclusive: true,
                },
            },
            units: [],
            queryText: 'faction=="Capellan *"',
            textSearch: '',
            isComplexQuery: false,
            totalRanges: {},
            dynamicInternalLabel: 'Internal',
            gameSystem: GameSystem.CLASSIC,
            getUnitFilterKernelDependencies: () => ({
                getProperty: () => undefined,
                getAdjustedBV: () => 0,
                getAdjustedPV: () => 0,
                getUnitIdsForExternalFilters: () => null,
                getPositiveFactionNames: () => [],
                unitMatchesAvailabilityFrom: () => false,
                unitMatchesAvailabilityRarity: () => false,
                getForcePackLookupSet: () => undefined,
                getAvailabilityLookupKey: () => '',
            }),
            buildIndexedDropdownOptions: () => [],
            buildForcePackDropdownOptions: () => [],
            buildCustomDropdownOptions: () => [
                { name: 'Capellan Confederation', available: false },
            ],
            getIndexedUniverseNames: () => ['Capellan Confederation'],
            getSortedIndexedUniverseNames: () => ['Capellan Confederation'],
            collectIndexedAvailabilityNames: () => new Set<string>(),
            collectConstrainedMultistateAvailabilityNames: () => null,
            getAvailableRangeForUnits: () => [0, 0],
            getDisplayName: () => undefined,
        });

        expect(result.options['faction']).toEqual(jasmine.objectContaining({
            semanticOnly: true,
            displayText: '==Capellan *',
            displayItems: [
                { text: '==Capellan *', state: 'or' },
            ],
        }));
    });
});