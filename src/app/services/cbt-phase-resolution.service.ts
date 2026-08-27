// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Injectable } from '@angular/core';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { PSRCheck } from '../models/rules/unit-type-rules';
import { CBTAutomationToastService } from './cbt-automation-toast.service';
import { FallingResolutionService } from './falling-resolution.service';
import { MekCriticalResolutionService } from './mek-critical-resolution.service';
import { UnitCheckResolutionService } from './unit-check-resolution.service';

type RandomSource = () => number;

export interface AutomaticPilotSkillCheckResolution {
    readonly check: PSRCheck;
    readonly outcome: 'success' | 'failed';
    readonly target: number;
    readonly dice: readonly [number, number] | null;
}

/** Rolls and applies every currently required Piloting Skill Check in rules order. */
export function resolvePilotSkillChecksAutomatically(
    unit: CBTForceUnit,
    random: RandomSource = Math.random,
): AutomaticPilotSkillCheckResolution[] {
    const turnState = unit.turnState();
    if (turnState.automaticPSRFailure()) {
        const target = unit.PSRTargetRoll();
        const checks = unresolvedPilotSkillChecks(unit);
        turnState.failPendingPSRChecks();
        turnState.resolveAutomaticFall();
        return checks.map(check => ({ check, outcome: 'failed', target, dice: null }));
    }

    const resolutions: AutomaticPilotSkillCheckResolution[] = [];
    while (true) {
        const unresolved = unresolvedPilotSkillChecks(unit);
        if (unresolved.length === 0) break;

        // An automatic fall is resolved after any independent checks. This
        // prevents becoming prone from making an unrelated check disappear.
        const check = turnState.autoFall()
            ? unresolved.find(candidate => candidate.failureOutcome !== 'Fall') ?? unresolved[0]
            : unresolved[0];
        const target = unit.PSRTargetRoll();
        const automaticFailure = turnState.isPSRCheckAutomaticFailure(check)
            || (turnState.autoFall() && check.failureOutcome === 'Fall');
        const dice = automaticFailure
            ? null
            : [rollD6(random), rollD6(random)] as const;
        const outcome = automaticFailure || dice![0] + dice![1] < target
            ? 'failed'
            : 'success';

        const applied = check.resolution
            ? unit.resolveRuleCheck(check.resolution.key, check.resolution.token, outcome)
            : check.id !== undefined && turnState.resolvePSRCheck(check.id, outcome);
        if (!applied) break;
        resolutions.push({ check, outcome, target, dice });
    }

    turnState.resolveAutomaticFall();
    return resolutions;
}

function unresolvedPilotSkillChecks(unit: CBTForceUnit): PSRCheck[] {
    const turnState = unit.turnState();
    return turnState.getPSRChecks().filter(check => {
        if (check.fallCheck === undefined || check.id === undefined) return false;
        if (!check.resolution) return turnState.getPSROutcome(check.id) === undefined;
        const current = unit.getRuleCheck(check.resolution.key);
        return !current
            || current.token !== check.resolution.token
            || current.status === 'pending';
    });
}

function rollD6(random: RandomSource): number {
    return Math.floor(random() * 6) + 1;
}

/**
 * Drains interactive work at phase and turn boundaries. A dismissed dialog
 * returns false immediately and leaves its event available in the UI.
 */
@Injectable({ providedIn: 'root' })
export class CBTPhaseResolutionService {
    private readonly falling = inject(FallingResolutionService);
    private readonly criticals = inject(MekCriticalResolutionService);
    private readonly unitChecks = inject(UnitCheckResolutionService);
    private readonly automationToasts = inject(CBTAutomationToastService);
    private readonly activeUnits = new WeakSet<CBTForceUnit>();

    isResolving(unit: CBTForceUnit): boolean {
        return this.activeUnits.has(unit);
    }

    /** Resolves the complete boundary sequence, then commits the phase once. */
    async endPhase(units: CBTForceUnit | readonly CBTForceUnit[]): Promise<boolean> {
        const requested = Array.isArray(units) ? units : [units];
        return this.run(requested, async targets => {
            if (!await this.drain(targets, 'phase')) return false;
            targets.forEach(unit => unit.endPhase());
            return true;
        });
    }

    /** Drains currently actionable work without committing a phase or turn. */
    async resolvePendingChain(units: CBTForceUnit | readonly CBTForceUnit[]): Promise<boolean> {
        const requested = Array.isArray(units) ? units : [units];
        return this.run(requested, targets => this.drain(targets, 'turn'));
    }

    /**
     * Resumes queued UI work without closing the current phase's pilot-damage
     * group or consolidating pending phase damage. Badge-driven resolution is
     * always interactive: configured `yes` modes behave as `ask` for this run.
     */
    async resumePendingChain(units: CBTForceUnit | readonly CBTForceUnit[]): Promise<boolean> {
        const requested = Array.isArray(units) ? units : [units];
        return this.run(requested, targets => this.drain(targets, 'interactive'));
    }

