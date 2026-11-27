// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

const SKILL_OPTIMIZATION_STATE_LIMIT = 5_000;

interface BudgetRange {
    min: number;
    max: number;
}

interface SkillSelection<T> {
    totalCost: number;
    selectedCandidates: T[];
}

export function isBudgetWithinRange(totalCost: number, budget: BudgetRange): boolean {
    return totalCost >= budget.min && totalCost <= budget.max;
}

export function getBudgetRangeDistance(totalCost: number, budget: BudgetRange): number {
    if (totalCost < budget.min) {
        return budget.min - totalCost;
    }
    if (totalCost > budget.max) {
        return totalCost - budget.max;
    }
    return 0;
}

export function getBudgetTarget(budget: BudgetRange): number {
    if (Number.isFinite(budget.max)) {
        return budget.min > 0 ? budget.min + ((budget.max - budget.min) / 2) : budget.max;
    }
    return budget.min;
}

/** Choose one skill option per selected unit, preserving the original selection on ties. */
export function optimizeSkillBudget<T extends { cost: number }>(
    selectedCandidates: T[],
    optionsByCandidate: readonly (readonly T[])[],
    budget: BudgetRange,
): T[] {
    const original: SkillSelection<T> = {
        totalCost: selectedCandidates.reduce((sum, candidate) => sum + candidate.cost, 0),
        selectedCandidates,
    };
    if (selectedCandidates.length === 0 || isBudgetWithinRange(original.totalCost, budget)) {
        return selectedCandidates;
    }

    const compare = (left: SkillSelection<T>, right: SkillSelection<T>): number => {
        const leftInRange = isBudgetWithinRange(left.totalCost, budget);
        const rightInRange = isBudgetWithinRange(right.totalCost, budget);
        if (leftInRange !== rightInRange) {
            return leftInRange ? -1 : 1;
        }
        const distance = getBudgetRangeDistance(left.totalCost, budget) - getBudgetRangeDistance(right.totalCost, budget);
        if (distance !== 0) {
            return distance;
        }
        const target = getBudgetTarget(budget);
        return Math.abs(left.totalCost - target) - Math.abs(right.totalCost - target);
    };

    let states: SkillSelection<T>[] = [{ totalCost: 0, selectedCandidates: [] }];
    for (const [index, options] of optionsByCandidate.entries()) {
        const candidateOptions = options.length > 0 ? options : [selectedCandidates[index]];
        const nextStatesByCost = new Map<number, SkillSelection<T>>();
        for (const state of states) {
            for (const candidate of candidateOptions) {
                const totalCost = state.totalCost + candidate.cost;
                if (!nextStatesByCost.has(totalCost)) {
                    nextStatesByCost.set(totalCost, {
                        totalCost,
                        selectedCandidates: [...state.selectedCandidates, candidate],
                    });
                }
            }
        }

        states = [...nextStatesByCost.values()];
        if (states.length > SKILL_OPTIMIZATION_STATE_LIMIT) {
            states = states.sort(compare).slice(0, SKILL_OPTIMIZATION_STATE_LIMIT);
        }
    }

    return states.reduce((best, state) => compare(state, best) < 0 ? state : best, original).selectedCandidates;
}
