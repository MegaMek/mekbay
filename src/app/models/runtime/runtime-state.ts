// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type {
    ArmorFaceId,
    ComponentId,
    CrewPositionId,
    CriticalSlotId,
    LocationId,
} from '../entity/entity-identifiers';
import type { SavedEntityIdentity } from '../persisted-unit-state';
import type { CBTRuleset } from '../cbt-ruleset.model';
import { ImmutableIndex, ImmutableSet } from '../entity/immutable-collections';
import type { EquipmentStatus } from '../equipment-status.model';
import {
    canonicalizeMekTurnStateV2,
    createPristineMekTurnStateV2,
    type MekTurnStateV2,
} from './mek-turn-state-v2';
import {
    canonicalizeMekHeatStateV2,
    createPristineMekHeatStateV2,
    type MekHeatStateV2,
} from './mek-heat-state-v2';
import {
    freezeRuleChecks,
    type MekRuleChecksV2,
} from './mek-destruction-state-v2';
import {
    canonicalizeMekMovementPsrStateV2,
    createPristineMekMovementPsrStateV2,
    type MekMovementPsrStateV2,
} from './mek-movement-psr-v2';
import { uuidv4 } from '../../utils/uuid.util';
import {
    createPristineAttackerTargetingState,
    freezeAttackerTargetingState,
} from './attacker-targeting-state';
import type { SparseMekGaussPowerState } from './mek-gauss-power';
import {
    freezeEquipmentRowOrder,
} from './equipment-row-order';
import type {
    CBTCrewRuntimeState,
    CBTLocationRuntimeState,
    CBTUnitRuntimeState,
} from './cbt-unit-runtime';

/** A sixth wound is fatal under the supported Mek rules profile. */
export const MAX_MEK_CREW_WOUNDS = 6;

/** Closed Mek location state vocabulary owned by the runtime contract. */
export const MEK_LOCATION_CONDITION_KEYS = Object.freeze([
    'blown-off',
    'flooded',
    'narc',
] as const);
export type MekLocationConditionKey = typeof MEK_LOCATION_CONDITION_KEYS[number];
const MEK_LOCATION_CONDITION_KEY_SET: ReadonlySet<string> = new Set(MEK_LOCATION_CONDITION_KEYS);

export function isMekLocationConditionKey(value: unknown): value is MekLocationConditionKey {
    return typeof value === 'string' && MEK_LOCATION_CONDITION_KEY_SET.has(value);
}

export const MAX_MEK_LOCATION_CONDITION_VALUE = 1_000_000;

export interface InitialStateProfileRef {
    readonly schemaVersion: 1;
    readonly initializerRevision: number;
    readonly profileId: string;
}

export interface InstanceBaselineRef {
    readonly entity: SavedEntityIdentity;
    readonly ruleset: CBTRuleset;
    readonly initialStateProfile: InitialStateProfileRef;
}

export interface LocationRuntimeState extends CBTLocationRuntimeState {
    /** Sparse positive values. Boolean conditions use one; NARC uses its marker count. */
    readonly conditions: ReadonlyMap<MekLocationConditionKey, number>;
}

export interface CriticalSlotRuntimeState {
    readonly hits: number;
    /** Omitted means the slot is available or became unavailable on turn zero. */
    readonly destroyedTurn?: number;
}

/** Sparse component-local lifecycle state. Absence means sequence zero and inactive. */
export interface EscalatingFailureRuntimeState {
    readonly sequence: number;
    readonly active?: true;
}

export type PpcCapacitorChargeState = 'charging' | 'charged';

export function isPpcCapacitorChargeState(value: unknown): value is PpcCapacitorChargeState {
    return value === 'charging' || value === 'charged';
}

/** Sparse pair-local state stored on the capacitor and bound to one exact PPC. */
export interface PpcCapacitorRuntimeState {
    readonly weaponId: ComponentId;
    readonly chargeState?: PpcCapacitorChargeState;
    readonly firedThisTurn?: true;
}

export type BombastLaserChargeState = 'charging' | 'charged';

export function isBombastLaserChargeState(value: unknown): value is BombastLaserChargeState {
    return value === 'charging' || value === 'charged';
}

/** Sparse component-local Bombast lifecycle. Charge and fired are mutually exclusive. */
export interface BombastLaserRuntimeState {
    readonly chargeState?: BombastLaserChargeState;
    readonly firedThisTurn?: true;
}

