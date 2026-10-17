// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { inject,Injectable } from '@angular/core';
import type { CBTUnitCommand } from '../models/runtime/unit-command';

import type { AutomationCheck,AutomationCheckResolution } from '../models/automation-check.model';
import type { AutomationReviewEvent } from '../models/automation-review.model';
import { isCaseEquipment } from '../models/case-equipment.model';
import type { CBTForce } from '../models/cbt-force.model';
import type { CBTForceUnitCommandDispatch,CBTForceUnitCommandResult } from '../models/cbt-force.types';
import {
cbtUnitCheckAutomaticMessage,
cbtUnitCheckPresentation,
} from '../models/cbt-unit-check-presentation';
import { hasNonMekRuntime,type CBTUnitSnapshot } from '../models/cbt-unit-snapshot';
import { activeCrewController,DEFAULT_PILOTING_SKILL } from '../models/crew-member.model';
import { isDroneOperatingSystemEquipment } from '../models/drone-operating-system.model';
import type { BaseEntity } from '../models/entity/base-entity';
import type { AeroEntity } from '../models/entity/entities/aero/aero-entity';
import type { CrewPositionId } from '../models/entity/entity-identifiers';
import { isAeroEntity, isVehicleEntity } from '../models/entity/utils/entity-type-guards';
import type { WeaponEquipment } from '../models/equipment.model';
import { projectAeroRuntimeRules } from '../models/rules/aero-runtime-rules';
import { projectAeroHeatAutomationChecks } from '../models/runtime/aero-heat-automation-rules';
import { heatAmmoExplosionCandidates, twoD6Total, type HeatAmmoExplosionCandidate } from '../models/runtime/mek-automation-rules';
import { ammoExplosionDamagePerShot } from '../models/runtime/mek-critical-hit-v2';
import { hotLoadedAmmoForWeapon } from '../models/runtime/mek-ammo';
import type { NonMekRuntimeIndex } from '../models/runtime/non-mek-runtime-index';
import { projectNonMekEndTurnHeat,type NonMekControlRecoveryCause,type NonMekControlRecoveryWorkflow,type NonMekUnitRuntimeState } from '../models/runtime/non-mek-unit-instance';
import type { UnitConditionKey } from '../models/unit-condition.model';
import { automationCheckEvidenceDice,CBTAutomationCheckService } from './cbt-automation-check.service';
import { CBTAutomationToastService } from './cbt-automation-toast.service';
import { CBTAutomationService } from './cbt-automation.service';
import {
CBTCrewHitAutomationService,
type PreparedCrewRecovery,
type ResolvedCrewHits,
} from './cbt-crew-hit-automation.service';
import { directAutomationSubject } from './direct-automation-subject';
import {
EndTurnHeatAutomationService,
stagedEndTurnHeatChecks,
type EndTurnHeatAdapter,
type PreparedEndTurnHeatEffects,
type StagedEndTurnHeat,
} from './end-turn-heat-automation.service';
import { OptionsService } from './options.service';
import type { Toast } from './toast.service';

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

export interface PreparedDirectNonMekAutomationCommand {
    readonly command: CBTUnitCommand;
    readonly cancelled?: true;
    readonly heatEffects?: PreparedEndTurnHeatEffects<StagedAeroHeatEffects>;
    readonly phaseBoundary?: PreparedNonMekPhaseBoundary;
}

export interface DirectNonMekEndTurnAutomationRequest {
    readonly instanceId: string;
    readonly command: Extract<CBTUnitCommand, { readonly type: 'end-turn' }>;
}

export interface PreparedDirectNonMekEndTurnAutomation {
    readonly instanceId: string;
    readonly prepared: PreparedDirectNonMekAutomationCommand;
}

export interface DirectNonMekEndPhaseAutomationRequest {
    readonly instanceId: string;
    readonly command: Extract<CBTUnitCommand, { readonly type: 'end-phase' }>;
}

