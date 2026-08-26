// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../entity/base-entity';
import type { EntityStateView } from '../entity/entity-state-view';
import type { EntityType } from '../entity/types';
import { BV_MOVEMENT_CALCULATION, STANDARD_MOVEMENT_CALCULATION } from '../entity/types';
import { ImmutableIndex, ImmutableSet } from '../entity/immutable-collections';
import type {
    ArmorFaceId,
    ComponentId,
    CrewPositionId,
    SystemDamageTrackId,
    LocationId,
} from '../entity/entity-identifiers';
import type { EquipmentStatus } from '../equipment-status.model';
import { WeaponEquipment } from '../equipment.model';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type { CrewMemberState } from '../crew.model';
import type { MotiveModes } from '../motiveModes.model';
import {
    isAeroEntity,
    isInfantryFamilyEntity,
    isProtoMekEntity,
    isVehicleEntity,
} from '../entity/utils/entity-type-guards';
import {
    projectVehicleRuntimeRules,
    type VehicleRuntimeRulesProjection,
} from '../rules/vehicle-runtime-rules';
import {
    projectProtoMekRuntimeRules,
    type ProtoMekRuntimeRulesProjection,
} from '../rules/protomek-runtime-rules';
import {
    projectInfantryRuntimeRules,
    type InfantryRuntimeRulesProjection,
} from '../rules/infantry-runtime-rules';
import {
    projectAeroRuntimeRules,
    type AeroRuntimeRulesProjection,
} from '../rules/aero-runtime-rules';
import {
    asStateRevision,
    type AmmoRuntimeState,
    type ComponentRuntimeState,
    type InstanceBaselineRef,
    type StateRevision,
    type UnitInstanceId,
} from './runtime-state';
import {
    buildNonMekRuntimeIndex,
    type NonMekDamageTrack,
    type NonMekRuntimeIndex,
} from './non-mek-runtime-index';
import {
    projectNonMekComponentStatuses,
} from './non-mek-component-status';
import {
    entityAmmoLoadout,
    entityAmmoLoadouts,
    weaponAcceptsAmmo,
} from './mek-ammo';
import type { TargetRegistrySnapshot } from './encounter-runtime';
import {
    createPristineAttackerTargetingState,
    freezeAttackerTargetingState,
    MAX_ATTACKER_TARGETING_COMPONENTS,
    reconcileAttackerTargetingState,
    reduceAttackerTargetingCommand,
    type AttackerTargetingEdit,
    type AttackerTargetingState,
    type AttackerTargetingValidationContext,
} from './attacker-targeting-state';
import {
    freezeEquipmentRowOrder,
    setEquipmentRowOrder as updateEquipmentRowOrder,
    type EquipmentRowOrderGroup,
    type EquipmentRowOrderState,
} from './equipment-row-order';
import type { CBTUnitSelectedWeaponFireCommand } from './unit-instance';
import { rapidFireAutocannonShotCount } from './component-rapid-fire-autocannon';
import {
    isMascEquipment,
    movementBoosterUsableWhile,
} from './component-escalating-failure';
import { bombastLaserEquipmentProfile } from '../bombast-laser-mode.model';
import { isJumpJetEquipment, isUmuEquipment } from '../jump-equipment.model';
import type {
    ClassicCrewRuntimeState,
    ClassicLocationRuntimeState,
    ClassicUnitQueryPort,
    ClassicUnitRuntimeState,
    RuntimeStatePerspective,
} from './classic-unit-runtime';

export type NonMekEntityType = Exclude<EntityType, 'Mek'>;
export const NON_MEK_UNIT_RUNTIME_SCHEMA_VERSION = 5 as const;

export type NonMekCrewState = Extract<CrewMemberState, 'killed' | 'stunned'>;

/** Non-Mek-only crew states layered over the common wounds/consciousness row. */
export interface NonMekCrewRuntimeState extends ClassicCrewRuntimeState {
    readonly state?: NonMekCrewState;
}

const PRISTINE_NON_MEK_CREW_STATE: NonMekCrewRuntimeState = Object.freeze({
    wounds: 0,
    unconscious: false,
    ejected: false,
});

export function effectiveNonMekCrewState(
    state: NonMekCrewRuntimeState | undefined,
): CrewMemberState {
    const current = state ?? PRISTINE_NON_MEK_CREW_STATE;
    if (current.wounds >= 6) return 'dead';
    if (current.state !== undefined) return current.state;
    if (current.ejected) return 'ejected';
    return current.unconscious ? 'unconscious' : 'healthy';
}

export type NonMekLocationRuntimeState = ClassicLocationRuntimeState;

export interface NonMekDamageTrackRuntimeState {
    readonly hits: number;
    readonly hitTimestamps: readonly number[];
}

export interface NonMekPendingDamageTrackState {
    readonly hitDelta: number;
    readonly hitTimestamps: readonly number[];
}

export interface NonMekPendingCombatState {
    readonly locationInternalDamage: ReadonlyMap<LocationId, number>;
    readonly armorDamage: ReadonlyMap<ArmorFaceId, number>;
    readonly componentStatus: ReadonlyMap<ComponentId, EquipmentStatus>;
    readonly damageTrackHits: ReadonlyMap<SystemDamageTrackId, NonMekPendingDamageTrackState>;
}

export interface NonMekMovementDeclaration {
    readonly mode: MotiveModes;
    readonly distance: number;
    readonly boosterComponentIds: readonly ComponentId[];
}

/** Durable heat track for non-Mek families that use heat. */
export interface NonMekHeatRuntimeState {
    readonly current: number;
    readonly previous: number;
    readonly pendingOverride?: number;
    readonly heatsinksOff: number;
}

/** Per-unit turn facts that are not part of the immutable BaseEntity blueprint. */
export interface NonMekTurnRuntimeState {
    readonly turnCounter: number;
    readonly airborne: boolean | null;
    readonly movement: NonMekMovementDeclaration | null;
    readonly weaponsHeat: number;
}

/** Sparse state shared by non-Mek entity families. Family mechanics extend this state directly. */
export interface NonMekUnitRuntimeState extends ClassicUnitRuntimeState {
    readonly schemaVersion: typeof NON_MEK_UNIT_RUNTIME_SCHEMA_VERSION;
    readonly stateRevision: StateRevision;
    readonly family: Readonly<{
        readonly kind: 'non-mek';
        readonly entityType: NonMekEntityType;
    }>;
    /** Explicit user/import override; use query.destroyed() for effective destruction. */
    readonly explicitlyDestroyed: boolean;
    readonly locations: ReadonlyMap<LocationId, NonMekLocationRuntimeState>;
    readonly components: ReadonlyMap<ComponentId, ComponentRuntimeState>;
    readonly damageTracks: ReadonlyMap<SystemDamageTrackId, NonMekDamageTrackRuntimeState>;
    readonly ammo: ReadonlyMap<ComponentId, AmmoRuntimeState>;
    readonly crew: ReadonlyMap<CrewPositionId, NonMekCrewRuntimeState>;
    readonly conditions: ReadonlySet<string>;
    readonly heat: NonMekHeatRuntimeState;
    readonly turn: NonMekTurnRuntimeState;
    readonly attackerTargeting: AttackerTargetingState;
    /** Optional presentation-only permutations; BaseEntity component topology remains canonical. */
    readonly equipmentRowOrder?: EquipmentRowOrderState;
    readonly pendingCombat: NonMekPendingCombatState;
}

/** True when the sparse Non-Mek runtime has edits waiting for the phase commit. */
export function hasPendingNonMekChanges(state: NonMekUnitRuntimeState): boolean {
    return !pendingCombatEmpty(state.pendingCombat)
        || state.heat.pendingOverride !== undefined;
}

export interface NonMekMovementCapabilities {
    readonly destroyed: boolean;
    readonly immobile: boolean;
    readonly minimum: Readonly<Record<MotiveModes, number>>;
    readonly maximum: Readonly<Record<MotiveModes, number>>;
    readonly ordinaryRun: number;
    readonly boosterComponentIds: readonly ComponentId[];
}

const ZERO_NON_MEK_MOVEMENT: Readonly<Record<MotiveModes, number>> = Object.freeze({
    stationary: 0,
    walk: 0,
    run: 0,
    jump: 0,
    UMU: 0,
    VTOL: 0,
});

/** One direct non-Mek BaseEntity + rules + sparse-state projection shared by validation and UI. */
export function projectNonMekMovementCapabilities(
    entity: BaseEntity,
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
    ruleset: CBTRuleset,
): NonMekMovementCapabilities {
    const vehicle = isVehicleEntity(entity)
        ? projectVehicleRuntimeRules(entity, index, state, ruleset)
        : null;
    const protoMek = isProtoMekEntity(entity)
        ? projectProtoMekRuntimeRules(entity, index, state, ruleset)
        : null;
    const infantry = isInfantryFamilyEntity(entity)
        ? projectInfantryRuntimeRules(entity, index, state)
        : null;
    const aero = isAeroEntity(entity)
        ? projectAeroRuntimeRules(entity, index, state, ruleset)
        : null;
    const destroyed = vehicle?.destroyed
        ?? protoMek?.destroyed
        ?? infantry?.destroyed
        ?? aero?.destroyed
        ?? state.explicitlyDestroyed;
    const immobile = destroyed
        || state.conditions.has('immobile')
        || state.conditions.has('immobilized')
        || vehicle?.computedConditions.includes('immobile') === true
        || protoMek?.computedConditions.includes('immobile') === true;
    const boosterComponentIds = Object.freeze([...index.components.values()].flatMap(component => {
        const equipment = component.mount.equipment;
        const status = vehicle?.componentStatuses.get(component.id)
            ?? state.components.get(component.id)?.statusOverride
            ?? 'available';
        return movementBoosterUsableWhile(equipment, state.turn.airborne)
            && status === 'available'
            ? [component.id]
            : [];
    }));
    const ordinaryRun = entityMovementMaximum('run', false, state, entity, vehicle, immobile);
    return Object.freeze({
        destroyed,
        immobile,
        minimum: infantry?.movementMinimums ?? ZERO_NON_MEK_MOVEMENT,
        maximum: Object.freeze({
            stationary: 0,
            walk: entityMovementMaximum('walk', false, state, entity, vehicle, immobile),
            run: boosterComponentIds.length > 0
                ? entityMovementMaximum('run', true, state, entity, vehicle, immobile)
                : ordinaryRun,
            jump: entityMovementMaximum('jump', false, state, entity, vehicle, immobile),
            UMU: entityMovementMaximum('UMU', false, state, entity, vehicle, immobile),
            VTOL: entityMovementMaximum('VTOL', false, state, entity, vehicle, immobile),
        }),
        ordinaryRun,
        boosterComponentIds,
    });
}

export function supportsNonMekAirborneSelection(entity: BaseEntity): boolean {
    return entity.unitType() === 'VTOL' || entity.motiveType() === 'WiGE';
}

