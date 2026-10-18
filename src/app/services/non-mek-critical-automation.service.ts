// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { inject, Injectable } from '@angular/core';

import type { AutomationReviewEvent } from '../models/automation-review.model';
import { isCaseEquipment } from '../models/case-equipment.model';
import type { CBTForce } from '../models/cbt-force.model';
import type { CBTForceUnitCommandDispatch } from '../models/cbt-force.types';
import { hasNonMekRuntime, type CBTNonMekUnitSnapshot } from '../models/cbt-unit-snapshot';
import type { ComponentId, LocationId } from '../models/entity/entity-identifiers';
import { supportVehicleBarRating } from '../models/entity/entities/support-vehicle';
import type { VehicleMotiveType } from '../models/entity/types/motive';
import { isAeroEntity, isProtoMekEntity, isVehicleEntity } from '../models/entity/utils/entity-type-guards';
import { AmmoEquipment, WeaponEquipment } from '../models/equipment.model';
import {
    AERO_CRITICAL_LABELS,
    AERO_CRITICAL_TARGET,
    type AeroCriticalType,
} from '../models/rules/aero-critical-rules';
import {
    protoMekCriticalPilotHits,
    protoMekCriticalReferences,
    protoMekTorsoCriticalResults,
} from '../models/rules/protomek-critical-rules';
import { systemDamageId, type SystemDamageKind } from '../models/rules/system-damage-rules';
import {
    vehicleCriticalColumn,
    vehicleCriticalEffect,
    applicableVehicleCriticalEffect,
    vehicleMotiveModifiers,
    vehicleMotiveStage,
    VEHICLE_CRITICAL_LABELS,
    type VehicleCriticalEffect,
    type VehicleCriticalFacts,
} from '../models/rules/vehicle-critical-rules';
import type { CBTRuntimeLocation, RuntimeStatePerspective } from '../models/runtime/cbt-unit-runtime';
import { rollD6, roll2D6, twoD6Total } from '../models/runtime/mek-automation-rules';
import { ammoExplosionDamagePerShot, ammoRackSize, resolveMekCriticalChance } from '../models/runtime/mek-critical-hit-v2';
import type { CBTUnitCommand } from '../models/runtime/unit-command';
import { componentIdForMount } from '../models/runtime/unit-runtime-index';
import { CBTAutomationToastService } from './cbt-automation-toast.service';
import { CBTAutomationService } from './cbt-automation.service';
import { CBTCrewHitAutomationService } from './cbt-crew-hit-automation.service';
import { directAutomationSubject } from './direct-automation-subject';
import type { NonMekDamageGroup, NonMekDamageGroupOutcome } from './direct-non-mek-automation.service';
import { OptionsService } from './options.service';

type Target = 'committed' | 'pending';

/** What one result does: the consequences shown for review and the commands it dispatches. */
type CriticalEffect = Omit<PlannedCritical, 'description'>;

/** One roll a damage group owes, planned against the unit as the previous roll left it. */
interface CriticalCheck {
    readonly event: string;
    readonly plan: (snapshot: CBTNonMekUnitSnapshot) => PlannedCritical | null;
}

/** One applied critical: its review text and the commands it dispatches. */
interface PlannedCritical {
    readonly description: string;
    readonly effects: readonly string[];
    readonly apply: (dispatch: CBTForceUnitCommandDispatch) => Promise<boolean>;
}

/**
 * Critical and motive rolls owed by damage to non-Mek units, read on each unit's own tables and applied
 * through the same review as Mek criticals ('criticalHitChanceCheck').
 */
@Injectable({ providedIn: 'root' })
export class NonMekCriticalAutomationService {
    private readonly automation = inject(CBTAutomationService);
    private readonly automationToasts = inject(CBTAutomationToastService);
    private readonly crewHitAutomation = inject(CBTCrewHitAutomationService);
    private readonly options = inject(OptionsService);
    private reviews = 0;

    /** Rolls and applies the checks one applied damage group owes; false only when a command is rejected. */
    async resolveDamageGroup(
        force: CBTForce,
        instanceId: string,
        group: NonMekDamageGroup,
        outcome: NonMekDamageGroupOutcome,
        target: Target,
        dispatch: CBTForceUnitCommandDispatch,
    ): Promise<boolean> {
        if (this.options.cbtAutomationMode('criticalHitChanceCheck') === 'no') return true;
        const snapshot = this.snapshot(force, instanceId);
        if (!snapshot) return true;
        // Each check reads the unit as the previous one left it.
        for (const check of this.criticalChecks(force, snapshot, group, outcome, target)) {
            const current = this.snapshot(force, instanceId);
            if (!current || current.query.destroyed()) return true;
            const plan = check.plan(current);
            if (plan && !await this.review(force, instanceId, check.event, plan, dispatch)) return false;
        }
        return true;
    }

