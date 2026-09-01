// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    CBTEncounterRuntime,
    decodeCBTEncounterStateV2,
    type EncounterNetwork,
    type TargetRegistrySnapshot,
} from './runtime/encounter-runtime';
import {
    CBT_FORCE_MINIMUM_WRITER_VERSION,
    CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
    emptyRuntimeHistory,
    validateSerializedCBTForceV2,
    type SerializedCBTForceV2,
    type SerializedCBTUnitV2,
} from './runtime/persistence-v2';
import {
    asUnitInstanceId,
    type MekUnitRuntimeState,
    type StateRevision,
    type UnitInstanceId,
} from './runtime/runtime-state';
import { ReadyMekUnitService } from '../services/ready-mek-unit.service';
import { ReadyNonMekUnitService } from '../services/ready-non-mek-unit.service';
import { ReadyMekUnitFactory, type ReadyMekUnit } from './runtime/ready-unit-factory';
import {
    isReadyNonMekUnit,
    isReadyMekUnit,
    type ReadyTargetingReconciliation,
    type ReadyClassicUnit,
} from './runtime/ready-classic-unit';
import { ReadyNonMekUnit } from './runtime/ready-non-mek-unit';
import {
    isSerializedNonMekUnit,
    type SerializedNonMekUnit,
} from './runtime/non-mek-unit-persistence';
import { jsonValuesEqual } from '../utils/json-value.util';
import type { UnitConditionKey } from './unit-condition.model';
import type { ScenarioRules } from './runtime/unit-state-initializer';
import {
    DEFAULT_FORCE_DEPLOYMENT_ID,
    scenarioRuleset,
} from './runtime/unit-state-initializer';
import type { CBTRuleset } from './cbt-ruleset.model';
import {
    canonicalizeCrewAssignment,
    CREW_ASSIGNMENT_SCHEMA_VERSION,
    type CrewAssignment,
    type CrewAssignmentPosition,
} from './runtime/crew-assignment';
import type { ComponentId } from './entity/entity-identifiers';
import type { MekEntity } from './entity/entities/mek/mek-entity';
import type {
    NonMekUnitCommand,
} from './runtime/non-mek-unit-instance';
import type {
    CBTUnitAttackerTargetingCommand,
    CBTUnitCommand,
    CBTUnitSelectedWeaponFireCommand,
} from './runtime/unit-instance';
import { evaluateMekRuntimeCapability } from './runtime/mek-runtime-capability';
import { readyUnitMatchesEntity } from './runtime/cbt-ready-unit-validation';
import { canPerformMekAction } from './runtime/mek-action-availability';
import type {
    EquipmentInteractionRegistry,
    HandlerCommandContext,
    HandlerQueryContext,
} from '../services/equipment-interaction-registry.service';
import { ToastService } from '../services/toast.service';
import {
    MAX_MEK_HEAT_VALUE_V2,
    type MekHeatAutomationPolicyV2,
} from './runtime/mek-heat-state-v2';
import {
    currentUnitBaseBattleValue,
    pristineUnitBattleValue,
} from './cbt-force-battle-value';
import type { CBTUnitSnapshot } from './cbt-unit-snapshot';
import type { EquipmentRowOrderGroup } from './runtime/equipment-row-order';
import type { RuntimeCommandCheckpoint } from './runtime/runtime-command-session';
import {
    deploymentFromPersistence,
    scenarioRulesFromPersistence,
} from './runtime/cbt-force-scenario';
import { sameReadyUnitGameplayState } from './runtime/cbt-force-runtime-history';
import type {
    AttackerTargetingCommandResult,
    AttackerTargetingSnapshot,
    CBTNonMekUnitCommandResult,
    CBTForceEndTurnAllResult,
    CBTForceEndTurnUnitResult,
    CBTMekUnitCommandResult,
    C3State,
    EquipmentRowOrderCommandResult,
    InventoryControlTargetRosterRow,
    MekEquipmentChoiceDispatchResult,
    MekEquipmentChoiceToken,
    MekEquipmentInteraction,
    SelectedWeaponFireCommandResult,
} from './cbt-force-api';
import {
    entityTargetRosterRow,
    mekTargetRosterRow,
} from './runtime/cbt-force-target-roster';
import { entityUnitLabel } from './runtime/cbt-unit-label';
import {
    decodeEquipmentChoiceToken,
    encodeEquipmentChoiceToken,
    equipmentChoiceMatches,
    expandV2EquipmentDropdownBinding,
    type ExpandedV2EquipmentInteractionChoiceBinding,
} from './runtime/mek-interaction-command-token';
import {
    CBTForceC3,
    emptyC3EmergencyMasterMutation,
    publishC3EmergencyMasterNotices,
    validateCBTEncounterNetworks,
} from './cbt-force-c3';
import { prepareCBTForceRosterMutationPlan } from './runtime/cbt-force-roster-owner';
import { pruneRemovedUnitsFromEncounter } from './runtime/cbt-force-persistence-helpers';

interface CBTForceAuthorityState {
    readonly envelope: SerializedCBTForceV2;
    readonly units: ReadonlyMap<UnitInstanceId, ReadyClassicUnit>;
    readonly scenario: ScenarioRules;
}

export interface PreparedUnitAdmission {
    readonly expectedBinding: CBTForceAuthorityState | null;
    readonly nextBinding: CBTForceAuthorityState;
}

export interface PreparedUnitRemoval {
    readonly expectedBinding: CBTForceAuthorityState;
    readonly nextBinding: CBTForceAuthorityState;
}

export interface PreparedUnitRepair {
    readonly expectedBinding: CBTForceAuthorityState;
    readonly nextBinding: CBTForceAuthorityState;
}

interface ReadyUnitPersistenceWitness {
    readonly unit: ReadyClassicUnit;
    readonly revision: StateRevision;
}

export interface PreparedUnitLoad {
    readonly expectedBinding: CBTForceAuthorityState | null;
    readonly envelope: SerializedCBTForceV2;
    readonly nextBinding: CBTForceAuthorityState | null;
    readonly readyWitnesses: readonly ReadyUnitPersistenceWitness[];
    readonly ignoredUnitIds: readonly UnitInstanceId[];
}

export interface CBTForceAuthorityFence {
    readonly expectedBinding: CBTForceAuthorityState | null;
    readonly units: ReadonlyMap<UnitInstanceId, ReadyClassicUnit>;
    readonly runtimeRevisions: ReadonlyMap<UnitInstanceId, StateRevision>;
}

