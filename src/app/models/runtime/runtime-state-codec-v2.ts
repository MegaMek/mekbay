// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentStatus } from '../equipment-status.model';
import { isUnitConditionKey, type UnitConditionKey } from '../unit-condition.model';
import { isObjectLiteralRecord, jsonValuesEqual } from '../../utils/json-value.util';
import { compareText } from '../../utils/string.util';
import { ImmutableIndex, ImmutableSet } from '../entity/immutable-collections';
import {
    asComponentId,
    asCriticalSlotId,
    asCrewPositionId,
    asLocationId,
    type ArmorFaceId,
    ComponentId,
    CrewPositionId,
    CriticalSlotId,
    LocationId,
} from '../entity/entity-identifiers';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import type { EntityMountedEquipment } from '../entity/types';
import {
    asOneBasedCriticalSlotOrdinal,
    asSavedTargetRef,
    createSavedTargetRef,
    CBT_UNIT_PERSISTENCE_SCHEMA_VERSION,
    savedTargetReferenceClosureV2,
    validateSavedBlueprintReferenceTableV2,
    validateSerializedCBTUnitRestorationV2,
    type OneBasedCriticalSlotOrdinal,
    type SavedBlueprintReferenceTableV2,
    type SavedSlotCoordinateV2,
    type SavedStateTargetV2,
    type SavedTargetRef,
    type SerializedAmmoStateEntryV2,
    type SerializedCBTUnitV2,
    type SerializedComponentStateEntryV2,
    type SerializedCrewStateV2,
    type SerializedDeploymentConfigurationV2,
    type SerializedLocationConditionStateEntryV2,
    type SerializedLocationStateEntryV2,
    type SerializedMekHeatRecoveryAuthorityV1,
    type SavedAttackerTargetingState,
    type SerializedPendingCombatStateV2,
    type SerializedIgnoredStateRecoveryDecisionV2,
    type SerializedPersistedRestoreAliasV2,
    type SerializedRecoverableStateFactV2,
    type SerializedSlotStateEntryV2,
    type SerializedUnitRestorationMetadataV2,
    type SerializedUnresolvedStateRecoveryEntryV2,
} from './persistence-v2';
import {
    asStateRevision,
    asUnitInstanceId,
    freezeRuntimeState,
    type AmmoRuntimeState,
    type BombastLaserRuntimeState,
    type C3EmergencyMasterRuntimeState,
    type MekUnitRuntimeState,
    type ComponentRuntimeState,
    type CriticalSlotRuntimeState,
    type CrewRuntimeState,
    type EscalatingFailureSequence,
    type InstanceBaselineRef,
    type LocationRuntimeState,
    type MekLocationConditionKey,
    type MekShieldDamageRuntimeState,
    type PendingCombatOverlay,
    type PpcCapacitorRuntimeState,
    type StateRevision,
    type UnitInstanceId,
    isMekLocationConditionKey,
    MAX_MEK_CREW_WOUNDS,
    MAX_MEK_LOCATION_CONDITION_VALUE,
} from './runtime-state';
import { ppcCapacitorWeaponId } from './component-ppc-capacitor';
import { componentEscalatingFailureProfile } from './component-escalating-failure';
import { isCoreBombastLaserComponent } from './component-bombast-laser';
import { isC3EmergencyMasterComponent } from './component-c3-emergency-master';
import {
    isStealthSystemEquipment,
    isSwitchableStealthEquipment,
    STEALTH_DISABLING_MODE,
    STEALTH_ENABLING_MODE,
} from '../stealth-equipment.model';
import {
    equipmentForComponent,
    type MekRuntimeIndex,
    type MekIndexedComponent,
} from './mek-runtime-index';
import {
    mekAmmoCapacity,
    mekAmmoDefaultMunitionKey,
    mekAmmoLoadout,
    mekIntrinsicMagazine,
} from './mek-ammo';
import {
    mekComponentModes,
    type MekComponentModes,
} from './mek-component-rules';
import { rapidFireAutocannonSupportsJamming } from './component-rapid-fire-autocannon';
import { ecmRuntimeModes } from './component-electronic-suite';
import { STATE_RESTORATION_ALGORITHM_VERSION_V2 } from './unit-restoration-repair-v2';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type { SavedEntityIdentity } from '../persisted-unit-state';
import {
    canonicalizeMekTurnStateV2,
    deserializeMekTurnStateV2,
    serializeMekTurnStateV2,
    type MekTurnStateV2,
} from './mek-turn-state-v2';
import {
    canonicalizeMekHeatStateV2,
    type MekHeatStateV2,
} from './mek-heat-state-v2';
import {
    deserializeMekMovementPsrStateV2,
    remapMekMovementPsrStateIdsV2,
    serializeMekMovementPsrStateV2,
    type MekMovementPsrStateV2,
} from './mek-movement-psr-v2';
import {
    freezeEquipmentRowOrder,
    type EquipmentRowOrderState,
} from './equipment-row-order';
import {
    freezeAttackerTargetingState,
    attackerActionTargetKey,
    type AttackerActionState,
    type AttackerComponentState,
    type AttackerLocalTargetState,
    type AttackerTargetingState,
} from './attacker-targeting-state';
import {
    isPhysicalWeaponFlags,
    resolveShieldProfileFromFlags,
} from '../entity/utils/physical-weapon-kernel';
import { isShieldEquipment } from '../entity/utils/physical-weapon';
import { asEncounterTargetId } from './encounter-runtime';
import {
    createMekTorsoCripplingRuleCheckTokenV2,
    freezeRuleChecks,
    MEK_TORSO_CRIPPLING_RULE_CHECK_KEY,
    type MekRuleChecksV2,
    type MekRuleCheckStateV2,
} from './mek-destruction-state-v2';
import {
    assertCanonicalCrewAssignment,
    type CrewTopology,
} from './crew-assignment';
import { MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION } from './unit-state-initializer';
import { isMekLocationPhysicallyDestroyed } from './mek-location-state-kernel';
import {
    mekCriticalSlotDirectHitThreshold,
    mekCriticalSlotMaximumHits,
} from './mek-critical-slot-rules';
import { GAUSS_POWERED_UP, isMekGaussPowerState } from './mek-gauss-power';
import { isGaussEquipment } from '../gauss-equipment.model';
import {
    isModularArmorEquipment,
    MODULAR_ARMOR_POINTS_PER_MOUNT,
} from '../modular-armor.model';

export const V2_STATE_RESTORATION_ALGORITHM_VERSION = STATE_RESTORATION_ALGORITHM_VERSION_V2;

export type V2StateCodecErrorCode =
    | 'BASELINE_ENTITY_MISMATCH'
    | 'DESIGN_IDENTITY_MISMATCH'
    | 'DEPLOYMENT_MISMATCH'
    | 'INVALID_RUNTIME_STATE'
    | 'INVALID_SERIALIZED_STATE'
    | 'TARGET_KIND_MISMATCH'
    | 'UNSUPPORTED_STATE_KIND'
    | 'UNSUPPORTED_STATE_CAPABILITY';

export class V2StateCodecError extends Error {
    public constructor(
        public readonly code: V2StateCodecErrorCode,
        message: string,
        public readonly path = '$',
    ) {
        super(`${path}: ${message}`);
        this.name = 'V2StateCodecError';
    }
}

export type V2StateRestoreWarningCode =
    | 'SOURCE_REVISION_CHANGED'
    | 'ENTITY_BASELINE_CHANGED'
    | 'INITIAL_BASELINE_CHANGED'
    | 'SLOT_OCCUPANT_MISMATCH'
    | 'TARGET_REKEYED'
    | 'DAMAGE_CLAMPED'
    | 'AMMO_CAPACITY_CHANGED'
    | 'UNSUPPORTED_EQUIPMENT_STATE_RETAINED';

export interface V2StateRestoreWarning {
    readonly code: V2StateRestoreWarningCode;
    readonly message: string;
    readonly sourceTargetRef?: SavedTargetRef;
    readonly currentTargetRef?: SavedTargetRef;
    readonly saved?: Readonly<Record<string, unknown>>;
    readonly current?: Readonly<Record<string, unknown>>;
}

export interface SerializeCBTUnitStateV2Input {
    readonly entity: MekEntity;
    readonly index: MekRuntimeIndex;
    readonly instanceId: UnitInstanceId;
    readonly baselineRef: InstanceBaselineRef;
    readonly state: MekUnitRuntimeState;
    readonly deployment: SerializedDeploymentConfigurationV2;
    /** Recovery evidence is an application-owned sidecar and must survive ordinary combat saves. */
    readonly restoration?: SerializedUnitRestorationMetadataV2;
}

export interface RestoreSerializedCBTUnitV2Result {
    readonly state: MekUnitRuntimeState;
    readonly baselineRef: InstanceBaselineRef;
    readonly blueprintReferences: SavedBlueprintReferenceTableV2;
    readonly targetTranslation: Readonly<Record<SavedTargetRef, SavedTargetRef>>;
    readonly metadata: SerializedUnitRestorationMetadataV2;
    readonly warnings: readonly V2StateRestoreWarning[];
    readonly unresolved: readonly SerializedUnresolvedStateRecoveryEntryV2[];
    readonly appliedExact: number;
    readonly appliedWithWarning: number;
}

interface CurrentLocationTarget {
    readonly ref: SavedTargetRef;
    readonly target: Extract<SavedStateTargetV2, { kind: 'location-section' }>;
    readonly locationId: LocationId;
    readonly armorFaceId?: ArmorFaceId;
    readonly maximum: number;
}

interface CurrentSlotTarget {
    readonly ref: SavedTargetRef;
    readonly target: Extract<SavedStateTargetV2, { kind: 'critical-slot' }>;
    readonly slotId: CriticalSlotId;
    readonly directHitThreshold: number;
    readonly maximumHits: number;
}

interface CurrentComponentTarget {
    readonly ref: SavedTargetRef;
    readonly target: Extract<SavedStateTargetV2, { kind: 'component' | 'intrinsic-system' }>;
    readonly componentId: ComponentId;
    readonly stateCapabilities: MekComponentModes & Readonly<{ supportsJamming: boolean }>;
    readonly escalatingFailureTargetCount: number;
    readonly ppcCapacitorWeaponId?: ComponentId;
    readonly supportsBombastLaser: boolean;
    readonly supportsC3EmergencyMaster: boolean;
    readonly supportsStealthTransition: boolean;
    readonly supportsGaussPower: boolean;
    readonly supportsShieldDamage: boolean;
    readonly supportsModularArmor: boolean;
    readonly shieldMaximumAbsorption: number;
    readonly shieldMaximumCapacity: number;
}

interface CurrentAmmoTarget {
    readonly ref: SavedTargetRef;
    readonly target: Extract<SavedStateTargetV2, { kind: 'ammo-source' }>;
    readonly componentId: ComponentId;
    readonly capacity: number;
}

interface CurrentCrewTarget {
    readonly ref: SavedTargetRef;
    readonly target: Extract<SavedStateTargetV2, { kind: 'crew-position' }>;
    readonly positionId: CrewPositionId;
}

type CurrentTarget = CurrentLocationTarget | CurrentSlotTarget | CurrentComponentTarget
    | CurrentAmmoTarget | CurrentCrewTarget;

interface CurrentTargetIndex {
    readonly table: SavedBlueprintReferenceTableV2;
    readonly byRef: ReadonlyMap<SavedTargetRef, CurrentTarget>;
    readonly locationByCoordinate: ReadonlyMap<string, CurrentLocationTarget>;
    readonly slotByCoordinate: ReadonlyMap<string, CurrentSlotTarget>;
    readonly slotById: ReadonlyMap<string, CurrentSlotTarget>;
    readonly componentById: ReadonlyMap<string, CurrentComponentTarget>;
    readonly components: readonly CurrentComponentTarget[];
    readonly ammoById: ReadonlyMap<string, CurrentAmmoTarget>;
    readonly ammo: readonly CurrentAmmoTarget[];
    readonly crewById: ReadonlyMap<string, CurrentCrewTarget>;
    readonly crewByPositionKey: ReadonlyMap<string, readonly CurrentCrewTarget[]>;
    readonly crew: readonly CurrentCrewTarget[];
}

interface RestoreAccumulator {
    readonly unit: MekCodecUnit;
    readonly currentIdentity: SavedEntityIdentity;
    readonly current: CurrentTargetIndex;
    readonly sourceTargets: Readonly<Record<SavedTargetRef, SavedStateTargetV2>>;
    readonly aliasBySourceWitness: ReadonlyMap<string, SavedTargetRef>;
    readonly translations: Map<SavedTargetRef, SavedTargetRef>;
    readonly warnings: V2StateRestoreWarning[];
    readonly warningKeys: Set<string>;
    readonly unresolvedDrafts: {
        readonly sourceTargetRef: SavedTargetRef;
        readonly sourceTarget: SavedStateTargetV2;
        readonly fact: SerializedRecoverableStateFactV2;
        readonly reason: string;
    }[];
    appliedExact: number;
    appliedWithWarning: number;
}

interface MekCodecUnit {
    readonly entity: MekEntity;
    readonly index: MekRuntimeIndex;
    readonly ruleset: CBTRuleset;
}

function codecUnit(entity: MekEntity, index: MekRuntimeIndex, ruleset: CBTRuleset): MekCodecUnit {
    return Object.freeze({ entity, index, ruleset });
}

/**
 * Builds the exhaustive witness table for every blueprint-addressed Mek runtime map. Canonical
 * topology slot indexes remain zero-based; only this persistence boundary emits one-based ordinals.
 */
export function buildSavedBlueprintReferenceTableV2(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
): SavedBlueprintReferenceTableV2 {
    return buildCurrentTargetIndex(codecUnit(entity, index, ruleset)).table;
}

function serializeAttackerTargeting(
    state: AttackerTargetingState,
    current: CurrentTargetIndex,
    unit: MekCodecUnit,
): SavedAttackerTargetingState {
    let frozen: AttackerTargetingState;
    try {
        frozen = freezeAttackerTargetingState(state);
    } catch (error) {
        codecFail(
            'INVALID_RUNTIME_STATE',
            '$.state.attackerTargeting',
            error instanceof Error ? error.message : 'invalid attacker-targeting state',
        );
    }

    const components = [...frozen.components].map(([componentId, component]) => {
        const target = current.componentById.get(componentId);
        if (!target || equipmentForComponent(unit.index, componentId)?.type !== 'weapon') {
            codecFail(
                'INVALID_RUNTIME_STATE',
                `$.state.attackerTargeting.components.${componentId}`,
                'targeting state references a non-weapon component',
            );
        }
        const preferredSourceTarget = component.ammo?.preferredSourceId === undefined
            ? undefined
            : current.ammoById.get(component.ammo.preferredSourceId)?.ref;
        if (component.ammo?.preferredSourceId !== undefined && preferredSourceTarget === undefined) {
            codecFail(
                'INVALID_RUNTIME_STATE',
                `$.state.attackerTargeting.components.${componentId}.ammo.preferredSourceId`,
                'targeting state references an unknown ammo source',
            );
        }
        return Object.freeze({
            target: target.ref,
            ...(component.selection === undefined
                ? {}
                : { selection: canonicalClone(component.selection) }),
            ...(component.ammo === undefined
                ? {}
                : {
                    ammo: Object.freeze({
                        munitionKey: component.ammo.munitionKey,
                        ...(preferredSourceTarget === undefined ? {} : { preferredSourceTarget }),
                    }),
                }),
        });
    }).sort(compareTargetEntry);
    const targets = [...frozen.targets].map(([targetId, facts]) => Object.freeze({
        targetId,
        ...canonicalClone(facts),
    }));
    const actions = [...frozen.actions].map(([, action]) => {
        if (action.target.kind === 'intrinsic') {
            const target = action.target;
            const matches = unit.index.intrinsicActions
                .filter(candidate => candidate.id === target.actionId);
            if (matches.length !== 1) {
                codecFail(
                    'INVALID_RUNTIME_STATE',
                    `$.state.attackerTargeting.actions.${target.actionId}`,
                    'targeting state references an unknown intrinsic action',
                );
            }
            return Object.freeze({
                kind: 'intrinsic' as const,
                actionId: target.actionId,
                selection: canonicalClone(action.selection),
            });
        }
        const equipment = equipmentForComponent(unit.index, action.target.componentId);
        const target = current.componentById.get(action.target.componentId);
        if (!target || !isPhysicalWeaponFlags(equipment?.flags ?? new Set())) {
            codecFail(
                'INVALID_RUNTIME_STATE',
                `$.state.attackerTargeting.actions.${action.target.componentId}`,
                'targeting state references a non-physical component action',
            );
        }
        return Object.freeze({
            kind: 'component' as const,
            target: target.ref,
            selection: canonicalClone(action.selection),
        });
    }).sort((left, right) => {
        const leftKey = left.kind === 'component' ? `component\u0000${left.target}` : `intrinsic\u0000${left.actionId}`;
        const rightKey = right.kind === 'component' ? `component\u0000${right.target}` : `intrinsic\u0000${right.actionId}`;
        return compareText(leftKey, rightKey);
    });
    return Object.freeze({
        schemaVersion: 1,
        components: Object.freeze(components),
        actions: Object.freeze(actions),
        targets: Object.freeze(targets),
    });
}

function restoreAttackerTargeting(
    value: SavedAttackerTargetingState,
    accumulator: RestoreAccumulator,
): AttackerTargetingState {
    if (!isObjectLiteralRecord(value)
        || !hasExactObjectKeys(value, ['schemaVersion', 'components', 'actions', 'targets'])
        || value.schemaVersion !== 1
        || !Array.isArray(value.components)
        || !Array.isArray(value.actions)
        || !Array.isArray(value.targets)) {
        codecFail('INVALID_SERIALIZED_STATE', '$.attackerTargeting', 'invalid targeting wire shape');
    }

    const actions = new Map<string, AttackerActionState>();
    for (let index = 0; index < value.actions.length; index += 1) {
        const row = value.actions[index];
        const path = `$.attackerTargeting.actions[${index}]`;
        if (!isObjectLiteralRecord(row) || typeof row['kind'] !== 'string') {
            codecFail('INVALID_SERIALIZED_STATE', path, 'invalid targeting action row');
        }
        let target: AttackerActionState['target'];
        if (row['kind'] === 'intrinsic') {
            if (!hasExactObjectKeys(row, ['kind', 'actionId', 'selection'])
                || typeof row['actionId'] !== 'string') {
                codecFail('INVALID_SERIALIZED_STATE', path, 'invalid intrinsic targeting action');
            }
            const actionId = canonicalBoundedText(row['actionId'], `${path}.actionId`);
            if (accumulator.unit.index.intrinsicActions
                .filter(candidate => candidate.id === actionId).length !== 1) {
                codecFail('INVALID_SERIALIZED_STATE', `${path}.actionId`, 'unknown intrinsic targeting action');
            }
            target = Object.freeze({ kind: 'intrinsic', actionId });
        } else if (row['kind'] === 'component') {
            if (!hasExactObjectKeys(row, ['kind', 'target', 'selection'])
                || typeof row['target'] !== 'string') {
                codecFail('INVALID_SERIALIZED_STATE', path, 'invalid component targeting action');
            }
            const ref = asSavedTargetRef(canonicalBoundedText(row['target'], `${path}.target`));
            const source = sourceTarget(accumulator, ref, ['component'], path);
            const current = resolveComponentTarget(source, accumulator, ref);
            if (!current || !isPhysicalWeaponFlags(
                equipmentForComponent(accumulator.unit.index, current.componentId)?.flags ?? new Set(),
            )) {
                codecFail('INVALID_SERIALIZED_STATE', `${path}.target`, 'physical component action does not resolve uniquely');
            }
            target = Object.freeze({ kind: 'component', componentId: current.componentId });
        } else {
            codecFail('INVALID_SERIALIZED_STATE', `${path}.kind`, 'unknown targeting action kind');
        }
        const key = attackerActionTargetKey(target);
        if (actions.has(key)) codecFail('INVALID_SERIALIZED_STATE', path, 'duplicate targeting action');
        actions.set(key, Object.freeze({
            target,
            selection: canonicalClone(row['selection']) as AttackerActionState['selection'],
        }));
    }

    const components = new Map<ComponentId, AttackerComponentState>();
    for (let index = 0; index < value.components.length; index += 1) {
        const row = value.components[index];
        const path = `$.attackerTargeting.components[${index}]`;
        if (!isObjectLiteralRecord(row)
            || !hasExactObjectKeys(row, ['target', 'selection', 'ammo'])) {
            codecFail('INVALID_SERIALIZED_STATE', path, 'invalid targeting component row');
        }
        if (typeof row['target'] !== 'string') {
            codecFail('INVALID_SERIALIZED_STATE', `${path}.target`, 'must be a string');
        }
        const ref = asSavedTargetRef(canonicalBoundedText(row['target'], `${path}.target`));
        const source = sourceTarget(accumulator, ref, ['component'], path);
        const current = resolveComponentTarget(source, accumulator, ref);
        if (!current
            || equipmentForComponent(accumulator.unit.index, current.componentId)?.type !== 'weapon') {
            codecFail(
                'INVALID_SERIALIZED_STATE',
                `${path}.target`,
                'saved targeting weapon does not resolve uniquely to a current weapon',
            );
        }
        if (components.has(current.componentId)) {
            codecFail('INVALID_SERIALIZED_STATE', path, 'duplicate resolved targeting weapon');
        }

        let ammo: AttackerComponentState['ammo'];
        const ammoValue = row['ammo'];
        if (ammoValue !== undefined) {
            if (!isObjectLiteralRecord(ammoValue)
                || !hasExactObjectKeys(ammoValue, ['munitionKey', 'preferredSourceTarget'])
                || typeof ammoValue['munitionKey'] !== 'string') {
                codecFail('INVALID_SERIALIZED_STATE', `${path}.ammo`, 'invalid targeting ammo row');
            }
            const munitionKey = canonicalBoundedText(ammoValue['munitionKey'], `${path}.ammo.munitionKey`);
            let preferredSourceId: ComponentId | undefined;
            if (ammoValue['preferredSourceTarget'] !== undefined) {
                if (typeof ammoValue['preferredSourceTarget'] !== 'string') {
                    codecFail(
                        'INVALID_SERIALIZED_STATE',
                        `${path}.ammo.preferredSourceTarget`,
                        'must be a string',
                    );
                }
                const sourceRef = asSavedTargetRef(canonicalBoundedText(
                    ammoValue['preferredSourceTarget'],
                    `${path}.ammo.preferredSourceTarget`,
                ));
                const sourceTargetValue = sourceTarget(
                    accumulator,
                    sourceRef,
                    ['ammo-source'],
                    `${path}.ammo.preferredSourceTarget`,
                );
                const resolvedSource = resolveAmmoTarget(sourceTargetValue, accumulator, sourceRef);
                if (!resolvedSource) {
                    codecFail(
                        'INVALID_SERIALIZED_STATE',
                        `${path}.ammo.preferredSourceTarget`,
                        'saved preferred ammo source does not resolve uniquely',
                    );
                }
                preferredSourceId = resolvedSource.componentId;
            }
            ammo = Object.freeze({
                munitionKey,
                ...(preferredSourceId === undefined ? {} : { preferredSourceId }),
            });
        }
        const selection = row['selection'] === undefined
            ? undefined
            : canonicalClone(row['selection']) as AttackerComponentState['selection'];
        components.set(current.componentId, Object.freeze({
            ...(selection === undefined ? {} : { selection }),
            ...(ammo === undefined ? {} : { ammo }),
        }));
    }

    const targets = new Map<ReturnType<typeof asEncounterTargetId>, AttackerLocalTargetState>();
    for (let index = 0; index < value.targets.length; index += 1) {
        const row = value.targets[index];
        const path = `$.attackerTargeting.targets[${index}]`;
        if (!isObjectLiteralRecord(row)
            || !hasExactObjectKeys(row, [
                'targetId', 'distance', 'c3Distance', 'useC3', 'calculator', 'manualTnOverride',
            ])) {
            codecFail('INVALID_SERIALIZED_STATE', path, 'invalid attacker-local target row');
        }
        if (typeof row['targetId'] !== 'string') {
            codecFail('INVALID_SERIALIZED_STATE', `${path}.targetId`, 'must be a string');
        }
        const targetId = asEncounterTargetId(canonicalBoundedText(row['targetId'], `${path}.targetId`));
        if (targets.has(targetId)) {
            codecFail('INVALID_SERIALIZED_STATE', `${path}.targetId`, 'duplicate attacker-local target');
        }
        const facts: AttackerLocalTargetState = {
            ...(row['distance'] === undefined ? {} : { distance: row['distance'] as number }),
            ...(row['c3Distance'] === undefined ? {} : { c3Distance: row['c3Distance'] as number }),
            ...(row['useC3'] === undefined ? {} : { useC3: row['useC3'] as true }),
            ...(row['calculator'] === undefined
                ? {}
                : { calculator: canonicalClone(row['calculator']) as AttackerLocalTargetState['calculator'] }),
            ...(row['manualTnOverride'] === undefined
                ? {}
                : { manualTnOverride: canonicalClone(row['manualTnOverride']) as AttackerLocalTargetState['manualTnOverride'] }),
        };
        targets.set(targetId, facts);
    }

    try {
        return freezeAttackerTargetingState({ schemaVersion: 1, components, actions, targets });
    } catch (error) {
        codecFail(
            'INVALID_SERIALIZED_STATE',
            '$.attackerTargeting',
            error instanceof Error ? error.message : 'invalid attacker-targeting state',
        );
    }
}

function hasExactObjectKeys(value: object, allowed: readonly string[]): boolean {
    const allowedSet = new Set(allowed);
    return Object.keys(value).every(key => allowedSet.has(key));
}