    /** The rolls one group owes on the struck unit's own tables, in rules order. */
    private criticalChecks(
        force: CBTForce,
        snapshot: CBTNonMekUnitSnapshot,
        group: NonMekDamageGroup,
        outcome: NonMekDamageGroupOutcome,
        target: Target,
    ): readonly CriticalCheck[] {
        const entity = snapshot.entity;
        if (isVehicleEntity(entity)) {
            return [
                ...vehicleCriticalChecks(snapshot, group, outcome).map(check => ({
                    event: 'Critical Hit',
                    plan: (current: CBTNonMekUnitSnapshot) =>
                        this.planVehicleCritical(current, check.locationId, check.modifier, check.reason, target),
                })),
                ...(group.effects.includes('motive') ? [{
                    event: 'Motive System Damage',
                    plan: (current: CBTNonMekUnitSnapshot) => this.planVehicleMotive(current, group, target),
                }] : []),
            ];
        }
        const aeroCritical = group.aeroCritical;
        if (isAeroEntity(entity) && aeroCritical) {
            return aeroCriticalChances(snapshot, group, outcome).map(reason => ({
                event: 'Critical Hit',
                plan: (current: CBTNonMekUnitSnapshot) =>
                    this.planAeroCritical(force, current, group.locationId, aeroCritical, reason, target),
            }));
        }
        if (isProtoMekEntity(entity)) {
            // TW p.185: every location whose internal structure is damaged rolls on the Determining Critical Hits Table.
            return [...new Set(outcome.structureDamaged)].map(locationId => ({
                event: 'Critical Hit',
                plan: (current: CBTNonMekUnitSnapshot) => this.planProtoMekCritical(force, current, locationId, target),
            }));
        }
        return [];
    }

    private planVehicleCritical(
        snapshot: CBTNonMekUnitSnapshot,
        locationId: LocationId,
        modifier: number,
        reason: string,
        target: Target,
    ): PlannedCritical | null {
        const location = snapshot.index.locations.get(locationId);
        if (!location) return null;
        const perspective = perspectiveOf(target);
        const facts = vehicleCriticalFacts(snapshot, location, perspective);
        const dice = roll2D6();
        const total = twoD6Total(dice) + modifier;
        const effect = vehicleCriticalEffect(total, vehicleCriticalColumn(location.code), facts);
        const roll = `${twoD6Total(dice)}${modifier === 0 ? '' : ` ${modifier > 0 ? '+' : '−'} ${Math.abs(modifier)}`}`
            + (modifier === 0 ? '' : ` = ${total}`);
        const description = `${location.code} (${reason}) · roll ${roll}: ${effect ? VEHICLE_CRITICAL_LABELS[effect] : 'no critical hit'}`;
        if (!effect) return Object.freeze({ description, effects: Object.freeze([]), apply: async () => true });
        const vehicle = this.vehicleEffect(snapshot, location, effect, facts, target);
        return Object.freeze({ description, effects: vehicle.effects, apply: vehicle.apply });
    }

