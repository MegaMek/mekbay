// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { combineEquipmentStatuses, type EquipmentStatus } from '../equipment-status.model';
import { ImmutableIndex, ImmutableSet } from '../entity/immutable-collections';
import type { ComponentId } from '../entity/entity-identifiers';
import type { VehicleEntity } from '../entity/entities/vehicle/vehicle-entity';
import { STANDARD_MOVEMENT_CALCULATION } from '../entity/types';
import { WeaponEquipment } from '../equipment.model';
import { isMascEquipment } from '../escalating-equipment.model';
import { isDroneOperatingSystemEquipment } from '../drone-operating-system.model';
import { isRamPlateEquipment } from '../physical-augmentation.model';
import type { ToHitModifierBreakdownEntry } from './game-rules';
import type { NonMekRuntimeIndex } from '../runtime/non-mek-runtime-index';
import { projectNonMekComponentStatuses } from '../runtime/non-mek-component-status';
import type {
    NonMekUnitRuntimeState,
} from '../runtime/non-mek-unit-instance';
import type { CrewMemberState } from '../crew.model';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type { UnitConditionKey } from '../unit-condition.model';
import { getDefaultAttackerMovementModifier } from '../target-number-calculator.model';
import {
    calculateChargeDamage,
    type ChargeDamageProjection,
} from './charge-damage';
import { isCrewDeathCommitted } from '../runtime/cbt-unit-runtime';

export interface VehicleMotiveHit {
    readonly level: number;
    readonly timestamp: number;
}

export interface VehicleRuntimeSystems {
    readonly crewKilled: boolean;
    readonly crewStunned: boolean;
    readonly commanderHit: boolean;
    readonly copilotHit: boolean;
    readonly driverOrPilotHit: boolean;
    readonly engineHit: boolean;
    readonly hasDroneOperatingSystem: boolean;
    readonly hasWorkingSupercharger: boolean;
    readonly sensorHits: number;
    readonly rotorHits: number;
    readonly flightStabilizerHit: boolean;
    readonly motiveHits: readonly VehicleMotiveHit[];
    readonly stabilizerLocations: ReadonlySet<string>;
}

export interface VehicleRuntimeMovement {
    readonly moveImpaired: boolean;
    readonly walk: number;
    readonly maxWalk: number;
    readonly run: number;
    readonly maxRun: number;
}

export interface VehicleRuntimeRuleModifiers {
    readonly ranged: readonly ToHitModifierBreakdownEntry[];
    readonly physical: readonly ToHitModifierBreakdownEntry[];
    readonly psr: readonly ToHitModifierBreakdownEntry[];
}

/**
 * Effective vehicle rules derived from one VehicleEntity and one sparse runtime snapshot.
 * Pending damage is projected only into preview component status; it never applies effects early.
 */
export interface VehicleRuntimeRulesProjection {
    readonly destroyed: boolean;
    readonly computedConditions: readonly UnitConditionKey[];
    readonly conditionControlKeys: readonly UnitConditionKey[];
    readonly crewStateControlKeys: readonly CrewMemberState[];
    readonly crewStateDisplayKeys: readonly CrewMemberState[];
    readonly systems: VehicleRuntimeSystems;
    readonly movement: VehicleRuntimeMovement;
    readonly attackMovementModifier: number;
    readonly chargeDamage: ChargeDamageProjection;
    readonly modifiers: VehicleRuntimeRuleModifiers;
    readonly componentStatuses: ReadonlyMap<ComponentId, EquipmentStatus>;
    readonly previewComponentStatuses: ReadonlyMap<ComponentId, EquipmentStatus>;
    readonly fireBlockedComponentIds: ReadonlySet<ComponentId>;
    readonly stabilizerAffectedComponentIds: ReadonlySet<ComponentId>;
}

