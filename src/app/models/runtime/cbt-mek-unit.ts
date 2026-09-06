// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { UnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { jsonValuesEqual } from '../../utils/json-value.util';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type { CrewMemberRuntimeState } from '../crew-member.model';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import type { CrewPositionId } from '../entity/entity-identifiers';
import { ImmutableIndex } from '../entity/immutable-collections';
import { CBTUnit,type CBTMekUnit } from './cbt-unit';
import { buildMekRuntimeIndex,type MekRuntimeIndex } from './mek-runtime-index';
import type { InitializeUnitStateOptions } from './unit-state-initializer';
import { initializeUnitState } from './unit-state-initializer';

import { cloneNativeUnitSourceHandle,type NativeUnitSourceHandle } from '../native-unit-source-handle';
import { canonicalizeCrewAssignment,createDefaultCrewAssignment,type CrewAssignment } from './crew-assignment';
import { createMekHeatContextV2,type MekHeatRuntimeContextV2 } from './mek-heat-state-v2';
import { createMekMechanicsContextV2,type MekMechanicsContextV2 } from './mek-mechanics-context-v2';
import type { SerializedCBTUnitV2,SerializedDeploymentConfigurationV2 } from './persistence-v2';
import { buildSavedBlueprintReferenceTableV2,restoreSerializedCBTUnitV2,type V2StateRestoreWarning } from './runtime-state-codec-v2';
import { createMekRuntimeBinding } from './unit-instance';
import type { ScenarioRules } from './unit-state-initializer';
import { MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION } from './unit-state-initializer';

export interface CreateCBTMekUnitRequest {
    readonly uuid: UnitUuid;
    readonly instanceId: string;
    readonly crewSkills?: Readonly<{ readonly gunnery: number; readonly piloting: number }>;
}

/** One-load codec diagnostics returned to the caller and never persisted with the unit. */
export interface RestoreCBTMekUnitDiagnostics {
    readonly onWarning?: (warning: V2StateRestoreWarning) => void;
}

export async function redeployMekCrew(
    current: CBTMekUnit,
    crewAssignment: CrewAssignment,
    scenario: ScenarioRules,
    crewState?: ReadonlyMap<CrewPositionId, CrewMemberRuntimeState>,
): Promise<CBTMekUnit> {
    const index = current.getIndex();
    const assignment = canonicalizeCrewAssignment(index.crewPositions, crewAssignment);
    const health = crewState === undefined ? undefined : new ImmutableIndex(
        [...crewState].map(([id, value]) => [id, Object.freeze({ ...value })] as const));
    const state = current.snapshot();
    const heat = await bindMekHeatRuntimeContext(current.getUnit(), index, current.baselineRef.ruleset, scenario);
    if (current.snapshot() !== state || !current.matchesEntity(current.getUnit())) {
        throw new Error('The runtime changed while its crew replacement was being prepared');
    }
    const prepared = createMekRuntimeBinding(
        current.getUnit(), index, current.ruleset(),
        health === undefined ? state : { ...state, crew: health }, assignment, heat,
        bindMekMechanicsContext(current.getUnit(), index, current.ruleset(), scenario),
    );
    const deployment = Object.freeze({ ...current.getDeployment(),
        values: Object.freeze({ ...current.getDeployment().values, crewAssignment: assignment }) });
    return new CBTUnit<'mek'>({
        uuid: current.uuid, instanceId: current.instanceId, baselineRef: current.baselineRef,
        runtime: { kind: 'mek', ...prepared, deployment }, nativeSource: current.getNativeSource(),
    });
}

/**
 * Rebuilds only the immutable deployment baseline of an unstarted V2 unit.
 * The caller atomically installs the replacement owner after preparation succeeds.
 */