    /** The commands and consequences of one Vehicle Critical Hits Table result. */
    private vehicleEffect(
        snapshot: CBTNonMekUnitSnapshot,
        location: CBTRuntimeLocation,
        effect: VehicleCriticalEffect,
        facts: VehicleCriticalFacts,
        target: Target,
    ): CriticalEffect {
        const perspective = perspectiveOf(target);
        const track = (system: SystemDamageKind, stage?: number, scope?: string): CBTUnitCommand => ({
            type: 'damage-track', damageTrackId: systemDamageId(system, stage, scope), amount: 1, target, timestamp: Date.now(),
        });
        const commands = (effects: readonly string[], ...list: CBTUnitCommand[]) => Object.freeze({
            effects: Object.freeze(effects),
            apply: (dispatch: CBTForceUnitCommandDispatch) => dispatchAll(dispatch, list),
        });
        const crew = (state: 'stunned' | 'killed') => this.crewCommands(snapshot, state);
        const destroyLocation = (): CBTUnitCommand => ({
            type: 'damage-internal', locationId: location.id, amount: snapshot.query.remainingInternal(location.id, perspective), target,
        });
        const weapons = locationWeapons(snapshot, location, perspective);
        const airborne = snapshot.state.turn.airborne === true;
        switch (effect) {
            case 'driver-hit':
                return commands(['+2 to Driving Skill Rolls for the rest of the game'], track('driver'));
            case 'pilot-hit':
                return commands(['+2 to Driving Skill Rolls for the rest of the game',
                    ...(airborne ? ['Make a Driving Skill Roll or drop one elevation'] : [])], track('pilot'));
            case 'co-pilot-hit':
                return commands(['+1 to all to-hit rolls for the rest of the game'], track('copilot'));
            case 'commander-hit':
                return commands(['+1 to to-hit and Driving Skill Rolls for the rest of the game', 'The crew is stunned'],
                    track('commander'), ...crew('stunned'));
            case 'crew-stunned':
                return commands(['Next turn: Cruising speed at most, no other actions'], ...crew('stunned'));
            case 'crew-killed':
                return commands(airborne ? ['The crew is killed', 'The airborne vehicle crashes and is destroyed'] : ['The crew is killed'],
                    ...crew('killed'), ...(airborne ? [{ type: 'set-destroyed', destroyed: true } as const] : []));
            case 'weapon-malfunction': {
                const working = weapons.filter(weapon => weapon.status === 'available');
                const weapon = working[Math.floor(Math.random() * working.length)]!;
                return commands([`${weapon.name} malfunctions until the crew spends a Weapon Attack Phase clearing it`], {
                    type: 'set-component-status', componentId: weapon.componentId, status: 'disabled', target,
                });
            }
            case 'weapon-destroyed': {
                const { choice, weapon } = chooseDestroyedWeapon(weapons)!;
                const explosion = weapon.explosionDamage > 0
                    ? this.explosion(snapshot, location, weapon.explosionDamage, facts, target)
                    : null;
                return Object.freeze({
                    effects: Object.freeze([
                        `1D6 ${choice}: the ${choice <= 3 ? 'defender' : 'attacker'} chooses — ${weapon.name} is destroyed`,
                        ...(explosion?.effects ?? []),
                    ]),
                    apply: async (dispatch: CBTForceUnitCommandDispatch) => await dispatchAll(dispatch, [{
                        type: 'set-component-status', componentId: weapon.componentId, status: 'destroyed', target,
                    }]) && (!explosion || await explosion.apply(dispatch)),
                });
            }
            case 'stabilizer':
                return commands([`Attacker movement modifier doubled for weapons in the ${location.code}`],
                    track('stabilizer', undefined, location.code));
            case 'sensors':
                return commands([facts.sensorHits + 1 >= 4 ? 'The vehicle can no longer fire weapons' : `+${facts.sensorHits + 1} to all to-hit rolls`], {
                    type: 'set-system-damage-level', system: 'sensors', level: facts.sensorHits + 1, target, timestamp: Date.now(),
                });
            case 'engine-hit':
                return commands(['The vehicle cannot move or change facing for the rest of the game',
                    ...(airborne ? ['Airborne: make a Driving Skill Roll (+4) to land, or the vehicle is destroyed'] : [])],
                track('engine', 1));
            case 'fuel-tank':
                return commands(['The fuel tank explodes and destroys the vehicle'], track('fuel-tank', 1));
            case 'ammunition': {
                const bins = ammunition(snapshot, perspective);
                const damage = bins.reduce((total, bin) => total + bin.damage, 0);
                const explosion = this.explosion(snapshot, location, damage, facts, target);
                return Object.freeze({
                    effects: Object.freeze(['All ammunition explodes', ...explosion.effects]),
                    apply: async (dispatch: CBTForceUnitCommandDispatch) => await dispatchAll(dispatch, bins.map(bin => ({
                        type: 'set-component-status', componentId: bin.componentId, status: 'destroyed', target,
                    }) as const)) && explosion.apply(dispatch),
                });
            }
            case 'turret-jam':
                return commands(['The turret is stuck in its current facing until the crew spends a Weapon Attack Phase, '
                    + 'without firing, clearing the jam', 'A second Turret Jam locks the turret']);
            case 'turret-locks':
                return commands(['The turret is locked in its current facing'], track('turret-lock', undefined, location.code));
            case 'turret-blown-off':
                return commands(['The turret is blown off, destroying the vehicle'], destroyLocation());
            case 'rotor-damage':
                return commands(['−1 Cruising MP'], track('rotor'));
            case 'flight-stabilizer':
                return commands(['+3 to Driving Skill Rolls'], track('flight-stabilizer'));
            case 'rotors-destroyed':
                return commands(['The rotors are destroyed'], destroyLocation());
            case 'cargo-hit':
                return commands([]);
        }
    }

