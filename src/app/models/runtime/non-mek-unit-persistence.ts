// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    sanitizeSavedEntityIdentity,
    type SavedEntityIdentity,
} from '../persisted-unit-state';
import type { EntityType } from '../entity/types';
import { isNativeEntityType } from '../entity/codec-capabilities';
import {
    asArmorFaceId,
    asComponentId,
    asSystemDamageTrackId,
    asCrewPositionId,
    asLocationId,
    type ArmorFaceId,
    type ComponentId,
    type SystemDamageTrackId,
    type CrewPositionId,
    type LocationId,
} from '../entity/entity-identifiers';
import type { EquipmentStatus } from '../equipment-status.model';
import { requireUnitConditionKey, type UnitConditionKey } from '../unit-condition.model';
import {
    deserializeUnitCover,
    serializeUnitCover,
    type SerializedUnitCover,
} from '../unit-cover.model';
import type { CrewAssignment } from './crew-assignment';
import { assertCanonicalCrewAssignment } from './crew-assignment';
import type { BaseEntity } from '../entity/base-entity';
import { isCBTRuleset } from '../cbt-ruleset.model';
import type {
    ComponentRuntimeState,
    InstanceBaselineRef,
    StateRevision,
    UnitInstanceId,
} from './runtime-state';
import { asStateRevision, asUnitInstanceId } from './runtime-state';
import {
    NON_MEK_UNIT_RUNTIME_SCHEMA_VERSION,
    NonMekUnitInstance,
    freezeNonMekUnitState,
    nonMekComponentStateModes,
    type NonMekCrewState,
    type NonMekMovementDeclaration,
    type NonMekUnitRuntimeState,
    type NonMekEntityType,
} from './non-mek-unit-instance';
import { buildNonMekRuntimeIndex } from './non-mek-runtime-index';
import {
    deserializeAttackerTargetingState,
    serializeAttackerTargetingState,
    type SerializedAttackerTargetingState,
} from './attacker-targeting-state';
import {
    freezeEquipmentRowOrder,
    type EquipmentRowOrderState,
} from './equipment-row-order';

export const NON_MEK_UNIT_PERSISTENCE_SCHEMA_VERSION = 6 as const;
export const NON_MEK_DEPLOYMENT_SCHEMA_VERSION = 1 as const;

export interface NonMekDeploymentConfiguration {
    readonly id: string;
    readonly crewAssignment: CrewAssignment;
}

export interface SerializedNonMekDeployment {
    readonly schemaVersion: typeof NON_MEK_DEPLOYMENT_SCHEMA_VERSION;
    readonly values: NonMekDeploymentConfiguration;
}

export interface SerializedNonMekUnitRestoration {
    readonly warnings: readonly string[];
    readonly unresolved: readonly string[];
}

