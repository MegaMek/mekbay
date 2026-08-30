// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../entity/base-entity';
import type { SavedEntityIdentity } from '../persisted-unit-state';
import type { NativeUnitSourceHandle } from '../native-unit-source-handle';
import { cloneNativeUnitSourceHandle } from '../native-unit-source-handle';
import type { StateRevision, UnitInstanceId } from './runtime-state';
import { asStateRevision } from './runtime-state';
import type { CrewAssignment } from './crew-assignment';
import {
    canonicalizeCrewAssignment,
    createDefaultCrewAssignment,
} from './crew-assignment';
import { buildNonMekRuntimeIndex, type NonMekRuntimeIndex } from './non-mek-runtime-index';
import {
    createPristineNonMekUnitState,
    NonMekUnitInstance,
} from './non-mek-unit-instance';
import {
    NON_MEK_DEPLOYMENT_SCHEMA_VERSION,
    canonicalizeNonMekUnitRestoration,
    restoreNonMekUnit,
    serializeNonMekUnit,
    type NonMekDeploymentConfiguration,
    type SerializedNonMekDeployment,
    type SerializedNonMekUnit,
    type SerializedNonMekUnitRestoration,
} from './non-mek-unit-persistence';
import { scenarioRuleset, type ScenarioRules } from './unit-state-initializer';
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
import type {
    CBTUnitAttackerTargetingCommand,
    CBTUnitSelectedWeaponFireCommand,
} from './unit-instance';

export interface NonMekUnitDeploymentInput {
    readonly id: string;
    readonly crewAssignment?: CrewAssignment;
}

export interface CreateReadyNonMekUnitRequest {
    readonly instanceId: UnitInstanceId;
    readonly identity: SavedEntityIdentity;
    readonly deployment: NonMekUnitDeploymentInput;
    readonly scenario: ScenarioRules;
    readonly initialStateProfileId: string;
}

/** Ready ownership aggregate for one non-Mek BaseEntity plus its direct sparse runtime. */
export class ReadyNonMekUnit implements ReadyClassicUnit {
    public readonly instanceId: UnitInstanceId;

    public constructor(
        private readonly entity: BaseEntity,
        private readonly sourceRef: SavedEntityIdentity,
        private readonly runtime: NonMekUnitInstance,
        private readonly deployment: SerializedNonMekDeployment,
        private readonly nativeSource?: NativeUnitSourceHandle,
        private readonly restoration?: SerializedNonMekUnitRestoration,
    ) {
        if (entity.entityType === 'Mek') throw new Error('ReadyNonMekUnit accepts non-Mek entities only');
        if (sourceRef.uuid !== entity.uuid() || !runtime.matchesEntity(entity)) {
            throw new Error('Ready entity identity does not match its runtime');
        }
        this.instanceId = runtime.id;
        this.sourceRef = Object.freeze({ ...sourceRef });
        this.deployment = freezeDeployment(deployment);
        this.nativeSource = nativeSource === undefined
            ? undefined
            : cloneNativeUnitSourceHandle(nativeSource);
        this.restoration = restoration === undefined
            ? undefined
            : canonicalizeNonMekUnitRestoration(restoration);
        Object.freeze(this);
    }

    public getUnit(): BaseEntity {
        return this.entity;
    }

    public getInstance(): NonMekUnitInstance {
        return this.runtime;
    }