    /**
     * An ammunition or explosive-weapon blast in a vehicle: into the struck location's structure, or with CASE
     * into the rear armor with the excess ignored and the crew stunned (TW p.194).
     */
    private explosion(
        snapshot: CBTNonMekUnitSnapshot,
        location: CBTRuntimeLocation,
        damage: number,
        facts: VehicleCriticalFacts,
        target: Target,
    ): CriticalEffect {
        const perspective = perspectiveOf(target);
        const caseProtected = [...snapshot.index.components.values()].some(component =>
            isCaseEquipment(component.mount.equipment) && snapshot.query.componentStatus(component.id, perspective) === 'available');
        const rear = [...snapshot.index.locations.values()].find(candidate => candidate.code === 'Rear');
        const rearFace = rear?.armorFaceIds[0];
        if (caseProtected && rearFace !== undefined) {
            const stun = applicableVehicleCriticalEffect('crew-stunned', facts);
            const armor = Math.min(damage, snapshot.query.remainingArmor(rearFace, perspective));
            return Object.freeze({
                effects: Object.freeze([`CASE vents ${damage} damage into the rear armor`,
                    ...(stun ? [`The crew is ${stun === 'crew-killed' ? 'killed' : 'stunned'}`] : [])]),
                apply: (dispatch: CBTForceUnitCommandDispatch) => dispatchAll(dispatch, [
                    ...(armor > 0 ? [{ type: 'damage-armor', faceId: rearFace, amount: armor, target } as const] : []),
                    ...(stun ? this.crewCommands(snapshot, stun === 'crew-killed' ? 'killed' : 'stunned') : []),
                ]),
            });
        }
        const internal = Math.min(damage, snapshot.query.remainingInternal(location.id, perspective));
        return Object.freeze({
            effects: Object.freeze([`${damage} damage to the ${location.code} internal structure`]),
            apply: (dispatch: CBTForceUnitCommandDispatch) => dispatchAll(dispatch, internal > 0
                ? [{ type: 'damage-internal', locationId: location.id, amount: internal, target }]
                : []),
        });
    }

    /** A motive roll (TW p.193); a VTOL's rotor hit instead costs one Cruising MP. */
    private planVehicleMotive(snapshot: CBTNonMekUnitSnapshot, group: NonMekDamageGroup, target: Target): PlannedCritical | null {
        const timestamp = Date.now();
        const perspective = perspectiveOf(target);
        if (snapshot.entity.unitType() === 'VTOL') {
            return Object.freeze({
                description: 'Rotor hit: −1 Cruising MP',
                effects: Object.freeze([]),
                apply: (dispatch: CBTForceUnitCommandDispatch) => dispatchAll(dispatch, [{
                    type: 'damage-track', damageTrackId: systemDamageId('rotor'), amount: 1, target, timestamp,
                }]),
            });
        }
        const armoredMotive = [...snapshot.index.components.values()].some(component =>
            component.mount.equipment?.hasFlag('F_ARMORED_MOTIVE_SYSTEM') === true
            && snapshot.query.componentStatus(component.id, perspective) === 'available');
        const modifiers = vehicleMotiveModifiers(group.arc, snapshot.entity.motiveType() as VehicleMotiveType, armoredMotive);
        const dice = roll2D6();
        const total = twoD6Total(dice) + modifiers.reduce((sum, row) => sum + row.value, 0);
        const stage = vehicleMotiveStage(total);
        const trackId = systemDamageId('motive', stage);
        const definition = stage > 0 ? snapshot.index.damageTracks.get(trackId) : undefined;
        const applies = definition !== undefined && trackHits(snapshot, trackId, perspective) < definition.maximumHits;
        const label = ['no effect', 'minor damage (+1 Driving Skill Rolls)', 'moderate damage (−1 Cruising MP, +2 Driving Skill Rolls)',
            'heavy damage (half Cruising MP, +3 Driving Skill Rolls)', 'major damage: immobile'][stage]!;
        return Object.freeze({
            description: `Rolled ${twoD6Total(dice)}${modifiers.length ? ` → ${total}` : ''}: ${label}`,
            effects: Object.freeze([
                ...modifiers.map(row => `${row.label} ${row.value > 0 ? '+' : '−'}${Math.abs(row.value)}`),
                ...(stage > 0 && !applies ? ['Already suffered; no further effect'] : []),
            ]),
            apply: (dispatch: CBTForceUnitCommandDispatch) => dispatchAll(dispatch, applies
                ? [{ type: 'damage-track', damageTrackId: trackId, amount: 1, target, timestamp }]
                : []),
        });
    }

