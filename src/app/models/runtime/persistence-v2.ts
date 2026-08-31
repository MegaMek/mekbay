// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentStatus } from '../equipment-status.model';
import { isUnitConditionKey, type UnitConditionKey } from '../unit-condition.model';
import type {
    BombastLaserRuntimeState,
    C3EmergencyMasterRuntimeState,
    ComponentRuntimeState,
    EscalatingFailureRuntimeState,
    MekLocationConditionKey,
    PpcCapacitorRuntimeState,
} from './runtime-state';
import {
    isMekLocationConditionKey,
    MAX_MEK_LOCATION_CONDITION_VALUE,
} from './runtime-state';
import {
    asComponentId,
    asCriticalSlotId,
    asCrewPositionId,
    asLocationId,
    type ComponentId,
    type CrewPositionId,
    type LocationId,
} from '../entity/entity-identifiers';
import { isCBTRuleset, type CBTRuleset } from '../cbt-ruleset.model';
import { jsonValuesEqual } from '../../utils/json-value.util';
import {
    sanitizeSavedEntityIdentity,
    type DeferredUnitSource,
    type ForceRecoveryEvidence,
    type JsonValue,
    type SavedEntityIdentity,
} from '../persisted-unit-state';
import {
    asSourceHash,
    asUnitProviderId,
    asUnitUuid,
} from '../../services/unit-catalog/unit-catalog.types';
import {
    asStateRevision,
    asUnitInstanceId,
    type InstanceBaselineRef,
    type StateRevision,
    type UnitInstanceId,
} from './runtime-state';
import {
    deserializeMekTurnStateV2,
    type SerializedMekTurnStateV2,
} from './mek-turn-state-v2';
import {
    deserializeMekMovementPsrStateV2,
    serializeMekMovementPsrStateV2,
    type SerializedMekMovementPsrStateV2,
} from './mek-movement-psr-v2';
import {
    assertCanonicalCrewAssignment,
    type CrewAssignment,
    type CrewPositionDefinition,
} from './crew-assignment';
import {
    MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION,
    type CanonicalMekDeploymentConfigurationV2,
} from './unit-state-initializer';
import {
    MAX_MEK_HEATSINKS_OFF_V2,
    MAX_MEK_HEAT_VALUE_V2,
} from './mek-heat-state-v2';
import {
    CBT_FORCE_ROSTER_SCHEMA_VERSION,
    CBT_FORCE_UNASSIGNED_GROUP_ID,
    CBTForceRosterValidationError,
    MAX_CBT_FORCE_ROSTER_METADATA_LENGTH,
    type SerializedCBTForceRosterV1,
} from './cbt-force-roster';
import type {
    TnTargetMovementBracketId,
    TnTargetNumberCalculatorState,
    TnTargetHexCover,
    TnTargetUnitType,
} from '../target-number-calculator.model';
import type {
    MekRuleCheckKeyV2,
    MekRuleCheckStatusV2,
    MekRuleCheckTokenV2,
} from './mek-destruction-state-v2';
import {
    freezeAttackerTargetingState,
    attackerActionTargetKey,
    type AttackerActionSelection,
    type AttackerActionState,
    AttackerSelection,
    AttackerLocalTargetState,
} from './attacker-targeting-state';
import { asEncounterTargetId } from './encounter-runtime';
import {
    inspectSerializedNonMekUnit,
    type SerializedNonMekUnit,
} from './non-mek-unit-persistence';
import {
    isRuntimeHistoryMessageId,
    runtimeHistoryMessageCanReferenceUnit,
    runtimeHistoryMessageRequiresUnit,
    type SerializedRuntimeHistory,
} from './runtime-history';
import {
    freezeEquipmentRowOrder,
    type EquipmentRowOrderState,
} from './equipment-row-order';

export type { SerializedMekTurnStateV2 } from './mek-turn-state-v2';

export const CBT_FORCE_PERSISTENCE_SCHEMA_VERSION = 15 as const;
export const CBT_FORCE_MINIMUM_WRITER_VERSION = 16 as const;
export const CBT_UNIT_PERSISTENCE_SCHEMA_VERSION = 9 as const;
export const CBT_UNIT_RESTORATION_ALGORITHM_VERSION_V2 = 2 as const;
export const MAX_SERIALIZED_ENCOUNTER_FACTS = 1024;
export const MAX_SERIALIZED_ENCOUNTER_TARGETS = 12;
export const MAX_SERIALIZED_ENCOUNTER_NETWORKS = 100;

declare const persistenceBrand: unique symbol;
export type ForceId = string & { readonly [persistenceBrand]: 'ForceId' };
export type SavedTargetRef = string & { readonly [persistenceBrand]: 'SavedTargetRef' };
export type OneBasedCriticalSlotOrdinal = number & { readonly [persistenceBrand]: 'OneBasedCriticalSlotOrdinal' };

export function asForceId(value: string): ForceId {
    return asBoundedId(value, 'force ID') as ForceId;
}

export function asSavedTargetRef(value: string): SavedTargetRef {
    return asBoundedId(value, 'saved target reference') as SavedTargetRef;
}

export type SavedTargetRefKind =
    | 'location'
    | 'slot'
    | 'component'
    | 'system'
    | 'ammo'
    | 'crew';

/** Stable Entity-owned target identity used by sparse Mek runtime state. */
export function createSavedTargetRef(
    kind: SavedTargetRefKind,
    ...parts: readonly string[]
): SavedTargetRef {
    const expectedParts = kind === 'location' ? 2 : 1;
    if (parts.length !== expectedParts) {
        throw new Error(`${kind} target references require ${expectedParts} identity part(s)`);
    }
    parts.forEach(part => asBoundedId(part, 'saved target identity'));
    const prefix = kind === 'location'
        ? locationTargetPrefix(parts[1]!)
        : targetKindPrefix(kind);
    return asSavedTargetRef(`${prefix}:${parts[0]}`);
}

export interface ParsedSavedTargetRef {
    readonly kind: SavedTargetRefKind;
    readonly parts: readonly string[];
}

export function parseSavedTargetRef(value: string): ParsedSavedTargetRef | null {
    if (value.length < 3 || value[1] !== ':') return null;
    const id = value.slice(2);
    try {
        asBoundedId(id, 'saved target identity');
    } catch {
        return null;
    }
    switch (value[0]) {
        case 'i': return { kind: 'location', parts: [id, 'internal'] };
        case 'f': return { kind: 'location', parts: [id, 'front-armor'] };
        case 'r': return { kind: 'location', parts: [id, 'rear-armor'] };
        case 's': return { kind: 'slot', parts: [id] };
        case 'c': return { kind: 'component', parts: [id] };
        case 'y': return { kind: 'system', parts: [id] };
        case 'm': return { kind: 'ammo', parts: [id] };
        case 'w': return { kind: 'crew', parts: [id] };
        default: return null;
    }
}

function locationTargetPrefix(section: string): string {
    switch (section) {
        case 'internal': return 'i';
        case 'front-armor': return 'f';
        case 'rear-armor': return 'r';
        default: throw new Error(`Unknown location target section ${section}`);
    }
}

function targetKindPrefix(kind: Exclude<SavedTargetRefKind, 'location'>): string {
    switch (kind) {
        case 'slot': return 's';
        case 'component': return 'c';
        case 'system': return 'y';
        case 'ammo': return 'm';
        case 'crew': return 'w';
    }
}

function inferredSavedTarget(value: string): SavedStateTargetV2 | null {
    const parsed = parseSavedTargetRef(value);
    if (!parsed) return null;
    const id = parsed.parts[0]!;
    switch (parsed.kind) {
        case 'location': {
            const section = parsed.parts[1];
            if (section !== 'internal' && section !== 'front-armor' && section !== 'rear-armor') return null;
            return { kind: 'location-section', location: id, section };
        }
        case 'slot':
            return { kind: 'critical-slot', savedSlotId: id, location: id, slot: asOneBasedCriticalSlotOrdinal(1) };
        case 'component':
            return { kind: 'component', savedComponentId: id, equipmentName: id, locations: [], criticalSlots: [] };
        case 'system':
            return { kind: 'intrinsic-system', savedComponentId: id, systemKey: id, locations: [], criticalSlots: [] };
        case 'ammo':
            return {
                kind: 'ammo-source',
                savedAmmoSourceId: id,
                source: { kind: 'installed-bin', savedComponentId: id, equipmentName: id },
                criticalSlots: [],
            };
        case 'crew':
            return { kind: 'crew-position', savedCrewPositionId: id, positionKey: id };
    }
}

/** Builds only the target kinds needed to validate a compact pre-Entity snapshot. */
function inferActiveSavedTargets(value: unknown): Record<string, SavedStateTargetV2> {
    const targets: Record<string, SavedStateTargetV2> = {};
    const visit = (candidate: unknown): void => {
        if (typeof candidate === 'string') {
            const target = inferredSavedTarget(candidate);
            if (target) targets[candidate] = target;
            return;
        }
        if (Array.isArray(candidate)) {
            candidate.forEach(visit);
            return;
        }
        if (candidate !== null && typeof candidate === 'object') {
            Object.values(candidate as Record<string, unknown>).forEach(visit);
        }
    };
    visit(value);
    return targets;
}

