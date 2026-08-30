// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { inject, Injectable } from '@angular/core';

import type { AutomationReviewEvent } from '../models/automation-review.model';
import type { CBTForce } from '../models/cbt-force.model';
import type { CBTMekUnitCommandResult } from '../models/cbt-force-api';
import { hasMekRuntime, type CBTUnitSnapshot } from '../models/cbt-unit-snapshot';
import { structureConstructionKind } from '../models/construction-equipment.model';
import { AmmoEquipment } from '../models/equipment.model';
import type { MekEntity } from '../models/entity/entities/mek/mek-entity';
import type {
    ComponentId,
    CrewPositionId,
    LocationId,
} from '../models/entity/entity-identifiers';
import {
    getMekLocationLabel,
    getTopologyFor,
    MEK_TORSO_LOCATIONS,
} from '../models/entity/types';
import { gameRulesFor, type MekExplosionProtection } from '../models/rules/game-rules';
import {
    ammoExplosionDamagePerShot,
    ammoRackSize,
    mekExplosionProtection,
    resolveMekCriticalChance,
    type MekCriticalChanceModifier,
    type MekCriticalChanceResult,
    type MekCriticalRollPlanV2,
} from '../models/runtime/mek-critical-hit-v2';
import {
    mekConsciousnessTarget,
    mekHeatAutomationChecks,
    roll2D6,
    succeedsOnTarget,
    twoD6Total,
} from '../models/runtime/mek-automation-rules';
import {
    resolveMekFallArmorDamage,
    resolveMekFallDamage,
    resolveMekFallHitLocation,
    resolveMekFallOrientation,
    resolveMekStructureDamage,
    resolvedMekFallDamageGroups,
} from '../models/runtime/mek-fall-rules';
import { projectMekLifeSupportPilotDamage } from '../models/runtime/mek-life-support';
import type { MekRuntimeIndex } from '../models/runtime/mek-runtime-index';
import { resolveMekUnitWaterState } from '../models/runtime/mek-targeting-rules';
import {
    createCommandId,
    MAX_MEK_CREW_WOUNDS,
    type MekUnitRuntimeState,
    type UnitInstanceId,
} from '../models/runtime/runtime-state';
import type {
    CBTUnitCommand,
    MekHitArcV2,
    MekUnitQueryPort,
} from '../models/runtime/unit-instance';
import { isModularArmorEquipment } from '../models/modular-armor.model';
import type { MekHitLocationTable } from '../utils/record-sheet-reference-table';
import { CBTAutomationService } from './cbt-automation.service';
import { OptionsService } from './options.service';

type MekSnapshot = Omit<CBTUnitSnapshot, 'entity' | 'index' | 'state' | 'query'> & Readonly<{
    entity: MekEntity;
    index: MekRuntimeIndex;
    state: MekUnitRuntimeState;
    query: MekUnitQueryPort;
}>;

type MekCommandDraft = CBTUnitCommand extends infer Command
    ? Command extends CBTUnitCommand
        ? Omit<Command, 'commandId' | 'expectedRevision'>
        : never
    : never;

export type DirectMekAutomationDispatch = (
    command: CBTUnitCommand,
    automate?: boolean,
) => Promise<CBTMekUnitCommandResult>;

export interface PreparedDirectMekAutomationCommand {
    readonly command: CBTUnitCommand;
    readonly deferredPilotHits: number;
    readonly criticalPlan?: Extract<MekCriticalRollPlanV2, { readonly kind: 'applied' }>;
}

interface DirectCriticalChanceContext {
    /** Used only by table-C/through-armor chances; ordinary penetration never floats. */
    readonly floatingHitArc?: MekHitArcV2;
    /** Exact armor-facing decision captured when this hit reached structure. */
    readonly hardenedArmorApplies?: boolean;
    /** Internal-explosion protection carried into the resulting critical sequence. */
    readonly explosionProtection?: MekExplosionProtection;
    /** A hit that consumed this location's last structure pip. */
    readonly locationDestroyed?: boolean;
}

/**
 * Coordinates user-selected automations around the direct Entity + runtime owner.
 * Rules remain pure or reducer-owned; this service only rolls, reviews, and emits typed commands.
 */
@Injectable({ providedIn: 'root' })
export class DirectMekAutomationService {
    private readonly automation = inject(CBTAutomationService);
    private readonly options = inject(OptionsService);

