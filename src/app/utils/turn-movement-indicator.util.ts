// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { hasNonMekRuntime, type CBTUnitSnapshot } from '../models/cbt-unit-snapshot';
import { calculateModifierTotal } from '../models/combat-modifier';
import type { MotiveModes } from '../models/motiveModes.model';
import type { MekTurnPanelSnapshot } from '../models/runtime/mek-turn-panel';
import { projectNonMekDefenseModifierBreakdown } from '../models/runtime/non-mek-unit-instance';

export type TurnMovementColor = 'stationary' | 'walk' | 'run' | 'jump' | 'sprint';

export interface TurnMovementIndicator {
    readonly color: TurnMovementColor;
    readonly letter: string;
}

const TURN_MOVEMENT_INDICATORS: Readonly<Record<MotiveModes, TurnMovementIndicator>> = {
    stationary: { color: 'stationary', letter: 'St' },
    walk: { color: 'walk', letter: 'W' },
    run: { color: 'run', letter: 'R' },
    sprint: { color: 'sprint', letter: 'S' },
    jump: { color: 'jump', letter: 'J' },
    UMU: { color: 'jump', letter: 'U' },
    VTOL: { color: 'jump', letter: 'V' },
};

/** Compact movement declaration plus the unit's complete defender modifier. */
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

/** A Mek's badge from the turn panel its view already projects. */
export function mekTurnMovementIndicator(turn: MekTurnPanelSnapshot | null | undefined): TurnMovementIndicator | null {
    return turn ? getTurnMovementIndicator(turn.movementState.movement?.mode, turn.defenseModifierTotal.modifier) : null;
}

/** Any other unit's badge from its runtime turn state and the same defender modifier the turn tracker shows. */
export function nonMekTurnMovementIndicator(unit: CBTUnitSnapshot | null | undefined): TurnMovementIndicator | null {
    if (!unit || !hasNonMekRuntime(unit)) return null;
    const defense = projectNonMekDefenseModifierBreakdown(unit.entity, unit.index, unit.state, unit.ruleset,
        unit.crewAssignment);
    return getTurnMovementIndicator(unit.state.turn.movement?.mode, calculateModifierTotal(defense).modifier);
}
