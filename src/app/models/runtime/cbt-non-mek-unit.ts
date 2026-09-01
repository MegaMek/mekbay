// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../entity/base-entity';
import { effectiveEntityPilotingSkill } from '../entity/utils/battle-value/skill-facts';
import type { NativeUnitSourceHandle } from '../native-unit-source-handle';
import type { UnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { cloneNativeUnitSourceHandle } from '../native-unit-source-handle';
import type { CrewAssignment } from './crew-assignment';
import { canonicalizeCrewAssignment, createDefaultCrewAssignment } from './crew-assignment';
import { buildNonMekRuntimeIndex, type NonMekRuntimeIndex } from './non-mek-runtime-index';
import { createPristineNonMekUnitState, NonMekUnitInstance } from './non-mek-unit-instance';
import {
    NON_MEK_DEPLOYMENT_SCHEMA_VERSION,
    restoreNonMekUnit,
    serializeNonMekUnit,
    type NonMekDeploymentConfiguration,
    type SerializedNonMekDeployment,
    type SerializedNonMekUnit,
} from './non-mek-unit-persistence';
import { scenarioRuleset, type ScenarioRules } from './unit-state-initializer';
import { captureCBTUnitRuntime, type CBTUnitRuntimeReadModel } from './cbt-unit-runtime';
import type { TargetRegistrySnapshot } from './encounter-runtime';
import type {
    CBTSelectedWeaponFireResult,
    CBTTargetingReconciliation,
    CBTUnit,
    CBTUnitDispatchResult,
} from './cbt-unit';
import type { EquipmentRowOrderGroup } from './equipment-row-order';
import type { CBTUnitAttackerTargetingCommand, CBTUnitSelectedWeaponFireCommand } from './unit-instance';

export interface NonMekUnitDeploymentInput {
    readonly id: string;
    readonly crewAssignment?: CrewAssignment;
}

export interface CreateCBTNonMekUnitRequest {
    readonly instanceId: string;
    readonly uuid: UnitUuid;
    readonly deployment: NonMekUnitDeploymentInput;
    readonly scenario: ScenarioRules;
    readonly initialStateProfileId: string;
    readonly crewSkills?: Readonly<{ readonly gunnery: number; readonly piloting: number }>;
}

/** Ready ownership aggregate for one non-Mek BaseEntity plus its direct sparse runtime. */
export class CBTNonMekUnit implements CBTUnit {
    public readonly instanceId: string;

    public constructor(
        private readonly entity: BaseEntity,
        public readonly uuid: UnitUuid,
        private readonly runtime: NonMekUnitInstance,
        private readonly deployment: SerializedNonMekDeployment,
        private readonly nativeSource?: NativeUnitSourceHandle,
    ) {
        if (entity.entityType === 'Mek') throw new Error('CBTNonMekUnit accepts non-Mek entities only');
        if (uuid !== entity.uuid() || !runtime.matchesEntity(entity)) {
            throw new Error('Ready entity identity does not match its runtime');
        }
        this.instanceId = runtime.id;
        this.deployment = freezeDeployment(deployment);
        this.nativeSource = nativeSource === undefined
            ? undefined
            : cloneNativeUnitSourceHandle(nativeSource);
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

    public captureRuntime(): CBTUnitRuntimeReadModel {
        return captureCBTUnitRuntime(this.runtime);
    }

    public planTargetingReconciliation(
        registry: TargetRegistrySnapshot,
    ): CBTTargetingReconciliation | null {
        const plan = this.runtime.planAttackerTargetingReconciliation(registry);
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
        return this.runtime.dispatchSelectedWeaponFire(
            command,
            registry,
            forceReadOnly,
            c3Available,
        );
    }

    public dispatchAttackerTargeting(
        command: CBTUnitAttackerTargetingCommand,
        registry: TargetRegistrySnapshot,
        forceReadOnly: boolean,
    ): CBTUnitDispatchResult {
        return this.runtime.dispatchAttackerTargeting({
            kind: 'edit-attacker-targeting',
            edit: command.edit,
        }, registry, forceReadOnly);
    }

    public endTurn(): CBTUnitDispatchResult {
        return this.runtime.dispatch({
            kind: 'end-turn',
        });
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
            uuid: this.uuid,
            sourceHashCanary: this.nativeSource?.sourceHashCanary,
            deployment: this.deployment,
        });
    }

    public static create(
        entity: BaseEntity,
        request: CreateCBTNonMekUnitRequest,
        nativeSource?: NativeUnitSourceHandle,
    ): CBTNonMekUnit {
        verifySource(entity, request.uuid, nativeSource);
        const index = buildNonMekRuntimeIndex(entity);
        const crewAssignment = request.crewSkills
            ? {
                schemaVersion: 1 as const,
                positions: createDefaultCrewAssignment(index.crewPositions).positions.map(position => ({
                    ...position,
                    gunnery: request.crewSkills!.gunnery,
                    piloting: effectiveEntityPilotingSkill(entity, request.crewSkills!.piloting),
                })),
            }
            : request.deployment.crewAssignment === undefined
                ? createDefaultCrewAssignment(index.crewPositions)
            : canonicalizeCrewAssignment(index.crewPositions, request.deployment.crewAssignment);
        const ruleset = scenarioRuleset(request.scenario);
        const baseline = Object.freeze({
            entity: request.uuid,
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
        return new CBTNonMekUnit(entity, request.uuid, runtime, deployment, nativeSource);
    }

    public static restore(
        saved: SerializedNonMekUnit,
        entity: BaseEntity,
        uuid: UnitUuid,
        nativeSource?: NativeUnitSourceHandle,
    ): CBTNonMekUnit {
        verifySource(entity, uuid, nativeSource);
        if (saved.entity !== uuid) {
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
        return new CBTNonMekUnit(
            entity,
            uuid,
            runtime,
            saved.deployment,
            nativeSource,
        );
    }

    public static repair(current: CBTNonMekUnit): CBTNonMekUnit {
        const runtime = current.getInstance();
        const currentState = runtime.snapshot();
        const revision = runtime.revision();
        if (revision >= Number.MAX_SAFE_INTEGER) throw new Error('Unit revision is exhausted');
        const state = Object.freeze({
            ...createPristineNonMekUnitState(current.getUnit()),
            stateRevision: revision + 1,
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
        return new CBTNonMekUnit(
            current.getUnit(),
            current.uuid,
            replacement,
            current.deployment,
            current.getNativeSource(),
        );
    }

    public static redeploy(
        current: CBTNonMekUnit,
        crewAssignment: CrewAssignment,
    ): CBTNonMekUnit {
        const assignment = canonicalizeCrewAssignment(
            current.getIndex().crewPositions,
            crewAssignment,
        );
        return new CBTNonMekUnit(
            current.entity,
            current.uuid,
            current.runtime,
            {
                ...current.deployment,
                values: Object.freeze({
                    ...current.deployment.values,
                    crewAssignment: assignment,
                }),
            },
            current.nativeSource,
        );
    }
}

function verifySource(
    entity: BaseEntity,
    uuid: UnitUuid,
    source?: NativeUnitSourceHandle,
): void {
    if (entity.entityType === 'Mek') throw new Error('Non-Mek readiness requires a BLK entity');
    if (entity.uuid() !== uuid) throw new Error('Entity UUID does not match its source identity');
    if (source !== undefined && source.format !== 'blk') throw new Error('Non-Mek runtime requires a BLK source');
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
