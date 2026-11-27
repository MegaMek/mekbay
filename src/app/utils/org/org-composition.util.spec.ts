// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { materializeComposedCountRule } from './org-composition.util';
import { compileGroupFacts } from './org-facts.util';
import type { GroupSizeResult, OrgComposedCountRule } from './org-types';

describe('organization counted composition', () => {
    it('matches the independent maximum for overlapping roles and preserves each selected child', () => {
        const rule: OrgComposedCountRule = {
            kind: 'composed-count', type: 'Company', tier: 2, modifiers: { '': 2 },
            childRoles: [
                { matches: ['Augmented Lance'], min: 1, max: 1 },
                { matches: ['Augmented Lance', 'Lance'], min: 1, max: 1 },
            ],
        };
        for (let augmented = 0; augmented <= 7; augmented++) for (let regular = 0; regular <= 7; regular++) {
            const groups: GroupSizeResult[] = Array.from({ length: augmented + regular }, (_, index) => ({
                name: index < augmented ? 'Augmented Lance' : 'Lance',
                type: index < augmented ? 'Augmented Lance' : 'Lance',
                modifierKey: '', countsAsType: null, tier: 1,
                units: [createEmptyUnit({ mul1id: index, tons: 20 + index * 5 })],
            }));
            for (const input of [groups, [...groups].reverse()]) {
                const result = materializeComposedCountRule(rule, input.map(group => compileGroupFacts(group)));
                // Every company needs two children and at least one augmented lance.
                expect(result.groups.length).withContext(`${augmented} augmented, ${regular} regular`)
                    .toBe(Math.min(augmented, Math.floor(groups.length / 2)));
                const children = result.groups.flatMap(group => group.children ?? []);
                const all = [...children, ...result.leftoverGroupFacts.map(facts => facts.group)];
                expect(all.length).toBe(groups.length);
                expect(new Set(all)).toEqual(new Set(groups));
                for (const company of result.groups) {
                    expect(company.children?.length).toBe(2);
                    expect(company.children?.some(child => child.type === 'Augmented Lance')).toBeTrue();
                }
            }
        }
    });
});
