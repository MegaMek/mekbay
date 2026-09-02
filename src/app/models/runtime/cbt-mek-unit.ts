// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MekEntity } from '../entity/entities/mek/mek-entity';
import { buildMekRuntimeIndex, type MekRuntimeIndex } from './mek-runtime-index';
import type { UnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { effectiveEntityPilotingSkill } from '../entity/utils/battle-value/skill-facts';
import type { CBTRuleset } from '../cbt-ruleset.model';
import { jsonValuesEqual } from '../../utils/json-value.util';
import type { InitializeUnitStateOptions } from './unit-state-initializer';
import { initializeUnitState } from './unit-state-initializer';
import { type InstanceBaselineRef } from './runtime-state';
import {
    CBTUnitInstance,
    type CBTUnitAttackerTargetingCommand,
    type CBTUnitSelectedWeaponFireCommand,
} from './unit-instance';
import type {
    SerializedCBTUnitV2,
    SerializedDeploymentConfigurationV2,
} from './persistence-v2';
import {
    buildSavedBlueprintReferenceTableV2,
    restoreSerializedCBTUnitV2,
    serializeCBTUnitStateV2,
    type V2StateRestoreWarning,
} from './runtime-state-codec-v2';
import { MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION } from './unit-state-initializer';
import { createDefaultCrewAssignment, type CrewAssignment } from './crew-assignment';
import {
    createMekHeatContextV2,
    type MekHeatAutomationPolicyV2,
    type MekHeatRuntimeContextV2,
} from './mek-heat-state-v2';
import type { ScenarioRules } from './unit-state-initializer';
import { createMekMechanicsContextV2, type MekMechanicsContextV2 } from './mek-mechanics-context-v2';
import { cloneNativeUnitSourceHandle, type NativeUnitSourceHandle } from '../native-unit-source-handle';
import { captureCBTUnitRuntime, type CBTUnitRuntimeReadModel } from './cbt-unit-runtime';
import type { TargetRegistrySnapshot } from './encounter-runtime';
import type {
    CBTSelectedWeaponFireResult,
    CBTTargetingReconciliation,
    CBTUnit,
    CBTUnitDispatchResult,
} from './cbt-unit';
import type { EquipmentRowOrderGroup } from './equipment-row-order';

export interface CreateCBTMekUnitRequest {
    readonly uuid: UnitUuid;
    readonly instanceId: string;
    readonly crewSkills?: Readonly<{ readonly gunnery: number; readonly piloting: number }>;
}

/** One-load codec diagnostics returned to the caller and never persisted with the unit. */
export interface RestoreCBTMekUnitDiagnostics {
    readonly onWarning?: (warning: V2StateRestoreWarning) => void;
}

/** Only this ready wrapper exposes the full entity and operational instance. */
export class CBTMekUnit implements CBTUnit {
    public readonly instanceId: string;
    private readonly entity: MekEntity;
    private readonly runtime: CBTUnitInstance;
    private readonly baselineRef: InstanceBaselineRef;

    public constructor(
        entity: MekEntity,
        public readonly uuid: UnitUuid,
        instance: CBTUnitInstance,
        private readonly deployment: SerializedDeploymentConfigurationV2,
        private readonly nativeSource?: NativeUnitSourceHandle,
    ) {
        if (uuid !== entity.uuid()) {
            throw new Error('Ready Mek source identity does not match the entity UUID');
        }
        this.entity = entity;
        this.instanceId = instance.id;
        this.baselineRef = instance.baselineRef;
        this.runtime = instance;
        Object.freeze(this);
    }

    public getUnit(): MekEntity {
        return this.entity;
    }

    public getInstance(): CBTUnitInstance {
        return this.runtime;
    }

    public getIndex(): MekRuntimeIndex {
        return this.runtime.getIndex();
    }

    public revision() {
        return this.runtime.revision();
    }

    public captureRuntime(): CBTUnitRuntimeReadModel {
        return captureCBTUnitRuntime(this.runtime);
    }

    public planTargetingReconciliation(
        registry: TargetRegistrySnapshot,
    ): CBTTargetingReconciliation | null {
        const plan = this.runtime.planAttackerTargetingReconciliation(registry, false);
        return plan === null
            ? null
            : () => this.runtime.installAttackerTargetingReconciliation(plan);
    }

    public setEquipmentRowOrder(
        group: EquipmentRowOrderGroup,
        permutation: readonly number[],
        rowCount: number,
        forceReadOnly: boolean,
    ): CBTUnitDispatchResult {
        return this.runtime.setEquipmentRowOrder(
            group,
            permutation,
            rowCount,
            forceReadOnly,
        );
    }

    public dispatchSelectedWeaponFire(
        command: CBTUnitSelectedWeaponFireCommand,
        registry: TargetRegistrySnapshot,
        forceReadOnly: boolean,
        c3Available: boolean,
    ): CBTSelectedWeaponFireResult {
        const result = this.runtime.dispatchSelectedWeaponFire(
            command,
            registry,
            forceReadOnly,
            c3Available,
        );
        return Object.freeze({
            ...result,
            prototypeHeat: result.prototypeHeat ?? Object.freeze([]),
        });
    }

    public dispatchAttackerTargeting(
        command: CBTUnitAttackerTargetingCommand,
        registry: TargetRegistrySnapshot,
        forceReadOnly: boolean,
    ): CBTUnitDispatchResult {
        return this.runtime.dispatchAttackerTargeting(command, registry, forceReadOnly);
    }

    public endTurn(policy: MekHeatAutomationPolicyV2): CBTUnitDispatchResult {
        return this.runtime.dispatch({
            type: 'end-turn',
            policy,
        });
    }

    /** Detached exact MTF/BLK bytes retained with this operational unit. */
    public getNativeSource(): NativeUnitSourceHandle | undefined {
        return this.nativeSource === undefined
            ? undefined
            : cloneNativeUnitSourceHandle(this.nativeSource);
    }

    /** Exact canonical entity fence for asynchronous owner replacement. */
    public matchesEntity(entity: MekEntity): boolean {
        return this.entity === entity;
    }

    public getCrewAssignment(): CrewAssignment {
        return this.runtime.query().crewAssignment();
    }

    /** Exact standalone current-format snapshot. */
    public serialize(): SerializedCBTUnitV2 {
        return serializeCBTUnitStateV2({
            entity: this.entity,
            index: this.runtime.getIndex(),
            instanceId: this.instanceId,
            sourceHashCanary: this.nativeSource?.sourceHashCanary,
            baselineRef: this.baselineRef,
            state: this.runtime.snapshot(),
            deployment: this.deployment,
        });
    }

    /** Rebuilds the immutable deployment baseline for an unstarted unit. */
    public static redeployCrew(
        current: CBTMekUnit,
        crewAssignment: CrewAssignment,
        scenario: ScenarioRules,
    ): Promise<CBTMekUnit> {
        const saved = current.serialize();
        return this.redeployPreCombat(current, {
            initializerRevision: saved.baselineRefAtSave.initialStateProfile.initializerRevision,
            profileId: saved.baselineRefAtSave.initialStateProfile.profileId,
            deployment: {
                id: saved.deployment.values.id,
                ...(saved.deployment.values.initialHeat === undefined
                    ? {}
                    : { initialHeat: saved.deployment.values.initialHeat }),
                crewAssignment,
            },
            scenario,
        });
    }

    /**
     * Rebuilds only the immutable deployment baseline of an unstarted V2 unit.
     * The exact entity, instance ID, scenario digest, runtime state, and
     * wrapper atomically only after this method has completed successfully.
     */
    public static async redeployPreCombat(
        current: CBTMekUnit,
        options: InitializeUnitStateOptions,
    ): Promise<CBTMekUnit> {
        options = captureInitializeOptions(options);
        const runtime = current.getInstance();
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
        const instance = new CBTUnitInstance(
            instanceId,
            initialized.baselineRef,
            entity,
            runtimeIndex,
            initialized.baselineRef.ruleset,
            state,
            initialized.deployment.crewAssignment,
            heatContext,
            bindMekMechanicsContext(
                entity,
                runtimeIndex,
                initialized.baselineRef.ruleset,
                options.scenario,
            ),
        );
        const deployment: SerializedDeploymentConfigurationV2 = Object.freeze({
            schemaVersion: MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION,
            values: initialized.deployment,
        });
        return new CBTMekUnit(
            entity,
            uuid,
            instance,
            deployment,
            nativeSource,
        );
    }

    /** Resets gameplay state while retaining the exact entity, identity, crew, and rules baseline. */
    public static async repair(
        current: CBTMekUnit,
        scenario: ScenarioRules,
    ): Promise<CBTMekUnit> {
        scenario = captureValue(scenario);
        const runtime = current.getInstance();
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
        const instance = new CBTUnitInstance(
            current.instanceId,
            initialized.baselineRef,
            entity,
            runtimeIndex,
            initialized.baselineRef.ruleset,
            state,
            initialized.deployment.crewAssignment,
            heat,
            bindMekMechanicsContext(entity, runtimeIndex, initialized.baselineRef.ruleset, scenario),
        );
        const deployment: SerializedDeploymentConfigurationV2 = Object.freeze({
            schemaVersion: MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION,
            values: initialized.deployment,
        });
        return new CBTMekUnit(
            entity,
            uuid,
            instance,
            deployment,
            nativeSource,
        );
    }

    /** Builds a detached runtime candidate for an atomic force-owner transfer. */
    public static cloneForOwner(
        current: CBTMekUnit,
        scenario: ScenarioRules,
    ): Promise<CBTMekUnit> {
        scenario = captureValue(scenario);
        const saved = current.serialize();
        return CBTMekUnit.restoreFromEntity(
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

    /** Restores one session undo checkpoint against the exact retained entity owner. */
    public static restoreSnapshot(
        current: CBTMekUnit,
        saved: SerializedCBTUnitV2,
        scenario: ScenarioRules,
    ): Promise<CBTMekUnit> {
        scenario = captureValue(scenario);
        if (saved.instanceId !== current.instanceId
            || saved.entity !== current.uuid) {
            throw new Error('Runtime checkpoint does not match its retained Mek owner');
        }
        return CBTMekUnit.restoreFromEntity(
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
    public static async createFromEntity(
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
                            piloting: effectiveEntityPilotingSkill(entity, request.crewSkills!.piloting),
                        })),
                    },
                },
            };
        }
        const initialized = initializeUnitState(entity, runtimeIndex, uuid, options);
        const instance = new CBTUnitInstance(
            request.instanceId,
            initialized.baselineRef,
            entity,
            runtimeIndex,
            initialized.baselineRef.ruleset,
            initialized.state,
            initialized.deployment.crewAssignment,
            await bindMekHeatRuntimeContext(
                entity,
                runtimeIndex,
                initialized.baselineRef.ruleset,
                options.scenario,
            ),
            bindMekMechanicsContext(
                entity,
                runtimeIndex,
                initialized.baselineRef.ruleset,
                options.scenario,
            ),
        );
        const deployment: SerializedDeploymentConfigurationV2 = Object.freeze({
            schemaVersion: MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION,
            values: initialized.deployment,
        });
        return new CBTMekUnit(
            entity,
            uuid,
            instance,
            deployment,
            nativeSource,
        );
    }

    /**
     * Restores one validated persisted V2 snapshot into the same authoritative
     * ready-runtime wrapper used for fresh and legacy-restored Meks. The
     * tolerant V2 restorer reports translation warnings; no legacy projection is used.
     */
    public static async restoreFromEntity(
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
        const storedCrew = saved.deployment.values.crewAssignment;
        const crewAssignment = storedCrew.positions.length === 0
            ? createDefaultCrewAssignment(runtimeIndex.crewPositions)
            : storedCrew;
        const deploymentValues = crewAssignment === storedCrew
            ? saved.deployment.values
            : Object.freeze({ ...saved.deployment.values, crewAssignment });
        if (deploymentValues !== saved.deployment.values) {
            saved = Object.freeze({
                ...saved,
                deployment: Object.freeze({ ...saved.deployment, values: deploymentValues }),
            });
        }
        const initialized = initializeUnitState(entity, runtimeIndex, uuid, {
            ...options,
            deployment: deploymentValues,
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
        const instance = new CBTUnitInstance(
            saved.instanceId,
            restored.baselineRef,
            entity,
            runtimeIndex,
            initialized.baselineRef.ruleset,
            restored.state,
            initialized.deployment.crewAssignment,
            await bindMekHeatRuntimeContext(
                entity,
                runtimeIndex,
                initialized.baselineRef.ruleset,
                options.scenario,
            ),
            bindMekMechanicsContext(
                entity,
                runtimeIndex,
                initialized.baselineRef.ruleset,
                options.scenario,
            ),
        );
        const deployment: SerializedDeploymentConfigurationV2 = Object.freeze({
            schemaVersion: MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION,
            values: initialized.deployment,
        });
        const unit = new CBTMekUnit(
            entity,
            uuid,
            instance,
            deployment,
            nativeSource,
        );
        for (const warning of restored.warnings) diagnostics.onWarning?.(warning);
        return unit;
    }

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
