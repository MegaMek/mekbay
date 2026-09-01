// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { MotiveModes } from '../models/motiveModes.model';
import {
    getTurnMovementIndicator,
    type TurnMovementColor,
} from './turn-movement-indicator.util';

describe('getTurnMovementIndicator', () => {
    it('returns no indicator until movement is assigned', () => {
        expect(getTurnMovementIndicator(null, 4)).toBeNull();
        expect(getTurnMovementIndicator(undefined, 4)).toBeNull();
    });

    it('maps standard movement modes to their colors and defender-modifier labels', () => {
        const cases: ReadonlyArray<readonly [MotiveModes, TurnMovementColor, string]> = [
            ['stationary', 'stationary', 'St'],
            ['walk', 'walk', 'W4'],
            ['run', 'run', 'R4'],
            ['jump', 'jump', 'J4'],
            ['sprint', 'sprint', 'S4'],
        ];

        for (const [mode, color, letter] of cases) {
            expect(getTurnMovementIndicator(mode, 4)).withContext(mode).toEqual({ color, letter });
        }
    });

    it('uses the jump color for special movement modes', () => {
        expect(getTurnMovementIndicator('UMU', 2)).toEqual({ color: 'jump', letter: 'U2' });
        expect(getTurnMovementIndicator('VTOL', 3)).toEqual({ color: 'jump', letter: 'V3' });
    });
});
