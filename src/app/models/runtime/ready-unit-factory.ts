// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MekEntity } from '../entity/entities/mek/mek-entity';
import type { SavedEntityIdentity } from '../persisted-unit-state';
import { buildMekRuntimeIndex, type MekRuntimeIndex } from './mek-runtime-index';
import type { UnitProviderId, UnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import type { CBTRuleset } from '../cbt-ruleset.model';
import { jsonValuesEqual } from '../../utils/json-value.util';
import type { InitializeUnitStateOptions } from './unit-state-initializer';
import { initializeUnitState } from './unit-state-initializer';
import {
    asStateRevision,
    createCommandId,
    type InstanceBaselineRef,
    type StateRevision,
    type UnitInstanceId,
} from './runtime-state';
import {
    CBTUnitInstance,
    type CBTUnitAttackerTargetingCommand,
    type CBTUnitSelectedWeaponFireCommand,
} from './unit-instance';
import type {
    SerializedCBTUnitV2,
    SerializedDeploymentConfigurationV2,
    SerializedUnitRestorationMetadataV2,
} from './persistence-v2';
import {
    buildSavedBlueprintReferenceTableV2,
    restoreSerializedCBTUnitV2,
    serializeCBTUnitStateV2,
} from './runtime-state-codec-v2';
import { MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION } from './unit-state-initializer';
import { createDefaultCrewAssignment, type CrewAssignment } from './crew-assignment';
import {
    createMekHeatContextV2,
    type MekHeatAutomationPolicyV2,
    type MekHeatRuntimeContextV2,
} from './mek-heat-state-v2';
import type { ScenarioRules } from './unit-state-initializer';
import {
    createMekMechanicsContextV2,
    type MekMechanicsContextV2,
} from './mek-mechanics-context-v2';
import {
    cloneNativeUnitSourceHandle,
    type NativeUnitSourceHandle,
} from '../native-unit-source-handle';
import {
    captureClassicUnitRuntime,
    type ClassicUnitRuntimeReadModel,
} from './classic-unit-runtime';
import type { TargetRegistrySnapshot } from './encounter-runtime';
import type {
    ReadyAttackerTargetingResult,
    ReadyEquipmentRowOrderResult,
    ReadyEndTurnResult,
    ReadySelectedWeaponFireResult,
    ReadyTargetingReconciliation,
    ReadyClassicUnit,
} from './ready-classic-unit';
import type { EquipmentRowOrderGroup } from './equipment-row-order';

export interface ReadyMekUnitFactoryDependencies {
    readonly initializeOptions: InitializeUnitStateOptions;
}

export interface ReadyMekUnitRequest {
    readonly identity: { readonly provider: UnitProviderId; readonly uuid: UnitUuid };
    readonly instanceId: UnitInstanceId;
}

/** Only this ready wrapper exposes the full entity and operational instance. */
export class ReadyMekUnit implements ReadyClassicUnit {
    public readonly instanceId: UnitInstanceId;
    private readonly entity: MekEntity;
    private readonly sourceRef: SavedEntityIdentity;
    private readonly runtime: CBTUnitInstance;
    private readonly baselineRef: InstanceBaselineRef;

    public constructor(
        entity: MekEntity,
        sourceRef: SavedEntityIdentity,
        instance: CBTUnitInstance,
        private readonly deployment: SerializedDeploymentConfigurationV2,
        private readonly nativeSource?: NativeUnitSourceHandle,
        private readonly restorationSidecar?: SerializedUnitRestorationMetadataV2,
    ) {
        if (sourceRef.uuid !== entity.uuid()) {
            throw new Error('Ready Mek source identity does not match the entity UUID');
        }
        this.entity = entity;
        this.sourceRef = Object.freeze({ ...sourceRef });
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

    public captureRuntime(): ClassicUnitRuntimeReadModel {
        return captureClassicUnitRuntime(this.runtime);
    }

    public planTargetingReconciliation(
        registry: TargetRegistrySnapshot,
    ): ReadyTargetingReconciliation | null {
        const plan = this.runtime.planAttackerTargetingReconciliation(registry, false);
        return plan === null ? null : Object.freeze({
            expectedRevision: plan.expectedRevision,
            commit: () => this.runtime.commitAttackerTargetingReconciliation(plan),
        });
    }

    public setEquipmentRowOrder(
        expectedRevision: StateRevision,
        group: EquipmentRowOrderGroup,
        permutation: readonly number[],
        rowCount: number,
        forceReadOnly: boolean,
    ): ReadyEquipmentRowOrderResult {
        const result = this.runtime.setEquipmentRowOrder(
            expectedRevision,
            group,
            permutation,
            rowCount,
            forceReadOnly,
        );
        return result.accepted
            ? Object.freeze({
                accepted: true,
                idempotent: !result.changed,
                currentRevision: result.currentRevision,
            })
            : result;
    }

    public dispatchSelectedWeaponFire(
        command: CBTUnitSelectedWeaponFireCommand,
        registry: TargetRegistrySnapshot,
        forceReadOnly: boolean,
        c3Available: boolean,
    ): ReadySelectedWeaponFireResult {
        const result = this.runtime.dispatchSelectedWeaponFire(
            command,
            registry,
            forceReadOnly,
            c3Available,
        );
        return result.accepted
            ? Object.freeze({
                accepted: true,
                idempotent: result.idempotent,
                currentRevision: result.state.stateRevision,
                prototypeHeat: result.prototypeHeat ?? Object.freeze([]),
            })
            : Object.freeze({
                accepted: false,
                reason: result.reason,
                currentRevision: result.currentRevision,
            });
    }

    public dispatchAttackerTargeting(
        command: CBTUnitAttackerTargetingCommand,
        registry: TargetRegistrySnapshot,
        forceReadOnly: boolean,
    ): ReadyAttackerTargetingResult {
        const result = this.runtime.dispatchAttackerTargeting(command, registry, forceReadOnly);
        return result.accepted
            ? Object.freeze({
                accepted: true,
                idempotent: result.idempotent,
                currentRevision: result.state.stateRevision,
            })
            : Object.freeze({
                accepted: false,
                reason: result.reason,
                currentRevision: result.currentRevision,
            });
    }

    public endTurn(policy: MekHeatAutomationPolicyV2): ReadyEndTurnResult {
        const result = this.runtime.dispatch({
            type: 'end-turn',
            commandId: createCommandId(),
            expectedRevision: this.runtime.revision(),
            policy,
        });
        return result.accepted || result.reason === 'NO_CHANGE'
            ? Object.freeze({ accepted: true })
            : Object.freeze({ accepted: false, reason: result.reason });
    }

    public getSourceRef(): SavedEntityIdentity {
        return this.sourceRef;
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

    /** Exact standalone current-format snapshot, including passive conversion diagnostics. */
    public serialize(): SerializedCBTUnitV2 {
        return serializeCBTUnitStateV2({
            entity: this.entity,
            instanceId: this.instanceId,
            baselineRef: this.baselineRef,
            state: this.runtime.snapshot(),
            deployment: this.deployment,
            ...(this.restorationSidecar ? { restoration: this.restorationSidecar } : {}),
        });
    }

}

/**
 * Async readiness boundary: entity loading and deterministic baseline
 * finish before a runtime can escape.
 */
export class ReadyMekUnitFactory {
    private readonly initializeOptions: InitializeUnitStateOptions;

    public constructor(dependencies: ReadyMekUnitFactoryDependencies) {
        this.initializeOptions = captureInitializeOptions(dependencies.initializeOptions);
    }

    /**
     * Rebuilds only the immutable deployment baseline of an unstarted V2 unit.
     * The exact entity, instance ID, scenario digest, runtime state, and
     * restoration evidence are retained. The caller installs the returned
     * wrapper atomically only after this method has completed successfully.
     */
    public static async redeployPreCombat(
        current: ReadyMekUnit,
        options: InitializeUnitStateOptions,
    ): Promise<ReadyMekUnit> {
        options = captureInitializeOptions(options);
        const runtime = current.getInstance();
        if (runtime.revision() !== 0) {
            throw new Error('A started V2 runtime cannot be redeployed');
        }

        const entity = current.getUnit();
        const sourceRef = current.getSourceRef();
        const instanceId = current.instanceId;
        const saved = current.serialize();
        const state = runtime.snapshot();
        const nativeSource = current.getNativeSource();
        const initialized = initializeUnitState(entity, sourceRef, options);
        if (runtime.revision() !== 0 || runtime.snapshot() !== state) {
            throw new Error('The V2 runtime changed while redeployment was being prepared');
        }
        if (!jsonValuesEqual(saved.baselineRefAtSave.entity, sourceRef)
            || !jsonValuesEqual(initialized.baselineRef.entity, sourceRef)
            || initialized.baselineRef.ruleset !== saved.baselineRefAtSave.ruleset) {
            throw new Error('Redeployment cannot change the entity identity or ruleset');
        }
        if (initialized.baselineRef.initialStateProfile.initializerRevision
            !== saved.baselineRefAtSave.initialStateProfile.initializerRevision
            || initialized.baselineRef.initialStateProfile.profileId
            !== saved.baselineRefAtSave.initialStateProfile.profileId) {
            throw new Error('Redeployment cannot change the initializer identity');
        }

        const heatContext = await bindMekHeatRuntimeContext(
            entity,
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
            initialized.baselineRef.ruleset,
            state,
            initialized.deployment.crewAssignment,
            heatContext,
            bindMekMechanicsContext(
                entity,
                initialized.baselineRef.ruleset,
                options.scenario,
            ),
        );
        const deployment: SerializedDeploymentConfigurationV2 = Object.freeze({
            schemaVersion: MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION,
            values: initialized.deployment,
        });
        return new ReadyMekUnit(
            entity,
            sourceRef,
            instance,
            deployment,
            nativeSource,
            saved.restoration,
        );
    }

    /** Resets gameplay state while retaining the exact entity, identity, crew, and rules baseline. */
    public static async repair(
        current: ReadyMekUnit,
        scenario: ScenarioRules,
    ): Promise<ReadyMekUnit> {
        scenario = captureValue(scenario);
        const runtime = current.getInstance();
        const currentState = runtime.snapshot();
        const currentRevision = runtime.revision();
        if (currentRevision >= Number.MAX_SAFE_INTEGER) throw new Error('Unit revision is exhausted');

        const saved = current.serialize();
        const entity = current.getUnit();
        const sourceRef = current.getSourceRef();
        const nativeSource = current.getNativeSource();
        const options = captureInitializeOptions({
            initializerRevision: saved.baselineRefAtSave.initialStateProfile.initializerRevision,
            profileId: saved.baselineRefAtSave.initialStateProfile.profileId,
            deployment: saved.deployment.values,
            scenario,
        });
        const initialized = initializeUnitState(entity, sourceRef, options);
        if (!jsonValuesEqual(initialized.baselineRef, saved.baselineRefAtSave)) {
            throw new Error('Repair cannot change the unit baseline');
        }
        const state = Object.freeze({
            ...initialized.state,
            stateRevision: asStateRevision(currentRevision + 1),
            ...(currentState.equipmentRowOrder === undefined
                ? {}
                : { equipmentRowOrder: currentState.equipmentRowOrder }),
        });
        const heat = await bindMekHeatRuntimeContext(
            entity,
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
            initialized.baselineRef.ruleset,
            state,
            initialized.deployment.crewAssignment,
            heat,
            bindMekMechanicsContext(entity, initialized.baselineRef.ruleset, scenario),
        );
        const deployment: SerializedDeploymentConfigurationV2 = Object.freeze({
            schemaVersion: MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION,
            values: initialized.deployment,
        });
        return new ReadyMekUnit(
            entity,
            sourceRef,
            instance,
            deployment,
            nativeSource,
            saved.restoration,
        );
    }

    /** Builds a detached runtime candidate for an atomic force-owner transfer. */
    public static cloneForOwner(
        current: ReadyMekUnit,
        scenario: ScenarioRules,
    ): Promise<ReadyMekUnit> {
        scenario = captureValue(scenario);
        const saved = current.serialize();
        const factory = new ReadyMekUnitFactory({
            initializeOptions: {
                initializerRevision: saved.baselineRefAtSave.initialStateProfile.initializerRevision,
                profileId: saved.baselineRefAtSave.initialStateProfile.profileId,
                deployment: saved.deployment.values,
                scenario,
            },
        });
        return factory.restoreFromEntity(
            saved,
            current.getUnit(),
            current.getSourceRef(),
            current.getNativeSource(),
        );
    }

    /** Restores one session undo checkpoint against the exact retained entity owner. */
    public static restoreSnapshot(
        current: ReadyMekUnit,
        saved: SerializedCBTUnitV2,
        scenario: ScenarioRules,
    ): Promise<ReadyMekUnit> {
        scenario = captureValue(scenario);
        if (saved.instanceId !== current.instanceId
            || saved.entity.provider !== current.getSourceRef().provider
            || saved.entity.uuid !== current.getSourceRef().uuid) {
            throw new Error('Runtime checkpoint does not match its retained Mek owner');
        }
        const factory = new ReadyMekUnitFactory({
            initializeOptions: {
                initializerRevision: saved.baselineRefAtSave.initialStateProfile.initializerRevision,
                profileId: saved.baselineRefAtSave.initialStateProfile.profileId,
                deployment: saved.deployment.values,
                scenario,
            },
        });
        return factory.restoreFromEntity(
            saved,
            current.getUnit(),
            current.getSourceRef(),
            current.getNativeSource(),
        );
    }

    /** Uses the exact entity already checked by the whole-unit capability gate. */
    public async createFromEntity(
        request: ReadyMekUnitRequest,
        entity: MekEntity,
        sourceRef: SavedEntityIdentity,
        nativeSource?: NativeUnitSourceHandle,
    ): Promise<ReadyMekUnit> {
        request = captureValue(request);
        sourceRef = captureValue(sourceRef);
        if (sourceRef.provider !== request.identity.provider
            || sourceRef.uuid !== request.identity.uuid
            || sourceRef.uuid !== entity.uuid()) {
            throw new Error('Entity does not match the requested provider/UUID');
        }
        nativeSource = verifyNativeSource(sourceRef, nativeSource);
        const initialized = initializeUnitState(entity, sourceRef, this.initializeOptions);
        const instance = new CBTUnitInstance(
            request.instanceId,
            initialized.baselineRef,
            entity,
            initialized.baselineRef.ruleset,
            initialized.state,
            initialized.deployment.crewAssignment,
            await bindMekHeatRuntimeContext(
                entity,
                initialized.baselineRef.ruleset,
                this.initializeOptions.scenario,
            ),
            bindMekMechanicsContext(
                entity,
                initialized.baselineRef.ruleset,
                this.initializeOptions.scenario,
            ),
        );
        const deployment: SerializedDeploymentConfigurationV2 = Object.freeze({
            schemaVersion: MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION,
            values: initialized.deployment,
        });
        return new ReadyMekUnit(
            entity,
            sourceRef,
            instance,
            deployment,
            nativeSource,
        );
    }

    /**
     * Restores one validated persisted V2 snapshot into the same authoritative
     * ready-runtime wrapper used for fresh and legacy-restored Meks. The
     * tolerant V2 restorer owns baseline drift; no legacy projection is used.
     */
    public async restoreFromEntity(
        saved: SerializedCBTUnitV2,
        entity: MekEntity,
        sourceRef: SavedEntityIdentity,
        nativeSource?: NativeUnitSourceHandle,
    ): Promise<ReadyMekUnit> {
        saved = captureValue(saved);
        sourceRef = captureValue(sourceRef);
        if (sourceRef.provider !== saved.entity.provider
            || sourceRef.uuid !== saved.entity.uuid
            || sourceRef.uuid !== entity.uuid()) {
            throw new Error('Entity does not match the persisted V2 provider/UUID');
        }
        nativeSource = verifyNativeSource(sourceRef, nativeSource);
        const storedCrew = saved.deployment.values.crewAssignment;
        const crewAssignment = storedCrew.positions.length === 0
            ? createDefaultCrewAssignment(buildMekRuntimeIndex(entity).crewPositions)
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
        const initialized = initializeUnitState(entity, sourceRef, {
            ...this.initializeOptions,
            deployment: deploymentValues,
        });
        // The native Entity owns topology. Storage carries only stable target IDs;
        // rebuild the transient lookup table from the exact loaded source.
        const restored = await restoreSerializedCBTUnitV2({
            ...saved,
            blueprintReferences: buildSavedBlueprintReferenceTableV2(
                entity,
                initialized.baselineRef.ruleset,
            ),
        }, entity, initialized);
        const instance = new CBTUnitInstance(
            saved.instanceId,
            restored.baselineRef,
            entity,
            initialized.baselineRef.ruleset,
            restored.state,
            initialized.deployment.crewAssignment,
            await bindMekHeatRuntimeContext(
                entity,
                initialized.baselineRef.ruleset,
                this.initializeOptions.scenario,
            ),
            bindMekMechanicsContext(
                entity,
                initialized.baselineRef.ruleset,
                this.initializeOptions.scenario,
            ),
        );
        const deployment: SerializedDeploymentConfigurationV2 = Object.freeze({
            schemaVersion: MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION,
            values: initialized.deployment,
        });
        const restoration = saved.restoration !== undefined
            || restored.metadata.sourceChanged
            || restored.metadata.warnings.length > 0
            || restored.metadata.unresolved.length > 0
            || restored.metadata.acceptedAliases.length > 0
            || restored.metadata.ignoredRecovery !== undefined
            || restored.metadata.heatRecovery !== undefined
            ? restored.metadata
            : undefined;
        return new ReadyMekUnit(
            entity,
            sourceRef,
            instance,
            deployment,
            nativeSource,
            restoration,
        );
    }

}

function verifyNativeSource(
    identity: SavedEntityIdentity,
    source?: NativeUnitSourceHandle,
): NativeUnitSourceHandle | undefined {
    if (identity.sourceFormat === 'blk') {
        throw new Error('A Mek runtime requires an MTF source');
    }
    if (source === undefined) return undefined;
    if ((identity.sourceFormat !== undefined && source.format !== identity.sourceFormat)
        || (identity.sourceHashAtSave !== undefined && source.sourceHash !== identity.sourceHashAtSave)) {
        throw new Error('Retained MTF source does not match the entity identity');
    }
    return cloneNativeUnitSourceHandle(source);
}

function bindMekHeatRuntimeContext(
    entity: MekEntity,
    ruleset: CBTRuleset,
    scenario: ScenarioRules,
): MekHeatRuntimeContextV2 {
    return createMekHeatContextV2(
        entity,
        buildMekRuntimeIndex(entity),
        ruleset,
        runtimeScenario(scenario),
    );
}

function bindMekMechanicsContext(
    entity: MekEntity,
    ruleset: CBTRuleset,
    scenario: ScenarioRules,
): MekMechanicsContextV2 {
    return createMekMechanicsContextV2(
        entity,
        buildMekRuntimeIndex(entity),
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
