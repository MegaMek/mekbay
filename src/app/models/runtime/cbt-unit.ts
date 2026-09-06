// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { HeatAutomationPolicy } from './cbt-unit-runtime';
import type { CBTUnitAttackerTargetingCommand,CBTUnitSelectedWeaponFireCommand } from './unit-command';

import type { UnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type { BaseEntity } from '../entity/base-entity';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import { cloneNativeUnitSourceHandle,type NativeUnitSourceHandle } from '../native-unit-source-handle';
import type { PrototypeLaserHeatResult } from '../prototype-laser-heat.model';
import type { AttackerTargetingState } from './attacker-targeting-state';
import type { CBTUnitCommandResult,CBTUnitQueryPort,CBTUnitRuntimeReadModel,CBTUnitRuntimeState } from './cbt-unit-runtime';
import { assignedCrewRuntimeState,canonicalizeCrewAssignment,type CrewAssignment } from './crew-assignment';
import type { TargetRegistrySnapshot } from './encounter-runtime';
import { setEquipmentRowOrder,type EquipmentRowOrderGroup } from './equipment-row-order';
import type { MekRuntimeIndex } from './mek-runtime-index';
import type { NonMekRuntimeIndex } from './non-mek-runtime-index';
import { serializeNonMekUnit,type SerializedNonMekDeployment,type SerializedNonMekUnit } from './non-mek-unit-persistence';
import type { SerializedCBTUnitV2,SerializedDeploymentConfigurationV2 } from './persistence-v2';
import { freezeRuntimeState,type InstanceBaselineRef,type MekUnitRuntimeState } from './runtime-state';
import { serializeCBTUnitStateV2 } from './runtime-state-codec-v2';
import type { CBTUnitCommand } from './unit-command';

import {
freezeNonMekUnitState,
planNonMekAttackerTargetingReconciliation,
queryNonMekRuntime,
reduceNonMekAttackerTargeting,
reduceNonMekRuntime,
reduceNonMekSelectedWeaponFire,
type NonMekRuntimeBinding,type NonMekUnitRuntimeState,
} from './non-mek-unit-instance';
import { planMekAttackerTargetingReconciliation,queryMekRuntime,reduceMekAttackerTargeting,reduceMekRuntime,reduceMekSelectedWeaponFire,type MekRuntimeBinding,type MekUnitQueryPort } from './unit-instance';

export type CBTUnitFamily = 'mek' | 'non-mek';
export type CBTUnitStateFor<F extends CBTUnitFamily> = F extends 'mek' ? MekUnitRuntimeState : NonMekUnitRuntimeState;
type UnitQueryFor<F extends CBTUnitFamily> = F extends 'mek' ? MekUnitQueryPort : CBTUnitQueryPort;
type UnitIndexFor<F extends CBTUnitFamily> = F extends 'mek' ? MekRuntimeIndex : NonMekRuntimeIndex;
type UnitEntityFor<F extends CBTUnitFamily> = F extends 'mek' ? MekEntity : BaseEntity;
type UnitDeploymentFor<F extends CBTUnitFamily> = F extends 'mek' ? SerializedDeploymentConfigurationV2 : SerializedNonMekDeployment;
type UnitSerializedFor<F extends CBTUnitFamily> = F extends 'mek' ? SerializedCBTUnitV2 : SerializedNonMekUnit;
type UnitMechanicsFor<F extends CBTUnitFamily> = F extends 'mek' ? MekRuntimeBinding : NonMekRuntimeBinding;
type MekBoundRuntime = Readonly<{ kind: 'mek'; binding: MekRuntimeBinding; state: MekUnitRuntimeState; deployment: SerializedDeploymentConfigurationV2 }>;
type NonMekBoundRuntime = Readonly<{ kind: 'non-mek'; binding: NonMekRuntimeBinding; state: NonMekUnitRuntimeState; deployment: SerializedNonMekDeployment }>;
type BoundRuntime = MekBoundRuntime | NonMekBoundRuntime;

export interface CBTUnitInitialization<F extends CBTUnitFamily> {
    readonly uuid: UnitUuid;
    readonly instanceId: string;
    readonly baselineRef: InstanceBaselineRef;
    readonly runtime: F extends 'mek' ? MekBoundRuntime : NonMekBoundRuntime;
    readonly nativeSource?: NativeUnitSourceHandle;
}
export type CBTTargetingReconciliation = () => void;
export type CBTUnitDispatchResult = CBTUnitCommandResult<CBTUnitRuntimeState>;
export type CBTSelectedWeaponFireResult = Readonly<CBTUnitDispatchResult & { readonly prototypeHeat: readonly PrototypeLaserHeatResult[] }>;
type OwnerResult<F extends CBTUnitFamily> = Readonly<CBTUnitCommandResult<CBTUnitStateFor<F>> & { readonly prototypeHeat?: readonly PrototypeLaserHeatResult[] }>;

/** The single mutable unit owner. Family modules calculate immutable results and own no runtime. */
export class CBTUnit<F extends CBTUnitFamily = CBTUnitFamily> {
    readonly family: F;
    readonly instanceId: string;
    readonly uuid: UnitUuid;
    readonly baselineRef: InstanceBaselineRef;
    readonly #nativeSource: NativeUnitSourceHandle | undefined;
    #runtime: BoundRuntime;
    #queryCache: Readonly<{ state: CBTUnitRuntimeState; query: CBTUnitQueryPort }> | undefined;

    constructor(input: CBTUnitInitialization<F>) {
        const runtime = input.runtime;
        const index = runtime.kind === 'mek' ? runtime.binding.source.index : runtime.binding.index;
        const crewAssignment = canonicalizeCrewAssignment(index.crewPositions,
            runtime.kind === 'mek' ? runtime.binding.source.crewAssignment : runtime.binding.crewAssignment);
        const deploymentCrew = canonicalizeCrewAssignment(index.crewPositions,
            runtime.deployment.values.crewAssignment);
        this.family = runtime.kind as F;
        this.#runtime = runtime.kind === 'mek' ? {
            ...runtime,
            binding: Object.freeze({ ...runtime.binding,
                source: Object.freeze({ ...runtime.binding.source, crewAssignment }) }),
            deployment: captureDeployment(runtime.deployment, deploymentCrew),
        } : {
            ...runtime,
            binding: Object.freeze({ ...runtime.binding, crewAssignment }),
            deployment: captureDeployment(runtime.deployment, deploymentCrew),
        };
        this.instanceId = input.instanceId;
        this.uuid = input.uuid;
        this.baselineRef = Object.freeze({ ...input.baselineRef,
            initialStateProfile: Object.freeze({ ...input.baselineRef.initialStateProfile }) });
        const entity = this.getUnit();
        if (input.uuid !== entity.uuid() || input.baselineRef.entity !== input.uuid
            || input.baselineRef.ruleset !== this.ruleset()
            || (input.runtime.kind === 'mek') !== (entity.entityType === 'Mek')) {
            throw new Error('Unit identity, mechanics and runtime baseline do not match');
        }
        this.installState(runtime.state);
        this.#nativeSource = input.nativeSource === undefined ? undefined : cloneNativeUnitSourceHandle(input.nativeSource);
        Object.freeze(this);
    }

    getUnit(): UnitEntityFor<F> {
        const runtime = this.#runtime;
        return (runtime.kind === 'mek' ? runtime.binding.source.entity : runtime.binding.entity) as UnitEntityFor<F>;
    }
    getIndex(): UnitIndexFor<F> {
        const runtime = this.#runtime;
        return (runtime.kind === 'mek' ? runtime.binding.source.index : runtime.binding.index) as UnitIndexFor<F>;
    }
    getDeployment(): UnitDeploymentFor<F> { return this.#runtime.deployment as UnitDeploymentFor<F>; }
    mechanics(): UnitMechanicsFor<F> { return this.#runtime.binding as UnitMechanicsFor<F>; }
    getCrewAssignment(): CrewAssignment {
        const runtime = this.#runtime;
        return runtime.kind === 'mek' ? runtime.binding.source.crewAssignment : runtime.binding.crewAssignment;
    }
    getNativeSource(): NativeUnitSourceHandle | undefined {
        return this.#nativeSource === undefined ? undefined : cloneNativeUnitSourceHandle(this.#nativeSource);
    }
    matchesEntity(entity: BaseEntity): boolean { return entity === this.getUnit(); }
    ruleset(): CBTRuleset {
        const runtime = this.#runtime;
        return runtime.kind === 'mek' ? runtime.binding.source.ruleset : runtime.binding.ruleset;
    }
    revision(): number { return this.#runtime.state.stateRevision; }
    snapshot(): CBTUnitStateFor<F> { return this.#runtime.state as CBTUnitStateFor<F>; }
    query(): UnitQueryFor<F> {
        const runtime = this.#runtime;
        if (this.#queryCache?.state === runtime.state) return this.#queryCache.query as UnitQueryFor<F>;
        const query = runtime.kind === 'mek' ? queryMekRuntime(runtime.binding, runtime.state)
            : queryNonMekRuntime(runtime.binding, runtime.state);
        this.#queryCache = Object.freeze({ state: runtime.state, query });
        return query as UnitQueryFor<F>;
    }
    captureRuntime(): CBTUnitRuntimeReadModel {
        return Object.freeze({ index: this.getIndex(), state: this.snapshot(), query: this.query() });
    }
    dispatch(command: CBTUnitCommand): OwnerResult<F> {
        const runtime = this.#runtime;
        const result = runtime.kind === 'mek' ? reduceMekRuntime(runtime.binding, runtime.state, command)
            : reduceNonMekRuntime(runtime.binding, runtime.state, command);
        return this.installResult(result);
    }
    endTurn(policy: HeatAutomationPolicy = 'automatic'): OwnerResult<F> {
        return this.dispatch({ type: 'end-turn', policy });
    }
    dispatchAttackerTargeting(command: CBTUnitAttackerTargetingCommand, registry: TargetRegistrySnapshot,
        forceReadOnly: boolean): OwnerResult<F> {
        const runtime = this.#runtime;
        const result = runtime.kind === 'mek'
            ? reduceMekAttackerTargeting(runtime.binding, runtime.state, command, registry, forceReadOnly)
            : reduceNonMekAttackerTargeting(runtime.binding, runtime.state, command, registry, forceReadOnly);
        return this.installResult(result);
    }
    dispatchSelectedWeaponFire(command: CBTUnitSelectedWeaponFireCommand, registry: TargetRegistrySnapshot,
        forceReadOnly: boolean, c3Available: boolean): OwnerResult<F> & { readonly prototypeHeat: readonly PrototypeLaserHeatResult[] } {
        const runtime = this.#runtime;
        const result = runtime.kind === 'mek'
            ? reduceMekSelectedWeaponFire(runtime.binding, runtime.state, command, registry, forceReadOnly, c3Available)
            : reduceNonMekSelectedWeaponFire(runtime.binding, runtime.state, command, registry, forceReadOnly, c3Available);
        return Object.freeze({ ...this.installResult(result), prototypeHeat: result.prototypeHeat ?? Object.freeze([]) });
    }
    planTargetingReconciliation(registry: TargetRegistrySnapshot): CBTTargetingReconciliation | null {
        const runtime = this.#runtime;
        const plan = runtime.kind === 'mek' ? planMekAttackerTargetingReconciliation(runtime.binding, runtime.state, registry)
            : planNonMekAttackerTargetingReconciliation(runtime.binding, runtime.state, registry);
        return plan === null ? null : () => {
            if (this.#runtime.state !== runtime.state) throw new Error('Runtime changed before targeting reconciliation');
            this.installAttackerTargetingSessionState(plan.nextTargeting);
        };
    }
    /** Session targeting deliberately does not advance the durable combat revision. */
    installAttackerTargetingSessionState(targeting: AttackerTargetingState): void {
        this.installState({ ...this.#runtime.state, attackerTargeting: targeting });
    }
    setEquipmentRowOrder(group: EquipmentRowOrderGroup, permutation: readonly number[], rowCount: number,
        forceReadOnly: boolean): OwnerResult<F> {
        const state = this.#runtime.state;
        if (forceReadOnly) return this.installResult({ accepted: false, changed: false, state });
        try {
            const equipmentRowOrder = setEquipmentRowOrder(state.equipmentRowOrder, group, permutation, rowCount);
            if (equipmentRowOrder === state.equipmentRowOrder || state.stateRevision >= Number.MAX_SAFE_INTEGER) {
                return this.installResult({ accepted: true, changed: false, state });
            }
            const { equipmentRowOrder: _previous, ...facts } = state;
            return this.installResult({ accepted: true, changed: true, state: {
                ...facts, stateRevision: state.stateRevision + 1,
                ...(equipmentRowOrder === undefined ? {} : { equipmentRowOrder }),
            } });
        } catch {
            return this.installResult({ accepted: true, changed: false, state });
        }
    }
    serialize(): UnitSerializedFor<F> {
        const runtime = this.#runtime;
        const shared = { instanceId: this.instanceId, sourceHashCanary: this.#nativeSource?.sourceHashCanary,
            baselineRef: this.baselineRef };
        const saved = runtime.kind === 'mek' ? serializeCBTUnitStateV2({ ...shared,
            entity: runtime.binding.source.entity, index: runtime.binding.source.index,
            state: runtime.state, deployment: runtime.deployment,
        }) : serializeNonMekUnit({ ...shared, uuid: this.uuid, entity: runtime.binding.entity,
            index: runtime.binding.index, state: runtime.state, deployment: runtime.deployment });
        return saved as UnitSerializedFor<F>;
    }
    private installResult(result: CBTUnitCommandResult<CBTUnitRuntimeState> & { readonly prototypeHeat?: readonly PrototypeLaserHeatResult[] }): OwnerResult<F> {
        if (result.accepted && result.changed) this.installState(result.state);
        return Object.freeze({ ...result, state: this.snapshot() });
    }
    private installState(state: CBTUnitRuntimeState): void {
        const runtime = this.#runtime;
        const crew = assignedCrewRuntimeState(state.crew, this.getCrewAssignment());
        const next = crew === state.crew ? state : { ...state, crew };
        if (runtime.kind === 'mek') {
            if (!('slots' in next)) throw new Error('Slot mechanics returned an incompatible snapshot');
            this.#runtime = { ...runtime, state: freezeRuntimeState(next as MekUnitRuntimeState) };
        } else {
            if (!('damageTracks' in next)) throw new Error('System mechanics returned an incompatible snapshot');
            this.#runtime = { ...runtime, state: freezeNonMekUnitState(next as NonMekUnitRuntimeState) };
        }
    }
}

function captureDeployment<T extends { readonly values: { readonly crewAssignment: CrewAssignment } }>(
    deployment: T, crewAssignment: CrewAssignment,
): T {
    return Object.freeze({ ...deployment, values: Object.freeze({ ...deployment.values, crewAssignment }) });
}

export type CBTMekUnit = CBTUnit<'mek'>;
export type CBTNonMekUnit = CBTUnit<'non-mek'>;
export function isCBTMekUnit(unit: CBTUnit): unit is CBTMekUnit { return unit.getUnit().entityType === 'Mek'; }
export function isCBTNonMekUnit(unit: CBTUnit): unit is CBTNonMekUnit { return unit.getUnit().entityType !== 'Mek'; }
