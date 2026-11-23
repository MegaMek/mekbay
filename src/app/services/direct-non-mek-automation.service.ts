// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { inject,Injectable,Injector } from '@angular/core';
import type { CBTUnitCommand } from '../models/runtime/unit-command';

import type { AutomationCheck,AutomationCheckResolution } from '../models/automation-check.model';
import type { AutomationReviewEvent } from '../models/automation-review.model';
import type { CBTForce } from '../models/cbt-force.model';
import type { CBTForceUnitCommandDispatch,CBTForceUnitCommandResult } from '../models/cbt-force.types';
import {
cbtUnitCheckAutomaticMessage,
cbtUnitCheckPresentation,
} from '../models/cbt-unit-check-presentation';
import { hasNonMekRuntime,type CBTUnitSnapshot } from '../models/cbt-unit-snapshot';
import { activeCrewController,DEFAULT_PILOTING_SKILL } from '../models/crew-member.model';
import { isDroneOperatingSystemEquipment } from '../models/drone-operating-system.model';
import { buildingCfLosses } from '../models/runtime/building-cf';
import type { BaseEntity } from '../models/entity/base-entity';
import type { AeroEntity } from '../models/entity/entities/aero/aero-entity';
import type { CrewPositionId, LocationId } from '../models/entity/entity-identifiers';
import { asComponentId } from '../models/entity/entity-identifiers';
import { isAeroEntity, isProtoMekEntity, isVehicleEntity } from '../models/entity/utils/entity-type-guards';
import { resolveArmorDamage, rifleHitDamage, type DamageSource } from '../models/rules/armor-damage-rules';
import {
    infernoEffect,
    infernoEffectCountsTurn,
    infernoMissilesStruck,
    type InfernoMissile,
} from '../models/rules/inferno-rules';
import { infernoMissilesThisTurn, struckArmorFace } from '../models/runtime/attack-hit-location';
import { resolveNonMekHitLocation, type NonMekHitArc, type NonMekHitEffect } from '../models/runtime/non-mek-hit-location';
import { aeroExplosionStructuralIntegrityDamage, type AeroCriticalType } from '../models/rules/aero-critical-rules';
import { projectAeroRuntimeRules } from '../models/rules/aero-runtime-rules';
import { projectAeroHeatAutomationChecks } from '../models/runtime/aero-heat-automation-rules';
import { heatAmmoExplosionCandidates, roll2D6, rollD6, twoD6Total, type HeatAmmoExplosionCandidate } from '../models/runtime/mek-automation-rules';
import { canDestroyComponents, vehicleHotLoadBlasts } from '../models/runtime/non-mek-unit-instance';
import type { CBTRuntimeLocation } from '../models/runtime/cbt-unit-runtime';
import type { NonMekRuntimeIndex } from '../models/runtime/non-mek-runtime-index';
import { projectNonMekEndTurnHeat,type NonMekControlRecoveryCause,type NonMekControlRecoveryWorkflow,type NonMekUnitRuntimeState } from '../models/runtime/non-mek-unit-instance';
import type { UnitConditionKey } from '../models/unit-condition.model';
import { isUnitWaterDepth, unitWaterDepthNumber } from '../models/unit-cover.model';
import { nonMekFliesAtElevation } from '../models/runtime/non-mek-airborne-state';
import { elevationAt } from '../models/elevation-record.model';
import { erraticManoeuvresModifier } from '../models/rules/anti-mek-attack-rules';
import {
    projectNonMekControlRoll,
    projectNonMekMovementCapabilities,
    type NonMekMovementDeclaration,
} from '../models/runtime/non-mek-unit-instance';
import { navalBreachThreshold } from '../models/rules/vehicle-runtime-rules';
import { systemDamageId } from '../models/rules/system-damage-rules';
import { DialogsService } from './dialogs.service';
import { loadSwarmService } from './swarm-service-loader';
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
import { NonMekCriticalAutomationService } from './non-mek-critical-automation.service';
import { OptionsService } from './options.service';
import type { Toast } from './toast.service';

