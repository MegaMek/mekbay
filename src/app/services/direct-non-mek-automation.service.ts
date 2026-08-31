// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { inject, Injectable } from '@angular/core';

import type { AutomationReviewEvent } from '../models/automation-review.model';
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
    roll2D6,
    succeedsOnTarget,
    twoD6Total,
} from '../models/runtime/mek-automation-rules';
import type { NonMekRuntimeIndex } from '../models/runtime/non-mek-runtime-index';
import {
    projectNonMekEndTurnHeat,
    type NonMekUnitCommand,
    type NonMekUnitRuntimeState,
} from '../models/runtime/non-mek-unit-instance';
import {
    MAX_MEK_CREW_WOUNDS,
    type UnitInstanceId,
} from '../models/runtime/runtime-state';
import { CBTAutomationService } from './cbt-automation.service';
import { OptionsService } from './options.service';

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

type NonMekCommandDraft = NonMekUnitCommand extends infer Command
    ? Command extends NonMekUnitCommand
        ? Omit<Command, 'expectedRevision'>
        : never
    : never;

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

type AeroHeatCheckKind =
    | 'shutdown'
    | 'startup'
    | 'ammo-explosion'
    | 'random-movement'
    | 'clear-heat-control'
    | 'control-recovery'
    | 'pilot-damage';

interface AeroHeatCheck {
    readonly kind: AeroHeatCheckKind;
    readonly target?: number;
    readonly automaticOutcome?: 'success' | 'failed';
}

interface RolledAeroHeatCheck {
    readonly id: string;
    readonly check: AeroHeatCheck;
    readonly total: number | null;
    readonly outcome: 'success' | 'failed';
}

interface StagedAeroHeatEffects {
    readonly id: string;
    readonly heat: number;
    readonly checks: readonly RolledAeroHeatCheck[];
    readonly hadHeatControlEffect: boolean;
    readonly ammo: AeroAmmoExplosionCandidate | null;
}

interface PreparedAeroHeatEffects {
    readonly staged: StagedAeroHeatEffects;
    readonly applyEffects: boolean;
    readonly applyPilotHits: boolean;
}

interface PreparedNonMekCrewRecovery {
    readonly eventId: string;
    readonly positionId: CrewPositionId;
    readonly recovered: boolean;
    readonly accepted: boolean;
}

interface PreparedNonMekPhaseBoundary {
    readonly recoveries: readonly PreparedNonMekCrewRecovery[];
}

interface AeroAmmoExplosionCandidate {
    readonly componentId: ComponentId;
    readonly equipment: string;
    readonly damagePerShot: number;
    readonly shots: number;
    readonly rawDamage: number;
}

/**
 * Coordinates direct-runtime automations shared by non-Mek families.
 * Aerospace heat is currently the only non-Mek family with end-turn effects.
 */
@Injectable({ providedIn: 'root' })
export class DirectNonMekAutomationService {
    private readonly automation = inject(CBTAutomationService);
    private readonly options = inject(OptionsService);