/** Owns ready Entity + sparse-runtime units behind the Classic force boundary. */
export class CBTForceAuthority {
    private binding: CBTForceAuthorityState | null = null;
    public readonly c3 = new CBTForceC3(() => this.binding?.units ?? null);

    public constructor() {
        Object.seal(this);
    }

    public async prepareLoad(
        envelope: SerializedCBTForceV2,
        readyMeks: ReadyMekUnitService | undefined,
        readyNonMekUnits: ReadyNonMekUnitService | undefined,
    ): Promise<PreparedUnitLoad> {
        const expectedBinding = this.binding;
        const scenario = scenarioRulesFromPersistence(envelope.scenarioRules.values);
        const entries = envelope.units;
        const ignoredUnitIds = new Set<UnitInstanceId>();
        const restored = await Promise.all(entries.map(async entry => {
            try {
                if (isSerializedNonMekUnit(entry.unit)) {
                    if (!readyNonMekUnits) throw new Error('A Ready non-Mek service is required for non-Mek members');
                    return await readyNonMekUnits.restoreReadyNonMekUnit({ saved: entry.unit });
                }
                if (!readyMeks) throw new Error('A Ready Mek service is required for Mek members');
                return await readyMeks.restoreReadyMekV2({
                    saved: entry.unit,
                    deployment: deploymentFromPersistence(entry.unit.deployment.values),
                    scenario,
                    initialStateProfileId: entry.unit.baselineRefAtSave.initialStateProfile.profileId,
                });
            } catch {
                ignoredUnitIds.add(entry.instanceId);
                if (isSerializedNonMekUnit(entry.unit)) {
                    if (!readyNonMekUnits) throw new Error('A Ready non-Mek service is required for non-Mek members');
                    try {
                        return await readyNonMekUnits.loadReadyNonMekUnit({
                            identity: entry.unit.entity,
                            instanceId: entry.instanceId,
                            deployment: entry.unit.deployment.values,
                            scenario,
                        });
                    } catch {
                        try {
                            return await readyNonMekUnits.loadReadyNonMekUnit({
                                identity: entry.unit.entity,
                                instanceId: entry.instanceId,
                                deployment: { id: DEFAULT_FORCE_DEPLOYMENT_ID },
                                scenario,
                            });
                        } catch {
                            return null;
                        }
                    }
                }
                if (!readyMeks) throw new Error('A Ready Mek service is required for Mek members');
                try {
                    return await readyMeks.loadReadyMek({
                        identity: entry.unit.entity,
                        instanceId: entry.instanceId,
                        deployment: deploymentFromPersistence(entry.unit.deployment.values),
                        scenario,
                    });
                } catch {
                    try {
                        return await readyMeks.loadReadyMek({
                            identity: entry.unit.entity,
                            instanceId: entry.instanceId,
                            deployment: { id: DEFAULT_FORCE_DEPLOYMENT_ID },
                            scenario,
                        });
                    } catch {
                        return null;
                    }
                }
            }
        }));
        const units = new Map<UnitInstanceId, ReadyClassicUnit>();
        restored.forEach(ready => {
            if (ready === null) return;
            if (units.has(ready.instanceId)) throw new Error(`Duplicate restored V2 runtime ${ready.instanceId}`);
            units.set(ready.instanceId, ready);
        });
        const retainedEntries = entries.filter(entry => units.has(entry.instanceId));
        const removedUnitIds = new Set(entries
            .filter(entry => !units.has(entry.instanceId))
            .map(entry => entry.instanceId));
        const serializedUnits = new Map<UnitInstanceId, SerializedCBTUnitV2 | SerializedNonMekUnit>();
        const readyWitnesses = retainedEntries.map(entry => {
            const ready = units.get(entry.instanceId)!;
            const entity = ready.getUnit();
            const serialized = ready.serialize();
            if (ready.instanceId !== entry.instanceId
                || serialized.instanceId !== entry.instanceId
                || serialized.stateRevision !== ready.revision()) {
                throw new Error(`Restored V2 runtime ${entry.instanceId} disagrees with its persisted revision`);
            }
            const sourceRef = ready.getSourceRef();
            if (sourceRef.provider !== entry.unit.entity.provider
                || entity.uuid() !== entry.unit.entity.uuid
                || serialized.entity.provider !== entry.unit.entity.provider
                || serialized.entity.uuid !== entry.unit.entity.uuid
                || ready.getUnit() !== entity) {
                throw new Error(`Restored V2 runtime ${entry.instanceId} disagrees with its persisted native source`);
            }
            if (entry.stateRevision !== ready.revision()) {
                ignoredUnitIds.add(entry.instanceId);
            }
            serializedUnits.set(entry.instanceId, serialized);
            return Object.freeze({
                unit: ready,
                revision: ready.revision(),
            });
        });
        const hydratedUnits = retainedEntries.map(entry => Object.freeze({
            ...entry,
            stateRevision: serializedUnits.get(entry.instanceId)!.stateRevision,
            unit: serializedUnits.get(entry.instanceId)!,
        }));
        let roster = envelope.roster;
        for (const instanceId of removedUnitIds) {
            const removal = prepareCBTForceRosterMutationPlan({
                roster,
                command: { kind: 'remove-member', instanceId },
            });
            if (removal.kind === 'ready') roster = removal.plan.nextRoster;
            else if (removal.reason !== 'UNKNOWN_MEMBER') {
                throw new Error(`Could not remove skipped V2 unit ${instanceId} from its roster`);
            }
        }
        const hydratedEnvelope = await validateSerializedCBTForceV2({
            ...envelope,
            schemaVersion: CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
            minimumWriterVersion: CBT_FORCE_MINIMUM_WRITER_VERSION,
            units: hydratedUnits,
            roster,
            encounter: removedUnitIds.size === 0
                ? envelope.encounter
                : pruneRemovedUnitsFromEncounter(envelope.encounter, removedUnitIds),
            history: removedUnitIds.size === 0 ? envelope.history : emptyRuntimeHistory(),
        });
        const encounter = decodeCBTEncounterStateV2(hydratedEnvelope.encounter.state).snapshot;
        if (!validateCBTEncounterNetworks(encounter.networks, units)) {
            throw new Error('Restored C3 network facts are not canonical for the restored units');
        }
        const nextBinding: CBTForceAuthorityState = Object.freeze({
            envelope: hydratedEnvelope,
            units,
            scenario,
        });
        return Object.freeze({
            expectedBinding,
            envelope: hydratedEnvelope,
            nextBinding,
            readyWitnesses: Object.freeze(readyWitnesses),
            ignoredUnitIds: Object.freeze([...ignoredUnitIds]),
        });
    }