/** Serializes one exact runtime snapshot without persisting baseline facts or map insertion order. */
export function serializeCBTUnitStateV2(
    input: SerializeCBTUnitStateV2Input,
): SerializedCBTUnitV2 {
    assertBaselineMatchesEntity(input.baselineRef, input.entity, '$.baselineRef');
    const unit = codecUnit(input.entity, input.index, input.baselineRef.ruleset);
    asUnitInstanceId(input.instanceId);
    asStateRevision(input.state.stateRevision);
    if (typeof input.state.explicitlyDestroyed !== 'boolean'
        || typeof input.state.destroyed !== 'boolean') {
        codecFail('INVALID_RUNTIME_STATE', '$.state.destroyed', 'must be boolean');
    }
    const turn = serializeRuntimeTurn(input.state.turn, '$.state.turn');
    if (input.deployment.schemaVersion !== MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION) {
        codecFail('DEPLOYMENT_MISMATCH', '$.deployment', 'unsupported deployment payload version');
    }
    assertDeploymentValues(unit.index.crewPositions, input.deployment, '$.deployment');

    const current = buildCurrentTargetIndex(unit, input.state.ammo);
    const locationState: SerializedLocationStateEntryV2[] = [];
    const locationConditions: SerializedLocationConditionStateEntryV2[] = [];
    const slotState: SerializedSlotStateEntryV2[] = [];
    const componentState: SerializedComponentStateEntryV2[] = [];
    const ammoState: SerializedAmmoStateEntryV2[] = [];
    const crewState: SerializedCrewStateV2['positions'][number][] = [];

    for (const [locationId, value] of input.state.locations) {
        const location = unit.index.locations.get(locationId);
        if (!location) codecFail('INVALID_RUNTIME_STATE', '$.state.locations', `unknown location ${locationId}`);
        const internal = requireNonnegativeInteger(value.internalDamage, `$.state.locations.${locationId}.internalDamage`);
        if (internal > location.internalPoints) {
            codecFail('INVALID_RUNTIME_STATE', `$.state.locations.${locationId}.internalDamage`, 'damage exceeds the current location maximum');
        }
        if (internal > 0) {
            const target = current.locationByCoordinate.get(locationCoordinate(locationId, 'internal'))!;
            locationState.push({ target: target.ref, damage: internal });
        }
        for (const [condition, rawValue] of value.conditions) {
            const conditionValue = requireMekLocationConditionValue(
                condition,
                rawValue,
                `$.state.locations.${locationId}.conditions.${condition}`,
                false,
                'INVALID_RUNTIME_STATE',
            );
            const target = current.locationByCoordinate.get(locationCoordinate(locationId, 'internal'))!;
            locationConditions.push({ target: target.ref, condition, value: conditionValue });
        }
        const seenFaces = new Set<ArmorFaceId>();
        for (const armor of value.armorDamage) {
            if (seenFaces.has(armor.faceId)) {
                codecFail('INVALID_RUNTIME_STATE', `$.state.locations.${locationId}.armorDamage`, `duplicate face ${armor.faceId}`);
            }
            seenFaces.add(armor.faceId);
            const face = unit.index.armorFaces.get(armor.faceId);
            if (!face || face.locationId !== locationId) {
                codecFail('INVALID_RUNTIME_STATE', `$.state.locations.${locationId}.armorDamage`, `unknown or misplaced armor face ${armor.faceId}`);
            }
            const damage = requireNonnegativeInteger(armor.damage, `$.state.locations.${locationId}.armorDamage.${armor.faceId}`);
            if (damage > face.maximumPoints) {
                codecFail('INVALID_RUNTIME_STATE', `$.state.locations.${locationId}.armorDamage.${armor.faceId}`, 'damage exceeds the current armor maximum');
            }
            if (damage > 0) {
                const target = current.locationByCoordinate.get(locationCoordinate(
                    locationId,
                    face.face === 'front' ? 'front-armor' : 'rear-armor',
                ))!;
                locationState.push({ target: target.ref, damage });
            }
        }
    }
    assertNoNarcOnPhysicallyDestroyedLocations(
        unit.index,
        input.state.locations,
        '$.state.locations',
        'INVALID_RUNTIME_STATE',
    );

    for (const [slotId, value] of input.state.slots) {
        const target = current.slotById.get(slotId);
        if (!target) codecFail('INVALID_RUNTIME_STATE', '$.state.slots', `unknown critical slot ${slotId}`);
        const hits = requireNonnegativeInteger(value.hits, `$.state.slots.${slotId}.hits`);
        if (hits > target.maximumHits) {
            codecFail('INVALID_RUNTIME_STATE', `$.state.slots.${slotId}.hits`, `exceeds slot capacity ${target.maximumHits}`);
        }
        const destroyedTurn = value.destroyedTurn === undefined
            ? undefined
            : requireNonnegativeInteger(
                value.destroyedTurn,
                `$.state.slots.${slotId}.destroyedTurn`,
            );
        if (destroyedTurn !== undefined && (
            destroyedTurn === 0
            || hits < target.directHitThreshold
        )) {
            codecFail(
                'INVALID_RUNTIME_STATE',
                `$.state.slots.${slotId}.destroyedTurn`,
                'sparse destruction turn requires an unavailable critical slot and must be positive',
            );
        }
        if (hits > 0) slotState.push({
            target: target.ref,
            hits,
            ...(destroyedTurn === undefined ? {} : { destroyedTurn }),
        });
    }

    for (const [componentId, value] of input.state.components) {
        const target = current.componentById.get(componentId);
        if (!target) codecFail('INVALID_RUNTIME_STATE', '$.state.components', `unknown component ${componentId}`);
        if (target.target.kind === 'intrinsic-system' && value.statusOverride !== undefined) {
            codecFail(
                'INVALID_RUNTIME_STATE',
                `$.state.components.${componentId}.statusOverride`,
                'intrinsic-system damage must be represented by critical-slot or location facts',
            );
        }
        const serialized = serializeComponentState(target, value, `$.state.components.${componentId}`);
        if (serialized) componentState.push(serialized);
    }

    for (const [componentId, value] of input.state.ammo) {
        const target = current.ammoById.get(componentId);
        if (!target) codecFail('INVALID_RUNTIME_STATE', '$.state.ammo', `component ${componentId} is not an ammo source`);
        const shotsSpent = requireNonnegativeInteger(value.shotsSpent, `$.state.ammo.${componentId}.shotsSpent`);
        const munitionOverride = optionalBoundedText(value.munitionOverride, `$.state.ammo.${componentId}.munitionOverride`);
        const loadout = mekAmmoLoadout(
            unit.entity,
            unit.index,
            componentId,
            unit.ruleset,
            munitionOverride,
        );
        if (!loadout || (munitionOverride !== undefined
            && loadout.munitionKey === mekAmmoDefaultMunitionKey(unit.entity, unit.index, componentId))) {
            codecFail(
                'UNSUPPORTED_STATE_CAPABILITY',
                `$.state.ammo.${componentId}.munitionOverride`,
                'the entity does not support that munition for the installed source',
            );
        }
        if (shotsSpent > loadout.capacity) {
            codecFail('INVALID_RUNTIME_STATE', `$.state.ammo.${componentId}.shotsSpent`, 'consumption exceeds the current source capacity');
        }
        if (shotsSpent > 0 || munitionOverride !== undefined) {
            ammoState.push({
                target: target.ref,
                shotsSpent,
                ...(munitionOverride === undefined ? {} : { munitionOverride }),
            });
        }
    }

    for (const [positionId, value] of input.state.crew) {
        const target = current.crewById.get(positionId);
        if (!target) codecFail('INVALID_RUNTIME_STATE', '$.state.crew', `unknown crew position ${positionId}`);
        const wounds = requireNonnegativeInteger(value.wounds, `$.state.crew.${positionId}.wounds`);
        if (wounds > MAX_MEK_CREW_WOUNDS) {
            codecFail('INVALID_RUNTIME_STATE', `$.state.crew.${positionId}.wounds`, 'exceeds the Mek crew wound limit');
        }
        if (typeof value.unconscious !== 'boolean') {
            codecFail('INVALID_RUNTIME_STATE', `$.state.crew.${positionId}.unconscious`, 'must be boolean');
        }
        if (value.dead !== undefined && value.dead !== true) {
            codecFail('INVALID_RUNTIME_STATE', `$.state.crew.${positionId}.dead`, 'sparse dead state must be true');
        }
        if (typeof value.ejected !== 'boolean') {
            codecFail('INVALID_RUNTIME_STATE', `$.state.crew.${positionId}.ejected`, 'must be boolean');
        }
        if (value.dead === true && wounds < MAX_MEK_CREW_WOUNDS) {
            codecFail(
                'INVALID_RUNTIME_STATE',
                `$.state.crew.${positionId}.dead`,
                'committed death requires fatal wounds',
            );
        }
        if (value.recoveryReadyTurn !== undefined
            && value.recoveryReadyTurn !== null
            && (!Number.isSafeInteger(value.recoveryReadyTurn)
                || value.recoveryReadyTurn < 0)) {
            codecFail(
                'INVALID_RUNTIME_STATE',
                `$.state.crew.${positionId}.recoveryReadyTurn`,
                'must be null or a nonnegative integer',
            );
        }
        if (value.recoveryReadyTurn !== undefined && !value.unconscious) {
            codecFail(
                'INVALID_RUNTIME_STATE',
                `$.state.crew.${positionId}.recoveryReadyTurn`,
                'requires unconscious crew',
            );
        }
        if (wounds === 0 && !value.unconscious && !value.ejected) {
            codecFail('INVALID_RUNTIME_STATE', `$.state.crew.${positionId}`, 'sparse crew state must contain a fact');
        }
        crewState.push({
            target: target.ref,
            wounds,
            unconscious: value.unconscious,
            ...(value.dead ? { dead: true as const } : {}),
            ...(value.ejected ? { ejected: true as const } : {}),
            ...(value.recoveryReadyTurn === undefined
                ? {}
                : { recoveryReadyTurn: value.recoveryReadyTurn }),
        });
    }

    const conditions = [...input.state.conditions].map((condition, index): UnitConditionKey => {
        if (!isUnitConditionKey(condition)) {
            codecFail('INVALID_RUNTIME_STATE', `$.state.conditions[${index}]`, 'unknown unit condition');
        }
        return condition;
    }).sort(compareText);
    if (new Set(conditions).size !== conditions.length) {
        codecFail('INVALID_RUNTIME_STATE', '$.state.conditions', 'conditions must be unique');
    }
    let heat: MekHeatStateV2;
    try {
        heat = canonicalizeMekHeatStateV2(input.state.heat);
    } catch (error) {
        codecFail(
            'INVALID_RUNTIME_STATE',
            '$.state.heat',
            error instanceof Error ? error.message : 'invalid heat state',
        );
    }
    const restoration = input.restoration;
    assertMekHeatRecoveryAuthorityForWrite(restoration, current.table);
    const pendingCombat = serializePending(
        input.state.pendingCombat,
        current,
        input.state.locations,
        input.state.slots,
        input.state.components,
    );
    const ruleChecks = serializeMekRuleChecks(
        input.state.ruleChecks,
        current,
        input.state.stateRevision,
    );
    const movementPsr = serializeMekMovementPsrStateV2(input.state.movementPsr);
    const attackerTargeting = serializeAttackerTargeting(input.state.attackerTargeting, current, unit);
    const equipmentRowOrder = freezeEquipmentRowOrder(input.state.equipmentRowOrder);

    locationState.sort(compareTargetEntry);
    locationConditions.sort(compareLocationConditionEntry);
    slotState.sort(compareTargetEntry);
    componentState.sort(compareTargetEntry);
    ammoState.sort(compareTargetEntry);
    crewState.sort(compareTargetEntry);

    if (input.baselineRef.entity.sourceFormat === 'blk') {
        codecFail('DESIGN_IDENTITY_MISMATCH', '$.entity', 'Mek V2 state cannot use a BLK baseline');
    }
    const exhaustiveValue: SerializedCBTUnitV2 = {
        schemaVersion: CBT_UNIT_PERSISTENCE_SCHEMA_VERSION,
        instanceId: input.instanceId,
        entity: input.baselineRef.entity,
        baselineRefAtSave: input.baselineRef,
        blueprintReferences: current.table,
        deployment: input.deployment,
        stateRevision: input.state.stateRevision,
        ...(input.state.explicitlyDestroyed ? { destroyed: true as const } : {}),
        ...(locationState.length === 0 ? {} : { locationState }),
        ...(locationConditions.length === 0 ? {} : { locationConditions }),
        ...(slotState.length === 0 ? {} : { slotState }),
        ...(componentState.length === 0 ? {} : { componentState }),
        ...(ammoState.length === 0 ? {} : { ammoState }),
        crew: { schemaVersion: 1, positions: crewState },
        // Heat is always explicit: deployment may initialize non-zero heat, while runtime state does
        // not retain whether a later zero was an intentional override or an omitted baseline value.
        heat: {
            heat: heat.current,
            ...(heat.previous === 0 ? {} : { previous: heat.previous }),
            ...(heat.pendingOverride === undefined ? {} : { pendingOverride: heat.pendingOverride }),
            ...(heat.heatsinksOff === 0 ? {} : { heatsinksOff: heat.heatsinksOff }),
        },
        family: { kind: 'mek' },
        ruleChecks,
        movementPsr,
        attackerTargeting,
        ...(equipmentRowOrder === undefined ? {} : { equipmentRowOrder }),
        ...(conditions.length === 0 ? {} : { conditions: { values: conditions } }),
        turn,
        ...(pendingCombat ? { pendingCombat } : {}),
        ...(restoration ? { restoration } : {}),
    };
    const value: SerializedCBTUnitV2 = {
        ...exhaustiveValue,
        blueprintReferences: compactActiveBlueprintReferences(exhaustiveValue),
    };
    const serialized = canonicalClone(value);
    try {
        validateSerializedCBTUnitRestorationV2(serialized);
    } catch (error) {
        codecFail(
            'INVALID_SERIALIZED_STATE',
            '$.restoration',
            error instanceof Error ? error.message : 'invalid serialized restoration metadata',
        );
    }
    return serialized;
}

/**
 * Persist only witnesses used by sparse runtime facts. The entity remains the
 * source of pristine topology, so an untouched unit needs no copied blueprint.
 */
function compactActiveBlueprintReferences(
    value: SerializedCBTUnitV2,
): SavedBlueprintReferenceTableV2 {
    if (value.restoration !== undefined
        && (value.restoration.unresolved.length > 0
            || value.restoration.acceptedAliases.length > 0
            || value.restoration.heatRecovery !== undefined)) {
        return value.blueprintReferences;
    }

    const strings = new Set<string>();
    for (const part of [
        value.locationState,
        value.locationConditions,
        value.slotState,
        value.componentState,
        value.ammoState,
        value.crew,
        value.ruleChecks,
        value.movementPsr,
        value.attackerTargeting,
        value.turn,
        value.pendingCombat,
    ]) collectNestedStrings(part, strings);

    const targets = value.blueprintReferences.targets;
    const roots: SavedTargetRef[] = [];
    for (const [rawRef, target] of Object.entries(targets)) {
        const ref = asSavedTargetRef(rawRef);
        if (strings.has(ref) || targetIdentityStrings(target).some(id => strings.has(id))) {
            roots.push(ref);
        }
    }
    const closure = savedTargetReferenceClosureV2(targets, roots);
    if (closure === undefined) throw new Error('Active blueprint reference closure is incomplete');
    return Object.freeze({
        schemaVersion: 1,
        targets: Object.freeze(Object.fromEntries(closure.map(ref => [ref, targets[ref]!]))),
    });
}

function targetIdentityStrings(target: SavedStateTargetV2): readonly string[] {
    switch (target.kind) {
        case 'critical-slot':
            return [target.location, target.savedSlotId ?? ''];
        case 'location-section':
            return [target.location];
        case 'component':
        case 'intrinsic-system':
            return [target.savedComponentId ?? ''];
        case 'ammo-source':
            return [target.savedAmmoSourceId ?? ''];
        case 'crew-position':
            return [target.savedCrewPositionId ?? ''];
    }
}

function collectNestedStrings(value: unknown, output: Set<string>): void {
    if (typeof value === 'string') {
        output.add(value);
        if (value.startsWith('ppc-capacitor:')) output.add(value.slice('ppc-capacitor:'.length));
        if (value.includes('|')) value.split('|').forEach(part => output.add(part));
        const first = value.charAt(0);
        if (first === '[' || first === '{') {
            try {
                collectNestedStrings(JSON.parse(value), output);
            } catch {
                // Ordinary text may begin with JSON punctuation.
            }
        }
        return;
    }
    if (Array.isArray(value)) {
        value.forEach(entry => collectNestedStrings(entry, output));
        return;
    }
    if (value !== null && typeof value === 'object') {
        Object.values(value as Record<string, unknown>)
            .forEach(entry => collectNestedStrings(entry, output));
    }
}

function serializeMekRuleChecks(
    checks: MekUnitRuntimeState['ruleChecks'],
    current: CurrentTargetIndex,
    stateRevision: MekUnitRuntimeState['stateRevision'],
): SerializedCBTUnitV2['ruleChecks'] {
    if (checks.size > 1) {
        codecFail('INVALID_RUNTIME_STATE', '$.state.ruleChecks', 'only the typed torso check is supported');
    }
    const entries = [...checks].sort(([left], [right]) => compareText(left, right)).map(([key, check]) => {
        if (key !== MEK_TORSO_CRIPPLING_RULE_CHECK_KEY
            || !Number.isSafeInteger(check.openedRevision)
            || check.openedRevision < 0
            || check.openedRevision > stateRevision
            || check.token !== createMekTorsoCripplingRuleCheckTokenV2(
                check.openedRevision,
                check.triggerLocationId,
            )
            || (check.status !== 'pending' && check.status !== 'success' && check.status !== 'failed')) {
            codecFail('INVALID_RUNTIME_STATE', `$.state.ruleChecks.${String(key)}`, 'invalid rule-check state');
        }
        const target = current.locationByCoordinate.get(locationCoordinate(
            check.triggerLocationId,
            'internal',
        ));
        if (!target) {
            codecFail(
                'INVALID_RUNTIME_STATE',
                `$.state.ruleChecks.${String(key)}.triggerLocationId`,
                `unknown internal location ${check.triggerLocationId}`,
            );
        }
        return Object.freeze({
            key,
            token: check.token,
            trigger: target.ref,
            openedRevision: asStateRevision(check.openedRevision),
            status: check.status,
        });
    });
    return Object.freeze({ schemaVersion: 1, entries: Object.freeze(entries) });
}

function restoreSavedMekRuleChecks(
    saved: SerializedCBTUnitV2,
    accumulator: RestoreAccumulator,
    ruleChecks: Map<
        typeof MEK_TORSO_CRIPPLING_RULE_CHECK_KEY,
        MekRuleCheckStateV2
    >,
): void {
    assertExactObjectKeys(saved.ruleChecks, ['schemaVersion', 'entries'], '$.ruleChecks');
    if (saved.ruleChecks.schemaVersion !== 1 || !Array.isArray(saved.ruleChecks.entries)) {
        codecFail('INVALID_SERIALIZED_STATE', '$.ruleChecks', 'invalid Mek rule-check container');
    }
    if (saved.ruleChecks.entries.length > 1) {
        codecFail('INVALID_SERIALIZED_STATE', '$.ruleChecks.entries', 'only the typed torso check is supported');
    }
    let previous: string | undefined;
    saved.ruleChecks.entries.forEach((entry, index) => {
        const path = `$.ruleChecks.entries[${index}]`;
        assertExactObjectKeys(entry, ['key', 'token', 'trigger', 'openedRevision', 'status'], path);
        if (entry.key !== MEK_TORSO_CRIPPLING_RULE_CHECK_KEY
            || (entry.status !== 'pending' && entry.status !== 'success' && entry.status !== 'failed')) {
            codecFail('INVALID_SERIALIZED_STATE', path, 'invalid Mek rule check');
        }
        if (previous !== undefined && previous >= entry.key) {
            codecFail('INVALID_SERIALIZED_STATE', `${path}.key`, 'rule checks must be unique and sorted');
        }
        previous = entry.key;
        canonicalBoundedText(entry.token, `${path}.token`);
        const openedRevision = asStateRevision(entry.openedRevision);
        if (openedRevision > saved.stateRevision) {
            codecFail('INVALID_SERIALIZED_STATE', `${path}.openedRevision`, 'cannot exceed unit revision');
        }
        const source = sourceTarget(accumulator, entry.trigger, 'location-section', path);
        if (source.section !== 'internal') {
            codecFail('TARGET_KIND_MISMATCH', `${path}.trigger`, 'torso check requires an internal location target');
        }
        const sourceLocationId = asLocationId(source.location);
        const sourceToken = createMekTorsoCripplingRuleCheckTokenV2(
            openedRevision,
            sourceLocationId,
        );
        if (entry.token !== sourceToken) {
            codecFail('INVALID_SERIALIZED_STATE', `${path}.token`, 'does not bind the exact saved torso trigger witness');
        }
        if (ruleChecks.has(entry.key)) {
            codecFail('INVALID_SERIALIZED_STATE', `${path}.key`, 'duplicate recoverable Mek rule check');
        }
        const fact: SerializedRecoverableStateFactV2 = {
            kind: 'mek-rule-check',
            key: entry.key,
            token: entry.token,
            openedRevision,
            status: entry.status,
        };
        const current = resolveLocationTarget(source, accumulator);
        if (!current || current.target.section !== 'internal') {
            unresolved(accumulator, entry.trigger, source, fact, 'MEK_RULE_CHECK_TRIGGER_NOT_FOUND');
            return;
        }
        const token = createMekTorsoCripplingRuleCheckTokenV2(
            openedRevision,
            current.locationId,
        );
        const rekeyed = entry.token !== token;
        if (rekeyed) warn(accumulator, {
            code: 'TARGET_REKEYED',
            message: 'A torso rule-check trigger was rebound to the current canonical location identity.',
            sourceTargetRef: entry.trigger,
            currentTargetRef: current.ref,
        });
        ruleChecks.set(entry.key, Object.freeze({
            token,
            triggerLocationId: current.locationId,
            openedRevision,
            status: entry.status,
        }));
        translated(accumulator, entry.trigger, current.ref, rekeyed);
    });
}

/**
 * Restores explicit saved deviations over the current initialized baseline. Provider + UUID is the
 * compatibility gate; source, entity, and initializer drift are diagnostics rather than refusal.
 */
