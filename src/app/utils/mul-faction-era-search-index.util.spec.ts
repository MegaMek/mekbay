// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    createMulFactionEraSearchIndex,
    getMulFactionEraUnitUuids,
} from './mul-faction-era-search-index.util';
import { asUnitUuid } from '../services/unit-catalog/unit-catalog.types';

describe('mul-faction-era-search-index', () => {
    const unitOne = asUnitUuid('01900000-0000-7000-8000-000000000001');
    const unitOneAlternate = asUnitUuid('01900000-0000-7000-8000-000000000002');
    const unitTwo = asUnitUuid('01900000-0000-7000-8000-000000000003');
    const unitThree = asUnitUuid('01900000-0000-7000-8000-000000000004');
    const snapshot = {
        unitUuidsByMulId: {
            '1': [unitOne, unitOneAlternate],
            '2': [unitTwo],
            '3': [unitThree],
        },
        referenceIdsByEraAndFaction: {
            Succession: {
                Lyran: [1, 2],
                Kurita: [3],
            },
            Invasion: {
                Lyran: [2, 3],
            },
        },
    } as const;

    it('expands only requested exact faction-era memberships', () => {
        const index = createMulFactionEraSearchIndex(snapshot);

        expect(Array.from(getMulFactionEraUnitUuids(index, ['Succession'], ['Lyran'])))
            .toEqual([unitOne, unitOneAlternate, unitTwo]);
        expect(index.factionEraUnitIds.get('Succession')?.size).toBe(1);
        expect(index.factionEraUnitIds.has('Invasion')).toBeFalse();
    });

    it('unions multiple faction-era pairs without duplicate identities', () => {
        const index = createMulFactionEraSearchIndex(snapshot);

        expect(Array.from(getMulFactionEraUnitUuids(
            index,
            ['Succession', 'Invasion'],
            ['Lyran', 'Kurita'],
        ))).toEqual([unitOne, unitOneAlternate, unitTwo, unitThree]);
    });

    it('returns no memberships for an incomplete scope', () => {
        const index = createMulFactionEraSearchIndex(snapshot);

        expect(getMulFactionEraUnitUuids(index, [], ['Lyran']).size).toBe(0);
        expect(getMulFactionEraUnitUuids(index, ['Succession'], []).size).toBe(0);
    });
});