    /**
     * A ProtoMech location's critical roll, or, once the location is destroyed, every box crossed off. Filled
     * shaded boxes wound the pilot; the last arm, leg and head boxes destroy the location (TW pp.185-186).
     */
    private planProtoMekCritical(
        force: CBTForce,
        snapshot: CBTNonMekUnitSnapshot,
        locationId: LocationId,
        target: Target,
    ): PlannedCritical | null {
        const entity = snapshot.entity;
        const location = snapshot.index.locations.get(locationId);
        if (!isProtoMekEntity(entity) || !location) return null;
        const perspective = perspectiveOf(target);
        const reference = protoMekCriticalReferences(entity).find(row => row.location === location.code);
        const boxes = reference?.effects.length ?? 0;
        if (!reference || boxes === 0) return null;
        const system = reference.system;
        let filled = 0;
        while (filled < boxes && trackHits(snapshot, systemDamageId(system, filled + 1), perspective) > 0) filled++;
        const locationDestroyed = snapshot.query.remainingInternal(location.id, perspective) === 0;
        // The main gun cannot suffer a critical hit; its box only goes with the location.
        if (filled >= boxes || (!locationDestroyed && system === 'main-gun')) return null;
        let to = boxes;
        let description = `${location.code} destroyed: every critical box is crossed off`;
        if (!locationDestroyed) {
            const dice = roll2D6();
            const chance = resolveMekCriticalChance(twoD6Total(dice), false);
            const count = chance.kind === 'critical-hits' ? chance.count : 0;
            to = Math.min(boxes, filled + count);
            description = `${location.code} · roll ${twoD6Total(dice)}: `
                + (count === 0 ? 'no critical hit' : `${count} critical hit${count === 1 ? '' : 's'}`);
            if (count === 0) return Object.freeze({ description, effects: Object.freeze([]), apply: async () => true });
        }
        const torsoWeapons = system === 'torso' && !locationDestroyed
            ? Array.from({ length: Math.max(0, Math.min(to, 2) - filled) }, () => {
                const roll = rollD6();
                const mount = protoMekTorsoCriticalResults(entity)
                    .find(result => roll >= result.firstRoll && roll <= result.lastRoll)?.mount;
                const componentId = mount ? componentIdForMount(mount) : null;
                const destroys = componentId !== null
                    && snapshot.query.componentStatus(componentId, perspective) !== 'destroyed';
                return Object.freeze({ roll, name: mount?.displayName(), componentId: destroys ? componentId : null });
            })
            : [];
        const destroysLocation = !locationDestroyed && to === boxes && system !== 'torso' && system !== 'main-gun';
        const pilotHits = protoMekCriticalPilotHits(system, filled, to);
        const timestamp = Date.now();
        return Object.freeze({
            description,
            effects: Object.freeze([
                ...reference.effects.slice(filled, to)
                    .map(effect => effect.detail ? `${effect.text} ${effect.detail}` : effect.text),
                ...torsoWeapons.map(weapon => `Torso weapon roll ${weapon.roll}: `
                    + (weapon.componentId ? `${weapon.name} destroyed` : 'no weapon destroyed')),
                ...(pilotHits > 0 ? [`The pilot takes ${pilotHits} hit${pilotHits === 1 ? '' : 's'}`] : []),
            ]),
            apply: async (dispatch: CBTForceUnitCommandDispatch) => await dispatchAll(dispatch, [
                { type: 'set-system-damage-level', system, level: to, target, timestamp },
                ...torsoWeapons.flatMap(weapon => weapon.componentId ? [{
                    type: 'set-component-status', componentId: weapon.componentId, status: 'destroyed', target,
                } as const] : []),
                ...(destroysLocation ? [{
                    type: 'damage-internal', locationId: location.id,
                    amount: snapshot.query.remainingInternal(location.id, perspective), target,
                } as const] : []),
            ]) && this.applyPilotHits(force, snapshot.instanceId, pilotHits, dispatch),
        });
    }

