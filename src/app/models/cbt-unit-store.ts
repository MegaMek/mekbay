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
import { type MekUnitRuntimeState } from './runtime/runtime-state';
import { CBTUnitService } from '../services/cbt-unit.service';
import { CBTMekUnit } from './runtime/cbt-mek-unit';
import { isCBTNonMekUnit, isCBTMekUnit, type CBTTargetingReconciliation, type CBTUnit } from './runtime/cbt-unit';
import { CBTNonMekUnit } from './runtime/cbt-non-mek-unit';
import { isSerializedNonMekUnit, type SerializedNonMekUnit } from './runtime/non-mek-unit-persistence';
import { jsonValuesEqual } from '../utils/json-value.util';
import type { UnitConditionKey } from './unit-condition.model';
import type { ScenarioRules } from './runtime/unit-state-initializer';
import { DEFAULT_FORCE_DEPLOYMENT_ID, scenarioRuleset } from './runtime/unit-state-initializer';
import type { CBTRuleset } from './cbt-ruleset.model';
import {
    canonicalizeCrewAssignment,
    CREW_ASSIGNMENT_SCHEMA_VERSION,
    type CrewAssignment,
    type CrewAssignmentPosition,
} from './runtime/crew-assignment';
import type { ComponentId } from './entity/entity-identifiers';
import type { MekEntity } from './entity/entities/mek/mek-entity';
import type { NonMekUnitCommand } from './runtime/non-mek-unit-instance';
import type {
    CBTUnitAttackerTargetingCommand,
    CBTUnitCommand,
    CBTUnitSelectedWeaponFireCommand,
} from './runtime/unit-instance';
import { evaluateMekRuntimeCapability } from './runtime/mek-runtime-capability';
import { cbtUnitMatchesEntity } from './runtime/cbt-unit-validation';
import { canPerformMekAction } from './runtime/mek-action-availability';
import type {
    EquipmentInteractionRegistry,
    HandlerCommandContext,
    HandlerQueryContext,
} from '../services/equipment-interaction-registry.service';
import { ToastService } from '../services/toast.service';
import { MAX_MEK_HEAT_VALUE_V2, type MekHeatAutomationPolicyV2 } from './runtime/mek-heat-state-v2';
import { currentUnitBaseBattleValue, pristineUnitBattleValue } from './cbt-force-battle-value';
import type { CBTUnitSnapshot } from './cbt-unit-snapshot';
import type { EquipmentRowOrderGroup } from './runtime/equipment-row-order';
import type { RuntimeCommandCheckpoint } from './runtime/runtime-command-session';
import { deploymentFromPersistence, scenarioRulesFromPersistence } from './runtime/cbt-force-scenario';
import { sameCBTUnitGameplayState } from './runtime/cbt-force-runtime-history';
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
} from './cbt-force.types';
import { entityTargetRosterRow, mekTargetRosterRow } from './runtime/cbt-force-target-roster';
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
import { pruneRemovedUnitsFromEncounter } from './runtime/cbt-force-persistence-helpers';

interface CBTUnitStoreState {
    readonly envelope: SerializedCBTForceV2;
    readonly units: ReadonlyMap<string, CBTUnit>;
    readonly scenario: ScenarioRules;
}

export interface RestoredCBTUnits {
    readonly envelope: SerializedCBTForceV2;
    readonly binding: CBTUnitStoreState;
    readonly warnings: readonly string[];
}

export interface CBTUnitStoreSnapshot {
    readonly binding: CBTUnitStoreState | null;
    readonly units: ReadonlyMap<string, CBTUnit>;
    readonly runtimeRevisions: ReadonlyMap<string, number>;
}

/** Owns the Entity + sparse runtime aggregate for each loaded CBT unit. */
export class CBTUnitStore {
    private binding: CBTUnitStoreState | null = null;
    public readonly c3 = new CBTForceC3(() => this.binding?.units ?? null);

    public constructor() {
        Object.seal(this);
    }