export async function restoreSerializedCBTUnitV2(
    savedInput: SerializedCBTUnitV2,
    entity: MekEntity,
    index: MekRuntimeIndex,
    initialized: { readonly baselineRef: InstanceBaselineRef; readonly state: MekUnitRuntimeState },
): Promise<RestoreSerializedCBTUnitV2Result> {
    // The initializer projection is caller-owned too. Capture its structural baseline and clone
    // every runtime collection before restoration work yields; keep entity by reference.
    initialized = {
        baselineRef: canonicalClone(initialized.baselineRef),
        state: freezeRuntimeState(initialized.state),
    };
    let saved: SerializedCBTUnitV2;
    try {
        saved = structuredClone(savedInput);
    } catch (error) {
        codecFail(
            'INVALID_SERIALIZED_STATE',
            '$',
            error instanceof Error ? error.message : 'invalid serialized unit',
        );
    }
    assertExactSerializedUnitKeys(saved);
    assertSerializedIdentity(saved, initialized.baselineRef, entity);
    assertBaselineMatchesEntity(initialized.baselineRef, entity, '$.initialized.baselineRef');
    const unit = codecUnit(entity, index, initialized.baselineRef.ruleset);
    if (saved.schemaVersion !== CBT_UNIT_PERSISTENCE_SCHEMA_VERSION || saved.family.kind !== 'mek') {
        codecFail('INVALID_SERIALIZED_STATE', '$', 'only the current Mek serialized unit schema is supported');
    }
    try {
        validateSerializedCBTUnitRestorationV2(saved);
    } catch (error) {
        codecFail(
            'INVALID_SERIALIZED_STATE',
            '$.restoration',
            error instanceof Error ? error.message : 'invalid serialized restoration metadata',
        );
    }
    assertSavedMekHeatRecoveryAuthority(saved);
    if (saved.destroyed !== undefined && saved.destroyed !== true) {
        codecFail('INVALID_SERIALIZED_STATE', '$.destroyed', 'sparse destroyed state must be true when present');
    }
    asUnitInstanceId(saved.instanceId);
    asStateRevision(saved.stateRevision);
    if (saved.deployment.schemaVersion !== MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION) {
        codecFail('DEPLOYMENT_MISMATCH', '$.deployment', 'unsupported saved deployment version');
    }
    assertDeploymentValues(unit.index.crewPositions, saved.deployment, '$.deployment');
    const savedTurn = deserializeSavedTurn(saved.turn, '$.turn');
    const current = buildCurrentTargetIndex(unit);
    const warnings: V2StateRestoreWarning[] = [];
    const warningKeys = new Set<string>();
    const sourceTargets = saved.blueprintReferences.targets;
    const priorUnresolvedAtSave = saved.restoration?.unresolved ?? [];
    const ignoredRecovery = saved.restoration?.ignoredRecovery ?? [];
    const aliasBySourceWitness = await usableAliasMap(
        saved.restoration?.acceptedAliases ?? [],
        current,
        initialized.baselineRef.entity,
        saved.restoration?.heatRecovery?.sourceReferences.targets ?? sourceTargets,
    );
    const priorUnresolved = await applyIgnoredRecoveryDecisions(
        priorUnresolvedAtSave,
        ignoredRecovery,
    );
    const accumulator: RestoreAccumulator = {
        unit,
        currentIdentity: initialized.baselineRef.entity,
        current,
        sourceTargets,
        aliasBySourceWitness,
        translations: new Map(),
        warnings,
        warningKeys,
        unresolvedDrafts: [],
        appliedExact: 0,
        appliedWithWarning: 0,
    };
    await assertSavedRecoveryTranslationIsCanonical(saved);
    const restoredMovement = restoreSavedMekMovementPsr(saved, accumulator);

    const sourceHash = saved.entity.sourceHashAtSave ?? saved.baselineRefAtSave.entity.sourceHashAtSave;
    const currentHash = initialized.baselineRef.entity.sourceHashAtSave;
    if (sourceHash !== undefined && sourceHash !== currentHash) {
        warn(accumulator, {
            code: 'SOURCE_REVISION_CHANGED',
            message: 'The same design was restored against a different local source revision.',
            saved: { sourceHash },
            current: { sourceHash: currentHash ?? '<canonical>' },
        });
    }
    if (!jsonValuesEqual(saved.baselineRefAtSave.entity, initialized.baselineRef.entity)
        || saved.baselineRefAtSave.ruleset !== initialized.baselineRef.ruleset) {
        warn(accumulator, {
            code: 'ENTITY_BASELINE_CHANGED',
            message: 'The saved state was translated to the current entity baseline.',
        });
    }
    if (saved.baselineRefAtSave.initialStateProfile.initializerRevision
            !== initialized.baselineRef.initialStateProfile.initializerRevision
        || saved.baselineRefAtSave.initialStateProfile.profileId
            !== initialized.baselineRef.initialStateProfile.profileId) {
        warn(accumulator, {
            code: 'INITIAL_BASELINE_CHANGED',
            message: 'Omitted sparse facts adopt the current initializer defaults.',
            saved: {
                initializerRevision: saved.baselineRefAtSave.initialStateProfile.initializerRevision,
                profileId: saved.baselineRefAtSave.initialStateProfile.profileId,
            },
            current: {
                initializerRevision: initialized.baselineRef.initialStateProfile.initializerRevision,
                profileId: initialized.baselineRef.initialStateProfile.profileId,
            },
        });
    }

    const locations = new Map(initialized.state.locations);
    const slots = new Map(initialized.state.slots);
    const components = new Map(initialized.state.components);
    const ammo = new Map(initialized.state.ammo);
    const crew = new Map(initialized.state.crew);
    const ruleChecks = new Map(initialized.state.ruleChecks);
    const pendingLocation = new Map(initialized.state.pendingCombat.locationInternalDamage);
    const pendingArmor = new Map(initialized.state.pendingCombat.armorDamage);
    const pendingSlots = new Map(initialized.state.pendingCombat.criticalHits);
    const pendingComponents = new Map(initialized.state.pendingCombat.componentStatus);
    const pendingShieldDamage = new Map(initialized.state.pendingCombat.shieldDamage);
    const pendingModularArmorDamage = new Map(initialized.state.pendingCombat.modularArmorDamage);
    const pendingLocationConditions = clonePendingLocationConditions(
        initialized.state.pendingCombat.locationConditions,
    );
    const retainedPriorUnresolved = retryPriorUnresolved(
        priorUnresolved,
        saved.stateRevision,
        accumulator,
        locations,
        slots,
        components,
        ammo,
        crew,
        pendingLocation,
        pendingArmor,
        pendingSlots,
        pendingComponents,
        pendingShieldDamage,
        pendingModularArmorDamage,
        pendingLocationConditions,
        ruleChecks,
    );

    restoreSavedMekRuleChecks(saved, accumulator, ruleChecks);

    forEachUnique(saved.locationState, '$.locationState', entry => {
        const target = sourceTarget(accumulator, entry.target, 'location-section', '$.locationState');
        const fact: SerializedRecoverableStateFactV2 = { kind: 'location-damage', damage: entry.damage };
        const requested = requirePositiveSerializedInteger(entry.damage, '$.locationState.damage');
        const currentTarget = resolveLocationTarget(target, accumulator);
        if (!currentTarget) return unresolved(accumulator, entry.target, target, fact, 'LOCATION_SECTION_NOT_FOUND');
        const effective = Math.min(requested, currentTarget.maximum);
        let warned = false;
        if (effective !== requested) {
            warned = true;
            warn(accumulator, {
                code: 'DAMAGE_CLAMPED',
                message: `Saved damage ${requested} exceeds the current maximum ${currentTarget.maximum}.`,
                sourceTargetRef: entry.target,
                currentTargetRef: currentTarget.ref,
                saved: { damage: requested },
                current: { maximum: currentTarget.maximum, effectiveDamage: effective },
            });
            unresolved(accumulator, entry.target, target, fact, 'DAMAGE_EXCEEDS_CURRENT_MAXIMUM');
        }
        applyLocationDamage(locations, currentTarget, effective);
        translated(accumulator, entry.target, currentTarget.ref, warned);
    });

    forEachUniqueLocationCondition(saved.locationConditions, '$.locationConditions', entry => {
        const target = sourceTarget(accumulator, entry.target, 'location-section', '$.locationConditions');
        if (target.section !== 'internal') {
            codecFail('TARGET_KIND_MISMATCH', '$.locationConditions.target', 'location conditions require an internal location target');
        }
        const condition = requireMekLocationConditionKey(
            entry.condition,
            '$.locationConditions.condition',
            'INVALID_SERIALIZED_STATE',
        );
        const value = requireMekLocationConditionValue(
            condition,
            entry.value,
            '$.locationConditions.value',
            false,
            'INVALID_SERIALIZED_STATE',
        );
        const fact: SerializedRecoverableStateFactV2 = { kind: 'location-condition', condition, value };
        const currentTarget = resolveLocationTarget(target, accumulator);
        if (!currentTarget || currentTarget.target.section !== 'internal') {
            return unresolved(accumulator, entry.target, target, fact, 'LOCATION_NOT_FOUND_FOR_CONDITION');
        }
        applyLocationCondition(locations, currentTarget.locationId, condition, value);
        translated(accumulator, entry.target, currentTarget.ref, false);
    });

    forEachUnique(saved.slotState, '$.slotState', entry => {
        const target = sourceTarget(accumulator, entry.target, 'critical-slot', '$.slotState');
        const destroyedTurn = entry.destroyedTurn === undefined
            ? undefined
            : requirePositiveSerializedInteger(entry.destroyedTurn, '$.slotState.destroyedTurn');
        const fact: SerializedRecoverableStateFactV2 = {
            kind: 'slot-hits',
            hits: entry.hits,
            ...(destroyedTurn === undefined ? {} : { destroyedTurn }),
        };
        const hits = requirePositiveSerializedInteger(entry.hits, '$.slotState.hits');
        const currentTarget = resolveSlotTarget(target, accumulator);
        if (!currentTarget) return unresolved(accumulator, entry.target, target, fact, 'CRITICAL_SLOT_NOT_FOUND');
        const mismatch = warnForSlotOccupantMismatch(accumulator, entry.target, target, currentTarget);
        const effective = Math.min(hits, currentTarget.maximumHits);
        let warned = mismatch;
        if (effective !== hits) {
            warned = true;
            warn(accumulator, {
                code: 'DAMAGE_CLAMPED',
                message: `Saved critical hits ${hits} exceed the current slot capacity ${currentTarget.maximumHits}.`,
                sourceTargetRef: entry.target,
                currentTargetRef: currentTarget.ref,
                saved: { hits },
                current: { maximumHits: currentTarget.maximumHits, effectiveHits: effective },
            });
            unresolved(accumulator, entry.target, target, fact, 'CRITICAL_HITS_EXCEED_CURRENT_CAPACITY');
        }
        if (effective === 0) slots.delete(currentTarget.slotId);
        else slots.set(currentTarget.slotId, Object.freeze({
            hits: effective,
            ...(destroyedTurn === undefined || effective < currentTarget.directHitThreshold
                ? {}
                : { destroyedTurn }),
        }));
        translated(accumulator, entry.target, currentTarget.ref, warned);
    });

    forEachUnique(saved.componentState, '$.componentState', entry => {
        const target = sourceTarget(accumulator, entry.target, ['component', 'intrinsic-system'], '$.componentState');
        const savedState = translateSavedComponentRuntimeIds(
            deserializeComponentState(entry, '$.componentState'),
            accumulator,
        );
        const savedFact = componentStateFact(savedState);
        if (!savedFact) {
            codecFail('INVALID_SERIALIZED_STATE', '$.componentState', 'sparse component state must contain a fact');
        }
        const currentTarget = resolveComponentTarget(target, accumulator, entry.target);
        if (!currentTarget) {
            if (savedState.statusOverride !== undefined) {
                unresolved(accumulator, entry.target, target, {
                    kind: 'component-state',
                    statusOverride: savedState.statusOverride,
                }, 'COMPONENT_NOT_UNIQUELY_TYPE_COMPATIBLE');
            }
            if (savedState.mode !== undefined || savedState.jammed !== undefined
                || savedState.escalatingFailure !== undefined || savedState.ppcCapacitor !== undefined
                || savedState.bombastLaser !== undefined
                || savedState.c3EmergencyMaster !== undefined
                || savedState.gaussPower !== undefined || savedState.shieldDamage !== undefined
                || savedState.modularArmorDamage !== undefined) {
                unresolved(accumulator, entry.target, target, {
                    kind: 'component-state',
                    ...(savedState.mode === undefined ? {} : { mode: savedState.mode }),
                    ...(savedState.jammed === undefined ? {} : { jammed: true }),
                    ...(savedState.escalatingFailure === undefined
                        ? {}
                        : { escalatingFailure: savedState.escalatingFailure }),
                    ...(savedState.ppcCapacitor === undefined
                        ? {}
                        : { ppcCapacitor: savedState.ppcCapacitor }),
                    ...(savedState.bombastLaser === undefined
                        ? {}
                        : { bombastLaser: savedState.bombastLaser }),
                    ...(savedState.c3EmergencyMaster === undefined
                        ? {}
                        : { c3EmergencyMaster: savedState.c3EmergencyMaster }),
                    ...(savedState.gaussPower === undefined
                        ? {}
                        : { gaussPower: savedState.gaussPower }),
                    ...(savedState.shieldDamage === undefined
                        ? {}
                        : { shieldDamage: savedState.shieldDamage }),
                    ...(savedState.modularArmorDamage === undefined
                        ? {}
                        : { modularArmorDamage: savedState.modularArmorDamage }),
                }, 'COMPONENT_NOT_UNIQUELY_TYPE_COMPATIBLE');
            }
            return;
        }
        const partition = partitionComponentState(savedState, currentTarget);
        if (partition.supportedFact) applyComponentState(components, currentTarget.componentId, partition);
        const rekeyed = componentSavedId(target) !== currentTarget.componentId;
        if (rekeyed) warnRekeyed(accumulator, entry.target, currentTarget.ref, 'component');
        if (partition.clampedShieldDamage) {
            unresolved(accumulator, entry.target, target, {
                kind: 'component-state',
                shieldDamage: partition.clampedShieldDamage.requested,
            }, 'SHIELD_DAMAGE_EXCEEDS_CURRENT_CAPACITY');
            warn(accumulator, {
                code: 'DAMAGE_CLAMPED',
                message: 'Saved shield damage exceeds the current shield track bounds.',
                sourceTargetRef: entry.target,
                currentTargetRef: currentTarget.ref,
                saved: { ...partition.clampedShieldDamage.requested },
                current: {
                    maximumAbsorption: currentTarget.shieldMaximumAbsorption,
                    maximumCapacity: currentTarget.shieldMaximumCapacity,
                    effectiveDamage: partition.clampedShieldDamage.effective,
                },
            });
        }
        if (partition.unsupportedFact) {
            unresolved(
                accumulator,
                entry.target,
                target,
                partition.unsupportedFact,
                'UNSUPPORTED_COMPONENT_CAPABILITY',
            );
            warn(accumulator, {
                code: 'UNSUPPORTED_EQUIPMENT_STATE_RETAINED',
                message: 'Component runtime state unsupported by the current equipment definition was retained for recovery.',
                sourceTargetRef: entry.target,
                currentTargetRef: currentTarget.ref,
            });
        }
        if (partition.supportedFact) {
            translated(
                accumulator,
                entry.target,
                currentTarget.ref,
                rekeyed || partition.unsupportedFact !== null || partition.clampedShieldDamage !== undefined,
            );
        }
        else accumulator.translations.set(entry.target, currentTarget.ref);
    });

    forEachUnique(saved.ammoState, '$.ammoState', entry => {
        const target = sourceTarget(accumulator, entry.target, 'ammo-source', '$.ammoState');
        const requested = requireNonnegativeInteger(entry.shotsSpent, '$.ammoState.shotsSpent');
        const munitionOverride = optionalBoundedText(entry.munitionOverride, '$.ammoState.munitionOverride');
        const shotsFact: SerializedRecoverableStateFactV2 | null = requested === 0
            ? null
            : { kind: 'ammo-state', shotsSpent: requested };
        const munitionFact: SerializedRecoverableStateFactV2 | null = munitionOverride === undefined
            ? null
            : { kind: 'ammo-state', shotsSpent: 0, munitionOverride };
        if (!shotsFact && !munitionFact) {
            codecFail('INVALID_SERIALIZED_STATE', '$.ammoState', 'sparse ammunition state must contain a fact');
        }
        if (target.munitionAtSave !== undefined && target.munitionAtSave !== munitionOverride) {
            codecFail('INVALID_SERIALIZED_STATE', '$.ammoState.munitionOverride', 'munition fact disagrees with its saved target witness');
        }
        const currentTarget = resolveAmmoTarget(target, accumulator, entry.target);
        if (!currentTarget) {
            if (shotsFact) {
                unresolved(
                    accumulator,
                    entry.target,
                    target,
                    shotsFact,
                    'AMMO_SOURCE_NOT_UNIQUELY_TYPE_COMPATIBLE',
                );
            }
            if (munitionFact) {
                unresolved(accumulator, entry.target, target, munitionFact, 'UNSUPPORTED_MUNITION_CAPABILITY');
            }
            return;
        }
        const selectedLoadout = mekAmmoLoadout(
            accumulator.unit.entity,
            accumulator.unit.index,
            currentTarget.componentId,
            accumulator.unit.ruleset,
            munitionOverride,
        );
        const supportedMunition = munitionOverride === undefined || selectedLoadout !== null;
        const currentCapacity = selectedLoadout?.capacity ?? currentTarget.capacity;
        const effective = Math.min(requested, currentCapacity);
        let warned = false;
        if (target.capacityAtSave !== undefined && target.capacityAtSave !== currentCapacity) {
            warned = true;
            warn(accumulator, {
                code: 'AMMO_CAPACITY_CHANGED',
                message: 'The matched ammunition source has a different current capacity.',
                sourceTargetRef: entry.target,
                currentTargetRef: currentTarget.ref,
                saved: { capacity: target.capacityAtSave },
                current: { capacity: currentCapacity },
            });
        }
        if (effective !== requested) {
            warned = true;
            warn(accumulator, {
                code: 'DAMAGE_CLAMPED',
                message: `Saved ammunition consumption ${requested} exceeds current capacity ${currentCapacity}.`,
                sourceTargetRef: entry.target,
                currentTargetRef: currentTarget.ref,
                saved: { shotsSpent: requested },
                current: { capacity: currentCapacity, effectiveShotsSpent: effective },
            });
            unresolved(
                accumulator,
                entry.target,
                target,
                shotsFact!,
                'AMMO_CONSUMPTION_EXCEEDS_CURRENT_CAPACITY',
            );
        }
        if (munitionOverride !== undefined && !supportedMunition) {
            warned = true;
            unresolved(accumulator, entry.target, target, munitionFact!, 'UNSUPPORTED_MUNITION_CAPABILITY');
            warn(accumulator, {
                code: 'UNSUPPORTED_EQUIPMENT_STATE_RETAINED',
                message: 'An uncompiled munition override was retained for recovery instead of being applied.',
                sourceTargetRef: entry.target,
                currentTargetRef: currentTarget.ref,
            });
        }
        if (effective > 0 || (munitionOverride !== undefined && supportedMunition)) {
            ammo.set(
                currentTarget.componentId,
                Object.freeze({
                    shotsSpent: effective,
                    ...(munitionOverride !== undefined && supportedMunition ? { munitionOverride } : {}),
                }),
            );
        } else if (munitionOverride === undefined) ammo.delete(currentTarget.componentId);
        const rekeyed = target.savedAmmoSourceId !== undefined
            && target.savedAmmoSourceId !== currentTarget.componentId;
        if (rekeyed) warnRekeyed(accumulator, entry.target, currentTarget.ref, 'ammo source');
        if (shotsFact || (munitionFact && supportedMunition)) {
            translated(accumulator, entry.target, currentTarget.ref, warned || rekeyed);
        } else accumulator.translations.set(entry.target, currentTarget.ref);
    });

    forEachUnique(saved.crew.positions, '$.crew.positions', entry => {
        const target = sourceTarget(accumulator, entry.target, 'crew-position', '$.crew.positions');
        const requested = requireNonnegativeInteger(entry.wounds, '$.crew.positions.wounds');
        if (typeof entry.unconscious !== 'boolean') {
            codecFail('INVALID_SERIALIZED_STATE', '$.crew.positions.unconscious', 'must be boolean');
        }
        const ejected = entry.ejected === true;
        const dead = entry.dead === true;
        if (entry.dead !== undefined && !dead) {
            codecFail('INVALID_SERIALIZED_STATE', '$.crew.positions.dead', 'sparse dead state must be true');
        }
        if (entry.ejected !== undefined && !ejected) {
            codecFail('INVALID_SERIALIZED_STATE', '$.crew.positions.ejected', 'sparse ejected state must be true');
        }
        if (dead && requested < MAX_MEK_CREW_WOUNDS) {
            codecFail(
                'INVALID_SERIALIZED_STATE',
                '$.crew.positions.dead',
                'committed death requires fatal wounds',
            );
        }
        const recoveryReadyTurn = entry.recoveryReadyTurn;
        if (recoveryReadyTurn !== undefined
            && recoveryReadyTurn !== null
            && (!Number.isSafeInteger(recoveryReadyTurn) || recoveryReadyTurn < 0)) {
            codecFail(
                'INVALID_SERIALIZED_STATE',
                '$.crew.positions.recoveryReadyTurn',
                'must be null or a nonnegative integer',
            );
        }
        if (recoveryReadyTurn !== undefined && !entry.unconscious) {
            codecFail(
                'INVALID_SERIALIZED_STATE',
                '$.crew.positions.recoveryReadyTurn',
                'requires unconscious crew',
            );
        }
        if (requested === 0 && !entry.unconscious && !ejected) {
            codecFail('INVALID_SERIALIZED_STATE', '$.crew.positions', 'sparse crew state must contain a fact');
        }
        const fact: SerializedRecoverableStateFactV2 = {
            kind: 'crew-state',
            wounds: requested,
            unconscious: entry.unconscious,
            ...(dead ? { dead: true } : {}),
            ...(ejected ? { ejected: true } : {}),
        };
        const currentTarget = resolveCrewTarget(target, accumulator, entry.target);
        if (!currentTarget) return unresolved(accumulator, entry.target, target, fact, 'CREW_POSITION_NOT_FOUND');
        const effective = Math.min(requested, MAX_MEK_CREW_WOUNDS);
        let warned = false;
        if (effective !== requested) {
            warned = true;
            warn(accumulator, {
                code: 'DAMAGE_CLAMPED',
                message: `Saved crew wounds ${requested} exceed the current limit ${MAX_MEK_CREW_WOUNDS}.`,
                sourceTargetRef: entry.target,
                currentTargetRef: currentTarget.ref,
                saved: { wounds: requested },
                current: { maximumWounds: MAX_MEK_CREW_WOUNDS, effectiveWounds: effective },
            });
            unresolved(accumulator, entry.target, target, fact, 'CREW_WOUNDS_EXCEED_CURRENT_LIMIT');
        }
        if (effective === 0 && !entry.unconscious && !ejected) crew.delete(currentTarget.positionId);
        else crew.set(currentTarget.positionId, Object.freeze({
            wounds: effective,
            unconscious: entry.unconscious,
            ejected,
            ...(dead ? { dead: true as const } : {}),
            ...(recoveryReadyTurn === undefined ? {} : { recoveryReadyTurn }),
        }));
        const rekeyed = target.savedCrewPositionId !== undefined
            && target.savedCrewPositionId !== currentTarget.positionId;
        if (rekeyed) warnRekeyed(accumulator, entry.target, currentTarget.ref, 'crew position');
        translated(accumulator, entry.target, currentTarget.ref, warned || rekeyed);
    });

    assertNoNarcOnPhysicallyDestroyedLocations(
        unit.index,
        locations,
        '$.locationConditions',
        'INVALID_SERIALIZED_STATE',
    );

    restorePending(
        saved.pendingCombat,
        accumulator,
        locations,
        slots,
        components,
        pendingLocation,
        pendingArmor,
        pendingSlots,
        pendingComponents,
        pendingShieldDamage,
        pendingModularArmorDamage,
        pendingLocationConditions,
    );
    const turn = translateSavedHeatAcknowledgements(savedTurn, accumulator);

    const pendingCombat: PendingCombatOverlay = Object.freeze({
        locationInternalDamage: new ImmutableIndex(pendingLocation),
        armorDamage: new ImmutableIndex(pendingArmor),
        criticalHits: new ImmutableIndex(pendingSlots),
        componentStatus: new ImmutableIndex(pendingComponents),
        shieldDamage: new ImmutableIndex(pendingShieldDamage),
        modularArmorDamage: new ImmutableIndex(pendingModularArmorDamage),
        locationConditions: new ImmutableIndex([...pendingLocationConditions].map(
            ([locationId, conditionValues]) => [locationId, new ImmutableIndex(conditionValues)] as const,
        )),
    });
    const conditions = saved.conditions === undefined
        ? initialized.state.conditions
        : new ImmutableSet<UnitConditionKey>(validateSortedUniqueText(
            saved.conditions.values,
            '$.conditions.values',
        ).map((condition, index): UnitConditionKey => {
            if (!isUnitConditionKey(condition)) {
                codecFail(
                    'INVALID_SERIALIZED_STATE',
                    `$.conditions.values[${index}]`,
                    'unknown unit condition',
                );
            }
            return condition;
        }));
    let heat = initialized.state.heat;
    if (saved.heat !== undefined) {
        const current = requireNonnegativeFinite(saved.heat.heat, '$.heat.heat');
        const previous = saved.heat.previous === undefined
            ? 0
            : requireNonnegativeFinite(saved.heat.previous, '$.heat.previous');
        if (saved.heat.previous !== undefined && previous === 0) {
            codecFail('INVALID_SERIALIZED_STATE', '$.heat.previous', 'sparse previous heat must be positive');
        }
        const pendingOverride = saved.heat.pendingOverride === undefined
            ? undefined
            : requireNonnegativeFinite(saved.heat.pendingOverride, '$.heat.pendingOverride');
        const heatsinksOff = saved.heat.heatsinksOff === undefined
            ? 0
            : requireNonnegativeInteger(saved.heat.heatsinksOff, '$.heat.heatsinksOff');
        if (saved.heat.heatsinksOff !== undefined && heatsinksOff === 0) {
            codecFail('INVALID_SERIALIZED_STATE', '$.heat.heatsinksOff', 'sparse heatsinks-off count must be positive');
        }
        try {
            heat = canonicalizeMekHeatStateV2({
                current,
                previous,
                ...(pendingOverride === undefined ? {} : { pendingOverride }),
                heatsinksOff,
            });
        } catch (error) {
            codecFail(
                'INVALID_SERIALIZED_STATE',
                '$.heat',
                error instanceof Error ? error.message : 'invalid heat state',
            );
        }
    }
    const attackerTargeting = restoreAttackerTargeting(saved.attackerTargeting, accumulator);
    let equipmentRowOrder: EquipmentRowOrderState | undefined;
    try {
        equipmentRowOrder = freezeEquipmentRowOrder(saved.equipmentRowOrder);
    } catch (error) {
        codecFail(
            'INVALID_SERIALIZED_STATE',
            '$.equipmentRowOrder',
            error instanceof Error ? error.message : 'invalid equipment row order',
        );
    }
    const { equipmentRowOrder: _initializedOrder, ...initializedState } = initialized.state;
    const state = freezeRuntimeState({
        ...initializedState,
        stateRevision: asStateRevision(saved.stateRevision),
        explicitlyDestroyed: saved.destroyed === true,
        destroyed: saved.destroyed === true,
        locations: new ImmutableIndex(locations),
        slots: new ImmutableIndex(slots),
        components: new ImmutableIndex(components),
        ammo: new ImmutableIndex(ammo),
        crew: new ImmutableIndex(crew),
        ruleChecks: freezeRuleChecks(ruleChecks),
        conditions,
        heat,
        movementPsr: restoredMovement,
        attackerTargeting,
        ...(equipmentRowOrder === undefined ? {} : { equipmentRowOrder }),
        turn,
        pendingCombat,
    });

    const retainedPriorRecoveryIds = new Set(retainedPriorUnresolved.map(entry => entry.recoveryId));
    const finalizedUnresolved = await finalizeUnresolved(
        accumulator.unresolvedDrafts,
        new Set(retainedPriorRecoveryIds),
    );
    const newUnresolved = await applyIgnoredRecoveryDecisions(
        finalizedUnresolved,
        ignoredRecovery,
        retainedPriorRecoveryIds,
    );
    const combinedUnresolved = [
        ...retainedPriorUnresolved,
        ...newUnresolved,
    ];
    const combinedRecoveryIds = new Set<string>();
    for (const entry of combinedUnresolved) {
        if (combinedRecoveryIds.has(entry.recoveryId)) {
            codecFail(
                'INVALID_SERIALIZED_STATE',
                '$.restoration.unresolved',
                `retained and newly generated recovery rows collide at ID ${entry.recoveryId}`,
            );
        }
        combinedRecoveryIds.add(entry.recoveryId);
    }
    const unresolvedEntries = Object.freeze(combinedUnresolved.sort((left, right) =>
        compareText(left.recoveryId, right.recoveryId)));
    const persistedWarnings = mergePersistedWarnings(saved.restoration?.warnings ?? [], warnings);
    const sourceChanged = saved.restoration?.sourceChanged === true
        || !jsonValuesEqual(saved.baselineRefAtSave.entity, initialized.baselineRef.entity)
        || saved.baselineRefAtSave.ruleset !== initialized.baselineRef.ruleset;
    const targetTranslation = Object.freeze(Object.fromEntries(
        [...accumulator.translations].sort(([left], [right]) => compareText(left, right)),
    ) as Record<SavedTargetRef, SavedTargetRef>);
    const heatRecovery = buildDurableMekHeatRecoveryAuthority(
        saved,
        current.table,
        unresolvedEntries,
        retainedPriorRecoveryIds,
        accumulator,
    );
    const acceptedAliases = await retainActiveRecoveryAliases(
        saved.restoration?.acceptedAliases ?? [],
        unresolvedEntries,
    );
    const metadata: SerializedUnitRestorationMetadataV2 = canonicalClone({
        schemaVersion: 1,
        algorithmVersion: V2_STATE_RESTORATION_ALGORITHM_VERSION,
        fromBaseline: saved.restoration?.fromBaseline ?? saved.baselineRefAtSave,
        sourceChanged,
        warnings: persistedWarnings,
        unresolved: unresolvedEntries,
        acceptedAliases,
        ...(saved.restoration?.ignoredRecovery === undefined
            ? {}
            : { ignoredRecovery: saved.restoration.ignoredRecovery }),
        ...(heatRecovery === undefined ? {} : { heatRecovery }),
    });

    return Object.freeze({
        state,
        baselineRef: initialized.baselineRef,
        blueprintReferences: current.table,
        targetTranslation,
        metadata,
        warnings: Object.freeze(warnings.map(canonicalClone)),
        unresolved: unresolvedEntries,
        appliedExact: accumulator.appliedExact,
        appliedWithWarning: accumulator.appliedWithWarning,
    });
}

function restoreSavedMekMovementPsr(
    saved: SerializedCBTUnitV2,
    accumulator: RestoreAccumulator,
): MekMovementPsrStateV2 {
    let sourceState: MekMovementPsrStateV2;
    try {
        sourceState = deserializeMekMovementPsrStateV2(saved.movementPsr);
    } catch (error) {
        codecFail(
            'INVALID_SERIALIZED_STATE',
            '$.movementPsr',
            error instanceof Error ? error.message : 'invalid movement/PSR state',
        );
    }
    const remapped = remapMekMovementPsrStateIdsV2(
        sourceState,
        movementPsrIdResolvers(saved.blueprintReferences, accumulator),
    );
    if (remapped.accepted) return remapped.state;
    codecFail(
        'INVALID_SERIALIZED_STATE',
        '$.movementPsr',
        `cannot map movement/PSR state to the current entity: ${[
            ...new Set(remapped.unresolved.map(issue => issue.code)),
        ].sort(compareText).join(', ')}`,
    );
}

function movementPsrIdResolvers(
    sourceReferences: SavedBlueprintReferenceTableV2,
    accumulator: RestoreAccumulator,
): Parameters<typeof remapMekMovementPsrStateIdsV2>[1] {
    const sourceRows = Object.freeze(Object.entries(sourceReferences.targets).map(
        ([ref, target]) => Object.freeze([asSavedTargetRef(ref), target] as const),
    ));
    return Object.freeze({
        componentId: (sourceId: ComponentId) => {
            const candidates = new Set<ComponentId>();
            for (const [sourceRef, target] of sourceRows) {
                if ((target.kind !== 'component' && target.kind !== 'intrinsic-system')
                    || target.savedComponentId !== sourceId) continue;
                for (const id of movementComponentCandidates(target, sourceRef, accumulator)) {
                    candidates.add(id);
                }
            }
            return Object.freeze([...candidates].sort(compareText));
        },
        criticalSlotId: (sourceId: CriticalSlotId) => {
            const candidates = new Set<CriticalSlotId>();
            for (const [, target] of sourceRows) {
                if (target.kind !== 'critical-slot' || target.savedSlotId !== sourceId) continue;
                const exact = accumulator.current.slotById.get(sourceId);
                if (exact
                    && exact.target.location === target.location
                    && exact.target.slot === target.slot) candidates.add(exact.slotId);
                const coordinate = accumulator.current.slotByCoordinate.get(
                    slotCoordinate(target.location, target.slot),
                );
                if (coordinate) candidates.add(coordinate.slotId);
            }
            return Object.freeze([...candidates].sort(compareText));
        },
        locationId: (sourceId: LocationId) => {
            const candidates = new Set<LocationId>();
            for (const [, target] of sourceRows) {
                if (target.kind !== 'location-section' || target.location !== sourceId) continue;
                const current = accumulator.current.locationByCoordinate.get(
                    locationCoordinate(target.location, target.section),
                );
                if (current) candidates.add(current.locationId);
            }
            return Object.freeze([...candidates].sort(compareText));
        },
    });
}