export interface SerializedNonMekUnit {
    readonly schemaVersion: typeof NON_MEK_UNIT_PERSISTENCE_SCHEMA_VERSION;
    readonly instanceId: UnitInstanceId;
    readonly entity: SavedEntityIdentity;
    readonly baselineRefAtSave: InstanceBaselineRef;
    readonly deployment: SerializedNonMekDeployment;
    readonly family: Readonly<{ readonly kind: 'non-mek'; readonly entityType: NonMekEntityType }>;
    readonly stateRevision: StateRevision;
    readonly destroyed?: true;
    readonly locationState?: readonly Readonly<{
        readonly locationId: LocationId;
        readonly internalDamage?: number;
        readonly armorDamage?: readonly Readonly<{
            readonly faceId: ArmorFaceId;
            readonly damage: number;
        }>[];
    }>[];
    readonly componentState?: readonly Readonly<{
        readonly componentId: ComponentId;
        readonly status?: Exclude<EquipmentStatus, 'available'>;
        readonly mode?: string;
        readonly jammed?: true;
        readonly escalatingFailure?: ComponentRuntimeState['escalatingFailure'];
    }>[];
    readonly damageTrackState?: readonly Readonly<{
        readonly damageTrackId: SystemDamageTrackId;
        readonly hits: number;
        readonly hitTimestamps: readonly number[];
    }>[];
    readonly ammoState?: readonly Readonly<{
        readonly componentId: ComponentId;
        readonly shotsSpent: number;
        readonly munitionOverride?: string;
    }>[];
    readonly crewState?: readonly Readonly<{
        readonly positionId: CrewPositionId;
        readonly wounds: number;
        readonly unconscious: boolean;
        readonly ejected: boolean;
        readonly state?: NonMekCrewState;
    }>[];
    readonly conditions?: readonly UnitConditionKey[];
    readonly heat?: Readonly<{
        readonly current: number;
        readonly previous: number;
        readonly pendingOverride?: number;
        readonly heatsinksOff: number;
    }>;
    readonly turn?: Readonly<{
        readonly turnCounter?: number;
        readonly airborne?: boolean;
        readonly movement?: NonMekMovementDeclaration;
        readonly weaponsHeat?: number;
        readonly cover?: SerializedUnitCover;
        readonly spotting?: true;
    }>;
    readonly attackerTargeting: SerializedAttackerTargetingState;
    readonly equipmentRowOrder?: EquipmentRowOrderState;
    readonly pendingCombat?: Readonly<{
        readonly internalDamage?: readonly Readonly<{
            readonly locationId: LocationId;
            readonly damage: number;
        }>[];
        readonly armorDamage?: readonly Readonly<{
            readonly faceId: ArmorFaceId;
            readonly damage: number;
        }>[];
        readonly componentStatus?: readonly Readonly<{
            readonly componentId: ComponentId;
            readonly status: EquipmentStatus;
        }>[];
        readonly damageTrackHits?: readonly Readonly<{
            readonly damageTrackId: SystemDamageTrackId;
            readonly hitDelta: number;
            readonly hitTimestamps: readonly number[];
        }>[];
    }>;
    readonly restoration?: SerializedNonMekUnitRestoration;
}

export interface SerializeNonMekUnitInput {
    readonly instance: NonMekUnitInstance;
    readonly sourceRef: SavedEntityIdentity;
    readonly deployment: SerializedNonMekDeployment;
    readonly restoration?: SerializedNonMekUnitRestoration;
}

export interface SerializedNonMekUnitInspection {
    readonly instanceId: UnitInstanceId;
    readonly stateRevision: StateRevision;
}

/** Small wire guard used before a current force installs a non-Mek runtime. */
export function inspectSerializedNonMekUnit(value: unknown): SerializedNonMekUnitInspection {
    const record = requireRecord(value, 'non-Mek unit');
    if (record['schemaVersion'] !== NON_MEK_UNIT_PERSISTENCE_SCHEMA_VERSION) {
        throw new Error(`Unsupported non-Mek unit schema ${String(record['schemaVersion'])}`);
    }
    const instanceId = asUnitInstanceId(requireString(record['instanceId'], 'instanceId'));
    const stateRevision = asStateRevision(requireInteger(record['stateRevision'], 'stateRevision'));
    const entity = sanitizeSavedEntityIdentity(record['entity']);
    if (!entity) throw new Error('Non-Mek unit requires a saved entity identity');
    const baseline = requireRecord(record['baselineRefAtSave'], 'baselineRefAtSave');
    const baselineEntity = sanitizeSavedEntityIdentity(baseline['entity']);
    if (!baselineEntity || baselineEntity.provider !== entity.provider || baselineEntity.uuid !== entity.uuid) {
        throw new Error('Non-Mek unit baseline identity does not match its source');
    }
    if (!isCBTRuleset(baseline['ruleset'])) throw new Error('Non-Mek unit baseline ruleset is invalid');
    const family = requireRecord(record['family'], 'family');
    if (family['kind'] !== 'non-mek' || !isNativeEntityType(family['entityType'])
        || family['entityType'] === 'Mek') {
        throw new Error('Non-Mek unit family is invalid');
    }
    deserializeAttackerTargetingState(record['attackerTargeting']);
    if (record['equipmentRowOrder'] !== undefined) {
        freezeEquipmentRowOrder(
            requireRecord(record['equipmentRowOrder'], 'equipmentRowOrder') as EquipmentRowOrderState,
        );
    }
    validateSerializedNonMekTurn(record['turn']);
    return Object.freeze({ instanceId, stateRevision });
}

