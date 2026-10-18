// SPDX-License-Identifier: GPL-3.0-or-later

import { inject, Injectable } from '@angular/core';

import type {
    AutomationCheck,
    AutomationCheckResolution,
} from '../models/automation-check.model';
import type { CBTForce } from '../models/cbt-force.model';
import type { CBTForceUnitCommandDispatch } from '../models/cbt-force.types';
import { cbtUnitCheckPresentation } from '../models/cbt-unit-check-presentation';
import type { CBTRuleset } from '../models/cbt-ruleset.model';
import type { CBTUnitSnapshot } from '../models/cbt-unit-snapshot';
import { MAX_CREW_WOUNDS } from '../models/crew-member.model';
import type { CrewPositionId } from '../models/entity/entity-identifiers';
import {
    assignedCrewName,
    consciousnessRecoveryReadyTurn,
    crewPositionLabel,
    dueConsciousnessRecoveryTarget,
    mekConsciousnessTarget,
    orderedCrewPositions,
    twoD6Total,
} from '../models/runtime/mek-automation-rules';
import type { CBTUnitCommand } from '../models/runtime/unit-command';
import { automationCheckEvidenceDice, CBTAutomationCheckService } from './cbt-automation-check.service';
import { CBTAutomationToastService } from './cbt-automation-toast.service';
import { directAutomationSubject } from './direct-automation-subject';
import { OptionsService } from './options.service';
import type { Toast } from './toast.service';

export interface CrewHitRecipient {
    readonly id: string;
    readonly name?: string;
    readonly wounds: number;
    readonly unconscious: boolean;
    readonly unavailable: boolean;
    readonly hits: number;
    /**
     * Core p.117 timing: `deferred` hits wound now and roll at the end of the combat phase;
     * `due` is that one end-of-phase roll, at the warrior's current hits.
     */
    readonly consciousness?: 'deferred' | 'due';
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
    /** Core p.117: `deferred` when this warrior's consciousness roll waits for the end of the combat phase. */
    readonly consciousness?: 'deferred';
}

export interface CrewHitAutomationOptions {
    /** Badge-driven parent work keeps every resulting consciousness stage interactive. */
    readonly interactive?: boolean;
}

export interface UnitCrewHitOptions extends CrewHitAutomationOptions {
    /** Crew health after earlier hit groups that are preflighted but not yet applied. */
    readonly projected?: ReadonlyMap<CrewPositionId, Readonly<{ wounds: number; unconscious: boolean }>>;
    /** The hits come from combat-phase damage, which resolves at the end of the phase. */
    readonly combatPhase?: boolean;
    /** Crew members already owing this phase's consciousness roll. */
    readonly consciousnessRollsDue?: ReadonlySet<CrewPositionId>;
}

/** A recovery roll due at a phase boundary. */
export interface StagedCrewRecovery {
    readonly eventId: string;
    readonly positionId: CrewPositionId;
    readonly targetNumber: number;
    readonly subject: string;
    readonly crewName?: string;
}

export interface PreparedCrewRecovery {
    readonly eventId: string;
    readonly positionId: CrewPositionId;
    readonly total: number;
    readonly targetNumber: number;
    readonly recovered: boolean;
    readonly accepted: boolean;
}

type CrewStateCommand = Extract<CBTUnitCommand, { readonly type: 'set-crew-state' }>;

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

/** Crew injury and consciousness automation shared by every CBT unit family. */
@Injectable({ providedIn: 'root' })
export class CBTCrewHitAutomationService {
    private readonly automationChecks = inject(CBTAutomationCheckService);
    private readonly automationToasts = inject(CBTAutomationToastService);
    private readonly options = inject(OptionsService);

    /**
     * A crew member knocked out by hand schedules the same recovery as an automated hit.
     * Every automated crew edit is prepared here before it is dispatched.
     */
    withRecoveryReadyTurn(snapshot: CBTUnitSnapshot, command: CrewStateCommand): CrewStateCommand {
        if (!command.unconscious || snapshot.query.crewState(command.positionId).unconscious) return command;
        return Object.freeze({
            ...command,
            recoveryReadyTurn: this.recoveryReadyTurn(snapshot.state.turn.turnCounter),
        });
    }

