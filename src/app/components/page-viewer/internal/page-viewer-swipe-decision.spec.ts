// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { resolveSwipeEndPlan, resolveShadowPagesToMove, resolveSwipeViewStartIndex, resolveSwipeReversePlan } from './page-viewer-swipe-decision';

describe('page-viewer swipe-decision', () => {
    it('resolves a committed swipe movement and target offset', () => {
        const plan = resolveSwipeEndPlan({
            totalDx: -1200,
            velocity: 0,
            scaledPageStep: 1000,
            totalUnits: 6,
            commitThreshold: 0.15,
            velocityThreshold: 300
        });

        expect(plan).toEqual({
            pagesToMove: 1,
            targetOffset: -1000
        });
    });

    it('falls back to flick velocity when distance stays below threshold', () => {
        const plan = resolveSwipeEndPlan({
            totalDx: 50,
            velocity: 350,
            scaledPageStep: 1000,
            totalUnits: 6,
            commitThreshold: 0.15,
            velocityThreshold: 300
        });

        expect(plan.pagesToMove).toBe(-1);
    });

    it('resolves shadow navigation movement and wrapped start indices', () => {
        expect(resolveShadowPagesToMove({
            direction: 'right',
            currentStartIndex: 4,
            effectiveVisible: 2,
            targetIndex: 1,
            totalUnits: 6
        })).toBe(2);

        expect(resolveSwipeViewStartIndex({
            baseDisplayStartIndex: 5,
            pagesToMove: 2,
            totalUnits: 6
        })).toBe(1);
    });

    it('builds reverse animation plans', () => {
        expect(resolveSwipeReversePlan({ currentTranslateX: 0.5, fullPageDistance: 1000 })).toEqual({
            shouldSnapImmediately: true,
            durationMs: 0
        });

        expect(resolveSwipeReversePlan({ currentTranslateX: 500, fullPageDistance: 1000 })).toEqual({
            shouldSnapImmediately: false,
            durationMs: 110
        });
    });
});