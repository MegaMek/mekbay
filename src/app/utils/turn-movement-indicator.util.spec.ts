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
        expect(getTurnMovementIndicator(null)).toBeNull();
        expect(getTurnMovementIndicator(undefined)).toBeNull();
    });

    it('maps standard movement modes to their colors and letters', () => {
        const cases: ReadonlyArray<readonly [MotiveModes, TurnMovementColor, string]> = [
            ['stationary', 'stationary', 'S'],
            ['walk', 'walk', 'W'],
            ['run', 'run', 'R'],
            ['jump', 'jump', 'J'],
            ['sprint', 'sprint', 'Sp'],
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