export interface NonMekAttackerTargetingCommand {
    readonly kind: 'edit-attacker-targeting';
    readonly expectedRevision: StateRevision;
    readonly expectedRegistryRevision: StateRevision;
    readonly edit: AttackerTargetingEdit;
}

export interface NonMekAttackerTargetingReconciliationPlan {
    readonly expectedRevision: StateRevision;
    readonly nextTargeting: AttackerTargetingState;
}

export type NonMekSelectedWeaponFireResult =
    | Readonly<{
        readonly accepted: true;
        readonly changed: true;
        readonly state: NonMekUnitRuntimeState;
    }>
    | Readonly<{
        readonly accepted: false;
        readonly reason:
            | 'REVISION_CONFLICT'
            | 'STALE_TARGET_REGISTRY'
            | 'FORCE_READ_ONLY'
            | 'INVALID_TARGETING'
            | 'INVALID_TARGET'
            | 'EXCEEDS_CAPACITY'
            | 'C3_UNAVAILABLE';
        readonly state: NonMekUnitRuntimeState;
    }>;

export type NonMekUnitCommand =
    | Readonly<{ readonly kind: 'set-destroyed'; readonly expectedRevision: StateRevision; readonly destroyed: boolean }>
    | Readonly<{ readonly kind: 'set-internal-damage'; readonly expectedRevision: StateRevision; readonly locationId: LocationId; readonly damage: number }>
    | Readonly<{ readonly kind: 'set-armor-damage'; readonly expectedRevision: StateRevision; readonly faceId: ArmorFaceId; readonly damage: number }>
    | Readonly<{ readonly kind: 'damage-internal'; readonly expectedRevision: StateRevision; readonly locationId: LocationId; readonly amount: number; readonly target: 'committed' | 'pending' }>
    | Readonly<{ readonly kind: 'repair-internal'; readonly expectedRevision: StateRevision; readonly locationId: LocationId; readonly amount: number; readonly target: 'committed' | 'pending' }>
    | Readonly<{ readonly kind: 'damage-armor'; readonly expectedRevision: StateRevision; readonly faceId: ArmorFaceId; readonly amount: number; readonly target: 'committed' | 'pending' }>
    | Readonly<{ readonly kind: 'repair-armor'; readonly expectedRevision: StateRevision; readonly faceId: ArmorFaceId; readonly amount: number; readonly target: 'committed' | 'pending' }>
    | Readonly<{ readonly kind: 'damage-track'; readonly expectedRevision: StateRevision; readonly damageTrackId: SystemDamageTrackId; readonly amount: number; readonly target: 'committed' | 'pending'; readonly timestamp: number }>
    | Readonly<{ readonly kind: 'repair-damage-track'; readonly expectedRevision: StateRevision; readonly damageTrackId: SystemDamageTrackId; readonly amount: number; readonly target: 'committed' | 'pending' }>
    | Readonly<{ readonly kind: 'set-sensor-damage-level'; readonly expectedRevision: StateRevision; readonly level: number; readonly target: 'committed' | 'pending'; readonly timestamp: number }>
    | Readonly<{ readonly kind: 'set-component-status'; readonly expectedRevision: StateRevision; readonly componentId: ComponentId; readonly status: EquipmentStatus; readonly target: 'committed' | 'pending' }>
    | Readonly<{ readonly kind: 'set-component-mode'; readonly expectedRevision: StateRevision; readonly componentId: ComponentId; readonly mode: string }>
    | Readonly<{ readonly kind: 'set-ammo-spent'; readonly expectedRevision: StateRevision; readonly componentId: ComponentId; readonly shotsSpent: number }>
    | Readonly<{ readonly kind: 'configure-ammo-source'; readonly expectedRevision: StateRevision; readonly componentId: ComponentId; readonly munitionKey: string; readonly remaining: number }>
    | Readonly<{ readonly kind: 'set-crew-state'; readonly expectedRevision: StateRevision; readonly positionId: CrewPositionId; readonly wounds: number; readonly unconscious: boolean; readonly ejected: boolean; readonly state?: NonMekCrewState }>
    | Readonly<{ readonly kind: 'set-condition'; readonly expectedRevision: StateRevision; readonly condition: string; readonly active: boolean }>
    | Readonly<{ readonly kind: 'set-heat'; readonly expectedRevision: StateRevision; readonly heat: number; readonly target: 'committed' | 'pending' }>
    | Readonly<{ readonly kind: 'set-heatsinks-off'; readonly expectedRevision: StateRevision; readonly heatsinksOff: number }>
    | Readonly<{ readonly kind: 'apply-heat'; readonly expectedRevision: StateRevision }>
    | Readonly<{ readonly kind: 'set-airborne'; readonly expectedRevision: StateRevision; readonly airborne: boolean | null }>
    | Readonly<{ readonly kind: 'set-movement'; readonly expectedRevision: StateRevision; readonly movement: NonMekMovementDeclaration | null }>
    | Readonly<{ readonly kind: 'end-phase'; readonly expectedRevision: StateRevision }>
    | Readonly<{ readonly kind: 'cancel-pending'; readonly expectedRevision: StateRevision }>
    | Readonly<{ readonly kind: 'end-turn'; readonly expectedRevision: StateRevision }>;

export type NonMekUnitCommandResult = Readonly<{
    readonly accepted: boolean;
    readonly changed: boolean;
    readonly state: NonMekUnitRuntimeState;
    readonly reason?:
        | 'STALE_REVISION'
        | 'STALE_TARGET_REGISTRY'
        | 'FORCE_READ_ONLY'
        | 'INVALID_TARGETING'
        | 'INVALID_COMMAND';
}>;

export function createPristineNonMekUnitState(entity: BaseEntity): NonMekUnitRuntimeState {
    if (entity.entityType === 'Mek') throw new Error('Meks require CBTUnitInstance');
    return freezeNonMekUnitState({
        schemaVersion: NON_MEK_UNIT_RUNTIME_SCHEMA_VERSION,
        stateRevision: asStateRevision(0),
        family: Object.freeze({ kind: 'non-mek', entityType: entity.entityType }),
        explicitlyDestroyed: false,
        locations: new Map(),
        components: new Map(),
        damageTracks: new Map(),
        ammo: new Map(),
        crew: new Map(),
        conditions: new Set(),
        heat: Object.freeze({ current: 0, previous: 0, heatsinksOff: 0 }),
        turn: Object.freeze({ turnCounter: 0, airborne: null, movement: null, weaponsHeat: 0 }),
        attackerTargeting: createPristineAttackerTargetingState(),
        pendingCombat: emptyPendingCombat(),
    });
}

