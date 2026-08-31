// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ImmutableIndex, ImmutableSet } from '../entity/immutable-collections';
import type {
    ArmorFaceId,
    ComponentId,
    CrewPositionId,
    CriticalSlotId,
    LocationId,
} from '../entity/entity-identifiers';
import { asComponentId } from '../entity/entity-identifiers';
import type { EntityStateView } from '../entity/entity-state-view';
import type { EquipmentStatus } from '../equipment-status.model';
import {
    RuntimeEquipmentStatusKernel,
    type RuntimeEquipmentCommittedState,
    type RuntimeEquipmentStatusTopology,
} from './equipment-status-kernel';
import {
    asStateRevision,
    createCommandId,
    type MekUnitRuntimeState,
    type AmmoRuntimeState,
    type BombastLaserRuntimeState,
    type C3EmergencyMasterOperatingTurns,
    type C3EmergencyMasterRuntimeState,
    type CommandId,
    type ComponentRuntimeState,
    type CrewRuntimeState,
    type CriticalSlotRuntimeState,
    type EscalatingFailureRuntimeState,
    type EscalatingFailureSequence,
    type InstanceBaselineRef,
    type LocationRuntimeState,
    type MekLocationConditionKey,
    type MekShieldDamageRuntimeState,
    type PendingCombatOverlay,
    type PpcCapacitorRuntimeState,
    type StateRevision,
    type UnitInstanceId,
    freezeRuntimeState,
    MAX_MEK_CREW_WOUNDS,
    MAX_MEK_LOCATION_CONDITION_VALUE,
    MEK_LOCATION_CONDITION_KEYS,
} from './runtime-state';
import type { MekShieldTrack } from './mek-shield-rules';
import {
    physicalEquipmentOperatingHeatFromFlags,
    resolveShieldProfileFromFlags,
} from '../entity/utils/physical-weapon-kernel';
import {
    isShieldEquipment,
    isSpotWelderEquipment,
} from '../entity/utils/physical-weapon';
import { isDroneOperatingSystemEquipment } from '../drone-operating-system.model';
import {
    GAUSS_POWERED_UP,
    isSparseMekGaussPowerState,
    nextGaussPowerState,
    settledGaussPowerState,
    type MekGaussPowerState,
} from './mek-gauss-power';
import { isGaussEquipment } from '../gauss-equipment.model';
import {
    isPpcCapacitorPair,
    ppcCapacitorWeaponId,
    PPC_CAPACITOR_CHARGED_STATE,
    PPC_CAPACITOR_CHARGING_STATE,
} from './component-ppc-capacitor';
import {
    BOMBAST_LASER_CHARGED_STATE,
    BOMBAST_LASER_CHARGING_STATE,
    isCoreBombastLaserComponent,
} from './component-bombast-laser';
import { isC3EmergencyMasterComponent } from './component-c3-emergency-master';
import {
    canUseEscalatingFailure,
    componentEscalatingFailureDefinition,
    isBattleArmorMyomerBoosterEquipment,
    movementBoosterUsableWhile,
    selectEscalatingFailureComponentState,
    setEscalatingFailureComponentStatus,
    settleEscalatingFailureComponentState,
    type ComponentEscalatingFailureDefinition,
} from './component-escalating-failure';
import { isEcmEquipment } from '../ecm-mode.model';
import { ECMMode } from '../common.model';
import {
    HPG_IDLE_MODE,
    isMobileHpgMode,
    mobileHpgBlocksMovement,
    mobileHpgBlocksWeaponAttacks,
    mobileHpgMode,
    mobileHpgModeChangeReason,
    mobileHpgOperatingHeat,
    settleMobileHpgMode,
    type MobileHpgComponentFact,
} from './component-mobile-hpg';
import { isMobileHpgEquipment } from '../aerospace-support-equipment.model';
import { isBoobyTrapEquipment } from '../aerospace-support-equipment.model';
import {
    BOOBY_TRAP_ARMED_MODE,
    BOOBY_TRAP_DETONATED_MODE,
    isBoobyTrapDetonated,
} from './component-booby-trap';
import {
    electronicClaims,
    effectiveEcmMode,
    isEcmRuntimeMode,
    isNovaCewsEquipment,
    isPowerControlledEquipment,
    planElectronicModeRequest,
    planElectronicSettlement,
    type ElectronicComponentFact,
} from './component-electronic-suite';
import { C3EM_FRIED_SEQUENCE_VALUE } from '../c3-emergency-master.model';
import {
    canonicalizeMekTurnStateV2,
    createPristineMekTurnStateV2,
    MAX_MEK_TURN_NUMBER,
    mekTurnStatesEqualV2,
    serializeMekTurnStateV2,
    type MekTurnStateV2,
} from './mek-turn-state-v2';
import {
    canonicalizeCrewAssignment,
    createDefaultCrewAssignment,
    type CrewAssignment,
} from './crew-assignment';
import {
    isMekLocationPhysicallyDestroyed,
    isMekLocationPhysicallyDestroyedFromView,
    mekLocationParentId,
} from './mek-location-state-kernel';
import {
    applyMekWeaponFirePlanV2,
    mekWeaponAmmoMatches,
    planMekWeaponFireV2,
    type MekWeaponFireSelectionV2,
} from './mek-weapon-fire-v2';
import type { TargetRegistrySnapshot } from './encounter-runtime';
import type {
    PrototypeLaserHeatResult,
    PrototypeLaserHeatRoll,
} from '../prototype-laser-heat.model';
import type { CBTRuleset } from '../cbt-ruleset.model';
import { AmmoEquipment, WeaponEquipment } from '../equipment.model';
import {
    activeStealthHeatComponents,
    getActiveStealthTnModifiers,
    hasFunctionalEcmForStealth,
    isStealthEquipment,
    isStealthSystemEquipment,
    isSwitchableStealthEquipment,
    isVoidSignatureEquipment,
    nextStealthState,
    STEALTH_DISABLING_MODE,
    STEALTH_ENABLING_MODE,
    stealthStateForMode,
    unitHasActiveC3DisruptingStealth,
    unitHasActiveVoidSignature,
    type StealthEquipmentFacts,
    type StealthState,
} from '../stealth-equipment.model';
import type { TnStealthModifiers } from '../target-number-calculator.model';
import { MML_INVENTORY_MODES } from '../ammo-weapon-profile.model';
import {
    mekAmmoCapacity,
    mekAmmoDefaultMunitionKey,
    mekAmmoLoadout,
    mekAmmoLoadouts,
    mekIntrinsicMagazine,
    type AmmoLoadout,
} from './mek-ammo';
import { mekComponentModes } from './mek-component-rules';
import {
    effectiveMachineGunArrayMode,
    isMachineGunArrayController,
    isMachineGunArrayEquipment,
    isMachineGunArrayLifecycleState,
    isMachineGunArrayTransition,
    machineGunArrayLifecycleState,
    MGA_LINKED_MODE,
    nextMachineGunArrayState,
    settledMachineGunArrayState,
} from './component-machine-gun-array';
import {
    SHIELD_ACTIVE_MODE,
    SHIELD_INACTIVE_MODE,
} from './component-shield-mode';
import { canPerformMekAction } from './mek-action-availability';
import {
    COOLANT_POD_ACTIVE_MODE,
    COOLANT_POD_READY_MODE,
    isCoolantPodEquipment,
} from './component-coolant-pod';
import { rapidFireAutocannonSupportsJamming } from './component-rapid-fire-autocannon';
import { getVibrobladeProfileFromFlags } from '../rules/vibroblade-rules';
import { VIBROBLADE_ON_MODE } from '../vibroblade-mode.model';
import {
    createPristineAttackerTargetingState,
    freezeAttackerTargetingState,
    reduceAttackerTargetingCommand,
    reconcileAttackerTargetingState,
    type AttackerTargetingEdit,
    type AttackerTargetingState,
    type AttackerTargetingValidationContext,
} from './attacker-targeting-state';
import {
    setEquipmentRowOrder as updateEquipmentRowOrder,
    type EquipmentRowOrderGroup,
    type EquipmentRowOrderState,
} from './equipment-row-order';
import {
    isMekWeaponUnderwater,
    weaponTargetDisabledReason,
    resolveMekUnitWaterState,
    resolveMekTargetingAmmo,
} from './mek-targeting-rules';
import {
    applyPendingMekHeatContextV2,
    assertMekHeatContextEntityV2,
    buildMekHeatKernelInputV2,
    canonicalizeMekHeatStateV2,
    createUnboundMekHeatContextV2,
    disableMekHeatContextV2,
    MAX_MEK_HEATSINKS_OFF_V2,
    MAX_MEK_HEAT_VALUE_V2,
    mekHeatCapabilityV2,
    mekHeatContextMatchesEntityV2,
    mekHeatSourceSignatureV2,
    mekHeatStatesEqualV2,
    projectMekHeatContextV2,
    resolveEndTurnMekHeatContextV2,
    validateMekHeatContextStateV2,
    type MekHeatAutomationPolicyV2,
    type MekHeatCapabilityV2,
    type MekHeatKernelInputV2,
    type MekHeatProjectionResultV2,
    type MekHeatRuntimeContextV2,
    type MekHeatStateV2,
} from './mek-heat-state-v2';
import {
    createMekTorsoCripplingRuleCheckTokenV2,
    MEK_TORSO_CRIPPLING_RULE_CHECK_KEY,
    type MekDamageStateViewV2,
    type MekDestructionFactsV2,
    type MekRuleCheckKeyV2,
    type MekRuleCheckOutcomeV2,
    type MekRuleCheckStateV2,
    type MekRuleCheckTokenV2,
} from './mek-destruction-state-v2';
import {
    canonicalizeMekMovementPsrStateV2,
    clearMekActionV2,
    clearMekMovementV2,
    createPristineMekMovementPsrStateV2,
    dismissMekAutomaticFallsV2,
    dismissPendingMekPilotChecksV2,
    mekMovementPsrStatesEqualV2,
    resetMekMovementPsrPhaseV2,
    resetMekMovementPsrTurnV2,
    type MekActionDeclarationV2,
    type MekCommittedDamageMutationV2,
    type MekMovementDeclarationV2,
    type MekMovementModeV2,
    type MekMovementPsrProjectionResultV2,
    type MekMovementPsrStateV2,
    type MekPilotCheckDiceEvidenceV2,
    type MekPilotCheckV2,
} from './mek-movement-psr-v2';
import {
    assertMekMechanicsContextEntityV2,
    adjustMekStandAttemptsContextV2,
    createUnboundMekMechanicsContextV2,
    declareMekActionContextV2,
    declareMekMovementContextV2,
    mekMechanicsContextMatchesEntityV2,
    projectMekBattleValueMovementContextV2,
    projectMekC3EndpointCapabilitiesV2,
    projectMekCombatModifiersContextV2,
    projectMekDestructionContextV2,
    projectMekPhysicalAttacksContextV2,
    projectMekPilotChecksContextV2,
    projectMekShieldsContextV2,
    projectMekMovementPsrContextV2,
    prepareMekStandUpContextV2,
    reconcileMekPilotChecksContextV2,
    resolveMekStandAttemptContextV2,
    reconcileMekRuleChecksContextV2,
    resolveMekPilotCheckContextV2,
    resolveMekRuleCheckContextV2,
    synthesizeCommittedMekDamagePilotChecksContextV2,
    type MekC3EndpointCapabilitiesResultV2,
    type MekDestructionProjectionResultV2,
    type MekMechanicsContextV2,
    type MekMovementRuntimeContextInputV2,
    type MekShieldProjectionResultV2,
} from './mek-mechanics-context-v2';
import type { MekPhysicalAttackProjectionResultV2 } from './mek-physical-attack-v2';
import type { MekCombatModifierProjectionResult } from './mek-combat-modifiers';
import {
    isModularArmorEquipment,
    MODULAR_ARMOR_POINTS_PER_MOUNT,
} from '../modular-armor.model';
import {
    mekCriticalSlotDirectHitThreshold,
    mekCriticalSlotMaximumHits,
} from './mek-critical-slot-rules';
import {
    projectMekBlowOffV2,
    projectMekCriticalChanceV2,
    projectMekCriticalRollProfileV2,
    projectMekCriticalRollV2,
    projectPendingMekCriticalExplosionV2,
    type MekBlowOffPlanV2,
    type MekCriticalChanceProfileV2,
    type MekEquipmentExplosionPlanV2,
    type MekCriticalRollPlanV2,
    type MekCriticalRollProfileV2,
    type MekCriticalRuntimeViewV2,
} from './mek-critical-hit-v2';
import {
    buildMekRuntimeIndex,
    componentLocationIds,
    equipmentForComponent,
    type MekRuntimeIndex,
    type MekIndexedBay,
    type MekIndexedCriticalSlot,
} from './mek-runtime-index';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import type { MekSystemType } from '../entity/types';
import type {
    ClassicUnitQueryPort,
    RuntimeStatePerspective,
} from './classic-unit-runtime';

export type StatePerspective = RuntimeStatePerspective;
export type MekHitArcV2 = 'front' | 'rear' | 'left' | 'right';

interface MekRuntimeSource {
    readonly entity: MekEntity;
    readonly index: MekRuntimeIndex;
    readonly ruleset: CBTRuleset;
}

interface CommandEnvelope {
    readonly commandId: CommandId;
    readonly expectedRevision: StateRevision;
}

export interface CBTUnitAttackerTargetingCommand {
    readonly type: 'edit-attacker-targeting';
    readonly commandId: CommandId;
    readonly expectedRevision: StateRevision;
    readonly expectedRegistryRevision: StateRevision;
    readonly edit: AttackerTargetingEdit;
}

/** Fires the current targeting selection; no second weapon-selection payload exists. */
export interface CBTUnitSelectedWeaponFireCommand {
    readonly type: 'fire-selected-weapons';
    readonly commandId: CommandId;
    readonly expectedRevision: StateRevision;
    readonly expectedRegistryRevision: StateRevision;
    readonly heatPolicy: MekHeatAutomationPolicyV2;
    readonly prototypeHeatRolls?: readonly PrototypeLaserHeatRoll[];
}

export interface CBTUnitAttackerTargetingReconciliationPlan {
    readonly expectedRevision: StateRevision;
    readonly nextTargeting: AttackerTargetingState;
}

export type CBTUnitCommand = CommandEnvelope & (
    | {
        readonly type: 'damage-armor';
        readonly faceId: ArmorFaceId;
        readonly amount: number;
        readonly target: 'committed' | 'pending';
    }
    | {
        readonly type: 'repair-armor';
        readonly faceId: ArmorFaceId;
        readonly amount: number;
        readonly target: 'committed' | 'pending';
    }
    | {
        readonly type: 'damage-internal';
        readonly locationId: LocationId;
        readonly amount: number;
        readonly target: 'committed' | 'pending';
        /** Exact facing context captured before this hit crossed Hardened Armor. */
        readonly hardenedArmorApplies?: boolean;
        /** This same hit already damaged armor and initiated its breach check. */
        readonly armorDamagedBySameHit?: boolean;
    }
    | {
        readonly type: 'repair-internal';
        readonly locationId: LocationId;
        readonly amount: number;
        readonly target: 'committed' | 'pending';
    }
    | {
        readonly type: 'hit-critical';
        readonly slotId: CriticalSlotId;
        readonly hits: number;
        readonly target: 'committed' | 'pending';
    }
    | {
        readonly type: 'repair-critical';
        readonly slotId: CriticalSlotId;
        readonly hits: number;
        readonly target: 'committed' | 'pending';
    }
    | {
        readonly type: 'apply-mek-blow-off';
        readonly locationId: LocationId;
        readonly target: 'committed' | 'pending';
    }
    | {
        readonly type: 'apply-mek-critical-roll';
        readonly locationId: LocationId;
        readonly results: readonly number[];
        readonly target: 'committed' | 'pending';
        /** Defaults to true. Automation can retain the critical while skipping its explosion. */
        readonly applyExplosion?: boolean;
        /** Defaults to true. Pilot-hit automation may review these injuries separately. */
        readonly applyPilotHits?: boolean;
        /** Resolves charged-component explosions now so one reviewed command owns the outcome. */
        readonly settlePendingExplosion?: boolean;
    }
    | {
        /** Sets the cumulative authored record-sheet system track atomically. */
        readonly type: 'set-system-critical-level';
        readonly system: string;
        readonly level: number;
        readonly target: 'committed' | 'pending';
    }
    | {
        readonly type: 'set-component-status';
        readonly componentId: ComponentId;
        readonly status: EquipmentStatus;
        readonly target: 'committed' | 'pending';
    }
    | {
        readonly type: 'damage-shield';
        readonly componentId: ComponentId;
        readonly track: MekShieldTrack;
        readonly amount: number;
        readonly target: 'committed' | 'pending';
    }
    | {
        readonly type: 'repair-shield';
        readonly componentId: ComponentId;
        readonly track: MekShieldTrack;
        readonly amount: number;
        readonly target: 'committed' | 'pending';
    }
    | {
        readonly type: 'set-component-mode';
        readonly componentId: ComponentId;
        readonly mode: string;
    }
    | {
        readonly type: 'detonate-booby-trap';
        readonly componentId: ComponentId;
    }
    | {
        readonly type: 'set-stealth-state';
        readonly componentId: ComponentId;
        readonly state: StealthState;
    }
    | {
        readonly type: 'toggle-gauss-power';
        readonly componentId: ComponentId;
    }
    | {
        readonly type: 'set-component-jammed';
        readonly componentId: ComponentId;
        readonly jammed: boolean;
    }
    | {
        readonly type: 'edit-escalating-failure';
        readonly componentId: ComponentId;
        readonly edit:
            | { readonly kind: 'select-sequence'; readonly index: number }
            | { readonly kind: 'set-status'; readonly status: 'available' | 'disabled' };
    }
    | {
        readonly type: 'set-ppc-capacitor-charge';
        readonly capacitorId: ComponentId;
        readonly weaponId: ComponentId;
        readonly state: typeof PPC_CAPACITOR_CHARGING_STATE | null;
    }
    | {
        readonly type: 'set-bombast-laser-charge';
        readonly componentId: ComponentId;
        readonly state: typeof BOMBAST_LASER_CHARGING_STATE | null;
    }
    | {
        readonly type: 'edit-c3-emergency-master';
        readonly componentId: ComponentId;
        readonly edit:
            | { readonly kind: 'toggle-requested'; readonly turningOn: boolean }
            | { readonly kind: 'select-operating-turns'; readonly turns: C3EmergencyMasterOperatingTurns }
            | { readonly kind: 'ensure-active-started'; readonly endpointRole: 'master' }
            | { readonly kind: 'settle-active-end-turn'; readonly endpointRole: 'master' };
    }
    | {
        readonly type: 'configure-ammo-source';
        readonly componentId: ComponentId;
        readonly munitionKey: string;
        readonly remaining: number;
    }
    | {
        readonly type: 'spend-ammo';
        readonly componentId: ComponentId;
        readonly amount: number;
    }
    | {
        readonly type: 'activate-coolant-pod';
        readonly componentId: ComponentId;
    }
    | {
        readonly type: 'fire-weapons';
        readonly selections: readonly MekWeaponFireSelectionV2[];
        readonly heatPolicy: MekHeatAutomationPolicyV2;
        readonly prototypeHeatRolls?: readonly PrototypeLaserHeatRoll[];
    }
    | {
        readonly type: 'set-heat';
        readonly heat: number;
    }
    | {
        readonly type: 'set-pending-heat';
        readonly heat: number | null;
    }
    | {
        readonly type: 'set-heatsinks-off';
        readonly heatsinksOff: number;
    }
    | {
        readonly type: 'apply-heat';
        readonly policy: MekHeatAutomationPolicyV2;
    }
    | {
        readonly type: 'set-condition';
        readonly condition: string;
        readonly active: boolean;
    }
    | {
        /** Rules-owned shutdown transition used by heat automation. */
        readonly type: 'set-mek-shutdown-state';
        readonly shutdown: boolean;
    }
    | {
        readonly type: 'resolve-mek-rule-check';
        readonly key: MekRuleCheckKeyV2;
        readonly token: MekRuleCheckTokenV2;
        readonly outcome: MekRuleCheckOutcomeV2;
    }
    | {
        readonly type: 'set-location-condition';
        readonly locationId: LocationId;
        readonly condition: MekLocationConditionKey;
        /** Zero removes the condition; positive values are sparse state. */
        readonly value: number;
        readonly target: 'committed' | 'pending';
    }
    | {
        readonly type: 'set-crew-state';
        readonly positionId: CrewPositionId;
        readonly wounds: number;
        readonly unconscious: boolean;
        readonly ejected: boolean;
    }
    | {
        readonly type: 'declare-mek-movement';
        readonly declaration: MekMovementDeclarationV2;
    }
    | { readonly type: 'clear-mek-movement' }
    | {
        readonly type: 'declare-mek-action';
        readonly action: MekActionDeclarationV2;
    }
    | { readonly type: 'clear-mek-action' }
    | { readonly type: 'prepare-mek-stand' }
    | {
        readonly type: 'resolve-mek-stand-attempt';
        readonly carefulStand: boolean;
        readonly evidence?: MekPilotCheckDiceEvidenceV2;
    }
    | {
        readonly type: 'adjust-mek-stand-attempts';
        readonly delta: number;
    }
    | {
        readonly type: 'resolve-mek-pilot-check';
        readonly checkId: string;
        readonly evidence: MekPilotCheckDiceEvidenceV2;
    }
    | {
        readonly type: 'dismiss-mek-pilot-checks';
        /** Omitted dismisses every pending check. */
        readonly checkIds?: readonly string[];
    }
    | { readonly type: 'dismiss-mek-automatic-falls' }
    | {
        readonly type: 'replace-turn-state';
        readonly turn: MekTurnStateV2;
    }
    | { readonly type: 'reset-turn-state' }
    | { readonly type: 'end-phase' }
    | { readonly type: 'end-turn'; readonly policy: MekHeatAutomationPolicyV2 }
    | { readonly type: 'commit-pending' }
    | { readonly type: 'cancel-pending' }
);

export interface UnitDomainEvent {
    readonly kind: CBTUnitCommand['type']
        | CBTUnitAttackerTargetingCommand['type']
        | CBTUnitSelectedWeaponFireCommand['type'];
    readonly commandId: CommandId;
    readonly revision: StateRevision;
}

export type CommandReduction =
    | {
        readonly accepted: true;
        readonly idempotent: boolean;
        readonly previousRevision: StateRevision;
        readonly state: MekUnitRuntimeState;
        readonly events: readonly UnitDomainEvent[];
        readonly prototypeHeat?: readonly PrototypeLaserHeatResult[];
    }
    | {
        readonly accepted: false;
        readonly reason:
            | 'REVISION_CONFLICT'
            | 'COMMAND_ID_CONFLICT'
            | 'INVALID_TARGET'
            | 'INVALID_AMOUNT'
            | 'INVALID_TURN_STATE'
            | 'EXCEEDS_CAPACITY'
            | 'UNSUPPORTED_HEAT_CONTEXT'
            | 'UNSUPPORTED_MECHANICS_CONTEXT'
            | 'UNSUPPORTED_MOVEMENT_PSR_CONTEXT'
            | 'INVALID_MOVEMENT_PSR_DECLARATION'
            | 'ILLEGAL_MOVEMENT_PSR_DECLARATION'
            | 'INVALID_PILOT_CHECK'
            | 'INVALID_DICE_EVIDENCE'
            | 'OUTCOME_MISMATCH'
            | 'PENDING_PILOT_CHECKS'
            | 'INVALID_RULE_CHECK'
            | 'RULE_CHECK_TRIGGER_CONFLICT'
            | 'STALE_TARGET_REGISTRY'
            | 'FORCE_READ_ONLY'
            | 'INVALID_TARGETING'
            | 'C3_UNAVAILABLE'
            | 'NO_CHANGE';
        readonly currentRevision: StateRevision;
    };

export type MekEquipmentRowOrderResult =
    | Readonly<{
        readonly accepted: true;
        readonly changed: boolean;
        readonly currentRevision: StateRevision;
    }>
    | Readonly<{
        readonly accepted: false;
        readonly reason: 'REVISION_CONFLICT' | 'FORCE_READ_ONLY' | 'INVALID_ORDER';
        readonly currentRevision: StateRevision;
    }>;

export interface MekUnitQueryPort extends ClassicUnitQueryPort {
    /** Preview forced-withdrawal fact; unsupported contexts throw instead of guessing. */
    crippled(): boolean;
    /** Current committed BV, excluding force/C3 and crew-skill adjustments. */
    mekBattleValue(): MekBattleValueProjection;
    /** Current immutable physical-attack effects; availability remains a separate pure query. */
    mekPhysicalAttacks(): MekPhysicalAttackProjectionResultV2;
    /** Current derived shield tracks from entity topology plus sparse runtime facts. */
    mekShields(perspective?: StatePerspective): MekShieldProjectionResultV2;
    /** Current entity + sparse-runtime attack modifier breakdowns. */
    mekCombatModifiers(): MekCombatModifierProjectionResult;
    mekCriticalChance(
        locationId: LocationId,
        target: 'committed' | 'pending',
    ): MekCriticalChanceProfileV2;
    mekBlowOff(
        locationId: LocationId,
        target: 'committed' | 'pending',
    ): MekBlowOffPlanV2;
    mekCriticalRollProfile(
        locationId: LocationId,
        target: 'committed' | 'pending',
    ): MekCriticalRollProfileV2;
    mekCriticalRoll(
        locationId: LocationId,
        results: readonly number[],
        target: 'committed' | 'pending',
    ): MekCriticalRollPlanV2;
    mekDestruction(): MekDestructionProjectionResultV2;
    mekRuleCheck(key: MekRuleCheckKeyV2): MekRuleCheckStateV2 | undefined;
    /** Effective location availability, including inherited torso loss or flooding. */
    locationStatus(locationId: LocationId, perspective?: StatePerspective): EquipmentStatus;
    criticalHits(slotId: CriticalSlotId, perspective?: StatePerspective): number;
    componentStatusAtLocation(
        componentId: ComponentId,
        locationId: LocationId,
        perspective?: StatePerspective,
    ): EquipmentStatus;
    locationCondition(
        locationId: LocationId,
        condition: MekLocationConditionKey,
        perspective?: StatePerspective,
    ): number;
    componentStealthState(componentId: ComponentId): StealthState;
    functionalEcmForStealth(perspective?: StatePerspective): boolean;
    stealthTnModifiers(
        targetMoveDistance?: number,
        perspective?: StatePerspective,
    ): TnStealthModifiers | undefined;
    c3DisruptedByStealth(perspective?: StatePerspective): boolean;
    voidSignatureActive(perspective?: StatePerspective): boolean;
    componentGaussPower(componentId: ComponentId): MekGaussPowerState;
    componentJammed(componentId: ComponentId): boolean;
    componentEscalatingFailure(componentId: ComponentId): EscalatingFailureRuntimeState | undefined;
    componentPpcCapacitor(componentId: ComponentId): PpcCapacitorRuntimeState | undefined;
    componentBombastLaser(componentId: ComponentId): BombastLaserRuntimeState | undefined;
    componentC3EmergencyMaster(componentId: ComponentId): C3EmergencyMasterRuntimeState | undefined;
    shieldDamage(
        componentId: ComponentId,
        track: MekShieldTrack,
        perspective?: StatePerspective,
    ): number;
    modularArmorDamage(componentId: ComponentId, perspective?: StatePerspective): number;
    modularArmorRemaining(componentId: ComponentId, perspective?: StatePerspective): number;
    ammoLoadout(componentId: ComponentId): AmmoLoadout;
    ammoCapacity(componentId: ComponentId): number;
    heatState(): MekHeatStateV2;
    heatCapability(): MekHeatCapabilityV2;
    heatProjection(policy: MekHeatAutomationPolicyV2): MekHeatProjectionResultV2;
    mekMovementPsr(): MekMovementPsrProjectionResultV2;
    mekMovementPsrState(): MekMovementPsrStateV2;
    mekPilotChecks(): readonly MekPilotCheckV2[];
    /** Pure preview of the exact phase-boundary reduction; never mutates runtime state. */
    previewEndPhase(): CommandReduction;
    mekMovementMode():
        | { readonly kind: 'supported'; readonly mode: MekMovementModeV2 | null }
        | { readonly kind: 'unsupported' };
    /** Immutable deployment profile; wounds/consciousness are queried separately. */
    crewAssignment(): CrewAssignment;
    turnState(): MekTurnStateV2;
    linkedTarget(componentId: ComponentId): ComponentId | undefined;
    linkedSource(componentId: ComponentId): ComponentId | undefined;
    baysForMember(componentId: ComponentId): readonly MekIndexedBay[];
    baysControlledBy(componentId: ComponentId): readonly MekIndexedBay[];
    /** Entity-bound immutable C3 endpoint identities; no mounted/index projection escapes. */
    mekC3Endpoints(): MekC3EndpointCapabilitiesResultV2;
}

export type MekBattleValueProjection =
    | Readonly<{
        kind: 'complete';
        battleValue: number;
        defensive: number;
        offensive: number;
        manualBattleValue?: number;
        manualOverrideApplied: false;
    }>
    | Readonly<{ kind: 'unsupported'; blockers: readonly Readonly<{ reason: string }>[] }>;

