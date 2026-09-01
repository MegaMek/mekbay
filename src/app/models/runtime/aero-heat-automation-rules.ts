// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { AeroHeatEffects } from '../rules/aero-runtime-rules';

export type AeroHeatAutomationCheckKind =
    | 'shutdown'
    | 'startup'
    | 'ammo-explosion'
    | 'random-movement'
    | 'clear-heat-control'
    | 'pilot-damage';

export interface AeroHeatAutomationCheck {
    readonly kind: AeroHeatAutomationCheckKind;
    readonly target?: number;
    readonly automaticOutcome?: 'success' | 'failed';
}

export interface AeroHeatAutomationFacts {
    readonly heat: number;
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
    const checks: AeroHeatAutomationCheck[] = [];
    if (facts.shutdown) {
        if (facts.heat < 14) {
            checks.push(Object.freeze({ kind: 'startup', automaticOutcome: 'success' }));
        } else if (facts.activeController && facts.effects.shutdownTarget !== undefined
            && facts.effects.shutdownTarget <= 12) {
            checks.push(Object.freeze({
                kind: 'startup',
                target: facts.effects.shutdownTarget,
            }));
        }
    } else if (facts.effects.shutdownTarget !== undefined) {
        checks.push(Object.freeze(
            facts.effects.shutdownTarget >= 100 || !facts.activeController
                ? { kind: 'shutdown', automaticOutcome: 'failed' }
                : { kind: 'shutdown', target: facts.effects.shutdownTarget },
        ));
    }
    if (facts.effects.ammoExplosionTarget !== undefined && facts.hasExplosiveAmmo) {
        checks.push(Object.freeze({
            kind: 'ammo-explosion',
            target: facts.effects.ammoExplosionTarget,
        }));
    }
    if (facts.effects.randomMovementTarget !== undefined) {
        checks.push(Object.freeze({
            kind: 'random-movement',
            target: facts.effects.randomMovementTarget,
        }));
    } else if (facts.heat < 5 && facts.hadHeatControlEffect) {
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