export function serializeNonMekUnit(input: SerializeNonMekUnitInput): SerializedNonMekUnit {
    const entity = input.instance.getUnit();
    const state = input.instance.snapshot();
    const index = input.instance.getIndex();
    if (input.sourceRef.uuid !== entity.uuid()
        || input.instance.baselineRef.entity.uuid !== entity.uuid()) {
        throw new Error('Non-Mek runtime identity changed before serialization');
    }
    assertCanonicalCrewAssignment(
        index.crewPositions,
        input.deployment.values.crewAssignment,
    );

    const locationState = [...state.locations]
        .sort(([left], [right]) => compareText(left, right))
        .map(([locationId, location]) => Object.freeze({
            locationId,
            ...(location.internalDamage === 0 ? {} : { internalDamage: location.internalDamage }),
            ...(location.armorDamage.length === 0
                ? {}
                : { armorDamage: Object.freeze([...location.armorDamage]
                    .sort((left, right) => compareText(left.faceId, right.faceId))
                    .map(entry => Object.freeze({ ...entry }))) }),
        }));
    const componentState = [...state.components]
        .sort(([left], [right]) => compareText(left, right))
        .flatMap(([componentId, component]) => {
            const status = component.statusOverride;
            if (status === undefined && component.mode === undefined && component.jammed !== true
                && component.escalatingFailure === undefined) return [];
            return [Object.freeze({
                componentId,
                ...(status === undefined ? {} : { status }),
                ...(component.mode === undefined ? {} : { mode: component.mode }),
                ...(component.jammed === true ? { jammed: true as const } : {}),
                ...(component.escalatingFailure === undefined
                    ? {}
                    : { escalatingFailure: Object.freeze({ ...component.escalatingFailure }) }),
            })];
        });
    const ammoState = [...state.ammo]
        .sort(([left], [right]) => compareText(left, right))
        .map(([componentId, ammo]) => Object.freeze({ componentId, ...ammo }));
    const damageTrackState = [...state.damageTracks]
        .sort(([left], [right]) => compareText(left, right))
        .map(([damageTrackId, damageTrack]) => Object.freeze({
            damageTrackId,
            hits: damageTrack.hits,
            hitTimestamps: Object.freeze([...damageTrack.hitTimestamps]),
        }));
    const crewState = [...state.crew]
        .sort(([left], [right]) => compareText(left, right))
        .map(([positionId, crew]) => Object.freeze({ positionId, ...crew }));
    const conditions = [...state.conditions].sort(compareText);
    const turn = serializeNonMekTurn(state);
    const pendingCombat = serializePendingCombat(state);
    const equipmentRowOrder = freezeEquipmentRowOrder(state.equipmentRowOrder);

    return Object.freeze({
        schemaVersion: NON_MEK_UNIT_PERSISTENCE_SCHEMA_VERSION,
        instanceId: input.instance.id,
        entity: Object.freeze({ ...input.sourceRef }),
        baselineRefAtSave: freezeBaseline(input.instance.baselineRef),
        deployment: freezeDeployment(input.deployment),
        family: Object.freeze({ kind: 'non-mek', entityType: state.family.entityType }),
        stateRevision: state.stateRevision,
        ...(state.explicitlyDestroyed ? { destroyed: true as const } : {}),
        ...(locationState.length === 0 ? {} : { locationState: Object.freeze(locationState) }),
        ...(componentState.length === 0 ? {} : { componentState: Object.freeze(componentState) }),
        ...(damageTrackState.length === 0 ? {} : { damageTrackState: Object.freeze(damageTrackState) }),
        ...(ammoState.length === 0 ? {} : { ammoState: Object.freeze(ammoState) }),
        ...(crewState.length === 0 ? {} : { crewState: Object.freeze(crewState) }),
        ...(conditions.length === 0 ? {} : { conditions: Object.freeze(conditions) }),
        ...(isPristineHeat(state.heat) ? {} : { heat: Object.freeze({ ...state.heat }) }),
        ...(turn === undefined ? {} : { turn }),
        attackerTargeting: serializeAttackerTargetingState(state.attackerTargeting),
        ...(equipmentRowOrder === undefined ? {} : { equipmentRowOrder }),
        ...(pendingCombat === undefined ? {} : { pendingCombat }),
        ...(input.restoration === undefined
            ? {}
            : { restoration: canonicalizeNonMekUnitRestoration(input.restoration) }),
    });
}

