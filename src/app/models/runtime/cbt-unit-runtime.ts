// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { compareBombLoads,type BombLoad } from '../aerospace-bomb.model';
import { CrewMember,type CrewMemberRuntimeState } from '../crew-member.model';
import type { ArmorFaceId,ComponentId,CrewPositionId,LocationId } from '../entity/entity-identifiers';
import { ImmutableIndex,ImmutableSet } from '../entity/immutable-collections';
import type { EntityMountedEquipment } from '../entity/types';
import type { EquipmentStatus } from '../equipment-status.model';
import type { AmmoEquipment } from '../equipment.model';
import type { SpottingMode } from '../target-number-calculator.model';
import type { UnitConditionKey } from '../unit-condition.model';
import { compareText } from '../../utils/string.util';
import { serializeUnitCover,type UnitCover } from '../unit-cover.model';
import { freezeAttackerTargetingState,type AttackerTargetingState } from './attacker-targeting-state';
import type { BoundOptionalRules } from './bound-optional-rules';
import type { CrewAssignment } from './crew-assignment';
import type { EndTurnCheckpoint } from './end-turn-checkpoint';
import { MAX_HEAT_VALUE, serializeTurnHeatLedger, type TurnHeatLedger } from './turn-heat-ledger';
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

export function isHeatValue(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_HEAT_VALUE
        && !Object.is(value, -0);
}

/** How far the player set NEXT from the calculated heat: a whole number within the heat bound either way. */
export function isHeatOffset(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= MAX_HEAT_VALUE
        && !Object.is(value, -0);
}

/** Durable heat facts; source calculation and settlement order belong to the mechanics. */
export interface CBTUnitHeatState {
    readonly current: number;
    readonly previous: number;
    /** NEXT, the player's arrow, where it stands: the value saved, sent and shown everywhere. */
    readonly pendingOverride?: number;
    /**
     * How far from the calculated heat the player set NEXT while heat resolution calculated the turn's heat; NEXT keeps
     * this offset as heat arrives (`followCalculatedHeat`). Absent when they set NEXT as their own number.
     */
    readonly pendingOffset?: number;
    readonly heatsinksOff: number;
    /**
     * The heat sinks the player switched off for the End Phase: shut-off sinks dissipate nothing from the following
     * Heat Phase (TW, Shutting Off Heat Sinks; Core p. 103). Absent when the switch is unchanged.
     */
    readonly heatsinksOffNext?: number;
}

function heatSinkSwitch(heat: CBTUnitHeatState): Pick<CBTUnitHeatState, 'heatsinksOff' | 'heatsinksOffNext'> {
    return { heatsinksOff: heat.heatsinksOff, ...(heat.heatsinksOffNext === undefined ? {} : { heatsinksOffNext: heat.heatsinksOffNext }) };
}

/**
 * On turn 1, until the unit has a move assigned, a heat-sink switch holds at once, so a unit can begin the game with
 * any number of sinks off (Core p. 103; the user's rule for both rulesets and every unit). Otherwise the End Phase
 * makes it.
 */
export function heatSinkSwitchIsImmediate(turn: Readonly<{ turnCounter: number }>, moveAssigned: boolean): boolean {
    return turn.turnCounter === 0 && !moveAssigned;
}

/**
 * Switches heat sinks off or on. The switch is made in the End Phase, so the turn's Heat Phase keeps the sinks it had
 * (TW, Shutting Off Heat Sinks; Core p. 103), except when it holds at once (`heatSinkSwitchIsImmediate`). 'Meks and
 * other units switch alike.
 */
export function withHeatSinkSwitch<T extends CBTUnitHeatState>(heat: T, heatsinksOff: number, atOnce: boolean): T {
    const { heatsinksOffNext: _next, ...rest } = heat;
    return (atOnce || heatsinksOff === heat.heatsinksOff
        ? { ...rest, heatsinksOff }
        : { ...rest, heatsinksOffNext: heatsinksOff }) as T;
}

/** The End Phase applies the heat-sink switch set during the turn. */
export function settleHeatSinkSwitch<T extends CBTUnitHeatState>(heat: T): T {
    const { heatsinksOffNext, ...rest } = heat;
    return (heatsinksOffNext === undefined ? heat : { ...rest, heatsinksOff: heatsinksOffNext }) as T;
}

/** Settles the track at a value: the prior current heat becomes previous and any pending arrow is consumed. */
export function settleHeat(heat: CBTUnitHeatState, current: number): CBTUnitHeatState {
    return Object.freeze({ current, previous: heat.current, ...heatSinkSwitch(heat) });
}

/** The heat a unit is headed for: the player's arrow (NEXT) when one is set, otherwise its current heat. */
export function nextHeat(heat: Readonly<{ current: number; pendingOverride?: number }>): number {
    return heat.pendingOverride ?? heat.current;
}

/** Sets or clears the pending arrow, and its offset from the calculated heat; the committed track is unchanged. */
export function withPendingHeat(
    heat: CBTUnitHeatState,
    pendingOverride: number | undefined,
    pendingOffset?: number,
): CBTUnitHeatState {
    return Object.freeze({
        current: heat.current,
        previous: heat.previous,
        ...(pendingOverride === undefined ? {} : { pendingOverride }),
        ...(pendingOverride === undefined || pendingOffset === undefined ? {} : { pendingOffset }),
        ...heatSinkSwitch(heat),
    });
}

