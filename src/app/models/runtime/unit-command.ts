// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { HeatAutomationPolicy } from './cbt-unit-runtime';

import type { ArmorFaceId,ComponentId,CrewPositionId,CriticalSlotId,LocationId,SystemDamageTrackId } from '../entity/entity-identifiers';
import type { EquipmentStatus } from '../equipment-status.model';
import type { PrototypeLaserHeatRoll } from '../prototype-laser-heat.model';
import type { StealthState } from '../stealth-equipment.model';
import type { UnitConditionKey } from '../unit-condition.model';
import type { BOMBAST_LASER_CHARGING_STATE } from './component-bombast-laser';
import type { PPC_CAPACITOR_CHARGING_STATE } from './component-ppc-capacitor';
import type { MekShieldTrack } from './mek-shield-rules';
import type { MekPendingFallConsequencesV2,MekTurnStateV2 } from './mek-turn-state-v2';
import type { MekWeaponFireSelectionV2 } from './mek-weapon-fire-v2';
import type { C3EmergencyMasterOperatingTurns,MekLocationConditionKey } from './runtime-state';

import type { UnitCover } from '../unit-cover.model';
import type { AttackerTargetingEdit } from './attacker-targeting-state';
import type { MekRuleCheckKeyV2,MekRuleCheckOutcomeV2,MekRuleCheckTokenV2 } from './mek-destruction-state-v2';
import type { MekActionDeclarationV2,MekMovementDeclarationV2,MekPilotCheckDiceEvidenceV2 } from './mek-movement-psr-v2';
import type { NonMekControlRecoveryWorkflow,NonMekMovementDeclaration } from './non-mek-unit-instance';

export interface CBTUnitAttackerTargetingCommand {
    readonly type: 'edit-attacker-targeting';
    readonly edit: AttackerTargetingEdit;
}

/** Fires the current targeting selection; no second weapon-selection payload exists. */
export interface CBTUnitSelectedWeaponFireCommand {
    readonly type: 'fire-selected-weapons';
    readonly heatPolicy: HeatAutomationPolicy;
    readonly prototypeHeatRolls?: readonly PrototypeLaserHeatRoll[];
}

/** Detach queued edits without losing the runtime's custom immutable map implementation. */
export function captureUnitCommand(command: CBTUnitCommand): CBTUnitCommand {
    return structuredClone(command.type === 'replace-turn-state'
        ? { ...command, turn: { ...command.turn, acknowledgedHeatSources: new Map(command.turn.acknowledgedHeatSources) } }
        : command);
}

/** Authored unit edits. Shared operations have one contract; rules decide applicability. */
export type CBTUnitCommand =
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
        readonly type: 'reset-ammo-loadout';
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
        readonly heatPolicy: HeatAutomationPolicy;
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
        readonly policy: HeatAutomationPolicy;
    }
    | {
        readonly type: 'set-condition';
        readonly condition: UnitConditionKey;
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
        /** Manual killed state for unit types whose crew rules support it. */
        readonly dead?: boolean;
        readonly positionId: CrewPositionId;
        readonly wounds: number;
        readonly unconscious: boolean;
        readonly ejected: boolean;
        /** Omitted preserves an existing schedule or queues a new loss for next turn. */
        readonly recoveryReadyTurn?: number | null;
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
    | {
        readonly type: 'set-pending-fall-consequences';
        readonly pending: MekPendingFallConsequencesV2 | null;
    }
    | { readonly type: 'reset-turn-state' }
    | {
        readonly type: 'end-phase';
        /** Set only when End Turn is completing its prerequisite phase. */
        readonly endTurnBoundary?: true;
    }
    | { readonly type: 'mark-end-turn-heat-staged' }
    | { readonly type: 'end-turn'; readonly policy: HeatAutomationPolicy }
    | { readonly type: 'commit-pending' }
    | { readonly type: 'cancel-pending' }
    | { readonly type: 'set-destroyed'; readonly destroyed: boolean }
    | { readonly type: 'set-internal-damage'; readonly locationId: LocationId; readonly damage: number }
    | { readonly type: 'set-armor-damage'; readonly faceId: ArmorFaceId; readonly damage: number }
    | { readonly type: 'damage-track'; readonly damageTrackId: SystemDamageTrackId; readonly amount: number; readonly target: 'committed' | 'pending'; readonly timestamp: number }
    | { readonly type: 'repair-damage-track'; readonly damageTrackId: SystemDamageTrackId; readonly amount: number; readonly target: 'committed' | 'pending' }
    | { readonly type: 'set-sensor-damage-level'; readonly level: number; readonly target: 'committed' | 'pending'; readonly timestamp: number }
    | { readonly type: 'set-component-statuses'; readonly componentIds: readonly ComponentId[]; readonly status: EquipmentStatus; readonly target: 'committed' | 'pending' }
    | { readonly type: 'set-ammo-spent'; readonly componentId: ComponentId; readonly shotsSpent: number }
    | { readonly type: 'set-airborne'; readonly airborne: boolean | null }
    | { readonly type: 'set-movement'; readonly movement: NonMekMovementDeclaration | null }
    | { readonly type: 'set-cover'; readonly cover: UnitCover | null }
    | { readonly type: 'set-spotting'; readonly spotting: boolean }
    | { readonly type: 'set-control-recovery'; readonly workflow: NonMekControlRecoveryWorkflow | null };