    async prepareCommand(
        force: CBTForce,
        instanceId: UnitInstanceId,
        command: CBTUnitCommand,
    ): Promise<PreparedDirectMekAutomationCommand> {
        const snapshot = this.snapshot(force, instanceId);
        if (!snapshot) return Object.freeze({ command, deferredPilotHits: 0 });
        if (command.type === 'end-turn') {
            const projection = snapshot.query.heatProjection('automatic');
            if (projection.kind === 'unsupported') {
                return Object.freeze({
                    command: { ...command, policy: 'manual' as const },
                    deferredPilotHits: 0,
                });
            }
            const event: AutomationReviewEvent = Object.freeze({
                id: `${command.commandId}:heat`,
                subject: this.subject(snapshot),
                event: 'Resolve Heat and Dissipation',
                description: `${projection.projection.current} heat → ${projection.projection.projected} heat`,
                delta: projection.projection.delta,
                breakdown: Object.freeze([
                    ...projection.projection.sources.map(source => Object.freeze({
                        id: source.id,
                        label: source.label,
                        value: source.value,
                    })),
                    ...(projection.projection.dissipated > 0 ? [Object.freeze({
                        id: 'dissipation', label: 'Dissipation', value: -projection.projection.dissipated,
                    })] : []),
                ]),
            });
            const accepted = await this.automation.resolve(
                'heatAndDissipationResolution',
                [event],
                { title: 'Review Heat', message: 'Apply calculated heat and cooling?' },
            );
            return Object.freeze({
                command: {
                    ...command,
                    policy: accepted?.has(event.id) ? 'automatic' as const : 'manual' as const,
                },
                deferredPilotHits: 0,
            });
        }
        if (command.type !== 'apply-mek-critical-roll') {
            return Object.freeze({ command, deferredPilotHits: 0 });
        }

        const plan = snapshot.query.mekCriticalRoll(
            command.locationId,
            command.results,
            command.target,
        );
        if (plan.kind !== 'applied' || (!plan.explosion && !plan.pendingExplosion)) {
            return Object.freeze({ command, deferredPilotHits: 0 });
        }
        const rawDamage = plan.explosion?.rawDamage ?? plan.pendingExplosion?.rawDamage ?? 0;
        const event: AutomationReviewEvent = Object.freeze({
            id: `${command.commandId}:explosion`,
            subject: this.subject(snapshot),
            event: `${plan.equipment} Explosion`,
            description: `Apply ${rawDamage} points of internal explosion damage.`,
            delta: rawDamage,
            effects: Object.freeze(plan.explosion?.locations.map(location =>
                `${getMekLocationLabel(location.locationCode) ?? location.locationCode}: `
                + `${location.internalDamage} internal, ${location.armorDamage} armor`) ?? []),
        });
        const explosionAccepted = await this.automation.resolve(
            'internalExplosionsCheck',
            [event],
            { title: 'Review Internal Explosion' },
        );
        const applyExplosion = explosionAccepted?.has(event.id) === true;
        const potentialPilotHits = plan.explosion?.pilotHits
            ?? gameRulesFor(snapshot.ruleset).getMekInternalExplosionPilotHits();
        const deferredPilotHits = applyExplosion
            ? await this.reviewPilotHits(snapshot, potentialPilotHits, `${command.commandId}:pilot`)
            : 0;
        return Object.freeze({
            command: {
                ...command,
                applyExplosion,
                applyPilotHits: false,
                settlePendingExplosion: true,
            },
            deferredPilotHits,
            criticalPlan: plan,
        });
    }

    async afterCommand(
        force: CBTForce,
        instanceId: UnitInstanceId,
        before: CBTUnitSnapshot | null,
        prepared: PreparedDirectMekAutomationCommand,
        result: CBTMekUnitCommandResult,
        dispatch: DirectMekAutomationDispatch,
    ): Promise<void> {
        if (!result.accepted || result.idempotent) return;
        const command = prepared.command;
        if (prepared.deferredPilotHits > 0) {
            await this.applyPilotHits(force, instanceId, prepared.deferredPilotHits, dispatch);
        }
        if (command.type === 'damage-internal') {
            const after = this.snapshot(force, instanceId);
            const perspective = command.target === 'pending' ? 'preview' as const : 'committed' as const;
            await this.resolveCriticalChance(
                force,
                instanceId,
                command.locationId,
                command.target,
                {
                    hardenedArmorApplies: command.hardenedArmorApplies,
                    locationDestroyed: after?.query.remainingInternal(
                        command.locationId,
                        perspective,
                    ) === 0,
                },
                dispatch,
            );
            if (!command.armorDamagedBySameHit) {
                await this.resolveBreachOrFloodLocation(
                    force, instanceId, command.locationId, command.target, dispatch,
                );
            }
        } else if (command.type === 'damage-armor') {
            await this.resolveBreachOrFlood(force, instanceId, command, dispatch);
        } else if (command.type === 'apply-mek-critical-roll'
            && prepared.criticalPlan
            && before
            && hasMekRuntime(before)
            && command.applyExplosion !== false) {
            await this.resolveExplosionConsequences(
                force,
                instanceId,
                before as MekSnapshot,
                prepared.criticalPlan,
                command.target,
                dispatch,
            );
        } else if (command.type === 'end-phase') {
            await this.resolvePhaseBoundary(force, instanceId, dispatch);
        } else if (command.type === 'end-turn') {
            await this.resolveHeatEffects(force, instanceId, before, dispatch);
        }
    }

    private async resolvePhaseBoundary(
        force: CBTForce,
        instanceId: UnitInstanceId,
        dispatch: DirectMekAutomationDispatch,
    ): Promise<void> {
        let handledBoundaryState = false;
        let fallResolved = false;
        for (let pass = 0; pass < 32; pass += 1) {
            const snapshot = this.snapshot(force, instanceId);
            if (!snapshot) return;
            const pendingChecks = snapshot.query.mekPilotChecks().filter(check => check.status === 'pending');
            const automaticFalls = snapshot.query.mekMovementPsrState().automaticFalls;
            if (pendingChecks.length === 0 && automaticFalls.length === 0) break;
            handledBoundaryState = true;

            if (pendingChecks.length > 0) {
                const rolled = pendingChecks.map(check => {
                    const dice = roll2D6();
                    const total = twoD6Total(dice);
                    return Object.freeze({ check, dice, total, failed: total < check.targetNumber });
                });
                const events = rolled.map(row => Object.freeze({
                    id: row.check.checkId,
                    subject: this.subject(snapshot),
                    event: 'Piloting Skill Check',
                    description: `${row.check.reason}: rolled ${row.total} against ${row.check.targetNumber}+`,
                    effects: Object.freeze([row.failed ? 'Failed: the Mek falls' : 'Succeeded']),
                } satisfies AutomationReviewEvent));
                const accepted = await this.automation.resolve(
                    'pilotSkillCheck',
                    events,
                    { title: 'Review Piloting Skill Checks' },
                );
                if (accepted === null) return;
                const dismissed = rolled.filter(row => !accepted.has(row.check.checkId));
                if (dismissed.length > 0) {
                    await dispatch(this.command(force, instanceId, {
                        type: 'dismiss-mek-pilot-checks',
                        checkIds: dismissed.map(row => row.check.checkId),
                    }), false);
                }
                for (const row of rolled.filter(candidate => accepted.has(candidate.check.checkId))) {
                    const resolution = await dispatch(this.command(force, instanceId, {
                        type: 'resolve-mek-pilot-check',
                        checkId: row.check.checkId,
                        evidence: { dice: row.dice },
                    }), false);
                    if (resolution.accepted && row.failed && !fallResolved) {
                        await this.resolveFall(force, instanceId, row.check.reason, dispatch);
                        fallResolved = true;
                    }
                }
            }

            const refreshed = this.snapshot(force, instanceId);
            if (!refreshed) return;
            if (refreshed.query.mekMovementPsrState().automaticFalls.length > 0) {
                if (!fallResolved) {
                    await this.resolveFall(force, instanceId, 'Automatic fall', dispatch);
                    fallResolved = true;
                }
                await dispatch(this.command(force, instanceId, {
                    type: 'dismiss-mek-automatic-falls',
                }), false);
            }
        }
        await this.resolveConsciousnessRecovery(force, instanceId, dispatch);
        if (handledBoundaryState) {
            await dispatch(this.command(force, instanceId, { type: 'end-phase' }), false);
        }
    }