    public isPreparedLoadCurrent(prepared: PreparedUnitLoad): boolean {
        if (this.binding !== prepared.expectedBinding) return false;
        for (const witness of prepared.readyWitnesses) {
            if (witness.unit.revision() !== witness.revision) return false;
        }
        return true;
    }

    public installLoad(prepared: PreparedUnitLoad): void {
        this.binding = prepared.nextBinding;
        this.c3.reset();
    }

    public clear(): void {
        this.binding = null;
        this.c3.reset();
    }

    public envelope(): SerializedCBTForceV2 | null {
        return this.binding?.envelope ?? null;
    }

    public history() {
        return this.binding?.envelope.history ?? null;
    }

    public liveUnits(): readonly ReadyClassicUnit[] {
        const binding = this.binding;
        if (!binding) throw new Error('The force has no installed Classic authority');
        const envelope = binding.envelope;
        const expected = envelope.units;
        if (expected.length !== binding.units.size
            || expected.some(entry => !binding.units.has(entry.instanceId))) {
            throw new Error('Live unit store coverage changed before persistence');
        }
        return Object.freeze(expected.map(entry => binding.units.get(entry.instanceId)!));
    }

    public readyUnit(instanceId: UnitInstanceId): ReadyClassicUnit | null {
        return this.binding?.units.get(instanceId) ?? null;
    }

    public readyMekUnit(instanceId: UnitInstanceId): ReadyMekUnit | null {
        const unit = this.readyUnit(instanceId);
        return unit && isReadyMekUnit(unit) ? unit : null;
    }

    public readyNonMekUnit(instanceId: UnitInstanceId): ReadyNonMekUnit | null {
        const unit = this.readyUnit(instanceId);
        return unit && isReadyNonMekUnit(unit) ? unit : null;
    }

    public commit(envelope: SerializedCBTForceV2): void {
        const binding = this.binding;
        const expected = envelope.units;
        if (!binding) {
            if (expected.length > 0) throw new Error('Cannot install ready entries without their runtimes');
            this.binding = Object.freeze({
                envelope,
                units: new Map(),
                scenario: scenarioRulesFromPersistence(envelope.scenarioRules.values),
            });
            return;
        }
        if (expected.length !== binding.units.size
            || expected.some(entry => !binding.units.has(entry.instanceId))) {
            throw new Error('Materialized envelope changed V2 runtime membership');
        }
        this.binding = Object.freeze({
            ...binding,
            envelope,
        });
    }

    /** Captures the exact retained owner/runtime revisions before admission awaits. */
    public captureFence(): CBTForceAuthorityFence {
        const expectedBinding = this.binding;
        const live = expectedBinding
            ? this.liveUnits()
            : Object.freeze([] as ReadyClassicUnit[]);
        return Object.freeze({
            expectedBinding,
            units: new Map(live.map(unit => [unit.instanceId, unit] as const)),
            runtimeRevisions: new Map(live.map(unit => [
                unit.instanceId,
                unit.revision(),
            ] as const)),
        });
    }

    public isFenceCurrent(fence: CBTForceAuthorityFence): boolean {
        const binding = this.binding;
        if (binding !== fence.expectedBinding || (binding?.units.size ?? 0) !== fence.units.size) return false;
        for (const [instanceId, unit] of fence.units) {
            if (binding?.units.get(instanceId) !== unit
                || unit.revision() !== fence.runtimeRevisions.get(instanceId)) return false;
        }
        return true;
    }

    public captureWholeOwnerFence(): CBTForceAuthorityFence {
        const binding = this.binding;
        const units = binding ? [...binding.units.values()] : [];
        return Object.freeze({
            expectedBinding: binding,
            units: new Map(units.map(unit => [unit.instanceId, unit] as const)),
            runtimeRevisions: new Map(units.map(unit => [
                unit.instanceId,
                unit.revision(),
            ] as const)),
        });
    }

    /**
     * Builds the complete next owner binding without installing it. Existing
     * runtime snapshots must still equal the sealed admission envelope, which
     * fences concurrent commands, redeployments, saves, and reloads.
     */
    public prepareAdmission(
        envelope: SerializedCBTForceV2,
        candidate: ReadyClassicUnit,
    ): PreparedUnitAdmission {
        const expectedBinding = this.binding;
        const existing = expectedBinding
            ? this.liveUnits()
            : Object.freeze([] as ReadyClassicUnit[]);
        if (existing.some(unit => unit.instanceId === candidate.instanceId)) {
            throw new Error(`V2 runtime ${candidate.instanceId} is already owned`);
        }

        const units = new Map<UnitInstanceId, ReadyClassicUnit>(
            existing.map(unit => [unit.instanceId, unit] as const),
        );
        units.set(candidate.instanceId, candidate);
        const entries = envelope.units;
        if (entries.length !== units.size || entries.some(entry => !units.has(entry.instanceId))) {
            throw new Error('Prepared V2 admission does not exactly cover the next runtime owner set');
        }
        for (const entry of entries) {
            const current = units.get(entry.instanceId)!;
            if (current.revision() !== entry.stateRevision
                || current.instanceId !== entry.instanceId) {
                throw new Error(`V2 runtime ${entry.instanceId} changed while admission was prepared`);
            }
        }

        const nextBinding: CBTForceAuthorityState = Object.freeze({
            envelope,
            units,
            scenario: scenarioRulesFromPersistence(envelope.scenarioRules.values),
        });
        return Object.freeze({ expectedBinding, nextBinding });
    }

    public canInstallAdmission(prepared: PreparedUnitAdmission): boolean {
        return this.binding === prepared.expectedBinding;
    }

    /** Prevalidated synchronous pointer install; deliberately invokes no user code. */
    public installAdmission(prepared: PreparedUnitAdmission): void {
        this.binding = prepared.nextBinding;
    }

    /** Synchronous rollback paired with installAdmission inside the owner CAS. */
    public rollbackAdmission(prepared: PreparedUnitAdmission): void {
        this.binding = prepared.expectedBinding;
    }