    /**
     * One possible aerospace critical: on 8+ the damage the hit-location roll threatens takes effect on the
     * system tracks (TW pp.238-240). Effects with no tracked state are reported for the players to apply.
     */
    private planAeroCritical(
        force: CBTForce,
        snapshot: CBTNonMekUnitSnapshot,
        locationId: LocationId,
        type: AeroCriticalType,
        reason: string,
        target: Target,
    ): PlannedCritical | null {
        const location = snapshot.index.locations.get(locationId);
        if (!location) return null;
        const perspective = perspectiveOf(target);
        const dice = roll2D6();
        const hit = twoD6Total(dice) >= AERO_CRITICAL_TARGET;
        const description = `${location.code} (${reason}) · roll ${twoD6Total(dice)}: `
            + (hit ? AERO_CRITICAL_LABELS[type] : 'no critical hit');
        const none = (effects: readonly string[] = []): PlannedCritical =>
            Object.freeze({ description, effects: Object.freeze(effects), apply: async () => true });
        if (!hit) return none();
        const timestamp = Date.now();
        const advance = (system: SystemDamageKind, effects: readonly string[]): PlannedCritical => {
            const stages = [...snapshot.index.damageTracks.values()].filter(track => track.system === system).length;
            let filled = 0;
            while (filled < stages && trackHits(snapshot, systemDamageId(system, filled + 1), perspective) > 0) filled++;
            if (filled >= stages) return none(['Already destroyed: no further effect']);
            return Object.freeze({
                description,
                effects: Object.freeze(effects),
                apply: (dispatch: CBTForceUnitCommandDispatch) => dispatchAll(dispatch, [
                    { type: 'set-system-damage-level', system, level: filled + 1, target, timestamp },
                ]),
            });
        };
        switch (type) {
            case 'avionics': return advance('avionics', ['+1 to Control Rolls (third hit: +5)', 'Make a Control Roll']);
            case 'fcs': return advance('fire-control', ['+2 to-hit (third hit: no weapon attacks)']);
            case 'sensors': return advance('sensors', ['+1 to-hit (third hit: +5)']);
            case 'engine': return advance('engine', ['Safe Thrust reduced']);
            case 'life-support': return advance('life-support', ['+2 to Control Rolls']);
            case 'gear': return advance('landing-gear', ['+5 to landing Control Rolls']);
            case 'docking-collar': return advance('docking-collar', ['The craft cannot dock']);
            case 'kf-boom': return advance('kf-boom', ['The craft cannot be carried through hyperspace']);
            case 'thruster':
                return advance(location.code.includes('Left') ? 'left-thruster' : 'right-thruster',
                    ['Turning away from this side costs 1 more thrust']);
            case 'fuel': {
                const explosion = roll2D6();
                const explodes = twoD6Total(explosion) >= 10;
                const tank = advance('fuel-tank', []);
                return Object.freeze({
                    description,
                    effects: Object.freeze([`Explosion roll ${twoD6Total(explosion)}: `
                        + (explodes ? 'the fuel tank explodes and destroys the unit' : 'the tank holds')]),
                    apply: async (dispatch: CBTForceUnitCommandDispatch) => await tank.apply(dispatch)
                        && (!explodes || await dispatchAll(dispatch, [{ type: 'set-destroyed', destroyed: true }])),
                });
            }
            case 'crew':
                return Object.freeze({
                    description,
                    effects: Object.freeze(['The crew takes 1 hit']),
                    apply: (dispatch: CBTForceUnitCommandDispatch) => this.applyPilotHits(force, snapshot.instanceId, 1, dispatch),
                });
            case 'weapon': {
                const chosen = chooseDestroyedWeapon(locationWeapons(snapshot, location, perspective));
                if (!chosen) return none(['No weapon in this location: no effect']);
                return Object.freeze({
                    description,
                    effects: Object.freeze([
                        `1D6 ${chosen.choice}: the ${chosen.choice <= 3 ? 'defender' : 'attacker'} chooses — ${chosen.weapon.name} is destroyed`,
                        ...(chosen.weapon.explosionDamage > 0 ? ['It explodes: resolve as an ammunition explosion'] : []),
                    ]),
                    apply: (dispatch: CBTForceUnitCommandDispatch) => dispatchAll(dispatch, [{
                        type: 'set-component-status', componentId: chosen.weapon.componentId, status: 'destroyed', target,
                    }]),
                });
            }
            case 'bomb': {
                const bomb = (snapshot.state.bombs ?? []).find(load => load.spent < load.count);
                if (!bomb) return none(['No bombs carried: no effect']);
                return Object.freeze({
                    description,
                    effects: Object.freeze(['One bomb is rendered useless']),
                    apply: (dispatch: CBTForceUnitCommandDispatch) => dispatchAll(dispatch, [{
                        type: 'set-bombs-spent', section: bomb.section, bombId: bomb.bombId, spent: bomb.spent + 1,
                    }]),
                });
            }
            case 'control': return none(['Make a Control Roll; on a failure the unit goes out of control']);
            case 'heat-sink': return none(['One heat sink is destroyed: reduce heat dissipation (not tracked)']);
            case 'door': return none(['A random door is damaged (not tracked)']);
            case 'cargo': return none(['Cargo is damaged (not tracked)']);
        }
    }