const STABILIZER_HIT_LOCATIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    stabilizer_hit_front: Object.freeze(['FR', 'FRRS', 'FRLS']),
    stabilizer_hit_rear: Object.freeze(['RR', 'RRRS', 'RRLS']),
    stabilizer_hit_turret: Object.freeze(['TU']),
    stabilizer_hit_left: Object.freeze(['LS', 'FRLS', 'RRLS']),
    stabilizer_hit_right: Object.freeze(['RS', 'FRRS', 'RRRS']),
    stabilizer_hit_turret_f: Object.freeze(['FT']),
    stabilizer_hit_turret_r: Object.freeze(['TU']),
});

export function projectVehicleRuntimeRules(
    entity: VehicleEntity,
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
    ruleset: CBTRuleset,
): VehicleRuntimeRulesProjection {
    const activeDamageTracks = [...index.damageTracks.values()]
        .filter(track => (state.damageTracks.get(track.id)?.hits ?? 0) > 0);
    const activeDamageTrackIds = new Set(activeDamageTracks.map(track => track.sheetId));
    const hasDamage = (sheetId: string): boolean => activeDamageTrackIds.has(sheetId);
    const rawCommanderHit = hasDamage('commander_hit');
    const crewKilled = [...index.crewPositions.keys()].some(positionId => {
        const crew = state.crew.get(positionId);
        return crew?.killed === true || (crew !== undefined && isCrewDeathCommitted(crew));
    });
    const crewStunned = [...index.crewPositions.keys()].some(positionId =>
        state.crew.get(positionId)?.stunned === true);
    const motiveHits = Object.freeze(activeDamageTracks.flatMap(track => {
        if (track.motiveLevel === undefined) return [];
        return (state.damageTracks.get(track.id)?.hitTimestamps ?? [])
            .map(timestamp => Object.freeze({ level: track.motiveLevel!, timestamp }));
    }).sort((left, right) => left.timestamp - right.timestamp));
    const sensorHits = activeDamageTracks.reduce((highest, track) => {
        const match = /^sensor_hit_(\d+)$/u.exec(track.sheetId);
        return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);
    const engineHit = activeDamageTracks.some(track => /^engine_hit_\d+$/u.test(track.sheetId));
    const rotor = [...index.damageTracks.values()].find(track => track.sheetId === 'rotor');
    const rotorHits = entity.unitType() === 'VTOL' && rotor !== undefined
        ? state.damageTracks.get(rotor.id)?.hits ?? 0
        : 0;
    const stabilizerLocations = new Set<string>();
    for (const track of activeDamageTracks) {
        STABILIZER_HIT_LOCATIONS[track.sheetId]?.forEach(location => stabilizerLocations.add(location));
    }

    const entityStatuses = projectNonMekComponentStatuses(index, state);
    const baseStatuses = componentStatuses(entityStatuses, index, 'committed', engineHit);
    const previewEngineHit = [...index.damageTracks.values()].some(track =>
        /^engine_hit_\d+$/u.test(track.sheetId)
        && (state.damageTracks.get(track.id)?.hits ?? 0)
            + (state.pendingCombat.damageTrackHits.get(track.id)?.hitDelta ?? 0) > 0);
    const previewStatuses = componentStatuses(entityStatuses, index, 'preview', previewEngineHit);
    const droneComponents = [...index.components.values()].filter(component =>
        isDroneOperatingSystemEquipment(component.mount.equipment));
    const hasDroneOperatingSystem = droneComponents.length > 0;
    const disconnected = hasDroneOperatingSystem && (rawCommanderHit
        || droneComponents.some(component => baseStatuses.get(component.id) !== 'available'));
    const hasWorkingSupercharger = [...index.components.values()].some(component =>
        isMascEquipment(component.mount.equipment)
        && baseStatuses.get(component.id) === 'available');
    const systems: VehicleRuntimeSystems = Object.freeze({
        crewKilled,
        crewStunned,
        commanderHit: !hasDroneOperatingSystem && rawCommanderHit,
        copilotHit: !hasDroneOperatingSystem && hasDamage('copilot_hit'),
        driverOrPilotHit: !hasDroneOperatingSystem
            && (hasDamage('driver_hit') || hasDamage('pilot_hit')),
        engineHit,
        hasDroneOperatingSystem,
        hasWorkingSupercharger,
        sensorHits,
        rotorHits,
        flightStabilizerHit: hasDamage('flight_stabilizer_hit'),
        motiveHits,
        stabilizerLocations: new ImmutableSet(stabilizerLocations),
    });
    const motiveImmobile = motiveHits.some(hit => hit.level === 4);
    const storedImmobile = state.conditions.has('immobile');
    const computedConditions = new Set<UnitConditionKey>();
    if (crewKilled && !hasDroneOperatingSystem) computedConditions.add('abandoned');
    if (disconnected) computedConditions.add('disconnected');
    if (crewKilled || motiveImmobile || disconnected) computedConditions.add('immobile');
    const destroyed = state.explicitlyDestroyed || [...index.locations.values()].some(location =>
        location.internalPoints > 0
        && (state.locations.get(location.id)?.internalDamage ?? 0) >= location.internalPoints);
    const movement = vehicleMovement(
        entity,
        systems,
        destroyed || storedImmobile || computedConditions.has('immobile')
            || state.conditions.has('disconnected'),
    );
    const fireBlockedComponentIds = new Set<ComponentId>();
    const stabilizerAffectedComponentIds = new Set<ComponentId>();
    for (const component of index.components.values()) {
        const equipment = component.mount.equipment;
        if (sensorHits >= 4 && equipment instanceof WeaponEquipment
            && !component.mount.isPhysicalWeapon()) fireBlockedComponentIds.add(component.id);
        if (component.mount.getOccupiedLocations().some(location =>
            stabilizerLocations.has(entity.componentLocationLabel(location)))) {
            stabilizerAffectedComponentIds.add(component.id);
        }
    }
    const conditionControlKeys: UnitConditionKey[] = ['swarmed', 'tagged', 'ecm-shielded'];
    if (ruleset === 'total-warfare') conditionControlKeys.push('skidding');
    conditionControlKeys.push('jammed');
    if (hasDroneOperatingSystem) conditionControlKeys.push('disconnected');
    const movementMode = state.turn.movement?.mode ?? null;
    const ramPlates = [...index.components.values()].filter(component =>
        isRamPlateEquipment(component.mount.equipment));
    const chargeDamage = calculateChargeDamage({
        ruleset,
        massTons: entity.tonnage(),
        movementMode,
        movementDistance: state.turn.movement?.distance ?? 0,
        maximumDistance: entity.maxRunMP(),
        hasRamPlate: ramPlates.length > 0,
        hasWorkingRamPlate: ramPlates.some(component =>
            baseStatuses.get(component.id) === 'available'),
    });

    const crewStateControlKeys = Object.freeze(hasDroneOperatingSystem
        ? []
        : ['killed', 'stunned'] as const);
    return Object.freeze({
        destroyed,
        computedConditions: Object.freeze([...computedConditions]),
        conditionControlKeys: Object.freeze(conditionControlKeys),
        crewStateControlKeys,
        crewStateDisplayKeys: crewStateControlKeys,
        systems,
        movement,
        attackMovementModifier: getDefaultAttackerMovementModifier(movementMode),
        chargeDamage,
        modifiers: vehicleModifiers(entity, systems),
        componentStatuses: new ImmutableIndex(baseStatuses),
        previewComponentStatuses: new ImmutableIndex(previewStatuses),
        fireBlockedComponentIds: new ImmutableSet(fireBlockedComponentIds),
        stabilizerAffectedComponentIds: new ImmutableSet(stabilizerAffectedComponentIds),
    });
}

function componentStatuses(
    base: ReturnType<typeof projectNonMekComponentStatuses>,
    index: NonMekRuntimeIndex,
    perspective: 'committed' | 'preview',
    engineHit: boolean,
): Map<ComponentId, EquipmentStatus> {
    const result = new Map<ComponentId, EquipmentStatus>();
    for (const component of index.components.values()) {
        const engineStatus: EquipmentStatus = engineHit
            && component.mount.equipment?.hasFlag('F_ENERGY') === true
            ? 'disabled'
            : 'available';
        result.set(component.id, combineEquipmentStatuses([
            (perspective === 'preview' ? base.preview : base.committed).get(component.id)
                ?? 'available',
            engineStatus,
        ]));
    }
    return result;
}

function vehicleMovement(
    entity: VehicleEntity,
    systems: VehicleRuntimeSystems,
    immobile: boolean,
): VehicleRuntimeMovement {
    const baseWalk = Math.max(0, entity.computeWalkMP(STANDARD_MOVEMENT_CALCULATION));
    const baseRun = baseWalk === 0 ? 0 : Math.round(baseWalk * 1.5);
    if (immobile) {
        return Object.freeze({ moveImpaired: true, walk: 0, maxWalk: 0, run: 0, maxRun: 0 });
    }
    let walk = systems.engineHit ? 0 : applyMotiveDamage(baseWalk, systems.motiveHits);
    if (entity.unitType() === 'VTOL') walk = Math.max(0, walk - systems.rotorHits);
    let run = walk === 0 ? 0 : Math.round(walk * 1.5);
    let maxRun = walk === 0 ? 0 : Math.round(walk * (systems.hasWorkingSupercharger ? 2 : 1.5));
    if (systems.flightStabilizerHit || systems.crewStunned) {
        run = 0;
        maxRun = 0;
    }
    return Object.freeze({
        moveImpaired: walk !== baseWalk || run !== baseRun,
        walk,
        maxWalk: walk,
        run,
        maxRun,
    });
}

function applyMotiveDamage(base: number, hits: readonly VehicleMotiveHit[]): number {
    let current = base;
    for (const hit of hits) {
        if (current <= 0) return 0;
        if (hit.level === 2) current = Math.max(0, current - 1);
        else if (hit.level === 3) current = Math.ceil(current / 2);
        else if (hit.level === 4) current = 0;
    }
    return current;
}

function vehicleModifiers(
    entity: VehicleEntity,
    systems: VehicleRuntimeSystems,
): VehicleRuntimeRuleModifiers {
    const ranged: ToHitModifierBreakdownEntry[] = [];
    const physical: ToHitModifierBreakdownEntry[] = [];
    const psr: ToHitModifierBreakdownEntry[] = [];
    if (entity.uniformArmor()?.armor.name === 'Hardened') psr.push(weakened('Mounts Hardened Armor', 1));
    if (systems.commanderHit) {
        ranged.push(weakened('Commander hit', 1));
        physical.push(weakened('Commander hit', 1));
        psr.push(weakened('Commander hit', 1));
    }
    if (systems.copilotHit) ranged.push(weakened('Co-pilot hit', 1));
    if (systems.driverOrPilotHit) psr.push(weakened('Driver/Pilot hit', 2));
    if (systems.flightStabilizerHit) {
        ranged.push(weakened('Flight stabilizer hit', 1));
        psr.push(weakened('Flight stabilizer hit', 3));
    }
    if (systems.sensorHits > 0) ranged.push(weakened('Sensor hits', systems.sensorHits));
    const motiveLevels = new Set<number>();
    for (const hit of systems.motiveHits) {
        if (hit.level < 1 || hit.level > 3 || motiveLevels.has(hit.level)) continue;
        motiveLevels.add(hit.level);
        psr.push(weakened('Motive system hit', hit.level));
    }
    return Object.freeze({
        ranged: Object.freeze(ranged),
        physical: Object.freeze(physical),
        psr: Object.freeze(psr),
    });
}

function weakened(label: string, modifier: number): ToHitModifierBreakdownEntry {
    return Object.freeze({ label, modifier, weakened: true });
}
