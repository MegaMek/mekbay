// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ComponentId } from './entity/entity-identifiers';
import type { TnTargetUnitType } from './target-number-calculator.model';
import type { UnitProviderId, UnitUuid } from '../services/unit-catalog/unit-catalog.types';
import type { V2EquipmentInteractionKind } from '../services/equipment-interaction-registry.service';
import type {
    EncounterTargetId,
    TargetRegistryCommandResult,
    TargetRegistrySnapshot,
} from './runtime/encounter-runtime';
import type { SerializedEncounterTargetCalculatorV2 } from './runtime/persistence-v2';
import type { StateRevision, UnitInstanceId } from './runtime/runtime-state';
import type { NonMekUnitRuntimeState } from './runtime/non-mek-unit-instance';
import type { CommandReduction } from './runtime/unit-instance';
import type { DeploymentConfiguration, ScenarioRules } from './runtime/unit-state-initializer';
import type { MekRuntimeCapabilityDecision } from './runtime/mek-runtime-capability';
import type {
    CrewProfileCommandResult,
    CrewProfileSnapshot,
} from './runtime/crew-profile';
import type { AttackerTargetingState } from './runtime/attacker-targeting-state';
import type { RuntimeCommandEntry } from './runtime/runtime-command-session';
import type { MekHeatAutomationPolicyV2 } from './runtime/mek-heat-state-v2';

export type CBTForceTargetRegistryAuthority = 'user' | 'opfor-sync' | 'registry-reset';

export type CBTForceTargetRegistryDispatchResult = TargetRegistryCommandResult | {
    readonly accepted: false;
    readonly changed: false;
    readonly reason: 'FORCE_READ_ONLY';
    readonly snapshot: TargetRegistrySnapshot;
} | {
    readonly accepted: false;
    readonly changed: false;
    readonly reason: 'TARGETING_RECONCILIATION_FAILED';
    readonly snapshot: TargetRegistrySnapshot;
};

/** Detached target-ready projection; no runtime owner escapes. */
export interface InventoryControlTargetRosterRow {
    readonly instanceId: UnitInstanceId;
    readonly targetId: EncounterTargetId;
    readonly name: string;
    readonly unitType: TnTargetUnitType;
    readonly tnCalculator: SerializedEncounterTargetCalculatorV2;
    readonly projection: 'v2';
}

export type CBTNonMekUnitCommandResult =
    | Readonly<{
        readonly accepted: true;
        readonly changed: boolean;
        readonly state: NonMekUnitRuntimeState;
    }>
    | Readonly<{
        readonly accepted: false;
        readonly changed: false;
        readonly reason:
            | 'NOT_ADMITTED'
            | 'FORCE_READ_ONLY'
            | 'STALE_REVISION'
            | 'STALE_TARGET_REGISTRY'
            | 'INVALID_TARGETING'
            | 'INVALID_COMMAND';
        readonly currentRevision: StateRevision | null;
    }>;

export type CBTMekUnitCommandResult = CommandReduction | Readonly<{
    readonly accepted: false;
    readonly reason: 'NOT_ADMITTED' | 'INVALID_COMMAND';
    readonly currentRevision: null;
}>;

export type CBTUnitRepairResult =
    | Readonly<{
        readonly accepted: true;
        readonly changed: boolean;
        readonly forceRevision: StateRevision;
    }>
    | Readonly<{
        readonly accepted: false;
        readonly changed: false;
        readonly reason: 'READ_ONLY' | 'NOT_READY' | 'FORCE_CHANGED' | 'REPAIR_FAILED' | 'PERSISTENCE_REJECTED';
    }>;

export type CBTUnitTransferResult =
    | Readonly<{
        readonly accepted: true;
        readonly changed: true;
        readonly instanceId: UnitInstanceId;
    }>
    | Readonly<{
        readonly accepted: false;
        readonly changed: false;
        readonly reason:
            | 'READ_ONLY'
            | 'SAME_FORCE'
            | 'NOT_READY'
            | 'UNKNOWN_GROUP'
            | 'FORCE_FULL'
            | 'INSTANCE_ID_COLLISION'
            | 'SCENARIO_MISMATCH'
            | 'FORCE_CHANGED'
            | 'PERSISTENCE_REJECTED';
    }>;

