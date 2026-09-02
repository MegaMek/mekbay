// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed, type Injector } from '@angular/core';
import type { DataService } from '../services/data.service';
import { forceMemberAdjustedValue, type CBTForceMember, type ForceMember } from './force-member.model';
import type { SerializedCBTForce, SerializedForce } from './force-serialization';
import { GameSystem } from './common.model';
import type { UnitConditionKey } from './unit-condition.model';
import {
    Force,
    MAX_UNITS,
    resolveSerializedFormation,
    UnitGroup,
    type CBTForceMutation,
    type ForceOwnerRevisionFence,
    type ForceGroupPatch,
    type RestoredCBTForce,
} from './force.model';
import {
    CBTEncounterC3State,
    reduceTargetRegistry,
    type CBTEncounterSnapshot,
    type EncounterNetwork,
    type TargetRegistryCommand,
    type TargetRegistryCommandResult,
    type TargetRegistrySnapshot,
} from './runtime/encounter-runtime';
import {
    validateSerializedCBTForceV2,
    type SerializedCBTEncounterStateV2,
    type SerializedCBTForceV2,
} from './runtime/persistence-v2';
import { createUnitInstanceId } from './runtime/runtime-state';
import { CBTUnitService } from '../services/cbt-unit.service';
import { CBTMekUnit } from './runtime/cbt-mek-unit';
import { CBTNonMekUnit } from './runtime/cbt-non-mek-unit';
import { isCBTMekUnit, isCBTNonMekUnit, type CBTUnit } from './runtime/cbt-unit';
import { jsonValuesEqual } from '../utils/json-value.util';
import type { C3UnitPosition } from './c3-network.model';
import {
    prepareCBTForcePersistenceV2 as prepareCurrentCBTForcePersistenceV2,
    prepareDirectUnitAdmission,
    type PreparedCBTForcePersistenceV2,
} from './runtime/force-persistence-boundary';
import {
    scenarioRulesFromOptions,
    type DeploymentConfiguration,
    type ScenarioRules,
} from './runtime/unit-state-initializer';
import type { ComponentId } from './entity/entity-identifiers';
import type { NonMekUnitCommand } from './runtime/non-mek-unit-instance';
import type {
    CBTUnitAttackerTargetingCommand,
    CBTUnitCommand,
    CBTUnitSelectedWeaponFireCommand,
} from './runtime/unit-instance';
import { evaluateCBTMekRuntimeCapability } from './runtime/cbt-unit-validation';
import { type CrewAssignment, type CrewAssignmentPosition } from './runtime/crew-assignment';
import type { UnitUuid } from '../services/unit-catalog/unit-catalog.types';
import { uuidv7 } from '../utils/uuid.util';
import { EquipmentInteractionRegistry } from '../services/equipment-interaction-registry.service';
import type { EquipmentInteractionQueryContext } from './runtime/equipment-interaction';
import { ToastService } from '../services/toast.service';
import { DialogsService } from '../services/dialogs.service';
import { OptionsService } from '../services/options.service';
import type { CBTOptionalRules } from './options.model';
import type { MekHeatAutomationPolicyV2 } from './runtime/mek-heat-state-v2';
import {
    prepareCBTForceRosterMutationPlan,
    type CBTForceRosterQueryResult,
    type CBTForceRosterCommand,
    type CBTForceRosterCommandResult,
    type CBTForceRosterCommandRejection,
    type CBTForceRosterGroupMetadataPatch,
    type CBTForceRosterMutationPlanResult,
} from './runtime/cbt-force-roster-owner';
import { calculateCBTForceBattleValues, type CBTForceBattleValueBreakdown } from './cbt-force-battle-value';
import { hasNonMekRuntime, hasMekRuntime, type CBTUnitSnapshot } from './cbt-unit-snapshot';
import { CBTUnitStore, type CBTUnitStoreSnapshot } from './cbt-unit-store';
import { publishC3EmergencyMasterNotices } from './cbt-force-c3';
import { CBT_FORCE_UNASSIGNED_GROUP_ID, queryCBTForceRoster } from './runtime/cbt-force-roster';
import {
    projectMekRecordSheet,
    projectMekUnitStatus,
    type MekRecordSheetSnapshot,
    type MekUnitStatusSnapshot,
} from './runtime/mek-record-sheet';
import { projectNonMekRecordSheet, type NonMekRecordSheetSnapshot } from './runtime/non-mek-record-sheet';
import { projectMekEquipmentPanel, type EquipmentPanelSnapshot } from './runtime/equipment-panel';
import { projectNonMekEquipmentPanel } from './runtime/non-mek-equipment-panel';
import type { EquipmentRowOrderGroup } from './runtime/equipment-row-order';
import {
    RUNTIME_HISTORY_MESSAGE,
    runtimeHistoryMessageUnitId,
    type RuntimeHistoryTargetKind,
} from './runtime/runtime-history';
import {
    captureMekComponentModes,
    changedComponentModeHistory,
    crewProfileHistory,
    nonMekCommandBoundary,
    nonMekCommandHistory,
    forceHistory,
    historyCrewLabel,
    historyTargetLabel,
    mekCommandBoundary,
    mekCommandHistory,
    selectedWeaponFireHistory,
    unitHistory,
    type RuntimeHistoryInput,
} from './runtime/cbt-force-runtime-history';
import { CBTForceSession, type CapturedRuntimeCommandMutation } from './runtime/cbt-force-session';
import { projectMekTurnPanel, type MekTurnPanelSnapshot } from './runtime/mek-turn-panel';
import { CBTForceMemberRegistry } from './runtime/cbt-force-member-registry';
import { CBTForceMekMutationImpact } from './runtime/cbt-force-mek-mutation-impact';
import { CBTForceUnitCommandDispatcher } from './runtime/cbt-force-unit-command-dispatcher';
import {
    nextForceRevision,
    pruneRemovedUnitsFromEncounter,
    remapCBTForceCloneEnvelope,
} from './runtime/cbt-force-persistence-helpers';
import { authorizeCBTForceTargetRegistryCommand } from './cbt-force-target-registry';
import { readOnlyTargetRegistry } from './runtime/encounter-runtime';

import type {
    AttackerTargetingCommandResult,
    AttackerTargetingSnapshot,
    CBTDirectUnitAdmissionRequest,
    CBTDirectUnitAdmissionResult,
    CBTForceEndTurnAllResult,
    CBTForceTargetRegistryAuthority,
    CBTMekUnitCommandResult,
    CBTNonMekUnitCommandResult,
    CBTUnitRepairResult,
    CBTUnitTransferResult,
    C3State,
    InventoryControlTargetRosterRow,
    CBTEquipmentChoiceCommand,
    CBTEquipmentChoiceDispatchResult,
    CBTEquipmentInteraction,
    RuntimeUndoCommandResult,
    SelectedWeaponFireCommandResult,
} from './cbt-force.types';


type PreparedCBTForcePersistenceWithFence = PreparedCBTForcePersistenceV2 & Readonly<{
    unitStoreSnapshot: CBTUnitStoreSnapshot;
}>;

function withUnitStoreSnapshot(
    prepared: PreparedCBTForcePersistenceV2,
    unitStoreSnapshot: CBTUnitStoreSnapshot,
): PreparedCBTForcePersistenceWithFence {
    return Object.freeze({ ...prepared, unitStoreSnapshot });
}


export class CBTForce extends Force<never> {
    override gameSystem: GameSystem = GameSystem.CBT;
    public override hasEmptyGroups = computed(() => {
        this.groups();
        return this.getSupportedCBTForceV2Envelope()?.roster.groups.some(
            group => group.members.length === 0,
        ) ?? false;
    });
    public override totalBv = computed(() => {
        return this.getCBTMembers().reduce(
            (total, member) => total + forceMemberAdjustedValue(member, 'damaged'),
            0,
        );
    });
    private readonly unitStore = new CBTUnitStore();
    private readonly session = new CBTForceSession(this.unitStore);
    private readonly c3Encounter = new CBTEncounterC3State();
    /** Reactive invalidation token for force-owned target queries. */
    readonly targetRegistryVersion = this.session.targetRegistryVersion;
    readonly inventoryControlOpforEnabled = this.session.opforEnabled;
    readonly sessionChanged = this.session.changed;
    private readonly memberRegistry = new CBTForceMemberRegistry(
        this,
        instanceId => this.unitStore.cbtUnit(instanceId),
    );
    private readonly mekMutationImpact = new CBTForceMekMutationImpact();
    private readonly unitCommandDispatcher: CBTForceUnitCommandDispatcher;
    private readonly adjustedBattleValues = computed(() => {
        this.memberRegistry.dependOnBattleValueInputs();
        return this.calculateAdjustedBattleValues(
            this.c3Encounter.snapshot().networks,
            'damaged',
        );
    });
    private readonly pristineAdjustedBattleValues = computed(() => {
        this.memberRegistry.dependOnBattleValueInputs();
        return this.calculateAdjustedBattleValues(
            this.c3Encounter.snapshot().networks,
            'pristine',
        );
    });

    private calculateAdjustedBattleValues(
        networks: readonly EncounterNetwork[],
        damageMode: 'damaged' | 'pristine',
    ): ReadonlyMap<string, CBTForceBattleValueBreakdown> {
        const scenario = this.unitStore.scenarioRules();
        if (!scenario) return new Map<string, CBTForceBattleValueBreakdown>();
        const units = this.getCBTMembers().flatMap(member => {
            const unit = this.unitStore.cbtUnit(member.id);
            return unit
                ? [{
                    unit,
                    baseBattleValue: damageMode === 'damaged'
                        ? member.currentBaseBattleValue()
                        : member.pristineBattleValue(),
                }]
                : [];
        });
        return calculateCBTForceBattleValues({
            units,
            scenario,
            networks,
            isC3EndpointIntact: (instanceId, componentId) =>
                this.unitStore.c3.isEndpointIntact(instanceId, componentId),
        });
    }
    constructor(name: string,
        dataService: DataService,
        injector: Injector) {
        super(name, dataService, injector);
        this.unitCommandDispatcher = new CBTForceUnitCommandDispatcher(this, injector, {
            readOnly: () => this.readOnly(),
            instanceIds: () => this.unitStore.instanceIds(),
            snapshot: instanceId => this.getUnitSnapshot(instanceId),
            heatPolicy: () => this.currentHeatPolicy(),
            dispatchMekCore: (instanceId, command) =>
                this.dispatchMekUnitCommandCore(instanceId, command),
            dispatchNonMekCore: (instanceId, command) =>
                this.dispatchNonMekUnitCommandCore(instanceId, command),
            endTurnForAllCore: () => this.endTurnForAllUnitsCore(),
        });
    }

