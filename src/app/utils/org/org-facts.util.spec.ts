// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { compileUnitFactsList } from './org-facts.util';

describe('organization unit identity', () => {
    it('retains distinct UUIDs for units with shared or missing external MUL IDs', () => {
        const units = [null, 0, -1, 42, 42].map(mul1id => createEmptyUnit({ mul1id }));
        const facts = compileUnitFactsList(units);

        expect(facts.map(fact => fact.scalars.uuid)).toEqual(units.map(unit => unit.uuid));
        expect(new Set(facts.map(fact => fact.scalars.uuid)).size).toBe(units.length);
        expect(facts.every(fact => !('id' in fact.scalars))).toBeTrue();
    });
});