    /** Recovery rolls due at this phase boundary, in station order. */
    stageRecoveries(snapshot: CBTUnitSnapshot): readonly StagedCrewRecovery[] {
        if (this.consciousnessMode() === 'no') return Object.freeze([]);
        const subject = this.subject(snapshot);
        return Object.freeze(orderedCrewPositions(snapshot).flatMap(position => {
            const targetNumber = dueConsciousnessRecoveryTarget(
                snapshot.query.crewState(position.id),
                snapshot.state.turn.turnCounter,
            );
            if (targetNumber === undefined) return [];
            const crewName = assignedCrewName(snapshot, position.id);
            return [Object.freeze({
                eventId: `consciousness:${snapshot.instanceId}:${snapshot.query.stateRevision}:${position.id}`,
                positionId: position.id,
                targetNumber,
                subject,
                ...(crewName === undefined ? {} : { crewName }),
            })];
        }));
    }

    /** Rolls every staged recovery in one review; null when the review is closed. */
    async resolveRecoveries(
        recoveries: readonly StagedCrewRecovery[],
        interactive?: boolean,
    ): Promise<ReadonlyMap<string, PreparedCrewRecovery> | null> {
        const resolutions = await this.automationChecks.resolve(
            'pilotHitsAndConsciousnessCheck',
            recoveries.map(recovery => Object.freeze({
                id: recovery.eventId,
                subject: recovery.subject,
                ...cbtUnitCheckPresentation('consciousness-recovery', { crewName: recovery.crewName }),
                targetNumber: recovery.targetNumber,
            } satisfies AutomationCheck)),
            { title: 'Recover Consciousness', interactive },
        );
        if (resolutions === null) return null;
        const resolutionById = new Map(resolutions.map(resolution => [resolution.id, resolution]));
        return new Map(recoveries.map(recovery => {
            const resolution = resolutionById.get(recovery.eventId);
            const dice = resolution
                ? automationCheckEvidenceDice(resolution, recovery.targetNumber)
                : null;
            return [recovery.eventId, Object.freeze({
                eventId: recovery.eventId,
                positionId: recovery.positionId,
                total: dice === null ? 0 : twoD6Total(dice),
                targetNumber: recovery.targetNumber,
                recovered: resolution?.outcome === 'success',
                accepted: resolution !== undefined,
            } satisfies PreparedCrewRecovery)] as const;
        }));
    }

    /** Applies reviewed recoveries; a failed roll waits until the following turn. */
    async applyRecoveries(
        force: CBTForce,
        instanceId: string,
        opening: CBTUnitSnapshot,
        recoveries: readonly PreparedCrewRecovery[],
        dispatch: CBTForceUnitCommandDispatch,
    ): Promise<boolean> {
        if (this.consciousnessMode() === 'yes') {
            const notification = automaticConsciousnessRecoveryNotification(
                recoveries.filter(recovery => recovery.accepted).map(recovery => ({
                    id: recovery.positionId,
                    targetNumber: recovery.targetNumber,
                    total: recovery.total,
                    recovered: recovery.recovered,
                })),
                id => crewPositionLabel(opening, id as CrewPositionId),
            );
            if (notification) this.toast(opening, notification.message, notification.type);
        }
        for (const recovery of recoveries) {
            if (!recovery.accepted) continue;
            const state = force.getUnitSnapshot(instanceId)?.query.crewState(recovery.positionId);
            if (!state?.unconscious || !state.isAliveAboard()) continue;
            const result = await dispatch({
                type: 'set-crew-state',
                positionId: recovery.positionId,
                wounds: state.wounds,
                unconscious: !recovery.recovered,
                ejected: false,
                ...(recovery.recovered
                    ? {}
                    : { recoveryReadyTurn: opening.state.turn.turnCounter + 1 }),
            }, false);
            if (!result.accepted) return false;
        }
        return true;
    }

    /**
     * Preflights every consciousness roll the hits cause; a number hits every station. Total Warfare
     * rolls for every hit at once (p.41). Core (p.117) rolls once at the warrior's total hits, and holds a
     * combat-phase roll, or one the warrior already owes, for the end of the phase.
     */
    resolveUnitHits(
        initial: CBTUnitSnapshot,
        hits: number | ReadonlyMap<CrewPositionId, number>,
        eventPrefix: string,
        options: UnitCrewHitOptions = {},
    ): Promise<readonly ResolvedCrewHits[] | null> {
        const deferred = (positionId: CrewPositionId): boolean => initial.ruleset === 'core-2026'
            && (options.combatPhase === true || options.consciousnessRollsDue?.has(positionId) === true);
        return this.resolve(
            this.subject(initial),
            initial.ruleset,
            eventPrefix,
            orderedCrewPositions(initial).flatMap(position => {
                const positionHits = typeof hits === 'number' ? hits : hits.get(position.id) ?? 0;
                return positionHits <= 0 ? [] : [this.recipient(
                    initial,
                    position.id,
                    positionHits,
                    deferred(position.id) ? 'deferred' : undefined,
                    options.projected?.get(position.id),
                )];
            }),
            { interactive: options.interactive },
        );
    }

