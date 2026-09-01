// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { inject, Injectable } from '@angular/core';

import {
    orderedAutomationChecks,
    type AutomationCheck,
    type AutomationCheckResolution,
} from '../models/automation-check.model';
import type { AutomationReviewEvent } from '../models/automation-review.model';
import {
    cbtUnitCheckAutomaticMessage,
    cbtUnitCheckPresentation,
    cbtUnitCheckReviewDescription,
} from '../models/cbt-unit-check-presentation';
import type { CBTForce } from '../models/cbt-force.model';
import type { CBTNonMekUnitCommandResult } from '../models/cbt-force-api';
import { hasNonMekRuntime, type CBTUnitSnapshot } from '../models/cbt-unit-snapshot';
import { isCaseEquipment } from '../models/case-equipment.model';
import { isDroneOperatingSystemEquipment } from '../models/drone-operating-system.model';
import { AmmoEquipment } from '../models/equipment.model';
import type { AeroEntity } from '../models/entity/entities/aero/aero-entity';
import type { BaseEntity } from '../models/entity/base-entity';
import type { ComponentId, CrewPositionId } from '../models/entity/entity-identifiers';
import type { UnitConditionKey } from '../models/unit-condition.model';
import { isAeroEntity } from '../models/entity/utils/entity-type-guards';
import { projectAeroRuntimeRules } from '../models/rules/aero-runtime-rules';
import {
    ammoExplosionDamagePerShot,
    ammoRackSize,
} from '../models/runtime/mek-critical-hit-v2';
import {
    mekConsciousnessTarget,
    twoD6Total,
} from '../models/runtime/mek-automation-rules';
import type { NonMekRuntimeIndex } from '../models/runtime/non-mek-runtime-index';
import {
    projectNonMekEndTurnHeat,
    type NonMekControlRecoveryCause,
    type NonMekControlRecoveryWorkflow,
    type NonMekUnitCommand,
    type NonMekUnitRuntimeState,
} from '../models/runtime/non-mek-unit-instance';
import {
    MAX_MEK_CREW_WOUNDS,
    type UnitInstanceId,
} from '../models/runtime/runtime-state';
import { selectedManualEndTurnHeat } from '../models/runtime/end-turn-heat-selection';
import { CBTAutomationService } from './cbt-automation.service';
import {
    automationCheckEvidenceDice,
    CBTAutomationCheckService,
} from './cbt-automation-check.service';
import { CBTAutomationToastService } from './cbt-automation-toast.service';
import {
    automaticConsciousnessNotifications,
    automaticConsciousnessRecoveryNotification,
    CBTCrewHitAutomationService,
    type ResolvedCrewHits,
} from './cbt-crew-hit-automation.service';
import { OptionsService } from './options.service';
import { directAutomationSubject } from './direct-automation-subject';
import type { Toast } from './toast.service';
import { buildHeatSummaryRows } from '../utils/heat-summary.util';

type AeroSnapshot = Omit<CBTUnitSnapshot, 'entity' | 'index' | 'state'> & Readonly<{
    entity: AeroEntity;
    index: NonMekRuntimeIndex;
    state: NonMekUnitRuntimeState;
}>;

type NonMekSnapshot = Omit<CBTUnitSnapshot, 'entity' | 'index' | 'state'> & Readonly<{
    entity: BaseEntity;
    index: NonMekRuntimeIndex;
    state: NonMekUnitRuntimeState;
}>;

export type DirectNonMekAutomationDispatch = (
    command: NonMekUnitCommand,
    automate?: boolean,
) => Promise<CBTNonMekUnitCommandResult>;

export interface PreparedDirectNonMekAutomationCommand {
    readonly command: NonMekUnitCommand;
    readonly cancelled?: true;
    readonly heatEffects?: PreparedAeroHeatEffects;
    readonly phaseBoundary?: PreparedNonMekPhaseBoundary;
}

export interface DirectNonMekEndTurnAutomationRequest {
    readonly instanceId: UnitInstanceId;
    readonly command: Extract<NonMekUnitCommand, { readonly kind: 'end-turn' }>;
}

export interface PreparedDirectNonMekEndTurnAutomation {
    readonly instanceId: UnitInstanceId;
    readonly prepared: PreparedDirectNonMekAutomationCommand;
}

export interface DirectNonMekEndPhaseAutomationRequest {
    readonly instanceId: UnitInstanceId;
    readonly command: Extract<NonMekUnitCommand, { readonly kind: 'end-phase' }>;
}

export interface PreparedDirectNonMekEndPhaseAutomation {
    readonly instanceId: UnitInstanceId;
    readonly prepared: PreparedDirectNonMekAutomationCommand;
}

type AeroHeatCheckKind =
    | 'shutdown'
    | 'startup'
    | 'ammo-explosion'
    | 'random-movement'
    | 'clear-heat-control'
    | 'pilot-damage';

interface AeroHeatCheck {
    readonly kind: AeroHeatCheckKind;
    readonly target?: number;
    readonly automaticOutcome?: 'success' | 'failed';
}

interface StagedAeroHeatCheck {
    readonly id: string;
    readonly check: AeroHeatCheck;
}

interface RolledAeroHeatCheck extends StagedAeroHeatCheck {
    readonly total: number | null;
    readonly outcome: 'success' | 'failed';
}

interface StagedAeroHeatEffects {
    readonly id: string;
    readonly heat: number;
    readonly checks: readonly StagedAeroHeatCheck[];
    readonly hadHeatControlEffect: boolean;
    readonly ammoCandidates: readonly AeroAmmoExplosionCandidate[];
}

interface ResolvedAeroHeatEffects extends Omit<StagedAeroHeatEffects, 'checks'> {
    readonly checks: readonly RolledAeroHeatCheck[];
    readonly ammo: AeroAmmoExplosionCandidate | null;
}

interface PreparedAeroHeatEffects {
    readonly staged: ResolvedAeroHeatEffects;
    readonly applyEffects: boolean;
    readonly applyPilotHits: boolean;
}

interface PreparedNonMekCrewRecovery {
    readonly eventId: string;
    readonly positionId: CrewPositionId;
    readonly total: number;
    readonly targetNumber: number;
    readonly recovered: boolean;
    readonly accepted: boolean;
}

interface StagedNonMekCrewRecovery {
    readonly eventId: string;
    readonly positionId: CrewPositionId;
    readonly targetNumber: number;
    readonly event: AutomationReviewEvent;
}

interface StagedNonMekControlRecovery {
    readonly eventId: string;
    readonly cause: NonMekControlRecoveryCause;
    readonly targetNumber?: number;
    readonly automaticOutcome?: 'failed';
}

interface PreparedNonMekControlRecovery extends StagedNonMekControlRecovery {
    readonly total: number;
    readonly recovered: boolean;
    readonly accepted: boolean;
}

interface PreparedNonMekPhaseBoundary {
    readonly recoveries: readonly PreparedNonMekCrewRecovery[];
    readonly controlRecovery: PreparedNonMekControlRecovery | null;
}

interface AeroAmmoExplosionCandidate {
    readonly componentId: ComponentId;
    readonly equipment: string;
    readonly location?: string;
    readonly damagePerShot: number;
    readonly shots: number;
    readonly rawDamage: number;
}

interface NonMekEndTurnDecision {
    readonly request: DirectNonMekEndTurnAutomationRequest;
    readonly snapshot: AeroSnapshot | null;
    readonly staged: StagedAeroHeatEffects | null;
    readonly heatAccepted: boolean;
    readonly applyEffects: boolean;
    readonly applyPilotHits: boolean;
}