    /** Pilot hits through the shared crew automation, with its consciousness rolls. */
    private async applyPilotHits(
        force: CBTForce,
        instanceId: string,
        hits: number,
        dispatch: CBTForceUnitCommandDispatch,
    ): Promise<boolean> {
        const snapshot = this.snapshot(force, instanceId);
        if (!snapshot || hits <= 0) return snapshot !== null;
        const resolved = await this.crewHitAutomation.resolveUnitHits(
            snapshot, hits, `critical-pilot-hits:${instanceId}:${snapshot.query.stateRevision}`);
        if (!resolved) return true;
        if (!await this.crewHitAutomation.applyResolvedHits(snapshot, resolved, dispatch)) return false;
        this.crewHitAutomation.showConsciousnessToasts(snapshot, resolved);
        return true;
    }

    /** Stuns or kills every living crew member aboard. */
    private crewCommands(snapshot: CBTNonMekUnitSnapshot, state: 'stunned' | 'killed'): CBTUnitCommand[] {
        return snapshot.crewAssignment.positions.flatMap(({ positionId }) => {
            const member = snapshot.query.crewState(positionId);
            if (member.isDeathCommitted() || (state === 'stunned' && member.unconscious)) return [];
            const command = Object.freeze({
                type: 'set-crew-state' as const,
                positionId,
                wounds: member.wounds,
                unconscious: state === 'stunned' || member.unconscious,
                ejected: member.ejected,
                ...(state === 'killed' ? { dead: true } : {}),
            });
            return [state === 'stunned' ? this.crewHitAutomation.withRecoveryReadyTurn(snapshot, command) : command];
        });
    }

    /** Shows one rolled result for review and applies it when accepted; true unless a command is rejected. */
    private async review(
        force: CBTForce,
        instanceId: string,
        event: string,
        plan: PlannedCritical,
        dispatch: CBTForceUnitCommandDispatch,
    ): Promise<boolean> {
        const snapshot = this.snapshot(force, instanceId);
        if (!snapshot) return false;
        const subject = directAutomationSubject(snapshot, this.options.options().displayUnitNameFormat);
        const review: AutomationReviewEvent = Object.freeze({
            id: `non-mek-critical:${instanceId}:${++this.reviews}`,
            subject,
            event,
            description: plan.description,
            effects: plan.effects,
        });
        const accepted = await this.automation.resolve('criticalHitChanceCheck', [review], { title: `Review ${event}` });
        if (!accepted?.has(review.id)) return true;
        if (this.options.cbtAutomationMode('criticalHitChanceCheck') === 'yes') {
            this.automationToasts.show(instanceId, subject, `${event}: ${plan.description}`, 'error');
        }
        return plan.apply(dispatch);
    }

    private snapshot(force: CBTForce, instanceId: string): CBTNonMekUnitSnapshot | null {
        const snapshot = force.getUnitSnapshot(instanceId);
        return snapshot && hasNonMekRuntime(snapshot) ? snapshot : null;
    }
}

/**
 * Each way one group can cause aerospace critical damage: exceeding the facing's Damage Threshold, damaging
 * the SI, or a lucky natural 12 (TW p.239).
 */
function aeroCriticalChances(
    snapshot: CBTNonMekUnitSnapshot,
    group: NonMekDamageGroup,
    outcome: NonMekDamageGroupOutcome,
): readonly string[] {
    const location = snapshot.index.locations.get(group.locationId);
    const entity = snapshot.entity;
    if (!location || !isAeroEntity(entity)) return [];
    return [
        ...(group.damage > entity.armorDamageThreshold(location.code) ? ['damage threshold'] : []),
        ...(outcome.structuralIntegrityDamage > 0 ? ['SI damage'] : []),
        ...(group.luckyHit ? ['lucky hit'] : []),
    ];
}

/** TW: on 1-3 the defender picks the weapon, on 4-6 the attacker; each picks the least or most valuable (MegaMek). */
function chooseDestroyedWeapon(weapons: ReturnType<typeof locationWeapons>) {
    const intact = weapons.filter(weapon => weapon.status !== 'destroyed').sort((left, right) => left.bv - right.bv);
    if (intact.length === 0) return null;
    const choice = rollD6();
    return Object.freeze({ choice, weapon: (choice <= 3 ? intact[0] : intact[intact.length - 1])! });
}