    public prepareRemoval(
        envelope: SerializedCBTForceV2,
        instanceIds: readonly UnitInstanceId[],
    ): PreparedUnitRemoval {
        const expectedBinding = this.binding;
        if (!expectedBinding) throw new Error('The force has no installed V2 unit owner');
        const units = new Map(this.liveUnits().map(unit => [unit.instanceId, unit] as const));
        for (const instanceId of instanceIds) {
            if (!units.delete(instanceId)) throw new Error(`Ready V2 runtime ${instanceId} is not owned`);
        }
        const entries = envelope.units;
        if (entries.length !== units.size || entries.some(entry => !units.has(entry.instanceId))) {
            throw new Error('Prepared V2 removal does not exactly cover the next runtime owner set');
        }
        const nextBinding: CBTForceAuthorityState = Object.freeze({
            ...expectedBinding,
            envelope,
            units,
        });
        return Object.freeze({ expectedBinding, nextBinding });
    }

    public installRemoval(prepared: PreparedUnitRemoval): void {
        if (this.binding !== prepared.expectedBinding) {
            throw new Error('The V2 unit owner changed before removal');
        }
        this.binding = prepared.nextBinding;
    }

    public rollbackRemoval(prepared: PreparedUnitRemoval): void {
        this.binding = prepared.expectedBinding;
    }

    public async buildRepairCandidates(
        instanceIds: readonly UnitInstanceId[],
    ): Promise<ReadonlyMap<UnitInstanceId, ReadyClassicUnit>> {
        const binding = this.binding;
        if (!binding) throw new Error('The force has no installed V2 unit owner');
        const units = new Map(this.liveUnits().map(unit => [unit.instanceId, unit] as const));
        const repaired = await Promise.all(instanceIds.map(async instanceId => {
            const current = units.get(instanceId);
            if (!current) throw new Error(`Ready V2 runtime ${instanceId} is not owned`);
            const candidate = isReadyMekUnit(current)
                ? await ReadyMekUnitFactory.repair(current, binding.scenario)
                : isReadyNonMekUnit(current)
                    ? ReadyNonMekUnit.repair(current)
                    : null;
            if (candidate === null) throw new Error(`Unknown Classic runtime family ${instanceId}`);
            return sameReadyUnitGameplayState(current, candidate)
                ? null
                : [instanceId, candidate] as const;
        }));
        return new Map(repaired.filter((entry): entry is NonNullable<typeof entry> => entry !== null));
    }

    public async buildRuntimeCommandCandidates(
        checkpoint: RuntimeCommandCheckpoint,
    ): Promise<ReadonlyMap<UnitInstanceId, ReadyClassicUnit>> {
        const binding = this.binding;
        if (!binding) throw new Error('The force has no installed Classic authority');
        const restored = await Promise.all(checkpoint.units.map(async row => {
            const current = binding.units.get(row.instanceId);
            if (!current) throw new Error(`Undo checkpoint references unknown unit ${row.instanceId}`);
            let candidate: ReadyClassicUnit;
            if (isSerializedNonMekUnit(row.unit)) {
                if (!isReadyNonMekUnit(current)) {
                    throw new Error(`Undo checkpoint family changed for ${row.instanceId}`);
                }
                candidate = ReadyNonMekUnit.restore(
                    row.unit,
                    current.getUnit(),
                    current.getSourceRef(),
                    current.getNativeSource(),
                );
            } else {
                if (!isReadyMekUnit(current)) {
                    throw new Error(`Undo checkpoint family changed for ${row.instanceId}`);
                }
                candidate = await ReadyMekUnitFactory.restoreSnapshot(current, row.unit, binding.scenario);
            }
            if (!jsonValuesEqual(candidate.serialize(), row.unit)) {
                throw new Error(`Undo checkpoint could not be restored exactly for ${row.instanceId}`);
            }
            return [row.instanceId, candidate] as const;
        }));
        return new Map(restored);
    }

    public prepareRepair(
        envelope: SerializedCBTForceV2,
        replacements: ReadonlyMap<UnitInstanceId, ReadyClassicUnit>,
        fence: CBTForceAuthorityFence,
    ): PreparedUnitRepair {
        if (!this.isFenceCurrent(fence) || !fence.expectedBinding) {
            throw new Error('The V2 unit owner changed before repair installation');
        }
        const units = new Map(this.liveUnits().map(unit => [unit.instanceId, unit] as const));
        for (const [instanceId, replacement] of replacements) {
            if (!units.has(instanceId) || replacement.instanceId !== instanceId) {
                throw new Error(`Repair candidate ${instanceId} is not owned`);
            }
            units.set(instanceId, replacement);
        }
        const entries = envelope.units;
        if (entries.length !== units.size || entries.some(entry => !units.has(entry.instanceId))) {
            throw new Error('Prepared V2 repair does not exactly cover the runtime owner set');
        }
        for (const entry of entries) {
            const unit = units.get(entry.instanceId)!;
            if (unit.revision() !== entry.stateRevision
                || !jsonValuesEqual(unit.serialize(), entry.unit)) {
                throw new Error(`Prepared V2 repair does not match runtime ${entry.instanceId}`);
            }
        }
        return Object.freeze({
            expectedBinding: fence.expectedBinding,
            nextBinding: Object.freeze({
                ...fence.expectedBinding,
                envelope,
                units,
                scenario: scenarioRulesFromPersistence(envelope.scenarioRules.values),
            }),
        });
    }

    public installRepair(prepared: PreparedUnitRepair): void {
        if (this.binding !== prepared.expectedBinding) {
            throw new Error('The V2 unit owner changed before repair');
        }
        this.binding = prepared.nextBinding;
        this.c3.reset();
    }

    public rollbackRepair(prepared: PreparedUnitRepair): void {
        this.binding = prepared.expectedBinding;
        this.c3.reset();
    }

    public instanceIds(): readonly UnitInstanceId[] {
        return Object.freeze([...(this.binding?.units.keys() ?? [])]);
    }

    public ruleset(instanceId: UnitInstanceId): CBTRuleset | null {
        const binding = this.binding;
        return binding?.units.has(instanceId) === true
            ? scenarioRuleset(binding.scenario)
            : null;
    }

    public scenarioRules(): ScenarioRules | null {
        return this.binding?.scenario ?? null;
    }

    public unitDestroyed(instanceId: UnitInstanceId): boolean | null {
        const unit = this.readyUnit(instanceId);
        return unit?.captureRuntime().query.destroyed() ?? null;
    }

