// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { UnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import type { CrewMemberRuntimeState } from '../crew-member.model';
import type { BaseEntity } from '../entity/base-entity';
import type { CrewPositionId } from '../entity/entity-identifiers';
import type { NativeUnitSourceHandle } from '../native-unit-source-handle';
import { CBTUnit,type CBTNonMekUnit } from './cbt-unit';

import type { CrewAssignment } from './crew-assignment';
import { canonicalizeCrewAssignment,createDefaultCrewAssignment } from './crew-assignment';
import { buildNonMekRuntimeIndex } from './non-mek-runtime-index';
import { createNonMekRuntimeBinding,createPristineNonMekUnitState } from './non-mek-unit-instance';
import { NON_MEK_DEPLOYMENT_SCHEMA_VERSION,restoreNonMekRuntime,type NonMekDeploymentConfiguration,type SerializedNonMekDeployment,type SerializedNonMekUnit } from './non-mek-unit-persistence';
import { scenarioRuleset,scenarioUsesForcedWithdrawal,type ScenarioRules } from './unit-state-initializer';

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

/** Prepares a new unit from immutable entity facts and deployment choices. */
export function createNonMekUnit(
    entity: BaseEntity, request: CreateCBTNonMekUnitRequest, nativeSource?: NativeUnitSourceHandle,
): CBTNonMekUnit {
    verifySource(entity, request.uuid, nativeSource);
    const index = buildNonMekRuntimeIndex(entity);
    const assigned = request.deployment.crewAssignment === undefined
        ? createDefaultCrewAssignment(index.crewPositions)
        : canonicalizeCrewAssignment(index.crewPositions, request.deployment.crewAssignment);
    const crewAssignment = request.crewSkills ? {
        schemaVersion: 1 as const,
        positions: assigned.positions.map(position => ({ ...position,
            gunnery: request.crewSkills!.gunnery, piloting: request.crewSkills!.piloting })),
    } : assigned;
    const ruleset = scenarioRuleset(request.scenario);
    const baselineRef = Object.freeze({
        entity: request.uuid, ruleset,
        initialStateProfile: Object.freeze({ schemaVersion: 1 as const, initializerRevision: 1,
            profileId: boundedText(request.initialStateProfileId, 'initial-state profile') }),
    });
    const prepared = createNonMekRuntimeBinding(entity, ruleset, createPristineNonMekUnitState(entity),
        scenarioUsesForcedWithdrawal(request.scenario), crewAssignment);
    const deployment = freezeDeployment({ schemaVersion: NON_MEK_DEPLOYMENT_SCHEMA_VERSION,
        values: { id: boundedText(request.deployment.id, 'deployment ID'), crewAssignment } });
    return new CBTUnit<'non-mek'>({ uuid: request.uuid, instanceId: request.instanceId, baselineRef,
        runtime: { kind: 'non-mek', binding: prepared.binding, state: prepared.state, deployment }, nativeSource });
}

export function restoreNonMekUnit(
    saved: SerializedNonMekUnit, entity: BaseEntity, uuid: UnitUuid, scenario: ScenarioRules,
    nativeSource?: NativeUnitSourceHandle,
): CBTNonMekUnit {
    verifySource(entity, uuid, nativeSource);
    if (saved.entity !== uuid) throw new Error('Persisted entity source does not match the loaded source');
    const prepared = restoreNonMekRuntime(saved, entity, scenarioRuleset(scenario),
        scenarioUsesForcedWithdrawal(scenario));
    return new CBTUnit<'non-mek'>({ uuid, instanceId: saved.instanceId, baselineRef: prepared.baselineRef,
        runtime: { kind: 'non-mek', binding: prepared.binding, state: prepared.state, deployment: freezeDeployment(saved.deployment) }, nativeSource });
}

/** Rebinds scenario mechanics while preserving sparse gameplay facts and session targeting. */
export function cloneNonMekForOwner(current: CBTNonMekUnit, scenario: ScenarioRules): CBTNonMekUnit {
    const candidate = restoreNonMekUnit(current.serialize(), current.getUnit(), current.uuid, scenario,
        current.getNativeSource());
    candidate.installAttackerTargetingSessionState(current.snapshot().attackerTargeting);
    return candidate;
}

export function repairNonMekUnit(current: CBTNonMekUnit): CBTNonMekUnit {
    const before = current.snapshot();
    if (before.stateRevision >= Number.MAX_SAFE_INTEGER) throw new Error('Unit revision is exhausted');
    const state = Object.freeze({ ...createPristineNonMekUnitState(current.getUnit()),
        stateRevision: before.stateRevision + 1, attackerTargeting: before.attackerTargeting,
        ...(before.equipmentRowOrder === undefined ? {} : { equipmentRowOrder: before.equipmentRowOrder }) });
    const prepared = createNonMekRuntimeBinding(current.getUnit(), current.ruleset(), state,
        current.mechanics().forcedWithdrawal, current.getCrewAssignment());
    return new CBTUnit<'non-mek'>({ uuid: current.uuid, instanceId: current.instanceId, baselineRef: current.baselineRef,
        runtime: { kind: 'non-mek', binding: prepared.binding, state: prepared.state, deployment: current.getDeployment() },
        nativeSource: current.getNativeSource() });
}

export function redeployNonMekCrew(
    current: CBTNonMekUnit, crewAssignment: CrewAssignment,
    crewState?: ReadonlyMap<CrewPositionId, CrewMemberRuntimeState>,
): CBTNonMekUnit {
    const assignment = canonicalizeCrewAssignment(current.getIndex().crewPositions, crewAssignment);
    const before = current.snapshot();
    const prepared = createNonMekRuntimeBinding(current.getUnit(), current.ruleset(),
        crewState === undefined ? before : { ...before, crew: crewState },
        current.mechanics().forcedWithdrawal, assignment);
    const deployment = freezeDeployment({ ...current.getDeployment(),
        values: { ...current.getDeployment().values, crewAssignment: assignment } });
    return new CBTUnit<'non-mek'>({ uuid: current.uuid, instanceId: current.instanceId, baselineRef: current.baselineRef,
        runtime: { kind: 'non-mek', binding: prepared.binding, state: prepared.state, deployment }, nativeSource: current.getNativeSource() });
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