export function restoreNonMekUnit(
    saved: SerializedNonMekUnit,
    entity: BaseEntity,
): NonMekUnitInstance {
    if (saved.schemaVersion !== NON_MEK_UNIT_PERSISTENCE_SCHEMA_VERSION) {
        throw new Error(`Unsupported non-Mek unit schema ${String(saved.schemaVersion)}`);
    }
    if (entity.entityType === 'Mek' || saved.family.kind !== 'non-mek'
        || saved.family.entityType !== entity.entityType) {
        throw new Error('Persisted runtime family does not match the entity');
    }
    if (saved.entity.uuid !== entity.uuid()
        || saved.baselineRefAtSave.entity.uuid !== entity.uuid()) {
        throw new Error('Persisted runtime identity does not match the entity');
    }
    const ruleset = saved.baselineRefAtSave.ruleset;
    if (ruleset === undefined) throw new Error('Persisted runtime has no ruleset');
    const index = buildNonMekRuntimeIndex(entity);
    assertCanonicalCrewAssignment(index.crewPositions, saved.deployment.values.crewAssignment);

    const locations = new Map<LocationId, NonMekUnitRuntimeState['locations'] extends ReadonlyMap<LocationId, infer T> ? T : never>();
    for (const entry of saved.locationState ?? []) {
        const locationId = asLocationId(entry.locationId);
        if (locations.has(locationId)) throw new Error(`Duplicate persisted location ${locationId}`);
        locations.set(locationId, Object.freeze({
            internalDamage: entry.internalDamage ?? 0,
            armorDamage: Object.freeze((entry.armorDamage ?? []).map(armor => Object.freeze({
                faceId: asArmorFaceId(armor.faceId),
                damage: armor.damage,
            }))),
        }));
    }
    const components = new Map<ComponentId, NonMekUnitRuntimeState['components'] extends ReadonlyMap<ComponentId, infer T> ? T : never>();
    const seenComponents = new Set<ComponentId>();
    for (const entry of saved.componentState ?? []) {
        const componentId = asComponentId(entry.componentId);
        if (seenComponents.has(componentId)) throw new Error(`Duplicate persisted component ${componentId}`);
        seenComponents.add(componentId);
        const component = index.components.get(componentId);
        const modes = component === undefined
            ? null
            : nonMekComponentStateModes(entity, component.mount.equipment, ruleset);
        const mode = entry.mode !== undefined
            && modes?.modes.includes(entry.mode) === true
            && entry.mode !== modes.defaultMode
            ? entry.mode
            : undefined;
        const restored: ComponentRuntimeState = Object.freeze({
            ...(entry.status === undefined ? {} : { statusOverride: entry.status }),
            ...(mode === undefined ? {} : { mode }),
            ...(entry.jammed === true ? { jammed: true } : {}),
            ...(entry.escalatingFailure === undefined
                ? {}
                : { escalatingFailure: Object.freeze({ ...entry.escalatingFailure }) }),
        });
        if (Object.keys(restored).length > 0) components.set(componentId, restored);
    }
    const damageTracks = new Map<SystemDamageTrackId, NonMekUnitRuntimeState['damageTracks'] extends ReadonlyMap<SystemDamageTrackId, infer T> ? T : never>();
    for (const entry of saved.damageTrackState ?? []) {
        const damageTrackId = asSystemDamageTrackId(entry.damageTrackId);
        if (damageTracks.has(damageTrackId)) throw new Error(`Duplicate persisted damage track ${damageTrackId}`);
        damageTracks.set(damageTrackId, Object.freeze({
            hits: entry.hits,
            hitTimestamps: Object.freeze([...entry.hitTimestamps]),
        }));
    }
    const ammo = new Map<ComponentId, NonMekUnitRuntimeState['ammo'] extends ReadonlyMap<ComponentId, infer T> ? T : never>();
    for (const entry of saved.ammoState ?? []) {
        const componentId = asComponentId(entry.componentId);
        if (ammo.has(componentId)) throw new Error(`Duplicate persisted ammunition ${componentId}`);
        ammo.set(componentId, Object.freeze({
            shotsSpent: entry.shotsSpent,
            ...(entry.munitionOverride === undefined ? {} : { munitionOverride: entry.munitionOverride }),
        }));
    }
    const crew = new Map<CrewPositionId, NonMekUnitRuntimeState['crew'] extends ReadonlyMap<CrewPositionId, infer T> ? T : never>();
    for (const entry of saved.crewState ?? []) {
        const positionId = asCrewPositionId(entry.positionId);
        if (crew.has(positionId)) throw new Error(`Duplicate persisted crew position ${positionId}`);
        crew.set(positionId, Object.freeze({
            wounds: entry.wounds,
            unconscious: entry.unconscious,
            ejected: entry.ejected,
            ...(entry.state === undefined ? {} : { state: entry.state }),
        }));
    }
    const conditions = new Set((saved.conditions ?? []).map(requireUnitConditionKey));
    if (conditions.size !== (saved.conditions?.length ?? 0)) throw new Error('Duplicate persisted condition');
    const equipmentRowOrder = freezeEquipmentRowOrder(saved.equipmentRowOrder);
    const state = freezeNonMekUnitState({
        schemaVersion: NON_MEK_UNIT_RUNTIME_SCHEMA_VERSION,
        stateRevision: asStateRevision(saved.stateRevision),
        family: Object.freeze({ kind: 'non-mek', entityType: saved.family.entityType }),
        explicitlyDestroyed: saved.destroyed === true,
        locations,
        components,
        damageTracks,
        ammo,
        crew,
        conditions,
        heat: Object.freeze({
            current: saved.heat?.current ?? 0,
            previous: saved.heat?.previous ?? 0,
            ...(saved.heat?.pendingOverride === undefined
                ? {}
                : { pendingOverride: saved.heat.pendingOverride }),
            heatsinksOff: saved.heat?.heatsinksOff ?? 0,
        }),
        turn: restoreNonMekTurn(saved),
        attackerTargeting: deserializeAttackerTargetingState(saved.attackerTargeting),
        ...(equipmentRowOrder === undefined ? {} : { equipmentRowOrder }),
        pendingCombat: restorePendingCombat(saved),
    });
    return new NonMekUnitInstance(
        asUnitInstanceId(saved.instanceId),
        freezeBaseline(saved.baselineRefAtSave),
        entity,
        ruleset,
        state,
    );
}