/**
 * Coordinates direct-runtime automations shared by non-Mek families.
 * Aerospace heat is currently the only non-Mek family with end-turn effects.
 */
@Injectable({ providedIn: 'root' })
export class DirectNonMekAutomationService {
    private readonly automation = inject(CBTAutomationService);
    private readonly automationChecks = inject(CBTAutomationCheckService);
    private readonly automationToasts = inject(CBTAutomationToastService);
    private readonly crewHitAutomation = inject(CBTCrewHitAutomationService);
    private readonly options = inject(OptionsService);

    async prepareCommand(
        force: CBTForce,
        instanceId: UnitInstanceId,
        command: NonMekUnitCommand,
    ): Promise<PreparedDirectNonMekAutomationCommand> {
        if (command.kind === 'set-crew-state') {
            const snapshot = this.nonMekSnapshot(force, instanceId);
            if (snapshot
                && command.unconscious
                && !snapshot.query.crewState(command.positionId).unconscious) {
                return Object.freeze({
                    command: Object.freeze({
                        ...command,
                        recoveryReadyTurn: this.options.cbtAutomationMode(
                            'pilotHitsAndConsciousnessCheck',
                        ) === 'no'
                            ? null
                            : snapshot.state.turn.turnCounter + 1,
                    }),
                });
            }
        }
        if (command.kind === 'end-phase') {
            const batch = await this.prepareEndPhaseCommands(force, [{ instanceId, command }]);
            return batch?.[0]?.prepared ?? Object.freeze({ command, cancelled: true });
        }
        if (command.kind !== 'end-turn') return Object.freeze({ command });
        const batch = await this.prepareEndTurnCommands(force, [{ instanceId, command }]);
        return batch?.[0]?.prepared ?? Object.freeze({ command, cancelled: true });
    }

    /** Reviews the complete force-wide non-Mek end-turn plan before mutation. */
    async prepareEndTurnCommands(
        force: CBTForce,
        requests: readonly DirectNonMekEndTurnAutomationRequest[],
    ): Promise<readonly PreparedDirectNonMekEndTurnAutomation[] | null> {
        const rows = requests.map(request => {
            const snapshot = this.snapshot(force, request.instanceId);
            const projection = snapshot === null
                ? null
                : projectNonMekEndTurnHeat(
                    snapshot.entity,
                    snapshot.index,
                    snapshot.state,
                    snapshot.ruleset,
                );
            const automaticHeat = projection?.projected ?? snapshot?.state.heat.current ?? 0;
            const staged = snapshot
                ? this.stageAeroHeatEffects(
                    snapshot,
                    automaticHeat,
                )
                : null;
            const effects = staged
                ? this.reviewableAeroEffectDescriptions(staged)
                : Object.freeze([]);
            const hasHeatWork = snapshot !== null && projection !== null && (
                projection.projected !== projection.current
                || projection.sources.some(source => source.value !== 0)
                || projection.dissipated > 0
                || snapshot.state.heat.pendingOverride !== undefined
            );
            const event: AutomationReviewEvent | null = snapshot && projection && hasHeatWork
                ? Object.freeze({
                    id: `non-mek-heat:${request.instanceId}`,
                    subject: this.subject(snapshot),
                    event: 'Heat and dissipation',
                    description: `Heat ${projection.current} → ${projection.projected}`,
                    delta: projection.projected - projection.current,
                    breakdown: Object.freeze(buildHeatSummaryRows(
                        projection.sources.filter(source => source.value > 0),
                        projection.dissipated,
                        Math.min(
                            projection.dissipated,
                            projection.current + projection.generated,
                        ),
                        projection.projected,
                    ).map(row => Object.freeze({
                        id: row.id,
                        label: row.label,
                        value: row.value,
                    }))),
                    ...(effects.length === 0 ? {} : { effects }),
                })
                : null;
            return Object.freeze({ request, snapshot, event, staged });
        });
        const heatMode = this.options.cbtAutomationMode('heatAndDissipationResolution');
        const effectsMode = this.options.cbtAutomationMode('heatEffectsCheck');
        const pilotHitsMode = this.options.cbtAutomationMode('pilotHitsAndConsciousnessCheck');

        if (heatMode === 'ask' && effectsMode === 'ask') {
            const events = rows.flatMap(row => {
                const effects = row.staged
                    ? this.reviewableAeroEffectDescriptions(row.staged)
                    : Object.freeze([]);
                if (!row.snapshot || (!row.event && effects.length === 0)) return [];
                return [Object.freeze({
                    id: this.combinedHeatEventId(row.request),
                    subject: this.subject(row.snapshot),
                    event: pilotHitsMode === 'ask'
                        ? 'Heat, dissipation, effects, and pilot hits'
                        : 'Heat, dissipation, and effects',
                    ...(row.event
                        ? {
                            description: row.event.description,
                            ...(row.event.delta === undefined ? {} : { delta: row.event.delta }),
                            ...(row.event.breakdown === undefined ? {} : { breakdown: row.event.breakdown }),
                        }
                        : { description: `Heat ${row.staged?.heat ?? row.snapshot.state.heat.current}` }),
                    ...(effects.length === 0 ? {} : { effects }),
                } satisfies AutomationReviewEvent)];
            });
            const accepted = await this.automation.resolve(
                'heatAndDissipationResolution',
                events,
                {
                    title: 'Review End-Turn Heat',
                    message: pilotHitsMode === 'ask'
                        ? 'Choose which units\' heat, dissipation, heat effects, and pilot hits to apply.'
                        : 'Choose which units\' heat, dissipation, and heat effects to apply.',
                    allowCancel: true,
                },
            );
            if (accepted === null) return null;
            return this.resolveAeroEndTurnDecisions(rows.map(row => {
                const selected = accepted.has(this.combinedHeatEventId(row.request));
                return Object.freeze({
                    request: row.request,
                    snapshot: row.snapshot,
                    staged: row.staged,
                    heatAccepted: row.event !== null && selected,
                    applyEffects: selected,
                    applyPilotHits: selected && pilotHitsMode !== 'no',
                } satisfies NonMekEndTurnDecision);
            }));
        }

        const acceptedHeat = await this.automation.resolve(
            'heatAndDissipationResolution',
            rows.flatMap(row => row.event ? [row.event] : []),
            {
                title: 'Review Heat and Dissipation',
                message: 'Choose which heat and dissipation results to apply.',
                allowCancel: true,
            },
        );
        if (acceptedHeat === null) return null;
        const finalRows = rows.map(row => {
            const heatAccepted = row.event !== null && acceptedHeat.has(row.event.id);
            const finalHeat = heatAccepted
                ? projectNonMekEndTurnHeat(
                    row.snapshot!.entity,
                    row.snapshot!.index,
                    row.snapshot!.state,
                    row.snapshot!.ruleset,
                )?.projected ?? row.snapshot?.state.heat.current ?? 0
                : row.snapshot?.state.heat.pendingOverride
                    ?? row.snapshot?.state.heat.current
                    ?? 0;
            const staged = row.snapshot
                ? this.stageAeroHeatEffects(
                    row.snapshot,
                    finalHeat,
                )
                : null;
            return Object.freeze({ ...row, heatAccepted, staged });
        });
        const combinesEffectsAndPilotHits = effectsMode === 'ask' && pilotHitsMode === 'ask';
        const effectEvents = finalRows.flatMap(row => {
            if (!row.snapshot || !row.staged) return [];
            const effects = this.reviewableAeroEffectDescriptions(row.staged);
            if (effects.length === 0) return [];
            return [Object.freeze({
                id: row.staged.id,
                subject: this.subject(row.snapshot),
                event: combinesEffectsAndPilotHits
                    ? 'Heat effects and pilot hits'
                    : 'Heat effects',
                ...(row.heatAccepted && row.event
                    ? {
                        description: row.event.description,
                        ...(row.event.delta === undefined ? {} : { delta: row.event.delta }),
                        ...(row.event.breakdown === undefined ? {} : { breakdown: row.event.breakdown }),
                    }
                    : { description: `Heat ${row.staged.heat}` }),
                effects,
            } satisfies AutomationReviewEvent)];
        });
        const acceptedEffects = await this.automation.resolve(
            'heatEffectsCheck',
            effectEvents,
            {
                title: 'Review End-Turn Heat Effects',
                message: combinesEffectsAndPilotHits
                    ? 'Choose which units\' heat effects and pilot hits to resolve.'
                    : 'Choose which units\' heat effects to resolve.',
                allowCancel: true,
            },
        );
        if (acceptedEffects === null) return null;

        let acceptedPilotHits = new Set<string>();
        if (combinesEffectsAndPilotHits) {
            acceptedPilotHits = new Set(finalRows
                .filter(row => row.staged && acceptedEffects.has(row.staged.id))
                .map(row => this.pilotHitEventId(row.request)));
        } else if (pilotHitsMode === 'yes') {
            acceptedPilotHits = new Set(finalRows
                .filter(row => row.staged && this.aeroPilotHits(row.staged) > 0
                    && acceptedEffects.has(row.staged.id))
                .map(row => this.pilotHitEventId(row.request)));
        } else if (pilotHitsMode === 'ask') {
            const pilotEvents = finalRows.flatMap(row => {
                if (!row.snapshot || !row.staged || !acceptedEffects.has(row.staged.id)) return [];
                const hits = this.aeroPilotHits(row.staged);
                if (hits === 0) return [];
                return [Object.freeze({
                    id: this.pilotHitEventId(row.request),
                    subject: this.subject(row.snapshot),
                    event: 'Pilot hits and consciousness',
                    description: `Heat ${row.staged.heat}`,
                    effects: Object.freeze(row.staged.checks
                        .filter(check => check.check.kind === 'pilot-damage')
                        .map(check => cbtUnitCheckReviewDescription('pilot-damage', {
                            targetNumber: check.check.target,
                            heat: row.staged!.heat,
                            hits: 1,
                        }))),
                } satisfies AutomationReviewEvent)];
            });
            const decision = await this.automation.resolve(
                'pilotHitsAndConsciousnessCheck',
                pilotEvents,
                {
                    title: 'Review Pilot Hits',
                    message: 'Choose which units\' pilot-hit effects to apply. Accepted hits continue directly into any required Consciousness Rolls.',
                    allowCancel: true,
                },
            );
            if (decision === null) return null;
            acceptedPilotHits = new Set(decision);
        }

        return this.resolveAeroEndTurnDecisions(finalRows.map(row => Object.freeze({
            request: row.request,
            snapshot: row.snapshot,
            staged: row.staged,
            heatAccepted: row.heatAccepted,
            applyEffects: row.staged !== null && acceptedEffects.has(row.staged.id),
            applyPilotHits: acceptedPilotHits.has(this.pilotHitEventId(row.request)),
        } satisfies NonMekEndTurnDecision)));
    }

