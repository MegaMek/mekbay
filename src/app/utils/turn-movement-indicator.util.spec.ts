// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    getTurnMovementIndicator,
    type TurnMovementColor,
    type TurnMovementMode,
} from './turn-movement-indicator.util';

describe('getTurnMovementIndicator', () => {
    it('returns no indicator until movement is assigned', () => {
        expect(getTurnMovementIndicator(null)).toBeNull();
        expect(getTurnMovementIndicator(undefined)).toBeNull();
    });

    it('maps standard movement modes to their colors and letters', () => {
        const cases: ReadonlyArray<readonly [TurnMovementMode, TurnMovementColor, string]> = [
            ['stationary', 'stationary', 'S'],
            ['walk', 'walk', 'W'],
            ['run', 'run', 'R'],
            ['jump', 'jump', 'J'],
            ['sprint', 'sprint', 'T'],
        ];

        for (const [mode, color, letter] of cases) {
            expect(getTurnMovementIndicator(mode)).withContext(mode).toEqual({ color, letter });
        }
    });

    it('uses the jump color for special movement modes', () => {
        expect(getTurnMovementIndicator('UMU')).toEqual({ color: 'jump', letter: 'U' });
        expect(getTurnMovementIndicator('VTOL')).toEqual({ color: 'jump', letter: 'V' });
    });
});