function serializeNonMekTurn(state: NonMekUnitRuntimeState): SerializedNonMekUnit['turn'] {
    const turn = state.turn;
    if (turn.turnCounter === 0 && turn.airborne === null && turn.movement === null
        && turn.weaponsHeat === 0 && turn.cover === null && !turn.spotting) return undefined;
    return Object.freeze({
        ...(turn.turnCounter === 0 ? {} : { turnCounter: turn.turnCounter }),
        ...(turn.airborne === null ? {} : { airborne: turn.airborne }),
        ...(turn.weaponsHeat === 0 ? {} : { weaponsHeat: turn.weaponsHeat }),
        ...(turn.cover === null ? {} : { cover: serializeUnitCover(turn.cover) }),
        ...(turn.spotting ? { spotting: true as const } : {}),
        ...(turn.movement === null
            ? {}
            : {
                movement: Object.freeze({
                    ...turn.movement,
                    boosterComponentIds: Object.freeze([...turn.movement.boosterComponentIds]),
                }),
            }),
    });
}

function isPristineHeat(state: NonMekUnitRuntimeState['heat']): boolean {
    return state.current === 0
        && state.previous === 0
        && state.pendingOverride === undefined
        && state.heatsinksOff === 0;
}

function restoreNonMekTurn(saved: SerializedNonMekUnit): NonMekUnitRuntimeState['turn'] {
    validateSerializedNonMekTurn(saved.turn);
    return Object.freeze({
        turnCounter: saved.turn?.turnCounter ?? 0,
        airborne: saved.turn?.airborne ?? null,
        weaponsHeat: saved.turn?.weaponsHeat ?? 0,
        cover: saved.turn?.cover === undefined
            ? null
            : deserializeUnitCover(saved.turn.cover) ?? null,
        spotting: saved.turn?.spotting === true,
        movement: saved.turn?.movement === undefined
            ? null
            : Object.freeze({
                ...saved.turn.movement,
                boosterComponentIds: Object.freeze([...saved.turn.movement.boosterComponentIds]),
            }),
    });
}