    async prepareCommand(
        force: CBTForce,
        instanceId: UnitInstanceId,
        command: NonMekUnitCommand,
    ): Promise<PreparedDirectNonMekAutomationCommand> {
        if (command.kind === 'end-phase') {
            const snapshot = this.nonMekSnapshot(force, instanceId);
            return snapshot
                ? this.preparePhaseBoundary(snapshot, command)
                : Object.freeze({ command });
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
                    force,
                    snapshot,
                    automaticHeat,
                    request.command.expectedRevision,
                )
                : null;
            const effects = staged
                ? this.reviewableAeroEffectDescriptions(staged)
                : Object.freeze([]);
            const event: AutomationReviewEvent | null = snapshot && projection
                ? Object.freeze({
                    id: `non-mek-heat:${request.instanceId}:${request.command.expectedRevision}`,
                    subject: this.subject(snapshot),
                    event: 'Heat and dissipation',
                    description: `${projection.current} heat → ${projection.projected} heat`,
                    delta: projection.projected - projection.current,
                    breakdown: projection.sources,
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
            return Object.freeze(rows.map(row => {
                const selected = accepted.has(this.combinedHeatEventId(row.request));
                return this.preparedAeroEndTurn(
                    row.request,
                    row.event !== null && selected,
                    row.staged,
                    selected,
                    selected && pilotHitsMode !== 'no',
                );
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
                    force,
                    row.snapshot,
                    finalHeat,
                    row.request.command.expectedRevision,
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
                    ? 'Aerospace Heat Effects and Pilot Hits'
                    : 'Aerospace Heat Effects',
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
                title: 'Review Aerospace Heat Effects',
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
                    effects: Object.freeze([
                        `${hits} pilot-hit effect${hits === 1 ? '' : 's'} pending`,
                    ]),
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

        return Object.freeze(finalRows.map(row => this.preparedAeroEndTurn(
            row.request,
            row.heatAccepted,
            row.staged,
            row.staged !== null && acceptedEffects.has(row.staged.id),
            acceptedPilotHits.has(this.pilotHitEventId(row.request)),
        )));
    }

    /** Applies the reviewed heat/consequence chain before the turn reset. */
    async settleBeforeCommand(
        force: CBTForce,
        instanceId: UnitInstanceId,
        prepared: PreparedDirectNonMekAutomationCommand,
        dispatch: DirectNonMekAutomationDispatch,
    ): Promise<PreparedDirectNonMekAutomationCommand | null> {
        if (prepared.command.kind !== 'end-turn') return prepared;
        const initial = this.snapshot(force, instanceId);
        if (!initial) return null;
        const finalHeat = prepared.command.heatPolicy === 'automatic'
            ? prepared.heatEffects?.staged.heat ?? initial.state.heat.current
            : initial.state.heat.pendingOverride ?? initial.state.heat.current;
        const heat = await dispatch(this.command(force, instanceId, {
            kind: 'set-heat',
            heat: finalHeat,
            target: 'committed',
        }), false);
        if (!heat.accepted) return null;
        if (prepared.heatEffects) {
            await this.applyAeroHeatEffects(force, instanceId, prepared.heatEffects, dispatch);
        }
        const settled = this.snapshot(force, instanceId);
        if (!settled) return null;
        return Object.freeze({
            ...prepared,
            command: Object.freeze({
                ...prepared.command,
                expectedRevision: settled.query.stateRevision,
                heatPolicy: 'manual' as const,
            }),
        });
    }

    async afterCommand(
        force: CBTForce,
        instanceId: UnitInstanceId,
        prepared: PreparedDirectNonMekAutomationCommand,
        result: CBTNonMekUnitCommandResult,
        dispatch: DirectNonMekAutomationDispatch,
    ): Promise<boolean> {
        if (!result.accepted || !result.changed) return true;
        if (prepared.command.kind === 'end-phase' && prepared.phaseBoundary) {
            return this.applyPhaseBoundary(
                force,
                instanceId,
                prepared.phaseBoundary,
                dispatch,
            );
        }
        return true;
    }

    private async preparePhaseBoundary(
        snapshot: NonMekSnapshot,
        command: Extract<NonMekUnitCommand, { readonly kind: 'end-phase' }>,
    ): Promise<PreparedDirectNonMekAutomationCommand> {
        if (command.expectedRevision !== snapshot.query.stateRevision) {
            return Object.freeze({ command });
        }
        const rows = [...snapshot.index.crewPositions.values()]
            .sort((left, right) => left.occurrence - right.occurrence)
            .flatMap(position => {
                const state = snapshot.query.crewState(position.id);
                const familyState = snapshot.state.crew.get(position.id)?.state;
                const target = mekConsciousnessTarget(state.wounds);
                if (!state.unconscious || state.ejected || familyState === 'killed'
                    || target === undefined) return [];
                const total = twoD6Total(roll2D6());
                const recovered = succeedsOnTarget(total, target);
                const eventId = `consciousness:${snapshot.instanceId}:${command.expectedRevision}:${position.id}`;
                return [Object.freeze({
                    eventId,
                    positionId: position.id,
                    recovered,
                    event: Object.freeze({
                        id: eventId,
                        subject: snapshot.entity.displayName() || String(snapshot.instanceId),
                        event: 'Consciousness Recovery',
                        description: `Rolled ${total} against ${target}+.`,
                        effects: Object.freeze([
                            recovered ? 'Crew member regains consciousness' : 'Crew member remains unconscious',
                        ]),
                    } satisfies AutomationReviewEvent),
                })];
            });
        const accepted = await this.automation.resolve(
            'pilotHitsAndConsciousnessCheck',
            rows.map(row => row.event),
            { title: 'Review Consciousness Recovery', allowCancel: true },
        );
        if (accepted === null) return Object.freeze({ command, cancelled: true });
        return Object.freeze({
            command,
            phaseBoundary: Object.freeze({
                recoveries: Object.freeze(rows.map(row => Object.freeze({
                    eventId: row.eventId,
                    positionId: row.positionId,
                    recovered: row.recovered,
                    accepted: accepted.has(row.eventId),
                } satisfies PreparedNonMekCrewRecovery))),
            }),
        });
    }

    private async applyPhaseBoundary(
        force: CBTForce,
        instanceId: UnitInstanceId,
        prepared: PreparedNonMekPhaseBoundary,
        dispatch: DirectNonMekAutomationDispatch,
    ): Promise<boolean> {
        for (const recovery of prepared.recoveries) {
            if (!recovery.accepted || !recovery.recovered) continue;
            const snapshot = this.nonMekSnapshot(force, instanceId);
            const state = snapshot?.query.crewState(recovery.positionId);
            const familyState = snapshot?.state.crew.get(recovery.positionId)?.state;
            if (!snapshot || !state || state.ejected || !state.unconscious
                || familyState === 'killed') continue;
            const result = await dispatch(this.command(force, instanceId, {
                kind: 'set-crew-state',
                positionId: recovery.positionId,
                wounds: state.wounds,
                unconscious: false,
                ejected: false,
                ...(familyState === undefined ? {} : { state: familyState }),
            }), false);
            if (!result.accepted) return false;
        }
        return true;
    }

    private preparedAeroEndTurn(
        request: DirectNonMekEndTurnAutomationRequest,
        heatAccepted: boolean,
        staged: StagedAeroHeatEffects | null,
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
        return `end-turn-heat:${request.instanceId}:${request.command.expectedRevision}`;
    }

    private pilotHitEventId(request: DirectNonMekEndTurnAutomationRequest): string {
        return `pilot-hits:${request.instanceId}:${request.command.expectedRevision}`;
    }

    private stageAeroHeatEffects(
        force: CBTForce,
        snapshot: AeroSnapshot,
        heat: number,
        revision: number,
    ): StagedAeroHeatEffects {
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
                ammo: null,
            });
        }
        const effects = projection.heat.effects;
        const controller = this.activeController(snapshot);
        const ammo = this.preferredExplosiveAmmo(snapshot);
        const hadHeatControlEffect = snapshot.query.hasCondition('out-of-control')
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
        if (effects.ammoExplosionTarget !== undefined && ammo) {
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
            if (hadHeatControlEffect) {
                const target = this.controlRollTarget(force, snapshot);
                checks.push(Object.freeze(
                    target !== null && target <= 12
                        ? { kind: 'control-recovery', target }
                        : { kind: 'control-recovery', automaticOutcome: 'failed' },
                ));
            }
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
            checks: Object.freeze(checks.map((check, index): RolledAeroHeatCheck => {
                const total = check.target === undefined ? null : twoD6Total(roll2D6());
                const outcome = check.automaticOutcome
                    ?? (total !== null && check.target !== undefined
                        && succeedsOnTarget(total, check.target) ? 'success' : 'failed');
                return Object.freeze({
                    id: `aero-heat-effect:${snapshot.instanceId}:${revision}:${index}`,
                    check,
                    total,
                    outcome,
                });
            })),
            hadHeatControlEffect,
            ammo,
        });
    }

    private reviewableAeroEffectDescriptions(staged: StagedAeroHeatEffects): readonly string[] {
        const pilotHitsMode = this.options.cbtAutomationMode('pilotHitsAndConsciousnessCheck');
        return Object.freeze(staged.checks
            .filter(row => row.check.kind !== 'pilot-damage' || pilotHitsMode !== 'no')
            .flatMap(row => [
                `${aeroHeatCheckLabel(row.check.kind)}: ${row.total === null
                    ? `automatic ${row.outcome}`
                    : `rolled ${row.total} against ${row.check.target}+ (${row.outcome})`}`,
                ...aeroHeatCheckEffects(row.check.kind, row.outcome, staged.ammo),
            ]));
    }

    private aeroPilotHits(staged: StagedAeroHeatEffects): number {
        return staged.checks.reduce((hits, row) => hits + (
            row.outcome === 'failed'
            && (row.check.kind === 'pilot-damage'
                || row.check.kind === 'ammo-explosion' && staged.ammo !== null)
                ? 1 : 0
        ), 0);
    }

    private async applyAeroHeatEffects(
        force: CBTForce,
        instanceId: UnitInstanceId,
        prepared: PreparedAeroHeatEffects,
        dispatch: DirectNonMekAutomationDispatch,
    ): Promise<void> {
        let snapshot = this.snapshot(force, instanceId);
        if (!snapshot || !prepared.applyEffects) return;
        for (const row of prepared.staged.checks) {
            switch (row.check.kind) {
                case 'shutdown':
                    if (row.outcome === 'failed') {
                        await dispatch(this.command(force, instanceId, {
                            kind: 'set-condition', condition: 'shutdown', active: true,
                        }), false);
                    }
                    break;
                case 'startup':
                    if (row.outcome === 'success') {
                        await dispatch(this.command(force, instanceId, {
                            kind: 'set-condition', condition: 'shutdown', active: false,
                        }), false);
                    }
                    break;
                case 'ammo-explosion':
                    if (row.outcome === 'failed' && prepared.staged.ammo) {
                        await this.explodeAmmo(
                            force,
                            instanceId,
                            prepared.staged.ammo,
                            dispatch,
                            prepared.applyPilotHits,
                        );
                    }
                    break;
                case 'random-movement':
                    if (row.outcome === 'failed') {
                        await this.setHeatControlConditions(force, instanceId, true, true, dispatch);
                    } else if (prepared.staged.hadHeatControlEffect) {
                        await this.setCondition(force, instanceId, 'random-movement', false, dispatch);
                    }
                    break;
                case 'clear-heat-control':
                    if (row.outcome === 'success') {
                        await this.setHeatControlConditions(force, instanceId, false, false, dispatch);
                    }
                    break;
                case 'control-recovery':
                    if (row.outcome === 'success') {
                        await this.setHeatControlConditions(force, instanceId, false, false, dispatch);
                    }
                    break;
                case 'pilot-damage':
                    if (row.outcome === 'failed' && prepared.applyPilotHits) {
                        await this.applyCrewHits(force, instanceId, 1, dispatch);
                    }
                    break;
            }
            snapshot = this.snapshot(force, instanceId) ?? snapshot;
        }
    }

    private async explodeAmmo(
        force: CBTForce,
        instanceId: UnitInstanceId,
        ammo: AeroAmmoExplosionCandidate,
        dispatch: DirectNonMekAutomationDispatch,
        applyPilotHits: boolean,
    ): Promise<void> {
        let snapshot = this.snapshot(force, instanceId);
        if (!snapshot
            || snapshot.query.componentStatus(ammo.componentId, 'committed') !== 'available') return;
        const caseProtected = [...snapshot.index.components.values()].some(component =>
            isCaseEquipment(component.mount.equipment)
            && snapshot!.query.componentStatus(component.id, 'committed') === 'available');
        const siDamage = Math.max(1, Math.floor(ammo.rawDamage / (caseProtected ? 20 : 10)));

        await dispatch(this.command(force, instanceId, {
            kind: 'set-component-status',
            componentId: ammo.componentId,
            status: 'destroyed',
            target: 'committed',
        }), false);
        snapshot = this.snapshot(force, instanceId);
        const si = snapshot && [...snapshot.index.locations.values()]
            .find(location => location.code === 'SI');
        if (snapshot && si) {
            const damage = Math.min(siDamage, snapshot.query.remainingInternal(si.id, 'committed'));
            if (damage > 0) {
                await dispatch(this.command(force, instanceId, {
                    kind: 'damage-internal',
                    locationId: si.id,
                    amount: damage,
                    target: 'committed',
                }), false);
            }
        }
        if (applyPilotHits) await this.applyCrewHits(force, instanceId, 1, dispatch);
    }

    private async applyCrewHits(
        force: CBTForce,
        instanceId: UnitInstanceId,
        hits: number,
        dispatch: DirectNonMekAutomationDispatch,
    ): Promise<void> {
        const initial = this.snapshot(force, instanceId);
        if (!initial || hits <= 0) return;
        const positions = [...initial.index.crewPositions.values()]
            .sort((left, right) => left.occurrence - right.occurrence);
        for (const position of positions) {
            for (let index = 0; index < hits; index += 1) {
                const current = this.snapshot(force, instanceId);
                const crew = current?.query.crewState(position.id);
                const crewState = current?.state.crew.get(position.id)?.state;
                if (!current || !crew || crew.ejected || crewState === 'killed'
                    || crew.wounds >= MAX_MEK_CREW_WOUNDS) break;
                const wounds = Math.min(MAX_MEK_CREW_WOUNDS, crew.wounds + 1);
                await dispatch(this.command(force, instanceId, {
                    kind: 'set-crew-state',
                    positionId: position.id,
                    wounds,
                    unconscious: crew.unconscious,
                    ejected: false,
                }), false);
                const target = mekConsciousnessTarget(wounds);
                if (target === undefined || succeedsOnTarget(twoD6Total(roll2D6()), target)) continue;
                const refreshed = this.snapshot(force, instanceId);
                const state = refreshed?.query.crewState(position.id);
                if (!refreshed || !state || state.ejected
                    || state.wounds >= MAX_MEK_CREW_WOUNDS) continue;
                await dispatch(this.command(force, instanceId, {
                    kind: 'set-crew-state',
                    positionId: position.id,
                    wounds: state.wounds,
                    unconscious: true,
                    ejected: false,
                }), false);
            }
        }
    }

    private preferredExplosiveAmmo(snapshot: AeroSnapshot): AeroAmmoExplosionCandidate | null {
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
                    damagePerShot,
                    shots,
                    rawDamage: shots * damagePerShot,
                })]
                : [];
        });
        return candidates.sort((left, right) =>
            right.damagePerShot - left.damagePerShot
            || right.shots - left.shots
            || left.componentId.localeCompare(right.componentId))[0] ?? null;
    }

    private activeController(snapshot: AeroSnapshot) {
        const pilot = this.primaryPilot(snapshot);
        return pilot && !pilot.state.unconscious && pilot.state.state === undefined
            ? pilot : null;
    }

    private primaryPilot(snapshot: AeroSnapshot): Readonly<{
        positionId: CrewPositionId;
        state: ReturnType<AeroSnapshot['query']['crewState']> & Readonly<{ state?: 'killed' | 'stunned' }>;
    }> | null {
        const positions = [...snapshot.index.crewPositions.values()]
            .sort((left, right) => left.occurrence - right.occurrence);
        for (const position of positions) {
            const common = snapshot.query.crewState(position.id);
            const state = snapshot.state.crew.get(position.id)?.state;
            if (common.ejected || common.wounds >= MAX_MEK_CREW_WOUNDS || state === 'killed') continue;
            return Object.freeze({ positionId: position.id, state: Object.freeze({ ...common, ...(state ? { state } : {}) }) });
        }
        return null;
    }

    private controlRollTarget(force: CBTForce, snapshot: AeroSnapshot): number | null {
        const controller = this.activeController(snapshot);
        const drone = [...snapshot.index.components.values()].find(component =>
            isDroneOperatingSystemEquipment(component.mount.equipment)
            && snapshot.query.componentStatus(component.id, 'committed') === 'available');
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
    ): Promise<void> {
        await this.setCondition(force, instanceId, 'random-movement', randomMovement, dispatch);
        await this.setCondition(force, instanceId, 'out-of-control', outOfControl, dispatch);
    }

    private async setCondition(
        force: CBTForce,
        instanceId: UnitInstanceId,
        condition: UnitConditionKey,
        active: boolean,
        dispatch: DirectNonMekAutomationDispatch,
    ): Promise<void> {
        const snapshot = this.snapshot(force, instanceId);
        if (!snapshot || snapshot.query.hasCondition(condition) === active) return;
        await dispatch(this.command(force, instanceId, {
            kind: 'set-condition', condition, active,
        }), false);
    }

    private command(
        force: CBTForce,
        instanceId: UnitInstanceId,
        draft: NonMekCommandDraft,
    ): NonMekUnitCommand {
        const snapshot = this.nonMekSnapshot(force, instanceId);
        if (!snapshot) throw new Error(`Non-Mek runtime ${instanceId} is no longer admitted`);
        return { ...draft, expectedRevision: snapshot.query.stateRevision } as NonMekUnitCommand;
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

    private subject(snapshot: AeroSnapshot): string {
        return snapshot.entity.displayName() || String(snapshot.instanceId);
    }
}