    /** Applies the reviewed heat/consequence chain before the turn reset. */
    async settleBeforeCommand(
        force: CBTForce,
        instanceId: UnitInstanceId,
        prepared: PreparedDirectNonMekAutomationCommand,
        dispatch: DirectNonMekAutomationDispatch,
    ): Promise<PreparedDirectNonMekAutomationCommand | null> {
        if (prepared.command.kind === 'end-phase' && prepared.phaseBoundary) {
            if (!await this.applyPhaseBoundary(
                force,
                instanceId,
                prepared.phaseBoundary,
                dispatch,
            )) return null;
            const settled = this.nonMekSnapshot(force, instanceId);
            if (!settled) return null;
            return Object.freeze({
                ...prepared,
                command: Object.freeze({
                    ...prepared.command,
                }),
                phaseBoundary: undefined,
            });
        }
        if (prepared.command.kind !== 'end-turn') return prepared;
        const initial = this.snapshot(force, instanceId);
        if (!initial) return null;
        const automaticHeat = prepared.command.heatPolicy === 'automatic';
        const finalHeat = prepared.command.heatPolicy === 'automatic'
            ? prepared.heatEffects?.staged.heat ?? initial.state.heat.current
            : selectedManualEndTurnHeat(
                this.options.cbtAutomationMode('heatAndDissipationResolution'),
                initial.state.heat.current,
                initial.state.heat.pendingOverride,
            );
        const heat = await dispatch({
            kind: 'set-heat',
            heat: finalHeat,
            target: 'committed',
        }, false);
        if (!heat.accepted) return null;
        if (automaticHeat
            && this.options.cbtAutomationMode('heatAndDissipationResolution') === 'yes') {
            this.toast(
                initial,
                `Heat and dissipation: Heat ${initial.state.heat.current} → ${finalHeat}`,
                'info',
            );
        }
        if (prepared.heatEffects) {
            if (!await this.applyAeroHeatEffects(
                force,
                instanceId,
                prepared.heatEffects,
                dispatch,
            )) return null;
        }
        const settled = this.snapshot(force, instanceId);
        if (!settled) return null;
        return Object.freeze({
            ...prepared,
            command: Object.freeze({
                ...prepared.command,
                heatPolicy: 'manual' as const,
            }),
        });
    }

    async afterCommand(
        force: CBTForce,
        instanceId: UnitInstanceId,
        before: CBTUnitSnapshot | null,
        prepared: PreparedDirectNonMekAutomationCommand,
        result: CBTNonMekUnitCommandResult,
        dispatch: DirectNonMekAutomationDispatch,
    ): Promise<boolean> {
        if (!result.accepted || !result.changed) return true;
        const command = prepared.command;
        const after = this.nonMekSnapshot(force, instanceId);
        if (command.kind === 'set-crew-state'
            && before && hasNonMekRuntime(before) && after
            && !await this.recordCrewRecoveryTransition(
                force,
                instanceId,
                before as NonMekSnapshot,
                after,
                command.positionId,
                dispatch,
            )) return false;
        const aeroAfter = this.snapshot(force, instanceId);
        if (aeroAfter?.state.turn.controlRecovery !== undefined
            && !this.hasPotentialController(aeroAfter)
            && !this.hasDroneController(aeroAfter)
            && !await this.setControlRecovery(force, instanceId, null, dispatch)) return false;
        return true;
    }