/** The vehicle critical rolls one damage group owes, in rules order. */
function vehicleCriticalChecks(
    snapshot: CBTNonMekUnitSnapshot,
    group: NonMekDamageGroup,
    outcome: NonMekDamageGroupOutcome,
): readonly Readonly<{ locationId: LocationId; modifier: number; reason: string }>[] {
    const checks: { locationId: LocationId; modifier: number; reason: string }[] = [];
    // TW Support Vehicles: a hit exceeding the BAR may penetrate even with armor left; it is rolled first.
    const struck = snapshot.index.locations.get(group.locationId);
    const entity = snapshot.entity;
    if (struck && entity.isSupportVehicle()) {
        const bar = supportVehicleBarRating(entity, struck.code);
        const armoredChassis = [...snapshot.index.components.values()]
            .some(component => component.mount.equipment?.hasFlag('F_ARMORED_CHASSIS') === true);
        if (bar >= 0 && group.damage > bar && !(armoredChassis && bar >= 10)) {
            checks.push({ locationId: struck.id, modifier: armoredChassis ? -1 : 0, reason: 'penetrating' });
        }
    }
    if (group.effects.includes('critical')) checks.push({ locationId: group.locationId, modifier: 0, reason: 'hit location' });
    for (const locationId of outcome.structureDamaged) checks.push({ locationId, modifier: 0, reason: 'internal structure' });
    return checks;
}

function vehicleCriticalFacts(
    snapshot: CBTNonMekUnitSnapshot,
    location: CBTRuntimeLocation,
    perspective: RuntimeStatePerspective,
): VehicleCriticalFacts {
    const vtol = snapshot.entity.unitType() === 'VTOL';
    const hit = (system: SystemDamageKind, stage?: number, scope?: string) =>
        trackHits(snapshot, systemDamageId(system, stage, scope), perspective) > 0;
    let sensorHits = 0;
    while (sensorHits < 4 && hit('sensors', sensorHits + 1)) sensorHits++;
    return Object.freeze({
        vtol,
        crewAlive: snapshot.crewAssignment.positions.some(({ positionId }) =>
            !snapshot.query.crewState(positionId).isDeathCommitted()),
        driverHit: hit(vtol ? 'pilot' : 'driver'),
        commanderHit: hit(vtol ? 'copilot' : 'commander'),
        weaponStatuses: Object.freeze(locationWeapons(snapshot, location, perspective).map(weapon => weapon.status)),
        stabilizerHit: hit('stabilizer', undefined, location.code),
        sensorHits,
        engineHit: hit('engine', 1),
        fusionEngine: snapshot.entity.mountedEngine().isFusion,
        hasAmmo: ammunition(snapshot, perspective).length > 0,
        turretLocked: hit('turret-lock', undefined, location.code),
        flightStabilizerHit: hit('flight-stabilizer'),
    });
}

function locationWeapons(snapshot: CBTNonMekUnitSnapshot, location: CBTRuntimeLocation, perspective: RuntimeStatePerspective) {
    return [...snapshot.index.components.values()].flatMap(component => {
        const equipment = component.mount.equipment;
        if (!(equipment instanceof WeaponEquipment) || !component.mount.getOccupiedLocations().includes(location.code)) return [];
        return [Object.freeze({
            componentId: component.id as ComponentId,
            name: equipment.name,
            status: snapshot.query.componentStatus(component.id, perspective),
            bv: typeof equipment.bv === 'number' ? equipment.bv : 0,
            explosionDamage: Math.max(0, equipment.weapon.explosionDamage),
        })];
    });
}

/** Every bin with shots left, and the damage it adds to a vehicle ammunition explosion. */
function ammunition(snapshot: CBTNonMekUnitSnapshot, perspective: RuntimeStatePerspective) {
    return [...snapshot.index.components.values()].flatMap(component => {
        if (!(component.mount.equipment instanceof AmmoEquipment)
            || snapshot.query.componentStatus(component.id, perspective) !== 'available') return [];
        const shots = snapshot.query.remainingAmmo(component.id);
        const ammo = snapshot.query.ammoEquipment(component.id);
        if (shots <= 0) return [];
        const damage = ammo?.isExplosive() ? shots * ammoRackSize(ammo) * ammoExplosionDamagePerShot(ammo) : 0;
        return [Object.freeze({ componentId: component.id as ComponentId, damage })];
    });
}

function trackHits(snapshot: CBTNonMekUnitSnapshot, trackId: ReturnType<typeof systemDamageId>, perspective: RuntimeStatePerspective): number {
    const committed = snapshot.state.damageTracks.get(trackId)?.hits ?? 0;
    return perspective === 'preview'
        ? committed + (snapshot.state.pendingCombat.damageTrackHits.get(trackId)?.hitDelta ?? 0)
        : committed;
}

function perspectiveOf(target: Target): RuntimeStatePerspective {
    return target === 'pending' ? 'preview' : 'committed';
}

async function dispatchAll(dispatch: CBTForceUnitCommandDispatch, commands: readonly CBTUnitCommand[]): Promise<boolean> {
    for (const command of commands) {
        if (!(await dispatch(command, false)).accepted) return false;
    }
    return true;
}