const IDEMPOTENCY_WINDOW = 256;

export class CBTUnitInstance {
    readonly #source: MekRuntimeSource;
    readonly #runtimeIndex: MekRuntimeIndex;
    readonly #statusTopology: RuntimeEquipmentStatusTopology;
    readonly #crewAssignment: CrewAssignment;
    readonly #heatContext: MekHeatRuntimeContextV2;
    readonly #mechanicsContext: MekMechanicsContextV2;
    readonly #acceptedCommands = new Map<CommandId, {
        readonly commandKey: string;
        readonly reduction: Extract<CommandReduction, { accepted: true }>;
    }>();
    #state: MekUnitRuntimeState;

    public constructor(
        public readonly id: UnitInstanceId,
        public readonly baselineRef: InstanceBaselineRef,
        public readonly unit: MekEntity,
        ruleset: CBTRuleset,
        initialState: MekUnitRuntimeState,
        crewAssignment?: CrewAssignment,
        heatContext: MekHeatRuntimeContextV2 = createUnboundMekHeatContextV2(),
        mechanicsContext: MekMechanicsContextV2 = createUnboundMekMechanicsContextV2(),
    ) {
        this.#runtimeIndex = buildMekRuntimeIndex(unit);
        this.#source = Object.freeze({ entity: unit, index: this.#runtimeIndex, ruleset });
        validateState(initialState, this.#source);
        this.#crewAssignment = canonicalizeCrewAssignment(
            this.#runtimeIndex.crewPositions,
            crewAssignment ?? createDefaultCrewAssignment(this.#runtimeIndex.crewPositions),
        );
        this.#statusTopology = buildStatusTopology(this.#source);
        assertMekHeatContextEntityV2(heatContext, unit);
        assertMekMechanicsContextEntityV2(mechanicsContext, unit);
        this.#mechanicsContext = mechanicsContext;
        const reconciled = reconcileMekDerivedState(
            this.#source,
            initialState,
            this.#mechanicsContext,
            initialState.stateRevision,
        );
        const heatBlockers = validateMekHeatContextStateV2(
            heatContext,
            unit,
            buildHeatKernelInput(this.#source, reconciled, this.#statusTopology),
        );
        this.#heatContext = heatContext.kind === 'supported' && heatBlockers.length > 0
            ? disableMekHeatContextV2(heatContext, heatBlockers)
            : heatContext;
        this.#state = freezeRuntimeState(reconciled);
        Object.seal(this);
    }

    public ruleset(): CBTRuleset {
        return this.#source.ruleset;
    }

    public revision(): StateRevision {
        return this.#state.stateRevision;
    }

    public snapshot(): MekUnitRuntimeState {
        return this.#state;
    }

    public getIndex(): MekRuntimeIndex {
        return this.#runtimeIndex;
    }

    /**
     * Narrow entity-currentness fence used by Ready/admission owners.
     * It compares both private compiled-context witnesses without exposing
     * either context, profile, or witness to the caller.
     */
    public matchesEntity(entity: MekEntity): boolean {
        return this.unit === entity
            && mekHeatContextMatchesEntityV2(this.#heatContext, entity)
            && mekMechanicsContextMatchesEntityV2(this.#mechanicsContext, entity);
    }

    public query(): MekUnitQueryPort {
        const state = this.#state;
        const unit = this.#source;
        const statusTopology = this.#statusTopology;
        let committedStatus: RuntimeEquipmentStatusKernel | undefined;
        let previewStatus: RuntimeEquipmentStatusKernel | undefined;
        const createStatusKernel = (perspective: StatePerspective): RuntimeEquipmentStatusKernel =>
            new RuntimeEquipmentStatusKernel(
                statusTopology,
                statusState(unit, state, perspective),
                { rules: unit.ruleset, family: 'mek' },
            );
        // One query captures one immutable state revision. Build each perspective's
        // shared rules context once instead of rebuilding and revalidating it for
        // every component, slot, and location lookup in the same projection.
        const statusKernel = (perspective: StatePerspective): RuntimeEquipmentStatusKernel => {
            if (perspective === 'committed') {
                return committedStatus ??= createStatusKernel(perspective);
            }
            return previewStatus ??= createStatusKernel(perspective);
        };
        let destructionProjection: MekDestructionProjectionResultV2 | undefined;
        const mechanicsProjection = (): MekDestructionProjectionResultV2 =>
            destructionProjection ??= projectRuntimeMekDestruction(
                unit,
                state,
                this.#mechanicsContext,
            );
        let sharedProjectionContext: MekRuntimeProjectionContext | undefined;
        const projectionContext = (): MekRuntimeProjectionContext =>
            sharedProjectionContext ??= Object.freeze({
                committedStatus: statusKernel('committed'),
                destruction: mechanicsProjection(),
            });
        let criticalProjectionView: MekCriticalRuntimeViewV2 | undefined;
        const criticalView = (): MekCriticalRuntimeViewV2 =>
            criticalProjectionView ??= criticalRuntimeView(unit, state, statusTopology);
        let movementResult: MekMovementPsrProjectionResultV2 | undefined;
        const movementProjection = (): MekMovementPsrProjectionResultV2 =>
            movementResult ??= projectRuntimeMekMovementPsr(
                unit,
                state,
                statusTopology,
                this.#crewAssignment,
                this.#mechanicsContext,
                projectionContext(),
            );
        const droneOperatingSystemIds = [...unit.index.components.values()]
            .filter(component => component.kind === 'equipment'
                && isDroneOperatingSystemEquipment(component.mount.equipment))
            .map(component => component.id);
        const hasDroneOperatingSystem = droneOperatingSystemIds.length > 0;
        const effectiveCrewState = (positionId: CrewPositionId): 'healthy' | 'ejected' | 'unconscious' | 'dead' => {
            const position = unit.index.crewPositions.get(positionId);
            if (!position) throw new Error(`Unknown crew position ${positionId}`);
            const crew = state.crew.get(positionId) ?? HEALTHY_CREW_STATE;
            if (crew.wounds >= MAX_MEK_CREW_WOUNDS) return 'dead';
            const destruction = mechanicsProjection();
            if (destruction.kind === 'supported') {
                const hasCommandConsole = this.unit.mountedCockpit().hasCommandConsoleBonus;
                const cockpitDestroyed = !hasCommandConsole
                    ? destruction.facts.committed.mainCockpitUnavailable
                    : position.occurrence === 0
                        ? destruction.facts.committed.mainCockpitUnavailable
                        : position.occurrence === 1
                            ? destruction.facts.committed.commandConsoleUnavailable
                            : false;
                if (cockpitDestroyed) return 'dead';
            }
            if (crew.ejected) return 'ejected';
            if (crew.unconscious) return 'unconscious';
            return 'healthy';
        };
        const hasEffectiveCondition = (condition: string): boolean => {
            if (state.conditions.has(condition)) return true;
            if (condition === 'spotting') return state.turn.spotting;
            if (condition === 'disconnected') {
                return hasDroneOperatingSystem && droneOperatingSystemIds.every(componentId =>
                    statusKernel('committed').component(componentId).status !== 'available');
            }
            if (condition === 'abandoned') {
                const positions = [...unit.index.crewPositions.values()];
                return !hasDroneOperatingSystem
                    && positions.length > 0
                    && positions.every(position => {
                        const crew = effectiveCrewState(position.id);
                        return crew === 'dead' || crew === 'ejected';
                    });
            }
            if (condition === 'immobile') {
                const movement = movementProjection();
                return movement.kind === 'supported' && movement.immobile;
            }
            if (condition === 'crippled') {
                const destruction = mechanicsProjection();
                return destruction.kind === 'supported' && destruction.facts.preview.crippled;
            }
            return false;
        };
        const pilotChecksProjection = () => projectMekPilotChecksContextV2(
            this.#mechanicsContext,
            this.unit,
            state.movementPsr,
        );
        const battleValueProjection = () => projectRuntimeMekBattleValue(
            unit,
            this.#runtimeIndex,
            state,
            statusTopology,
            this.#crewAssignment,
            this.#mechanicsContext,
            projectionContext(),
        );
        return Object.freeze({
            stateRevision: state.stateRevision,
            hasPendingCombat: () => hasPending(state.pendingCombat),
            destroyed: () => {
                const projection = mechanicsProjection();
                if (projection.kind === 'unsupported') {
                    throw new Error('Mek destruction mechanics context is unsupported');
                }
                return projection.facts.committed.destroyed;
            },
            crippled: () => {
                const projection = mechanicsProjection();
                if (projection.kind === 'unsupported') {
                    throw new Error('Mek destruction mechanics context is unsupported');
                }
                return projection.facts.preview.crippled;
            },
            currentBaseBattleValue: () => {
                const projection = battleValueProjection();
                return projection.kind === 'complete' ? projection.battleValue : null;
            },
            mekBattleValue: battleValueProjection,
            mekPhysicalAttacks: () => projectRuntimeMekPhysicalAttacks(
                unit,
                state,
                statusTopology,
                this.#crewAssignment,
                this.#mechanicsContext,
                projectionContext(),
            ),
            mekShields: (perspective: StatePerspective = 'committed') => projectRuntimeMekShields(
                unit,
                state,
                statusTopology,
                this.#mechanicsContext,
                perspective,
                statusKernel(perspective),
            ),
            mekCombatModifiers: () => projectRuntimeMekCombatModifiers(
                unit,
                state,
                statusTopology,
                this.#crewAssignment,
                this.#mechanicsContext,
                projectionContext(),
            ),
            mekCriticalChance: (locationId: LocationId, target: 'committed' | 'pending') => projectMekCriticalChanceV2(
                unit.entity,
                unit.index,
                unit.ruleset,
                criticalView(),
                locationId,
                target,
            ),
            mekBlowOff: (locationId: LocationId, target: 'committed' | 'pending') => projectMekBlowOffV2(
                unit.index,
                criticalView(),
                locationId,
                target,
            ),
            mekCriticalRollProfile: (
                locationId: LocationId,
                target: 'committed' | 'pending',
            ) => projectMekCriticalRollProfileV2(
                unit.entity,
                unit.index,
                unit.ruleset,
                criticalView(),
                locationId,
                target,
            ),
            mekCriticalRoll: (
                locationId: LocationId,
                results: readonly number[],
                target: 'committed' | 'pending',
            ) => projectMekCriticalRollV2(
                unit.entity,
                unit.index,
                unit.ruleset,
                criticalView(),
                locationId,
                results,
                target,
            ),
            mekDestruction: mechanicsProjection,
            mekRuleCheck: (key: MekRuleCheckKeyV2) => {
                if (key !== MEK_TORSO_CRIPPLING_RULE_CHECK_KEY) {
                    throw new Error(`Unknown Mek rule check ${String(key)}`);
                }
                const check = state.ruleChecks.get(key);
                return check === undefined ? undefined : Object.freeze({ ...check });
            },
            remainingArmor: (faceId: ArmorFaceId, perspective: StatePerspective = 'committed') => {
                const face = unit.index.armorFaces.get(faceId);
                if (!face) throw new Error(`Unknown armor face ${faceId}`);
                return Math.max(0, face.maximumPoints - armorDamage(state, faceId, perspective));
            },
            remainingInternal: (locationId: LocationId, perspective: StatePerspective = 'committed') => {
                const location = unit.index.locations.get(locationId);
                if (!location) throw new Error(`Unknown location ${locationId}`);
                return Math.max(0, location.internalPoints - internalDamage(state, locationId, perspective));
            },
            locationStatus: (locationId: LocationId, perspective: StatePerspective = 'committed') => {
                if (!unit.index.locations.has(locationId)) throw new Error(`Unknown location ${locationId}`);
                return runtimeLocationStatus(unit, state, locationId, perspective);
            },
            criticalHits: (slotId: CriticalSlotId, perspective: StatePerspective = 'committed') => {
                if (!unit.index.slots.has(slotId)) throw new Error(`Unknown critical slot ${slotId}`);
                return criticalHits(state, slotId, perspective);
            },
            componentStatus: (componentId: ComponentId, perspective: StatePerspective = 'committed') => {
                const kernel = statusKernel(perspective);
                const status = kernel.component(componentId).status;
                return shieldAwareComponentStatus(
                    unit,
                    state,
                    statusTopology,
                    this.#mechanicsContext,
                    componentId,
                    perspective,
                    status,
                    kernel,
                );
            },
            componentStatusAtLocation: (
                componentId: ComponentId,
                locationId: LocationId,
                perspective: StatePerspective = 'committed',
            ) => requireComponent(unit, componentId, () => {
                if (!componentLocationIds(unit.index, componentId).includes(locationId)) {
                    throw new Error(`Component ${componentId} is not installed at ${locationId}`);
                }
                const kernel = statusKernel(perspective);
                const status = kernel.componentAtLocation(componentId, locationId).status;
                return shieldAwareComponentStatus(
                    unit,
                    state,
                    statusTopology,
                    this.#mechanicsContext,
                    componentId,
                    perspective,
                    status,
                    kernel,
                );
            }),
            locationCondition: (
                locationId: LocationId,
                condition: MekLocationConditionKey,
                perspective: StatePerspective = 'committed',
            ) => {
                if (!unit.index.locations.has(locationId)) throw new Error(`Unknown location ${locationId}`);
                if (!isMekLocationConditionKey(condition)) throw new Error(`Unknown location condition ${condition}`);
                return locationConditionValue(state, locationId, condition, perspective);
            },
            componentMode: (componentId: ComponentId) => {
                return effectiveComponentMode(unit, state, componentId);
            },
            componentStealthState: (componentId: ComponentId) => {
                return componentStealthState(unit, state, componentId);
            },
            functionalEcmForStealth: (perspective: StatePerspective = 'preview') => {
                return hasFunctionalEcmForStealth(buildMekStealthFacts(
                    unit,
                    state,
                    statusTopology,
                    perspective,
                ));
            },
            stealthTnModifiers: (
                targetMoveDistance = 0,
                perspective: StatePerspective = 'preview',
            ) => getActiveStealthTnModifiers(
                buildMekStealthFacts(unit, state, statusTopology, perspective),
                targetMoveDistance,
                state.destroyed || state.conditions.has('shutdown'),
            ),
            c3DisruptedByStealth: (perspective: StatePerspective = 'preview') => (
                unitHasActiveC3DisruptingStealth(
                    buildMekStealthFacts(unit, state, statusTopology, perspective),
                    state.destroyed || state.conditions.has('shutdown'),
                )
            ),
            voidSignatureActive: (perspective: StatePerspective = 'preview') => (
                unitHasActiveVoidSignature(
                    buildMekStealthFacts(unit, state, statusTopology, perspective),
                    state.destroyed || state.conditions.has('shutdown'),
                )
            ),
            componentGaussPower: (componentId: ComponentId) => gaussPowerState(unit, state, componentId),
            componentJammed: (componentId: ComponentId) => {
                const component = unit.index.components.get(componentId);
                if (!component) throw new Error(`Unknown component ${componentId}`);
                return state.components.get(componentId)?.jammed ?? false;
            },
            componentEscalatingFailure: (componentId: ComponentId) => {
                const component = unit.index.components.get(componentId);
                if (!component) throw new Error(`Unknown component ${componentId}`);
                const lifecycle = state.components.get(componentId)?.escalatingFailure;
                return lifecycle === undefined ? undefined : Object.freeze({ ...lifecycle });
            },
            componentPpcCapacitor: (componentId: ComponentId) => {
                if (!unit.index.components.has(componentId)) throw new Error(`Unknown component ${componentId}`);
                const lifecycle = state.components.get(componentId)?.ppcCapacitor;
                return lifecycle === undefined ? undefined : Object.freeze({ ...lifecycle });
            },
            componentBombastLaser: (componentId: ComponentId) => {
                if (!unit.index.components.has(componentId)) throw new Error(`Unknown component ${componentId}`);
                const lifecycle = state.components.get(componentId)?.bombastLaser;
                return lifecycle === undefined ? undefined : Object.freeze({ ...lifecycle });
            },
            componentC3EmergencyMaster: (componentId: ComponentId) => {
                if (!unit.index.components.has(componentId)) throw new Error(`Unknown component ${componentId}`);
                const lifecycle = state.components.get(componentId)?.c3EmergencyMaster;
                return lifecycle === undefined ? undefined : Object.freeze({ ...lifecycle });
            },
            shieldDamage: (
                componentId: ComponentId,
                track: MekShieldTrack,
                perspective: StatePerspective = 'committed',
            ) => {
                requireShieldProfile(unit, componentId);
                return shieldDamage(state, componentId, track, perspective);
            },
            modularArmorDamage: (
                componentId: ComponentId,
                perspective: StatePerspective = 'committed',
            ) => {
                requireModularArmor(unit, componentId);
                return modularArmorDamage(state, componentId, perspective);
            },
            modularArmorRemaining: (
                componentId: ComponentId,
                perspective: StatePerspective = 'committed',
            ) => modularArmorRemaining(unit, state, componentId, perspective),
            ammoLoadout: (componentId: ComponentId) => requireAmmoLoadout(
                unit,
                componentId,
                state.ammo.get(componentId)?.munitionOverride,
            ),
            ammoCapacity: (componentId: ComponentId) => requireAmmoCapacity(
                unit,
                componentId,
                state.ammo.get(componentId)?.munitionOverride,
            ),
            remainingAmmo: (componentId: ComponentId) => {
                const ammo = state.ammo.get(componentId);
                const capacity = requireAmmoCapacity(unit, componentId, ammo?.munitionOverride);
                return capacity - (ammo?.shotsSpent ?? 0);
            },
            ammoEquipment: (componentId: ComponentId) => requireAmmoLoadout(
                unit,
                componentId,
                state.ammo.get(componentId)?.munitionOverride,
            ).equipment,
            heatState: () => state.heat,
            heatCapability: () => mekHeatCapabilityV2(
                this.#heatContext,
                this.unit,
            ),
            heatProjection: (policy: MekHeatAutomationPolicyV2) => {
                if (!isHeatPolicy(policy)) {
                    return Object.freeze({
                        kind: 'unsupported' as const,
                        blockers: Object.freeze(['Invalid heat automation policy']),
                    });
                }
                return projectMekHeatContextV2(
                    this.#heatContext,
                    this.unit,
                    buildHeatKernelInput(unit, state, statusTopology),
                    policy,
                );
            },
            mekMovementPsr: movementProjection,
            mekMovementPsrState: () => state.movementPsr,
            mekPilotChecks: () => {
                const projection = pilotChecksProjection();
                return projection.kind === 'supported' ? projection.checks : state.movementPsr.checks;
            },
            mekMovementMode: () => movementProjection().kind === 'unsupported'
                ? Object.freeze({ kind: 'unsupported' as const })
                : Object.freeze({ kind: 'supported' as const, mode: state.movementPsr.movement?.mode ?? null }),
            attackerTargetingState: () => state.attackerTargeting,
            equipmentRowOrder: () => state.equipmentRowOrder,
            hasCondition: (condition: string) => {
                if (!boundedRuntimeText(condition)) throw new Error('Invalid runtime condition');
                return hasEffectiveCondition(condition);
            },
            conditions: () => Object.freeze([...state.conditions]),
            crewAssignment: () => this.#crewAssignment,
            crewState: (positionId: CrewPositionId) => {
                if (!unit.index.crewPositions.has(positionId)) {
                    throw new Error(`Unknown crew position ${positionId}`);
                }
                return state.crew.get(positionId) ?? HEALTHY_CREW_STATE;
            },
            turnState: () => state.turn,
            previewEndPhase: () => this.preview({
                type: 'end-phase',
                commandId: createCommandId(),
                expectedRevision: state.stateRevision,
            }),
            linkedTarget: (componentId: ComponentId) => requireComponent(unit, componentId, () =>
                unit.index.relationships.linkedTargetBySource.get(componentId)),
            linkedSource: (componentId: ComponentId) => requireComponent(unit, componentId, () =>
                unit.index.relationships.linkedSourceByTarget.get(componentId)),
            baysForMember: (componentId: ComponentId) => requireComponent(unit, componentId, () =>
                unit.index.relationships.bays.filter(bay => bay.memberIds.includes(componentId))),
            baysControlledBy: (componentId: ComponentId) => requireComponent(unit, componentId, () =>
                unit.index.relationships.bays.filter(bay => bay.controllerId === componentId)),
            mekC3Endpoints: () => projectMekC3EndpointCapabilitiesV2(
                this.#mechanicsContext,
                this.unit,
            ),
        });
    }

    private preview(command: CBTUnitCommand): CommandReduction {
        return reduce(
            this.#source,
            this.getIndex(),
            this.#state,
            command,
            this.query(),
            this.#statusTopology,
            this.#heatContext,
            this.#mechanicsContext,
        );
    }

    public dispatch(command: CBTUnitCommand): CommandReduction {
        return this.dispatchOwned(command, () => reduce(
            this.#source,
            this.getIndex(),
            this.#state,
            command,
            this.query(),
            this.#statusTopology,
            this.#heatContext,
            this.#mechanicsContext,
        ));
    }

    /** Force-owned targeting lane; weapon/ammo facts are always derived from this entity. */
    public dispatchAttackerTargeting(
        command: CBTUnitAttackerTargetingCommand,
        registry: TargetRegistrySnapshot,
        forceReadOnly: boolean,
    ): CommandReduction {
        return this.dispatchOwned(command, () => reduceAttackerTargeting(
            this.#source,
            this.getIndex(),
            this.#state,
            command,
            registry,
            forceReadOnly,
            this.query(),
            this.#statusTopology,
        ));
    }

    public dispatchSelectedWeaponFire(
        command: CBTUnitSelectedWeaponFireCommand,
        registry: TargetRegistrySnapshot,
        forceReadOnly: boolean,
        c3Available: boolean,
    ): CommandReduction {
        return this.dispatchOwned(command, () => reduceSelectedWeaponFire(
            this.#source,
            this.getIndex(),
            this.#state,
            command,
            registry,
            forceReadOnly,
            c3Available,
            this.query(),
            this.#statusTopology,
            this.#heatContext,
            this.#mechanicsContext,
        ));
    }

    public planAttackerTargetingReconciliation(
        registry: TargetRegistrySnapshot,
        forceReadOnly: boolean,
    ): CBTUnitAttackerTargetingReconciliationPlan | null {
        const context = buildAttackerTargetingContext(
            this.#source,
            this.getIndex(),
            this.#state,
            registry,
            forceReadOnly,
        );
        const planned = reconcileAttackerTargetingState(this.#state.attackerTargeting, context);
        if (!planned.accepted) throw new Error(`Attacker targeting reconciliation failed: ${planned.reason}`);
        const nextTargeting = reconcileMekWeaponTargetPolicies(
            this.#source,
            this.getIndex(),
            this.query(),
            registry,
            planned.state,
        );
        return planned.changed || nextTargeting !== planned.state
            ? Object.freeze({
                expectedRevision: this.#state.stateRevision,
                nextTargeting,
            })
            : null;
    }

    /** Updates presentation order without entering gameplay undo/history. */
    public setEquipmentRowOrder(
        expectedRevision: StateRevision,
        group: EquipmentRowOrderGroup,
        permutation: readonly number[],
        rowCount: number,
        forceReadOnly: boolean,
    ): MekEquipmentRowOrderResult {
        if (expectedRevision !== this.#state.stateRevision) {
            return Object.freeze({
                accepted: false,
                reason: 'REVISION_CONFLICT',
                currentRevision: this.#state.stateRevision,
            });
        }
        if (forceReadOnly) {
            return Object.freeze({
                accepted: false,
                reason: 'FORCE_READ_ONLY',
                currentRevision: this.#state.stateRevision,
            });
        }
        let equipmentRowOrder: EquipmentRowOrderState | undefined;
        try {
            equipmentRowOrder = updateEquipmentRowOrder(
                this.#state.equipmentRowOrder,
                group,
                permutation,
                rowCount,
            );
        } catch {
            return Object.freeze({
                accepted: false,
                reason: 'INVALID_ORDER',
                currentRevision: this.#state.stateRevision,
            });
        }
        if (equipmentRowOrder === this.#state.equipmentRowOrder) {
            return Object.freeze({
                accepted: true,
                changed: false,
                currentRevision: this.#state.stateRevision,
            });
        }
        const { equipmentRowOrder: _currentOrder, ...current } = this.#state;
        this.#state = freezeRuntimeState({
            ...current,
            stateRevision: asStateRevision(this.#state.stateRevision + 1),
            ...(equipmentRowOrder === undefined ? {} : { equipmentRowOrder }),
        });
        return Object.freeze({
            accepted: true,
            changed: true,
            currentRevision: this.#state.stateRevision,
        });
    }

    /** Installs a precomputed synchronous reconciliation; the force owns the surrounding CAS. */
    public commitAttackerTargetingReconciliation(
        plan: CBTUnitAttackerTargetingReconciliationPlan,
    ): boolean {
        if (this.#state.stateRevision !== plan.expectedRevision) return false;
        const nextRevision = asStateRevision(this.#state.stateRevision + 1);
        this.#state = freezeRuntimeState({
            ...this.#state,
            stateRevision: nextRevision,
            attackerTargeting: plan.nextTargeting,
        });
        return true;
    }

    private dispatchOwned(
        command: CBTUnitCommand | CBTUnitAttackerTargetingCommand | CBTUnitSelectedWeaponFireCommand,
        apply: () => CommandReduction,
    ): CommandReduction {
        const previous = this.#acceptedCommands.get(command.commandId);
        if (previous) {
            let commandKey: string;
            try {
                commandKey = canonicalCommandKey(command);
            } catch {
                return {
                    accepted: false,
                    reason: 'COMMAND_ID_CONFLICT',
                    currentRevision: this.#state.stateRevision,
                };
            }
            if (previous.commandKey !== commandKey) {
                return {
                    accepted: false,
                    reason: 'COMMAND_ID_CONFLICT',
                    currentRevision: this.#state.stateRevision,
                };
            }
            return { ...previous.reduction, idempotent: true };
        }
        if (command.expectedRevision !== this.#state.stateRevision) {
            return { accepted: false, reason: 'REVISION_CONFLICT', currentRevision: this.#state.stateRevision };
        }
        const next = apply();
        if (!next.accepted) return next;
        const commandKey = canonicalCommandKey(command);
        this.#state = next.state;
        this.#acceptedCommands.set(command.commandId, Object.freeze({ commandKey, reduction: next }));
        while (this.#acceptedCommands.size > IDEMPOTENCY_WINDOW) {
            this.#acceptedCommands.delete(this.#acceptedCommands.keys().next().value!);
        }
        return next;
    }
}

function reduceAttackerTargeting(
    unit: MekRuntimeSource,
    index: MekRuntimeIndex,
    state: MekUnitRuntimeState,
    command: CBTUnitAttackerTargetingCommand,
    registry: TargetRegistrySnapshot,
    forceReadOnly: boolean,
    runtime: MekUnitQueryPort,
    statusTopology: RuntimeEquipmentStatusTopology,
): CommandReduction {
    if (command.edit.kind === 'set-component-selection'
        && command.edit.selection !== null
        && mobileHpgBlocksWeaponAttacks(
            buildMekMobileHpgFacts(unit, state, statusTopology, 'committed'),
        )) return rejected(state, 'INVALID_TARGETING');
    let context: AttackerTargetingValidationContext;
    try {
        context = buildAttackerTargetingContext(unit, index, state, registry, forceReadOnly);
    } catch {
        return rejected(state, 'INVALID_TARGETING');
    }
    const planned = reduceAttackerTargetingCommand(state.attackerTargeting, context, {
        expectedRegistryRevision: command.expectedRegistryRevision,
        ...command.edit,
    });
    if (!planned.accepted) {
        return rejected(
            state,
            planned.reason === 'STALE_REGISTRY'
                ? 'STALE_TARGET_REGISTRY'
                : planned.reason === 'READ_ONLY'
                    ? 'FORCE_READ_ONLY'
                    : 'INVALID_TARGETING',
        );
    }
    if (!planned.changed) return rejected(state, 'NO_CHANGE');
    if (command.edit.kind === 'set-component-selection'
        && command.edit.selection?.kind === 'target'
        && !mekWeaponTargetSelectionAllowed(
            unit,
            index,
            runtime,
            registry,
            planned.state,
            command.edit.componentId,
        )) {
        return rejected(state, 'INVALID_TARGETING');
    }
    const nextTargeting = reconcileMekWeaponTargetPolicies(
        unit, index, runtime, registry, planned.state,
    );
    const nextRevision = asStateRevision(state.stateRevision + 1);
    const nextState = freezeRuntimeState({
        ...state,
        stateRevision: nextRevision,
        attackerTargeting: nextTargeting,
    });
    return Object.freeze({
        accepted: true,
        idempotent: false,
        previousRevision: state.stateRevision,
        state: nextState,
        events: Object.freeze([{ kind: command.type, commandId: command.commandId, revision: nextRevision }]),
    });
}

function reduceSelectedWeaponFire(
    unit: MekRuntimeSource,
    index: MekRuntimeIndex,
    state: MekUnitRuntimeState,
    command: CBTUnitSelectedWeaponFireCommand,
    registry: TargetRegistrySnapshot,
    forceReadOnly: boolean,
    c3Available: boolean,
    runtime: MekUnitQueryPort,
    statusTopology: RuntimeEquipmentStatusTopology,
    heatContext: MekHeatRuntimeContextV2,
    mechanicsContext: MekMechanicsContextV2,
): CommandReduction {
    if (command.expectedRegistryRevision !== registry.revision) {
        return rejected(state, 'STALE_TARGET_REGISTRY');
    }
    if (forceReadOnly) return rejected(state, 'FORCE_READ_ONLY');
    if (mobileHpgBlocksWeaponAttacks(
        buildMekMobileHpgFacts(unit, state, statusTopology, 'committed'),
    )) return rejected(state, 'INVALID_TARGETING');
    if (!isHeatPolicy(command.heatPolicy)) return rejected(state, 'INVALID_TARGET');

    let context: AttackerTargetingValidationContext;
    try {
        context = buildAttackerTargetingContext(unit, index, state, registry, false);
    } catch {
        return rejected(state, 'INVALID_TARGETING');
    }
    const reconciled = reconcileAttackerTargetingState(state.attackerTargeting, context);
    if (!reconciled.accepted || reconciled.changed) return rejected(state, 'INVALID_TARGETING');
    if (reconcileMekWeaponTargetPolicies(unit, index, runtime, registry, state.attackerTargeting)
        !== state.attackerTargeting) return rejected(state, 'INVALID_TARGETING');

    const selected = [...state.attackerTargeting.components]
        .filter(([, component]) => component.selection !== undefined)
        .sort(([left], [right]) => String(left).localeCompare(String(right)));
    const selectedTargetIds = new Set(selected.flatMap(([, component]) =>
        component.selection?.kind === 'target' ? [component.selection.targetId] : []));
    if (!c3Available && [...selectedTargetIds].some(targetId =>
        state.attackerTargeting.targets.get(targetId)?.useC3 === true)) {
        return rejected(state, 'C3_UNAVAILABLE');
    }

    const selections = selected.map(([weaponId, component]): MekWeaponFireSelectionV2 => Object.freeze({
        weaponId,
        ...(component.ammo?.preferredSourceId === undefined
            ? {}
            : { ammoSourceId: component.ammo.preferredSourceId }),
        ...(component.ammo === undefined ? {} : { expectedMunitionKey: component.ammo.munitionKey }),
    }));
    const selectedSpotWelders: ComponentId[] = [];
    for (const action of state.attackerTargeting.actions.values()) {
        if (action.target.kind !== 'component') continue;
        const equipment = equipmentForComponent(index, action.target.componentId);
        if (!isSpotWelderEquipment(equipment)) continue;
        if (!canPerformMekAction(
            unit.entity,
            index,
            runtime,
            action.target,
            'physical-attack',
            unit.ruleset,
        )) return rejected(state, 'INVALID_TARGET');
        selectedSpotWelders.push(action.target.componentId);
    }
    if (selections.length === 0 && selectedSpotWelders.length === 0) {
        return rejected(state, 'INVALID_AMOUNT');
    }

    let fired: Extract<CommandReduction, { accepted: true }> | undefined;
    if (selections.length > 0) {
        const result = reduce(
            unit,
            index,
            state,
            {
                type: 'fire-weapons',
                commandId: command.commandId,
                expectedRevision: command.expectedRevision,
                selections,
                heatPolicy: command.heatPolicy,
                ...(command.prototypeHeatRolls === undefined
                    ? {}
                    : { prototypeHeatRolls: command.prototypeHeatRolls }),
            },
            runtime,
            statusTopology,
            heatContext,
            mechanicsContext,
        );
        if (!result.accepted) return result;
        fired = result;
    }

    let nextState = fired?.state ?? state;
    const spotWelderHeat = selectedSpotWelders.reduce((total, componentId) => {
        const equipment = equipmentForComponent(index, componentId);
        return total + (equipment !== undefined && isSpotWelderEquipment(equipment)
            ? physicalEquipmentOperatingHeatFromFlags(equipment.flags)
            : 0);
    }, 0);
    if (spotWelderHeat > 0) {
        const acknowledgedHeatSources = new Map(nextState.turn.acknowledgedHeatSources);
        acknowledgedHeatSources.delete('weapons');
        nextState = {
            ...nextState,
            turn: canonicalizeMekTurnStateV2({
                ...nextState.turn,
                weaponsHeat: nextState.turn.weaponsHeat + spotWelderHeat,
                acknowledgedHeatSources,
            }),
        };
        if (state.heat.pendingOverride !== undefined) {
            const projected = projectPendingHeatAfterWeaponFire(
                unit,
                unit.entity,
                state,
                nextState,
                statusTopology,
                heatContext,
                command.heatPolicy,
            );
            if (projected > MAX_MEK_HEAT_VALUE_V2) return rejected(state, 'EXCEEDS_CAPACITY');
            nextState = {
                ...nextState,
                heat: canonicalizeMekHeatStateV2({
                    current: state.heat.current,
                    previous: state.heat.previous,
                    pendingOverride: projected,
                    heatsinksOff: state.heat.heatsinksOff,
                }),
            };
        }
    }

    if (fired === undefined) {
        const revision = asStateRevision(state.stateRevision + 1);
        return Object.freeze({
            accepted: true,
            idempotent: false,
            previousRevision: state.stateRevision,
            state: freezeRuntimeState({ ...nextState, stateRevision: revision }),
            events: Object.freeze([Object.freeze({
                kind: command.type,
                commandId: command.commandId,
                revision,
            })]),
        });
    }
    return Object.freeze({
        ...fired,
        state: nextState === fired.state ? fired.state : freezeRuntimeState(nextState),
        events: Object.freeze(fired.events.map(event => Object.freeze({
            ...event,
            kind: command.type,
        }))),
    });
}

function buildAttackerTargetingContext(
    unit: MekRuntimeSource,
    index: MekRuntimeIndex,
    state: MekUnitRuntimeState,
    registry: TargetRegistrySnapshot,
    forceReadOnly: boolean,
): AttackerTargetingValidationContext {
    const entity = unit.entity;
    if (entity === undefined) throw new Error('Mek targeting requires the canonical entity');
    const ruleset = unit.ruleset;
    const targets = registry.targets.map(target => Object.freeze({
        id: target.id,
        source: target.source ?? 'manual' as const,
        readOnly: target.readOnly ?? false,
    }));
    const weapons = [...index.components]
        .filter(([, component]) => component.kind === 'equipment'
            && component.mount.equipment instanceof WeaponEquipment)
        .map(([componentId, component]) => {
            const weapon = component.kind === 'equipment' ? component.mount.equipment : undefined;
            if (!(weapon instanceof WeaponEquipment)) throw new Error('Invalid weapon mount');
            const selectedMode = effectiveComponentMode(unit, state, componentId);
            const sources = [...index.components]
                .filter(([sourceId, source]) => source.kind === 'equipment'
                    && (source.mount.equipment instanceof AmmoEquipment
                        || mekIntrinsicMagazine(entity, index, sourceId, ruleset)?.ownerComponentId === componentId))
                .map(([sourceId]) => Object.freeze({
                    componentId: sourceId,
                    munitionKeys: Object.freeze(mekAmmoLoadouts(entity, index, sourceId, ruleset)
                        .filter(loadout => mekWeaponAmmoMatches(
                            weapon,
                            loadout.equipment,
                            selectedMode,
                        ))
                        .map(loadout => loadout.munitionKey)
                        .sort()),
                }))
                .filter(source => source.munitionKeys.length > 0)
                .sort((left, right) => String(left.componentId).localeCompare(String(right.componentId)));
            return Object.freeze({
                componentId,
                compatibleMunitionKeys: Object.freeze([...new Set(
                    sources.flatMap(source => source.munitionKeys),
                )].sort()),
                sources: Object.freeze(sources),
            });
        })
        .sort((left, right) => String(left.componentId).localeCompare(String(right.componentId)));
    const actions = [
        ...index.intrinsicActions.map(action => Object.freeze({
            kind: 'intrinsic' as const,
            actionId: action.id,
        })),
        ...[...index.components]
            .filter(([, component]) => component.kind === 'equipment' && component.mount.isPhysicalWeapon())
            .map(([componentId]) => Object.freeze({ kind: 'component' as const, componentId })),
    ];
    return Object.freeze({
        registryRevision: registry.revision,
        forceReadOnly,
        targets: Object.freeze(targets),
        weapons: Object.freeze(weapons),
        actions: Object.freeze(actions),
    });
}

function reconcileMekWeaponTargetPolicies(
    unit: MekRuntimeSource,
    index: MekRuntimeIndex,
    runtime: MekUnitQueryPort,
    registry: TargetRegistrySnapshot,
    targeting: AttackerTargetingState,
): AttackerTargetingState {
    const components = new Map(targeting.components);
    let changed = false;
    for (const [componentId, component] of components) {
        if (component.selection?.kind !== 'target'
            || mekWeaponTargetSelectionAllowed(unit, index, runtime, registry, targeting, componentId)) {
            continue;
        }
        changed = true;
        if (component.ammo === undefined) components.delete(componentId);
        else components.set(componentId, Object.freeze({ ammo: component.ammo }));
    }
    return changed
        ? freezeAttackerTargetingState({ ...targeting, components: new ImmutableIndex(components) })
        : targeting;
}

function mekWeaponTargetSelectionAllowed(
    unit: MekRuntimeSource,
    index: MekRuntimeIndex,
    runtime: MekUnitQueryPort,
    registry: TargetRegistrySnapshot,
    targeting: AttackerTargetingState,
    componentId: ComponentId,
): boolean {
    const component = targeting.components.get(componentId);
    if (component?.selection?.kind !== 'target') return true;
    const targetId = component.selection.targetId;
    const weapon = equipmentForComponent(index, componentId);
    const target = registry.targets.find(candidate => candidate.id === targetId);
    if (!(weapon instanceof WeaponEquipment) || target === undefined) return false;
    const local = targeting.targets.get(target.id);
    const calculator = Object.freeze({ ...target.tnCalculator, ...local?.calculator });
    return weaponTargetDisabledReason(
        weapon,
        resolveMekTargetingAmmo(unit.entity, index, unit.ruleset, runtime, componentId, component.ammo),
        unit.ruleset,
        {
            ...(target.unitType === undefined ? {} : { unitType: target.unitType }),
            ...(Object.keys(calculator).length === 0 ? {} : { calculator }),
            ...(local?.manualTnOverride === undefined ? {} : { manualTnOverride: true }),
        },
        isMekWeaponUnderwater(unit.entity, index, runtime, componentId),
    ) === null;
}

function requireComponent<T>(unit: MekRuntimeSource, componentId: ComponentId, read: () => T): T {
    if (!unit.index.components.has(componentId)) throw new Error(`Unknown component ${componentId}`);
    return read();
}

function requireCanonicalMek(unit: MekRuntimeSource): MekEntity {
    return unit.entity;
}

function reduce(
    unit: MekRuntimeSource,
    index: MekRuntimeIndex,
    state: MekUnitRuntimeState,
    command: CBTUnitCommand,
    runtime: MekUnitQueryPort,
    statusTopology: RuntimeEquipmentStatusTopology,
    heatContext: MekHeatRuntimeContextV2,
    mechanicsContext: MekMechanicsContextV2,
): CommandReduction {
    const entity = unit.entity;
    const ruleset = unit.ruleset;
    const nextRevision = asStateRevision(state.stateRevision + 1);
    let changed: MekUnitRuntimeState | null = null;
    let prototypeHeat: readonly PrototypeLaserHeatResult[] | undefined;
    switch (command.type) {
        case 'damage-armor': {
            if (!isStateMutationTarget(command.target)) return rejected(state, 'INVALID_TARGET');
            if (!positiveInteger(command.amount)) return rejected(state, 'INVALID_AMOUNT');
            const face = unit.index.armorFaces.get(command.faceId);
            if (!face) return rejected(state, 'INVALID_TARGET');
            const capacity = armorMutationCapacity(
                unit, state, face.locationId, command.faceId, 'damage', command.target,
            );
            if (command.amount > capacity) {
                return rejected(state, 'EXCEEDS_CAPACITY');
            }
            changed = applyArmorMutation(
                unit, state, face.locationId, command.faceId, command.amount, command.target,
            );
            break;
        }
        case 'repair-armor': {
            if (!isStateMutationTarget(command.target)) return rejected(state, 'INVALID_TARGET');
            if (!positiveInteger(command.amount)) return rejected(state, 'INVALID_AMOUNT');
            const face = unit.index.armorFaces.get(command.faceId);
            if (!face) return rejected(state, 'INVALID_TARGET');
            const capacity = armorMutationCapacity(
                unit, state, face.locationId, command.faceId, 'repair', command.target,
            );
            if (command.amount > capacity) {
                return rejected(state, 'EXCEEDS_CAPACITY');
            }
            changed = applyArmorMutation(
                unit, state, face.locationId, command.faceId, -command.amount, command.target,
            );
            break;
        }
        case 'damage-internal': {
            if (!isStateMutationTarget(command.target)) return rejected(state, 'INVALID_TARGET');
            if (!positiveInteger(command.amount)) return rejected(state, 'INVALID_AMOUNT');
            if ((command.hardenedArmorApplies !== undefined
                    && typeof command.hardenedArmorApplies !== 'boolean')
                || (command.armorDamagedBySameHit !== undefined
                    && typeof command.armorDamagedBySameHit !== 'boolean')) {
                return rejected(state, 'INVALID_TARGET');
            }
            const location = unit.index.locations.get(command.locationId);
            if (!location) return rejected(state, 'INVALID_TARGET');
            if (internalDamage(state, command.locationId, 'preview') + command.amount > location.internalPoints
                || (command.target === 'committed'
                    && internalDamage(state, command.locationId, 'committed') + command.amount
                        > location.internalPoints)) {
                return rejected(state, 'EXCEEDS_CAPACITY');
            }
            changed = command.target === 'pending'
                ? withPending(state, 'locationInternalDamage', command.locationId, command.amount)
                : clearNarcFromCommittedPhysicallyDestroyedLocations(
                    unit,
                    withLocationInternalDamage(state, command.locationId, command.amount),
                );
            break;
        }
        case 'repair-internal': {
            if (!isStateMutationTarget(command.target)) return rejected(state, 'INVALID_TARGET');
            if (!positiveInteger(command.amount)) return rejected(state, 'INVALID_AMOUNT');
            const location = unit.index.locations.get(command.locationId);
            if (!location) return rejected(state, 'INVALID_TARGET');
            if (internalDamage(state, command.locationId, 'preview') - command.amount < 0
                || (command.target === 'committed'
                    && internalDamage(state, command.locationId, 'committed') - command.amount < 0)) {
                return rejected(state, 'EXCEEDS_CAPACITY');
            }
            changed = command.target === 'pending'
                ? withPending(state, 'locationInternalDamage', command.locationId, -command.amount)
                : withLocationInternalDamage(state, command.locationId, -command.amount);
            break;
        }
        case 'hit-critical': {
            if (!isStateMutationTarget(command.target)) return rejected(state, 'INVALID_TARGET');
            if (!positiveInteger(command.hits)) return rejected(state, 'INVALID_AMOUNT');
            const slot = unit.index.slots.get(command.slotId);
            if (!slot) return rejected(state, 'INVALID_TARGET');
            const capacity = mekCriticalSlotMaximumHits(unit.index, unit.ruleset, slot);
            if (criticalHits(state, command.slotId, 'preview') + command.hits > capacity
                || (command.target === 'committed'
                    && criticalHits(state, command.slotId, 'committed') + command.hits > capacity)) {
                return rejected(state, 'EXCEEDS_CAPACITY');
            }
            if (command.target === 'pending') {
                changed = withPending(state, 'criticalHits', command.slotId, command.hits);
            } else {
                const hit = withCriticalHits(state, slot, command.hits);
                const becameDirectHit = criticalHits(hit, command.slotId, 'committed')
                    >= mekCriticalSlotDirectHitThreshold(slot);
                changed = becameDirectHit
                    ? explodeCommittedPpcCapacitorPairs(
                        unit,
                        entity,
                        index,
                        state,
                        hit,
                        new Set(slot.componentIds),
                    )
                    : hit;
            }
            break;
        }
        case 'repair-critical': {
            if (!isStateMutationTarget(command.target)) return rejected(state, 'INVALID_TARGET');
            if (!positiveInteger(command.hits)) return rejected(state, 'INVALID_AMOUNT');
            const slot = unit.index.slots.get(command.slotId);
            if (!slot) return rejected(state, 'INVALID_TARGET');
            if (criticalHits(state, command.slotId, 'preview') - command.hits < 0
                || (command.target === 'committed'
                    && criticalHits(state, command.slotId, 'committed') - command.hits < 0)) {
                return rejected(state, 'EXCEEDS_CAPACITY');
            }
            changed = command.target === 'pending'
                ? withPending(state, 'criticalHits', command.slotId, -command.hits)
                : withCriticalHits(state, slot, -command.hits);
            break;
        }
        case 'apply-mek-blow-off': {
            if (!isStateMutationTarget(command.target) || !unit.index.locations.has(command.locationId)) {
                return rejected(state, 'INVALID_TARGET');
            }
            const plan = projectMekBlowOffV2(
                unit.index,
                criticalRuntimeView(unit, state, statusTopology),
                command.locationId,
                command.target,
            );
            changed = applyMekBlowOffPlan(unit, state, plan, command.target);
            break;
        }
        case 'apply-mek-critical-roll': {
            if (!isStateMutationTarget(command.target) || !unit.index.locations.has(command.locationId)) {
                return rejected(state, 'INVALID_TARGET');
            }
            const plan = projectMekCriticalRollV2(
                entity,
                unit.index,
                unit.ruleset,
                criticalRuntimeView(unit, state, statusTopology),
                command.locationId,
                command.results,
                command.target,
            );
            if (plan.kind === 'invalid') return rejected(state, 'INVALID_DICE_EVIDENCE');
            if (plan.kind === 'not-applied') return rejected(state, 'NO_CHANGE');
            if ((command.applyExplosion !== undefined && typeof command.applyExplosion !== 'boolean')
                || (command.applyPilotHits !== undefined && typeof command.applyPilotHits !== 'boolean')
                || (command.settlePendingExplosion !== undefined
                    && typeof command.settlePendingExplosion !== 'boolean')) {
                return rejected(state, 'INVALID_TARGET');
            }
            changed = applyMekCriticalRollPlan(
                unit,
                state,
                plan,
                command.target,
                command.applyExplosion ?? true,
                command.applyPilotHits ?? true,
                command.settlePendingExplosion ?? false,
                statusTopology,
            );
            break;
        }
        case 'set-system-critical-level': {
            if (!isStateMutationTarget(command.target)
                || !Number.isSafeInteger(command.level)
                || command.level < 0) {
                return rejected(state, 'INVALID_AMOUNT');
            }
            const slots = [...unit.index.slots.values()]
                .filter(slot => slot.componentIds.some(componentId => {
                    const component = unit.index.components.get(componentId);
                    return component?.kind === 'system'
                        && component.systemType === command.system;
                }))
                .sort((left, right) => compareText(left.locationId, right.locationId)
                    || left.slotIndex - right.slotIndex
                    || compareText(left.id, right.id));
            if (slots.length === 0 || command.level > slots.length) {
                return rejected(state, 'INVALID_TARGET');
            }
            let next = state;
            for (let index = 0; index < slots.length; index++) {
                const slot = slots[index];
                const desired = index < command.level ? mekCriticalSlotDirectHitThreshold(slot) : 0;
                const current = criticalHits(next, slot.id, command.target === 'pending' ? 'preview' : 'committed');
                const delta = desired - current;
                if (delta === 0) continue;
                next = command.target === 'pending'
                    ? withPending(next, 'criticalHits', slot.id, delta)
                    : withCriticalHits(next, slot, delta);
            }
            changed = next === state ? null : next;
            break;
        }
        case 'set-component-status': {
            if (!isStateMutationTarget(command.target)) return rejected(state, 'INVALID_TARGET');
            const component = unit.index.components.get(command.componentId);
            if (!component || component.kind !== 'equipment'
                || !isEquipmentStatus(command.status)) {
                return rejected(state, 'INVALID_TARGET');
            }
            if (command.target === 'pending') {
                changed = withPendingComponentStatus(state, command.componentId, command.status);
            } else {
                const statusChanged = withComponentStatus(state, command.componentId, command.status);
                changed = statusChanged && command.status === 'destroyed'
                    ? explodeCommittedPpcCapacitorPairs(
                        unit,
                        entity,
                        index,
                        state,
                        statusChanged,
                        new Set([command.componentId]),
                    )
                    : statusChanged;
            }
            break;
        }
        case 'damage-shield':
        case 'repair-shield': {
            if (!isStateMutationTarget(command.target)
                || !isMekShieldTrack(command.track)
                || !positiveInteger(command.amount)) {
                return rejected(state, 'INVALID_AMOUNT');
            }
            const profile = shieldProfile(unit, command.componentId);
            if (!profile) return rejected(state, 'INVALID_TARGET');
            const perspective = command.target === 'pending' ? 'preview' : 'committed';
            const current = shieldDamage(state, command.componentId, command.track, perspective);
            const maximum = command.track === 'absorption'
                ? profile.damageAbsorption
                : profile.damageCapacity;
            const delta = command.type === 'damage-shield' ? command.amount : -command.amount;
            if (current + delta < 0 || current + delta > maximum) {
                return rejected(state, 'EXCEEDS_CAPACITY');
            }
            changed = withShieldDamage(
                state,
                command.componentId,
                command.track,
                delta,
                command.target,
            );
            break;
        }
        case 'detonate-booby-trap': {
            const equipment = equipmentForComponent(index, command.componentId);
            if (!isBoobyTrapEquipment(equipment)
                || runtime.componentStatus(command.componentId, 'committed') !== 'available'
                || isBoobyTrapDetonated(state.components.get(command.componentId)?.mode)) {
                return rejected(state, 'INVALID_TARGET');
            }
            const detonated = withComponentMode(
                state,
                command.componentId,
                BOOBY_TRAP_DETONATED_MODE,
                BOOBY_TRAP_ARMED_MODE,
            );
            if (!detonated) return rejected(state, 'NO_CHANGE');
            changed = { ...detonated, destroyed: true };
            break;
        }
        case 'set-component-mode': {
            const equipment = equipmentForComponent(index, command.componentId);
            if (isBoobyTrapEquipment(equipment)) return rejected(state, 'INVALID_TARGET');
            if (isMobileHpgEquipment(equipment)) {
                const hpg = reduceMobileHpgMode(
                    unit,
                    state,
                    statusTopology,
                    command.componentId,
                    command.mode,
                );
                if (hpg === 'invalid') return rejected(state, 'INVALID_TARGET');
                changed = hpg;
                break;
            }
            if (equipment) {
                const electronic = reduceElectronicComponentMode(
                    unit,
                    state,
                    statusTopology,
                    command.componentId,
                    command.mode,
                );
                if (electronic.kind === 'invalid') return rejected(state, 'INVALID_TARGET');
                if (electronic.kind === 'handled') {
                    changed = electronic.state;
                    break;
                }
            }
            if (isCoolantPodEquipment(equipment)) return rejected(state, 'INVALID_TARGET');
            if (equipment && isStealthSystemEquipment(equipment)
                && isSwitchableStealthEquipment(equipment)) {
                return rejected(state, 'INVALID_TARGET');
            }
            const modes = mekComponentModes(entity, index, command.componentId, ruleset);
            if (!index.components.has(command.componentId) || !modes.modes.includes(command.mode)) {
                return rejected(state, 'INVALID_TARGET');
            }
            if (isMachineGunArrayEquipment(equipment)) {
                if (!isMachineGunArrayController(index, command.componentId)
                    || !isMachineGunArrayLifecycleState(command.mode)) {
                    return rejected(state, 'INVALID_TARGET');
                }
                const current = machineGunArrayLifecycleState(
                    state.components.get(command.componentId)?.mode,
                );
                if (command.mode !== nextMachineGunArrayState(current)) {
                    return rejected(state, 'INVALID_TARGET');
                }
            }
            changed = withComponentMode(
                state,
                command.componentId,
                command.mode,
                modes.defaultMode,
            );
            if (changed && ruleset === 'core-2026'
                && isShieldEquipment(equipment)
                && command.mode === SHIELD_ACTIVE_MODE) {
                for (const [otherId, other] of index.components) {
                    if (otherId === command.componentId
                        || other.kind !== 'equipment'
                        || !isShieldEquipment(other.mount.equipment)
                        || effectiveComponentMode(unit, changed, otherId) !== SHIELD_ACTIVE_MODE) continue;
                    changed = withComponentMode(
                        changed,
                        otherId,
                        SHIELD_INACTIVE_MODE,
                        SHIELD_INACTIVE_MODE,
                    ) ?? changed;
                }
            }
            if (changed && isMachineGunArrayEquipment(equipment)
                && isMachineGunArrayLifecycleState(command.mode)
                && isMachineGunArrayTransition(command.mode)) {
                changed = {
                    ...changed,
                    turn: canonicalizeMekTurnStateV2({
                        ...changed.turn,
                        equipmentStateChanged: true,
                    }),
                };
            }
            break;
        }
        case 'set-stealth-state': {
            const equipment = equipmentForComponent(index, command.componentId);
            if (!equipment
                || !isStealthSystemEquipment(equipment)
                || !isSwitchableStealthEquipment(equipment)) {
                return rejected(state, 'INVALID_TARGET');
            }
            const current = componentStealthState(unit, state, command.componentId);
            if (nextStealthState(current) !== command.state) {
                return rejected(state, 'INVALID_TARGET');
            }
            if ((command.state === 'enabling' || command.state === 'enabled')
                && (componentRuntimeStatus(unit, state, command.componentId, 'preview') !== 'available'
                    || ((isStealthEquipment(equipment)
                        || isVoidSignatureEquipment(equipment))
                        && !hasFunctionalEcmForStealth(buildMekStealthFacts(
                            unit,
                            state,
                            statusTopology,
                            'preview',
                        ))))) {
                return rejected(state, 'INVALID_TARGET');
            }
            changed = withStealthState(
                unit,
                state,
                command.componentId,
                command.state,
                true,
            );
            break;
        }
        case 'toggle-gauss-power': {
            const equipment = equipmentForComponent(index, command.componentId);
            if (!isGaussEquipment(equipment)) {
                return rejected(state, 'INVALID_TARGET');
            }
            changed = withGaussPowerState(
                state,
                command.componentId,
                nextGaussPowerState(gaussPowerState(unit, state, command.componentId)),
                true,
            );
            break;
        }
        case 'set-component-jammed': {
            if (!rapidFireAutocannonSupportsJamming(index, command.componentId, ruleset)
                || typeof command.jammed !== 'boolean') {
                return rejected(state, 'INVALID_TARGET');
            }
            changed = withComponentJammed(state, command.componentId, command.jammed);
            break;
        }
        case 'edit-escalating-failure': {
            const definition = escalatingFailureDefinition(unit, command.componentId);
            if (!definition) return rejected(state, 'INVALID_TARGET');
            if (command.edit.kind === 'select-sequence') {
                if (!Number.isSafeInteger(command.edit.index)
                    || command.edit.index < 0
                    || command.edit.index >= definition.targets.length
                    || componentRuntimeStatus(unit, state, command.componentId) !== 'available'
                    || !canUseEscalatingFailure(definition, state.turn.airborne)) {
                    return rejected(state, 'INVALID_TARGET');
                }
                changed = withEscalatingFailureSelection(
                    state,
                    command.componentId,
                    command.edit.index,
                    definition.targets.length,
                );
            } else {
                const current = componentRuntimeStatus(unit, state, command.componentId);
                if ((command.edit.status === 'disabled' && current !== 'available')
                    || (command.edit.status === 'available'
                        && state.components.get(command.componentId)?.statusOverride !== 'disabled')) {
                    return rejected(state, 'INVALID_TARGET');
                }
                changed = withEscalatingFailureStatus(
                    state,
                    command.componentId,
                    command.edit.status,
                );
            }
            break;
        }
        case 'set-ppc-capacitor-charge': {
            if (!isPpcCapacitorPair(entity, index, command.capacitorId, command.weaponId)) {
                return rejected(state, 'INVALID_TARGET');
            }
            const pair = Object.freeze({
                capacitorId: command.capacitorId,
                weaponId: command.weaponId,
            });
            const lifecycle = state.components.get(pair.capacitorId)?.ppcCapacitor;
            if (command.state !== null && command.state !== PPC_CAPACITOR_CHARGING_STATE) {
                return rejected(state, 'INVALID_TARGET');
            }
            if (command.state === PPC_CAPACITOR_CHARGING_STATE
                && (componentRuntimeStatus(unit, state, pair.capacitorId, 'preview') !== 'available'
                    || componentRuntimeStatus(unit, state, pair.weaponId, 'preview') !== 'available'
                    || lifecycle?.firedThisTurn
                    || lifecycle?.chargeState === PPC_CAPACITOR_CHARGED_STATE)) {
                return rejected(state, 'INVALID_TARGET');
            }
            changed = withPpcCapacitorState(
                state,
                pair,
                command.state ?? undefined,
                lifecycle?.firedThisTurn,
                command.state === PPC_CAPACITOR_CHARGING_STATE,
            );
            break;
        }
        case 'set-bombast-laser-charge': {
            if (!isCoreBombastLaserComponent(index, command.componentId, ruleset)) {
                return rejected(state, 'INVALID_TARGET');
            }
            const lifecycle = state.components.get(command.componentId)?.bombastLaser;
            if (command.state !== null && command.state !== BOMBAST_LASER_CHARGING_STATE) {
                return rejected(state, 'INVALID_TARGET');
            }
            if (command.state === BOMBAST_LASER_CHARGING_STATE
                && (componentRuntimeStatus(unit, state, command.componentId, 'preview') !== 'available'
                    || lifecycle?.firedThisTurn === true
                    || lifecycle?.chargeState === BOMBAST_LASER_CHARGED_STATE)) {
                return rejected(state, 'INVALID_TARGET');
            }
            changed = withBombastLaserState(
                state,
                command.componentId,
                command.state ?? undefined,
                lifecycle?.firedThisTurn,
                command.state === BOMBAST_LASER_CHARGING_STATE,
            );
            break;
        }
        case 'edit-c3-emergency-master': {
            if (!isC3EmergencyMasterComponent(index, command.componentId)
                || componentRuntimeStatus(unit, state, command.componentId, 'preview') !== 'available') {
                return rejected(state, 'INVALID_TARGET');
            }
            const lifecycle = state.components.get(command.componentId)?.c3EmergencyMaster;
            const operatingTurns = lifecycle?.operatingTurns ?? 0;
            if (command.edit.kind === 'toggle-requested') {
                if (typeof command.edit.turningOn !== 'boolean'
                    || operatingTurns === C3EM_FRIED_SEQUENCE_VALUE) {
                    return rejected(state, 'INVALID_TARGET');
                }
                changed = withC3EmergencyMasterState(state, command.componentId, {
                    mode: command.edit.turningOn ? 'on' : 'off',
                    ...(command.edit.turningOn && operatingTurns === 0
                        ? { operatingTurns: 1 as const }
                        : lifecycle?.operatingTurns === undefined
                            ? {}
                            : { operatingTurns: lifecycle.operatingTurns }),
                });
            } else if (command.edit.kind === 'select-operating-turns') {
                if (!isC3EmergencyMasterOperatingTurns(command.edit.turns)) {
                    return rejected(state, 'INVALID_TARGET');
                }
                changed = withC3EmergencyMasterState(state, command.componentId, {
                    ...(command.edit.turns === C3EM_FRIED_SEQUENCE_VALUE
                        ? { mode: 'off' as const }
                        : lifecycle?.mode === undefined ? {} : { mode: lifecycle.mode }),
                    operatingTurns: command.edit.turns,
                });
            } else if (command.edit.kind === 'ensure-active-started') {
                if (command.edit.endpointRole !== 'master'
                    || operatingTurns === C3EM_FRIED_SEQUENCE_VALUE) {
                    return rejected(state, 'INVALID_TARGET');
                }
                changed = operatingTurns === 0
                    ? withC3EmergencyMasterState(state, command.componentId, {
                        ...(lifecycle?.mode === undefined ? {} : { mode: lifecycle.mode }),
                        operatingTurns: 1,
                    })
                    : null;
            } else {
                if (command.edit.endpointRole !== 'master'
                    || operatingTurns === C3EM_FRIED_SEQUENCE_VALUE) {
                    return rejected(state, 'INVALID_TARGET');
                }
                const nextTurns = Math.min(
                    C3EM_FRIED_SEQUENCE_VALUE,
                    operatingTurns + 1,
                ) as C3EmergencyMasterOperatingTurns;
                changed = withC3EmergencyMasterState(state, command.componentId, {
                    ...(nextTurns === C3EM_FRIED_SEQUENCE_VALUE
                        ? { mode: 'off' as const }
                        : lifecycle?.mode === undefined ? {} : { mode: lifecycle.mode }),
                    operatingTurns: nextTurns,
                });
            }
            break;
        }
        case 'configure-ammo-source': {
            if (!boundedRuntimeText(command.munitionKey)) return rejected(state, 'INVALID_TARGET');
            if (!nonnegativeInteger(command.remaining)) return rejected(state, 'INVALID_AMOUNT');
            const loadout = mekAmmoLoadout(
                unit.entity,
                unit.index,
                command.componentId,
                unit.ruleset,
                command.munitionKey,
            );
            if (!loadout) return rejected(state, 'INVALID_TARGET');
            if (command.remaining > loadout.capacity) return rejected(state, 'EXCEEDS_CAPACITY');
            changed = withAmmoConfiguration(
                state,
                unit,
                command.componentId,
                loadout.munitionKey,
                loadout.capacity - command.remaining,
            );
            break;
        }
        case 'spend-ammo': {
            if (!positiveInteger(command.amount)) return rejected(state, 'INVALID_AMOUNT');
            const current = state.ammo.get(command.componentId);
            const capacity = mekAmmoCapacity(
                unit.entity,
                unit.index,
                command.componentId,
                unit.ruleset,
                current?.munitionOverride,
            );
            if (capacity === null) return rejected(state, 'INVALID_TARGET');
            const spent = current?.shotsSpent ?? 0;
            if (spent + command.amount > capacity) return rejected(state, 'EXCEEDS_CAPACITY');
            changed = withAmmoSpent(state, command.componentId, command.amount);
            break;
        }
        case 'activate-coolant-pod': {
            const equipment = equipmentForComponent(index, command.componentId);
            if (!isCoolantPodEquipment(equipment)
                || componentRuntimeStatus(unit, state, command.componentId, 'committed') !== 'available'
                || effectiveComponentMode(unit, state, command.componentId) !== COOLANT_POD_READY_MODE
                || [...index.components].some(([componentId, component]) =>
                    component.kind === 'equipment'
                    && isCoolantPodEquipment(component.mount.equipment)
                    && effectiveComponentMode(unit, state, componentId) === COOLANT_POD_ACTIVE_MODE)) {
                return rejected(state, 'INVALID_TARGET');
            }
            const ammo = state.ammo.get(command.componentId);
            const capacity = mekAmmoCapacity(
                entity,
                index,
                command.componentId,
                ruleset,
                ammo?.munitionOverride,
            );
            if (capacity === null || (ammo?.shotsSpent ?? 0) >= capacity) {
                return rejected(state, 'EXCEEDS_CAPACITY');
            }
            const spent = withAmmoSpent(state, command.componentId, 1);
            const activated = withComponentMode(
                spent,
                command.componentId,
                COOLANT_POD_ACTIVE_MODE,
                COOLANT_POD_READY_MODE,
            );
            if (activated === null) return rejected(state, 'INVALID_TARGET');
            changed = {
                ...activated,
                turn: canonicalizeMekTurnStateV2({
                    ...activated.turn,
                    equipmentStateChanged: true,
                }),
            };
            break;
        }
        case 'fire-weapons': {
            if (mekHeatCapabilityV2(heatContext, entity).kind === 'unsupported') {
                return rejected(state, 'UNSUPPORTED_HEAT_CONTEXT');
            }
            if (!isHeatPolicy(command.heatPolicy)) return rejected(state, 'INVALID_TARGET');
            const planned = planMekWeaponFireV2(
                entity,
                index,
                unit.ruleset,
                runtime,
                command.selections,
                command.prototypeHeatRolls,
            );
            if (!planned.accepted) {
                return rejected(
                    state,
                    planned.code === 'EMPTY_SELECTION' || planned.code === 'TOO_MANY_SELECTIONS'
                        ? 'INVALID_AMOUNT'
                        : planned.code === 'INSUFFICIENT_AMMO' || planned.code === 'HEAT_LIMIT_EXCEEDED'
                            ? 'EXCEEDS_CAPACITY'
                            : 'INVALID_TARGET',
                );
            }
            changed = applyMekWeaponFirePlanV2(state, planned.plan);
            prototypeHeat = planned.plan.prototypeHeat;
            if (state.heat.pendingOverride !== undefined) {
                const projected = projectPendingHeatAfterWeaponFire(
                    unit,
                    entity,
                    state,
                    changed,
                    statusTopology,
                    heatContext,
                    command.heatPolicy,
                );
                if (projected > MAX_MEK_HEAT_VALUE_V2) return rejected(state, 'EXCEEDS_CAPACITY');
                changed = {
                    ...changed,
                    heat: canonicalizeMekHeatStateV2({
                        current: state.heat.current,
                        previous: state.heat.previous,
                        pendingOverride: projected,
                        heatsinksOff: state.heat.heatsinksOff,
                    }),
                };
            }
            break;
        }
        case 'set-heat': {
            if (mekHeatCapabilityV2(heatContext, entity).kind === 'unsupported') {
                return rejected(state, 'UNSUPPORTED_HEAT_CONTEXT');
            }
            if (!canonicalNonnegativeNumber(command.heat)) return rejected(state, 'INVALID_AMOUNT');
            const heat = canonicalizeMekHeatStateV2({
                current: command.heat,
                previous: state.heat.current,
                heatsinksOff: state.heat.heatsinksOff,
            });
            changed = mekHeatStatesEqualV2(state.heat, heat) ? null : { ...state, heat };
            break;
        }
        case 'set-pending-heat': {
            if (mekHeatCapabilityV2(heatContext, entity).kind === 'unsupported') {
                return rejected(state, 'UNSUPPORTED_HEAT_CONTEXT');
            }
            if (command.heat !== null && !canonicalNonnegativeNumber(command.heat)) {
                return rejected(state, 'INVALID_AMOUNT');
            }
            const pendingOverride = command.heat === null ? undefined : command.heat;
            changed = state.heat.pendingOverride === pendingOverride
                ? null
                : {
                    ...state,
                    heat: canonicalizeMekHeatStateV2({
                        current: state.heat.current,
                        previous: state.heat.previous,
                        ...(pendingOverride === undefined ? {} : { pendingOverride }),
                        heatsinksOff: state.heat.heatsinksOff,
                    }),
                };
            break;
        }
        case 'set-heatsinks-off': {
            const capability = mekHeatCapabilityV2(heatContext, entity);
            if (capability.kind === 'unsupported') return rejected(state, 'UNSUPPORTED_HEAT_CONTEXT');
            if (!Number.isSafeInteger(command.heatsinksOff)
                || command.heatsinksOff < 0
                || command.heatsinksOff > MAX_MEK_HEATSINKS_OFF_V2) {
                return rejected(state, 'INVALID_AMOUNT');
            }
            if (command.heatsinksOff > capability.maxHeatsinksOff) {
                return rejected(state, 'EXCEEDS_CAPACITY');
            }
            changed = state.heat.heatsinksOff === command.heatsinksOff
                ? null
                : {
                    ...state,
                    heat: canonicalizeMekHeatStateV2({
                        ...state.heat,
                        heatsinksOff: command.heatsinksOff,
                    }),
                };
            break;
        }
        case 'apply-heat': {
            if (mekHeatCapabilityV2(heatContext, entity).kind === 'unsupported') {
                return rejected(state, 'UNSUPPORTED_HEAT_CONTEXT');
            }
            if (!isHeatPolicy(command.policy)) return rejected(state, 'INVALID_TARGET');
            const input = buildHeatKernelInput(unit, state, statusTopology);
            const projection = projectMekHeatContextV2(
                heatContext, entity, input, command.policy,
            );
            if (projection.kind === 'unsupported') return rejected(state, 'UNSUPPORTED_HEAT_CONTEXT');
            if (command.policy === 'automatic'
                && projection.projection.projected > MAX_MEK_HEAT_VALUE_V2) {
                return rejected(state, 'EXCEEDS_CAPACITY');
            }
            const applied = applyPendingMekHeatContextV2(
                heatContext, entity, input, command.policy,
            );
            if (applied.kind === 'unsupported') return rejected(state, 'UNSUPPORTED_HEAT_CONTEXT');
            changed = applied.application.changed
                ? {
                    ...state,
                    heat: applied.application.heat,
                    turn: applied.application.turn,
                }
                : null;
            break;
        }
        case 'set-condition': {
            if (!boundedRuntimeText(command.condition) || typeof command.active !== 'boolean') {
                return rejected(state, 'INVALID_TARGET');
            }
            // Shutdown is owned by typed shutdown/startup actions. Generic
            // condition mutation may never bypass that transition.
            if (command.condition === 'shutdown' && !command.active) {
                return rejected(state, 'INVALID_TARGET');
            }
            const conditions = new Set(state.conditions);
            const existed = conditions.has(command.condition);
            if (command.active === existed) changed = null;
            else {
                if (command.active) conditions.add(command.condition);
                else conditions.delete(command.condition);
                changed = { ...state, conditions: new ImmutableSet(conditions) };
            }
            break;
        }
        case 'set-mek-shutdown-state': {
            if (typeof command.shutdown !== 'boolean') return rejected(state, 'INVALID_TARGET');
            const conditions = new Set(state.conditions);
            const existed = conditions.has('shutdown');
            if (command.shutdown === existed) changed = null;
            else {
                if (command.shutdown) conditions.add('shutdown');
                else conditions.delete('shutdown');
                changed = { ...state, conditions: new ImmutableSet(conditions) };
            }
            break;
        }
        case 'resolve-mek-rule-check': {
            const resolved = resolveMekRuleCheckContextV2(
                mechanicsContext,
                entity,
                mekDamageStateView(unit, state),
                state.ruleChecks,
                command.key,
                command.token,
                command.outcome,
            );
            if (resolved.kind === 'unsupported') {
                return rejected(state, 'UNSUPPORTED_MECHANICS_CONTEXT');
            }
            if (!resolved.resolution.accepted) return rejected(state, resolved.resolution.reason);
            changed = { ...state, ruleChecks: resolved.resolution.ruleChecks };
            break;
        }
        case 'set-location-condition': {
            if (!isStateMutationTarget(command.target)) return rejected(state, 'INVALID_TARGET');
            if (!unit.index.locations.has(command.locationId)
                || !isMekLocationConditionKey(command.condition)) {
                return rejected(state, 'INVALID_TARGET');
            }
            if (!isMekLocationConditionValue(command.condition, command.value, true)) {
                return rejected(state, 'INVALID_AMOUNT');
            }
            changed = command.target === 'pending'
                ? withPendingLocationCondition(
                    state,
                    command.locationId,
                    command.condition,
                    command.value,
                )
                : withLocationCondition(
                    state,
                    command.locationId,
                    command.condition,
                    command.value,
                );
            if (changed && command.target === 'committed') {
                changed = clearNarcFromCommittedPhysicallyDestroyedLocations(unit, changed);
            }
            break;
        }
        case 'set-crew-state': {
            if (!unit.index.crewPositions.has(command.positionId)) {
                return rejected(state, 'INVALID_TARGET');
            }
            if (!Number.isSafeInteger(command.wounds)
                || command.wounds < 0
                || command.wounds > MAX_MEK_CREW_WOUNDS
                || typeof command.unconscious !== 'boolean'
                || typeof command.ejected !== 'boolean'
                || (command.unconscious && command.ejected)) {
                return rejected(state, 'INVALID_AMOUNT');
            }
            changed = withCrewState(
                state,
                command.positionId,
                command.wounds,
                command.unconscious,
                command.ejected,
            );
            break;
        }
        case 'declare-mek-movement': {
            if (command.declaration.mode !== 'stationary'
                && mobileHpgBlocksMovement(
                    buildMekMobileHpgFacts(unit, state, statusTopology, 'committed'),
                )) return rejected(state, 'ILLEGAL_MOVEMENT_PSR_DECLARATION');
            const input = createMovementRuntimeInput(
                unit, state, statusTopology, runtime.crewAssignment(), mechanicsContext,
            );
            if (!input) return rejected(state, 'UNSUPPORTED_MOVEMENT_PSR_CONTEXT');
            const transition = declareMekMovementContextV2(
                mechanicsContext,
                entity,
                input,
                state.movementPsr,
                command.declaration,
                nextRevision,
            );
            if (!transition.accepted) {
                return rejected(state, transition.reason === 'UNSUPPORTED'
                    ? 'UNSUPPORTED_MOVEMENT_PSR_CONTEXT'
                    : transition.reason === 'INVALID_DECLARATION'
                        ? 'INVALID_MOVEMENT_PSR_DECLARATION'
                        : 'ILLEGAL_MOVEMENT_PSR_DECLARATION');
            }
            changed = mekMovementPsrStatesEqualV2(state.movementPsr, transition.state)
                ? null
                : command.declaration.mode === 'sprint'
                    ? {
                        ...state,
                        movementPsr: transition.state,
                        turn: { ...state.turn, spotting: false },
                        attackerTargeting: createPristineAttackerTargetingState(),
                    }
                    : { ...state, movementPsr: transition.state };
            break;
        }
        case 'clear-mek-movement': {
            const movementPsr = clearMekMovementV2(state.movementPsr);
            changed = mekMovementPsrStatesEqualV2(state.movementPsr, movementPsr)
                ? null
                : { ...state, movementPsr };
            break;
        }
        case 'declare-mek-action': {
            const input = createMovementRuntimeInput(
                unit, state, statusTopology, runtime.crewAssignment(), mechanicsContext,
            );
            if (!input) return rejected(state, 'UNSUPPORTED_MOVEMENT_PSR_CONTEXT');
            const transition = declareMekActionContextV2(
                mechanicsContext,
                entity,
                input,
                state.movementPsr,
                command.action,
                nextRevision,
            );
            if (!transition.accepted) {
                return rejected(state, transition.reason === 'UNSUPPORTED'
                    ? 'UNSUPPORTED_MOVEMENT_PSR_CONTEXT'
                    : transition.reason === 'INVALID_DECLARATION'
                        ? 'INVALID_MOVEMENT_PSR_DECLARATION'
                        : 'ILLEGAL_MOVEMENT_PSR_DECLARATION');
            }
            const conditions = new Set(state.conditions);
            if (command.action.kind === 'shutdown') conditions.add('shutdown');
            if (command.action.kind === 'startup') conditions.delete('shutdown');
            changed = {
                ...state,
                movementPsr: transition.state,
                conditions: new ImmutableSet(conditions),
            };
            break;
        }
        case 'clear-mek-action': {
            if (state.movementPsr.action !== null && state.movementPsr.checks.some(check =>
                check.status === 'pending'
                && check.source.sourceKind === 'action'
                && check.source.triggerKind === state.movementPsr.action!.kind)) {
                return rejected(state, 'PENDING_PILOT_CHECKS');
            }
            const movementPsr = clearMekActionV2(state.movementPsr);
            changed = mekMovementPsrStatesEqualV2(state.movementPsr, movementPsr)
                ? null
                : { ...state, movementPsr };
            break;
        }
        case 'prepare-mek-stand': {
            const input = createMovementRuntimeInput(
                unit, state, statusTopology, runtime.crewAssignment(), mechanicsContext,
            );
            if (!input) return rejected(state, 'UNSUPPORTED_MOVEMENT_PSR_CONTEXT');
            const transition = prepareMekStandUpContextV2(
                mechanicsContext,
                entity,
                input,
                state.movementPsr,
            );
            if (!transition.accepted) {
                return rejected(state, transition.reason === 'UNSUPPORTED'
                    ? 'UNSUPPORTED_MOVEMENT_PSR_CONTEXT'
                    : transition.reason === 'INVALID_DECLARATION'
                        ? 'INVALID_MOVEMENT_PSR_DECLARATION'
                        : 'ILLEGAL_MOVEMENT_PSR_DECLARATION');
            }
            changed = mekMovementPsrStatesEqualV2(state.movementPsr, transition.state)
                ? null
                : { ...state, movementPsr: transition.state };
            break;
        }
        case 'resolve-mek-stand-attempt': {
            const input = createMovementRuntimeInput(
                unit, state, statusTopology, runtime.crewAssignment(), mechanicsContext,
            );
            if (!input) return rejected(state, 'UNSUPPORTED_MOVEMENT_PSR_CONTEXT');
            const transition = resolveMekStandAttemptContextV2(
                mechanicsContext,
                entity,
                input,
                state.movementPsr,
                command.carefulStand,
                command.evidence,
                nextRevision,
            );
            if (!transition.accepted) {
                return rejected(state, transition.reason === 'UNSUPPORTED'
                    ? 'UNSUPPORTED_MOVEMENT_PSR_CONTEXT'
                    : transition.reason === 'INVALID_DECLARATION'
                        ? 'INVALID_MOVEMENT_PSR_DECLARATION'
                        : transition.reason === 'ILLEGAL_DECLARATION'
                            ? 'ILLEGAL_MOVEMENT_PSR_DECLARATION'
                            : transition.reason);
            }
            const conditions = new Set(state.conditions);
            if (transition.failed) conditions.add('prone');
            else conditions.delete('prone');
            changed = {
                ...state,
                movementPsr: transition.state,
                conditions: new ImmutableSet(conditions),
            };
            break;
        }
        case 'adjust-mek-stand-attempts': {
            if (!Number.isSafeInteger(command.delta)) return rejected(state, 'INVALID_AMOUNT');
            const input = createMovementRuntimeInput(
                unit, state, statusTopology, runtime.crewAssignment(), mechanicsContext,
            );
            if (!input) return rejected(state, 'UNSUPPORTED_MOVEMENT_PSR_CONTEXT');
            let movementPsr: MekMovementPsrStateV2;
            try {
                const adjusted = adjustMekStandAttemptsContextV2(
                    mechanicsContext,
                    entity,
                    input,
                    state.movementPsr,
                    command.delta,
                );
                if ('kind' in adjusted) return rejected(state, 'UNSUPPORTED_MOVEMENT_PSR_CONTEXT');
                movementPsr = adjusted;
            } catch {
                return rejected(state, 'INVALID_AMOUNT');
            }
            changed = mekMovementPsrStatesEqualV2(state.movementPsr, movementPsr)
                ? null
                : { ...state, movementPsr };
            break;
        }
        case 'resolve-mek-pilot-check': {
            const projectedResolution = resolveMekPilotCheckContextV2(
                mechanicsContext,
                entity,
                state.movementPsr,
                command.checkId,
                command.evidence,
            );
            if (projectedResolution.kind === 'unsupported') {
                return rejected(state, 'UNSUPPORTED_MOVEMENT_PSR_CONTEXT');
            }
            const resolution = projectedResolution.resolution;
            if (!resolution.accepted) return rejected(
                state,
                resolution.reason === 'INVALID_CHECK' ? 'INVALID_PILOT_CHECK' : resolution.reason,
            );
            const conditions = new Set(state.conditions);
            const check = resolution.state.checks.find(candidate => candidate.checkId === command.checkId)!;
            if (resolution.failed) conditions.add('prone');
            else if (check.source.triggerKind === 'get-up') conditions.delete('prone');
            changed = {
                ...state,
                movementPsr: resolution.state,
                conditions: new ImmutableSet(conditions),
            };
            break;
        }
        case 'dismiss-mek-pilot-checks': {
            try {
                const movementPsr = dismissPendingMekPilotChecksV2(
                    state.movementPsr,
                    command.checkIds,
                );
                changed = mekMovementPsrStatesEqualV2(state.movementPsr, movementPsr)
                    ? null
                    : { ...state, movementPsr };
            } catch {
                return rejected(state, 'INVALID_PILOT_CHECK');
            }
            break;
        }
        case 'dismiss-mek-automatic-falls': {
            const movementPsr = dismissMekAutomaticFallsV2(state.movementPsr);
            changed = mekMovementPsrStatesEqualV2(state.movementPsr, movementPsr)
                ? null
                : { ...state, movementPsr };
            break;
        }
        case 'replace-turn-state': {
            let turn: MekTurnStateV2;
            try {
                turn = canonicalizeMekTurnStateV2(command.turn);
            } catch {
                return rejected(state, 'INVALID_TURN_STATE');
            }
            if (state.movementPsr.movement?.mode === 'sprint' && turn.spotting) {
                return rejected(state, 'INVALID_TURN_STATE');
            }
            const movementPsr = state.turn.airborne === turn.airborne
                ? state.movementPsr
                : clearMekMovementV2(state.movementPsr);
            changed = mekTurnStatesEqualV2(state.turn, turn)
                && mekMovementPsrStatesEqualV2(state.movementPsr, movementPsr)
                ? null
                : { ...state, turn, movementPsr };
            break;
        }
        case 'reset-turn-state': {
            const turn = createPristineMekTurnStateV2(state.turn.turnCounter);
            changed = mekTurnStatesEqualV2(state.turn, turn) ? null : { ...state, turn };
            break;
        }
        case 'end-phase':
            changed = endPhase(unit, entity, index, state, statusTopology);
            break;
        case 'end-turn':
            if (mekHeatCapabilityV2(heatContext, entity).kind === 'unsupported') {
                return rejected(state, 'UNSUPPORTED_HEAT_CONTEXT');
            }
            if (!isHeatPolicy(command.policy)) return rejected(state, 'INVALID_TARGET');
            const endTurnProjection = projectMekHeatContextV2(
                heatContext,
                entity,
                buildHeatKernelInput(unit, state, statusTopology),
                command.policy,
            );
            if (endTurnProjection.kind === 'unsupported') return rejected(state, 'UNSUPPORTED_HEAT_CONTEXT');
            if (command.policy === 'automatic'
                && endTurnProjection.projection.projected > MAX_MEK_HEAT_VALUE_V2) {
                return rejected(state, 'EXCEEDS_CAPACITY');
            }
            const ended = endTurn(unit, entity, index, state, command.policy, statusTopology, heatContext);
            if (ended === 'unsupported') return rejected(state, 'UNSUPPORTED_HEAT_CONTEXT');
            changed = ended;
            break;
        case 'commit-pending':
            changed = commitPending(unit, entity, index, state);
            break;
        case 'cancel-pending':
            changed = hasPending(state.pendingCombat) ? { ...state, pendingCombat: emptyPending() } : null;
            break;
    }
    // End Phase is also the history/undo separator, so it remains meaningful
    // without damage to commit. Movement reconciliation still blocks pending
    // checks and settles resolved evidence atomically.
    if (!changed && movementBoundaryNeedsEvaluation(state, command.type)) changed = state;
    if (!changed) return rejected(state, 'NO_CHANGE');
    changed = reconcileHeatAcknowledgements(entity, unit, changed, statusTopology, heatContext);
    const ruleCheckReconciliation = reconcileMekRuleChecksContextV2(
        mechanicsContext,
        entity,
        mekDamageStateView(unit, changed),
        changed.ruleChecks,
        nextRevision,
    );
    if (ruleCheckReconciliation.kind === 'supported'
        && ruleCheckReconciliation.triggerConflict) {
        return rejected(state, 'RULE_CHECK_TRIGGER_CONFLICT');
    }
    changed = reconcileMekDerivedState(unit, changed, mechanicsContext, nextRevision);
    const movementReconciliation = reconcileMovementAfterCommand(
        unit,
        state,
        changed,
        command,
        statusTopology,
        runtime.crewAssignment(),
        mechanicsContext,
        nextRevision,
    );
    if (movementReconciliation.kind === 'rejected') {
        return rejected(state, movementReconciliation.reason);
    }
    changed = movementReconciliation.state;
    const nextState = freezeRuntimeState({ ...changed, stateRevision: nextRevision });
    return Object.freeze({
        accepted: true,
        idempotent: false,
        previousRevision: state.stateRevision,
        state: nextState,
        events: Object.freeze([{ kind: command.type, commandId: command.commandId, revision: nextRevision }]),
        ...(prototypeHeat === undefined ? {} : { prototypeHeat }),
    });
}

type MovementPostCommandResult =
    | { readonly kind: 'accepted'; readonly state: MekUnitRuntimeState }
    | { readonly kind: 'rejected'; readonly reason: 'PENDING_PILOT_CHECKS' };

function movementBoundaryNeedsEvaluation(
    state: MekUnitRuntimeState,
    commandType: CBTUnitCommand['type'],
): boolean {
    const phaseBoundary = commandType === 'end-phase';
    const turnBoundary = commandType === 'end-turn' || commandType === 'reset-turn-state';
    if (phaseBoundary) return true;
    if (!turnBoundary) return false;

    return !mekMovementPsrStatesEqualV2(
        state.movementPsr,
        createPristineMekMovementPsrStateV2(),
    );
}

function reconcileMovementAfterCommand(
    unit: MekRuntimeSource,
    before: MekUnitRuntimeState,
    candidate: MekUnitRuntimeState,
    command: CBTUnitCommand,
    statusTopology: RuntimeEquipmentStatusTopology,
    crewAssignment: CrewAssignment,
    mechanicsContext: MekMechanicsContextV2,
    nextRevision: StateRevision,
): MovementPostCommandResult {
    const mutations = committedMekDamageMutations(unit, before, candidate, statusTopology);
    let changed = candidate;
    const input = createMovementRuntimeInput(
        unit,
        changed,
        statusTopology,
        crewAssignment,
        mechanicsContext,
    );
    if (!input) return Object.freeze({ kind: 'accepted', state: changed });

    if (mutations.length > 0) {
        const synthesis = synthesizeCommittedMekDamagePilotChecksContextV2(
            mechanicsContext,
            requireCanonicalMek(unit),
            input,
            changed.movementPsr,
            mutations,
            nextRevision,
        );
        if (synthesis.kind === 'supported') {
            changed = {
                ...changed,
                movementPsr: synthesis.synthesis.state,
            };
        }
    }

    const reconciledInput = createMovementRuntimeInput(
        unit,
        changed,
        statusTopology,
        crewAssignment,
        mechanicsContext,
    );
    if (reconciledInput) {
        const movementPsr = reconcileMekPilotChecksContextV2(
            mechanicsContext,
            requireCanonicalMek(unit),
            reconciledInput,
            changed.movementPsr,
        );
        if (!('kind' in movementPsr)) changed = { ...changed, movementPsr };
    }

    const automaticFallPending = changed.movementPsr.automaticFalls.length > 0;
    const committedDamageRequiresPilotChecks = command.type === 'end-phase'
        && mutations.length > 0
        && changed.movementPsr.checks.some(check => check.status === 'pending');
    const boundaryNeedsAutomaticFallResolution = command.type === 'end-phase'
        && automaticFallPending;
    if (!committedDamageRequiresPilotChecks && !boundaryNeedsAutomaticFallResolution) {
        try {
            if (command.type === 'end-phase') {
                changed = { ...changed, movementPsr: resetMekMovementPsrPhaseV2(changed.movementPsr) };
            } else if (command.type === 'end-turn' || command.type === 'reset-turn-state') {
                changed = {
                    ...changed,
                    movementPsr: resetMekMovementPsrTurnV2(changed.movementPsr),
                };
            }
        } catch {
            return Object.freeze({ kind: 'rejected', reason: 'PENDING_PILOT_CHECKS' });
        }
    }
    if (command.type === 'end-phase'
        || command.type === 'end-turn'
        || command.type === 'reset-turn-state') {
        if (automaticFallPending) {
            const conditions = new Set(changed.conditions);
            conditions.add('prone');
            changed = { ...changed, conditions: new ImmutableSet(conditions) };
        }
    }
    return Object.freeze({ kind: 'accepted', state: changed });
}

function reconcileMekDerivedState(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    context: MekMechanicsContextV2,
    openingRevision: number,
): MekUnitRuntimeState {
    const reconciled = reconcileMekRuleChecksContextV2(
        context,
        requireCanonicalMek(unit),
        mekDamageStateView(unit, state),
        state.ruleChecks,
        openingRevision,
    );
    if (reconciled.kind === 'unsupported') return state;
    if (reconciled.triggerConflict) {
        throw new Error('Mek rule-check trigger conflict in runtime state');
    }
    const withChecks = reconciled.ruleChecks === state.ruleChecks
        ? state
        : { ...state, ruleChecks: reconciled.ruleChecks };
    const projection = projectRuntimeMekDestruction(unit, withChecks, context);
    if (projection.kind === 'unsupported') return withChecks;
    return withChecks.destroyed === projection.facts.committed.destroyed
        ? withChecks
        : { ...withChecks, destroyed: projection.facts.committed.destroyed };
}

function mekDamageStateView(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
): MekDamageStateViewV2 {
    return Object.freeze({
        remainingInternal: (locationId: LocationId, perspective: StatePerspective) => {
            const location = unit.index.locations.get(locationId);
            if (!location) throw new Error(`Unknown location ${locationId}`);
            return Math.max(0, location.internalPoints - internalDamage(state, locationId, perspective));
        },
        remainingArmor: (faceId: ArmorFaceId, perspective: StatePerspective) => {
            const face = unit.index.armorFaces.get(faceId);
            if (!face) throw new Error(`Unknown armor face ${faceId}`);
            return Math.max(0, face.maximumPoints - armorDamage(state, faceId, perspective));
        },
        criticalHits: (slotId: CriticalSlotId, perspective: StatePerspective) => {
            if (!unit.index.slots.has(slotId)) throw new Error(`Unknown critical slot ${slotId}`);
            return criticalHits(state, slotId, perspective);
        },
        crewState: (positionId: CrewPositionId) => {
            if (!unit.index.crewPositions.has(positionId)) throw new Error(`Unknown crew position ${positionId}`);
            const crew = state.crew.get(positionId) ?? HEALTHY_CREW_STATE;
            return Object.freeze({
                wounds: crew.wounds,
                ejected: crew.ejected,
                fatallyWounded: crew.wounds >= MAX_MEK_CREW_WOUNDS,
            });
        },
        locationCondition: (
            locationId: LocationId,
            condition: 'blown-off' | 'flooded',
            perspective: StatePerspective,
        ) => {
            if (!unit.index.locations.has(locationId)) throw new Error(`Unknown location ${locationId}`);
            return locationConditionValue(state, locationId, condition, perspective);
        },
    });
}

function projectRuntimeMekDestruction(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    context: MekMechanicsContextV2,
): MekDestructionProjectionResultV2 {
    const projection = projectMekDestructionContextV2(
        context,
        requireCanonicalMek(unit),
        mekDamageStateView(unit, state),
        state.ruleChecks,
    );
    if (projection.kind === 'unsupported'
        || projection.facts.committed.destroyed
        || !hasDetonatedBoobyTrap(unit, state)) return projection;
    return Object.freeze({
        ...projection,
        destroyed: true,
        facts: Object.freeze({
            ...projection.facts,
            committed: Object.freeze({ ...projection.facts.committed, destroyed: true }),
        }),
    });
}

function hasDetonatedBoobyTrap(unit: MekRuntimeSource, state: MekUnitRuntimeState): boolean {
    return [...unit.index.components].some(([componentId, component]) =>
        component.kind === 'equipment'
        && isBoobyTrapEquipment(component.mount.equipment)
        && isBoobyTrapDetonated(state.components.get(componentId)?.mode));
}

interface MekRuntimeProjectionContext {
    readonly committedStatus: RuntimeEquipmentStatusKernel;
    readonly destruction: MekDestructionProjectionResultV2;
}

function projectRuntimeMekMovementPsr(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    statusTopology: RuntimeEquipmentStatusTopology,
    crewAssignment: CrewAssignment,
    mechanicsContext: MekMechanicsContextV2,
    context?: MekRuntimeProjectionContext,
): MekMovementPsrProjectionResultV2 {
    const input = createMovementRuntimeInput(
        unit,
        state,
        statusTopology,
        crewAssignment,
        mechanicsContext,
        context,
    );
    return input === null
        ? Object.freeze({
            kind: 'unsupported',
            blockers: Object.freeze(['Mek mechanics context is unsupported']),
        })
        : projectMekMovementPsrContextV2(
            mechanicsContext,
            requireCanonicalMek(unit),
            input,
            state.movementPsr,
        );
}

function projectRuntimeMekBattleValue(
    unit: MekRuntimeSource,
    runtimeIndex: MekRuntimeIndex | null,
    state: MekUnitRuntimeState,
    statusTopology: RuntimeEquipmentStatusTopology,
    crewAssignment: CrewAssignment,
    mechanicsContext: MekMechanicsContextV2,
    context?: MekRuntimeProjectionContext,
): MekBattleValueProjection {
    const input = createMovementRuntimeInput(
        unit,
        state,
        statusTopology,
        crewAssignment,
        mechanicsContext,
        context,
    );
    if (input === null) throw new Error('Mek current BV mechanics context is unsupported');
    const movement = projectMekBattleValueMovementContextV2(
        mechanicsContext,
        requireCanonicalMek(unit),
        input,
    );
    if (movement.kind === 'unsupported') {
        throw new Error(`Mek current BV movement is unsupported: ${movement.blockers.join('; ')}`);
    }
    const entity = unit.entity;
    if (entity === undefined || runtimeIndex === null) {
        throw new Error('Mek current BV requires the canonical entity');
    }
    const status = context?.committedStatus ?? new RuntimeEquipmentStatusKernel(
        statusTopology,
        statusState(unit, state, 'committed'),
        { rules: unit.ruleset, family: 'mek' },
    );
    const armorRemaining = new Map<ArmorFaceId, number>();
    for (const face of runtimeIndex.armorFaces.values()) {
        armorRemaining.set(face.id, Math.max(0, face.maximumPoints - armorDamage(state, face.id, 'committed')));
    }
    const internalRemaining = new Map<LocationId, number>();
    for (const location of runtimeIndex.locations.values()) {
        internalRemaining.set(location.id, Math.max(
            0,
            location.internalPoints - internalDamage(state, location.id, 'committed'),
        ));
    }
    const locationIdByCode = new Map(
        [...runtimeIndex.locations.values()].map(location => [location.code, location.id] as const),
    );
    const armorFaceIdByLocation = new Map<string, ArmorFaceId>();
    for (const face of runtimeIndex.armorFaces.values()) {
        armorFaceIdByLocation.set(`${face.locationId}\0${face.face}`, face.id);
    }
    const view: EntityStateView = Object.freeze({
        destroyed: state.destroyed,
        movement: Object.freeze({
            walk: movement.walkMp,
            run: movement.runMp,
            jump: movement.jumpMp,
            umu: movement.umuMp,
        }),
        engineHits: Math.min(3, countCommittedSystemHits(unit, state, 'Engine')),
        equipmentStatus: (mountId: string) => {
            const componentId = asComponentId(mountId);
            if (runtimeIndex.components.get(componentId)?.kind !== 'equipment') {
                throw new Error(`Runtime has no component for mount ${mountId}`);
            }
            return status.component(componentId).status;
        },
        armorRemaining: (location: string, face: 'front' | 'rear') => {
            const locationId = locationIdByCode.get(location);
            if (locationId === undefined) throw new Error(`Runtime has no location ${location}`);
            const faceId = armorFaceIdByLocation.get(`${locationId}\0${face}`);
            return faceId === undefined ? 0 : armorRemaining.get(faceId) ?? 0;
        },
        structureRemaining: (location: string) => {
            const locationId = locationIdByCode.get(location);
            if (locationId === undefined) throw new Error(`Runtime has no location ${location}`);
            return internalRemaining.get(locationId) ?? 0;
        },
        ammoRemaining: (mountId: string) => {
            const componentId = asComponentId(mountId);
            if (runtimeIndex.components.get(componentId)?.kind !== 'equipment') {
                throw new Error(`Runtime has no component for mount ${mountId}`);
            }
            if (mekAmmoCapacity(unit.entity, unit.index, componentId, unit.ruleset) === null) return 0;
            const ammo = state.ammo.get(componentId);
            const capacity = requireAmmoCapacity(unit, componentId, ammo?.munitionOverride);
            return capacity - (ammo?.shotsSpent ?? 0);
        },
        ammoEquipment: (mountId: string) => {
            const componentId = asComponentId(mountId);
            if (runtimeIndex.components.get(componentId)?.kind !== 'equipment') {
                throw new Error(`Runtime has no component for mount ${mountId}`);
            }
            return mekAmmoLoadout(
                unit.entity,
                unit.index,
                componentId,
                unit.ruleset,
                state.ammo.get(componentId)?.munitionOverride,
            )?.equipment ?? null;
        },
    });
    const result = entity.battleValueBreakdownFor(view, unit.ruleset);
    const manualBattleValue = entity.manualBV();
    return Object.freeze({
        kind: 'complete',
        battleValue: result.base,
        defensive: result.defensive,
        offensive: result.offensive,
        ...(manualBattleValue > 0 ? { manualBattleValue } : {}),
        manualOverrideApplied: false,
    });
}

function projectRuntimeMekPhysicalAttacks(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    statusTopology: RuntimeEquipmentStatusTopology,
    crewAssignment: CrewAssignment,
    mechanicsContext: MekMechanicsContextV2,
    context?: MekRuntimeProjectionContext,
): MekPhysicalAttackProjectionResultV2 {
    const input = createMovementRuntimeInput(
        unit,
        state,
        statusTopology,
        crewAssignment,
        mechanicsContext,
        context,
    );
    if (input === null) {
        return Object.freeze({
            kind: 'unsupported',
            blockers: Object.freeze(['Mek mechanics context is unsupported']),
        });
    }
    return projectMekPhysicalAttacksContextV2(mechanicsContext, requireCanonicalMek(unit), Object.freeze({
        ...input,
        movementMode: state.movementPsr.movement?.mode ?? null,
        movementDistance: state.movementPsr.movement?.distance ?? 0,
        componentMode: (componentId: ComponentId) => {
            return effectiveComponentMode(unit, state, componentId);
        },
    }));
}

function projectRuntimeMekShields(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    statusTopology: RuntimeEquipmentStatusTopology,
    mechanicsContext: MekMechanicsContextV2,
    perspective: StatePerspective,
    sharedStatus?: RuntimeEquipmentStatusKernel,
): MekShieldProjectionResultV2 {
    const committed = statusState(unit, state, perspective);
    const status = sharedStatus ?? new RuntimeEquipmentStatusKernel(
        statusTopology,
        committed,
        { rules: unit.ruleset, family: 'mek' },
    );
    return projectMekShieldsContextV2(
        mechanicsContext,
        requireCanonicalMek(unit),
        Object.freeze({
            componentDestroyed: (componentId: ComponentId) =>
                committed.components.get(componentId) === 'destroyed',
            criticalSlotUnavailable: (slotId: CriticalSlotId) =>
                status.criticalSlot(slotId).status !== 'available',
            locationDestroyed: (locationId: LocationId) =>
                isRuntimeLocationPhysicallyDestroyed(unit, state, locationId, perspective),
            shieldDamage: (componentId: ComponentId, track: MekShieldTrack) =>
                shieldDamage(state, componentId, track, perspective),
        }),
    );
}

function shieldAwareComponentStatus(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    statusTopology: RuntimeEquipmentStatusTopology,
    mechanicsContext: MekMechanicsContextV2,
    componentId: ComponentId,
    perspective: StatePerspective,
    status: EquipmentStatus,
    sharedStatus?: RuntimeEquipmentStatusKernel,
): EquipmentStatus {
    if (status !== 'available') return status;
    const component = unit.index.components.get(componentId);
    if (component?.kind !== 'equipment' || !isShieldEquipment(component.mount.equipment)) {
        return status;
    }
    const projection = projectRuntimeMekShields(
        unit,
        state,
        statusTopology,
        mechanicsContext,
        perspective,
        sharedStatus,
    );
    if (projection.kind === 'unsupported') return status;
    return projection.shields.find(shield => shield.componentId === componentId)?.operational === false
        ? 'destroyed'
        : status;
}

function projectRuntimeMekCombatModifiers(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    statusTopology: RuntimeEquipmentStatusTopology,
    crewAssignment: CrewAssignment,
    mechanicsContext: MekMechanicsContextV2,
    context?: MekRuntimeProjectionContext,
): MekCombatModifierProjectionResult {
    const input = createMovementRuntimeInput(
        unit,
        state,
        statusTopology,
        crewAssignment,
        mechanicsContext,
        context,
    );
    if (input === null) {
        return Object.freeze({
            kind: 'unsupported',
            blockers: Object.freeze(['Mek mechanics context is unsupported']),
        });
    }
    return projectMekCombatModifiersContextV2(
        mechanicsContext,
        requireCanonicalMek(unit),
        input,
    );
}

function countCommittedSystemHits(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    system: MekSystemType,
): number {
    return [...unit.index.slots.values()].reduce((total, slot) => {
        if (!slot.componentIds.some(componentId => {
            const component = unit.index.components.get(componentId);
            return component?.kind === 'system' && component.systemType === system;
        })) return total;
        return total + criticalHits(state, slot.id, 'committed');
    }, 0);
}

function createMovementRuntimeInput(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    statusTopology: RuntimeEquipmentStatusTopology,
    crewAssignment: CrewAssignment,
    mechanicsContext: MekMechanicsContextV2,
    context?: MekRuntimeProjectionContext,
): MekMovementRuntimeContextInputV2 | null {
    const destruction = context?.destruction
        ?? projectRuntimeMekDestruction(unit, state, mechanicsContext);
    if (destruction.kind === 'unsupported') return null;
    const status = context?.committedStatus ?? new RuntimeEquipmentStatusKernel(
        statusTopology,
        statusState(unit, state, 'committed'),
        { rules: unit.ruleset, family: 'mek' },
    );
    const conditions = new Set<'shutdown' | 'prone' | 'disconnected'>();
    for (const condition of ['shutdown', 'prone', 'disconnected'] as const) {
        if (state.conditions.has(condition)) conditions.add(condition);
    }
    return Object.freeze({
        currentHeat: state.heat.current,
        airborne: state.turn.airborne === true,
        crewAssignment,
        crewState: (positionId: CrewPositionId) => state.crew.get(positionId) ?? HEALTHY_CREW_STATE,
        conditions: new ImmutableSet(conditions),
        destruction: destruction.facts,
        componentAvailable: (componentId: ComponentId) =>
            status.component(componentId).status === 'available',
        componentDisabled: (componentId: ComponentId) =>
            status.component(componentId).status === 'disabled',
        componentDestroyed: (componentId: ComponentId) =>
            state.components.get(componentId)?.statusOverride === 'destroyed',
        componentBoosterActive: (componentId: ComponentId) => {
            const component = unit.index.components.get(componentId);
            return state.components.get(componentId)?.escalatingFailure?.active === true
                && (component?.kind !== 'equipment'
                    || movementBoosterUsableWhile(component.mount.equipment, state.turn.airborne));
        },
        modularArmorRemaining: (componentId: ComponentId) =>
            modularArmorRemaining(unit, state, componentId, 'committed'),
        criticalSlotUnavailable: (slotId: CriticalSlotId) =>
            status.criticalSlot(slotId).status !== 'available',
        criticalSlotDestroyedTurn: (slotId: CriticalSlotId) => {
            const slot = unit.index.slots.get(slotId);
            const runtime = state.slots.get(slotId);
            if (!slot || !runtime
                || runtime.hits < mekCriticalSlotDirectHitThreshold(slot)) return undefined;
            return runtime.destroyedTurn ?? 0;
        },
        locationDestroyed: (locationId: LocationId) => isMekLocationPhysicallyDestroyed(
            unit.index,
            state.locations,
            locationId,
        ),
        shieldDamage: (componentId: ComponentId, track: MekShieldTrack) =>
            shieldDamage(state, componentId, track, 'committed'),
    });
}

function committedMekDamageMutations(
    unit: MekRuntimeSource,
    before: MekUnitRuntimeState,
    after: MekUnitRuntimeState,
    statusTopology: RuntimeEquipmentStatusTopology,
): readonly MekCommittedDamageMutationV2[] {
    const beforeStatus = new RuntimeEquipmentStatusKernel(
        statusTopology,
        statusState(unit, before, 'committed'),
        { rules: unit.ruleset, family: 'mek' },
    );
    const afterStatus = new RuntimeEquipmentStatusKernel(
        statusTopology,
        statusState(unit, after, 'committed'),
        { rules: unit.ruleset, family: 'mek' },
    );
    const mutations: MekCommittedDamageMutationV2[] = [];
    for (const face of unit.index.armorFaces.values()) {
        const beforeRemaining = face.maximumPoints - armorDamage(before, face.id, 'committed');
        const afterRemaining = face.maximumPoints - armorDamage(after, face.id, 'committed');
        if (afterRemaining >= beforeRemaining) continue;
        mutations.push(Object.freeze({
            kind: 'armor',
            faceId: face.id,
            beforeRemaining,
            afterRemaining,
            receivedDamage: beforeRemaining - afterRemaining,
        }));
    }
    for (const location of unit.index.locations.values()) {
        const beforeRemaining = location.internalPoints - internalDamage(before, location.id, 'committed');
        const afterRemaining = location.internalPoints - internalDamage(after, location.id, 'committed');
        const beforeDestroyed = isMekLocationPhysicallyDestroyed(unit.index, before.locations, location.id);
        const afterDestroyed = isMekLocationPhysicallyDestroyed(unit.index, after.locations, location.id);
        // This stream feeds damage-triggered PSRs. Reattaching or repairing a
        // location is a valid committed change, but it is not damage.
        if (beforeDestroyed && !afterDestroyed) continue;
        if (afterRemaining >= beforeRemaining && beforeDestroyed === afterDestroyed) continue;
        mutations.push(Object.freeze({
            kind: 'internal',
            locationId: location.id,
            beforeRemaining,
            afterRemaining,
            beforeDestroyed,
            afterDestroyed,
            receivedDamage: beforeRemaining - afterRemaining,
        }));
    }
    for (const slot of unit.index.slots.values()) {
        const beforeHits = criticalHits(before, slot.id, 'committed');
        const afterHits = criticalHits(after, slot.id, 'committed');
        if (afterHits <= beforeHits) continue;
        mutations.push(Object.freeze({
            kind: 'critical',
            slotId: slot.id,
            beforeHits,
            afterHits,
            beforeUnavailable: beforeStatus.criticalSlot(slot.id).status !== 'available',
            afterUnavailable: afterStatus.criticalSlot(slot.id).status !== 'available',
            receivedDamage: 0,
        }));
    }
    mutations.sort((left, right) => compareText(
        JSON.stringify(left),
        JSON.stringify(right),
    ));
    return Object.freeze(mutations);
}

function endPhase(
    unit: MekRuntimeSource,
    entity: MekEntity,
    index: MekRuntimeIndex,
    state: MekUnitRuntimeState,
    statusTopology: RuntimeEquipmentStatusTopology,
): MekUnitRuntimeState | null {
    const committed = commitPending(unit, entity, index, state) ?? state;
    const arraysSettled = settleMachineGunArrays(unit, committed);
    const shieldsSettled = lowerCoreShields(unit, arraysSettled);
    const stealthSettled = settleStealthSystems(unit, shieldsSettled, statusTopology, false);
    const phaseTurn = canonicalizeMekTurnStateV2({
        ...stealthSettled.turn,
        equipmentStateChanged: false,
    });
    if (stealthSettled === state && mekTurnStatesEqualV2(state.turn, phaseTurn)) return null;
    return { ...stealthSettled, turn: phaseTurn };
}

function buildMekStealthFacts(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    statusTopology: RuntimeEquipmentStatusTopology,
    perspective: StatePerspective,
): readonly StealthEquipmentFacts[] {
    const status = new RuntimeEquipmentStatusKernel(
        statusTopology,
        statusState(unit, state, perspective),
        { rules: unit.ruleset, family: 'mek' },
    );
    const electronics = buildMekElectronicFacts(unit, state, statusTopology, perspective);
    return Object.freeze([...unit.index.components].flatMap(([componentId, component]) => {
        if (component.kind !== 'equipment' || !component.mount.equipment) return [];
        const equipment = component.mount.equipment;
        if (!isStealthSystemEquipment(equipment)
            && !isEcmEquipment(equipment)
            && !isBattleArmorMyomerBoosterEquipment(equipment)) return [];
        return [Object.freeze({
            componentId,
            equipment,
            mode: electronicClaims(equipment).ecm
                ? effectiveEcmMode(electronics, componentId, perspective === 'preview')
                : effectiveComponentMode(unit, state, componentId),
            ...(isStealthSystemEquipment(equipment)
                ? { state: componentStealthState(unit, state, componentId) }
                : {}),
            operational: status.component(componentId).status === 'available',
        })];
    }));
}

function settleStealthSystems(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    statusTopology: RuntimeEquipmentStatusTopology,
    completeTransitions: boolean,
): MekUnitRuntimeState {
    let settled = state;
    const facts = buildMekStealthFacts(unit, state, statusTopology, 'preview');
    const functionalEcm = hasFunctionalEcmForStealth(facts);
    for (const fact of facts) {
        if (!isStealthSystemEquipment(fact.equipment)
            || !isSwitchableStealthEquipment(fact.equipment)) continue;
        const current = fact.state ?? 'disabled';
        const next = (isStealthEquipment(fact.equipment)
            || isVoidSignatureEquipment(fact.equipment)) && !functionalEcm
            ? 'disabled'
            : !completeTransitions ? current
                : current === 'enabling' ? 'enabled'
                    : current === 'disabling' ? 'disabled' : current;
        if (next !== current) {
            settled = withStealthState(unit, settled, fact.componentId, next) ?? settled;
        }
    }
    return settled;
}

function projectPendingHeatAfterWeaponFire(
    unit: MekRuntimeSource,
    entity: MekEntity,
    before: MekUnitRuntimeState,
    fired: MekUnitRuntimeState,
    statusTopology: RuntimeEquipmentStatusTopology,
    heatContext: MekHeatRuntimeContextV2,
    policy: MekHeatAutomationPolicyV2,
): number {
    const pending = before.heat.pendingOverride;
    if (pending === undefined) throw new Error('Pending weapon-fire projection requires a pending heat target');
    const baseHeat = canonicalizeMekHeatStateV2({
        current: pending,
        previous: before.heat.previous,
        heatsinksOff: before.heat.heatsinksOff,
    });
    const result = projectMekHeatContextV2(
        heatContext,
        entity,
        buildHeatKernelInput(unit, { ...fired, heat: baseHeat }, statusTopology),
        policy,
    );
    if (result.kind === 'unsupported') throw new Error('Mek heat context became unsupported during weapon fire');
    return result.projection.projected;
}

function endTurn(
    unit: MekRuntimeSource,
    entity: MekEntity,
    index: MekRuntimeIndex,
    state: MekUnitRuntimeState,
    policy: MekHeatAutomationPolicyV2,
    statusTopology: RuntimeEquipmentStatusTopology,
    heatContext: MekHeatRuntimeContextV2,
): MekUnitRuntimeState | null | 'unsupported' {
    // Heat is deliberately evaluated before pending equipment/damage commit. Pending engine hits
    // generate heat now, while only committed sink loss changes this turn's cooling capacity.
    const heatResult = resolveEndTurnMekHeatContextV2(
        heatContext,
        entity,
        buildHeatKernelInput(unit, state, statusTopology),
        policy,
    );
    if (heatResult.kind === 'unsupported') return 'unsupported';
    const heatApplied = heatResult.application;
    const preCommit = heatApplied?.changed
        ? {
            ...state,
            heat: heatApplied.heat,
            turn: heatApplied.turn,
        }
        : state;
    // Charged-component explosions resolve against preview damage before the pending facts commit.
    const criticalExploded = applyPendingMekCriticalExplosions(unit, entity, index, preCommit) ?? preCommit;
    const expanded = expandPendingPpcCapacitorExplosions(unit, entity, index, criticalExploded)
        ?? criticalExploded;
    const escalatingSettled = settleEscalatingFailures(unit, expanded);
    const ppcSettled = settlePpcCapacitors(unit, entity, index, escalatingSettled);
    const gaussSettled = settleGaussPower(unit, ppcSettled);
    const equipmentSettled = settleBombastLasers(
        unit,
        index,
        unit.ruleset,
        gaussSettled,
    );
    const arraysSettled = settleMachineGunArrays(unit, equipmentSettled);
    const shieldsSettled = lowerCoreShields(unit, arraysSettled);
    const coolantSettled = settleCoolantPods(unit, shieldsSettled);
    const hpgSettled = settleMobileHpgs(unit, coolantSettled);
    const electronicSettled = settleElectronicSuites(unit, hpgSettled, statusTopology);
    const stealthSettled = settleStealthSystems(unit, electronicSettled, statusTopology, true);
    const committed = commitPending(unit, entity, index, stealthSettled) ?? stealthSettled;
    const conditions = new Set(committed.conditions);
    conditions.delete('tagged');
    conditions.delete('skidding');
    const turn = createPristineMekTurnStateV2(Math.min(
        committed.turn.turnCounter + 1,
        MAX_MEK_TURN_NUMBER,
    ));
    if (committed === state
        && conditions.size === state.conditions.size
        && mekTurnStatesEqualV2(state.turn, turn)) return null;
    return {
        ...committed,
        conditions: new ImmutableSet(conditions),
        turn,
    };
}

function withLocationArmorDamage(
    state: MekUnitRuntimeState,
    locationId: LocationId,
    faceId: ArmorFaceId,
    amount: number,
): MekUnitRuntimeState {
    const locations = new Map(state.locations);
    const current = locations.get(locationId) ?? emptyLocationRuntimeState();
    const armor = new Map(current.armorDamage.map(item => [item.faceId, item.damage]));
    const nextDamage = (armor.get(faceId) ?? 0) + amount;
    if (nextDamage === 0) armor.delete(faceId);
    else armor.set(faceId, nextDamage);
    const armorDamage = Object.freeze([...armor]
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([id, damage]) => Object.freeze({ faceId: id, damage })));
    if (current.internalDamage === 0 && armorDamage.length === 0 && current.conditions.size === 0) {
        locations.delete(locationId);
    }
    else locations.set(locationId, Object.freeze({ ...current, armorDamage }));
    return { ...state, locations: new ImmutableIndex(locations) };
}

function withLocationInternalDamage(
    state: MekUnitRuntimeState,
    locationId: LocationId,
    amount: number,
): MekUnitRuntimeState {
    const locations = new Map(state.locations);
    const current = locations.get(locationId) ?? emptyLocationRuntimeState();
    const internalDamage = current.internalDamage + amount;
    if (internalDamage === 0 && current.armorDamage.length === 0 && current.conditions.size === 0) {
        locations.delete(locationId);
    }
    else locations.set(locationId, Object.freeze({ ...current, internalDamage }));
    return { ...state, locations: new ImmutableIndex(locations) };
}

function withLocationCondition(
    state: MekUnitRuntimeState,
    locationId: LocationId,
    condition: MekLocationConditionKey,
    value: number,
): MekUnitRuntimeState | null {
    const locations = new Map(state.locations);
    const current = locations.get(locationId) ?? emptyLocationRuntimeState();
    const existing = current.conditions.get(condition) ?? 0;
    const pendingByLocation = new Map(state.pendingCombat.locationConditions);
    const pending = new Map(pendingByLocation.get(locationId) ?? []);
    const clearedPending = pending.delete(condition);
    if (clearedPending) {
        if (pending.size === 0) pendingByLocation.delete(locationId);
        else pendingByLocation.set(locationId, new ImmutableIndex(pending));
    }
    if (existing === value && !clearedPending) return null;
    if (existing !== value) {
        const conditions = new Map(current.conditions);
        if (value === 0) conditions.delete(condition);
        else conditions.set(condition, value);
        if (current.internalDamage === 0 && current.armorDamage.length === 0 && conditions.size === 0) {
            locations.delete(locationId);
        } else {
            locations.set(locationId, Object.freeze({
                ...current,
                conditions: new ImmutableIndex(conditions),
            }));
        }
    }
    return {
        ...state,
        locations: new ImmutableIndex(locations),
        pendingCombat: clearedPending
            ? Object.freeze({
                ...state.pendingCombat,
                locationConditions: new ImmutableIndex(pendingByLocation),
            })
            : state.pendingCombat,
    };
}

function withPendingLocationCondition(
    state: MekUnitRuntimeState,
    locationId: LocationId,
    condition: MekLocationConditionKey,
    value: number,
): MekUnitRuntimeState | null {
    const pendingByLocation = new Map(state.pendingCombat.locationConditions);
    const pending = new Map(pendingByLocation.get(locationId) ?? []);
    const committed = state.locations.get(locationId)?.conditions.get(condition) ?? 0;
    const existing = pending.has(condition) ? pending.get(condition)! : committed;
    if (existing === value) return null;
    if (value === committed) pending.delete(condition);
    else pending.set(condition, value);
    if (pending.size === 0) pendingByLocation.delete(locationId);
    else pendingByLocation.set(locationId, new ImmutableIndex(pending));
    return {
        ...state,
        pendingCombat: Object.freeze({
            ...state.pendingCombat,
            locationConditions: new ImmutableIndex(pendingByLocation),
        }),
    };
}

function criticalRuntimeView(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    statusTopology: RuntimeEquipmentStatusTopology,
): MekCriticalRuntimeViewV2 {
    let committedStatus: RuntimeEquipmentStatusKernel | undefined;
    let previewStatus: RuntimeEquipmentStatusKernel | undefined;
    const createStatus = (perspective: StatePerspective) => new RuntimeEquipmentStatusKernel(
        statusTopology,
        statusState(unit, state, perspective),
        { rules: unit.ruleset, family: 'mek' },
    );
    const status = (perspective: StatePerspective) => perspective === 'committed'
        ? committedStatus ??= createStatus(perspective)
        : previewStatus ??= createStatus(perspective);
    return Object.freeze({
        remainingArmor: (faceId: ArmorFaceId, perspective: StatePerspective) => {
            const face = unit.index.armorFaces.get(faceId);
            if (!face) throw new Error(`Unknown armor face ${faceId}`);
            return Math.max(0, face.maximumPoints - armorDamage(state, faceId, perspective));
        },
        remainingInternal: (locationId: LocationId, perspective: StatePerspective) => {
            const location = unit.index.locations.get(locationId);
            if (!location) throw new Error(`Unknown location ${locationId}`);
            return Math.max(0, location.internalPoints - internalDamage(state, locationId, perspective));
        },
        criticalHits: (slotId: CriticalSlotId, perspective: StatePerspective) => {
            if (!unit.index.slots.has(slotId)) throw new Error(`Unknown critical slot ${slotId}`);
            return criticalHits(state, slotId, perspective);
        },
        componentStatus: (componentId: ComponentId, perspective: StatePerspective) => {
            if (!unit.index.components.has(componentId)) throw new Error(`Unknown component ${componentId}`);
            return status(perspective).component(componentId).status;
        },
        componentMode: (componentId: ComponentId) => {
            return effectiveComponentMode(unit, state, componentId);
        },
        componentGaussPower: (componentId: ComponentId) => gaussPowerState(unit, state, componentId),
        componentEscalatingFailure: (componentId: ComponentId) => {
            if (!unit.index.components.has(componentId)) throw new Error(`Unknown component ${componentId}`);
            return state.components.get(componentId)?.escalatingFailure;
        },
        componentPpcCapacitor: (componentId: ComponentId) => {
            if (!unit.index.components.has(componentId)) throw new Error(`Unknown component ${componentId}`);
            return state.components.get(componentId)?.ppcCapacitor;
        },
        componentBombastLaser: (componentId: ComponentId) => {
            if (!unit.index.components.has(componentId)) throw new Error(`Unknown component ${componentId}`);
            return state.components.get(componentId)?.bombastLaser;
        },
        ammoLoadout: (componentId: ComponentId) => requireAmmoLoadout(
            unit,
            componentId,
            state.ammo.get(componentId)?.munitionOverride,
        ),
        remainingAmmo: (componentId: ComponentId) => {
            const ammo = state.ammo.get(componentId);
            return requireAmmoCapacity(unit, componentId, ammo?.munitionOverride) - (ammo?.shotsSpent ?? 0);
        },
    });
}

function applyMekBlowOffPlan(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    plan: MekBlowOffPlanV2,
    target: 'committed' | 'pending',
): MekUnitRuntimeState | null {
    if (plan.kind === 'absorbed') {
        const slot = unit.index.slots.get(plan.slotId);
        if (!slot) throw new Error(`Unknown critical slot ${plan.slotId}`);
        return target === 'pending'
            ? withPending(state, 'criticalHits', plan.slotId, 1)
            : withCriticalHits(state, slot, 1);
    }
    return target === 'pending'
        ? withPendingLocationCondition(state, plan.locationId, 'blown-off', 1)
        : withLocationCondition(state, plan.locationId, 'blown-off', 1);
}

function applyMekCriticalRollPlan(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    plan: Extract<MekCriticalRollPlanV2, { readonly kind: 'applied' }>,
    target: 'committed' | 'pending',
    applyExplosion: boolean,
    applyPilotHits: boolean,
    settlePendingExplosion: boolean,
    statusTopology: RuntimeEquipmentStatusTopology,
): MekUnitRuntimeState {
    const slot = unit.index.slots.get(plan.slotId);
    if (!slot) throw new Error(`Unknown critical slot ${plan.slotId}`);
    let next = target === 'pending'
        ? withPending(state, 'criticalHits', plan.slotId, 1)
        : withCriticalHits(state, slot, 1);
    if (!applyExplosion) {
        if (plan.explosion || plan.pendingExplosion) {
            for (const componentId of slot.componentIds) {
                next = clearDestroyedComponentLifecycle(next, componentId);
            }
        }
        return next;
    }
    if (plan.explosion) {
        return applyMekEquipmentExplosionPlan(unit, next, plan.explosion, target, applyPilotHits);
    }
    if (plan.pendingExplosion && settlePendingExplosion) {
        const pending = projectPendingMekCriticalExplosionV2(
            unit.entity,
            unit.index,
            unit.ruleset,
            criticalRuntimeView(unit, next, statusTopology),
            new Set<string>(),
        );
        return pending
            ? applyMekEquipmentExplosionPlan(unit, next, pending.explosion, target, applyPilotHits)
            : next;
    }
    return next;
}

function applyMekEquipmentExplosionPlan(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    explosion: MekEquipmentExplosionPlanV2,
    target: 'committed' | 'pending',
    applyPilotHits = true,
): MekUnitRuntimeState {
    let next = state;
    for (const componentId of explosion.destroyComponentIds) {
        next = destroyComponentForCriticalExplosion(unit, next, componentId, target);
    }
    for (const damage of explosion.locations) {
        if (damage.armorFaceId !== undefined && damage.armorDamage > 0) {
            next = target === 'pending'
                ? withPending(next, 'armorDamage', damage.armorFaceId, damage.armorDamage)
                : withLocationArmorDamage(next, damage.locationId, damage.armorFaceId, damage.armorDamage);
        }
        if (damage.internalDamage > 0) {
            next = target === 'pending'
                ? withPending(next, 'locationInternalDamage', damage.locationId, damage.internalDamage)
                : withLocationInternalDamage(next, damage.locationId, damage.internalDamage);
        }
    }
    if (applyPilotHits && explosion.pilotHits > 0) {
        const pilot = [...unit.index.crewPositions.values()]
            .sort((left, right) => left.occurrence - right.occurrence)[0];
        if (pilot) {
            const current = next.crew.get(pilot.id) ?? HEALTHY_CREW_STATE;
            next = withCrewState(
                next,
                pilot.id,
                Math.min(MAX_MEK_CREW_WOUNDS, current.wounds + explosion.pilotHits),
                current.unconscious,
                current.ejected,
            ) ?? next;
        }
    }
    if (explosion.automaticCritical) {
        const slot = unit.index.slots.get(explosion.automaticCritical.slotId);
        if (!slot) throw new Error(`Unknown critical slot ${explosion.automaticCritical.slotId}`);
        next = target === 'pending'
            ? withPending(
                next,
                'criticalHits',
                explosion.automaticCritical.slotId,
                explosion.automaticCritical.hits,
            )
            : withCriticalHits(
                next,
                slot,
                explosion.automaticCritical.hits,
            );
    }
    return target === 'committed'
        ? clearNarcFromCommittedPhysicallyDestroyedLocations(unit, next)
        : next;
}

function destroyComponentForCriticalExplosion(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    componentId: ComponentId,
    target: 'committed' | 'pending',
): MekUnitRuntimeState {
    const slots = [...unit.index.slots.values()].filter(slot => slot.componentIds.includes(componentId));
    let next = state;
    if (slots.length === 0) {
        return target === 'pending'
            ? withPendingComponentStatus(next, componentId, 'destroyed') ?? next
            : withComponentStatus(next, componentId, 'destroyed') ?? next;
    }
    for (const slot of slots) {
        const perspective = target === 'pending' ? 'preview' : 'committed';
        const remaining = mekCriticalSlotDirectHitThreshold(slot) - criticalHits(next, slot.id, perspective);
        if (remaining <= 0) continue;
        next = target === 'pending'
            ? withPending(next, 'criticalHits', slot.id, remaining)
            : withCriticalHits(next, slot, remaining);
    }
    return clearDestroyedComponentLifecycle(next, componentId);
}

function clearDestroyedComponentLifecycle(
    state: MekUnitRuntimeState,
    componentId: ComponentId,
): MekUnitRuntimeState {
    const current = state.components.get(componentId);
    if (!current?.ppcCapacitor && !current?.bombastLaser) return state;
    const { ppcCapacitor: _ppc, bombastLaser: _bombast, ...remaining } = current;
    const components = new Map(state.components);
    if (componentStateEmpty(remaining)) components.delete(componentId);
    else components.set(componentId, Object.freeze(remaining));
    return { ...state, components: new ImmutableIndex(components) };
}

function emptyLocationRuntimeState(): LocationRuntimeState {
    return Object.freeze({
        internalDamage: 0,
        armorDamage: Object.freeze([]),
        conditions: new ImmutableIndex<MekLocationConditionKey, number>([]),
    });
}

function withCriticalHits(
    state: MekUnitRuntimeState,
    slot: MekIndexedCriticalSlot,
    hits: number,
): MekUnitRuntimeState {
    const slots = new Map(state.slots);
    const current = slots.get(slot.id);
    const threshold = mekCriticalSlotDirectHitThreshold(slot);
    const nextHits = (current?.hits ?? 0) + hits;
    if (nextHits === 0) slots.delete(slot.id);
    else {
        const wasUnavailable = (current?.hits ?? 0) >= threshold;
        const destroyedTurn = nextHits < threshold
            ? undefined
            : wasUnavailable
                ? current?.destroyedTurn
                : state.turn.turnCounter || undefined;
        slots.set(slot.id, Object.freeze({
            hits: nextHits,
            ...(destroyedTurn === undefined ? {} : { destroyedTurn }),
        }));
    }
    return { ...state, slots: new ImmutableIndex(slots) };
}

function withComponentStatus(
    state: MekUnitRuntimeState,
    componentId: ComponentId,
    status: EquipmentStatus,
): MekUnitRuntimeState | null {
    const components = new Map(state.components);
    const current = components.get(componentId) ?? {};
    const existing = current.statusOverride ?? 'available';
    if (existing === status) return null;
    if (status === 'available') {
        const { statusOverride: _removed, ...remaining } = current;
        if (Object.keys(remaining).length === 0) components.delete(componentId);
        else components.set(componentId, Object.freeze(remaining));
    } else {
        components.set(componentId, Object.freeze({ ...current, statusOverride: status }));
    }
    return { ...state, components: new ImmutableIndex(components) };
}

function withComponentMode(
    state: MekUnitRuntimeState,
    componentId: ComponentId,
    mode: string,
    defaultMode: string | undefined,
): MekUnitRuntimeState | null {
    const components = new Map(state.components);
    const current = components.get(componentId) ?? {};
    const existing = current.mode ?? defaultMode;
    if (existing === mode) return null;
    if (mode === defaultMode) {
        const { mode: _removed, ...remaining } = current;
        if (Object.keys(remaining).length === 0) components.delete(componentId);
        else components.set(componentId, Object.freeze(remaining));
    } else {
        components.set(componentId, Object.freeze({ ...current, mode }));
    }
    return { ...state, components: new ImmutableIndex(components) };
}

type ElectronicModeReduction =
    | Readonly<{ readonly kind: 'not-electronic' }>
    | Readonly<{ readonly kind: 'invalid' }>
    | Readonly<{ readonly kind: 'handled'; readonly state: MekUnitRuntimeState | null }>;

function reduceMobileHpgMode(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    statusTopology: RuntimeEquipmentStatusTopology,
    componentId: ComponentId,
    requestedMode: string,
): MekUnitRuntimeState | null | 'invalid' {
    const equipment = equipmentForComponent(unit.index, componentId);
    if (!isMobileHpgEquipment(equipment) || !isMobileHpgMode(requestedMode)) return 'invalid';
    const fact = buildMekMobileHpgFacts(unit, state, statusTopology, 'committed')
        .find(candidate => candidate.componentId === componentId);
    if (!fact?.operational) return 'invalid';
    const movement = state.movementPsr.movement;
    const reason = mobileHpgModeChangeReason(equipment, fact.mode, requestedMode, {
        fusionEngine: unit.entity.mountedEngine().isFusion,
        selectedWeaponAttack: [...state.attackerTargeting.components.values()]
            .some(component => component.selection !== undefined),
        movementMode: movement?.mode ?? 'stationary',
        movementDistance: movement?.distance ?? 0,
    });
    if (reason !== null) return 'invalid';
    const changed = withComponentMode(state, componentId, requestedMode, HPG_IDLE_MODE);
    return changed === null ? null : {
        ...changed,
        turn: canonicalizeMekTurnStateV2({ ...changed.turn, equipmentStateChanged: true }),
    };
}

function buildMekMobileHpgFacts(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    statusTopology: RuntimeEquipmentStatusTopology,
    perspective: StatePerspective,
): readonly MobileHpgComponentFact[] {
    const status = new RuntimeEquipmentStatusKernel(
        statusTopology,
        statusState(unit, state, perspective),
        { rules: unit.ruleset, family: 'mek' },
    );
    const unavailable = state.destroyed || state.conditions.has('shutdown');
    return Object.freeze([...unit.index.components].flatMap(([componentId, component]) => {
        const equipment = component.kind === 'equipment' ? component.mount.equipment : undefined;
        if (!equipment || !isMobileHpgEquipment(equipment)) return [];
        return [Object.freeze({
            componentId,
            equipment,
            mode: state.components.get(componentId)?.mode,
            operational: !unavailable && status.component(componentId).status === 'available',
        })];
    }));
}

function settleMobileHpgs(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
): MekUnitRuntimeState {
    let settled = state;
    for (const [componentId, component] of unit.index.components) {
        if (component.kind !== 'equipment' || !isMobileHpgEquipment(component.mount.equipment)) continue;
        const current = settled.components.get(componentId)?.mode;
        const mode = settleMobileHpgMode(
            component.mount.equipment,
            current,
            unit.entity.weightClass() === 'Large Support',
        );
        if (mode === mobileHpgMode(current)) continue;
        settled = withComponentMode(settled, componentId, mode, HPG_IDLE_MODE) ?? settled;
    }
    return settled;
}

function reduceElectronicComponentMode(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    statusTopology: RuntimeEquipmentStatusTopology,
    componentId: ComponentId,
    requestedMode: string,
): ElectronicModeReduction {
    const equipment = equipmentForComponent(unit.index, componentId);
    if (!equipment) return Object.freeze({ kind: 'not-electronic' });
    const plan = planElectronicModeRequest(
        buildMekElectronicFacts(unit, state, statusTopology, 'committed'),
        componentId,
        requestedMode,
    );
    if (plan.kind === 'not-electronic') return Object.freeze({ kind: 'not-electronic' });
    if (plan.kind === 'invalid') return Object.freeze({ kind: 'invalid' });
    if (plan.kind === 'unchanged') return Object.freeze({ kind: 'handled', state: null });
    let next = state;
    for (const update of plan.updates) {
        const defaultMode = mekComponentModes(
            unit.entity,
            unit.index,
            update.componentId,
            unit.ruleset,
        ).defaultMode;
        next = withComponentMode(next, update.componentId, update.mode, defaultMode) ?? next;
    }
    if (next === state) return Object.freeze({ kind: 'handled', state: null });
    return Object.freeze({
        kind: 'handled',
        state: {
            ...next,
            turn: canonicalizeMekTurnStateV2({ ...next.turn, equipmentStateChanged: true }),
        },
    });
}

function buildMekElectronicFacts(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    statusTopology: RuntimeEquipmentStatusTopology,
    perspective: StatePerspective,
): readonly ElectronicComponentFact[] {
    const status = new RuntimeEquipmentStatusKernel(
        statusTopology,
        statusState(unit, state, perspective),
        { rules: unit.ruleset, family: 'mek' },
    );
    const unavailable = state.destroyed || state.conditions.has('shutdown');
    return Object.freeze([...unit.index.components].flatMap(([componentId, component]) => {
        if (component.kind !== 'equipment' || !component.mount.equipment) return [];
        const equipment = component.mount.equipment;
        const claims = electronicClaims(equipment);
        if (!claims.ecm && !claims.probe && !isPowerControlledEquipment(equipment)) return [];
        return [Object.freeze({
            componentId,
            equipment,
            mode: state.components.get(componentId)?.mode,
            operational: !unavailable && status.component(componentId).status === 'available',
        })];
    }));
}

function settleElectronicSuites(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    statusTopology: RuntimeEquipmentStatusTopology,
): MekUnitRuntimeState {
    let settled = state;
    const updates = planElectronicSettlement(
        buildMekElectronicFacts(unit, state, statusTopology, 'committed'),
    );
    for (const update of updates) {
        const defaultMode = mekComponentModes(
            unit.entity,
            unit.index,
            update.componentId,
            unit.ruleset,
        ).defaultMode;
        settled = withComponentMode(
            settled,
            update.componentId,
            update.mode,
            defaultMode,
        ) ?? settled;
    }
    return settled;
}

function componentStealthState(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    componentId: ComponentId,
): StealthState {
    const equipment = equipmentForComponent(unit.index, componentId);
    if (!equipment || !isStealthSystemEquipment(equipment)) {
        throw new Error(`Component ${componentId} is not a stealth system`);
    }
    const rawMode = state.components.get(componentId)?.mode
        ?? mekComponentModes(unit.entity, unit.index, componentId, unit.ruleset).defaultMode;
    return stealthStateForMode(equipment, rawMode);
}

function withStealthState(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    componentId: ComponentId,
    stealth: StealthState,
    markEquipmentStateChanged = false,
): MekUnitRuntimeState | null {
    const equipment = equipmentForComponent(unit.index, componentId);
    if (!equipment || !isSwitchableStealthEquipment(equipment)) return null;
    const modes = mekComponentModes(unit.entity, unit.index, componentId, unit.ruleset);
    const enabled = modes.modes.find(mode => mode.toLowerCase() === 'on');
    const disabled = modes.modes.find(mode => mode.toLowerCase() === 'off');
    if (!enabled || !disabled) return null;
    const mode = stealth === 'enabling' ? STEALTH_ENABLING_MODE
        : stealth === 'disabling' ? STEALTH_DISABLING_MODE
            : stealth === 'enabled' ? enabled : disabled;
    const changed = withComponentMode(state, componentId, mode, modes.defaultMode);
    if (!changed || !markEquipmentStateChanged) return changed;
    return {
        ...changed,
        turn: canonicalizeMekTurnStateV2({ ...changed.turn, equipmentStateChanged: true }),
    };
}

function gaussPowerState(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    componentId: ComponentId,
): MekGaussPowerState {
    const equipment = equipmentForComponent(unit.index, componentId);
    if (!unit.index.components.has(componentId)) throw new Error(`Unknown component ${componentId}`);
    if (!isGaussEquipment(equipment)) return GAUSS_POWERED_UP;
    return state.components.get(componentId)?.gaussPower ?? GAUSS_POWERED_UP;
}

function withGaussPowerState(
    state: MekUnitRuntimeState,
    componentId: ComponentId,
    gaussPower: MekGaussPowerState,
    markEquipmentStateChanged = false,
): MekUnitRuntimeState | null {
    const components = new Map(state.components);
    const current = components.get(componentId) ?? {};
    const existing = current.gaussPower ?? GAUSS_POWERED_UP;
    if (existing === gaussPower) return null;
    const { gaussPower: _removed, ...remaining } = current;
    const next: ComponentRuntimeState = Object.freeze({
        ...remaining,
        ...(gaussPower === GAUSS_POWERED_UP ? {} : { gaussPower }),
    });
    if (componentStateEmpty(next)) components.delete(componentId);
    else components.set(componentId, next);
    return {
        ...state,
        components: new ImmutableIndex(components),
        turn: markEquipmentStateChanged
            ? canonicalizeMekTurnStateV2({ ...state.turn, equipmentStateChanged: true })
            : state.turn,
    };
}

function settleGaussPower(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
): MekUnitRuntimeState {
    let settled = state;
    for (const [componentId, definition] of unit.index.components) {
        if (definition.kind !== 'equipment'
            || !isGaussEquipment(definition.mount.equipment)) continue;
        const current = gaussPowerState(unit, settled, componentId);
        const next = settledGaussPowerState(current);
        if (next !== current) settled = withGaussPowerState(settled, componentId, next) ?? settled;
    }
    return settled;
}

function withComponentJammed(
    state: MekUnitRuntimeState,
    componentId: ComponentId,
    jammed: boolean,
): MekUnitRuntimeState | null {
    const components = new Map(state.components);
    const current = components.get(componentId) ?? {};
    const existing = current.jammed ?? false;
    if (existing === jammed) return null;
    if (!jammed) {
        const { jammed: _removed, ...remaining } = current;
        if (Object.keys(remaining).length === 0) components.delete(componentId);
        else components.set(componentId, Object.freeze(remaining));
    } else {
        components.set(componentId, Object.freeze({ ...current, jammed: true }));
    }
    return { ...state, components: new ImmutableIndex(components) };
}

function withEscalatingFailureSelection(
    state: MekUnitRuntimeState,
    componentId: ComponentId,
    index: number,
    sequenceLength: number,
): MekUnitRuntimeState | null {
    const components = selectEscalatingFailureComponentState(
        state.components,
        componentId,
        index,
        sequenceLength,
    );
    return components === null ? null : { ...state, components };
}

function withEscalatingFailureStatus(
    state: MekUnitRuntimeState,
    componentId: ComponentId,
    status: 'available' | 'disabled',
): MekUnitRuntimeState | null {
    const components = setEscalatingFailureComponentStatus(
        state.components,
        componentId,
        status,
    );
    return components === null ? null : { ...state, components };
}

function settleEscalatingFailures(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
): MekUnitRuntimeState {
    let settled = state;
    for (const [componentId, definition] of unit.index.components) {
        if (definition.kind !== 'equipment') continue;
        const failure = escalatingFailureDefinition(unit, componentId);
        if (!failure) continue;
        const component = settled.components.get(componentId);
        const lifecycle = component?.escalatingFailure;
        if (!lifecycle || component.statusOverride === 'disabled') continue;
        if (!lifecycle.active && !failure.recoversWhenUnused) continue;
        const components = settleEscalatingFailureComponentState(settled.components, failure);
        if (components !== null) settled = { ...settled, components };
    }
    return settled;
}

interface PpcCapacitorPair {
    readonly capacitorId: ComponentId;
    readonly weaponId: ComponentId;
}

function withPpcCapacitorState(
    state: MekUnitRuntimeState,
    pair: PpcCapacitorPair,
    chargeState?: PpcCapacitorRuntimeState['chargeState'],
    firedThisTurn?: true,
    markEquipmentStateChanged = false,
): MekUnitRuntimeState | null {
    const components = new Map(state.components);
    const current = components.get(pair.capacitorId) ?? {};
    const currentPpc = current.ppcCapacitor;
    const nextPpc = chargeState === undefined && firedThisTurn === undefined
        ? undefined
        : Object.freeze({
            weaponId: pair.weaponId,
            ...(chargeState === undefined ? {} : { chargeState }),
            ...(firedThisTurn === undefined ? {} : { firedThisTurn }),
        });
    if (currentPpc?.weaponId === nextPpc?.weaponId
        && currentPpc?.chargeState === nextPpc?.chargeState
        && currentPpc?.firedThisTurn === nextPpc?.firedThisTurn) return null;

    const { ppcCapacitor: _removed, ...remaining } = current;
    const next: ComponentRuntimeState = Object.freeze({
        ...remaining,
        ...(nextPpc === undefined ? {} : { ppcCapacitor: nextPpc }),
    });
    if (componentStateEmpty(next)) components.delete(pair.capacitorId);
    else components.set(pair.capacitorId, next);
    return {
        ...state,
        components: new ImmutableIndex(components),
        turn: markEquipmentStateChanged
            ? canonicalizeMekTurnStateV2({ ...state.turn, equipmentStateChanged: true })
            : state.turn,
    };
}

function settlePpcCapacitorPair(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    pair: PpcCapacitorPair,
): MekUnitRuntimeState | null {
    const lifecycle = state.components.get(pair.capacitorId)?.ppcCapacitor;
    if (!lifecycle || lifecycle.weaponId !== pair.weaponId) return null;
    const usable = componentRuntimeStatus(unit, state, pair.capacitorId, 'preview') === 'available'
        && componentRuntimeStatus(unit, state, pair.weaponId, 'preview') === 'available';
    const chargeState = usable && lifecycle.chargeState === PPC_CAPACITOR_CHARGING_STATE
        ? PPC_CAPACITOR_CHARGED_STATE
        : usable ? lifecycle.chargeState : undefined;
    return withPpcCapacitorState(state, pair, chargeState);
}

function settlePpcCapacitors(
    unit: MekRuntimeSource,
    entity: MekEntity,
    index: MekRuntimeIndex,
    state: MekUnitRuntimeState,
): MekUnitRuntimeState {
    let settled = state;
    for (const pair of ppcCapacitorPairs(entity, index)) {
        settled = settlePpcCapacitorPair(unit, settled, pair) ?? settled;
    }
    return settled;
}

function expandPendingPpcCapacitorExplosions(
    unit: MekRuntimeSource,
    entity: MekEntity,
    index: MekRuntimeIndex,
    state: MekUnitRuntimeState,
    only?: PpcCapacitorPair,
): MekUnitRuntimeState | null {
    let expanded = state;
    let changed = false;
    const pairs = only ? [only] : ppcCapacitorPairs(entity, index);
    for (const pair of pairs) {
        const lifecycle = expanded.components.get(pair.capacitorId)?.ppcCapacitor;
        if (!lifecycle?.chargeState || lifecycle.weaponId !== pair.weaponId
            || componentRuntimeStatus(unit, expanded, pair.capacitorId) === 'destroyed'
            || componentRuntimeStatus(unit, expanded, pair.weaponId) === 'destroyed'
            || !hasPendingDirectPpcHit(unit, expanded, pair)) continue;

        const pendingCritical = new Map(expanded.pendingCombat.criticalHits);
        const pendingComponents = new Map(expanded.pendingCombat.componentStatus);
        for (const componentId of [pair.weaponId, pair.capacitorId]) {
            const slots = componentSlots(unit, componentId);
            if (slots.length === 0) pendingComponents.set(componentId, 'destroyed');
            for (const slot of slots) {
                const committed = expanded.slots.get(slot.id)?.hits ?? 0;
                const remaining = mekCriticalSlotDirectHitThreshold(slot) - committed;
                if (remaining > 0) pendingCritical.set(slot.id, remaining);
                else pendingCritical.delete(slot.id);
            }
        }
        expanded = {
            ...expanded,
            pendingCombat: Object.freeze({
                ...expanded.pendingCombat,
                criticalHits: new ImmutableIndex(pendingCritical),
                componentStatus: new ImmutableIndex(pendingComponents),
            }),
        };
        expanded = withPpcCapacitorState(expanded, pair) ?? expanded;
        changed = true;
    }
    return changed ? expanded : null;
}

function explodeCommittedPpcCapacitorPairs(
    unit: MekRuntimeSource,
    entity: MekEntity,
    index: MekRuntimeIndex,
    before: MekUnitRuntimeState,
    after: MekUnitRuntimeState,
    directHitComponentIds: ReadonlySet<ComponentId>,
): MekUnitRuntimeState {
    let exploded = after;
    const pendingCritical = new Map(after.pendingCombat.criticalHits);
    const pendingComponents = new Map(after.pendingCombat.componentStatus);
    let pendingRebased = false;
    for (const pair of ppcCapacitorPairs(entity, index)) {
        if (!directHitComponentIds.has(pair.capacitorId) && !directHitComponentIds.has(pair.weaponId)) continue;
        const lifecycle = before.components.get(pair.capacitorId)?.ppcCapacitor;
        if (!lifecycle?.chargeState || lifecycle.weaponId !== pair.weaponId
            || componentRuntimeStatus(unit, before, pair.capacitorId) === 'destroyed'
            || componentRuntimeStatus(unit, before, pair.weaponId) === 'destroyed') continue;
        for (const componentId of [pair.weaponId, pair.capacitorId]) {
            const slots = componentSlots(unit, componentId);
            if (slots.length === 0) {
                exploded = withComponentStatus(exploded, componentId, 'destroyed') ?? exploded;
                if (pendingComponents.get(componentId) === 'destroyed') {
                    pendingComponents.delete(componentId);
                    pendingRebased = true;
                }
            }
            for (const slot of slots) {
                const capacity = mekCriticalSlotDirectHitThreshold(slot);
                const current = exploded.slots.get(slot.id)?.hits ?? 0;
                if (current < capacity) exploded = withCriticalHits(exploded, slot, capacity - current);
                const pending = pendingCritical.get(slot.id);
                if (pending !== undefined && pending > 0) {
                    pendingCritical.delete(slot.id);
                    pendingRebased = true;
                }
            }
        }
        exploded = withPpcCapacitorState(exploded, pair) ?? exploded;
    }
    return !pendingRebased ? exploded : {
        ...exploded,
        pendingCombat: Object.freeze({
            ...exploded.pendingCombat,
            criticalHits: new ImmutableIndex(pendingCritical),
            componentStatus: new ImmutableIndex(pendingComponents),
        }),
    };
}

function hasPendingDirectPpcHit(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    pair: PpcCapacitorPair,
): boolean {
    if ([pair.capacitorId, pair.weaponId].some(componentId =>
        state.pendingCombat.componentStatus.get(componentId) === 'destroyed')) return true;
    return [pair.capacitorId, pair.weaponId].some(componentId =>
        componentSlots(unit, componentId).some(slot => {
            const delta = state.pendingCombat.criticalHits.get(slot.id) ?? 0;
            const committed = state.slots.get(slot.id)?.hits ?? 0;
            return delta > 0 && committed + delta >= mekCriticalSlotDirectHitThreshold(slot);
        }));
}

function ppcCapacitorPairs(entity: MekEntity, index: MekRuntimeIndex): readonly PpcCapacitorPair[] {
    return [...index.relationships.linkedTargetBySource.keys()].flatMap(capacitorId => {
        const weaponId = ppcCapacitorWeaponId(entity, index, capacitorId);
        return weaponId === undefined ? [] : [Object.freeze({ capacitorId, weaponId })];
    });
}

function componentSlots(unit: MekRuntimeSource, componentId: ComponentId) {
    return [...unit.index.slots.values()].filter(slot => slot.componentIds.includes(componentId));
}

function withBombastLaserState(
    state: MekUnitRuntimeState,
    componentId: ComponentId,
    chargeState?: BombastLaserRuntimeState['chargeState'],
    firedThisTurn?: true,
    markEquipmentStateChanged = false,
): MekUnitRuntimeState | null {
    const components = new Map(state.components);
    const current = components.get(componentId) ?? {};
    const currentBombast = current.bombastLaser;
    const nextBombast = chargeState === undefined && firedThisTurn === undefined
        ? undefined
        : Object.freeze({
            ...(chargeState === undefined ? {} : { chargeState }),
            ...(firedThisTurn === undefined ? {} : { firedThisTurn }),
        });
    if (currentBombast?.chargeState === nextBombast?.chargeState
        && currentBombast?.firedThisTurn === nextBombast?.firedThisTurn) return null;
    const { bombastLaser: _removed, ...remaining } = current;
    const next: ComponentRuntimeState = Object.freeze({
        ...remaining,
        ...(nextBombast === undefined ? {} : { bombastLaser: nextBombast }),
    });
    if (componentStateEmpty(next)) components.delete(componentId);
    else components.set(componentId, next);
    return {
        ...state,
        components: new ImmutableIndex(components),
        turn: markEquipmentStateChanged
            ? canonicalizeMekTurnStateV2({ ...state.turn, equipmentStateChanged: true })
            : state.turn,
    };
}

function settleBombastLaser(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    componentId: ComponentId,
): MekUnitRuntimeState | null {
    const lifecycle = state.components.get(componentId)?.bombastLaser;
    if (!lifecycle) return null;
    if (lifecycle.firedThisTurn === true
        || componentRuntimeStatus(unit, state, componentId, 'preview') !== 'available') {
        return withBombastLaserState(state, componentId);
    }
    return withBombastLaserState(
        state,
        componentId,
        lifecycle.chargeState === BOMBAST_LASER_CHARGING_STATE
            ? BOMBAST_LASER_CHARGED_STATE
            : lifecycle.chargeState,
    );
}

function settleBombastLasers(
    unit: MekRuntimeSource,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    state: MekUnitRuntimeState,
): MekUnitRuntimeState {
    let settled = state;
    for (const componentId of index.components.keys()) {
        if (!isCoreBombastLaserComponent(index, componentId, ruleset)) continue;
        settled = settleBombastLaser(unit, settled, componentId) ?? settled;
    }
    return settled;
}

function withC3EmergencyMasterState(
    state: MekUnitRuntimeState,
    componentId: ComponentId,
    lifecycle?: C3EmergencyMasterRuntimeState,
): MekUnitRuntimeState | null {
    const components = new Map(state.components);
    const current = components.get(componentId) ?? {};
    const nextLifecycle = lifecycle?.mode === undefined && lifecycle?.operatingTurns === undefined
        ? undefined
        : Object.freeze({ ...lifecycle });
    const { c3EmergencyMaster: _removed, ...remaining } = current;
    const next: ComponentRuntimeState = Object.freeze({
        ...remaining,
        ...(nextLifecycle === undefined ? {} : { c3EmergencyMaster: nextLifecycle }),
    });
    if (componentStatesEqual(current, next)) return null;
    if (componentStateEmpty(next)) components.delete(componentId);
    else components.set(componentId, next);
    return { ...state, components: new ImmutableIndex(components) };
}

function componentStateEmpty(state: ComponentRuntimeState): boolean {
    return state.statusOverride === undefined
        && state.mode === undefined
        && state.jammed === undefined
        && state.escalatingFailure === undefined
        && state.ppcCapacitor === undefined
        && state.bombastLaser === undefined
        && state.c3EmergencyMaster === undefined
        && state.gaussPower === undefined
        && state.shieldDamage === undefined
        && state.modularArmorDamage === undefined;
}

function componentStatesEqual(left: ComponentRuntimeState, right: ComponentRuntimeState): boolean {
    return left.statusOverride === right.statusOverride
        && left.mode === right.mode
        && left.jammed === right.jammed
        && left.escalatingFailure?.sequence === right.escalatingFailure?.sequence
        && left.escalatingFailure?.active === right.escalatingFailure?.active
        && left.ppcCapacitor?.weaponId === right.ppcCapacitor?.weaponId
        && left.ppcCapacitor?.chargeState === right.ppcCapacitor?.chargeState
        && left.ppcCapacitor?.firedThisTurn === right.ppcCapacitor?.firedThisTurn
        && left.bombastLaser?.chargeState === right.bombastLaser?.chargeState
        && left.bombastLaser?.firedThisTurn === right.bombastLaser?.firedThisTurn
        && left.c3EmergencyMaster?.mode === right.c3EmergencyMaster?.mode
        && left.c3EmergencyMaster?.operatingTurns === right.c3EmergencyMaster?.operatingTurns
        && left.gaussPower === right.gaussPower
        && left.shieldDamage?.absorptionDamage === right.shieldDamage?.absorptionDamage
        && left.shieldDamage?.capacityDamage === right.shieldDamage?.capacityDamage
        && left.modularArmorDamage === right.modularArmorDamage;
}

function withAmmoSpent(
    state: MekUnitRuntimeState,
    componentId: ComponentId,
    amount: number,
): MekUnitRuntimeState {
    const ammo = new Map(state.ammo);
    const current = ammo.get(componentId);
    ammo.set(componentId, Object.freeze({
        ...current,
        shotsSpent: (current?.shotsSpent ?? 0) + amount,
    }));
    return { ...state, ammo: new ImmutableIndex(ammo) };
}

function withAmmoConfiguration(
    state: MekUnitRuntimeState,
    unit: MekRuntimeSource,
    componentId: ComponentId,
    munitionKey: string,
    shotsSpent: number,
): MekUnitRuntimeState | null {
    const defaultKey = mekAmmoDefaultMunitionKey(unit.entity, unit.index, componentId);
    if (defaultKey === null) return null;
    const next: AmmoRuntimeState = Object.freeze({
        shotsSpent,
        ...(munitionKey === defaultKey ? {} : { munitionOverride: munitionKey }),
    });
    const current = state.ammo.get(componentId);
    if ((current?.shotsSpent ?? 0) === next.shotsSpent
        && current?.munitionOverride === next.munitionOverride) return null;
    const ammo = new Map(state.ammo);
    if (next.shotsSpent === 0 && next.munitionOverride === undefined) ammo.delete(componentId);
    else ammo.set(componentId, next);
    return { ...state, ammo: new ImmutableIndex(ammo) };
}

const HEALTHY_CREW_STATE: CrewRuntimeState = Object.freeze({ wounds: 0, unconscious: false, ejected: false });

function withCrewState(
    state: MekUnitRuntimeState,
    positionId: CrewPositionId,
    wounds: number,
    unconscious: boolean,
    ejected: boolean,
): MekUnitRuntimeState | null {
    const current = state.crew.get(positionId) ?? HEALTHY_CREW_STATE;
    if (current.wounds === wounds && current.unconscious === unconscious && current.ejected === ejected) return null;
    const crew = new Map(state.crew);
    if (wounds === 0 && !unconscious && !ejected) crew.delete(positionId);
    else crew.set(positionId, Object.freeze({ wounds, unconscious, ejected }));
    return { ...state, crew: new ImmutableIndex(crew) };
}

function withPending<K extends 'armorDamage' | 'locationInternalDamage' | 'criticalHits'>(
    state: MekUnitRuntimeState,
    field: K,
    id: K extends 'armorDamage' ? ArmorFaceId : K extends 'criticalHits' ? CriticalSlotId : LocationId,
    amount: number,
): MekUnitRuntimeState {
    const values = new Map(state.pendingCombat[field] as ReadonlyMap<typeof id, number>);
    const next = (values.get(id) ?? 0) + amount;
    if (next === 0) values.delete(id);
    else values.set(id, next);
    return {
        ...state,
        pendingCombat: Object.freeze({ ...state.pendingCombat, [field]: new ImmutableIndex(values) }),
    };
}

function withPendingComponentStatus(
    state: MekUnitRuntimeState,
    componentId: ComponentId,
    status: EquipmentStatus,
): MekUnitRuntimeState | null {
    const values = new Map(state.pendingCombat.componentStatus);
    const existing = values.has(componentId)
        ? values.get(componentId)!
        : state.components.get(componentId)?.statusOverride ?? 'available';
    if (existing === status) return null;
    const committed = state.components.get(componentId)?.statusOverride ?? 'available';
    if (status === committed) values.delete(componentId);
    else values.set(componentId, status);
    return {
        ...state,
        pendingCombat: Object.freeze({ ...state.pendingCombat, componentStatus: new ImmutableIndex(values) }),
    };
}

function commitPending(
    unit: MekRuntimeSource,
    entity: MekEntity,
    index: MekRuntimeIndex,
    state: MekUnitRuntimeState,
): MekUnitRuntimeState | null {
    if (!hasPending(state.pendingCombat)) return null;
    const exploded = applyPendingMekCriticalExplosions(unit, entity, index, state) ?? state;
    const expanded = expandPendingPpcCapacitorExplosions(unit, entity, index, exploded) ?? exploded;
    let result = expanded;
    for (const [faceId, amount] of expanded.pendingCombat.armorDamage) {
        const locationId = unit.index.armorFaces.get(faceId)?.locationId;
        if (!locationId) throw new Error(`Pending armor face disappeared from the baseline: ${faceId}`);
        result = withLocationArmorDamage(result, locationId, faceId, amount);
    }
    for (const [locationId, amount] of expanded.pendingCombat.locationInternalDamage) {
        result = withLocationInternalDamage(result, locationId, amount);
    }
    for (const [slotId, hits] of expanded.pendingCombat.criticalHits) {
        const slot = unit.index.slots.get(slotId);
        if (!slot) throw new Error(`Pending critical slot disappeared from the baseline: ${slotId}`);
        result = withCriticalHits(result, slot, hits);
    }
    for (const [componentId, status] of expanded.pendingCombat.componentStatus) {
        result = withComponentStatus(result, componentId, status) ?? result;
    }
    for (const [componentId, damage] of expanded.pendingCombat.shieldDamage) {
        if (damage.absorptionDamage !== 0) {
            result = withShieldDamage(
                result,
                componentId,
                'absorption',
                damage.absorptionDamage,
                'committed',
            );
        }
        if (damage.capacityDamage !== 0) {
            result = withShieldDamage(
                result,
                componentId,
                'capacity',
                damage.capacityDamage,
                'committed',
            );
        }
    }
    for (const [componentId, damage] of expanded.pendingCombat.modularArmorDamage) {
        result = withModularArmorDamage(result, componentId, damage, 'committed');
    }
    for (const [locationId, conditions] of expanded.pendingCombat.locationConditions) {
        for (const [condition, value] of conditions) {
            result = withLocationCondition(result, locationId, condition, value) ?? result;
        }
    }
    result = clearNarcFromCommittedPhysicallyDestroyedLocations(unit, result);
    return { ...result, pendingCombat: emptyPending() };
}

function applyPendingMekCriticalExplosions(
    unit: MekRuntimeSource,
    entity: MekEntity,
    index: MekRuntimeIndex,
    state: MekUnitRuntimeState,
): MekUnitRuntimeState | null {
    let next = state;
    const resolved = new Set<string>();
    const topology = buildStatusTopology(unit);
    while (true) {
        const pending = projectPendingMekCriticalExplosionV2(
            entity,
            index,
            unit.ruleset,
            criticalRuntimeView(unit, next, topology),
            resolved,
        );
        if (!pending) break;
        resolved.add(pending.key);
        next = applyMekEquipmentExplosionPlan(unit, next, pending.explosion, 'pending');
    }
    return next === state ? null : next;
}

function armorDamage(state: MekUnitRuntimeState, faceId: ArmorFaceId, perspective: StatePerspective): number {
    const committed = [...state.locations.values()].flatMap(location => location.armorDamage)
        .find(item => item.faceId === faceId)?.damage ?? 0;
    return committed + (perspective === 'preview' ? state.pendingCombat.armorDamage.get(faceId) ?? 0 : 0);
}

function modularArmorDamage(
    state: MekUnitRuntimeState,
    componentId: ComponentId,
    perspective: StatePerspective,
): number {
    const committed = state.components.get(componentId)?.modularArmorDamage ?? 0;
    return committed + (perspective === 'preview'
        ? state.pendingCombat.modularArmorDamage.get(componentId) ?? 0
        : 0);
}

function modularArmorRemaining(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    componentId: ComponentId,
    perspective: StatePerspective,
): number {
    requireModularArmor(unit, componentId);
    if (componentRuntimeStatus(unit, state, componentId, 'committed') !== 'available') return 0;
    return MODULAR_ARMOR_POINTS_PER_MOUNT - modularArmorDamage(state, componentId, perspective);
}

function requireModularArmor(unit: MekRuntimeSource, componentId: ComponentId): void {
    const equipment = equipmentForComponent(unit.index, componentId);
    if (!isModularArmorEquipment(equipment)) {
        throw new Error(`Unknown Modular Armor component ${componentId}`);
    }
}

function modularArmorComponentsAt(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    locationId: LocationId,
): readonly ComponentId[] {
    const ids = [...unit.index.components]
        .filter(([, component]) => component.kind === 'equipment'
            && isModularArmorEquipment(component.mount.equipment))
        .filter(([componentId]) => [...unit.index.slots.values()].some(slot =>
            slot.locationId === locationId && slot.componentIds.includes(componentId)))
        .map(([componentId]) => componentId)
        .filter(componentId => componentRuntimeStatus(unit, state, componentId, 'committed') === 'available')
        .sort(compareText);
    return Object.freeze(ids);
}

function armorMutationCapacity(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    locationId: LocationId,
    faceId: ArmorFaceId,
    operation: 'damage' | 'repair',
    target: 'committed' | 'pending',
): number {
    const ordinary = ordinaryArmorMutationCapacity(unit, state, faceId, operation, target);
    const modular = modularArmorComponentsAt(unit, state, locationId).reduce((sum, componentId) => {
        const committed = modularArmorDamage(state, componentId, 'committed');
        const preview = modularArmorDamage(state, componentId, 'preview');
        const capacity = operation === 'damage'
            ? target === 'pending'
                ? MODULAR_ARMOR_POINTS_PER_MOUNT - preview
                : Math.min(
                    MODULAR_ARMOR_POINTS_PER_MOUNT - committed,
                    MODULAR_ARMOR_POINTS_PER_MOUNT - preview,
                )
            : target === 'pending' ? preview : Math.min(committed, preview);
        return sum + capacity;
    }, 0);
    return ordinary + modular;
}

function ordinaryArmorMutationCapacity(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    faceId: ArmorFaceId,
    operation: 'damage' | 'repair',
    target: 'committed' | 'pending',
): number {
    const face = unit.index.armorFaces.get(faceId);
    if (!face) return 0;
    const committed = armorDamage(state, faceId, 'committed');
    const preview = armorDamage(state, faceId, 'preview');
    if (operation === 'repair') {
        return target === 'pending' ? preview : Math.min(committed, preview);
    }
    return target === 'pending'
        ? face.maximumPoints - preview
        : Math.min(face.maximumPoints - committed, face.maximumPoints - preview);
}

function applyArmorMutation(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    locationId: LocationId,
    faceId: ArmorFaceId,
    delta: number,
    target: 'committed' | 'pending',
): MekUnitRuntimeState {
    let next = state;
    let remaining = Math.abs(delta);
    const applyOrdinary = (): void => {
        const capacity = ordinaryArmorMutationCapacity(
            unit, next, faceId, delta > 0 ? 'damage' : 'repair', target,
        );
        const amount = Math.min(remaining, capacity);
        if (amount === 0) return;
        next = target === 'pending'
            ? withPending(next, 'armorDamage', faceId, delta > 0 ? amount : -amount)
            : withLocationArmorDamage(next, locationId, faceId, delta > 0 ? amount : -amount);
        remaining -= amount;
    };
    const applyModular = (): void => {
        for (const componentId of modularArmorComponentsAt(unit, next, locationId)) {
            if (remaining === 0) break;
            const committed = modularArmorDamage(next, componentId, 'committed');
            const preview = modularArmorDamage(next, componentId, 'preview');
            const capacity = delta > 0
                ? target === 'pending'
                    ? MODULAR_ARMOR_POINTS_PER_MOUNT - preview
                    : Math.min(
                        MODULAR_ARMOR_POINTS_PER_MOUNT - committed,
                        MODULAR_ARMOR_POINTS_PER_MOUNT - preview,
                    )
                : target === 'pending' ? preview : Math.min(committed, preview);
            const amount = Math.min(remaining, capacity);
            if (amount === 0) continue;
            next = withModularArmorDamage(next, componentId, delta > 0 ? amount : -amount, target);
            remaining -= amount;
        }
    };
    if (delta > 0) {
        applyModular();
        applyOrdinary();
    } else {
        applyOrdinary();
        applyModular();
    }
    if (remaining !== 0) throw new Error('Armor mutation capacity changed during reduction');
    return next;
}

function withModularArmorDamage(
    state: MekUnitRuntimeState,
    componentId: ComponentId,
    delta: number,
    target: 'committed' | 'pending',
): MekUnitRuntimeState {
    if (target === 'pending') {
        const values = new Map(state.pendingCombat.modularArmorDamage);
        const next = (values.get(componentId) ?? 0) + delta;
        if (next === 0) values.delete(componentId);
        else values.set(componentId, next);
        return {
            ...state,
            pendingCombat: Object.freeze({
                ...state.pendingCombat,
                modularArmorDamage: new ImmutableIndex(values),
            }),
        };
    }
    const components = new Map(state.components);
    const current = components.get(componentId) ?? {};
    const nextDamage = (current.modularArmorDamage ?? 0) + delta;
    const { modularArmorDamage: _removed, ...remaining } = current;
    const next: ComponentRuntimeState = Object.freeze({
        ...remaining,
        ...(nextDamage === 0 ? {} : { modularArmorDamage: nextDamage }),
    });
    if (componentStateEmpty(next)) components.delete(componentId);
    else components.set(componentId, next);
    return { ...state, components: new ImmutableIndex(components) };
}

function internalDamage(state: MekUnitRuntimeState, locationId: LocationId, perspective: StatePerspective): number {
    return (state.locations.get(locationId)?.internalDamage ?? 0)
        + (perspective === 'preview' ? state.pendingCombat.locationInternalDamage.get(locationId) ?? 0 : 0);
}

function criticalHits(state: MekUnitRuntimeState, slotId: CriticalSlotId, perspective: StatePerspective): number {
    return (state.slots.get(slotId)?.hits ?? 0)
        + (perspective === 'preview' ? state.pendingCombat.criticalHits.get(slotId) ?? 0 : 0);
}

function shieldDamage(
    state: MekUnitRuntimeState,
    componentId: ComponentId,
    track: MekShieldTrack,
    perspective: StatePerspective,
): number {
    const field = track === 'absorption' ? 'absorptionDamage' : 'capacityDamage';
    const committed = state.components.get(componentId)?.shieldDamage?.[field] ?? 0;
    return committed + (perspective === 'preview'
        ? state.pendingCombat.shieldDamage.get(componentId)?.[field] ?? 0
        : 0);
}

function withShieldDamage(
    state: MekUnitRuntimeState,
    componentId: ComponentId,
    track: MekShieldTrack,
    delta: number,
    target: 'committed' | 'pending',
): MekUnitRuntimeState {
    const field = track === 'absorption' ? 'absorptionDamage' : 'capacityDamage';
    if (target === 'pending') {
        const values = new Map(state.pendingCombat.shieldDamage);
        const current = values.get(componentId) ?? { absorptionDamage: 0, capacityDamage: 0 };
        const next = Object.freeze({ ...current, [field]: current[field] + delta });
        if (next.absorptionDamage === 0 && next.capacityDamage === 0) values.delete(componentId);
        else values.set(componentId, next);
        return {
            ...state,
            pendingCombat: Object.freeze({
                ...state.pendingCombat,
                shieldDamage: new ImmutableIndex(values),
            }),
        };
    }

    const components = new Map(state.components);
    const current = components.get(componentId) ?? {};
    const damage = current.shieldDamage ?? { absorptionDamage: 0, capacityDamage: 0 };
    const nextDamage = Object.freeze({ ...damage, [field]: damage[field] + delta });
    const { shieldDamage: _removed, ...remaining } = current;
    const next: ComponentRuntimeState = Object.freeze({
        ...remaining,
        ...(nextDamage.absorptionDamage === 0 && nextDamage.capacityDamage === 0
            ? {}
            : { shieldDamage: nextDamage }),
    });
    if (componentStateEmpty(next)) components.delete(componentId);
    else components.set(componentId, next);
    return { ...state, components: new ImmutableIndex(components) };
}

function shieldProfile(unit: MekRuntimeSource, componentId: ComponentId) {
    const equipment = equipmentForComponent(unit.index, componentId);
    return equipment && isShieldEquipment(equipment)
        ? resolveShieldProfileFromFlags(equipment.flags)
        : undefined;
}

function requireShieldProfile(unit: MekRuntimeSource, componentId: ComponentId) {
    const profile = shieldProfile(unit, componentId);
    if (!profile) throw new Error(`Unknown shield component ${componentId}`);
    return profile;
}

function isMekShieldTrack(value: unknown): value is MekShieldTrack {
    return value === 'absorption' || value === 'capacity';
}

function locationConditionValue(
    state: MekUnitRuntimeState,
    locationId: LocationId,
    condition: MekLocationConditionKey,
    perspective: StatePerspective,
): number {
    if (perspective === 'preview') {
        const pending = state.pendingCombat.locationConditions.get(locationId);
        if (pending?.has(condition)) return pending.get(condition)!;
    }
    return state.locations.get(locationId)?.conditions.get(condition) ?? 0;
}

function componentRuntimeStatus(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    componentId: ComponentId,
    perspective: StatePerspective = 'committed',
): EquipmentStatus {
    return new RuntimeEquipmentStatusKernel(
        buildStatusTopology(unit),
        statusState(unit, state, perspective),
        { rules: unit.ruleset, family: 'mek' },
    ).component(componentId).status;
}

function statusState(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    perspective: StatePerspective,
): RuntimeEquipmentCommittedState {
    const components = new Map<ComponentId, EquipmentStatus>();
    for (const [id, value] of state.components) components.set(id, value.statusOverride ?? 'available');
    if (perspective === 'preview') {
        for (const [id, status] of state.pendingCombat.componentStatus) components.set(id, status);
    }
    const slots = new Map<CriticalSlotId, { status: EquipmentStatus; hits: number; armored: boolean }>();
    for (const [id, definition] of unit.index.slots) {
        const hits = criticalHits(state, id, perspective);
        if (hits > 0) slots.set(id, {
            status: hits >= mekCriticalSlotDirectHitThreshold(definition) ? 'destroyed' : 'available',
            hits,
            armored: definition.armored,
        });
    }
    const locations = new Map<LocationId, EquipmentStatus>();
    for (const id of unit.index.locations.keys()) {
        const status = runtimeLocationStatus(unit, state, id, perspective);
        if (status !== 'available') locations.set(id, status);
    }
    const engineHit = [...unit.index.slots.values()].some(slot =>
        criticalHits(state, slot.id, perspective) > 0
        && slot.componentIds.some(componentId => {
            const component = unit.index.components.get(componentId);
            return component?.kind === 'system' && component.systemType === 'Engine';
        }));
    return { components, criticalSlots: slots, locations, engineHit };
}

function runtimeLocationStatus(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    locationId: LocationId,
    perspective: StatePerspective,
): EquipmentStatus {
    if (isRuntimeLocationPhysicallyDestroyed(unit, state, locationId, perspective)) return 'destroyed';
    if (locationConditionValue(state, locationId, 'flooded', perspective) > 0) return 'disabled';
    const parentId = mekLocationParentId(unit.index, locationId);
    return parentId === null ? 'available' : runtimeLocationStatus(unit, state, parentId, perspective);
}

function isRuntimeLocationPhysicallyDestroyed(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    locationId: LocationId,
    perspective: StatePerspective,
): boolean {
    return isMekLocationPhysicallyDestroyedFromView(unit.index, locationId, {
        internalDamage: id => internalDamage(state, id, perspective),
        blownOff: id => locationConditionValue(state, id, 'blown-off', perspective) > 0,
    });
}

function clearNarcFromCommittedPhysicallyDestroyedLocations(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
): MekUnitRuntimeState {
    let result = state;
    for (const [locationId, locationState] of state.locations) {
        if ((locationState.conditions.get('narc') ?? 0) <= 0
            || !isMekLocationPhysicallyDestroyed(unit.index, state.locations, locationId)) continue;
        result = withLocationCondition(result, locationId, 'narc', 0) ?? result;
    }
    return result;
}

function buildStatusTopology(unit: MekRuntimeSource): RuntimeEquipmentStatusTopology {
    const components = new Map<string, {
        id: string;
        flags: ReadonlySet<string>;
        locationIds: readonly string[];
        criticalSlotIds: readonly string[];
    }>();
    for (const [id, component] of unit.index.components) {
        components.set(id, {
            id,
            flags: component.kind === 'equipment'
                ? component.mount.equipment?.flags ?? new ImmutableSet([])
                : new ImmutableSet([]),
            locationIds: componentLocationIds(unit.index, id),
            criticalSlotIds: [...unit.index.slots.values()]
                .filter(slot => slot.componentIds.includes(id))
                .map(slot => slot.id),
        });
    }
    return {
        components,
        criticalSlots: new Map([...unit.index.slots].map(([id, slot]) => [id, {
            id,
            componentIds: slot.componentIds,
            locationId: slot.locationId,
        }])),
    };
}

function emptyPending(): PendingCombatOverlay {
    return Object.freeze({
        locationInternalDamage: new ImmutableIndex<LocationId, number>([]),
        armorDamage: new ImmutableIndex<ArmorFaceId, number>([]),
        criticalHits: new ImmutableIndex<CriticalSlotId, number>([]),
        componentStatus: new ImmutableIndex<ComponentId, EquipmentStatus>([]),
        shieldDamage: new ImmutableIndex<ComponentId, MekShieldDamageRuntimeState>([]),
        modularArmorDamage: new ImmutableIndex<ComponentId, number>([]),
        locationConditions: new ImmutableIndex<
            LocationId,
            ReadonlyMap<MekLocationConditionKey, number>
        >([]),
    });
}

function hasPending(pending: PendingCombatOverlay): boolean {
    return pending.locationInternalDamage.size > 0 || pending.armorDamage.size > 0
        || pending.criticalHits.size > 0 || pending.componentStatus.size > 0
        || pending.shieldDamage.size > 0 || pending.modularArmorDamage.size > 0
        || pending.locationConditions.size > 0;
}

function validateState(
    state: MekUnitRuntimeState,
    unit: MekRuntimeSource,
): void {
    const entity = unit.entity;
    const index = unit.index;
    const ruleset = unit.ruleset;
    if (state.schemaVersion !== 7) throw new Error('Unsupported runtime-state schema');
    if (state.family.kind !== 'mek') throw new Error('Unsupported runtime-state family');
    asStateRevision(state.stateRevision);
    if (typeof state.destroyed !== 'boolean') throw new Error('Invalid runtime destroyed state');
    try {
        canonicalizeMekHeatStateV2(state.heat);
    } catch {
        throw new Error('Invalid runtime heat');
    }
    try {
        canonicalizeMekMovementPsrStateV2(state.movementPsr);
    } catch {
        throw new Error('Invalid runtime movement/PSR state');
    }
    try {
        canonicalizeMekTurnStateV2(state.turn);
    } catch (error) {
        throw new Error(`Invalid Mek turn state: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const condition of state.conditions) {
        if (!boundedRuntimeText(condition)) throw new Error(`Invalid runtime condition ${String(condition)}`);
    }
    for (const [id, locationState] of state.locations) {
        const location = unit.index.locations.get(id);
        if (!location) throw new Error(`Unknown state location ${id}`);
        if (!nonnegativeInteger(locationState.internalDamage)
            || locationState.internalDamage > location.internalPoints) {
            throw new Error(`Invalid internal damage for ${id}`);
        }
        const faces = new Set<ArmorFaceId>();
        for (const armor of locationState.armorDamage) {
            const face = unit.index.armorFaces.get(armor.faceId);
            if (!face || face.locationId !== id || faces.has(armor.faceId)
                || !nonnegativeInteger(armor.damage) || armor.damage > face.maximumPoints) {
                throw new Error(`Invalid armor damage for ${id}`);
            }
            faces.add(armor.faceId);
        }
        for (const [condition, value] of locationState.conditions) {
            if (!isMekLocationConditionValue(condition, value, false)) {
                throw new Error(`Invalid location condition ${condition} for ${id}`);
            }
        }
        if (locationState.internalDamage === 0
            && locationState.armorDamage.length === 0
            && locationState.conditions.size === 0) {
            throw new Error(`Empty sparse location state for ${id}`);
        }
    }
    for (const [id, slot] of state.slots) {
        const definition = unit.index.slots.get(id);
        if (!definition) throw new Error(`Unknown state slot ${id}`);
        const capacity = mekCriticalSlotMaximumHits(unit.index, unit.ruleset, definition);
        if (!nonnegativeInteger(slot.hits) || slot.hits > capacity) {
            throw new Error(`Invalid critical hits for ${id}`);
        }
        if (slot.destroyedTurn !== undefined && (
            !positiveInteger(slot.destroyedTurn)
            || slot.hits < mekCriticalSlotDirectHitThreshold(definition)
        )) {
            throw new Error(`Invalid critical destruction turn for ${id}`);
        }
    }
    for (const [id, component] of state.components) {
        const definition = unit.index.components.get(id);
        if (!definition) throw new Error(`Unknown state component ${id}`);
        if (component.statusOverride !== undefined
            && (definition.kind !== 'equipment'
                || (component.statusOverride !== 'disabled'
                    && component.statusOverride !== 'destroyed'))) {
            throw new Error(`Invalid component status for ${id}`);
        }
        const modes = mekComponentModes(entity, index, id, ruleset);
        if (component.mode !== undefined) {
            const equipment = equipmentForComponent(index, id);
            const stealthTransition = equipment !== undefined
                && isStealthSystemEquipment(equipment)
                && isSwitchableStealthEquipment(equipment)
                && (component.mode === STEALTH_ENABLING_MODE
                    || component.mode === STEALTH_DISABLING_MODE);
            const electronicTransition = equipment !== undefined
                && isEcmRuntimeMode(equipment, component.mode);
            if ((!modes.modes.includes(component.mode)
                    && !stealthTransition
                    && !electronicTransition)
                || component.mode === modes.defaultMode) {
                throw new Error(`Invalid component mode for ${id}`);
            }
        }
        if (component.jammed !== undefined && (
            component.jammed !== true || !rapidFireAutocannonSupportsJamming(index, id, ruleset)
        )) {
            throw new Error(`Invalid component jam state for ${id}`);
        }
        if (component.escalatingFailure !== undefined) {
            const failure = escalatingFailureDefinition(unit, id);
            if (!failure
                || !isEscalatingFailureSequence(
                    component.escalatingFailure.sequence,
                    failure.targets.length,
                )
                || (component.escalatingFailure.active !== undefined
                    && component.escalatingFailure.active !== true)) {
                throw new Error(`Invalid escalating-failure state for ${id}`);
            }
        }
        if (component.ppcCapacitor !== undefined && (
            !isPpcCapacitorPair(entity, index, id, component.ppcCapacitor.weaponId)
            || (component.ppcCapacitor.chargeState !== undefined
                && component.ppcCapacitor.chargeState !== PPC_CAPACITOR_CHARGING_STATE
                && component.ppcCapacitor.chargeState !== PPC_CAPACITOR_CHARGED_STATE)
            || (component.ppcCapacitor.firedThisTurn !== undefined
                && component.ppcCapacitor.firedThisTurn !== true)
            || (component.ppcCapacitor.chargeState === undefined
                && component.ppcCapacitor.firedThisTurn === undefined)
            || (component.ppcCapacitor.chargeState !== undefined
                && component.ppcCapacitor.firedThisTurn !== undefined)
        )) {
            throw new Error(`Invalid PPC capacitor state for ${id}`);
        }
        if (component.bombastLaser !== undefined && (
            !isCoreBombastLaserComponent(index, id, ruleset)
            || (component.bombastLaser.chargeState !== undefined
                && component.bombastLaser.chargeState !== BOMBAST_LASER_CHARGING_STATE
                && component.bombastLaser.chargeState !== BOMBAST_LASER_CHARGED_STATE)
            || (component.bombastLaser.firedThisTurn !== undefined
                && component.bombastLaser.firedThisTurn !== true)
            || (component.bombastLaser.chargeState === undefined
                && component.bombastLaser.firedThisTurn === undefined)
            || (component.bombastLaser.chargeState !== undefined
                && component.bombastLaser.firedThisTurn !== undefined)
        )) {
            throw new Error(`Invalid Bombast Laser state for ${id}`);
        }
        if (component.c3EmergencyMaster !== undefined && (
            !isC3EmergencyMasterComponent(index, id)
            || (component.c3EmergencyMaster.mode !== undefined
                && component.c3EmergencyMaster.mode !== 'on'
                && component.c3EmergencyMaster.mode !== 'off')
            || (component.c3EmergencyMaster.operatingTurns !== undefined
                && !isC3EmergencyMasterOperatingTurns(
                    component.c3EmergencyMaster.operatingTurns,
                ))
            || (component.c3EmergencyMaster.mode === undefined
                && component.c3EmergencyMaster.operatingTurns === undefined)
        )) {
            throw new Error(`Invalid C3 Emergency Master state for ${id}`);
        }
        if (component.gaussPower !== undefined && (
            definition.kind !== 'equipment'
            || !isGaussEquipment(definition.mount.equipment)
            || !isSparseMekGaussPowerState(component.gaussPower)
        )) {
            throw new Error(`Invalid Gauss power state for ${id}`);
        }
        if (component.shieldDamage !== undefined) {
            const profile = shieldProfile(unit, id);
            const damage = component.shieldDamage;
            if (!profile
                || !nonnegativeInteger(damage.absorptionDamage)
                || damage.absorptionDamage > profile.damageAbsorption
                || !nonnegativeInteger(damage.capacityDamage)
                || damage.capacityDamage > profile.damageCapacity
                || (damage.absorptionDamage === 0 && damage.capacityDamage === 0)) {
                throw new Error(`Invalid shield damage state for ${id}`);
            }
        }
        if (component.modularArmorDamage !== undefined && (
            definition.kind !== 'equipment'
            || !isModularArmorEquipment(definition.mount.equipment)
            || !Number.isSafeInteger(component.modularArmorDamage)
            || component.modularArmorDamage < 1
            || component.modularArmorDamage > MODULAR_ARMOR_POINTS_PER_MOUNT
        )) {
            throw new Error(`Invalid Modular Armor damage state for ${id}`);
        }
        if (componentStateEmpty(component)) {
            throw new Error(`Empty sparse component state for ${id}`);
        }
    }
    for (const [id, ammo] of state.ammo) {
        const baseCapacity = mekAmmoCapacity(entity, index, id, ruleset);
        const defaultMunitionKey = mekAmmoDefaultMunitionKey(entity, index, id);
        if (baseCapacity === null || defaultMunitionKey === null) throw new Error(`Unknown state ammo source ${id}`);
        if (ammo.munitionOverride !== undefined && (
            ammo.munitionOverride === defaultMunitionKey
            || mekAmmoLoadout(entity, index, id, ruleset, ammo.munitionOverride) === null
        )) {
            throw new Error(`Unsupported munition override for ammo source ${id}`);
        }
        const capacity = mekAmmoCapacity(entity, index, id, ruleset, ammo.munitionOverride)!;
        if (!Number.isSafeInteger(ammo.shotsSpent) || ammo.shotsSpent < 0 || ammo.shotsSpent > capacity) {
            throw new Error(`Invalid spent shots for ammo source ${id}`);
        }
        if (ammo.shotsSpent === 0 && ammo.munitionOverride === undefined) {
            throw new Error(`Empty sparse ammo state for ${id}`);
        }
    }
    for (const [id, crew] of state.crew) {
        if (!unit.index.crewPositions.has(id)) throw new Error(`Unknown crew position ${id}`);
        if (!Number.isSafeInteger(crew.wounds)
            || crew.wounds < 0
            || crew.wounds > MAX_MEK_CREW_WOUNDS
            || typeof crew.unconscious !== 'boolean'
            || typeof crew.ejected !== 'boolean'
            || (crew.unconscious && crew.ejected)
            || (crew.wounds === 0 && !crew.unconscious && !crew.ejected)) {
            throw new Error(`Invalid sparse crew state for ${id}`);
        }
    }
    if (state.ruleChecks.size > 1) throw new Error('Invalid Mek rule-check state');
    for (const [key, check] of state.ruleChecks) {
        if (key !== MEK_TORSO_CRIPPLING_RULE_CHECK_KEY
            || !unit.index.locations.has(check.triggerLocationId)
            || !Number.isSafeInteger(check.openedRevision)
            || check.openedRevision < 0
            || check.openedRevision > state.stateRevision
            || (check.status !== 'pending' && check.status !== 'success' && check.status !== 'failed')
            || check.token !== createMekTorsoCripplingRuleCheckTokenV2(
                check.openedRevision,
                check.triggerLocationId,
            )) {
            throw new Error(`Invalid Mek rule check ${String(key)}`);
        }
    }
    validatePendingState(state.pendingCombat, state, unit);
}

function validatePendingState(
    pending: PendingCombatOverlay,
    state: MekUnitRuntimeState,
    unit: MekRuntimeSource,
): void {
    for (const [id, delta] of pending.locationInternalDamage) {
        const maximum = unit.index.locations.get(id)?.internalPoints;
        const committed = state.locations.get(id)?.internalDamage ?? 0;
        if (maximum === undefined || !signedNonzeroInteger(delta)
            || committed + delta < 0 || committed + delta > maximum) {
            throw new Error(`Invalid pending internal damage for ${id}`);
        }
    }
    for (const [id, delta] of pending.armorDamage) {
        const face = unit.index.armorFaces.get(id);
        const committed = face === undefined ? 0 : state.locations.get(face.locationId)?.armorDamage
            .find(entry => entry.faceId === id)?.damage ?? 0;
        if (!face || !signedNonzeroInteger(delta)
            || committed + delta < 0 || committed + delta > face.maximumPoints) {
            throw new Error(`Invalid pending armor damage for ${id}`);
        }
    }
    for (const [id, delta] of pending.criticalHits) {
        const definition = unit.index.slots.get(id);
        const committed = state.slots.get(id)?.hits ?? 0;
        const capacity = definition === undefined
            ? 1
            : mekCriticalSlotMaximumHits(unit.index, unit.ruleset, definition);
        if (!definition || !signedNonzeroInteger(delta)
            || committed + delta < 0 || committed + delta > capacity) {
            throw new Error(`Invalid pending critical hits for ${id}`);
        }
    }
    for (const [id, status] of pending.componentStatus) {
        const definition = unit.index.components.get(id);
        if (!definition || definition.kind !== 'equipment' || !isEquipmentStatus(status)) {
            throw new Error(`Invalid pending component status for ${id}`);
        }
    }
    for (const [id, delta] of pending.shieldDamage) {
        const profile = shieldProfile(unit, id);
        const committed = state.components.get(id)?.shieldDamage
            ?? { absorptionDamage: 0, capacityDamage: 0 };
        if (!profile
            || !Number.isSafeInteger(delta.absorptionDamage)
            || !Number.isSafeInteger(delta.capacityDamage)
            || (delta.absorptionDamage === 0 && delta.capacityDamage === 0)
            || committed.absorptionDamage + delta.absorptionDamage < 0
            || committed.absorptionDamage + delta.absorptionDamage > profile.damageAbsorption
            || committed.capacityDamage + delta.capacityDamage < 0
            || committed.capacityDamage + delta.capacityDamage > profile.damageCapacity) {
            throw new Error(`Invalid pending shield damage for ${id}`);
        }
    }
    for (const [id, delta] of pending.modularArmorDamage) {
        const definition = unit.index.components.get(id);
        const committed = state.components.get(id)?.modularArmorDamage ?? 0;
        if (definition?.kind !== 'equipment'
            || !isModularArmorEquipment(definition.mount.equipment)
            || !signedNonzeroInteger(delta)
            || committed + delta < 0
            || committed + delta > MODULAR_ARMOR_POINTS_PER_MOUNT) {
            throw new Error(`Invalid pending Modular Armor damage for ${id}`);
        }
    }
    for (const [locationId, conditions] of pending.locationConditions) {
        if (!unit.index.locations.has(locationId) || conditions.size === 0) {
            throw new Error(`Invalid pending location conditions for ${locationId}`);
        }
        for (const [condition, value] of conditions) {
            const committed = state.locations.get(locationId)?.conditions.get(condition) ?? 0;
            if (!isMekLocationConditionValue(condition, value, true) || value === committed) {
                throw new Error(`Invalid pending location condition ${condition} for ${locationId}`);
            }
        }
    }
}

function effectiveComponentMode(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    componentId: ComponentId,
): string | undefined {
    const component = unit.index.components.get(componentId);
    if (!component) throw new Error(`Unknown component ${componentId}`);
    const persisted = state.components.get(componentId)?.mode;
    if (persisted !== undefined) {
        const equipment = equipmentForComponent(unit.index, componentId);
        if (isMachineGunArrayEquipment(equipment)
            && isMachineGunArrayLifecycleState(persisted)) {
            return effectiveMachineGunArrayMode(persisted);
        }
        if (equipment && isSwitchableStealthEquipment(equipment)
            && (persisted === STEALTH_ENABLING_MODE || persisted === STEALTH_DISABLING_MODE)) {
            const modes = mekComponentModes(unit.entity, unit.index, componentId, unit.ruleset).modes;
            return modes.find(mode => mode.toLowerCase() === (
                persisted === STEALTH_DISABLING_MODE ? 'on' : 'off'
            ));
        }
        return persisted;
    }

    const equipment = component.kind === 'equipment' ? component.mount.equipment : undefined;
    if (equipment instanceof WeaponEquipment && equipment.ammoType === 'MML') {
        for (const [ammoId, ammoComponent] of unit.index.components) {
            if (ammoComponent.kind !== 'equipment'
                || !(ammoComponent.mount.equipment instanceof AmmoEquipment)) continue;
            const loadout = mekAmmoLoadout(
                unit.entity,
                unit.index,
                ammoId,
                unit.ruleset,
                state.ammo.get(ammoId)?.munitionOverride,
            );
            if (loadout && mekWeaponAmmoMatches(equipment, loadout.equipment, MML_INVENTORY_MODES[0])) {
                return MML_INVENTORY_MODES[0];
            }
        }
        return MML_INVENTORY_MODES[1];
    }
    return mekComponentModes(unit.entity, unit.index, componentId, unit.ruleset).defaultMode;
}

function settleMachineGunArrays(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
): MekUnitRuntimeState {
    let settled = state;
    for (const bay of unit.index.relationships.bays) {
        if (bay.kind !== 'machine-gun-array' || bay.controllerId === undefined) continue;
        const current = machineGunArrayLifecycleState(
            settled.components.get(bay.controllerId)?.mode,
        );
        const next = settledMachineGunArrayState(current);
        if (next === current) continue;
        settled = withComponentMode(
            settled,
            bay.controllerId,
            next,
            MGA_LINKED_MODE,
        ) ?? settled;
    }
    return settled;
}

function lowerCoreShields(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
): MekUnitRuntimeState {
    if (unit.ruleset !== 'core-2026') return state;
    let lowered = state;
    for (const [componentId, component] of unit.index.components) {
        if (component.kind !== 'equipment'
            || !isShieldEquipment(component.mount.equipment)
            || effectiveComponentMode(unit, lowered, componentId) !== SHIELD_ACTIVE_MODE) continue;
        lowered = withComponentMode(
            lowered,
            componentId,
            SHIELD_INACTIVE_MODE,
            SHIELD_INACTIVE_MODE,
        ) ?? lowered;
    }
    return lowered;
}

function settleCoolantPods(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
): MekUnitRuntimeState {
    let settled = state;
    for (const [componentId, component] of unit.index.components) {
        if (component.kind !== 'equipment'
            || !isCoolantPodEquipment(component.mount.equipment)
            || effectiveComponentMode(unit, settled, componentId) !== COOLANT_POD_ACTIVE_MODE) continue;
        settled = withComponentMode(
            settled,
            componentId,
            COOLANT_POD_READY_MODE,
            COOLANT_POD_READY_MODE,
        ) ?? settled;
    }
    return settled;
}

function requireAmmoLoadout(
    unit: MekRuntimeSource,
    componentId: ComponentId,
    munitionOverride?: string,
): AmmoLoadout {
    const loadout = mekAmmoLoadout(
        unit.entity,
        unit.index,
        componentId,
        unit.ruleset,
        munitionOverride,
    );
    if (!loadout) throw new Error(`Unknown ammo source or munition ${componentId}`);
    return loadout;
}

function requireAmmoCapacity(
    unit: MekRuntimeSource,
    componentId: ComponentId,
    munitionOverride?: string,
): number {
    const capacity = mekAmmoCapacity(
        unit.entity,
        unit.index,
        componentId,
        unit.ruleset,
        munitionOverride,
    );
    if (capacity === null) throw new Error(`Unknown ammo source ${componentId}`);
    return capacity;
}

function buildHeatKernelInput(
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    statusTopology: RuntimeEquipmentStatusTopology,
): MekHeatKernelInputV2 {
    const status = new RuntimeEquipmentStatusKernel(
        statusTopology,
        statusState(unit, state, 'committed'),
        { rules: unit.ruleset, family: 'mek' },
    );
    const previewStatus = new RuntimeEquipmentStatusKernel(
        statusTopology,
        statusState(unit, state, 'preview'),
        { rules: unit.ruleset, family: 'mek' },
    );
    const committedUnavailableComponents = new Set<ComponentId>();
    for (const componentId of unit.index.components.keys()) {
        if (status.component(componentId).status !== 'available') {
            committedUnavailableComponents.add(componentId);
        }
    }
    const committedUnavailableCriticalSlots = new Set<CriticalSlotId>();
    const committedDestroyedCriticalSlots = new Set<CriticalSlotId>();
    const previewUnavailableCriticalSlots = new Set<CriticalSlotId>();
    for (const slotId of unit.index.slots.keys()) {
        const committedStatus = status.criticalSlot(slotId).status;
        const committedUnavailable = committedStatus !== 'available';
        if (committedUnavailable) committedUnavailableCriticalSlots.add(slotId);
        if (committedStatus === 'destroyed') committedDestroyedCriticalSlots.add(slotId);
        // A pending repair does not erase a committed engine hit before commit. Preview
        // destruction (including pending critical/location loss) does contribute immediately.
        if (committedUnavailable || previewStatus.criticalSlot(slotId).status !== 'available') {
            previewUnavailableCriticalSlots.add(slotId);
        }
    }
    const ppcCapacitors = [...state.components].flatMap(([componentId, componentState]) => {
        const lifecycle = componentState.ppcCapacitor;
        if (lifecycle === undefined) return [];
        return [Object.freeze({
            capacitorId: componentId,
            weaponId: lifecycle.weaponId,
            chargeState: lifecycle?.chargeState ?? null,
        })];
    });
    const activeEscalatingFailureComponents = new Set([...state.components]
        .filter(([, componentState]) => componentState.escalatingFailure?.active === true)
        .map(([componentId]) => componentId));
    const activeVibrobladeComponents = new Set<ComponentId>();
    for (const [componentId, component] of unit.index.components) {
        if (component.kind !== 'equipment'
            || !component.mount.equipment
            || getVibrobladeProfileFromFlags(component.mount.equipment.flags) === null) continue;
        const mode = effectiveComponentMode(unit, state, componentId);
        if (mode === VIBROBLADE_ON_MODE) activeVibrobladeComponents.add(componentId);
    }
    const activeStealthComponents = activeStealthHeatComponents(
        buildMekStealthFacts(unit, state, statusTopology, 'preview'),
        state.destroyed || state.conditions.has('shutdown'),
    );
    const electronicFacts = buildMekElectronicFacts(unit, state, statusTopology, 'committed');
    const activeElectronicComponents = new Set<ComponentId>(electronicFacts.flatMap(fact =>
        isNovaCewsEquipment(fact.equipment)
            && effectiveEcmMode(electronicFacts, fact.componentId) !== ECMMode.OFF
            ? [fact.componentId]
            : []));
    const activeMobileHpgComponents = new Set<ComponentId>(
        buildMekMobileHpgFacts(unit, state, statusTopology, 'committed').flatMap(fact =>
            mobileHpgOperatingHeat(
                fact.equipment,
                fact.mode,
                fact.operational,
                unit.entity.mountedEngine().isFusion,
            ) > 0 ? [fact.componentId] : []),
    );
    const activeCoolantPodComponents = new Set<ComponentId>();
    for (const [componentId, component] of unit.index.components) {
        if (component.kind === 'equipment'
            && isCoolantPodEquipment(component.mount.equipment)
            && effectiveComponentMode(unit, state, componentId) === COOLANT_POD_ACTIVE_MODE) {
            activeCoolantPodComponents.add(componentId);
        }
    }
    const hasSelectedWeapon = [...state.attackerTargeting.components.values()]
        .some(component => component.selection !== undefined);
    const movement = state.movementPsr.movement;
    return buildMekHeatKernelInputV2({
        heat: state.heat,
        turn: state.turn,
        movement: movement === undefined || movement === null
            ? null
            : Object.freeze({ mode: movement.mode, distance: movement.distance }),
        standAttempts: state.movementPsr.standAttempts,
        destroyed: state.destroyed,
        shutdown: state.conditions.has('shutdown'),
        water: resolveMekUnitWaterState(
            unit.entity,
            state.turn.cover,
            state.conditions.has('prone'),
        ),
        committedUnavailableCriticalSlots,
        committedDestroyedCriticalSlots,
        previewUnavailableCriticalSlots,
        committedUnavailableComponents,
        activeEscalatingFailureComponents,
        activeVibrobladeComponents,
        activeStealthComponents,
        activeElectronicComponents,
        activeMobileHpgComponents,
        activeCoolantPodComponents,
        hasSelectedWeapon,
        ppcCapacitors,
    });
}

function reconcileHeatAcknowledgements(
    entity: MekEntity,
    unit: MekRuntimeSource,
    state: MekUnitRuntimeState,
    statusTopology: RuntimeEquipmentStatusTopology,
    heatContext: MekHeatRuntimeContextV2,
): MekUnitRuntimeState {
    if (state.turn.acknowledgedHeatSources.size === 0) return state;
    const result = projectMekHeatContextV2(
        heatContext,
        entity,
        buildHeatKernelInput(unit, state, statusTopology),
        'manual',
    );
    if (result.kind === 'unsupported') return state;
    const sources = result.projection.committedSources;
    const current = new Map(sources.map(source => [source.id, mekHeatSourceSignatureV2(source)]));
    const acknowledged = new ImmutableIndex([...state.turn.acknowledgedHeatSources]
        .filter(([sourceId, signature]) => current.get(sourceId) === signature));
    if (acknowledged.size === state.turn.acknowledgedHeatSources.size) return state;
    return {
        ...state,
        turn: canonicalizeMekTurnStateV2({ ...state.turn, acknowledgedHeatSources: acknowledged }),
    };
}

function isStateMutationTarget(value: unknown): value is 'pending' | 'committed' {
    return value === 'pending' || value === 'committed';
}

function positiveInteger(value: number): boolean {
    return Number.isSafeInteger(value) && value > 0;
}

function nonnegativeInteger(value: number): boolean {
    return Number.isSafeInteger(value) && value >= 0;
}

function signedNonzeroInteger(value: number): boolean {
    return Number.isSafeInteger(value) && value !== 0;
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function isMekLocationConditionKey(value: unknown): value is MekLocationConditionKey {
    return typeof value === 'string'
        && (MEK_LOCATION_CONDITION_KEYS as readonly string[]).includes(value);
}

function isMekLocationConditionValue(
    condition: MekLocationConditionKey,
    value: unknown,
    allowZero: boolean,
): value is number {
    if (!Number.isSafeInteger(value)
        || Number(value) < (allowZero ? 0 : 1)
        || Number(value) > MAX_MEK_LOCATION_CONDITION_VALUE) return false;
    return condition === 'narc' || value === 0 || value === 1;
}

function escalatingFailureDefinition(
    unit: MekRuntimeSource,
    componentId: ComponentId,
): ComponentEscalatingFailureDefinition | null {
    try {
        return componentEscalatingFailureDefinition(unit.index, componentId, unit.ruleset);
    } catch {
        return null;
    }
}

function isEscalatingFailureSequence(
    value: unknown,
    maximum: number,
): value is EscalatingFailureSequence {
    return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= maximum;
}

function isC3EmergencyMasterOperatingTurns(
    value: unknown,
): value is C3EmergencyMasterOperatingTurns {
    return Number.isSafeInteger(value)
        && Number(value) >= 1
        && Number(value) <= C3EM_FRIED_SEQUENCE_VALUE;
}

function canonicalNonnegativeNumber(value: number): boolean {
    return Number.isFinite(value)
        && value >= 0
        && value <= MAX_MEK_HEAT_VALUE_V2
        && !Object.is(value, -0);
}

function isHeatPolicy(value: unknown): value is MekHeatAutomationPolicyV2 {
    return value === 'automatic' || value === 'manual';
}

function boundedRuntimeText(value: string): boolean {
    return typeof value === 'string' && value.trim().length > 0 && value === value.trim()
        && value.length <= 512 && !value.includes('\0');
}

function isEquipmentStatus(value: unknown): value is EquipmentStatus {
    return value === 'available' || value === 'disabled' || value === 'destroyed';
}

function rejected(
    state: MekUnitRuntimeState,
    reason: Extract<CommandReduction, { accepted: false }>['reason'],
): CommandReduction {
    return { accepted: false, reason, currentRevision: state.stateRevision };
}

function canonicalCommandKey(
    command: CBTUnitCommand | CBTUnitAttackerTargetingCommand | CBTUnitSelectedWeaponFireCommand,
): string {
    return JSON.stringify(command.type === 'replace-turn-state'
        ? { ...command, turn: serializeMekTurnStateV2(command.turn) }
        : command);
}