    private async resolveCriticalChance(
        force: CBTForce,
        instanceId: UnitInstanceId,
        sourceLocationId: LocationId,
        target: 'committed' | 'pending',
        context: DirectCriticalChanceContext,
        dispatch: DirectMekAutomationDispatch,
    ): Promise<void> {
        let snapshot = this.snapshot(force, instanceId);
        if (!snapshot) return;
        let locationId = sourceLocationId;
        let floatingDescription: string | undefined;
        if (this.options.options().CBTOptionalRules.floatingCriticals && context.floatingHitArc) {
            const floating = this.rollHitLocation(snapshot, context.floatingHitArc);
            const location = [...snapshot.index.locations.values()].find(row => row.code === floating.location);
            if (location) {
                locationId = location.id;
                floatingDescription = `Floating critical moved to ${floating.locationLabel}.`;
            }
        }
        const profile = snapshot.query.mekCriticalChance(locationId, target);
        if (context.locationDestroyed
            && explosiveCriticalRolls(snapshot, locationId, target).length === 0) return;
        const modifiers: MekCriticalChanceModifier[] = profile.modifiers.flatMap(row => {
            if (row.label !== 'Hardened armor in damaged facing') return [row];
            if (context.hardenedArmorApplies === false) return [];
            return context.hardenedArmorApplies === true
                ? [Object.freeze({ label: row.label, value: row.value })]
                : [row];
        });
        if (snapshot.ruleset === 'core-2026' && context.explosionProtection === 'case-ii') {
            modifiers.push(Object.freeze({ label: 'CASE II internal explosion', value: -1 }));
        }
        const dice = roll2D6();
        const modifier = modifiers.reduce((total, row) =>
            total + (!row.optional || row.enabled ? row.value : 0), 0);
        const total = Math.min(profile.industrialMek ? 14 : 12, twoD6Total(dice) + modifier);
        const outcome = resolveMekCriticalChance(total, profile.canBlowOff, profile.industrialMek);
        const caseIIChecks = snapshot.ruleset === 'total-warfare'
            && context.explosionProtection === 'case-ii'
            && outcome.kind === 'critical-hits'
            ? Array.from({ length: outcome.count }, () => {
                const checkDice = roll2D6();
                const checkTotal = twoD6Total(checkDice);
                return Object.freeze({ dice: checkDice, total: checkTotal, discarded: checkTotal >= 8 });
            })
            : [];
        const event: AutomationReviewEvent = Object.freeze({
            id: `critical:${instanceId}:${snapshot.query.stateRevision}:${locationId}`,
            subject: this.subject(snapshot),
            event: 'Critical Hit Chance',
            description: `Rolled ${twoD6Total(dice)}${modifier === 0 ? '' : ` ${modifier > 0 ? '+' : '−'} ${Math.abs(modifier)}`} = ${total}.`,
            breakdown: Object.freeze(modifiers
                .filter(row => !row.optional || row.enabled)
                .map((row, index) => Object.freeze({ id: String(index), label: row.label, value: row.value }))),
            effects: Object.freeze([
                floatingDescription,
                context.locationDestroyed
                    ? 'Destroyed location: only critical slots that would explode can be hit.'
                    : undefined,
                describeCriticalChance(outcome),
                ...caseIIChecks.map((check, index) =>
                    `CASE II check ${index + 1}: ${check.total} vs 8+ — ${check.discarded ? 'critical discarded' : 'critical applies'}`),
            ].filter((row): row is string => row !== undefined)),
        });
        const accepted = await this.automation.resolve(
            'criticalHitChanceCheck',
            [event],
            { title: 'Review Critical Hit Chance' },
        );
        if (!accepted?.has(event.id) || outcome.kind === 'none') return;
        if (outcome.kind === 'blown-off') {
            await dispatch(this.command(force, instanceId, {
                type: 'apply-mek-blow-off', locationId, target,
            }), false);
            return;
        }
        for (let hit = 0; hit < outcome.count; hit += 1) {
            if (caseIIChecks[hit]?.discarded) continue;
            snapshot = this.snapshot(force, instanceId);
            if (!snapshot) return;
            const rollProfile = snapshot.query.mekCriticalRollProfile(locationId, target);
            if (rollProfile.validRolls.length === 0) return;
            const results = context.locationDestroyed
                ? Object.freeze(Array.from(
                    { length: rollProfile.diceCount },
                    () => randomD6(),
                ))
                : rollProfile.validRolls[randomIndex(rollProfile.validRolls.length)]!;
            if (context.locationDestroyed) {
                const plan = snapshot.query.mekCriticalRoll(locationId, results, target);
                // In a destroyed location a roll against an empty, inert, or otherwise
                // non-explosive slot consumes this critical without applying damage.
                if (plan.kind !== 'applied' || (!plan.explosion && !plan.pendingExplosion)) continue;
            }
            await dispatch(this.command(force, instanceId, {
                type: 'apply-mek-critical-roll', locationId, results, target,
            }), true);
        }
    }