    /** Groups eligible non-Mek recovery rolls at the force phase boundary. */
    async prepareEndPhaseCommands(
        force: CBTForce,
        requests: readonly DirectNonMekEndPhaseAutomationRequest[],
    ): Promise<readonly PreparedDirectNonMekEndPhaseAutomation[] | null> {
        const rows = requests.map(request => {
            const snapshot = this.nonMekSnapshot(force, request.instanceId);
            const recoveries = snapshot
                ? this.stageCrewRecoveries(snapshot, request.command)
                : Object.freeze([]);
            return Object.freeze({ request, snapshot, recoveries });
        });
        const candidates = rows.flatMap(row => row.recoveries.map(recovery => {
            const snapshot = this.nonMekSnapshot(force, row.request.instanceId);
            const assignment = snapshot?.crewAssignment.positions.find(position =>
                position.positionId === recovery.positionId);
            return Object.freeze({
                id: recovery.eventId,
                subject: recovery.event.subject,
                ...cbtUnitCheckPresentation('consciousness-recovery', {
                    crewName: assignment?.name.trim() || undefined,
                }),
                targetNumber: recovery.targetNumber,
            } satisfies AutomationCheck);
        }));
        const resolutions = await this.automationChecks.resolve(
            'pilotHitsAndConsciousnessCheck',
            candidates,
            { title: 'Recover Consciousness' },
        );
        if (resolutions === null) return null;
        const resolutionById = new Map(resolutions.map(result => [result.id, result]));
        const controls = new Map<UnitInstanceId, StagedNonMekControlRecovery>();
        const controlCandidates = rows.flatMap(row => {
            if (!row.snapshot || !isAeroEntity(row.snapshot.entity)) return [];
            const recoveredPositions = new Set(row.recoveries
                .filter(recovery => resolutionById.get(recovery.eventId)?.outcome === 'success')
                .map(recovery => recovery.positionId));
            const control = this.stageControlRecovery(
                force,
                row.snapshot as AeroSnapshot,
                row.request.command,
                recoveredPositions,
            );
            if (!control) return [];
            controls.set(row.request.instanceId, control);
            return [Object.freeze({
                instanceId: row.request.instanceId,
                key: control.cause === 'heat-random-movement'
                    ? 'heatEffectsCheck' as const
                    : 'pilotHitsAndConsciousnessCheck' as const,
                check: Object.freeze({
                    id: control.eventId,
                    subject: this.subject(row.snapshot),
                    ...cbtUnitCheckPresentation('control-recovery', {
                        controlCause: control.cause,
                    }),
                    ...(control.targetNumber === undefined
                        ? {}
                        : { targetNumber: control.targetNumber }),
                    ...(control.automaticOutcome === undefined
                        ? {}
                        : { automaticOutcome: control.automaticOutcome }),
                } satisfies AutomationCheck),
            })];
        });
        const controlResolutions: AutomationCheckResolution[] = [];
        for (const key of ['heatEffectsCheck', 'pilotHitsAndConsciousnessCheck'] as const) {
            const group = controlCandidates.filter(candidate => candidate.key === key);
            if (group.length === 0) continue;
            if (this.options.cbtAutomationMode(key) === 'no') {
                continue;
            }
            const resolved = await this.automationChecks.resolve(
                key,
                group.map(candidate => candidate.check),
                { title: 'Resolve Pending Checks' },
            );
            if (resolved === null) return null;
            controlResolutions.push(...resolved);
        }
        const controlById = new Map(controlResolutions.map(result => [result.id, result]));
        return Object.freeze(rows.map(row => Object.freeze({
            instanceId: row.request.instanceId,
            prepared: Object.freeze({
                command: row.request.command,
                phaseBoundary: Object.freeze({
                    recoveries: Object.freeze(row.recoveries.map(recovery => {
                        const resolution = resolutionById.get(recovery.eventId);
                        const dice = resolution
                            ? automationCheckEvidenceDice(resolution, recovery.targetNumber)
                            : null;
                        return Object.freeze({
                            eventId: recovery.eventId,
                            positionId: recovery.positionId,
                            total: dice === null ? 0 : twoD6Total(dice),
                            targetNumber: recovery.targetNumber,
                            recovered: resolution?.outcome === 'success',
                            accepted: resolution !== undefined,
                        } satisfies PreparedNonMekCrewRecovery);
                    })),
                    controlRecovery: (() => {
                        const control = controls.get(row.request.instanceId);
                        if (!control) return null;
                        const resolution = controlById.get(control.eventId);
                        const dice = resolution && control.targetNumber !== undefined
                            ? automationCheckEvidenceDice(resolution, control.targetNumber)
                            : null;
                        return Object.freeze({
                            ...control,
                            total: dice === null ? 0 : twoD6Total(dice),
                            recovered: resolution?.outcome === 'success',
                            accepted: resolution !== undefined,
                        } satisfies PreparedNonMekControlRecovery);
                    })(),
                }),
            }),
        })));
    }

    private stageCrewRecoveries(
        snapshot: NonMekSnapshot,
        command: Extract<NonMekUnitCommand, { readonly kind: 'end-phase' }>,
    ): readonly StagedNonMekCrewRecovery[] {
        const positions = [...snapshot.index.crewPositions.values()]
            .sort((left, right) => left.occurrence - right.occurrence);
        if (this.options.cbtAutomationMode('pilotHitsAndConsciousnessCheck') === 'no') {
            return Object.freeze([]);
        }
        return Object.freeze(positions.flatMap(position => {
            const state = snapshot.query.crewState(position.id);
            const crewState = snapshot.state.crew.get(position.id);
            const target = mekConsciousnessTarget(state.wounds);
            const readyTurn = state.recoveryReadyTurn;
            if (!state.unconscious || state.ejected || crewState?.killed
                || target === undefined || readyTurn === null
                || readyTurn !== undefined && readyTurn > snapshot.state.turn.turnCounter) return [];
            const eventId = `consciousness:${snapshot.instanceId}:${snapshot.query.stateRevision}:${position.id}`;
            return [Object.freeze({
                eventId,
                positionId: position.id,
                targetNumber: target,
                event: Object.freeze({
                    id: eventId,
                    subject: directAutomationSubject(snapshot),
                    event: 'Consciousness Recovery',
                    description: `Target ${target}+.`,
                    effects: Object.freeze(['Success: crew member regains consciousness']),
                } satisfies AutomationReviewEvent),
            } satisfies StagedNonMekCrewRecovery)];
        }));
    }

    private stageControlRecovery(
        force: CBTForce,
        snapshot: AeroSnapshot,
        command: Extract<NonMekUnitCommand, { readonly kind: 'end-phase' }>,
        recoveredPositions: ReadonlySet<CrewPositionId>,
    ): StagedNonMekControlRecovery | null {
        const workflow = snapshot.state.turn.controlRecovery;
        if (workflow === undefined || workflow.readyTurn > snapshot.state.turn.turnCounter
            || !snapshot.query.hasCondition('out-of-control')) return null;
        if (!this.hasPotentialController(snapshot) && !this.hasDroneController(snapshot)) {
            return null;
        }
        const targetNumber = this.controlRollTarget(force, snapshot, recoveredPositions);
        const eventId = `control-recovery:${snapshot.instanceId}:${snapshot.query.stateRevision}`;
        return targetNumber !== null && targetNumber <= 12
            ? Object.freeze({ eventId, cause: workflow.cause, targetNumber })
            : Object.freeze({ eventId, cause: workflow.cause, automaticOutcome: 'failed' as const });
    }

