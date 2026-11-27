// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { endTurnHeat, endTurnHeatStep, endTurnHeatStepForPolicy } from './end-turn-heat-selection';

describe('End Turn heat selection', () => {
    it('takes the calculated heat when the automation applies, the player\'s when it is off or declined', () => {
        expect(endTurnHeatStep('yes', true)).toBe('calculated');
        expect(endTurnHeatStep('ask', true)).toBe('calculated');
        expect(endTurnHeatStep('ask', false)).toBe('player');
        expect(endTurnHeatStep('no', true)).toBe('player');
        expect(endTurnHeatStepForPolicy('automatic')).toBe('calculated');
        expect(endTurnHeatStepForPolicy('manual')).toBe('player');
    });

    it('applies NEXT whenever the player set one, as APPLY HEAT does; otherwise the calculated or current heat', () => {
        const arrow = { current: 4, pendingOverride: 9 };
        const noArrow = { current: 4 };

        for (const step of ['calculated', 'player'] as const) expect(endTurnHeat(step, arrow, 7)).toBe(9);
        expect(endTurnHeat('calculated', noArrow, 7)).toBe(7);
        expect(endTurnHeat('player', noArrow, 7)).toBe(4);
    });
});