    private async resolveBreachOrFlood(
        force: CBTForce,
        instanceId: UnitInstanceId,
        command: Readonly<{
            faceId: Extract<CBTUnitCommand, { readonly type: 'damage-armor' }>['faceId'];
            target: Extract<CBTUnitCommand, { readonly type: 'damage-armor' }>['target'];
        }>,
        dispatch: DirectMekAutomationDispatch,
    ): Promise<void> {
        const snapshot = this.snapshot(force, instanceId);
        const face = snapshot?.index.armorFaces.get(command.faceId);
        if (!snapshot || !face) return;
        await this.resolveBreachOrFloodLocation(
            force,
            instanceId,
            face.locationId,
            command.target,
            dispatch,
        );
    }

    private async resolveBreachOrFloodLocation(
        force: CBTForce,
        instanceId: UnitInstanceId,
        locationId: LocationId,
        target: 'committed' | 'pending',
        dispatch: DirectMekAutomationDispatch,
    ): Promise<void> {
        const snapshot = this.snapshot(force, instanceId);
        const location = snapshot?.index.locations.get(locationId);
        if (!snapshot || !location || !this.locationUnderwater(snapshot, location.code)) return;
        const perspective = target === 'pending' ? 'preview' as const : 'committed' as const;
        if (snapshot.query.locationCondition(location.id, 'flooded', perspective) > 0
            || snapshot.query.locationCondition(location.id, 'blown-off', perspective) > 0) return;
        const remainingByFacing = location.armorFaceIds.map(faceId =>
            snapshot.query.remainingArmor(faceId, perspective));
        const armorDepleted = remainingByFacing.length === 0
            || remainingByFacing.some(remaining => remaining === 0);
        const rules = gameRulesFor(snapshot.ruleset);
        const dice = armorDepleted ? null : roll2D6();
        const total = dice ? twoD6Total(dice) : null;
        const breached = total !== null && rules.hullBreachCheckSucceeds(total);
        const event: AutomationReviewEvent = Object.freeze({
            id: `breach:${instanceId}:${snapshot.query.stateRevision}:${location.id}`,
            subject: this.subject(snapshot),
            event: armorDepleted ? 'Flood Location' : 'Hull Breach Check',
            description: armorDepleted
                ? `${getMekLocationLabel(location.code) ?? location.code} armor is depleted underwater.`
                : `Rolled ${total} (${rules.getHullBreachCheckRangeLabel()} breaches).`,
            effects: Object.freeze([
                armorDepleted || breached ? 'Location floods' : 'Hull remains intact',
            ]),
        });
        const accepted = await this.automation.resolve(
            'breachAndFloodCheck',
            [event],
            { title: 'Review Breach and Flooding' },
        );
        if (!accepted?.has(event.id) || (!armorDepleted && !breached)) return;
        await dispatch(this.command(force, instanceId, {
            type: 'set-location-condition',
            locationId: location.id,
            condition: 'flooded',
            value: 1,
            target,
        }), false);
    }

    private async resolveExplosionConsequences(
        force: CBTForce,
        instanceId: UnitInstanceId,
        before: MekSnapshot,
        plan: Extract<MekCriticalRollPlanV2, { readonly kind: 'applied' }>,
        target: 'committed' | 'pending',
        dispatch: DirectMekAutomationDispatch,
    ): Promise<void> {
        const after = this.snapshot(force, instanceId);
        if (!after) return;
        const perspective = target === 'pending' ? 'preview' as const : 'committed' as const;
        const armorDamagedLocations = new Set<LocationId>();
        for (const face of before.index.armorFaces.values()) {
            if (before.query.remainingArmor(face.id, perspective)
                <= after.query.remainingArmor(face.id, perspective)) continue;
            armorDamagedLocations.add(face.locationId);
        }
        for (const locationId of armorDamagedLocations) {
            await this.resolveBreachOrFloodLocation(force, instanceId, locationId, target, dispatch);
        }

        const internalDamageLocations = [...before.index.locations.values()].filter(location =>
            before.query.remainingInternal(location.id, perspective)
                > after.query.remainingInternal(location.id, perspective));
        for (const location of internalDamageLocations) {
            const planned = plan.explosion?.locations.find(candidate =>
                candidate.locationId === location.id);
            const directHitSlot = location.id === plan.targetLocationId
                ? before.index.slots.get(plan.slotId)
                : undefined;
            const protection = planned?.protection ?? mekExplosionProtection(
                before.index,
                before.ruleset,
                before.query,
                location.id,
                target,
                directHitSlot,
            );
            await this.resolveCriticalChance(
                force,
                instanceId,
                location.id,
                target,
                {
                    explosionProtection: protection,
                    locationDestroyed: after.query.remainingInternal(
                        location.id,
                        perspective,
                    ) === 0,
                },
                dispatch,
            );
            if (!armorDamagedLocations.has(location.id)) {
                await this.resolveBreachOrFloodLocation(
                    force, instanceId, location.id, target, dispatch,
                );
            }
        }
    }