function movementComponentCandidates(
    target: Extract<SavedStateTargetV2, { kind: 'component' | 'intrinsic-system' }>,
    sourceRef: SavedTargetRef,
    accumulator: RestoreAccumulator,
): readonly ComponentId[] {
    const savedId = componentSavedId(target);
    if (savedId !== undefined) {
        const exact = accumulator.current.componentById.get(savedId);
        if (exact && componentsCompatible(target, exact.target)) return Object.freeze([exact.componentId]);
    }
    const alias = acceptedAliasTarget(sourceRef, target, accumulator);
    if (alias && isCurrentComponent(alias) && componentsCompatible(target, alias.target)) {
        return Object.freeze([alias.componentId]);
    }
    let candidates = accumulator.current.components.filter(candidate =>
        componentsCompatible(target, candidate.target));
    if (target.criticalSlots.length > 0) {
        const occupantIds = componentsAtAllCoordinates(target.criticalSlots, accumulator);
        const atSavedSlots = candidates.filter(candidate => occupantIds.has(candidate.componentId));
        if (atSavedSlots.length > 0) candidates = atSavedSlots;
    }
    if (target.locations.length > 0) {
        const atSavedLocations = candidates.filter(candidate =>
            sameStringSet(target.locations, candidate.target.locations));
        if (atSavedLocations.length > 0) candidates = atSavedLocations;
    }
    if (target.kind === 'component' && target.occurrence !== undefined) {
        const sameOccurrence = candidates.filter(candidate =>
            candidate.target.kind === 'component'
            && candidate.target.occurrence === target.occurrence);
        if (sameOccurrence.length > 0) candidates = sameOccurrence;
    }
    return Object.freeze([...new Set(candidates.map(candidate => candidate.componentId))].sort(compareText));
}

function retainActiveRecoveryAliases(
    aliases: readonly SerializedPersistedRestoreAliasV2[],
    unresolved: readonly SerializedUnresolvedStateRecoveryEntryV2[],
): readonly SerializedPersistedRestoreAliasV2[] {
    const active = new Set(unresolved.map(entry => entry.sourceTargetRef));
    return Object.freeze(aliases.filter(alias => active.has(alias.sourceTargetRef)));
}

function buildDurableMekHeatRecoveryAuthority(
    saved: SerializedCBTUnitV2,
    currentReferences: SavedBlueprintReferenceTableV2,
    unresolved: readonly SerializedUnresolvedStateRecoveryEntryV2[],
    retainedPriorRecoveryIds: ReadonlySet<string>,
    accumulator: RestoreAccumulator,
): SerializedMekHeatRecoveryAuthorityV1 | undefined {
    if (unresolved.length === 0) return undefined;
    const prior = saved.restoration?.heatRecovery;
    if (prior !== undefined && !sameReferenceTable(prior.currentReferences, saved.blueprintReferences)) {
        codecFail(
            'INVALID_SERIALIZED_STATE',
            '$.restoration.heatRecovery.currentReferences',
            'does not match the saved unit reference table',
        );
    }

    const mergedTargets: Record<SavedTargetRef, SavedStateTargetV2> = {};
    for (const [index, entry] of unresolved.entries()) {
        const ref = entry.sourceTargetRef;
        const owningTable = retainedPriorRecoveryIds.has(entry.recoveryId)
            ? prior?.sourceReferences ?? saved.blueprintReferences
            : saved.blueprintReferences;
        const durableTarget = owningTable.targets[ref];
        if (durableTarget === undefined
            || !jsonValuesEqual(durableTarget, entry.sourceTarget)) {
            codecFail(
                'INVALID_SERIALIZED_STATE',
                `$.restoration.unresolved[${index}].sourceTargetRef`,
                'recovery source is not owned by the saved or retained source table',
            );
        }
        const sourceClosure = savedTargetReferenceClosureV2(owningTable.targets, [ref]);
        if (sourceClosure === undefined) {
            codecFail(
                'INVALID_SERIALIZED_STATE',
                `$.restoration.unresolved[${index}].sourceTargetRef`,
                'active recovery source closure is incomplete',
            );
        }
        for (const requiredRef of sourceClosure) {
            const requiredTarget = owningTable.targets[requiredRef]!;
            const existing = mergedTargets[requiredRef];
            if (existing !== undefined
                && !jsonValuesEqual(existing, requiredTarget)) {
                codecFail(
                    'INVALID_SERIALIZED_STATE',
                    `$.restoration.heatRecovery.sourceReferences.targets.${requiredRef}`,
                    'active recovery source closures collide at one ref with different target content',
                );
            }
            mergedTargets[requiredRef] = requiredTarget;
        }
    }
    const canonicalMergedTargets = Object.fromEntries(
        Object.entries(mergedTargets).sort(([left], [right]) => compareText(left, right)),
    ) as Record<SavedTargetRef, SavedStateTargetV2>;
    const sourceReferences: SavedBlueprintReferenceTableV2 = Object.freeze({
        schemaVersion: 1,
        targets: Object.freeze(canonicalMergedTargets),
    });
    assertRecoverySourcesOwnEntries(sourceReferences, unresolved);
    const targetTranslation = deriveActiveRecoveryTranslation(unresolved, accumulator);
    return Object.freeze({
        schemaVersion: 1,
        sourceReferences,
        targetTranslation,
        currentReferences,
    });
}

async function assertSavedRecoveryTranslationIsCanonical(
    saved: SerializedCBTUnitV2,
): Promise<void> {
    const authority = saved.restoration?.heatRecovery;
    if (authority === undefined) return;
    const expected: Record<SavedTargetRef, SavedTargetRef> = {};
    for (const entry of saved.restoration?.unresolved ?? []) {
        const aliases = (saved.restoration?.acceptedAliases ?? []).filter(alias =>
            alias.sourceTargetRef === entry.sourceTargetRef
            && alias.algorithmVersion === V2_STATE_RESTORATION_ALGORITHM_VERSION
            && jsonValuesEqual(alias.targetEntity, saved.baselineRefAtSave.entity));
        const aliasTargets = [...new Set(aliases.map(alias => alias.target))];
        if (aliasTargets.length > 1) {
            codecFail(
                'INVALID_SERIALIZED_STATE',
                '$.restoration.acceptedAliases',
                'one active source witness has conflicting aliases for the saved entity',
            );
        }
        let targetRef: SavedTargetRef | undefined = aliasTargets[0];
        if (targetRef !== undefined) {
            const target = authority.currentReferences.targets[targetRef];
            if (target === undefined || !recoveryAliasKindsCompatible(entry.sourceTarget, target)) {
                codecFail(
                    'TARGET_KIND_MISMATCH',
                    '$.restoration.acceptedAliases.target',
                    'saved-entity alias does not select a compatible current target',
                );
            }
        } else {
            targetRef = resolveSavedTargetInReferenceTable(
                entry.sourceTargetRef,
                entry.sourceTarget,
                authority.currentReferences,
            );
        }
        if (targetRef !== undefined) {
            expected[entry.sourceTargetRef] = targetRef;
        }
    }
    const canonicalExpected = Object.freeze(Object.fromEntries(
        Object.entries(expected).sort(([left], [right]) => compareText(left, right)),
    ) as Record<SavedTargetRef, SavedTargetRef>);
    if (!jsonValuesEqual(authority.targetTranslation, canonicalExpected)) {
        codecFail(
            'INVALID_SERIALIZED_STATE',
            '$.restoration.heatRecovery.targetTranslation',
            'must equal the exact active-row mapping derived from the saved reference table and accepted aliases',
        );
    }
}

function resolveSavedTargetInReferenceTable(
    sourceRef: SavedTargetRef,
    source: SavedStateTargetV2,
    current: SavedBlueprintReferenceTableV2,
): SavedTargetRef | undefined {
    const exact = current.targets[sourceRef];
    if (exact !== undefined && jsonValuesEqual(exact, source)) {
        return sourceRef;
    }
    const candidates = Object.entries(current.targets)
        .filter(([, target]) => recoveryAliasKindsCompatible(source, target))
        .map(([ref, target]) => ({ ref: asSavedTargetRef(ref), target }));
    switch (source.kind) {
        case 'location-section':
            return uniqueSavedTargetRef(candidates.filter(({ target }) =>
                target.kind === 'location-section'
                && target.location === source.location
                && target.section === source.section));
        case 'critical-slot':
            return uniqueSavedTargetRef(candidates.filter(({ target }) =>
                target.kind === 'critical-slot'
                && target.location === source.location
                && target.slot === source.slot));
        case 'component':
        case 'intrinsic-system':
            return resolveSavedComponentTarget(source, candidates);
        case 'ammo-source':
            return resolveSavedAmmoTarget(source, candidates);
        case 'crew-position':
            return resolveSavedCrewTarget(source, candidates);
    }
}

function resolveSavedComponentTarget(
    source: Extract<SavedStateTargetV2, { kind: 'component' | 'intrinsic-system' }>,
    candidates: readonly { readonly ref: SavedTargetRef; readonly target: SavedStateTargetV2 }[],
): SavedTargetRef | undefined {
    let compatible = candidates.filter((candidate): candidate is {
        readonly ref: SavedTargetRef;
        readonly target: Extract<SavedStateTargetV2, { kind: 'component' | 'intrinsic-system' }>;
    } => (candidate.target.kind === 'component' || candidate.target.kind === 'intrinsic-system')
        && componentsCompatible(source, candidate.target));
    const savedId = componentSavedId(source);
    if (savedId !== undefined) {
        const exact = compatible.filter(({ target }) => componentSavedId(target) === savedId);
        if (exact.length === 1) return exact[0].ref;
    }
    if (source.criticalSlots.length > 0) {
        const atSlots = compatible.filter(({ target }) =>
            sameSavedSlotCoordinates(source.criticalSlots, target.criticalSlots));
        if (atSlots.length === 1) return atSlots[0].ref;
        if (atSlots.length > 1) compatible = atSlots;
    }
    if (source.locations.length > 0) {
        const atLocations = compatible.filter(({ target }) =>
            sameStringSet(source.locations, target.locations));
        if (atLocations.length === 1) return atLocations[0].ref;
        if (atLocations.length > 1) compatible = atLocations;
    }
    if (source.kind === 'component' && source.occurrence !== undefined) {
        const atOccurrence = compatible.filter(({ target }) =>
            target.kind === 'component' && target.occurrence === source.occurrence);
        if (atOccurrence.length === 1) return atOccurrence[0].ref;
        if (atOccurrence.length > 1) compatible = atOccurrence;
    }
    return uniqueSavedTargetRef(compatible);
}

function resolveSavedAmmoTarget(
    source: Extract<SavedStateTargetV2, { kind: 'ammo-source' }>,
    candidates: readonly { readonly ref: SavedTargetRef; readonly target: SavedStateTargetV2 }[],
): SavedTargetRef | undefined {
    let compatible = candidates.filter((candidate): candidate is {
        readonly ref: SavedTargetRef;
        readonly target: Extract<SavedStateTargetV2, { kind: 'ammo-source' }>;
    } => candidate.target.kind === 'ammo-source' && ammoCompatible(source, candidate.target));
    const savedId = source.savedAmmoSourceId
        ?? (source.source.kind === 'installed-bin' ? source.source.savedComponentId : undefined);
    if (savedId !== undefined) {
        const exact = compatible.filter(({ target }) => {
            const targetId = target.savedAmmoSourceId
                ?? (target.source.kind === 'installed-bin' ? target.source.savedComponentId : undefined);
            return targetId === savedId;
        });
        if (exact.length === 1) return exact[0].ref;
    }
    if (source.criticalSlots.length > 0) {
        const atSlots = compatible.filter(({ target }) =>
            sameSavedSlotCoordinates(source.criticalSlots, target.criticalSlots));
        if (atSlots.length === 1) return atSlots[0].ref;
        if (atSlots.length > 1) compatible = atSlots;
    }
    if (source.location !== undefined) {
        const atLocation = compatible.filter(({ target }) => target.location === source.location);
        if (atLocation.length === 1) return atLocation[0].ref;
        if (atLocation.length > 1) compatible = atLocation;
    }
    if (source.occurrence !== undefined) {
        const atOccurrence = compatible.filter(({ target }) => target.occurrence === source.occurrence);
        if (atOccurrence.length === 1) return atOccurrence[0].ref;
        if (atOccurrence.length > 1) compatible = atOccurrence;
    }
    return uniqueSavedTargetRef(compatible);
}

function resolveSavedCrewTarget(
    source: Extract<SavedStateTargetV2, { kind: 'crew-position' }>,
    candidates: readonly { readonly ref: SavedTargetRef; readonly target: SavedStateTargetV2 }[],
): SavedTargetRef | undefined {
    let compatible = candidates.filter((candidate): candidate is {
        readonly ref: SavedTargetRef;
        readonly target: Extract<SavedStateTargetV2, { kind: 'crew-position' }>;
    } => candidate.target.kind === 'crew-position'
        && candidate.target.positionKey === source.positionKey);
    if (source.savedCrewPositionId !== undefined) {
        const exact = compatible.filter(({ target }) =>
            target.savedCrewPositionId === source.savedCrewPositionId);
        if (exact.length === 1) return exact[0].ref;
    }
    if (source.occurrence !== undefined) {
        const atOccurrence = compatible.filter(({ target }) => target.occurrence === source.occurrence);
        if (atOccurrence.length === 1) return atOccurrence[0].ref;
        if (atOccurrence.length > 1) compatible = atOccurrence;
    }
    return uniqueSavedTargetRef(compatible);
}

function uniqueSavedTargetRef(
    candidates: readonly { readonly ref: SavedTargetRef }[],
): SavedTargetRef | undefined {
    return candidates.length === 1 ? candidates[0].ref : undefined;
}

function sameSavedSlotCoordinates(
    left: readonly SavedSlotCoordinateV2[],
    right: readonly SavedSlotCoordinateV2[],
): boolean {
    const key = (slot: SavedSlotCoordinateV2) => `${slot.location}\0${slot.slot}`;
    const a = left.map(key).sort(compareText);
    const b = right.map(key).sort(compareText);
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

function deriveActiveRecoveryTranslation(
    unresolved: readonly SerializedUnresolvedStateRecoveryEntryV2[],
    accumulator: RestoreAccumulator,
): Readonly<Record<SavedTargetRef, SavedTargetRef>> {
    const translation: Record<SavedTargetRef, SavedTargetRef> = {};
    for (const entry of unresolved) {
        const aliased = acceptedAliasTarget(entry.sourceTargetRef, entry.sourceTarget, accumulator);
        const resolvedRef = aliased?.ref ?? resolveSavedTargetInReferenceTable(
            entry.sourceTargetRef,
            entry.sourceTarget,
            accumulator.current.table,
        );
        if (resolvedRef !== undefined) {
            translation[entry.sourceTargetRef] = resolvedRef;
        }
    }
    return Object.freeze(Object.fromEntries(
        Object.entries(translation).sort(([left], [right]) => compareText(left, right)),
    ) as Record<SavedTargetRef, SavedTargetRef>);
}

function assertRecoverySourcesOwnEntries(
    references: SavedBlueprintReferenceTableV2,
    unresolved: readonly SerializedUnresolvedStateRecoveryEntryV2[],
): void {
    for (const [index, entry] of unresolved.entries()) {
        assertExactObjectKeys(entry, [
            'recoveryId', 'sourceTargetRef', 'sourceTarget', 'fact', 'reason',
        ], `$.restoration.unresolved[${index}]`);
        let sourceTargetRef: SavedTargetRef;
        try {
            sourceTargetRef = asSavedTargetRef(entry.sourceTargetRef);
        } catch {
            codecFail(
                'INVALID_SERIALIZED_STATE',
                `$.restoration.unresolved[${index}].sourceTargetRef`,
                'is not a valid saved target ref',
            );
        }
        const owned = references.targets[sourceTargetRef];
        if (owned === undefined) {
            codecFail(
                'INVALID_SERIALIZED_STATE',
                `$.restoration.unresolved[${index}].sourceTargetRef`,
                'is not owned by the durable heat recovery source table',
            );
        }
        if (!jsonValuesEqual(owned, entry.sourceTarget)) {
            codecFail(
                'INVALID_SERIALIZED_STATE',
                `$.restoration.unresolved[${index}].sourceTargetRef`,
                'does not own the byte-exact unresolved source target',
            );
        }
    }
}

function sameReferenceTable(
    left: SavedBlueprintReferenceTableV2,
    right: SavedBlueprintReferenceTableV2,
): boolean {
    return jsonValuesEqual(left, right);
}

function assertMekHeatRecoveryAuthorityForWrite(
    restoration: SerializedUnitRestorationMetadataV2 | undefined,
    currentReferences: SavedBlueprintReferenceTableV2,
): void {
    assertMekHeatRecoveryAuthority(
        restoration,
        currentReferences,
        '$.restoration',
    );
}

function assertSavedMekHeatRecoveryAuthority(saved: SerializedCBTUnitV2): void {
    assertMekHeatRecoveryAuthority(
        saved.restoration,
        saved.blueprintReferences,
        '$.restoration',
    );
}

function assertMekHeatRecoveryAuthority(
    restoration: SerializedUnitRestorationMetadataV2 | undefined,
    currentReferences: SavedBlueprintReferenceTableV2,
    path: string,
): void {
    if (restoration !== undefined) {
        if (restoration.algorithmVersion !== V2_STATE_RESTORATION_ALGORITHM_VERSION) {
            codecFail(
                'INVALID_SERIALIZED_STATE',
                `${path}.algorithmVersion`,
                `must be ${V2_STATE_RESTORATION_ALGORITHM_VERSION}`,
            );
        }
        for (const [index, alias] of restoration.acceptedAliases.entries()) {
            if (alias.algorithmVersion !== V2_STATE_RESTORATION_ALGORITHM_VERSION) {
                codecFail(
                    'INVALID_SERIALIZED_STATE',
                    `${path}.acceptedAliases[${index}].algorithmVersion`,
                    `must be ${V2_STATE_RESTORATION_ALGORITHM_VERSION}`,
                );
            }
        }
        for (const [index, ignored] of (restoration.ignoredRecovery ?? []).entries()) {
            if (ignored.algorithmVersion !== V2_STATE_RESTORATION_ALGORITHM_VERSION) {
                codecFail(
                    'INVALID_SERIALIZED_STATE',
                    `${path}.ignoredRecovery[${index}].algorithmVersion`,
                    `must be ${V2_STATE_RESTORATION_ALGORITHM_VERSION}`,
                );
            }
        }
    }
    const unresolved = restoration?.unresolved ?? [];
    const authority = restoration?.heatRecovery;
    if (unresolved.length === 0) {
        if (authority !== undefined) {
            codecFail('INVALID_SERIALIZED_STATE', `${path}.heatRecovery`, 'empty recovery must omit heat authority');
        }
        return;
    }
    if (authority === undefined) {
        assertRecoverySourcesOwnEntries(currentReferences, unresolved);
        return;
    }
    assertExactObjectKeys(authority, [
        'schemaVersion', 'sourceReferences', 'targetTranslation', 'currentReferences',
    ], `${path}.heatRecovery`);
    if (authority.schemaVersion !== 1) {
        codecFail('INVALID_SERIALIZED_STATE', `${path}.heatRecovery.schemaVersion`, 'must be 1');
    }
    assertRecoveryReferenceTableShape(authority.sourceReferences, `${path}.heatRecovery.sourceReferences`);
    assertRecoveryReferenceTableShape(authority.currentReferences, `${path}.heatRecovery.currentReferences`);
    if (!sameReferenceTable(authority.currentReferences, currentReferences)) {
        codecFail(
            'INVALID_SERIALIZED_STATE',
            `${path}.heatRecovery.currentReferences`,
            'must equal the unit current blueprint reference table',
        );
    }
    assertRecoverySourcesOwnEntries(authority.sourceReferences, unresolved);
    const activeSourceRefs = new Set(unresolved.map(entry => entry.sourceTargetRef));
    const expectedSourceClosure = savedTargetReferenceClosureV2(
        authority.sourceReferences.targets,
        [...activeSourceRefs],
    );
    if (expectedSourceClosure === undefined
        || !jsonValuesEqual(Object.keys(authority.sourceReferences.targets).sort(), expectedSourceClosure)) {
        codecFail(
            'INVALID_SERIALIZED_STATE',
            `${path}.heatRecovery.sourceReferences.targets`,
            'must contain exactly the active recovery roots and their transitive target dependencies',
        );
    }
    if (authority.targetTranslation === null
        || typeof authority.targetTranslation !== 'object'
        || Array.isArray(authority.targetTranslation)) {
        codecFail('INVALID_SERIALIZED_STATE', `${path}.heatRecovery.targetTranslation`, 'must be an object');
    }
    for (const [rawSourceRef, rawCurrentRef] of Object.entries(authority.targetTranslation)) {
        let sourceRef: SavedTargetRef;
        let currentRef: SavedTargetRef;
        try {
            sourceRef = asSavedTargetRef(rawSourceRef);
            currentRef = asSavedTargetRef(rawCurrentRef);
        } catch {
            codecFail(
                'INVALID_SERIALIZED_STATE',
                `${path}.heatRecovery.targetTranslation.${rawSourceRef}`,
                'contains an invalid target ref',
            );
        }
        if (authority.sourceReferences.targets[sourceRef] === undefined
            || authority.currentReferences.targets[currentRef] === undefined) {
            codecFail(
                'INVALID_SERIALIZED_STATE',
                `${path}.heatRecovery.targetTranslation.${sourceRef}`,
                'translation is outside its exact source/current tables',
            );
        }
        if (!activeSourceRefs.has(sourceRef)) {
            codecFail(
                'INVALID_SERIALIZED_STATE',
                `${path}.heatRecovery.targetTranslation.${sourceRef}`,
                'translation does not belong to an active unresolved source row',
            );
        }
    }
}

function assertRecoveryReferenceTableShape(
    table: SavedBlueprintReferenceTableV2,
    path: string,
): void {
    try {
        validateSavedBlueprintReferenceTableV2(table, path);
    } catch (error) {
        codecFail(
            'INVALID_SERIALIZED_STATE',
            path,
            error instanceof Error ? error.message : 'invalid saved blueprint reference table',
        );
    }
}

/**
 * Component-owned lifecycle payloads may embed the ID of a related component. Translate those
 * IDs through the same exhaustive saved witness table used for their owning state row.
 */
function translateSavedComponentRuntimeIds(
    state: ComponentRuntimeState,
    accumulator: RestoreAccumulator,
): ComponentRuntimeState {
    if (state.ppcCapacitor === undefined) return state;
    const weaponId = translateSavedComponentId(state.ppcCapacitor.weaponId, accumulator, 'PPC weapon');
    return weaponId === state.ppcCapacitor.weaponId
        ? state
        : Object.freeze({
            ...state,
            ppcCapacitor: Object.freeze({ ...state.ppcCapacitor, weaponId: asComponentId(weaponId) }),
        });
}

/**
 * Heat acknowledgements are turn-ledger facts, but several signatures embed blueprint IDs.
 * Translate only through unique current targets resolved from the saved exhaustive witnesses.
 * Unmapped or malformed evidence stays byte-for-byte intact and therefore fails closed by not
 * matching a current source.
 */
function translateSavedHeatAcknowledgements(
    turn: MekTurnStateV2,
    accumulator: RestoreAccumulator,
): MekTurnStateV2 {
    if (turn.acknowledgedHeatSources.size === 0) return turn;
    const original = turn.acknowledgedHeatSources;
    const translated = new Map<string, string>();
    let changed = false;
    for (const [sourceId, signature] of original) {
        const translatedSourceId = translateSavedPpcHeatSourceId(sourceId, accumulator);
        const translatedSignature = translateSavedHeatSourceSignature(sourceId, signature, accumulator);
        const targetId = translatedSourceId !== sourceId
            && (original.has(translatedSourceId) || translated.has(translatedSourceId))
            ? sourceId
            : translatedSourceId;
        translated.set(targetId, translatedSignature);
        changed ||= targetId !== sourceId || translatedSignature !== signature;
    }
    return changed
        ? canonicalizeMekTurnStateV2({ ...turn, acknowledgedHeatSources: translated })
        : turn;
}

function translateSavedPpcHeatSourceId(sourceId: string, accumulator: RestoreAccumulator): string {
    const prefix = 'ppc-capacitor:';
    if (!sourceId.startsWith(prefix)) return sourceId;
    const savedWeaponId = sourceId.slice(prefix.length);
    const currentWeaponId = translateSavedComponentId(savedWeaponId, accumulator, 'PPC heat source');
    return currentWeaponId === savedWeaponId ? sourceId : `${prefix}${currentWeaponId}`;
}

function translateSavedHeatSourceSignature(
    sourceId: string,
    signature: string,
    accumulator: RestoreAccumulator,
): string {
    const parsed = parseJsonArray(signature, 3);
    if (!parsed) return signature;
    const translated = [...parsed];
    if (sourceId.startsWith('ppc-capacitor:') && typeof translated[1] === 'string') {
        translated[1] = translateSavedComponentId(translated[1], accumulator, 'PPC heat replacement');
    }
    if (sourceId === 'damaged-engine' && typeof translated[2] === 'string') {
        translated[2] = translated[2].split('|')
            .map(savedSlotId => translateSavedCriticalSlotId(savedSlotId, accumulator, 'engine heat source'))
            .join('|');
    }
    if (sourceId === 'movement' && typeof translated[2] === 'string') {
        const witness = parseJsonArray(translated[2], 5);
        if (witness) {
            const currentWitness = [...witness];
            for (const index of [2, 3] as const) {
                if (Array.isArray(currentWitness[index])) {
                    currentWitness[index] = currentWitness[index].map(value => typeof value === 'string'
                        ? translateSavedComponentId(value, accumulator, 'movement heat source')
                        : value);
                }
            }
            if (Array.isArray(currentWitness[4])) {
                currentWitness[4] = currentWitness[4].map(value => typeof value === 'string'
                    ? translateSavedCriticalSlotId(value, accumulator, 'movement heat source')
                    : value);
            }
            translated[2] = JSON.stringify(currentWitness);
        }
    }
    const result = JSON.stringify(translated);
    return result === signature ? signature : result;
}

function translateSavedComponentId(
    savedId: string,
    accumulator: RestoreAccumulator,
    label: string,
): ComponentId | string {
    const source = Object.entries(accumulator.sourceTargets).find(([, target]) =>
        (target.kind === 'component' || target.kind === 'intrinsic-system')
        && componentSavedId(target) === savedId);
    if (!source) return accumulator.current.componentById.has(savedId) ? asComponentId(savedId) : savedId;
    const [sourceRef, sourceTarget] = source;
    const current = resolveComponentTarget(sourceTarget as Extract<
        SavedStateTargetV2,
        { kind: 'component' | 'intrinsic-system' }
    >, accumulator);
    if (!current) return savedId;
    if (current.componentId !== savedId) recordEmbeddedIdTranslation(accumulator, sourceRef, current.ref, label);
    return current.componentId;
}

function translateSavedCriticalSlotId(
    savedId: string,
    accumulator: RestoreAccumulator,
    label: string,
): CriticalSlotId | string {
    const source = Object.entries(accumulator.sourceTargets).find(([, target]) =>
        target.kind === 'critical-slot' && target.savedSlotId === savedId);
    if (!source) return accumulator.current.slotById.has(savedId) ? savedId as CriticalSlotId : savedId;
    const [sourceRef, sourceTarget] = source;
    const current = resolveSlotTarget(
        sourceTarget as Extract<SavedStateTargetV2, { kind: 'critical-slot' }>,
        accumulator,
    );
    if (!current) return savedId;
    if (current.slotId !== savedId) recordEmbeddedIdTranslation(accumulator, sourceRef, current.ref, label);
    return current.slotId;
}

function recordEmbeddedIdTranslation(
    accumulator: RestoreAccumulator,
    sourceRef: string,
    currentRef: SavedTargetRef,
    label: string,
): void {
    const source = asSavedTargetRef(sourceRef);
    accumulator.translations.set(source, currentRef);
    warnRekeyed(accumulator, source, currentRef, label);
}

function parseJsonArray(value: string, length: number): unknown[] | null {
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) && parsed.length === length ? parsed : null;
    } catch {
        return null;
    }
}

