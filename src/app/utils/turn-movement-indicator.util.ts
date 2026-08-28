// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { MotiveModes } from '../models/motiveModes.model';

export type TurnMovementColor = 'stationary' | 'walk' | 'run' | 'jump' | 'sprint';
export type TurnMovementMode = MotiveModes | 'sprint';

export interface TurnMovementIndicator {
    readonly color: TurnMovementColor;
    readonly letter: string;
}

const TURN_MOVEMENT_INDICATORS: Readonly<Record<TurnMovementMode, TurnMovementIndicator>> = {
    stationary: { color: 'stationary', letter: 'S' },
    walk: { color: 'walk', letter: 'W' },
    run: { color: 'run', letter: 'R' },
    jump: { color: 'jump', letter: 'J' },
    sprint: { color: 'sprint', letter: 'T' },
    // These special modes use the jump movement category in the turn-state UI.
    UMU: { color: 'jump', letter: 'U' },
    VTOL: { color: 'jump', letter: 'V' },
};

export function getTurnMovementIndicator(
    mode: TurnMovementMode | null | undefined,
): TurnMovementIndicator | null {
    return mode === null || mode === undefined ? null : TURN_MOVEMENT_INDICATORS[mode];
}