    public unitCrewAssignment(instanceId: UnitInstanceId): CrewAssignment | null {
        return this.readyUnit(instanceId)?.getCrewAssignment() ?? null;
    }

    public unitConditions(instanceId: UnitInstanceId): readonly UnitConditionKey[] | null {
        const unit = this.readyUnit(instanceId);
        return unit?.captureRuntime().query.conditions() ?? null;
    }

    public unitCurrentBaseBattleValue(instanceId: UnitInstanceId): number | null {
        const unit = this.readyUnit(instanceId);
        return unit ? currentUnitBaseBattleValue(unit) : null;
    }

    public unitPristineBattleValue(instanceId: UnitInstanceId): number | null {
        const unit = this.readyUnit(instanceId);
        return unit ? pristineUnitBattleValue(unit) : null;
    }

    public unitSnapshot(instanceId: UnitInstanceId): CBTUnitSnapshot | null {
        const unit = this.readyUnit(instanceId);
        if (!unit) return null;
        const runtime = unit.captureRuntime();
        const nativeSource = unit.getNativeSource();
        return Object.freeze({
            instanceId,
            entity: unit.getUnit(),
            index: runtime.index,
            sourceRef: unit.getSourceRef(),
            ...(nativeSource === undefined ? {} : { nativeSource }),
            ruleset: this.ruleset(instanceId)!,
            crewAssignment: unit.getCrewAssignment(),
            state: runtime.state,
            query: runtime.query,
        }) satisfies CBTUnitSnapshot;
    }

    public dispatchNonMekUnitCommand(
        instanceId: UnitInstanceId,
        command: NonMekUnitCommand,
        forceReadOnly: boolean,
    ): CBTNonMekUnitCommandResult {
        const unit = this.readyNonMekUnit(instanceId);
        if (!unit) {
            return Object.freeze({
                accepted: true,
                changed: false,
                state: null,
            });
        }
        const runtime = unit.getInstance();
        if (forceReadOnly) {
            return Object.freeze({
                accepted: false,
                changed: false,
                state: runtime.snapshot(),
            });
        }
        return runtime.dispatch(command);
    }

    public dispatchMekUnitCommand(
        instanceId: UnitInstanceId,
        command: CBTUnitCommand,
        forceReadOnly: boolean,
    ): CBTMekUnitCommandResult {
        const unit = this.readyMekUnit(instanceId);
        if (!unit) {
            return Object.freeze({ accepted: true, changed: false, state: null });
        }
        const runtime = unit.getInstance();
        if (forceReadOnly) {
            return Object.freeze({
                accepted: false,
                changed: false,
                state: runtime.snapshot(),
            });
        }
        return runtime.dispatch(command);
    }

    public attackerTargetingSnapshot(
        instanceId: UnitInstanceId,
        registry: TargetRegistrySnapshot,
    ): AttackerTargetingSnapshot | null {
        const unit = this.binding?.units.get(instanceId);
        if (!unit) return null;
        const runtime = unit.captureRuntime();
        return Object.freeze({
            instanceId,
            stateRevision: runtime.query.stateRevision,
            registryRevision: registry.revision,
            state: runtime.query.attackerTargetingState(),
        });
    }

    public dispatchAttackerTargeting(
        instanceId: UnitInstanceId,
        command: CBTUnitAttackerTargetingCommand,
        registry: TargetRegistrySnapshot,
        networks: readonly EncounterNetwork[],
        forceReadOnly: boolean,
    ): AttackerTargetingCommandResult {
        const binding = this.binding;
        const unit = binding?.units.get(instanceId);
        if (!binding || !unit) {
            return Object.freeze({ accepted: true, changed: false, state: null });
        }
        if (command.edit.kind === 'set-target-facts'
            && command.edit.facts?.useC3 === true
            && !this.c3.hasOperationalEndpoint(instanceId, unit, networks)) {
            return Object.freeze({
                accepted: true,
                changed: false,
                state: unit.captureRuntime().state,
            });
        }
        return unit.dispatchAttackerTargeting(command, registry, forceReadOnly);
    }

    public dispatchEquipmentRowOrder(
        instanceId: UnitInstanceId,
        group: EquipmentRowOrderGroup,
        permutation: readonly number[],
        rowCount: number,
        forceReadOnly: boolean,
    ): EquipmentRowOrderCommandResult {
        const unit = this.binding?.units.get(instanceId);
        if (!unit) {
            return Object.freeze({ accepted: true, changed: false, state: null });
        }
        return unit.setEquipmentRowOrder(
            group,
            permutation,
            rowCount,
            forceReadOnly,
        );
    }

    public dispatchSelectedWeaponFire(
        instanceId: UnitInstanceId,
        command: CBTUnitSelectedWeaponFireCommand,
        registry: TargetRegistrySnapshot,
        networks: readonly EncounterNetwork[],
        forceReadOnly: boolean,
    ): SelectedWeaponFireCommandResult {
        const binding = this.binding;
        const unit = this.readyUnit(instanceId);
        if (!binding || !unit) {
            return Object.freeze({
                accepted: true,
                changed: false,
                state: null,
                prototypeHeat: Object.freeze([]),
            });
        }
        const c3Available = this.c3.hasOperationalEndpoint(instanceId, unit, networks);
        return unit.dispatchSelectedWeaponFire(command, registry, forceReadOnly, c3Available);
    }

    public prepareTargetingReconciliation(
        registry: TargetRegistrySnapshot,
    ): readonly ReadyTargetingReconciliation[] {
        const plans: ReadyTargetingReconciliation[] = [];
        for (const unit of this.binding?.units.values() ?? []) {
            const plan = unit.planTargetingReconciliation(registry);
            if (plan !== null) plans.push(plan);
        }
        return Object.freeze(plans);
    }

    /** Installs plans prepared immediately before the synchronous registry commit. */
    public installTargetingReconciliation(
        prepared: readonly ReadyTargetingReconciliation[],
    ): void {
        for (const plan of prepared) plan.install();
    }

    public targetRoster(forceInstanceId: string): readonly InventoryControlTargetRosterRow[] {
        return Object.freeze([...(this.binding?.units.values() ?? [])]
            .flatMap(unit => isReadyMekUnit(unit)
                ? [mekTargetRosterRow(forceInstanceId, unit)]
                : isReadyNonMekUnit(unit)
                    ? [entityTargetRosterRow(forceInstanceId, unit)]
                    : []));
    }