function assertDeploymentValues(
    crewPositions: CrewTopology,
    deployment: SerializedDeploymentConfigurationV2,
    path: string,
): void {
    const values = deployment.values;
    if (typeof values.id !== 'string' || !values.id.trim()
        || values.id.length > 256 || values.id.includes('\0')) {
        codecFail('INVALID_SERIALIZED_STATE', `${path}.values.id`, 'must be a bounded non-empty string');
    }
    if (values.initialHeat !== undefined
        && (!Number.isSafeInteger(values.initialHeat) || values.initialHeat < 0)) {
        codecFail('INVALID_SERIALIZED_STATE', `${path}.values.initialHeat`, 'must be a non-negative integer');
    }
    try {
        assertCanonicalCrewAssignment(crewPositions, values.crewAssignment);
    } catch (error) {
        codecFail(
            'INVALID_SERIALIZED_STATE',
            `${path}.values.crewAssignment`,
            error instanceof Error ? error.message : 'invalid crew assignment',
        );
    }
}

function buildCurrentTargetIndex(
    unit: MekCodecUnit,
    ammoState?: ReadonlyMap<ComponentId, AmmoRuntimeState>,
): CurrentTargetIndex {
    const { entity, index, ruleset } = unit;
    const targetRows = new Map<SavedTargetRef, SavedStateTargetV2>();
    const byRef = new Map<SavedTargetRef, CurrentTarget>();
    const locationByCoordinate = new Map<string, CurrentLocationTarget>();
    const slotByCoordinate = new Map<string, CurrentSlotTarget>();
    const slotById = new Map<string, CurrentSlotTarget>();
    const componentById = new Map<string, CurrentComponentTarget>();
    const components: CurrentComponentTarget[] = [];
    const ammoById = new Map<string, CurrentAmmoTarget>();
    const ammo: CurrentAmmoTarget[] = [];
    const crewById = new Map<string, CurrentCrewTarget>();
    const crewByPositionKey = new Map<string, CurrentCrewTarget[]>();
    const crew: CurrentCrewTarget[] = [];

    for (const location of [...index.locations.values()].sort((left, right) => compareText(left.id, right.id))) {
        const locationCode = location.code.toLowerCase();
        const internalTarget: Extract<SavedStateTargetV2, { kind: 'location-section' }> = Object.freeze({
            kind: 'location-section', location: location.id, section: 'internal',
        });
        const internalRef = createSavedTargetRef('location', locationCode, 'internal');
        const internal: CurrentLocationTarget = Object.freeze({
            ref: internalRef, target: internalTarget, locationId: location.id, maximum: location.internalPoints,
        });
        addCurrentTarget(targetRows, byRef, internal);
        locationByCoordinate.set(locationCoordinate(location.id, 'internal'), internal);
        for (const faceId of [...location.armorFaceIds].sort(compareText)) {
            const face = index.armorFaces.get(faceId);
            if (!face) codecFail('INVALID_RUNTIME_STATE', '$.entity', `location references missing armor face ${faceId}`);
            const section = face.face === 'front' ? 'front-armor' as const : 'rear-armor' as const;
            const target: Extract<SavedStateTargetV2, { kind: 'location-section' }> = Object.freeze({
                kind: 'location-section', location: location.id, section,
            });
            const ref = createSavedTargetRef('location', locationCode, section);
            const current: CurrentLocationTarget = Object.freeze({
                ref, target, locationId: location.id, armorFaceId: face.id, maximum: face.maximumPoints,
            });
            addCurrentTarget(targetRows, byRef, current);
            locationByCoordinate.set(locationCoordinate(location.id, section), current);
        }
    }

    const occurrences = componentOccurrences(index);
    for (const [componentId, definition] of [...index.components].sort(([left], [right]) => compareText(left, right))) {
        const locations = sortedUnique(componentLocations(index, definition));
        const criticalSlots = componentSlotCoordinates(index, componentId);
        const equipment = definition.kind === 'equipment' ? definition.mount.equipment : undefined;
        const equipmentKey = definition.kind === 'equipment'
            ? equipment?.id ?? definition.mount.equipmentId
            : undefined;
        const ammoCapacity = mekAmmoCapacity(entity, index, componentId, ruleset);
        const intrinsicMagazine = mekIntrinsicMagazine(entity, index, componentId, ruleset);
        const target: Extract<SavedStateTargetV2, { kind: 'component' | 'intrinsic-system' }> = definition.kind === 'equipment'
            ? Object.freeze({
                kind: 'component',
                savedComponentId: componentId,
                equipmentName: equipmentKey!,
                locations,
                criticalSlots,
                occurrence: occurrences.get(componentId)!,
                ...(equipment?.type === 'ammo' && ammoCapacity !== null
                    ? { capacity: ammoCapacity }
                    : {}),
            })
            : Object.freeze({
                kind: 'intrinsic-system',
                savedComponentId: componentId,
                systemKey: definition.systemType,
                locations,
                criticalSlots,
            });
        const ref = createSavedTargetRef(definition.kind === 'equipment' ? 'component' : 'system', componentId);
        const capacitorWeaponId = ppcCapacitorWeaponId(entity, index, componentId);
        const modes = mekComponentModes(entity, index, componentId, ruleset);
        const persistedModes = equipment === undefined
            ? modes.modes
            : ecmRuntimeModes(equipment).length > 0
                ? ecmRuntimeModes(equipment)
                : modes.modes;
        const shieldProfile = equipment === undefined
            ? undefined
            : resolveShieldProfileFromFlags(equipment.flags);
        const current: CurrentComponentTarget = Object.freeze({
            ref,
            target,
            componentId,
            stateCapabilities: Object.freeze({
                ...modes,
                modes: persistedModes,
                supportsJamming: rapidFireAutocannonSupportsJamming(index, componentId, ruleset),
            }),
            escalatingFailureTargetCount: equipment === undefined
                ? 0
                : componentEscalatingFailureProfile(equipment.flags, ruleset)?.targets.length ?? 0,
            supportsBombastLaser: isCoreBombastLaserComponent(index, componentId, ruleset),
            supportsC3EmergencyMaster: isC3EmergencyMasterComponent(index, componentId),
            supportsStealthTransition: equipment !== undefined
                && isStealthSystemEquipment(equipment)
                && isSwitchableStealthEquipment(equipment),
            supportsGaussPower: isGaussEquipment(equipment),
            supportsShieldDamage: isShieldEquipment(equipment),
            supportsModularArmor: isModularArmorEquipment(equipment),
            shieldMaximumAbsorption: shieldProfile?.damageAbsorption ?? 0,
            shieldMaximumCapacity: shieldProfile?.damageCapacity ?? 0,
            ...(capacitorWeaponId === undefined ? {} : { ppcCapacitorWeaponId: capacitorWeaponId }),
        });
        addCurrentTarget(targetRows, byRef, current);
        componentById.set(componentId, current);
        components.push(current);

        if (definition.kind === 'equipment' && ammoCapacity !== null) {
            const munitionOverride = ammoState?.get(componentId)?.munitionOverride;
            const selectedCapacity = mekAmmoCapacity(
                entity,
                index,
                componentId,
                ruleset,
                munitionOverride,
            ) ?? ammoCapacity;
            const ammoTarget: Extract<SavedStateTargetV2, { kind: 'ammo-source' }> = Object.freeze({
                kind: 'ammo-source',
                savedAmmoSourceId: componentId,
                source: intrinsicMagazine === null
                    ? Object.freeze({
                        kind: 'installed-bin' as const,
                        savedComponentId: componentId,
                        equipmentName: equipmentKey!,
                    })
                    : Object.freeze({
                        kind: 'one-shot' as const,
                        ownerComponentTarget: ref,
                        equipmentName: intrinsicMagazine.defaultMunitionKey,
                    }),
                ...(locations.length === 1 ? { location: locations[0] } : {}),
                criticalSlots,
                occurrence: occurrences.get(componentId)!,
                capacityAtSave: selectedCapacity,
                ...(munitionOverride === undefined ? {} : { munitionAtSave: munitionOverride }),
            });
            const ammoRef = createSavedTargetRef('ammo', componentId);
            const ammoCurrent: CurrentAmmoTarget = Object.freeze({
                ref: ammoRef,
                target: ammoTarget,
                componentId,
                capacity: selectedCapacity,
            });
            addCurrentTarget(targetRows, byRef, ammoCurrent);
            ammoById.set(componentId, ammoCurrent);
            ammo.push(ammoCurrent);
        }
    }

    for (const slot of [...index.slots.values()].sort((left, right) =>
        compareText(slotCoordinate(left.locationId, left.slotIndex + 1), slotCoordinate(right.locationId, right.slotIndex + 1)))) {
        const occupant = slot.componentIds.length === 1
            ? index.components.get(slot.componentIds[0])
            : undefined;
        const target: Extract<SavedStateTargetV2, { kind: 'critical-slot' }> = Object.freeze({
            kind: 'critical-slot',
            savedSlotId: slot.id,
            location: slot.locationId,
            slot: asOneBasedCriticalSlotOrdinal(slot.slotIndex + 1),
            ...(occupant?.kind === 'equipment' ? {
                expectedEquipmentName: occupant.mount.equipment?.id ?? occupant.mount.equipmentId,
                ...(occupant.mount.equipment?.id ? { expectedOriginalName: occupant.mount.equipment.id } : {}),
                ...(occupant.mount.equipment?.name ? { expectedDisplayName: occupant.mount.equipment.name } : {}),
            } : {}),
            ...(occupant?.kind === 'system' ? { expectedSystemId: occupant.systemType } : {}),
        });
        const locationCode = index.locations.get(slot.locationId)?.code;
        if (locationCode === undefined) {
            codecFail('INVALID_RUNTIME_STATE', '$.entity', `critical slot references missing location ${slot.locationId}`);
        }
        const ref = createSavedTargetRef('slot', `${locationCode.toLowerCase()}:${slot.slotIndex}`);
        const current: CurrentSlotTarget = Object.freeze({
            ref,
            target,
            slotId: slot.id,
            directHitThreshold: mekCriticalSlotDirectHitThreshold(slot),
            maximumHits: mekCriticalSlotMaximumHits(index, ruleset, slot),
        });
        addCurrentTarget(targetRows, byRef, current);
        slotByCoordinate.set(slotCoordinate(slot.locationId, slot.slotIndex + 1), current);
        slotById.set(slot.id, current);
    }

    for (const position of [...index.crewPositions.values()].sort((left, right) =>
        left.occurrence - right.occurrence)) {
        const positionKey = String(position.id);
        const target: Extract<SavedStateTargetV2, { kind: 'crew-position' }> = Object.freeze({
            kind: 'crew-position',
            savedCrewPositionId: position.id,
            positionKey,
            occurrence: position.occurrence,
        });
        const ref = createSavedTargetRef('crew', String(position.occurrence));
        const current: CurrentCrewTarget = Object.freeze({ ref, target, positionId: position.id });
        addCurrentTarget(targetRows, byRef, current);
        crewById.set(position.id, current);
        crewByPositionKey.set(positionKey, [
            ...(crewByPositionKey.get(positionKey) ?? []),
            current,
        ]);
        crew.push(current);
    }

    const sortedTargets = Object.fromEntries(
        [...targetRows].sort(([left], [right]) => compareText(left, right)),
    ) as Record<SavedTargetRef, SavedStateTargetV2>;
    const table = deepFreeze({ schemaVersion: 1 as const, targets: sortedTargets });
    return Object.freeze({
        table,
        byRef,
        locationByCoordinate,
        slotByCoordinate,
        slotById,
        componentById,
        components: Object.freeze(components),
        ammoById,
        ammo: Object.freeze(ammo),
        crewById,
        crewByPositionKey: new ImmutableIndex([...crewByPositionKey].map(([key, values]) => [
            key,
            Object.freeze([...values]),
        ])),
        crew: Object.freeze(crew),
    });
}

function addCurrentTarget(
    targets: Map<SavedTargetRef, SavedStateTargetV2>,
    byRef: Map<SavedTargetRef, CurrentTarget>,
    target: CurrentTarget,
): void {
    if (targets.has(target.ref)) codecFail('INVALID_RUNTIME_STATE', '$.entity', `duplicate target reference ${target.ref}`);
    targets.set(target.ref, target.target);
    byRef.set(target.ref, target);
}

function serializeComponentState(
    target: CurrentComponentTarget,
    value: ComponentRuntimeState,
    path: string,
): SerializedComponentStateEntryV2 | null {
    const statusOverride = value.statusOverride;
    if (statusOverride !== undefined && statusOverride !== 'disabled' && statusOverride !== 'destroyed') {
        codecFail('INVALID_RUNTIME_STATE', `${path}.statusOverride`, 'must be disabled or destroyed');
    }
    if (value.mode !== undefined) {
        optionalBoundedText(value.mode, `${path}.mode`);
        if (!target.stateCapabilities.modes.includes(value.mode)
            && !(target.supportsStealthTransition && isStealthTransitionMode(value.mode))) {
            codecFail(
                'UNSUPPORTED_STATE_CAPABILITY',
                `${path}.mode`,
                'the entity does not support this component mode',
            );
        }
        if (value.mode === target.stateCapabilities.defaultMode) {
            codecFail('INVALID_RUNTIME_STATE', `${path}.mode`, 'default equipment mode must remain sparse');
        }
    }
    if (value.jammed !== undefined) {
        if (value.jammed !== true) {
            codecFail('INVALID_RUNTIME_STATE', `${path}.jammed`, 'sparse jam state must be true');
        }
        if (!target.stateCapabilities.supportsJamming) {
            codecFail(
                'UNSUPPORTED_STATE_CAPABILITY',
                `${path}.jammed`,
                'the entity component does not support jamming',
            );
        }
    }
    if (value.escalatingFailure !== undefined) {
        validateEscalatingFailureState(value.escalatingFailure, `${path}.escalatingFailure`, 'INVALID_RUNTIME_STATE');
        if (target.escalatingFailureTargetCount === 0
            || value.escalatingFailure.sequence > target.escalatingFailureTargetCount) {
            codecFail(
                'UNSUPPORTED_STATE_CAPABILITY',
                `${path}.escalatingFailure`,
                'the entity component does not support this escalating-failure sequence',
            );
        }
    }
    if (value.ppcCapacitor !== undefined) {
        validatePpcCapacitorState(value.ppcCapacitor, `${path}.ppcCapacitor`, 'INVALID_RUNTIME_STATE');
        if (target.ppcCapacitorWeaponId === undefined
            || value.ppcCapacitor.weaponId !== target.ppcCapacitorWeaponId) {
            codecFail(
                'UNSUPPORTED_STATE_CAPABILITY',
                `${path}.ppcCapacitor`,
                'the entity does not expose this PPC capacitor relation',
            );
        }
    }
    if (value.bombastLaser !== undefined) {
        validateBombastLaserState(value.bombastLaser, `${path}.bombastLaser`, 'INVALID_RUNTIME_STATE');
        if (!target.supportsBombastLaser) {
            codecFail(
                'UNSUPPORTED_STATE_CAPABILITY',
                `${path}.bombastLaser`,
                'the entity component does not support the Bombast Laser lifecycle',
            );
        }
    }
    if (value.c3EmergencyMaster !== undefined) {
        validateC3EmergencyMasterState(
            value.c3EmergencyMaster,
            `${path}.c3EmergencyMaster`,
            'INVALID_RUNTIME_STATE',
        );
        if (!target.supportsC3EmergencyMaster) {
            codecFail(
                'UNSUPPORTED_STATE_CAPABILITY',
                `${path}.c3EmergencyMaster`,
                'the entity component is not a C3 Emergency Master',
            );
        }
    }
    if (value.gaussPower !== undefined) {
        validateGaussPowerState(value.gaussPower, `${path}.gaussPower`, 'INVALID_RUNTIME_STATE');
        if (!target.supportsGaussPower) {
            codecFail(
                'UNSUPPORTED_STATE_CAPABILITY',
                `${path}.gaussPower`,
                'the entity component is not a Gauss weapon',
            );
        }
    }
    if (value.shieldDamage !== undefined) {
        validateShieldDamageState(value.shieldDamage, `${path}.shieldDamage`, 'INVALID_RUNTIME_STATE');
        if (!target.supportsShieldDamage) {
            codecFail(
                'UNSUPPORTED_STATE_CAPABILITY',
                `${path}.shieldDamage`,
                'the entity component is not a physical shield',
            );
        }
        if (value.shieldDamage.absorptionDamage > target.shieldMaximumAbsorption
            || value.shieldDamage.capacityDamage > target.shieldMaximumCapacity) {
            codecFail(
                'INVALID_RUNTIME_STATE',
                `${path}.shieldDamage`,
                'shield damage exceeds its track bounds',
            );
        }
    }
    if (value.modularArmorDamage !== undefined) {
        const damage = requirePositiveSerializedInteger(
            value.modularArmorDamage,
            `${path}.modularArmorDamage`,
        );
        if (!target.supportsModularArmor) {
            codecFail(
                'UNSUPPORTED_STATE_CAPABILITY',
                `${path}.modularArmorDamage`,
                'the entity component is not Modular Armor',
            );
        }
        if (damage > MODULAR_ARMOR_POINTS_PER_MOUNT) {
            codecFail(
                'INVALID_RUNTIME_STATE',
                `${path}.modularArmorDamage`,
                'Modular Armor damage exceeds its capacity',
            );
        }
    }
    if (statusOverride === undefined && value.mode === undefined && value.jammed === undefined
        && value.escalatingFailure === undefined && value.ppcCapacitor === undefined
        && value.bombastLaser === undefined && value.c3EmergencyMaster === undefined
        && value.gaussPower === undefined && value.shieldDamage === undefined
        && value.modularArmorDamage === undefined) return null;
    return {
        target: target.ref,
        ...(statusOverride === undefined ? {} : { statusOverride }),
        ...(value.mode === undefined ? {} : { mode: value.mode }),
        ...(value.jammed === undefined ? {} : { jammed: true }),
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
        ...(value.gaussPower === undefined ? {} : { gaussPower: value.gaussPower }),
        ...(value.shieldDamage === undefined
            ? {}
            : { shieldDamage: Object.freeze({ ...value.shieldDamage }) }),
        ...(value.modularArmorDamage === undefined
            ? {}
            : { modularArmorDamage: value.modularArmorDamage }),
    };
}

function serializePending(
    pending: PendingCombatOverlay,
    current: CurrentTargetIndex,
    committedLocations: ReadonlyMap<LocationId, LocationRuntimeState>,
    committedSlots: ReadonlyMap<CriticalSlotId, CriticalSlotRuntimeState>,
    committedComponents: ReadonlyMap<ComponentId, ComponentRuntimeState>,
): SerializedPendingCombatStateV2 | undefined {
    const locationDamage: SerializedLocationStateEntryV2[] = [];
    const locationConditions: SerializedLocationConditionStateEntryV2[] = [];
    const slotHits: SerializedSlotStateEntryV2[] = [];
    const componentStatus: { target: SavedTargetRef; status: EquipmentStatus }[] = [];
    const shieldDamage: NonNullable<SerializedPendingCombatStateV2['shieldDamage']>[number][] = [];
    const modularArmorDamage: NonNullable<SerializedPendingCombatStateV2['modularArmorDamage']>[number][] = [];
    for (const [locationId, damage] of pending.locationInternalDamage) {
        const target = current.locationByCoordinate.get(locationCoordinate(locationId, 'internal'));
        if (!target) codecFail('INVALID_RUNTIME_STATE', '$.state.pendingCombat.locationInternalDamage', `unknown location ${locationId}`);
        const delta = requireSignedIntegerOrZero(damage, `$.state.pendingCombat.locationInternalDamage.${locationId}`);
        if (delta !== 0) locationDamage.push({ target: target.ref, damage: delta });
    }
    for (const [faceId, damage] of pending.armorDamage) {
        const target = [...current.locationByCoordinate.values()].find(candidate => candidate.armorFaceId === faceId);
        if (!target) codecFail('INVALID_RUNTIME_STATE', '$.state.pendingCombat.armorDamage', `unknown armor face ${faceId}`);
        const delta = requireSignedIntegerOrZero(damage, `$.state.pendingCombat.armorDamage.${faceId}`);
        if (delta !== 0) locationDamage.push({ target: target.ref, damage: delta });
    }
    for (const [locationId, conditions] of pending.locationConditions) {
        const target = current.locationByCoordinate.get(locationCoordinate(locationId, 'internal'));
        if (!target) {
            codecFail('INVALID_RUNTIME_STATE', '$.state.pendingCombat.locationConditions', `unknown location ${locationId}`);
        }
        if (conditions.size === 0) {
            codecFail('INVALID_RUNTIME_STATE', `$.state.pendingCombat.locationConditions.${locationId}`, 'sparse pending condition map must contain a fact');
        }
        for (const [condition, rawValue] of conditions) {
            const value = requireMekLocationConditionValue(
                condition,
                rawValue,
                `$.state.pendingCombat.locationConditions.${locationId}.${condition}`,
                true,
                'INVALID_RUNTIME_STATE',
            );
            const committed = committedLocations.get(locationId)?.conditions.get(condition) ?? 0;
            if (value === committed) {
                codecFail('INVALID_RUNTIME_STATE', `$.state.pendingCombat.locationConditions.${locationId}.${condition}`, 'pending condition must differ from committed state');
            }
            locationConditions.push({ target: target.ref, condition, value });
        }
    }
    for (const [slotId, hits] of pending.criticalHits) {
        const target = current.slotById.get(slotId);
        if (!target) codecFail('INVALID_RUNTIME_STATE', '$.state.pendingCombat.criticalHits', `unknown slot ${slotId}`);
        const delta = requireSignedIntegerOrZero(hits, `$.state.pendingCombat.criticalHits.${slotId}`);
        const committed = committedSlots.get(slotId)?.hits ?? 0;
        if (committed + delta < 0 || committed + delta > target.maximumHits) {
            codecFail(
                'INVALID_RUNTIME_STATE',
                `$.state.pendingCombat.criticalHits.${slotId}`,
                `pending delta exceeds slot bounds 0..${target.maximumHits}`,
            );
        }
        if (delta !== 0) slotHits.push({ target: target.ref, hits: delta });
    }
    for (const [componentId, status] of pending.componentStatus) {
        const target = current.componentById.get(componentId);
        if (!target) codecFail('INVALID_RUNTIME_STATE', '$.state.pendingCombat.componentStatus', `unknown component ${componentId}`);
        if (target.target.kind === 'intrinsic-system') {
            codecFail(
                'INVALID_RUNTIME_STATE',
                `$.state.pendingCombat.componentStatus.${componentId}`,
                'intrinsic-system damage must be represented by critical-slot or location facts',
            );
        }
        if (!isEquipmentStatus(status)) codecFail('INVALID_RUNTIME_STATE', '$.state.pendingCombat.componentStatus', `invalid status ${status}`);
        componentStatus.push({ target: target.ref, status });
    }
    for (const [componentId, damage] of pending.shieldDamage) {
        const target = current.componentById.get(componentId);
        if (!target?.supportsShieldDamage) {
            codecFail('INVALID_RUNTIME_STATE', '$.state.pendingCombat.shieldDamage', `unknown shield ${componentId}`);
        }
        const absorptionDamage = requireSignedIntegerOrZero(
            damage.absorptionDamage,
            `$.state.pendingCombat.shieldDamage.${componentId}.absorptionDamage`,
        );
        const capacityDamage = requireSignedIntegerOrZero(
            damage.capacityDamage,
            `$.state.pendingCombat.shieldDamage.${componentId}.capacityDamage`,
        );
        if (absorptionDamage === 0 && capacityDamage === 0) {
            codecFail('INVALID_RUNTIME_STATE', `$.state.pendingCombat.shieldDamage.${componentId}`, 'sparse pending shield damage must contain a fact');
        }
        const committed = committedComponents.get(componentId)?.shieldDamage
            ?? { absorptionDamage: 0, capacityDamage: 0 };
        if (committed.absorptionDamage + absorptionDamage < 0
            || committed.absorptionDamage + absorptionDamage > target.shieldMaximumAbsorption
            || committed.capacityDamage + capacityDamage < 0
            || committed.capacityDamage + capacityDamage > target.shieldMaximumCapacity) {
            codecFail('INVALID_RUNTIME_STATE', `$.state.pendingCombat.shieldDamage.${componentId}`, 'pending shield damage exceeds its track bounds');
        }
        shieldDamage.push({ target: target.ref, absorptionDamage, capacityDamage });
    }
    for (const [componentId, rawDamage] of pending.modularArmorDamage) {
        const target = current.componentById.get(componentId);
        if (!target?.supportsModularArmor) {
            codecFail(
                'INVALID_RUNTIME_STATE',
                '$.state.pendingCombat.modularArmorDamage',
                `unknown Modular Armor component ${componentId}`,
            );
        }
        const damage = requireSignedNonzeroInteger(
            rawDamage,
            `$.state.pendingCombat.modularArmorDamage.${componentId}`,
        );
        const committed = committedComponents.get(componentId)?.modularArmorDamage ?? 0;
        if (committed + damage < 0 || committed + damage > MODULAR_ARMOR_POINTS_PER_MOUNT) {
            codecFail(
                'INVALID_RUNTIME_STATE',
                `$.state.pendingCombat.modularArmorDamage.${componentId}`,
                'pending Modular Armor damage exceeds its capacity',
            );
        }
        modularArmorDamage.push({ target: target.ref, damage });
    }
    locationDamage.sort(compareTargetEntry);
    locationConditions.sort(compareLocationConditionEntry);
    slotHits.sort(compareTargetEntry);
    componentStatus.sort(compareTargetEntry);
    shieldDamage.sort(compareTargetEntry);
    modularArmorDamage.sort(compareTargetEntry);
    if (locationDamage.length === 0 && locationConditions.length === 0
        && slotHits.length === 0 && componentStatus.length === 0
        && shieldDamage.length === 0 && modularArmorDamage.length === 0) return undefined;
    return {
        ...(locationDamage.length === 0 ? {} : { locationDamage }),
        ...(locationConditions.length === 0 ? {} : { locationConditions }),
        ...(slotHits.length === 0 ? {} : { slotHits }),
        ...(componentStatus.length === 0 ? {} : { componentStatus }),
        ...(shieldDamage.length === 0 ? {} : { shieldDamage }),
        ...(modularArmorDamage.length === 0 ? {} : { modularArmorDamage }),
    };
}