    private async resolveHeatEffects(
        force: CBTForce,
        instanceId: UnitInstanceId,
        _before: CBTUnitSnapshot | null,
        dispatch: DirectMekAutomationDispatch,
    ): Promise<void> {
        let snapshot = this.snapshot(force, instanceId);
        if (!snapshot) return;
        const ammo = this.preferredExplosiveAmmo(snapshot);
        const pilot = this.primaryPilot(snapshot);
        const checks = mekHeatAutomationChecks({
            heat: snapshot.state.heat.current,
            shutdown: snapshot.query.hasCondition('shutdown'),
            consciousPilot: pilot !== null && !pilot.state.unconscious
                && !pilot.state.ejected && pilot.state.wounds < MAX_MEK_CREW_WOUNDS,
            hasExplosiveAmmo: ammo !== null,
        });
        const rolled = checks.map((check, index) => {
            const dice = check.target === undefined ? null : roll2D6();
            const total = dice === null ? null : twoD6Total(dice);
            const outcome = check.automaticOutcome
                ?? (total !== null && check.target !== undefined && succeedsOnTarget(total, check.target)
                    ? 'success' : 'failed');
            return Object.freeze({ check, index, dice, total, outcome });
        });
        const lifeSupport = projectMekLifeSupportPilotDamage(
            snapshot.entity,
            snapshot.index,
            snapshot.ruleset,
            snapshot.query,
            snapshot.state.heat.current,
        );
        const events: AutomationReviewEvent[] = rolled.map(row => Object.freeze({
            id: `heat-effect:${instanceId}:${snapshot!.query.stateRevision}:${row.index}`,
            subject: this.subject(snapshot!),
            event: heatCheckLabel(row.check.kind),
            description: row.total === null
                ? `Automatic ${row.outcome}.`
                : `Rolled ${row.total} against ${row.check.target}+ (${row.outcome}).`,
            effects: Object.freeze(heatCheckEffects(row.check.kind, row.outcome)),
        }));
        const lifeHits = lifeSupport.heatHits + lifeSupport.oxygenHits;
        if (lifeHits > 0) events.push(Object.freeze({
            id: `heat-effect:${instanceId}:${snapshot.query.stateRevision}:life-support`,
            subject: this.subject(snapshot),
            event: 'Damaged Life Support',
            description: `${lifeHits} pilot hit${lifeHits === 1 ? '' : 's'} from heat or oxygen loss.`,
            delta: lifeHits,
        }));
        const accepted = await this.automation.resolve(
            'heatEffectsCheck',
            events,
            { title: 'Review Heat Effects' },
        );
        if (accepted === null) return;
        for (const row of rolled) {
            const id = `heat-effect:${instanceId}:${snapshot.query.stateRevision}:${row.index}`;
            if (!accepted.has(id)) continue;
            if (row.check.kind === 'shutdown' && row.outcome === 'failed') {
                const wasShutdown = snapshot.query.hasCondition('shutdown');
                await dispatch(this.command(force, instanceId, {
                    type: 'set-mek-shutdown-state', shutdown: true,
                }), false);
                if (!wasShutdown && snapshot.ruleset === 'total-warfare') {
                    await this.resolveShutdownFall(force, instanceId, dispatch);
                }
            } else if (row.check.kind === 'startup' && row.outcome === 'success') {
                await dispatch(this.command(force, instanceId, {
                    type: 'set-mek-shutdown-state', shutdown: false,
                }), false);
            } else if (row.check.kind === 'ammo-explosion' && row.outcome === 'failed' && ammo) {
                await this.explodeAmmo(force, instanceId, ammo.componentId, dispatch);
            }
            snapshot = this.snapshot(force, instanceId) ?? snapshot;
        }
        const lifeEventId = `heat-effect:${instanceId}:${snapshot.query.stateRevision}:life-support`;
        // The revision can change while resolving preceding checks; match the originally emitted suffix too.
        const acceptedLife = [...accepted].some(id => id.endsWith(':life-support'));
        if ((accepted.has(lifeEventId) || acceptedLife) && lifeHits > 0) {
            const hits = await this.reviewPilotHits(snapshot, lifeHits, `${lifeEventId}:pilot`);
            await this.applyPilotHits(force, instanceId, hits, dispatch);
        }
    }

    private async resolveShutdownFall(
        force: CBTForce,
        instanceId: UnitInstanceId,
        dispatch: DirectMekAutomationDispatch,
    ): Promise<void> {
        const snapshot = this.snapshot(force, instanceId);
        const movement = snapshot?.query.mekMovementPsr();
        if (!snapshot || movement?.kind !== 'supported' || snapshot.query.hasCondition('prone')) return;
        const dice = roll2D6();
        const total = twoD6Total(dice);
        const failed = total < movement.pilotingTargetNumber;
        const event: AutomationReviewEvent = Object.freeze({
            id: `shutdown-psr:${instanceId}:${snapshot.query.stateRevision}`,
            subject: this.subject(snapshot),
            event: 'Shutdown Piloting Skill Check',
            description: `Rolled ${total} against ${movement.pilotingTargetNumber}+.`,
            effects: Object.freeze([failed ? 'Failed: the Mek falls' : 'Succeeded']),
        });
        const accepted = await this.automation.resolve('pilotSkillCheck', [event]);
        if (!accepted?.has(event.id) || !failed) return;
        await dispatch(this.command(force, instanceId, {
            type: 'set-condition', condition: 'prone', active: true,
        }), false);
        await this.resolveFall(force, instanceId, 'Involuntary shutdown', dispatch);
    }

    private async resolveFall(
        force: CBTForce,
        instanceId: UnitInstanceId,
        reason: string,
        dispatch: DirectMekAutomationDispatch,
    ): Promise<void> {
        const snapshot = this.snapshot(force, instanceId);
        if (!snapshot) return;
        const waterDepth = coverWaterDepth(snapshot.query.turnState().cover);
        const damage = resolveMekFallDamage(snapshot.ruleset, snapshot.entity.tonnage(), 0, waterDepth);
        const groups = resolvedMekFallDamageGroups(damage);
        const orientation = resolveMekFallOrientation(snapshot.ruleset, randomD6());
        const table = hitLocationTable(snapshot);
        const locations = groups.map(group => {
            const dice = roll2D6();
            let result = resolveMekFallHitLocation(table, orientation.hitArc, twoD6Total(dice));
            if (result.location === null) {
                result = resolveMekFallHitLocation(table, orientation.hitArc, twoD6Total(dice), randomD6());
            }
            return Object.freeze({ damage: group, result });
        });
        const event: AutomationReviewEvent = Object.freeze({
            id: `fall:${instanceId}:${snapshot.query.stateRevision}`,
            subject: this.subject(snapshot),
            event: reason,
            description: `${damage.totalDamage} fall damage from the ${orientation.hitArcLabel.toLowerCase()} arc.`,
            breakdown: Object.freeze(locations.map((row, index) => Object.freeze({
                id: String(index),
                label: row.result.locationLabel ?? row.result.rawTableResult,
                value: row.damage,
            }))),
            effects: Object.freeze([orientation.facingInstruction]),
        });
        const accepted = await this.automation.resolve(
            'fallingCheck',
            [event],
            { title: 'Review Falling Damage' },
        );
        if (!accepted?.has(event.id)) return;
        let headHits = 0;
        for (const row of locations) {
            if (!row.result.location) continue;
            const applied = await this.applyFallDamageGroup(
                force,
                instanceId,
                row.result.location,
                row.result.rear,
                row.damage,
                orientation.hitArc,
                row.result.critical,
                dispatch,
            );
            if (row.result.location === 'HD' && applied) headHits += 1;
        }
        if (headHits > 0) {
            const current = this.snapshot(force, instanceId);
            if (current) {
                const hits = await this.reviewPilotHits(current, headHits, `${event.id}:head`);
                await this.applyPilotHits(force, instanceId, hits, dispatch);
            }
        }
    }