export function freezeNonMekUnitState(state: NonMekUnitRuntimeState): NonMekUnitRuntimeState {
    const { equipmentRowOrder: rawEquipmentRowOrder, ...values } = state;
    const equipmentRowOrder = freezeEquipmentRowOrder(rawEquipmentRowOrder);
    return Object.freeze({
        ...values,
        family: Object.freeze({ ...state.family }),
        locations: new ImmutableIndex([...state.locations].map(([id, value]) => [
            id,
            Object.freeze({
                internalDamage: value.internalDamage,
                armorDamage: Object.freeze(value.armorDamage.map(entry => Object.freeze({ ...entry }))),
            }),
        ] as const)),
        components: new ImmutableIndex([...state.components].map(([id, value]) => [
            id,
            Object.freeze({ ...value }),
        ] as const)),
        damageTracks: new ImmutableIndex([...state.damageTracks].map(([id, value]) => [
            id,
            Object.freeze({
                hits: value.hits,
                hitTimestamps: Object.freeze([...value.hitTimestamps]),
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
        conditions: new ImmutableSet(state.conditions),
        heat: Object.freeze({ ...state.heat }),
        turn: Object.freeze({
            turnCounter: state.turn.turnCounter,
            airborne: state.turn.airborne,
            weaponsHeat: state.turn.weaponsHeat,
            movement: state.turn.movement === null
                ? null
                : Object.freeze({
                    ...state.turn.movement,
                    boosterComponentIds: Object.freeze([...state.turn.movement.boosterComponentIds]),
                }),
        }),
        attackerTargeting: freezeAttackerTargetingState(state.attackerTargeting),
        ...(equipmentRowOrder === undefined ? {} : { equipmentRowOrder }),
        pendingCombat: Object.freeze({
            locationInternalDamage: new ImmutableIndex(state.pendingCombat.locationInternalDamage),
            armorDamage: new ImmutableIndex(state.pendingCombat.armorDamage),
            componentStatus: new ImmutableIndex(state.pendingCombat.componentStatus),
            damageTrackHits: new ImmutableIndex([...state.pendingCombat.damageTrackHits].map(([id, value]) => [
                id,
                Object.freeze({
                    hitDelta: value.hitDelta,
                    hitTimestamps: Object.freeze([...value.hitTimestamps]),
                }),
            ] as const)),
        }),
    });
}

/** Direct non-Mek runtime. It owns sparse state and computes through its exact entity. */
export class NonMekUnitInstance {
    private state: NonMekUnitRuntimeState;
    private readonly index: NonMekRuntimeIndex;

    public constructor(
        public readonly id: UnitInstanceId,
        public readonly baselineRef: InstanceBaselineRef,
        private readonly entity: BaseEntity,
        public readonly ruleset: CBTRuleset,
        initialState: NonMekUnitRuntimeState = createPristineNonMekUnitState(entity),
    ) {
        if (entity.entityType === 'Mek') throw new Error('Meks require CBTUnitInstance');
        if (baselineRef.entity.uuid !== entity.uuid()) {
            throw new Error('Runtime baseline does not match the entity UUID');
        }
        if (baselineRef.ruleset !== ruleset) throw new Error('Runtime ruleset does not match its baseline');
        if (initialState.family.entityType !== entity.entityType) {
            throw new Error('Runtime family does not match the entity type');
        }
        this.index = buildNonMekRuntimeIndex(entity);
        this.state = validateState(initialState, this.index, entity, ruleset);
    }

    public getUnit(): BaseEntity {
        return this.entity;
    }

    public getIndex(): NonMekRuntimeIndex {
        return this.index;
    }

    public matchesEntity(entity: BaseEntity): boolean {
        return entity === this.entity;
    }

    public revision(): StateRevision {
        return this.state.stateRevision;
    }

    public snapshot(): NonMekUnitRuntimeState {
        return this.state;
    }

    /** Immutable, state-captured reads shared with the force-level snapshot. */
    public query(): ClassicUnitQueryPort {
        return createNonMekUnitQuery(this.entity, this.index, this.state, this.ruleset);
    }

    public turnState(): NonMekTurnRuntimeState {
        return this.state.turn;
    }

    public destroyed(): boolean {
        return this.query().destroyed();
    }

    public hasCondition(condition: string): boolean {
        return this.query().hasCondition(condition);
    }

    public conditions(): readonly string[] {
        return this.query().conditions();
    }

    public vehicleRules(): VehicleRuntimeRulesProjection | null {
        if (!isVehicleEntity(this.entity)) return null;
        return projectVehicleRuntimeRules(this.entity, this.index, this.state, this.ruleset);
    }

    public protoMekRules(): ProtoMekRuntimeRulesProjection | null {
        if (!isProtoMekEntity(this.entity)) return null;
        return projectProtoMekRuntimeRules(this.entity, this.index, this.state, this.ruleset);
    }

    public infantryRules(): InfantryRuntimeRulesProjection | null {
        if (!isInfantryFamilyEntity(this.entity)) return null;
        return projectInfantryRuntimeRules(this.entity, this.index, this.state);
    }

    public aeroRules(): AeroRuntimeRulesProjection | null {
        if (!isAeroEntity(this.entity)) return null;
        return projectAeroRuntimeRules(this.entity, this.index, this.state, this.ruleset);
    }

    public remainingInternal(locationId: LocationId): number {
        return this.query().remainingInternal(locationId);
    }

    public remainingArmor(faceId: ArmorFaceId): number {
        return this.query().remainingArmor(faceId);
    }

    public damageTrackHits(damageTrackId: SystemDamageTrackId, perspective: 'committed' | 'preview' = 'committed'): number {
        const definition = this.index.damageTracks.get(damageTrackId);
        if (!definition) throw new Error(`Unknown non-Mek damage track ${damageTrackId}`);
        const committed = this.state.damageTracks.get(damageTrackId)?.hits ?? 0;
        return perspective === 'committed'
            ? committed
            : committed + (this.state.pendingCombat.damageTrackHits.get(damageTrackId)?.hitDelta ?? 0);
    }

    public damageTrackTimeline(perspective: 'committed' | 'preview' = 'committed'): readonly Readonly<{
        readonly damageTrackId: SystemDamageTrackId;
        readonly timestamp: number;
    }>[] {
        return Object.freeze([...this.index.damageTracks.keys()]
            .flatMap(damageTrackId => damageTrackTimestamps(this.state, damageTrackId, perspective)
                .map(timestamp => Object.freeze({ damageTrackId, timestamp })))
            .sort((left, right) => left.timestamp - right.timestamp));
    }

    public componentStatus(
        componentId: ComponentId,
        perspective: 'committed' | 'preview' = 'committed',
    ): EquipmentStatus {
        return this.query().componentStatus(componentId, perspective);
    }

    public componentMode(componentId: ComponentId): string | undefined {
        return this.query().componentMode(componentId);
    }

    public ammoRemaining(componentId: ComponentId): number {
        return this.query().remainingAmmo(componentId);
    }

    public attackerTargetingState(): AttackerTargetingState {
        return this.state.attackerTargeting;
    }

    /** Updates presentation order without entering gameplay undo/history. */
    public setEquipmentRowOrder(
        expectedRevision: StateRevision,
        group: EquipmentRowOrderGroup,
        permutation: readonly number[],
        rowCount: number,
        forceReadOnly: boolean,
    ): NonMekUnitCommandResult {
        if (expectedRevision !== this.state.stateRevision) {
            return Object.freeze({
                accepted: false,
                changed: false,
                reason: 'STALE_REVISION',
                state: this.state,
            });
        }
        if (forceReadOnly) {
            return Object.freeze({
                accepted: false,
                changed: false,
                reason: 'FORCE_READ_ONLY',
                state: this.state,
            });
        }
        let equipmentRowOrder: EquipmentRowOrderState | undefined;
        try {
            equipmentRowOrder = updateEquipmentRowOrder(
                this.state.equipmentRowOrder,
                group,
                permutation,
                rowCount,
            );
        } catch {
            return Object.freeze({
                accepted: false,
                changed: false,
                reason: 'INVALID_COMMAND',
                state: this.state,
            });
        }
        if (equipmentRowOrder === this.state.equipmentRowOrder) {
            return Object.freeze({ accepted: true, changed: false, state: this.state });
        }
        const { equipmentRowOrder: _currentOrder, ...current } = this.state;
        this.state = freezeNonMekUnitState({
            ...current,
            stateRevision: nextRevision(this.state.stateRevision),
            ...(equipmentRowOrder === undefined ? {} : { equipmentRowOrder }),
        });
        return Object.freeze({ accepted: true, changed: true, state: this.state });
    }

    public dispatchAttackerTargeting(
        command: NonMekAttackerTargetingCommand,
        registry: TargetRegistrySnapshot,
        forceReadOnly: boolean,
    ): NonMekUnitCommandResult {
        if (command.expectedRevision !== this.state.stateRevision) {
            return Object.freeze({
                accepted: false,
                changed: false,
                reason: 'STALE_REVISION',
                state: this.state,
            });
        }
        if (forceReadOnly) {
            return Object.freeze({
                accepted: false,
                changed: false,
                reason: 'FORCE_READ_ONLY',
                state: this.state,
            });
        }
        if (command.edit.kind === 'set-component-selection'
            && command.edit.selection !== null
            && (this.destroyed()
                || this.state.components.get(command.edit.componentId)?.jammed === true
                || this.componentStatus(command.edit.componentId, 'committed') !== 'available')) {
            return Object.freeze({
                accepted: false,
                changed: false,
                reason: 'INVALID_TARGETING',
                state: this.state,
            });
        }
        const context = buildNonMekAttackerTargetingContext(
            this.entity,
            this.index,
            this.ruleset,
            this.state,
            registry,
            false,
        );
        const reduced = reduceAttackerTargetingCommand(this.state.attackerTargeting, context, {
            expectedRegistryRevision: command.expectedRegistryRevision,
            ...command.edit,
        });
        if (!reduced.accepted) {
            return Object.freeze({
                accepted: false,
                changed: false,
                reason: reduced.reason === 'STALE_REGISTRY'
                    ? 'STALE_TARGET_REGISTRY'
                    : reduced.reason === 'READ_ONLY'
                        ? 'FORCE_READ_ONLY'
                        : 'INVALID_TARGETING',
                state: this.state,
            });
        }
        if (!reduced.changed) {
            return Object.freeze({ accepted: true, changed: false, state: this.state });
        }
        this.state = freezeNonMekUnitState({
            ...this.state,
            stateRevision: nextRevision(this.state.stateRevision),
            attackerTargeting: reduced.state,
        });
        return Object.freeze({ accepted: true, changed: true, state: this.state });
    }

    /** Fires the current canonical weapon selections through the Non-Mek runtime owner. */
    public dispatchSelectedWeaponFire(
        command: CBTUnitSelectedWeaponFireCommand,
        registry: TargetRegistrySnapshot,
        forceReadOnly: boolean,
        c3Available: boolean,
    ): NonMekSelectedWeaponFireResult {
        const rejected = (reason: Extract<NonMekSelectedWeaponFireResult, { accepted: false }>['reason']) =>
            Object.freeze({ accepted: false as const, reason, state: this.state });
        if (command.expectedRevision !== this.state.stateRevision) return rejected('REVISION_CONFLICT');
        if (command.expectedRegistryRevision !== registry.revision) return rejected('STALE_TARGET_REGISTRY');
        if (forceReadOnly) return rejected('FORCE_READ_ONLY');
        if (command.heatPolicy !== 'automatic' && command.heatPolicy !== 'manual') {
            return rejected('INVALID_TARGET');
        }

        let context: AttackerTargetingValidationContext;
        try {
            context = buildNonMekAttackerTargetingContext(
                this.entity,
                this.index,
                this.ruleset,
                this.state,
                registry,
                false,
            );
        } catch {
            return rejected('INVALID_TARGETING');
        }
        const reconciled = reconcileAttackerTargetingState(this.state.attackerTargeting, context);
        if (!reconciled.accepted || reconciled.changed) return rejected('INVALID_TARGETING');

        const selected = [...this.state.attackerTargeting.components]
            .filter(([, component]) => component.selection !== undefined)
            .sort(([left], [right]) => compareText(left, right));
        if (selected.length === 0 || selected.length > MAX_ATTACKER_TARGETING_COMPONENTS) {
            return rejected('INVALID_TARGETING');
        }
        if (!c3Available && selected.some(([, component]) => component.selection?.kind === 'target'
            && this.state.attackerTargeting.targets.get(component.selection.targetId)?.useC3 === true)) {
            return rejected('C3_UNAVAILABLE');
        }

        const ammoSpends = new Map<ComponentId, number>();
        let heat = 0;
        const vehicle = this.vehicleRules();
        const infantry = this.infantryRules();
        if (this.destroyed() || this.hasCondition('shutdown')) return rejected('INVALID_TARGET');
        for (const [weaponId, targeting] of selected) {
            const component = this.index.components.get(weaponId);
            const weapon = component?.mount.equipment;
            if (!(weapon instanceof WeaponEquipment)
                || component?.mount.isPhysicalWeapon()
                || this.componentStatus(weaponId, 'committed') !== 'available'
                || this.state.components.get(weaponId)?.jammed === true
                || vehicle?.fireBlockedComponentIds.has(weaponId) === true
                || infantry?.fireBlockedComponentIds.has(weaponId) === true) {
                return rejected('INVALID_TARGET');
            }
            const mode = this.componentMode(weaponId);
            const shots = rapidFireAutocannonShotCount(weapon, mode);
            const bombast = bombastLaserEquipmentProfile(weapon, this.ruleset, mode);
            heat += (bombast?.heat ?? weapon.heat) * shots;
            if (!Number.isSafeInteger(heat) || heat < 0 || heat > 1_000_000) {
                return rejected('EXCEEDS_CAPACITY');
            }
            if (weapon.ammoType === 'NA') {
                if (targeting.ammo !== undefined) return rejected('INVALID_TARGET');
                continue;
            }
            const ammoSelection = targeting.ammo;
            if (!ammoSelection?.preferredSourceId) return rejected('INVALID_TARGET');
            const sourceId = ammoSelection.preferredSourceId;
            const source = this.index.components.get(sourceId);
            const runtimeAmmo = this.state.ammo.get(sourceId);
            const loadout = source === undefined ? null : entityAmmoLoadout(
                this.entity,
                source.mount,
                this.ruleset,
                runtimeAmmo?.munitionOverride,
            );
            if (!source
                || !loadout
                || loadout.munitionKey !== ammoSelection.munitionKey
                || this.componentStatus(sourceId, 'committed') !== 'available'
                || !weaponAcceptsAmmo(weapon, loadout.equipment, mode)) {
                return rejected('INVALID_TARGET');
            }
            ammoSpends.set(sourceId, (ammoSpends.get(sourceId) ?? 0) + shots);
        }

        const ammo = new Map(this.state.ammo);
        for (const [sourceId, amount] of ammoSpends) {
            const source = this.index.components.get(sourceId)!;
            const current = ammo.get(sourceId);
            const loadout = entityAmmoLoadout(
                this.entity,
                source.mount,
                this.ruleset,
                current?.munitionOverride,
            )!;
            const shotsSpent = (current?.shotsSpent ?? 0) + amount;
            if (shotsSpent > loadout.capacity) return rejected('EXCEEDS_CAPACITY');
            ammo.set(sourceId, Object.freeze({
                shotsSpent,
                ...(current?.munitionOverride === undefined
                    ? {}
                    : { munitionOverride: current.munitionOverride }),
            }));
        }
        const weaponsHeat = this.state.turn.weaponsHeat + (this.entity.tracksHeat() ? heat : 0);
        if (!Number.isSafeInteger(weaponsHeat) || weaponsHeat > 1_000_000) {
            return rejected('EXCEEDS_CAPACITY');
        }
        this.state = freezeNonMekUnitState({
            ...this.state,
            stateRevision: nextRevision(this.state.stateRevision),
            ammo,
            turn: Object.freeze({ ...this.state.turn, weaponsHeat }),
        });
        return Object.freeze({ accepted: true, changed: true, state: this.state });
    }

    public planAttackerTargetingReconciliation(
        registry: TargetRegistrySnapshot,
    ): NonMekAttackerTargetingReconciliationPlan | null {
        const context = buildNonMekAttackerTargetingContext(
            this.entity,
            this.index,
            this.ruleset,
            this.state,
            registry,
            false,
        );
        const reduced = reconcileAttackerTargetingState(this.state.attackerTargeting, context);
        if (!reduced.accepted) {
            throw new Error(`Non-Mek attacker targeting reconciliation failed: ${reduced.reason}`);
        }
        return reduced.changed
            ? Object.freeze({
                expectedRevision: this.state.stateRevision,
                nextTargeting: reduced.state,
            })
            : null;
    }

    public commitAttackerTargetingReconciliation(
        plan: NonMekAttackerTargetingReconciliationPlan,
    ): boolean {
        if (this.state.stateRevision !== plan.expectedRevision) return false;
        this.state = freezeNonMekUnitState({
            ...this.state,
            stateRevision: nextRevision(this.state.stateRevision),
            attackerTargeting: plan.nextTargeting,
        });
        return true;
    }

    public stateView(): EntityStateView {
        return projectNonMekStateView(this.entity, this.index, this.state, this.ruleset);
    }

    public battleValue(): number {
        return this.entity.battleValueFor(this.stateView(), this.ruleset);
    }

    public dispatch(command: NonMekUnitCommand): NonMekUnitCommandResult {
        if (command.expectedRevision !== this.state.stateRevision) {
            return Object.freeze({ accepted: false, changed: false, reason: 'STALE_REVISION', state: this.state });
        }
        let next: NonMekUnitRuntimeState | null;
        try {
            next = reduceNonMekUnitState(this.state, this.index, this.entity, this.ruleset, command);
        } catch {
            return Object.freeze({ accepted: false, changed: false, reason: 'INVALID_COMMAND', state: this.state });
        }
        if (next === null) return Object.freeze({ accepted: true, changed: false, state: this.state });
        this.state = next;
        return Object.freeze({ accepted: true, changed: true, state: next });
    }
}

function createNonMekUnitQuery(
    entity: BaseEntity,
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
    ruleset: CBTRuleset,
): ClassicUnitQueryPort {
    return Object.freeze({
        stateRevision: state.stateRevision,
        hasPendingCombat: () => hasPendingNonMekChanges(state),
        destroyed: () => entityRuntimeDestroyed(entity, index, state, ruleset),
        currentBaseBattleValue: () => entity.battleValueFor(
            projectNonMekStateView(entity, index, state, ruleset),
            ruleset,
        ),
        remainingArmor: (
            faceId: ArmorFaceId,
            perspective: RuntimeStatePerspective = 'committed',
        ) => entityRemainingArmor(index, state, faceId, perspective),
        remainingInternal: (
            locationId: LocationId,
            perspective: RuntimeStatePerspective = 'committed',
        ) => entityRemainingInternal(index, state, locationId, perspective),
        componentStatus: (
            componentId: ComponentId,
            perspective: RuntimeStatePerspective = 'committed',
        ) => entityComponentStatus(entity, index, state, ruleset, componentId, perspective),
        componentMode: (componentId: ComponentId) => {
            const component = index.components.get(componentId);
            if (!component) throw new Error(`Unknown entity component ${componentId}`);
            return state.components.get(componentId)?.mode ?? component.mount.equipment?.modes[0];
        },
        remainingAmmo: (componentId: ComponentId) => {
            const component = index.components.get(componentId);
            if (!component) throw new Error(`Unknown entity component ${componentId}`);
            const runtime = state.ammo.get(componentId);
            const capacity = entityAmmoLoadout(
                entity,
                component.mount,
                ruleset,
                runtime?.munitionOverride,
            )?.capacity ?? 0;
            return Math.max(0, capacity - (runtime?.shotsSpent ?? 0));
        },
        ammoEquipment: (componentId: ComponentId) => {
            const component = index.components.get(componentId);
            if (!component) throw new Error(`Unknown entity component ${componentId}`);
            return entityAmmoLoadout(
                entity,
                component.mount,
                ruleset,
                state.ammo.get(componentId)?.munitionOverride,
            )?.equipment ?? null;
        },
        attackerTargetingState: () => state.attackerTargeting,
        equipmentRowOrder: () => state.equipmentRowOrder,
        hasCondition: (condition: string) => entityHasCondition(
            entity,
            index,
            state,
            ruleset,
            normalizeCondition(condition),
        ),
        conditions: () => entityConditions(entity, index, state, ruleset),
        crewState: (positionId: CrewPositionId) => {
            if (!index.crewPositions.has(positionId)) {
                throw new Error(`Unknown entity crew position ${positionId}`);
            }
            return state.crew.get(positionId) ?? PRISTINE_NON_MEK_CREW_STATE;
        },
    });
}

function entityRuntimeDestroyed(
    entity: BaseEntity,
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
    ruleset: CBTRuleset,
): boolean {
    if (isVehicleEntity(entity)) return projectVehicleRuntimeRules(entity, index, state, ruleset).destroyed;
    if (isProtoMekEntity(entity)) return projectProtoMekRuntimeRules(entity, index, state, ruleset).destroyed;
    if (isInfantryFamilyEntity(entity)) return projectInfantryRuntimeRules(entity, index, state).destroyed;
    if (isAeroEntity(entity)) return projectAeroRuntimeRules(entity, index, state, ruleset).destroyed;
    return state.explicitlyDestroyed;
}

function entityHasCondition(
    entity: BaseEntity,
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
    ruleset: CBTRuleset,
    condition: string,
): boolean {
    if ((condition === 'airborne' && state.turn.airborne === true)
        || state.conditions.has(condition)) return true;
    if (isVehicleEntity(entity)) {
        return projectVehicleRuntimeRules(entity, index, state, ruleset)
            .computedConditions.includes(condition);
    }
    if (isProtoMekEntity(entity)) {
        return projectProtoMekRuntimeRules(entity, index, state, ruleset)
            .computedConditions.includes(condition);
    }
    if (isAeroEntity(entity)) {
        return projectAeroRuntimeRules(entity, index, state, ruleset)
            .computedConditions.includes(condition);
    }
    return false;
}

function entityConditions(
    entity: BaseEntity,
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
    ruleset: CBTRuleset,
): readonly string[] {
    const conditions = new Set(state.conditions);
    if (state.turn.airborne === true) conditions.add('airborne');
    if (isVehicleEntity(entity)) {
        projectVehicleRuntimeRules(entity, index, state, ruleset)
            .computedConditions.forEach(condition => conditions.add(condition));
    } else if (isProtoMekEntity(entity)) {
        projectProtoMekRuntimeRules(entity, index, state, ruleset)
            .computedConditions.forEach(condition => conditions.add(condition));
    } else if (isAeroEntity(entity)) {
        projectAeroRuntimeRules(entity, index, state, ruleset)
            .computedConditions.forEach(condition => conditions.add(condition));
    }
    return Object.freeze([...conditions]);
}

function entityRemainingArmor(
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
    faceId: ArmorFaceId,
    perspective: RuntimeStatePerspective,
): number {
    const face = index.armorFaces.get(faceId);
    if (!face) throw new Error(`Unknown entity armor face ${faceId}`);
    const committed = armorDamage(state, face.locationId, faceId);
    const damage = committed + (perspective === 'preview'
        ? state.pendingCombat.armorDamage.get(faceId) ?? 0
        : 0);
    return Math.max(0, face.maximumPoints - damage);
}

function entityRemainingInternal(
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
    locationId: LocationId,
    perspective: RuntimeStatePerspective,
): number {
    const location = index.locations.get(locationId);
    if (!location) throw new Error(`Unknown entity location ${locationId}`);
    const committed = state.locations.get(locationId)?.internalDamage ?? 0;
    const damage = committed + (perspective === 'preview'
        ? state.pendingCombat.locationInternalDamage.get(locationId) ?? 0
        : 0);
    return Math.max(0, location.internalPoints - damage);
}

function entityComponentStatus(
    entity: BaseEntity,
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
    ruleset: CBTRuleset,
    componentId: ComponentId,
    perspective: RuntimeStatePerspective,
): EquipmentStatus {
    if (!index.components.has(componentId)) throw new Error(`Unknown entity component ${componentId}`);
    if (isVehicleEntity(entity)) {
        const projection = projectVehicleRuntimeRules(entity, index, state, ruleset);
        return (perspective === 'preview'
            ? projection.previewComponentStatuses
            : projection.componentStatuses).get(componentId) ?? 'available';
    }
    const projection = projectNonMekComponentStatuses(index, state);
    return (perspective === 'preview' ? projection.preview : projection.committed)
        .get(componentId) ?? 'available';
}

function projectNonMekStateView(
    entity: BaseEntity,
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
    ruleset: CBTRuleset,
): EntityStateView {
    const vehicle = isVehicleEntity(entity)
        ? projectVehicleRuntimeRules(entity, index, state, ruleset)
        : null;
    const protoMek = isProtoMekEntity(entity)
        ? projectProtoMekRuntimeRules(entity, index, state, ruleset)
        : null;
    const infantry = isInfantryFamilyEntity(entity)
        ? projectInfantryRuntimeRules(entity, index, state)
        : null;
    const aero = isAeroEntity(entity)
        ? projectAeroRuntimeRules(entity, index, state, ruleset)
        : null;
    const destroyed = vehicle?.destroyed
        ?? protoMek?.destroyed
        ?? infantry?.destroyed
        ?? aero?.destroyed
        ?? state.explicitlyDestroyed;
    const immobile = destroyed
        || protoMek?.computedConditions.includes('immobile') === true
        || state.conditions.has('immobile')
        || state.conditions.has('immobilized');
    const statuses = vehicle === null ? projectNonMekComponentStatuses(index, state) : null;
    const status = (componentId: ComponentId): EquipmentStatus => vehicle === null
        ? statuses!.committed.get(componentId) ?? 'available'
        : vehicle.componentStatuses.get(componentId) ?? 'available';
    const protoJump = protoMek === null ? null : [...index.components.values()]
        .filter(component => isJumpJetEquipment(component.mount.equipment)
            && status(component.id) === 'available').length;
    const protoUmu = protoMek === null ? null : [...index.components.values()]
        .filter(component => isUmuEquipment(component.mount.equipment)
            && status(component.id) === 'available').length;
    const movement = Object.freeze({
        walk: immobile ? 0 : vehicle?.movement.walk ?? entity.computeWalkMP(BV_MOVEMENT_CALCULATION),
        run: immobile ? 0 : vehicle?.movement.maxRun ?? entity.computeRunMP(BV_MOVEMENT_CALCULATION),
        jump: immobile ? 0 : protoJump ?? entity.computeJumpMP(BV_MOVEMENT_CALCULATION),
        umu: immobile ? 0 : protoUmu ?? entity.umuMP(),
    });
    return Object.freeze({
        destroyed,
        movement,
        engineHits: vehicle?.systems.engineHit ? 1 : 0,
        equipmentStatus: (mountId: string) => status(mountId as ComponentId),
        armorRemaining: (location: string, face: 'front' | 'rear') => {
            const locationRow = [...index.locations.values()].find(row => row.code === location);
            const faceRow = locationRow?.armorFaceIds
                .map(id => index.armorFaces.get(id))
                .find(row => row?.face === face);
            return faceRow ? entityRemainingArmor(index, state, faceRow.id, 'committed') : 0;
        },
        structureRemaining: (location: string) => {
            const row = [...index.locations.values()].find(candidate => candidate.code === location);
            return row ? entityRemainingInternal(index, state, row.id, 'committed') : 0;
        },
        ammoRemaining: (mountId: string) => {
            const component = index.components.get(mountId as ComponentId);
            if (!component) throw new Error(`Runtime has no component for mount ${mountId}`);
            const runtime = state.ammo.get(component.id);
            const capacity = entityAmmoLoadout(
                entity,
                component.mount,
                ruleset,
                runtime?.munitionOverride,
            )?.capacity ?? 0;
            return Math.max(0, capacity - (runtime?.shotsSpent ?? 0));
        },
        ammoEquipment: (mountId: string) => {
            const component = index.components.get(mountId as ComponentId);
            if (!component) throw new Error(`Runtime has no component for mount ${mountId}`);
            return entityAmmoLoadout(
                entity,
                component.mount,
                ruleset,
                state.ammo.get(component.id)?.munitionOverride,
            )?.equipment ?? null;
        },
    });
}

function reduceNonMekUnitState(
    state: NonMekUnitRuntimeState,
    index: NonMekRuntimeIndex,
    entity: BaseEntity,
    ruleset: CBTRuleset,
    command: NonMekUnitCommand,
): NonMekUnitRuntimeState | null {
    let candidate: Omit<NonMekUnitRuntimeState, 'stateRevision'> & { stateRevision: StateRevision } = state;
    switch (command.kind) {
        case 'set-destroyed':
            if (state.explicitlyDestroyed === command.destroyed) return null;
            candidate = { ...state, explicitlyDestroyed: command.destroyed };
            break;
        case 'set-internal-damage': {
            const location = index.locations.get(command.locationId);
            const damage = boundedDamage(command.damage, location?.internalPoints);
            if (!location) throw new Error('Unknown location');
            const current = state.locations.get(command.locationId);
            if ((current?.internalDamage ?? 0) === damage) return null;
            const locations = new Map(state.locations);
            const armorDamage = current?.armorDamage ?? [];
            if (damage === 0 && armorDamage.length === 0) locations.delete(command.locationId);
            else locations.set(command.locationId, Object.freeze({ internalDamage: damage, armorDamage }));
            candidate = { ...state, locations };
            break;
        }
        case 'set-armor-damage': {
            const face = index.armorFaces.get(command.faceId);
            const damage = boundedDamage(command.damage, face?.maximumPoints);
            if (!face) throw new Error('Unknown armor face');
            const current = state.locations.get(face.locationId);
            const currentDamage = current?.armorDamage.find(entry => entry.faceId === face.id)?.damage ?? 0;
            if (currentDamage === damage) return null;
            const armor = new Map((current?.armorDamage ?? []).map(entry => [entry.faceId, entry.damage] as const));
            if (damage === 0) armor.delete(face.id);
            else armor.set(face.id, damage);
            const locations = new Map(state.locations);
            const internalDamage = current?.internalDamage ?? 0;
            const armorDamage = [...armor]
                .sort(([left], [right]) => String(left).localeCompare(String(right)))
                .map(([faceId, value]) => Object.freeze({ faceId, damage: value }));
            if (internalDamage === 0 && armorDamage.length === 0) locations.delete(face.locationId);
            else locations.set(face.locationId, Object.freeze({ internalDamage, armorDamage }));
            candidate = { ...state, locations };
            break;
        }
        case 'damage-internal':
        case 'repair-internal': {
            const location = index.locations.get(command.locationId);
            if (!location) throw new Error('Unknown location');
            const delta = command.kind === 'damage-internal'
                ? positiveAmount(command.amount)
                : -positiveAmount(command.amount);
            candidate = changeInternalDamage(state, location.id, location.internalPoints, delta, command.target);
            if (candidate === state) return null;
            break;
        }
        case 'damage-armor':
        case 'repair-armor': {
            const face = index.armorFaces.get(command.faceId);
            if (!face) throw new Error('Unknown armor face');
            const delta = command.kind === 'damage-armor'
                ? positiveAmount(command.amount)
                : -positiveAmount(command.amount);
            candidate = changeArmorDamage(state, face.locationId, face.id, face.maximumPoints, delta, command.target);
            if (candidate === state) return null;
            break;
        }
        case 'damage-track':
        case 'repair-damage-track': {
            const definition = index.damageTracks.get(command.damageTrackId);
            if (!definition) throw new Error('Unknown non-Mek damage track');
            const delta = command.kind === 'damage-track'
                ? positiveAmount(command.amount)
                : -positiveAmount(command.amount);
            candidate = changeDamageTrackHits(
                state,
                definition.id,
                definition.maximumHits,
                delta,
                command.target,
                command.kind === 'damage-track' ? command.timestamp : undefined,
            );
            if (candidate === state) return null;
            break;
        }
        case 'set-sensor-damage-level':
            candidate = setSensorDamageLevel(
                state,
                index,
                command.level,
                command.target,
                command.timestamp,
            );
            if (candidate === state) return null;
            break;
        case 'set-component-status': {
            if (!index.components.has(command.componentId)) throw new Error('Unknown component');
            const committedStatus = state.components.get(command.componentId)?.statusOverride ?? 'available';
            if (command.target === 'pending') {
                const currentStatus = state.pendingCombat.componentStatus.get(command.componentId)
                    ?? committedStatus;
                if (currentStatus === command.status) return null;
                const componentStatus = new Map(state.pendingCombat.componentStatus);
                if (command.status === committedStatus) componentStatus.delete(command.componentId);
                else componentStatus.set(command.componentId, command.status);
                candidate = {
                    ...state,
                    pendingCombat: { ...state.pendingCombat, componentStatus },
                };
                break;
            }
            if (committedStatus === command.status) return null;
            candidate = {
                ...state,
                components: setComponentStatus(state.components, command.componentId, command.status),
            };
            break;
        }
        case 'set-component-mode': {
            const component = index.components.get(command.componentId);
            const modes = component?.mount.equipment?.modes ?? [];
            const status = state.components.get(command.componentId)?.statusOverride
                ?? 'available';
            if (!component || status !== 'available' || !modes.includes(command.mode)) {
                throw new Error('Invalid component mode');
            }
            const defaultMode = modes[0];
            const current = state.components.get(command.componentId);
            if ((current?.mode ?? defaultMode) === command.mode) return null;
            const components = new Map(state.components);
            if (command.mode === defaultMode) {
                const { mode: _removed, ...remaining } = current ?? {};
                if (Object.keys(remaining).length === 0) components.delete(command.componentId);
                else components.set(command.componentId, remaining);
            } else {
                components.set(command.componentId, { ...current, mode: command.mode });
            }
            candidate = { ...state, components };
            break;
        }
        case 'set-ammo-spent': {
            const component = index.components.get(command.componentId);
            const current = state.ammo.get(command.componentId);
            const maximum = component
                ? entityAmmoLoadout(
                    entity,
                    component.mount,
                    ruleset,
                    current?.munitionOverride,
                )?.capacity
                : undefined;
            const shotsSpent = boundedDamage(command.shotsSpent, maximum);
            if (!component || maximum === undefined) throw new Error('Component is not ammunition');
            if ((current?.shotsSpent ?? 0) === shotsSpent) return null;
            const ammo = new Map(state.ammo);
            if (shotsSpent === 0 && current?.munitionOverride === undefined) ammo.delete(command.componentId);
            else ammo.set(command.componentId, { ...current, shotsSpent });
            candidate = { ...state, ammo };
            break;
        }
        case 'configure-ammo-source': {
            const component = index.components.get(command.componentId);
            if (!component) throw new Error('Unknown component');
            const loadout = entityAmmoLoadout(entity, component.mount, ruleset, command.munitionKey);
            if (!loadout
                || !Number.isSafeInteger(command.remaining)
                || command.remaining < 0
                || command.remaining > loadout.capacity) {
                throw new Error('Invalid ammunition loadout');
            }
            const equipment = component.mount.equipment;
            const defaultMunitionKey = equipment?.internalName;
            if (defaultMunitionKey === undefined) throw new Error('Component is not ammunition');
            const nextAmmo = Object.freeze({
                shotsSpent: loadout.capacity - command.remaining,
                ...(command.munitionKey === defaultMunitionKey
                    ? {}
                    : { munitionOverride: command.munitionKey }),
            });
            const current = state.ammo.get(command.componentId);
            if ((current?.shotsSpent ?? 0) === nextAmmo.shotsSpent
                && current?.munitionOverride === nextAmmo.munitionOverride) return null;
            const ammo = new Map(state.ammo);
            if (nextAmmo.shotsSpent === 0 && nextAmmo.munitionOverride === undefined) {
                ammo.delete(command.componentId);
            } else ammo.set(command.componentId, nextAmmo);
            candidate = { ...state, ammo };
            break;
        }
        case 'set-crew-state': {
            if (!index.crewPositions.has(command.positionId)
                || !Number.isSafeInteger(command.wounds) || command.wounds < 0 || command.wounds > 6
                || (command.state !== undefined && command.state !== 'killed' && command.state !== 'stunned')
                || (command.state !== undefined && (command.unconscious || command.ejected))
                || (command.unconscious && command.ejected)) {
                throw new Error('Invalid crew state');
            }
            const nextCrew = Object.freeze({
                wounds: command.wounds,
                unconscious: command.unconscious,
                ejected: command.ejected,
                ...(command.state === undefined ? {} : { state: command.state }),
            });
            const current = state.crew.get(command.positionId) ?? PRISTINE_NON_MEK_CREW_STATE;
            if (current.wounds === nextCrew.wounds
                && current.unconscious === nextCrew.unconscious
                && current.ejected === nextCrew.ejected
                && current.state === nextCrew.state) return null;
            const crew = new Map(state.crew);
            if (nextCrew.wounds === 0 && !nextCrew.unconscious && !nextCrew.ejected
                && nextCrew.state === undefined) crew.delete(command.positionId);
            else crew.set(command.positionId, nextCrew);
            candidate = { ...state, crew };
            break;
        }
        case 'set-condition': {
            const condition = normalizeCondition(command.condition);
            const active = state.conditions.has(condition);
            if (active === command.active) return null;
            const conditions = new Set(state.conditions);
            if (command.active) conditions.add(condition);
            else conditions.delete(condition);
            candidate = { ...state, conditions };
            break;
        }
        case 'set-heat': {
            if (!entity.tracksHeat()) throw new Error('Non-Mek unit does not track heat');
            const heat = boundedHeat(command.heat);
            if (command.target === 'pending') {
                const pendingOverride = heat === state.heat.current ? undefined : heat;
                if (state.heat.pendingOverride === pendingOverride) return null;
                candidate = { ...state, heat: { ...state.heat, pendingOverride } };
                break;
            }
            if (state.heat.current === heat && state.heat.pendingOverride === undefined) return null;
            candidate = {
                ...state,
                heat: {
                    current: heat,
                    previous: heat === state.heat.current ? state.heat.previous : state.heat.current,
                    heatsinksOff: state.heat.heatsinksOff,
                },
            };
            break;
        }
        case 'set-heatsinks-off': {
            if (!entity.tracksHeat()) throw new Error('Non-Mek unit does not track heat');
            const heatsinksOff = boundedHeatsinksOff(command.heatsinksOff, entity.engineHeatSinks());
            if (state.heat.heatsinksOff === heatsinksOff) return null;
            candidate = { ...state, heat: { ...state.heat, heatsinksOff } };
            break;
        }
        case 'apply-heat':
            if (!entity.tracksHeat()) throw new Error('Non-Mek unit does not track heat');
            if (state.heat.pendingOverride === undefined) return null;
            candidate = commitPendingHeat(state);
            break;
        case 'set-airborne':
            if (!supportsNonMekAirborneSelection(entity)
                || (command.airborne !== null && typeof command.airborne !== 'boolean')) {
                throw new Error('Invalid airborne state');
            }
            if (state.turn.airborne === command.airborne && state.turn.movement === null) return null;
            candidate = {
                ...state,
                turn: Object.freeze({
                    ...state.turn,
                    airborne: command.airborne,
                    movement: null,
                }),
            };
            break;
        case 'set-movement': {
            const movement = validateNonMekMovement(command.movement, state, index, entity, ruleset);
            if (sameNonMekMovement(state.turn.movement, movement)) return null;
            candidate = {
                ...state,
                turn: Object.freeze({ ...state.turn, movement }),
            };
            break;
        }
        case 'end-phase':
            candidate = commitPendingNonMekChanges(state, index);
            break;
        case 'cancel-pending':
            if (!hasPendingNonMekChanges(state)) return null;
            candidate = {
                ...state,
                heat: clearPendingHeat(state.heat),
                pendingCombat: emptyPendingCombat(),
            };
            break;
        case 'end-turn': {
            if (state.turn.turnCounter >= Number.MAX_SAFE_INTEGER) {
                throw new Error('Non-Mek turn counter is exhausted');
            }
            const pendingHeatWasExplicit = state.heat.pendingOverride !== undefined;
            let committed = commitPendingNonMekChanges(state, index);
            if (isAeroEntity(entity) && entity.tracksHeat() && !pendingHeatWasExplicit) {
                const dissipation = projectAeroRuntimeRules(
                    entity,
                    index,
                    committed,
                    ruleset,
                ).heat.dissipation;
                const heat = boundedHeat(Math.max(
                    0,
                    committed.heat.current + committed.turn.weaponsHeat - dissipation,
                ));
                committed = {
                    ...committed,
                    heat: {
                        current: heat,
                        previous: committed.heat.current,
                        heatsinksOff: committed.heat.heatsinksOff,
                    },
                };
            }
            candidate = {
                ...committed,
                turn: Object.freeze({
                    turnCounter: state.turn.turnCounter + 1,
                    airborne: null,
                    movement: null,
                    weaponsHeat: 0,
                }),
            };
            break;
        }
    }
    return freezeNonMekUnitState({ ...candidate, stateRevision: nextRevision(state.stateRevision) });
}

function buildNonMekAttackerTargetingContext(
    entity: BaseEntity,
    index: NonMekRuntimeIndex,
    ruleset: CBTRuleset,
    state: NonMekUnitRuntimeState,
    registry: TargetRegistrySnapshot,
    forceReadOnly: boolean,
): AttackerTargetingValidationContext {
    const targets = registry.targets.map(target => Object.freeze({
        id: target.id,
        source: target.source ?? 'manual' as const,
        readOnly: target.readOnly ?? false,
    }));
    const weapons = [...index.components.values()]
        .filter(component => component.mount.equipment instanceof WeaponEquipment
            && !component.mount.isPhysicalWeapon())
        .map(component => {
            const weapon = component.mount.equipment;
            if (!(weapon instanceof WeaponEquipment)) throw new Error('Invalid non-Mek weapon mount');
            const selectedMode = state.components.get(component.id)?.mode ?? weapon.modes[0];
            const sources = [...index.components.values()].flatMap(source => {
                const munitionKeys = entityAmmoLoadouts(entity, source.mount, ruleset)
                    .filter(loadout => weaponAcceptsAmmo(weapon, loadout.equipment, selectedMode))
                    .map(loadout => loadout.munitionKey)
                    .sort(compareText);
                return munitionKeys.length === 0
                    ? []
                    : [Object.freeze({
                        componentId: source.id,
                        munitionKeys: Object.freeze(munitionKeys),
                    })];
            }).sort((left, right) => compareText(left.componentId, right.componentId));
            return Object.freeze({
                componentId: component.id,
                compatibleMunitionKeys: Object.freeze([...new Set(
                    sources.flatMap(source => source.munitionKeys),
                )].sort(compareText)),
                sources: Object.freeze(sources),
            });
        }).sort((left, right) => compareText(left.componentId, right.componentId));
    const actions = Object.freeze([
        ...[...index.components.values()]
            .filter(component => component.mount.isPhysicalWeapon())
            .map(component => Object.freeze({
                kind: 'component' as const,
                componentId: component.id,
            })),
        ...entity.intrinsicWeapons().map(action => Object.freeze({
            kind: 'intrinsic' as const,
            actionId: action.id,
        })),
    ]);
    return Object.freeze({
        registryRevision: registry.revision,
        forceReadOnly,
        targets: Object.freeze(targets),
        weapons: Object.freeze(weapons),
        actions,
    });
}

function commitPendingNonMekChanges(
    state: NonMekUnitRuntimeState,
    index: NonMekRuntimeIndex,
): NonMekUnitRuntimeState {
    return commitPendingHeat(commitPendingCombat(state, index));
}

function commitPendingHeat(state: NonMekUnitRuntimeState): NonMekUnitRuntimeState {
    const pending = state.heat.pendingOverride;
    if (pending === undefined) return state;
    return {
        ...state,
        heat: {
            current: pending,
            previous: state.heat.current,
            heatsinksOff: state.heat.heatsinksOff,
        },
        turn: Object.freeze({ ...state.turn, weaponsHeat: 0 }),
    };
}

function clearPendingHeat(heat: NonMekHeatRuntimeState): NonMekHeatRuntimeState {
    if (heat.pendingOverride === undefined) return heat;
    return Object.freeze({
        current: heat.current,
        previous: heat.previous,
        heatsinksOff: heat.heatsinksOff,
    });
}

function commitPendingCombat(
    state: NonMekUnitRuntimeState,
    index: NonMekRuntimeIndex,
): NonMekUnitRuntimeState {
    if (pendingCombatEmpty(state.pendingCombat)) return state;
    let next = state;
    for (const [locationId, delta] of state.pendingCombat.locationInternalDamage) {
        const maximum = index.locations.get(locationId)?.internalPoints;
        if (maximum === undefined) continue;
        next = setLocationDamage(next, locationId, Math.min(maximum,
            Math.max(0, (next.locations.get(locationId)?.internalDamage ?? 0) + delta)));
    }
    for (const [faceId, delta] of state.pendingCombat.armorDamage) {
        const face = index.armorFaces.get(faceId);
        if (!face) continue;
        const damage = Math.min(face.maximumPoints,
            Math.max(0, armorDamage(next, face.locationId, faceId) + delta));
        next = setArmorDamage(next, face.locationId, faceId, damage);
    }
    let components = next.components;
    for (const [componentId, status] of state.pendingCombat.componentStatus) {
        if (!index.components.has(componentId)) continue;
        components = setComponentStatus(components, componentId, status);
    }
    const damageTracks = new Map(next.damageTracks);
    for (const [damageTrackId, pending] of state.pendingCombat.damageTrackHits) {
        if (!index.damageTracks.has(damageTrackId)) continue;
        const current = damageTracks.get(damageTrackId);
        const currentHits = current?.hits ?? 0;
        const hits = currentHits + pending.hitDelta;
        const hitTimestamps = pending.hitDelta > 0
            ? [...(current?.hitTimestamps ?? []), ...pending.hitTimestamps].sort(compareNumbers)
            : [...(current?.hitTimestamps ?? [])].sort(compareNumbers).slice(0, hits);
        if (hits === 0) damageTracks.delete(damageTrackId);
        else damageTracks.set(damageTrackId, { hits, hitTimestamps });
    }
    return { ...next, components, damageTracks, pendingCombat: emptyPendingCombat() };
}

function setComponentStatus(
    currentComponents: ReadonlyMap<ComponentId, ComponentRuntimeState>,
    componentId: ComponentId,
    status: EquipmentStatus,
): Map<ComponentId, ComponentRuntimeState> {
    const current = currentComponents.get(componentId);
    const components = new Map(currentComponents);
    if (status !== 'available') {
        components.set(componentId, { ...current, statusOverride: status });
        return components;
    }
    if (!current) return components;
    const { statusOverride: _removed, ...rest } = current;
    if (Object.keys(rest).length === 0) components.delete(componentId);
    else components.set(componentId, rest);
    return components;
}

function setLocationDamage(
    state: NonMekUnitRuntimeState,
    locationId: LocationId,
    internalDamage: number,
): NonMekUnitRuntimeState {
    const current = state.locations.get(locationId);
    const armorDamage = current?.armorDamage ?? [];
    const locations = new Map(state.locations);
    if (internalDamage === 0 && armorDamage.length === 0) locations.delete(locationId);
    else locations.set(locationId, { internalDamage, armorDamage });
    return { ...state, locations };
}

function setArmorDamage(
    state: NonMekUnitRuntimeState,
    locationId: LocationId,
    faceId: ArmorFaceId,
    damage: number,
): NonMekUnitRuntimeState {
    const current = state.locations.get(locationId);
    const values = new Map((current?.armorDamage ?? []).map(entry => [entry.faceId, entry.damage] as const));
    if (damage === 0) values.delete(faceId);
    else values.set(faceId, damage);
    const armorDamage = [...values].map(([id, value]) => ({ faceId: id, damage: value }));
    const internalDamage = current?.internalDamage ?? 0;
    const locations = new Map(state.locations);
    if (internalDamage === 0 && armorDamage.length === 0) locations.delete(locationId);
    else locations.set(locationId, { internalDamage, armorDamage });
    return { ...state, locations };
}

function changeInternalDamage(
    state: NonMekUnitRuntimeState,
    locationId: LocationId,
    maximum: number,
    delta: number,
    target: 'committed' | 'pending',
): NonMekUnitRuntimeState {
    const committed = state.locations.get(locationId)?.internalDamage ?? 0;
    if (target === 'committed') {
        return setLocationDamage(state, locationId, boundedDamage(committed + delta, maximum));
    }
    const pending = state.pendingCombat.locationInternalDamage.get(locationId) ?? 0;
    boundedDamage(committed + pending + delta, maximum);
    const values = new Map(state.pendingCombat.locationInternalDamage);
    const next = pending + delta;
    if (next === 0) values.delete(locationId);
    else values.set(locationId, next);
    return {
        ...state,
        pendingCombat: { ...state.pendingCombat, locationInternalDamage: values },
    };
}

function changeArmorDamage(
    state: NonMekUnitRuntimeState,
    locationId: LocationId,
    faceId: ArmorFaceId,
    maximum: number,
    delta: number,
    target: 'committed' | 'pending',
): NonMekUnitRuntimeState {
    const committed = armorDamage(state, locationId, faceId);
    if (target === 'committed') {
        return setArmorDamage(state, locationId, faceId, boundedDamage(committed + delta, maximum));
    }
    const pending = state.pendingCombat.armorDamage.get(faceId) ?? 0;
    boundedDamage(committed + pending + delta, maximum);
    const values = new Map(state.pendingCombat.armorDamage);
    const next = pending + delta;
    if (next === 0) values.delete(faceId);
    else values.set(faceId, next);
    return {
        ...state,
        pendingCombat: { ...state.pendingCombat, armorDamage: values },
    };
}

function changeDamageTrackHits(
    state: NonMekUnitRuntimeState,
    damageTrackId: SystemDamageTrackId,
    maximum: number,
    delta: number,
    target: 'committed' | 'pending',
    timestamp?: number,
): NonMekUnitRuntimeState {
    const current = state.damageTracks.get(damageTrackId);
    const committedHits = current?.hits ?? 0;
    if (target === 'committed') {
        const hits = boundedDamage(committedHits + delta, maximum);
        const committedTimestamps = [...(current?.hitTimestamps ?? [])].sort(compareNumbers);
        const hitTimestamps = delta > 0
            ? [...committedTimestamps, ...newHitTimestamps(timestamp, delta)].sort(compareNumbers)
            : committedTimestamps.slice(0, hits);
        const damageTracks = new Map(state.damageTracks);
        if (hits === 0) damageTracks.delete(damageTrackId);
        else damageTracks.set(damageTrackId, { hits, hitTimestamps });
        return { ...state, damageTracks };
    }

    const currentPending = state.pendingCombat.damageTrackHits.get(damageTrackId);
    const currentDelta = currentPending?.hitDelta ?? 0;
    const nextDelta = currentDelta + delta;
    boundedDelta(nextDelta, committedHits, maximum);
    const nextTimestampCount = Math.max(0, nextDelta);
    const currentTimestamps = [...(currentPending?.hitTimestamps ?? [])].sort(compareNumbers);
    const missingTimestamps = nextTimestampCount - currentTimestamps.length;
    const hitTimestamps = missingTimestamps > 0
        ? [...currentTimestamps, ...newHitTimestamps(timestamp, missingTimestamps)].sort(compareNumbers)
        : currentTimestamps.slice(0, nextTimestampCount);
    const values = new Map(state.pendingCombat.damageTrackHits);
    if (nextDelta === 0) values.delete(damageTrackId);
    else values.set(damageTrackId, { hitDelta: nextDelta, hitTimestamps });
    return {
        ...state,
        pendingCombat: { ...state.pendingCombat, damageTrackHits: values },
    };
}

function setSensorDamageLevel(
    state: NonMekUnitRuntimeState,
    index: NonMekRuntimeIndex,
    level: number,
    target: 'committed' | 'pending',
    timestamp: number,
): NonMekUnitRuntimeState {
    const sensors = [...index.damageTracks.values()]
        .map(track => ({ track, level: sensorDamageLevel(track.sheetId) }))
        .filter((entry): entry is { track: NonMekDamageTrack; level: number } => entry.level !== null)
        .sort((left, right) => left.level - right.level);
    const maximumLevel = sensors.at(-1)?.level ?? 0;
    if (!Number.isSafeInteger(level) || level < 0 || level > maximumLevel) {
        throw new Error('Invalid sensor damage level');
    }
    let next = state;
    for (const sensor of sensors) {
        const committed = next.damageTracks.get(sensor.track.id)?.hits ?? 0;
        const current = target === 'committed'
            ? committed
            : committed + (next.pendingCombat.damageTrackHits.get(sensor.track.id)?.hitDelta ?? 0);
        const desired = sensor.level <= level ? 1 : 0;
        const delta = desired - current;
        if (delta !== 0) {
            next = changeDamageTrackHits(
                next,
                sensor.track.id,
                sensor.track.maximumHits,
                delta,
                target,
                delta > 0 ? timestamp : undefined,
            );
        }
    }
    return next;
}

function sensorDamageLevel(sheetId: string): number | null {
    const match = /^sensor_hit_(\d+)$/u.exec(sheetId);
    return match ? Number(match[1]) : null;
}

const NON_MEK_MOVEMENT_MODES = new Set<MotiveModes>([
    'stationary',
    'walk',
    'run',
    'jump',
    'UMU',
    'VTOL',
]);

function validateNonMekMovement(
    value: NonMekMovementDeclaration | null,
    state: NonMekUnitRuntimeState,
    index: NonMekRuntimeIndex,
    entity: BaseEntity,
    ruleset: CBTRuleset,
    enforceCurrentCapacity = true,
): NonMekMovementDeclaration | null {
    if (value === null) return null;
    if (!NON_MEK_MOVEMENT_MODES.has(value.mode)
        || !Number.isSafeInteger(value.distance)
        || value.distance < 0) {
        throw new Error('Invalid non-Mek movement declaration');
    }
    const boosterComponentIds = [...value.boosterComponentIds];
    if (new Set(boosterComponentIds).size !== boosterComponentIds.length
        || (value.mode !== 'run' && boosterComponentIds.length > 0)) {
        throw new Error('Invalid non-Mek movement boosters');
    }
    const capabilities = projectNonMekMovementCapabilities(entity, index, state, ruleset);
    const availableBoosters = new Set(capabilities.boosterComponentIds);
    for (const componentId of boosterComponentIds) {
        const component = index.components.get(componentId);
        const equipment = component?.mount.equipment;
        if (!component || !isMascEquipment(equipment)
            || (enforceCurrentCapacity && !availableBoosters.has(componentId))) {
            throw new Error('Non-Mek movement references an unavailable booster');
        }
    }
    const maximum = enforceCurrentCapacity
        ? value.mode === 'run' && boosterComponentIds.length === 0
            ? capabilities.ordinaryRun
            : capabilities.maximum[value.mode]
        : Number.MAX_SAFE_INTEGER;
    const minimum = enforceCurrentCapacity ? capabilities.minimum[value.mode] : 0;
    if (value.distance < minimum
        || value.distance > maximum
        || (value.mode === 'stationary' && value.distance !== 0)) {
        throw new Error('Non-Mek movement exceeds its effective capacity');
    }
    return Object.freeze({
        mode: value.mode,
        distance: value.distance,
        boosterComponentIds: Object.freeze(boosterComponentIds),
    });
}

function entityMovementMaximum(
    mode: MotiveModes,
    boosted: boolean,
    state: NonMekUnitRuntimeState,
    entity: BaseEntity,
    vehicle: VehicleRuntimeRulesProjection | null,
    immobile: boolean,
): number {
    if (mode === 'stationary') return 0;
    if (immobile) return 0;
    if (mode === 'walk') {
        if (entity.unitType() === 'VTOL' && state.turn.airborne !== true) return 0;
        return vehicle?.movement.walk
            ?? Math.max(0, entity.computeWalkMP(STANDARD_MOVEMENT_CALCULATION));
    }
    if (mode === 'run') {
        if (entity.unitType() === 'Infantry'
            || (entity.unitType() === 'VTOL' && state.turn.airborne !== true)) return 0;
        if (vehicle) return boosted ? vehicle.movement.maxRun : vehicle.movement.run;
        return Math.max(0, entity.computeRunMP(isProtoMekEntity(entity) && !boosted
            ? { ...STANDARD_MOVEMENT_CALCULATION, ignoreMyomerBooster: true }
            : STANDARD_MOVEMENT_CALCULATION));
    }
    if (mode === 'jump') {
        return state.turn.airborne === true
            ? 0
            : Math.max(0, entity.computeJumpMP(STANDARD_MOVEMENT_CALCULATION));
    }
    if (mode === 'UMU') return Math.max(0, entity.umuMP());
    return 0;
}

function sameNonMekMovement(
    left: NonMekMovementDeclaration | null,
    right: NonMekMovementDeclaration | null,
): boolean {
    return left === right || (left !== null && right !== null
        && left.mode === right.mode
        && left.distance === right.distance
        && left.boosterComponentIds.length === right.boosterComponentIds.length
        && left.boosterComponentIds.every((id, index) => id === right.boosterComponentIds[index]));
}

function validateState(
    state: NonMekUnitRuntimeState,
    index: NonMekRuntimeIndex,
    entity: BaseEntity,
    ruleset: CBTRuleset,
): NonMekUnitRuntimeState {
    if (state.schemaVersion !== NON_MEK_UNIT_RUNTIME_SCHEMA_VERSION) {
        throw new Error('Unsupported non-Mek runtime state version');
    }
    asStateRevision(state.stateRevision);
    if (typeof state.explicitlyDestroyed !== 'boolean') {
        throw new Error('Invalid explicit destroyed state');
    }
    for (const [locationId, location] of state.locations) {
        const definition = index.locations.get(locationId);
        if (!definition) throw new Error(`Runtime references unknown location ${locationId}`);
        boundedDamage(location.internalDamage, definition.internalPoints);
        const seenFaces = new Set<ArmorFaceId>();
        for (const armor of location.armorDamage) {
            const face = index.armorFaces.get(armor.faceId);
            if (!face || face.locationId !== locationId) throw new Error(`Runtime references unknown armor face ${armor.faceId}`);
            if (seenFaces.has(armor.faceId)) throw new Error(`Runtime repeats armor face ${armor.faceId}`);
            seenFaces.add(armor.faceId);
            boundedDamage(armor.damage, face.maximumPoints);
        }
    }
    for (const [componentId, component] of state.components) {
        const definition = index.components.get(componentId);
        if (!definition) throw new Error(`Runtime references unknown component ${componentId}`);
        if (component.statusOverride !== undefined
            && component.statusOverride !== 'disabled'
            && component.statusOverride !== 'destroyed') {
            throw new Error(`Runtime has invalid component status ${componentId}`);
        }
        if (component.mode !== undefined) {
            const modes = definition.mount.equipment?.modes ?? [];
            if (!modes.includes(component.mode) || component.mode === modes[0]) {
                throw new Error(`Runtime has invalid component mode ${componentId}`);
            }
        }
        if (component.jammed !== undefined && typeof component.jammed !== 'boolean') {
            throw new Error(`Runtime has invalid component jam state ${componentId}`);
        }
    }
    for (const [damageTrackId, track] of state.damageTracks) {
        const definition = index.damageTracks.get(damageTrackId);
        if (!definition) throw new Error(`Runtime references unknown damage track ${damageTrackId}`);
        boundedDamage(track.hits, definition.maximumHits);
        validateHitTimestamps(track.hitTimestamps, track.hits, damageTrackId);
    }
    for (const [componentId, ammo] of state.ammo) {
        if (ammo.munitionOverride !== undefined
            && (typeof ammo.munitionOverride !== 'string'
                || ammo.munitionOverride.length > 256
                || ammo.munitionOverride.includes('\0'))) {
            throw new Error(`Runtime has invalid munition override ${componentId}`);
        }
        const component = index.components.get(componentId);
        const loadout = component
            ? entityAmmoLoadout(entity, component.mount, ruleset, ammo.munitionOverride)
            : null;
        if (!loadout) throw new Error(`Runtime ammunition references invalid loadout ${componentId}`);
        boundedDamage(ammo.shotsSpent, loadout.capacity);
    }
    for (const [positionId, crew] of state.crew) {
        if (!index.crewPositions.has(positionId)) throw new Error(`Runtime references unknown crew position ${positionId}`);
        if (!Number.isSafeInteger(crew.wounds) || crew.wounds < 0 || crew.wounds > 6
            || typeof crew.unconscious !== 'boolean' || typeof crew.ejected !== 'boolean'
            || (crew.state !== undefined && crew.state !== 'killed' && crew.state !== 'stunned')
            || (crew.state !== undefined && (crew.unconscious || crew.ejected))
            || (crew.unconscious && crew.ejected)) {
            throw new Error(`Runtime has invalid crew state ${positionId}`);
        }
    }
    for (const condition of state.conditions) {
        if (normalizeCondition(condition) !== condition) throw new Error(`Runtime has invalid condition ${condition}`);
    }
    boundedHeat(state.heat.current);
    boundedHeat(state.heat.previous);
    if (state.heat.pendingOverride !== undefined) boundedHeat(state.heat.pendingOverride);
    boundedHeatsinksOff(state.heat.heatsinksOff, entity.engineHeatSinks());
    if (!entity.tracksHeat() && (state.heat.current !== 0
        || state.heat.previous !== 0
        || state.heat.pendingOverride !== undefined
        || state.heat.heatsinksOff !== 0)) {
        throw new Error('Runtime heat state belongs to a non-Mek unit that does not track heat');
    }
    if (!Number.isSafeInteger(state.turn.turnCounter) || state.turn.turnCounter < 0
        || !Number.isSafeInteger(state.turn.weaponsHeat) || state.turn.weaponsHeat < 0
        || state.turn.weaponsHeat > 1_000_000
        || (state.turn.airborne !== null && typeof state.turn.airborne !== 'boolean')) {
        throw new Error('Runtime has invalid non-Mek turn state');
    }
    if (!entity.tracksHeat() && state.turn.weaponsHeat !== 0) {
        throw new Error('Runtime weapon heat belongs to a non-Mek unit that does not track heat');
    }
    validateNonMekMovement(state.turn.movement, state, index, entity, ruleset, false);
    const targeting = freezeAttackerTargetingState(state.attackerTargeting);
    const targetIds = new Set([
        ...targeting.targets.keys(),
        ...[...targeting.components.values()].flatMap(component =>
            component.selection?.kind === 'target' ? [component.selection.targetId] : []),
        ...[...targeting.actions.values()].flatMap(action =>
            action.selection.kind === 'target' ? [action.selection.targetId] : []),
    ]);
    const targetingValidation = reconcileAttackerTargetingState(
        targeting,
        buildNonMekAttackerTargetingContext(
            entity,
            index,
            ruleset,
            state,
            Object.freeze({
                revision: asStateRevision(0),
                targets: Object.freeze([...targetIds].map((id, position) => Object.freeze({
                    id,
                    letter: String(position + 1),
                    name: String(id),
                    color: '#000000',
                    source: 'manual' as const,
                    readOnly: false,
                }))),
            }),
            false,
        ),
    );
    if (!targetingValidation.accepted || targetingValidation.changed) {
        throw new Error('Runtime has invalid attacker targeting state');
    }
    for (const [locationId, delta] of state.pendingCombat.locationInternalDamage) {
        const location = index.locations.get(locationId);
        if (!location) throw new Error(`Pending combat references unknown location ${locationId}`);
        boundedDelta(delta, state.locations.get(locationId)?.internalDamage ?? 0, location.internalPoints);
    }
    for (const [faceId, delta] of state.pendingCombat.armorDamage) {
        const face = index.armorFaces.get(faceId);
        if (!face) throw new Error(`Pending combat references unknown armor face ${faceId}`);
        boundedDelta(delta, armorDamage(state, face.locationId, faceId), face.maximumPoints);
    }
    for (const [componentId, status] of state.pendingCombat.componentStatus) {
        if (!index.components.has(componentId)) throw new Error(`Pending combat references unknown component ${componentId}`);
        if (status !== 'available' && status !== 'disabled' && status !== 'destroyed') {
            throw new Error(`Pending combat has invalid component status ${componentId}`);
        }
    }
    for (const [damageTrackId, pending] of state.pendingCombat.damageTrackHits) {
        const definition = index.damageTracks.get(damageTrackId);
        if (!definition) throw new Error(`Pending combat references unknown damage track ${damageTrackId}`);
        boundedDelta(pending.hitDelta, state.damageTracks.get(damageTrackId)?.hits ?? 0, definition.maximumHits);
        validateHitTimestamps(pending.hitTimestamps, Math.max(0, pending.hitDelta), damageTrackId);
    }
    return freezeNonMekUnitState(state);
}

function damageTrackTimestamps(
    state: NonMekUnitRuntimeState,
    damageTrackId: SystemDamageTrackId,
    perspective: 'committed' | 'preview',
): readonly number[] {
    const committed = state.damageTracks.get(damageTrackId)?.hitTimestamps ?? [];
    if (perspective === 'committed') return committed;
    const pending = state.pendingCombat.damageTrackHits.get(damageTrackId);
    if (!pending || pending.hitDelta === 0) return committed;
    return pending.hitDelta > 0
        ? [...committed, ...pending.hitTimestamps].sort(compareNumbers)
        : committed.slice(0, committed.length + pending.hitDelta);
}

function armorDamage(
    state: NonMekUnitRuntimeState,
    locationId: LocationId,
    faceId: ArmorFaceId,
): number {
    return state.locations.get(locationId)?.armorDamage.find(entry => entry.faceId === faceId)?.damage ?? 0;
}

function boundedDamage(value: number, maximum: number | undefined): number {
    if (maximum === undefined || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
        throw new Error('Damage is outside the entity capacity');
    }
    return value;
}

function positiveAmount(value: number): number {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Damage amount must be a positive integer');
    return value;
}

function boundedDelta(value: number, current: number, maximum: number): void {
    if (!Number.isSafeInteger(value) || value < -current || value > maximum - current) {
        throw new Error('Pending damage is outside the entity capacity');
    }
}

function newHitTimestamps(timestamp: number | undefined, count: number): number[] {
    if (!Number.isSafeInteger(timestamp) || timestamp! < 0) throw new Error('Invalid damage-track timestamp');
    const values = Array.from({ length: count }, (_unused, index) => timestamp! + index);
    if (values.some(value => !Number.isSafeInteger(value))) throw new Error('Invalid damage-track timestamp');
    return values;
}

function validateHitTimestamps(
    timestamps: readonly number[],
    expectedCount: number,
    damageTrackId: SystemDamageTrackId,
): void {
    if (timestamps.length !== expectedCount
        || timestamps.some(timestamp => !Number.isSafeInteger(timestamp) || timestamp < 0)
        || timestamps.some((timestamp, index) => index > 0 && timestamp < timestamps[index - 1])) {
        throw new Error(`Runtime has invalid damage-track timestamps ${damageTrackId}`);
    }
}

function compareNumbers(left: number, right: number): number {
    return left - right;
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeCondition(value: string): string {
    const condition = value.trim().toLowerCase();
    if (!condition || condition.length > 64 || condition.includes('\0')) throw new Error('Invalid condition');
    return condition;
}

function boundedHeat(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
        throw new Error('Invalid non-Mek heat');
    }
    return value;
}

function boundedHeatsinksOff(value: number, installed: number): number {
    const maximum = Math.max(0, Math.trunc(installed));
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
        throw new Error('Invalid non-Mek heat-sink state');
    }
    return value;
}

function nextRevision(revision: StateRevision): StateRevision {
    if (revision >= Number.MAX_SAFE_INTEGER) throw new Error('Unit revision is exhausted');
    return asStateRevision(revision + 1);
}

function emptyPendingCombat(): NonMekPendingCombatState {
    return Object.freeze({
        locationInternalDamage: new ImmutableIndex<LocationId, number>([]),
        armorDamage: new ImmutableIndex<ArmorFaceId, number>([]),
        componentStatus: new ImmutableIndex<ComponentId, EquipmentStatus>([]),
        damageTrackHits: new ImmutableIndex<SystemDamageTrackId, NonMekPendingDamageTrackState>([]),
    });
}

function pendingCombatEmpty(value: NonMekPendingCombatState): boolean {
    return value.locationInternalDamage.size === 0
        && value.armorDamage.size === 0
        && value.componentStatus.size === 0
        && value.damageTrackHits.size === 0;
}