/** Replays only facts the user explicitly scoped to this exact entity target through an alias. */
function retryPriorUnresolved(
    entries: readonly SerializedUnresolvedStateRecoveryEntryV2[],
    savedStateRevision: StateRevision,
    accumulator: RestoreAccumulator,
    locations: Map<LocationId, LocationRuntimeState>,
    slots: Map<CriticalSlotId, CriticalSlotRuntimeState>,
    components: Map<ComponentId, ComponentRuntimeState>,
    ammo: Map<ComponentId, AmmoRuntimeState>,
    crew: Map<CrewPositionId, CrewRuntimeState>,
    pendingLocation: Map<LocationId, number>,
    pendingArmor: Map<ArmorFaceId, number>,
    pendingSlots: Map<CriticalSlotId, number>,
    pendingComponents: Map<ComponentId, EquipmentStatus>,
    pendingShieldDamage: Map<ComponentId, MekShieldDamageRuntimeState>,
    pendingModularArmorDamage: Map<ComponentId, number>,
    pendingLocationConditions: Map<LocationId, Map<MekLocationConditionKey, number>>,
    ruleChecks: Map<
        typeof MEK_TORSO_CRIPPLING_RULE_CHECK_KEY,
        MekRuleCheckStateV2
    >,
): readonly SerializedUnresolvedStateRecoveryEntryV2[] {
    const retained: SerializedUnresolvedStateRecoveryEntryV2[] = [];
    for (const entry of entries) {
        const current = acceptedAliasTarget(entry.sourceTargetRef, entry.sourceTarget, accumulator);
        if (!current) {
            retained.push(canonicalClone(entry));
            continue;
        }
        accumulator.translations.set(entry.sourceTargetRef, current.ref);
        const fact = entry.fact;
        let remaining: SerializedRecoverableStateFactV2 | null = null;
        let applied = false;
        switch (fact.kind) {
            case 'location-damage': {
                if (!isCurrentLocation(current)) break;
                const requested = requireNonnegativeInteger(fact.damage, '$.restoration.unresolved.fact.damage');
                const effective = Math.min(requested, current.maximum);
                applyLocationDamage(locations, current, effective);
                applied = true;
                if (effective !== requested) {
                    remaining = fact;
                    warn(accumulator, {
                        code: 'DAMAGE_CLAMPED',
                        message: `Remapped damage ${requested} exceeds the current maximum ${current.maximum}.`,
                        currentTargetRef: current.ref,
                        saved: { damage: requested },
                        current: { maximum: current.maximum, effectiveDamage: effective },
                    });
                }
                break;
            }
            case 'location-condition': {
                if (!isCurrentLocation(current) || current.target.section !== 'internal') break;
                const condition = requireMekLocationConditionKey(
                    fact.condition,
                    '$.restoration.unresolved.fact.condition',
                    'INVALID_SERIALIZED_STATE',
                );
                const value = requireMekLocationConditionValue(
                    condition,
                    fact.value,
                    '$.restoration.unresolved.fact.value',
                    false,
                    'INVALID_SERIALIZED_STATE',
                );
                applyLocationCondition(locations, current.locationId, condition, value);
                applied = true;
                break;
            }
            case 'slot-hits': {
                if (!isCurrentSlot(current)) break;
                const requested = requireNonnegativeInteger(fact.hits, '$.restoration.unresolved.fact.hits');
                const destroyedTurn = fact.destroyedTurn === undefined
                    ? undefined
                    : requirePositiveSerializedInteger(
                        fact.destroyedTurn,
                        '$.restoration.unresolved.fact.destroyedTurn',
                    );
                const effective = Math.min(requested, current.maximumHits);
                if (effective === 0) slots.delete(current.slotId);
                else slots.set(current.slotId, Object.freeze({
                    hits: effective,
                    ...(destroyedTurn === undefined || effective < current.directHitThreshold
                        ? {}
                        : { destroyedTurn }),
                }));
                applied = true;
                if (effective !== requested) {
                    remaining = fact;
                    warn(accumulator, {
                        code: 'DAMAGE_CLAMPED',
                        message: `Remapped critical hits ${requested} exceed the current slot capacity ${current.maximumHits}.`,
                        currentTargetRef: current.ref,
                        saved: { hits: requested },
                        current: { maximumHits: current.maximumHits, effectiveHits: effective },
                    });
                }
                break;
            }
            case 'component-state': {
                if (!isCurrentComponent(current)) break;
                const savedState = deserializeComponentState(fact, '$.restoration.unresolved.fact');
                const partition = partitionComponentState(savedState, current);
                if (partition.supportedFact) {
                    applyComponentState(components, current.componentId, partition);
                    applied = true;
                }
                const remainingComponentState = partition.clampedShieldDamage
                    ? Object.freeze({
                        ...(partition.unsupportedFact ?? { kind: 'component-state' as const }),
                        shieldDamage: partition.clampedShieldDamage.requested,
                    })
                    : partition.unsupportedFact;
                if (remainingComponentState) {
                    remaining = remainingComponentState;
                    warn(accumulator, {
                        code: 'UNSUPPORTED_EQUIPMENT_STATE_RETAINED',
                        message: 'A remapped component fact is still unsupported by the current equipment definition and remains recoverable.',
                        currentTargetRef: current.ref,
                    });
                }
                if (partition.clampedShieldDamage) warn(accumulator, {
                    code: 'DAMAGE_CLAMPED',
                    message: 'Remapped shield damage exceeds the current shield track bounds.',
                    currentTargetRef: current.ref,
                    saved: { ...partition.clampedShieldDamage.requested },
                    current: {
                        maximumAbsorption: current.shieldMaximumAbsorption,
                        maximumCapacity: current.shieldMaximumCapacity,
                        effectiveDamage: partition.clampedShieldDamage.effective,
                    },
                });
                break;
            }
            case 'ammo-state': {
                if (!isCurrentAmmo(current)) break;
                const requested = requireNonnegativeInteger(fact.shotsSpent, '$.restoration.unresolved.fact.shotsSpent');
                const munitionOverride = optionalBoundedText(
                    fact.munitionOverride,
                    '$.restoration.unresolved.fact.munitionOverride',
                );
                const loadout = mekAmmoLoadout(
                    accumulator.unit.entity,
                    accumulator.unit.index,
                    current.componentId,
                    accumulator.unit.ruleset,
                    munitionOverride,
                );
                const supportedMunition = munitionOverride === undefined || loadout !== null;
                const capacity = loadout?.capacity ?? current.capacity;
                const effective = Math.min(requested, capacity);
                if (effective > 0 || (munitionOverride !== undefined && supportedMunition)) {
                    ammo.set(
                        current.componentId,
                        Object.freeze({
                            shotsSpent: effective,
                            ...(munitionOverride !== undefined && supportedMunition ? { munitionOverride } : {}),
                        }),
                    );
                } else if (munitionOverride === undefined) ammo.delete(current.componentId);
                applied = requested > 0 || (munitionOverride !== undefined && supportedMunition);
                if (effective !== requested) {
                    remaining = fact;
                    warn(accumulator, {
                        code: 'DAMAGE_CLAMPED',
                        message: `Remapped ammunition consumption ${requested} exceeds current capacity ${capacity}.`,
                        currentTargetRef: current.ref,
                        saved: { shotsSpent: requested },
                        current: { capacity, effectiveShotsSpent: effective },
                    });
                } else if (munitionOverride !== undefined && !supportedMunition) {
                    remaining = { kind: 'ammo-state', shotsSpent: 0, munitionOverride };
                    warn(accumulator, {
                        code: 'UNSUPPORTED_EQUIPMENT_STATE_RETAINED',
                        message: 'A remapped munition override still lacks a compiled capability and remains recoverable.',
                        currentTargetRef: current.ref,
                    });
                }
                break;
            }
            case 'crew-state': {
                if (!isCurrentCrew(current)) break;
                const requested = requireNonnegativeInteger(fact.wounds, '$.restoration.unresolved.fact.wounds');
                if (typeof fact.unconscious !== 'boolean') {
                    codecFail('INVALID_SERIALIZED_STATE', '$.restoration.unresolved.fact.unconscious', 'must be boolean');
                }
                const ejected = fact.ejected === true;
                const dead = fact.dead === true;
                if (fact.dead !== undefined && !dead) {
                    codecFail('INVALID_SERIALIZED_STATE', '$.restoration.unresolved.fact.dead', 'sparse dead state must be true');
                }
                if (fact.ejected !== undefined && !ejected) {
                    codecFail('INVALID_SERIALIZED_STATE', '$.restoration.unresolved.fact.ejected', 'sparse ejected state must be true');
                }
                const effective = Math.min(requested, MAX_MEK_CREW_WOUNDS);
                if (dead && effective < MAX_MEK_CREW_WOUNDS) {
                    codecFail(
                        'INVALID_SERIALIZED_STATE',
                        '$.restoration.unresolved.fact.dead',
                        'committed death requires fatal wounds',
                    );
                }
                if (effective === 0 && !fact.unconscious && !ejected) crew.delete(current.positionId);
                else crew.set(current.positionId, Object.freeze({
                    wounds: effective,
                    unconscious: fact.unconscious,
                    ejected,
                    ...(dead ? { dead: true as const } : {}),
                }));
                applied = true;
                if (effective !== requested) {
                    remaining = fact;
                    warn(accumulator, {
                        code: 'DAMAGE_CLAMPED',
                        message: `Remapped crew wounds ${requested} exceed the current limit ${MAX_MEK_CREW_WOUNDS}.`,
                        currentTargetRef: current.ref,
                        saved: { wounds: requested },
                        current: { maximumWounds: MAX_MEK_CREW_WOUNDS, effectiveWounds: effective },
                    });
                }
                break;
            }
            case 'mek-rule-check': {
                if (fact.key !== MEK_TORSO_CRIPPLING_RULE_CHECK_KEY
                    || (fact.status !== 'pending' && fact.status !== 'success' && fact.status !== 'failed')) {
                    codecFail('INVALID_SERIALIZED_STATE', '$.restoration.unresolved.fact', 'invalid Mek rule check');
                }
                const openedRevision = asStateRevision(fact.openedRevision);
                if (openedRevision > savedStateRevision) {
                    codecFail(
                        'INVALID_SERIALIZED_STATE',
                        '$.restoration.unresolved.fact.openedRevision',
                        'cannot exceed unit revision',
                    );
                }
                if (entry.sourceTarget.kind !== 'location-section'
                    || entry.sourceTarget.section !== 'internal') {
                    codecFail(
                        'TARGET_KIND_MISMATCH',
                        '$.restoration.unresolved.sourceTarget',
                        'torso check requires an internal location target',
                    );
                }
                const sourceLocationId = asLocationId(entry.sourceTarget.location);
                if (fact.token !== createMekTorsoCripplingRuleCheckTokenV2(
                    openedRevision,
                    sourceLocationId,
                )) {
                    codecFail(
                        'INVALID_SERIALIZED_STATE',
                        '$.restoration.unresolved.fact.token',
                        'does not bind the exact saved torso trigger witness',
                    );
                }
                if (!isCurrentLocation(current) || current.target.section !== 'internal') break;
                if (ruleChecks.has(MEK_TORSO_CRIPPLING_RULE_CHECK_KEY)) {
                    codecFail(
                        'INVALID_SERIALIZED_STATE',
                        '$.restoration.unresolved.fact.key',
                        'duplicate recoverable Mek rule check',
                    );
                }
                ruleChecks.set(MEK_TORSO_CRIPPLING_RULE_CHECK_KEY, Object.freeze({
                    token: createMekTorsoCripplingRuleCheckTokenV2(
                        openedRevision,
                        current.locationId,
                    ),
                    triggerLocationId: current.locationId,
                    openedRevision,
                    status: fact.status,
                }));
                applied = true;
                break;
            }
            case 'pending-location-damage': {
                if (!isCurrentLocation(current)) break;
                const damage = requireSignedNonzeroInteger(fact.damage, '$.restoration.unresolved.fact.damage');
                if (current.armorFaceId) pendingArmor.set(current.armorFaceId, damage);
                else pendingLocation.set(current.locationId, damage);
                applied = true;
                break;
            }
            case 'pending-location-condition': {
                if (!isCurrentLocation(current) || current.target.section !== 'internal') break;
                const condition = requireMekLocationConditionKey(
                    fact.condition,
                    '$.restoration.unresolved.fact.condition',
                    'INVALID_SERIALIZED_STATE',
                );
                const value = requireMekLocationConditionValue(
                    condition,
                    fact.value,
                    '$.restoration.unresolved.fact.value',
                    true,
                    'INVALID_SERIALIZED_STATE',
                );
                setPendingLocationCondition(
                    pendingLocationConditions,
                    current.locationId,
                    condition,
                    value,
                );
                applied = true;
                break;
            }
            case 'pending-slot-hits': {
                if (!isCurrentSlot(current)) break;
                const requested = requireSignedNonzeroInteger(fact.hits, '$.restoration.unresolved.fact.hits');
                const committed = slots.get(current.slotId)?.hits ?? 0;
                const effective = Math.max(-committed, Math.min(requested, current.maximumHits - committed));
                if (effective !== 0) pendingSlots.set(current.slotId, effective);
                applied = effective !== 0;
                if (effective !== requested) {
                    remaining = fact;
                    warn(accumulator, {
                        code: 'DAMAGE_CLAMPED',
                        message: `Remapped pending critical delta ${requested} exceeds the current slot bounds.`,
                        currentTargetRef: current.ref,
                        saved: { hits: requested },
                        current: { committedHits: committed, maximumHits: current.maximumHits, effectiveDelta: effective },
                    });
                }
                break;
            }
            case 'pending-component-status': {
                if (!isCurrentComponent(current)) break;
                if (!isEquipmentStatus(fact.status)) {
                    codecFail('INVALID_SERIALIZED_STATE', '$.restoration.unresolved.fact.status', 'invalid pending status');
                }
                pendingComponents.set(current.componentId, fact.status);
                applied = true;
                break;
            }
            case 'pending-shield-damage': {
                if (!isCurrentComponent(current)
                    || current.target.kind !== 'component'
                    || !current.supportsShieldDamage) break;
                const requested = readPendingShieldDamage(
                    fact,
                    '$.restoration.unresolved.fact',
                );
                const effective = clampPendingShieldDamage(
                    current,
                    components.get(current.componentId),
                    requested,
                );
                if (effective.absorptionDamage !== 0 || effective.capacityDamage !== 0) {
                    pendingShieldDamage.set(current.componentId, effective);
                    applied = true;
                }
                if (!shieldDamageEqual(effective, requested)) {
                    remaining = fact;
                    warn(accumulator, {
                        code: 'DAMAGE_CLAMPED',
                        message: 'Remapped pending shield damage exceeds the current shield track bounds.',
                        currentTargetRef: current.ref,
                        saved: { ...requested },
                        current: {
                            maximumAbsorption: current.shieldMaximumAbsorption,
                            maximumCapacity: current.shieldMaximumCapacity,
                            effectiveDelta: effective,
                        },
                    });
                }
                break;
            }
            case 'pending-modular-armor-damage': {
                if (!isCurrentComponent(current)
                    || current.target.kind !== 'component'
                    || !current.supportsModularArmor) break;
                const requested = requireSignedNonzeroInteger(
                    fact.damage,
                    '$.restoration.unresolved.fact.damage',
                );
                const committed = components.get(current.componentId)?.modularArmorDamage ?? 0;
                const effective = Math.max(
                    -committed,
                    Math.min(requested, MODULAR_ARMOR_POINTS_PER_MOUNT - committed),
                );
                if (effective !== 0) {
                    pendingModularArmorDamage.set(current.componentId, effective);
                    applied = true;
                }
                if (effective !== requested) {
                    remaining = fact;
                    warn(accumulator, {
                        code: 'DAMAGE_CLAMPED',
                        message: 'Remapped pending Modular Armor damage exceeds its capacity.',
                        currentTargetRef: current.ref,
                        saved: { damage: requested },
                        current: {
                            committedDamage: committed,
                            capacity: MODULAR_ARMOR_POINTS_PER_MOUNT,
                            effectiveDelta: effective,
                        },
                    });
                }
                break;
            }
        }
        if (!applied && remaining === null) {
            retained.push(canonicalClone(entry));
            continue;
        }
        if (applied) {
            warn(accumulator, {
                code: 'TARGET_REKEYED',
                message: 'Applied a prior unresolved fact through its exact accepted repair alias.',
                currentTargetRef: current.ref,
            });
            accumulator.appliedWithWarning += 1;
        }
        if (remaining) retained.push(canonicalClone({
            ...entry,
            fact: remaining,
            reason: remaining.kind === 'component-state'
                ? 'UNSUPPORTED_COMPONENT_CAPABILITY'
                : remaining.kind === 'ammo-state'
                    ? 'UNSUPPORTED_MUNITION_OR_CAPACITY'
                    : entry.reason,
        }));
    }
    return Object.freeze(retained);
}

function restorePending(
    pending: SerializedPendingCombatStateV2 | undefined,
    accumulator: RestoreAccumulator,
    locations: ReadonlyMap<LocationId, LocationRuntimeState>,
    slots: ReadonlyMap<CriticalSlotId, CriticalSlotRuntimeState>,
    components: ReadonlyMap<ComponentId, ComponentRuntimeState>,
    pendingLocation: Map<LocationId, number>,
    pendingArmor: Map<ArmorFaceId, number>,
    pendingSlots: Map<CriticalSlotId, number>,
    pendingComponents: Map<ComponentId, EquipmentStatus>,
    pendingShieldDamage: Map<ComponentId, MekShieldDamageRuntimeState>,
    pendingModularArmorDamage: Map<ComponentId, number>,
    pendingLocationConditions: Map<LocationId, Map<MekLocationConditionKey, number>>,
): void {
    if (!pending) return;
    forEachUnique(pending.locationDamage, '$.pendingCombat.locationDamage', entry => {
        const target = sourceTarget(accumulator, entry.target, 'location-section', '$.pendingCombat.locationDamage');
        const fact: SerializedRecoverableStateFactV2 = { kind: 'pending-location-damage', damage: entry.damage };
        const damage = requireSignedNonzeroInteger(entry.damage, '$.pendingCombat.locationDamage.damage');
        const current = resolveLocationTarget(target, accumulator);
        if (!current) {
            return unresolved(accumulator, entry.target, target, fact, 'PENDING_LOCATION_SECTION_NOT_FOUND');
        }
        if (current.armorFaceId) pendingArmor.set(current.armorFaceId, damage);
        else pendingLocation.set(current.locationId, damage);
        translated(accumulator, entry.target, current.ref, false);
    });
    forEachUniqueLocationCondition(
        pending.locationConditions,
        '$.pendingCombat.locationConditions',
        entry => {
            const target = sourceTarget(
                accumulator,
                entry.target,
                'location-section',
                '$.pendingCombat.locationConditions',
            );
            if (target.section !== 'internal') {
                codecFail(
                    'TARGET_KIND_MISMATCH',
                    '$.pendingCombat.locationConditions.target',
                    'pending location conditions require an internal location target',
                );
            }
            const condition = requireMekLocationConditionKey(
                entry.condition,
                '$.pendingCombat.locationConditions.condition',
                'INVALID_SERIALIZED_STATE',
            );
            const value = requireMekLocationConditionValue(
                condition,
                entry.value,
                '$.pendingCombat.locationConditions.value',
                true,
                'INVALID_SERIALIZED_STATE',
            );
            const fact: SerializedRecoverableStateFactV2 = {
                kind: 'pending-location-condition',
                condition,
                value,
            };
            const current = resolveLocationTarget(target, accumulator);
            if (!current || current.target.section !== 'internal') {
                return unresolved(
                    accumulator,
                    entry.target,
                    target,
                    fact,
                    'PENDING_LOCATION_NOT_FOUND_FOR_CONDITION',
                );
            }
            const committed = locations.get(current.locationId)?.conditions.get(condition) ?? 0;
            if (value === committed) {
                codecFail(
                    'INVALID_SERIALIZED_STATE',
                    '$.pendingCombat.locationConditions.value',
                    'pending condition must differ from committed state',
                );
            }
            setPendingLocationCondition(pendingLocationConditions, current.locationId, condition, value);
            translated(accumulator, entry.target, current.ref, false);
        },
    );
    forEachUnique(pending.slotHits, '$.pendingCombat.slotHits', entry => {
        const target = sourceTarget(accumulator, entry.target, 'critical-slot', '$.pendingCombat.slotHits');
        const fact: SerializedRecoverableStateFactV2 = { kind: 'pending-slot-hits', hits: entry.hits };
        const hits = requireSignedNonzeroInteger(entry.hits, '$.pendingCombat.slotHits.hits');
        const current = resolveSlotTarget(target, accumulator);
        if (!current) return unresolved(accumulator, entry.target, target, fact, 'PENDING_CRITICAL_SLOT_NOT_FOUND');
        const mismatch = warnForSlotOccupantMismatch(accumulator, entry.target, target, current);
        const committed = slots.get(current.slotId)?.hits ?? 0;
        const effective = Math.max(-committed, Math.min(hits, current.maximumHits - committed));
        let warned = mismatch;
        if (effective !== hits) {
            warned = true;
            warn(accumulator, {
                code: 'DAMAGE_CLAMPED',
                message: `Saved pending critical delta ${hits} exceeds the current slot bounds.`,
                sourceTargetRef: entry.target,
                currentTargetRef: current.ref,
                saved: { hits },
                current: { committedHits: committed, maximumHits: current.maximumHits, effectiveDelta: effective },
            });
            unresolved(
                accumulator,
                entry.target,
                target,
                fact,
                'PENDING_CRITICAL_HITS_EXCEED_CURRENT_CAPACITY',
            );
        }
        if (effective !== 0) pendingSlots.set(current.slotId, effective);
        translated(accumulator, entry.target, current.ref, warned);
    });
    forEachUnique(pending.componentStatus, '$.pendingCombat.componentStatus', entry => {
        const target = sourceTarget(accumulator, entry.target, ['component', 'intrinsic-system'], '$.pendingCombat.componentStatus');
        const fact: SerializedRecoverableStateFactV2 = { kind: 'pending-component-status', status: entry.status };
        if (!isEquipmentStatus(entry.status)) {
            codecFail('INVALID_SERIALIZED_STATE', '$.pendingCombat.componentStatus.status', `invalid status ${entry.status}`);
        }
        const current = resolveComponentTarget(target, accumulator, entry.target);
        if (!current) {
            return unresolved(
                accumulator,
                entry.target,
                target,
                fact,
                'PENDING_COMPONENT_NOT_UNIQUELY_TYPE_COMPATIBLE',
            );
        }
        if (current.target.kind === 'intrinsic-system') {
            unresolved(
                accumulator,
                entry.target,
                target,
                fact,
                'INTRINSIC_SYSTEM_STATUS_REQUIRES_SLOT_OR_LOCATION_DAMAGE',
            );
            accumulator.translations.set(entry.target, current.ref);
            return;
        }
        pendingComponents.set(current.componentId, entry.status);
        const rekeyed = componentSavedId(target) !== current.componentId;
        if (rekeyed) warnRekeyed(accumulator, entry.target, current.ref, 'component');
        translated(accumulator, entry.target, current.ref, rekeyed);
    });
    forEachUnique(pending.shieldDamage, '$.pendingCombat.shieldDamage', entry => {
        const target = sourceTarget(
            accumulator,
            entry.target,
            'component',
            '$.pendingCombat.shieldDamage',
        );
        const requested = readPendingShieldDamage(entry, '$.pendingCombat.shieldDamage');
        const fact: SerializedRecoverableStateFactV2 = {
            kind: 'pending-shield-damage',
            ...requested,
        };
        const current = resolveComponentTarget(target, accumulator, entry.target);
        if (!current || current.target.kind !== 'component' || !current.supportsShieldDamage) {
            return unresolved(
                accumulator,
                entry.target,
                target,
                fact,
                'PENDING_SHIELD_NOT_UNIQUELY_TYPE_COMPATIBLE',
            );
        }
        const effective = clampPendingShieldDamage(
            current,
            components.get(current.componentId),
            requested,
        );
        let warned = false;
        if (!shieldDamageEqual(effective, requested)) {
            warned = true;
            warn(accumulator, {
                code: 'DAMAGE_CLAMPED',
                message: 'Saved pending shield damage exceeds the current shield track bounds.',
                sourceTargetRef: entry.target,
                currentTargetRef: current.ref,
                saved: { ...requested },
                current: {
                    maximumAbsorption: current.shieldMaximumAbsorption,
                    maximumCapacity: current.shieldMaximumCapacity,
                    effectiveDelta: effective,
                },
            });
            unresolved(
                accumulator,
                entry.target,
                target,
                fact,
                'PENDING_SHIELD_DAMAGE_EXCEEDS_CURRENT_CAPACITY',
            );
        }
        if (effective.absorptionDamage !== 0 || effective.capacityDamage !== 0) {
            pendingShieldDamage.set(current.componentId, effective);
        }
        const rekeyed = componentSavedId(target) !== current.componentId;
        if (rekeyed) warnRekeyed(accumulator, entry.target, current.ref, 'shield component');
        translated(accumulator, entry.target, current.ref, warned || rekeyed);
    });
    forEachUnique(
        pending.modularArmorDamage,
        '$.pendingCombat.modularArmorDamage',
        entry => {
            const target = sourceTarget(
                accumulator,
                entry.target,
                'component',
                '$.pendingCombat.modularArmorDamage',
            );
            const requested = requireSignedNonzeroInteger(
                entry.damage,
                '$.pendingCombat.modularArmorDamage.damage',
            );
            const fact: SerializedRecoverableStateFactV2 = {
                kind: 'pending-modular-armor-damage',
                damage: requested,
            };
            const current = resolveComponentTarget(target, accumulator, entry.target);
            if (!current || current.target.kind !== 'component' || !current.supportsModularArmor) {
                return unresolved(
                    accumulator,
                    entry.target,
                    target,
                    fact,
                    'PENDING_MODULAR_ARMOR_NOT_UNIQUELY_TYPE_COMPATIBLE',
                );
            }
            const committed = components.get(current.componentId)?.modularArmorDamage ?? 0;
            const effective = Math.max(
                -committed,
                Math.min(requested, MODULAR_ARMOR_POINTS_PER_MOUNT - committed),
            );
            let warned = false;
            if (effective !== requested) {
                warned = true;
                warn(accumulator, {
                    code: 'DAMAGE_CLAMPED',
                    message: 'Saved pending Modular Armor damage exceeds its capacity.',
                    sourceTargetRef: entry.target,
                    currentTargetRef: current.ref,
                    saved: { damage: requested },
                    current: {
                        committedDamage: committed,
                        capacity: MODULAR_ARMOR_POINTS_PER_MOUNT,
                        effectiveDelta: effective,
                    },
                });
                unresolved(
                    accumulator,
                    entry.target,
                    target,
                    fact,
                    'PENDING_MODULAR_ARMOR_DAMAGE_EXCEEDS_CAPACITY',
                );
            }
            if (effective !== 0) pendingModularArmorDamage.set(current.componentId, effective);
            const rekeyed = componentSavedId(target) !== current.componentId;
            if (rekeyed) warnRekeyed(accumulator, entry.target, current.ref, 'Modular Armor component');
            translated(accumulator, entry.target, current.ref, warned || rekeyed);
        },
    );
}

function readPendingShieldDamage(
    value: Pick<MekShieldDamageRuntimeState, 'absorptionDamage' | 'capacityDamage'>,
    path: string,
): MekShieldDamageRuntimeState {
    const damage = Object.freeze({
        absorptionDamage: requireSignedIntegerOrZero(
            value.absorptionDamage,
            `${path}.absorptionDamage`,
        ),
        capacityDamage: requireSignedIntegerOrZero(
            value.capacityDamage,
            `${path}.capacityDamage`,
        ),
    });
    if (damage.absorptionDamage === 0 && damage.capacityDamage === 0) {
        codecFail('INVALID_SERIALIZED_STATE', path, 'sparse pending shield damage must contain a fact');
    }
    return damage;
}

function clampPendingShieldDamage(
    target: CurrentComponentTarget,
    component: ComponentRuntimeState | undefined,
    requested: MekShieldDamageRuntimeState,
): MekShieldDamageRuntimeState {
    const committed = component?.shieldDamage ?? { absorptionDamage: 0, capacityDamage: 0 };
    return Object.freeze({
        absorptionDamage: Math.max(
            -committed.absorptionDamage,
            Math.min(
                requested.absorptionDamage,
                target.shieldMaximumAbsorption - committed.absorptionDamage,
            ),
        ),
        capacityDamage: Math.max(
            -committed.capacityDamage,
            Math.min(
                requested.capacityDamage,
                target.shieldMaximumCapacity - committed.capacityDamage,
            ),
        ),
    });
}

function shieldDamageEqual(
    left: MekShieldDamageRuntimeState,
    right: MekShieldDamageRuntimeState,
): boolean {
    return left.absorptionDamage === right.absorptionDamage
        && left.capacityDamage === right.capacityDamage;
}