    public crewProfile(instanceId: UnitInstanceId): CrewAssignment | null {
        return this.binding?.units.get(instanceId)?.getCrewAssignment() ?? null;
    }

    public async replaceCrewProfile(
        instanceId: UnitInstanceId,
        positions: readonly CrewAssignmentPosition[],
        readyMeks: ReadyMekUnitService,
        isReadOnly: () => boolean,
        isOwnerCurrent: () => boolean,
        publishChanged: () => void,
    ): Promise<CrewAssignment | null> {
        if (isReadOnly() || !isOwnerCurrent()) return null;
        const binding = this.binding;
        const current = binding?.units.get(instanceId);
        if (!binding || !current) return null;

        const runtimeRevision = current.revision();
        if (runtimeRevision !== 0) return null;

        let assignment: CrewAssignment;
        try {
            assignment = canonicalizeCrewAssignment(current.getIndex().crewPositions, {
                schemaVersion: CREW_ASSIGNMENT_SCHEMA_VERSION,
                positions,
            });
        } catch {
            return null;
        }
        if (jsonValuesEqual(assignment, current.getCrewAssignment())) return current.getCrewAssignment();

        let replacement: ReadyClassicUnit;
        try {
            if (isReadyMekUnit(current)) {
                replacement = await readyMeks.redeployReadyMekV2({
                    current,
                    crewAssignment: assignment,
                    scenario: binding.scenario,
                });
            } else if (isReadyNonMekUnit(current)) {
                replacement = ReadyNonMekUnit.redeploy(current, assignment);
            } else {
                throw new Error(`Unknown Classic runtime family ${instanceId}`);
            }
            // Force the exact persistence codec before installing the candidate.
            const serialized = replacement.serialize();
            if (replacement.instanceId !== instanceId
                || serialized.instanceId !== instanceId
                || serialized.stateRevision !== replacement.revision()
                || replacement.getUnit() !== current.getUnit()
                || !readyUnitMatchesEntity(replacement, current.getUnit())) {
                throw new Error('Redeployed Ready unit changed owner identity or native source');
            }
        } catch {
            return null;
        }

        // An owner replacement during the asynchronous Mek rebuild wins.
        if (isReadOnly()
            || !isOwnerCurrent()
            || this.binding !== binding
            || binding.units.get(instanceId) !== current
            || current.revision() !== runtimeRevision) {
            return null;
        }

        const units = new Map(binding.units);
        units.set(instanceId, replacement);
        this.binding = Object.freeze({
            ...binding,
            units,
        });
        publishChanged();
        return replacement.getCrewAssignment();
    }

    public equipmentInteractions(
        registry: EquipmentInteractionRegistry,
        context: HandlerQueryContext,
        encounter: () => ReturnType<CBTEncounterRuntime['snapshot']>,
        readOnly: boolean,
    ): readonly MekEquipmentInteraction[] {
        const owner = this.binding;
        if (!owner) return Object.freeze([]);
        const encounterSnapshot = encounter();
        const effectiveEncounterSnapshot = Object.freeze({
            ...encounterSnapshot,
            networks: this.c3.effectiveNetworks(encounterSnapshot.networks),
        });
        const rows: MekEquipmentInteraction[] = [];
        const units = [...owner.units].sort(([left], [right]) => String(left).localeCompare(String(right)));
        for (const [instanceId, unit] of units) {
            if (!isReadyMekUnit(unit)) continue;
            const entity = unit.getUnit();
            const runtime = unit.getInstance();
            if (evaluateMekRuntimeCapability(entity).readiness !== 'ready'
                || runtime.query().heatCapability().kind === 'unsupported') {
                continue;
            }
            const stateRevision = runtime.revision();
            const offered = registry.getV2EquipmentInteractionChoices(
                runtime,
                entity,
                unit.getIndex(),
                scenarioRuleset(owner.scenario),
                {
                    instanceId,
                    encounter: () => effectiveEncounterSnapshot,
                },
                context,
            );
            const groups = new Map<string, ExpandedV2EquipmentInteractionChoiceBinding[]>();
            for (const binding of offered.flatMap(expandV2EquipmentDropdownBinding)) {
                const key = `${binding.componentId}\0${binding.relatedComponentId ?? ''}`;
                const group = groups.get(key) ?? [];
                group.push(binding);
                groups.set(key, group);
            }
            for (const group of groups.values()) {
                const first = group[0];
                const publicChoices = group.map(interaction => {
                    const token = encodeEquipmentChoiceToken({
                        instanceId,
                        entityUuid: entity.uuid(),
                        stateRevision,
                        interaction,
                    });
                    const action = interaction.choice.action;
                    const actionAllowed = interaction.choice.stateEdit !== undefined
                        || interaction.choice.skipActionGate === true
                        || action === 'configure-network'
                        || canPerformMekAction(
                            entity,
                            unit.getIndex(),
                            runtime.query(),
                            { kind: 'component', componentId: interaction.actionComponentId },
                            action ?? 'change-mode',
                            runtime.ruleset(),
                        );
                    return Object.freeze({
                        token,
                        handlerId: interaction.handler.id,
                        interactionKind: interaction.kind,
                        label: interaction.choice.label,
                        ...(interaction.groupLabel === undefined
                            ? {}
                            : { groupLabel: interaction.groupLabel }),
                        ...(interaction.choice.shortLabel === undefined
                            ? {}
                            : { shortLabel: interaction.choice.shortLabel }),
                        active: interaction.choice.active === true,
                        disabled: (readOnly && interaction.choice.readOnlySafe !== true)
                            || interaction.choice.disabled === true
                            || !actionAllowed,
                        ...(interaction.choice.selectionTone === undefined
                            ? {}
                            : { selectionTone: interaction.choice.selectionTone }),
                        ...(interaction.choice.colors === undefined
                            ? {}
                            : { colors: Object.freeze({ ...interaction.choice.colors }) }),
                        ...(interaction.choice.keepOpen === undefined
                            ? {}
                            : { keepOpen: interaction.choice.keepOpen }),
                        ...(interaction.choice.displayType === undefined
                            ? {}
                            : { displayType: interaction.choice.displayType }),
                        ...(interaction.choice.tooltipType === undefined
                            ? {}
                            : { tooltipType: interaction.choice.tooltipType }),
                        ...(interaction.choice.failureTarget === undefined
                            ? {}
                            : { failureTarget: interaction.choice.failureTarget }),
                    });
                });
                const component = entity.equipment().find(
                    mount => mount.mountId === String(first.componentId),
                );
                rows.push(Object.freeze({
                    instanceId,
                    unitLabel: entityUnitLabel(entity, instanceId),
                    componentId: first.componentId,
                    ...(first.relatedComponentId === undefined
                        ? {}
                        : { relatedComponentId: first.relatedComponentId }),
                    componentLabel: component?.displayName() ?? first.componentId,
                    stateRevision,
                    choices: Object.freeze(publicChoices),
                }));
            }
        }
        return Object.freeze(rows);
    }

