// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

export type MekHeatAutomationCheckKind =
    | 'shutdown'
    | 'startup'
    | 'ammo-explosion';

export interface MekHeatAutomationCheck {
    readonly kind: MekHeatAutomationCheckKind;
    readonly target?: number;
    readonly automaticOutcome?: 'success' | 'failed';
}

export interface MekHeatAutomationFacts {
    readonly heat: number;
    readonly shutdown: boolean;
    readonly consciousPilot: boolean;
    readonly hasExplosiveAmmo: boolean;
}

/** Cumulative heat-control checks for a Mek after end-turn heat is settled. */
export function mekHeatAutomationChecks(
    facts: MekHeatAutomationFacts,
): readonly MekHeatAutomationCheck[] {
    const heat = Math.max(0, Number.isFinite(facts.heat) ? Math.trunc(facts.heat) : 0);
    const shutdownTarget = mekHeatShutdownTarget(heat);
    const checks: MekHeatAutomationCheck[] = [];

    if (facts.shutdown) {
        if (heat < 14) {
            checks.push(Object.freeze({ kind: 'startup', automaticOutcome: 'success' }));
        } else if (facts.consciousPilot && shutdownTarget !== undefined && shutdownTarget <= 12) {
            checks.push(Object.freeze({ kind: 'startup', target: shutdownTarget }));
        }
    } else if (shutdownTarget !== undefined) {
        checks.push(Object.freeze(
            shutdownTarget > 12 || !facts.consciousPilot
                ? { kind: 'shutdown', automaticOutcome: 'failed' }
                : { kind: 'shutdown', target: shutdownTarget },
        ));
    }

    const ammoExplosionTarget = mekHeatAmmoExplosionTarget(heat);
    if (facts.hasExplosiveAmmo && ammoExplosionTarget !== undefined) {
        checks.push(Object.freeze({ kind: 'ammo-explosion', target: ammoExplosionTarget }));
    }
    return Object.freeze(checks);
}

export function mekHeatShutdownTarget(heat: number): number | undefined {
    return heat >= 30 ? 100
        : heat >= 26 ? 10
            : heat >= 22 ? 8
                : heat >= 18 ? 6
                    : heat >= 14 ? 4
                        : undefined;
}

export function mekHeatAmmoExplosionTarget(heat: number): number | undefined {
    return heat >= 28 ? 8
        : heat >= 23 ? 6
            : heat >= 19 ? 4
                : undefined;
}

export function rollD6(random: () => number = Math.random): number {
    return Math.max(1, Math.min(6, Math.floor(random() * 6) + 1));
}

export function roll2D6(random: () => number = Math.random): readonly [number, number] {
    return Object.freeze([rollD6(random), rollD6(random)] as const);
}

export function twoD6Total(dice: readonly [number, number]): number {
    return dice[0] + dice[1];
}

/** Target to remain conscious after the current cumulative wound count. */
export function mekConsciousnessTarget(wounds: number): number | undefined {
    const normalized = Math.max(0, Math.trunc(wounds));
    return normalized >= 6 ? undefined : [undefined, 3, 5, 7, 10, 11][normalized];
}