    public getIndex(): NonMekRuntimeIndex {
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
        const plan = this.runtime.planAttackerTargetingReconciliation(registry);
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
                currentRevision: result.state.stateRevision,
            })
            : Object.freeze({
                accepted: false,
                reason: result.reason === 'STALE_REVISION'
                    ? 'REVISION_CONFLICT'
                    : result.reason === 'FORCE_READ_ONLY'
                        ? 'FORCE_READ_ONLY'
                        : 'INVALID_ORDER',
                currentRevision: result.state.stateRevision,
            });
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
                idempotent: !result.changed,
                currentRevision: result.state.stateRevision,
                prototypeHeat: result.prototypeHeat,
            })
            : Object.freeze({
                accepted: false,
                reason: result.reason,
                currentRevision: result.state.stateRevision,
            });
    }

    public dispatchAttackerTargeting(
        command: CBTUnitAttackerTargetingCommand,
        registry: TargetRegistrySnapshot,
        forceReadOnly: boolean,
    ): ReadyAttackerTargetingResult {
        const result = this.runtime.dispatchAttackerTargeting({
            kind: 'edit-attacker-targeting',
            expectedRevision: command.expectedRevision,
            expectedRegistryRevision: command.expectedRegistryRevision,
            edit: command.edit,
        }, registry, forceReadOnly);
        return result.accepted
            ? Object.freeze({
                accepted: true,
                idempotent: !result.changed,
                currentRevision: result.state.stateRevision,
            })
            : Object.freeze({
                accepted: false,
                reason: result.reason === 'STALE_REVISION'
                    ? 'REVISION_CONFLICT'
                    : result.reason === 'STALE_TARGET_REGISTRY'
                        ? 'STALE_TARGET_REGISTRY'
                        : result.reason === 'FORCE_READ_ONLY'
                            ? 'FORCE_READ_ONLY'
                            : 'INVALID_TARGETING',
                currentRevision: result.state.stateRevision,
            });
    }

    public endTurn(): ReadyEndTurnResult {
        const result = this.runtime.dispatch({
            kind: 'end-turn',
            expectedRevision: this.runtime.revision(),
        });
        return result.accepted
            ? Object.freeze({ accepted: true })
            : Object.freeze({ accepted: false, reason: result.reason });
    }

    public getSourceRef(): SavedEntityIdentity {
        return this.sourceRef;
    }

    public getCrewAssignment(): CrewAssignment {
        return this.deployment.values.crewAssignment;
    }

    public getNativeSource(): NativeUnitSourceHandle | undefined {
        return this.nativeSource === undefined
            ? undefined
            : cloneNativeUnitSourceHandle(this.nativeSource);
    }

    public matchesEntity(entity: BaseEntity): boolean {
        return entity === this.entity;
    }

    public serialize(): SerializedNonMekUnit {
        return serializeNonMekUnit({
            instance: this.runtime,
            sourceRef: this.sourceRef,
            deployment: this.deployment,
            ...(this.restoration === undefined ? {} : { restoration: this.restoration }),
        });
    }

    public static create(
        entity: BaseEntity,
        request: CreateReadyNonMekUnitRequest,
        nativeSource?: NativeUnitSourceHandle,
    ): ReadyNonMekUnit {
        verifySource(entity, request.identity, nativeSource);
        const index = buildNonMekRuntimeIndex(entity);
        const crewAssignment = request.deployment.crewAssignment === undefined
            ? createDefaultCrewAssignment(index.crewPositions)
            : canonicalizeCrewAssignment(index.crewPositions, request.deployment.crewAssignment);
        const ruleset = scenarioRuleset(request.scenario);
        const baseline = Object.freeze({
            entity: Object.freeze({ ...request.identity }),
            ruleset,
            initialStateProfile: Object.freeze({
                schemaVersion: 1 as const,
                initializerRevision: 1,
                profileId: boundedText(request.initialStateProfileId, 'initial-state profile'),
            }),
        });
        const runtime = new NonMekUnitInstance(
            request.instanceId,
            baseline,
            entity,
            ruleset,
            createPristineNonMekUnitState(entity),
        );
        const deployment = freezeDeployment({
            schemaVersion: NON_MEK_DEPLOYMENT_SCHEMA_VERSION,
            values: Object.freeze({
                id: boundedText(request.deployment.id, 'deployment ID'),
                crewAssignment,
            }),
        });
        return new ReadyNonMekUnit(entity, request.identity, runtime, deployment, nativeSource);
    }

    public static restore(
        saved: SerializedNonMekUnit,
        entity: BaseEntity,
        sourceRef: SavedEntityIdentity,
        nativeSource?: NativeUnitSourceHandle,
    ): ReadyNonMekUnit {
        verifySource(entity, sourceRef, nativeSource);
        if (saved.entity.provider !== sourceRef.provider || saved.entity.uuid !== sourceRef.uuid) {
            throw new Error('Persisted entity source does not match the loaded source');
        }
        const storedCrew = saved.deployment.values.crewAssignment;
        if (storedCrew.positions.length === 0) {
            const crewAssignment = createDefaultCrewAssignment(buildNonMekRuntimeIndex(entity).crewPositions);
            if (crewAssignment.positions.length > 0) {
                saved = Object.freeze({
                    ...saved,
                    deployment: Object.freeze({
                        ...saved.deployment,
                        values: Object.freeze({ ...saved.deployment.values, crewAssignment }),
                    }),
                });
            }
        }
        const runtime = restoreNonMekUnit(saved, entity);
        return new ReadyNonMekUnit(
            entity,
            sourceRef,
            runtime,
            saved.deployment,
            nativeSource,
            saved.restoration,
        );
    }

    public static repair(current: ReadyNonMekUnit): ReadyNonMekUnit {
        const runtime = current.getInstance();
        const currentState = runtime.snapshot();
        const revision = runtime.revision();
        if (revision >= Number.MAX_SAFE_INTEGER) throw new Error('Unit revision is exhausted');
        const state = Object.freeze({
            ...createPristineNonMekUnitState(current.getUnit()),
            stateRevision: asStateRevision(revision + 1),
            ...(currentState.equipmentRowOrder === undefined
                ? {}
                : { equipmentRowOrder: currentState.equipmentRowOrder }),
        });
        const replacement = new NonMekUnitInstance(
            current.instanceId,
            runtime.baselineRef,
            current.getUnit(),
            runtime.ruleset,
            state,
        );
        return new ReadyNonMekUnit(
            current.getUnit(),
            current.getSourceRef(),
            replacement,
            current.deployment,
            current.getNativeSource(),
            current.restoration,
        );
    }

    public static redeploy(
        current: ReadyNonMekUnit,
        crewAssignment: CrewAssignment,
    ): ReadyNonMekUnit {
        const assignment = canonicalizeCrewAssignment(
            current.getIndex().crewPositions,
            crewAssignment,
        );
        return new ReadyNonMekUnit(
            current.entity,
            current.sourceRef,
            current.runtime,
            {
                ...current.deployment,
                values: Object.freeze({
                    ...current.deployment.values,
                    crewAssignment: assignment,
                }),
            },
            current.nativeSource,
            current.restoration,
        );
    }
}

