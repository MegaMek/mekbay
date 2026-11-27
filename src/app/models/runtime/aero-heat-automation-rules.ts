// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { AeroHeatEffects } from '../rules/aero-runtime-rules';
import { heatControlChecks, type HeatAutomationCheck, type HeatControlCheckKind } from './mek-automation-rules';

export type AeroHeatAutomationCheckKind =
    | HeatControlCheckKind
    | 'random-movement'
    | 'clear-heat-control'
    | 'pilot-damage';

export type AeroHeatAutomationCheck = HeatAutomationCheck<AeroHeatAutomationCheckKind>;

export interface AeroHeatAutomationFacts {
    /** Derived from the settled heat; every threshold below reads it. */
    readonly effects: AeroHeatEffects;
    readonly shutdown: boolean;
    readonly activeController: boolean;
    readonly hasExplosiveAmmo: boolean;
    readonly hadHeatControlEffect: boolean;
}

/** One canonical projection for end-turn aerospace heat reviews and badges. */
export function projectAeroHeatAutomationChecks(
    facts: AeroHeatAutomationFacts,
): readonly AeroHeatAutomationCheck[] {
    const checks: AeroHeatAutomationCheck[] = [...heatControlChecks({
        shutdownTarget: facts.effects.shutdownTarget,
        ammoExplosionTarget: facts.effects.ammoExplosionTarget,
        shutdown: facts.shutdown,
        activeController: facts.activeController,
        hasExplosiveAmmo: facts.hasExplosiveAmmo,
    })];
    if (facts.effects.randomMovementTarget !== undefined) {
        checks.push(Object.freeze({
            kind: 'random-movement',
            target: facts.effects.randomMovementTarget,
        }));
    } else if (facts.hadHeatControlEffect) {
        checks.push(Object.freeze({
            kind: 'clear-heat-control',
            automaticOutcome: 'success',
        }));
    }
    if (facts.effects.pilotDamageTarget !== undefined) {
        checks.push(Object.freeze({
            kind: 'pilot-damage',
            target: facts.effects.pilotDamageTarget,
        }));
    }
    return Object.freeze(checks);
}
