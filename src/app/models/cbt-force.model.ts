// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed, signal, type Injector } from '@angular/core';
import type { DataService } from '../services/data.service';
import type { UnitSummary } from './unit-summary.model';
import {
    forceMemberAdjustedValue,
    type CBTForceMember,
    type ForceMember,
} from './force-member.model';
import type { SerializedClassicForce, SerializedForce } from './force-serialization';
import { GameSystem } from './common.model';
import type { UnitConditionKey } from './unit-condition.model';
import {
    Force,
    MAX_UNITS,
    resolveSerializedFormation,
    UnitGroup,
    type CBTForceV2AuthorityMutationContext,
    type ForceOwnerRevisionFence,
    type ForceGroupPatch,
    type PreparedLoadedCBTForceV2Authority,
} from './force.model';
import {
    CBTEncounterRuntime,
    reduceTargetRegistry,
    type EncounterNetwork,
    type EncounterTargetId,
    type TargetRegistryCommand,
    type TargetRegistrySnapshot,
} from './runtime/encounter-runtime';
import {
    validateSerializedCBTForceV2,
    type SerializedCBTEncounterStateV2,
    type SerializedCBTForceV2,
    type SerializedForceEncounterEntryV2,
} from './runtime/persistence-v2';
import {
    asStateRevision,
    asUnitInstanceId,
    createUnitInstanceId,
    type StateRevision,
    type UnitInstanceId,
} from './runtime/runtime-state';
import { ReadyMekUnitService } from '../services/ready-mek-unit.service';
import { ReadyNonMekUnitService } from '../services/ready-non-mek-unit.service';
import { NativeEntityService } from '../services/native-entity.service';
import { ReadyMekUnitFactory } from './runtime/ready-unit-factory';
import {
    isReadyNonMekUnit,
    isReadyMekUnit,
    type ReadyClassicUnit,
    type ReadyTargetingReconciliation,
} from './runtime/ready-classic-unit';
import { isSerializedNonMekUnit } from './runtime/non-mek-unit-persistence';
import { jsonValuesEqual } from '../utils/json-value.util';
import type { JsonValue, SavedEntityIdentity } from './persisted-unit-state';
import {
    prepareCBTForcePersistenceV2 as prepareCurrentCBTForcePersistenceV2,
    prepareDirectUnitAdmission,
    type PreparedCBTForcePersistenceV2,
} from './runtime/force-persistence-boundary';
import {
    scenarioRuleset,
    type DeploymentConfiguration,
    type ScenarioRules,
} from './runtime/unit-state-initializer';
import type { ComponentId } from './entity/entity-identifiers';
import type { MekEntity } from './entity/entities/mek/mek-entity';
import type { BaseEntity } from './entity/base-entity';
import { effectiveEntityPilotingSkill } from './entity/utils/battle-value/skill-facts';
import { buildNonMekRuntimeIndex } from './runtime/non-mek-runtime-index';
import type {
    NonMekUnitCommand,
    NonMekUnitRuntimeState,
} from './runtime/non-mek-unit-instance';
import type {
    CBTUnitAttackerTargetingCommand,
    CBTUnitCommand,
    CBTUnitSelectedWeaponFireCommand,
} from './runtime/unit-instance';
import type { AttackerTargetingState } from './runtime/attacker-targeting-state';
import {
    evaluateMekRuntimeCapability,
    type MekRuntimeCapabilityDecision,
} from './runtime/mek-runtime-capability';
import {
    evaluateReadyMekRuntimeCapability,
    readyUnitMatchesEntity,
} from './runtime/cbt-ready-unit-validation';
import {
    createDefaultCrewAssignment,
    type CrewAssignment,
    type CrewAssignmentPosition,
} from './runtime/crew-assignment';
import type {
    UnitProviderId,
    UnitUuid,
} from '../services/unit-catalog/unit-catalog.types';
import { uuidv7 } from '../utils/uuid.util';
import {
    createHandlerCommandContext,
    createHandlerQueryContext,
    EquipmentInteractionRegistryService,
    type HandlerQueryContext,
    type V2EquipmentInteractionKind,
} from '../services/equipment-interaction-registry.service';
import { ToastService } from '../services/toast.service';
import { DialogsService } from '../services/dialogs.service';
import { OptionsService } from '../services/options.service';
import type { CBTOptionalRules } from './options.model';
import type { MekHeatAutomationPolicyV2 } from './runtime/mek-heat-state-v2';
import type { TnTargetUnitType } from './target-number-calculator.model';
import {
    prepareCBTForceRosterMutationPlan,
    type CBTForceRosterQueryResult,
    type CBTForceRosterCommand,
    type CBTForceRosterCommandResult,
    type CBTForceRosterGroupMetadataPatch,
    type CBTForceRosterMutationPlanResult,
} from './runtime/cbt-force-roster-owner';
import {
    calculateCBTForceBattleValues,
    type CBTForceBattleValueBreakdown,
} from './cbt-force-battle-value';
import {
    hasNonMekRuntime,
    hasMekRuntime,
    type CBTUnitSnapshot,
} from './cbt-unit-snapshot';
import {
    CBTForceAuthority,
    type CBTForceAuthorityFence,
    type PreparedUnitAdmission,
    type PreparedUnitRemoval,
    type PreparedUnitRepair,
} from './cbt-force-authority';
import {
    publishC3EmergencyMasterNotices,
} from './cbt-force-c3';
import { entityUnitLabel } from './runtime/cbt-unit-label';
import { CBT_FORCE_UNASSIGNED_GROUP_ID, queryCBTForceRoster } from './runtime/cbt-force-roster';
import {
    projectMekRecordSheet,
    projectMekUnitStatus,
    type MekRecordSheetSnapshot,
    type MekUnitStatusSnapshot,
} from './runtime/mek-record-sheet';
import {
    projectNonMekRecordSheet,
    type NonMekRecordSheetSnapshot,
} from './runtime/non-mek-record-sheet';
import {
    projectMekEquipmentPanel,
    type EquipmentPanelSnapshot,
} from './runtime/equipment-panel';
import { projectNonMekEquipmentPanel } from './runtime/non-mek-equipment-panel';
import type { EquipmentRowOrderGroup } from './runtime/equipment-row-order';
import {
    RUNTIME_HISTORY_MESSAGE,
    runtimeHistoryMessageUnitId,
    type RuntimeHistoryTargetKind,
} from './runtime/runtime-history';
import { scenarioRulesFromPersistence } from './runtime/cbt-force-scenario';
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
import {
    CBTForceRuntimeJournal,
    type CapturedRuntimeCommandMutation,
} from './runtime/cbt-force-runtime-journal';
import {
    projectMekTurnPanel,
    type MekTurnPanelSnapshot,
} from './runtime/mek-turn-panel';
import { CBTForceMemberRegistry } from './runtime/cbt-force-member-registry';
import { CBTForceMekMutationImpact } from './runtime/cbt-force-mek-mutation-impact';
import {
    rejectedRosterCommand,
    rejectedRuntimeUndoCommand,
    rejectedUnitRepair,
    rejectedUnitTransfer,
} from './runtime/cbt-force-command-rejections';
import { CBTForceUnitCommandDispatcher } from './runtime/cbt-force-unit-command-dispatcher';
import {
    nextForceRevision,
    pruneRemovedUnitsFromEncounter,
    remapCBTForceCloneEnvelope,
} from './runtime/cbt-force-persistence-helpers';
import {
    authorizeCBTForceTargetRegistryCommand,
} from './cbt-force-target-registry';
import { readOnlyTargetRegistry } from './runtime/encounter-runtime';

import type {
    AttackerTargetingCommandResult,
    AttackerTargetingSnapshot,
    CBTDirectUnitAdmissionRequest,
    CBTDirectUnitAdmissionResult,
    CBTForceEndTurnAllResult,
    CBTForceTargetRegistryAuthority,
    CBTForceTargetRegistryDispatchResult,
    CBTMekUnitCommandResult,
    CBTNonMekUnitCommandResult,
    CBTUnitRepairResult,
    CBTUnitTransferResult,
    C3State,
    EquipmentRowOrderCommandResult,
    InventoryControlTargetRosterRow,
    MekEquipmentChoiceDispatchResult,
    MekEquipmentChoiceToken,
    MekEquipmentInteraction,
    RuntimeUndoCommandResult,
    SelectedWeaponFireCommandResult,
} from './cbt-force-api';
export type * from './cbt-force-api';