export type C3EmergencyMasterModeOverride = 'on' | 'off';
export type C3EmergencyMasterOperatingTurns = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export function isC3EmergencyMasterModeOverride(value: unknown): value is C3EmergencyMasterModeOverride {
    return value === 'on' || value === 'off';
}

export function isC3EmergencyMasterOperatingTurns(value: unknown): value is C3EmergencyMasterOperatingTurns {
    return value === 1 || value === 2 || value === 3 || value === 4
        || value === 5 || value === 6 || value === 7;
}

/** Sparse component-local request/operating lifecycle. Absence means auto with zero turns. */
export interface C3EmergencyMasterRuntimeState {
    readonly mode?: C3EmergencyMasterModeOverride;
    readonly operatingTurns?: C3EmergencyMasterOperatingTurns;
}

/** Sparse combat damage stored on a physical shield; critical/actuator losses are derived. */
export interface MekShieldDamageRuntimeState {
    readonly absorptionDamage: number;
    readonly capacityDamage: number;
}

export interface ComponentRuntimeState {
    readonly statusOverride?: Exclude<EquipmentStatus, 'available'>;
    readonly mode?: string;
    readonly jammed?: boolean;
    readonly escalatingFailure?: EscalatingFailureRuntimeState;
    readonly ppcCapacitor?: PpcCapacitorRuntimeState;
    readonly bombastLaser?: BombastLaserRuntimeState;
    readonly c3EmergencyMaster?: C3EmergencyMasterRuntimeState;
    /** Independent from the weapon mode (notably HAG Standard/Flak). Absence means powered up. */
    readonly gaussPower?: SparseMekGaussPowerState;
    readonly shieldDamage?: MekShieldDamageRuntimeState;
    /** Damage absorbed by this 10-point Modular Armor panel. */
    readonly modularArmorDamage?: number;
}

export interface AmmoRuntimeState {
    readonly shotsSpent: number;
    readonly munitionOverride?: string;
}

export interface PendingCombatOverlay {
    readonly locationInternalDamage: ReadonlyMap<LocationId, number>;
    readonly armorDamage: ReadonlyMap<ArmorFaceId, number>;
    readonly criticalHits: ReadonlyMap<CriticalSlotId, number>;
    /** Explicit `available` represents a pending repair over a committed override. */
    readonly componentStatus: ReadonlyMap<ComponentId, EquipmentStatus>;
    /** Signed preview deltas over committed shield combat damage. */
    readonly shieldDamage: ReadonlyMap<ComponentId, MekShieldDamageRuntimeState>;
    /** Signed preview deltas over committed Modular Armor panel damage. */
    readonly modularArmorDamage: ReadonlyMap<ComponentId, number>;
    /**
     * Exact preview replacement values by stable location. Zero is an explicit
     * pending removal; committed location state remains sparse and positive.
     */
    readonly locationConditions: ReadonlyMap<
        LocationId,
        ReadonlyMap<MekLocationConditionKey, number>
    >;
}

export interface MekUnitRuntimeState extends CBTUnitRuntimeState {
    /** Explicit source/import override; absent mechanical damage remains independently derivable. */
    readonly explicitlyDestroyed: boolean;
    /** Reconciled effective value used by hot runtime projections; never persistence authority. */
    readonly destroyed: boolean;
    readonly locations: ReadonlyMap<LocationId, LocationRuntimeState>;
    readonly slots: ReadonlyMap<CriticalSlotId, CriticalSlotRuntimeState>;
    readonly heat: MekHeatStateV2;
    /** Persistent typed outcomes; required even when empty in runtime schema V4. */
    readonly ruleChecks: MekRuleChecksV2;
    /** Sole typed owner of Mek movement declarations, phase damage, and pilot checks. */
    readonly movementPsr: MekMovementPsrStateV2;
    readonly turn: MekTurnStateV2;
    readonly pendingCombat: PendingCombatOverlay;
}

export function createUnitInstanceId(): string {
    return `unit:${uuidv4()}`;
}

export function emptyPendingCombatOverlay(): PendingCombatOverlay {
    return Object.freeze({
        locationInternalDamage: new ImmutableIndex<LocationId, number>([]),
        armorDamage: new ImmutableIndex<ArmorFaceId, number>([]),
        criticalHits: new ImmutableIndex<CriticalSlotId, number>([]),
        componentStatus: new ImmutableIndex<ComponentId, EquipmentStatus>([]),
        shieldDamage: new ImmutableIndex<ComponentId, MekShieldDamageRuntimeState>([]),
        modularArmorDamage: new ImmutableIndex<ComponentId, number>([]),
        locationConditions: new ImmutableIndex<
            LocationId,
            ReadonlyMap<MekLocationConditionKey, number>
        >([]),
    });
}