    private async applyFallDamageGroup(
        force: CBTForce,
        instanceId: UnitInstanceId,
        sourceCode: string,
        rearArc: boolean,
        incomingDamage: number,
        hitArc: MekHitArcV2,
        throughArmorCritical: boolean,
        dispatch: DirectMekAutomationDispatch,
    ): Promise<boolean> {
        let damage = incomingDamage;
        let code: string | null = sourceCode;
        let applied = false;
        let groupDamaged = false;
        let sharedCompositePip = false;
        const initial = this.snapshot(force, instanceId);
        if (!initial) return false;
        const topology = getTopologyFor([...initial.index.locations.values()].map(location => location.code));
        const initialLocation = [...initial.index.locations.values()].find(row => row.code === sourceCode);
        const initialRear = rearArc && MEK_TORSO_LOCATIONS.has(sourceCode);
        const initialFace = initialLocation?.armorFaceIds
            .map(faceId => initial.index.armorFaces.get(faceId))
            .find(candidate => candidate?.face === (initialRear ? 'rear' : 'front'));
        const initialArmor = initialFace ? initial.query.remainingArmor(initialFace.id) : 0;
        const initialArmorType = initialLocation?.armor.type ?? null;
        const visited = new Set<string>();
        while (code && (damage > 0 || sharedCompositePip) && !visited.has(code)) {
            visited.add(code);
            let snapshot = this.snapshot(force, instanceId);
            const location = snapshot && [...snapshot.index.locations.values()].find(row => row.code === code);
            if (!snapshot || !location) break;
            const rear = rearArc && MEK_TORSO_LOCATIONS.has(code);
            const nextCode: string | null = topology[code as keyof typeof topology]?.transfersTo ?? null;
            const face = location.armorFaceIds
                .map(faceId => snapshot!.index.armorFaces.get(faceId))
                .find(candidate => candidate?.face === (rear ? 'rear' : 'front'));
            if (!face) break;
            let modularDamage = 0;
            if (damage > 0) {
                const modular = [...snapshot.index.components.entries()]
                    .filter(([, component]) => component.kind === 'equipment'
                        && isModularArmorEquipment(component.mount.equipment))
                    .filter(([componentId]) => [...snapshot!.index.slots.values()].some(slot =>
                        slot.locationId === location.id && slot.componentIds.includes(componentId)))
                    .reduce((sum, [componentId]) =>
                        sum + snapshot!.query.modularArmorRemaining(componentId), 0);
                modularDamage = Math.min(damage, modular);
                damage -= modularDamage;
            }
            const remainingArmor = snapshot.query.remainingArmor(face.id);
            const hardenedArmorApplies = location.armor.type === 'HARDENED' && remainingArmor > 0;
            const armor = resolveMekFallArmorDamage(
                snapshot.ruleset,
                damage,
                remainingArmor,
                location.armor.type,
            );
            const armorPips = modularDamage + armor.armorDamage;
            if (armorPips > 0) {
                const armorCommand = this.command(force, instanceId, {
                    type: 'damage-armor', faceId: face.id, amount: armorPips, target: 'committed',
                });
                const result = await dispatch(armorCommand, false);
                applied ||= result.accepted;
                groupDamaged ||= result.accepted;
                if (result.accepted) {
                    await this.resolveBreachOrFlood(force, instanceId, {
                        faceId: face.id,
                        target: 'committed',
                    }, dispatch);
                }
            }
            damage = armor.remainingDamage;
            snapshot = this.snapshot(force, instanceId);
            if (!snapshot) break;
            const remainingInternal = snapshot.query.remainingInternal(location.id);
            const receivedSharedCompositePip: boolean = sharedCompositePip;
            const sharedInternalDamage: number = receivedSharedCompositePip && remainingInternal > 0 ? 1 : 0;
            sharedCompositePip = false;
            const construction = structureConstructionKind(location.structure.structure);
            const structureIncomingDamage = damage;
            const structure = resolveMekStructureDamage(
                damage,
                Math.max(0, remainingInternal - sharedInternalDamage),
                construction === 'composite' ? 'composite'
                    : construction === 'reinforced' ? 'reinforced' : 'standard',
            );
            const internalDamage: number = sharedInternalDamage + structure.internalDamage;
            if (internalDamage > 0) {
                const result = await dispatch(this.command(force, instanceId, {
                    type: 'damage-internal',
                    locationId: location.id,
                    amount: internalDamage,
                    target: 'committed',
                    hardenedArmorApplies,
                    armorDamagedBySameHit: armorPips > 0,
                }), false);
                applied ||= result.accepted;
                groupDamaged ||= result.accepted;
                if (result.accepted) {
                    await this.resolveCriticalChance(
                        force,
                        instanceId,
                        location.id,
                        'committed',
                        { hardenedArmorApplies },
                        dispatch,
                    );
                }
            }
            damage = structure.overflowDamage;
            sharedCompositePip = !receivedSharedCompositePip
                && snapshot.ruleset === 'core-2026'
                && structureIncomingDamage > 0
                && remainingInternal % 2 === 1
                && construction === 'composite'
                && internalDamage === remainingInternal
                && this.canShareCompositePip(force, instanceId, nextCode, rearArc);
            code = nextCode;
        }
        const blockedAblativeCritical = initial?.ruleset === 'core-2026'
            && initialArmorType === 'ANTI_PENETRATIVE_ABLATION'
            && initialArmor > 0;
        if (throughArmorCritical && groupDamaged && !blockedAblativeCritical) {
            const latest = this.snapshot(force, instanceId);
            const location = latest && [...latest.index.locations.values()].find(row => row.code === sourceCode);
            if (location) {
                await this.resolveCriticalChance(
                    force,
                    instanceId,
                    location.id,
                    'committed',
                    {
                        floatingHitArc: hitArc,
                        hardenedArmorApplies: initialArmorType === 'HARDENED' && initialArmor > 0,
                    },
                    dispatch,
                );
            }
        }
        return applied;
    }