export async function redeployMekPreCombat(
    current: CBTMekUnit,
    options: InitializeUnitStateOptions,
    crewState?: ReadonlyMap<CrewPositionId, CrewMemberRuntimeState>,
): Promise<CBTMekUnit> {
    options = captureInitializeOptions(options);
    const health = crewState === undefined ? undefined : new ImmutableIndex(
        [...crewState].map(([id, value]) => [id, Object.freeze({ ...value })] as const),
    );
    const runtime = current;
    if (runtime.revision() !== 0) {
        throw new Error('A started V2 runtime cannot be redeployed');
    }

    const entity = current.getUnit();
    const uuid = current.uuid;
    const instanceId = current.instanceId;
    const saved = current.serialize();
    const state = runtime.snapshot();
    const nativeSource = current.getNativeSource();
    const runtimeIndex = buildMekRuntimeIndex(entity);
    const initialized = initializeUnitState(entity, runtimeIndex, uuid, options);
    if (runtime.revision() !== 0 || runtime.snapshot() !== state) {
        throw new Error('The V2 runtime changed while redeployment was being prepared');
    }
    if (!jsonValuesEqual(saved.baselineRefAtSave.entity, uuid)
        || !jsonValuesEqual(initialized.baselineRef.entity, uuid)) {
        throw new Error('Redeployment cannot change the entity identity');
    }
    if (initialized.baselineRef.initialStateProfile.initializerRevision
        !== saved.baselineRefAtSave.initialStateProfile.initializerRevision
        || initialized.baselineRef.initialStateProfile.profileId
        !== saved.baselineRefAtSave.initialStateProfile.profileId) {
        throw new Error('Redeployment cannot change the initializer identity');
    }

    const heatContext = await bindMekHeatRuntimeContext(
        entity,
        runtimeIndex,
        initialized.baselineRef.ruleset,
        options.scenario,
    );
    // Heat binding is asynchronous. Recheck the exact owner before constructing its replacement.
    if (runtime.revision() !== 0
        || runtime.snapshot() !== state
        || current.instanceId !== instanceId
        || current.getUnit() !== entity
        || !runtime.matchesEntity(entity)) {
        throw new Error('The V2 runtime changed while heat authority was being bound');
    }
    const prepared = createMekRuntimeBinding(
        entity, runtimeIndex, initialized.baselineRef.ruleset,
        health === undefined ? state : { ...state, crew: health },
        initialized.deployment.crewAssignment, heatContext,
        bindMekMechanicsContext(entity, runtimeIndex, initialized.baselineRef.ruleset, options.scenario),
    );
    const deployment: SerializedDeploymentConfigurationV2 = Object.freeze({
        schemaVersion: MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION,
        values: initialized.deployment,
    });
    return new CBTUnit<'mek'>({
        uuid, instanceId, baselineRef: initialized.baselineRef,
        runtime: { kind: 'mek', ...prepared, deployment }, nativeSource,
    });
}

/** Resets gameplay state while retaining the exact entity, identity, crew, and rules baseline. */
export async function repairMekUnit(
    current: CBTMekUnit,
    scenario: ScenarioRules,
): Promise<CBTMekUnit> {
    scenario = captureValue(scenario);
    const runtime = current;
    const currentState = runtime.snapshot();
    const currentRevision = runtime.revision();
    if (currentRevision >= Number.MAX_SAFE_INTEGER) throw new Error('Unit revision is exhausted');

    const saved = current.serialize();
    const entity = current.getUnit();
    const uuid = current.uuid;
    const nativeSource = current.getNativeSource();
    const options = captureInitializeOptions({
        initializerRevision: saved.baselineRefAtSave.initialStateProfile.initializerRevision,
        profileId: saved.baselineRefAtSave.initialStateProfile.profileId,
        deployment: saved.deployment.values,
        scenario,
    });
    const runtimeIndex = buildMekRuntimeIndex(entity);
    const initialized = initializeUnitState(entity, runtimeIndex, uuid, options);
    if (initialized.baselineRef.entity !== saved.baselineRefAtSave.entity
        || !jsonValuesEqual(
            initialized.baselineRef.initialStateProfile,
            saved.baselineRefAtSave.initialStateProfile,
        )) {
        throw new Error('Repair cannot change the unit baseline');
    }
    const state = Object.freeze({
        ...initialized.state,
        stateRevision: currentRevision + 1,
        attackerTargeting: currentState.attackerTargeting,
        ...(currentState.equipmentRowOrder === undefined
            ? {}
            : { equipmentRowOrder: currentState.equipmentRowOrder }),
    });
    const heat = await bindMekHeatRuntimeContext(
        entity,
        runtimeIndex,
        initialized.baselineRef.ruleset,
        scenario,
    );
    if (current.getUnit() !== entity
        || runtime.revision() !== currentRevision
        || runtime.snapshot() !== currentState) {
        throw new Error('The V2 runtime changed while repair was being prepared');
    }
    const prepared = createMekRuntimeBinding(
        entity, runtimeIndex, initialized.baselineRef.ruleset, state,
        initialized.deployment.crewAssignment, heat,
        bindMekMechanicsContext(entity, runtimeIndex, initialized.baselineRef.ruleset, scenario),
    );
    const deployment: SerializedDeploymentConfigurationV2 = Object.freeze({
        schemaVersion: MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION,
        values: initialized.deployment,
    });
    return new CBTUnit<'mek'>({
        uuid, instanceId: current.instanceId, baselineRef: initialized.baselineRef,
        runtime: { kind: 'mek', ...prepared, deployment }, nativeSource,
    });
}

