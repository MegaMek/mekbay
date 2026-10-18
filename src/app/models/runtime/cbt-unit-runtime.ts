// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { compareBombLoads,type BombLoad } from '../aerospace-bomb.model';
import { CrewMember,type CrewMemberRuntimeState } from '../crew-member.model';
import type { ArmorFaceId,ComponentId,CrewPositionId,LocationId } from '../entity/entity-identifiers';
import { ImmutableIndex,ImmutableSet } from '../entity/immutable-collections';
import type { EntityMountedEquipment } from '../entity/types';
import type { EquipmentStatus } from '../equipment-status.model';
import type { AmmoEquipment } from '../equipment.model';
import type { UnitConditionKey } from '../unit-condition.model';
import { serializeUnitCover,type UnitCover } from '../unit-cover.model';
import { freezeAttackerTargetingState,type AttackerTargetingState } from './attacker-targeting-state';
import type { CrewAssignment } from './crew-assignment';
import type { EndTurnCheckpoint } from './end-turn-checkpoint';
import { freezeEquipmentRowOrder,type EquipmentRowOrderState } from './equipment-row-order';
import type { AmmoRuntimeState,ComponentRuntimeState } from './runtime-state';

export type RuntimeStatePerspective = 'committed' | 'preview';

/** Shared immutable location topology for every CBT BaseEntity runtime. */
export interface CBTRuntimeLocation {
    readonly id: LocationId;
    readonly code: string;
    /** Damage capacity: Reinforced Structure uses two marks per construction point. */
    readonly internalPoints: number;
    readonly armorFaceIds: readonly ArmorFaceId[];
}

/** Shared immutable armor topology for every CBT BaseEntity runtime. */
export interface CBTRuntimeArmorFace {
    readonly id: ArmorFaceId;
    readonly locationId: LocationId;
    readonly face: 'front' | 'rear';
    /** Damage capacity: Hardened Armor uses two marks per construction point. */
    readonly maximumPoints: number;
}

/** Components share identity; only equipment-backed components have a mount. */
export interface CBTRuntimeComponent {
    readonly id: ComponentId;
    readonly kind: 'equipment' | 'system';
    readonly mount?: EntityMountedEquipment;
}

export interface CBTRuntimeEquipment extends CBTRuntimeComponent {
    readonly kind: 'equipment';
    readonly mount: EntityMountedEquipment;
}

export interface CBTRuntimeCrewPosition {
    readonly id: CrewPositionId;
    readonly occurrence: number;
}

/**
 * One disposable topology contract for every CBT BaseEntity. Family-only
 * metadata lives on the indexed rows or in explicit mechanics capabilities.
 */
export interface CBTUnitRuntimeIndex {
    readonly locations: ReadonlyMap<LocationId, CBTRuntimeLocation>;
    readonly armorFaces: ReadonlyMap<ArmorFaceId, CBTRuntimeArmorFace>;
    readonly components: ReadonlyMap<ComponentId, CBTRuntimeComponent>;
    readonly crewPositions: ReadonlyMap<CrewPositionId, CBTRuntimeCrewPosition>;
}

export interface CBTLocationRuntimeState {
    readonly internalDamage: number;
    readonly armorDamage: readonly { readonly faceId: ArmorFaceId; readonly damage: number }[];
}

export type HeatAutomationPolicy = 'automatic' | 'manual';

/** Heat is a whole number of points; one bound serves every family, command and save format. */
export const MAX_HEAT_VALUE = 1_000_000;

export function isHeatValue(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_HEAT_VALUE
        && !Object.is(value, -0);
}

/** Durable heat facts; source calculation and settlement order belong to the mechanics. */
export interface CBTUnitHeatState {
    readonly current: number;
    readonly previous: number;
    readonly pendingOverride?: number;
    readonly heatsinksOff: number;
}

/** Settles the track at a value: the prior current heat becomes previous and any pending arrow is consumed. */
export function settleHeat(heat: CBTUnitHeatState, current: number): CBTUnitHeatState {
    return Object.freeze({ current, previous: heat.current, heatsinksOff: heat.heatsinksOff });
}

/** Sets or clears the pending arrow; the committed track is unchanged. */
export function withPendingHeat(heat: CBTUnitHeatState, pendingOverride: number | undefined): CBTUnitHeatState {
    return Object.freeze({
        current: heat.current,
        previous: heat.previous,
        ...(pendingOverride === undefined ? {} : { pendingOverride }),
        heatsinksOff: heat.heatsinksOff,
    });
}

/** A manual edit settles a new value; re-entering the current value only drops a pending arrow. */
export function withEditedHeat(heat: CBTUnitHeatState, current: number): CBTUnitHeatState | null {
    if (current !== heat.current) return settleHeat(heat, current);
    return heat.pendingOverride === undefined ? null : withPendingHeat(heat, undefined);
}

