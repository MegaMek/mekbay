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
import type { ComponentId, CrewPositionId } from '../models/entity/entity-identifiers';
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

type AeroSnapshot = Omit<CBTUnitSnapshot, 'entity' | 'index' | 'state'> & Readonly<{
    entity: AeroEntity;
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

    async prepareCommand(
        force: CBTForce,
        instanceId: UnitInstanceId,
        command: NonMekUnitCommand,
    ): Promise<PreparedDirectNonMekAutomationCommand> {
        if (command.kind !== 'end-turn') return Object.freeze({ command });
        const snapshot = this.snapshot(force, instanceId);
        const projection = snapshot === null
            ? null
            : projectNonMekEndTurnHeat(
                snapshot.entity,
                snapshot.index,
                snapshot.state,
                snapshot.ruleset,
            );
        if (!snapshot || !projection) {
            return Object.freeze({ command: { ...command, heatPolicy: 'manual' as const } });
        }

        const event: AutomationReviewEvent = Object.freeze({
            id: `non-mek-heat:${instanceId}:${command.expectedRevision}`,
            subject: this.subject(snapshot),
            event: 'Resolve Heat and Dissipation',
            description: `${projection.current} heat → ${projection.projected} heat`,
            delta: projection.projected - projection.current,
            breakdown: projection.sources,
        });
        const accepted = await this.automation.resolve(
            'heatAndDissipationResolution',
            [event],
            { title: 'Review Heat', message: 'Apply calculated heat and cooling?' },
        );
        return Object.freeze({
            command: {
                ...command,
                heatPolicy: accepted?.has(event.id) ? 'automatic' as const : 'manual' as const,
            },
        });
    }

    async afterCommand(
        force: CBTForce,
        instanceId: UnitInstanceId,
        prepared: PreparedDirectNonMekAutomationCommand,
        result: CBTNonMekUnitCommandResult,
        dispatch: DirectNonMekAutomationDispatch,
    ): Promise<void> {
        if (!result.accepted || !result.changed || prepared.command.kind !== 'end-turn') return;
        await this.resolveAeroHeatEffects(force, instanceId, dispatch);
    }

    private async resolveAeroHeatEffects(
        force: CBTForce,
        instanceId: UnitInstanceId,
        dispatch: DirectNonMekAutomationDispatch,
    ): Promise<void> {
        let snapshot = this.snapshot(force, instanceId);
        if (!snapshot) return;
        const projection = projectAeroRuntimeRules(
            snapshot.entity,
            snapshot.index,
            snapshot.state,
            snapshot.ruleset,
        );
        if (!projection.heat.tracked) return;

        const effects = projection.heat.effects;
        const controller = this.activeController(snapshot);
        const ammo = this.preferredExplosiveAmmo(snapshot);
        const hadHeatControlEffect = snapshot.query.hasCondition('out-of-control')
            && snapshot.query.hasCondition('random-movement');
        const checks: AeroHeatCheck[] = [];

        if (snapshot.query.hasCondition('shutdown')) {
            if (projection.heat.current < 14) {
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
        } else if (projection.heat.current < 5 && hadHeatControlEffect) {
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

        const revision = snapshot.query.stateRevision;
        const rolled = checks.map((check, index): RolledAeroHeatCheck => {
            const total = check.target === undefined ? null : twoD6Total(roll2D6());
            const outcome = check.automaticOutcome
                ?? (total !== null && check.target !== undefined
                    && succeedsOnTarget(total, check.target) ? 'success' : 'failed');
            return Object.freeze({
                id: `aero-heat-effect:${instanceId}:${revision}:${index}`,
                check,
                total,
                outcome,
            });
        });
        const events = rolled.map(row => Object.freeze({
            id: row.id,
            subject: this.subject(snapshot!),
            event: aeroHeatCheckLabel(row.check.kind),
            description: row.total === null
                ? `Automatic ${row.outcome}.`
                : `Rolled ${row.total} against ${row.check.target}+ (${row.outcome}).`,
            effects: Object.freeze(aeroHeatCheckEffects(row.check.kind, row.outcome, ammo)),
        }));
        const accepted = await this.automation.resolve(
            'heatEffectsCheck',
            events,
            { title: 'Review Aerospace Heat Effects' },
        );
        if (accepted === null) return;

        for (const row of rolled) {
            if (!accepted.has(row.id)) continue;
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
                    if (row.outcome === 'failed' && ammo) {
                        await this.explodeAmmo(force, instanceId, ammo, dispatch, row.id);
                    }
                    break;
                case 'random-movement':
                    if (row.outcome === 'failed') {
                        await this.setHeatControlConditions(force, instanceId, true, true, dispatch);
                    } else if (hadHeatControlEffect) {
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
                    if (row.outcome === 'failed') {
                        await this.reviewAndApplyPilotHits(force, instanceId, 1, dispatch, row.id);
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
        eventId: string,
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
        await this.reviewAndApplyPilotHits(force, instanceId, 1, dispatch, `${eventId}:pilot`);
    }

    private async reviewAndApplyPilotHits(
        force: CBTForce,
        instanceId: UnitInstanceId,
        hits: number,
        dispatch: DirectNonMekAutomationDispatch,
        eventId: string,
    ): Promise<void> {
        const snapshot = this.snapshot(force, instanceId);
        if (!snapshot || hits <= 0) return;
        const event: AutomationReviewEvent = Object.freeze({
            id: eventId,
            subject: this.subject(snapshot),
            event: 'Pilot Hits and Consciousness',
            description: `Apply ${hits} pilot hit${hits === 1 ? '' : 's'} and resolve consciousness.`,
            delta: hits,
        });
        const accepted = await this.automation.resolve(
            'pilotHitsAndConsciousnessCheck',
            [event],
            { title: 'Review Pilot Injury' },
        );
        if (!accepted?.has(event.id)) return;

        for (let index = 0; index < hits; index += 1) {
            const current = this.snapshot(force, instanceId);
            const pilot = current && this.primaryPilot(current);
            if (!current || !pilot || pilot.state.wounds >= MAX_MEK_CREW_WOUNDS) return;
            const wounds = Math.min(MAX_MEK_CREW_WOUNDS, pilot.state.wounds + 1);
            await dispatch(this.command(force, instanceId, {
                kind: 'set-crew-state',
                positionId: pilot.positionId,
                wounds,
                unconscious: pilot.state.unconscious,
                ejected: pilot.state.ejected,
            }), false);
            const target = mekConsciousnessTarget(wounds);
            if (target === undefined || pilot.state.ejected
                || succeedsOnTarget(twoD6Total(roll2D6()), target)) continue;
            const refreshed = this.snapshot(force, instanceId);
            const crew = refreshed?.query.crewState(pilot.positionId);
            if (!refreshed || !crew || crew.ejected || crew.wounds >= MAX_MEK_CREW_WOUNDS) continue;
            await dispatch(this.command(force, instanceId, {
                kind: 'set-crew-state',
                positionId: pilot.positionId,
                wounds: crew.wounds,
                unconscious: true,
                ejected: false,
            }), false);
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
        condition: string,
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
        const snapshot = this.snapshot(force, instanceId);
        if (!snapshot) throw new Error(`Non-Mek runtime ${instanceId} is no longer admitted`);
        return { ...draft, expectedRevision: snapshot.query.stateRevision } as NonMekUnitCommand;
    }

    private snapshot(force: CBTForce, instanceId: UnitInstanceId): AeroSnapshot | null {
        const snapshot = force.getUnitSnapshot(instanceId);
        return snapshot && hasNonMekRuntime(snapshot) && isAeroEntity(snapshot.entity)
            ? snapshot as AeroSnapshot
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