/** Builds a detached runtime candidate for an atomic force-owner transfer. */
export function cloneMekForOwner(
    current: CBTMekUnit,
    scenario: ScenarioRules,
): Promise<CBTMekUnit> {
    scenario = captureValue(scenario);
    const saved = current.serialize();
    return restoreMekUnit(
        saved,
        current.getUnit(),
        current.uuid,
        {
            initializerRevision: saved.baselineRefAtSave.initialStateProfile.initializerRevision,
            profileId: saved.baselineRefAtSave.initialStateProfile.profileId,
            deployment: saved.deployment.values,
            scenario,
        },
        current.getNativeSource(),
    ).then(candidate => {
        candidate.installAttackerTargetingSessionState(
            current.captureRuntime().query.attackerTargetingState(),
        );
        return candidate;
    });
}

/** Restores one session undo checkpoint against the exact retained entity owner. */
export function restoreMekSnapshot(
    current: CBTMekUnit,
    saved: SerializedCBTUnitV2,
    scenario: ScenarioRules,
): Promise<CBTMekUnit> {
    scenario = captureValue(scenario);
    if (saved.instanceId !== current.instanceId
        || saved.entity !== current.uuid) {
        throw new Error('Runtime checkpoint does not match its retained Mek owner');
    }
    return restoreMekUnit(
        saved,
        current.getUnit(),
        current.uuid,
        {
            initializerRevision: saved.baselineRefAtSave.initialStateProfile.initializerRevision,
            profileId: saved.baselineRefAtSave.initialStateProfile.profileId,
            deployment: saved.deployment.values,
            scenario,
        },
        current.getNativeSource(),
    );
}

/** Uses the exact entity already checked by the whole-unit capability gate. */
export async function createMekUnit(
    request: CreateCBTMekUnitRequest,
    entity: MekEntity,
    uuid: UnitUuid,
    options: InitializeUnitStateOptions,
    nativeSource?: NativeUnitSourceHandle,
): Promise<CBTMekUnit> {
    request = captureValue(request);
    uuid = captureValue(uuid);
    options = captureInitializeOptions(options);
    if (uuid !== request.uuid || uuid !== entity.uuid()) {
        throw new Error('Entity does not match the requested UUID');
    }
    nativeSource = verifyNativeSource(nativeSource);
    const runtimeIndex = buildMekRuntimeIndex(entity);
    if (request.crewSkills) {
        options = {
            ...options,
            deployment: {
                ...options.deployment,
                crewAssignment: {
                    schemaVersion: 1,
                    positions: createDefaultCrewAssignment(runtimeIndex.crewPositions).positions.map(position => ({
                        ...position,
                        gunnery: request.crewSkills!.gunnery,
                        piloting: request.crewSkills!.piloting,
                    })),
                },
            },
        };
    }
    const initialized = initializeUnitState(entity, runtimeIndex, uuid, options);
    const prepared = createMekRuntimeBinding(
        entity, runtimeIndex, initialized.baselineRef.ruleset, initialized.state,
        initialized.deployment.crewAssignment,
        await bindMekHeatRuntimeContext(entity, runtimeIndex, initialized.baselineRef.ruleset, options.scenario),
        bindMekMechanicsContext(entity, runtimeIndex, initialized.baselineRef.ruleset, options.scenario),
    );
    const deployment: SerializedDeploymentConfigurationV2 = Object.freeze({
        schemaVersion: MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION,
        values: initialized.deployment,
    });
    return new CBTUnit<'mek'>({
        uuid, instanceId: request.instanceId, baselineRef: initialized.baselineRef,
        runtime: { kind: 'mek', ...prepared, deployment }, nativeSource,
    });
}