    public equipmentChoiceInstanceId(token: MekEquipmentChoiceToken): UnitInstanceId | null {
        return decodeEquipmentChoiceToken(token)?.instanceId ?? null;
    }

    public endTurnForAll(
        isReadOnly: () => boolean,
        policy: () => MekHeatAutomationPolicyV2,
        configuredNetworks: readonly EncounterNetwork[],
        toast: Pick<ToastService, 'showToast'>,
        publishChanged: () => void,
    ): CBTForceEndTurnAllResult {
        const result = this.endTurnForAllNow(isReadOnly, policy, configuredNetworks, toast);
        if (result.changed) publishChanged();
        return result;
    }

    public dispatchEquipmentChoice(
        token: MekEquipmentChoiceToken,
        registry: EquipmentInteractionRegistry,
        queryContext: HandlerQueryContext,
        commandContext: HandlerCommandContext,
        encounter: () => ReturnType<CBTEncounterRuntime['snapshot']>,
        isReadOnly: () => boolean,
        isOwnerCurrent: () => boolean,
        publishChanged: () => void,
    ): Promise<MekEquipmentChoiceDispatchResult> {
        const result = this.dispatchEquipmentChoiceNow(
            token,
            registry,
            queryContext,
            commandContext,
            encounter,
            isReadOnly,
            isOwnerCurrent,
        );
        if (isPromiseLike(result)) {
            return result.then(resolved => {
                if (resolved.accepted && resolved.changed) publishChanged();
                return resolved;
            });
        }
        if (result.accepted && result.changed) publishChanged();
        return Promise.resolve(result);
    }

    private dispatchEquipmentChoiceNow(
        token: MekEquipmentChoiceToken,
        registry: EquipmentInteractionRegistry,
        queryContext: HandlerQueryContext,
        commandContext: HandlerCommandContext,
        encounter: () => ReturnType<CBTEncounterRuntime['snapshot']>,
        isReadOnly: () => boolean,
        isOwnerCurrent: () => boolean,
    ): MekEquipmentChoiceDispatchResult | Promise<MekEquipmentChoiceDispatchResult> {
        const selected = decodeEquipmentChoiceToken(token);
        if (!selected) return rejectedEquipmentChoice('UNKNOWN_TOKEN');
        if (!isOwnerCurrent()) return rejectedEquipmentChoice('OWNER_CHANGED');
        const owner = this.binding;
        const candidate = owner?.units.get(selected.instanceId);
        if (!owner || !candidate || !isReadyMekUnit(candidate)) return rejectedEquipmentChoice('OWNER_CHANGED');
        const unit = candidate;
        const entity = unit.getUnit();
        const runtime = unit.getInstance();
        if (runtime.revision() !== selected.stateRevision) return rejectedEquipmentChoice('STALE_REVISION');
        if (entity.uuid() !== selected.entityUuid || !unit.matchesEntity(entity)) {
            return rejectedEquipmentChoice('ENTITY_MISMATCH');
        }
        if (evaluateMekRuntimeCapability(entity).readiness !== 'ready') {
            return rejectedEquipmentChoice('NOT_ADMITTED');
        }
        if (runtime.query().heatCapability().kind === 'unsupported') {
            return rejectedEquipmentChoice('NOT_ADMITTED');
        }

        const configuredEncounter = encounter();
        const effectiveEncounter = Object.freeze({
            ...configuredEncounter,
            networks: this.c3.effectiveNetworks(configuredEncounter.networks),
        });
        const interaction = registry.getV2EquipmentInteractionChoices(
            runtime,
            entity,
            unit.getIndex(),
            scenarioRuleset(owner.scenario),
            { instanceId: selected.instanceId, encounter: () => effectiveEncounter },
            queryContext,
        ).flatMap(expandV2EquipmentDropdownBinding)
            .find(candidateInteraction => equipmentChoiceMatches(candidateInteraction, selected));
        if (!interaction) return rejectedEquipmentChoice('CHOICE_UNAVAILABLE');
        if (isReadOnly() && interaction.choice.readOnlySafe !== true) {
            return rejectedEquipmentChoice('READ_ONLY');
        }
        const action = interaction.choice.action;
        if (interaction.choice.stateEdit === undefined
            && interaction.choice.skipActionGate !== true
            && action !== 'configure-network'
            && !canPerformMekAction(
                entity,
                unit.getIndex(),
                runtime.query(),
                { kind: 'component', componentId: interaction.actionComponentId },
                action ?? 'change-mode',
                runtime.ruleset(),
            )) return rejectedEquipmentChoice('CHOICE_UNAVAILABLE');

        const before = runtime.revision();
        const finalize = (accepted: boolean, handlerFailed: boolean): MekEquipmentChoiceDispatchResult => {
            if ((isReadOnly() && interaction.choice.readOnlySafe !== true)
                || !isOwnerCurrent()
                || this.binding?.units.get(selected.instanceId) !== unit) {
                return rejectedEquipmentChoice('OWNER_CHANGED');
            }
            const handlerChanged = runtime.revision() !== before;
            const c3 = interaction.choice.action !== 'configure-network'
                && (handlerChanged || accepted)
                ? this.c3.reconcileEmergencyMasters(configuredEncounter.networks)
                : emptyC3EmergencyMasterMutation();
            publishC3EmergencyMasterNotices(c3.notices, commandContext.toastService);
            const changed = handlerChanged || c3.changedUnitIds.length > 0;
            // The revision is the mutation authority. A handler may mutate and then
            // fail in a notification side effect; the force must still publish that
            // state change exactly once.
            if (changed) return Object.freeze({ accepted: true, changed: true });
            if (!accepted || handlerFailed) return rejectedEquipmentChoice('HANDLER_REJECTED');
            return Object.freeze({ accepted: true, changed: false });
        };
        try {
            const handled = registry.handleV2EquipmentInteractionChoice(
                runtime,
                entity,
                unit.getIndex(),
                scenarioRuleset(owner.scenario),
                { instanceId: selected.instanceId, encounter: () => effectiveEncounter },
                interaction,
                queryContext,
                commandContext,
            );
            return isPromiseLike(handled)
                ? handled.then(
                    accepted => finalize(accepted, false),
                    () => finalize(false, true),
                )
                : finalize(handled, false);
        } catch {
            return finalize(false, true);
        }
    }