    public async restore(
        envelope: SerializedCBTForceV2,
        cbtUnits: CBTUnitService,
    ): Promise<RestoredCBTUnits> {
        const scenario = scenarioRulesFromPersistence(envelope.scenarioRules.values);
        const entries = envelope.units;
        const invalidStateUnitIds = new Set<string>();
        const warnings = new Set<string>();
        const restored = await Promise.all(entries.map(async entry => {
            try {
                return { entry, unit: await cbtUnits.restore(entry.unit, scenario) };
            } catch {
                invalidStateUnitIds.add(entry.instanceId);
                try {
                    const deployment = isSerializedNonMekUnit(entry.unit)
                        ? entry.unit.deployment.values
                        : deploymentFromPersistence(entry.unit.deployment.values);
                    const identity = entry.unit.entity;
                    return { entry, unit: await cbtUnits.create({
                        identity,
                        instanceId: entry.instanceId,
                        deployment,
                        scenario,
                    }) };
                } catch {
                    try {
                        const identity = entry.unit.entity;
                        return { entry, unit: await cbtUnits.create({
                            identity,
                            instanceId: entry.instanceId,
                            deployment: { id: DEFAULT_FORCE_DEPLOYMENT_ID },
                            scenario,
                        }) };
                    } catch {
                        warnings.add(`Unit "${entry.instanceId}" could not be identified and was skipped.`);
                        return { entry, unit: null };
                    }
                }
            }
        }));
        const units = new Map<string, CBTUnit>();
        const retainedEntries: typeof entries[number][] = [];
        restored.forEach(({ entry, unit }) => {
            if (unit === null) return;
            if (unit.instanceId !== entry.instanceId) {
                warnings.add(`Unit "${entry.instanceId}" resolved with an invalid identity and was skipped.`);
                return;
            }
            if (units.has(unit.instanceId)) {
                warnings.add(`Duplicate unit "${unit.instanceId}" was skipped.`);
                return;
            }
            units.set(unit.instanceId, unit);
            retainedEntries.push(entry);
        });
        const retainedUnitIds = new Set(retainedEntries.map(entry => entry.instanceId));
        const removedUnitIds = new Set(entries
            .filter(entry => !retainedUnitIds.has(entry.instanceId))
            .map(entry => entry.instanceId));
        const serializedUnits = new Map<string, SerializedCBTUnitV2 | SerializedNonMekUnit>();
        retainedEntries.forEach(entry => {
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
                invalidStateUnitIds.add(entry.instanceId);
            }
            serializedUnits.set(entry.instanceId, serialized);
        });
        const hydratedUnits = retainedEntries.map(entry => Object.freeze({
            ...entry,
            stateRevision: serializedUnits.get(entry.instanceId)!.stateRevision,
            unit: serializedUnits.get(entry.instanceId)!,
        }));
        for (const instanceId of invalidStateUnitIds) {
            if (!removedUnitIds.has(instanceId)) {
                warnings.add(`Unit "${instanceId}" had invalid saved state; that state was ignored.`);
            }
        }
        const roster = Object.freeze({
            ...envelope.roster,
            groups: Object.freeze(envelope.roster.groups.map(group => Object.freeze({
                ...group,
                members: Object.freeze(group.members.filter(member => !removedUnitIds.has(member.instanceId))),
            }))),
        });
        let hydratedEnvelope = await validateSerializedCBTForceV2({
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
            warnings.add('C3 network data was invalid and was ignored.');
            hydratedEnvelope = await validateSerializedCBTForceV2({
                ...hydratedEnvelope,
                encounter: Object.freeze({
                    ...hydratedEnvelope.encounter,
                    state: Object.freeze({
                        ...hydratedEnvelope.encounter.state,
                        facts: Object.freeze(hydratedEnvelope.encounter.state.facts.filter(
                            fact => fact.kind !== 'network',
                        )),
                    }),
                }),
            });
        }
        const nextBinding: CBTUnitStoreState = Object.freeze({
            envelope: hydratedEnvelope,
            units,
            scenario,
        });
        return Object.freeze({
            envelope: hydratedEnvelope,
            binding: nextBinding,
            warnings: Object.freeze([...warnings]),
        });
    }

