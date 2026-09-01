// SPDX-License-Identifier: GPL-3.0-or-later

import { inject, Injectable } from '@angular/core';

import type {
    AutomationCheck,
    AutomationCheckResolution,
} from '../models/automation-check.model';
import type { CBTRuleset } from '../models/cbt-ruleset.model';
import { mekConsciousnessTarget } from '../models/runtime/mek-automation-rules';
import { MAX_MEK_CREW_WOUNDS } from '../models/runtime/runtime-state';
import { CBTAutomationCheckService } from './cbt-automation-check.service';

export interface CrewHitRecipient {
    readonly id: string;
    readonly name?: string;
    readonly wounds: number;
    readonly unconscious: boolean;
    readonly unavailable: boolean;
    readonly hits: number;
}

export interface ResolvedCrewConsciousnessCheck {
    readonly targetNumber: number;
    readonly resolution: AutomationCheckResolution;
}

export interface ResolvedCrewHits {
    readonly id: string;
    readonly wounds: number;
    readonly unconscious: boolean;
    readonly checks: readonly ResolvedCrewConsciousnessCheck[];
}

export interface CrewHitAutomationOptions {
    /** Badge-driven parent work keeps every resulting consciousness stage interactive. */
    readonly interactive?: boolean;
}

export interface AutomaticCrewCheckNotification {
    readonly message: string;
    readonly type: 'success' | 'error';
}

export interface AutomaticCrewRecoveryResult {
    readonly id: string;
    readonly targetNumber: number;
    readonly total: number;
    readonly recovered: boolean;
}

/** Canonical origin/next automatic notifications, grouped by rules stage. */
export function automaticConsciousnessNotifications(
    resolved: readonly ResolvedCrewHits[],
    crewLabel: (id: string) => string,
): readonly AutomaticCrewCheckNotification[] {
    const stageCount = resolved.reduce((highest, plan) =>
        Math.max(highest, plan.checks.length), 0);
    return Object.freeze(Array.from({ length: stageCount }, (_unused, stage) => {
        const rows = resolved.flatMap(plan => {
            const check = plan.checks[stage];
            if (!check) return [];
            const resolution = check.resolution;
            const total = resolution.dice ? resolution.dice[0] + resolution.dice[1] : null;
            const result = `${resolution.outcome === 'success' ? 'PASSED' : 'FAILED'}`
                + `${total === null ? ' (automatic)' : ` (${total} vs ${check.targetNumber}+)`}`
                + ` — crew member ${resolution.outcome === 'success'
                    ? 'remains conscious'
                    : 'rendered unconscious'}`;
            return [Object.freeze({
                crew: crewLabel(plan.id),
                result,
                failed: resolution.outcome === 'failed',
            })];
        });
        return Object.freeze({
            message: rows.length === 1
                ? `Consciousness check: ${rows[0]!.result}`
                : `Consciousness checks — ${rows.map(row => `${row.crew}: ${row.result}`).join('; ')}`,
            type: rows.some(row => row.failed) ? 'error' as const : 'success' as const,
        });
    }));
}

/** Canonical origin/next automatic recovery notification for one rules stage. */
export function automaticConsciousnessRecoveryNotification(
    recoveries: readonly AutomaticCrewRecoveryResult[],
    crewLabel: (id: string) => string,
): AutomaticCrewCheckNotification | null {
    if (recoveries.length === 0) return null;
    const rows = recoveries.map(recovery => {
        const result = `${recovery.recovered ? 'PASSED' : 'FAILED'}`
            + ` (${recovery.total} vs ${recovery.targetNumber}+)`
            + ` — crew member ${recovery.recovered
                ? 'regained consciousness'
                : 'remains unconscious'}`;
        return Object.freeze({
            crew: crewLabel(recovery.id),
            result,
            failed: !recovery.recovered,
        });
    });
    return Object.freeze({
        message: rows.length === 1
            ? `Consciousness recovery: ${rows[0]!.result}`
            : `Consciousness recovery — ${rows.map(row => `${row.crew}: ${row.result}`).join('; ')}`,
        type: rows.some(row => row.failed) ? 'error' : 'success',
    });
}

/** Preflights pilot hits and every resulting consciousness roll before mutation. */
@Injectable({ providedIn: 'root' })
export class CBTCrewHitAutomationService {
    private readonly automationChecks = inject(CBTAutomationCheckService);