/**
 * The player sets NEXT. Given the `calculated` heat (heat resolution on), NEXT keeps its offset from it; without, NEXT
 * is the player's own number.
 */
export function withNextHeat(heat: CBTUnitHeatState, next: number | undefined, calculated?: number): CBTUnitHeatState {
    return withPendingHeat(heat, next, next === undefined || calculated === undefined ? undefined : next - calculated);
}

/**
 * NEXT moved to keep the player's offset from the `calculated` heat, within the heat bound: heat that arrives after they
 * set it moves it too. A NEXT set as the player's own number (no offset) stays where it is.
 */
export function followCalculatedHeat(heat: CBTUnitHeatState, calculated: number): CBTUnitHeatState {
    if (heat.pendingOverride === undefined || heat.pendingOffset === undefined) return heat;
    const next = Math.min(MAX_HEAT_VALUE, Math.max(0, calculated + heat.pendingOffset));
    return next === heat.pendingOverride ? heat : withPendingHeat(heat, next, heat.pendingOffset);
}

/**
 * How far a NEXT that follows the `calculated` heat stands from it: the offset the player keeps, unless the heat
 * bounds hold NEXT; then the distance it still makes. Undefined when NEXT is not set or is the player's own number.
 */
export function nextHeatAdjustment(
    heat: Readonly<{ pendingOverride?: number; pendingOffset?: number }>,
    calculated: number,
): number | undefined {
    const next = heat.pendingOverride;
    if (next === undefined || heat.pendingOffset === undefined) return undefined;
    return next > 0 && next < MAX_HEAT_VALUE ? heat.pendingOffset : next - calculated;
}

/** NEXT stands where it stood and follows the calculation as it did. */
export function sameNextHeat(a: CBTUnitHeatState, b: CBTUnitHeatState): boolean {
    return a.pendingOverride === b.pendingOverride && a.pendingOffset === b.pendingOffset;
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
    /** Outside heat the phase's attacks add once their damage commits; absent when none. */
    readonly outsideHeat?: number;
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

const MAX_FIRED_WEAPONS = 1_024;

/**
 * The turn's fired weapons with `weaponIds` added: a weapon fires once a turn, so firing in steps (select some, fire,
 * select others, fire) never fires one twice. Unique ids in ascending order; undefined when none fired.
 */
export function withFiredWeapons(
    fired: readonly ComponentId[] | undefined,
    weaponIds: Iterable<ComponentId>,
): readonly ComponentId[] | undefined {
    const all = [...new Set([...fired ?? [], ...weaponIds])].sort(compareText);
    return all.length === 0 ? undefined : Object.freeze(all);
}

/** Reads a turn's fired weapons, live or saved: a non-empty list of unique canonical ids in ascending order. */
export function readFiredWeapons(
    value: unknown,
    path: string,
    fail: (message: string, path: string) => never,
): readonly ComponentId[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_FIRED_WEAPONS) {
        return fail(`must list 1 to ${MAX_FIRED_WEAPONS} fired weapons`, path);
    }
    const ids = value.map((id: unknown, index) => typeof id === 'string' && id.length > 0 && id.length <= 512
        && id.trim() === id ? id as ComponentId : fail('must be a canonical component id', `${path}[${index}]`));
    if (ids.some((id, index) => index > 0 && compareText(ids[index - 1], id) >= 0)) {
        return fail('must contain unique sorted component ids', path);
    }
    return Object.freeze(ids);
}

/** The turn facts every family shares, the heat ledger APPLY HEAT keeps (`TurnHeatLedger`) among them. */
export interface CBTTurnRuntimeState extends TurnHeatLedger {
    readonly turnCounter: number;
    readonly airborne: boolean | null;
    readonly cover: UnitCover | null;
    readonly weaponsHeat: number;
    /** The weapons that fired this turn, each once (`withFiredWeapons`); absent when none. */
    readonly firedWeapons?: readonly ComponentId[];
    /** Heat from outside sources such as inferno missiles, settled with this turn's heat; absent at 0. */
    readonly outsideHeat?: number;
    readonly spotting: SpottingMode;
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
        ...(turn.firedWeapons === undefined ? {} : { firedWeapons: turn.firedWeapons }),
        ...(turn.outsideHeat ? { outsideHeat: turn.outsideHeat } : {}),
        ...(turn.spotting ? { spotting: turn.spotting } : {}),
        ...(turn.phaseStateChanged ? { phaseStateChanged: true as const } : {}),
        ...(turn.endTurnCheckpoint === undefined ? {} : { endTurnCheckpoint: turn.endTurnCheckpoint }),
        ...(turn.turnStep === 0 ? {} : { turnStep: turn.turnStep }),
        ...(turn.joinedStep === undefined ? {} : { joinedStep: turn.joinedStep }),
        ...serializeTurnHeatLedger(turn),
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
    /** The optional rules bound into this unit when it was created or last rebound. */
    boundRules(): BoundOptionalRules;
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
