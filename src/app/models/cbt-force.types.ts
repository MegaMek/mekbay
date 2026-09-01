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
import type { MekUnitRuntimeState } from './runtime/runtime-state';
import type { NonMekUnitRuntimeState } from './runtime/non-mek-unit-instance';
import type { CBTUnitCommandResult, CBTUnitRuntimeState } from './runtime/cbt-unit-runtime';
import type { DeploymentConfiguration, ScenarioRules } from './runtime/unit-state-initializer';
import type { MekRuntimeCapabilityDecision } from './runtime/mek-runtime-capability';
import type { AttackerTargetingState } from './runtime/attacker-targeting-state';
import type { RuntimeCommandEntry } from './runtime/runtime-command-session';

export type CBTForceTargetRegistryAuthority = 'user' | 'opfor-sync' | 'registry-reset';

export type CBTForceTargetRegistryDispatchResult = TargetRegistryCommandResult;

/** Detached target-ready projection; no runtime owner escapes. */
export interface InventoryControlTargetRosterRow {
    readonly instanceId: string;
    readonly targetId: EncounterTargetId;
    readonly name: string;
    readonly unitType: TnTargetUnitType;
    readonly tnCalculator: SerializedEncounterTargetCalculatorV2;
    readonly projection: 'v2';
}

export type CBTNonMekUnitCommandResult = CBTUnitCommandResult<NonMekUnitRuntimeState | null>;
export type CBTMekUnitCommandResult = Readonly<
    CBTUnitCommandResult<MekUnitRuntimeState | null>
    & { readonly prototypeHeat?: readonly import('./prototype-laser-heat.model').PrototypeLaserHeatResult[] }
>;

export type CBTUnitRepairResult =
    | Readonly<{
        readonly accepted: true;
        readonly changed: boolean;
        readonly forceRevision: number;
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
        readonly instanceId: string;
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
    readonly instanceId?: string;
    readonly initialStateProfileId?: string;
    readonly targetRosterGroupId?: string;
    readonly targetRosterMemberIndex?: number;
    readonly commander?: boolean;
}

export type CBTDirectUnitAdmissionResult =
    | { readonly kind: 'admitted'; readonly instanceId: string }
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

export interface AttackerTargetingSnapshot {
    readonly instanceId: string;
    readonly stateRevision: number;
    readonly registryRevision: number;
    readonly state: AttackerTargetingState;
}

export type C3State = 'none' | 'operational' | 'degraded';

export type AttackerTargetingCommandResult = CBTUnitCommandResult<CBTUnitRuntimeState | null>;

export type EquipmentRowOrderCommandResult = AttackerTargetingCommandResult;

export type SelectedWeaponFireCommandResult =
    Readonly<AttackerTargetingCommandResult & {
        readonly prototypeHeat: readonly import('./prototype-laser-heat.model').PrototypeLaserHeatResult[];
    }>;

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
    readonly instanceId: string;
    readonly unitLabel: string;
    readonly componentId: ComponentId;
    readonly relatedComponentId?: ComponentId;
    readonly componentLabel: string;
    readonly stateRevision: number;
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
