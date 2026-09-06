// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { projectInfantryStrengthCells,type InfantryStrengthFacts } from './infantry-strength-projection';

describe('infantry aggregate strength projection', () => {
    it('uses thirty exact strength cells and preserves aggregate damage counts', () => {
        const facts: InfantryStrengthFacts = { maximum: 30, committedRemaining: 25, previewRemaining: 23 };
        const cells = projectInfantryStrengthCells(facts);
        expect(cells.length).toBe(30);
        expect(cells.map(cell => cell.strength)).toEqual(Array.from({ length: 30 }, (_, index) => 30 - index));
        expect(cells.filter(cell => cell.state === 'alive').length).toBe(23);
        expect(cells.filter(cell => cell.state === 'damaged').length).toBe(2);
        expect(cells.filter(cell => cell.state === 'committed').length).toBe(5);
    });

    it('uses aggregate current and prior counts for pending, fresh and restored visuals', () => {
        const pending = projectInfantryStrengthCells({ maximum: 4, committedRemaining: 3, previewRemaining: 2 });
        expect(pending[26]!.state).toBe('committed');
        expect(pending[27]!.state).toBe('damaged');
        expect(pending[28]!.state).toBe('alive');
        const fresh = projectInfantryStrengthCells({ maximum: 4, committedRemaining: 3, previewRemaining: 2 }, 3);
        expect(fresh[27]!.state).toBe('fresh');
        const repair = projectInfantryStrengthCells({ maximum: 4, committedRemaining: 2, previewRemaining: 3 }, 2);
        expect(repair[27]!.state).toBe('restored');
        expect(repair[27]!.committedDamaged).toBeTrue();
    });

    it('marks only unused strength choices inert', () => {
        const cells = projectInfantryStrengthCells({ maximum: 4, committedRemaining: 3, previewRemaining: 3 });
        expect(cells.filter(cell => cell.available).length).toBe(4);
        expect(cells.filter(cell => cell.available).map(cell => cell.strength)).toEqual([4, 3, 2, 1]);
    });
});
