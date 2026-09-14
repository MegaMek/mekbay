// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { compareModifierPreferences, type ModifierStep } from './org-rule-metadata.util';

/** Independent reference for the ordering used before numeric preference buckets. */
function referenceCompare(left: readonly ModifierStep[], right: readonly ModifierStep[]): number {
    const keyCompare = (left: string, right: string): number => {
        const [leftBand, leftDistance] = left.split(':').map(Number);
        const [rightBand, rightDistance] = right.split(':').map(Number);
        return leftBand - rightBand || rightDistance - leftDistance;
    };
    const buckets = (steps: readonly ModifierStep[]) => {
        const counts = new Map<string, number>();
        for (const step of steps) {
            const band = step.relativeBand === 'regular' ? 3 : step.relativeBand === 'super-regular' ? 2 : 1;
            const key = `${band}:${step.distanceFromRegular}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return [...counts].sort(([left], [right]) => -keyCompare(left, right));
    };
    const leftBuckets = buckets(left);
    const rightBuckets = buckets(right);
    for (let index = 0; index < Math.min(leftBuckets.length, rightBuckets.length); index++) {
        const difference = keyCompare(leftBuckets[index][0], rightBuckets[index][0])
            || leftBuckets[index][1] - rightBuckets[index][1];
        if (difference !== 0) return difference;
    }
    return leftBuckets.length - rightBuckets.length;
}

describe('organization modifier preference ordering', () => {
    const step = (relativeBand: ModifierStep['relativeBand'], distanceFromRegular: number, modifierKey = ''): ModifierStep => ({
        modifierKey, relativeBand, distanceFromRegular, count: 4, tier: 1,
    });

    it('matches the previous ordering for every pair of short plans, including repeated and equivalent modifiers', () => {
        const choices = [
            step('regular', 0), step('super-regular', 1), step('super-regular', 2),
            step('sub-regular', 1), step('sub-regular', 2), step('super-regular', 1, 'Equivalent'),
        ];
        const plans: ModifierStep[][] = [[]];
        let previous: ModifierStep[][] = [[]];
        for (let length = 1; length <= 3; length++) {
            previous = previous.flatMap(plan => choices.map(choice => [...plan, choice]));
            plans.push(...previous);
        }
        for (const left of plans) for (const right of plans) {
            const actual = Math.sign(compareModifierPreferences(left, right));
            const expected = Math.sign(referenceCompare(left, right));
            if (actual !== expected) {
                fail(`Ordering changed for ${JSON.stringify({ left, right, actual, expected })}`);
                return;
            }
        }
        expect(plans.length ** 2).toBe(67_081);
    });

    it('orders fractional and large distances numerically while keeping band priority', () => {
        expect(compareModifierPreferences([step('super-regular', 0.5)], [step('super-regular', 2)])).toBeGreaterThan(0);
        expect(compareModifierPreferences([step('super-regular', 10)], [step('super-regular', 2)])).toBeLessThan(0);
        expect(compareModifierPreferences([step('super-regular', 100)], [step('sub-regular', 0.5)])).toBeGreaterThan(0);
    });
});