    protected override getSupportedCBTForceV2Envelope(): SerializedCBTForceV2 | null {
        return this.unitStore.envelope();
    }

    /** Canonical detached roster membership. */
    public queryCanonicalRoster(): CBTForceRosterQueryResult {
        const envelope = this.getSupportedCBTForceV2Envelope();
        if (!envelope) {
            return Object.freeze({
                kind: 'unavailable',
                reason: 'NO_CANONICAL_ROSTER',
                message: 'The force has no validated canonical roster envelope',
            });
        }
        try {
            const unitIds = new Set(envelope.units.map(entry => entry.instanceId));
            for (const unit of this.unitStore.liveUnits()) {
                if (!unitIds.has(unit.instanceId)) {
                    throw new Error(`Ready runtime ${unit.instanceId} is absent from the canonical roster`);
                }
            }
            const snapshot = queryCBTForceRoster({
                forceId: envelope.forceId,
                forceRevision: envelope.forceRevision,
                roster: envelope.roster,
            });
            return Object.freeze({
                kind: 'available',
                snapshot,
            });
        } catch (error) {
            return Object.freeze({
                kind: 'unavailable',
                reason: 'RUNTIME_TOPOLOGY_DRIFT',
                message: errorMessage(error),
            });
        }
    }

    private refreshForceMemberDependencies(
        changedUnitIds: readonly string[] | null = null,
        baseBattleValueChangedUnitIds: readonly string[] | null = changedUnitIds,
        runtimeForceInputsChanged = true,
        runtimeOperationalC3InputsChanged = true,
    ): void {
        this.memberRegistry.refresh(
            this.getSupportedCBTForceV2Envelope(),
            this.c3Encounter.snapshot().networks,
            this.unitStore.scenarioRules(),
            changedUnitIds,
            baseBattleValueChangedUnitIds,
            runtimeForceInputsChanged,
            runtimeOperationalC3InputsChanged,
        );
    }

    /** One force-owned presentation handle for each currently resolvable roster member. */
    public getCBTMembers(): readonly CBTForceMember[] {
        return this.memberRegistry.members();
    }

    protected override projectMembers(): ForceMember[] {
        this.groups();
        return [...this.getCBTMembers()];
    }

    protected override projectMembersInGroup(group: UnitGroup): ForceMember[] {
        if (group.force !== this || !this.groups().includes(group as UnitGroup<never>)) return [];
        return this.getCBTMembers().filter(member => member.rosterGroupId === group.id);
    }

    public getCBTMember(instanceId: string): CBTForceMember | null {
        return this.memberRegistry.member(instanceId);
    }

    public getRosterGroupId(instanceId: string): string | null {
        const envelope = this.getSupportedCBTForceV2Envelope();
        if (!envelope) return null;
        for (const group of envelope.roster.groups) {
            if (group.members.some(member => member.instanceId === instanceId)) return group.groupId;
        }
        return null;
    }

    public override getFormationUnitsForGroup(group: UnitGroup): readonly CBTForceMember[] {
        if (group.force !== this || !this.groups().includes(group as UnitGroup<never>)) return Object.freeze([]);
        return Object.freeze(this.getCBTMembers().filter(member => member.rosterGroupId === group.id));
    }

    /** Creates a real roster group; the returned UnitGroup is only its UI handle. */
    public override async addGroup(name?: string): Promise<UnitGroup<never>> {
        if (!this.getSupportedCBTForceV2Envelope()) await this.serializeForPersistence();
        const envelope = this.getSupportedCBTForceV2Envelope();
        if (!envelope) throw new Error('The canonical CBT force owner could not be initialized');
        const groupId = uuidv7();
        const result = await this.dispatchCanonicalRosterCommand({
            kind: 'create-group',
            groupId,
            atIndex: envelope.roster.groups.filter(
                group => group.groupId !== CBT_FORCE_UNASSIGNED_GROUP_ID,
            ).length,
            ...(name?.trim() ? { metadata: { name } } : {}),
        });
        if (!result.accepted) throw new Error(`CBT roster group creation failed: ${result.reason}`);
        const group = this.groups().find(candidate => candidate.id === groupId);
        if (!group) throw new Error(`Created CBT roster group ${groupId} has no UI projection`);
        return group;
    }

    public updateRosterGroup(
        group: UnitGroup,
        patch: CBTForceRosterGroupMetadataPatch,
    ): Promise<CBTForceRosterCommandResult> {
        if (group.force !== this || !this.groups().includes(group as UnitGroup<never>)) {
            return Promise.resolve(rejectedRosterCommand('UNKNOWN_GROUP'));
        }
        return this.dispatchCanonicalRosterCommand({ kind: 'update-group', groupId: group.id, patch });
    }

