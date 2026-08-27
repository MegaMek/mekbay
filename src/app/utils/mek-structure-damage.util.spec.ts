// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    mekStructureDamageCapacity,
    mekStructurePhaseDamage,
    resolveMekStructureDamage,
} from './mek-structure-damage.util';

describe('Mek structure damage', () => {
    it('reports the integer damage threshold for alternate structure', () => {
        expect(mekStructureDamageCapacity(5, 'composite')).toBe(3);
        expect(mekStructureDamageCapacity(5, 'reinforced')).toBe(5);
        expect(mekStructureDamageCapacity(5, 'standard')).toBe(5);
    });

    it('drops the unusable half point when odd composite structure is destroyed', () => {
        expect(resolveMekStructureDamage(2, 3, 'composite')).toEqual({
            internalDamage: 3,
            phaseDamage: 3,
            overflowDamage: 0,
        });
        expect(resolveMekStructureDamage(2, 1, 'composite')).toEqual({
            internalDamage: 1,
            phaseDamage: 1,
            overflowDamage: 1,
        });
    });

    it('keeps incoming phase damage while composite structure survives', () => {
        expect(resolveMekStructureDamage(1, 3, 'composite')).toEqual({
            internalDamage: 2,
            phaseDamage: 1,
            overflowDamage: 0,
        });
    });

    it('derives phase damage from applied pips, remaining structure, and structure kind', () => {
        expect(mekStructurePhaseDamage(2, 6, 'composite')).toBe(1);
        expect(mekStructurePhaseDamage(3, 3, 'composite')).toBe(3);
        expect(mekStructurePhaseDamage(1, 6, 'reinforced')).toBe(0);
        expect(mekStructurePhaseDamage(1, 5, 'reinforced')).toBe(1);
        expect(mekStructurePhaseDamage(2, 6, 'standard')).toBe(2);
    });

    it('records Reinforced Structure as integer half-pips and counts only completed circles', () => {
        expect(resolveMekStructureDamage(3, 6, 'reinforced')).toEqual({
            internalDamage: 3,
            phaseDamage: 1,
            overflowDamage: 0,
        });
        expect(resolveMekStructureDamage(1, 3, 'reinforced')).toEqual({
            internalDamage: 1,
            phaseDamage: 1,
            overflowDamage: 0,
        });
    });

    it('uses reinforced structure pips as two incoming damage points', () => {
        expect(resolveMekStructureDamage(5, 2, 'reinforced')).toEqual({
            internalDamage: 2,
            phaseDamage: 1,
            overflowDamage: 3,
        });
    });
});
