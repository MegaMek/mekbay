// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MotiveModes } from '../models/motiveModes.model';
import {
    getTurnMovementIndicator,
    type TurnMovementColor,
} from './turn-movement-indicator.util';

describe('getTurnMovementIndicator', () => {
    it('returns no badge before movement is assigned', () => {
        expect(getTurnMovementIndicator(null, 1)).toBeNull();
        expect(getTurnMovementIndicator(undefined, 1)).toBeNull();
    });

    it('shows movement mode and the complete defender modifier', () => {
        const cases: ReadonlyArray<readonly [MotiveModes, TurnMovementColor, string]> = [
            ['stationary', 'stationary', 'St'],
            ['walk', 'walk', 'W1'],
            ['run', 'run', 'R1'],
            ['sprint', 'sprint', 'S1'],
            ['jump', 'jump', 'J1'],
            ['UMU', 'jump', 'U1'],
            ['VTOL', 'jump', 'V1'],
        ];

        for (const [mode, color, letter] of cases) {
            expect(getTurnMovementIndicator(mode, 1)).withContext(mode).toEqual({ color, letter });
        }
        expect(getTurnMovementIndicator('walk', 0)).toEqual({ color: 'walk', letter: 'W0' });
        expect(getTurnMovementIndicator('sprint', -1)).toEqual({ color: 'sprint', letter: 'S-1' });
    });
});