export interface CBTUnitPendingCombatState {
    readonly locationInternalDamage: ReadonlyMap<LocationId, number>;
    readonly armorDamage: ReadonlyMap<ArmorFaceId, number>;
    readonly componentStatus: ReadonlyMap<ComponentId, EquipmentStatus>;
}

type PendingCounterField<P> = { [K in keyof P]-?: P[K] extends ReadonlyMap<unknown, number> ? K : never }[keyof P];
type PendingCounterId<P, K extends keyof P> = P[K] extends ReadonlyMap<infer Id, number> ? Id : never;

/** Adds a signed delta to one sparse pending-combat counter; a counter back at zero is removed. */
export function withPendingCombatDelta<
    State extends { readonly pendingCombat: CBTUnitPendingCombatState },
    K extends PendingCounterField<State['pendingCombat']>,
>(state: State, field: K, id: PendingCounterId<State['pendingCombat'], K>, amount: number): State {
    type Id = PendingCounterId<State['pendingCombat'], K>;
    const counters = state.pendingCombat as unknown as Readonly<Record<K, ReadonlyMap<Id, number>>>;
    const values = new Map(counters[field]);
    const next = (values.get(id) ?? 0) + amount;
    if (next === 0) values.delete(id);
    else values.set(id, next);
    return {
        ...state,
        pendingCombat: Object.freeze({ ...state.pendingCombat, [field]: new ImmutableIndex(values) }),
    };
}

/** Boundary facts shared by every CBT family runtime. */
export interface CBTTurnRuntimeState {
    readonly turnCounter: number;
    readonly airborne: boolean | null;
    readonly cover: UnitCover | null;
    readonly weaponsHeat: number;
    readonly spotting: boolean;
    /** A committed phase-scoped edit exists and has not crossed End Phase yet. */
    readonly phaseStateChanged: boolean;
    readonly endTurnCheckpoint?: EndTurnCheckpoint;
    /** Real-phase steps of this turn the unit has completed (see turn-sequence); 0 until it acts. */
    readonly turnStep: number;
    /**
     * The real-phase step this unit joined the turn at, when it was added after the turn's Movement: it acts
     * after the Initiative order. Absent otherwise.
     */
    readonly joinedStep?: number;
}

/** Sparse wire form of the turn facts every family shares; each family's wire adds its own facts after them. */
export function serializeSharedTurnFacts(turn: CBTTurnRuntimeState) {
    return {
        ...(turn.turnCounter === 0 ? {} : { turnCounter: turn.turnCounter }),
        ...(turn.airborne === null ? {} : { airborne: turn.airborne }),
        ...(turn.cover === null ? {} : { cover: serializeUnitCover(turn.cover) }),
        ...(turn.weaponsHeat === 0 ? {} : { weaponsHeat: turn.weaponsHeat }),
        ...(turn.spotting ? { spotting: true as const } : {}),
        ...(turn.phaseStateChanged ? { phaseStateChanged: true as const } : {}),
        ...(turn.endTurnCheckpoint === undefined ? {} : { endTurnCheckpoint: turn.endTurnCheckpoint }),
        ...(turn.turnStep === 0 ? {} : { turnStep: turn.turnStep }),
        ...(turn.joinedStep === undefined ? {} : { joinedStep: turn.joinedStep }),
    };
}

/**
 * Common sparse state owned by every CBT runtime. Family-specific turn
 * declarations extend the shared boundary facts on their concrete state.
 */
export interface CBTUnitRuntimeState {
    readonly stateRevision: number;
    readonly explicitlyDestroyed: boolean;
    readonly locations: ReadonlyMap<LocationId, CBTLocationRuntimeState>;
    readonly components: ReadonlyMap<ComponentId, ComponentRuntimeState>;
    readonly ammo: ReadonlyMap<ComponentId, AmmoRuntimeState>;
    readonly crew: ReadonlyMap<CrewPositionId, CrewMemberRuntimeState>;
    readonly conditions: ReadonlySet<UnitConditionKey>;
    readonly heat: CBTUnitHeatState;
    readonly pendingCombat: CBTUnitPendingCombatState;
    readonly turn: CBTTurnRuntimeState;
    readonly attackerTargeting: AttackerTargetingState;
    readonly equipmentRowOrder?: EquipmentRowOrderState;
    /** Carried bomb loadout in canonical order; absent when the unit carries no bombs. */
    readonly bombs?: readonly BombLoad[];
}