function resolveRecoveryAuthorityTarget(
    target: SavedStateTargetV2,
    accumulator: RestoreAccumulator,
): CurrentTarget | undefined {
    switch (target.kind) {
        case 'location-section': return resolveLocationTarget(target, accumulator);
        case 'critical-slot': return resolveSlotTarget(target, accumulator);
        case 'component':
        case 'intrinsic-system': return resolveComponentTarget(target, accumulator);
        case 'ammo-source': return resolveAmmoTarget(target, accumulator);
        case 'crew-position': return resolveCrewTarget(target, accumulator);
    }
}

function resolveLocationTarget(
    target: Extract<SavedStateTargetV2, { kind: 'location-section' }>,
    accumulator: RestoreAccumulator,
): CurrentLocationTarget | undefined {
    return accumulator.current.locationByCoordinate.get(locationCoordinate(target.location, target.section));
}

function resolveSlotTarget(
    target: Extract<SavedStateTargetV2, { kind: 'critical-slot' }>,
    accumulator: RestoreAccumulator,
): CurrentSlotTarget | undefined {
    if (target.savedSlotId) {
        const exact = accumulator.current.slotById.get(target.savedSlotId);
        if (exact && exact.target.location === target.location && exact.target.slot === target.slot) return exact;
    }
    return accumulator.current.slotByCoordinate.get(slotCoordinate(target.location, target.slot));
}

function resolveComponentTarget(
    target: Extract<SavedStateTargetV2, { kind: 'component' | 'intrinsic-system' }>,
    accumulator: RestoreAccumulator,
    sourceRef?: SavedTargetRef,
): CurrentComponentTarget | undefined {
    const savedId = componentSavedId(target);
    if (savedId) {
        const exact = accumulator.current.componentById.get(savedId);
        if (exact && componentsCompatible(target, exact.target)) return exact;
    }
    const alias = sourceRef === undefined ? undefined : acceptedAliasTarget(sourceRef, target, accumulator);
    if (alias && isCurrentComponent(alias) && componentsCompatible(target, alias.target)) return alias;

    let candidates = accumulator.current.components.filter(candidate => componentsCompatible(target, candidate.target));
    const savedSlots = target.criticalSlots;
    if (savedSlots.length > 0) {
        const occupantIds = componentsAtAllCoordinates(savedSlots, accumulator);
        const atSavedSlots = candidates.filter(candidate => occupantIds.has(candidate.componentId));
        if (atSavedSlots.length === 1) return atSavedSlots[0];
        if (atSavedSlots.length > 1) candidates = atSavedSlots;
    }
    if (target.locations.length > 0) {
        const atSavedLocations = candidates.filter(candidate =>
            sameStringSet(target.locations, candidate.target.locations));
        if (atSavedLocations.length === 1) return atSavedLocations[0];
        if (atSavedLocations.length > 1) candidates = atSavedLocations;
    }
    if (target.kind === 'component' && target.occurrence !== undefined) {
        const sameOccurrence = candidates.filter(candidate =>
            candidate.target.kind === 'component' && candidate.target.occurrence === target.occurrence);
        if (sameOccurrence.length === 1) return sameOccurrence[0];
        if (sameOccurrence.length > 1) candidates = sameOccurrence;
    }
    return candidates.length === 1 ? candidates[0] : undefined;
}

function resolveAmmoTarget(
    target: Extract<SavedStateTargetV2, { kind: 'ammo-source' }>,
    accumulator: RestoreAccumulator,
    sourceRef?: SavedTargetRef,
): CurrentAmmoTarget | undefined {
    if (target.source.kind !== 'installed-bin') {
        const owner = accumulator.sourceTargets[target.source.ownerComponentTarget];
        if (!owner || (owner.kind !== 'component' && owner.kind !== 'intrinsic-system')) return undefined;
        const currentOwner = resolveComponentTarget(owner, accumulator);
        const exact = currentOwner === undefined
            ? undefined
            : accumulator.current.ammoById.get(currentOwner.componentId);
        if (exact && ammoCompatible(target, exact.target)) return exact;
        const alias = sourceRef === undefined ? undefined : acceptedAliasTarget(sourceRef, target, accumulator);
        return alias && isCurrentAmmo(alias) && ammoCompatible(target, alias.target)
            ? alias
            : undefined;
    }
    const savedId = target.savedAmmoSourceId ?? target.source.savedComponentId;
    if (savedId) {
        const exact = accumulator.current.ammoById.get(savedId);
        if (exact && ammoCompatible(target, exact.target)) return exact;
    }
    const alias = sourceRef === undefined ? undefined : acceptedAliasTarget(sourceRef, target, accumulator);
    if (alias && isCurrentAmmo(alias) && ammoCompatible(target, alias.target)) return alias;
    let candidates = accumulator.current.ammo.filter(candidate => ammoCompatible(target, candidate.target));
    if (target.criticalSlots.length > 0) {
        const occupantIds = componentsAtAllCoordinates(target.criticalSlots, accumulator);
        const atSavedSlots = candidates.filter(candidate => occupantIds.has(candidate.componentId));
        if (atSavedSlots.length === 1) return atSavedSlots[0];
        if (atSavedSlots.length > 1) candidates = atSavedSlots;
    }
    if (target.location !== undefined) {
        const atSavedLocation = candidates.filter(candidate => candidate.target.location === target.location);
        if (atSavedLocation.length === 1) return atSavedLocation[0];
        if (atSavedLocation.length > 1) candidates = atSavedLocation;
    }
    if (target.occurrence !== undefined) {
        const sameOccurrence = candidates.filter(candidate => candidate.target.occurrence === target.occurrence);
        if (sameOccurrence.length === 1) return sameOccurrence[0];
        if (sameOccurrence.length > 1) candidates = sameOccurrence;
    }
    return candidates.length === 1 ? candidates[0] : undefined;
}

function resolveCrewTarget(
    target: Extract<SavedStateTargetV2, { kind: 'crew-position' }>,
    accumulator: RestoreAccumulator,
    sourceRef?: SavedTargetRef,
): CurrentCrewTarget | undefined {
    if (target.savedCrewPositionId) {
        const exact = accumulator.current.crewById.get(target.savedCrewPositionId);
        if (exact && exact.target.positionKey === target.positionKey) return exact;
    }
    const alias = sourceRef === undefined ? undefined : acceptedAliasTarget(sourceRef, target, accumulator);
    if (alias && isCurrentCrew(alias)) return alias;
    let candidates = [...(accumulator.current.crewByPositionKey.get(target.positionKey) ?? [])];
    if (target.occurrence !== undefined) {
        const sameOccurrence = candidates.filter(candidate =>
            candidate.target.occurrence === target.occurrence);
        if (sameOccurrence.length === 1) return sameOccurrence[0];
        if (sameOccurrence.length > 1) candidates = sameOccurrence;
    }
    return candidates.length === 1 ? candidates[0] : undefined;
}

function acceptedAliasTarget(
    sourceRef: SavedTargetRef,
    _source: SavedStateTargetV2,
    accumulator: RestoreAccumulator,
): CurrentTarget | undefined {
    const ref = accumulator.aliasBySourceWitness.get(sourceAliasKey(sourceRef));
    return ref ? accumulator.current.byRef.get(ref) : undefined;
}

async function usableAliasMap(
    aliases: readonly SerializedPersistedRestoreAliasV2[],
    current: CurrentTargetIndex,
    currentIdentity: SavedEntityIdentity,
    sourceTargets: Readonly<Record<SavedTargetRef, SavedStateTargetV2>>,
): Promise<ReadonlyMap<string, SavedTargetRef>> {
    const result = new Map<string, SavedTargetRef>();
    for (const alias of aliases) {
        const source = sourceTargets[alias.sourceTargetRef];
        if (source === undefined) {
            codecFail(
                'INVALID_SERIALIZED_STATE',
                '$.restoration.acceptedAliases.sourceTargetRef',
                'accepted alias source ref is not owned by the exact recovery table',
            );
        }
        const currentTarget = current.byRef.get(alias.target);
        if (alias.algorithmVersion !== V2_STATE_RESTORATION_ALGORITHM_VERSION
            || !jsonValuesEqual(alias.targetEntity, currentIdentity)
            || currentTarget === undefined) continue;
        if (!recoveryAliasKindsCompatible(source, currentTarget.target)) {
            codecFail(
                'TARGET_KIND_MISMATCH',
                '$.restoration.acceptedAliases.target',
                `accepted alias cannot map ${source.kind} recovery to ${currentTarget.target.kind}`,
            );
        }
        const key = sourceAliasKey(alias.sourceTargetRef);
        const existing = result.get(key);
        if (existing !== undefined && existing !== alias.target) {
            codecFail('INVALID_SERIALIZED_STATE', '$.restoration.acceptedAliases', 'one source witness has conflicting accepted aliases');
        }
        result.set(key, alias.target);
    }
    return result;
}

function recoveryAliasKindsCompatible(source: SavedStateTargetV2, target: SavedStateTargetV2): boolean {
    if (source.kind === 'component' || source.kind === 'intrinsic-system') {
        return target.kind === 'component' || target.kind === 'intrinsic-system';
    }
    return source.kind === target.kind;
}

function sourceAliasKey(sourceRef: SavedTargetRef): string {
    return sourceRef;
}

function sourceTarget<K extends SavedStateTargetV2['kind']>(
    accumulator: RestoreAccumulator,
    ref: SavedTargetRef,
    allowed: K | readonly K[],
    path: string,
): Extract<SavedStateTargetV2, { kind: K }> {
    const target = accumulator.sourceTargets[ref];
    if (!target) codecFail('INVALID_SERIALIZED_STATE', `${path}.${ref}`, 'state references a missing witness');
    const kinds = Array.isArray(allowed) ? allowed : [allowed];
    if (!kinds.includes(target.kind as K)) {
        codecFail('TARGET_KIND_MISMATCH', `${path}.${ref}`, `state cannot consume a ${target.kind} witness`);
    }
    return target as Extract<SavedStateTargetV2, { kind: K }>;
}

function warnForSlotOccupantMismatch(
    accumulator: RestoreAccumulator,
    sourceRef: SavedTargetRef,
    source: Extract<SavedStateTargetV2, { kind: 'critical-slot' }>,
    current: CurrentSlotTarget,
): boolean {
    const expected = [source.expectedSystemId, source.expectedEquipmentName]
        .filter((item): item is string => item !== undefined);
    if (expected.length === 0) return false;
    const actual = slotOccupants(accumulator.unit, current.slotId);
    if (expected.some(saved => actual.some(candidate => equipmentKeyMatches(saved, candidate)))) return false;
    warn(accumulator, {
        code: 'SLOT_OCCUPANT_MISMATCH',
        message: `Applied coordinate-owned damage to ${source.location} slot ${source.slot} despite an occupant mismatch.`,
        sourceTargetRef: sourceRef,
        currentTargetRef: current.ref,
        saved: { occupants: expected },
        current: { occupants: actual },
    });
    return true;
}

function translated(
    accumulator: RestoreAccumulator,
    source: SavedTargetRef,
    current: SavedTargetRef,
    warned: boolean,
): void {
    accumulator.translations.set(source, current);
    if (warned) accumulator.appliedWithWarning += 1;
    else accumulator.appliedExact += 1;
}

function unresolved(
    accumulator: RestoreAccumulator,
    sourceTargetRef: SavedTargetRef,
    sourceTarget: SavedStateTargetV2,
    fact: SerializedRecoverableStateFactV2,
    reason: string,
): void {
    accumulator.unresolvedDrafts.push({
        sourceTargetRef,
        sourceTarget: canonicalClone(sourceTarget),
        fact: canonicalClone(fact),
        reason,
    });
}

function warn(accumulator: RestoreAccumulator, warning: V2StateRestoreWarning): void {
    const key = JSON.stringify(warning);
    if (accumulator.warningKeys.has(key)) return;
    accumulator.warningKeys.add(key);
    accumulator.warnings.push(deepFreeze({ ...warning }));
}

function warnRekeyed(
    accumulator: RestoreAccumulator,
    source: SavedTargetRef,
    current: SavedTargetRef,
    label: string,
): void {
    warn(accumulator, {
        code: 'TARGET_REKEYED',
        message: `Mapped the saved ${label} witness to a current same-design target.`,
        sourceTargetRef: source,
        currentTargetRef: current,
    });
}

function applyLocationDamage(
    locations: Map<LocationId, LocationRuntimeState>,
    target: CurrentLocationTarget,
    damage: number,
): void {
    const existing = locations.get(target.locationId) ?? emptyLocationState();
    if (target.armorFaceId === undefined) {
        const next = { ...existing, internalDamage: damage };
        if (next.internalDamage === 0 && next.armorDamage.length === 0 && next.conditions.size === 0) {
            locations.delete(target.locationId);
        }
        else locations.set(target.locationId, deepFreeze(next));
        return;
    }
    const armor = new Map(existing.armorDamage.map(entry => [entry.faceId, entry.damage]));
    if (damage === 0) armor.delete(target.armorFaceId);
    else armor.set(target.armorFaceId, damage);
    const armorDamage = [...armor].sort(([left], [right]) => compareText(left, right))
        .map(([faceId, value]) => Object.freeze({ faceId, damage: value }));
    if (existing.internalDamage === 0 && armorDamage.length === 0 && existing.conditions.size === 0) {
        locations.delete(target.locationId);
    } else locations.set(target.locationId, Object.freeze({
        internalDamage: existing.internalDamage,
        armorDamage: Object.freeze(armorDamage),
        conditions: new ImmutableIndex(existing.conditions),
    }));
}

function applyLocationCondition(
    locations: Map<LocationId, LocationRuntimeState>,
    locationId: LocationId,
    condition: MekLocationConditionKey,
    value: number,
): void {
    const existing = locations.get(locationId) ?? emptyLocationState();
    const conditions = new Map(existing.conditions);
    if (value === 0) conditions.delete(condition);
    else conditions.set(condition, value);
    if (existing.internalDamage === 0 && existing.armorDamage.length === 0 && conditions.size === 0) {
        locations.delete(locationId);
    } else locations.set(locationId, Object.freeze({
        ...existing,
        conditions: new ImmutableIndex(conditions),
    }));
}

function emptyLocationState(): LocationRuntimeState {
    return Object.freeze({
        internalDamage: 0,
        armorDamage: Object.freeze([]),
        conditions: new ImmutableIndex<MekLocationConditionKey, number>([]),
    });
}

function assertNoNarcOnPhysicallyDestroyedLocations(
    index: MekRuntimeIndex,
    locations: ReadonlyMap<LocationId, LocationRuntimeState>,
    path: string,
    errorCode: V2StateCodecErrorCode,
): void {
    for (const [locationId, state] of locations) {
        if ((state.conditions.get('narc') ?? 0) > 0
            && isMekLocationPhysicallyDestroyed(index, locations, locationId)) {
            codecFail(
                errorCode,
                path,
                `location ${locationId} retains NARC after committed physical destruction`,
            );
        }
    }
}

function clonePendingLocationConditions(
    values: ReadonlyMap<LocationId, ReadonlyMap<MekLocationConditionKey, number>>,
): Map<LocationId, Map<MekLocationConditionKey, number>> {
    return new Map([...values].map(([locationId, conditions]) => [locationId, new Map(conditions)]));
}

function setPendingLocationCondition(
    values: Map<LocationId, Map<MekLocationConditionKey, number>>,
    locationId: LocationId,
    condition: MekLocationConditionKey,
    value: number,
): void {
    const conditions = new Map(values.get(locationId) ?? []);
    conditions.set(condition, value);
    values.set(locationId, conditions);
}

function deserializeComponentState(
    entry: Omit<SerializedComponentStateEntryV2, 'target'> | Extract<SerializedRecoverableStateFactV2, { kind: 'component-state' }>,
    path: string,
): ComponentRuntimeState {
    if (entry.statusOverride !== undefined && entry.statusOverride !== 'disabled' && entry.statusOverride !== 'destroyed') {
        codecFail('INVALID_SERIALIZED_STATE', `${path}.statusOverride`, 'must be disabled or destroyed');
    }
    if (entry.mode !== undefined) optionalBoundedText(entry.mode, `${path}.mode`);
    if (entry.jammed !== undefined && entry.jammed !== true) {
        codecFail('INVALID_SERIALIZED_STATE', `${path}.jammed`, 'sparse jam state must be true');
    }
    if (entry.escalatingFailure !== undefined) {
        validateEscalatingFailureState(
            entry.escalatingFailure,
            `${path}.escalatingFailure`,
            'INVALID_SERIALIZED_STATE',
        );
    }
    if (entry.ppcCapacitor !== undefined) {
        validatePpcCapacitorState(entry.ppcCapacitor, `${path}.ppcCapacitor`, 'INVALID_SERIALIZED_STATE');
    }
    if (entry.bombastLaser !== undefined) {
        validateBombastLaserState(entry.bombastLaser, `${path}.bombastLaser`, 'INVALID_SERIALIZED_STATE');
    }
    if (entry.c3EmergencyMaster !== undefined) {
        validateC3EmergencyMasterState(
            entry.c3EmergencyMaster,
            `${path}.c3EmergencyMaster`,
            'INVALID_SERIALIZED_STATE',
        );
    }
    if (entry.gaussPower !== undefined) {
        validateGaussPowerState(entry.gaussPower, `${path}.gaussPower`, 'INVALID_SERIALIZED_STATE');
    }
    if (entry.shieldDamage !== undefined) {
        validateShieldDamageState(entry.shieldDamage, `${path}.shieldDamage`, 'INVALID_SERIALIZED_STATE');
    }
    if (entry.modularArmorDamage !== undefined) {
        const damage = requirePositiveSerializedInteger(
            entry.modularArmorDamage,
            `${path}.modularArmorDamage`,
        );
        if (damage > MODULAR_ARMOR_POINTS_PER_MOUNT) {
            codecFail(
                'INVALID_SERIALIZED_STATE',
                `${path}.modularArmorDamage`,
                'Modular Armor damage exceeds its capacity',
            );
        }
    }
    return {
        ...(entry.statusOverride === undefined ? {} : { statusOverride: entry.statusOverride }),
        ...(entry.mode === undefined ? {} : { mode: entry.mode }),
        ...(entry.jammed === undefined ? {} : { jammed: true }),
        ...(entry.escalatingFailure === undefined
            ? {}
            : { escalatingFailure: Object.freeze({ ...entry.escalatingFailure }) }),
        ...(entry.ppcCapacitor === undefined
            ? {}
            : { ppcCapacitor: Object.freeze({
                ...entry.ppcCapacitor,
                weaponId: asComponentId(entry.ppcCapacitor.weaponId),
            }) }),
        ...(entry.bombastLaser === undefined
            ? {}
            : { bombastLaser: Object.freeze({ ...entry.bombastLaser }) }),
        ...(entry.c3EmergencyMaster === undefined
            ? {}
            : { c3EmergencyMaster: Object.freeze({ ...entry.c3EmergencyMaster }) }),
        ...(entry.gaussPower === undefined ? {} : { gaussPower: entry.gaussPower }),
        ...(entry.shieldDamage === undefined
            ? {}
            : { shieldDamage: Object.freeze({ ...entry.shieldDamage }) }),
        ...(entry.modularArmorDamage === undefined
            ? {}
            : { modularArmorDamage: entry.modularArmorDamage }),
    };
}

function componentStateFact(
    state: ComponentRuntimeState,
): Extract<SerializedRecoverableStateFactV2, { kind: 'component-state' }> | null {
    if (state.statusOverride === undefined && state.mode === undefined && state.jammed === undefined
        && state.escalatingFailure === undefined && state.ppcCapacitor === undefined
        && state.bombastLaser === undefined && state.c3EmergencyMaster === undefined
        && state.gaussPower === undefined && state.shieldDamage === undefined
        && state.modularArmorDamage === undefined) return null;
    return {
        kind: 'component-state',
        ...(state.statusOverride === undefined ? {} : { statusOverride: state.statusOverride }),
        ...(state.mode === undefined ? {} : { mode: state.mode }),
        ...(state.jammed === undefined ? {} : { jammed: true }),
        ...(state.escalatingFailure === undefined
            ? {}
            : { escalatingFailure: Object.freeze({ ...state.escalatingFailure }) }),
        ...(state.ppcCapacitor === undefined
            ? {}
            : { ppcCapacitor: Object.freeze({ ...state.ppcCapacitor }) }),
        ...(state.bombastLaser === undefined
            ? {}
            : { bombastLaser: Object.freeze({ ...state.bombastLaser }) }),
        ...(state.c3EmergencyMaster === undefined
            ? {}
            : { c3EmergencyMaster: Object.freeze({ ...state.c3EmergencyMaster }) }),
        ...(state.gaussPower === undefined ? {} : { gaussPower: state.gaussPower }),
        ...(state.shieldDamage === undefined
            ? {}
            : { shieldDamage: Object.freeze({ ...state.shieldDamage }) }),
        ...(state.modularArmorDamage === undefined
            ? {}
            : { modularArmorDamage: state.modularArmorDamage }),
    };
}

function validateGaussPowerState(
    value: unknown,
    path: string,
    code: Extract<V2StateCodecErrorCode, 'INVALID_RUNTIME_STATE' | 'INVALID_SERIALIZED_STATE'>,
): void {
    if (!isMekGaussPowerState(value) || value === GAUSS_POWERED_UP) {
        codecFail(code, path, 'must be a sparse non-default Gauss power state');
    }
}

function validateShieldDamageState(
    value: unknown,
    path: string,
    code: Extract<V2StateCodecErrorCode, 'INVALID_RUNTIME_STATE' | 'INVALID_SERIALIZED_STATE'>,
): void {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        codecFail(code, path, 'must be a shield damage object');
    }
    const damage = value as Record<string, unknown>;
    const unknownKey = Object.keys(damage).find(key =>
        key !== 'absorptionDamage' && key !== 'capacityDamage');
    if (unknownKey !== undefined) codecFail(code, `${path}.${unknownKey}`, 'is not a shield damage field');
    const absorption = damage['absorptionDamage'];
    const capacity = damage['capacityDamage'];
    if (!Number.isSafeInteger(absorption) || Number(absorption) < 0) {
        codecFail(code, `${path}.absorptionDamage`, 'must be a non-negative safe integer');
    }
    if (!Number.isSafeInteger(capacity) || Number(capacity) < 0) {
        codecFail(code, `${path}.capacityDamage`, 'must be a non-negative safe integer');
    }
    if (absorption === 0 && capacity === 0) {
        codecFail(code, path, 'sparse shield damage must contain a nonzero value');
    }
}

function validateEscalatingFailureState(
    value: unknown,
    path: string,
    code: Extract<V2StateCodecErrorCode, 'INVALID_RUNTIME_STATE' | 'INVALID_SERIALIZED_STATE'>,
): void {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        codecFail(code, path, 'must be an escalating-failure object');
    }
    const lifecycle = value as Record<string, unknown>;
    const unknownKey = Object.keys(lifecycle).find(key => key !== 'sequence' && key !== 'active');
    if (unknownKey !== undefined) {
        codecFail(code, `${path}.${unknownKey}`, 'is not a recognized escalating-failure field');
    }
    const sequence = lifecycle['sequence'];
    if (!Number.isSafeInteger(sequence) || Number(sequence) < 1) {
        codecFail(code, `${path}.sequence`, 'must be a positive safe integer');
    }
    if (lifecycle['active'] !== undefined && lifecycle['active'] !== true) {
        codecFail(code, `${path}.active`, 'sparse active state must be true');
    }
}

function validatePpcCapacitorState(
    value: PpcCapacitorRuntimeState,
    path: string,
    code: Extract<V2StateCodecErrorCode, 'INVALID_RUNTIME_STATE' | 'INVALID_SERIALIZED_STATE'>,
): void {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        codecFail(code, path, 'must be a PPC capacitor object');
    }
    const unknownKey = Object.keys(value).find(key =>
        key !== 'weaponId' && key !== 'chargeState' && key !== 'firedThisTurn');
    if (unknownKey !== undefined) {
        codecFail(code, `${path}.${unknownKey}`, 'is not a recognized PPC capacitor field');
    }
    if (typeof value.weaponId !== 'string' || !value.weaponId.trim() || value.weaponId.includes('\0')) {
        codecFail(code, `${path}.weaponId`, 'must be a non-empty component ID');
    }
    if (value.chargeState !== undefined
        && value.chargeState !== 'charging'
        && value.chargeState !== 'charged') {
        codecFail(code, `${path}.chargeState`, 'must be charging or charged');
    }
    if (value.firedThisTurn !== undefined && value.firedThisTurn !== true) {
        codecFail(code, `${path}.firedThisTurn`, 'sparse fired state must be true');
    }
    if ((value.chargeState === undefined && value.firedThisTurn === undefined)
        || (value.chargeState !== undefined && value.firedThisTurn !== undefined)) {
        codecFail(code, path, 'must contain exactly one charge or fired fact');
    }
}

function validateBombastLaserState(
    value: BombastLaserRuntimeState,
    path: string,
    code: Extract<V2StateCodecErrorCode, 'INVALID_RUNTIME_STATE' | 'INVALID_SERIALIZED_STATE'>,
): void {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        codecFail(code, path, 'must be a Bombast Laser object');
    }
    const unknownKey = Object.keys(value).find(key =>
        key !== 'chargeState' && key !== 'firedThisTurn');
    if (unknownKey !== undefined) {
        codecFail(code, `${path}.${unknownKey}`, 'is not a recognized Bombast Laser field');
    }
    if (value.chargeState !== undefined
        && value.chargeState !== 'charging'
        && value.chargeState !== 'charged') {
        codecFail(code, `${path}.chargeState`, 'must be charging or charged');
    }
    if (value.firedThisTurn !== undefined && value.firedThisTurn !== true) {
        codecFail(code, `${path}.firedThisTurn`, 'sparse fired state must be true');
    }
    if ((value.chargeState === undefined && value.firedThisTurn === undefined)
        || (value.chargeState !== undefined && value.firedThisTurn !== undefined)) {
        codecFail(code, path, 'must contain exactly one charge or fired fact');
    }
}

function validateC3EmergencyMasterState(
    value: C3EmergencyMasterRuntimeState,
    path: string,
    code: Extract<V2StateCodecErrorCode, 'INVALID_RUNTIME_STATE' | 'INVALID_SERIALIZED_STATE'>,
): void {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        codecFail(code, path, 'must be a C3 Emergency Master object');
    }
    const unknownKey = Object.keys(value).find(key =>
        key !== 'mode' && key !== 'operatingTurns');
    if (unknownKey !== undefined) {
        codecFail(code, `${path}.${unknownKey}`, 'is not a recognized C3 Emergency Master field');
    }
    if (value.mode !== undefined && value.mode !== 'on' && value.mode !== 'off') {
        codecFail(code, `${path}.mode`, 'must be on or off');
    }
    if (value.operatingTurns !== undefined && (
        !Number.isSafeInteger(value.operatingTurns)
        || value.operatingTurns < 1
        || value.operatingTurns > 7
    )) {
        codecFail(code, `${path}.operatingTurns`, 'must be an integer from 1 to 7');
    }
    if (value.mode === undefined && value.operatingTurns === undefined) {
        codecFail(code, path, 'sparse C3 Emergency Master state must contain a fact');
    }
}

interface PartitionedComponentState {
    readonly supportedState: ComponentRuntimeState;
    /** True when at least one saved fact is understood, including selecting the current default mode. */
    readonly supportedFact: boolean;
    readonly resetMode: boolean;
    readonly unsupportedFact: Extract<SerializedRecoverableStateFactV2, { kind: 'component-state' }> | null;
    readonly clampedShieldDamage?: {
        readonly requested: MekShieldDamageRuntimeState;
        readonly effective: MekShieldDamageRuntimeState;
    };
}