export interface CBTDirectUnitAdmissionRequest {
    readonly identity: Readonly<{ readonly provider: UnitProviderId; readonly uuid: UnitUuid }>;
    readonly deployment: DeploymentConfiguration;
    readonly crewSkills?: Readonly<{ readonly gunnery: number; readonly piloting: number }>;
    readonly scenario?: ScenarioRules;
    readonly instanceId?: UnitInstanceId;
    readonly initialStateProfileId?: string;
    readonly targetRosterGroupId?: string;
    readonly targetRosterMemberIndex?: number;
    readonly commander?: boolean;
}

export type CBTDirectUnitAdmissionResult =
    | { readonly kind: 'admitted'; readonly instanceId: UnitInstanceId }
    | {
        readonly kind: 'deferred';
        readonly decision: Extract<MekRuntimeCapabilityDecision, { readonly readiness: 'deferred' }>;
    }
    | {
        readonly kind: 'failed';
        readonly reason:
            | 'READ_ONLY'
            | 'FORCE_FULL'
            | 'INSTANCE_ID_COLLISION'
            | 'CANDIDATE_PREPARATION_FAILED'
            | 'SOURCE_MISMATCH'
            | 'PERSISTENCE_REJECTED'
            | 'FORCE_CHANGED';
        readonly message: string;
    };

export type MekCrewProfileCommandResult = CrewProfileCommandResult | {
    readonly accepted: false;
    readonly reason: 'REDEPLOY_FAILED';
    readonly snapshot: CrewProfileSnapshot;
};

export interface AttackerTargetingSnapshot {
    readonly instanceId: UnitInstanceId;
    readonly stateRevision: StateRevision;
    readonly registryRevision: StateRevision;
    readonly state: AttackerTargetingState;
}

export type C3State = 'none' | 'operational' | 'degraded';

export type AttackerTargetingCommandResult =
    | {
        readonly accepted: true;
        readonly idempotent: boolean;
        readonly currentRevision: StateRevision;
    }
    | {
        readonly accepted: false;
        readonly reason: Extract<CommandReduction, { readonly accepted: false }>['reason']
            | 'UNIT_NOT_FOUND'
            | 'OWNER_CHANGED'
            | 'C3_UNAVAILABLE';
        readonly currentRevision: StateRevision | null;
    };

export type EquipmentRowOrderCommandResult =
    | Readonly<{
        readonly accepted: true;
        readonly idempotent: boolean;
        readonly currentRevision: StateRevision;
    }>
    | Readonly<{
        readonly accepted: false;
        readonly reason: 'UNIT_NOT_FOUND' | 'REVISION_CONFLICT' | 'FORCE_READ_ONLY' | 'INVALID_ORDER';
        readonly currentRevision: StateRevision | null;
    }>;

export type SelectedWeaponFireCommandResult =
    | (Extract<AttackerTargetingCommandResult, { readonly accepted: true }> & Readonly<{
        readonly prototypeHeat: readonly import('./prototype-laser-heat.model').PrototypeLaserHeatResult[];
    }>)
    | Extract<AttackerTargetingCommandResult, { readonly accepted: false }>;

export type RuntimeUndoCommandResult = Readonly<{
    readonly accepted: boolean;
    readonly changed: boolean;
    readonly reason?: 'EMPTY' | 'READ_ONLY' | 'FORCE_CHANGED' | 'RESTORE_FAILED';
    readonly entry?: RuntimeCommandEntry;
}>;

declare const MEK_EQUIPMENT_CHOICE_TOKEN: unique symbol;
export type MekEquipmentChoiceToken = string & { readonly [MEK_EQUIPMENT_CHOICE_TOKEN]: true };