    private async applyPhaseBoundary(
        force: CBTForce,
        instanceId: UnitInstanceId,
        prepared: PreparedNonMekPhaseBoundary,
        dispatch: DirectNonMekAutomationDispatch,
    ): Promise<boolean> {
        const opening = this.nonMekSnapshot(force, instanceId);
        if (!opening) return false;
        if (this.options.cbtAutomationMode('pilotHitsAndConsciousnessCheck') === 'yes') {
            const notification = automaticConsciousnessRecoveryNotification(
                prepared.recoveries.filter(recovery => recovery.accepted).map(recovery => ({
                    id: recovery.positionId,
                    targetNumber: recovery.targetNumber,
                    total: recovery.total,
                    recovered: recovery.recovered,
                })),
                id => {
                    const positionId = id as CrewPositionId;
                    const occurrence = opening.index.crewPositions.get(positionId)?.occurrence ?? 0;
                    const assignment = opening.crewAssignment.positions.find(position =>
                        position.positionId === positionId);
                    return assignment?.name.trim() || `Crew ${occurrence + 1}`;
                },
            );
            if (notification) this.toast(opening, notification.message, notification.type);
        }
        for (const recovery of prepared.recoveries) {
            if (!recovery.accepted) continue;
            if (!recovery.recovered) {
                if (!await this.deferCrewRecovery(
                    force,
                    instanceId,
                    recovery.positionId,
                    opening.state.turn.turnCounter,
                    dispatch,
                )) return false;
                continue;
            }
            const snapshot = this.nonMekSnapshot(force, instanceId);
            const state = snapshot?.query.crewState(recovery.positionId);
            const crewState = snapshot?.state.crew.get(recovery.positionId);
            if (!snapshot || !state || state.ejected || !state.unconscious
                || crewState?.killed) continue;
            const result = await dispatch({
                kind: 'set-crew-state',
                positionId: recovery.positionId,
                wounds: state.wounds,
                unconscious: false,
                ejected: state.ejected,
                killed: crewState?.killed === true,
                stunned: crewState?.stunned === true,
            }, false);
            if (!result.accepted) return false;
        }
        const control = prepared.controlRecovery;
        if (control?.accepted) {
            const automationKey = control.cause === 'heat-random-movement'
                ? 'heatEffectsCheck'
                : 'pilotHitsAndConsciousnessCheck';
            if (this.options.cbtAutomationMode(automationKey) === 'yes') {
                this.toast(
                    opening,
                    cbtUnitCheckAutomaticMessage('control-recovery', {
                        outcome: control.recovered ? 'success' : 'failed',
                        total: control.targetNumber === undefined ? null : control.total,
                        targetNumber: control.targetNumber,
                    }, { controlCause: control.cause }),
                    control.recovered ? 'success' : 'error',
                );
            }
            if (control.recovered) {
                if (control.cause === 'heat-random-movement') {
                    if (!await this.setHeatControlConditions(
                        force, instanceId, false, false, dispatch,
                    )) return false;
                } else if (!await this.setCondition(
                    force, instanceId, 'out-of-control', false, dispatch,
                )) return false;
            } else {
                if (!await this.setControlRecovery(force, instanceId, Object.freeze({
                    readyTurn: opening.state.turn.turnCounter + 1,
                    cause: control.cause,
                }), dispatch)) return false;
            }
        }
        return true;
    }

    private async resolveAeroEndTurnDecisions(
        decisions: readonly NonMekEndTurnDecision[],
    ): Promise<readonly PreparedDirectNonMekEndTurnAutomation[] | null> {
        const checks = orderedAutomationChecks(decisions.flatMap(decision => {
            if (!decision.snapshot || !decision.staged || !decision.applyEffects) return [];
            return decision.staged.checks
                .filter(row => row.check.kind !== 'pilot-damage' || decision.applyPilotHits)
                .map(row => Object.freeze({
                    id: row.id,
                    subject: this.subject(decision.snapshot!),
                    ...cbtUnitCheckPresentation(row.check.kind, {
                        targetNumber: row.check.target,
                        heat: decision.staged!.heat,
                        ...(row.check.kind === 'pilot-damage' ? { hits: 1 } : {}),
                    }),
                    ...(row.check.target === undefined ? {} : { targetNumber: row.check.target }),
                    ...(row.check.automaticOutcome === undefined
                        ? {}
                        : { automaticOutcome: row.check.automaticOutcome }),
                    ...(row.check.kind !== 'ammo-explosion'
                        ? {}
                        : {
                            failureChoices: Object.freeze(decision.staged!.ammoCandidates.map(candidate => Object.freeze({
                                id: candidate.componentId,
                                label: `${candidate.equipment}${candidate.location ? ` · ${candidate.location}` : ''}`,
                                detail: `${candidate.damagePerShot}/shot · ${candidate.shots} shots`,
                            }))),
                        }),
                } satisfies AutomationCheck));
        }));
        const resolutions = await this.automationChecks.resolve(
            'heatEffectsCheck',
            checks,
            { title: 'Resolve Pending Checks' },
        );
        if (resolutions === null) return null;
        const resolutionById = new Map(resolutions.map(result => [result.id, result]));
        return Object.freeze(decisions.map(decision => {
            let staged: ResolvedAeroHeatEffects | null = null;
            if (decision.staged !== null) {
                const ammoCheck = decision.staged.checks.find(row => row.check.kind === 'ammo-explosion');
                const selectedAmmoId = ammoCheck
                    ? resolutionById.get(ammoCheck.id)?.selectionId
                    : undefined;
                const ammo = decision.staged.ammoCandidates.find(candidate =>
                    candidate.componentId === selectedAmmoId)
                    ?? (decision.staged.ammoCandidates.length === 1
                        ? decision.staged.ammoCandidates[0]!
                        : null);
                staged = Object.freeze({
                    ...decision.staged,
                    checks: Object.freeze(decision.staged.checks.map(row => {
                        const resolution = resolutionById.get(row.id);
                        return resolution
                            ? Object.freeze({
                                ...row,
                                total: resolution.dice === null
                                    ? null
                                    : twoD6Total(resolution.dice),
                                outcome: resolution.outcome,
                            })
                            : Object.freeze({
                                ...row,
                                total: null,
                                outcome: row.check.automaticOutcome ?? 'success',
                            });
                    })),
                    ammo,
                });
            }
            return this.preparedAeroEndTurn(
                decision.request,
                decision.heatAccepted,
                staged,
                decision.applyEffects,
                decision.applyPilotHits,
            );
        }));
    }

    private preparedAeroEndTurn(
        request: DirectNonMekEndTurnAutomationRequest,
        heatAccepted: boolean,
        staged: ResolvedAeroHeatEffects | null,
        applyEffects: boolean,
        applyPilotHits: boolean,
    ): PreparedDirectNonMekEndTurnAutomation {
        return Object.freeze({
            instanceId: request.instanceId,
            prepared: Object.freeze({
                command: Object.freeze({
                    ...request.command,
                    heatPolicy: heatAccepted ? 'automatic' as const : 'manual' as const,
                }),
                ...(staged === null ? {} : {
                    heatEffects: Object.freeze({ staged, applyEffects, applyPilotHits }),
                }),
            }),
        });
    }

    private combinedHeatEventId(request: DirectNonMekEndTurnAutomationRequest): string {
        return `end-turn-heat:${request.instanceId}`;
    }

    private pilotHitEventId(request: DirectNonMekEndTurnAutomationRequest): string {
        return `pilot-hits:${request.instanceId}`;
    }