function aeroHeatCheckLabel(kind: AeroHeatCheckKind): string {
    switch (kind) {
        case 'shutdown': return 'Heat Shutdown Check';
        case 'startup': return 'Shutdown Recovery Check';
        case 'ammo-explosion': return 'Heat Ammunition Explosion Check';
        case 'random-movement': return 'Heat Avoid Roll';
        case 'clear-heat-control': return 'Heat Control Restored';
        case 'control-recovery': return 'Aerospace Control Roll';
        case 'pilot-damage': return 'Heat Pilot Damage Check';
    }
}

function aeroHeatCheckEffects(
    kind: AeroHeatCheckKind,
    outcome: 'success' | 'failed',
    ammo: AeroAmmoExplosionCandidate | null,
): string[] {
    switch (kind) {
        case 'shutdown': return [outcome === 'failed' ? 'Aerospace unit shuts down' : 'Shutdown avoided'];
        case 'startup': return [outcome === 'success' ? 'Aerospace unit starts up' : 'Unit remains shutdown'];
        case 'ammo-explosion': return [outcome === 'failed'
            ? `${ammo?.equipment ?? 'Most dangerous ammunition'} explodes`
            : 'Explosion avoided'];
        case 'random-movement': return [outcome === 'failed'
            ? 'Random movement; unit becomes out of control'
            : 'Random movement avoided'];
        case 'clear-heat-control': return ['Heat-induced random movement and loss of control end'];
        case 'control-recovery': return [outcome === 'success' ? 'Control regained' : 'Unit remains out of control'];
        case 'pilot-damage': return [outcome === 'failed' ? 'Pilot takes 1 hit' : 'Pilot damage avoided'];
    }
}
