// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { mekHeatEffects } from './mek-heat-rules';

describe('Mek heat rules', () => {
    it('projects the cumulative movement and fire thresholds from one table', () => {
        expect([0, 5, 8, 10, 13, 15, 17, 20, 24, 25].map(heat =>
            [heat, mekHeatEffects(heat)])).toEqual([
            [0, { moveModifier: 0, fireModifier: 0 }],
            [5, { moveModifier: -1, fireModifier: 0 }],
            [8, { moveModifier: -1, fireModifier: 1 }],
            [10, { moveModifier: -2, fireModifier: 1 }],
            [13, { moveModifier: -2, fireModifier: 2 }],
            [15, { moveModifier: -3, fireModifier: 2 }],
            [17, { moveModifier: -3, fireModifier: 3 }],
            [20, { moveModifier: -4, fireModifier: 3 }],
            [24, { moveModifier: -4, fireModifier: 4 }],
            [25, { moveModifier: -5, fireModifier: 4 }],
        ]);
    });
});