    private stageAeroHeatEffects(
        snapshot: AeroSnapshot,
        heat: number,
    ): StagedAeroHeatEffects {
        const revision = snapshot.query.stateRevision;
        const state: NonMekUnitRuntimeState = heat === snapshot.state.heat.current
            ? snapshot.state
            : Object.freeze({
                ...snapshot.state,
                heat: Object.freeze({ ...snapshot.state.heat, current: heat }),
            });
        const projection = projectAeroRuntimeRules(
            snapshot.entity,
            snapshot.index,
            state,
            snapshot.ruleset,
        );
        if (!projection.heat.tracked) {
            return Object.freeze({
                id: `aero-heat-effects:${snapshot.instanceId}:${revision}`,
                heat,
                checks: Object.freeze([]),
                hadHeatControlEffect: false,
                ammoCandidates: Object.freeze([]),
            });
        }
        const effects = projection.heat.effects;
        const controller = this.activeController(snapshot);
        const ammoCandidates = this.preferredExplosiveAmmoCandidates(snapshot);
        const hadHeatControlEffect = snapshot.state.turn.controlRecovery?.cause
            === 'heat-random-movement'
            && snapshot.query.hasCondition('out-of-control')
            && snapshot.query.hasCondition('random-movement');
        const checks: AeroHeatCheck[] = [];
        if (snapshot.query.hasCondition('shutdown')) {
            if (heat < 14) {
                checks.push(Object.freeze({ kind: 'startup', automaticOutcome: 'success' }));
            } else if (controller && effects.shutdownTarget !== undefined
                && effects.shutdownTarget <= 12) {
                checks.push(Object.freeze({ kind: 'startup', target: effects.shutdownTarget }));
            }
        } else if (effects.shutdownTarget !== undefined) {
            checks.push(Object.freeze(
                effects.shutdownTarget >= 100 || !controller
                    ? { kind: 'shutdown', automaticOutcome: 'failed' }
                    : { kind: 'shutdown', target: effects.shutdownTarget },
            ));
        }
        if (effects.ammoExplosionTarget !== undefined && ammoCandidates.length > 0) {
            checks.push(Object.freeze({
                kind: 'ammo-explosion',
                target: effects.ammoExplosionTarget,
            }));
        }
        if (effects.randomMovementTarget !== undefined) {
            checks.push(Object.freeze({
                kind: 'random-movement',
                target: effects.randomMovementTarget,
            }));
        } else if (heat < 5 && hadHeatControlEffect) {
            checks.push(Object.freeze({
                kind: 'clear-heat-control',
                automaticOutcome: 'success',
            }));
        }
        if (effects.pilotDamageTarget !== undefined) {
            checks.push(Object.freeze({
                kind: 'pilot-damage',
                target: effects.pilotDamageTarget,
            }));
        }
        return Object.freeze({
            id: `aero-heat-effects:${snapshot.instanceId}:${revision}`,
            heat,
            checks: Object.freeze(checks.map((check, index): StagedAeroHeatCheck => Object.freeze({
                id: `aero-heat-effect:${snapshot.instanceId}:${revision}:${index}`,
                check,
            }))),
            hadHeatControlEffect,
            ammoCandidates,
        });
    }

    private reviewableAeroEffectDescriptions(staged: StagedAeroHeatEffects): readonly string[] {
        const pilotHitsMode = this.options.cbtAutomationMode('pilotHitsAndConsciousnessCheck');
        return Object.freeze(staged.checks
            .filter(row => row.check.kind !== 'pilot-damage' || pilotHitsMode !== 'no')
            .map(row => cbtUnitCheckReviewDescription(row.check.kind, {
                targetNumber: row.check.target,
                heat: staged.heat,
                ...(row.check.kind === 'pilot-damage' ? { hits: 1 } : {}),
            })));
    }

    private aeroPilotHits(staged: StagedAeroHeatEffects): number {
        return staged.checks.reduce((hits, row) => hits + (
            row.check.kind === 'pilot-damage' ? 1 : 0
        ), 0);
    }

    private async applyAeroHeatEffects(
        force: CBTForce,
        instanceId: UnitInstanceId,
        prepared: PreparedAeroHeatEffects,
        dispatch: DirectNonMekAutomationDispatch,
    ): Promise<boolean> {
        let snapshot = this.snapshot(force, instanceId);
        if (!snapshot) return false;
        if (!prepared.applyEffects) return true;
        const pilotHits = prepared.staged.checks.reduce((hits, row) => hits + (
            row.outcome !== 'failed' ? 0
                : row.check.kind === 'ammo-explosion' && prepared.staged.ammo !== null ? 1
                    : row.check.kind === 'pilot-damage' && prepared.applyPilotHits ? 1
                        : 0
        ), 0);
        // Preflight the complete crew consequence before applying ammunition
        // or condition mutations. CLOSE must leave the whole chain resumable.
        const crewPlan = pilotHits > 0
            ? await this.resolveCrewHits(snapshot, pilotHits)
            : Object.freeze([]);
        if (crewPlan === null) return false;
        for (const row of prepared.staged.checks) {
            switch (row.check.kind) {
                case 'shutdown':
                    if (row.outcome === 'failed') {
                        const result = await dispatch({
                            kind: 'set-condition', condition: 'shutdown', active: true,
                        }, false);
                        if (!result.accepted) return false;
                    }
                    break;
                case 'startup':
                    if (row.outcome === 'success') {
                        const result = await dispatch({
                            kind: 'set-condition', condition: 'shutdown', active: false,
                        }, false);
                        if (!result.accepted) return false;
                    }
                    break;
                case 'ammo-explosion':
                    if (row.outcome === 'failed' && prepared.staged.ammo) {
                        if (!await this.explodeAmmo(
                            force,
                            instanceId,
                            prepared.staged.ammo,
                            dispatch,
                        )) return false;
                    }
                    break;
                case 'random-movement':
                    if (row.outcome === 'failed') {
                        if (!await this.setHeatControlConditions(
                            force, instanceId, true, true, dispatch,
                        )) return false;
                        if (!await this.setControlRecovery(force, instanceId, Object.freeze({
                            readyTurn: snapshot.state.turn.turnCounter + 1,
                            cause: 'heat-random-movement',
                        }), dispatch)) return false;
                    } else if (prepared.staged.hadHeatControlEffect) {
                        if (!await this.setCondition(
                            force, instanceId, 'random-movement', false, dispatch,
                        )) return false;
                    }
                    break;
                case 'clear-heat-control':
                    if (row.outcome === 'success') {
                        if (!await this.setHeatControlConditions(
                            force, instanceId, false, false, dispatch,
                        )) return false;
                    }
                    break;
                case 'pilot-damage':
                    // The complete accepted crew consequence was preflighted
                    // above so it can be committed exactly once below.
                    break;
            }
            snapshot = this.snapshot(force, instanceId) ?? snapshot;
            if (this.options.cbtAutomationMode('heatEffectsCheck') === 'yes'
                && (row.check.kind !== 'pilot-damage' || prepared.applyPilotHits)) {
                this.toast(
                    snapshot,
                    cbtUnitCheckAutomaticMessage(row.check.kind, {
                        outcome: row.outcome,
                        total: row.total,
                        targetNumber: row.check.target,
                    }, row.check.kind === 'pilot-damage' ? { hits: 1 } : {}),
                    row.outcome === 'success' ? 'success' : 'error',
                );
            }
        }
        if (!await this.applyResolvedCrewHits(
            force,
            instanceId,
            snapshot,
            crewPlan,
            dispatch,
        )) return false;
        this.showAutomaticConsciousnessToasts(snapshot, crewPlan);
        return true;
    }

