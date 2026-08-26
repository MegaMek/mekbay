// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    createMulFactionEraSearchIndex,
    getMulFactionEraUnitIdentityKeys,
} from './mul-faction-era-search-index.util';

describe('mul-faction-era-search-index', () => {
    const snapshot = {
        unitIdentityKeysByMulId: {
            '1': ['mul|one', 'custom|one'],
            '2': ['mul|two'],
            '3': ['mul|three'],
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

        expect(Array.from(getMulFactionEraUnitIdentityKeys(index, ['Succession'], ['Lyran'])))
            .toEqual(['mul|one', 'custom|one', 'mul|two']);
        expect(index.factionEraUnitIds.get('Succession')?.size).toBe(1);
        expect(index.factionEraUnitIds.has('Invasion')).toBeFalse();
    });

    it('unions multiple faction-era pairs without duplicate identities', () => {
        const index = createMulFactionEraSearchIndex(snapshot);

        expect(Array.from(getMulFactionEraUnitIdentityKeys(
            index,
            ['Succession', 'Invasion'],
            ['Lyran', 'Kurita'],
        ))).toEqual(['mul|one', 'custom|one', 'mul|two', 'mul|three']);
    });

    it('returns no memberships for an incomplete scope', () => {
        const index = createMulFactionEraSearchIndex(snapshot);

        expect(getMulFactionEraUnitIdentityKeys(index, [], ['Lyran']).size).toBe(0);
        expect(getMulFactionEraUnitIdentityKeys(index, ['Succession'], []).size).toBe(0);
    });
});