    public override async updateGroup(
        group: UnitGroup<never>,
        patch: ForceGroupPatch,
    ): Promise<boolean> {
        const canonical: {
            name?: string | null;
            color?: string | null;
            formationId?: string | null;
            formationTargetGroupId?: string | null;
            formationLock?: boolean;
        } = {};
        if (Object.prototype.hasOwnProperty.call(patch, 'name')) canonical.name = patch.name ?? null;
        if (Object.prototype.hasOwnProperty.call(patch, 'color')) canonical.color = patch.color ?? null;
        if (Object.prototype.hasOwnProperty.call(patch, 'formation')) {
            canonical.formationId = patch.formation?.id ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'formationTargetGroupId')) {
            canonical.formationTargetGroupId = patch.formationTargetGroupId ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'formationLock')) {
            canonical.formationLock = patch.formationLock === true;
        }
        return (await this.updateRosterGroup(group, canonical)).accepted;
    }

    public reorderRosterGroup(fromIndex: number, toIndex: number): Promise<CBTForceRosterCommandResult> {
        const group = this.groups()[fromIndex];
        if (!group || toIndex < 0 || toIndex >= this.groups().length) {
            return Promise.resolve(rejectedRosterCommand('INVALID_POSITION'));
        }
        return this.dispatchCanonicalRosterCommand({
            kind: 'reorder-group',
            groupId: group.id,
            atIndex: toIndex,
        });
    }

    public removeRosterGroup(
        group: UnitGroup,
        relocateMembersToGroupId?: string,
        removeMembers = false,
    ): Promise<CBTForceRosterCommandResult> {
        if (group.force !== this || !this.groups().includes(group as UnitGroup<never>)) {
            return Promise.resolve(rejectedRosterCommand('UNKNOWN_GROUP'));
        }
        return this.dispatchCanonicalRosterCommand({
            kind: 'delete-group',
            groupId: group.id,
            ...(relocateMembersToGroupId === undefined ? {} : { relocateMembersToGroupId }),
            ...(removeMembers ? { removeMembers: true } : {}),
        });
    }

    public override async reorderGroup(fromIndex: number, toIndex: number): Promise<boolean> {
        return (await this.reorderRosterGroup(fromIndex, toIndex)).accepted;
    }

    public override async removeGroup(
        group: UnitGroup<never>,
        relocateUnits = false,
    ): Promise<boolean> {
        let relocateMembersToGroupId: string | undefined;
        if (relocateUnits) {
            const groups = this.groups().filter(candidate => candidate !== group);
            relocateMembersToGroupId = groups.at(-1)?.id;
            if (relocateMembersToGroupId === undefined) return false;
        }
        return (await this.removeRosterGroup(group, relocateMembersToGroupId, !relocateUnits)).accepted;
    }

    public moveMember(
        instanceId: string,
        targetGroupId: string,
        atIndex: number,
    ): Promise<CBTForceRosterCommandResult> {
        return this.dispatchCanonicalRosterCommand({
            kind: 'move-member',
            instanceId,
            targetGroupId,
            atIndex,
        });
    }

    public removeCBTMember(instanceId: string): Promise<CBTForceRosterCommandResult> {
        return this.dispatchCanonicalRosterCommand({ kind: 'remove-member', instanceId });
    }

    public repairMember(instanceId: string): Promise<CBTUnitRepairResult> {
        return this.repairMembers([instanceId]);
    }

    public repairAllMembers(): Promise<CBTUnitRepairResult> {
        return this.repairMembers(null);
    }

    /**
     * Rebinds force-owned Mek mechanics to the current bounded application
     * options. Runtime wrappers and persistence are replaced in one authority
     * commit, so no unit can observe mixed scenario rules.
     */
    public synchronizeOptionalRules(
        rules: Pick<CBTOptionalRules, 'forcedWithdrawal' | 'sprinting'>,
    ): Promise<boolean> {
        const requested = Object.freeze({
            forcedWithdrawal: rules.forcedWithdrawal,
            sprinting: rules.sprinting,
        });
        return this.enqueueCBTMutation(async () => {
            if (this.readOnly()) return false;
            const context = this.beginCBTForceMutation();
            const current = context.previous;
            if (!current) return false;

            const previousScenario = this.unitStore.scenarioRules();
            if (!previousScenario) return false;
            const scenario: ScenarioRules = Object.freeze({
                ...previousScenario,
                options: Object.freeze({
                    ...(previousScenario.options ?? {}),
                    ...requested,
                }),
            });
            if (previousScenario.options?.['forcedWithdrawal'] === requested.forcedWithdrawal
                && previousScenario.options?.['sprinting'] === requested.sprinting) return false;

            let replacements: ReadonlyMap<string, CBTUnit>;
            try {
                const rows = await Promise.all(this.unitStore.liveUnits().flatMap<
                    Promise<readonly [string, CBTUnit]>
                >(unit =>
                    isCBTMekUnit(unit)
                        ? [CBTMekUnit.cloneForOwner(unit, scenario).then(candidate => {
                            const movement = candidate.getInstance().query().mekMovementPsr();
                            if (movement.kind === 'unsupported') {
                                throw new Error('Scenario rebinding made Mek movement unsupported');
                            }
                            if (candidate.getInstance().snapshot().movementPsr.movement?.mode === 'sprint') {
                                if (movement.declaration?.legal !== true) {
                                    const cleared = candidate.getInstance().dispatch({
                                        type: 'clear-mek-movement',
                                    });
                                    if (!cleared.accepted) throw new Error('Invalid restored Sprint could not be cleared');
                                } else if (candidate.getInstance().query().turnState().spotting) {
                                    const turn = candidate.getInstance().query().turnState();
                                    const cleared = candidate.getInstance().dispatch({
                                        type: 'replace-turn-state',
                                        turn: { ...turn, spotting: false },
                                    });
                                    if (!cleared.accepted) throw new Error('Restored Sprint spotting could not be cleared');
                                }
                            }
                            return [unit.instanceId, candidate] as const;
                        })]
                        : isCBTNonMekUnit(unit)
                            ? [Promise.resolve([
                                unit.instanceId,
                                CBTNonMekUnit.cloneForOwner(unit, scenario),
                            ] as const)]
                            : []));
                replacements = new Map(rows);
            } catch {
                return false;
            }

            let envelope = current;
            try {
                const units = current.units.map(entry => {
                    const ready = replacements.get(entry.instanceId)
                        ?? this.unitStore.cbtUnit(entry.instanceId);
                    if (!ready) throw new Error(`Scenario rebinding lost runtime ${entry.instanceId}`);
                    const unit = ready.serialize();
                    return jsonValuesEqual(unit, entry.unit)
                        ? entry
                        : Object.freeze({
                            instanceId: entry.instanceId,
                            stateRevision: unit.stateRevision,
                            unit,
                        });
                });
                if (units.some((entry, index) => entry !== current.units[index])) {
                    envelope = await validateSerializedCBTForceV2({
                        ...current,
                        forceRevision: nextForceRevision(current.forceRevision),
                        units,
                    });
                }
            } catch {
                return false;
            }

            const prepared: PreparedCBTForcePersistenceV2 = Object.freeze({ envelope, reused: false });
            this.commitCBTForceMutation(
                context,
                prepared,
                () => this.unitStore.replace(envelope, replacements, scenario),
            );
            this.emitChangedFromReservedIntent(Object.freeze([...replacements.keys()]));
            return true;
        });
    }

    private repairMembers(
        requestedInstanceIds: readonly string[] | null,
    ): Promise<CBTUnitRepairResult> {
        const capturedIds = requestedInstanceIds === null
            ? null
            : Object.freeze([...requestedInstanceIds]);
        return this.enqueueCBTMutation(async () => {
            if (this.readOnly()) return rejectedUnitRepair('READ_ONLY');
            const context = this.beginCBTForceMutation();
            const current = context.previous;
            if (!current) return rejectedUnitRepair('NOT_READY');
            const readyIds = current.units.map(entry => entry.instanceId);
            const readyIdSet = new Set(readyIds);
            const instanceIds = capturedIds ?? readyIds;
            if (instanceIds.some(instanceId => !readyIdSet.has(instanceId))) {
                return rejectedUnitRepair('NOT_READY');
            }
            if (instanceIds.length === 0) {
                return Object.freeze({
                    accepted: true as const,
                    changed: false,
                    forceRevision: current.forceRevision,
                });
            }

            let replacements: ReadonlyMap<string, CBTUnit>;
            try {
                replacements = await this.unitStore.buildRepairCandidates(instanceIds);
            } catch {
                return rejectedUnitRepair('REPAIR_FAILED');
            }
            if (replacements.size === 0) {
                return Object.freeze({
                    accepted: true as const,
                    changed: false,
                    forceRevision: current.forceRevision,
                });
            }
            const capture = this.captureRuntimeCommandMutation(instanceIds);

            let envelope: SerializedCBTForceV2;
            try {
                const repaired = new Map([...replacements].map(([instanceId, unit]) => [
                    instanceId,
                    unit.serialize(),
                ] as const));
                envelope = await validateSerializedCBTForceV2({
                    ...current,
                    forceRevision: nextForceRevision(current.forceRevision),
                    units: current.units.map(entry => {
                        const unit = repaired.get(entry.instanceId);
                        return unit
                            ? { ...entry, stateRevision: unit.stateRevision, unit }
                            : entry;
                    }),
                });
            } catch {
                return rejectedUnitRepair('PERSISTENCE_REJECTED');
            }

            const prepared: PreparedCBTForcePersistenceV2 = Object.freeze({ envelope, reused: false });
            this.commitCBTForceMutation(
                context,
                prepared,
                () => this.unitStore.replace(envelope, replacements),
            );
            const changedUnitIds = this.recordRuntimeCommandMutation(capture, instanceIds.length === 1
                ? unitHistory(RUNTIME_HISTORY_MESSAGE.UNIT_REPAIRED, instanceIds[0]!)
                : forceHistory(RUNTIME_HISTORY_MESSAGE.FORCE_ACTION, 'repair-units'));
            this.emitChangedFromReservedIntent(changedUnitIds.length > 0 ? changedUnitIds : instanceIds);
            return Object.freeze({
                accepted: true as const,
                changed: true,
                forceRevision: envelope.forceRevision,
            });
        });
    }

    /** Moves one ready runtime between two force owners in one paired commit. */
    public transferMemberTo(
        target: CBTForce,
        instanceId: string,
        targetGroupId: string,
        atIndex: number,
    ): Promise<CBTUnitTransferResult> {
        if (target === this) return Promise.resolve(rejectedUnitTransfer('SAME_FORCE'));
        const sourceId = this.getSupportedCBTForceV2Envelope()?.forceId;
        const targetId = target.getSupportedCBTForceV2Envelope()?.forceId;
        if (!sourceId || !targetId) return Promise.resolve(rejectedUnitTransfer('NOT_READY'));
        if (sourceId === targetId) return Promise.resolve(rejectedUnitTransfer('INSTANCE_ID_COLLISION'));

        const run = () => this.transferMemberToNow(target, instanceId, targetGroupId, atIndex);
        return sourceId < targetId
            ? this.enqueueCBTMutation(() => target.enqueueCBTMutation(run))
            : target.enqueueCBTMutation(() => this.enqueueCBTMutation(run));
    }

    private async transferMemberToNow(
        target: CBTForce,
        instanceId: string,
        targetGroupId: string,
        atIndex: number,
    ): Promise<CBTUnitTransferResult> {
        if (this.readOnly() || target.readOnly()) return rejectedUnitTransfer('READ_ONLY');
        const sourceContext = this.beginCBTForceMutation();
        const targetContext = target.beginCBTForceMutation();
        const source = sourceContext.previous;
        const destination = targetContext.previous;
        if (!source || !destination) return rejectedUnitTransfer('NOT_READY');
        if (!target.groups().some(group => group.id === targetGroupId)) {
            return rejectedUnitTransfer('UNKNOWN_GROUP');
        }
        if (destination.units.length >= MAX_UNITS) return rejectedUnitTransfer('FORCE_FULL');
        if (destination.units.some(entry => entry.instanceId === instanceId)) {
            return rejectedUnitTransfer('INSTANCE_ID_COLLISION');
        }
        const sourceRosterMember = source.roster.groups
            .flatMap(group => group.members)
            .find(member => member.instanceId === instanceId);
        const sourceUnit = this.unitStore.cbtUnit(instanceId);
        if (!sourceRosterMember || !sourceUnit) {
            return rejectedUnitTransfer('NOT_READY');
        }

        const destinationScenario = target.unitStore.scenarioRules();
        if (!destinationScenario) return rejectedUnitTransfer('NOT_READY');
        let candidate: CBTUnit;
        try {
            candidate = isCBTMekUnit(sourceUnit)
                ? await CBTMekUnit.cloneForOwner(sourceUnit, destinationScenario)
                : isCBTNonMekUnit(sourceUnit)
                    ? CBTNonMekUnit.cloneForOwner(sourceUnit, destinationScenario)
                    : sourceUnit;
            const targeting = candidate.planTargetingReconciliation(
                target.queryInventoryControlTargetRegistry(),
            );
            targeting?.();
        } catch {
            return rejectedUnitTransfer('PERSISTENCE_REJECTED');
        }

        const removal = this.prepareCanonicalRosterMutation({ kind: 'remove-member', instanceId });
        if (removal?.kind !== 'ready') return rejectedUnitTransfer('FORCE_CHANGED');
        let sourceEnvelope: SerializedCBTForceV2;
        let targetEnvelope: SerializedCBTForceV2;
        try {
            const removed = new Set<string>(removal.plan.removedInstanceIds ?? [instanceId]);
            sourceEnvelope = await validateSerializedCBTForceV2({
                ...source,
                forceRevision: nextForceRevision(source.forceRevision),
                units: source.units.filter(entry => !removed.has(entry.instanceId)),
                roster: removal.plan.nextRoster,
                encounter: pruneRemovedUnitsFromEncounter(source.encounter, removed),
            });
            const admitted = await prepareDirectUnitAdmission({
                forceId: destination.forceId,
                previous: destination,
                liveUnits: target.unitStore.liveUnits(),
                candidate,
                ...(targetContext.typedEncounterState === undefined
                    ? {}
                    : { typedEncounterState: targetContext.typedEncounterState }),
                targetRosterGroupId: targetGroupId,
                targetRosterMemberIndex: atIndex,
                ...(sourceRosterMember.commander === true ? { commander: true } : {}),
            });
            if (admitted.kind === 'read-only') {
                return rejectedUnitTransfer(
                    admitted.code === 'INSTANCE_ID_COLLISION'
                        ? 'INSTANCE_ID_COLLISION'
                        : 'PERSISTENCE_REJECTED',
                );
            }
            targetEnvelope = admitted.envelope;
            const targetEntry = targetEnvelope.units.find(entry => entry.instanceId === instanceId);
            if (!targetEntry || !jsonValuesEqual(targetEntry.unit, candidate.serialize())) {
                return rejectedUnitTransfer('PERSISTENCE_REJECTED');
            }
        } catch {
            return rejectedUnitTransfer('PERSISTENCE_REJECTED');
        }

        this.commitPairedCBTForceMutations(
            target,
            {
                mutation: sourceContext,
                prepared: Object.freeze({ envelope: sourceEnvelope, reused: false }),
                install: () => this.unitStore.remove(sourceEnvelope, [instanceId]),
            },
            {
                mutation: targetContext,
                prepared: Object.freeze({ envelope: targetEnvelope, reused: false }),
                install: () => target.unitStore.add(targetEnvelope, candidate, destinationScenario),
            },
        );
        this.session.prune(new Set(removal.plan.removedInstanceIds ?? [instanceId]));
        this.reconcileCBTForceV2Projection();
        target.reconcileCBTForceV2Projection();
        this.emitChangedFromReservedIntent();
        target.emitChangedFromReservedIntent();
        return Object.freeze({ accepted: true, changed: true, instanceId });
    }

    protected prepareCanonicalRosterMutation(
        command: CBTForceRosterCommand,
    ): CBTForceRosterMutationPlanResult | null {
        const envelope = this.getSupportedCBTForceV2Envelope();
        return envelope
            ? prepareCBTForceRosterMutationPlan({
                roster: envelope.roster,
                command,
            })
            : null;
    }

    /** Installs one structural roster edit in the same force/runtime owner transaction. */
    public dispatchCanonicalRosterCommand(
        command: CBTForceRosterCommand,
    ): Promise<CBTForceRosterCommandResult> {
        let captured: CBTForceRosterCommand | null = null;
        try {
            captured = structuredClone(command);
        } catch {
            return Promise.resolve(rejectedRosterCommand('INVALID_COMMAND'));
        }
        return this.enqueueCBTMutation(async () => {
            if (this.readOnly()) return rejectedRosterCommand('READ_ONLY');
            const context = this.beginCBTForceMutation();
            const current = context.previous;
            if (!current) return rejectedRosterCommand('NO_CANONICAL_ROSTER');
            const planned = this.prepareCanonicalRosterMutation(captured!);
            if (planned === null) return rejectedRosterCommand('NO_CANONICAL_ROSTER');
            if (planned.kind === 'rejected') return rejectedRosterCommand(planned.reason);

            let envelope: SerializedCBTForceV2;
            try {
                const removedInstanceIds = planned.plan.removedInstanceIds ?? Object.freeze([]);
                const removed = new Set(removedInstanceIds);
                const units = removed.size === 0
                    ? current.units
                    : Object.freeze(current.units.filter(entry => !removed.has(entry.instanceId)));
                if (removed.size > 0 && current.units.length - units.length !== removed.size) {
                    return rejectedRosterCommand('FORCE_CHANGED');
                }
                const encounter = removed.size === 0
                    ? current.encounter
                    : pruneRemovedUnitsFromEncounter(current.encounter, removed);
                envelope = await validateSerializedCBTForceV2({
                    ...current,
                    forceRevision: nextForceRevision(current.forceRevision),
                    units,
                    roster: planned.plan.nextRoster,
                    encounter,
                });
            } catch {
                return rejectedRosterCommand('PERSISTENCE_REJECTED');
            }

            const removedInstanceIds = planned.plan.removedInstanceIds ?? Object.freeze([]);
            const removedReadyIds = removedInstanceIds.filter(instanceId =>
                current.units.some(entry => entry.instanceId === instanceId));
            const prepared: PreparedCBTForcePersistenceV2 = Object.freeze({ envelope, reused: false });
            this.commitCBTForceMutation(
                context,
                prepared,
                removedReadyIds.length > 0
                    ? () => this.unitStore.remove(envelope, removedReadyIds)
                    : () => this.unitStore.commit(envelope),
            );
            if (removedInstanceIds.length > 0) {
                this.session.prune(new Set(removedInstanceIds));
            }
            this.reconcileCBTForceV2Projection();
            this.emitChangedFromReservedIntent();
            return Object.freeze({
                accepted: true as const,
                changed: true as const,
                forceRevision: envelope.forceRevision,
            });
        });
    }

    protected override shouldPersistEmptyGroup(_group: UnitGroup<never>): boolean {
        return true;
    }

    protected override ownedMemberCountForCapacity(): number {
        return this.cbtForceV2MemberInstanceIds().length;
    }

    /** Resolves one exact native Entity and atomically admits its sparse runtime. */
    public async admitRetainedUnit(
        request: CBTDirectUnitAdmissionRequest,
    ): Promise<CBTDirectUnitAdmissionResult> {
        if (!this.isWholeOwnerActive()) {
            return directAdmissionFailure('READ_ONLY', 'The force is being replaced');
        }
        let uuid: CBTDirectUnitAdmissionRequest['uuid'];
        let deployment: DeploymentConfiguration;
        let crewSkills: CBTDirectUnitAdmissionRequest['crewSkills'];
        let initialStateProfileId: string | undefined;
        let instanceId: string;
        let targetRosterGroupId: string | undefined;
        let targetRosterMemberIndex: number | undefined;
        let commander = false;
        try {
            uuid = request.uuid;
            deployment = structuredClone(request.deployment);
            crewSkills = request.crewSkills === undefined
                ? undefined
                : Object.freeze({
                    gunnery: request.crewSkills.gunnery,
                    piloting: request.crewSkills.piloting,
                });
            initialStateProfileId = request.initialStateProfileId;
            instanceId = request.instanceId === undefined
                ? createUnitInstanceId()
                : request.instanceId;
            targetRosterGroupId = request.targetRosterGroupId?.trim() || undefined;
            targetRosterMemberIndex = request.targetRosterMemberIndex;
            if (targetRosterMemberIndex !== undefined
                && (!Number.isSafeInteger(targetRosterMemberIndex) || targetRosterMemberIndex < 0)) {
                throw new Error('The target roster member index is invalid');
            }
            if (targetRosterMemberIndex !== undefined && targetRosterGroupId === undefined) {
                throw new Error('A target roster group is required for an exact member index');
            }
            commander = request.commander === true;
        } catch (error) {
            return directAdmissionFailure(
                'CANDIDATE_PREPARATION_FAILED',
                `Admission inputs could not be captured: ${errorMessage(error)}`,
            );
        }

        return this.enqueueCBTMutation(async () => {
            if (this.readOnly()) {
                return directAdmissionFailure('READ_ONLY', 'The force is read-only');
            }
            if (this.hasOwnedInstanceId(instanceId)) {
                return directAdmissionFailure(
                    'INSTANCE_ID_COLLISION',
                    `Force instance ${instanceId} is already owned`,
                );
            }

            const installed = this.unitStore.envelope();
            if ((installed?.units.length ?? 0) >= MAX_UNITS) {
                return directAdmissionFailure(
                    'FORCE_FULL',
                    `Cannot add more than ${MAX_UNITS} units to a single force`,
                );
            }
            let scenario: ScenarioRules;
            try {
                scenario = this.currentScenarioRules();
            } catch (error) {
                return directAdmissionFailure('CANDIDATE_PREPARATION_FAILED', errorMessage(error));
            }
            let candidate: CBTUnit;
            try {
                candidate = await this.injector.get(CBTUnitService).create({
                    uuid,
                    instanceId,
                    deployment,
                    scenario,
                    ...(crewSkills === undefined ? {} : { crewSkills }),
                    ...(initialStateProfileId === undefined
                        ? {}
                        : { initialStateProfileId }),
                });
                if (isCBTMekUnit(candidate)) {
                    const decision = evaluateCBTMekRuntimeCapability(candidate);
                    if (decision.readiness === 'deferred') {
                        return Object.freeze({ kind: 'deferred' as const, decision });
                    }
                }
            } catch (error) {
                return directAdmissionFailure(
                    'CANDIDATE_PREPARATION_FAILED',
                    `The ready V2 candidate could not be constructed: ${errorMessage(error)}`,
                );
            }

            let context: CBTForceMutation;
            try {
                context = this.beginCBTForceMutation();
            } catch (error) {
                return directAdmissionFailure('READ_ONLY', errorMessage(error));
            }

            let liveUnits: readonly CBTUnit[];
            try {
                liveUnits = context.previous
                    ? this.unitStore.liveUnits()
                    : Object.freeze([]);
            } catch (error) {
                return directAdmissionFailure('FORCE_CHANGED', errorMessage(error));
            }
            const materialized = await prepareDirectUnitAdmission({
                forceId: context.metadata.instanceId,
                previous: context.previous,
                liveUnits,
                candidate,
                ...(context.typedEncounterState === undefined
                    ? {}
                    : { typedEncounterState: context.typedEncounterState }),
                ...(targetRosterGroupId === undefined ? {} : { targetRosterGroupId }),
                ...(targetRosterMemberIndex === undefined ? {} : { targetRosterMemberIndex }),
                ...(commander ? { commander: true } : {}),
            });
            if (materialized.kind === 'read-only') {
                return directAdmissionFailure(
                    materialized.code === 'INSTANCE_ID_COLLISION'
                        ? 'INSTANCE_ID_COLLISION'
                        : 'PERSISTENCE_REJECTED',
                    `${materialized.code}: ${materialized.error}`,
                );
            }

            try {
                const durableMemberCount = this.durableOwnedUnitCount(context);
                if (durableMemberCount >= MAX_UNITS) {
                    return directAdmissionFailure(
                        'FORCE_FULL',
                        `Cannot add more than ${MAX_UNITS} units to a single force`,
                    );
                }
            } catch (error) {
                return directAdmissionFailure('PERSISTENCE_REJECTED', errorMessage(error));
            }
            if (this.readOnly()
                || this.hasOwnedInstanceId(instanceId)) {
                return directAdmissionFailure(
                    'FORCE_CHANGED',
                    'The force changed while direct V2 admission was prepared',
                );
            }
            this.commitCBTForceMutation(
                context,
                materialized,
                () => this.unitStore.add(materialized.envelope, candidate, scenario),
            );
            this.emitChangedFromReservedIntent();
            return Object.freeze({ kind: 'admitted' as const, instanceId });
        });
    }

    private durableOwnedUnitCount(context: CBTForceMutation): number {
        return context.previous?.units.length ?? 0;
    }

    private hasOwnedInstanceId(instanceId: string): boolean {
        return this.unitStore.instanceIds().some(id => id === instanceId)
            || this.cbtForceV2MemberInstanceIds().some(id => id === instanceId);
    }

    protected override getCBTEncounterStateForPersistence(): SerializedCBTEncounterStateV2 {
        if (!this.unitStore.c3.validateConfiguredNetworks(this.c3Encounter.snapshot().networks)) {
            throw new Error('Cannot persist non-canonical C3 networks');
        }
        return this.c3Encounter.serializedState();
    }

    /** Read-only evidence; no runtime object or mutation API escapes this owner. */
    public getRuntimeInstanceIds(): readonly string[] {
        return this.unitStore.instanceIds();
    }

    public getUnitDestroyed(instanceId: string): boolean | null {
        return this.unitStore.unitDestroyed(instanceId);
    }

    public getUnitCrewAssignment(instanceId: string): CrewAssignment | null {
        return this.unitStore.unitCrewAssignment(instanceId);
    }

    public getUnitConditions(instanceId: string): readonly UnitConditionKey[] | null {
        return this.unitStore.unitConditions(instanceId);
    }

    public getUnitAdjustedBattleValue(instanceId: string): number | null {
        return this.adjustedBattleValues().get(instanceId)?.adjusted ?? null;
    }

    public getUnitPristineAdjustedBattleValue(instanceId: string): number | null {
        return this.pristineAdjustedBattleValues().get(instanceId)?.adjusted ?? null;
    }

    /** Canonical formula projected against a prospective C3 graph; no state is retained. */
    public previewAdjustedBattleValues(
        networks: readonly EncounterNetwork[],
    ): ReadonlyMap<string, CBTForceBattleValueBreakdown> {
        return this.calculateAdjustedBattleValues(networks, 'damaged');
    }

    public getUnitCurrentBaseBattleValue(instanceId: string): number | null {
        return this.unitStore.unitCurrentBaseBattleValue(instanceId);
    }

    public getUnitTagBattleValue(instanceId: string): number | null {
        return this.adjustedBattleValues().get(instanceId)?.tag ?? null;
    }

    public getUnitC3BattleValue(instanceId: string): number | null {
        return this.adjustedBattleValues().get(instanceId)?.c3 ?? null;
    }

    public getUnitSkillBattleValue(instanceId: string): number | null {
        return this.adjustedBattleValues().get(instanceId)?.skills ?? null;
    }

    public getUnitPristineBattleValue(instanceId: string): number | null {
        return this.unitStore.unitPristineBattleValue(instanceId);
    }

    public isUnitCommander(instanceId: string): boolean {
        const roster = this.queryCanonicalRoster();
        return roster.kind === 'available'
            && roster.snapshot.members.some(member =>
                member.instanceId === instanceId && member.commander === true);
    }

    public getUnitSnapshot(instanceId: string): CBTUnitSnapshot | null {
        return this.unitStore.unitSnapshot(instanceId);
    }

    public getUnitUuid(instanceId: string): UnitUuid | null {
        return this.unitStore.cbtUnit(instanceId)?.uuid ?? null;
    }

    /** Total entity + runtime record-sheet projection; no SVG participates. */
    public getMekRecordSheetSnapshot(instanceId: string): MekRecordSheetSnapshot | null {
        const unit = this.getUnitSnapshot(instanceId);
        if (!unit || !hasMekRuntime(unit)) return null;
        const registry = this.queryInventoryControlTargetRegistry();
        const heatPolicy = this.currentHeatPolicy();
        const adjustedBattleValue = this.getUnitAdjustedBattleValue(instanceId);
        const member = this.memberRegistry.member(instanceId);
        const battleValue = Object.freeze({
            pristine: member?.pristineBattleValue() ?? this.getUnitPristineBattleValue(instanceId),
            current: member?.currentBaseBattleValue() ?? this.getUnitCurrentBaseBattleValue(instanceId),
            adjusted: adjustedBattleValue,
        });
        return projectMekRecordSheet(
            unit.entity,
            unit.index,
            unit.ruleset,
            unit.state,
            unit.query,
            registry,
            battleValue,
            heatPolicy,
        );
    }

    /** Small Entity + runtime projection for force-card condition badges. */
    public getMekUnitStatusSnapshot(instanceId: string): MekUnitStatusSnapshot | null {
        const unit = this.getUnitSnapshot(instanceId);
        return unit && hasMekRuntime(unit)
            ? projectMekUnitStatus(unit.entity, unit.index, unit.state, unit.query)
            : null;
    }

    /** Total non-Mek Entity + sparse-runtime record-sheet projection; no SVG participates. */
    public getNonMekRecordSheetSnapshot(instanceId: string): NonMekRecordSheetSnapshot | null {
        const unit = this.getUnitSnapshot(instanceId);
        if (!unit || !hasNonMekRuntime(unit)) return null;
        const owned = this.unitStore.nonMekUnit(instanceId);
        if (!owned) return null;
        const adjustedBattleValue = this.getUnitAdjustedBattleValue(instanceId);
        const pristineBattleValue = this.getUnitPristineBattleValue(instanceId);
        if (adjustedBattleValue === null || pristineBattleValue === null) {
            throw new Error(`Non-Mek runtime ${instanceId} has no battle-value projection`);
        }
        const crew = this.getUnitCrewAssignment(instanceId);
        if (!crew) throw new Error(`Non-Mek runtime ${instanceId} has no crew assignment`);
        return projectNonMekRecordSheet(
            unit.entity,
            unit.index,
            unit.state,
            unit.ruleset,
            adjustedBattleValue,
            pristineBattleValue,
            crew,
            owned.getInstance().forcedWithdrawal,
        );
    }

    /** Entity + runtime equipment projection; no summary, SVG, mount, or runtime owner escapes. */
    public getEquipmentPanelSnapshot(
        instanceId: string,
    ): EquipmentPanelSnapshot | null {
        const registry = this.queryInventoryControlTargetRegistry();
        const unit = this.getUnitSnapshot(instanceId);
        if (!unit) return null;
        if (hasMekRuntime(unit)) {
            return projectMekEquipmentPanel(
                unit.entity,
                unit.index,
                unit.ruleset,
                unit.query,
                registry,
            );
        }
        if (!hasNonMekRuntime(unit)) return null;
        const owned = this.unitStore.nonMekUnit(instanceId);
        if (!owned) return null;
        const crew = this.getUnitCrewAssignment(instanceId);
        if (!crew) throw new Error(`Non-Mek runtime ${instanceId} has no crew assignment`);
        return projectNonMekEquipmentPanel(
            unit.entity,
            unit.index,
            unit.ruleset,
            unit.state,
            crew,
            registry,
            owned.getInstance().forcedWithdrawal,
        );
    }

    /** Entity + runtime turn projection; the legacy TurnState and sheet DOM are not inputs. */
    public getMekTurnPanelSnapshot(
        instanceId: string,
        heatPolicy: MekHeatAutomationPolicyV2,
    ): MekTurnPanelSnapshot | null {
        const unit = this.getUnitSnapshot(instanceId);
        return unit && hasMekRuntime(unit) ? projectMekTurnPanel(
            unit.entity,
            unit.index,
            unit.ruleset,
            unit.query,
            heatPolicy,
        ) : null;
    }

    public getRuntimeUndoState(): Readonly<{ readonly canUndo: boolean; readonly canRedo: boolean }> {
        return this.session.undoState();
    }

    public getRuntimeHistory() {
        return this.session.history();
    }

    public hasRuntimeHistoryForUnitTurn(instanceId: string, turn: number): boolean {
        return this.getRuntimeHistory().some(row => row.event.turn === turn
            && runtimeHistoryMessageUnitId(row.event.message) === instanceId);
    }

    public runtimeHistoryUnitLabel(instanceId: string): string {
        const unit = this.unitStore.cbtUnit(instanceId);
        return unit ? unit.getUnit().displayName() || unit.instanceId : instanceId;
    }

    public runtimeHistoryTargetLabel(
        instanceId: string,
        kind: RuntimeHistoryTargetKind,
        targetId: string,
    ): string {
        const unit = this.unitStore.cbtUnit(instanceId);
        return unit ? historyTargetLabel(unit, kind, targetId) : targetId;
    }

    public runtimeHistoryCrewLabel(instanceId: string, occurrence: number): string {
        const unit = this.unitStore.cbtUnit(instanceId);
        return unit ? historyCrewLabel(unit, occurrence) : `Crew ${occurrence + 1}`;
    }

    public runtimeHistoryAmmoLabel(instanceId: string, munitionKey: string): string {
        const unit = this.unitStore.cbtUnit(instanceId);
        return unit?.getUnit().getEquipmentRegistry().findEquipment(munitionKey)?.name ?? munitionKey;
    }

    public undoRuntimeCommand(): Promise<RuntimeUndoCommandResult> {
        return this.restoreRuntimeCommand('undo');
    }

    public redoRuntimeCommand(): Promise<RuntimeUndoCommandResult> {
        return this.restoreRuntimeCommand('redo');
    }

    private restoreRuntimeCommand(
        direction: 'undo' | 'redo',
    ): Promise<RuntimeUndoCommandResult> {
        return this.enqueueCBTMutation(async () => {
            if (this.readOnly()) return rejectedRuntimeUndoCommand('READ_ONLY');
            const context = this.beginCBTForceMutation();
            const current = context.previous;
            if (!current) return rejectedRuntimeUndoCommand('EMPTY');
            const move = this.session.prepare(direction);
            if (!move) return rejectedRuntimeUndoCommand('EMPTY');
            const checkpoint = this.session.preserveCurrentOperationalState(move.checkpoint);

            let replacements: ReadonlyMap<string, CBTUnit>;
            try {
                replacements = await this.unitStore.buildRuntimeCommandCandidates(checkpoint);
            } catch {
                return rejectedRuntimeUndoCommand('RESTORE_FAILED');
            }

            let envelope: SerializedCBTForceV2;
            try {
                const units = current.units.map(entry => {
                    const ready = replacements.get(entry.instanceId)
                        ?? this.unitStore.cbtUnit(entry.instanceId);
                    if (!ready) throw new Error(`Undo restore lost runtime ${entry.instanceId}`);
                    const unit = ready.serialize();
                    return Object.freeze({
                        instanceId: entry.instanceId,
                        stateRevision: unit.stateRevision,
                        unit,
                    });
                });
                envelope = await validateSerializedCBTForceV2({
                    ...current,
                    forceRevision: nextForceRevision(current.forceRevision),
                    units,
                    ...(context.typedEncounterState === undefined
                        ? {}
                        : {
                            // C3 topology and layout are outside gameplay undo.
                            // Carry the live durable encounter state through while restoring units.
                            encounter: context.typedEncounterState,
                        }),
                });
            } catch {
                return rejectedRuntimeUndoCommand('RESTORE_FAILED');
            }

            const prepared: PreparedCBTForcePersistenceV2 = Object.freeze({ envelope, reused: false });
            this.commitCBTForceMutation(
                context,
                prepared,
                () => this.unitStore.replace(envelope, replacements),
            );
            this.session.commit(move);
            this.emitChangedFromReservedIntent(Object.freeze([...replacements.keys()]));
            return Object.freeze({
                accepted: true,
                changed: true,
                entry: move.entry,
            });
        });
    }

    private captureRuntimeCommandMutation(
        instanceIds: readonly string[],
    ): CapturedRuntimeCommandMutation {
        return this.session.capture(instanceIds);
    }

    /** Primary runtime plus the only peers C3 reconciliation is allowed to mutate. */
    private c3RuntimeMutationScope(
        instanceId: string,
        emergencyMasterUnitIds = this.unitStore.c3.emergencyMasterUnitIds(),
    ): readonly string[] {
        return Object.freeze([
            ...new Set([instanceId, ...emergencyMasterUnitIds]),
        ]);
    }

    private recordRuntimeCommandMutation(
        captured: CapturedRuntimeCommandMutation,
        history: RuntimeHistoryInput,
        boundary?: 'phase',
    ): readonly string[] {
        return this.session.record(captured, history, boundary);
    }

    public dispatchNonMekUnitCommand(
        instanceId: string,
        command: NonMekUnitCommand,
    ): Promise<CBTNonMekUnitCommandResult> {
        return this.unitCommandDispatcher.dispatchNonMek(instanceId, command);
    }

    private dispatchNonMekUnitCommandCore(
        instanceId: string,
        command: NonMekUnitCommand,
    ): Promise<CBTNonMekUnitCommandResult> {
        const captured = Object.freeze({ ...command }) as NonMekUnitCommand;
        return this.enqueueCBTMutation(() => {
            const ready = this.unitStore.nonMekUnit(instanceId);
            const beforeState = ready?.getInstance().snapshot();
            const beforeMode = captured.kind === 'set-component-mode'
                ? ready?.getInstance().componentMode(captured.componentId)
                : undefined;
            const capture = ready === null
                ? null
                : this.captureRuntimeCommandMutation([instanceId]);
            const result = this.unitStore.dispatchNonMekUnitCommand(
                instanceId,
                captured,
                this.readOnly(),
            );
            if (result.accepted && result.changed) {
                if (capture === null || ready === null || beforeState === undefined) {
                    throw new Error('Accepted non-Mek command has no captured state');
                }
                const changedUnitIds = this.recordRuntimeCommandMutation(
                    capture,
                    nonMekCommandHistory(
                        instanceId,
                        ready,
                        captured,
                        beforeState,
                        ready.getInstance().snapshot(),
                        captured.kind === 'set-component-mode'
                            ? Object.freeze({
                                before: beforeMode,
                                after: ready.getInstance().componentMode(captured.componentId),
                            })
                            : undefined,
                    ),
                    nonMekCommandBoundary(captured),
                );
                this.reserveForceOwnerMutationIntent();
                this.emitChangedFromReservedIntent(
                    changedUnitIds.length > 0 ? changedUnitIds : [instanceId],
                );
            }
            return result;
        });
    }

    public dispatchMekUnitCommand(
        instanceId: string,
        command: CBTUnitCommand,
    ): Promise<CBTMekUnitCommandResult> {
        return this.unitCommandDispatcher.dispatchMek(instanceId, command);
    }

    private dispatchMekUnitCommandCore(
        instanceId: string,
        command: CBTUnitCommand,
    ): Promise<CBTMekUnitCommandResult> {
        return this.enqueueCBTMutation(() => {
            const ready = this.unitStore.mekUnit(instanceId);
            const beforeState = ready?.getInstance().snapshot();
            const beforeMode = command.type === 'set-component-mode'
                ? ready?.getInstance().query().componentMode(command.componentId)
                : undefined;
            const emergencyMasterUnitIds = this.unitStore.c3.emergencyMasterUnitIds();
            const capture = ready === null
                ? null
                : this.captureRuntimeCommandMutation(
                    this.c3RuntimeMutationScope(instanceId, emergencyMasterUnitIds),
                );
            const configuredNetworks = this.c3Encounter.snapshot().networks;
            const c3EndTurn = command.type === 'end-turn'
                ? this.unitStore.c3.planEmergencyMasterEndTurn(instanceId, configuredNetworks)
                : null;
            const reduction = this.unitStore.dispatchMekUnitCommand(
                instanceId,
                command,
                this.readOnly(),
            );
            if (!reduction.accepted) return reduction;
            const settled = this.unitStore.c3.settleEmergencyMasterEndTurn(c3EndTurn);
            const reconciled = this.unitStore.c3.reconcileEmergencyMasters(
                configuredNetworks,
                emergencyMasterUnitIds,
            );
            const toast = this.injector.get(ToastService);
            publishC3EmergencyMasterNotices(settled.notices, toast);
            publishC3EmergencyMasterNotices(reconciled.notices, toast);
            const changed = reduction.changed
                || settled.changedUnitIds.length > 0
                || reconciled.changedUnitIds.length > 0;
            if (changed) {
                if (capture === null || ready === null || beforeState === undefined) {
                    throw new Error('Accepted Mek command has no captured state');
                }
                const changedUnitIds = this.recordRuntimeCommandMutation(
                    capture,
                    mekCommandHistory(
                        instanceId,
                        ready,
                        command,
                        beforeState,
                        ready.getInstance().snapshot(),
                        command.type === 'set-component-mode'
                            ? Object.freeze({
                                before: beforeMode,
                                after: ready.getInstance().query().componentMode(command.componentId),
                            })
                            : undefined,
                    ),
                    mekCommandBoundary(command, ready.getInstance().snapshot()),
                );
                this.reserveForceOwnerMutationIntent();
                this.mekMutationImpact.publish(
                    instanceId,
                    command,
                    changedUnitIds.length > 0 ? changedUnitIds : [instanceId],
                    changed => this.emitChangedFromReservedIntent(changed),
                );
            }
            const runtime = this.unitStore.mekUnit(instanceId)?.getInstance();
            return runtime
                ? Object.freeze({ ...reduction, changed, state: runtime.snapshot() })
                : reduction;
        });
    }

    protected override captureWholeOwnerSubclassAuthorityFence(): unknown {
        return this.unitStore.snapshot();
    }

    protected override isWholeOwnerSubclassAuthorityFenceCurrent(fence: unknown): boolean {
        return fence !== null
            && typeof fence === 'object'
            && this.unitStore.isSnapshotCurrent(
                fence as CBTUnitStoreSnapshot,
            );
    }

    public getUnitCrewProfile(instanceId: string): CrewAssignment | null {
        return this.unitStore.crewProfile(instanceId);
    }

    public async replaceUnitCrewProfile(
        instanceId: string,
        positions: readonly CrewAssignmentPosition[],
    ): Promise<CrewAssignment | null> {
        let capturedPositions: readonly CrewAssignmentPosition[];
        try {
            capturedPositions = structuredClone(positions);
        } catch {
            return null;
        }
        const capturedInstanceId = instanceId;
        return this.enqueueCBTMutation(async () => {
            if (this.readOnly()) return null;
            const ready = this.unitStore.cbtUnit(capturedInstanceId);
            const beforeProfile = this.unitStore.crewProfile(capturedInstanceId);
            const capture = ready === null
                ? null
                : this.captureRuntimeCommandMutation([capturedInstanceId]);
            const executionGeneration = this.captureForceOwnerGeneration();
            return this.unitStore.replaceCrewProfile(
                capturedInstanceId,
                capturedPositions,
                () => this.readOnly(),
                () => this.isForceOwnerGenerationCurrent(executionGeneration),
                () => {
                    const afterReady = this.unitStore.cbtUnit(capturedInstanceId);
                    const afterProfile = this.unitStore.crewProfile(capturedInstanceId);
                    if (capture === null || afterReady === null || beforeProfile === null || afterProfile === null) {
                        throw new Error('Accepted crew command has no captured state');
                    }
                    const changedUnitIds = this.recordRuntimeCommandMutation(
                        capture,
                        crewProfileHistory(capturedInstanceId, afterReady, beforeProfile, afterProfile),
                    );
                    this.reserveForceOwnerMutationIntent();
                    this.emitChangedFromReservedIntent(changedUnitIds.length > 0 ? changedUnitIds : [capturedInstanceId]);
                },
            );
        });
    }

    public getAttackerTargeting(
        instanceId: string,
    ): AttackerTargetingSnapshot | null {
        return this.unitStore.attackerTargetingSnapshot(
            instanceId,
            this.queryInventoryControlTargetRegistry(),
        );
    }

    public getC3State(instanceId: string): C3State {
        this.memberRegistry.dependOnOperationalC3Inputs();
        return this.unitStore.c3.state(instanceId, this.c3Encounter.snapshot().networks);
    }

    public isC3EndpointOperational(instanceId: string, componentId: ComponentId): boolean {
        return this.unitStore.c3.isEndpointOperational(instanceId, componentId);
    }

    public async dispatchAttackerTargeting(
        instanceId: string,
        command: CBTUnitAttackerTargetingCommand,
    ): Promise<AttackerTargetingCommandResult> {
        const capturedCommand = structuredClone(command);
        const capturedInstanceId = instanceId;
        return this.enqueueCBTMutation(() => {
            const result = this.unitStore.dispatchAttackerTargeting(
                capturedInstanceId,
                capturedCommand,
                this.queryInventoryControlTargetRegistry(),
                this.c3Encounter.snapshot().networks,
                this.readOnly(),
            );
            if (result.accepted && result.changed) this.session.publish([capturedInstanceId]);
            return result;
        });
    }

    /** Presentation-only row order; intentionally excluded from gameplay undo/history. */
    public async dispatchEquipmentRowOrder(
        instanceId: string,
        command: Readonly<{
            readonly group: EquipmentRowOrderGroup;
            readonly permutation: readonly number[];
        }>,
    ): Promise<AttackerTargetingCommandResult> {
        const capturedInstanceId = instanceId;
        const captured = Object.freeze({
            group: command.group,
            permutation: Object.freeze([...command.permutation]),
        });
        return this.enqueueCBTMutation(() => {
            const snapshot = this.getEquipmentPanelSnapshot(capturedInstanceId);
            if (!snapshot) {
                return Object.freeze({
                    accepted: true,
                    changed: false,
                    state: null,
                });
            }
            const rowCount = captured.group === 'ranged'
                ? snapshot.components.filter(row => row.weapon !== undefined).length
                : snapshot.physicalAttacks.length;
            const result = this.unitStore.dispatchEquipmentRowOrder(
                capturedInstanceId,
                captured.group,
                captured.permutation,
                rowCount,
                this.readOnly(),
            );
            if (result.accepted && result.changed) {
                this.reserveForceOwnerMutationIntent();
                this.emitChangedFromReservedIntent([capturedInstanceId]);
            }
            return result;
        });
    }

    public async fireSelectedWeapons(
        instanceId: string,
        command: CBTUnitSelectedWeaponFireCommand,
    ): Promise<SelectedWeaponFireCommandResult> {
        const capturedCommand = structuredClone(command);
        const capturedInstanceId = instanceId;
        return this.enqueueCBTMutation(() => {
            const ready = this.unitStore.cbtUnit(capturedInstanceId);
            const capture = ready === null
                ? null
                : this.captureRuntimeCommandMutation([capturedInstanceId]);
            const history = ready === null
                ? Object.freeze([])
                : selectedWeaponFireHistory(capturedInstanceId, ready);
            const result = this.unitStore.dispatchSelectedWeaponFire(
                capturedInstanceId,
                capturedCommand,
                this.queryInventoryControlTargetRegistry(),
                this.c3Encounter.snapshot().networks,
                this.readOnly(),
            );
            if (result.accepted && result.changed) {
                if (capture === null) throw new Error('Accepted fire command has no captured state');
                const changedUnitIds = this.recordRuntimeCommandMutation(
                    capture,
                    history,
                );
                this.reserveForceOwnerMutationIntent();
                this.emitChangedFromReservedIntent(changedUnitIds.length > 0 ? changedUnitIds : [capturedInstanceId]);
            }
            return result;
        });
    }

    /** Detached equipment rows; no runtime, facade or handler escapes. */
    public getEquipmentInteractions(
        instanceId: string,
        choiceSurface?: EquipmentInteractionQueryContext['choiceSurface'],
    ): readonly CBTEquipmentInteraction[] {
        const registry = this.injector.get(EquipmentInteractionRegistry);
        return this.unitStore.equipmentInteractions(
            instanceId,
            registry,
            choiceSurface === undefined ? {} : { choiceSurface },
            () => this.encounterSnapshot(),
            this.readOnly(),
        );
    }

    public async dispatchEquipmentChoice(
        command: CBTEquipmentChoiceCommand,
    ): Promise<CBTEquipmentChoiceDispatchResult> {
        const capturedCommand = Object.freeze({ ...command });
        return this.enqueueCBTMutation(async () => {
            const selectedId = capturedCommand.instanceId;
            const selectedUnit = this.unitStore.cbtUnit(selectedId);
            const mutationScope = selectedUnit && isCBTMekUnit(selectedUnit)
                ? this.c3RuntimeMutationScope(selectedId)
                : Object.freeze([selectedId]);
            const capture = this.captureRuntimeCommandMutation(mutationScope);
            const beforeModes = captureMekComponentModes(this.unitStore, mutationScope);
            const executionGeneration = this.captureForceOwnerGeneration();
            const registry = this.injector.get(EquipmentInteractionRegistry);
            const queryContext: EquipmentInteractionQueryContext = {};
            return this.unitStore.dispatchEquipmentChoice(
                capturedCommand,
                registry,
                queryContext,
                {
                    toastService: this.injector.get(ToastService),
                    dialogsService: this.injector.get(DialogsService),
                    configureC3Network: () => {
                        void import('../services/force-dialogs.service').then(({ ForceDialogsService }) =>
                            this.injector.get(ForceDialogsService).openC3Network(this, this.readOnly()))
                            .catch(() => this.injector.get(ToastService).showToast(
                                'Unable to open C3 network configuration',
                                'error',
                            ));
                    },
                },
                () => this.encounterSnapshot(),
                () => this.readOnly(),
                () => this.isForceOwnerGenerationCurrent(executionGeneration),
                () => {
                    const modeChanges = changedComponentModeHistory(this.unitStore, beforeModes);
                    const changedUnitIds = this.recordRuntimeCommandMutation(
                        capture,
                        modeChanges.length === 0
                            ? forceHistory(RUNTIME_HISTORY_MESSAGE.EQUIPMENT_CHANGED)
                            : modeChanges,
                    );
                    this.reserveForceOwnerMutationIntent();
                    this.emitChangedFromReservedIntent(changedUnitIds);
                },
            );
        });
    }

    /** Commits the current phase for every canonical V2 unit after shared preflight. */
    public endPhaseForAllUnits(): Promise<CBTForceEndTurnAllResult> {
        return this.unitCommandDispatcher.endPhaseForAll();
    }

    public hasPendingEndTurnForUnit(instanceId: string): boolean {
        return this.unitCommandDispatcher.hasPendingEndTurn(instanceId);
    }

    /** Resolves badge-advertised work without committing the phase or resetting the turn. */
    public resolvePendingUnitAutomation(instanceId: string): Promise<boolean> {
        return this.unitCommandDispatcher.resolvePendingAutomation(instanceId);
    }

    /** Ends every canonical V2 turn through one owner boundary. */
    public endTurnForAllUnits(): Promise<CBTForceEndTurnAllResult> {
        return this.unitCommandDispatcher.endTurnForAll();
    }

    private endTurnForAllUnitsCore(): Promise<CBTForceEndTurnAllResult> {
        return this.enqueueCBTMutation(() => {
            const capture = this.captureRuntimeCommandMutation(
                this.unitStore.instanceIds(),
            );
            return this.unitStore.endTurnForAll(
                () => this.readOnly(),
                () => this.currentHeatPolicy(),
                this.c3Encounter.snapshot().networks,
                this.injector.get(ToastService),
                () => {
                    const changedUnitIds = this.recordRuntimeCommandMutation(
                        capture,
                        forceHistory(RUNTIME_HISTORY_MESSAGE.TURN_ENDED),
                    );
                    this.reserveForceOwnerMutationIntent();
                    this.emitChangedFromReservedIntent(changedUnitIds);
                },
            );
        });
    }

    private currentHeatPolicy(): MekHeatAutomationPolicyV2 {
        const mode = this.injector.get(OptionsService, null, { optional: true })
            ?.cbtAutomationMode('heatAndDissipationResolution') ?? 'yes';
        return mode === 'yes' ? 'automatic' : 'manual';
    }

    protected override reconcileCBTForceV2Projection(): void {
        const envelope = this.getSupportedCBTForceV2Envelope();
        if (!envelope) {
            this.groups.set([]);
            this.refreshForceMemberDependencies();
            return;
        }
        const current = new Map(this.groups().map(group => [group.id, group] as const));
        const groups = envelope.roster.groups.map(serialized => {
            const group = current.get(serialized.groupId) ?? new UnitGroup<never>(this);
            group.id = serialized.groupId;
            group.name.set(serialized.groupId === CBT_FORCE_UNASSIGNED_GROUP_ID
                ? 'Unassigned'
                : serialized.name);
            group.color = serialized.color;
            group.formationLock = serialized.formationLock;
            group.formation.set(resolveSerializedFormation(
                serialized.formationId,
                serialized.formationLock,
                this.gameSystem,
            ));
            group.formationTargetGroupId.set(serialized.formationTargetGroupId ?? null);
            group.units.set([]);
            return group;
        });
        this.groups.set(groups);
        this.refreshForceMemberDependencies();
    }

    protected override onForceChanged(changedUnitIds: readonly string[] | null): void {
        // Runtime edits publish only the changed members and the dependency domains
        // their command can affect. Unrelated base BV and C3 projections stay cold.
        this.refreshForceMemberDependencies(
            changedUnitIds,
            ...this.mekMutationImpact.dependencyRefresh(changedUnitIds),
        );
    }

    protected override async restoreCBTForce(
        envelope: SerializedCBTForceV2,
    ): Promise<RestoredCBTForce> {
        const restored = await this.unitStore.restore(
            envelope,
            this.injector.get(CBTUnitService),
            this.currentScenarioRules(),
        );
        return Object.freeze({
            ...(restored.envelope === envelope
                ? {}
                : { replacement: restored.envelope }),
            install: () => {
                this.unitStore.install(restored);
                this.resetRuntimeCommandSession();
            },
            ...(restored.warnings.length === 0
                ? {}
                : {
                    afterInstall: () => this.injector.get(DialogsService).showNotice(
                        restored.warnings.map(warning => `• ${warning}`).join('\n'),
                        'Save Loaded with Warnings',
                    ),
                }),
        });
    }

    protected override clearLoadedCBTForceV2Authority(): boolean {
        const encounter = this.c3Encounter.serializedState();
        const changed = this.unitStore.instanceIds().length > 0
            || encounter.networks.length > 0
            || (encounter.c3Positions?.length ?? 0) > 0;
        this.unitStore.clear();
        this.session.resetRuntime();
        this.session.resetTargets();
        this.c3Encounter.restoreSerialized(Object.freeze({
            networks: Object.freeze([]),
        }));
        return changed;
    }

    private resetRuntimeCommandSession(): void {
        this.session.resetRuntime();
    }

    protected override async prepareCBTForcePersistenceV2(input: {
        readonly forceId: string;
        readonly previous?: SerializedCBTForceV2;
        readonly typedEncounterState?: SerializedCBTEncounterStateV2;
    }): Promise<PreparedCBTForcePersistenceV2> {
        const previous = input.previous;
        let persistenceFence: CBTUnitStoreSnapshot;
        try {
            const installed = this.unitStore.envelope();
            persistenceFence = this.unitStore.snapshot();
            if (installed !== (previous ?? null)) {
                // The caller deliberately rechecks its owner pointer after this
                // asynchronous seam. Return a harmless stale candidate so that
                // it can retry with the newer runtime owner.
                const staleEnvelope = installed ?? previous;
                if (!staleEnvelope) throw new Error('The CBT authority disappeared during persistence');
                return withUnitStoreSnapshot(
                    Object.freeze({ envelope: staleEnvelope, reused: true }),
                    persistenceFence,
                );
            }
        } catch (error) {
            throw new Error(`V2_RUNTIME_SERIALIZATION_FAILED: ${errorMessage(error)}`);
        }
        if (!previous) {
            const prepared = await super.prepareCBTForcePersistenceV2(input);
            return withUnitStoreSnapshot(prepared, persistenceFence);
        }
        const liveUnits = this.unitStore.liveUnits();
        const prepared = await prepareCurrentCBTForcePersistenceV2({
            previous,
            liveUnits,
            ...(input.typedEncounterState === undefined
                ? {}
                : { encounterState: input.typedEncounterState }),
        });
        if (prepared.kind === 'read-only') {
            throw new Error(`CBT persistence remains read-only: ${prepared.code}: ${prepared.error}`);
        }
        return withUnitStoreSnapshot(prepared, persistenceFence);
    }

    protected override isPreparedCBTForcePersistenceCurrent(
        prepared: PreparedCBTForcePersistenceV2,
    ): boolean {
        const fence = (prepared as Partial<PreparedCBTForcePersistenceWithFence>).unitStoreSnapshot;
        return fence !== undefined && this.unitStore.isSnapshotCurrent(fence);
    }

    protected override commitPreparedCBTForcePersistenceV2(
        prepared: PreparedCBTForcePersistenceV2,
    ): void {
        this.unitStore.commit(prepared.envelope, this.currentScenarioRules());
    }

    private currentScenarioRules(): ScenarioRules {
        return this.unitStore.scenarioRules()
            ?? scenarioRulesFromOptions(this.injector.get(OptionsService).options());
    }

    protected override restoreCBTEncounterPersistence(state: SerializedCBTEncounterStateV2): void {
        this.c3Encounter.restoreSerialized(state);
        this.session.resetTargets();
    }

    protected override installCBTEncounterPersistence(state: SerializedCBTEncounterStateV2): void {
        this.c3Encounter.restoreSerialized(state);
    }

    /** Encounter-owned C3 graph; component-index arrays are never mechanics authority. */
    public c3EncounterNetworks(): readonly EncounterNetwork[] {
        return this.c3Encounter.snapshot().networks;
    }

    public c3EncounterPosition(instanceId: string): Readonly<{ x: number; y: number }> | null {
        return this.c3Encounter.snapshot().c3Positions
            .find(position => position.unitId === instanceId) ?? null;
    }

    /** Atomically replaces the complete encounter-owned C3 graph and visual layout. */
    public replaceC3EncounterConfigurationIfOwnerRevisionCurrent(
        revisionFence: ForceOwnerRevisionFence,
        networks: readonly EncounterNetwork[],
        positions: readonly C3UnitPosition[],
    ): boolean {
        if (this.readOnly()
            || !this.isForceOwnerRevisionFenceCurrent(revisionFence)
            || this.c3Networks().length > 0) return false;
        let detached: readonly EncounterNetwork[];
        let detachedPositions: C3UnitPosition[];
        try {
            detached = structuredClone(networks);
            detachedPositions = structuredClone(positions)
                .map(position => Object.freeze({
                    unitId: position.unitId,
                    x: Object.is(position.x, -0) ? 0 : position.x,
                    y: Object.is(position.y, -0) ? 0 : position.y,
                }))
                .sort((left, right) => left.unitId < right.unitId ? -1 : left.unitId > right.unitId ? 1 : 0);
        } catch {
            return false;
        }
        const unitIds = new Set(this.unitStore.instanceIds());
        const positionedUnitIds = new Set(detachedPositions.map(position => position.unitId));
        if (positionedUnitIds.size !== detachedPositions.length
            || detachedPositions.some(position => !unitIds.has(position.unitId)
                || !Number.isFinite(position.x)
                || !Number.isFinite(position.y))) return false;
        const current = this.c3Encounter.snapshot();
        if ((jsonValuesEqual(current.networks, detached)
            && jsonValuesEqual(current.c3Positions, detachedPositions))
            || !this.unitStore.c3.validateConfiguredNetworks(detached)) return false;
        const affectedUnitIds = new Set<string>();
        for (const network of [...current.networks, ...detached]) {
            for (const endpoint of network.endpoints) affectedUnitIds.add(endpoint.instanceId);
        }
        for (const position of [...current.c3Positions, ...detachedPositions]) {
            affectedUnitIds.add(position.unitId);
        }
        const c3UnitIds = this.unitStore.c3.emergencyMasterUnitIds();
        const c3Revisions = new Map(c3UnitIds.map(instanceId => [
            instanceId,
            this.unitStore.cbtUnit(instanceId)?.revision() ?? null,
        ] as const));
        this.reserveForceOwnerMutationIntent();
        this.c3Encounter.replaceC3Configuration(detached, detachedPositions);
        const c3 = this.unitStore.c3.reconcileEmergencyMasters(
            this.c3Encounter.snapshot().networks,
            c3UnitIds,
        );
        publishC3EmergencyMasterNotices(c3.notices, this.injector.get(ToastService));
        for (const instanceId of c3UnitIds) {
            if (this.unitStore.cbtUnit(instanceId)?.revision() !== c3Revisions.get(instanceId)) {
                affectedUnitIds.add(instanceId);
            }
        }
        this.emitChangedFromReservedIntent(Object.freeze([...affectedUnitIds]));
        return true;
    }

    /** Detached, deeply frozen compare-and-swap query. */
    public queryInventoryControlTargetRegistry(): TargetRegistrySnapshot {
        this.targetRegistryVersion();
        return this.session.targetRegistry();
    }

    /**
     * The only production target-registry write boundary. User replacement/reset
     * owns manual facts; OPFOR synchronization owns OPFOR facts. Neither authority
     * can replace facts owned by the other.
     */
    public dispatchInventoryControlTargetRegistry(
        command: TargetRegistryCommand,
        authority: CBTForceTargetRegistryAuthority = 'user',
    ): TargetRegistryCommandResult {
        const current = this.queryInventoryControlTargetRegistry();
        if (this.readOnly()) return readOnlyTargetRegistry(current);

        const authorized = authorizeCBTForceTargetRegistryCommand(current, command, authority);
        if ('accepted' in authorized) return authorized;
        const planned = reduceTargetRegistry(current, authorized);
        if (!planned.accepted || !planned.changed) return planned;
        const targetingReconciliation = this.unitStore.prepareTargetingReconciliation(planned.snapshot);
        const result = this.session.dispatchTargetRegistry(authorized);
        if (result.accepted && result.changed) {
            this.unitStore.installTargetingReconciliation(targetingReconciliation);
            this.session.publish(null);
        }
        return result;
    }

    /** Detached opponent roster across canonical V2 ownership. */
    public getInventoryControlTargetRoster(): readonly InventoryControlTargetRosterRow[] {
        const forceInstanceId = this.instanceId();
        if (!forceInstanceId) {
            throw new Error('A stable force instance ID is required to query the opponent target roster');
        }
        const mekRows = this.unitStore.targetRoster(forceInstanceId);
        const instanceIds = new Set<string>();
        const rows = [...mekRows];
        for (const row of rows) {
            if (instanceIds.has(row.instanceId)) {
                throw new Error(`Duplicate opponent target-roster instance ${row.instanceId}`);
            }
            instanceIds.add(row.instanceId);
        }
        return Object.freeze(rows);
    }

    private encounterSnapshot(): CBTEncounterSnapshot {
        const registry = this.session.targetRegistry();
        const c3 = this.c3Encounter.snapshot();
        return Object.freeze({
            revision: registry.revision,
            targets: registry.targets,
            networks: c3.networks,
            c3Positions: c3.c3Positions,
        });
    }

    protected override buildCBTForcePersistenceRecord(
        metadata: SerializedForce,
        cbt: SerializedCBTForceV2,
    ): SerializedCBTForce {
        const history = this.unitStore.envelope()?.forceId === cbt.forceId
            ? this.session.serializeHistory(cbt.history)
            : cbt.history;
        return super.buildCBTForcePersistenceRecord(
            metadata,
            history === cbt.history ? cbt : Object.freeze({ ...cbt, history }),
        );
    }

    public override serialize(): SerializedForce {
        const envelope = this.getSupportedCBTForceV2Envelope();
        if (!envelope) throw new Error('Use serializeForPersistence() to initialize a new CBT V2 force');
        return this.buildCBTForcePersistenceRecord(
            this.buildCBTForceMetadataRecord(
                this.instanceId() ?? uuidv7(),
                this.timestamp ?? new Date().toISOString(),
            ),
            envelope,
        );
    }

    /** Creates an independent V2 owner while preserving the complete sparse runtime state. */
    public override async cloneForPersistence(): Promise<CBTForce> {
        let serialized: SerializedForce;
        if (this.readOnly()) {
            const previous = this.getSupportedCBTForceV2Envelope();
            if (!previous) throw new Error('CBT force clone requires a validated V2 envelope');
            const prepared = await this.prepareCBTForcePersistenceV2({
                forceId: previous.forceId,
                previous,
                typedEncounterState: this.getCBTEncounterStateForPersistence(),
            });
            serialized = Object.freeze({ ...this.serialize(), cbt: prepared.envelope });
        } else {
            serialized = await this.serializeForPersistence();
        }
        if (!serialized.cbt) throw new Error('CBT force clone requires a validated V2 envelope');

        const cbt = await remapCBTForceCloneEnvelope(serialized.cbt);
        const record = this.buildCBTForcePersistenceRecord(
            Object.freeze({
                ...this.buildCBTForceMetadataRecord(cbt.forceId, new Date().toISOString()),
                owned: true,
            }),
            cbt,
        );
        const cloned = await CBTForce.deserialize(record, this.dataService, this.injector);
        if (!cloned.hasCBTForceV2()) {
            throw new Error('Cloned CBT V2 authority could not be installed');
        }
        return cloned;
    }

    public static async deserialize(
        data: SerializedCBTForce,
        dataService: DataService,
        injector: Injector,
    ): Promise<CBTForce> {
        const force = new CBTForce(data.name, dataService, injector);
        force.populateFromCBTForceV2(data);
        if (!await force.loadCBTForceV2Persistence(data)) {
            throw new Error('CBT force changed while it was loading');
        }
        return force;
    }

    protected override deserializeFrom(serialized: SerializedForce): Promise<CBTForce> {
        return CBTForce.deserialize(
            serialized as SerializedCBTForce,
            this.dataService, this.injector
        );
    }
}