    private async explodeAmmo(
        force: CBTForce,
        instanceId: UnitInstanceId,
        ammo: AeroAmmoExplosionCandidate,
        dispatch: DirectNonMekAutomationDispatch,
    ): Promise<boolean> {
        let snapshot = this.snapshot(force, instanceId);
        if (!snapshot
            || snapshot.query.componentStatus(ammo.componentId, 'committed') !== 'available') {
            return snapshot !== null;
        }
        const caseProtected = [...snapshot.index.components.values()].some(component =>
            isCaseEquipment(component.mount.equipment)
            && snapshot!.query.componentStatus(component.id, 'committed') === 'available');
        const siDamage = Math.max(1, Math.floor(ammo.rawDamage / (caseProtected ? 20 : 10)));

        const destroyed = await dispatch({
            kind: 'set-component-status',
            componentId: ammo.componentId,
            status: 'destroyed',
            target: 'committed',
        }, false);
        if (!destroyed.accepted) return false;
        snapshot = this.snapshot(force, instanceId);
        const si = snapshot && [...snapshot.index.locations.values()]
            .find(location => location.code === 'SI');
        if (snapshot && si) {
            const damage = Math.min(siDamage, snapshot.query.remainingInternal(si.id, 'committed'));
            if (damage > 0) {
                const damaged = await dispatch({
                    kind: 'damage-internal',
                    locationId: si.id,
                    amount: damage,
                    target: 'committed',
                }, false);
                if (!damaged.accepted) return false;
            }
        }
        return true;
    }

    private resolveCrewHits(
        initial: NonMekSnapshot,
        hits: number,
    ): Promise<readonly ResolvedCrewHits[] | null> {
        const positions = [...initial.index.crewPositions.values()]
            .sort((left, right) => left.occurrence - right.occurrence);
        return this.crewHitAutomation.resolve(
            this.subject(initial),
            initial.ruleset,
            `crew-hits:${initial.instanceId}:${initial.query.stateRevision}`,
            positions.map(position => {
                const state = initial.query.crewState(position.id);
                const crewState = initial.state.crew.get(position.id);
                const assignment = initial.crewAssignment.positions.find(candidate =>
                    candidate.positionId === position.id);
                const name = positions.length > 1
                    ? assignment?.name.trim() || assignment?.role.trim()
                    : undefined;
                return Object.freeze({
                    id: position.id,
                    ...(name ? { name } : {}),
                    wounds: state.wounds,
                    unconscious: state.unconscious,
                    unavailable: state.ejected || crewState?.killed === true
                        || state.wounds >= MAX_MEK_CREW_WOUNDS,
                    hits,
                });
            }),
        );
    }

    private async applyResolvedCrewHits(
        force: CBTForce,
        instanceId: UnitInstanceId,
        initial: NonMekSnapshot,
        resolved: readonly ResolvedCrewHits[],
        dispatch: DirectNonMekAutomationDispatch,
    ): Promise<boolean> {
        const aeroInitiallyControlled = isAeroEntity(initial.entity)
            && this.hasActiveAeroController(initial as AeroSnapshot);
        const positions = [...initial.index.crewPositions.values()]
            .sort((left, right) => left.occurrence - right.occurrence);
        for (const position of positions) {
            const plan = resolved.find(candidate => candidate.id === position.id);
            const state = initial.query.crewState(position.id);
            const crewState = initial.state.crew.get(position.id);
            if (!plan || state.ejected || crewState?.killed
                || (plan.wounds === state.wounds
                    && plan.unconscious === state.unconscious)) continue;
            const result = await dispatch({
                kind: 'set-crew-state',
                positionId: position.id,
                wounds: plan.wounds,
                unconscious: plan.unconscious,
                ejected: state.ejected,
                killed: crewState?.killed === true,
                stunned: crewState?.stunned === true,
                ...(plan.unconscious && !state.unconscious
                    ? {
                        recoveryReadyTurn: this.options.cbtAutomationMode(
                            'pilotHitsAndConsciousnessCheck',
                        ) === 'no'
                            ? null
                            : initial.state.turn.turnCounter + 1,
                    }
                    : {}),
            }, false);
            if (!result.accepted) return false;
        }
        const latest = this.snapshot(force, instanceId);
        if (latest
            && aeroInitiallyControlled
            && this.isAeroAirborne(latest)
            && !this.hasActiveAeroController(latest)) {
            if (!await this.setCondition(
                force, instanceId, 'out-of-control', true, dispatch,
            )) return false;
            if (this.hasPotentialController(latest)
                && latest.state.turn.controlRecovery === undefined) {
                if (!await this.setControlRecovery(force, instanceId, Object.freeze({
                    readyTurn: latest.state.turn.turnCounter + 1,
                    cause: 'controller-loss',
                }), dispatch)) return false;
            }
        }
        return true;
    }

    private async deferCrewRecovery(
        force: CBTForce,
        instanceId: UnitInstanceId,
        positionId: CrewPositionId,
        currentTurn: number,
        dispatch: DirectNonMekAutomationDispatch,
    ): Promise<boolean> {
        const snapshot = this.nonMekSnapshot(force, instanceId);
        const state = snapshot?.query.crewState(positionId);
        const crewState = snapshot?.state.crew.get(positionId);
        if (!snapshot || !state || !state.unconscious || state.ejected
            || crewState?.killed || state.wounds >= MAX_MEK_CREW_WOUNDS) return true;
        const result = await dispatch({
            kind: 'set-crew-state',
            positionId,
            wounds: state.wounds,
            unconscious: true,
            ejected: state.ejected,
            killed: crewState?.killed === true,
            stunned: crewState?.stunned === true,
            recoveryReadyTurn: currentTurn + 1,
        }, false);
        return result.accepted;
    }

    private async recordCrewRecoveryTransition(
        force: CBTForce,
        instanceId: UnitInstanceId,
        before: NonMekSnapshot,
        after: NonMekSnapshot,
        positionId: CrewPositionId,
        dispatch: DirectNonMekAutomationDispatch,
    ): Promise<boolean> {
        const previous = before.query.crewState(positionId);
        const current = after.query.crewState(positionId);
        const crewState = after.state.crew.get(positionId);
        if (previous.unconscious || !current.unconscious || current.ejected
            || crewState?.killed || current.wounds >= MAX_MEK_CREW_WOUNDS) return true;
        const recoveryReadyTurn = this.options.cbtAutomationMode(
            'pilotHitsAndConsciousnessCheck',
        ) === 'no' ? null : before.state.turn.turnCounter + 1;
        if (current.recoveryReadyTurn === recoveryReadyTurn) return true;
        const result = await dispatch({
            kind: 'set-crew-state',
            positionId,
            wounds: current.wounds,
            unconscious: true,
            ejected: current.ejected,
            killed: crewState?.killed === true,
            stunned: crewState?.stunned === true,
            recoveryReadyTurn,
        }, false);
        return result.accepted;
    }

    private showAutomaticConsciousnessToasts(
        initial: NonMekSnapshot,
        resolved: readonly ResolvedCrewHits[],
    ): void {
        if (this.options.cbtAutomationMode('pilotHitsAndConsciousnessCheck') !== 'yes') return;
        const crewLabel = (id: string): string => {
            const positionId = id as CrewPositionId;
            const occurrence = initial.index.crewPositions.get(positionId)?.occurrence ?? 0;
            const assignment = initial.crewAssignment.positions.find(position =>
                position.positionId === positionId);
            return assignment?.name.trim() || `Crew ${occurrence + 1}`;
        };
        for (const notification of automaticConsciousnessNotifications(resolved, crewLabel)) {
            this.toast(
                initial,
                notification.message,
                notification.type,
            );
        }
    }