/**
 * Restores one validated persisted V2 snapshot into the same authoritative
 * unit owner used for fresh and legacy-restored Meks. The
 * tolerant V2 restorer reports translation warnings; no legacy projection is used.
 */
export async function restoreMekUnit(
    saved: SerializedCBTUnitV2,
    entity: MekEntity,
    uuid: UnitUuid,
    options: InitializeUnitStateOptions,
    nativeSource?: NativeUnitSourceHandle,
    diagnostics: RestoreCBTMekUnitDiagnostics = {},
): Promise<CBTMekUnit> {
    saved = captureValue(saved);
    uuid = captureValue(uuid);
    options = captureInitializeOptions(options);
    if (uuid !== saved.entity || uuid !== entity.uuid()) {
        throw new Error('Entity does not match the persisted V2 UUID');
    }
    nativeSource = verifyNativeSource(nativeSource);
    const runtimeIndex = buildMekRuntimeIndex(entity);
    const initialized = initializeUnitState(entity, runtimeIndex, uuid, {
        ...options,
        deployment: saved.deployment.values,
    });
    // The native Entity owns topology. Storage carries only stable target IDs;
    // rebuild the transient lookup table from the exact loaded source.
    const restored = await restoreSerializedCBTUnitV2(
        {
            ...saved,
            blueprintReferences: buildSavedBlueprintReferenceTableV2(
                entity,
                runtimeIndex,
                initialized.baselineRef.ruleset,
            ),
        },
        entity,
        runtimeIndex,
        initialized,
    );
    const prepared = createMekRuntimeBinding(
        entity, runtimeIndex, initialized.baselineRef.ruleset, restored.state,
        initialized.deployment.crewAssignment,
        await bindMekHeatRuntimeContext(entity, runtimeIndex, initialized.baselineRef.ruleset, options.scenario),
        bindMekMechanicsContext(entity, runtimeIndex, initialized.baselineRef.ruleset, options.scenario),
    );
    const deployment: SerializedDeploymentConfigurationV2 = Object.freeze({
        schemaVersion: MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION,
        values: initialized.deployment,
    });
    const unit = new CBTUnit<'mek'>({
        uuid, instanceId: saved.instanceId, baselineRef: restored.baselineRef,
        runtime: { kind: 'mek', ...prepared, deployment }, nativeSource,
    });
    for (const warning of restored.warnings) diagnostics.onWarning?.(warning);
    return unit;
}

function verifyNativeSource(source?: NativeUnitSourceHandle): NativeUnitSourceHandle | undefined {
    if (source === undefined) return undefined;
    if (source.format !== 'mtf') throw new Error('A Mek runtime requires an MTF source');
    return cloneNativeUnitSourceHandle(source);
}

function bindMekHeatRuntimeContext(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    scenario: ScenarioRules,
): MekHeatRuntimeContextV2 {
    return createMekHeatContextV2(
        entity,
        index,
        ruleset,
        runtimeScenario(scenario),
    );
}

function bindMekMechanicsContext(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    scenario: ScenarioRules,
): MekMechanicsContextV2 {
    return createMekMechanicsContextV2(
        entity,
        index,
        ruleset,
        runtimeScenario(scenario),
    );
}

/** Ruleset is already bound separately; only scenario facts belong in these contexts. */
function runtimeScenario(scenario: ScenarioRules): Pick<ScenarioRules, 'id' | 'options'> {
    return Object.freeze({
        id: scenario.id,
        ...(scenario.options === undefined ? {} : { options: scenario.options }),
    });
}

function captureInitializeOptions(options: InitializeUnitStateOptions): InitializeUnitStateOptions {
    return captureValue(options);
}

/** Owns caller structural JSON before an async boundary; entity objects stay reference-bound. */
function captureValue<T>(value: T): T {
    return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
    if (value === null || typeof value !== 'object' || seen.has(value as object)) return value;
    seen.add(value as object);
    if (Array.isArray(value)) value.forEach(item => deepFreeze(item, seen));
    else Object.values(value as Record<string, unknown>).forEach(item => deepFreeze(item, seen));
    return Object.freeze(value);
}