/** Captures shared sparse facts once; specialized canonicalizers add only their own mechanics. */
export function freezeCommonUnitRuntimeState<State extends CBTUnitRuntimeState>(state: State): State {
    const { equipmentRowOrder: rawOrder, bombs: rawBombs, ...values } = state;
    const equipmentRowOrder = freezeEquipmentRowOrder(rawOrder);
    const bombs = rawBombs?.length
        ? Object.freeze([...rawBombs].sort(compareBombLoads).map(load => Object.freeze({ ...load })))
        : undefined;
    return Object.freeze({
        ...values,
        ...(bombs === undefined ? {} : { bombs }),
        locations: new ImmutableIndex([...state.locations].map(([id, value]) => [id, Object.freeze({
            ...value, armorDamage: Object.freeze(value.armorDamage.map(entry => Object.freeze({ ...entry }))),
        })] as const)),
        components: new ImmutableIndex([...state.components].map(([id, value]) => [id,
            Object.freeze(Object.fromEntries(Object.entries(value).map(([key, fact]) => [key,
                fact !== null && typeof fact === 'object' ? Object.freeze({ ...fact }) : fact,
            ]))) as ComponentRuntimeState,
        ] as const)),
        ammo: new ImmutableIndex([...state.ammo].map(([id, value]) => [id, Object.freeze({ ...value })] as const)),
        crew: new ImmutableIndex([...state.crew].map(([id, value]) => [id, Object.freeze({ ...value })] as const)),
        conditions: new ImmutableSet(state.conditions),
        heat: Object.freeze({ ...state.heat }),
        attackerTargeting: freezeAttackerTargetingState(state.attackerTargeting),
        ...(equipmentRowOrder === undefined ? {} : { equipmentRowOrder }),
        pendingCombat: Object.freeze({ ...state.pendingCombat,
            locationInternalDamage: new ImmutableIndex(state.pendingCombat.locationInternalDamage),
            armorDamage: new ImmutableIndex(state.pendingCombat.armorDamage),
            componentStatus: new ImmutableIndex(state.pendingCombat.componentStatus),
        }),
    // Every specialized field is retained; only readonly collection implementations change.
    }) as unknown as State;
}

export interface CBTUnitCommandResult<State extends CBTUnitRuntimeState | null> {
    /** False when the owning force is read-only or the edit authority has expired. */
    readonly accepted: boolean;
    readonly changed: boolean;
    readonly state: State;
}

/**
 * Family-neutral runtime reads used by CBTForce and generic presentation.
 * Mek-only rule queries extend this interface and are obtained through an
 * explicit capability guard.
 */
export interface CBTUnitQueryPort {
    readonly stateRevision: number;
    /** One authoritative dirty check for the current phase. */
    hasPendingPhaseChanges(): boolean;
    hasPendingCombat(): boolean;
    destroyed(): boolean;
    currentBaseBattleValue(): number | null;
    remainingArmor(faceId: ArmorFaceId, perspective?: RuntimeStatePerspective): number;
    remainingInternal(locationId: LocationId, perspective?: RuntimeStatePerspective): number;
    componentStatus(componentId: ComponentId, perspective?: RuntimeStatePerspective): EquipmentStatus;
    componentMode(componentId: ComponentId): string | undefined;
    componentJammed(componentId: ComponentId): boolean;
    remainingAmmo(componentId: ComponentId): number;
    ammoEquipment(componentId: ComponentId): AmmoEquipment | null;
    ammoHotLoaded(componentId: ComponentId): boolean;
    attackerTargetingState(): AttackerTargetingState;
    equipmentRowOrder(): EquipmentRowOrderState | undefined;
    hasCondition(condition: UnitConditionKey): boolean;
    conditions(): readonly UnitConditionKey[];
    crewState(positionId: CrewPositionId): CrewMember;
    /** Immutable deployment profile; wounds/consciousness are queried separately. */
    crewAssignment(): CrewAssignment;
}

/** One atomically captured force-facing runtime read model. */
export interface CBTUnitRuntimeReadModel {
    readonly index: CBTUnitRuntimeIndex;
    readonly state: CBTUnitRuntimeState;
    readonly query: CBTUnitQueryPort;
}

/** Minimal family-neutral source for an atomic force-facing runtime read. */
export interface CBTUnitRuntimePort {
    getIndex(): CBTUnitRuntimeIndex;
    snapshot(): CBTUnitRuntimeState;
    query(): CBTUnitQueryPort;
}

/** The single capture path used by every ready CBT unit. */
export function captureCBTUnitRuntime(
    runtime: CBTUnitRuntimePort,
): CBTUnitRuntimeReadModel {
    return Object.freeze({
        index: runtime.getIndex(),
        state: runtime.snapshot(),
        query: runtime.query(),
    });
}