    private preferredExplosiveAmmoCandidates(
        snapshot: AeroSnapshot,
    ): readonly AeroAmmoExplosionCandidate[] {
        const candidates = [...snapshot.index.components.values()].flatMap(component => {
            const ammo = component.mount.equipment;
            if (!(ammo instanceof AmmoEquipment)
                || !ammo.isExplosive()
                || snapshot.query.componentStatus(component.id, 'committed') !== 'available') return [];
            const shots = snapshot.query.remainingAmmo(component.id);
            const damagePerShot = ammoRackSize(ammo) * ammoExplosionDamagePerShot(ammo);
            return shots > 0 && damagePerShot > 0
                ? [Object.freeze({
                    componentId: component.id,
                    equipment: component.mount.displayName(),
                    ...(component.mount.location === 'Unallocated'
                        ? {}
                        : { location: component.mount.location }),
                    damagePerShot,
                    shots,
                    rawDamage: shots * damagePerShot,
                })]
                : [];
        });
        if (candidates.length <= 1) return Object.freeze(candidates);
        const highestDamage = Math.max(...candidates.map(candidate => candidate.damagePerShot));
        const mostDestructive = candidates.filter(candidate =>
            candidate.damagePerShot === highestDamage);
        const mostShots = Math.max(...mostDestructive.map(candidate => candidate.shots));
        return Object.freeze(mostDestructive.filter(candidate => candidate.shots === mostShots));
    }

    private activeController(
        snapshot: AeroSnapshot,
        recoveredPositions: ReadonlySet<CrewPositionId> = new Set<CrewPositionId>(),
    ) {
        const candidates = [...snapshot.index.crewPositions.values()].flatMap(position => {
            const common = snapshot.query.crewState(position.id);
            const crewState = snapshot.state.crew.get(position.id);
            if (common.ejected || common.wounds >= MAX_MEK_CREW_WOUNDS
                || crewState?.killed || crewState?.stunned
                || common.unconscious && !recoveredPositions.has(position.id)) return [];
            const assignment = snapshot.crewAssignment.positions.find(candidate =>
                candidate.positionId === position.id);
            return [Object.freeze({
                positionId: position.id,
                occurrence: position.occurrence,
                piloting: assignment?.piloting ?? 5,
                state: common,
            })];
        });
        return candidates.find(candidate => candidate.occurrence === 0)
            ?? candidates.sort((left, right) =>
                left.piloting - right.piloting
                || left.occurrence - right.occurrence
                || left.positionId.localeCompare(right.positionId))[0]
            ?? null;
    }

    private hasPotentialController(snapshot: AeroSnapshot): boolean {
        return [...snapshot.index.crewPositions.keys()].some(positionId => {
            const common = snapshot.query.crewState(positionId);
            const crewState = snapshot.state.crew.get(positionId);
            return !common.ejected && common.wounds < MAX_MEK_CREW_WOUNDS
                && !crewState?.killed;
        });
    }

    private hasActiveAeroController(snapshot: AeroSnapshot): boolean {
        return this.activeController(snapshot) !== null || this.hasDroneController(snapshot);
    }

    private isAeroAirborne(snapshot: AeroSnapshot): boolean {
        return snapshot.entity.entityType !== 'DropShip'
            || snapshot.state.turn.airborne === true;
    }

    private hasDroneController(snapshot: AeroSnapshot): boolean {
        return [...snapshot.index.components.values()].some(component =>
            isDroneOperatingSystemEquipment(component.mount.equipment)
            && snapshot.query.componentStatus(component.id, 'committed') === 'available');
    }

    private controlRollTarget(
        force: CBTForce,
        snapshot: AeroSnapshot,
        recoveredPositions: ReadonlySet<CrewPositionId> = new Set<CrewPositionId>(),
    ): number | null {
        const controller = this.activeController(snapshot, recoveredPositions);
        const drone = this.hasDroneController(snapshot);
        if (!controller && !drone) return null;
        const profile = force.getUnitCrewProfile(snapshot.instanceId);
        const base = controller
            ? profile?.positions.find(position => position.positionId === controller.positionId)?.piloting ?? 5
            : 5;
        const wounds = controller?.state.wounds ?? 0;
        const systemDamage = [...snapshot.index.damageTracks.values()].filter(track =>
            (track.sheetId.startsWith('avionics_hit_')
                || track.sheetId.startsWith('life_support_hit_'))
            && (snapshot.state.damageTracks.get(track.id)?.hits ?? 0) > 0).length;
        return base + wounds + systemDamage;
    }

    private async setHeatControlConditions(
        force: CBTForce,
        instanceId: UnitInstanceId,
        randomMovement: boolean,
        outOfControl: boolean,
        dispatch: DirectNonMekAutomationDispatch,
    ): Promise<boolean> {
        if (!await this.setCondition(
            force, instanceId, 'random-movement', randomMovement, dispatch,
        )) return false;
        return this.setCondition(
            force, instanceId, 'out-of-control', outOfControl, dispatch,
        );
    }

    private async setCondition(
        force: CBTForce,
        instanceId: UnitInstanceId,
        condition: UnitConditionKey,
        active: boolean,
        dispatch: DirectNonMekAutomationDispatch,
    ): Promise<boolean> {
        const snapshot = this.snapshot(force, instanceId);
        if (!snapshot) return false;
        if (snapshot.query.hasCondition(condition) === active) return true;
        const result = await dispatch({
            kind: 'set-condition', condition, active,
        }, false);
        return result.accepted;
    }

    private async setControlRecovery(
        force: CBTForce,
        instanceId: UnitInstanceId,
        workflow: NonMekControlRecoveryWorkflow | null,
        dispatch: DirectNonMekAutomationDispatch,
    ): Promise<boolean> {
        const snapshot = this.snapshot(force, instanceId);
        if (!snapshot) return false;
        const current = snapshot.state.turn.controlRecovery;
        if (current?.readyTurn === workflow?.readyTurn && current?.cause === workflow?.cause) {
            return true;
        }
        if (current === undefined && workflow === null) return true;
        const result = await dispatch({
            kind: 'set-control-recovery', workflow,
        }, false);
        return result.accepted;
    }

    private snapshot(force: CBTForce, instanceId: UnitInstanceId): AeroSnapshot | null {
        const snapshot = force.getUnitSnapshot(instanceId);
        return snapshot && hasNonMekRuntime(snapshot) && isAeroEntity(snapshot.entity)
            ? snapshot as AeroSnapshot
            : null;
    }

    private nonMekSnapshot(force: CBTForce, instanceId: UnitInstanceId): NonMekSnapshot | null {
        const snapshot = force.getUnitSnapshot(instanceId);
        return snapshot && hasNonMekRuntime(snapshot)
            ? snapshot as NonMekSnapshot
            : null;
    }

    private subject(snapshot: NonMekSnapshot): string {
        return directAutomationSubject(snapshot);
    }

    private toast(snapshot: NonMekSnapshot, message: string, type: Toast['type']): void {
        this.automationToasts.show(
            String(snapshot.instanceId),
            this.subject(snapshot),
            message,
            type,
        );
    }
}
