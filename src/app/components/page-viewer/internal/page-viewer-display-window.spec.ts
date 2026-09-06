// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { resolveDisplayStartIndex, resolveDisplayedUnits, buildForceChangePlan } from './page-viewer-display-window';

describe('page-viewer display-window', () => {
    it('resets the view start when all units fit', () => {
        expect(resolveDisplayStartIndex(2, 3, 1)).toBe(0);
        expect(resolveDisplayStartIndex(4, 2, 1)).toBe(1);
    });

    it('resolves the displayed unit window from the current start index', () => {
        const result = resolveDisplayedUnits([
            { id: 'a' },
            { id: 'b' },
            { id: 'c' }
        ] as never[], 2, 1);

        expect(result.startIndex).toBe(1);
        expect(result.units.map((unit) => unit.id)).toEqual([
            'b',
            'c',
        ]);
    });

    it('builds a force-change plan that follows the selected slot across reorder', () => {
        const plan = buildForceChangePlan({
            allUnits: [{ id: 'a' }, { id: 'c' }, { id: 'b' }, { id: 'd' }] as never[],
            displayedUnits: [{ id: 'a' }, { id: 'b' }] as never[],
            selectedUnitId: 'b',
            visibleCount: 2,
            previousUnitCount: 4,
            currentViewStartIndex: 0
        });

        expect(plan.nextViewStartIndex).toBe(1);
        expect(plan.needsRedisplay).toBeTrue();
        expect(plan.preserveSelectedSlot).toBeTrue();
        expect(plan.modeChanged).toBeFalse();
    });
});