export function asOneBasedCriticalSlotOrdinal(value: number): OneBasedCriticalSlotOrdinal {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid one-based slot ordinal: ${value}`);
    return value as OneBasedCriticalSlotOrdinal;
}

function asBoundedId(value: string, label: string): string {
    if (!value.trim() || value.length > 512 || value.includes('\0')) {
        throw new Error(`Invalid ${label}`);
    }
    return value;
}

export interface SavedSlotCoordinateV2 {
    readonly location: string;
    readonly slot: OneBasedCriticalSlotOrdinal;
}

export type SavedStateTargetV2 =
    | {
        readonly kind: 'critical-slot';
        readonly savedSlotId?: string;
        readonly location: string;
        readonly slot: OneBasedCriticalSlotOrdinal;
        readonly expectedSystemId?: string;
        readonly expectedEquipmentName?: string;
        readonly expectedOriginalName?: string;
        readonly expectedDisplayName?: string;
        readonly expectedAmmoRole?: string;
        readonly legacyId?: string;
        readonly rawLegacyLocation?: string;
        readonly rawLegacySlot?: number;
    }
    | {
        readonly kind: 'location-section';
        readonly location: string;
        readonly section: 'internal' | 'front-armor' | 'rear-armor';
    }
    | {
        readonly kind: 'component';
        readonly savedComponentId?: string;
        readonly equipmentName: string;
        readonly locations: readonly string[];
        readonly criticalSlots: readonly SavedSlotCoordinateV2[];
        readonly occurrence?: number;
        readonly capacity?: number;
        readonly legacySummaryComponentIndex?: number;
        readonly legacyBinIndex?: number;
    }
    | {
        readonly kind: 'ammo-source';
        readonly savedAmmoSourceId?: string;
        readonly source:
            | {
                readonly kind: 'installed-bin';
                readonly savedComponentId?: string;
                readonly equipmentName: string;
            }
            | {
                readonly kind: 'intrinsic-magazine' | 'one-shot';
                readonly ownerComponentTarget: SavedTargetRef;
                readonly equipmentName: string;
            };
        readonly location?: string;
        readonly criticalSlots: readonly SavedSlotCoordinateV2[];
        readonly occurrence?: number;
        readonly capacityAtSave?: number;
        readonly munitionAtSave?: string;
        readonly legacySummaryComponentIndex?: number;
        readonly legacyBinIndex?: number;
    }
    | {
        readonly kind: 'intrinsic-system';
        readonly savedComponentId?: string;
        readonly legacySystemId?: string;
        readonly systemKey: string;
        readonly aliases?: readonly string[];
        readonly locations: readonly string[];
        readonly criticalSlots: readonly SavedSlotCoordinateV2[];
    }
    | {
        readonly kind: 'crew-position';
        readonly savedCrewPositionId?: string;
        readonly positionKey: string;
        readonly aliases?: readonly string[];
        readonly occurrence?: number;
    };

/** Unit-owned witness table. It is rebuilt for the exact baseline saved with this unit. */
export interface SavedBlueprintReferenceTableV2 {
    readonly schemaVersion: 1;
    readonly targets: Readonly<Record<SavedTargetRef, SavedStateTargetV2>>;
}

/**
 * Returns the canonical transitive source-table closure for active recovery roots.
 * Intrinsic/one-shot ammo targets depend on their owner component target; callers
 * must retain that owner even when it is not itself an unresolved recovery row.
 */
export function savedTargetReferenceClosureV2(
    targets: Readonly<Record<SavedTargetRef, SavedStateTargetV2>>,
    roots: readonly SavedTargetRef[],
): readonly SavedTargetRef[] | undefined {
    const retained = new Set<SavedTargetRef>();
    const pending = [...new Set(roots)].sort(compareSavedTargetRefs);
    while (pending.length > 0) {
        const ref = pending.shift()!;
        if (retained.has(ref)) continue;
        const target = targets[ref];
        if (target === undefined) return undefined;
        retained.add(ref);
        if (target.kind === 'ammo-source' && target.source.kind !== 'installed-bin') {
            pending.push(target.source.ownerComponentTarget);
            pending.sort(compareSavedTargetRefs);
        }
    }
    return Object.freeze([...retained].sort(compareSavedTargetRefs));
}

function compareSavedTargetRefs(left: SavedTargetRef, right: SavedTargetRef): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

export interface SerializedDeploymentConfigurationV2 {
    readonly schemaVersion: typeof MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION;
    readonly values: CanonicalMekDeploymentConfigurationV2;
}

export interface SerializedLocationStateEntryV2 {
    readonly target: SavedTargetRef;
    readonly damage: number;
}

/**
 * One sparse, closed-vocabulary location condition fact. The target must be
 * the location's `internal` section so the condition has one stable LocationId
 * witness rather than an armor-facing-dependent identity.
 */
export interface SerializedLocationConditionStateEntryV2 {
    readonly target: SavedTargetRef;
    readonly condition: MekLocationConditionKey;
    /** Positive when committed; pending entries also use zero as explicit removal. */
    readonly value: number;
}

export interface SerializedSlotStateEntryV2 {
    readonly target: SavedTargetRef;
    readonly hits: number;
    /** Sparse: absence means the slot became unavailable on turn zero. */
    readonly destroyedTurn?: number;
}

export interface SerializedComponentStateEntryV2 {
    readonly target: SavedTargetRef;
    readonly statusOverride?: Exclude<EquipmentStatus, 'available'>;
    readonly mode?: string;
    readonly jammed?: boolean;
    readonly escalatingFailure?: EscalatingFailureRuntimeState;
    readonly ppcCapacitor?: PpcCapacitorRuntimeState;
    readonly bombastLaser?: BombastLaserRuntimeState;
    readonly c3EmergencyMaster?: C3EmergencyMasterRuntimeState;
    readonly gaussPower?: ComponentRuntimeState['gaussPower'];
    readonly shieldDamage?: ComponentRuntimeState['shieldDamage'];
    readonly modularArmorDamage?: number;
}

export interface SerializedAmmoStateEntryV2 {
    readonly target: SavedTargetRef;
    readonly shotsSpent: number;
    readonly munitionOverride?: string;
}

export interface SerializedCrewStateV2 {
    readonly schemaVersion: 1;
    readonly positions: readonly {
        readonly target: SavedTargetRef;
        readonly wounds: number;
        readonly unconscious: boolean;
        /** Sparse state: omitted is canonical false. */
        readonly ejected?: true;
    }[];
}

export interface SerializedHeatStateV2 {
    /** Current remains named `heat` for snapshots written by the scalar V2 codec. */
    readonly heat: number;
    readonly previous?: number;
    readonly pendingOverride?: number;
    readonly heatsinksOff?: number;
}

export interface SerializedCommonConditionStateV2 {
    readonly values: readonly UnitConditionKey[];
}

export interface SerializedPendingCombatStateV2 {
    readonly locationDamage?: readonly SerializedLocationStateEntryV2[];
    readonly locationConditions?: readonly SerializedLocationConditionStateEntryV2[];
    readonly slotHits?: readonly SerializedSlotStateEntryV2[];
    readonly componentStatus?: readonly {
        readonly target: SavedTargetRef;
        readonly status: EquipmentStatus;
    }[];
    readonly shieldDamage?: readonly {
        readonly target: SavedTargetRef;
        readonly absorptionDamage: number;
        readonly capacityDamage: number;
    }[];
    readonly modularArmorDamage?: readonly {
        readonly target: SavedTargetRef;
        readonly damage: number;
    }[];
}

export type SerializedRecoverableStateFactV2 =
    | { readonly kind: 'location-damage'; readonly damage: number }
    | {
        readonly kind: 'location-condition';
        readonly condition: MekLocationConditionKey;
        readonly value: number;
    }
    | { readonly kind: 'slot-hits'; readonly hits: number; readonly destroyedTurn?: number }
    | {
        readonly kind: 'component-state';
        readonly statusOverride?: Exclude<EquipmentStatus, 'available'>;
        readonly mode?: string;
        readonly jammed?: boolean;
        readonly escalatingFailure?: EscalatingFailureRuntimeState;
        readonly ppcCapacitor?: PpcCapacitorRuntimeState;
        readonly bombastLaser?: BombastLaserRuntimeState;
        readonly c3EmergencyMaster?: C3EmergencyMasterRuntimeState;
        readonly gaussPower?: ComponentRuntimeState['gaussPower'];
        readonly shieldDamage?: ComponentRuntimeState['shieldDamage'];
        readonly modularArmorDamage?: number;
    }
    | { readonly kind: 'ammo-state'; readonly shotsSpent: number; readonly munitionOverride?: string }
    | {
        readonly kind: 'crew-state';
        readonly wounds: number;
        readonly unconscious: boolean;
        /** Omitted is canonical false. */
        readonly ejected?: true;
    }
    | {
        readonly kind: 'mek-rule-check';
        readonly key: MekRuleCheckKeyV2;
        readonly token: MekRuleCheckTokenV2;
        readonly openedRevision: StateRevision;
        readonly status: MekRuleCheckStatusV2;
    }
    | { readonly kind: 'pending-location-damage'; readonly damage: number }
    | {
        readonly kind: 'pending-location-condition';
        readonly condition: MekLocationConditionKey;
        readonly value: number;
    }
    | { readonly kind: 'pending-slot-hits'; readonly hits: number }
    | { readonly kind: 'pending-component-status'; readonly status: EquipmentStatus }
    | {
        readonly kind: 'pending-shield-damage';
        readonly absorptionDamage: number;
        readonly capacityDamage: number;
    }
    | { readonly kind: 'pending-modular-armor-damage'; readonly damage: number };

export interface SerializedUnresolvedStateRecoveryEntryV2 {
    readonly recoveryId: string;
    /** Exact source-table occurrence; target content alone is not a unique provenance key. */
    readonly sourceTargetRef: SavedTargetRef;
    readonly sourceTarget: SavedStateTargetV2;
    readonly fact: SerializedRecoverableStateFactV2;
    readonly reason: string;
}

export interface SerializedPersistedRestoreAliasV2 {
    /** Exact source-table occurrence selected by the repair owner. */
    readonly sourceTargetRef: SavedTargetRef;
    readonly targetEntity: SavedEntityIdentity;
    readonly target: SavedTargetRef;
    readonly algorithmVersion: number;
}

/** Durable user decision for one exact recovery occurrence. */
export interface SerializedIgnoredStateRecoveryDecisionV2 {
    readonly recoveryId: string;
    readonly algorithmVersion: number;
}

/** Exact classifier inputs retained whenever typed V2 recovery remains unresolved. */
export interface SerializedMekHeatRecoveryAuthorityV1 {
    readonly schemaVersion: 1;
    readonly sourceReferences: SavedBlueprintReferenceTableV2;
    readonly targetTranslation: Readonly<Record<SavedTargetRef, SavedTargetRef>>;
    readonly currentReferences: SavedBlueprintReferenceTableV2;
}

export type SerializedRestorationBaselineV2 =
    | InstanceBaselineRef
    | {
        readonly kind: 'legacy-v1';
        readonly coordinateProfileVersion: number;
    };

/** Unit-local restoration evidence stays inside its unit snapshot. */
export interface SerializedUnitRestorationMetadataV2 {
    readonly schemaVersion: 1;
    readonly algorithmVersion: number;
    readonly fromBaseline: SerializedRestorationBaselineV2;
    readonly sourceChanged: boolean;
    readonly warnings: readonly { readonly code: string; readonly message: string }[];
    readonly unresolved: readonly SerializedUnresolvedStateRecoveryEntryV2[];
    readonly acceptedAliases: readonly SerializedPersistedRestoreAliasV2[];
    /** Omitted when no recovery decision was explicitly ignored. */
    readonly ignoredRecovery?: readonly SerializedIgnoredStateRecoveryDecisionV2[];
    /** Required for writable unit V4 whenever typed unresolved entries remain. */
    readonly heatRecovery?: SerializedMekHeatRecoveryAuthorityV1;
}

export interface SerializedMekRuleCheckEntryV1 {
    readonly key: MekRuleCheckKeyV2;
    readonly token: MekRuleCheckTokenV2;
    readonly trigger: SavedTargetRef;
    readonly openedRevision: StateRevision;
    readonly status: MekRuleCheckStatusV2;
}

export interface SerializedMekRuleChecksV1 {
    readonly schemaVersion: 1;
    /** Canonically sorted by key; required even when empty in unit schema V3. */
    readonly entries: readonly SerializedMekRuleCheckEntryV1[];
}

/** Blueprint-local IDs use the unit's existing SavedBlueprintReferenceTableV2. */
export interface SavedAttackerTargetingState {
    readonly schemaVersion: 1;
    readonly components: readonly {
        readonly target: SavedTargetRef;
        readonly selection?: AttackerSelection;
        readonly ammo?: {
            readonly munitionKey: string;
            readonly preferredSourceTarget?: SavedTargetRef;
        };
    }[];
    readonly actions: readonly (
        | {
            readonly kind: 'intrinsic';
            readonly actionId: string;
            readonly selection: AttackerSelection;
        }
        | {
            readonly kind: 'component';
            readonly target: SavedTargetRef;
            readonly selection: AttackerSelection;
        }
    )[];
    readonly targets: readonly ({
        readonly targetId: string;
    } & AttackerLocalTargetState)[];
}

export interface SerializedCBTUnitV2 {
    readonly schemaVersion: typeof CBT_UNIT_PERSISTENCE_SCHEMA_VERSION;
    readonly instanceId: UnitInstanceId;
    readonly entity: SavedEntityIdentity;
    readonly baselineRefAtSave: InstanceBaselineRef;
    readonly blueprintReferences: SavedBlueprintReferenceTableV2;
    readonly deployment: SerializedDeploymentConfigurationV2;
    readonly stateRevision: StateRevision;
    /** Sparse committed fact; absence is the pristine false baseline. */
    readonly destroyed?: true;
    readonly locationState?: readonly SerializedLocationStateEntryV2[];
    readonly locationConditions?: readonly SerializedLocationConditionStateEntryV2[];
    readonly slotState?: readonly SerializedSlotStateEntryV2[];
    readonly componentState?: readonly SerializedComponentStateEntryV2[];
    readonly ammoState?: readonly SerializedAmmoStateEntryV2[];
    readonly crew: SerializedCrewStateV2;
    readonly heat?: SerializedHeatStateV2;
    readonly family: { readonly kind: 'mek' };
    readonly ruleChecks: SerializedMekRuleChecksV1;
    /** Required sole durable movement/PSR owner. */
    readonly movementPsr: SerializedMekMovementPsrStateV2;
    /** Required sole durable attacker-local targeting owner. */
    readonly attackerTargeting: SavedAttackerTargetingState;
    readonly equipmentRowOrder?: EquipmentRowOrderState;
    readonly conditions?: SerializedCommonConditionStateV2;
    readonly turn: SerializedMekTurnStateV2;
    readonly pendingCombat?: SerializedPendingCombatStateV2;
    readonly restoration?: SerializedUnitRestorationMetadataV2;
}

export type SerializedForceUnitEntryV2 =
    | {
        readonly kind: 'ready';
        readonly instanceId: UnitInstanceId;
        readonly stateRevision: StateRevision;
        readonly unit: SerializedCBTUnitV2 | SerializedNonMekUnit;
    }
    | {
        readonly kind: 'deferred';
        readonly instanceId: UnitInstanceId;
        readonly stateRevision: StateRevision;
        readonly source: DeferredUnitSource;
    };

export interface SerializedEncounterEndpointV2 {
    readonly instanceId: UnitInstanceId;
    readonly target?: SavedTargetRef;
}

export type SerializedEncounterTargetCalculatorV2 = Pick<TnTargetNumberCalculatorState,
    | 'isAirborne'
    | 'targetMovementBracket'
    | 'targetMovementDistance'
    | 'skidding'
    | 'prone'
    | 'immobile'
    | 'targetHexCover'
    | 'waterDepth'
    | 'buildingCover'
    | 'targetHeight'
    | 'largeTarget'
    | 'narcAboveWater'
    | 'narcUnderwater'
    | 'tagged'
    | 'ecmShielded'
    | 'stealth'
    | 'stealthSystem'>;

/** Force-shared target definition. Attacker-local range, C3 use, and TN deltas belong to each unit. */
export interface SerializedEncounterTargetV2 {
    readonly id: string;
    readonly letter: string;
    readonly name: string;
    readonly color: string;
    readonly source?: 'manual' | 'opfor';
    readonly readOnly?: boolean;
    readonly unitType?: TnTargetUnitType;
    readonly tnCalculator?: SerializedEncounterTargetCalculatorV2;
}

export type SerializedEncounterNetworkTypeV2 = 'c3' | 'c3i' | 'naval' | 'nova';

export interface SerializedEncounterNetworkEndpointV2 {
    readonly instanceId: UnitInstanceId;
    /** Stable entity component identity. Numeric equipment positions are deliberately forbidden. */
    readonly componentId: ComponentId;
    readonly role: 'master' | 'member' | 'peer';
}

export interface SerializedEncounterNetworkV2 {
    readonly id: string;
    readonly networkType: SerializedEncounterNetworkTypeV2;
    readonly color: string;
    readonly endpoints: readonly SerializedEncounterNetworkEndpointV2[];
}

export function encounterTargetFactId(targetId: string): string {
    return `target:${targetId.length}:${targetId}`;
}

export function encounterNetworkFactId(networkId: string): string {
    return `network:${networkId.length}:${networkId}`;
}

export type SerializedEncounterFactV2 =
    | {
        readonly kind: 'target';
        readonly factId: string;
        readonly target: SerializedEncounterTargetV2;
    }
    | {
        readonly kind: 'network';
        readonly factId: string;
        readonly network: SerializedEncounterNetworkV2;
    }
    | {
        readonly kind: 'network-link';
        readonly factId: string;
        readonly networkType: string;
        readonly endpoints: readonly SerializedEncounterEndpointV2[];
    }
    | {
        readonly kind: 'cross-unit-effect';
        readonly factId: string;
        readonly effectKey: string;
        readonly source?: SerializedEncounterEndpointV2;
        readonly target: SerializedEncounterEndpointV2;
    };

export interface SerializedCBTEncounterStateV2 {
    readonly schemaVersion: 2;
    readonly encounterRevision: StateRevision;
    readonly facts: readonly SerializedEncounterFactV2[];
}

export interface SerializedForceEncounterEntryV2 {
    readonly encounterRevision: StateRevision;
    readonly state: SerializedCBTEncounterStateV2;
    /** Raw V1 cross-unit facts retained only for recovery; never live mechanics. */
    readonly recovery?: ForceRecoveryEvidence;
}

/** Force-owned recovery rows that could not be attached to the typed encounter. */
export interface SerializedForceRestorationMetadataV2 {
    readonly schemaVersion: 2;
    readonly unresolvedEncounter: readonly {
        readonly recoveryId: string;
        readonly fact: SerializedEncounterFactV2;
        readonly reason: string;
    }[];
}

export interface SerializedScenarioRulesV2 {
    readonly schemaVersion: 1;
    readonly values: JsonValue;
}

export interface SerializedCBTForceV2 {
    readonly schemaVersion: typeof CBT_FORCE_PERSISTENCE_SCHEMA_VERSION;
    readonly minimumWriterVersion: typeof CBT_FORCE_MINIMUM_WRITER_VERSION;
    readonly forceId: ForceId;
    readonly forceRevision: StateRevision;
    readonly scenarioRules: SerializedScenarioRulesV2;
    readonly history: SerializedRuntimeHistory;
    readonly units: readonly SerializedForceUnitEntryV2[];
    readonly roster: SerializedCBTForceRosterV1;
    readonly encounter: SerializedForceEncounterEntryV2;
    readonly restoration?: SerializedForceRestorationMetadataV2;
}

export type ForceEnvelopeValidationCode =
    | 'INVALID_SHAPE'
    | 'DUPLICATE_INSTANCE_ID'
    | 'DUPLICATE_ROSTER_GROUP_ID'
    | 'DUPLICATE_ROSTER_MEMBER_ID'
    | 'DANGLING_ROSTER_MEMBER_ID'
    | 'MISSING_ROSTER_MEMBER_ID'
    | 'ROSTER_KIND_MISMATCH'
    | 'ROSTER_ORDER_MISMATCH'
    | 'ROSTER_COMMANDER_CONFLICT'
    | 'INSTANCE_ID_MISMATCH'
    | 'REVISION_MISMATCH'
    | 'DESIGN_IDENTITY_MISMATCH'
    | 'DUPLICATE_TARGET_REF'
    | 'DANGLING_TARGET_REF'
    | 'TARGET_KIND_MISMATCH'
    | 'DUPLICATE_STATE_TARGET'
    | 'ENCOUNTER_ENDPOINT_INVALID';

export class ForceEnvelopeValidationError extends Error {
    public constructor(
        public readonly code: ForceEnvelopeValidationCode,
        message: string,
        public readonly path = '$',
    ) {
        super(`${path}: ${message}`);
        this.name = 'ForceEnvelopeValidationError';
    }
}

/** The encounter is present even before any cross-unit state exists. */
export function emptySerializedEncounterV2(): SerializedForceEncounterEntryV2 {
    const revision = asStateRevision(0);
    return Object.freeze({
        encounterRevision: revision,
        state: Object.freeze({ schemaVersion: 2, encounterRevision: revision, facts: Object.freeze([]) }),
    });
}

export function emptyRuntimeHistory(): SerializedRuntimeHistory {
    return Object.freeze({ u: Object.freeze([]), t: Object.freeze([]) });
}

/** Validates structure, ownership, and identity; failures never partially load. */
export async function validateSerializedCBTForceV2(value: unknown): Promise<SerializedCBTForceV2> {
    let root: Record<string, unknown>;
    try {
        root = requireRecord(structuredClone(value), '$');
    } catch (error) {
        throw validationError('INVALID_SHAPE', error, '$');
    }
    validateForceEnvelope(root);
    return deepFreeze(root);
}

function validateForceEnvelope(
    root: Record<string, unknown>,
): asserts root is Record<string, unknown> & SerializedCBTForceV2 {
    exactKeys(root, [
        'schemaVersion', 'minimumWriterVersion', 'forceId', 'forceRevision', 'scenarioRules',
        'history', 'units', 'roster', 'encounter', 'restoration',
    ], '$');
    if (root['schemaVersion'] !== CBT_FORCE_PERSISTENCE_SCHEMA_VERSION
        || root['minimumWriterVersion'] !== CBT_FORCE_MINIMUM_WRITER_VERSION) {
        fail('INVALID_SHAPE', '$', 'unsupported persistence or writer version');
    }
    validateId(root['forceId'], '$.forceId', asForceId);
    validateRevision(root['forceRevision'], '$.forceRevision');
    validateScenarioRules(root['scenarioRules']);

    const units = requireArray(root['units'], '$.units');
    const instanceKinds = new Map<string, 'ready' | 'deferred'>();
    const unitTargets = new Map<string, ReadonlySet<string>>();
    units.forEach((entry, index) => {
        const result = validateUnitEntry(entry, index);
        if (instanceKinds.has(result.instanceId)) {
            fail('DUPLICATE_INSTANCE_ID', `$.units[${index}].instanceId`, `duplicate instance ${result.instanceId}`);
        }
        instanceKinds.set(result.instanceId, result.kind);
        if (result.targets) unitTargets.set(result.instanceId, result.targets);
    });

    validateRoster(root['roster'], instanceKinds);
    const encounterFacts = validateEncounter(root['encounter'], instanceKinds, unitTargets);
    validateRuntimeHistory(root['history']);
    validateForceRestoration(root['restoration'], encounterFacts);
}

function validateRuntimeHistory(value: unknown): void {
    const history = requireRecord(value, '$.history');
    exactKeys(history, ['u', 't'], '$.history');
    const unitIds = requireArray(history['u'], '$.history.u').map((unitId, index) =>
        validateId(unitId, `$.history.u[${index}]`, asUnitInstanceId));
    if (new Set(unitIds).size !== unitIds.length) {
        fail('INVALID_SHAPE', '$.history.u', 'unit IDs must be unique');
    }
    const turns = requireArray(history['t'], '$.history.t');
    if (turns.length > 2) {
        fail('INVALID_SHAPE', '$.history.t', 'history retains at most the current and previous turn');
    }
    let previousTurn = 0;
    turns.forEach((rawTurn, turnIndex) => {
        const path = `$.history.t[${turnIndex}]`;
        const turn = requireRecord(rawTurn, path);
        exactKeys(turn, ['n', 'p'], path);
        const number = requirePositiveInteger(turn['n'], `${path}.n`);
        if (number <= previousTurn) fail('INVALID_SHAPE', `${path}.n`, 'turns must be strictly ordered');
        previousTurn = number;
        const phases = requireArray(turn['p'], `${path}.p`);
        if (phases.length === 0) fail('INVALID_SHAPE', `${path}.p`, 'history turn requires a phase');
        phases.forEach((rawPhase, phaseIndex) => {
            const phasePath = `${path}.p[${phaseIndex}]`;
            const messages = requireArray(rawPhase, phasePath);
            if (messages.length === 0) fail('INVALID_SHAPE', phasePath, 'history phases cannot be empty');
            messages.forEach((rawMessage, messageIndex) => {
                const messagePath = `${phasePath}[${messageIndex}]`;
                const message = requireArray(rawMessage, messagePath);
                if (message.length < 1 || message.length > 13) {
                    fail('INVALID_SHAPE', messagePath, 'history messages require 1 to 13 values');
                }
                if (!isRuntimeHistoryMessageId(message[0])) {
                    fail('INVALID_SHAPE', `${messagePath}[0]`, 'is not a supported history message ID');
                }
                message.slice(1).forEach((item, index) => assertJson(item, `${messagePath}[${index + 1}]`));
                const messageId = message[0];
                if (runtimeHistoryMessageRequiresUnit(messageId) && message.length < 2) {
                    fail('INVALID_SHAPE', messagePath, 'unit history message requires a unit index');
                }
                if (runtimeHistoryMessageCanReferenceUnit(messageId) && message.length >= 2) {
                    const unitIndex = message[1];
                    if (!Number.isSafeInteger(unitIndex) || (unitIndex as number) < 0
                        || (unitIndex as number) >= unitIds.length) {
                        fail('INVALID_SHAPE', `${messagePath}[1]`, 'invalid history unit index');
                    }
                }
            });
        });
    });
}

function validateRoster(
    value: unknown,
    instances: ReadonlyMap<string, 'ready' | 'deferred'>,
): void {
    const roster = requireRecord(value, '$.roster');
    exactKeys(roster, ['schemaVersion', 'groups'], '$.roster');
    if (roster['schemaVersion'] !== CBT_FORCE_ROSTER_SCHEMA_VERSION) {
        fail('INVALID_SHAPE', '$.roster.schemaVersion', `must be ${CBT_FORCE_ROSTER_SCHEMA_VERSION}`);
    }
    const groups = requireArray(roster['groups'], '$.roster.groups');
    const groupIds = new Set<string>();
    const memberIds = new Set<string>();
    groups.forEach((rawGroup, groupIndex) => {
        const path = `$.roster.groups[${groupIndex}]`;
        const group = requireRecord(rawGroup, path);
        exactKeys(group, [
            'groupId', 'order', 'name', 'color', 'formationId', 'formationTargetGroupId',
            'formationLock', 'members',
        ], path);
        const groupId = validateId(group['groupId'], `${path}.groupId`);
        if (groupIds.has(groupId)) {
            fail('DUPLICATE_ROSTER_GROUP_ID', `${path}.groupId`, `duplicate roster group ${groupId}`);
        }
        groupIds.add(groupId);
        if (requireSafeNonnegative(group['order'], `${path}.order`) !== groupIndex) {
            fail('ROSTER_ORDER_MISMATCH', `${path}.order`, 'must equal the canonical group array index');
        }
        validateOptionalCanonicalRosterText(
            group,
            path,
            ['name', 'color', 'formationId', 'formationTargetGroupId'],
        );
        validateSparseRosterTrue(group, 'formationLock', path);
        if (groupId === CBT_FORCE_UNASSIGNED_GROUP_ID) {
            if (groupIndex !== groups.length - 1) {
                fail('ROSTER_ORDER_MISMATCH', path, 'the unassigned roster group must be last');
            }
            if (group['name'] !== undefined
                || group['color'] !== undefined
                || group['formationId'] !== undefined
                || group['formationTargetGroupId'] !== undefined
                || group['formationLock'] !== undefined) {
                fail('INVALID_SHAPE', path, 'the unassigned roster group cannot carry organizational metadata');
            }
        }
        const members = requireArray(group['members'], `${path}.members`);
        let commanderInstanceId: string | undefined;
        members.forEach((rawMember, memberIndex) => {
            const memberPath = `${path}.members[${memberIndex}]`;
            const member = requireRecord(rawMember, memberPath);
            exactKeys(member, ['instanceId', 'kind', 'order', 'commander'], memberPath);
            const instanceId = validateId(member['instanceId'], `${memberPath}.instanceId`, asUnitInstanceId);
            if (memberIds.has(instanceId)) {
                fail(
                    'DUPLICATE_ROSTER_MEMBER_ID',
                    `${memberPath}.instanceId`,
                    `duplicate roster member ${instanceId}`,
                );
            }
            memberIds.add(instanceId);
            const kind = member['kind'];
            if (kind !== 'ready' && kind !== 'deferred') {
                fail('INVALID_SHAPE', `${memberPath}.kind`, 'must be ready or deferred');
            }
            const ownedKind = instances.get(instanceId);
            if (!ownedKind) {
                fail(
                    'DANGLING_ROSTER_MEMBER_ID',
                    `${memberPath}.instanceId`,
                    `roster member ${instanceId} has no force unit entry`,
                );
            }
            if (ownedKind !== kind) {
                fail(
                    'ROSTER_KIND_MISMATCH',
                    `${memberPath}.kind`,
                    `${instanceId} is ${ownedKind}, not ${kind}`,
                );
            }
            if (groupId === CBT_FORCE_UNASSIGNED_GROUP_ID && kind !== 'ready') {
                fail(
                    'ROSTER_KIND_MISMATCH',
                    `${memberPath}.kind`,
                    'the unassigned roster group can contain only ready entries',
                );
            }
            if (requireSafeNonnegative(member['order'], `${memberPath}.order`) !== memberIndex) {
                fail('ROSTER_ORDER_MISMATCH', `${memberPath}.order`, 'must equal the canonical member array index');
            }
            validateSparseRosterTrue(member, 'commander', memberPath);
            if (member['commander'] === true) {
                if (commanderInstanceId !== undefined) {
                    fail(
                        'ROSTER_COMMANDER_CONFLICT',
                        `${memberPath}.commander`,
                        `roster group ${groupId} may contain at most one commander; ${instanceId} conflicts with ${commanderInstanceId}`,
                    );
                }
                commanderInstanceId = instanceId;
            }
        });
    });
    groups.forEach((rawGroup, groupIndex) => {
        const group = rawGroup as Record<string, unknown>;
        const targetGroupId = group['formationTargetGroupId'];
        if (targetGroupId === undefined) return;
        const path = `$.roster.groups[${groupIndex}].formationTargetGroupId`;
        if (targetGroupId === group['groupId']
            || targetGroupId === CBT_FORCE_UNASSIGNED_GROUP_ID
            || !groupIds.has(targetGroupId as string)) {
            fail('INVALID_SHAPE', path, 'must reference another regular roster group');
        }
    });
    for (const instanceId of instances.keys()) {
        if (!memberIds.has(instanceId)) {
            fail(
                'MISSING_ROSTER_MEMBER_ID',
                '$.roster.groups',
                `force unit ${instanceId} has no roster member`,
            );
        }
    }
}

function validateOptionalCanonicalRosterText(
    record: Record<string, unknown>,
    path: string,
    keys: readonly ('name' | 'color' | 'formationId' | 'formationTargetGroupId')[],
): void {
    for (const key of keys) {
        if (record[key] !== undefined) {
            validateBoundedText(record[key], `${path}.${key}`, 1, MAX_CBT_FORCE_ROSTER_METADATA_LENGTH);
        }
    }
}

function validateSparseRosterTrue(
    record: Record<string, unknown>,
    key: 'formationLock' | 'commander',
    path: string,
): void {
    if (record[key] !== undefined && record[key] !== true) {
        fail('INVALID_SHAPE', `${path}.${key}`, 'sparse organizational flag must be true when present');
    }
}

function validateScenarioRules(value: unknown): void {
    const record = requireRecord(value, '$.scenarioRules');
    exactKeys(record, ['schemaVersion', 'values'], '$.scenarioRules');
    if (record['schemaVersion'] !== 1) fail('INVALID_SHAPE', '$.scenarioRules.schemaVersion', 'must be 1');
    assertJson(record['values'], '$.scenarioRules.values');
}

interface ValidatedUnitEntry {
    readonly kind: 'ready' | 'deferred';
    readonly instanceId: string;
    readonly targets?: ReadonlySet<string>;
    readonly components?: ReadonlySet<string>;
}

function validateUnitEntry(
    value: unknown,
    index: number,
): ValidatedUnitEntry {
    const path = `$.units[${index}]`;
    const record = requireRecord(value, path);
    const kind = record['kind'];
    if (kind !== 'ready' && kind !== 'deferred') {
        fail('INVALID_SHAPE', `${path}.kind`, 'must discriminate a ready or deferred unit');
    }
    exactKeys(record, kind === 'ready'
        ? ['kind', 'instanceId', 'stateRevision', 'unit']
        : ['kind', 'instanceId', 'stateRevision', 'source'], path);
    const instanceId = validateId(record['instanceId'], `${path}.instanceId`, asUnitInstanceId);
    const revision = validateRevision(record['stateRevision'], `${path}.stateRevision`);
    if (kind === 'ready') {
        const unit = requireRecord(record['unit'], `${path}.unit`);
        const family = requireRecord(unit['family'], `${path}.unit.family`);
        const result = family['kind'] === 'non-mek'
            ? validateNonMekUnit(unit, `${path}.unit`)
            : validateV2Unit(unit, `${path}.unit`);
        if (result.instanceId !== instanceId) {
            fail('INSTANCE_ID_MISMATCH', `${path}.unit.instanceId`, 'outer and unit instance IDs differ');
        }
        if (result.revision !== revision) {
            fail('REVISION_MISMATCH', `${path}.unit.stateRevision`, 'outer and unit revisions differ');
        }
        return { kind, instanceId, targets: result.targets, components: result.components };
    }
    validateDeferredSource(record['source'], `${path}.source`);
    return { kind, instanceId };
}

function validateNonMekUnit(
    value: unknown,
    path: string,
): {
    readonly instanceId: string;
    readonly revision: number;
    readonly targets: ReadonlySet<string>;
    readonly components: ReadonlySet<string>;
} {
    try {
        const inspected = inspectSerializedNonMekUnit(value);
        return {
            instanceId: inspected.instanceId,
            revision: inspected.stateRevision,
            targets: new Set(),
            components: new Set(),
        };
    } catch (error) {
        fail(
            'INVALID_SHAPE',
            path,
            error instanceof Error ? error.message : 'invalid non-Mek non-Mek unit',
        );
    }
}

function validateV2Unit(
    value: unknown,
    path: string,
): {
    readonly instanceId: string;
    readonly revision: number;
    readonly targets: ReadonlySet<string>;
    readonly components: ReadonlySet<string>;
} {
    const record = requireRecord(value, path);
    exactKeys(record, [
        'schemaVersion', 'instanceId', 'entity', 'baselineRefAtSave', 'blueprintReferences', 'deployment',
        'stateRevision', 'destroyed', 'locationState', 'locationConditions', 'slotState', 'componentState', 'ammoState', 'crew', 'heat',
        'family', 'ruleChecks', 'movementPsr', 'attackerTargeting',
        'equipmentRowOrder', 'conditions', 'turn', 'pendingCombat', 'restoration',
    ], path);
    if (record['schemaVersion'] !== CBT_UNIT_PERSISTENCE_SCHEMA_VERSION) {
        fail('INVALID_SHAPE', `${path}.schemaVersion`, `must be ${CBT_UNIT_PERSISTENCE_SCHEMA_VERSION}`);
    }
    const instanceId = validateId(record['instanceId'], `${path}.instanceId`, asUnitInstanceId);
    const entity = validateSavedIdentity(record['entity'], `${path}.entity`);
    const baseline = validateBaseline(record['baselineRefAtSave'], `${path}.baselineRefAtSave`);
    if (entity.sourceFormat === 'blk' || baseline.sourceFormat === 'blk') {
        fail('DESIGN_IDENTITY_MISMATCH', `${path}.entity.sourceFormat`, 'Mek V2 baselines must use MTF native sources');
    }
    if (entity.provider !== baseline.provider || entity.uuid !== baseline.uuid) {
        fail('DESIGN_IDENTITY_MISMATCH', `${path}.baselineRefAtSave.entity`, 'saved entity and baseline identify different designs');
    }
    if (entity.sourceHashAtSave !== undefined && baseline.sourceHash !== undefined
        && entity.sourceHashAtSave !== baseline.sourceHash) {
        fail('DESIGN_IDENTITY_MISMATCH', `${path}.entity.sourceHashAtSave`, 'source hash conflicts with the baseline witness');
    }
    if (entity.sourceFormat !== undefined && baseline.sourceFormat !== undefined
        && entity.sourceFormat !== baseline.sourceFormat) {
        fail('DESIGN_IDENTITY_MISMATCH', `${path}.entity.sourceFormat`, 'source format conflicts with the baseline witness');
    }
    const savedTargets = validateSavedBlueprintReferenceTableV2(
        record['blueprintReferences'],
        `${path}.blueprintReferences`,
    );
    const referencesOmitted = Object.keys(savedTargets).length === 0;
    const targets = referencesOmitted ? inferActiveSavedTargets(record) : savedTargets;
    validateDeployment(record['deployment'], `${path}.deployment`, targets);
    const revision = validateRevision(record['stateRevision'], `${path}.stateRevision`);
    if (record['destroyed'] !== undefined && record['destroyed'] !== true) {
        fail('INVALID_SHAPE', `${path}.destroyed`, 'sparse destroyed state must be true when present');
    }

    validateTargetStateArray(record['locationState'], `${path}.locationState`, targets, ['location-section'], validateLocationState);
    validateLocationConditionStateArray(
        record['locationConditions'],
        `${path}.locationConditions`,
        targets,
        false,
    );
    validateTargetStateArray(record['slotState'], `${path}.slotState`, targets, ['critical-slot'], validateSlotState);
    validateTargetStateArray(record['componentState'], `${path}.componentState`, targets, ['component', 'intrinsic-system'], validateComponentState);
    validateTargetStateArray(record['ammoState'], `${path}.ammoState`, targets, ['ammo-source'], validateAmmoState);
    validateCrew(record['crew'], `${path}.crew`, targets);
    if (record['heat'] !== undefined) {
        const heat = requireRecord(record['heat'], `${path}.heat`);
        exactKeys(heat, ['heat', 'previous', 'pendingOverride', 'heatsinksOff'], `${path}.heat`);
        const value = requireFiniteNumber(heat['heat'], `${path}.heat.heat`);
        if (value < 0 || value > MAX_MEK_HEAT_VALUE_V2 || Object.is(value, -0)) {
            fail('INVALID_SHAPE', `${path}.heat.heat`, 'must be a canonical bounded heat value');
        }
        if (heat['previous'] !== undefined) {
            const previous = requireFiniteNumber(heat['previous'], `${path}.heat.previous`);
            if (previous <= 0 || previous > MAX_MEK_HEAT_VALUE_V2 || Object.is(previous, -0)) {
                fail('INVALID_SHAPE', `${path}.heat.previous`, 'sparse previous heat must be positive and bounded');
            }
        }
        if (heat['pendingOverride'] !== undefined) {
            const pending = requireFiniteNumber(heat['pendingOverride'], `${path}.heat.pendingOverride`);
            if (pending < 0 || pending > MAX_MEK_HEAT_VALUE_V2 || Object.is(pending, -0)) {
                fail('INVALID_SHAPE', `${path}.heat.pendingOverride`, 'must be a canonical bounded heat value');
            }
        }
        if (heat['heatsinksOff'] !== undefined) {
            const off = requireFiniteNumber(heat['heatsinksOff'], `${path}.heat.heatsinksOff`);
            if (!Number.isSafeInteger(off) || off <= 0 || off > MAX_MEK_HEATSINKS_OFF_V2) {
                fail(
                    'INVALID_SHAPE',
                    `${path}.heat.heatsinksOff`,
                    'sparse heatsinks-off count must be a bounded positive integer',
                );
            }
        }
    }
    const family = requireRecord(record['family'], `${path}.family`);
    exactKeys(family, ['kind'], `${path}.family`);
    if (family['kind'] !== 'mek') fail('INVALID_SHAPE', `${path}.family.kind`, 'only Mek semantic V2 state is supported');
    validateMekRuleChecks(record['ruleChecks'], `${path}.ruleChecks`, targets, revision);
    {
        let movementPsr: SerializedMekMovementPsrStateV2;
        try {
            const canonical = deserializeMekMovementPsrStateV2(record['movementPsr']);
            movementPsr = serializeMekMovementPsrStateV2(canonical);
        } catch (error) {
            fail(
                'INVALID_SHAPE',
                `${path}.movementPsr`,
                error instanceof Error ? error.message : 'invalid Mek movement/PSR state',
            );
        }
        // Compact storage omits Entity topology. Exact ownership is checked after
        // the native source is loaded and its transient reference table rebuilt.
        if (!referencesOmitted) {
            assertMovementPsrIdsOwnedByReferences(
                movementPsr,
                targets,
                `${path}.movementPsr`,
            );
        }
        validateAttackerTargeting(
            record['attackerTargeting'],
            `${path}.attackerTargeting`,
            targets,
        );
    }
    if (record['equipmentRowOrder'] !== undefined) {
        const order = requireRecord(record['equipmentRowOrder'], `${path}.equipmentRowOrder`);
        try {
            freezeEquipmentRowOrder(order as EquipmentRowOrderState);
        } catch (error) {
            fail(
                'INVALID_SHAPE',
                `${path}.equipmentRowOrder`,
                error instanceof Error ? error.message : 'invalid equipment row order',
            );
        }
    }
    try {
        deserializeMekTurnStateV2(record['turn']);
    } catch (error) {
        fail(
            'INVALID_SHAPE',
            `${path}.turn`,
            error instanceof Error ? error.message : 'invalid Mek turn state',
        );
    }
    if (record['conditions'] !== undefined) {
        const conditions = requireRecord(record['conditions'], `${path}.conditions`);
        exactKeys(conditions, ['values'], `${path}.conditions`);
        validateUniqueSortedUnitConditions(conditions['values'], `${path}.conditions.values`);
    }
    if (record['pendingCombat'] !== undefined) validatePending(record['pendingCombat'], `${path}.pendingCombat`, targets);
    if (record['restoration'] !== undefined) {
        validateUnitRestoration(
            record['restoration'],
            `${path}.restoration`,
            targets,
            baseline.entity,
        );
    }
    return {
        instanceId,
        revision,
        targets: new Set(Object.keys(targets)),
        components: collectSavedComponentIds(targets, `${path}.blueprintReferences.targets`),
    };
}

function validateDeployment(
    value: unknown,
    path: string,
    _targets: Record<string, SavedStateTargetV2>,
): void {
    const deployment = requireRecord(value, path);
    exactKeys(deployment, ['schemaVersion', 'values'], path);
    if (deployment['schemaVersion'] !== MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION) {
        fail(
            'INVALID_SHAPE',
            `${path}.schemaVersion`,
            `must be ${MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION}; older crew-less V2 deployments are not guessed`,
        );
    }
    const values = requireRecord(deployment['values'], `${path}.values`);
    exactKeys(values, ['id', 'initialHeat', 'crewAssignment'], `${path}.values`);
    validateId(values['id'], `${path}.values.id`);
    if (values['initialHeat'] !== undefined) {
        requireSafeNonnegative(values['initialHeat'], `${path}.values.initialHeat`);
    }
    try {
        const assignment = requireRecord(
            values['crewAssignment'],
            `${path}.values.crewAssignment`,
        );
        const positions = requireArray(
            assignment['positions'],
            `${path}.values.crewAssignment.positions`,
        );
        const topology = new Map<CrewPositionId, CrewPositionDefinition>();
        positions.forEach((rawPosition, occurrence) => {
            const position = requireRecord(
                rawPosition,
                `${path}.values.crewAssignment.positions[${occurrence}]`,
            );
            const id = asCrewPositionId(validateId(
                position['positionId'],
                `${path}.values.crewAssignment.positions[${occurrence}].positionId`,
            ));
            if (topology.has(id)) throw new Error(`duplicate crew position ${id}`);
            topology.set(id, Object.freeze({ id, occurrence }));
        });
        assertCanonicalCrewAssignment(
            topology,
            values['crewAssignment'] as CrewAssignment,
        );
    } catch (error) {
        fail(
            'INVALID_SHAPE',
            `${path}.values.crewAssignment`,
            error instanceof Error ? error.message : 'invalid crew assignment',
        );
    }
}

function collectSavedComponentIds(
    targets: Readonly<Record<string, SavedStateTargetV2>>,
    path: string,
): ReadonlySet<string> {
    const components = new Set<string>();
    for (const [targetRef, target] of Object.entries(targets)) {
        if (target.kind !== 'component' && target.kind !== 'intrinsic-system') continue;
        if (target.savedComponentId === undefined) continue;
        let componentId: string;
        try {
            componentId = asComponentId(target.savedComponentId);
        } catch (error) {
            throw validationError('INVALID_SHAPE', error, `${path}.${targetRef}.savedComponentId`);
        }
        if (components.has(componentId)) {
            fail('INVALID_SHAPE', `${path}.${targetRef}.savedComponentId`, 'duplicate saved component ID');
        }
        components.add(componentId);
    }
    return components;
}

interface ValidatedBaseline {
    readonly provider: string;
    readonly uuid: string;
    readonly sourceHash?: string;
    readonly sourceFormat?: string;
    readonly entity: SavedEntityIdentity;
    readonly ruleset: CBTRuleset;
}

function validateBaseline(value: unknown, path: string): ValidatedBaseline {
    const record = requireRecord(value, path);
    exactKeys(record, ['entity', 'ruleset', 'initialStateProfile'], path);
    const entity = validateSavedIdentity(record['entity'], `${path}.entity`);
    if (!isCBTRuleset(record['ruleset'])) {
        fail('INVALID_SHAPE', `${path}.ruleset`, 'must be a supported CBT ruleset');
    }
    const profile = requireRecord(record['initialStateProfile'], `${path}.initialStateProfile`);
    exactKeys(profile, ['schemaVersion', 'initializerRevision', 'profileId'], `${path}.initialStateProfile`);
    if (profile['schemaVersion'] !== 1) fail('INVALID_SHAPE', `${path}.initialStateProfile.schemaVersion`, 'must be 1');
    requirePositiveInteger(profile['initializerRevision'], `${path}.initialStateProfile.initializerRevision`);
    validateId(profile['profileId'], `${path}.initialStateProfile.profileId`);
    return {
        provider: entity.provider,
        uuid: entity.uuid,
        ...(entity.sourceHashAtSave === undefined ? {} : { sourceHash: entity.sourceHashAtSave }),
        ...(entity.sourceFormat === undefined ? {} : { sourceFormat: entity.sourceFormat }),
        entity,
        ruleset: record['ruleset'],
    };
}

function validateSavedIdentity(value: unknown, path: string): SavedEntityIdentity {
    const record = requireRecord(value, path);
    exactKeys(record, ['origin', 'provider', 'uuid', 'sourceHashAtSave', 'sourceFormat'], path);
    if (record['origin'] !== 'megamek' && record['origin'] !== 'user') fail('INVALID_SHAPE', `${path}.origin`, 'must be core or user');
    if (typeof record['provider'] !== 'string') fail('INVALID_SHAPE', `${path}.provider`, 'must be a string');
    if (typeof record['uuid'] !== 'string') fail('INVALID_SHAPE', `${path}.uuid`, 'must be a string');
    if (record['sourceHashAtSave'] !== undefined && typeof record['sourceHashAtSave'] !== 'string') fail('INVALID_SHAPE', `${path}.sourceHashAtSave`, 'must be a string');
    if (record['sourceFormat'] !== undefined && record['sourceFormat'] !== 'mtf' && record['sourceFormat'] !== 'blk') {
        fail('INVALID_SHAPE', `${path}.sourceFormat`, 'must be mtf or blk');
    }
    try {
        const identity = sanitizeSavedEntityIdentity(record);
        if (!identity) fail('INVALID_SHAPE', path, 'identity is required');
        return identity!;
    } catch (error) {
        throw validationError('INVALID_SHAPE', error, path);
    }
}

export function validateSavedBlueprintReferenceTableV2(
    value: unknown,
    path: string,
): Record<string, SavedStateTargetV2> {
    const record = requireRecord(value, path);
    exactKeys(record, ['schemaVersion', 'targets'], path);
    if (record['schemaVersion'] !== 1) fail('INVALID_SHAPE', `${path}.schemaVersion`, 'must be 1');
    const targets = requireRecord(record['targets'], `${path}.targets`);
    for (const [ref, target] of Object.entries(targets)) {
        validateId(ref, `${path}.targets key`, asSavedTargetRef);
        validateSavedTarget(target, `${path}.targets.${ref}`, targets);
    }
    return targets as Record<string, SavedStateTargetV2>;
}

/** Exact standalone-unit restoration validation used before any retry or alias replay. */
export function validateSerializedCBTUnitRestorationV2(value: SerializedCBTUnitV2): void {
    const targets = validateSavedBlueprintReferenceTableV2(
        value.blueprintReferences,
        '$.blueprintReferences',
    );
    if (value.restoration === undefined) return;
    validateUnitRestoration(
        value.restoration,
        '$.restoration',
        targets,
        value.baselineRefAtSave.entity,
    );
}

function validateSavedTarget(value: unknown, path: string, table: Record<string, unknown>): void {
    const target = requireRecord(value, path);
    switch (target['kind']) {
        case 'critical-slot':
            exactKeys(target, ['kind', 'savedSlotId', 'location', 'slot', 'expectedSystemId', 'expectedEquipmentName', 'expectedOriginalName', 'expectedDisplayName', 'expectedAmmoRole', 'legacyId', 'rawLegacyLocation', 'rawLegacySlot'], path);
            validateId(target['location'], `${path}.location`);
            validateOrdinal(target['slot'], `${path}.slot`);
            validateOptionalStringFields(target, path, ['savedSlotId', 'expectedSystemId', 'expectedEquipmentName', 'expectedOriginalName', 'expectedDisplayName', 'expectedAmmoRole', 'legacyId', 'rawLegacyLocation']);
            if (target['rawLegacySlot'] !== undefined) requireSafeNonnegative(target['rawLegacySlot'], `${path}.rawLegacySlot`);
            return;
        case 'location-section':
            exactKeys(target, ['kind', 'location', 'section'], path);
            validateId(target['location'], `${path}.location`);
            if (!['internal', 'front-armor', 'rear-armor'].includes(String(target['section']))) fail('INVALID_SHAPE', `${path}.section`, 'invalid section');
            return;
        case 'component':
            exactKeys(target, ['kind', 'savedComponentId', 'equipmentName', 'locations', 'criticalSlots', 'occurrence', 'capacity', 'legacySummaryComponentIndex', 'legacyBinIndex'], path);
            validateId(target['equipmentName'], `${path}.equipmentName`);
            validateOptionalStringFields(target, path, ['savedComponentId']);
            validateStringArray(target['locations'], `${path}.locations`);
            validateSlotCoordinates(target['criticalSlots'], `${path}.criticalSlots`);
            validateOptionalNonnegative(target, path, ['occurrence', 'capacity', 'legacySummaryComponentIndex', 'legacyBinIndex']);
            return;
        case 'ammo-source': {
            exactKeys(target, ['kind', 'savedAmmoSourceId', 'source', 'location', 'criticalSlots', 'occurrence', 'capacityAtSave', 'munitionAtSave', 'legacySummaryComponentIndex', 'legacyBinIndex'], path);
            const source = requireRecord(target['source'], `${path}.source`);
            if (source['kind'] === 'installed-bin') {
                exactKeys(source, ['kind', 'savedComponentId', 'equipmentName'], `${path}.source`);
                validateOptionalStringFields(source, `${path}.source`, ['savedComponentId']);
            } else if (source['kind'] === 'intrinsic-magazine' || source['kind'] === 'one-shot') {
                exactKeys(source, ['kind', 'ownerComponentTarget', 'equipmentName'], `${path}.source`);
                const owner = validateId(source['ownerComponentTarget'], `${path}.source.ownerComponentTarget`, asSavedTargetRef);
                const ownerTarget = table[owner];
                if (!isRecord(ownerTarget) || (ownerTarget['kind'] !== 'component' && ownerTarget['kind'] !== 'intrinsic-system')) {
                    fail('DANGLING_TARGET_REF', `${path}.source.ownerComponentTarget`, 'owner is missing or not a component');
                }
            } else fail('INVALID_SHAPE', `${path}.source.kind`, 'invalid ammo source kind');
            validateId(source['equipmentName'], `${path}.source.equipmentName`);
            if (target['location'] !== undefined) validateId(target['location'], `${path}.location`);
            validateSlotCoordinates(target['criticalSlots'], `${path}.criticalSlots`);
            validateOptionalStringFields(target, path, ['savedAmmoSourceId', 'location', 'munitionAtSave']);
            validateOptionalNonnegative(target, path, ['occurrence', 'capacityAtSave', 'legacySummaryComponentIndex', 'legacyBinIndex']);
            return;
        }
        case 'intrinsic-system':
            exactKeys(target, ['kind', 'savedComponentId', 'legacySystemId', 'systemKey', 'aliases', 'locations', 'criticalSlots'], path);
            validateId(target['systemKey'], `${path}.systemKey`);
            if (target['aliases'] !== undefined) validateStringArray(target['aliases'], `${path}.aliases`);
            validateStringArray(target['locations'], `${path}.locations`);
            validateSlotCoordinates(target['criticalSlots'], `${path}.criticalSlots`);
            validateOptionalStringFields(target, path, ['savedComponentId', 'legacySystemId']);
            return;
        case 'crew-position':
            exactKeys(target, ['kind', 'savedCrewPositionId', 'positionKey', 'aliases', 'occurrence'], path);
            validateId(target['positionKey'], `${path}.positionKey`);
            if (target['aliases'] !== undefined) validateStringArray(target['aliases'], `${path}.aliases`);
            validateOptionalStringFields(target, path, ['savedCrewPositionId']);
            validateOptionalNonnegative(target, path, ['occurrence']);
            return;
        default:
            fail('INVALID_SHAPE', `${path}.kind`, 'unknown saved target kind');
    }
}

function validateTargetStateArray(
    value: unknown,
    path: string,
    targets: Record<string, SavedStateTargetV2>,
    allowedKinds: readonly SavedStateTargetV2['kind'][],
    validateEntry: (entry: Record<string, unknown>, path: string) => void,
): void {
    if (value === undefined) return;
    const entries = requireArray(value, path);
    const seen = new Set<string>();
    let previous: string | undefined;
    entries.forEach((valueEntry, index) => {
        const entryPath = `${path}[${index}]`;
        const entry = requireRecord(valueEntry, entryPath);
        const ref = validateId(entry['target'], `${entryPath}.target`, asSavedTargetRef);
        if (seen.has(ref)) fail('DUPLICATE_STATE_TARGET', `${entryPath}.target`, `duplicate state for ${ref}`);
        if (previous !== undefined && previous >= ref) fail('INVALID_SHAPE', `${entryPath}.target`, 'state entries must be sorted by target');
        seen.add(ref);
        previous = ref;
        const target = targets[ref];
        if (!target) fail('DANGLING_TARGET_REF', `${entryPath}.target`, `unknown target ${ref}`);
        if (!allowedKinds.includes(target.kind)) fail('TARGET_KIND_MISMATCH', `${entryPath}.target`, `target ${ref} has kind ${target.kind}`);
        validateEntry(entry, entryPath);
    });
}

function validateMekRuleChecks(
    value: unknown,
    path: string,
    targets: Record<string, SavedStateTargetV2>,
    unitRevision: number,
): void {
    const checks = requireRecord(value, path);
    exactKeys(checks, ['schemaVersion', 'entries'], path);
    if (checks['schemaVersion'] !== 1) fail('INVALID_SHAPE', `${path}.schemaVersion`, 'must be 1');
    const entries = requireArray(checks['entries'], `${path}.entries`);
    if (entries.length > 1) fail('INVALID_SHAPE', `${path}.entries`, 'only the typed torso check is supported');
    let previous: string | undefined;
    entries.forEach((raw, index) => {
        const entryPath = `${path}.entries[${index}]`;
        const entry = requireRecord(raw, entryPath);
        exactKeys(entry, ['key', 'token', 'trigger', 'openedRevision', 'status'], entryPath);
        if (entry['key'] !== 'core.torso-crippling') {
            fail('INVALID_SHAPE', `${entryPath}.key`, 'unknown Mek rule-check key');
        }
        const key = String(entry['key']);
        if (previous !== undefined && previous >= key) {
            fail('INVALID_SHAPE', `${entryPath}.key`, 'rule checks must be unique and sorted by key');
        }
        previous = key;
        validateId(entry['token'], `${entryPath}.token`);
        const trigger = validateId(entry['trigger'], `${entryPath}.trigger`, asSavedTargetRef);
        const target = targets[trigger];
        if (!target) fail('DANGLING_TARGET_REF', `${entryPath}.trigger`, `unknown target ${trigger}`);
        if (target.kind !== 'location-section' || target.section !== 'internal') {
            fail('TARGET_KIND_MISMATCH', `${entryPath}.trigger`, 'torso check requires an internal location target');
        }
        const openedRevision = validateRevision(entry['openedRevision'], `${entryPath}.openedRevision`);
        if (openedRevision > unitRevision) {
            fail('INVALID_SHAPE', `${entryPath}.openedRevision`, 'cannot exceed the unit revision');
        }
        if (entry['status'] !== 'pending' && entry['status'] !== 'success' && entry['status'] !== 'failed') {
            fail('INVALID_SHAPE', `${entryPath}.status`, 'unknown Mek rule-check status');
        }
    });
}

function validateAttackerTargeting(
    value: unknown,
    path: string,
    targets: Record<string, SavedStateTargetV2>,
): void {
    const record = requireRecord(value, path);
    exactKeys(record, ['schemaVersion', 'components', 'actions', 'targets'], path);
    if (record['schemaVersion'] !== 1) fail('INVALID_SHAPE', `${path}.schemaVersion`, 'must be 1');

    const components = new Map<ComponentId, {
        readonly selection?: AttackerSelection;
        readonly ammo?: { readonly munitionKey: string; readonly preferredSourceId?: ComponentId };
    }>();
    let previousComponentRef: string | undefined;
    requireArray(record['components'], `${path}.components`).forEach((raw, index) => {
        const rowPath = `${path}.components[${index}]`;
        const row = requireRecord(raw, rowPath);
        exactKeys(row, ['target', 'selection', 'ammo'], rowPath);
        const ref = validateId(row['target'], `${rowPath}.target`, asSavedTargetRef);
        if (previousComponentRef !== undefined && previousComponentRef >= ref) {
            fail('INVALID_SHAPE', `${rowPath}.target`, 'targeting components must be unique and sorted');
        }
        previousComponentRef = ref;
        if (targets[ref]?.kind !== 'component') {
            fail('TARGET_KIND_MISMATCH', `${rowPath}.target`, 'targeting weapon must reference a component');
        }

        let ammo: { readonly munitionKey: string; readonly preferredSourceId?: ComponentId } | undefined;
        if (row['ammo'] !== undefined) {
            const ammoRow = requireRecord(row['ammo'], `${rowPath}.ammo`);
            exactKeys(ammoRow, ['munitionKey', 'preferredSourceTarget'], `${rowPath}.ammo`);
            const munitionKey = validateId(ammoRow['munitionKey'], `${rowPath}.ammo.munitionKey`);
            let preferredSourceId: ComponentId | undefined;
            if (ammoRow['preferredSourceTarget'] !== undefined) {
                const sourceRef = validateId(
                    ammoRow['preferredSourceTarget'],
                    `${rowPath}.ammo.preferredSourceTarget`,
                    asSavedTargetRef,
                );
                if (targets[sourceRef]?.kind !== 'ammo-source') {
                    fail(
                        'TARGET_KIND_MISMATCH',
                        `${rowPath}.ammo.preferredSourceTarget`,
                        'preferred source must reference an ammo source',
                    );
                }
                preferredSourceId = asComponentId(sourceRef);
            }
            ammo = Object.freeze({
                munitionKey,
                ...(preferredSourceId === undefined ? {} : { preferredSourceId }),
            });
        }
        components.set(asComponentId(ref), Object.freeze({
            ...(row['selection'] === undefined
                ? {}
                : { selection: row['selection'] as AttackerSelection }),
            ...(ammo === undefined ? {} : { ammo }),
        }));
    });

    const actions = new Map<string, AttackerActionState>();
    let previousActionKey: string | undefined;
    requireArray(record['actions'], `${path}.actions`).forEach((raw, index) => {
        const rowPath = `${path}.actions[${index}]`;
        const row = requireRecord(raw, rowPath);
        let target: AttackerActionState['target'];
        if (row['kind'] === 'intrinsic') {
            exactKeys(row, ['kind', 'actionId', 'selection'], rowPath);
            target = Object.freeze({
                kind: 'intrinsic',
                actionId: validateId(row['actionId'], `${rowPath}.actionId`),
            });
        } else if (row['kind'] === 'component') {
            exactKeys(row, ['kind', 'target', 'selection'], rowPath);
            const ref = validateId(row['target'], `${rowPath}.target`, asSavedTargetRef);
            if (targets[ref]?.kind !== 'component') {
                fail('TARGET_KIND_MISMATCH', `${rowPath}.target`, 'physical action must reference a component');
            }
            target = Object.freeze({ kind: 'component', componentId: asComponentId(ref) });
        } else {
            fail('INVALID_SHAPE', `${rowPath}.kind`, 'unknown targeting action kind');
        }
        const key = attackerActionTargetKey(target);
        if (previousActionKey !== undefined && previousActionKey >= key) {
            fail('INVALID_SHAPE', rowPath, 'targeting actions must be unique and sorted');
        }
        previousActionKey = key;
        actions.set(key, Object.freeze({
            target,
            selection: row['selection'] as AttackerActionSelection,
        }));
    });

    const localTargets = new Map<ReturnType<typeof asEncounterTargetId>, AttackerLocalTargetState>();
    let previousTargetId: string | undefined;
    requireArray(record['targets'], `${path}.targets`).forEach((raw, index) => {
        const rowPath = `${path}.targets[${index}]`;
        const row = requireRecord(raw, rowPath);
        exactKeys(row, [
            'targetId', 'distance', 'c3Distance', 'useC3', 'calculator', 'manualTnOverride',
        ], rowPath);
        const targetId = validateId(row['targetId'], `${rowPath}.targetId`, asEncounterTargetId);
        if (previousTargetId !== undefined && previousTargetId >= targetId) {
            fail('INVALID_SHAPE', `${rowPath}.targetId`, 'attacker-local targets must be unique and sorted');
        }
        previousTargetId = targetId;
        const { targetId: _targetId, ...facts } = row;
        localTargets.set(asEncounterTargetId(targetId), facts as AttackerLocalTargetState);
    });

    try {
        freezeAttackerTargetingState({
            schemaVersion: 1,
            components,
            actions,
            targets: localTargets,
        });
    } catch (error) {
        fail(
            'INVALID_SHAPE',
            path,
            error instanceof Error ? error.message : 'invalid attacker-targeting state',
        );
    }
}

function validateLocationState(entry: Record<string, unknown>, path: string): void {
    exactKeys(entry, ['target', 'damage'], path);
    requirePositiveInteger(entry['damage'], `${path}.damage`);
}

function validateLocationConditionStateArray(
    value: unknown,
    path: string,
    targets: Record<string, SavedStateTargetV2>,
    pending: boolean,
): void {
    if (value === undefined) return;
    const entries = requireArray(value, path);
    let previous: string | undefined;
    entries.forEach((raw, index) => {
        const entryPath = `${path}[${index}]`;
        const entry = requireRecord(raw, entryPath);
        exactKeys(entry, ['target', 'condition', 'value'], entryPath);
        const ref = validateId(entry['target'], `${entryPath}.target`, asSavedTargetRef);
        const target = targets[ref];
        if (!target) fail('DANGLING_TARGET_REF', `${entryPath}.target`, `unknown target ${ref}`);
        if (target.kind !== 'location-section' || target.section !== 'internal') {
            fail('TARGET_KIND_MISMATCH', `${entryPath}.target`, 'location conditions require an internal location-section target');
        }
        const condition = validateMekLocationConditionKey(entry['condition'], `${entryPath}.condition`);
        validateMekLocationConditionValue(entry['value'], condition, `${entryPath}.value`, pending);
        const coordinate = `${ref}\0${condition}`;
        if (previous !== undefined && previous >= coordinate) {
            fail('INVALID_SHAPE', entryPath, 'location condition entries must be unique and sorted by target then condition');
        }
        previous = coordinate;
    });
}

function validateMekLocationConditionKey(value: unknown, path: string): MekLocationConditionKey {
    if (!isMekLocationConditionKey(value)) {
        fail('INVALID_SHAPE', path, 'unknown Mek location condition');
    }
    return value;
}

function validateMekLocationConditionValue(
    value: unknown,
    condition: MekLocationConditionKey,
    path: string,
    pending: boolean,
): number {
    const normalized = requireSafeNonnegative(value, path);
    if (!pending && normalized === 0) fail('INVALID_SHAPE', path, 'committed sparse condition values must be positive');
    if ((condition === 'blown-off' || condition === 'flooded') && normalized > 1) {
        fail('INVALID_SHAPE', path, 'boolean location condition values must be 0 or 1');
    }
    if (normalized > MAX_MEK_LOCATION_CONDITION_VALUE) {
        fail('INVALID_SHAPE', path, `location condition values must not exceed ${MAX_MEK_LOCATION_CONDITION_VALUE}`);
    }
    return normalized;
}

function validateSlotState(entry: Record<string, unknown>, path: string): void {
    exactKeys(entry, ['target', 'hits', 'destroyedTurn'], path);
    requirePositiveInteger(entry['hits'], `${path}.hits`);
    if (entry['destroyedTurn'] !== undefined) {
        requirePositiveInteger(entry['destroyedTurn'], `${path}.destroyedTurn`);
    }
}

function validateComponentState(entry: Record<string, unknown>, path: string): void {
    exactKeys(entry, ['target', 'statusOverride', 'mode', 'jammed', 'escalatingFailure', 'ppcCapacitor', 'bombastLaser', 'c3EmergencyMaster', 'gaussPower', 'shieldDamage', 'modularArmorDamage'], path);
    if (entry['statusOverride'] !== undefined && entry['statusOverride'] !== 'disabled' && entry['statusOverride'] !== 'destroyed') {
        fail('INVALID_SHAPE', `${path}.statusOverride`, 'must be disabled or destroyed');
    }
    if (entry['mode'] !== undefined) validateId(entry['mode'], `${path}.mode`);
    if (entry['jammed'] !== undefined && entry['jammed'] !== true) {
        fail('INVALID_SHAPE', `${path}.jammed`, 'sparse jam state must be true');
    }
    validateEscalatingFailure(entry['escalatingFailure'], `${path}.escalatingFailure`);
    validatePpcCapacitor(entry['ppcCapacitor'], `${path}.ppcCapacitor`);
    validateBombastLaser(entry['bombastLaser'], `${path}.bombastLaser`);
    validateC3EmergencyMaster(entry['c3EmergencyMaster'], `${path}.c3EmergencyMaster`);
    validateGaussPower(entry['gaussPower'], `${path}.gaussPower`);
    validateShieldDamage(entry['shieldDamage'], `${path}.shieldDamage`, false);
    if (entry['modularArmorDamage'] !== undefined) {
        requirePositiveInteger(entry['modularArmorDamage'], `${path}.modularArmorDamage`);
    }
    if (entry['statusOverride'] === undefined && entry['mode'] === undefined && entry['jammed'] === undefined
        && entry['escalatingFailure'] === undefined && entry['ppcCapacitor'] === undefined
        && entry['bombastLaser'] === undefined && entry['c3EmergencyMaster'] === undefined
        && entry['gaussPower'] === undefined && entry['shieldDamage'] === undefined
        && entry['modularArmorDamage'] === undefined) {
        fail('INVALID_SHAPE', path, 'sparse component state must contain a fact');
    }
}

function validateShieldDamage(value: unknown, path: string, pending: boolean): void {
    if (value === undefined) return;
    const damage = requireRecord(value, path);
    exactKeys(damage, ['absorptionDamage', 'capacityDamage'], path);
    const absorption = pending
        ? requireSafeInteger(damage['absorptionDamage'], `${path}.absorptionDamage`)
        : requireSafeNonnegative(damage['absorptionDamage'], `${path}.absorptionDamage`);
    const capacity = pending
        ? requireSafeInteger(damage['capacityDamage'], `${path}.capacityDamage`)
        : requireSafeNonnegative(damage['capacityDamage'], `${path}.capacityDamage`);
    if (absorption === 0 && capacity === 0) {
        fail('INVALID_SHAPE', path, 'sparse shield damage must contain a nonzero value');
    }
}

function validateEscalatingFailure(value: unknown, path: string): void {
    if (value === undefined) return;
    const lifecycle = requireRecord(value, path);
    exactKeys(lifecycle, ['sequence', 'active'], path);
    const sequence = requirePositiveInteger(lifecycle['sequence'], `${path}.sequence`);
    if (sequence > 5) fail('INVALID_SHAPE', `${path}.sequence`, 'must be from 1 to 5');
    if (lifecycle['active'] !== undefined && lifecycle['active'] !== true) {
        fail('INVALID_SHAPE', `${path}.active`, 'sparse active state must be true');
    }
}

function validatePpcCapacitor(value: unknown, path: string): void {
    if (value === undefined) return;
    const lifecycle = requireRecord(value, path);
    exactKeys(lifecycle, ['weaponId', 'chargeState', 'firedThisTurn'], path);
    validateId(lifecycle['weaponId'], `${path}.weaponId`, asComponentId);
    if (lifecycle['chargeState'] !== undefined
        && lifecycle['chargeState'] !== 'charging'
        && lifecycle['chargeState'] !== 'charged') {
        fail('INVALID_SHAPE', `${path}.chargeState`, 'must be charging or charged');
    }
    if (lifecycle['firedThisTurn'] !== undefined && lifecycle['firedThisTurn'] !== true) {
        fail('INVALID_SHAPE', `${path}.firedThisTurn`, 'sparse fired state must be true');
    }
    if ((lifecycle['chargeState'] === undefined && lifecycle['firedThisTurn'] === undefined)
        || (lifecycle['chargeState'] !== undefined && lifecycle['firedThisTurn'] !== undefined)) {
        fail('INVALID_SHAPE', path, 'must contain exactly one charge or fired fact');
    }
}

function validateBombastLaser(value: unknown, path: string): void {
    if (value === undefined) return;
    const lifecycle = requireRecord(value, path);
    exactKeys(lifecycle, ['chargeState', 'firedThisTurn'], path);
    if (lifecycle['chargeState'] !== undefined
        && lifecycle['chargeState'] !== 'charging'
        && lifecycle['chargeState'] !== 'charged') {
        fail('INVALID_SHAPE', `${path}.chargeState`, 'must be charging or charged');
    }
    if (lifecycle['firedThisTurn'] !== undefined && lifecycle['firedThisTurn'] !== true) {
        fail('INVALID_SHAPE', `${path}.firedThisTurn`, 'sparse fired state must be true');
    }
    if ((lifecycle['chargeState'] === undefined && lifecycle['firedThisTurn'] === undefined)
        || (lifecycle['chargeState'] !== undefined && lifecycle['firedThisTurn'] !== undefined)) {
        fail('INVALID_SHAPE', path, 'must contain exactly one charge or fired fact');
    }
}

function validateC3EmergencyMaster(value: unknown, path: string): void {
    if (value === undefined) return;
    const lifecycle = requireRecord(value, path);
    exactKeys(lifecycle, ['mode', 'operatingTurns'], path);
    if (lifecycle['mode'] !== undefined
        && lifecycle['mode'] !== 'on'
        && lifecycle['mode'] !== 'off') {
        fail('INVALID_SHAPE', `${path}.mode`, 'must be on or off');
    }
    if (lifecycle['operatingTurns'] !== undefined) {
        const turns = requirePositiveInteger(lifecycle['operatingTurns'], `${path}.operatingTurns`);
        if (turns > 7) fail('INVALID_SHAPE', `${path}.operatingTurns`, 'must be from 1 to 7');
    }
    if (lifecycle['mode'] === undefined && lifecycle['operatingTurns'] === undefined) {
        fail('INVALID_SHAPE', path, 'sparse C3 Emergency Master state must contain a fact');
    }
}

function validateGaussPower(value: unknown, path: string): void {
    if (value === undefined) return;
    if (value !== 'Powering Down' && value !== 'Powered Down' && value !== 'Powering Up') {
        fail('INVALID_SHAPE', path, 'must be Powering Down, Powered Down, or Powering Up');
    }
}

function validateAmmoState(entry: Record<string, unknown>, path: string): void {
    exactKeys(entry, ['target', 'shotsSpent', 'munitionOverride'], path);
    const shotsSpent = requireSafeNonnegative(entry['shotsSpent'], `${path}.shotsSpent`);
    if (entry['munitionOverride'] !== undefined) validateId(entry['munitionOverride'], `${path}.munitionOverride`);
    if (shotsSpent === 0 && entry['munitionOverride'] === undefined) {
        fail('INVALID_SHAPE', path, 'sparse ammunition state must contain a fact');
    }
}

function validateCrew(value: unknown, path: string, targets: Record<string, SavedStateTargetV2>): void {
    const crew = requireRecord(value, path);
    exactKeys(crew, ['schemaVersion', 'positions'], path);
    if (crew['schemaVersion'] !== 1) fail('INVALID_SHAPE', `${path}.schemaVersion`, 'must be 1');
    validateTargetStateArray(crew['positions'], `${path}.positions`, targets, ['crew-position'], (entry, entryPath) => {
        exactKeys(entry, ['target', 'wounds', 'unconscious', 'ejected'], entryPath);
        requireSafeNonnegative(entry['wounds'], `${entryPath}.wounds`);
        if (typeof entry['unconscious'] !== 'boolean') fail('INVALID_SHAPE', `${entryPath}.unconscious`, 'must be boolean');
        if (entry['ejected'] !== undefined && entry['ejected'] !== true) {
            fail('INVALID_SHAPE', `${entryPath}.ejected`, 'sparse ejected state must be true');
        }
        if (entry['unconscious'] === true && entry['ejected'] === true) {
            fail('INVALID_SHAPE', entryPath, 'crew cannot be unconscious and ejected simultaneously');
        }
        if (entry['wounds'] === 0 && entry['unconscious'] === false && entry['ejected'] !== true) {
            fail('INVALID_SHAPE', entryPath, 'sparse crew state must contain a fact');
        }
    });
}

function validatePending(value: unknown, path: string, targets: Record<string, SavedStateTargetV2>): void {
    const pending = requireRecord(value, path);
    exactKeys(pending, ['locationDamage', 'locationConditions', 'slotHits', 'componentStatus', 'shieldDamage', 'modularArmorDamage'], path);
    validateTargetStateArray(pending['locationDamage'], `${path}.locationDamage`, targets, ['location-section'], (entry, entryPath) => {
        exactKeys(entry, ['target', 'damage'], entryPath);
        requireSignedSparseDelta(entry['damage'], `${entryPath}.damage`);
    });
    validateLocationConditionStateArray(
        pending['locationConditions'],
        `${path}.locationConditions`,
        targets,
        true,
    );
    validateTargetStateArray(pending['slotHits'], `${path}.slotHits`, targets, ['critical-slot'], (entry, entryPath) => {
        exactKeys(entry, ['target', 'hits'], entryPath);
        requireSignedSparseDelta(entry['hits'], `${entryPath}.hits`);
    });
    validateTargetStateArray(pending['componentStatus'], `${path}.componentStatus`, targets, ['component', 'intrinsic-system'], (entry, entryPath) => {
        exactKeys(entry, ['target', 'status'], entryPath);
        if (!['available', 'disabled', 'destroyed'].includes(String(entry['status']))) fail('INVALID_SHAPE', `${entryPath}.status`, 'invalid equipment status');
    });
    validateTargetStateArray(pending['shieldDamage'], `${path}.shieldDamage`, targets, ['component'], (entry, entryPath) => {
        exactKeys(entry, ['target', 'absorptionDamage', 'capacityDamage'], entryPath);
        validateShieldDamage({
            absorptionDamage: entry['absorptionDamage'],
            capacityDamage: entry['capacityDamage'],
        }, entryPath, true);
    });
    validateTargetStateArray(pending['modularArmorDamage'], `${path}.modularArmorDamage`, targets, ['component'], (entry, entryPath) => {
        exactKeys(entry, ['target', 'damage'], entryPath);
        requireSignedSparseDelta(entry['damage'], `${entryPath}.damage`);
    });
}

function validateUnitRestoration(
    value: unknown,
    path: string,
    targets: Record<string, SavedStateTargetV2>,
    currentEntity: SavedEntityIdentity,
): void {
    const metadata = requireRecord(value, path);
    exactKeys(metadata, [
        'schemaVersion', 'algorithmVersion', 'fromBaseline', 'sourceChanged', 'warnings',
        'unresolved', 'acceptedAliases', 'ignoredRecovery',
        'heatRecovery',
    ], path);
    if (metadata['schemaVersion'] !== 1) fail('INVALID_SHAPE', `${path}.schemaVersion`, 'must be 1');
    const metadataAlgorithmVersion = requirePositiveInteger(metadata['algorithmVersion'], `${path}.algorithmVersion`);
    if (metadataAlgorithmVersion !== CBT_UNIT_RESTORATION_ALGORITHM_VERSION_V2) {
        fail(
            'INVALID_SHAPE',
            `${path}.algorithmVersion`,
            `must be ${CBT_UNIT_RESTORATION_ALGORITHM_VERSION_V2}`,
        );
    }
    if (typeof metadata['sourceChanged'] !== 'boolean') fail('INVALID_SHAPE', `${path}.sourceChanged`, 'must be boolean');
    const from = requireRecord(metadata['fromBaseline'], `${path}.fromBaseline`);
    if (from['kind'] === 'legacy-v1') {
        exactKeys(from, ['kind', 'coordinateProfileVersion'], `${path}.fromBaseline`);
        requirePositiveInteger(from['coordinateProfileVersion'], `${path}.fromBaseline.coordinateProfileVersion`);
    } else {
        validateBaseline(from, `${path}.fromBaseline`);
    }
    requireArray(metadata['warnings'], `${path}.warnings`).forEach((warning, index) => {
        const row = requireRecord(warning, `${path}.warnings[${index}]`);
        exactKeys(row, ['code', 'message'], `${path}.warnings[${index}]`);
        validateId(row['code'], `${path}.warnings[${index}].code`);
        requireString(row, 'message', `${path}.warnings[${index}]`);
    });
    const recoveryIds = new Set<string>();
    const unresolvedRows = requireArray(metadata['unresolved'], `${path}.unresolved`);
    const unresolvedSourceTargets = metadata['heatRecovery'] === undefined
        ? targets
        : validateSavedBlueprintReferenceTableV2(
            requireRecord(metadata['heatRecovery'], `${path}.heatRecovery`)['sourceReferences'],
            `${path}.heatRecovery.sourceReferences`,
        );
    const unresolvedSources: {
        readonly ref?: SavedTargetRef;
        readonly target: SavedStateTargetV2;
        readonly path: string;
    }[] = [];
    unresolvedRows.forEach((raw, index) => {
        const rowPath = `${path}.unresolved[${index}]`;
        const row = requireRecord(raw, rowPath);
        exactKeys(row, [
            'recoveryId',
            'sourceTargetRef',
            'sourceTarget', 'fact', 'reason',
        ], rowPath);
        const id = validateId(row['recoveryId'], `${rowPath}.recoveryId`);
        if (recoveryIds.has(id)) fail('INVALID_SHAPE', `${rowPath}.recoveryId`, 'duplicate recovery ID');
        recoveryIds.add(id);
        const sourceTargetRef = asSavedTargetRef(validateId(
            row['sourceTargetRef'],
            `${rowPath}.sourceTargetRef`,
            asSavedTargetRef,
        ));
        validateSavedTarget(row['sourceTarget'], `${rowPath}.sourceTarget`, unresolvedSourceTargets);
        unresolvedSources.push({
            ref: sourceTargetRef,
            target: row['sourceTarget'] as SavedStateTargetV2,
            path: rowPath,
        });
        validateRecoverableFact(row['fact'], `${rowPath}.fact`, requireRecord(row['sourceTarget'], `${rowPath}.sourceTarget`)['kind']);
        requireString(row, 'reason', rowPath);
    });
    if (metadata['heatRecovery'] === undefined) {
        if (unresolvedRows.length > 0) {
            fail('INVALID_SHAPE', `${path}.heatRecovery`, 'typed unresolved recovery requires heat authority');
        }
        assertUnresolvedRecoverySourceOwnership(unresolvedSources, targets);
    } else {
        if (unresolvedRows.length === 0) {
            fail('INVALID_SHAPE', `${path}.heatRecovery`, 'empty typed recovery must omit heat authority');
        }
        validateMekHeatRecoveryAuthority(
            metadata['heatRecovery'],
            `${path}.heatRecovery`,
            targets,
            unresolvedSources,
        );
    }
    requireArray(metadata['acceptedAliases'], `${path}.acceptedAliases`).forEach((raw, index) => {
        const rowPath = `${path}.acceptedAliases[${index}]`;
        const row = requireRecord(raw, rowPath);
        exactKeys(row, ['sourceTargetRef', 'targetEntity', 'target', 'algorithmVersion'], rowPath);
        const sourceRef = validateId(
            row['sourceTargetRef'],
            `${rowPath}.sourceTargetRef`,
            asSavedTargetRef,
        );
        const sourceTargets = metadata['heatRecovery'] === undefined
            ? targets
            : validateSavedBlueprintReferenceTableV2(
                requireRecord(metadata['heatRecovery'], `${path}.heatRecovery`)['sourceReferences'],
                `${path}.heatRecovery.sourceReferences`,
            );
        const sourceTarget = sourceTargets[sourceRef];
        if (sourceTarget === undefined) {
            fail('DANGLING_TARGET_REF', `${rowPath}.sourceTargetRef`, `unknown source target ${sourceRef}`);
        }
        validateSavedIdentity(row['targetEntity'], `${rowPath}.targetEntity`);
        const ref = validateId(row['target'], `${rowPath}.target`, asSavedTargetRef);
        const targetsCurrentSavedBaseline = jsonValuesEqual(row['targetEntity'], currentEntity);
        if (targetsCurrentSavedBaseline) {
            const currentTarget = targets[ref];
            if (!currentTarget) {
                fail('DANGLING_TARGET_REF', `${rowPath}.target`, `unknown target ${ref}`);
            }
            if (!recoveryAliasTargetKindsCompatible(sourceTarget, currentTarget)) {
                fail(
                    'TARGET_KIND_MISMATCH',
                    `${rowPath}.target`,
                    `accepted alias cannot map ${sourceTarget.kind} recovery to ${currentTarget.kind}`,
                );
            }
        }
        const algorithmVersion = requirePositiveInteger(row['algorithmVersion'], `${rowPath}.algorithmVersion`);
        if (algorithmVersion !== CBT_UNIT_RESTORATION_ALGORITHM_VERSION_V2) {
            fail(
                'INVALID_SHAPE',
                `${rowPath}.algorithmVersion`,
                `must be ${CBT_UNIT_RESTORATION_ALGORITHM_VERSION_V2}`,
            );
        }
    });
    const ignoredRecoveryKeys = new Set<string>();
    const ignored = metadata['ignoredRecovery'] === undefined
        ? []
        : requireArray(metadata['ignoredRecovery'], `${path}.ignoredRecovery`);
    ignored.forEach((raw, index) => {
        const rowPath = `${path}.ignoredRecovery[${index}]`;
        const row = requireRecord(raw, rowPath);
        exactKeys(row, ['recoveryId', 'algorithmVersion'], rowPath);
        const id = validateId(row['recoveryId'], `${rowPath}.recoveryId`);
        const algorithmVersion = requirePositiveInteger(row['algorithmVersion'], `${rowPath}.algorithmVersion`);
        if (algorithmVersion !== CBT_UNIT_RESTORATION_ALGORITHM_VERSION_V2) {
            fail(
                'INVALID_SHAPE',
                `${rowPath}.algorithmVersion`,
                `must be ${CBT_UNIT_RESTORATION_ALGORITHM_VERSION_V2}`,
            );
        }
        const decisionKey = `${algorithmVersion}\0${id}`;
        if (ignoredRecoveryKeys.has(decisionKey)) {
            fail('INVALID_SHAPE', `${rowPath}.recoveryId`, 'duplicate ignored recovery decision');
        }
        if (algorithmVersion === metadataAlgorithmVersion && recoveryIds.has(id)) {
            fail('INVALID_SHAPE', `${rowPath}.recoveryId`, 'recovery cannot be unresolved and ignored by the active algorithm');
        }
        ignoredRecoveryKeys.add(decisionKey);
    });
}

function assertMovementPsrIdsOwnedByReferences(
    serialized: SerializedMekMovementPsrStateV2,
    targets: Readonly<Record<string, SavedStateTargetV2>>,
    path: string,
): void {
    const state = deserializeMekMovementPsrStateV2(serialized);
    const componentIds = new Set<string>();
    const slotIds = new Set<string>();
    const locationIds = new Set<string>();
    for (const [targetRef, target] of Object.entries(targets)) {
        if ((target.kind === 'component' || target.kind === 'intrinsic-system')
            && target.savedComponentId !== undefined) {
            const id = validateId(target.savedComponentId, `${path}.references.${targetRef}.savedComponentId`, asComponentId);
            if (componentIds.has(id)) {
                fail('DUPLICATE_TARGET_REF', `${path}.references.${targetRef}.savedComponentId`, 'duplicate component identity');
            }
            componentIds.add(id);
        }
        if (target.kind === 'critical-slot' && target.savedSlotId !== undefined) {
            const id = validateId(target.savedSlotId, `${path}.references.${targetRef}.savedSlotId`, asCriticalSlotId);
            if (slotIds.has(id)) {
                fail('DUPLICATE_TARGET_REF', `${path}.references.${targetRef}.savedSlotId`, 'duplicate critical-slot identity');
            }
            slotIds.add(id);
        }
        if (target.kind === 'location-section') {
            locationIds.add(validateId(target.location, `${path}.references.${targetRef}.location`, asLocationId));
        }
    }
    const requiredComponents = new Set<string>(state.movement?.boosterComponentIds ?? []);
    const requiredSlots = new Set<string>();
    const requiredLocations = new Set<string>();
    for (const check of state.checks) {
        for (const id of check.source.criticalSlotIds) requiredSlots.add(id);
        for (const id of check.source.locationIds) requiredLocations.add(id);
    }
    for (const id of requiredComponents) {
        if (!componentIds.has(id)) fail('DANGLING_TARGET_REF', path, `movement references unknown component ${id}`);
    }
    for (const id of requiredSlots) {
        if (!slotIds.has(id)) fail('DANGLING_TARGET_REF', path, `pilot check references unknown critical slot ${id}`);
    }
    for (const id of requiredLocations) {
        if (!locationIds.has(id)) fail('DANGLING_TARGET_REF', path, `pilot check references unknown location ${id}`);
    }
}

function validateMekHeatRecoveryAuthority(
    value: unknown,
    path: string,
    unitTargets: Record<string, SavedStateTargetV2>,
    unresolvedSources: readonly {
        readonly ref?: SavedTargetRef;
        readonly target: SavedStateTargetV2;
        readonly path: string;
    }[],
): void {
    const authority = requireRecord(value, path);
    exactKeys(authority, [
        'schemaVersion', 'sourceReferences', 'targetTranslation', 'currentReferences',
    ], path);
    if (authority['schemaVersion'] !== 1) {
        fail('INVALID_SHAPE', `${path}.schemaVersion`, 'must be 1');
    }
    const sourceTargets = validateSavedBlueprintReferenceTableV2(
        authority['sourceReferences'],
        `${path}.sourceReferences`,
    );
    const currentTargets = validateSavedBlueprintReferenceTableV2(
        authority['currentReferences'],
        `${path}.currentReferences`,
    );
    if (!jsonValuesEqual(currentTargets, unitTargets)) {
        fail(
            'INVALID_SHAPE',
            `${path}.currentReferences`,
            'must equal the unit current blueprint reference table',
        );
    }
    assertUnresolvedRecoverySourceOwnership(unresolvedSources, sourceTargets);
    const activeSourceRefs = unresolvedSources.flatMap(source =>
        source.ref === undefined ? [] : [source.ref]);
    const expectedSourceClosure = savedTargetReferenceClosureV2(sourceTargets, activeSourceRefs);
    if (expectedSourceClosure === undefined) {
        fail('DANGLING_TARGET_REF', `${path}.sourceReferences`, 'active recovery source closure is incomplete');
    }
    const actualSourceRefs = Object.keys(sourceTargets).sort();
    if (!jsonValuesEqual(actualSourceRefs, expectedSourceClosure)) {
        fail(
            'INVALID_SHAPE',
            `${path}.sourceReferences.targets`,
            'must contain exactly the active recovery roots and their transitive target dependencies',
        );
    }
    const translation = requireRecord(authority['targetTranslation'], `${path}.targetTranslation`);
    const activeTranslationRefs = new Set(activeSourceRefs);
    for (const [sourceRef, currentRefValue] of Object.entries(translation)) {
        validateId(sourceRef, `${path}.targetTranslation key`, asSavedTargetRef);
        const currentRef = validateId(
            currentRefValue,
            `${path}.targetTranslation.${sourceRef}`,
            asSavedTargetRef,
        );
        if (sourceTargets[sourceRef] === undefined) {
            fail('DANGLING_TARGET_REF', `${path}.targetTranslation.${sourceRef}`, 'unknown source ref');
        }
        if (currentTargets[currentRef] === undefined) {
            fail('DANGLING_TARGET_REF', `${path}.targetTranslation.${sourceRef}`, 'unknown current ref');
        }
        if (!activeTranslationRefs.has(asSavedTargetRef(sourceRef))) {
            fail(
                'INVALID_SHAPE',
                `${path}.targetTranslation.${sourceRef}`,
                'translation does not belong to an active unresolved source row',
            );
        }
    }
}

function assertUnresolvedRecoverySourceOwnership(
    unresolvedSources: readonly {
        readonly ref?: SavedTargetRef;
        readonly target: SavedStateTargetV2;
        readonly path: string;
    }[],
    sourceTargets: Readonly<Record<string, SavedStateTargetV2>>,
): void {
    for (const source of unresolvedSources) {
        if (source.ref === undefined) {
            fail('INVALID_SHAPE', `${source.path}.sourceTargetRef`, 'is required by current unit recovery');
        }
        const owned = sourceTargets[source.ref];
        if (owned === undefined) {
            fail('DANGLING_TARGET_REF', `${source.path}.sourceTargetRef`, `unknown source ref ${source.ref}`);
        }
        if (!jsonValuesEqual(owned, source.target)) {
            fail(
                'INVALID_SHAPE',
                `${source.path}.sourceTargetRef`,
                'does not own the byte-exact unresolved source target',
            );
        }
    }
}

function recoveryAliasTargetKindsCompatible(
    source: SavedStateTargetV2,
    target: SavedStateTargetV2,
): boolean {
    if (source.kind === 'component' || source.kind === 'intrinsic-system') {
        return target.kind === 'component' || target.kind === 'intrinsic-system';
    }
    return source.kind === target.kind;
}

function validateRecoverableFact(value: unknown, path: string, targetKind: unknown): void {
    const fact = requireRecord(value, path);
    switch (fact['kind']) {
        case 'location-damage':
            exactKeys(fact, ['kind', 'damage'], path); requireSafeNonnegative(fact['damage'], `${path}.damage`);
            if (targetKind !== 'location-section') fail('TARGET_KIND_MISMATCH', path, 'location fact has non-location witness');
            return;
        case 'location-condition': {
            exactKeys(fact, ['kind', 'condition', 'value'], path);
            const condition = validateMekLocationConditionKey(fact['condition'], `${path}.condition`);
            validateMekLocationConditionValue(fact['value'], condition, `${path}.value`, false);
            if (targetKind !== 'location-section') fail('TARGET_KIND_MISMATCH', path, 'location condition fact has non-location witness');
            return;
        }
        case 'slot-hits':
            exactKeys(fact, ['kind', 'hits', 'destroyedTurn'], path);
            requireSafeNonnegative(fact['hits'], `${path}.hits`);
            if (fact['destroyedTurn'] !== undefined) {
                requirePositiveInteger(fact['destroyedTurn'], `${path}.destroyedTurn`);
            }
            if (targetKind !== 'critical-slot') fail('TARGET_KIND_MISMATCH', path, 'slot fact has non-slot witness');
            return;
        case 'component-state':
            exactKeys(fact, ['kind', 'statusOverride', 'mode', 'jammed', 'escalatingFailure', 'ppcCapacitor', 'bombastLaser', 'c3EmergencyMaster', 'gaussPower', 'shieldDamage', 'modularArmorDamage'], path);
            if (fact['statusOverride'] !== undefined && fact['statusOverride'] !== 'disabled' && fact['statusOverride'] !== 'destroyed') {
                fail('INVALID_SHAPE', `${path}.statusOverride`, 'must be disabled or destroyed');
            }
            if (fact['mode'] !== undefined) validateId(fact['mode'], `${path}.mode`);
            if (fact['jammed'] !== undefined && fact['jammed'] !== true) {
                fail('INVALID_SHAPE', `${path}.jammed`, 'sparse jam state must be true');
            }
            validateEscalatingFailure(fact['escalatingFailure'], `${path}.escalatingFailure`);
            validatePpcCapacitor(fact['ppcCapacitor'], `${path}.ppcCapacitor`);
            validateBombastLaser(fact['bombastLaser'], `${path}.bombastLaser`);
            validateC3EmergencyMaster(fact['c3EmergencyMaster'], `${path}.c3EmergencyMaster`);
            validateGaussPower(fact['gaussPower'], `${path}.gaussPower`);
            validateShieldDamage(fact['shieldDamage'], `${path}.shieldDamage`, false);
            if (fact['modularArmorDamage'] !== undefined) {
                requirePositiveInteger(fact['modularArmorDamage'], `${path}.modularArmorDamage`);
            }
            if (fact['statusOverride'] === undefined && fact['mode'] === undefined && fact['jammed'] === undefined
                && fact['escalatingFailure'] === undefined && fact['ppcCapacitor'] === undefined
                && fact['bombastLaser'] === undefined && fact['c3EmergencyMaster'] === undefined
                && fact['gaussPower'] === undefined && fact['shieldDamage'] === undefined
                && fact['modularArmorDamage'] === undefined) {
                fail('INVALID_SHAPE', path, 'sparse component recovery fact must contain a fact');
            }
            if (targetKind !== 'component' && targetKind !== 'intrinsic-system') fail('TARGET_KIND_MISMATCH', path, 'component fact has wrong witness');
            return;
        case 'ammo-state':
            exactKeys(fact, ['kind', 'shotsSpent', 'munitionOverride'], path);
            requireSafeNonnegative(fact['shotsSpent'], `${path}.shotsSpent`);
            if (fact['munitionOverride'] !== undefined) validateId(fact['munitionOverride'], `${path}.munitionOverride`);
            if (targetKind !== 'ammo-source') fail('TARGET_KIND_MISMATCH', path, 'ammo fact has wrong witness');
            return;
        case 'crew-state':
            exactKeys(fact, ['kind', 'wounds', 'unconscious', 'ejected'], path);
            requireSafeNonnegative(fact['wounds'], `${path}.wounds`);
            if (typeof fact['unconscious'] !== 'boolean') {
                fail('INVALID_SHAPE', `${path}.unconscious`, 'must be boolean');
            }
            if (fact['ejected'] !== undefined && fact['ejected'] !== true) {
                fail('INVALID_SHAPE', `${path}.ejected`, 'sparse ejected state must be true');
            }
            if (fact['unconscious'] === true && fact['ejected'] === true) {
                fail('INVALID_SHAPE', path, 'crew cannot be unconscious and ejected simultaneously');
            }
            if (targetKind !== 'crew-position') {
                fail('TARGET_KIND_MISMATCH', path, 'crew fact has non-crew witness');
            }
            return;
        case 'mek-rule-check':
            exactKeys(fact, ['kind', 'key', 'token', 'openedRevision', 'status'], path);
            if (fact['key'] !== 'core.torso-crippling') {
                fail('INVALID_SHAPE', `${path}.key`, 'unknown Mek rule-check key');
            }
            validateId(fact['token'], `${path}.token`);
            validateRevision(fact['openedRevision'], `${path}.openedRevision`);
            if (fact['status'] !== 'pending' && fact['status'] !== 'success' && fact['status'] !== 'failed') {
                fail('INVALID_SHAPE', `${path}.status`, 'unknown Mek rule-check status');
            }
            if (targetKind !== 'location-section') {
                fail('TARGET_KIND_MISMATCH', path, 'Mek rule check has non-location witness');
            }
            return;
        case 'pending-location-damage':
            exactKeys(fact, ['kind', 'damage'], path);
            requireSignedSparseDelta(fact['damage'], `${path}.damage`);
            if (targetKind !== 'location-section') fail('TARGET_KIND_MISMATCH', path, 'pending location fact has non-location witness');
            return;
        case 'pending-location-condition': {
            exactKeys(fact, ['kind', 'condition', 'value'], path);
            const condition = validateMekLocationConditionKey(fact['condition'], `${path}.condition`);
            validateMekLocationConditionValue(fact['value'], condition, `${path}.value`, true);
            if (targetKind !== 'location-section') fail('TARGET_KIND_MISMATCH', path, 'pending location condition fact has non-location witness');
            return;
        }
        case 'pending-slot-hits':
            exactKeys(fact, ['kind', 'hits'], path);
            requireSignedSparseDelta(fact['hits'], `${path}.hits`);
            if (targetKind !== 'critical-slot') fail('TARGET_KIND_MISMATCH', path, 'pending slot fact has non-slot witness');
            return;
        case 'pending-component-status':
            exactKeys(fact, ['kind', 'status'], path);
            if (!['available', 'disabled', 'destroyed'].includes(String(fact['status']))) {
                fail('INVALID_SHAPE', `${path}.status`, 'invalid pending equipment status');
            }
            if (targetKind !== 'component' && targetKind !== 'intrinsic-system') {
                fail('TARGET_KIND_MISMATCH', path, 'pending component fact has wrong witness');
            }
            return;
        case 'pending-shield-damage':
            exactKeys(fact, ['kind', 'absorptionDamage', 'capacityDamage'], path);
            validateShieldDamage({
                absorptionDamage: fact['absorptionDamage'],
                capacityDamage: fact['capacityDamage'],
            }, path, true);
            if (targetKind !== 'component') {
                fail('TARGET_KIND_MISMATCH', path, 'pending shield fact has a non-component witness');
            }
            return;
        case 'pending-modular-armor-damage':
            exactKeys(fact, ['kind', 'damage'], path);
            requireSignedSparseDelta(fact['damage'], `${path}.damage`);
            if (targetKind !== 'component') {
                fail('TARGET_KIND_MISMATCH', path, 'pending Modular Armor fact has a non-component witness');
            }
            return;
        default: fail('INVALID_SHAPE', `${path}.kind`, 'unknown recoverable fact');
    }
}

function validateDeferredSource(value: unknown, path: string): void {
    const source = requireRecord(value, path);
    exactKeys(source, ['payload', 'identity'], path);
    assertJson(source['payload'], `${path}.payload`);
    validatePersistedUnitIdentity(source['identity'], `${path}.identity`);
}

function validatePersistedUnitIdentity(value: unknown, path: string): void {
    const identity = requireRecord(value, path);
    if (identity['kind'] === 'resolved') {
        exactKeys(identity, ['kind', 'savedIdentity'], path);
        validateSavedIdentity(identity['savedIdentity'], `${path}.savedIdentity`);
        return;
    }
    if (identity['kind'] !== 'unresolved') fail('INVALID_SHAPE', `${path}.kind`, 'invalid persisted unit identity');
    exactKeys(identity, ['kind', 'rawLegacyName', 'rawChassis', 'rawModel', 'rawEntityType', 'candidates', 'reason'], path);
    requireString(identity, 'rawLegacyName', path);
    validateOptionalStringFields(identity, path, ['rawChassis', 'rawModel', 'rawEntityType']);
    if (!['not-found', 'ambiguous', 'catalog-not-ready'].includes(String(identity['reason']))) fail('INVALID_SHAPE', `${path}.reason`, 'invalid resolution reason');
    requireArray(identity['candidates'], `${path}.candidates`).forEach((candidate, index) => {
        const row = requireRecord(candidate, `${path}.candidates[${index}]`);
        exactKeys(row, ['provider', 'uuid'], `${path}.candidates[${index}]`);
        validateId(row['provider'], `${path}.candidates[${index}].provider`, asUnitProviderId);
        validateId(row['uuid'], `${path}.candidates[${index}].uuid`, asUnitUuid);
    });
}

function validateEncounter(
    value: unknown,
    instances: ReadonlyMap<string, 'ready' | 'deferred'>,
    targets: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlySet<string> {
    const encounter = requireRecord(value, '$.encounter');
    exactKeys(encounter, ['encounterRevision', 'state', 'recovery'], '$.encounter');
    const outerRevision = validateRevision(encounter['encounterRevision'], '$.encounter.encounterRevision');
    const state = validateEncounterState(encounter['state'], '$.encounter.state', instances, targets);
    if (state.revision !== outerRevision) {
        fail('REVISION_MISMATCH', '$.encounter.state.encounterRevision', 'outer and encounter revisions differ');
    }
    if (encounter['recovery'] !== undefined) {
        const recovery = requireRecord(encounter['recovery'], '$.encounter.recovery');
        exactKeys(recovery, ['schemaVersion', 'c3Networks'], '$.encounter.recovery');
        if (recovery['schemaVersion'] !== 1) fail('INVALID_SHAPE', '$.encounter.recovery.schemaVersion', 'must be 1');
        const c3Networks = requireArray(recovery['c3Networks'], '$.encounter.recovery.c3Networks');
        c3Networks.forEach((network, index) =>
            assertJson(network, `$.encounter.recovery.c3Networks[${index}]`));
        if (state.typedNetworkCount > 0 && c3Networks.length > 0) {
            fail(
                'INVALID_SHAPE',
                '$.encounter',
                'typed C3 networks cannot coexist with legacy component-index C3 authority',
            );
        }
    }
    return state.factIds;
}

function validateEncounterState(
    value: unknown,
    path: string,
    instances: ReadonlyMap<string, 'ready' | 'deferred'>,
    targets: ReadonlyMap<string, ReadonlySet<string>>,
): { readonly revision: number; readonly factIds: Set<string>; readonly typedNetworkCount: number } {
    const state = requireRecord(value, path);
    exactKeys(state, ['schemaVersion', 'encounterRevision', 'facts'], path);
    if (state['schemaVersion'] !== 2) fail('INVALID_SHAPE', `${path}.schemaVersion`, 'must be 2');
    const revision = validateRevision(state['encounterRevision'], `${path}.encounterRevision`);
    const facts = requireArray(state['facts'], `${path}.facts`);
    if (facts.length > MAX_SERIALIZED_ENCOUNTER_FACTS) {
        fail('INVALID_SHAPE', `${path}.facts`, `cannot contain more than ${MAX_SERIALIZED_ENCOUNTER_FACTS} facts`);
    }
    const factIds = new Set<string>();
    const targetIds = new Set<string>();
    const targetLetters = new Set<string>();
    const networkIds = new Set<string>();
    let previous: string | undefined;
    facts.forEach((raw, index) => {
        const factPath = `${path}.facts[${index}]`;
        const fact = requireRecord(raw, factPath);
        const factId = validateId(fact['factId'], `${factPath}.factId`);
        if (factIds.has(factId)) fail('INVALID_SHAPE', `${factPath}.factId`, 'duplicate encounter fact ID');
        if (previous !== undefined && previous >= factId) fail('INVALID_SHAPE', `${factPath}.factId`, 'encounter facts must be sorted by ID');
        previous = factId;
        factIds.add(factId);
        if (fact['kind'] === 'target') {
            exactKeys(fact, ['kind', 'factId', 'target'], factPath);
            const target = validateEncounterTargetFact(
                fact['target'], `${factPath}.target`, targetIds, targetLetters,
            );
            if (factId !== encounterTargetFactId(target.id)) {
                fail('INVALID_SHAPE', `${factPath}.factId`, 'target fact ID must be derived from its stable target ID');
            }
        } else if (fact['kind'] === 'network') {
            exactKeys(fact, ['kind', 'factId', 'network'], factPath);
            const networkId = validateEncounterNetworkFact(
                fact['network'], `${factPath}.network`, instances, networkIds,
            );
            if (factId !== encounterNetworkFactId(networkId)) {
                fail('INVALID_SHAPE', `${factPath}.factId`, 'network fact ID must be derived from its stable network ID');
            }
        } else if (fact['kind'] === 'network-link') {
            exactKeys(fact, ['kind', 'factId', 'networkType', 'endpoints'], factPath);
            validateId(fact['networkType'], `${factPath}.networkType`);
            const endpointKeys = new Set<string>();
            const endpoints = requireArray(fact['endpoints'], `${factPath}.endpoints`);
            if (endpoints.length < 2) fail('ENCOUNTER_ENDPOINT_INVALID', `${factPath}.endpoints`, 'a network needs at least two endpoints');
            endpoints.forEach((endpoint, endpointIndex) => {
                const key = validateEncounterEndpoint(endpoint, `${factPath}.endpoints[${endpointIndex}]`, instances, targets);
                if (endpointKeys.has(key)) fail('ENCOUNTER_ENDPOINT_INVALID', `${factPath}.endpoints[${endpointIndex}]`, 'duplicate endpoint');
                endpointKeys.add(key);
            });
        } else if (fact['kind'] === 'cross-unit-effect') {
            exactKeys(fact, ['kind', 'factId', 'effectKey', 'source', 'target'], factPath);
            validateId(fact['effectKey'], `${factPath}.effectKey`);
            if (fact['source'] !== undefined) validateEncounterEndpoint(fact['source'], `${factPath}.source`, instances, targets);
            validateEncounterEndpoint(fact['target'], `${factPath}.target`, instances, targets);
        } else fail('INVALID_SHAPE', `${factPath}.kind`, 'unknown encounter fact');
    });
    if (targetIds.size > MAX_SERIALIZED_ENCOUNTER_TARGETS) {
        fail('INVALID_SHAPE', `${path}.facts`, `cannot contain more than ${MAX_SERIALIZED_ENCOUNTER_TARGETS} targets`);
    }
    if (networkIds.size > MAX_SERIALIZED_ENCOUNTER_NETWORKS) {
        fail('INVALID_SHAPE', `${path}.facts`, `cannot contain more than ${MAX_SERIALIZED_ENCOUNTER_NETWORKS} networks`);
    }
    return { revision, factIds, typedNetworkCount: networkIds.size };
}

function validateEncounterTargetFact(
    value: unknown,
    path: string,
    targetIds: Set<string>,
    targetLetters: Set<string>,
): { readonly id: string } {
    const target = requireRecord(value, path);
    exactKeys(target, [
        'id', 'letter', 'name', 'color', 'source', 'readOnly', 'unitType', 'tnCalculator',
    ], path);
    const id = validateEncounterStableId(target['id'], `${path}.id`, 'target ID');
    if (targetIds.has(id)) fail('INVALID_SHAPE', `${path}.id`, 'duplicate encounter target ID');
    targetIds.add(id);
    const letter = validateBoundedText(target['letter'], `${path}.letter`, 1, 4);
    if (!/^[A-Z]+$/.test(letter)) fail('INVALID_SHAPE', `${path}.letter`, 'must contain only uppercase ASCII letters');
    if (targetLetters.has(letter)) fail('INVALID_SHAPE', `${path}.letter`, 'duplicate encounter target letter');
    targetLetters.add(letter);
    validateBoundedText(target['name'], `${path}.name`, 1, 160);
    validateEncounterColor(target['color'], `${path}.color`);
    if (target['source'] !== undefined && target['source'] !== 'manual' && target['source'] !== 'opfor') {
        fail('INVALID_SHAPE', `${path}.source`, 'must be manual or opfor');
    }
    if (target['readOnly'] !== undefined && typeof target['readOnly'] !== 'boolean') {
        fail('INVALID_SHAPE', `${path}.readOnly`, 'must be a boolean');
    }
    if ((target['source'] === 'opfor') !== (target['readOnly'] === true)) {
        fail(
            'INVALID_SHAPE',
            path,
            'opfor targets must be read-only and only opfor targets may be read-only',
        );
    }
    if (target['unitType'] !== undefined && !ENCOUNTER_TARGET_UNIT_TYPES.has(String(target['unitType']))) {
        fail('INVALID_SHAPE', `${path}.unitType`, 'unknown target unit type');
    }
    if (target['tnCalculator'] !== undefined) {
        validateEncounterTargetCalculator(target['tnCalculator'], `${path}.tnCalculator`);
    }
    return { id };
}

const ENCOUNTER_TARGET_UNIT_TYPES = new Set<string>([
    'mek-biped', 'mek-quad', 'mek-tripod', 'battle-armor', 'vehicle', 'vtol-wige',
    'infantry', 'protoMek', 'aero', 'terrain', 'building',
] satisfies readonly TnTargetUnitType[]);
const ENCOUNTER_MOVEMENT_BRACKETS = new Set<string>([
    '0-2', '3-4', '5-6', '7-9', '10-17', '18-24', '25+',
] satisfies readonly TnTargetMovementBracketId[]);
const ENCOUNTER_TARGET_COVERS = new Set<string>([
    'none', 'light', 'heavy',
] satisfies readonly TnTargetHexCover[]);
const ENCOUNTER_TARGET_WATER_DEPTHS = new Set([
    'underwater-depth-1', 'underwater-depth-2', 'underwater-depth-3',
]);
const ENCOUNTER_TARGET_BUILDING_LEVELS = new Set([
    'building-1', 'building-2', 'building-3',
]);
const ENCOUNTER_STEALTH_SYSTEMS = new Set([
    'stealth-armor', 'null-signature', 'chameleon', 'chameleon-null',
    'ba-basic', 'ba-standard', 'ba-improved', 'mimetic', 'simple-camo',
]);

function validateEncounterNonNegativeInteger(value: unknown, path: string): void {
    if (!Number.isSafeInteger(value) || Number(value) < 0) {
        fail('INVALID_SHAPE', path, 'must be a non-negative integer');
    }
}

function validateEncounterRangeModifiers(value: unknown, path: string): void {
    const modifiers = requireRecord(value, path);
    exactKeys(modifiers, ['short', 'medium', 'long'], path);
    for (const key of ['short', 'medium', 'long'] as const) {
        if (!Number.isSafeInteger(modifiers[key])) {
            fail('INVALID_SHAPE', `${path}.${key}`, 'must be an integer');
        }
    }
}

function validateEncounterStealth(value: unknown, path: string): void {
    if (value === undefined || typeof value === 'boolean') return;
    const stealth = requireRecord(value, path);
    exactKeys(stealth, [
        'short', 'medium', 'long', 'conventionalInfantry', 'secondaryTargetRestricted',
    ], path);
    validateEncounterRangeModifiers({
        short: stealth['short'],
        medium: stealth['medium'],
        long: stealth['long'],
    }, path);
    if (stealth['conventionalInfantry'] !== undefined) {
        validateEncounterRangeModifiers(stealth['conventionalInfantry'], `${path}.conventionalInfantry`);
    }
    if (stealth['secondaryTargetRestricted'] !== undefined
        && typeof stealth['secondaryTargetRestricted'] !== 'boolean') {
        fail('INVALID_SHAPE', `${path}.secondaryTargetRestricted`, 'must be a boolean');
    }
}

function validateEncounterTargetCalculator(value: unknown, path: string): void {
    const calculator = requireRecord(value, path);
    exactKeys(calculator, [
        'isAirborne', 'targetMovementBracket', 'targetMovementDistance', 'skidding', 'prone', 'immobile',
        'targetHexCover', 'waterDepth', 'buildingCover', 'targetHeight', 'largeTarget',
        'narcAboveWater', 'narcUnderwater', 'tagged', 'ecmShielded', 'stealth', 'stealthSystem',
    ], path);
    for (const key of [
        'isAirborne', 'skidding', 'prone', 'immobile', 'largeTarget',
        'narcAboveWater', 'narcUnderwater', 'tagged', 'ecmShielded',
    ] as const) {
        if (calculator[key] !== undefined && typeof calculator[key] !== 'boolean') {
            fail('INVALID_SHAPE', `${path}.${key}`, 'must be a boolean');
        }
    }
    if (calculator['targetMovementBracket'] !== undefined
        && calculator['targetMovementBracket'] !== null
        && !ENCOUNTER_MOVEMENT_BRACKETS.has(String(calculator['targetMovementBracket']))) {
        fail('INVALID_SHAPE', `${path}.targetMovementBracket`, 'unknown movement bracket');
    }
    if (calculator['targetMovementDistance'] !== undefined
        && calculator['targetMovementDistance'] !== null) {
        validateEncounterNonNegativeInteger(calculator['targetMovementDistance'], `${path}.targetMovementDistance`);
    }
    if (calculator['targetHexCover'] !== undefined && !ENCOUNTER_TARGET_COVERS.has(String(calculator['targetHexCover']))) {
        fail('INVALID_SHAPE', `${path}.targetHexCover`, 'unknown target cover');
    }
    if (calculator['waterDepth'] !== undefined
        && !ENCOUNTER_TARGET_WATER_DEPTHS.has(String(calculator['waterDepth']))) {
        fail('INVALID_SHAPE', `${path}.waterDepth`, 'unknown target water depth');
    }
    if (calculator['buildingCover'] !== undefined
        && !ENCOUNTER_TARGET_BUILDING_LEVELS.has(String(calculator['buildingCover']))) {
        fail('INVALID_SHAPE', `${path}.buildingCover`, 'unknown target building cover');
    }
    if (calculator['targetHeight'] !== undefined
        && calculator['targetHeight'] !== 1
        && calculator['targetHeight'] !== 2
        && calculator['targetHeight'] !== 3) {
        fail('INVALID_SHAPE', `${path}.targetHeight`, 'must be 1, 2, or 3');
    }
    validateEncounterStealth(calculator['stealth'], `${path}.stealth`);
    if (calculator['stealthSystem'] !== undefined
        && !ENCOUNTER_STEALTH_SYSTEMS.has(String(calculator['stealthSystem']))) {
        fail('INVALID_SHAPE', `${path}.stealthSystem`, 'unknown stealth system');
    }
}

function validateEncounterNetworkFact(
    value: unknown,
    path: string,
    instances: ReadonlyMap<string, 'ready' | 'deferred'>,
    networkIds: Set<string>,
): string {
    const network = requireRecord(value, path);
    exactKeys(network, ['id', 'networkType', 'color', 'endpoints'], path);
    const networkId = validateEncounterStableId(network['id'], `${path}.id`, 'network ID');
    if (networkIds.has(networkId)) fail('INVALID_SHAPE', `${path}.id`, 'duplicate encounter network ID');
    networkIds.add(networkId);
    const networkType = String(network['networkType']);
    if (!['c3', 'c3i', 'naval', 'nova'].includes(networkType)) {
        fail('INVALID_SHAPE', `${path}.networkType`, 'unknown C3 network type');
    }
    validateEncounterColor(network['color'], `${path}.color`);
    const endpoints = requireArray(network['endpoints'], `${path}.endpoints`);
    // Persistence owns only shape and resource bounds. C3 topology is validated
    // once, after unit hydration, by C3NetworkEditor through the force boundary.
    if (endpoints.length > MAX_SERIALIZED_ENCOUNTER_FACTS) {
        fail(
            'INVALID_SHAPE',
            `${path}.endpoints`,
            `cannot contain more than ${MAX_SERIALIZED_ENCOUNTER_FACTS} endpoints`,
        );
    }
    const endpointKeys = new Set<string>();
    let previous: string | undefined;
    endpoints.forEach((raw, index) => {
        const endpointPath = `${path}.endpoints[${index}]`;
        const endpoint = requireRecord(raw, endpointPath);
        exactKeys(endpoint, ['instanceId', 'componentId', 'role'], endpointPath);
        const instanceId = validateId(endpoint['instanceId'], `${endpointPath}.instanceId`, asUnitInstanceId);
        if (instances.get(instanceId) !== 'ready') {
            fail('ENCOUNTER_ENDPOINT_INVALID', `${endpointPath}.instanceId`, 'typed network endpoints may reference only ready units');
        }
        const componentId = validateId(endpoint['componentId'], `${endpointPath}.componentId`, asComponentId);
        const role = endpoint['role'];
        if (role !== 'master' && role !== 'member' && role !== 'peer') {
            fail('ENCOUNTER_ENDPOINT_INVALID', `${endpointPath}.role`, 'unknown network endpoint role');
        }
        const key = `${instanceId}\0${componentId}`;
        if (endpointKeys.has(key)) fail('ENCOUNTER_ENDPOINT_INVALID', endpointPath, 'duplicate network endpoint');
        if (previous !== undefined && previous >= key) {
            fail('INVALID_SHAPE', endpointPath, 'network endpoints must be unique and sorted by stable identity');
        }
        endpointKeys.add(key);
        previous = key;
    });
    return networkId;
}

function validateEncounterStableId(value: unknown, path: string, label: string): string {
    const id = validateBoundedText(value, path, 1, 128);
    if (id.includes('\0')) fail('INVALID_SHAPE', path, `${label} must not contain NUL`);
    return id;
}

function validateBoundedText(value: unknown, path: string, minimum: number, maximum: number): string {
    if (typeof value !== 'string') fail('INVALID_SHAPE', path, 'must be a string');
    const text = value as string;
    if (text.length < minimum || text.length > maximum || text.trim() !== text) {
        fail('INVALID_SHAPE', path, `must be ${minimum}-${maximum} characters without surrounding whitespace`);
    }
    if (text.includes('\0')) fail('INVALID_SHAPE', path, 'must not contain NUL');
    return text;
}

function validateEncounterColor(value: unknown, path: string): void {
    if (typeof value !== 'string'
        || !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
        fail('INVALID_SHAPE', path, 'must be a three- or six-digit hexadecimal color');
    }
}

function validateEncounterEndpoint(
    value: unknown,
    path: string,
    instances: ReadonlyMap<string, 'ready' | 'deferred'>,
    targets: ReadonlyMap<string, ReadonlySet<string>>,
): string {
    const endpoint = requireRecord(value, path);
    exactKeys(endpoint, ['instanceId', 'target'], path);
    const instance = validateId(endpoint['instanceId'], `${path}.instanceId`, asUnitInstanceId);
    if (instances.get(instance) !== 'ready') {
        fail('ENCOUNTER_ENDPOINT_INVALID', `${path}.instanceId`, 'typed encounter facts may reference only ready units');
    }
    let ref = '';
    if (endpoint['target'] !== undefined) {
        ref = validateId(endpoint['target'], `${path}.target`, asSavedTargetRef);
    }
    return `${instance}\0${ref}`;
}

function validateForceRestoration(
    value: unknown,
    factIds: ReadonlySet<string>,
): void {
    if (value === undefined) return;
    const metadata = requireRecord(value, '$.restoration');
    exactKeys(metadata, ['schemaVersion', 'unresolvedEncounter'], '$.restoration');
    if (metadata['schemaVersion'] !== 2) fail('INVALID_SHAPE', '$.restoration.schemaVersion', 'must be 2');
    validateEncounterRecovery(metadata, factIds);
}

function validateEncounterRecovery(metadata: Record<string, unknown>, factIds: ReadonlySet<string>): void {
    const recoveryIds = new Set<string>();
    requireArray(metadata['unresolvedEncounter'], '$.restoration.unresolvedEncounter').forEach((raw, index) => {
        const path = `$.restoration.unresolvedEncounter[${index}]`;
        const row = requireRecord(raw, path);
        exactKeys(row, ['recoveryId', 'fact', 'reason'], path);
        const id = validateId(row['recoveryId'], `${path}.recoveryId`);
        if (recoveryIds.has(id)) fail('INVALID_SHAPE', `${path}.recoveryId`, 'duplicate recovery ID');
        recoveryIds.add(id);
        assertJson(row['fact'], `${path}.fact`);
        requireString(row, 'reason', path);
    });
}

function validateOptionalStringFields(record: Record<string, unknown>, path: string, keys: readonly string[]): void {
    for (const key of keys) {
        const value = record[key];
        if (value !== undefined && typeof value !== 'string') fail('INVALID_SHAPE', `${path}.${key}`, 'must be a string');
        if (typeof value === 'string' && value.includes('\0')) fail('INVALID_SHAPE', `${path}.${key}`, 'must not contain NUL');
    }
}

function validateOptionalNonnegative(record: Record<string, unknown>, path: string, keys: readonly string[]): void {
    for (const key of keys) if (record[key] !== undefined) requireSafeNonnegative(record[key], `${path}.${key}`);
}

function validateStringArray(value: unknown, path: string): void {
    requireArray(value, path).forEach((entry, index) => validateId(entry, `${path}[${index}]`));
}

function validateUniqueSortedStrings(value: unknown, path: string): void {
    let previous: string | undefined;
    requireArray(value, path).forEach((entry, index) => {
        const current = validateId(entry, `${path}[${index}]`);
        if (previous !== undefined && previous >= current) fail('INVALID_SHAPE', `${path}[${index}]`, 'values must be unique and sorted');
        previous = current;
    });
}

function validateUniqueSortedUnitConditions(value: unknown, path: string): void {
    let previous: UnitConditionKey | undefined;
    requireArray(value, path).forEach((entry, index) => {
        const entryPath = `${path}[${index}]`;
        const current = validateId(entry, entryPath);
        if (!isUnitConditionKey(current)) fail('INVALID_SHAPE', entryPath, 'unknown unit condition');
        if (previous !== undefined && previous >= current) {
            fail('INVALID_SHAPE', entryPath, 'values must be unique and sorted');
        }
        previous = current;
    });
}

function validateSlotCoordinates(value: unknown, path: string): void {
    requireArray(value, path).forEach((raw, index) => {
        const coordinate = requireRecord(raw, `${path}[${index}]`);
        exactKeys(coordinate, ['location', 'slot'], `${path}[${index}]`);
        validateId(coordinate['location'], `${path}[${index}].location`);
        validateOrdinal(coordinate['slot'], `${path}[${index}].slot`);
    });
}

function validateOrdinal(value: unknown, path: string): number {
    if (typeof value !== 'number') fail('INVALID_SHAPE', path, 'must be a one-based slot ordinal');
    try { return asOneBasedCriticalSlotOrdinal(value as number); }
    catch (error) { throw validationError('INVALID_SHAPE', error, path); }
}

function validateRevision(value: unknown, path: string): number {
    if (typeof value !== 'number') fail('INVALID_SHAPE', path, 'must be a state revision');
    try { return asStateRevision(value as number); }
    catch (error) { throw validationError('INVALID_SHAPE', error, path); }
}

function validateId(
    value: unknown,
    path: string,
    constructor: (text: string) => string = text => asBoundedId(text, 'identifier'),
): string {
    if (typeof value !== 'string') fail('INVALID_SHAPE', path, 'must be a string identifier');
    try { return constructor(value as string); }
    catch (error) { throw validationError('INVALID_SHAPE', error, path); }
}

function requireSafeNonnegative(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail('INVALID_SHAPE', path, 'must be a non-negative safe integer');
    return value as number;
}

function requireSafeInteger(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        fail('INVALID_SHAPE', path, 'must be a safe integer');
    }
    return value;
}

function requireSignedSparseDelta(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value === 0) {
        fail('INVALID_SHAPE', path, 'must be a non-zero signed safe-integer delta');
    }
    return value;
}

function requirePositiveInteger(value: unknown, path: string): number {
    const parsed = requireSafeNonnegative(value, path);
    if (parsed < 1) fail('INVALID_SHAPE', path, 'must be positive');
    return parsed;
}

function requireFiniteNumber(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) fail('INVALID_SHAPE', path, 'must be a canonical finite number');
    return value as number;
}

function requireString(record: Record<string, unknown>, key: string, path: string): string {
    const value = record[key];
    if (typeof value !== 'string') fail('INVALID_SHAPE', `${path}.${key}`, 'must be a string');
    return value as string;
}

function requireArray(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) fail('INVALID_SHAPE', path, 'must be an array');
    return value;
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
    if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('INVALID_SHAPE', path, 'must be a plain object');
    return value as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[], path: string): void {
    const set = new Set(allowed);
    for (const key of Object.keys(record)) if (!set.has(key)) fail('INVALID_SHAPE', `${path}.${key}`, 'unknown field');
}

function assertJson(value: unknown, path: string, ancestors = new Set<object>()): asserts value is JsonValue {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') { requireFiniteNumber(value, path); return; }
    if (typeof value !== 'object') fail('INVALID_SHAPE', path, 'must be JSON data');
    if (ancestors.has(value as object)) fail('INVALID_SHAPE', path, 'contains a cycle');
    ancestors.add(value as object);
    if (Array.isArray(value)) value.forEach((entry, index) => assertJson(entry, `${path}[${index}]`, ancestors));
    else {
        if (Object.getPrototypeOf(value) !== Object.prototype) fail('INVALID_SHAPE', path, 'must use plain JSON objects');
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
            if (entry === undefined) fail('INVALID_SHAPE', `${path}.${key}`, 'must not be undefined');
            assertJson(entry, `${path}.${key}`, ancestors);
        }
    }
    ancestors.delete(value as object);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function validationError(code: ForceEnvelopeValidationCode, error: unknown, path: string): ForceEnvelopeValidationError {
    return error instanceof ForceEnvelopeValidationError
        ? error
        : new ForceEnvelopeValidationError(code, errorMessage(error), path);
}

function fail(code: ForceEnvelopeValidationCode, path: string, message: string): never {
    throw new ForceEnvelopeValidationError(code, message, path);
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
    if (value === null || typeof value !== 'object' || seen.has(value as object)) return value;
    seen.add(value as object);
    if (Array.isArray(value)) value.forEach(entry => deepFreeze(entry, seen));
    else Object.values(value as Record<string, unknown>).forEach(entry => deepFreeze(entry, seen));
    return Object.freeze(value);
}