export interface PreparedDirectNonMekEndPhaseAutomation {
    readonly instanceId: string;
    readonly prepared: PreparedDirectNonMekAutomationCommand;
}

export interface DirectNonMekAutomationReviewOptions {
    readonly interactive?: boolean;
}

interface StagedAeroHeatEffects extends StagedEndTurnHeat {
    readonly hadHeatControlEffect: boolean;
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
    readonly recoveries: readonly PreparedCrewRecovery[];
    readonly controlRecovery: PreparedNonMekControlRecovery | null;
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
    private readonly endTurnHeat = inject(EndTurnHeatAutomationService);
    private readonly endTurnHeatAdapter: EndTurnHeatAdapter<AeroSnapshot, StagedAeroHeatEffects> = {
        snapshot: (force, instanceId) => this.snapshot(force, instanceId),
        projectHeat: snapshot => {
            const projection = projectNonMekEndTurnHeat(
                snapshot.entity,
                snapshot.index,
                snapshot.state,
                snapshot.ruleset,
            );
            return projection && {
                current: projection.current,
                projected: projection.projected,
                sources: projection.sources,
                dissipationBalance: projection.dissipated,
                consumedDissipation: Math.min(projection.dissipated, projection.current + projection.generated),
            };
        },
        stage: (snapshot, heat) => this.stageAeroHeatEffects(snapshot, heat),
        extraPilotHitDescriptions: () => [],
        applyEffects: (force, instanceId, prepared, dispatch) =>
            this.applyAeroHeatEffects(force, instanceId, prepared, dispatch),
    };

    async prepareCommand(
        force: CBTForce,
        instanceId: string,
        command: CBTUnitCommand,
    ): Promise<PreparedDirectNonMekAutomationCommand> {
        if ((command.type === 'set-component-status' || command.type === 'set-component-statuses')
            && command.status === 'destroyed' && command.applyExplosion === undefined) {
            const snapshot = this.nonMekSnapshot(force, instanceId);
            if (snapshot && isVehicleEntity(snapshot.entity)) {
                const ids = command.type === 'set-component-status' ? [command.componentId] : command.componentIds;
                const perspective = command.target === 'pending' ? 'preview' : 'committed';
                let damage = 0;
                const effects: string[] = [];
                for (const id of ids) {
                    if (snapshot.query.componentStatus(id, perspective) === 'destroyed') continue;
                    const ammo = hotLoadedAmmoForWeapon(snapshot.index, snapshot.query, id, perspective);
                    if (ammo.length === 0) continue;
                    const mount = snapshot.index.components.get(id)!.mount;
                    const rawDamage = (mount.equipment as WeaponEquipment).rackSize * Math.max(...ammo.map(ammoExplosionDamagePerShot));
                    damage += rawDamage;
                    effects.push(`${mount.displayName()} (${mount.location}): ${rawDamage} internal damage`);
                }
                if (damage > 0) {
                    const event: AutomationReviewEvent = { id: 'hot-loaded-launchers', subject: this.subject(snapshot),
                        event: 'Hot-loaded launcher explosion', delta: damage, effects,
                        description: `Apply ${damage} points of internal explosion damage. Vehicles do not roll for a secondary ammo explosion.` };
                    const accepted = await this.automation.resolve('internalExplosionsCheck', [event],
                        { title: 'Review Internal Explosion', allowCancel: true });
                    return accepted === null ? Object.freeze({ command, cancelled: true })
                        : Object.freeze({ command: { ...command, applyExplosion: accepted.has(event.id) } });
                }
            }
        }
        if (command.type === 'set-crew-state') {
            const snapshot = this.nonMekSnapshot(force, instanceId);
            return Object.freeze({
                command: snapshot ? this.crewHitAutomation.withRecoveryReadyTurn(snapshot, command) : command,
            });
        }
        if (command.type === 'end-phase') {
            const batch = await this.prepareEndPhaseCommands(force, [{ instanceId, command }]);
            return batch?.[0]?.prepared ?? Object.freeze({ command, cancelled: true });
        }
        if (command.type !== 'end-turn') return Object.freeze({ command });
        const batch = await this.prepareEndTurnCommands(force, [{ instanceId, command }]);
        return batch?.[0]?.prepared ?? Object.freeze({ command, cancelled: true });
    }

