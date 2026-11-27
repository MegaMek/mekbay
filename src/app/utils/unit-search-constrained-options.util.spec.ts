// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MultiStateSelection } from '../components/multi-select-dropdown/multi-select-dropdown.component';
import type { UnitSummary } from '../models/unit-summary.model';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { collectConstrainedMultistateAvailabilityNames } from './unit-search-constrained-options.util';

function optionIndex(memberships: Record<string, readonly UnitSummary[]> = {}) {
    const ids = new Map(Object.entries(memberships).map(([name, units]) => [name, new Set(units.map(unit => unit.uuid))]));
    return {
        getDropdownOptionUniverse: () => Object.keys(memberships).map(name => ({ name })),
        getIndexedUnitIds: (_key: string, name: string) => ids.get(name),
        getIndexedASSpecials: () => undefined,
    };
}

describe('constrained dropdown co-selections', () => {
    it('leaves OR-only selections unconstrained', () => {
        expect(collectConstrainedMultistateAvailabilityNames('features', [], {
            A: { name: 'A', state: 'or', count: 1 },
        }, false, optionIndex())).toBeNull();
    });

    for (const indexed of [false, true]) {
        it(`keeps AND co-matches inside the current context and excludes NOT matches (${indexed ? 'indexed' : 'scan'})`, () => {
            const a = createEmptyUnit({ features: ['A', 'B'] });
            const b = createEmptyUnit({ features: ['A', 'Excluded'] });
            const c = createEmptyUnit({ features: ['C'] });
            const outside = createEmptyUnit({ features: ['A', 'Outside'] });
            const selection: MultiStateSelection = {
                A: { name: 'A', state: 'and', count: 1 },
                excluded: { name: 'Excluded', state: 'not', count: 1 },
                C: { name: 'C', state: 'or', count: 1 },
            };
            const index = optionIndex(indexed ? { A: [a, b, outside], B: [a], Excluded: [b], C: [c], Outside: [outside] } : {});

            expect([...collectConstrainedMultistateAvailabilityNames('features', [a, b, c], selection, false, index)!])
                .toEqual(['A', 'B']);
            if (indexed) expect(index.getIndexedUnitIds('features', 'A')?.size).toBe(3);
        });
    }

    it('honors required counts and returns normalized countable names', () => {
        const units = [
            createEmptyUnit({ _weaponTypeCounts: { E: 2, M: 1 } }),
            createEmptyUnit({ _weaponTypeCounts: { E: 1, F: 1 } }),
            createEmptyUnit({ _weaponTypeCounts: { E: 3, B: 1 } }),
        ];
        const names = collectConstrainedMultistateAvailabilityNames('weaponType', units, {
            E: { name: 'E', state: 'and', count: 2 },
            B: { name: 'B', state: 'not', count: 1 },
        }, true, optionIndex());

        expect([...names!]).toEqual(['e', 'm']);
    });

    it('checks numeric Alpha Strike requirements after narrowing by the ability index', () => {
        const strong = createEmptyUnit({ as: { specials: ['IF2', 'TSM'] } });
        const weak = createEmptyUnit({ as: { specials: ['IF1', 'ECM'] } });
        const excluded = createEmptyUnit({ as: { specials: ['IF3', 'TAG'] } });
        const names = collectConstrainedMultistateAvailabilityNames('as.specials', [strong, weak, excluded], {
            IF: { name: 'IF', state: 'and', count: 1, minimumValues: [2] },
            TAG: { name: 'TAG', state: 'not', count: 1 },
        }, false, optionIndex({ IF: [strong, weak, excluded], TSM: [strong], ECM: [weak], TAG: [excluded] }));

        expect([...names!]).toEqual(['IF', 'TSM']);
    });
});