    /** Core p.117: one consciousness roll per listed crew member, at their current hits. */
    resolveDueConsciousness(
        snapshot: CBTUnitSnapshot,
        positionIds: readonly CrewPositionId[],
        eventPrefix: string,
        options: CrewHitAutomationOptions = {},
    ): Promise<readonly ResolvedCrewHits[] | null> {
        return this.resolve(
            this.subject(snapshot),
            snapshot.ruleset,
            eventPrefix,
            orderedCrewPositions(snapshot)
                .filter(position => positionIds.includes(position.id))
                .map(position => this.recipient(snapshot, position.id, 0, 'due')),
            options,
        );
    }

    /** One crew member as a hit recipient; `current` is health after hits preflighted but not yet applied. */
    private recipient(
        snapshot: CBTUnitSnapshot,
        positionId: CrewPositionId,
        hits: number,
        consciousness: CrewHitRecipient['consciousness'],
        current: Readonly<{ wounds: number; unconscious: boolean }> = snapshot.query.crewState(positionId),
    ): CrewHitRecipient {
        const state = snapshot.query.crewState(positionId);
        const name = orderedCrewPositions(snapshot).length > 1 ? assignedCrewName(snapshot, positionId) : undefined;
        return Object.freeze({
            id: positionId,
            ...(name === undefined ? {} : { name }),
            wounds: current.wounds,
            unconscious: current.unconscious,
            unavailable: !state.isAboard() || current.wounds >= MAX_CREW_WOUNDS,
            hits,
            ...(consciousness === undefined ? {} : { consciousness }),
        });
    }

    /** Commits preflighted crew hits; a newly unconscious member schedules recovery. */
    async applyResolvedHits(
        initial: CBTUnitSnapshot,
        resolved: readonly ResolvedCrewHits[],
        dispatch: CBTForceUnitCommandDispatch,
    ): Promise<boolean> {
        for (const position of orderedCrewPositions(initial)) {
            const plan = resolved.find(candidate => candidate.id === position.id);
            const state = initial.query.crewState(position.id);
            if (!plan || !state.isAboard()
                || plan.wounds === state.wounds && plan.unconscious === state.unconscious) continue;
            const result = await dispatch({
                type: 'set-crew-state',
                positionId: position.id,
                wounds: plan.wounds,
                unconscious: plan.unconscious,
                ejected: false,
                ...(plan.unconscious && !state.unconscious
                    ? { recoveryReadyTurn: this.recoveryReadyTurn(initial.state.turn.turnCounter) }
                    : {}),
            }, false);
            if (!result.accepted) return false;
        }
        return true;
    }

    showConsciousnessToasts(
        initial: CBTUnitSnapshot,
        resolved: readonly ResolvedCrewHits[],
    ): void {
        if (this.consciousnessMode() !== 'yes') return;
        const notifications = automaticConsciousnessNotifications(
            resolved,
            id => crewPositionLabel(initial, id as CrewPositionId),
        );
        for (const notification of notifications) {
            this.toast(initial, notification.message, notification.type);
        }
    }

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
                : Math.min(MAX_CREW_WOUNDS, recipient.wounds + appliedHits);
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
                ...(plan.recipient.consciousness === 'deferred' ? { consciousness: 'deferred' as const } : {}),
            });
        }));
    }

    private consciousnessMode() {
        return this.options.cbtAutomationMode('pilotHitsAndConsciousnessCheck');
    }

    private recoveryReadyTurn(turnCounter: number): number | null {
        return consciousnessRecoveryReadyTurn(this.consciousnessMode(), turnCounter);
    }

    private subject(snapshot: CBTUnitSnapshot): string {
        return directAutomationSubject(snapshot, this.options.options().displayUnitNameFormat);
    }

    private toast(snapshot: CBTUnitSnapshot, message: string, type: Toast['type']): void {
        this.automationToasts.show(String(snapshot.instanceId), this.subject(snapshot), message, type);
    }

    private consciousnessWoundLevels(
        ruleset: CBTRuleset,
        recipient: CrewHitRecipient,
        finalWounds: number,
    ): readonly number[] {
        if (recipient.unavailable || recipient.unconscious || recipient.consciousness === 'deferred') return [];
        if (recipient.consciousness === 'due') return finalWounds > 0 && finalWounds < MAX_CREW_WOUNDS ? [finalWounds] : [];
        if (finalWounds <= recipient.wounds || finalWounds >= MAX_CREW_WOUNDS) return [];
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