    private endTurnForAllNow(
        isReadOnly: () => boolean,
        policy: () => MekHeatAutomationPolicyV2,
        configuredNetworks: readonly EncounterNetwork[],
        toast: Pick<ToastService, 'showToast'>,
    ): CBTForceEndTurnAllResult {
        const owner = this.binding;
        const retained: Array<readonly [UnitInstanceId, ReadyClassicUnit]> = owner
            ? [...owner.units].flatMap(([instanceId, unit]) =>
                isReadyMekUnit(unit) || isReadyNonMekUnit(unit)
                    ? [[instanceId, unit] as const]
                    : [])
            : [];
        if (isReadOnly()) return frozenEndTurnAllResult(false, false, [
            ...retained.map(([instanceId]) => ({
                instanceId,
                accepted: false,
                changed: false,
                reason: 'READ_ONLY',
            })),
        ]);

        const selectedPolicy = retained.some(([, unit]) => isReadyMekUnit(unit))
            ? policy()
            : 'automatic';
        for (const [instanceId, unit] of retained) {
            if (!isReadyMekUnit(unit)) continue;
            const entity = unit.getUnit();
            if (evaluateMekRuntimeCapability(entity).readiness !== 'ready') {
                return frozenEndTurnAllResult(false, false, preflightFailureRows(
                    retained.map(([id]) => id),
                    instanceId,
                    'NOT_ADMITTED',
                ));
            }
            const query = unit.getInstance().query();
            if (query.heatCapability().kind === 'unsupported') {
                return frozenEndTurnAllResult(false, false, preflightFailureRows(
                    retained.map(([id]) => id),
                    instanceId,
                    'UNSUPPORTED_HEAT_CONTEXT',
                ));
            }
            const projection = query.heatProjection(selectedPolicy);
            if (projection.kind === 'unsupported') {
                return frozenEndTurnAllResult(false, false, preflightFailureRows(
                    retained.map(([id]) => id),
                    instanceId,
                    'UNSUPPORTED_HEAT_CONTEXT',
                ));
            }
            if (selectedPolicy === 'automatic'
                && projection.projection.projected > MAX_MEK_HEAT_VALUE_V2) {
                return frozenEndTurnAllResult(false, false, preflightFailureRows(
                    retained.map(([id]) => id),
                    instanceId,
                    'EXCEEDS_CAPACITY',
                ));
            }
            if (selectedPolicy === 'manual'
                && query.heatState().pendingOverride === undefined
                && projection.projection.hasPendingSettlement) {
                return frozenEndTurnAllResult(false, false, preflightFailureRows(
                    retained.map(([id]) => id),
                    instanceId,
                    'INVALID_TARGET',
                ));
            }
        }

        const c3Plans = new Map(retained.flatMap(([instanceId, unit]) =>
            isReadyMekUnit(unit)
                ? [[instanceId, this.c3.planEmergencyMasterEndTurn(instanceId, configuredNetworks)] as const]
                : []));
        const results: CBTForceEndTurnUnitResult[] = [];
        let v2Changed = false;
        for (const [instanceId, unit] of retained) {
            const before = unit.revision();
            let accepted = false;
            let reason: string | undefined;
            try {
                const reduction = isReadyMekUnit(unit)
                    ? unit.endTurn(selectedPolicy)
                    : isReadyNonMekUnit(unit)
                        ? unit.endTurn()
                        : null;
                if (reduction === null) throw new Error('Unsupported Classic unit family');
                accepted = reduction.accepted;
            } catch (error) {
                reason = error instanceof Error ? error.message : 'Retained V2 end-turn failed';
            }
            const c3 = accepted && isReadyMekUnit(unit)
                ? this.c3.settleEmergencyMasterEndTurn(c3Plans.get(instanceId) ?? null)
                : emptyC3EmergencyMasterMutation();
            publishC3EmergencyMasterNotices(c3.notices, toast);
            const changed = unit.revision() !== before || c3.changedUnitIds.length > 0;
            v2Changed = v2Changed || changed;
            results.push(Object.freeze({
                instanceId,
                accepted,
                changed,
                ...(reason === undefined ? {} : { reason }),
            }));
        }
        const reconciled = this.c3.reconcileEmergencyMasters(configuredNetworks);
        publishC3EmergencyMasterNotices(reconciled.notices, toast);
        if (reconciled.changedUnitIds.length > 0) {
            for (let index = 0; index < results.length; index += 1) {
                const row = results[index]!;
                if (!reconciled.changedUnitIds.includes(asUnitInstanceId(row.instanceId))) continue;
                results[index] = Object.freeze({ ...row, changed: true });
            }
            v2Changed = true;
        }
        return frozenEndTurnAllResult(
            results.every(result => result.accepted),
            results.some(result => result.changed),
            results,
        );
    }

}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
    return typeof (value as Promise<T> | null)?.then === 'function';
}

type MekEquipmentChoiceRejectionReason = Extract<
    MekEquipmentChoiceDispatchResult,
    { readonly accepted: false }
>['reason'];

export function rejectedEquipmentChoice(
    reason: MekEquipmentChoiceRejectionReason,
): MekEquipmentChoiceDispatchResult {
    return Object.freeze({ accepted: false, changed: false, reason });
}

function frozenEndTurnAllResult(
    accepted: boolean,
    changed: boolean,
    results: readonly CBTForceEndTurnUnitResult[],
): CBTForceEndTurnAllResult {
    return Object.freeze({
        accepted,
        changed,
        atomic: false,
        results: Object.freeze(results.map(result => Object.freeze({ ...result }))),
    });
}

function preflightFailureRows(
    retainedIds: readonly UnitInstanceId[],
    failedId: UnitInstanceId,
    reason: string,
): readonly CBTForceEndTurnUnitResult[] {
    return Object.freeze([
        ...retainedIds.map(instanceId => Object.freeze({
            instanceId,
            accepted: false,
            changed: false,
            reason: instanceId === failedId ? reason : 'PRECHECK_ABORTED',
        })),
    ]);
}