type PreparedCBTForcePersistenceWithFence = PreparedCBTForcePersistenceV2 & Readonly<{
    authorityFence: CBTForceAuthorityFence;
}>;

function withAuthorityFence(
    prepared: PreparedCBTForcePersistenceV2,
    authorityFence: CBTForceAuthorityFence,
): PreparedCBTForcePersistenceWithFence {
    return Object.freeze({ ...prepared, authorityFence });
}


export class CBTForce extends Force<never> {
    override gameSystem: GameSystem = GameSystem.CLASSIC;
    public override hasEmptyGroups = computed(() => {
        this.groups();
        return this.getSupportedCBTForceV2Envelope()?.roster.groups.some(
            group => group.members.length === 0,
        ) ?? false;
    });
    public override totalBv = computed(() => {
        return this.getClassicMembers().reduce(
            (total, member) => total + forceMemberAdjustedValue(member, 'damaged'),
            0,
        );
    });
    private readonly encounterRuntime = new CBTEncounterRuntime();
    private readonly targetRegistryVersionState = signal(0);
    /** Reactive invalidation token for force-owned target queries. */
    readonly targetRegistryVersion = this.targetRegistryVersionState.asReadonly();
    readonly inventoryControlOpforEnabled = signal(false);
    private readonly authority = new CBTForceAuthority();
    private readonly memberRegistry = new CBTForceMemberRegistry(
        this,
        instanceId => this.authority.readyUnit(instanceId),
    );
    private readonly runtimeJournal = new CBTForceRuntimeJournal(this.authority);
    private readonly mekMutationImpact = new CBTForceMekMutationImpact();
    private readonly unitCommandDispatcher: CBTForceUnitCommandDispatcher;
    private readonly adjustedBattleValues = computed(() => {
        this.memberRegistry.dependOnBattleValueInputs();
        return this.calculateAdjustedBattleValues(
            this.encounterRuntime.snapshot().networks,
            'damaged',
        );
    });
    private readonly pristineAdjustedBattleValues = computed(() => {
        this.memberRegistry.dependOnBattleValueInputs();
        return this.calculateAdjustedBattleValues(
            this.encounterRuntime.snapshot().networks,
            'pristine',
        );
    });

