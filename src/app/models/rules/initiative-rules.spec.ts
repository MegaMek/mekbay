// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    effectiveInitiativeOrder,
    initiativeRollTotal,
    initiativeSequence,
    nextInitiativeDice,
    initiativeOrderFromRolls,
    initiativeRollsDue,
    withInitiativeRoll,
} from './initiative-rules';

/** Units each side acts for, selection by selection. */
function selections(order: readonly string[], counts: Record<string, number>, mode: 'front-loaded' | 'back-loaded' | 'spread') {
    const slots = initiativeSequence(order, new Map(Object.entries(counts)), mode);
    const groups: string[] = [];
    for (const slot of slots) {
        if (groups.length === slot.selection) groups.push('');
        groups[slot.selection] += slot.side;
    }
    return groups;
}

describe('initiative rules', () => {
    it('follows the ruleset unless a Total Warfare game picks another order', () => {
        expect(effectiveInitiativeOrder('core-2026', 'back-loaded')).toBe('front-loaded');
        expect(effectiveInitiativeOrder('total-warfare', 'rules')).toBe('back-loaded');
        expect(effectiveInitiativeOrder('total-warfare', 'spread')).toBe('spread');
    });

    it('alternates one unit at a time, the loser first, when the sides are even', () => {
        expect(selections(['B', 'A'], { A: 3, B: 3 }, 'back-loaded')).toEqual(['B', 'A', 'B', 'A', 'B', 'A']);
    });

    it('back-loads the larger side as Total Warfare does: 8 against 5 moves 1, 1, 2, 2, 2', () => {
        // TW p.39: Side A (8 units) won Initiative against Side B (5 units).
        expect(selections(['B', 'A'], { A: 8, B: 5 }, 'back-loaded'))
            .toEqual(['B', 'A', 'B', 'A', 'B', 'AA', 'B', 'AA', 'B', 'AA']);
    });

    it('front-loads the larger side as Core does: 14 against 5 moves 3, 3, 3, 3, 2', () => {
        // Core p.41: Side B (5 units) lost Initiative to Side A (14 units).
        expect(selections(['B', 'A'], { A: 14, B: 5 }, 'front-loaded'))
            .toEqual(['B', 'AAA', 'B', 'AAA', 'B', 'AAA', 'B', 'AAA', 'B', 'AA']);
        expect(selections(['B', 'A'], { A: 18, B: 10 }, 'front-loaded').filter(group => group.startsWith('A')).map(group => group.length))
            .toEqual([2, 2, 2, 2, 2, 2, 2, 2, 1, 1]);
    });

    it('spreads the extra units evenly, and lets a lone side act for every unit', () => {
        expect(selections(['B', 'A'], { A: 6, B: 4 }, 'spread')).toEqual(['B', 'A', 'B', 'AA', 'B', 'A', 'B', 'AA']);
        expect(selections(['B', 'A'], { A: 3, B: 0 }, 'back-loaded')).toEqual(['A', 'A', 'A']);
    });

    it('ranks the rolls, the loser first, and asks only tied sides to roll again: other rolls are final', () => {
        const sides = ['A', 'B', 'C'];
        let rolls = withInitiativeRoll([], 'A', [3, 3], 0);
        expect([...initiativeRollsDue(sides, rolls)]).toEqual(['B', 'C']);
        expect(initiativeOrderFromRolls(sides, rolls)).toBeNull();
        rolls = withInitiativeRoll(rolls, 'B', [2, 3], 1);
        rolls = withInitiativeRoll(rolls, 'C', [5, 4], 0);
        // A and B tie on 6; C's 9 is final.
        expect([...initiativeRollsDue(sides, rolls)].sort()).toEqual(['A', 'B']);
        rolls = withInitiativeRoll(rolls, 'A', [1, 1], 5);
        expect([...initiativeRollsDue(sides, rolls)]).toEqual(['B']);
        rolls = withInitiativeRoll(rolls, 'B', [6, 5], 0);
        expect(initiativeRollsDue(sides, rolls).size).toBe(0);
        expect(initiativeOrderFromRolls(sides, rolls)).toEqual(['A', 'B', 'C']);
        // A reroll keeps the first roll's modifier.
        const reroll = rolls.find(roll => roll.side === 'B')!;
        expect(reroll.modifier).toBe(1);
        expect(initiativeRollTotal(reroll)).toBe(12);
    });

    it('passes the Initiative Die to the loser and removes it from a winner, up to +6', () => {
        expect(nextInitiativeDice({}, ['A', 'B'], undefined)).toEqual({ A: 1 });
        expect(nextInitiativeDice({ A: 1 }, ['A', 'B'], undefined)).toEqual({ A: 2 });
        expect(nextInitiativeDice({ A: 2 }, ['B', 'A'], undefined)).toEqual({ B: 1 });
        expect(nextInitiativeDice({ A: 6 }, ['A', 'B'], undefined)).toEqual({ A: 6 });
        // Three sides: the side that lost by the most takes the die.
        const rolls = [
            { side: 'A', modifier: 0, dice: [[1, 1]] as const },
            { side: 'B', modifier: 0, dice: [[3, 3]] as const },
            { side: 'C', modifier: 0, dice: [[6, 6]] as const },
        ];
        expect(nextInitiativeDice({}, ['A', 'B', 'C'], rolls)).toEqual({ A: 1 });
    });
});
