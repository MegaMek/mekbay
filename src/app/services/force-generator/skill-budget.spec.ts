// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { optimizeSkillBudget } from './skill-budget';

describe('skill-budget optimization', () => {
    it('preserves the original selection and skills when already in budget', () => {
        const selected = [{ cost: 10, skill: 4 }];
        expect(optimizeSkillBudget(selected, [[{ cost: 15, skill: 3 }]], { min: 10, max: 20 })).toBe(selected);
    });

    it('combines one option per unit to reach an exact budget', () => {
        const selected = [{ cost: 10, skill: 4 }, { cost: 10, skill: 4 }];
        const first = { cost: 15, skill: 3 };
        const second = { cost: 12, skill: 3 };
        expect(optimizeSkillBudget(selected, [[selected[0], first], [selected[1], second]], { min: 27, max: 27 })).toEqual([first, second]);
    });

    it('keeps equal-cost option ordering and the original selection on equal-ranked outcomes', () => {
        const selected = [{ cost: 100, skill: 4 }];
        const first = { cost: 55, skill: 3 };
        const second = { cost: 55, skill: 2 };
        expect(optimizeSkillBudget(selected, [[first, second]], { min: 50, max: 60 })).toEqual([first]);
        expect(optimizeSkillBudget(selected, [[{ cost: 10, skill: 7 }]], { min: 50, max: 60 })).toBe(selected);
    });

    it('chooses the closest feasible cost when no option reaches the budget', () => {
        const selected = [{ cost: 10 }];
        expect(optimizeSkillBudget(selected, [[{ cost: 40 }, { cost: 75 }]], { min: 50, max: 60 })).toEqual([{ cost: 40 }]);
        expect(optimizeSkillBudget(selected, [[{ cost: 65 }, { cost: 70 }]], { min: 60, max: Infinity })).toEqual([{ cost: 65 }]);
    });

    it('uses original candidates for empty option lists and preserves an empty force', () => {
        const locked = { cost: 10, locked: true };
        const changed = { cost: 15, locked: false };
        expect(optimizeSkillBudget([locked, { cost: 10, locked: false }], [[], [changed]], { min: 25, max: 25 })).toEqual([locked, changed]);
        const empty: { cost: number }[] = [];
        expect(optimizeSkillBudget(empty, [], { min: 25, max: 25 })).toBe(empty);
    });

    it('retains useful partial choices when the bounded search prunes a large option set', () => {
        const firstOptions = Array.from({ length: 5_100 }, (_, cost) => ({ cost }));
        const result = optimizeSkillBudget([{ cost: 0 }, { cost: 0 }], [firstOptions, [{ cost: 1 }]], { min: 5_100, max: 5_100 });
        expect(result).toEqual([{ cost: 5_099 }, { cost: 1 }]);
    });
});