function validateSerializedNonMekTurn(value: unknown): void {
    if (value === undefined) return;
    const turn = requireRecord(value, 'entity turn');
    const keys = Object.keys(turn);
    if (keys.some(key => key !== 'turnCounter' && key !== 'airborne'
        && key !== 'movement' && key !== 'weaponsHeat'
        && key !== 'cover' && key !== 'spotting')) {
        throw new Error('Non-Mek turn contains unknown fields');
    }
    if (turn['turnCounter'] !== undefined) requireInteger(turn['turnCounter'], 'entity turn counter');
    if (turn['weaponsHeat'] !== undefined) requireInteger(turn['weaponsHeat'], 'entity weapon heat');
    if (turn['airborne'] !== undefined && typeof turn['airborne'] !== 'boolean') {
        throw new Error('Non-Mek airborne state must be boolean');
    }
    if (turn['cover'] !== undefined && deserializeUnitCover(turn['cover']) === undefined) {
        throw new Error('Non-Mek cover state is invalid');
    }
    if (turn['spotting'] !== undefined && turn['spotting'] !== true) {
        throw new Error('Non-Mek spotting state must be true when present');
    }
    if (turn['movement'] === undefined) return;
    const movement = requireRecord(turn['movement'], 'entity movement');
    if (Object.keys(movement).some(key =>
        key !== 'mode' && key !== 'distance' && key !== 'boosterComponentIds')) {
        throw new Error('Non-Mek movement contains unknown fields');
    }
    const mode = movement['mode'];
    if (mode !== 'stationary' && mode !== 'walk' && mode !== 'run'
        && mode !== 'jump' && mode !== 'UMU' && mode !== 'VTOL') {
        throw new Error('Non-Mek movement mode is invalid');
    }
    requireInteger(movement['distance'], 'entity movement distance');
    if (!Array.isArray(movement['boosterComponentIds'])
        || movement['boosterComponentIds'].some(id => typeof id !== 'string')) {
        throw new Error('Non-Mek movement boosters are invalid');
    }
}

