// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    createMulFactionEraSearchIndex,
    getMulFactionEraUnitUuids,
} from './mul-faction-era-search-index.util';

describe('mul-faction-era-search-index', () => {
    const snapshot = {
        unitUuidsByMulId: {
            '1': ['unit-one', 'unit-one-alternate'],
            '2': ['unit-two'],
            '3': ['unit-three'],
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
            .toEqual(['unit-one', 'unit-one-alternate', 'unit-two']);
        expect(index.factionEraUnitIds.get('Succession')?.size).toBe(1);
        expect(index.factionEraUnitIds.has('Invasion')).toBeFalse();
    });

    it('unions multiple faction-era pairs without duplicate identities', () => {
        const index = createMulFactionEraSearchIndex(snapshot);

        expect(Array.from(getMulFactionEraUnitUuids(
            index,
            ['Succession', 'Invasion'],
            ['Lyran', 'Kurita'],
        ))).toEqual(['unit-one', 'unit-one-alternate', 'unit-two', 'unit-three']);
    });

    it('returns no memberships for an incomplete scope', () => {
        const index = createMulFactionEraSearchIndex(snapshot);

        expect(getMulFactionEraUnitUuids(index, [], ['Lyran']).size).toBe(0);
        expect(getMulFactionEraUnitUuids(index, ['Succession'], []).size).toBe(0);
    });
});