type AeroSnapshot = Omit<CBTUnitSnapshot, 'entity' | 'index' | 'state'> & Readonly<{
    entity: AeroEntity;
    index: NonMekRuntimeIndex;
    state: NonMekUnitRuntimeState;
}>;

/** One damage group read on a non-Mek's own hit-location table, with that table's markers. */
export interface NonMekDamageGroup {
    readonly projectileDamage?: number;
    readonly attackerUnderwater?: true;
    /** Groups of one attack share this index for the ProtoMek pilot-wound limit. */
    readonly attackIndex?: number;
    readonly locationId: LocationId;
    readonly damage: number;
    readonly arc: NonMekHitArc;
    readonly effects: readonly NonMekHitEffect[];
    readonly source: DamageSource;
    /** The hit-location table already transferred a hit on a missing ProtoMek location to its torso. */
    readonly transferred?: true;
    /** Aerospace: the critical damage the hit-location roll threatens. */
    readonly aeroCritical?: AeroCriticalType;
    /** Aerospace: the first group a natural-12 attack puts on this location (TW p.239 lucky hit). */
    readonly luckyHit?: boolean;
}

/** What one applied damage group did, for the critical and motive rules that follow it. */
export interface NonMekDamageGroupOutcome {
    /** Locations whose internal structure took damage, in the order struck. */
    readonly structureDamaged: readonly LocationId[];
    /** Aerospace: points of structural integrity lost. */
    readonly structuralIntegrityDamage: number;
    /** Armor left on the struck location's face when the hit was applied. */
    readonly struckArmor: number;
    /** The face that actually lost armor, the points it had at impact and the points lost. */
    readonly armorHit: Readonly<{ locationId: LocationId; atHit: number; damage: number }> | null;
}

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
    /** The vehicle's erratic manoeuvres shook the swarming infantry off. */
    readonly shookOffSwarm?: true;
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
    private readonly criticals = inject(NonMekCriticalAutomationService);
    private readonly dialogs = inject(DialogsService);
    private readonly injector = inject(Injector);
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
                projected: projection.calculated,
                sources: projection.sources,
                dissipationBalance: projection.dissipationBalance,
                consumedDissipation: projection.dissipated,
            };
        },
        stage: (snapshot, heat) => this.stageAeroHeatEffects(snapshot, heat),
        extraPilotHitDescriptions: () => [],
        applyEffects: (force, instanceId, prepared, dispatch) =>
            this.applyAeroHeatEffects(force, instanceId, prepared, dispatch),
    };

    /**
     * Applies accepted weapon hits to a non-Mek, one damage group at a time: armor by type, then structure,
     * then a ProtoMech's torso or an aerospace unit's structural integrity.
     */
    async applyWeaponHits(
        force: CBTForce,
        instanceId: string,
        groups: readonly NonMekDamageGroup[],
        target: 'committed' | 'pending',
        dispatch: CBTForceUnitCommandDispatch,
        inferno: readonly InfernoMissile[] = [],
        weaponHeat = 0,
    ): Promise<boolean> {
        const pilotWounds = new Map<number, { wounded: boolean }>();
        for (const group of groups) {
            const before = this.nonMekSnapshot(force, instanceId);
            const pilot = group.attackIndex === undefined ? { wounded: false } : pilotWounds.get(group.attackIndex) ?? { wounded: false };
            if (group.attackIndex !== undefined) pilotWounds.set(group.attackIndex, pilot);
            const outcome = await this.applyDamageGroup(force, instanceId, group, target, dispatch);
            if (outcome && !await this.checkNavalHull(force, instanceId, group, outcome, target, dispatch)) return false;
            if (!outcome || !group.effects.includes('rotor-destroyed') && !await this.criticals.resolveDamageGroup(force, instanceId, group, outcome, target, dispatch, pilot)) {
                return false;
            }
            if (target === 'committed' && !await this.resolveFlightDamage(force, instanceId, before, dispatch)) return false;
        }
        if (weaponHeat > 0 && this.nonMekSnapshot(force, instanceId)?.entity.tracksHeat()
            && !(await dispatch({ type: 'add-outside-heat', amount: weaponHeat, target }, false)).accepted) return false;
        if (!inferno.length) return true;
        if (inferno.some(missile => missile.attackIndex !== undefined)) {
            // Each ProtoMek pilot wound is limited by the originating attack, including inferno destruction.
            for (const source of new Set(inferno.map(missile => missile.attackIndex))) {
                const missiles = inferno.filter(missile => missile.attackIndex === source);
                if (!await this.applyInferno(force, instanceId, missiles, target, dispatch)) return false;
            }
            return true;
        }
        return this.applyInferno(force, instanceId, inferno, target, dispatch);
    }

    /** Applies what an attack's inferno missiles do to this unit (TW pp. 141-142). */
    private async applyInferno(
        force: CBTForce,
        instanceId: string,
        inferno: readonly InfernoMissile[],
        target: 'committed' | 'pending',
        dispatch: CBTForceUnitCommandDispatch,
    ): Promise<boolean> {
        const snapshot = this.nonMekSnapshot(force, instanceId);
        if (!snapshot) return false;
        const perspective = target === 'pending' ? 'preview' : 'committed';
        const effect = infernoEffect(snapshot.entity, inferno, infernoMissilesThisTurn(force.getUnitSnapshot(instanceId)));
        const struck = infernoMissilesStruck(snapshot.entity, inferno);
        if (infernoEffectCountsTurn(effect) && struck > 0
            && !(await dispatch({ type: 'add-inferno-missiles', count: struck, target }, false)).accepted) return false;
        const locations = [...snapshot.index.locations.values()];
        const destroy = async (locationIds: readonly LocationId[]): Promise<boolean> => {
            for (const locationId of new Set(locationIds)) {
                const amount = this.nonMekSnapshot(force, instanceId)?.query.remainingInternal(locationId, perspective) ?? 0;
                if (amount > 0 && !(await dispatch({ type: 'damage-internal', locationId, amount, target }, false)).accepted) {
                    return false;
                }
            }
            return true;
        };
        const damage = async (code: string, amount: number): Promise<boolean> => {
            const location = locations.find(candidate => candidate.code === code);
            const applied = location ? Math.min(amount, snapshot.query.remainingInternal(location.id, perspective)) : 0;
            return applied === 0
                || (await dispatch({ type: 'damage-internal', locationId: location!.id, amount: applied, target }, false)).accepted;
        };
        switch (effect.kind) {
            case 'heat':
                return effect.heat === 0
                    || (await dispatch({ type: 'add-outside-heat', amount: effect.heat, target }, false)).accepted;
            case 'troopers':
                return damage('Infantry', effect.troopers);
            case 'structural-integrity':
                return damage('SI', effect.damage);
            case 'battle-armor-troopers': {
                // Each is a randomly determined surviving trooper: a 1D6 roll on the troopers, rerolled until it names
                // a living one (MegaMek rolls a battle armor hit location).
                const living = locations.filter(location => location.code.startsWith('Trooper ')
                    && snapshot.query.remainingInternal(location.id, perspective) > 0).map(location => location.id);
                const eliminated: LocationId[] = [];
                while (eliminated.length < Math.min(effect.troopers, living.length)) {
                    const trooper = living[rollD6() - 1];
                    if (trooper !== undefined && !eliminated.includes(trooper)) eliminated.push(trooper);
                }
                return destroy(eliminated);
            }
            case 'protomek-locations':
                return await destroy(effect.locationIds)
                    && this.criticals.resolveDestroyedProtoMekLocations(force, instanceId, effect.locationIds, target, dispatch);
            case 'vehicle-criticals':
                return this.criticals.resolveInfernoCriticals(force, instanceId, effect.locationIds, target, dispatch);
            case 'none':
                return true;
        }
    }

    private async checkNavalHull(force: CBTForce, instanceId: string, group: NonMekDamageGroup,
        outcome: NonMekDamageGroupOutcome, target: 'committed' | 'pending', dispatch: CBTForceUnitCommandDispatch): Promise<boolean> {
        if (this.options.cbtAutomationMode('breachAndFloodCheck') === 'no' || (!outcome.armorHit && !outcome.structureDamaged.length)) return true;
        const snapshot = this.nonMekSnapshot(force, instanceId);
        const loc = snapshot?.index.locations.get(group.locationId);
        if (!snapshot || !loc || !isVehicleEntity(snapshot.entity)) return true;
        const threshold = navalBreachThreshold(snapshot.entity.motiveType(), loc.code, isUnitWaterDepth(snapshot.state.turn.cover), !!group.attackerUnderwater);
        if (threshold === null) return true;
        const id = systemDamageId('hull-breach', undefined, loc.code);
        if (snapshot.state.damageTracks.get(id)?.hits || snapshot.state.pendingCombat.damageTrackHits.get(id)?.hitDelta) return true;
        const perspective = target === 'pending' ? 'preview' : 'committed';
        const bare = loc.armorFaceIds.every(face => snapshot.query.remainingArmor(face, perspective) === 0);
        const dice = bare ? null : twoD6Total(roll2D6());
        const breached = bare || dice !== null && dice >= threshold;
        const event = { id: 'naval-breach:' + instanceId + ':' + snapshot.query.stateRevision + ':' + loc.code,
            subject: this.subject(snapshot), event: 'Hull integrity', description: bare ? loc.code + ' has no armor' : loc.code + ': rolled ' + dice + ' against ' + threshold,
            effects: [breached ? 'Hull breached; vessel is lost' : 'Hull holds'] };
        const accepted = await this.automation.resolve('breachAndFloodCheck', [event], { title: 'Hull Integrity' });
        return !breached || !accepted?.has(event.id) || (await dispatch({ type: 'damage-track', damageTrackId: id, amount: 1, target, timestamp: Date.now() }, false)).accepted;
    }

    private async applyDamageGroup(
        force: CBTForce,
        instanceId: string,
        group: NonMekDamageGroup,
        target: 'committed' | 'pending',
        dispatch: CBTForceUnitCommandDispatch,
    ): Promise<NonMekDamageGroupOutcome | null> {
        const perspective = target === 'pending' ? 'preview' : 'committed';
        const structureDamaged: LocationId[] = [];
        let structuralIntegrityDamage = 0;
        let armorHit: NonMekDamageGroupOutcome['armorHit'] = null;
        const struck = this.nonMekSnapshot(force, instanceId);
        const struckLocation = struck?.index.locations.get(group.locationId);
        const struckFace = struck && struckLocation ? struckArmorFace(struck.index, struckLocation.id, false) : undefined;
        const struckArmor = struck && struckFace ? struck.query.remainingArmor(struckFace.id, perspective) : 0;
        if (group.effects.includes('rotor-destroyed') && struck && struckLocation?.code === 'Rotor') {
            const remaining = struck.query.remainingInternal(struckLocation.id, perspective);
            if (remaining && !(await dispatch({ type: 'damage-internal', locationId: struckLocation.id, amount: remaining, target }, false)).accepted) return null;
            return { structureDamaged: [struckLocation.id], structuralIntegrityDamage: 0, struckArmor, armorHit: null };
        }
        // A rifle hit loses 3 points against the armor where it strikes (`rifleHitDamage`).
        const weaponDamage = struck && struckLocation && group.source.kind === 'weapon' && group.source.rifle
            ? rifleHitDamage(struck.ruleset, group.damage, {
                entity: struck.entity,
                location: struckLocation.code,
                armor: struckArmor,
            })
            : group.damage;
        // TW p.197: a weapon striking a VTOL's rotors deals 1 point per 10 (or fraction) of its damage value.
        let damage = group.source.kind === 'weapon' && struckLocation?.code === 'Rotor'
            ? Math.ceil(weaponDamage / 10)
            : weaponDamage;
        let locationId: LocationId | null = group.locationId;
        while (locationId !== null && damage > 0) {
            const snapshot = this.nonMekSnapshot(force, instanceId);
            const location: CBTRuntimeLocation | undefined = snapshot?.index.locations.get(locationId);
            if (!snapshot || !location) return null;
            const face = struckArmorFace(snapshot.index, location.id, false);
            const missingProtoLocation = isProtoMekEntity(snapshot.entity)
                && snapshot.query.remainingInternal(location.id, perspective) === 0;
            if (face && !missingProtoLocation) {
                const before = snapshot.query.remainingArmor(face.id, perspective);
                const armor = resolveArmorDamage(snapshot.ruleset, damage, before,
                    snapshot.entity.armorAt(location.code)?.type ?? null, group.source, snapshot.entity);
                if (armor.armorDamage > 0) {
                    if (!(await dispatch({ type: 'damage-armor', faceId: face.id, amount: armor.armorDamage, target },
                        false)).accepted) return null;
                    armorHit = { locationId: location.id, atHit: before, damage: armor.armorDamage };
                }
                damage = armor.remainingDamage;
            }
            if (damage <= 0) break;
            if (snapshot.ruleset === 'total-warfare' && snapshot.entity.entityType === 'BuildingEntity') {
                const losses = buildingCfLosses(snapshot, location.code, damage, perspective);
                if (losses) {
                    for (const { locationId, amount } of losses) {
                        if (!(await dispatch({ type: 'damage-internal', locationId, amount, target }, false)).accepted) return null;
                    }
                    break;
                }
            }
            const structuralIntegrity = isAeroEntity(snapshot.entity)
                ? [...snapshot.index.locations.values()].find(candidate => candidate.code === 'SI')
                : undefined;
            if (structuralIntegrity && structuralIntegrity.id !== location.id) {
                // MegaMek: damage past an aerospace location's armor reaches the SI at half (round), minimum 1.
                structuralIntegrityDamage = Math.min(Math.max(1, Math.round(damage / 2)),
                    snapshot.query.remainingInternal(structuralIntegrity.id, perspective));
                if (structuralIntegrityDamage > 0 && !(await dispatch({
                    type: 'damage-internal', locationId: structuralIntegrity.id, amount: structuralIntegrityDamage, target,
                }, false)).accepted) return null;
                break;
            }
            const internal = Math.min(damage, snapshot.query.remainingInternal(location.id, perspective));
            if (internal > 0) {
                if (!(await dispatch({ type: 'damage-internal', locationId: location.id, amount: internal, target }, false))
                    .accepted) return null;
                structureDamaged.push(location.id);
            }
            damage -= internal;
            // MegaMek: a ProtoMech's destroyed location passes the rest to its torso; other units lose it.
            const torso: CBTRuntimeLocation | undefined = isProtoMekEntity(snapshot.entity) && location.code !== 'Torso'
                ? [...snapshot.index.locations.values()].find(candidate => candidate.code === 'Torso')
                : undefined;
            locationId = torso?.id ?? null;
        }
        return Object.freeze({
            structureDamaged: Object.freeze(structureDamaged),
            structuralIntegrityDamage,
            struckArmor,
            armorHit,
        });
    }

    async prepareCommand(
        force: CBTForce,
        instanceId: string,
        command: CBTUnitCommand,
    ): Promise<PreparedDirectNonMekAutomationCommand> {
        if (canDestroyComponents(command) && command.applyExplosion === undefined) {
            const snapshot = this.nonMekSnapshot(force, instanceId);
            if (snapshot && isVehicleEntity(snapshot.entity)) {
                const blasts = vehicleHotLoadBlasts(snapshot, snapshot.state, () => snapshot.query, command);
                const damage = blasts.reduce((sum, blast) => sum + blast.damage, 0);
                const effects = blasts.map(blast => `${blast.name} (${blast.location.code}): ${blast.damage} base explosion damage`);
                if (damage > 0) {
                    const event: AutomationReviewEvent = { id: 'hot-loaded-launchers', subject: this.subject(snapshot),
                        event: 'Hot-loaded launcher explosion', delta: damage, effects,
                        description: 'Resolve the explosion in each launcher’s location. Vehicles do not roll for a secondary ammo explosion.' };
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
        if (command.type === 'set-movement' && command.movement?.mode === 'run') {
            const snapshot = this.nonMekSnapshot(force, instanceId);
            // A new flank distance keeps the turn's erratic manoeuvres, within the Cruising MP.
            if (snapshot?.state.turn.movement?.erratic && !command.movement.erratic) {
                return Object.freeze({ command: this.erraticMovement(snapshot, command.movement) });
            }
            if (snapshot && isVehicleEntity(snapshot.entity) && snapshot.query.hasCondition('swarmed')
                && snapshot.state.turn.movement?.mode !== 'run'
                && this.options.cbtAutomationMode('pilotSkillCheck') !== 'no') {
                return this.prepareErraticManoeuvres(force, snapshot, command.movement);
            }
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
        if (prepared.command.type === 'set-cover' && isUnitWaterDepth(prepared.command.cover)
            && !isUnitWaterDepth(before?.state.turn.cover)) {
            const current = this.nonMekSnapshot(force, instanceId);
            if (current && current.entity.motiveType() === 'Submarine' && !current.query.destroyed()) {
                for (const loc of current.index.locations.values()) {
                    if (!loc.armorFaceIds.length || loc.code === 'Body' || !loc.internalPoints
                        || loc.armorFaceIds.some(face => current.query.remainingArmor(face) > 0)) continue;
                    if (!await this.checkNavalHull(force, instanceId, { locationId: loc.id, damage: 0, arc: 'front', effects: [], source: { kind: 'fall' } },
                        { structureDamaged: [loc.id], structuralIntegrityDamage: 0, struckArmor: 0, armorHit: null }, 'committed', dispatch)) return false;
                    if (this.nonMekSnapshot(force, instanceId)?.query.destroyed()) break;
                }
            }
        }
        if (before && hasNonMekRuntime(before) && !await this.resolveFlightDamage(force, instanceId, before, dispatch)) return false;
        if (prepared.shookOffSwarm && !await this.releaseSwarm(force, instanceId, dispatch)) return false;
        const aeroAfter = this.snapshot(force, instanceId);
        if (aeroAfter?.state.turn.controlRecovery !== undefined
            && !this.hasPotentialController(aeroAfter)
            && !this.hasDroneController(aeroAfter)
            && !await this.setControlRecovery(force, instanceId, null, dispatch)) return false;
        return true;
    }

    private async resolveFlightDamage(force: CBTForce, instanceId: string, before: NonMekSnapshot | null,
        dispatch: CBTForceUnitCommandDispatch): Promise<boolean> {
        if (!before || before.state.turn.airborne !== true || !isVehicleEntity(before.entity)) return true;
        const vtol = before.entity.unitType() === 'VTOL';
        if (!vtol && before.entity.motiveType() !== 'WiGE') return true;
        const current = this.nonMekSnapshot(force, instanceId);
        if (!current || current.state.turn.airborne !== true || current.query.destroyed() || !isVehicleEntity(current.entity)) return true;
        const project = (s: NonMekSnapshot) => projectNonMekMovementCapabilities(s.entity, s.index, s.state, s.ruleset, s.crewAssignment);
        if (current.crewAssignment.positions.some(position => current.query.crewState(position.positionId).isDeathCommitted())) {
            return (await dispatch({ type: 'set-destroyed', destroyed: true }, false)).accepted;
        }
        const engine = systemDamageId('engine', 1);
        const lostMotive = [...current.index.damageTracks.values()].some(track => (track.system === 'motive' || track.system === 'rotor')
            && (current.state.damageTracks.get(track.id)?.hits ?? 0) > (before.state.damageTracks.get(track.id)?.hits ?? 0));
        const engineHit = !before.state.damageTracks.get(engine)?.hits && !!current.state.damageTracks.get(engine)?.hits;
        if (!engineHit && (!lostMotive || project(before).maximum.walk === 0 || project(current).maximum.walk > 0)) return true;
        const terrain = await this.dialogs.choose('Emergency landing', 'What terrain is the vehicle over?', [
            { label: 'Clear or paved', value: 'clear' }, { label: 'Rough or building', value: 'rough' },
            { label: 'Water', value: 'water' }, { label: 'Other terrain', value: 'other' },
        ], 'other');
        let landed = false;
        if ((vtol || engineHit) && (terrain === 'clear' || terrain === 'rough')) {
            const driver = activeCrewController(current, 'piloting');
            const mods = projectNonMekControlRoll(current.entity, current.index, current.state, current.ruleset, current.crewAssignment)
                .modifiers.reduce((n, row) => n + row.modifier, vtol ? 4 : 0);
            const targetNumber = (driver?.piloting ?? 5) + mods;
            if (this.options.cbtAutomationMode('pilotSkillCheck') === 'no') {
                landed = await this.dialogs.choose('Emergency landing', 'Did the Driving Skill Roll succeed (' + targetNumber + '+)?',
                    [{ label: 'Success', value: true }, { label: 'Failure', value: false }], false);
            } else {
                const rolls = await this.automationChecks.resolve('pilotSkillCheck', [{ id: 'landing:' + instanceId + ':' + current.query.stateRevision,
                    subject: this.subject(current), label: 'Emergency landing', description: vtol ? 'VTOL engine damage (+4)' : 'WiGE engine damage',
                    failureOutcome: 'Crash', targetNumber }], { title: 'Driving Skill Roll' });
                if (!rolls?.length) return false;
                landed = rolls[0]!.outcome === 'success';
            }
        }
        const distance = before.state.turn.movement?.distance ?? 0;
        if (!(await dispatch({ type: 'set-airborne', airborne: false }, false)).accepted) return false;
        if (landed) return (await dispatch({ type: 'set-condition', condition: 'immobile', active: true }, false)).accepted;
        if (vtol || (terrain !== 'clear' && terrain !== 'water')) {
            return (await dispatch({ type: 'set-destroyed', destroyed: true }, false)).accepted;
        }
        if (!(await dispatch({ type: 'set-condition', condition: 'crashed', active: true }, false)).accepted) return false;
        const damage = Math.ceil(distance * current.entity.tonnage() / 10);
        if (!damage) return true;
        const arc = await this.dialogs.choose<NonMekHitArc>('WiGE crash', 'Which side struck the terrain?',
            (['front', 'left', 'right', 'rear'] as const).map(value => ({ value, label: value })), 'front');
        const member = force.getCBTMembers().find(m => m.id === instanceId);
        for (let remaining = damage; remaining > 0; remaining -= 5) {
            const sheet = member?.nonMekRecordSheetSnapshot();
            if (!sheet) return false;
            const table = resolveNonMekHitLocation(current.entity, sheet, arc, twoD6Total(roll2D6()), rollD6);
            const loc = sheet.locations.find(l => l.sheetCode === table?.locationCode);
            if (loc && !await this.applyWeaponHits(force, instanceId, [{ locationId: loc.locationId, arc, damage: Math.min(remaining, 5),
                effects: table?.effects ?? [], source: { kind: 'fall' } }], 'committed', dispatch)) return false;
        }
        return true;
    }

    /**
     * A swarmed vehicle declaring flank speed may make erratic manoeuvres, spending only its Cruising MP: at the end of
     * its movement a Driving Skill Roll at +4 (+2 on VTOL MP), magnetic claws +1 (TW p. 222).
     */
    private async prepareErraticManoeuvres(
        force: CBTForce,
        snapshot: NonMekSnapshot,
        movement: NonMekMovementDeclaration,
    ): Promise<PreparedDirectNonMekAutomationCommand> {
        const command = Object.freeze({ type: 'set-movement' as const, movement });
        const flank = Object.freeze({ command });
        const member = force.getCBTMembers().find(candidate => candidate.id === snapshot.instanceId);
        const driver = activeCrewController(snapshot, 'piloting');
        if (!member || !driver) return flank;
        const choice = await this.dialogs.choose<'erratic' | 'flank' | 'cancel'>(
            'Erratic Manoeuvres',
            `${this.subject(snapshot)} is swarmed. Make erratic manoeuvres to shake the infantry off? `
                + 'It spends only its Cruising MP.',
            [
                { label: 'ERRATIC MANOEUVRES', value: 'erratic' },
                { label: 'FLANK', value: 'flank' },
                { label: 'CANCEL', value: 'cancel' },
            ],
            'cancel',
        );
        if (choice === 'cancel') return Object.freeze({ command, cancelled: true });
        if (choice === 'flank') return flank;
        const erratic = Object.freeze({ command: this.erraticMovement(snapshot, movement) });
        const swarm = await loadSwarmService(this.injector);
        const permanent = projectNonMekControlRoll(
            snapshot.entity, snapshot.index, snapshot.state, snapshot.ruleset, snapshot.crewAssignment,
        ).modifiers.reduce((total, entry) => total + entry.modifier, 0);
        const targetNumber = driver.piloting + permanent
            + erraticManoeuvresModifier(snapshot.entity.entityType === 'VTOL') + swarm.removalModifier(member);
        const resolutions = await this.automationChecks.resolve('pilotSkillCheck', [Object.freeze({
            id: `erratic-manoeuvres:${snapshot.instanceId}:${snapshot.query.stateRevision}`,
            subject: this.subject(snapshot),
            label: 'Driving Skill Check',
            description: 'Erratic manoeuvres to shake off swarming infantry.',
            failureOutcome: 'Infantry holds on',
            targetNumber,
        })], { title: 'Driving Skill Rolls' });
        if (resolutions === null) return Object.freeze({ command, cancelled: true });
        const resolution = resolutions[0];
        if (!resolution) return erratic;
        if (this.options.cbtAutomationMode('pilotSkillCheck') === 'yes') {
            const total = resolution.dice ? twoD6Total(resolution.dice) : null;
            this.toast(
                snapshot,
                `Driving Skill Check: ${resolution.outcome === 'success' ? 'PASSED' : 'FAILED'}`
                    + `${total === null ? ' (automatic)' : ` (${total} vs ${targetNumber}+)`}`
                    + ' — Erratic manoeuvres',
                resolution.outcome === 'success' ? 'success' : 'error',
            );
        }
        return resolution.outcome === 'success' ? Object.freeze({ ...erratic, shookOffSwarm: true }) : erratic;
    }

    /** The flank movement as erratic manoeuvres, cut to the vehicle's Cruising MP (TW p. 222). */
    private erraticMovement(snapshot: NonMekSnapshot, movement: NonMekMovementDeclaration): CBTUnitCommand {
        const cruise = projectNonMekMovementCapabilities(
            snapshot.entity, snapshot.index, snapshot.state, snapshot.ruleset, snapshot.crewAssignment,
        ).maximum.walk;
        return Object.freeze({
            type: 'set-movement',
            movement: Object.freeze({ ...movement, distance: Math.min(movement.distance, cruise), erratic: true as const }),
        });
    }

    /**
     * Erratic manoeuvres shake the swarming infantry off as a jumping 'Mech would, 1 point to each trooper (1 for each
     * Elevation off a VTOL or WiGE): it is sent what it takes (`SwarmService.shakeOff`) and the vehicle is no longer
     * swarmed (TW p. 222).
     */
    private async releaseSwarm(
        force: CBTForce,
        instanceId: string,
        dispatch: CBTForceUnitCommandDispatch,
    ): Promise<boolean> {
        const snapshot = this.nonMekSnapshot(force, instanceId);
        const member = force.getCBTMembers().find(candidate => candidate.id === instanceId);
        if (!snapshot?.query.hasCondition('swarmed') || !member) return true;
        const cover = snapshot.state.turn.cover;
        const waterDepth = isUnitWaterDepth(cover) ? unitWaterDepthNumber(cover) : 0;
        // A VTOL or WiGE throws the infantry from its Elevation (TW p. 222).
        const elevation = nonMekFliesAtElevation(snapshot.entity)
            ? { elevation: elevationAt(snapshot.state.elevationRecord, snapshot.state.turn.turnCounter + 1) } : {};
        if (!(await loadSwarmService(this.injector)).shakeOff(member, { kind: 'erratic', waterDepth, ...elevation })) {
            return true;
        }
        return (await dispatch({ type: 'set-condition', condition: 'swarmed', active: false }, false)).accepted;
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
        const ammoMount = snapshot.index.components.get(ammo.componentId)?.mount;
        const protection = ammoMount === undefined ? null : snapshot.entity.ammoCaseProtection(ammoMount.location, mount =>
            snapshot!.query.componentStatus(asComponentId(mount.mountId), 'committed') === 'available');
        const siDamage = aeroExplosionStructuralIntegrityDamage(ammo.shots * ammo.damagePerShot, protection);

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