function serializePendingCombat(state: NonMekUnitRuntimeState): SerializedNonMekUnit['pendingCombat'] {
    const pending = state.pendingCombat;
    if (pending.locationInternalDamage.size === 0
        && pending.armorDamage.size === 0
        && pending.componentStatus.size === 0
        && pending.damageTrackHits.size === 0) return undefined;
    const internalDamage = [...pending.locationInternalDamage]
        .sort(([left], [right]) => compareText(left, right))
        .map(([locationId, damage]) => Object.freeze({ locationId, damage }));
    const armorDamage = [...pending.armorDamage]
        .sort(([left], [right]) => compareText(left, right))
        .map(([faceId, damage]) => Object.freeze({ faceId, damage }));
    const componentStatus = [...pending.componentStatus]
        .sort(([left], [right]) => compareText(left, right))
        .map(([componentId, status]) => Object.freeze({ componentId, status }));
    const damageTrackHits = [...pending.damageTrackHits]
        .sort(([left], [right]) => compareText(left, right))
        .map(([damageTrackId, damageTrack]) => Object.freeze({
            damageTrackId,
            hitDelta: damageTrack.hitDelta,
            hitTimestamps: Object.freeze([...damageTrack.hitTimestamps]),
        }));
    return Object.freeze({
        ...(internalDamage.length === 0 ? {} : { internalDamage: Object.freeze(internalDamage) }),
        ...(armorDamage.length === 0 ? {} : { armorDamage: Object.freeze(armorDamage) }),
        ...(componentStatus.length === 0 ? {} : { componentStatus: Object.freeze(componentStatus) }),
        ...(damageTrackHits.length === 0 ? {} : { damageTrackHits: Object.freeze(damageTrackHits) }),
    });
}

function restorePendingCombat(saved: SerializedNonMekUnit): NonMekUnitRuntimeState['pendingCombat'] {
    return Object.freeze({
        locationInternalDamage: new Map((saved.pendingCombat?.internalDamage ?? []).map(entry => [
            asLocationId(entry.locationId), entry.damage,
        ])),
        armorDamage: new Map((saved.pendingCombat?.armorDamage ?? []).map(entry => [
            asArmorFaceId(entry.faceId), entry.damage,
        ])),
        componentStatus: new Map((saved.pendingCombat?.componentStatus ?? []).map(entry => [
            asComponentId(entry.componentId), entry.status,
        ])),
        damageTrackHits: new Map((saved.pendingCombat?.damageTrackHits ?? []).map(entry => [
            asSystemDamageTrackId(entry.damageTrackId), Object.freeze({
                hitDelta: entry.hitDelta,
                hitTimestamps: Object.freeze([...entry.hitTimestamps]),
            }),
        ])),
    });
}

function freezeBaseline(value: InstanceBaselineRef): InstanceBaselineRef {
    return Object.freeze({
        entity: Object.freeze({ ...value.entity }),
        ruleset: value.ruleset,
        initialStateProfile: Object.freeze({ ...value.initialStateProfile }),
    });
}

function freezeDeployment(value: SerializedNonMekDeployment): SerializedNonMekDeployment {
    if (value.schemaVersion !== NON_MEK_DEPLOYMENT_SCHEMA_VERSION
        || !value.values.id.trim() || value.values.id.includes('\0')) {
        throw new Error('Invalid entity deployment');
    }
    return Object.freeze({
        schemaVersion: NON_MEK_DEPLOYMENT_SCHEMA_VERSION,
        values: Object.freeze({
            id: value.values.id,
            crewAssignment: Object.freeze({
                ...value.values.crewAssignment,
                positions: Object.freeze(value.values.crewAssignment.positions.map(position =>
                    Object.freeze({ ...position }))),
            }),
        }),
    });
}

export function canonicalizeNonMekUnitRestoration(
    value: SerializedNonMekUnitRestoration,
): SerializedNonMekUnitRestoration {
    return Object.freeze({
        warnings: Object.freeze(value.warnings.map(boundedMessage)),
        unresolved: Object.freeze(value.unresolved.map(boundedMessage)),
    });
}

function boundedMessage(value: string): string {
    if (typeof value !== 'string' || value.length > 2_000 || value.includes('\0')) {
        throw new Error('Invalid restoration message');
    }
    return value;
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
        throw new Error(`${label} must be a non-empty string`);
    }
    return value;
}

function requireInteger(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new Error(`${label} must be a non-negative integer`);
    }
    return value as number;
}

export function isNonMekEntityType(value: EntityType): value is NonMekEntityType {
    return value !== 'Mek';
}

export function isSerializedNonMekUnit(value: unknown): value is SerializedNonMekUnit {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const family = (value as { readonly family?: unknown }).family;
    return family !== null && typeof family === 'object' && !Array.isArray(family)
        && (family as { readonly kind?: unknown }).kind === 'non-mek';
}
