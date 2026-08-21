// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { describeHeatScaleRollChecks, type HeatScaleEntry } from './heat-management';

describe('describeHeatScaleRollChecks', () => {
    const scale: readonly HeatScaleEntry[] = [
        { heat: 5, move: -1, randomMovement: 5 },
        { heat: 8, fire: 1 },
        { heat: 14, shutdown: 4 },
        { heat: 18, shutdown: 6 },
        { heat: 19, ammoExp: 4 },
        { heat: 21, pilotDamage: 6 },
        { heat: 30, shutdown: 100 },
    ];

    it('describes each cumulative roll check using the latest active threshold', () => {
        expect(describeHeatScaleRollChecks(scale, 21)).toEqual([
            'Shutdown check 6+',
            'Ammo explosion check 4+',
            'Random movement check 5+',
            'Pilot damage check 6+',
        ]);
    });

    it('labels heat-30 shutdown as automatic', () => {
        expect(describeHeatScaleRollChecks(scale, 30)).toContain('Automatic shutdown');
    });

    it('omits movement and fire effects when no roll is required', () => {
        expect(describeHeatScaleRollChecks(scale, 8)).toEqual([
            'Random movement check 5+',
        ]);
        expect(describeHeatScaleRollChecks([
            { heat: 5, move: -1 },
            { heat: 8, fire: 1 },
        ], 8)).toEqual([]);
    });
});