export function createPristineMekState(): MekUnitRuntimeState {
    return freezeRuntimeState({
        stateRevision: 0,
        explicitlyDestroyed: false,
        destroyed: false,
        locations: new ImmutableIndex<LocationId, LocationRuntimeState>([]),
        slots: new ImmutableIndex<CriticalSlotId, CriticalSlotRuntimeState>([]),
        components: new ImmutableIndex<ComponentId, ComponentRuntimeState>([]),
        ammo: new ImmutableIndex<ComponentId, AmmoRuntimeState>([]),
        crew: new ImmutableIndex<CrewPositionId, CBTCrewRuntimeState>([]),
        heat: createPristineMekHeatStateV2(),
        conditions: new ImmutableSet([]),
        ruleChecks: new ImmutableIndex([]),
        movementPsr: createPristineMekMovementPsrStateV2(),
        attackerTargeting: createPristineAttackerTargetingState(),
        turn: createPristineMekTurnStateV2(),
        pendingCombat: emptyPendingCombatOverlay(),
    });
}

export function freezeRuntimeState(state: MekUnitRuntimeState): MekUnitRuntimeState {
    const { equipmentRowOrder: rawEquipmentRowOrder, ...values } = state;
    const equipmentRowOrder = freezeEquipmentRowOrder(rawEquipmentRowOrder);
    return Object.freeze({
        ...values,
        locations: new ImmutableIndex([...state.locations].map(([id, value]) => [
            id,
            Object.freeze({
                ...value,
                armorDamage: Object.freeze(value.armorDamage.map(entry => Object.freeze({ ...entry }))),
                conditions: new ImmutableIndex(value.conditions),
            }),
        ] as const)),
        slots: new ImmutableIndex(state.slots),
        components: new ImmutableIndex([...state.components].map(([id, value]) => [
            id,
            Object.freeze({
                ...value,
                ...(value.escalatingFailure === undefined
                    ? {}
                    : { escalatingFailure: Object.freeze({ ...value.escalatingFailure }) }),
                ...(value.ppcCapacitor === undefined
                    ? {}
                    : { ppcCapacitor: Object.freeze({ ...value.ppcCapacitor }) }),
                ...(value.bombastLaser === undefined
                    ? {}
                    : { bombastLaser: Object.freeze({ ...value.bombastLaser }) }),
                ...(value.c3EmergencyMaster === undefined
                    ? {}
                    : { c3EmergencyMaster: Object.freeze({ ...value.c3EmergencyMaster }) }),
                ...(value.shieldDamage === undefined
                    ? {}
                    : { shieldDamage: Object.freeze({ ...value.shieldDamage }) }),
            }),
        ] as const)),
        ammo: new ImmutableIndex([...state.ammo].map(([id, value]) => [
            id,
            Object.freeze({ ...value }),
        ] as const)),
        crew: new ImmutableIndex([...state.crew].map(([id, value]) => [
            id,
            Object.freeze({ ...value }),
        ] as const)),
        heat: canonicalizeMekHeatStateV2(state.heat),
        conditions: new ImmutableSet(state.conditions),
        ruleChecks: freezeRuleChecks(state.ruleChecks),
        movementPsr: canonicalizeMekMovementPsrStateV2(state.movementPsr),
        attackerTargeting: freezeAttackerTargetingState(state.attackerTargeting),
        ...(equipmentRowOrder === undefined ? {} : { equipmentRowOrder }),
        turn: canonicalizeMekTurnStateV2(state.turn),
        pendingCombat: Object.freeze({
            locationInternalDamage: new ImmutableIndex(state.pendingCombat.locationInternalDamage),
            armorDamage: new ImmutableIndex(state.pendingCombat.armorDamage),
            criticalHits: new ImmutableIndex(state.pendingCombat.criticalHits),
            componentStatus: new ImmutableIndex(state.pendingCombat.componentStatus),
            shieldDamage: new ImmutableIndex([...state.pendingCombat.shieldDamage].map(([id, value]) => [
                id,
                Object.freeze({ ...value }),
            ] as const)),
            modularArmorDamage: new ImmutableIndex(state.pendingCombat.modularArmorDamage),
            locationConditions: new ImmutableIndex([...state.pendingCombat.locationConditions]
                .map(([locationId, conditions]) => [
                    locationId,
                    new ImmutableIndex(conditions),
                ] as const)),
        }),
    });
}