    public install(restored: RestoredCBTUnits): void {
        this.binding = restored.binding;
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

    public liveUnits(): readonly CBTUnit[] {
        const binding = this.binding;
        if (!binding) throw new Error('The force has no installed CBT authority');
        const envelope = binding.envelope;
        const expected = envelope.units;
        if (expected.length !== binding.units.size
            || expected.some(entry => !binding.units.has(entry.instanceId))) {
            throw new Error('Live unit store coverage changed before persistence');
        }
        return Object.freeze(expected.map(entry => binding.units.get(entry.instanceId)!));
    }

    public cbtUnit(instanceId: string): CBTUnit | null {
        return this.binding?.units.get(instanceId) ?? null;
    }

    public mekUnit(instanceId: string): CBTMekUnit | null {
        const unit = this.cbtUnit(instanceId);
        return unit && isCBTMekUnit(unit) ? unit : null;
    }

    public nonMekUnit(instanceId: string): CBTNonMekUnit | null {
        const unit = this.cbtUnit(instanceId);
        return unit && isCBTNonMekUnit(unit) ? unit : null;
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

    /** Snapshot used only when work continues after the CBT owner queue is released. */
    public snapshot(): CBTUnitStoreSnapshot {
        const binding = this.binding;
        const live = binding ? [...binding.units.values()] : [];
        return Object.freeze({
            binding,
            units: new Map(live.map(unit => [unit.instanceId, unit] as const)),
            runtimeRevisions: new Map(live.map(unit => [
                unit.instanceId,
                unit.revision(),
            ] as const)),
        });
    }

    public isSnapshotCurrent(snapshot: CBTUnitStoreSnapshot): boolean {
        const binding = this.binding;
        if (binding !== snapshot.binding || (binding?.units.size ?? 0) !== snapshot.units.size) return false;
        for (const [instanceId, unit] of snapshot.units) {
            if (binding?.units.get(instanceId) !== unit
                || unit.revision() !== snapshot.runtimeRevisions.get(instanceId)) return false;
        }
        return true;
    }

    public add(
        envelope: SerializedCBTForceV2,
        candidate: CBTUnit,
    ): void {
        const existing = this.binding
            ? this.liveUnits()
            : Object.freeze([] as CBTUnit[]);
        if (existing.some(unit => unit.instanceId === candidate.instanceId)) {
            throw new Error(`V2 runtime ${candidate.instanceId} is already owned`);
        }

        const units = new Map<string, CBTUnit>(
            existing.map(unit => [unit.instanceId, unit] as const),
        );
        units.set(candidate.instanceId, candidate);
        this.setUnits(envelope, units);
    }

    public remove(
        envelope: SerializedCBTForceV2,
        instanceIds: readonly string[],
    ): void {
        if (!this.binding) throw new Error('The force has no installed V2 unit owner');
        const units = new Map(this.liveUnits().map(unit => [unit.instanceId, unit] as const));
        for (const instanceId of instanceIds) {
            if (!units.delete(instanceId)) throw new Error(`Ready V2 runtime ${instanceId} is not owned`);
        }
        this.setUnits(envelope, units);
    }

    public async buildRepairCandidates(
        instanceIds: readonly string[],
    ): Promise<ReadonlyMap<string, CBTUnit>> {
        const binding = this.binding;
        if (!binding) throw new Error('The force has no installed V2 unit owner');
        const units = new Map(this.liveUnits().map(unit => [unit.instanceId, unit] as const));
        const repaired = await Promise.all(instanceIds.map(async instanceId => {
            const current = units.get(instanceId);
            if (!current) throw new Error(`Ready V2 runtime ${instanceId} is not owned`);
            const candidate = isCBTMekUnit(current)
                ? await CBTMekUnit.repair(current, binding.scenario)
                : isCBTNonMekUnit(current)
                    ? CBTNonMekUnit.repair(current)
                    : null;
            if (candidate === null) throw new Error(`Unknown CBT runtime family ${instanceId}`);
            return sameCBTUnitGameplayState(current, candidate)
                ? null
                : [instanceId, candidate] as const;
        }));
        return new Map(repaired.filter((entry): entry is NonNullable<typeof entry> => entry !== null));
    }

    public async buildRuntimeCommandCandidates(
        checkpoint: RuntimeCommandCheckpoint,
    ): Promise<ReadonlyMap<string, CBTUnit>> {
        const binding = this.binding;
        if (!binding) throw new Error('The force has no installed CBT authority');
        const restored = await Promise.all(checkpoint.units.map(async row => {
            const current = binding.units.get(row.instanceId);
            if (!current) throw new Error(`Undo checkpoint references unknown unit ${row.instanceId}`);
            let candidate: CBTUnit;
            if (isSerializedNonMekUnit(row.unit)) {
                if (!isCBTNonMekUnit(current)) {
                    throw new Error(`Undo checkpoint family changed for ${row.instanceId}`);
                }
                candidate = CBTNonMekUnit.restore(
                    row.unit,
                    current.getUnit(),
                    current.getSourceRef(),
                    current.getNativeSource(),
                );
            } else {
                if (!isCBTMekUnit(current)) {
                    throw new Error(`Undo checkpoint family changed for ${row.instanceId}`);
                }
                candidate = await CBTMekUnit.restoreSnapshot(current, row.unit, binding.scenario);
            }
            if (!jsonValuesEqual(candidate.serialize(), row.unit)) {
                throw new Error(`Undo checkpoint could not be restored exactly for ${row.instanceId}`);
            }
            return [row.instanceId, candidate] as const;
        }));
        return new Map(restored);
    }

    public replace(
        envelope: SerializedCBTForceV2,
        replacements: ReadonlyMap<string, CBTUnit>,
    ): void {
        if (!this.binding) throw new Error('The force has no installed V2 unit owner');
        const units = new Map(this.liveUnits().map(unit => [unit.instanceId, unit] as const));
        for (const [instanceId, replacement] of replacements) {
            if (!units.has(instanceId) || replacement.instanceId !== instanceId) {
                throw new Error(`Repair candidate ${instanceId} is not owned`);
            }
            units.set(instanceId, replacement);
        }
        this.setUnits(envelope, units);
    }

    private setUnits(
        envelope: SerializedCBTForceV2,
        units: ReadonlyMap<string, CBTUnit>,
    ): void {
        if (envelope.units.length !== units.size
            || envelope.units.some(entry => !units.has(entry.instanceId))) {
            throw new Error('CBT envelope and installed units disagree');
        }
        this.binding = Object.freeze({
            envelope,
            units,
            scenario: scenarioRulesFromPersistence(envelope.scenarioRules.values),
        });
        this.c3.reset();
    }

    public instanceIds(): readonly string[] {
        return Object.freeze([...(this.binding?.units.keys() ?? [])]);
    }

    public ruleset(instanceId: string): CBTRuleset | null {
        const binding = this.binding;
        return binding?.units.has(instanceId) === true
            ? scenarioRuleset(binding.scenario)
            : null;
    }

    public scenarioRules(): ScenarioRules | null {
        return this.binding?.scenario ?? null;
    }

    public unitDestroyed(instanceId: string): boolean | null {
        const unit = this.cbtUnit(instanceId);
        return unit?.captureRuntime().query.destroyed() ?? null;
    }

    public unitCrewAssignment(instanceId: string): CrewAssignment | null {
        return this.cbtUnit(instanceId)?.getCrewAssignment() ?? null;
    }

    public unitConditions(instanceId: string): readonly UnitConditionKey[] | null {
        const unit = this.cbtUnit(instanceId);
        return unit?.captureRuntime().query.conditions() ?? null;
    }

    public unitCurrentBaseBattleValue(instanceId: string): number | null {
        const unit = this.cbtUnit(instanceId);
        return unit ? currentUnitBaseBattleValue(unit) : null;
    }

    public unitPristineBattleValue(instanceId: string): number | null {
        const unit = this.cbtUnit(instanceId);
        return unit ? pristineUnitBattleValue(unit) : null;
    }

    public unitSnapshot(instanceId: string): CBTUnitSnapshot | null {
        const unit = this.cbtUnit(instanceId);
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
        instanceId: string,
        command: NonMekUnitCommand,
        forceReadOnly: boolean,
    ): CBTNonMekUnitCommandResult {
        const unit = this.nonMekUnit(instanceId);
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
        instanceId: string,
        command: CBTUnitCommand,
        forceReadOnly: boolean,
    ): CBTMekUnitCommandResult {
        const unit = this.mekUnit(instanceId);
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
        instanceId: string,
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
        instanceId: string,
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
        instanceId: string,
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
        instanceId: string,
        command: CBTUnitSelectedWeaponFireCommand,
        registry: TargetRegistrySnapshot,
        networks: readonly EncounterNetwork[],
        forceReadOnly: boolean,
    ): SelectedWeaponFireCommandResult {
        const binding = this.binding;
        const unit = this.cbtUnit(instanceId);
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
    ): readonly CBTTargetingReconciliation[] {
        const plans: CBTTargetingReconciliation[] = [];
        for (const unit of this.binding?.units.values() ?? []) {
            const plan = unit.planTargetingReconciliation(registry);
            if (plan !== null) plans.push(plan);
        }
        return Object.freeze(plans);
    }

    /** Installs plans prepared immediately before the synchronous registry commit. */
    public installTargetingReconciliation(
        prepared: readonly CBTTargetingReconciliation[],
    ): void {
        for (const plan of prepared) plan.install();
    }

    public targetRoster(forceInstanceId: string): readonly InventoryControlTargetRosterRow[] {
        return Object.freeze([...(this.binding?.units.values() ?? [])]
            .flatMap(unit => isCBTMekUnit(unit)
                ? [mekTargetRosterRow(forceInstanceId, unit)]
                : isCBTNonMekUnit(unit)
                    ? [entityTargetRosterRow(forceInstanceId, unit)]
                    : []));
    }

    public crewProfile(instanceId: string): CrewAssignment | null {
        return this.binding?.units.get(instanceId)?.getCrewAssignment() ?? null;
    }

    public async replaceCrewProfile(
        instanceId: string,
        positions: readonly CrewAssignmentPosition[],
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

        let replacement: CBTUnit;
        try {
            if (isCBTMekUnit(current)) {
                replacement = await CBTMekUnit.redeployCrew(
                    current,
                    assignment,
                    binding.scenario,
                );
            } else if (isCBTNonMekUnit(current)) {
                replacement = CBTNonMekUnit.redeploy(current, assignment);
            } else {
                throw new Error(`Unknown CBT runtime family ${instanceId}`);
            }
            // Force the exact persistence codec before installing the candidate.
            const serialized = replacement.serialize();
            if (replacement.instanceId !== instanceId
                || serialized.instanceId !== instanceId
                || serialized.stateRevision !== replacement.revision()
                || replacement.getUnit() !== current.getUnit()
                || !cbtUnitMatchesEntity(replacement, current.getUnit())) {
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
            if (!isCBTMekUnit(unit)) continue;
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

    public equipmentChoiceInstanceId(token: MekEquipmentChoiceToken): string | null {
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
        if (!owner || !candidate || !isCBTMekUnit(candidate)) return rejectedEquipmentChoice('OWNER_CHANGED');
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
        const retained: Array<readonly [string, CBTUnit]> = owner
            ? [...owner.units].flatMap(([instanceId, unit]) =>
                isCBTMekUnit(unit) || isCBTNonMekUnit(unit)
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

        const selectedPolicy = retained.some(([, unit]) => isCBTMekUnit(unit))
            ? policy()
            : 'automatic';
        for (const [instanceId, unit] of retained) {
            if (!isCBTMekUnit(unit)) continue;
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
            isCBTMekUnit(unit)
                ? [[instanceId, this.c3.planEmergencyMasterEndTurn(instanceId, configuredNetworks)] as const]
                : []));
        const results: CBTForceEndTurnUnitResult[] = [];
        let v2Changed = false;
        for (const [instanceId, unit] of retained) {
            const before = unit.revision();
            let accepted = false;
            let reason: string | undefined;
            try {
                const reduction = isCBTMekUnit(unit)
                    ? unit.endTurn(selectedPolicy)
                    : isCBTNonMekUnit(unit)
                        ? unit.endTurn()
                        : null;
                if (reduction === null) throw new Error('Unsupported CBT unit family');
                accepted = reduction.accepted;
            } catch (error) {
                reason = error instanceof Error ? error.message : 'Retained V2 end-turn failed';
            }
            const c3 = accepted && isCBTMekUnit(unit)
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
                if (!reconciled.changedUnitIds.includes(row.instanceId)) continue;
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
    retainedIds: readonly string[],
    failedId: string,
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
