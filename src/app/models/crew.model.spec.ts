// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    consciousnessTargetForWounds,
    woundsForConsciousnessTarget,
} from './crew.model';

describe('crew consciousness table', () => {
    it('maps wound tiers in both directions', () => {
        expect([1, 2, 3, 4, 5].map(consciousnessTargetForWounds)).toEqual([3, 5, 7, 10, 11]);
        expect([3, 5, 7, 10, 11].map(woundsForConsciousnessTarget)).toEqual([1, 2, 3, 4, 5]);
        expect(woundsForConsciousnessTarget(8)).toBeNull();
    });
});