function directAdmissionFailure(
    reason: Extract<CBTDirectUnitAdmissionResult, { readonly kind: 'failed' }>['reason'],
    message: string,
): Extract<CBTDirectUnitAdmissionResult, { readonly kind: 'failed' }> {
    return Object.freeze({ kind: 'failed', reason, message });
}

function rejectedRosterCommand(
    reason: CBTForceRosterCommandRejection['reason'],
): CBTForceRosterCommandRejection {
    return Object.freeze({ accepted: false, changed: false, reason });
}

function rejectedUnitRepair(
    reason: Extract<CBTUnitRepairResult, { readonly accepted: false }>['reason'],
): Extract<CBTUnitRepairResult, { readonly accepted: false }> {
    return Object.freeze({ accepted: false, changed: false, reason });
}

function rejectedUnitTransfer(
    reason: Extract<CBTUnitTransferResult, { readonly accepted: false }>['reason'],
): Extract<CBTUnitTransferResult, { readonly accepted: false }> {
    return Object.freeze({ accepted: false, changed: false, reason });
}

function rejectedRuntimeUndoCommand(
    reason: NonNullable<RuntimeUndoCommandResult['reason']>,
): RuntimeUndoCommandResult {
    return Object.freeze({ accepted: false, changed: false, reason });
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