function partitionComponentState(
    saved: ComponentRuntimeState,
    target: CurrentComponentTarget,
): PartitionedComponentState {
    const capabilities = target.stateCapabilities;
    const supported: ComponentRuntimeState = {
        ...(saved.statusOverride === undefined || target.target.kind === 'intrinsic-system'
            ? {}
            : { statusOverride: saved.statusOverride }),
    };
    let supportedFact = saved.statusOverride !== undefined && target.target.kind === 'component';
    let resetMode = false;
    const unsupportedStatus = target.target.kind === 'intrinsic-system'
        ? saved.statusOverride
        : undefined;
    let unsupportedMode: string | undefined;
    let unsupportedJammed: true | undefined;
    let unsupportedEscalatingFailure: ComponentRuntimeState['escalatingFailure'];
    let unsupportedPpcCapacitor: ComponentRuntimeState['ppcCapacitor'];
    let unsupportedBombastLaser: ComponentRuntimeState['bombastLaser'];
    let unsupportedC3EmergencyMaster: ComponentRuntimeState['c3EmergencyMaster'];
    let unsupportedGaussPower: ComponentRuntimeState['gaussPower'];
    let unsupportedShieldDamage: ComponentRuntimeState['shieldDamage'];
    let unsupportedModularArmorDamage: number | undefined;
    let clampedShieldDamage: PartitionedComponentState['clampedShieldDamage'];

    if (saved.mode !== undefined) {
        if (capabilities.modes.includes(saved.mode)
            || (target.supportsStealthTransition && isStealthTransitionMode(saved.mode))) {
            supportedFact = true;
            if (saved.mode === capabilities.defaultMode) resetMode = true;
            else (supported as { mode?: string }).mode = saved.mode;
        } else unsupportedMode = saved.mode;
    }
    if (saved.jammed !== undefined) {
        if (capabilities.supportsJamming) {
            supportedFact = true;
            (supported as { jammed?: boolean }).jammed = true;
        } else unsupportedJammed = true;
    }
    if (saved.escalatingFailure !== undefined) {
        if (target.escalatingFailureTargetCount >= saved.escalatingFailure.sequence) {
            supportedFact = true;
            (supported as { escalatingFailure?: ComponentRuntimeState['escalatingFailure'] })
                .escalatingFailure = Object.freeze({ ...saved.escalatingFailure });
        } else unsupportedEscalatingFailure = saved.escalatingFailure;
    }
    if (saved.ppcCapacitor !== undefined) {
        if (target.ppcCapacitorWeaponId === saved.ppcCapacitor.weaponId) {
            supportedFact = true;
            (supported as { ppcCapacitor?: ComponentRuntimeState['ppcCapacitor'] })
                .ppcCapacitor = Object.freeze({ ...saved.ppcCapacitor });
        } else unsupportedPpcCapacitor = saved.ppcCapacitor;
    }
    if (saved.bombastLaser !== undefined) {
        if (target.supportsBombastLaser) {
            supportedFact = true;
            (supported as { bombastLaser?: ComponentRuntimeState['bombastLaser'] })
                .bombastLaser = Object.freeze({ ...saved.bombastLaser });
        } else unsupportedBombastLaser = saved.bombastLaser;
    }
    if (saved.c3EmergencyMaster !== undefined) {
        if (target.supportsC3EmergencyMaster) {
            supportedFact = true;
            (supported as { c3EmergencyMaster?: ComponentRuntimeState['c3EmergencyMaster'] })
                .c3EmergencyMaster = Object.freeze({ ...saved.c3EmergencyMaster });
        } else unsupportedC3EmergencyMaster = saved.c3EmergencyMaster;
    }
    if (saved.gaussPower !== undefined) {
        if (target.supportsGaussPower) {
            supportedFact = true;
            (supported as { gaussPower?: ComponentRuntimeState['gaussPower'] })
                .gaussPower = saved.gaussPower;
        } else unsupportedGaussPower = saved.gaussPower;
    }
    if (saved.shieldDamage !== undefined) {
        if (target.supportsShieldDamage) {
            supportedFact = true;
            const effective = Object.freeze({
                absorptionDamage: Math.min(
                    saved.shieldDamage.absorptionDamage,
                    target.shieldMaximumAbsorption,
                ),
                capacityDamage: Math.min(
                    saved.shieldDamage.capacityDamage,
                    target.shieldMaximumCapacity,
                ),
            });
            if (effective.absorptionDamage !== 0 || effective.capacityDamage !== 0) {
                (supported as { shieldDamage?: ComponentRuntimeState['shieldDamage'] })
                    .shieldDamage = effective;
            }
            if (!shieldDamageEqual(effective, saved.shieldDamage)) {
                clampedShieldDamage = Object.freeze({
                    requested: Object.freeze({ ...saved.shieldDamage }),
                    effective,
                });
            }
        } else unsupportedShieldDamage = saved.shieldDamage;
    }
    if (saved.modularArmorDamage !== undefined) {
        if (target.supportsModularArmor) {
            supportedFact = true;
            (supported as { modularArmorDamage?: number }).modularArmorDamage =
                saved.modularArmorDamage;
        } else unsupportedModularArmorDamage = saved.modularArmorDamage;
    }

    const unsupportedFact = unsupportedStatus === undefined
        && unsupportedMode === undefined && unsupportedJammed === undefined
        && unsupportedEscalatingFailure === undefined && unsupportedPpcCapacitor === undefined
        && unsupportedBombastLaser === undefined && unsupportedC3EmergencyMaster === undefined
        && unsupportedGaussPower === undefined && unsupportedShieldDamage === undefined
        && unsupportedModularArmorDamage === undefined
        ? null
        : {
            kind: 'component-state' as const,
            ...(unsupportedStatus === undefined ? {} : { statusOverride: unsupportedStatus }),
            ...(unsupportedMode === undefined ? {} : { mode: unsupportedMode }),
            ...(unsupportedJammed === undefined ? {} : { jammed: true as const }),
            ...(unsupportedEscalatingFailure === undefined
                ? {}
                : { escalatingFailure: unsupportedEscalatingFailure }),
            ...(unsupportedPpcCapacitor === undefined
                ? {}
                : { ppcCapacitor: unsupportedPpcCapacitor }),
            ...(unsupportedBombastLaser === undefined
                ? {}
                : { bombastLaser: unsupportedBombastLaser }),
            ...(unsupportedC3EmergencyMaster === undefined
                ? {}
                : { c3EmergencyMaster: unsupportedC3EmergencyMaster }),
            ...(unsupportedGaussPower === undefined ? {} : { gaussPower: unsupportedGaussPower }),
            ...(unsupportedShieldDamage === undefined
                ? {}
                : { shieldDamage: unsupportedShieldDamage }),
            ...(unsupportedModularArmorDamage === undefined
                ? {}
                : { modularArmorDamage: unsupportedModularArmorDamage }),
        };
    return Object.freeze({
        supportedState: Object.freeze(supported),
        supportedFact,
        resetMode,
        unsupportedFact: unsupportedFact && Object.freeze(unsupportedFact),
        ...(clampedShieldDamage === undefined ? {} : { clampedShieldDamage }),
    });
}

function isStealthTransitionMode(mode: string): boolean {
    return mode === STEALTH_ENABLING_MODE || mode === STEALTH_DISABLING_MODE;
}

function applyComponentState(
    components: Map<ComponentId, ComponentRuntimeState>,
    componentId: ComponentId,
    partition: PartitionedComponentState,
): void {
    const existing = components.get(componentId) ?? {};
    const withoutMode = partition.resetMode
        ? (({ mode: _removed, ...remaining }) => remaining)(existing)
        : existing;
    const next = Object.freeze({ ...withoutMode, ...partition.supportedState });
    if (next.statusOverride === undefined && next.mode === undefined && next.jammed === undefined
        && next.escalatingFailure === undefined && next.ppcCapacitor === undefined
        && next.bombastLaser === undefined && next.c3EmergencyMaster === undefined
        && next.gaussPower === undefined && next.shieldDamage === undefined
        && next.modularArmorDamage === undefined) {
        components.delete(componentId);
    } else components.set(componentId, next);
}

function componentsCompatible(
    source: Extract<SavedStateTargetV2, { kind: 'component' | 'intrinsic-system' }>,
    current: Extract<SavedStateTargetV2, { kind: 'component' | 'intrinsic-system' }>,
): boolean {
    if (source.kind !== current.kind) return false;
    return source.kind === 'component' && current.kind === 'component'
        ? equipmentKeyMatches(source.equipmentName, current.equipmentName)
        : source.kind === 'intrinsic-system' && current.kind === 'intrinsic-system'
            ? systemKeyMatches(source, current)
            : false;
}

function systemKeyMatches(
    source: Extract<SavedStateTargetV2, { kind: 'intrinsic-system' }>,
    current: Extract<SavedStateTargetV2, { kind: 'intrinsic-system' }>,
): boolean {
    const sourceKeys = [source.systemKey, ...(source.aliases ?? [])];
    const currentKeys = [current.systemKey, ...(current.aliases ?? [])];
    return sourceKeys.some(left => currentKeys.some(right => equipmentKeyMatches(left, right)));
}

function ammoCompatible(
    source: Extract<SavedStateTargetV2, { kind: 'ammo-source' }>,
    current: Extract<SavedStateTargetV2, { kind: 'ammo-source' }>,
): boolean {
    const sourceInstalled = source.source.kind === 'installed-bin';
    const currentInstalled = current.source.kind === 'installed-bin';
    if (sourceInstalled !== currentInstalled) return false;
    return equipmentKeyMatches(source.source.equipmentName, current.source.equipmentName);
}

function componentsAtAllCoordinates(
    coordinates: readonly SavedSlotCoordinateV2[],
    accumulator: RestoreAccumulator,
): ReadonlySet<ComponentId> {
    let result: Set<ComponentId> | undefined;
    for (const coordinate of coordinates) {
        const slot = accumulator.current.slotByCoordinate.get(slotCoordinate(coordinate.location, coordinate.slot));
        if (!slot) return new Set();
        const occupants = new Set(accumulator.unit.index.slots.get(slot.slotId)?.componentIds ?? []);
        result = result === undefined
            ? occupants
            : new Set([...result].filter(componentId => occupants.has(componentId)));
    }
    return result ?? new Set();
}

function slotOccupants(unit: MekCodecUnit, slotId: CriticalSlotId): readonly string[] {
    return unit.index.slots.get(slotId)?.componentIds.flatMap(componentId => {
        const component = unit.index.components.get(componentId);
        if (!component) return [];
        if (component.kind === 'system') return [component.systemType];
        return [component.mount.equipmentId, component.mount.equipment?.id, component.mount.equipment?.name]
            .filter((item): item is string => item !== undefined);
    }) ?? [];
}

function componentSavedId(
    target: Extract<SavedStateTargetV2, { kind: 'component' | 'intrinsic-system' }>,
): string | undefined {
    return target.savedComponentId;
}

function componentOccurrences(index: MekRuntimeIndex): ReadonlyMap<ComponentId, number> {
    const counts = new Map<string, number>();
    const occurrences = new Map<ComponentId, number>();
    for (const [componentId, component] of index.components) {
        const key = component.kind === 'equipment'
            ? `equipment\0${canonicalEquipmentKey(component.mount.equipment?.id ?? component.mount.equipmentId)}`
            : `system\0${canonicalEquipmentKey(component.systemType)}`;
        const occurrence = counts.get(key) ?? 0;
        counts.set(key, occurrence + 1);
        occurrences.set(componentId, occurrence);
    }
    return occurrences;
}

function componentLocations(index: MekRuntimeIndex, component: MekIndexedComponent): readonly LocationId[] {
    if (component.kind === 'system') return component.placements.map(placement => placement.locationId);
    const occupied = new Set(component.mount.getOccupiedLocations());
    return [...index.locations.values()]
        .filter(location => occupied.has(location.code))
        .map(location => location.id);
}

function componentSlotCoordinates(index: MekRuntimeIndex, componentId: ComponentId): readonly SavedSlotCoordinateV2[] {
    return Object.freeze([...index.slots.values()]
        .filter(slot => slot.componentIds.includes(componentId))
        .map(slot => Object.freeze({
            location: slot.locationId,
            slot: asOneBasedCriticalSlotOrdinal(slot.slotIndex + 1),
        }))
        .sort((left, right) => compareText(slotCoordinate(left.location, left.slot), slotCoordinate(right.location, right.slot))));
}

function isCurrentComponent(
    target: CurrentTarget,
): target is CurrentComponentTarget {
    return target.target.kind === 'component' || target.target.kind === 'intrinsic-system';
}

function isCurrentLocation(
    target: CurrentTarget,
): target is CurrentLocationTarget {
    return target.target.kind === 'location-section';
}

function isCurrentSlot(
    target: CurrentTarget,
): target is CurrentSlotTarget {
    return target.target.kind === 'critical-slot';
}

function isCurrentAmmo(
    target: CurrentTarget,
): target is CurrentAmmoTarget {
    return target.target.kind === 'ammo-source';
}

function isCurrentCrew(target: CurrentTarget): target is CurrentCrewTarget {
    return target.target.kind === 'crew-position';
}

function assertSerializedIdentity(
    saved: SerializedCBTUnitV2,
    currentBaseline: InstanceBaselineRef,
    entity: MekEntity,
): void {
    const baseline = saved.baselineRefAtSave.entity;
    if (saved.entity.provider !== baseline.provider || saved.entity.uuid !== baseline.uuid) {
        codecFail('DESIGN_IDENTITY_MISMATCH', '$.baselineRefAtSave', 'saved lookup identity conflicts with its baseline');
    }
    if (saved.entity.provider !== currentBaseline.entity.provider
        || saved.entity.uuid !== currentBaseline.entity.uuid
        || saved.entity.uuid !== entity.uuid()) {
        codecFail('DESIGN_IDENTITY_MISMATCH', '$.entity', 'saved state belongs to a different provider/UUID design');
    }
    if (saved.entity.sourceHashAtSave !== undefined && baseline.sourceHashAtSave !== undefined
        && saved.entity.sourceHashAtSave !== baseline.sourceHashAtSave) {
        codecFail('DESIGN_IDENTITY_MISMATCH', '$.entity.sourceHashAtSave', 'source hash conflicts with the saved baseline');
    }
    if (saved.entity.sourceFormat === 'blk' || baseline.sourceFormat === 'blk') {
        codecFail('DESIGN_IDENTITY_MISMATCH', '$.entity.sourceFormat', 'Mek V2 state cannot use a BLK baseline');
    }
}

function assertExactSerializedUnitKeys(
    saved: SerializedCBTUnitV2,
): void {
    if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) {
        codecFail('INVALID_SERIALIZED_STATE', '$', 'serialized unit must be an object');
    }
    if (saved.schemaVersion !== CBT_UNIT_PERSISTENCE_SCHEMA_VERSION) {
        codecFail('INVALID_SERIALIZED_STATE', '$.schemaVersion', `must be unit schema ${CBT_UNIT_PERSISTENCE_SCHEMA_VERSION}`);
    }
    const allowed = new Set([
        'schemaVersion', 'instanceId', 'entity', 'baselineRefAtSave', 'blueprintReferences', 'deployment',
        'stateRevision', 'destroyed', 'locationState', 'locationConditions', 'slotState', 'componentState',
        'ammoState', 'crew', 'heat', 'family',
        'ruleChecks', 'movementPsr', 'attackerTargeting',
        'equipmentRowOrder', 'conditions', 'turn', 'pendingCombat', 'restoration',
    ]);
    for (const key of Object.keys(saved)) if (!allowed.has(key)) {
        codecFail('INVALID_SERIALIZED_STATE', `$.${key}`, 'unknown serialized unit field');
    }
    if (!Object.prototype.hasOwnProperty.call(saved, 'ruleChecks')) {
        codecFail('INVALID_SERIALIZED_STATE', '$.ruleChecks', 'current unit schema requires explicit rule checks');
    }
    if (saved.schemaVersion === CBT_UNIT_PERSISTENCE_SCHEMA_VERSION
        && !Object.prototype.hasOwnProperty.call(saved, 'movementPsr')) {
        codecFail('INVALID_SERIALIZED_STATE', '$.movementPsr', 'current unit schema requires movement/PSR state');
    }
    if (saved.schemaVersion === CBT_UNIT_PERSISTENCE_SCHEMA_VERSION
        && !Object.prototype.hasOwnProperty.call(saved, 'attackerTargeting')) {
        codecFail('INVALID_SERIALIZED_STATE', '$.attackerTargeting', 'current unit schema requires attacker targeting');
    }
}

function assertExactObjectKeys(
    value: object,
    allowed: readonly string[],
    path: string,
): void {
    const keys = new Set(allowed);
    for (const key of Object.keys(value)) if (!keys.has(key)) {
        codecFail('INVALID_SERIALIZED_STATE', `${path}.${key}`, 'unknown field');
    }
}

function assertBaselineMatchesEntity(
    baseline: InstanceBaselineRef,
    entity: MekEntity,
    path: string,
): void {
    if (baseline.entity.uuid !== entity.uuid()) {
        codecFail('BASELINE_ENTITY_MISMATCH', path, 'runtime baseline does not match the entity');
    }
}

async function finalizeUnresolved(
    drafts: readonly RestoreAccumulator['unresolvedDrafts'][number][],
    usedIds: Set<string>,
): Promise<readonly SerializedUnresolvedStateRecoveryEntryV2[]> {
    const result: SerializedUnresolvedStateRecoveryEntryV2[] = [];
    let sequence = 0;
    for (const draft of drafts) {
        let recoveryId = `v2-recovery:${sequence++}`;
        while (usedIds.has(recoveryId)) recoveryId = `v2-recovery:${sequence++}`;
        usedIds.add(recoveryId);
        result.push(canonicalClone({ recoveryId, ...draft }));
    }
    return Object.freeze(result);
}

/**
 * Applies a durable ignore decision to its recovery ID for the current restoration algorithm.
 */
async function applyIgnoredRecoveryDecisions(
    entries: readonly SerializedUnresolvedStateRecoveryEntryV2[],
    decisions: readonly SerializedIgnoredStateRecoveryDecisionV2[],
    occupiedIds: ReadonlySet<string> = new Set(),
): Promise<readonly SerializedUnresolvedStateRecoveryEntryV2[]> {
    const decisionsByKey = new Map<string, SerializedIgnoredStateRecoveryDecisionV2>();
    for (const [index, decision] of decisions.entries()) {
        boundedText(decision.recoveryId, `$.restoration.ignoredRecovery[${index}].recoveryId`);
        if (!Number.isSafeInteger(decision.algorithmVersion) || decision.algorithmVersion < 1) {
            codecFail(
                'INVALID_SERIALIZED_STATE',
                `$.restoration.ignoredRecovery[${index}].algorithmVersion`,
                'must be a positive safe integer',
            );
        }
        const key = `${decision.algorithmVersion}\0${decision.recoveryId}`;
        if (decisionsByKey.has(key)) {
            codecFail(
                'INVALID_SERIALIZED_STATE',
                `$.restoration.ignoredRecovery[${index}].recoveryId`,
                'duplicate ignored recovery decision for the same algorithm',
            );
        }
        decisionsByKey.set(key, decision);
    }

    const usedIds = new Set(occupiedIds);
    const retained: SerializedUnresolvedStateRecoveryEntryV2[] = [];
    for (const entry of entries) {
        boundedText(entry.recoveryId, '$.restoration.unresolved.recoveryId');
        if (usedIds.has(entry.recoveryId)) {
            codecFail(
                'INVALID_SERIALIZED_STATE',
                '$.restoration.unresolved.recoveryId',
                `duplicate recovery ID ${entry.recoveryId}`,
            );
        }
        const decision = decisionsByKey.get(
            `${V2_STATE_RESTORATION_ALGORITHM_VERSION}\0${entry.recoveryId}`,
        );
        if (decision) continue;
        usedIds.add(entry.recoveryId);
        retained.push(canonicalClone(entry));
    }
    retained.sort((left, right) => compareText(left.recoveryId, right.recoveryId));
    return Object.freeze(retained);
}

function mergePersistedWarnings(
    prior: readonly { readonly code: string; readonly message: string }[],
    current: readonly V2StateRestoreWarning[],
): readonly { readonly code: string; readonly message: string }[] {
    const rows = [...prior.map(canonicalClone), ...current.map(warning => ({ code: warning.code, message: warning.message }))];
    const unique = new Map(rows.map(row => [`${row.code}\0${row.message}`, row]));
    return Object.freeze([...unique.values()].sort((left, right) =>
        compareText(`${left.code}\0${left.message}`, `${right.code}\0${right.message}`)));
}

function forEachUnique<T extends { readonly target: SavedTargetRef }>(
    entries: readonly T[] | undefined,
    path: string,
    visit: (entry: T) => void,
): void {
    const seen = new Set<SavedTargetRef>();
    for (const entry of entries ?? []) {
        if (seen.has(entry.target)) codecFail('INVALID_SERIALIZED_STATE', path, `duplicate state target ${entry.target}`);
        seen.add(entry.target);
        visit(entry);
    }
}

function forEachUniqueLocationCondition(
    entries: readonly SerializedLocationConditionStateEntryV2[] | undefined,
    path: string,
    visit: (entry: SerializedLocationConditionStateEntryV2) => void,
): void {
    let previous: string | undefined;
    for (const entry of entries ?? []) {
        const coordinate = `${entry.target}\0${String(entry.condition)}`;
        if (previous !== undefined && previous >= coordinate) {
            codecFail(
                'INVALID_SERIALIZED_STATE',
                path,
                'location condition entries must be unique and sorted by target then condition',
            );
        }
        previous = coordinate;
        visit(entry);
    }
}

function locationCoordinate(location: string, section: string): string {
    return `${location.length}:${location}${section}`;
}

function slotCoordinate(location: string, oneBasedSlot: number): string {
    return `${location.length}:${location}${oneBasedSlot}`;
}

function equipmentKeyMatches(left: string, right: string): boolean {
    return canonicalEquipmentKey(left) === canonicalEquipmentKey(right);
}

function canonicalEquipmentKey(value: string): string {
    return value.normalize('NFC').trim().toLowerCase();
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
    const a = sortedUnique(left);
    const b = sortedUnique(right);
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sortedUnique<T extends string>(values: readonly T[]): readonly T[] {
    return Object.freeze([...new Set(values)].sort(compareText));
}

function compareTargetEntry(
    left: { readonly target: SavedTargetRef },
    right: { readonly target: SavedTargetRef },
): number {
    return compareText(left.target, right.target);
}

function compareLocationConditionEntry(
    left: SerializedLocationConditionStateEntryV2,
    right: SerializedLocationConditionStateEntryV2,
): number {
    return compareText(`${left.target}\0${left.condition}`, `${right.target}\0${right.condition}`);
}

function requireNonnegativeInteger(value: number, path: string): number {
    if (!Number.isSafeInteger(value) || value < 0) {
        codecFail('INVALID_SERIALIZED_STATE', path, 'must be a non-negative safe integer');
    }
    return value;
}

function requirePositiveSerializedInteger(value: number, path: string): number {
    const parsed = requireNonnegativeInteger(value, path);
    if (parsed === 0) codecFail('INVALID_SERIALIZED_STATE', path, 'sparse state values must be positive');
    return parsed;
}

function requireMekLocationConditionKey(
    value: unknown,
    path: string,
    errorCode: V2StateCodecErrorCode,
): MekLocationConditionKey {
    if (!isMekLocationConditionKey(value)) {
        codecFail(errorCode, path, 'unknown Mek location condition');
    }
    return value;
}

function requireMekLocationConditionValue(
    rawCondition: unknown,
    value: unknown,
    path: string,
    pending: boolean,
    errorCode: V2StateCodecErrorCode,
): number {
    const condition = requireMekLocationConditionKey(rawCondition, path.replace(/\.value$/, '.condition'), errorCode);
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        codecFail(errorCode, path, 'must be a non-negative safe integer');
    }
    const normalized = value as number;
    if (!pending && normalized === 0) {
        codecFail(errorCode, path, 'committed sparse condition values must be positive');
    }
    if ((condition === 'blown-off' || condition === 'flooded') && normalized > 1) {
        codecFail(errorCode, path, 'boolean location condition values must be 0 or 1');
    }
    if (normalized > MAX_MEK_LOCATION_CONDITION_VALUE) {
        codecFail(errorCode, path, `must not exceed ${MAX_MEK_LOCATION_CONDITION_VALUE}`);
    }
    return normalized;
}

function requireSignedIntegerOrZero(value: number, path: string): number {
    if (!Number.isSafeInteger(value)) codecFail('INVALID_RUNTIME_STATE', path, 'must be a signed safe integer');
    return value;
}

function requireSignedNonzeroInteger(value: number, path: string): number {
    if (!Number.isSafeInteger(value) || value === 0) {
        codecFail('INVALID_SERIALIZED_STATE', path, 'must be a non-zero signed safe integer');
    }
    return value;
}

function requireNonnegativeFinite(value: number, path: string): number {
    if (!Number.isFinite(value) || Object.is(value, -0) || value < 0) {
        codecFail('INVALID_SERIALIZED_STATE', path, 'must be a canonical non-negative finite number');
    }
    return value;
}

function boundedText(value: string, path: string): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 512 || value.includes('\0')) {
        codecFail('INVALID_SERIALIZED_STATE', path, 'must be a non-empty bounded string');
    }
    return value;
}

function optionalBoundedText(value: string | undefined, path: string): string | undefined {
    return value === undefined ? undefined : boundedText(value, path);
}

function canonicalBoundedText(value: string, path: string): string {
    const checked = boundedText(value, path);
    if (checked !== checked.trim()) {
        codecFail('INVALID_SERIALIZED_STATE', path, 'must not contain leading or trailing whitespace');
    }
    return checked;
}

function validateSortedUniqueText(values: readonly string[], path: string): readonly string[] {
    const result: string[] = [];
    let previous: string | undefined;
    for (const [index, value] of values.entries()) {
        const current = canonicalBoundedText(value, `${path}[${index}]`);
        if (previous !== undefined && previous >= current) {
            codecFail('INVALID_SERIALIZED_STATE', `${path}[${index}]`, 'values must be unique and sorted');
        }
        result.push(current);
        previous = current;
    }
    return Object.freeze(result);
}

function isEquipmentStatus(value: unknown): value is EquipmentStatus {
    return value === 'available' || value === 'disabled' || value === 'destroyed';
}

function serializeRuntimeTurn(
    value: MekUnitRuntimeState['turn'],
    path: string,
): ReturnType<typeof serializeMekTurnStateV2> {
    try {
        return serializeMekTurnStateV2(value);
    } catch (error) {
        codecFail(
            'INVALID_RUNTIME_STATE',
            path,
            error instanceof Error ? error.message : 'invalid Mek turn state',
        );
    }
}

function deserializeSavedTurn(
    value: SerializedCBTUnitV2['turn'],
    path: string,
): MekUnitRuntimeState['turn'] {
    try {
        return deserializeMekTurnStateV2(value);
    } catch (error) {
        codecFail(
            'INVALID_SERIALIZED_STATE',
            path,
            error instanceof Error ? error.message : 'invalid serialized Mek turn state',
        );
    }
}

function canonicalClone<T>(value: T): T {
    return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
    if (value === null || typeof value !== 'object' || seen.has(value as object)) return value;
    seen.add(value as object);
    if (Array.isArray(value)) value.forEach(item => deepFreeze(item, seen));
    else Object.values(value as Record<string, unknown>).forEach(item => deepFreeze(item, seen));
    return Object.freeze(value);
}

function codecFail(code: V2StateCodecErrorCode, path: string, message: string): never {
    throw new V2StateCodecError(code, message, path);
}