    private canShareCompositePip(
        force: CBTForce,
        instanceId: UnitInstanceId,
        locationCode: string | null,
        rearArc: boolean,
    ): boolean {
        if (!locationCode) return false;
        const snapshot = this.snapshot(force, instanceId);
        const location = snapshot && [...snapshot.index.locations.values()]
            .find(candidate => candidate.code === locationCode);
        if (!snapshot || !location
            || structureConstructionKind(location.structure.structure) !== 'composite') return false;
        const rear = rearArc && MEK_TORSO_LOCATIONS.has(locationCode);
        const face = location.armorFaceIds
            .map(faceId => snapshot.index.armorFaces.get(faceId))
            .find(candidate => candidate?.face === (rear ? 'rear' : 'front'));
        if (!face || snapshot.query.remainingArmor(face.id) > 0
            || snapshot.query.remainingInternal(location.id) <= 0) return false;
        return [...snapshot.index.components.entries()]
            .filter(([, component]) => component.kind === 'equipment'
                && isModularArmorEquipment(component.mount.equipment))
            .filter(([componentId]) => [...snapshot.index.slots.values()].some(slot =>
                slot.locationId === location.id && slot.componentIds.includes(componentId)))
            .every(([componentId]) => snapshot.query.modularArmorRemaining(componentId) === 0);
    }

    private async reviewPilotHits(
        snapshot: MekSnapshot,
        hits: number,
        eventId: string,
    ): Promise<number> {
        if (hits <= 0) return 0;
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
        return accepted?.has(event.id) ? hits : 0;
    }

    private async applyPilotHits(
        force: CBTForce,
        instanceId: UnitInstanceId,
        hits: number,
        dispatch: DirectMekAutomationDispatch,
    ): Promise<void> {
        for (let index = 0; index < hits; index += 1) {
            const snapshot = this.snapshot(force, instanceId);
            const pilot = snapshot && this.primaryPilot(snapshot);
            if (!snapshot || !pilot || pilot.state.wounds >= MAX_MEK_CREW_WOUNDS) return;
            const wounds = Math.min(MAX_MEK_CREW_WOUNDS, pilot.state.wounds + 1);
            await dispatch(this.command(force, instanceId, {
                type: 'set-crew-state',
                positionId: pilot.positionId,
                wounds,
                unconscious: pilot.state.unconscious,
                ejected: pilot.state.ejected,
            }), false);
            const target = mekConsciousnessTarget(wounds);
            if (target === undefined || pilot.state.ejected) continue;
            const dice = roll2D6();
            if (succeedsOnTarget(twoD6Total(dice), target)) continue;
            const current = this.snapshot(force, instanceId);
            const state = current?.query.crewState(pilot.positionId);
            if (!current || !state || state.ejected || state.wounds >= MAX_MEK_CREW_WOUNDS) continue;
            await dispatch(this.command(force, instanceId, {
                type: 'set-crew-state',
                positionId: pilot.positionId,
                wounds: state.wounds,
                unconscious: true,
                ejected: false,
            }), false);
        }
    }

    private async resolveConsciousnessRecovery(
        force: CBTForce,
        instanceId: UnitInstanceId,
        dispatch: DirectMekAutomationDispatch,
    ): Promise<void> {
        const snapshot = this.snapshot(force, instanceId);
        if (!snapshot) return;
        for (const position of [...snapshot.index.crewPositions.values()].sort((a, b) => a.occurrence - b.occurrence)) {
            const state = snapshot.query.crewState(position.id);
            const target = mekConsciousnessTarget(state.wounds);
            if (!state.unconscious || state.ejected || target === undefined) continue;
            const dice = roll2D6();
            const total = twoD6Total(dice);
            const recovered = succeedsOnTarget(total, target);
            const event: AutomationReviewEvent = Object.freeze({
                id: `consciousness:${instanceId}:${snapshot.query.stateRevision}:${position.id}`,
                subject: this.subject(snapshot),
                event: 'Consciousness Recovery',
                description: `Rolled ${total} against ${target}+.`,
                effects: Object.freeze([recovered ? 'Pilot regains consciousness' : 'Pilot remains unconscious']),
            });
            const accepted = await this.automation.resolve('pilotHitsAndConsciousnessCheck', [event]);
            if (!accepted?.has(event.id) || !recovered) continue;
            await dispatch(this.command(force, instanceId, {
                type: 'set-crew-state',
                positionId: position.id,
                wounds: state.wounds,
                unconscious: false,
                ejected: false,
            }), false);
        }
    }

    private async explodeAmmo(
        force: CBTForce,
        instanceId: UnitInstanceId,
        componentId: ComponentId,
        dispatch: DirectMekAutomationDispatch,
    ): Promise<void> {
        const snapshot = this.snapshot(force, instanceId);
        if (!snapshot) return;
        const slot = [...snapshot.index.slots.values()].find(candidate =>
            candidate.componentIds.includes(componentId));
        if (!slot) return;
        const profile = snapshot.query.mekCriticalRollProfile(slot.locationId, 'committed');
        const results = profile.validRolls.find(dice => {
            const plan = snapshot.query.mekCriticalRoll(slot.locationId, dice, 'committed');
            return plan.kind === 'applied' && plan.slotId === slot.id;
        });
        if (!results) return;
        await dispatch(this.command(force, instanceId, {
            type: 'apply-mek-critical-roll',
            locationId: slot.locationId,
            results,
            target: 'committed',
        }), true);
    }