/** Detached choice metadata. Registered handlers and runtime ports never escape. */
export interface MekEquipmentChoice {
    readonly token: MekEquipmentChoiceToken;
    readonly handlerId: string;
    readonly interactionKind: V2EquipmentInteractionKind;
    readonly label: string;
    readonly groupLabel?: string;
    readonly shortLabel?: string;
    readonly active: boolean;
    readonly disabled: boolean;
    readonly selectionTone?: 'selected' | 'muted';
    readonly colors?: Readonly<{
        readonly normal?: string;
        readonly normalText?: string;
        readonly selected?: string;
        readonly selectedText?: string;
        readonly mutedSelected?: string;
        readonly mutedSelectedText?: string;
        readonly disabled?: string;
        readonly disabledText?: string;
    }>;
    readonly keepOpen?: boolean;
    readonly displayType?: 'button' | 'dropdown' | 'label' | 'state-button' | 'toggle';
    readonly tooltipType?: 'info' | 'success' | 'error';
    readonly failureTarget?: number;
}

export interface MekEquipmentInteraction {
    readonly instanceId: UnitInstanceId;
    readonly unitLabel: string;
    readonly componentId: ComponentId;
    readonly relatedComponentId?: ComponentId;
    readonly componentLabel: string;
    readonly stateRevision: StateRevision;
    readonly choices: readonly MekEquipmentChoice[];
}

export type MekEquipmentChoiceDispatchResult =
    | { readonly accepted: true; readonly changed: boolean }
    | {
        readonly accepted: false;
        readonly changed: false;
        readonly reason:
            | 'UNKNOWN_TOKEN'
            | 'READ_ONLY'
            | 'OWNER_CHANGED'
            | 'STALE_REVISION'
            | 'ENTITY_MISMATCH'
            | 'NOT_ADMITTED'
            | 'CHOICE_UNAVAILABLE'
            | 'HANDLER_REJECTED';
    };

declare const MEK_HEAT_COMMAND_TOKEN: unique symbol;
export type MekHeatCommandToken = string & { readonly [MEK_HEAT_COMMAND_TOKEN]: true };

export interface MekHeatSourceRow {
    readonly id: string;
    readonly label: string;
    readonly value: number;
}

export type MekHeatInteraction =
    | {
        readonly kind: 'supported';
        readonly token: MekHeatCommandToken;
        readonly instanceId: UnitInstanceId;
        readonly unitLabel: string;
        readonly stateRevision: StateRevision;
        readonly policy: MekHeatAutomationPolicyV2;
        readonly current: number;
        readonly previous: number;
        readonly pendingOverride?: number;
        readonly heatsinksOff: number;
        readonly maxHeatsinksOff: number;
        readonly projected: number;
        readonly delta: number;
        readonly capacity: number;
        readonly remainingDissipation: number;
        readonly dissipated: number;
        readonly sources: readonly MekHeatSourceRow[];
        readonly hasPendingSettlement: boolean;
        readonly disabled: boolean;
    }
    | {
        readonly kind: 'unsupported';
        readonly instanceId: UnitInstanceId;
        readonly unitLabel: string;
        readonly blockers: readonly string[];
        readonly disabled: true;
    };

export type MekHeatCommand =
    | {
        readonly type: 'set-target';
        readonly token: MekHeatCommandToken;
        readonly heat: number | null;
    }
    | {
        readonly type: 'set-heatsinks-off';
        readonly token: MekHeatCommandToken;
        readonly heatsinksOff: number;
    }
    | {
        readonly type: 'apply' | 'end-turn';
        readonly token: MekHeatCommandToken;
    };

export type MekHeatCommandResult =
    | { readonly accepted: true; readonly changed: boolean }
    | {
        readonly accepted: false;
        readonly changed: false;
        readonly reason:
            | 'UNKNOWN_TOKEN'
            | 'READ_ONLY'
            | 'OWNER_CHANGED'
            | 'STALE_REVISION'
            | 'ENTITY_MISMATCH'
            | 'NOT_ADMITTED'
            | 'UNSUPPORTED_HEAT_CONTEXT'
            | 'INVALID_AMOUNT'
            | 'EXCEEDS_CAPACITY'
            | 'COMMAND_REJECTED';
    };

export interface CBTForceEndTurnUnitResult {
    readonly instanceId: string;
    readonly accepted: boolean;
    readonly changed: boolean;
    readonly reason?: string;
}

export interface CBTForceEndTurnAllResult {
    readonly accepted: boolean;
    readonly changed: boolean;
    readonly atomic: false;
    readonly results: readonly CBTForceEndTurnUnitResult[];
}