    /** Reviews the complete force-wide non-Mek end-turn plan before mutation. */
    async prepareEndTurnCommands(
        force: CBTForce,
        requests: readonly DirectNonMekEndTurnAutomationRequest[],
        review: DirectNonMekAutomationReviewOptions = {},
    ): Promise<readonly PreparedDirectNonMekEndTurnAutomation[] | null> {
        return this.endTurnHeat.prepare(this.endTurnHeatAdapter, force, requests, review.interactive);
    }

    /** Applies the reviewed heat/consequence chain before the turn reset. */
    async settleBeforeCommand(
        force: CBTForce,
        instanceId: string,
        prepared: PreparedDirectNonMekAutomationCommand,
        dispatch: CBTForceUnitCommandDispatch,
    ): Promise<PreparedDirectNonMekAutomationCommand | null> {
        if (prepared.command.type === 'end-phase' && prepared.phaseBoundary) {
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
        return this.endTurnHeat.settle(this.endTurnHeatAdapter, force, instanceId, prepared, dispatch);
    }

    async afterCommand(
        force: CBTForce,
        instanceId: string,
        before: CBTUnitSnapshot | null,
        prepared: PreparedDirectNonMekAutomationCommand,
        result: CBTForceUnitCommandResult,
        dispatch: CBTForceUnitCommandDispatch,
    ): Promise<boolean> {
        if (!result.accepted || !result.changed) return true;
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
        review: DirectNonMekAutomationReviewOptions = {},
    ): Promise<readonly PreparedDirectNonMekEndPhaseAutomation[] | null> {
        const rows = requests.map(request => {
            const snapshot = this.nonMekSnapshot(force, request.instanceId);
            const recoveries = snapshot
                ? this.crewHitAutomation.stageRecoveries(snapshot)
                : Object.freeze([]);
            return Object.freeze({ request, snapshot, recoveries });
        });
        const recoveries = await this.crewHitAutomation.resolveRecoveries(
            rows.flatMap(row => row.recoveries),
            review.interactive,
        );
        if (recoveries === null) return null;
        const controls = new Map<string, StagedNonMekControlRecovery>();
        const controlCandidates = rows.flatMap(row => {
            if (!row.snapshot || !isAeroEntity(row.snapshot.entity)) return [];
            const recoveredPositions = new Set(row.recoveries
                .filter(recovery => recoveries.get(recovery.eventId)?.recovered)
                .map(recovery => recovery.positionId));
            const control = this.stageControlRecovery(
                row.snapshot as AeroSnapshot,
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
                { title: 'Resolve Pending Checks', interactive: review.interactive },
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
                    recoveries: Object.freeze(row.recoveries
                        .map(recovery => recoveries.get(recovery.eventId)!)),
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

    private stageControlRecovery(
        snapshot: AeroSnapshot,
        recoveredPositions: ReadonlySet<CrewPositionId>,
    ): StagedNonMekControlRecovery | null {
        const workflow = snapshot.state.turn.controlRecovery;
        if (workflow === undefined || workflow.readyTurn > snapshot.state.turn.turnCounter
            || !snapshot.query.hasCondition('out-of-control')) return null;
        if (!this.hasPotentialController(snapshot) && !this.hasDroneController(snapshot)) {
            return null;
        }
        const targetNumber = this.controlRollTarget(snapshot, recoveredPositions);
        const eventId = `control-recovery:${snapshot.instanceId}:${snapshot.query.stateRevision}`;
        return targetNumber !== null && targetNumber <= 12
            ? Object.freeze({ eventId, cause: workflow.cause, targetNumber })
            : Object.freeze({ eventId, cause: workflow.cause, automaticOutcome: 'failed' as const });
    }

    private async applyPhaseBoundary(
        force: CBTForce,
        instanceId: string,
        prepared: PreparedNonMekPhaseBoundary,
        dispatch: CBTForceUnitCommandDispatch,
    ): Promise<boolean> {
        const opening = this.nonMekSnapshot(force, instanceId);
        if (!opening) return false;
        if (!await this.crewHitAutomation.applyRecoveries(
            force,
            instanceId,
            opening,
            prepared.recoveries,
            dispatch,
        )) return false;
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

    private stageAeroHeatEffects(
        snapshot: AeroSnapshot,
        heat: number,
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
                ...stagedEndTurnHeatChecks(snapshot, heat, []),
                hadHeatControlEffect: false,
                ammoCandidates: Object.freeze([]),
            });
        }
        const effects = projection.heat.effects;
        const activeController = activeCrewController(snapshot, 'aeroPiloting') !== null;
        const ammoCandidates = heatAmmoExplosionCandidates(snapshot);
        const hadHeatControlEffect = snapshot.state.turn.controlRecovery?.cause
            === 'heat-random-movement'
            && snapshot.query.hasCondition('out-of-control')
            && snapshot.query.hasCondition('random-movement');
        const checks = projectAeroHeatAutomationChecks({
            effects,
            shutdown: snapshot.query.hasCondition('shutdown'),
            activeController,
            hasExplosiveAmmo: ammoCandidates.length > 0,
            hadHeatControlEffect,
        });
        return Object.freeze({
            ...stagedEndTurnHeatChecks(snapshot, heat, checks),
            hadHeatControlEffect,
            ammoCandidates,
        });
    }

    private async applyAeroHeatEffects(
        force: CBTForce,
        instanceId: string,
        prepared: PreparedEndTurnHeatEffects<StagedAeroHeatEffects>,
        dispatch: CBTForceUnitCommandDispatch,
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
            ? await this.crewHitAutomation.resolveUnitHits(
                snapshot,
                pilotHits,
                `crew-hits:${snapshot.instanceId}:${snapshot.query.stateRevision}`,
                { interactive: prepared.interactive },
            )
            : Object.freeze([]);
        if (crewPlan === null) return false;
        for (const row of prepared.staged.checks) {
            switch (row.check.kind) {
                case 'shutdown':
                    if (row.outcome === 'failed') {
                        const result = await dispatch({
                            type: 'set-condition', condition: 'shutdown', active: true,
                        }, false);
                        if (!result.accepted) return false;
                    }
                    break;
                case 'startup':
                    if (row.outcome === 'success') {
                        const result = await dispatch({
                            type: 'set-condition', condition: 'shutdown', active: false,
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
        this.crewHitAutomation.showConsciousnessToasts(snapshot, crewPlan);
        return true;
    }

    private async explodeAmmo(
        force: CBTForce,
        instanceId: string,
        ammo: HeatAmmoExplosionCandidate,
        dispatch: CBTForceUnitCommandDispatch,
    ): Promise<boolean> {
        let snapshot = this.snapshot(force, instanceId);
        if (!snapshot
            || snapshot.query.componentStatus(ammo.componentId, 'committed') !== 'available') {
            return snapshot !== null;
        }
        const caseProtected = [...snapshot.index.components.values()].some(component =>
            isCaseEquipment(component.mount.equipment)
            && snapshot!.query.componentStatus(component.id, 'committed') === 'available');
        const rawDamage = ammo.shots * ammo.damagePerShot;
        const siDamage = Math.max(1, Math.floor(rawDamage / (caseProtected ? 20 : 10)));

        const destroyed = await dispatch({
            type: 'set-component-status',
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
                    type: 'damage-internal',
                    locationId: si.id,
                    amount: damage,
                    target: 'committed',
                }, false);
                if (!damaged.accepted) return false;
            }
        }
        return true;
    }

    private async applyResolvedCrewHits(
        force: CBTForce,
        instanceId: string,
        initial: NonMekSnapshot,
        resolved: readonly ResolvedCrewHits[],
        dispatch: CBTForceUnitCommandDispatch,
    ): Promise<boolean> {
        const aeroInitiallyControlled = isAeroEntity(initial.entity)
            && this.hasActiveAeroController(initial as AeroSnapshot);
        if (!await this.crewHitAutomation.applyResolvedHits(initial, resolved, dispatch)) return false;
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

    private hasPotentialController(snapshot: AeroSnapshot): boolean {
        return [...snapshot.index.crewPositions.keys()].some(positionId =>
            snapshot.query.crewState(positionId).isAliveAboard());
    }

    private hasActiveAeroController(snapshot: AeroSnapshot): boolean {
        return activeCrewController(snapshot, 'aeroPiloting') !== null
            || this.hasDroneController(snapshot);
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
        snapshot: AeroSnapshot,
        recoveredPositions: ReadonlySet<CrewPositionId>,
    ): number | null {
        const controller = activeCrewController(snapshot, 'aeroPiloting', recoveredPositions);
        if (!controller && !this.hasDroneController(snapshot)) return null;
        const base = controller?.piloting ?? DEFAULT_PILOTING_SKILL;
        const wounds = controller?.member.wounds ?? 0;
        const systemDamage = [...snapshot.index.damageTracks.values()].filter(track =>
            (track.system === 'avionics' || track.system === 'life-support')
            && (snapshot.state.damageTracks.get(track.id)?.hits ?? 0) > 0).length;
        return base + wounds + systemDamage;
    }

    private async setHeatControlConditions(
        force: CBTForce,
        instanceId: string,
        randomMovement: boolean,
        outOfControl: boolean,
        dispatch: CBTForceUnitCommandDispatch,
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
        instanceId: string,
        condition: UnitConditionKey,
        active: boolean,
        dispatch: CBTForceUnitCommandDispatch,
    ): Promise<boolean> {
        const snapshot = this.snapshot(force, instanceId);
        if (!snapshot) return false;
        if (snapshot.query.hasCondition(condition) === active) return true;
        const result = await dispatch({
            type: 'set-condition', condition, active,
        }, false);
        return result.accepted;
    }

    private async setControlRecovery(
        force: CBTForce,
        instanceId: string,
        workflow: NonMekControlRecoveryWorkflow | null,
        dispatch: CBTForceUnitCommandDispatch,
    ): Promise<boolean> {
        const snapshot = this.snapshot(force, instanceId);
        if (!snapshot) return false;
        const current = snapshot.state.turn.controlRecovery;
        if (current?.readyTurn === workflow?.readyTurn && current?.cause === workflow?.cause) {
            return true;
        }
        if (current === undefined && workflow === null) return true;
        const result = await dispatch({
            type: 'set-control-recovery', workflow,
        }, false);
        return result.accepted;
    }

    private snapshot(force: CBTForce, instanceId: string): AeroSnapshot | null {
        const snapshot = force.getUnitSnapshot(instanceId);
        return snapshot && hasNonMekRuntime(snapshot) && isAeroEntity(snapshot.entity)
            ? snapshot as AeroSnapshot
            : null;
    }

    private nonMekSnapshot(force: CBTForce, instanceId: string): NonMekSnapshot | null {
        const snapshot = force.getUnitSnapshot(instanceId);
        return snapshot && hasNonMekRuntime(snapshot)
            ? snapshot as NonMekSnapshot
            : null;
    }

    private subject(snapshot: NonMekSnapshot): string {
        return directAutomationSubject(snapshot, this.options.options().displayUnitNameFormat);
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
