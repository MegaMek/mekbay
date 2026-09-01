// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { MotiveModes } from '../models/motiveModes.model';

export type TurnMovementColor = 'stationary' | 'walk' | 'run' | 'jump' | 'sprint';

export interface TurnMovementIndicator {
    readonly color: TurnMovementColor;
    readonly letter: string;
}

const TURN_MOVEMENT_INDICATORS: Readonly<Record<MotiveModes, TurnMovementIndicator>> = {
    stationary: { color: 'stationary', letter: 'St' },
    walk: { color: 'walk', letter: 'W' },
    run: { color: 'run', letter: 'R' },
    jump: { color: 'jump', letter: 'J' },
    sprint: { color: 'sprint', letter: 'S' },
    // These special modes use the jump movement category in the turn-state UI.
    UMU: { color: 'jump', letter: 'U' },
    VTOL: { color: 'jump', letter: 'V' },
};

export function getTurnMovementIndicator(
    mode: MotiveModes | null | undefined,
    defenderModifier: number,
): TurnMovementIndicator | null {
    if (mode === null || mode === undefined) return null;

    const indicator = TURN_MOVEMENT_INDICATORS[mode];
    return mode === 'stationary'
        ? indicator
        : { ...indicator, letter: `${indicator.letter}${defenderModifier}` };
}
