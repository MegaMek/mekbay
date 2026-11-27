// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { resolveDisplayStartIndex, resolveDisplayedUnits, buildForceChangePlan } from './page-viewer-display-window';

describe('page-viewer display-window', () => {
    it('resets the view start when all units fit', () => {
        expect(resolveDisplayStartIndex(2, 3, 1)).toBe(0);
        expect(resolveDisplayStartIndex(4, 2, 1)).toBe(1);
    });

    it('normalizes wrapped starts without dropping slots', () => {
        const units = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never[];
        expect(resolveDisplayedUnits(units, 2, -1).units).toEqual([units[2], units[0]]);
        expect(resolveDisplayedUnits(units, 2, 4).units).toEqual([units[1], units[2]]);
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

    it('refreshes replacement members but leaves an unchanged visible window alone', () => {
        const units = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never[];
        const options = {
            allUnits: units,
            displayedUnits: units.slice(0, 2),
            selectedUnitId: 'a',
            visibleCount: 2,
            previousUnitCount: 3,
            currentViewStartIndex: 0,
        };
        expect(buildForceChangePlan(options).needsRedisplay).toBeFalse();
        expect(buildForceChangePlan({
            ...options, allUnits: [units[0], { id: 'b' } as never, units[2]],
        }).needsRedisplay).toBeTrue();
    });
});