function verifySource(
    entity: BaseEntity,
    identity: SavedEntityIdentity,
    source?: NativeUnitSourceHandle,
): void {
    if (entity.entityType === 'Mek') throw new Error('Non-Mek readiness requires a BLK entity');
    if (entity.uuid() !== identity.uuid) throw new Error('Entity UUID does not match its source identity');
    if (identity.sourceFormat !== undefined && identity.sourceFormat !== 'blk') {
        throw new Error('Non-Mek runtime requires a BLK source');
    }
    if (source !== undefined && (source.format !== 'blk'
        || (identity.sourceHashAtSave !== undefined && source.sourceHash !== identity.sourceHashAtSave))) {
        throw new Error('Retained BLK source does not match the entity identity');
    }
}

function freezeDeployment(value: SerializedNonMekDeployment): SerializedNonMekDeployment {
    const assignment = Object.freeze({
        ...value.values.crewAssignment,
        positions: Object.freeze(value.values.crewAssignment.positions.map(position =>
            Object.freeze({ ...position }))),
    });
    const values: NonMekDeploymentConfiguration = Object.freeze({
        id: boundedText(value.values.id, 'deployment ID'),
        crewAssignment: assignment,
    });
    return Object.freeze({ schemaVersion: NON_MEK_DEPLOYMENT_SCHEMA_VERSION, values });
}

function boundedText(value: string, label: string): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 256 || value.includes('\0')) {
        throw new Error(`Invalid ${label}`);
    }
    return value;
}