    private async run(
        units: readonly CBTForceUnit[],
        operation: (units: readonly CBTForceUnit[]) => Promise<boolean>,
    ): Promise<boolean> {
        const targets = uniqueUnits(units);
        if (targets.length === 0 || targets.some(unit => this.activeUnits.has(unit))) return false;
        targets.forEach(unit => this.activeUnits.add(unit));
        try {
            return await operation(targets);
        } finally {
            targets.forEach(unit => this.activeUnits.delete(unit));
        }
    }

    private async drain(
        targets: readonly CBTForceUnit[],
        boundary: 'interactive' | 'phase' | 'turn',
    ): Promise<boolean> {
        const skippedPilotChecks = new Set<CBTForceUnit>();
        const atPhaseEnd = boundary === 'phase';
        const manualResolution = boundary === 'interactive';

        while (true) {
            if (!manualResolution) {
                targets.forEach(unit => unit.resolvePendingCrewDeaths());
            }
            if (boundary === 'turn') {
                targets.forEach(unit => unit.turnState().completePilotDamageTurn());
            }
            const fallUnit = targets.find(unit => (unit.pendingFallCount?.() ?? 0) > 0);
            if (fallUnit) {
                const pendingId = fallUnit.getPendingFall()?.id;
                if (!pendingId) continue;
                await this.falling.resume(
                    fallUnit,
                    boundary === 'turn' || !fallUnit.tracksPhaseAndTurn(),
                    manualResolution,
                );
                if (fallUnit.getPendingFall(pendingId)) return false;
                continue;
            }

            const hasPendingUnitChecks = targets.some(unit => atPhaseEnd
                ? unit.turnState().pendingUnitCheckCountAtPhaseEnd() > 0
                : unit.turnState().pendingUnitCheckCount() > 0);
            if (hasPendingUnitChecks) {
                if (!await this.unitChecks.open(targets, atPhaseEnd, manualResolution)) return false;
                continue;
            }

            const criticalUnit = targets.find(unit =>
                unit.turnState().getNextPendingCriticalEvent() !== undefined);
            if (criticalUnit) {
                const pending = criticalUnit.turnState().getNextPendingCriticalEvent()!;
                if (pending.type === 'mek-critical-chance') {
                    await this.criticals.resumeChance(criticalUnit, pending.id, manualResolution);
                } else {
                    await this.criticals.resume(criticalUnit, pending.id, manualResolution);
                }
                if (criticalUnit.turnState().getNextPendingCriticalEvent()?.id === pending.id) {
                    return false;
                }
                continue;
            }

            const pilotUnit = targets.find(unit =>
                !skippedPilotChecks.has(unit) && hasPilotSkillWork(unit));
            if (pilotUnit) {
                const mode = pilotUnit.automationMode('pilotSkillCheck');
                if (mode === 'no') {
                    skippedPilotChecks.add(pilotUnit);
                    continue;
                }
                if ((!manualResolution && mode === 'yes')
                    || pilotUnit.turnState().automaticPSRFailure()
                    || pilotUnit.turnState().actionablePSRRollsCount() === 0) {
                    const results = resolvePilotSkillChecksAutomatically(pilotUnit);
                    if (mode === 'yes') {
                        results.forEach(result => this.showAutomaticPilotSkillToast(pilotUnit, result));
                    }
                    continue;
                }
                if (!await this.unitChecks.open(targets, atPhaseEnd, manualResolution)) return false;
                continue;
            }

            // New disabled checks can be created by an earlier event in the
            // chain. They remain informational only until this boundary.
            if (boundary !== 'interactive') {
                targets
                    .filter(unit => unit.automationMode('pilotSkillCheck') === 'no')
                    .forEach(unit => unit.turnState().resetPSRChecks());
            }
            return true;
        }
    }

    private showAutomaticPilotSkillToast(
        unit: CBTForceUnit,
        result: AutomaticPilotSkillCheckResolution,
    ): void {
        const detail = result.dice
            ? ` (${result.dice[0] + result.dice[1]} vs ${result.target}+)`
            : ' (automatic)';
        this.automationToasts.show(
            unit,
            `Piloting Skill Check: ${result.outcome === 'success' ? 'PASSED' : 'FAILED'}${detail} — ${result.check.reason}`,
            result.outcome === 'success' ? 'success' : 'error',
        );
    }

}

function hasPilotSkillWork(unit: CBTForceUnit): boolean {
    const turnState = unit.turnState();
    return turnState.PSRRollsCount() > 0
        || (turnState.autoFall() && !unit.getCondition('prone'));
}

function uniqueUnits(units: readonly CBTForceUnit[]): CBTForceUnit[] {
    return Array.from(new Map(units.map(unit => [unit.id, unit])).values());
}