    async resolve(
        subject: string,
        ruleset: CBTRuleset,
        eventPrefix: string,
        recipients: readonly CrewHitRecipient[],
        options: CrewHitAutomationOptions = {},
    ): Promise<readonly ResolvedCrewHits[] | null> {
        const planned = recipients.map(recipient => {
            const appliedHits = Math.max(0, Math.trunc(recipient.hits));
            const wounds = recipient.unavailable
                ? recipient.wounds
                : Math.min(MAX_MEK_CREW_WOUNDS, recipient.wounds + appliedHits);
            const woundLevels = this.consciousnessWoundLevels(
                ruleset,
                recipient,
                wounds,
            );
            const failureGroup = `${eventPrefix}:consciousness:${recipient.id}`;
            const checks = woundLevels.flatMap(woundLevel => {
                const targetNumber = mekConsciousnessTarget(woundLevel);
                if (targetNumber === undefined) return [];
                const id = `${failureGroup}:${woundLevel}`;
                return [Object.freeze({
                    id,
                    targetNumber,
                    check: Object.freeze({
                        id,
                        subject,
                        label: 'Consciousness check',
                        description: this.description(recipient, woundLevel, wounds),
                        failureOutcome: 'unconsciousness',
                        targetNumber,
                        failureGroup,
                        successLabel: 'STAYS CONSCIOUS',
                        failedLabel: 'UNCONSCIOUS',
                    } satisfies AutomationCheck),
                })];
            });
            return Object.freeze({ recipient, wounds, checks: Object.freeze(checks) });
        });
        const resolutionById = new Map<string, AutomationCheckResolution>();
        const ownerByCheckId = new Map(planned.flatMap(plan =>
            plan.checks.map(row => [row.id, plan.recipient.id] as const)));
        const unconscious = new Set(planned
            .filter(plan => plan.recipient.unconscious)
            .map(plan => plan.recipient.id));
        const stageCount = planned.reduce((highest, plan) =>
            Math.max(highest, plan.checks.length), 0);
        for (let stage = 0; stage < stageCount; stage += 1) {
            // Origin/next exposes only the next TW consciousness roll for each
            // crew member. A failure ends that member's sequence instead of
            // displaying invented automatic failures for later wound levels.
            const stageChecks = planned.flatMap(plan => {
                const row = plan.checks[stage];
                return row && !unconscious.has(plan.recipient.id) ? [row.check] : [];
            });
            if (stageChecks.length === 0) continue;
            const resolutions = await this.automationChecks.resolve(
                'pilotHitsAndConsciousnessCheck',
                stageChecks,
                { title: 'Consciousness Rolls', interactive: options.interactive },
            );
            if (resolutions === null) return null;
            for (const resolution of resolutions) {
                resolutionById.set(resolution.id, resolution);
                if (resolution.outcome !== 'failed') continue;
                const ownerId = ownerByCheckId.get(resolution.id);
                if (ownerId) unconscious.add(ownerId);
            }
        }
        return Object.freeze(planned.map(plan => {
            const resolvedChecks = plan.checks.flatMap(row => {
                const resolution = resolutionById.get(row.id);
                return resolution
                    ? [Object.freeze({ targetNumber: row.targetNumber, resolution })]
                    : [];
            });
            return Object.freeze({
                id: plan.recipient.id,
                wounds: plan.wounds,
                unconscious: plan.recipient.unconscious
                    || resolvedChecks.some(row => row.resolution.outcome === 'failed'),
                checks: Object.freeze(resolvedChecks),
            });
        }));
    }

    private consciousnessWoundLevels(
        ruleset: CBTRuleset,
        recipient: CrewHitRecipient,
        finalWounds: number,
    ): readonly number[] {
        if (recipient.unavailable || recipient.unconscious
            || finalWounds <= recipient.wounds || finalWounds >= MAX_MEK_CREW_WOUNDS) return [];
        if (ruleset === 'core-2026') return [finalWounds];
        return Array.from(
            { length: finalWounds - recipient.wounds },
            (_unused, index) => recipient.wounds + index + 1,
        );
    }

    private description(
        recipient: CrewHitRecipient,
        woundLevel: number,
        finalWounds: number,
    ): string {
        const prefix = recipient.name ? `${recipient.name}: ` : '';
        const hitText = woundLevel < finalWounds
            ? `Pilot hit ${woundLevel} of ${finalWounds}`
            : `${finalWounds} pilot hit${finalWounds === 1 ? '' : 's'}`;
        return `${prefix}${hitText}.`;
    }
}
