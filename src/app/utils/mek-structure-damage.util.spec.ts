// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    mekStructureDamageCapacity,
    mekStructureDamageReceived,
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
            overflowDamage: 0,
        });
        expect(resolveMekStructureDamage(2, 1, 'composite')).toEqual({
            internalDamage: 1,
            overflowDamage: 1,
        });
    });

    it('keeps incoming phase damage while composite structure survives', () => {
        expect(resolveMekStructureDamage(1, 3, 'composite')).toEqual({
            internalDamage: 2,
            overflowDamage: 0,
        });
    });

    it('derives received damage cumulatively from marked pips and structure kind', () => {
        expect([0, 1, 2, 3].map(hits => mekStructureDamageReceived(5, hits, 'composite')))
            .toEqual([0, 1, 1, 2]);
        expect([0, 1, 2, 3].map(hits => mekStructureDamageReceived(4, hits, 'composite')))
            .toEqual([0, 0, 1, 1]);
        expect([0, 1, 2, 3].map(hits => mekStructureDamageReceived(6, hits, 'reinforced')))
            .toEqual([0, 0, 1, 1]);
        expect(mekStructureDamageReceived(5, 2, 'standard')).toBe(2);
    });

    it('records Reinforced Structure as integer half-pips and counts only completed circles', () => {
        expect(resolveMekStructureDamage(3, 6, 'reinforced')).toEqual({
            internalDamage: 3,
            overflowDamage: 0,
        });
        expect(resolveMekStructureDamage(1, 3, 'reinforced')).toEqual({
            internalDamage: 1,
            overflowDamage: 0,
        });
    });

    it('uses reinforced structure pips as two incoming damage points', () => {
        expect(resolveMekStructureDamage(5, 2, 'reinforced')).toEqual({
            internalDamage: 2,
            overflowDamage: 3,
        });
    });
});
