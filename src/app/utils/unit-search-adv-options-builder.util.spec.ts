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

import { GameSystem } from '../models/common.model';
import { ADVANCED_FILTERS } from '../services/unit-search-filters.model';
import { buildUnitSearchAdvOptions } from './unit-search-adv-options-builder.util';

describe('buildUnitSearchAdvOptions', () => {
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