    private preferredExplosiveAmmo(snapshot: MekSnapshot): Readonly<{
        componentId: ComponentId;
        damagePerShot: number;
        shots: number;
    }> | null {
        const candidates = [...snapshot.index.components.entries()].flatMap(([componentId, component]) => {
            const ammo = component.kind === 'equipment' ? component.mount.equipment : null;
            if (!(ammo instanceof AmmoEquipment)
                || !ammo.isExplosive()
                || snapshot.query.componentStatus(componentId, 'committed') !== 'available') return [];
            const shots = snapshot.query.remainingAmmo(componentId);
            const damagePerShot = ammoRackSize(ammo) * ammoExplosionDamagePerShot(ammo);
            return shots > 0 && damagePerShot > 0
                ? [Object.freeze({ componentId, damagePerShot, shots })]
                : [];
        });
        return candidates.sort((left, right) =>
            right.damagePerShot - left.damagePerShot
            || right.shots - left.shots
            || left.componentId.localeCompare(right.componentId))[0] ?? null;
    }

    private primaryPilot(snapshot: MekSnapshot): Readonly<{
        positionId: CrewPositionId;
        state: ReturnType<MekSnapshot['query']['crewState']>;
    }> | null {
        const positions = [...snapshot.index.crewPositions.values()]
            .sort((left, right) => left.occurrence - right.occurrence);
        const position = positions.find(candidate => {
            const state = snapshot.query.crewState(candidate.id);
            return !state.ejected && state.wounds < MAX_MEK_CREW_WOUNDS;
        }) ?? positions[0];
        return position ? Object.freeze({
            positionId: position.id,
            state: snapshot.query.crewState(position.id),
        }) : null;
    }

    private rollHitLocation(snapshot: MekSnapshot, hitArc: MekHitArcV2) {
        const dice = roll2D6();
        let result = resolveMekFallHitLocation(
            hitLocationTable(snapshot), hitArc, twoD6Total(dice),
        );
        if (result.location === null) {
            result = resolveMekFallHitLocation(
                hitLocationTable(snapshot), hitArc, twoD6Total(dice), randomD6(),
            );
        }
        return result;
    }

    private locationUnderwater(snapshot: MekSnapshot, locationCode: string): boolean {
        const water = resolveMekUnitWaterState(
            snapshot.entity,
            snapshot.query.turnState().cover,
            snapshot.query.hasCondition('prone'),
        );
        return water.submerged || (water.partiallyUnderwater && snapshot.entity.locationIsLeg(locationCode));
    }

    private command(
        force: CBTForce,
        instanceId: UnitInstanceId,
        draft: MekCommandDraft,
    ): CBTUnitCommand {
        const snapshot = this.snapshot(force, instanceId);
        if (!snapshot) throw new Error(`Mek runtime ${instanceId} is no longer admitted`);
        return {
            ...draft,
            commandId: createCommandId(),
            expectedRevision: snapshot.query.stateRevision,
        } as CBTUnitCommand;
    }

    private snapshot(force: CBTForce, instanceId: UnitInstanceId): MekSnapshot | null {
        const snapshot = force.getUnitSnapshot(instanceId);
        return snapshot && hasMekRuntime(snapshot) ? snapshot as MekSnapshot : null;
    }

    private subject(snapshot: MekSnapshot): string {
        return snapshot.entity.displayName() || String(snapshot.instanceId);
    }
}

function describeCriticalChance(result: MekCriticalChanceResult): string {
    if (result.kind === 'none') return 'No critical hit';
    if (result.kind === 'blown-off') return 'Location blown off';
    return `${result.count} critical hit${result.count === 1 ? '' : 's'}`;
}

function heatCheckLabel(kind: 'shutdown' | 'startup' | 'ammo-explosion'): string {
    if (kind === 'shutdown') return 'Heat Shutdown Check';
    if (kind === 'startup') return 'Shutdown Recovery Check';
    return 'Heat Ammunition Explosion Check';
}

function heatCheckEffects(
    kind: 'shutdown' | 'startup' | 'ammo-explosion',
    outcome: 'success' | 'failed',
): string[] {
    if (kind === 'shutdown') return [outcome === 'failed' ? 'Mek shuts down' : 'Shutdown avoided'];
    if (kind === 'startup') return [outcome === 'success' ? 'Mek starts up' : 'Mek remains shutdown'];
    return [outcome === 'failed' ? 'Most dangerous ammunition bin explodes' : 'Explosion avoided'];
}

function hitLocationTable(snapshot: MekSnapshot): MekHitLocationTable {
    return snapshot.entity.chassisConfig === 'Tripod' ? 'tripod'
        : snapshot.entity.chassisConfig === 'Quad' || snapshot.entity.chassisConfig === 'QuadVee'
            ? 'quad' : 'biped';
}

function coverWaterDepth(cover: string | null): number {
    if (!cover?.startsWith('underwater-depth-')) return 0;
    return Math.max(0, Number(cover.slice('underwater-depth-'.length)) || 0);
}

function randomD6(): number {
    return Math.floor(Math.random() * 6) + 1;
}

function randomIndex(length: number): number {
    return Math.max(0, Math.min(length - 1, Math.floor(Math.random() * length)));
}

function explosiveCriticalRolls(
    snapshot: MekSnapshot,
    locationId: LocationId,
    target: 'committed' | 'pending',
): readonly (readonly number[])[] {
    return snapshot.query.mekCriticalRollProfile(locationId, target).validRolls.filter(results => {
        const plan = snapshot.query.mekCriticalRoll(locationId, results, target);
        return plan.kind === 'applied' && (plan.explosion !== undefined || plan.pendingExplosion !== undefined);
    });
}
