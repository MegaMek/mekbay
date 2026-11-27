// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { AutomationMode } from '../options.model';
import type { HeatAutomationPolicy } from './cbt-unit-runtime';

/**
 * How End Turn resolves a unit's heat: the automation applies its calculated result, or the heat is the player's (the
 * automation is off, or they declined its result).
 */
export type EndTurnHeatStep = 'calculated' | 'player';

/** The step a heat-resolution mode gives End Turn; `accepted` is false when the player declined the review. */
export function endTurnHeatStep(mode: AutomationMode, accepted: boolean): EndTurnHeatStep {
    return mode !== 'no' && accepted ? 'calculated' : 'player';
}

/** The step a unit's End Turn command takes: automatic heat applies the calculated result; manual heat is the player's. */
export function endTurnHeatStepForPolicy(policy: HeatAutomationPolicy): EndTurnHeatStep {
    return policy === 'automatic' ? 'calculated' : 'player';
}

/**
 * The heat End Turn settles, one rule for every unit that tracks heat: End Turn applies NEXT whenever the player set
 * one, as APPLY HEAT does. Without one, the calculated heat when the automation applies it, otherwise the current heat.
 */
export function endTurnHeat(
    step: EndTurnHeatStep,
    heat: Readonly<{ current: number; pendingOverride?: number }>,
    calculated: number,
): number {
    return heat.pendingOverride ?? (step === 'calculated' ? calculated : heat.current);
}