    private calculateAdjustedBattleValues(
        networks: readonly EncounterNetwork[],
        damageMode: 'damaged' | 'pristine',
    ): ReadonlyMap<UnitInstanceId, CBTForceBattleValueBreakdown> {
        const scenario = this.authority.scenarioRules();
        if (!scenario) return new Map<UnitInstanceId, CBTForceBattleValueBreakdown>();
        const units = this.getClassicMembers().flatMap(member => {
            const unit = this.authority.readyUnit(member.id);
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
                this.authority.c3.isEndpointIntact(instanceId, componentId),
        });
    }
    constructor(name: string,
        dataService: DataService,
        injector: Injector) {
        super(name, dataService, injector);
        this.unitCommandDispatcher = new CBTForceUnitCommandDispatcher(this, injector, {
            readOnly: () => this.readOnly(),
            instanceIds: () => this.authority.instanceIds(),
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
        return this.authority.envelope();
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
            for (const unit of this.authority.liveUnits()) {
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
            this.encounterRuntime.snapshot().networks,
            this.authority.scenarioRules(),
            changedUnitIds,
            baseBattleValueChangedUnitIds,
            runtimeForceInputsChanged,
            runtimeOperationalC3InputsChanged,
        );
    }

    /** One force-owned presentation handle for each currently resolvable roster member. */
    public getClassicMembers(): readonly CBTForceMember[] {
        return this.memberRegistry.members();
    }

    protected override projectMembers(): ForceMember[] {
        this.groups();
        return [...this.getClassicMembers()];
    }

    protected override projectMembersInGroup(group: UnitGroup): ForceMember[] {
        if (group.force !== this || !this.groups().includes(group as UnitGroup<never>)) return [];
        return this.getClassicMembers().filter(member => member.rosterGroupId === group.id);
    }

    public getClassicMember(instanceId: UnitInstanceId): CBTForceMember | null {
        return this.memberRegistry.member(instanceId);
    }

    public getRosterGroupId(instanceId: UnitInstanceId): string | null {
        const envelope = this.getSupportedCBTForceV2Envelope();
        if (!envelope) return null;
        for (const group of envelope.roster.groups) {
            if (group.members.some(member => member.instanceId === instanceId)) return group.groupId;
        }
        return null;
    }

    public override getFormationUnitsForGroup(group: UnitGroup): readonly CBTForceMember[] {
        if (group.force !== this || !this.groups().includes(group as UnitGroup<never>)) return Object.freeze([]);
        return Object.freeze(this.getClassicMembers().filter(member => member.rosterGroupId === group.id));
    }

    /** Creates a real roster group; the returned UnitGroup is only its UI handle. */
    public override async addGroup(name?: string): Promise<UnitGroup<never>> {
        if (!this.getSupportedCBTForceV2Envelope()) await this.serializeForPersistence();
        const envelope = this.getSupportedCBTForceV2Envelope();
        if (!envelope) throw new Error('The canonical Classic force owner could not be initialized');
        const groupId = uuidv7();
        const result = await this.dispatchCanonicalRosterCommand({
            kind: 'create-group',
            groupId,
            atIndex: envelope.roster.groups.filter(
                group => group.groupId !== CBT_FORCE_UNASSIGNED_GROUP_ID,
            ).length,
            ...(name?.trim() ? { metadata: { name } } : {}),
        });
        if (!result.accepted) throw new Error(`Classic roster group creation failed: ${result.reason}`);
        const group = this.groups().find(candidate => candidate.id === groupId);
        if (!group) throw new Error(`Created Classic roster group ${groupId} has no UI projection`);
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
        instanceId: UnitInstanceId,
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

    public removeClassicMember(instanceId: UnitInstanceId): Promise<CBTForceRosterCommandResult> {
        return this.dispatchCanonicalRosterCommand({ kind: 'remove-member', instanceId });
    }

    public repairMember(instanceId: UnitInstanceId): Promise<CBTUnitRepairResult> {
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
        return this.enqueueCBTForceV2AuthorityMutation(async () => {
            if (this.readOnly()) return false;
            const context = this.prepareCBTForceV2AuthorityMutation();
            const current = context.previous;
            if (!current) return false;

            const previousScenario = scenarioRulesFromPersistence(current.scenarioRules.values);
            const scenario: ScenarioRules = Object.freeze({
                ...previousScenario,
                options: Object.freeze({
                    ...(previousScenario.options ?? {}),
                    ...requested,
                }),
            });
            const scenarioValues: JsonValue = Object.freeze({
                id: scenario.id,
                ruleset: scenarioRuleset(scenario),
                options: structuredClone(scenario.options!),
            });
            if (jsonValuesEqual(current.scenarioRules.values, scenarioValues)) return false;

            let fence: CBTForceAuthorityFence;
            let replacements: ReadonlyMap<UnitInstanceId, ReadyClassicUnit>;
            try {
                fence = this.authority.captureFence();
                const rows = await Promise.all([...fence.units].flatMap(([instanceId, unit]) =>
                    isReadyMekUnit(unit)
                        ? [ReadyMekUnitFactory.cloneForOwner(unit, scenario).then(candidate => {
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
                            return [instanceId, candidate] as const;
                        })]
                        : []));
                replacements = new Map(rows);
            } catch {
                return false;
            }
            if (!this.authority.isFenceCurrent(fence)) return false;

            let envelope: SerializedCBTForceV2;
            let preparedUnits: PreparedUnitRepair;
            try {
                envelope = await validateSerializedCBTForceV2({
                    ...current,
                    forceRevision: nextForceRevision(current.forceRevision),
                    scenarioRules: Object.freeze({
                        ...current.scenarioRules,
                        values: scenarioValues,
                    }),
                    units: current.units.map(entry => {
                        const ready = replacements.get(entry.instanceId)
                            ?? this.authority.readyUnit(entry.instanceId);
                        if (!ready) throw new Error(`Scenario rebinding lost runtime ${entry.instanceId}`);
                        const unit = ready.serialize();
                        return Object.freeze({
                            instanceId: entry.instanceId,
                            stateRevision: unit.stateRevision,
                            unit,
                        });
                    }),
                });
                preparedUnits = this.authority.prepareRepair(envelope, replacements, fence);
            } catch {
                return false;
            }

            const prepared: PreparedCBTForcePersistenceV2 = Object.freeze({ envelope, reused: false });
            const committed = this.commitCBTForceV2AuthorityMutation(
                context,
                prepared,
                () => this.authority.installRepair(preparedUnits),
                () => this.authority.rollbackRepair(preparedUnits),
            );
            if (committed.kind === 'rejected') return false;
            this.emitChangedFromReservedIntent(Object.freeze([...replacements.keys()]));
            return true;
        });
    }

    private repairMembers(
        requestedInstanceIds: readonly UnitInstanceId[] | null,
    ): Promise<CBTUnitRepairResult> {
        const capturedIds = requestedInstanceIds === null
            ? null
            : Object.freeze([...requestedInstanceIds]);
        return this.enqueueCBTForceV2AuthorityMutation(async () => {
            if (this.readOnly()) return rejectedUnitRepair('READ_ONLY');
            const context = this.prepareCBTForceV2AuthorityMutation();
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

            let fence: CBTForceAuthorityFence;
            let replacements: ReadonlyMap<UnitInstanceId, ReadyClassicUnit>;
            try {
                fence = this.authority.captureFence();
                replacements = await this.authority.buildRepairCandidates(instanceIds);
            } catch {
                return rejectedUnitRepair('REPAIR_FAILED');
            }
            if (!this.authority.isFenceCurrent(fence)) return rejectedUnitRepair('FORCE_CHANGED');
            if (replacements.size === 0) {
                return Object.freeze({
                    accepted: true as const,
                    changed: false,
                    forceRevision: current.forceRevision,
                });
            }
            const capture = this.captureRuntimeCommandMutation(instanceIds);

            let envelope: SerializedCBTForceV2;
            let preparedUnits: PreparedUnitRepair;
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
                preparedUnits = this.authority.prepareRepair(envelope, replacements, fence);
            } catch {
                return rejectedUnitRepair('PERSISTENCE_REJECTED');
            }

            const prepared: PreparedCBTForcePersistenceV2 = Object.freeze({ envelope, reused: false });
            const committed = this.commitCBTForceV2AuthorityMutation(
                context,
                prepared,
                () => this.authority.installRepair(preparedUnits),
                () => this.authority.rollbackRepair(preparedUnits),
            );
            if (committed.kind === 'rejected') {
                return rejectedUnitRepair(
                    committed.reason === 'install-failed' ? 'PERSISTENCE_REJECTED' : 'FORCE_CHANGED',
                );
            }
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
        instanceId: UnitInstanceId,
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
            ? this.enqueueCBTForceV2AuthorityMutation(() => target.enqueueCBTForceV2AuthorityMutation(run))
            : target.enqueueCBTForceV2AuthorityMutation(() => this.enqueueCBTForceV2AuthorityMutation(run));
    }

    private async transferMemberToNow(
        target: CBTForce,
        instanceId: UnitInstanceId,
        targetGroupId: string,
        atIndex: number,
    ): Promise<CBTUnitTransferResult> {
        if (this.readOnly() || target.readOnly()) return rejectedUnitTransfer('READ_ONLY');
        const sourceContext = this.prepareCBTForceV2AuthorityMutation();
        const targetContext = target.prepareCBTForceV2AuthorityMutation();
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
        if (!jsonValuesEqual(source.scenarioRules, destination.scenarioRules)) {
            return rejectedUnitTransfer('SCENARIO_MISMATCH');
        }
        const sourceRosterMember = source.roster.groups
            .flatMap(group => group.members)
            .find(member => member.instanceId === instanceId);
        const sourceUnit = this.authority.readyUnit(instanceId);
        if (!sourceRosterMember || !sourceUnit) {
            return rejectedUnitTransfer('NOT_READY');
        }

        let sourceFence: CBTForceAuthorityFence;
        let targetFence: CBTForceAuthorityFence;
        let candidate: ReadyClassicUnit;
        try {
            sourceFence = this.authority.captureFence();
            targetFence = target.authority.captureFence();
            candidate = isReadyMekUnit(sourceUnit)
                ? await ReadyMekUnitFactory.cloneForOwner(
                    sourceUnit,
                    scenarioRulesFromPersistence(destination.scenarioRules.values),
                )
                : sourceUnit;
            const targeting = candidate.planTargetingReconciliation(
                target.queryInventoryControlTargetRegistry(),
            );
            targeting?.install();
        } catch {
            return rejectedUnitTransfer('PERSISTENCE_REJECTED');
        }
        if (!this.authority.isFenceCurrent(sourceFence)
            || !target.authority.isFenceCurrent(targetFence)) {
            return rejectedUnitTransfer('FORCE_CHANGED');
        }

        const removal = this.prepareCanonicalRosterMutation({ kind: 'remove-member', instanceId });
        if (removal?.kind !== 'ready') return rejectedUnitTransfer('FORCE_CHANGED');
        let sourceEnvelope: SerializedCBTForceV2;
        let targetEnvelope: SerializedCBTForceV2;
        let sourceUnits: PreparedUnitRemoval;
        let targetUnits: PreparedUnitAdmission;
        try {
            const removed = new Set<UnitInstanceId>(removal.plan.removedInstanceIds ?? [instanceId]);
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
                liveUnits: target.authority.liveUnits(),
                candidate,
                scenarioRules: destination.scenarioRules.values,
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
            sourceUnits = this.authority.prepareRemoval(sourceEnvelope, [instanceId]);
            targetUnits = target.authority.prepareAdmission(targetEnvelope, candidate);
        } catch {
            return rejectedUnitTransfer('PERSISTENCE_REJECTED');
        }

        const committed = this.commitPairedCBTForceV2AuthorityMutations(
            target,
            {
                context: sourceContext,
                prepared: Object.freeze({ envelope: sourceEnvelope, reused: false }),
                installAuthority: () => this.authority.installRemoval(sourceUnits),
                rollbackAuthority: () => this.authority.rollbackRemoval(sourceUnits),
            },
            {
                context: targetContext,
                prepared: Object.freeze({ envelope: targetEnvelope, reused: false }),
                installAuthority: () => target.authority.installAdmission(targetUnits),
                rollbackAuthority: () => target.authority.rollbackAdmission(targetUnits),
            },
        );
        if (committed.kind === 'rejected') {
            return rejectedUnitTransfer(
                committed.reason === 'install-failed' ? 'PERSISTENCE_REJECTED' : 'FORCE_CHANGED',
            );
        }
        this.runtimeJournal.prune(new Set(removal.plan.removedInstanceIds ?? [instanceId]));
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
        return this.enqueueCBTForceV2AuthorityMutation(async () => {
            if (this.readOnly()) return rejectedRosterCommand('READ_ONLY');
            const context = this.prepareCBTForceV2AuthorityMutation();
            const current = context.previous;
            if (!current) return rejectedRosterCommand('NO_CANONICAL_ROSTER');
            const planned = this.prepareCanonicalRosterMutation(captured!);
            if (planned === null) return rejectedRosterCommand('NO_CANONICAL_ROSTER');
            if (planned.kind === 'rejected') return rejectedRosterCommand(planned.reason);

            let unitFence: CBTForceAuthorityFence;
            try {
                unitFence = this.authority.captureFence();
            } catch {
                return rejectedRosterCommand('FORCE_CHANGED');
            }

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

            if (!this.authority.isFenceCurrent(unitFence)) {
                return rejectedRosterCommand('FORCE_CHANGED');
            }
            const removedInstanceIds = planned.plan.removedInstanceIds ?? Object.freeze([]);
            const removedReadyIds = removedInstanceIds.filter(instanceId =>
                current.units.some(entry => entry.instanceId === instanceId));
            let removal: PreparedUnitRemoval | null = null;
            try {
                if (removedReadyIds.length > 0) {
                    removal = this.authority.prepareRemoval(envelope, removedReadyIds);
                }
            } catch {
                return rejectedRosterCommand('FORCE_CHANGED');
            }
            const prepared: PreparedCBTForcePersistenceV2 = Object.freeze({ envelope, reused: false });
            const committed = this.commitCBTForceV2AuthorityMutation(
                context,
                prepared,
                removal
                    ? () => this.authority.installRemoval(removal!)
                    : () => this.authority.commit(envelope),
                removal
                    ? () => this.authority.rollbackRemoval(removal!)
                    : () => this.authority.commit(current),
            );
            if (committed.kind === 'rejected') {
                return rejectedRosterCommand(
                    committed.reason === 'install-failed' ? 'PERSISTENCE_REJECTED' : 'FORCE_CHANGED',
                );
            }
            if (removedInstanceIds.length > 0) {
                this.runtimeJournal.prune(new Set(removedInstanceIds));
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
        let identity: CBTDirectUnitAdmissionRequest['identity'];
        let deployment: DeploymentConfiguration;
        let requestedScenario: ScenarioRules | undefined;
        let crewSkills: CBTDirectUnitAdmissionRequest['crewSkills'];
        let initialStateProfileId: string | undefined;
        let instanceId: UnitInstanceId;
        let targetRosterGroupId: string | undefined;
        let targetRosterMemberIndex: number | undefined;
        let commander = false;
        try {
            identity = Object.freeze({
                provider: request.identity.provider,
                uuid: request.identity.uuid,
            });
            deployment = structuredClone(request.deployment);
            requestedScenario = request.scenario === undefined
                ? undefined
                : structuredClone(request.scenario);
            crewSkills = request.crewSkills === undefined
                ? undefined
                : Object.freeze({
                    gunnery: request.crewSkills.gunnery,
                    piloting: request.crewSkills.piloting,
                });
            initialStateProfileId = request.initialStateProfileId;
            instanceId = request.instanceId === undefined
                ? createUnitInstanceId()
                : asUnitInstanceId(request.instanceId);
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

        return this.enqueueCBTForceV2AuthorityMutation(async () => {
            if (this.readOnly()) {
                return directAdmissionFailure('READ_ONLY', 'The force is read-only');
            }
            if (this.hasOwnedInstanceId(instanceId)) {
                return directAdmissionFailure(
                    'INSTANCE_ID_COLLISION',
                    `Force instance ${instanceId} is already owned`,
                );
            }

            let context: CBTForceV2AuthorityMutationContext;
            let unitFence: CBTForceAuthorityFence;
            try {
                // Capture every owner authority before catalog/runtime awaits;
                // Concurrent force, encounter, or runtime edits win.
                context = this.prepareCBTForceV2AuthorityMutation();
                unitFence = this.authority.captureFence();
            } catch (error) {
                return directAdmissionFailure('READ_ONLY', errorMessage(error));
            }
            let durableMemberCount: number;
            try {
                durableMemberCount = this.durableOwnedUnitCount(context);
            } catch (error) {
                return directAdmissionFailure('PERSISTENCE_REJECTED', errorMessage(error));
            }
            if (durableMemberCount >= MAX_UNITS) {
                return directAdmissionFailure(
                    'FORCE_FULL',
                    `Cannot add more than ${MAX_UNITS} units to a single force`,
                );
            }

            const nativeEntities = this.injector.get(NativeEntityService);
            const readyMeks = this.injector.get(ReadyMekUnitService);
            const readyNonMekUnits = this.injector.get(ReadyNonMekUnitService);
            let entity: BaseEntity;
            try {
                entity = (await nativeEntities.load(identity)).entity;
            } catch (error) {
                return directAdmissionFailure(
                    'CANDIDATE_PREPARATION_FAILED',
                    `The current native Entity source could not be resolved: ${errorMessage(error)}`,
                );
            }
            if (entity.entityType === 'Mek') {
                const decision = evaluateMekRuntimeCapability(entity as MekEntity);
                if (decision.readiness === 'deferred') {
                    return Object.freeze({ kind: 'deferred' as const, decision });
                }
            }
            if (crewSkills) {
                const defaults = createDefaultCrewAssignment(buildNonMekRuntimeIndex(entity).crewPositions);
                deployment = Object.freeze({
                    ...deployment,
                    crewAssignment: Object.freeze({
                        schemaVersion: 1 as const,
                        positions: Object.freeze(defaults.positions.map(position => Object.freeze({
                            ...position,
                            gunnery: crewSkills!.gunnery,
                            piloting: effectiveEntityPilotingSkill(entity, crewSkills!.piloting),
                        }))),
                    }),
                });
            }
            let scenario: ScenarioRules;
            try {
                scenario = context.previous
                    ? scenarioRulesFromPersistence(context.previous.scenarioRules.values)
                    : requestedScenario
                        ?? (() => { throw new Error('Scenario rules are required for the first V2 force member'); })();
            } catch (error) {
                return directAdmissionFailure('CANDIDATE_PREPARATION_FAILED', errorMessage(error));
            }
            const scenarioValues: JsonValue = Object.freeze({
                id: scenario.id,
                ruleset: scenarioRuleset(scenario),
                ...(scenario.options === undefined
                    ? {}
                    : { options: structuredClone(scenario.options) }),
            });
            let candidate: ReadyClassicUnit;
            try {
                candidate = entity.entityType === 'Mek'
                    ? await readyMeks.loadReadyMek({
                        identity,
                        instanceId,
                        deployment,
                        scenario,
                        ...(initialStateProfileId === undefined
                            ? {}
                            : { initialStateProfileId }),
                    })
                    : await readyNonMekUnits.loadReadyNonMekUnit({
                        identity,
                        instanceId,
                        deployment,
                        scenario,
                        ...(initialStateProfileId === undefined
                            ? {}
                            : { initialStateProfileId }),
                    });
                if (!readyUnitMatchesEntity(candidate, entity)) {
                    return directAdmissionFailure(
                        'SOURCE_MISMATCH',
                        'The ready candidate does not match the exact native source that was admitted',
                    );
                }
                if (isReadyMekUnit(candidate)) {
                    const decision = evaluateReadyMekRuntimeCapability(candidate);
                    if (decision.readiness === 'deferred') {
                        return Object.freeze({ kind: 'deferred' as const, decision });
                    }
                }
                // Force the strict unit codec while the candidate is still off-owner.
                candidate.serialize();
            } catch (error) {
                return directAdmissionFailure(
                    'CANDIDATE_PREPARATION_FAILED',
                    `The ready V2 candidate could not be constructed: ${errorMessage(error)}`,
                );
            }

            let liveUnits: readonly ReadyClassicUnit[];
            try {
                liveUnits = context.previous
                    ? this.authority.liveUnits()
                    : Object.freeze([]);
            } catch (error) {
                return directAdmissionFailure('FORCE_CHANGED', errorMessage(error));
            }
            const materialized = await prepareDirectUnitAdmission({
                forceId: context.metadata.instanceId,
                previous: context.previous,
                liveUnits,
                candidate,
                scenarioRules: scenarioValues,
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

            const canonicalEntry = materialized.envelope.units.find(
                entry => entry.instanceId === instanceId,
            );
            if (!canonicalEntry
                || isSerializedNonMekUnit(canonicalEntry.unit) !== isReadyNonMekUnit(candidate)) {
                return directAdmissionFailure(
                    'PERSISTENCE_REJECTED',
                    'The prepared current envelope does not contain the admitted unit family',
                );
            }
            try {
                candidate = isSerializedNonMekUnit(canonicalEntry.unit)
                    ? await readyNonMekUnits.restoreReadyNonMekUnit({ saved: canonicalEntry.unit })
                    : await readyMeks.restoreReadyMekV2({
                        saved: canonicalEntry.unit,
                        deployment,
                        scenario,
                        ...(initialStateProfileId === undefined
                            ? {}
                            : { initialStateProfileId }),
                    });
                if (!readyUnitMatchesEntity(candidate, entity)) {
                    return directAdmissionFailure(
                        'SOURCE_MISMATCH',
                        'The canonical candidate does not match the admitted native source',
                    );
                }
                if (isReadyMekUnit(candidate)) {
                    const decision = evaluateReadyMekRuntimeCapability(candidate);
                    if (decision.readiness === 'deferred') {
                        return Object.freeze({ kind: 'deferred' as const, decision });
                    }
                }
            } catch (error) {
                return directAdmissionFailure(
                    'CANDIDATE_PREPARATION_FAILED',
                    `The canonical V2 candidate could not be restored: ${errorMessage(error)}`,
                );
            }

            let latestEntity: BaseEntity;
            try {
                latestEntity = (await nativeEntities.load(identity)).entity;
            } catch (error) {
                return directAdmissionFailure(
                    'SOURCE_MISMATCH',
                    `The admitted native source is no longer current: ${errorMessage(error)}`,
                );
            }
            if (!readyUnitMatchesEntity(candidate, latestEntity)) {
                return directAdmissionFailure(
                    'SOURCE_MISMATCH',
                    'The native Entity source changed while direct admission was prepared',
                );
            }
            if (isReadyMekUnit(candidate)) {
                const decision = evaluateReadyMekRuntimeCapability(candidate);
                if (decision.readiness === 'deferred') {
                    return Object.freeze({ kind: 'deferred' as const, decision });
                }
            }
            if (!this.authority.isFenceCurrent(unitFence)) {
                return directAdmissionFailure(
                    'FORCE_CHANGED',
                    'A retained V2 runtime changed while direct admission was prepared',
                );
            }

            let preparedUnits: PreparedUnitAdmission;
            try {
                preparedUnits = this.authority.prepareAdmission(
                    materialized.envelope,
                    candidate,
                );
            } catch (error) {
                return directAdmissionFailure('FORCE_CHANGED', errorMessage(error));
            }
            try {
                durableMemberCount = this.durableOwnedUnitCount(context);
            } catch (error) {
                return directAdmissionFailure('PERSISTENCE_REJECTED', errorMessage(error));
            }
            if (this.readOnly()
                || durableMemberCount >= MAX_UNITS
                || this.hasOwnedInstanceId(instanceId)
                || !this.authority.isFenceCurrent(unitFence)
                || !readyUnitMatchesEntity(candidate, latestEntity)
                || !this.authority.canInstallAdmission(preparedUnits)) {
                return directAdmissionFailure(
                    'FORCE_CHANGED',
                    'The force changed while direct V2 admission was prepared',
                );
            }
            const committed = this.commitCBTForceV2AuthorityMutation(
                context,
                materialized,
                () => this.authority.installAdmission(preparedUnits),
                () => this.authority.rollbackAdmission(preparedUnits),
            );
            if (committed.kind === 'rejected') {
                return directAdmissionFailure(
                    committed.reason === 'install-failed' ? 'PERSISTENCE_REJECTED' : 'FORCE_CHANGED',
                    committed.reason === 'install-failed'
                        ? 'Direct V2 ownership installation failed and was rolled back'
                        : 'The force changed before direct V2 ownership could be installed',
                );
            }
            this.emitChangedFromReservedIntent();
            return Object.freeze({ kind: 'admitted' as const, instanceId });
        });
    }

    private durableOwnedUnitCount(context: CBTForceV2AuthorityMutationContext): number {
        return context.previous?.units.length ?? 0;
    }

    private hasOwnedInstanceId(instanceId: UnitInstanceId): boolean {
        return this.authority.instanceIds().some(id => id === instanceId)
            || this.cbtForceV2MemberInstanceIds().some(id => id === instanceId);
    }

    protected override getCBTEncounterStateForPersistence(): SerializedCBTEncounterStateV2 {
        if (!this.authority.c3.validateConfiguredNetworks(this.encounterRuntime.snapshot().networks)) {
            throw new Error('Cannot persist non-canonical C3 network facts');
        }
        return this.encounterRuntime.serializedState();
    }

    /** Read-only evidence; no runtime object or mutation API escapes this owner. */
    public getRuntimeInstanceIds(): readonly UnitInstanceId[] {
        return this.authority.instanceIds();
    }

    public getUnitDestroyed(instanceId: UnitInstanceId): boolean | null {
        return this.authority.unitDestroyed(instanceId);
    }

    public getUnitCrewAssignment(instanceId: UnitInstanceId): CrewAssignment | null {
        return this.authority.unitCrewAssignment(instanceId);
    }

    public getUnitConditions(instanceId: UnitInstanceId): readonly UnitConditionKey[] | null {
        return this.authority.unitConditions(instanceId);
    }

    public getUnitAdjustedBattleValue(instanceId: UnitInstanceId): number | null {
        return this.adjustedBattleValues().get(instanceId)?.adjusted ?? null;
    }

    public getUnitPristineAdjustedBattleValue(instanceId: UnitInstanceId): number | null {
        return this.pristineAdjustedBattleValues().get(instanceId)?.adjusted ?? null;
    }

    /** Canonical formula projected against a prospective C3 graph; no state is retained. */
    public previewAdjustedBattleValues(
        networks: readonly EncounterNetwork[],
    ): ReadonlyMap<UnitInstanceId, CBTForceBattleValueBreakdown> {
        return this.calculateAdjustedBattleValues(networks, 'damaged');
    }

    public getUnitCurrentBaseBattleValue(instanceId: UnitInstanceId): number | null {
        return this.authority.unitCurrentBaseBattleValue(instanceId);
    }

    public getUnitTagBattleValue(instanceId: UnitInstanceId): number | null {
        return this.adjustedBattleValues().get(instanceId)?.tag ?? null;
    }

    public getUnitC3BattleValue(instanceId: UnitInstanceId): number | null {
        return this.adjustedBattleValues().get(instanceId)?.c3 ?? null;
    }

    public getUnitPristineBattleValue(instanceId: UnitInstanceId): number | null {
        return this.authority.unitPristineBattleValue(instanceId);
    }

    public isUnitCommander(instanceId: UnitInstanceId): boolean {
        const roster = this.queryCanonicalRoster();
        return roster.kind === 'available'
            && roster.snapshot.members.some(member =>
                member.instanceId === instanceId && member.commander === true);
    }

    public getUnitSnapshot(instanceId: UnitInstanceId): CBTUnitSnapshot | null {
        return this.authority.unitSnapshot(instanceId);
    }

    /** Stable source identity for catalog-only presentation lookups. */
    public getUnitSourceIdentity(instanceId: UnitInstanceId): SavedEntityIdentity | null {
        return this.authority.readyUnit(instanceId)?.getSourceRef() ?? null;
    }

    /** Total entity + runtime record-sheet projection; no SVG participates. */
    public getMekRecordSheetSnapshot(instanceId: UnitInstanceId): MekRecordSheetSnapshot | null {
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
    public getMekUnitStatusSnapshot(instanceId: UnitInstanceId): MekUnitStatusSnapshot | null {
        const unit = this.getUnitSnapshot(instanceId);
        return unit && hasMekRuntime(unit)
            ? projectMekUnitStatus(unit.entity, unit.index, unit.state, unit.query)
            : null;
    }

    /** Total non-Mek Entity + sparse-runtime record-sheet projection; no SVG participates. */
    public getNonMekRecordSheetSnapshot(instanceId: UnitInstanceId): NonMekRecordSheetSnapshot | null {
        const unit = this.getUnitSnapshot(instanceId);
        if (!unit || !hasNonMekRuntime(unit)) return null;
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
        );
    }

    /** Entity + runtime equipment projection; no summary, SVG, mount, or runtime owner escapes. */
    public getEquipmentPanelSnapshot(
        instanceId: UnitInstanceId,
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
        const crew = this.getUnitCrewAssignment(instanceId);
        if (!crew) throw new Error(`Non-Mek runtime ${instanceId} has no crew assignment`);
        return projectNonMekEquipmentPanel(
            unit.entity,
            unit.index,
            unit.ruleset,
            unit.state,
            crew,
            registry,
        );
    }

    /** Entity + runtime turn projection; the legacy TurnState and sheet DOM are not inputs. */
    public getMekTurnPanelSnapshot(
        instanceId: UnitInstanceId,
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
        return this.runtimeJournal.undoState();
    }

    public getRuntimeHistory() {
        return this.runtimeJournal.history();
    }

    public hasRuntimeHistoryForUnitTurn(instanceId: UnitInstanceId, turn: number): boolean {
        return this.getRuntimeHistory().some(row => row.event.turn === turn
            && runtimeHistoryMessageUnitId(row.event.message) === instanceId);
    }

    public runtimeHistoryUnitLabel(instanceId: string): string {
        const unit = this.authority.readyUnit(asUnitInstanceId(instanceId));
        return unit ? entityUnitLabel(unit.getUnit(), unit.instanceId) : instanceId;
    }

    public runtimeHistoryTargetLabel(
        instanceId: string,
        kind: RuntimeHistoryTargetKind,
        targetId: string,
    ): string {
        const unit = this.authority.readyUnit(asUnitInstanceId(instanceId));
        return unit ? historyTargetLabel(unit, kind, targetId) : targetId;
    }

    public runtimeHistoryCrewLabel(instanceId: string, occurrence: number): string {
        const unit = this.authority.readyUnit(asUnitInstanceId(instanceId));
        return unit ? historyCrewLabel(unit, occurrence) : `Crew ${occurrence + 1}`;
    }

    public runtimeHistoryAmmoLabel(instanceId: string, munitionKey: string): string {
        const unit = this.authority.readyUnit(asUnitInstanceId(instanceId));
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
        return this.enqueueCBTForceV2AuthorityMutation(async () => {
            if (this.readOnly()) return rejectedRuntimeUndoCommand('READ_ONLY');
            const context = this.prepareCBTForceV2AuthorityMutation();
            const current = context.previous;
            if (!current) return rejectedRuntimeUndoCommand('EMPTY');
            const move = this.runtimeJournal.prepare(direction);
            if (!move) return rejectedRuntimeUndoCommand('EMPTY');
            const checkpoint = this.runtimeJournal.preserveCurrentOperationalState(move.checkpoint);

            let fence: CBTForceAuthorityFence;
            let replacements: ReadonlyMap<UnitInstanceId, ReadyClassicUnit>;
            try {
                fence = this.authority.captureFence();
                replacements = await this.authority.buildRuntimeCommandCandidates(checkpoint);
            } catch {
                return rejectedRuntimeUndoCommand('RESTORE_FAILED');
            }
            if (!this.authority.isFenceCurrent(fence)) {
                return rejectedRuntimeUndoCommand('FORCE_CHANGED');
            }

            let envelope: SerializedCBTForceV2;
            let preparedUnits: PreparedUnitRepair;
            try {
                const units = current.units.map(entry => {
                    const ready = replacements.get(entry.instanceId)
                        ?? this.authority.readyUnit(entry.instanceId);
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
                            // Encounter topology and targets are outside gameplay undo.
                            // Carry the live encounter through while restoring unit-local state.
                            encounter: Object.freeze({
                                ...current.encounter,
                                encounterRevision: context.typedEncounterState.encounterRevision,
                                state: context.typedEncounterState,
                            }),
                        }),
                });
                preparedUnits = this.authority.prepareRepair(envelope, replacements, fence);
            } catch {
                return rejectedRuntimeUndoCommand('RESTORE_FAILED');
            }

            const prepared: PreparedCBTForcePersistenceV2 = Object.freeze({ envelope, reused: false });
            const committed = this.commitCBTForceV2AuthorityMutation(
                context,
                prepared,
                () => this.authority.installRepair(preparedUnits),
                () => this.authority.rollbackRepair(preparedUnits),
            );
            if (committed.kind === 'rejected') {
                return rejectedRuntimeUndoCommand(
                    committed.reason === 'stale' ? 'FORCE_CHANGED' : 'RESTORE_FAILED',
                );
            }
            this.runtimeJournal.commit(move);
            this.emitChangedFromReservedIntent(Object.freeze([...replacements.keys()]));
            return Object.freeze({
                accepted: true,
                changed: true,
                entry: move.entry,
            });
        });
    }

    private captureRuntimeCommandMutation(
        instanceIds: readonly UnitInstanceId[],
    ): CapturedRuntimeCommandMutation {
        return this.runtimeJournal.capture(instanceIds);
    }

    /** Primary runtime plus the only peers C3 reconciliation is allowed to mutate. */
    private c3RuntimeMutationScope(
        instanceId: UnitInstanceId,
        emergencyMasterUnitIds = this.authority.c3.emergencyMasterUnitIds(),
    ): readonly UnitInstanceId[] {
        return Object.freeze([
            ...new Set([instanceId, ...emergencyMasterUnitIds]),
        ]);
    }

    private recordRuntimeCommandMutation(
        captured: CapturedRuntimeCommandMutation,
        history: RuntimeHistoryInput,
        boundary?: 'phase',
    ): readonly UnitInstanceId[] {
        return this.runtimeJournal.record(captured, history, boundary);
    }

    public dispatchNonMekUnitCommand(
        instanceId: UnitInstanceId,
        command: NonMekUnitCommand,
    ): Promise<CBTNonMekUnitCommandResult> {
        return this.unitCommandDispatcher.dispatchNonMek(instanceId, command);
    }

    private dispatchNonMekUnitCommandCore(
        instanceId: UnitInstanceId,
        command: NonMekUnitCommand,
    ): Promise<CBTNonMekUnitCommandResult> {
        const captured = Object.freeze({ ...command }) as NonMekUnitCommand;
        return this.enqueueCBTForceV2AuthorityMutation(() => {
            const ready = this.authority.readyNonMekUnit(instanceId);
            const beforeState = ready?.getInstance().snapshot();
            const beforeMode = captured.kind === 'set-component-mode'
                ? ready?.getInstance().componentMode(captured.componentId)
                : undefined;
            const capture = ready === null
                ? null
                : this.captureRuntimeCommandMutation([instanceId]);
            const result = this.authority.dispatchNonMekUnitCommand(
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
        instanceId: UnitInstanceId,
        command: CBTUnitCommand,
    ): Promise<CBTMekUnitCommandResult> {
        return this.unitCommandDispatcher.dispatchMek(instanceId, command);
    }

    private dispatchMekUnitCommandCore(
        instanceId: UnitInstanceId,
        command: CBTUnitCommand,
    ): Promise<CBTMekUnitCommandResult> {
        return this.enqueueCBTForceV2AuthorityMutation(() => {
            const ready = this.authority.readyMekUnit(instanceId);
            const beforeState = ready?.getInstance().snapshot();
            const beforeMode = command.type === 'set-component-mode'
                ? ready?.getInstance().query().componentMode(command.componentId)
                : undefined;
            const emergencyMasterUnitIds = this.authority.c3.emergencyMasterUnitIds();
            const capture = ready === null
                ? null
                : this.captureRuntimeCommandMutation(
                    this.c3RuntimeMutationScope(instanceId, emergencyMasterUnitIds),
                );
            const configuredNetworks = this.encounterRuntime.snapshot().networks;
            const c3EndTurn = command.type === 'end-turn'
                ? this.authority.c3.planEmergencyMasterEndTurn(instanceId, configuredNetworks)
                : null;
            const reduction = this.authority.dispatchMekUnitCommand(
                instanceId,
                command,
                this.readOnly(),
            );
            if (!reduction.accepted) return reduction;
            const settled = this.authority.c3.settleEmergencyMasterEndTurn(c3EndTurn);
            const reconciled = this.authority.c3.reconcileEmergencyMasters(
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
            const runtime = this.authority.readyMekUnit(instanceId)?.getInstance();
            return runtime
                ? Object.freeze({ ...reduction, changed, state: runtime.snapshot() })
                : reduction;
        });
    }

    protected override captureWholeOwnerSubclassAuthorityFence(): unknown {
        return this.authority.captureWholeOwnerFence();
    }

    protected override isWholeOwnerSubclassAuthorityFenceCurrent(fence: unknown): boolean {
        return fence !== null
            && typeof fence === 'object'
            && this.authority.isFenceCurrent(
                fence as CBTForceAuthorityFence,
            );
    }

    public getUnitCrewProfile(instanceId: UnitInstanceId): CrewAssignment | null {
        return this.authority.crewProfile(instanceId);
    }

    public async replaceUnitCrewProfile(
        instanceId: UnitInstanceId,
        positions: readonly CrewAssignmentPosition[],
    ): Promise<CrewAssignment | null> {
        let capturedPositions: readonly CrewAssignmentPosition[];
        try {
            capturedPositions = structuredClone(positions);
        } catch {
            return null;
        }
        const capturedInstanceId = instanceId;
        return this.enqueueCBTForceV2AuthorityMutation(async () => {
            if (this.readOnly()) return null;
            const ready = this.authority.readyUnit(capturedInstanceId);
            const beforeProfile = this.authority.crewProfile(capturedInstanceId);
            const capture = ready === null
                ? null
                : this.captureRuntimeCommandMutation([capturedInstanceId]);
            const executionGeneration = this.captureForceOwnerGeneration();
            return this.authority.replaceCrewProfile(
                capturedInstanceId,
                capturedPositions,
                this.injector.get(ReadyMekUnitService),
                () => this.readOnly(),
                () => this.isForceOwnerGenerationCurrent(executionGeneration),
                () => {
                    const afterReady = this.authority.readyUnit(capturedInstanceId);
                    const afterProfile = this.authority.crewProfile(capturedInstanceId);
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
        instanceId: UnitInstanceId,
    ): AttackerTargetingSnapshot | null {
        return this.authority.attackerTargetingSnapshot(
            instanceId,
            this.queryInventoryControlTargetRegistry(),
        );
    }

    public getC3State(instanceId: UnitInstanceId): C3State {
        this.memberRegistry.dependOnOperationalC3Inputs();
        return this.authority.c3.state(instanceId, this.encounterRuntime.snapshot().networks);
    }

    public isC3EndpointOperational(instanceId: UnitInstanceId, componentId: ComponentId): boolean {
        return this.authority.c3.isEndpointOperational(instanceId, componentId);
    }

    public async dispatchAttackerTargeting(
        instanceId: UnitInstanceId,
        command: CBTUnitAttackerTargetingCommand,
    ): Promise<AttackerTargetingCommandResult> {
        const capturedCommand = structuredClone(command);
        const capturedInstanceId = instanceId;
        return this.enqueueCBTForceV2AuthorityMutation(() => {
            const result = this.authority.dispatchAttackerTargeting(
                capturedInstanceId,
                capturedCommand,
                this.queryInventoryControlTargetRegistry(),
                this.encounterRuntime.snapshot().networks,
                this.readOnly(),
            );
            if (result.accepted && result.changed) {
                this.reserveForceOwnerMutationIntent();
                this.emitChangedFromReservedIntent([capturedInstanceId]);
            }
            return result;
        });
    }

    /** Presentation-only row order; intentionally excluded from gameplay undo/history. */
    public async dispatchEquipmentRowOrder(
        instanceId: UnitInstanceId,
        command: Readonly<{
            readonly group: EquipmentRowOrderGroup;
            readonly permutation: readonly number[];
        }>,
    ): Promise<EquipmentRowOrderCommandResult> {
        const capturedInstanceId = instanceId;
        const captured = Object.freeze({
            group: command.group,
            permutation: Object.freeze([...command.permutation]),
        });
        return this.enqueueCBTForceV2AuthorityMutation(() => {
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
            const result = this.authority.dispatchEquipmentRowOrder(
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
        instanceId: UnitInstanceId,
        command: CBTUnitSelectedWeaponFireCommand,
    ): Promise<SelectedWeaponFireCommandResult> {
        const capturedCommand = structuredClone(command);
        const capturedInstanceId = instanceId;
        return this.enqueueCBTForceV2AuthorityMutation(() => {
            const ready = this.authority.readyUnit(capturedInstanceId);
            const capture = ready === null
                ? null
                : this.captureRuntimeCommandMutation([capturedInstanceId]);
            const history = ready === null
                ? Object.freeze([])
                : selectedWeaponFireHistory(capturedInstanceId, ready);
            const result = this.authority.dispatchSelectedWeaponFire(
                capturedInstanceId,
                capturedCommand,
                this.queryInventoryControlTargetRegistry(),
                this.encounterRuntime.snapshot().networks,
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

    /** Detached Mek equipment rows; no runtime, facade or handler escapes. */
    public getMekEquipmentInteractions(
        choiceSurface?: HandlerQueryContext['choiceSurface'],
    ): readonly MekEquipmentInteraction[] {
        const registry = this.injector.get(EquipmentInteractionRegistryService).getRegistry();
        return this.authority.equipmentInteractions(
            registry,
            createHandlerQueryContext(this.dataService.getEquipmentRegistry(), choiceSurface),
            () => this.encounterRuntime.snapshot(),
            this.readOnly(),
        );
    }

    public async dispatchMekEquipmentChoice(
        token: MekEquipmentChoiceToken,
    ): Promise<MekEquipmentChoiceDispatchResult> {
        const capturedToken = token;
        return this.enqueueCBTForceV2AuthorityMutation(async () => {
            const selectedId = this.authority.equipmentChoiceInstanceId(capturedToken);
            const mutationScope = selectedId === null ? Object.freeze([]) : this.c3RuntimeMutationScope(selectedId);
            const capture = this.captureRuntimeCommandMutation(mutationScope);
            const beforeModes = captureMekComponentModes(this.authority, mutationScope);
            const executionGeneration = this.captureForceOwnerGeneration();
            const registry = this.injector.get(EquipmentInteractionRegistryService).getRegistry();
            const queryContext = createHandlerQueryContext(this.dataService.getEquipmentRegistry());
            return this.authority.dispatchEquipmentChoice(
                capturedToken,
                registry,
                queryContext,
                createHandlerCommandContext(
                    this.dataService.getEquipmentRegistry(),
                    this.injector.get(ToastService),
                    this.injector.get(DialogsService),
                    () => {
                        void import('../services/force-dialogs.service').then(({ ForceDialogsService }) =>
                            this.injector.get(ForceDialogsService).openC3Network(this, this.readOnly()))
                            .catch(() => this.injector.get(ToastService).showToast(
                                'Unable to open C3 network configuration',
                                'error',
                            ));
                    },
                ),
                () => this.encounterRuntime.snapshot(),
                () => this.readOnly(),
                () => this.isForceOwnerGenerationCurrent(executionGeneration),
                () => {
                    const modeChanges = changedComponentModeHistory(this.authority, beforeModes);
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

    public hasPendingEndTurnForUnit(instanceId: UnitInstanceId): boolean {
        return this.unitCommandDispatcher.hasPendingEndTurn(instanceId);
    }

    /** Ends every canonical V2 turn through one owner boundary. */
    public endTurnForAllUnits(): Promise<CBTForceEndTurnAllResult> {
        return this.unitCommandDispatcher.endTurnForAll();
    }

    private endTurnForAllUnitsCore(): Promise<CBTForceEndTurnAllResult> {
        return this.enqueueCBTForceV2AuthorityMutation(() => {
            const capture = this.captureRuntimeCommandMutation(
                this.authority.instanceIds(),
            );
            return this.authority.endTurnForAll(
                () => this.readOnly(),
                () => this.currentHeatPolicy(),
                this.encounterRuntime.snapshot().networks,
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

    private trackPhaseAndTurn(): boolean {
        return this.injector.get(OptionsService, null, { optional: true })
            ?.options().trackPhaseAndTurn ?? true;
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

    protected override async prepareLoadedCBTForceV2Authority(
        envelope: SerializedCBTForceV2,
    ): Promise<PreparedLoadedCBTForceV2Authority> {
        const needsReadyMekRestore = envelope.units.some(entry =>
            !isSerializedNonMekUnit(entry.unit));
        const needsReadyNonMekRestore = envelope.units.some(entry =>
            isSerializedNonMekUnit(entry.unit));
        const readyMeks = needsReadyMekRestore
            ? this.injector.get(ReadyMekUnitService, null, { optional: true })
            : undefined;
        const readyNonMekUnits = needsReadyNonMekRestore
            ? this.injector.get(ReadyNonMekUnitService, null, { optional: true })
            : undefined;
        const prepared = await this.authority.prepareLoad(
            envelope,
            readyMeks ?? undefined,
            readyNonMekUnits ?? undefined,
        );
        if (!this.authority.isPreparedLoadCurrent(prepared)) {
            throw new Error('Restored V2 runtime changed before load installation');
        }
        return Object.freeze({
            ...(prepared.envelope === envelope
                ? {}
                : { replacement: prepared.envelope }),
            canInstall: () => this.authority.isPreparedLoadCurrent(prepared),
            install: () => {
                this.authority.installLoad(prepared);
                this.resetRuntimeCommandSession();
            },
            ...(prepared.ignoredUnitIds.length === 0
                ? {}
                : {
                    afterInstall: () => this.injector.get(DialogsService).showNotice(
                        'Some V2 unit data could not be loaded and was ignored.',
                        'Save Loaded with Warnings',
                    ),
                }),
        });
    }

    protected override clearLoadedCBTForceV2Authority(): boolean {
        const encounter = this.encounterRuntime.serializedState();
        const changed = this.authority.instanceIds().length > 0
            || encounter.encounterRevision !== 0
            || encounter.facts.length > 0
            || this.inventoryControlOpforEnabled();
        this.authority.clear();
        this.runtimeJournal.reset();
        this.encounterRuntime.restoreSerialized(Object.freeze({
            schemaVersion: 2,
            encounterRevision: asStateRevision(0),
            facts: Object.freeze([]),
        }));
        this.inventoryControlOpforEnabled.set(false);
        this.invalidateInventoryControlTargetRegistry();
        return changed;
    }

    private resetRuntimeCommandSession(): void {
        this.runtimeJournal.reset();
    }

    protected override async prepareCBTForcePersistenceV2(input: {
        readonly forceId: string;
        readonly previous?: SerializedCBTForceV2;
        readonly typedEncounterState?: SerializedCBTEncounterStateV2;
    }): Promise<PreparedCBTForcePersistenceV2> {
        const previous = input.previous;
        let persistenceFence: CBTForceAuthorityFence;
        try {
            const installed = this.authority.envelope();
            persistenceFence = this.authority.captureFence();
            if (installed !== (previous ?? null)) {
                // The caller deliberately rechecks its owner pointer after this
                // asynchronous seam. Return a harmless stale candidate so that
                // it can retry with the newer runtime owner.
                const staleEnvelope = installed ?? previous;
                if (!staleEnvelope) throw new Error('The Classic authority disappeared during persistence');
                return withAuthorityFence(
                    Object.freeze({ envelope: staleEnvelope, reused: true }),
                    persistenceFence,
                );
            }
        } catch (error) {
            throw new Error(`V2_RUNTIME_SERIALIZATION_FAILED: ${errorMessage(error)}`);
        }
        if (!previous) {
            const prepared = await super.prepareCBTForcePersistenceV2(input);
            return withAuthorityFence(prepared, persistenceFence);
        }
        const liveUnits = this.authority.liveUnits();
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
        return withAuthorityFence(prepared, persistenceFence);
    }

    protected override isPreparedCBTForcePersistenceCurrent(
        prepared: PreparedCBTForcePersistenceV2,
    ): boolean {
        const fence = (prepared as Partial<PreparedCBTForcePersistenceWithFence>).authorityFence;
        return fence !== undefined && this.authority.isFenceCurrent(fence);
    }

    protected override commitPreparedCBTForcePersistenceV2(
        prepared: PreparedCBTForcePersistenceV2,
    ): void {
        this.authority.commit(prepared.envelope);
    }

    protected override restoreCBTEncounterPersistence(entry: SerializedForceEncounterEntryV2): void {
        this.encounterRuntime.restoreSerialized(entry.state);
        this.inventoryControlOpforEnabled.set(
            this.encounterRuntime.targetRegistry().targets.some(target => target.source === 'opfor'),
        );
        this.invalidateInventoryControlTargetRegistry();
    }

    /** Encounter-owned C3 graph; component-index arrays are never mechanics authority. */
    public c3EncounterNetworks(): readonly EncounterNetwork[] {
        return this.encounterRuntime.snapshot().networks;
    }

    /** Atomically replaces the complete encounter-owned C3 graph for a current editor session. */
    public replaceC3EncounterNetworksIfOwnerRevisionCurrent(
        revisionFence: ForceOwnerRevisionFence,
        networks: readonly EncounterNetwork[],
    ): boolean {
        if (this.readOnly()
            || !this.isForceOwnerRevisionFenceCurrent(revisionFence)
            || this.c3Networks().length > 0) return false;
        const detached = structuredClone(networks);
        const current = this.encounterRuntime.snapshot();
        if (jsonValuesEqual(current.networks, detached)
            || !this.authority.c3.validateConfiguredNetworks(detached)) return false;
        const affectedUnitIds = new Set<UnitInstanceId>();
        for (const network of [...current.networks, ...detached]) {
            for (const endpoint of network.endpoints) affectedUnitIds.add(endpoint.instanceId);
        }
        const c3UnitIds = this.authority.c3.emergencyMasterUnitIds();
        const c3Revisions = new Map(c3UnitIds.map(instanceId => [
            instanceId,
            this.authority.readyUnit(instanceId)?.revision() ?? null,
        ] as const));
        this.reserveForceOwnerMutationIntent();
        this.encounterRuntime.replaceNetworks(detached);
        const c3 = this.authority.c3.reconcileEmergencyMasters(
            this.encounterRuntime.snapshot().networks,
            c3UnitIds,
        );
        publishC3EmergencyMasterNotices(c3.notices, this.injector.get(ToastService));
        for (const instanceId of c3UnitIds) {
            if (this.authority.readyUnit(instanceId)?.revision() !== c3Revisions.get(instanceId)) {
                affectedUnitIds.add(instanceId);
            }
        }
        this.emitChangedFromReservedIntent(Object.freeze([...affectedUnitIds]));
        return true;
    }

    /** Detached, deeply frozen compare-and-swap query. */
    public queryInventoryControlTargetRegistry(): TargetRegistrySnapshot {
        this.targetRegistryVersionState();
        return this.encounterRuntime.targetRegistry();
    }

    /**
     * The only production target-registry write boundary. User replacement/reset
     * owns manual facts; OPFOR synchronization owns OPFOR facts. Neither authority
     * can replace facts owned by the other.
     */
    public dispatchInventoryControlTargetRegistry(
        command: TargetRegistryCommand,
        authority: CBTForceTargetRegistryAuthority = 'user',
    ): CBTForceTargetRegistryDispatchResult {
        const current = this.queryInventoryControlTargetRegistry();
        if (this.readOnly()) return readOnlyTargetRegistry(current);

        const authorized = authorizeCBTForceTargetRegistryCommand(current, command, authority);
        if ('accepted' in authorized) return authorized;
        const planned = reduceTargetRegistry(current, authorized);
        if (!planned.accepted || !planned.changed) return planned;
        const targetingReconciliation = this.authority.prepareTargetingReconciliation(planned.snapshot);
        this.reserveForceOwnerMutationIntent();
        const result = this.encounterRuntime.dispatchTargetRegistry(authorized);
        if (result.accepted && result.changed) {
            this.authority.installTargetingReconciliation(targetingReconciliation);
            this.targetRegistryVersionState.update(version => version + 1);
            this.emitChangedFromReservedIntent(Object.freeze([]));
        }
        return result;
    }

    /** Detached opponent roster across canonical V2 ownership. */
    public getInventoryControlTargetRoster(): readonly InventoryControlTargetRosterRow[] {
        const forceInstanceId = this.instanceId();
        if (!forceInstanceId) {
            throw new Error('A stable force instance ID is required to query the opponent target roster');
        }
        const mekRows = this.authority.targetRoster(forceInstanceId);
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

    private invalidateInventoryControlTargetRegistry(): void {
        this.targetRegistryVersionState.update(version => version + 1);
    }

    protected override buildCBTForcePersistenceRecord(
        metadata: SerializedForce,
        cbt: SerializedCBTForceV2,
    ): SerializedClassicForce {
        const history = this.authority.envelope()?.forceId === cbt.forceId
            ? this.runtimeJournal.serialize(cbt.history)
            : cbt.history;
        return super.buildCBTForcePersistenceRecord(
            metadata,
            history === cbt.history ? cbt : Object.freeze({ ...cbt, history }),
        );
    }

    public override serialize(): SerializedForce {
        const envelope = this.getSupportedCBTForceV2Envelope();
        if (!envelope) throw new Error('Use serializeForPersistence() to initialize a new Classic V2 force');
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
            if (!previous) throw new Error('Classic force clone requires a validated V2 envelope');
            const prepared = await this.prepareCBTForcePersistenceV2({
                forceId: previous.forceId,
                previous,
                typedEncounterState: this.getCBTEncounterStateForPersistence(),
            });
            serialized = Object.freeze({ ...this.serialize(), cbt: prepared.envelope });
        } else {
            serialized = await this.serializeForPersistence();
        }
        if (!serialized.cbt) throw new Error('Classic force clone requires a validated V2 envelope');

        const cbt = await remapCBTForceCloneEnvelope(serialized.cbt);
        const record = this.buildCBTForcePersistenceRecord(
            Object.freeze({
                ...this.buildCBTForceMetadataRecord(cbt.forceId, new Date().toISOString()),
                owned: true,
            }),
            cbt,
        );
        const cloned = CBTForce.deserializeV2(record, this.dataService, this.injector);
        if (!await cloned.loadCBTForceV2Persistence(record)) {
            throw new Error('Cloned Classic V2 authority could not be installed');
        }
        return cloned;
    }

    public static deserializeV2(
        data: SerializedClassicForce,
        dataService: DataService,
        injector: Injector,
    ): CBTForce {
        const force = new CBTForce(data.name, dataService, injector);
        force.populateFromCBTForceV2(data);
        return force;
    }

    protected override deserializeFrom(serialized: SerializedForce): CBTForce {
        return CBTForce.deserializeV2(
            serialized as SerializedClassicForce,
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

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
