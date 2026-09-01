// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { jsonValuesEqual } from '../../utils/json-value.util';
import { compareText } from '../../utils/string.util';
import {
    asCriticalSlotId,
    asLocationId,
    type ComponentId,
    type CriticalSlotId,
    type LocationId,
} from '../entity/entity-identifiers';
import type {
    MekActuatorKind,
    MekExactComponentGroup,
    MekMechanicsProfile,
} from './mek-mechanics-profile';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type { MekDestructionFactsV2 } from './mek-destruction-state-v2';
import { mekHeatEffects } from '../rules/mek-heat-rules';
import {
    projectMekShieldsV2,
    type MekShieldRuntimeFactsV2,
} from './mek-shield-rules';

export const MEK_MOVEMENT_PSR_STATE_SCHEMA_VERSION = 2 as const;
export const MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION = 1 as const;
export const MEK_ACTION_DECLARATION_SCHEMA_VERSION = 1 as const;
export const MAX_MEK_PILOT_CHECKS_V2 = 256;
export const MAX_MEK_PILOT_CHECK_WITNESS_LENGTH_V2 = 16_384;
export const MAX_MEK_MOVEMENT_MP_V2 = 1_000;
export const MAX_MEK_PILOT_TARGET_V2 = 100;

export type MekMovementModeV2 = 'stationary' | 'walk' | 'run' | 'sprint' | 'jump' | 'UMU';
/** Detached movement facts consumed by heat settlement, including retained VTOL recovery. */
export interface MekMovementHeatInputV2 {
    readonly mode: MekMovementModeV2 | 'VTOL';
    readonly distance: number;
}
export type MekActionIntentKindV2 = 'shutdown' | 'startup';
export type MekPilotCheckOutcomeV2 = 'success' | 'failed';
export type MekPilotCheckStatusV2 = 'pending' | MekPilotCheckOutcomeV2;

export interface MekMovementDeclarationV2 {
    readonly schemaVersion: typeof MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION;
    readonly mode: MekMovementModeV2;
    readonly distance: number;
    /** Exact active MASC/supercharger components selected for this Run or Sprint. */
    readonly boosterComponentIds: readonly ComponentId[];
}

export interface MekActionDeclarationV2 {
    readonly schemaVersion: typeof MEK_ACTION_DECLARATION_SCHEMA_VERSION;
    readonly kind: MekActionIntentKindV2;
}

export type MekPilotCheckTriggerKindV2 =
    | 'damage-total-20'
    | 'leg-actuator-hit'
    | 'hip-hit'
    | 'gyro-hit'
    | 'leg-destroyed'
    | 'move-damaged-gyro'
    | 'move-damaged-leg'
    | 'move-damaged-actuator'
    | 'sprint-booster'
    | 'get-up'
    | 'shutdown';

export type MekPilotCheckSourceKindV2 = 'damage' | 'movement' | 'action';

/**
 * Machine identity for one exact trigger. `witness` is canonical JSON made by
 * this module. Display reason text is intentionally absent: copy edits cannot
 * settle, merge, or reopen a rules check.
 */
export interface MekPilotCheckSourceV2 {
    readonly sourceKind: MekPilotCheckSourceKindV2;
    readonly triggerKind: MekPilotCheckTriggerKindV2;
    readonly witness: string;
    readonly criticalSlotIds: readonly CriticalSlotId[];
    readonly locationIds: readonly LocationId[];
    readonly baseTarget: number;
    readonly triggerModifier: number;
}

export interface MekPilotCheckResolutionEvidenceV2 {
    readonly dice: readonly [number, number];
    readonly total: number;
}

export interface MekPilotCheckV2 {
    readonly checkId: string;
    readonly source: MekPilotCheckSourceV2;
    readonly producingRevision: number;
    readonly ordinal: number;
    readonly targetNumber: number;
    readonly reason: string;
    readonly status: MekPilotCheckStatusV2;
    readonly resolution?: MekPilotCheckResolutionEvidenceV2;
}

/** Durable declarations and outcomes only. Legality and modifiers are projections. */
export interface MekMovementPsrStateV2 {
    readonly movement: MekMovementDeclarationV2 | null;
    readonly action: MekActionDeclarationV2 | null;
    readonly standAttempts: number;
    readonly carefulStand: boolean;
    readonly damageThisPhase: number;
    readonly checks: readonly MekPilotCheckV2[];
    readonly automaticFalls: readonly MekAutomaticFallV2[];
}

export interface MekMovementPsrRuntimeFactsV2 extends MekShieldRuntimeFactsV2 {
    readonly rulesFlavor: CBTRuleset;
    readonly sprintingAllowed: boolean;
    readonly currentHeat: number;
    readonly airborne: boolean;
    readonly pilotingSkill: number;
    readonly functionalCrew: boolean;
    /**
     * Whether the dedicated occurrence-zero pilot is currently able to control
     * a tripod. The runtime owner selects crew and cockpit-seat authority; this
     * pure kernel consumes only the resulting narrow rules fact.
     */
    readonly dedicatedPilotFunctional: boolean;
    readonly conditions: ReadonlySet<'shutdown' | 'prone' | 'disconnected'>;
    readonly destruction: MekDestructionFactsV2;
    componentAvailable(componentId: ComponentId): boolean;
    componentDisabled(componentId: ComponentId): boolean;
    componentBoosterActive(componentId: ComponentId): boolean;
    modularArmorRemaining(componentId: ComponentId): number;
    criticalSlotUnavailable(slotId: CriticalSlotId): boolean;
    criticalSlotDestroyedTurn(slotId: CriticalSlotId): number | undefined;
    locationDestroyed(locationId: LocationId): boolean;
}

export type MekMovementBlockReasonCodeV2 =
    | 'DESTROYED'
    | 'SHUTDOWN'
    | 'NO_FUNCTIONAL_CONTROL'
    | 'PRONE'
    | 'NOT_PRONE'
    | 'IMMOBILE'
    | 'NO_MOVEMENT_POINTS'
    | 'OPTION_DISABLED'
    | 'AIRBORNE'
    | 'INSUFFICIENT_HIPS'
    | 'RUN_UNAVAILABLE'
    | 'CAREFUL_STAND'
    | 'ALREADY_SHUTDOWN'
    | 'NOT_SHUTDOWN';

export type MekMovementWarningCodeV2 =
    | 'MOVEMENT_IMPAIRED'
    | 'BOOSTER_FAILURE_CHECK'
    | 'HARDENED_RUN_PENALTY'
    | 'TSM_ACTIVE'
    | 'TSM_POTENTIAL'
    | 'PARTIAL_WING_DAMAGED'
    | 'PENDING_DAMAGE_PREVIEW'
    | 'PILOT_CHECK_REQUIRED'
    | 'DRONE_CONTROLLED';

export interface MekMovementMessageV2<TCode extends string> {
    readonly code: TCode;
    readonly message: string;
}

export interface MekLegalActionProjectionV2 {
    readonly kind: MekMovementModeV2 | MekActionIntentKindV2 | 'get-up';
    readonly legal: boolean;
    readonly minimumMp?: number;
    readonly maximumMp?: number;
    readonly ordinaryMaximumMp?: number;
    readonly requiresPilotCheck?: boolean;
    readonly reasons: readonly MekMovementMessageV2<MekMovementBlockReasonCodeV2>[];
    readonly warnings: readonly MekMovementMessageV2<MekMovementWarningCodeV2>[];
}

export interface MekStandUpProjectionV2 {
    readonly attempts: number;
    readonly carefulStand: boolean;
    readonly movementPointsSpent: number;
    readonly movementMode: 'walk' | 'run' | null;
    readonly requiresPilotCheck: boolean;
    readonly targetNumber: number;
    readonly standingModifier: -1 | 0;
    readonly supportsCarefulStand: boolean;
    readonly canCarefulStand: boolean;
    readonly attemptLimit: 1 | null;
}

/** One rules-owned piloting modifier, ready for any UI to label by stable location. */
export interface MekPsrModifier {
    readonly modifier: number;
    readonly reason: string;
    readonly modifierReason?: string;
    readonly locationId?: LocationId;
}

export interface MekMovementPsrProjectionV2 {
    readonly kind: 'supported';
    readonly rulesFlavor: CBTRuleset;
    readonly controlledByDrone: boolean;
    readonly immobile: boolean;
    readonly walkMp: number;
    readonly potentialWalkMp: number;
    readonly runMp: number;
    readonly maximumRunMp: number;
    readonly sprintMp: number;
    readonly maximumSprintMp: number;
    readonly jumpMp: number;
    readonly umuMp: number;
    readonly movementImpaired: boolean;
    readonly permanentPsrModifier: number;
    readonly permanentPsrModifiers: readonly MekPsrModifier[];
    readonly pilotingTargetNumber: number;
    readonly standing: MekStandUpProjectionV2;
    readonly actions: readonly MekLegalActionProjectionV2[];
    readonly declaration: MekDeclarationLegalityV2 | null;
}

export interface MekMovementPsrUnsupportedV2 {
    readonly kind: 'unsupported';
    readonly blockers: readonly string[];
}

export type MekMovementPsrProjectionResultV2 =
    | MekMovementPsrProjectionV2
    | MekMovementPsrUnsupportedV2;

/** Damage-sensitive, transient-free movement used only by current BV. */
export type MekBattleValueMovementProjectionV2 =
    | Readonly<{
        kind: 'supported';
        walkMp: number;
        runMp: number;
        jumpMp: number;
        umuMp: number;
    }>
    | MekMovementPsrUnsupportedV2;

export interface MekDeclarationLegalityV2 {
    readonly legal: boolean;
    readonly maximumMp: number;
    readonly reasons: readonly MekMovementMessageV2<MekMovementBlockReasonCodeV2>[];
    readonly warnings: readonly MekMovementMessageV2<MekMovementWarningCodeV2>[];
}

export type MekCommittedDamageMutationV2 =
    | {
        readonly kind: 'critical';
        readonly slotId: CriticalSlotId;
        readonly beforeHits: number;
        readonly afterHits: number;
        readonly beforeUnavailable: boolean;
        readonly afterUnavailable: boolean;
        readonly receivedDamage: 0;
    }
    | {
        readonly kind: 'internal';
        readonly locationId: LocationId;
        readonly beforeRemaining: number;
        readonly afterRemaining: number;
        readonly beforeDestroyed: boolean;
        readonly afterDestroyed: boolean;
        readonly receivedDamage: number;
    }
    | {
        readonly kind: 'armor';
        /** Stable ArmorFaceId is intentionally carried as bounded text. */
        readonly faceId: string;
        readonly beforeRemaining: number;
        readonly afterRemaining: number;
        readonly receivedDamage: number;
    };

export interface MekPilotCheckDiceEvidenceV2 {
    readonly dice: readonly [number, number];
    /** Optional UI assertion. It is verified and never treated as authority. */
    readonly claimedOutcome?: MekPilotCheckOutcomeV2;
}

export type MekAutomaticFallTriggerKindV2 =
    | 'gyro-destroyed'
    | 'leg-destroyed-auto-fall';

/** A phase-scoped fall that needs no dice and becomes prone at the boundary. */
export interface MekAutomaticFallV2 {
    readonly triggerKind: MekAutomaticFallTriggerKindV2;
    readonly locationIds: readonly LocationId[];
}

export interface MekCommittedDamagePilotCheckSynthesisResultV2 {
    readonly state: MekMovementPsrStateV2;
}

export type MekPilotCheckResolutionResultV2 =
    | {
        readonly accepted: true;
        readonly outcome: MekPilotCheckOutcomeV2;
        readonly failed: boolean;
        readonly state: MekMovementPsrStateV2;
    }
    | {
        readonly accepted: false;
        readonly reason: 'INVALID_CHECK' | 'INVALID_DICE_EVIDENCE' | 'OUTCOME_MISMATCH';
    };

export type MekMovementStateTransitionV2 =
    | { readonly accepted: true; readonly state: MekMovementPsrStateV2 }
    | {
        readonly accepted: false;
        readonly reason: 'UNSUPPORTED' | 'ILLEGAL_DECLARATION' | 'INVALID_DECLARATION';
        readonly blockers: readonly string[];
    };

export type MekStandAttemptResolutionV2 =
    | {
        readonly accepted: true;
        readonly outcome: MekPilotCheckOutcomeV2;
        readonly failed: boolean;
        readonly state: MekMovementPsrStateV2;
    }
    | {
        readonly accepted: false;
        readonly reason:
            | 'UNSUPPORTED'
            | 'ILLEGAL_DECLARATION'
            | 'INVALID_DECLARATION'
            | 'INVALID_DICE_EVIDENCE'
            | 'OUTCOME_MISMATCH';
        readonly blockers: readonly string[];
    };

export interface SerializedMekMovementPsrStateV2 {
    readonly schemaVersion: typeof MEK_MOVEMENT_PSR_STATE_SCHEMA_VERSION;
    readonly movement?: MekMovementDeclarationV2;
    readonly action?: MekActionDeclarationV2;
    readonly standAttempts?: number;
    readonly carefulStand?: true;
    readonly damageThisPhase?: number;
    readonly checks?: readonly SerializedMekPilotCheckV2[];
    readonly automaticFalls?: readonly MekAutomaticFallV2[];
}

export interface SerializedMekPilotCheckV2 {
    readonly checkId: string;
    readonly source: MekPilotCheckSourceV2;
    readonly producingRevision: number;
    readonly ordinal: number;
    readonly targetNumber: number;
    readonly reason: string;
    readonly status: MekPilotCheckStatusV2;
    readonly resolution?: MekPilotCheckResolutionEvidenceV2;
}

export type MekMovementPsrRemapIdentityKindV2 =
    | 'component'
    | 'critical-slot'
    | 'location'
    | 'state';

/**
 * Each resolver returns the complete exact candidate set for one source ID.
 * An empty set is missing and more than one distinct candidate is ambiguous;
 * the remapper never assumes that an omitted source retained its old ID.
 */
export interface MekMovementPsrIdRemapResolversV2 {
    readonly componentId: (sourceId: ComponentId) => readonly ComponentId[];
    readonly criticalSlotId: (sourceId: CriticalSlotId) => readonly CriticalSlotId[];
    readonly locationId: (sourceId: LocationId) => readonly LocationId[];
}

export type MekMovementPsrRemapUnresolvedCodeV2 =
    | 'INVALID_STATE'
    | 'INVALID_RESOLVER_RESULT'
    | 'MISSING_ID_MAPPING'
    | 'AMBIGUOUS_ID_MAPPING'
    | 'TARGET_ID_COLLISION'
    | 'REMAPPED_STATE_INVALID';

/** Machine-readable evidence retained by a persistence owner on failed remap. */
export interface MekMovementPsrRemapUnresolvedV2 {
    readonly code: MekMovementPsrRemapUnresolvedCodeV2;
    readonly identityKind: MekMovementPsrRemapIdentityKindV2;
    readonly sourceIds: readonly string[];
    readonly candidateIds: readonly string[];
    readonly paths: readonly string[];
}

export type MekMovementPsrStateRemapResultV2 =
    | {
        readonly accepted: true;
        readonly state: MekMovementPsrStateV2;
    }
    | {
        readonly accepted: false;
        readonly unresolved: readonly MekMovementPsrRemapUnresolvedV2[];
    };

interface LegDamageSummaryV2 {
    readonly locationId: LocationId;
    readonly destroyed: boolean;
    readonly hipHits: number;
    readonly legActuatorHits: number;
    readonly footHits: number;
}

interface MovementNumbersV2 {
    readonly controlledByDrone: boolean;
    readonly allLimbsDestroyed: boolean;
    readonly movementImpaired: boolean;
    readonly walkMp: number;
    readonly damageWalkMp: number;
    readonly potentialWalkMp: number;
    readonly runMp: number;
    readonly maximumRunMp: number;
    readonly activeRunMp: number;
    readonly runningMinimumMp: number;
    readonly sprintMp: number;
    readonly maximumSprintMp: number;
    readonly activeSprintMp: number;
    readonly jumpMp: number;
    readonly umuMp: number;
    readonly hardened: boolean;
    readonly tsmActive: boolean;
    readonly tsmPotential: boolean;
    readonly partialWingDamaged: boolean;
    readonly permanentPsrModifier: number;
    readonly permanentPsrModifiers: readonly MekPsrModifier[];
}

interface MekPsrModifierProjection {
    readonly modifier: number;
    readonly modifiers: readonly MekPsrModifier[];
}

interface MekPilotCheckSeedV2 {
    readonly source: MekPilotCheckSourceV2;
    readonly reason: string;
}

interface CoreLegPilotCheckGroup {
    readonly firstIndex: number;
    readonly indexes: readonly number[];
    readonly representative: MekPilotCheckV2;
    readonly reason: string;
}

const MOVEMENT_MODES = Object.freeze([
    'stationary', 'walk', 'run', 'sprint', 'jump', 'UMU',
] as const satisfies readonly MekMovementModeV2[]);
const ACTION_KINDS = Object.freeze([
    'shutdown', 'startup',
] as const satisfies readonly MekActionIntentKindV2[]);
const CHECK_STATUSES = Object.freeze([
    'pending', 'success', 'failed',
] as const satisfies readonly MekPilotCheckStatusV2[]);
const CHECK_STATUS_SET: ReadonlySet<string> = new Set(CHECK_STATUSES);
const SOURCE_KINDS = Object.freeze([
    'damage', 'movement', 'action',
] as const satisfies readonly MekPilotCheckSourceKindV2[]);
const SOURCE_KIND_SET: ReadonlySet<string> = new Set(SOURCE_KINDS);
const TRIGGER_KINDS = Object.freeze([
    'damage-total-20', 'leg-actuator-hit', 'hip-hit', 'gyro-hit', 'leg-destroyed',
    'move-damaged-gyro', 'move-damaged-leg', 'move-damaged-actuator', 'sprint-booster',
    'get-up', 'shutdown',
] as const satisfies readonly MekPilotCheckTriggerKindV2[]);
const TRIGGER_KIND_SET: ReadonlySet<string> = new Set(TRIGGER_KINDS);
const AUTOMATIC_FALL_TRIGGER_KINDS = Object.freeze([
    'gyro-destroyed', 'leg-destroyed-auto-fall',
] as const satisfies readonly MekAutomaticFallTriggerKindV2[]);
const AUTOMATIC_FALL_TRIGGER_KIND_SET: ReadonlySet<string> = new Set(AUTOMATIC_FALL_TRIGGER_KINDS);

function isMekPilotCheckStatus(value: unknown): value is MekPilotCheckStatusV2 {
    return typeof value === 'string' && CHECK_STATUS_SET.has(value);
}

function isMekPilotCheckSourceKind(value: unknown): value is MekPilotCheckSourceKindV2 {
    return typeof value === 'string' && SOURCE_KIND_SET.has(value);
}

function isMekPilotCheckTriggerKind(value: unknown): value is MekPilotCheckTriggerKindV2 {
    return typeof value === 'string' && TRIGGER_KIND_SET.has(value);
}

function isMekAutomaticFallTriggerKind(value: unknown): value is MekAutomaticFallTriggerKindV2 {
    return typeof value === 'string' && AUTOMATIC_FALL_TRIGGER_KIND_SET.has(value);
}

const PRISTINE_STATE = freezeState({
    movement: null,
    action: null,
    standAttempts: 0,
    carefulStand: false,
    damageThisPhase: 0,
    checks: [],
    automaticFalls: [],
});

export function createPristineMekMovementPsrStateV2(): MekMovementPsrStateV2 {
    return PRISTINE_STATE;
}

export function canonicalizeMekMovementDeclarationV2(
    value: MekMovementDeclarationV2,
): MekMovementDeclarationV2 {
    if (!plainRecord(value)
        || !exactKeys(value, ['schemaVersion', 'mode', 'distance', 'boosterComponentIds'])
        || value.schemaVersion !== MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION
        || !isMovementMode(value.mode)
        || !canonicalNonnegativeInteger(value.distance, MAX_MEK_MOVEMENT_MP_V2)
        || !Array.isArray(value.boosterComponentIds)) {
        throw new Error('Invalid Mek movement declaration');
    }
    const boosters = canonicalIds(value.boosterComponentIds, 'booster component');
    if (value.mode !== 'run' && value.mode !== 'sprint' && boosters.length > 0) {
        throw new Error('Only Run or Sprint may declare MASC-family boosters');
    }
    if (value.mode === 'stationary' && value.distance !== 0) {
        throw new Error('Movement mode and distance are inconsistent');
    }
    return Object.freeze({
        schemaVersion: MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION,
        mode: value.mode,
        distance: value.distance,
        boosterComponentIds: Object.freeze(boosters as ComponentId[]),
    });
}

export function canonicalizeMekActionDeclarationV2(
    value: MekActionDeclarationV2,
): MekActionDeclarationV2 {
    if (!plainRecord(value)
        || !exactKeys(value, ['schemaVersion', 'kind'])
        || value.schemaVersion !== MEK_ACTION_DECLARATION_SCHEMA_VERSION
        || !isActionKind(value.kind)) {
        throw new Error('Invalid Mek action declaration');
    }
    return Object.freeze({ schemaVersion: MEK_ACTION_DECLARATION_SCHEMA_VERSION, kind: value.kind });
}

export function canonicalizeMekMovementPsrStateV2(
    value: MekMovementPsrStateV2,
): MekMovementPsrStateV2 {
    if (!plainRecord(value)
        || !exactKeys(value, [
            'movement', 'action', 'standAttempts', 'carefulStand', 'damageThisPhase', 'checks',
            'automaticFalls',
        ])
        || !Array.isArray(value.checks)
        || value.checks.length > MAX_MEK_PILOT_CHECKS_V2
        || !Array.isArray(value.automaticFalls)
        || value.automaticFalls.length > MAX_MEK_PILOT_CHECKS_V2
        || !canonicalNonnegativeInteger(value.standAttempts, MAX_MEK_MOVEMENT_MP_V2)
        || typeof value.carefulStand !== 'boolean'
        || (value.carefulStand && value.standAttempts === 0)
        || !canonicalNonnegativeInteger(value.damageThisPhase, 1_000_000)) {
        throw new Error('Invalid Mek movement/PSR state');
    }
    const checks = value.checks.map(canonicalizeCheck);
    const automaticFalls = canonicalAutomaticFalls(value.automaticFalls);
    const ids = new Set<string>();
    const revisionOrdinals = new Set<string>();
    for (const check of checks) {
        if (ids.has(check.checkId)) throw new Error('Duplicate Mek pilot check ID');
        ids.add(check.checkId);
        const revisionOrdinal = `${check.producingRevision}:${check.ordinal}`;
        if (revisionOrdinals.has(revisionOrdinal)) {
            throw new Error('Duplicate Mek pilot check revision/ordinal');
        }
        revisionOrdinals.add(revisionOrdinal);
    }
    return freezeState({
        movement: value.movement === null
            ? null
            : canonicalizeMekMovementDeclarationV2(value.movement),
        action: value.action === null ? null : canonicalizeMekActionDeclarationV2(value.action),
        standAttempts: value.standAttempts,
        carefulStand: value.carefulStand,
        damageThisPhase: value.damageThisPhase,
        checks,
        automaticFalls,
    });
}

/** Pure profile-owned movement, action-legality, and permanent PSR projection. */
export function projectMekMovementPsrV2(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
    state: MekMovementPsrStateV2,
): MekMovementPsrProjectionResultV2 {
    if (profile.rulesFlavor !== facts.rulesFlavor) {
        return unsupported('Mek movement ruleset does not match the entity ruleset');
    }
    if (!canonicalNonnegativeNumber(facts.currentHeat, 1_000_000)
        || !canonicalNonnegativeInteger(facts.pilotingSkill, MAX_MEK_PILOT_TARGET_V2)
        || typeof facts.sprintingAllowed !== 'boolean'
        || typeof facts.airborne !== 'boolean'
        || typeof facts.functionalCrew !== 'boolean'
        || typeof facts.dedicatedPilotFunctional !== 'boolean') {
        return unsupported('Movement runtime heat or piloting skill is invalid');
    }
    let canonicalState: MekMovementPsrStateV2;
    try { canonicalState = canonicalizeMekMovementPsrStateV2(state); }
    catch { return unsupported('Movement/PSR state is not canonical'); }

    const numbers = movementNumbers(profile, facts);
    const destroyed = facts.destruction.committed.destroyed;
    const shutdown = facts.conditions.has('shutdown');
    const disconnected = facts.conditions.has('disconnected');
    const controlled = facts.functionalCrew || numbers.controlledByDrone;
    const damageAvailableMovement = [
        profile.movement.baseWalkMp > 0 ? numbers.damageWalkMp : null,
        profile.movement.baseJumpMp > 0 && !facts.conditions.has('prone') ? numbers.jumpMp : null,
        profile.movement.baseUmuMp > 0 && !facts.conditions.has('prone') ? numbers.umuMp : null,
    ].filter((value): value is number => value !== null);
    const damageImmobile = damageAvailableMovement.length > 0
        && damageAvailableMovement.every(value => value <= 0);
    const immobile = destroyed || shutdown || disconnected || !controlled
        || (facts.rulesFlavor === 'total-warfare' ? numbers.allLimbsDestroyed : damageImmobile);
    const warnings = commonWarnings(numbers, facts);
    const sprintReasons = sprintBlockReasons(profile, facts, numbers);
    const sprintSelected = canonicalState.movement?.mode === 'sprint' && sprintReasons.length === 0;
    const permanentPsrModifiers = sprintSelected
        ? Object.freeze([
            ...numbers.permanentPsrModifiers,
            psrModifier(2, 'Sprinting'),
        ].sort(comparePsrModifiers))
        : numbers.permanentPsrModifiers;
    const permanentPsrModifier = numbers.permanentPsrModifier + (sprintSelected ? 2 : 0);
    const pilotingTargetNumber = facts.pilotingSkill + permanentPsrModifier;
    const movementRequiresPilotCheck = (mode: 'run' | 'sprint' | 'jump'): boolean => {
        const selected = canonicalState.movement?.mode === mode;
        const declaration = Object.freeze({
            schemaVersion: MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION,
            mode,
            distance: selected ? canonicalState.movement!.distance : 0,
            boosterComponentIds: selected
                ? canonicalState.movement!.boosterComponentIds
                : Object.freeze([] as ComponentId[]),
        });
        return movementCheckSeeds(profile, facts, pilotingTargetNumber, declaration).length > 0;
    };
    const standing = standUpProjection(
        profile,
        facts,
        canonicalState,
        numbers,
        immobile,
    );
    const spent = standing.movementPointsSpent;
    const actions: MekLegalActionProjectionV2[] = [
        movementAction('stationary', 0, 0, destroyed, shutdown, controlled, false, false,
            canonicalState.carefulStand, warnings),
        movementAction('walk', 0, numbers.walkMp, destroyed, shutdown, controlled, immobile,
            facts.conditions.has('prone'), canonicalState.carefulStand, warnings),
        movementAction('run', 0, Math.max(
            numbers.maximumRunMp,
            numbers.activeRunMp,
            numbers.runningMinimumMp,
        ),
            destroyed, shutdown, controlled, immobile,
            facts.conditions.has('prone'), canonicalState.carefulStand, [
                ...warnings,
                ...(Math.max(numbers.maximumRunMp, numbers.activeRunMp) > numbers.runMp ? [warning(
                    'BOOSTER_FAILURE_CHECK',
                    'Maximum run MP uses MASC-family equipment and requires its own failure checks',
                )] : []),
                ...(numbers.hardened ? [warning(
                    'HARDENED_RUN_PENALTY',
                    'Hardened armor reduces run MP by one',
                )] : []),
            ], Math.max(numbers.runMp, numbers.runningMinimumMp), movementRequiresPilotCheck('run')),
        movementAction('sprint', 0, sprintReasons.length === 0
            ? Math.max(numbers.maximumSprintMp, numbers.activeSprintMp)
            : 0,
            destroyed, shutdown, controlled, immobile,
            facts.conditions.has('prone'), canonicalState.carefulStand, [
                ...warnings,
                ...(numbers.maximumSprintMp > numbers.sprintMp ? [warning(
                    'BOOSTER_FAILURE_CHECK',
                    'Maximum Sprint MP uses MASC-family equipment and requires its own failure checks',
                )] : []),
            ], numbers.sprintMp, movementRequiresPilotCheck('sprint'), sprintReasons),
        movementAction('jump', 0, numbers.jumpMp, destroyed, shutdown, controlled, immobile,
            facts.conditions.has('prone'), canonicalState.carefulStand, warnings,
            numbers.jumpMp, movementRequiresPilotCheck('jump')),
        movementAction('UMU', 0, numbers.umuMp, destroyed, shutdown, controlled, immobile,
            facts.conditions.has('prone'), canonicalState.carefulStand, warnings),
        getUpAction(standing, warnings),
        shutdownAction(destroyed, shutdown, controlled),
        startupAction(destroyed, shutdown, controlled),
    ];
    const declaration = canonicalState.movement === null
        ? null
        : declarationLegality(profile, facts, numbers, actions, canonicalState.movement, spent);
    return Object.freeze({
        kind: 'supported',
        rulesFlavor: facts.rulesFlavor,
        controlledByDrone: numbers.controlledByDrone,
        immobile,
        walkMp: numbers.walkMp,
        potentialWalkMp: numbers.potentialWalkMp,
        runMp: numbers.runMp,
        maximumRunMp: numbers.maximumRunMp,
        sprintMp: numbers.sprintMp,
        maximumSprintMp: numbers.maximumSprintMp,
        jumpMp: numbers.jumpMp,
        umuMp: numbers.umuMp,
        movementImpaired: numbers.movementImpaired,
        permanentPsrModifier,
        permanentPsrModifiers,
        pilotingTargetNumber,
        standing,
        actions: Object.freeze(actions),
        declaration,
    });
}

/**
 * Projects the MegaMek BV-calculation movement view. Current heat, shutdown,
 * prone state, and crew availability are transient and therefore excluded;
 * committed equipment/location damage remains authoritative.
 */
export function projectMekBattleValueMovementV2(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
): MekBattleValueMovementProjectionV2 {
    if (profile.rulesFlavor !== facts.rulesFlavor) {
        return unsupported('Mek movement ruleset does not match the entity ruleset');
    }
    if (!canonicalNonnegativeNumber(facts.currentHeat, 1_000_000)
        || !canonicalNonnegativeInteger(facts.pilotingSkill, MAX_MEK_PILOT_TARGET_V2)
        || typeof facts.sprintingAllowed !== 'boolean'
        || typeof facts.airborne !== 'boolean'
        || typeof facts.functionalCrew !== 'boolean'
        || typeof facts.dedicatedPilotFunctional !== 'boolean') {
        return unsupported('Movement runtime facts are invalid');
    }
    const numbers = movementNumbers(
        profile,
        Object.freeze({ ...facts, currentHeat: 0 }),
        { battleValue: true },
    );
    return Object.freeze({
        kind: 'supported',
        walkMp: numbers.potentialWalkMp,
        runMp: numbers.maximumRunMp,
        jumpMp: numbers.jumpMp,
        umuMp: numbers.umuMp,
    });
}

export function declareMekMovementV2(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
    state: MekMovementPsrStateV2,
    declaration: MekMovementDeclarationV2,
    producingRevision: number,
): MekMovementStateTransitionV2 {
    let canonicalState: MekMovementPsrStateV2;
    let canonicalDeclaration: MekMovementDeclarationV2;
    try {
        canonicalState = canonicalizeMekMovementPsrStateV2(state);
        canonicalDeclaration = canonicalizeMekMovementDeclarationV2(declaration);
        requireRevision(producingRevision);
    } catch (error) {
        return rejectedTransition('INVALID_DECLARATION', String(error));
    }
    const candidate = freezeState({ ...canonicalState, movement: canonicalDeclaration });
    const projected = projectMekMovementPsrV2(profile, facts, candidate);
    if (projected.kind === 'unsupported') {
        return Object.freeze({ accepted: false, reason: 'UNSUPPORTED', blockers: projected.blockers });
    }
    if (!projected.declaration?.legal) {
        return Object.freeze({
            accepted: false,
            reason: 'ILLEGAL_DECLARATION',
            blockers: Object.freeze(projected.declaration?.reasons.map(item => item.code)
                ?? ['Declaration legality was not projected']),
        });
    }
    const retained = canonicalState.checks.filter(check =>
        check.source.sourceKind !== 'movement' || check.status !== 'pending');
    const seeds = movementCheckSeeds(
        profile,
        facts,
        projected.pilotingTargetNumber,
        canonicalDeclaration,
    );
    return Object.freeze({
        accepted: true,
        state: freezeState({
            ...canonicalState,
            movement: canonicalDeclaration,
            checks: appendSeeds(retained, seeds, producingRevision),
        }),
    });
}

export function clearMekMovementV2(state: MekMovementPsrStateV2): MekMovementPsrStateV2 {
    const canonical = canonicalizeMekMovementPsrStateV2(state);
    return canonical.movement === null && !canonical.checks.some(check =>
        check.source.sourceKind === 'movement' && check.status === 'pending')
        ? canonical
        : freezeState({
            ...canonical,
            movement: null,
            checks: canonical.checks.filter(check =>
                check.source.sourceKind !== 'movement' || check.status !== 'pending'),
        });
}

export function declareMekActionV2(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
    state: MekMovementPsrStateV2,
    action: MekActionDeclarationV2,
    producingRevision: number,
): MekMovementStateTransitionV2 {
    let canonicalState: MekMovementPsrStateV2;
    let canonicalAction: MekActionDeclarationV2;
    try {
        canonicalState = canonicalizeMekMovementPsrStateV2(state);
        canonicalAction = canonicalizeMekActionDeclarationV2(action);
        requireRevision(producingRevision);
    } catch (error) {
        return rejectedTransition('INVALID_DECLARATION', String(error));
    }
    const projected = projectMekMovementPsrV2(profile, facts, canonicalState);
    if (projected.kind === 'unsupported') {
        return Object.freeze({ accepted: false, reason: 'UNSUPPORTED', blockers: projected.blockers });
    }
    const actionProjection = projected.actions.find(entry => entry.kind === canonicalAction.kind);
    if (!actionProjection?.legal) {
        return Object.freeze({
            accepted: false,
            reason: 'ILLEGAL_DECLARATION',
            blockers: Object.freeze(actionProjection?.reasons.map(item => item.code)
                ?? ['Action legality was not projected']),
        });
    }
    const retained = canonicalState.checks.filter(check =>
        check.source.sourceKind !== 'action' || check.status !== 'pending');
    const seeds = canonicalAction.kind === 'startup'
        ? []
        : [actionCheckSeed(projected.pilotingTargetNumber, canonicalAction)];
    return Object.freeze({
        accepted: true,
        state: freezeState({
            ...canonicalState,
            action: canonicalAction,
            checks: appendSeeds(retained, seeds, producingRevision),
        }),
    });
}

export function clearMekActionV2(state: MekMovementPsrStateV2): MekMovementPsrStateV2 {
    const canonical = canonicalizeMekMovementPsrStateV2(state);
    return canonical.action === null && !canonical.checks.some(check =>
        check.source.sourceKind === 'action' && check.status === 'pending')
        ? canonical
        : freezeState({
            ...canonical,
            action: null,
            checks: canonical.checks.filter(check =>
                check.source.sourceKind !== 'action' || check.status !== 'pending'),
        });
}

export function prepareMekStandUpV2(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
    state: MekMovementPsrStateV2,
): MekMovementStateTransitionV2 {
    let canonical: MekMovementPsrStateV2;
    try { canonical = canonicalizeMekMovementPsrStateV2(state); }
    catch (error) { return rejectedTransition('INVALID_DECLARATION', String(error)); }
    const projected = projectMekMovementPsrV2(profile, facts, canonical);
    if (projected.kind === 'unsupported') {
        return Object.freeze({ accepted: false, reason: 'UNSUPPORTED', blockers: projected.blockers });
    }
    const action = projected.actions.find(entry => entry.kind === 'get-up');
    const mode = projected.standing.movementMode;
    if (!action?.legal || mode === null) {
        return Object.freeze({
            accepted: false,
            reason: 'ILLEGAL_DECLARATION',
            blockers: Object.freeze(action?.reasons.map(item => item.code) ?? ['Stand-up is not legal']),
        });
    }
    const sameMode = canonical.movement?.mode === mode;
    const maximum = sameMode ? projected.declaration?.maximumMp ?? 0 : 0;
    const movement = Object.freeze({
        schemaVersion: MEK_MOVEMENT_DECLARATION_SCHEMA_VERSION,
        mode,
        distance: sameMode ? Math.min(canonical.movement!.distance, maximum) : 0,
        boosterComponentIds: sameMode
            ? canonical.movement!.boosterComponentIds
            : Object.freeze([] as ComponentId[]),
    });
    return Object.freeze({
        accepted: true,
        state: freezeState({
            ...canonical,
            movement,
            checks: sameMode
                ? canonical.checks
                : canonical.checks.filter(check =>
                    check.source.sourceKind !== 'movement' || check.status !== 'pending'),
        }),
    });
}

export function resolveMekStandAttemptV2(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
    state: MekMovementPsrStateV2,
    carefulStand: boolean,
    evidence: MekPilotCheckDiceEvidenceV2 | undefined,
    producingRevision: number,
): MekStandAttemptResolutionV2 {
    if (typeof carefulStand !== 'boolean') {
        return rejectedStand('INVALID_DECLARATION', ['Careful-stand intent must be boolean']);
    }
    try { requireRevision(producingRevision); }
    catch (error) { return rejectedStand('INVALID_DECLARATION', [String(error)]); }
    const prepared = prepareMekStandUpV2(profile, facts, state);
    if (!prepared.accepted) return prepared;
    const projected = projectMekMovementPsrV2(profile, facts, prepared.state);
    if (projected.kind === 'unsupported') {
        return rejectedStand('UNSUPPORTED', projected.blockers);
    }
    if (carefulStand && !projected.standing.canCarefulStand) {
        return rejectedStand('ILLEGAL_DECLARATION', ['Careful stand requires Total Warfare and three remaining Walking MP']);
    }

    let outcome: MekPilotCheckOutcomeV2 = 'success';
    let resolvedState = prepared.state;
    if (projected.standing.requiresPilotCheck) {
        if (evidence === undefined) {
            return rejectedStand('INVALID_DICE_EVIDENCE', ['A standing PSR requires two dice']);
        }
        const retained = prepared.state.checks.filter(check =>
            check.source.triggerKind !== 'get-up' || check.status !== 'pending');
        const checks = appendSeeds(retained, [standAttemptCheckSeed(
            projected.pilotingTargetNumber,
            projected.standing.standingModifier + (carefulStand ? -2 : 0),
            carefulStand,
        )], producingRevision);
        const pending = checks[checks.length - 1]!;
        const resolution = resolveMekPilotCheckV2(
            profile,
            freezeState({ ...prepared.state, checks }),
            pending.checkId,
            evidence,
        );
        if (!resolution.accepted) {
            return rejectedStand(
                resolution.reason === 'INVALID_CHECK' ? 'INVALID_DECLARATION' : resolution.reason,
                [resolution.reason],
            );
        }
        outcome = resolution.outcome;
        resolvedState = resolution.state;
    } else if (evidence !== undefined) {
        return rejectedStand('INVALID_DICE_EVIDENCE', ['An intact quad stands without a PSR']);
    }

    const attempts = resolvedState.standAttempts + 1;
    if (attempts > MAX_MEK_MOVEMENT_MP_V2) {
        return rejectedStand('INVALID_DECLARATION', ['Stand-attempt count is outside the bounded range']);
    }
    const next = withStandAttemptsAndClampedMovement(
        profile,
        facts,
        resolvedState,
        attempts,
        carefulStand,
    );
    return Object.freeze({
        accepted: true,
        outcome,
        failed: outcome === 'failed',
        state: next,
    });
}

export function adjustMekStandAttemptsV2(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
    state: MekMovementPsrStateV2,
    delta: number,
): MekMovementPsrStateV2 {
    const canonical = canonicalizeMekMovementPsrStateV2(state);
    if (!Number.isSafeInteger(delta)) throw new Error('Stand-attempt adjustment must be an integer');
    const attempts = Math.max(0, Math.min(MAX_MEK_MOVEMENT_MP_V2, canonical.standAttempts + delta));
    const carefulStand = delta < 0 ? false : canonical.carefulStand;
    return withStandAttemptsAndClampedMovement(profile, facts, canonical, attempts, carefulStand);
}

/**
 * Add checks only from committed mutations. Callers must not pass preview
 * deltas. The exact before/after witness is persisted and distinct events with
 * the same display reason receive different ordinals and IDs.
 */
export function synthesizeCommittedMekDamagePilotChecksV2(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
    state: MekMovementPsrStateV2,
    mutations: readonly MekCommittedDamageMutationV2[],
    producingRevision: number,
): MekCommittedDamagePilotCheckSynthesisResultV2 {
    const canonical = canonicalizeMekMovementPsrStateV2(state);
    requireRevision(producingRevision);
    if (!Array.isArray(mutations) || mutations.length > MAX_MEK_PILOT_CHECKS_V2) {
        throw new Error('Invalid committed Mek damage mutation set');
    }
    const validated = mutations.map(canonicalDamageMutation);
    assertDistinctMutationTargets(validated);
    for (const mutation of validated) assertMutationMatchesCommittedFacts(mutation, facts);
    const projected = projectMekMovementPsrV2(profile, facts, canonical);
    if (projected.kind === 'unsupported') {
        throw new Error(`Cannot synthesize Mek damage pilot checks: ${projected.blockers.join(', ')}`);
    }
    const receivedDamage = validated.reduce((sum, mutation) => sum + mutation.receivedDamage, 0);
    const nextDamage = canonical.damageThisPhase + receivedDamage;
    if (!canonicalNonnegativeInteger(nextDamage, 1_000_000)) {
        throw new Error('Mek phase damage exceeds its bounded range');
    }
    const seeds: MekPilotCheckSeedV2[] = [];
    for (const mutation of validated) {
        seeds.push(...damageMutationSeeds(profile, facts, projected, mutation));
    }
    seeds.push(...gyroDamageMutationSeeds(profile, facts, projected, validated));
    if (canonical.damageThisPhase < 20 && nextDamage >= 20) {
        seeds.push(seed({
            sourceKind: 'damage',
            triggerKind: 'damage-total-20',
            witness: canonicalWitness({
                triggerKind: 'damage-total-20',
                before: canonical.damageThisPhase,
                after: nextDamage,
                mutations: validated,
            }),
            criticalSlotIds: [],
            locationIds: [],
            baseTarget: projected.pilotingTargetNumber,
            triggerModifier: 1,
        }, `Received ${nextDamage} damage`));
    }
    const nextState = reconcileMekPilotChecksV2(profile, facts, freezeState({
        ...canonical,
        damageThisPhase: nextDamage,
        checks: appendSeeds(canonical.checks, seeds, producingRevision),
        automaticFalls: canonicalAutomaticFalls([
            ...canonical.automaticFalls,
            ...synthesizeAutomaticFalls(profile, facts, validated),
        ]),
    }));
    return Object.freeze({ state: nextState });
}

/** Remove only unsettled triggers that committed state/action no longer supports. */
export function reconcileMekPilotChecksV2(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
    state: MekMovementPsrStateV2,
): MekMovementPsrStateV2 {
    const canonical = canonicalizeMekMovementPsrStateV2(state);
    const checks = canonical.checks.filter(check => check.status !== 'pending'
        || pilotCheckTriggerStillActive(profile, facts, canonical, check));
    const automaticFalls = canonical.automaticFalls.filter(fall =>
        automaticFallTriggerStillActive(profile, facts, fall));
    return checks.length === canonical.checks.length
        && automaticFalls.length === canonical.automaticFalls.length
        ? canonical
        : freezeState({ ...canonical, checks, automaticFalls });
}

/**
 * Core combines every hip/leg-actuator check for the same leg into one roll.
 * The durable ledger stays event-exact; this is the rules-owned read model.
 */
export function projectMekPilotChecksV2(
    profile: MekMechanicsProfile,
    state: MekMovementPsrStateV2,
): readonly MekPilotCheckV2[] {
    const canonical = canonicalizeMekMovementPsrStateV2(state);
    const groups = coreLegPilotCheckGroups(profile, canonical.checks);
    if (groups.length === 0) return canonical.checks;

    const groupByFirstIndex = new Map(groups.map(group => [group.firstIndex, group]));
    const groupedIndexes = new Set(groups.flatMap(group => group.indexes));
    const projected: MekPilotCheckV2[] = [];
    for (const [index, check] of canonical.checks.entries()) {
        const group = groupByFirstIndex.get(index);
        if (group) {
            projected.push(Object.freeze({ ...group.representative, reason: group.reason }));
        } else if (!groupedIndexes.has(index)) {
            projected.push(check);
        }
    }
    return Object.freeze(projected);
}

/** The caller supplies dice only; target and outcome remain owner authority. */
export function resolveMekPilotCheckV2(
    profile: MekMechanicsProfile,
    state: MekMovementPsrStateV2,
    checkId: string,
    evidence: MekPilotCheckDiceEvidenceV2,
): MekPilotCheckResolutionResultV2 {
    const canonical = canonicalizeMekMovementPsrStateV2(state);
    if (!boundedText(checkId, 256)) return Object.freeze({ accepted: false, reason: 'INVALID_CHECK' });
    if (!plainRecord(evidence)
        || !exactKeys(evidence, ['dice', 'claimedOutcome'])
        || !Array.isArray(evidence.dice)
        || evidence.dice.length !== 2
        || !evidence.dice.every(die => Number.isSafeInteger(die) && die >= 1 && die <= 6)
        || (evidence.claimedOutcome !== undefined
            && evidence.claimedOutcome !== 'success'
            && evidence.claimedOutcome !== 'failed')) {
        return Object.freeze({ accepted: false, reason: 'INVALID_DICE_EVIDENCE' });
    }
    const index = canonical.checks.findIndex(check => check.checkId === checkId);
    const group = coreLegPilotCheckGroups(profile, canonical.checks)
        .find(candidate => candidate.indexes.includes(index));
    const indexes = group?.indexes ?? (index < 0 ? [] : [index]);
    const check = group?.representative ?? canonical.checks[index];
    if (!check || check.status !== 'pending') {
        return Object.freeze({ accepted: false, reason: 'INVALID_CHECK' });
    }
    const dice = Object.freeze([evidence.dice[0]!, evidence.dice[1]!] as const);
    const total = dice[0] + dice[1];
    const outcome: MekPilotCheckOutcomeV2 = total >= check.targetNumber ? 'success' : 'failed';
    if (evidence.claimedOutcome !== undefined && evidence.claimedOutcome !== outcome) {
        return Object.freeze({ accepted: false, reason: 'OUTCOME_MISMATCH' });
    }
    const checks = [...canonical.checks];
    const resolution = Object.freeze({ dice, total });
    for (const memberIndex of indexes) {
        checks[memberIndex] = Object.freeze({
            ...checks[memberIndex]!,
            status: outcome,
            resolution,
        });
    }
    return Object.freeze({
        accepted: true,
        outcome,
        failed: outcome === 'failed',
        state: freezeState({ ...canonical, checks }),
    });
}

/** Explicit boundary policy for checks the player chose not to resolve. */
export function dismissPendingMekPilotChecksV2(
    state: MekMovementPsrStateV2,
    checkIds?: readonly string[],
): MekMovementPsrStateV2 {
    const canonical = canonicalizeMekMovementPsrStateV2(state);
    const selected = checkIds === undefined ? null : new Set(checkIds);
    if (selected !== null && selected.size !== checkIds!.length) {
        throw new Error('Pilot-check dismissal IDs must be unique');
    }
    const checks = canonical.checks.filter(check =>
        check.status !== 'pending' || (selected !== null && !selected.has(check.checkId)));
    if (selected !== null && checks.length + selected.size !== canonical.checks.length) {
        throw new Error('Pilot-check dismissal contains an unknown or settled check');
    }
    return checks.length === canonical.checks.length
        ? canonical
        : freezeState({ ...canonical, checks });
}

/** Consumes automatic-fall notices after falling automation has handled or skipped them. */
export function dismissMekAutomaticFallsV2(
    state: MekMovementPsrStateV2,
): MekMovementPsrStateV2 {
    const canonical = canonicalizeMekMovementPsrStateV2(state);
    return canonical.automaticFalls.length === 0
        ? canonical
        : freezeState({ ...canonical, automaticFalls: [] });
}

export function resetMekMovementPsrPhaseV2(state: MekMovementPsrStateV2): MekMovementPsrStateV2 {
    const canonical = canonicalizeMekMovementPsrStateV2(state);
    assertNoPendingPilotChecks(canonical, 'phase');
    return canonical.damageThisPhase === 0
        && canonical.checks.length === 0
        && canonical.automaticFalls.length === 0
        ? canonical
        : freezeState({ ...canonical, damageThisPhase: 0, checks: [], automaticFalls: [] });
}

export function resetMekMovementPsrTurnV2(state: MekMovementPsrStateV2): MekMovementPsrStateV2 {
    const canonical = canonicalizeMekMovementPsrStateV2(state);
    assertNoPendingPilotChecks(canonical, 'turn');
    return createPristineMekMovementPsrStateV2();
}

export function serializeMekMovementPsrStateV2(
    value: MekMovementPsrStateV2,
): SerializedMekMovementPsrStateV2 {
    const state = canonicalizeMekMovementPsrStateV2(value);
    return Object.freeze({
        schemaVersion: MEK_MOVEMENT_PSR_STATE_SCHEMA_VERSION,
        ...(state.movement === null ? {} : { movement: state.movement }),
        ...(state.action === null ? {} : { action: state.action }),
        ...(state.standAttempts === 0 ? {} : { standAttempts: state.standAttempts }),
        ...(state.carefulStand ? { carefulStand: true as const } : {}),
        ...(state.damageThisPhase === 0 ? {} : { damageThisPhase: state.damageThisPhase }),
        ...(state.checks.length === 0 ? {} : {
            checks: Object.freeze(state.checks.map(check => Object.freeze({
                checkId: check.checkId,
                source: check.source,
                producingRevision: check.producingRevision,
                ordinal: check.ordinal,
                targetNumber: check.targetNumber,
                reason: check.reason,
                status: check.status,
                ...(check.resolution === undefined ? {} : { resolution: check.resolution }),
            }))),
        }),
        ...(state.automaticFalls.length === 0 ? {} : {
            automaticFalls: state.automaticFalls,
        }),
    });
}

/** Strict current-wire decoder; unknown fields and explicit sparse defaults reject. */
export function deserializeMekMovementPsrStateV2(value: unknown): MekMovementPsrStateV2 {
    if (!plainRecord(value)
        || !exactKeys(value, [
            'schemaVersion', 'movement', 'action', 'standAttempts', 'carefulStand',
            'damageThisPhase', 'checks', 'automaticFalls',
        ])
        || value['schemaVersion'] !== MEK_MOVEMENT_PSR_STATE_SCHEMA_VERSION) {
        throw new Error('Invalid serialized Mek movement/PSR state');
    }
    const standAttempts = value['standAttempts'] === undefined ? 0 : value['standAttempts'];
    const carefulStand = value['carefulStand'] === undefined ? false : value['carefulStand'];
    if (!canonicalNonnegativeInteger(standAttempts, MAX_MEK_MOVEMENT_MP_V2)
        || value['standAttempts'] === 0
        || (carefulStand !== false && carefulStand !== true)
        || value['carefulStand'] === false
        || (carefulStand && standAttempts === 0)) {
        throw new Error('Serialized Mek standing state is not sparse canonical state');
    }
    const damageThisPhase = value['damageThisPhase'] === undefined ? 0 : value['damageThisPhase'];
    if (!canonicalNonnegativeInteger(damageThisPhase, 1_000_000)
        || value['damageThisPhase'] === 0) {
        throw new Error('Serialized Mek phase damage is not sparse canonical state');
    }
    const rawChecks = value['checks'] === undefined ? [] : value['checks'];
    if (!Array.isArray(rawChecks) || rawChecks.length === 0 && value['checks'] !== undefined) {
        throw new Error('Serialized Mek pilot checks are not sparse canonical state');
    }
    const checks = rawChecks.map(deserializeCheck);
    const rawAutomaticFalls = value['automaticFalls'] === undefined ? [] : value['automaticFalls'];
    if (!Array.isArray(rawAutomaticFalls)
        || rawAutomaticFalls.length === 0 && value['automaticFalls'] !== undefined) {
        throw new Error('Serialized Mek automatic falls are not sparse canonical state');
    }
    return canonicalizeMekMovementPsrStateV2({
        movement: value['movement'] === undefined
            ? null
            : deserializeMovementDeclaration(value['movement']),
        action: value['action'] === undefined ? null : deserializeActionDeclaration(value['action']),
        standAttempts,
        carefulStand,
        damageThisPhase,
        checks,
        automaticFalls: rawAutomaticFalls.map(canonicalizeMekAutomaticFallV2),
    });
}

export function mekMovementPsrStatesEqualV2(
    left: MekMovementPsrStateV2,
    right: MekMovementPsrStateV2,
): boolean {
    return JSON.stringify(serializeMekMovementPsrStateV2(left))
        === JSON.stringify(serializeMekMovementPsrStateV2(right));
}

/**
 * Rebind every topology identity carried by durable movement/PSR state. The
 * kernel owns witness grammar and check-ID derivation, so persistence codecs
 * never need to parse or duplicate either contract. No partial state escapes:
 * every required identity resolves exactly and without aliasing, or the owner
 * receives deterministic unresolved evidence for durable recovery.
 */
export function remapMekMovementPsrStateIdsV2(
    value: MekMovementPsrStateV2,
    resolvers: MekMovementPsrIdRemapResolversV2,
): MekMovementPsrStateRemapResultV2 {
    let state: MekMovementPsrStateV2;
    try {
        state = canonicalizeMekMovementPsrStateV2(value);
    } catch {
        return remapRejected([remapUnresolved('INVALID_STATE', 'state', [], [], ['$'])]);
    }

    const references = collectRemapReferences(state);
    const resolution = resolveRemapReferences(references, resolvers);
    if (resolution.unresolved.length > 0) return remapRejected(resolution.unresolved);

    try {
        const movement = state.movement === null
            ? null
            : remapMovementDeclaration(state.movement, resolution.ids);
        const checks = state.checks.map(check => remapPilotCheck(check, resolution.ids));
        const automaticFalls = state.automaticFalls.map(fall => canonicalizeMekAutomaticFallV2({
            ...fall,
            locationIds: fall.locationIds
                .map(id => requiredRemappedId(resolution.ids.locations, id))
                .sort(compareText),
        }));
        return Object.freeze({
            accepted: true as const,
            state: canonicalizeMekMovementPsrStateV2({
                movement,
                action: state.action,
                standAttempts: state.standAttempts,
                carefulStand: state.carefulStand,
                damageThisPhase: state.damageThisPhase,
                checks,
                automaticFalls,
            }),
        });
    } catch {
        return remapRejected([remapUnresolved(
            'REMAPPED_STATE_INVALID',
            'state',
            [],
            [],
            ['$'],
        )]);
    }
}

export function canonicalizeMekAutomaticFallV2(value: unknown): MekAutomaticFallV2 {
    if (!plainRecord(value)
        || !exactKeys(value, ['triggerKind', 'locationIds'])
        || !isMekAutomaticFallTriggerKind(value['triggerKind'])
        || !Array.isArray(value['locationIds'])) {
        throw new Error('Invalid Mek automatic fall');
    }
    const triggerKind = value['triggerKind'];
    const rawLocationIds = value['locationIds'];
    const locationIds = canonicalIds(
        rawLocationIds,
        'automatic fall location',
    ).map(asLocationId);
    if (rawLocationIds.length !== locationIds.length
        || rawLocationIds.some((id, index) => id !== locationIds[index])
        || triggerKind === 'gyro-destroyed' && locationIds.length !== 0
        || triggerKind === 'leg-destroyed-auto-fall' && locationIds.length !== 1) {
        throw new Error('Mek automatic fall locations are not canonical');
    }
    return Object.freeze({
        triggerKind,
        locationIds: Object.freeze(locationIds),
    });
}

function canonicalAutomaticFalls(
    values: readonly MekAutomaticFallV2[],
): readonly MekAutomaticFallV2[] {
    const byKey = new Map<string, MekAutomaticFallV2>();
    for (const value of values) {
        const fall = canonicalizeMekAutomaticFallV2(value);
        byKey.set(JSON.stringify(fall), fall);
    }
    return Object.freeze([...byKey]
        .sort(([left], [right]) => compareText(left, right))
        .map(([, fall]) => fall));
}

function movementNumbers(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
    options: Readonly<{ battleValue?: boolean }> = {},
): MovementNumbersV2 {
    const legs = legDamage(profile, facts);
    const destroyedLegs = legs.filter(leg => leg.destroyed).length;
    const destroyedHips = legs.filter(leg => !leg.destroyed)
        .reduce((sum, leg) => sum + leg.hipHits, 0);
    const destroyedLegActuators = legs.filter(leg => !leg.destroyed)
        .reduce((sum, leg) => sum + leg.legActuatorHits, 0);
    const destroyedFeet = legs.filter(leg => !leg.destroyed)
        .reduce((sum, leg) => sum + leg.footHits, 0);
    const quadruped = profile.form === 'quad' || profile.form === 'quadvee';
    const shields = projectMekShieldsV2(profile, facts);
    // BV uses the design's maximum movement profile. Shield stance and mounted
    // Modular Armor are operational mobility choices, not structural damage.
    const activeMediumShields = options.battleValue ? 0 : shields.filter(shield =>
        shield.size === 'medium' && shield.retainsMobilityPenalty).length;
    const activeLargeShields = options.battleValue ? 0 : shields.filter(shield =>
        shield.size === 'large' && shield.retainsMobilityPenalty).length;
    const modularArmorActive = !options.battleValue && profile.modularArmor.some(group =>
        groupAvailable(group, facts) && facts.modularArmorRemaining(group.componentId) > 0);
    let walk = Math.max(
        0,
        profile.movement.baseWalkMp
            - activeMediumShields
            - activeLargeShields
            - (modularArmorActive ? 1 : 0),
    );
    const preDamageWalk = walk;
    let runDisabled = false;
    let runCap: number | null = null;
    let applyActuatorDamage = true;
    let impaired = false;
    if (facts.rulesFlavor === 'core-2026') {
        if (!quadruped) {
            if (destroyedLegs === 1) {
                walk = Math.min(walk, 1);
                runCap = Math.min(profile.movement.baseRunMp, 2);
                applyActuatorDamage = false;
                impaired = true;
            } else if (destroyedLegs >= 2) {
                walk = 0;
                runDisabled = true;
                impaired = true;
            } else {
                walk -= destroyedHips;
            }
        } else {
            walk -= destroyedHips;
            impaired ||= destroyedHips > 0;
            if (destroyedLegs <= 2) walk -= destroyedLegs;
            else if (destroyedLegs === 3) {
                walk = Math.min(walk, 1);
                runCap = Math.min(profile.movement.baseRunMp, 2);
                applyActuatorDamage = false;
                impaired = true;
            } else {
                walk = 0;
                runDisabled = true;
                impaired = true;
            }
        }
    } else {
        if (!quadruped) {
            if (destroyedHips >= 2) {
                walk = 0;
                runDisabled = true;
            } else {
                for (let index = 0; index < destroyedHips; index += 1) {
                    walk = Math.ceil(walk * 0.5);
                }
            }
            if (destroyedLegs === 1) {
                walk = Math.min(walk, 1);
                runDisabled = true;
            } else if (destroyedLegs >= 2) {
                walk = 0;
                runDisabled = true;
            }
        } else {
            if (destroyedLegs === 1) walk -= 1;
            else if (destroyedLegs === 2) {
                walk = Math.min(walk, 1);
                runDisabled = true;
            } else if (destroyedLegs >= 3) {
                walk = 0;
                runDisabled = true;
            }
            if (destroyedHips >= 4) {
                walk = 0;
                runDisabled = true;
            } else {
                for (let index = 0; index < destroyedHips && walk > 0; index += 1) {
                    walk = Math.ceil(walk * 0.5);
                }
            }
        }
        impaired ||= destroyedHips > 0 || destroyedLegs > 0;
    }
    if (applyActuatorDamage) walk -= destroyedLegActuators + destroyedFeet;
    impaired ||= destroyedLegActuators > 0 || destroyedFeet > 0 || destroyedLegs > 0;
    const legDamageMinimumWalk = facts.rulesFlavor === 'core-2026'
        && preDamageWalk > 0
        && destroyedLegs < (quadruped ? 4 : 2)
        ? 1
        : 0;
    walk = Math.max(legDamageMinimumWalk, Math.min(profile.movement.baseWalkMp, walk));
    const damageWalk = walk;

    const heatModifier = mekHeatEffects(facts.currentHeat).moveModifier;
    walk = Math.max(0, walk + heatModifier);
    const standardTsm = profile.tripleStrengthMyomer.filter(group => group.kind === 'standard');
    const functionalTsm = standardTsm.some(group => groupAvailable(group, facts));
    const tsmActive = functionalTsm && facts.currentHeat >= 9 && destroyedLegs === 0;
    const tsmPotential = functionalTsm && !tsmActive && destroyedLegs === 0;
    if (tsmActive) walk += 2;
    const potentialWalk = tsmPotential ? walk + Math.max(0, 1 - heatModifier) : walk;

    const hardened = profile.armorVariants.some(variant => variant.hardened);
    const ordinaryRun = walk <= 0 || runDisabled
        ? 0
        : Math.max(0, Math.round(walk * 1.5) - (hardened ? 1 : 0));
    const workingMasc = profile.masc.some(group => groupAvailable(group, facts));
    const workingSupercharger = profile.superchargers.some(group => groupAvailable(group, facts));
    const coefficient = movementBoosterCoefficient(1.5, workingMasc, workingSupercharger);
    const activeMasc = profile.masc.some(group => boosterActive(facts, group.componentId));
    const activeSupercharger = profile.superchargers.some(group =>
        boosterActive(facts, group.componentId));
    const activeCoefficient = movementBoosterCoefficient(1.5, activeMasc, activeSupercharger);
    const maximumRunWalk = tsmPotential ? potentialWalk : walk;
    let maximumRun = maximumRunWalk <= 0 || runDisabled
        ? 0
        : Math.max(0, Math.round(maximumRunWalk * coefficient) - (hardened ? 1 : 0));
    let activeRun = walk <= 0 || runDisabled
        ? 0
        : Math.max(0, Math.round(walk * activeCoefficient) - (hardened ? 1 : 0));
    let cappedRun = ordinaryRun;
    if (runCap !== null) {
        cappedRun = Math.min(cappedRun, runCap);
        maximumRun = Math.min(maximumRun, runCap);
        activeRun = Math.min(activeRun, runCap);
    }
    const runningMinimum = facts.rulesFlavor === 'total-warfare'
        && walk >= 1
        && destroyedLegs === (quadruped ? 2 : 1)
        ? 1
        : 0;
    const sprint = ordinaryRun <= 0 ? 0 : Math.max(0, Math.round(walk * 2));
    const maximumSprint = sprint <= 0
        ? 0
        : Math.max(0, Math.round(walk * movementBoosterCoefficient(
            2,
            workingMasc,
            workingSupercharger,
        )));
    const activeSprint = sprint <= 0
        ? 0
        : Math.max(0, Math.round(walk * movementBoosterCoefficient(
            2,
            activeMasc,
            activeSupercharger,
        )));

    const lostJets = profile.jumpJets.filter(group => !groupAvailable(group, facts)).length;
    const wingSlotLoss = profile.partialWings.reduce((sum, group) => sum
        + group.criticalSlotIds.filter(slotId => facts.criticalSlotUnavailable(slotId)).length, 0);
    const lostWingBonus = Math.min(3, wingSlotLoss);
    const jump = activeLargeShields > 0 ? 0 : Math.max(
        0,
        profile.movement.baseJumpMp
            - lostJets
            - lostWingBonus
            - activeMediumShields
            - (modularArmorActive ? 1 : 0),
    );
    const lostUmus = profile.umus.filter(group => !groupAvailable(group, facts)).length;
    const umu = activeLargeShields > 0
        ? 0
        : Math.max(0, profile.movement.baseUmuMp - lostUmus);
    impaired ||= heatModifier < 0 || lostJets > 0 || wingSlotLoss > 0 || lostUmus > 0;

    const drone = profile.droneOperatingSystems.some(group => groupAvailable(group, facts));
    const psr = permanentPsr(profile, facts, legs, drone, hardened, modularArmorActive);
    return Object.freeze({
        controlledByDrone: !facts.functionalCrew && drone,
        allLimbsDestroyed: profile.limbs.length > 0
            && profile.limbs.every(limb => facts.locationDestroyed(limb.locationId)),
        movementImpaired: impaired,
        walkMp: walk,
        damageWalkMp: damageWalk,
        potentialWalkMp: potentialWalk,
        runMp: cappedRun,
        maximumRunMp: maximumRun,
        activeRunMp: activeRun,
        runningMinimumMp: runningMinimum,
        sprintMp: sprint,
        maximumSprintMp: maximumSprint,
        activeSprintMp: activeSprint,
        jumpMp: jump,
        umuMp: umu,
        hardened,
        tsmActive,
        tsmPotential,
        partialWingDamaged: wingSlotLoss > 0,
        permanentPsrModifier: psr.modifier,
        permanentPsrModifiers: psr.modifiers,
    });
}

function movementBoosterCoefficient(
    base: number,
    masc: boolean,
    supercharger: boolean,
): number {
    return base + (masc ? 0.5 : 0) + (supercharger ? 0.5 : 0);
}

function permanentPsr(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
    legs: readonly LegDamageSummaryV2[],
    drone: boolean,
    hardened: boolean,
    modularArmorActive: boolean,
): MekPsrModifierProjection {
    const modifiers: MekPsrModifier[] = [];
    const quadruped = profile.form === 'quad' || profile.form === 'quadvee';
    const destroyed = legs.filter(leg => leg.destroyed);
    if (destroyed.length === 0) {
        if (quadruped) modifiers.push(psrModifier(-2, 'No Destroyed Legs'));
        else if (profile.form === 'tripod') modifiers.push(psrModifier(-1, 'No Destroyed Legs'));
    } else if (quadruped) {
        const value = profile.rulesFlavor === 'total-warfare'
            ? (destroyed.length === 2 ? 5 : 0)
            : destroyed.length <= 2
                ? destroyed.length
                : destroyed.length === 3 ? 4 : 0;
        if (value !== 0) modifiers.push(psrModifier(value, 'Leg Destroyed', {
            ...(destroyed.length === 1 ? { locationId: destroyed[0]!.locationId } : {}),
            ...(destroyed.length > 1 ? { modifierReason: `Legs Destroyed (${destroyed.length})` } : {}),
        }));
    } else {
        const value = profile.rulesFlavor === 'total-warfare' ? 5 : 4;
        for (const leg of destroyed) {
            modifiers.push(psrModifier(value, 'Leg Destroyed', { locationId: leg.locationId }));
        }
    }
    if (profile.form === 'tripod') {
        modifiers.push(psrModifier(
            facts.dedicatedPilotFunctional ? -1 : 2,
            facts.dedicatedPilotFunctional ? 'Dedicated Pilot' : 'Dedicated Pilot disabled',
        ));
    }
    for (const leg of legs) {
        if (leg.destroyed) continue;
        if (leg.hipHits > 0) modifiers.push(psrModifier(
            leg.hipHits * (profile.rulesFlavor === 'total-warfare' ? 2 : 1),
            'Hip Destroyed',
            { locationId: leg.locationId },
        ));
        const actuatorHits = leg.legActuatorHits
            + (profile.rulesFlavor === 'total-warfare' ? leg.footHits : 0);
        if (actuatorHits > 0) modifiers.push(psrModifier(
            actuatorHits,
            'Leg Actuator(s) Destroyed',
            {
                locationId: leg.locationId,
                modifierReason: actuatorHits === 1
                    ? 'Leg Actuator Destroyed'
                    : `Leg Actuators Destroyed (${actuatorHits})`,
            },
        ));
    }
    const gyroHits = profile.gyro.criticalSlotIds.filter(slotId =>
        facts.criticalSlotUnavailable(slotId)).length;
    const gyroModifier = gyroPsrModifier(profile, gyroHits);
    if (gyroModifier !== 0) modifiers.push(psrModifier(
        gyroModifier,
        profile.gyro.heavyDuty ? 'Heavy-Duty Gyro damaged' : 'Gyro damaged',
    ));

    const legIds = new Set(legs.map(leg => leg.locationId));
    const legAes = profile.actuatorEnhancementSystems.filter(group =>
        group.locationIds.some(locationId => legIds.has(locationId)));
    if (legAes.length > 0 && legAes.every(group => groupAvailable(group, facts))) {
        modifiers.push(psrModifier(-2, 'Mounts AES in its legs'));
    }
    if (hardened) modifiers.push(psrModifier(1, 'Mounts Hardened Armor'));
    if (modularArmorActive) {
        modifiers.push(psrModifier(1, 'Mounts Modular Armor'));
    }
    const cockpit = profile.cockpit.type.toLowerCase();
    if (!drone && (profile.cockpit.torsoMounted || cockpit.includes('small'))) {
        modifiers.push(psrModifier(1, 'Mounts small or torso cockpit'));
    }
    const sorted = Object.freeze([...modifiers].sort(comparePsrModifiers));
    return Object.freeze({
        modifier: sorted.reduce((sum, entry) => sum + entry.modifier, 0),
        modifiers: sorted,
    });
}

function psrModifier(
    modifier: number,
    reason: string,
    details: Pick<MekPsrModifier, 'modifierReason' | 'locationId'> = {},
): MekPsrModifier {
    return Object.freeze({ modifier, reason, ...details });
}

function comparePsrModifiers(left: MekPsrModifier, right: MekPsrModifier): number {
    const leftNegative = left.modifier < 0;
    const rightNegative = right.modifier < 0;
    if (leftNegative !== rightNegative) return leftNegative ? -1 : 1;
    const leftLabel = left.modifierReason ?? left.reason;
    const rightLabel = right.modifierReason ?? right.reason;
    return leftLabel < rightLabel ? -1 : leftLabel > rightLabel ? 1 : 0;
}

function gyroPsrModifier(profile: MekMechanicsProfile, hitCount: number): number {
    if (hitCount === 0) return 0;
    if (!profile.gyro.heavyDuty) return profile.rulesFlavor === 'total-warfare' ? 3 : 2;
    if (profile.rulesFlavor === 'core-2026') return hitCount;
    return hitCount === 1 ? 1 : 3;
}

function gyroLocationIds(profile: MekMechanicsProfile): LocationId[] {
    return canonicalIds(
        profile.gyro.groups.flatMap(group => group.locationIds),
        'gyro location',
    ) as LocationId[];
}

function legDamage(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
): readonly LegDamageSummaryV2[] {
    return Object.freeze(profile.limbs.filter(limb => limb.kind === 'leg').map(limb => {
        const damagedActuators = limb.actuators.flatMap(actuator => {
            const unavailableSlots = actuator.criticalSlotIds.filter(slotId =>
                facts.criticalSlotUnavailable(slotId));
            if (unavailableSlots.length === 0) return [];
            const destroyedTurn = unavailableSlots.reduce((latest, slotId) => Math.max(
                latest,
                facts.criticalSlotDestroyedTurn(slotId) ?? 0,
            ), 0);
            return [{ kind: actuator.kind, destroyedTurn }];
        });
        const hipHits = damagedActuators.filter(actuator => actuator.kind === 'hip');
        const latestHipTurn = hipHits.reduce<number | undefined>(
            (latest, hip) => Math.max(latest ?? 0, hip.destroyedTurn),
            undefined,
        );
        const effectiveActuators = profile.rulesFlavor === 'total-warfare'
            ? damagedActuators.filter(actuator => actuator.kind === 'hip'
                || latestHipTurn === undefined
                || actuator.destroyedTurn >= latestHipTurn)
            : damagedActuators;
        const legActuatorHits = effectiveActuators.filter(actuator =>
            actuator.kind === 'upper-leg' || actuator.kind === 'lower-leg').length;
        const footHits = effectiveActuators.filter(actuator => actuator.kind === 'foot').length;
        return Object.freeze({
            locationId: limb.locationId,
            destroyed: facts.locationDestroyed(limb.locationId),
            hipHits: hipHits.length,
            legActuatorHits,
            footHits,
        });
    }));
}

function commonWarnings(
    numbers: MovementNumbersV2,
    facts: MekMovementPsrRuntimeFactsV2,
): readonly MekMovementMessageV2<MekMovementWarningCodeV2>[] {
    const result: MekMovementMessageV2<MekMovementWarningCodeV2>[] = [];
    if (numbers.movementImpaired) result.push(warning('MOVEMENT_IMPAIRED', 'Damage or heat reduces movement'));
    if (numbers.tsmActive) result.push(warning('TSM_ACTIVE', 'Standard TSM movement bonus is active at heat 9+'));
    else if (numbers.tsmPotential) result.push(warning('TSM_POTENTIAL', 'Standard TSM can increase movement at heat 9+'));
    if (numbers.partialWingDamaged) result.push(warning('PARTIAL_WING_DAMAGED', 'Partial-wing damage reduces jump MP'));
    if (facts.destruction.preview.crippled
        || facts.destruction.preview.unavailableCriticalSlotIds.some(slotId =>
            !facts.destruction.committed.unavailableCriticalSlotIds.includes(slotId))) {
        result.push(warning(
            'PENDING_DAMAGE_PREVIEW',
            'Pending damage changes the preview mechanics state but does not yet alter committed movement',
        ));
    }
    if (numbers.controlledByDrone) result.push(warning('DRONE_CONTROLLED', 'The Mek is moving under its drone operating system'));
    if (facts.destruction.committed.unavailableCriticalSlotIds.length > 0) {
        result.push(warning('PILOT_CHECK_REQUIRED', 'Committed system damage can require a piloting check'));
    }
    return Object.freeze(result);
}

function standUpProjection(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
    state: MekMovementPsrStateV2,
    numbers: MovementNumbersV2,
    immobile: boolean,
): MekStandUpProjectionV2 {
    const legs = legDamage(profile, facts);
    const destroyedLegs = legs.filter(leg => leg.destroyed).length;
    const intactLegs = legs.length - destroyedLegs;
    const destroyedArms = profile.limbs.filter(limb =>
        limb.kind === 'arm' && facts.locationDestroyed(limb.locationId)).length;
    const quadruped = profile.form === 'quad' || profile.form === 'quadvee';
    const totalWarfare = facts.rulesFlavor === 'total-warfare';
    const destroyedLegThreshold = quadruped ? (totalWarfare ? 2 : 3) : 1;
    const destroyedLegException = destroyedLegs === destroyedLegThreshold;
    const gyroHits = profile.gyro.criticalSlotIds.filter(slotId =>
        facts.criticalSlotUnavailable(slotId)).length;
    const gyroDestroyed = profile.gyro.destructionHitThreshold > 0
        && gyroHits >= profile.gyro.destructionHitThreshold;
    const prone = facts.conditions.has('prone');
    const canStand = !state.carefulStand
        && prone
        && !immobile
        && !gyroDestroyed
        && numbers.walkMp >= 1
        && intactLegs > 0
        && destroyedLegs <= destroyedLegThreshold
        && (quadruped || destroyedLegs !== 1 || destroyedArms !== 2);
    const canStandWithoutPsr = quadruped && destroyedLegs === 0;
    const movementMode = !canStand
        ? null
        : destroyedLegException || numbers.walkMp === 1 || state.movement?.mode === 'run'
            ? 'run'
            : 'walk';
    const currentCapacity = movementCapacityForDeclaration(profile, facts, numbers, state.movement);
    const movementPointsSpent = state.carefulStand
        ? currentCapacity
        : state.standAttempts * 2;
    const supportsCarefulStand = totalWarfare;
    return Object.freeze({
        attempts: state.standAttempts,
        carefulStand: state.carefulStand,
        movementPointsSpent,
        movementMode,
        requiresPilotCheck: !canStandWithoutPsr,
        targetNumber: facts.pilotingSkill + numbers.permanentPsrModifier + (totalWarfare ? 0 : -1),
        standingModifier: totalWarfare ? 0 : -1,
        supportsCarefulStand,
        canCarefulStand: supportsCarefulStand
            && canStand
            && numbers.walkMp - state.standAttempts * 2 >= 3,
        attemptLimit: totalWarfare && destroyedLegException ? 1 : null,
    });
}

function movementCapacityForDeclaration(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
    numbers: MovementNumbersV2,
    declaration: MekMovementDeclarationV2 | null,
): number {
    if (!declaration) return 0;
    if (declaration.mode === 'stationary') return 0;
    if (declaration.mode === 'walk') return numbers.walkMp;
    if (declaration.mode === 'jump') return numbers.jumpMp;
    if (declaration.mode === 'UMU') return numbers.umuMp;
    return declaration.mode === 'sprint'
        ? selectedSprintCapacity(profile, facts, numbers, declaration.boosterComponentIds)
        : selectedRunCapacity(profile, facts, numbers, declaration.boosterComponentIds);
}

function sprintBlockReasons(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
    numbers: MovementNumbersV2,
): readonly MekMovementMessageV2<MekMovementBlockReasonCodeV2>[] {
    const reasons: MekMovementMessageV2<MekMovementBlockReasonCodeV2>[] = [];
    if (!facts.sprintingAllowed) reasons.push(blocker(
        'OPTION_DISABLED',
        'Sprinting is disabled by the force scenario',
    ));
    if (facts.airborne) reasons.push(blocker('AIRBORNE', 'An airborne Mek cannot Sprint'));
    if (facts.conditions.has('prone')) reasons.push(blocker('PRONE', 'A prone Mek cannot Sprint'));
    if (numbers.runMp <= 0) reasons.push(blocker(
        'RUN_UNAVAILABLE',
        'Sprint requires ordinary Run movement',
    ));
    const workingHips = profile.limbs.filter(limb => limb.kind === 'leg'
        && !facts.locationDestroyed(limb.locationId)
        && limb.actuators.some(actuator => actuator.kind === 'hip'
            && groupAvailable(actuator, facts))).length;
    if (workingHips < 2) reasons.push(blocker(
        'INSUFFICIENT_HIPS',
        'Sprint requires at least two working hip actuators',
    ));
    return Object.freeze(reasons);
}

function movementAction(
    kind: MekMovementModeV2,
    minimumMp: number,
    maximumMp: number,
    destroyed: boolean,
    shutdown: boolean,
    controlled: boolean,
    immobile: boolean,
    prone: boolean,
    carefulStand: boolean,
    warnings: readonly MekMovementMessageV2<MekMovementWarningCodeV2>[],
    ordinaryMaximumMp = maximumMp,
    requiresPilotCheck = false,
    additionalReasons: readonly MekMovementMessageV2<MekMovementBlockReasonCodeV2>[] = [],
): MekLegalActionProjectionV2 {
    const reasons: MekMovementMessageV2<MekMovementBlockReasonCodeV2>[] = [...additionalReasons];
    if (destroyed) reasons.push(blocker('DESTROYED', 'Destroyed Meks cannot declare movement'));
    if (shutdown) reasons.push(blocker('SHUTDOWN', 'Shutdown Meks cannot declare movement'));
    if (!controlled) reasons.push(blocker('NO_FUNCTIONAL_CONTROL', 'No functional crew or drone operating system is available'));
    if (carefulStand) reasons.push(blocker('CAREFUL_STAND', 'A careful stand consumes all remaining movement'));
    if (kind === 'jump' && prone) reasons.push(blocker('PRONE', 'A prone Mek cannot jump'));
    if (kind !== 'stationary' && immobile) reasons.push(blocker('IMMOBILE', 'The Mek is immobile'));
    if (kind !== 'stationary' && maximumMp <= 0) {
        reasons.push(blocker('NO_MOVEMENT_POINTS', `${kind} has no available MP`));
    }
    return Object.freeze({
        kind,
        legal: reasons.length === 0,
        minimumMp,
        maximumMp,
        ordinaryMaximumMp,
        requiresPilotCheck,
        reasons: Object.freeze(reasons),
        warnings: Object.freeze([...warnings]),
    });
}

function getUpAction(
    standing: MekStandUpProjectionV2,
    warnings: readonly MekMovementMessageV2<MekMovementWarningCodeV2>[],
): MekLegalActionProjectionV2 {
    const reasons = standing.movementMode === null
        ? [blocker('IMMOBILE', 'The Mek cannot stand in its current state')]
        : [];
    return Object.freeze({
        kind: 'get-up',
        legal: reasons.length === 0,
        reasons: Object.freeze(reasons),
        warnings: Object.freeze([
            ...warnings,
            ...(standing.requiresPilotCheck
                ? [warning('PILOT_CHECK_REQUIRED', 'Getting up requires a piloting check')]
                : []),
        ]),
    });
}

function shutdownAction(
    destroyed: boolean,
    shutdown: boolean,
    controlled: boolean,
): MekLegalActionProjectionV2 {
    const reasons: MekMovementMessageV2<MekMovementBlockReasonCodeV2>[] = [];
    if (destroyed) reasons.push(blocker('DESTROYED', 'Destroyed Meks cannot declare a shutdown action'));
    if (shutdown) reasons.push(blocker('ALREADY_SHUTDOWN', 'The Mek is already shutdown'));
    if (!controlled) reasons.push(blocker(
        'NO_FUNCTIONAL_CONTROL',
        'No functional crew or drone operating system is available',
    ));
    return Object.freeze({
        kind: 'shutdown',
        legal: reasons.length === 0,
        reasons: Object.freeze(reasons),
        warnings: Object.freeze([]),
    });
}

function startupAction(
    destroyed: boolean,
    shutdown: boolean,
    controlled: boolean,
): MekLegalActionProjectionV2 {
    const reasons: MekMovementMessageV2<MekMovementBlockReasonCodeV2>[] = [];
    if (destroyed) reasons.push(blocker('DESTROYED', 'Destroyed Meks cannot start up'));
    if (!shutdown) reasons.push(blocker('NOT_SHUTDOWN', 'Only a shutdown Mek can start up'));
    if (!controlled) reasons.push(blocker(
        'NO_FUNCTIONAL_CONTROL',
        'No functional crew or drone operating system is available',
    ));
    return Object.freeze({
        kind: 'startup',
        legal: reasons.length === 0,
        reasons: Object.freeze(reasons),
        warnings: Object.freeze([]),
    });
}

function declarationLegality(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
    numbers: MovementNumbersV2,
    actions: readonly MekLegalActionProjectionV2[],
    declaration: MekMovementDeclarationV2,
    movementPointsSpent: number,
): MekDeclarationLegalityV2 {
    const action = actions.find(entry => entry.kind === declaration.mode)!;
    const reasons = [...action.reasons];
    let maximumMp = Math.max(0, (action.maximumMp ?? 0) - movementPointsSpent);
    if (declaration.mode === 'run' || declaration.mode === 'sprint') {
        const activeBoosters = new Set<ComponentId>([
            ...profile.masc.filter(group => boosterActive(facts, group.componentId))
                .map(group => group.componentId),
            ...profile.superchargers.filter(group => boosterActive(facts, group.componentId))
                .map(group => group.componentId),
        ]);
        if (declaration.boosterComponentIds.some(componentId => !activeBoosters.has(componentId))) {
            reasons.push(blocker('NO_MOVEMENT_POINTS', 'The declaration selects inactive or non-MASC boosters'));
            maximumMp = 0;
        } else {
            const selectedCapacity = declaration.mode === 'sprint'
                ? selectedSprintCapacity(
                    profile,
                    facts,
                    numbers,
                    declaration.boosterComponentIds,
                )
                : selectedRunCapacity(
                    profile,
                    facts,
                    numbers,
                    declaration.boosterComponentIds,
                );
            maximumMp = Math.max(
                0,
                selectedCapacity - movementPointsSpent,
            );
        }
    }
    if (declaration.distance > maximumMp) {
        reasons.push(blocker('NO_MOVEMENT_POINTS', `Declared distance exceeds ${declaration.mode} MP`));
    }
    return Object.freeze({
        legal: action.legal && reasons.length === 0,
        maximumMp,
        reasons: Object.freeze(reasons),
        warnings: action.warnings,
    });
}

function selectedRunCapacity(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
    numbers: MovementNumbersV2,
    componentIds: readonly ComponentId[],
): number {
    const selected = new Set(componentIds);
    const usesMasc = profile.masc.some(group =>
        selected.has(group.componentId) && boosterActive(facts, group.componentId));
    const usesSupercharger = profile.superchargers.some(group =>
        selected.has(group.componentId) && boosterActive(facts, group.componentId));
    const coefficient = movementBoosterCoefficient(1.5, usesMasc, usesSupercharger);
    const calculated = numbers.walkMp <= 0
        ? 0
        : Math.max(0, Math.round(numbers.walkMp * coefficient) - (numbers.hardened ? 1 : 0));
    return Math.max(
        numbers.runningMinimumMp,
        Math.min(calculated, Math.max(numbers.maximumRunMp, numbers.activeRunMp)),
    );
}

function selectedSprintCapacity(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
    numbers: MovementNumbersV2,
    componentIds: readonly ComponentId[],
): number {
    if (sprintBlockReasons(profile, facts, numbers).length > 0) return 0;
    const selected = new Set(componentIds);
    const usesMasc = profile.masc.some(group =>
        selected.has(group.componentId) && boosterActive(facts, group.componentId));
    const usesSupercharger = profile.superchargers.some(group =>
        selected.has(group.componentId) && boosterActive(facts, group.componentId));
    const calculated = Math.max(0, Math.round(numbers.walkMp
        * movementBoosterCoefficient(2, usesMasc, usesSupercharger)));
    return Math.min(calculated, Math.max(numbers.maximumSprintMp, numbers.activeSprintMp));
}

function boosterActive(facts: MekMovementPsrRuntimeFactsV2, componentId: ComponentId): boolean {
    return facts.componentBoosterActive(componentId) && !facts.componentDisabled(componentId);
}

function movementCheckSeeds(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
    pilotingTargetNumber: number,
    declaration: MekMovementDeclarationV2,
): readonly MekPilotCheckSeedV2[] {
    if (declaration.mode !== 'run'
        && declaration.mode !== 'sprint'
        && declaration.mode !== 'jump') return Object.freeze([]);
    const seeds = declaration.mode === 'sprint'
        ? sprintBoosterCheckSeeds(profile, facts, pilotingTargetNumber, declaration)
        : [];
    if ((declaration.mode === 'run' || declaration.mode === 'sprint')
        && declaration.distance < 1
        && profile.rulesFlavor === 'core-2026') {
        return Object.freeze([...seeds]);
    }
    const damagedGyro = canonicalIds(profile.gyro.criticalSlotIds.filter(slotId =>
        facts.criticalSlotUnavailable(slotId)), 'damaged gyro critical slot') as CriticalSlotId[];
    const coreHeavyDuty = profile.rulesFlavor === 'core-2026' && profile.gyro.heavyDuty;
    if (damagedGyro.length > 0 && !(coreHeavyDuty && declaration.mode !== 'jump')) {
        const permanentGyroModifier = gyroPsrModifier(profile, damagedGyro.length);
        return Object.freeze([...seeds, seed({
            sourceKind: 'movement',
            triggerKind: 'move-damaged-gyro',
            witness: canonicalWitness({ declaration, damagedGyro, heavyDuty: profile.gyro.heavyDuty }),
            criticalSlotIds: damagedGyro,
            locationIds: gyroLocationIds(profile),
            baseTarget: coreHeavyDuty
                ? pilotingTargetNumber - permanentGyroModifier
                : pilotingTargetNumber,
            triggerModifier: coreHeavyDuty ? 2 : 0,
        }, coreHeavyDuty
            ? 'Jumping with damaged HD gyro'
            : `${movementModeVerb(declaration.mode)} with damaged gyro`)]);
    }
    const legs = legDamage(profile, facts);
    const quadruped = profile.form === 'quad' || profile.form === 'quadvee';
    const destroyed = legs.filter(leg => leg.destroyed);
    const representativeDestroyedLeg = destroyed[0];
    const coreQuadHipEquivalent = profile.rulesFlavor === 'core-2026'
        && quadruped
        && destroyed.length === 2;
    if (representativeDestroyedLeg && coreQuadHipEquivalent) {
        return Object.freeze([...seeds, seed({
            sourceKind: 'movement',
            triggerKind: 'move-damaged-leg',
            witness: canonicalWitness({
                declaration,
                locationId: representativeDestroyedLeg.locationId,
                quadruped,
            }),
            criticalSlotIds: [],
            locationIds: [representativeDestroyedLeg.locationId],
            baseTarget: pilotingTargetNumber,
            triggerModifier: 0,
        }, `${movementModeVerb(declaration.mode)} with damaged hip`)]);
    }
    const destroyedLegRequiresCheck = declaration.mode === 'jump'
        ? profile.rulesFlavor === 'total-warfare'
            ? destroyed.length > 0
            : destroyed.length >= (quadruped ? 2 : 1)
        : profile.rulesFlavor === 'core-2026'
            && destroyed.length >= (quadruped ? 2 : 1);
    if (representativeDestroyedLeg && destroyedLegRequiresCheck) {
        const triggerModifier = profile.rulesFlavor === 'total-warfare'
            && declaration.mode === 'jump'
            && quadruped
            && destroyed.length === 1
            ? 5
            : 0;
        return Object.freeze([...seeds, seed({
            sourceKind: 'movement',
            triggerKind: 'move-damaged-leg',
            witness: canonicalWitness({
                declaration,
                locationId: representativeDestroyedLeg.locationId,
                quadruped,
            }),
            criticalSlotIds: [],
            locationIds: [representativeDestroyedLeg.locationId],
            baseTarget: pilotingTargetNumber,
            triggerModifier,
        }, `${movementModeVerb(declaration.mode)} with damaged leg`)]);
    }

    const relevantKinds: readonly MekActuatorKind[] = declaration.mode === 'jump'
        ? ['hip', 'upper-leg', 'lower-leg', 'foot']
        : ['hip'];
    for (const leg of legs.filter(candidate => !candidate.destroyed)) {
        const slots = canonicalIds(
            profile.limbs.find(limb => limb.locationId === leg.locationId)?.actuators
                .filter(actuator => relevantKinds.includes(actuator.kind))
                .flatMap(actuator => actuator.criticalSlotIds)
                .filter(slotId => facts.criticalSlotUnavailable(slotId)) ?? [],
            'damaged actuator critical slot',
        ) as CriticalSlotId[];
        if (slots.length === 0) continue;
        return Object.freeze([...seeds, seed({
            sourceKind: 'movement',
            triggerKind: 'move-damaged-actuator',
            witness: canonicalWitness({ declaration, locationId: leg.locationId, slotIds: slots }),
            criticalSlotIds: slots,
            locationIds: [leg.locationId],
            baseTarget: pilotingTargetNumber,
            triggerModifier: 0,
        }, declaration.mode === 'jump'
            ? 'Jumping with damaged leg actuator'
            : `${movementModeVerb(declaration.mode)} with damaged hip`)]);
    }
    return Object.freeze([...seeds]);
}

function sprintBoosterCheckSeeds(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
    pilotingTargetNumber: number,
    declaration: MekMovementDeclarationV2,
): readonly MekPilotCheckSeedV2[] {
    const selected = new Set(declaration.boosterComponentIds);
    const usesMasc = profile.masc.some(group => selected.has(group.componentId)
        && boosterActive(facts, group.componentId));
    const usesSupercharger = profile.superchargers.some(group => selected.has(group.componentId)
        && boosterActive(facts, group.componentId));
    const enhancers: readonly {
        readonly boosterKind: 'MASC' | 'supercharger';
        readonly label: string;
    }[] = usesMasc && usesSupercharger
        ? [
            { boosterKind: 'MASC', label: 'MASC' },
            { boosterKind: 'supercharger', label: 'supercharger' },
        ]
        : usesMasc
            ? [{ boosterKind: 'MASC', label: 'MASC or supercharger' }]
            : usesSupercharger
                ? [{ boosterKind: 'supercharger', label: 'MASC or supercharger' }]
                : [];
    return Object.freeze(enhancers.map(enhancer => seed({
        sourceKind: 'movement',
        triggerKind: 'sprint-booster',
        witness: canonicalWitness({ declaration, boosterKind: enhancer.boosterKind }),
        criticalSlotIds: [],
        locationIds: [],
        baseTarget: pilotingTargetNumber,
        triggerModifier: 0,
    }, `Sprinting with ${enhancer.label}`)));
}

function movementModeVerb(mode: 'run' | 'sprint' | 'jump'): 'Running' | 'Sprinting' | 'Jumping' {
    if (mode === 'jump') return 'Jumping';
    return mode === 'sprint' ? 'Sprinting' : 'Running';
}

function actionCheckSeed(baseTarget: number, action: MekActionDeclarationV2): MekPilotCheckSeedV2 {
    if (action.kind !== 'shutdown') throw new Error('Startup does not require a pilot check');
    return seed({
        sourceKind: 'action',
        triggerKind: 'shutdown',
        witness: canonicalWitness({ action }),
        criticalSlotIds: [],
        locationIds: [],
        baseTarget,
        triggerModifier: 3,
    }, 'Shutdown');
}

function standAttemptCheckSeed(
    baseTarget: number,
    triggerModifier: number,
    carefulStand: boolean,
): MekPilotCheckSeedV2 {
    return seed({
        sourceKind: 'action',
        triggerKind: 'get-up',
        witness: canonicalWitness({ carefulStand, prone: true }),
        criticalSlotIds: [],
        locationIds: [],
        baseTarget,
        triggerModifier,
    }, 'Getting up');
}

function gyroDamageMutationSeeds(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
    projected: MekMovementPsrProjectionV2,
    mutations: readonly MekCommittedDamageMutationV2[],
): readonly MekPilotCheckSeedV2[] {
    const gyroSlotIds = new Set(profile.gyro.criticalSlotIds);
    const hits = sortedMutations(mutations.filter((mutation): mutation is Extract<
        MekCommittedDamageMutationV2,
        { readonly kind: 'critical' }
    > => mutation.kind === 'critical'
        && gyroSlotIds.has(mutation.slotId)
        && !mutation.beforeUnavailable
        && mutation.afterUnavailable));
    if (hits.length === 0) return Object.freeze([]);

    const afterHitCount = profile.gyro.criticalSlotIds.filter(slotId =>
        facts.criticalSlotUnavailable(slotId)).length;
    const destroyed = profile.gyro.destructionHitThreshold > 0
        && afterHitCount >= profile.gyro.destructionHitThreshold;
    if ((profile.rulesFlavor === 'core-2026' && profile.gyro.heavyDuty)
        || (profile.rulesFlavor === 'total-warfare' && destroyed)) {
        return Object.freeze([]);
    }

    const permanentModifier = gyroPsrModifier(profile, afterHitCount);
    const hitCountBeforeMutations = afterHitCount - hits.length;
    return Object.freeze(hits.map((hit, index) => {
        const firstTotalWarfareHeavyDutyHit = profile.rulesFlavor === 'total-warfare'
            && profile.gyro.heavyDuty
            && hitCountBeforeMutations + index + 1 === 1;
        const triggerModifier = firstTotalWarfareHeavyDutyHit
            ? 1
            : (profile.gyro.heavyDuty || profile.rulesFlavor === 'total-warfare') ? 3 : 2;
        return seed({
            sourceKind: 'damage',
            triggerKind: 'gyro-hit',
            witness: canonicalWitness(hit),
            criticalSlotIds: [hit.slotId],
            locationIds: gyroLocationIds(profile),
            baseTarget: projected.pilotingTargetNumber - permanentModifier,
            triggerModifier,
        }, 'Gyro hit');
    }));
}

function damageMutationSeeds(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
    projected: MekMovementPsrProjectionV2,
    mutation: MekCommittedDamageMutationV2,
): readonly MekPilotCheckSeedV2[] {
    if (mutation.kind === 'critical') {
        if (mutation.beforeUnavailable || !mutation.afterUnavailable) return Object.freeze([]);
        const actuator = profile.limbs.flatMap(limb => limb.actuators.map(group => ({ limb, group })))
            .find(entry => entry.group.criticalSlotIds.includes(mutation.slotId));
        if (actuator?.group.kind === 'hip') {
            return Object.freeze([seed({
                sourceKind: 'damage', triggerKind: 'hip-hit',
                witness: canonicalWitness(mutation), criticalSlotIds: [mutation.slotId],
                locationIds: [actuator.limb.locationId], baseTarget: projected.pilotingTargetNumber,
                triggerModifier: 0,
            }, 'Hip hit')]);
        }
        if (actuator?.group.kind === 'upper-leg'
            || actuator?.group.kind === 'lower-leg'
            || (actuator?.group.kind === 'foot' && profile.rulesFlavor === 'total-warfare')) {
            return Object.freeze([seed({
                sourceKind: 'damage', triggerKind: 'leg-actuator-hit',
                witness: canonicalWitness(mutation), criticalSlotIds: [mutation.slotId],
                locationIds: [actuator.limb.locationId], baseTarget: projected.pilotingTargetNumber,
                triggerModifier: 0,
            }, 'Leg Actuator hit')]);
        }
        if (profile.gyro.criticalSlotIds.includes(mutation.slotId)) return Object.freeze([]);
        return Object.freeze([]);
    }
    if (mutation.kind === 'internal'
        && !mutation.beforeDestroyed
        && mutation.afterDestroyed
        && profile.limbs.some(limb => limb.kind === 'leg' && limb.locationId === mutation.locationId)) {
        const quadruped = profile.form === 'quad' || profile.form === 'quadvee';
        const destroyedLegs = profile.limbs.filter(limb => limb.kind === 'leg'
            && facts.locationDestroyed(limb.locationId)).length;
        if (!quadruped || destroyedLegs >= 2) {
            return Object.freeze([seed({
                sourceKind: 'damage', triggerKind: 'leg-destroyed',
                witness: canonicalWitness(mutation), criticalSlotIds: [],
                locationIds: [mutation.locationId], baseTarget: projected.pilotingTargetNumber,
                triggerModifier: 0,
            }, 'Leg destroyed')]);
        }
    }
    return Object.freeze([]);
}

function synthesizeAutomaticLegFalls(
    profile: MekMechanicsProfile,
    mutations: readonly MekCommittedDamageMutationV2[],
): readonly MekAutomaticFallV2[] {
    if (profile.form === 'quad' || profile.form === 'quadvee') return Object.freeze([]);
    const legLocationIds = new Set(profile.limbs
        .filter(limb => limb.kind === 'leg')
        .map(limb => limb.locationId));
    return canonicalAutomaticFalls(sortedMutations(mutations.filter((mutation): mutation is Extract<
        MekCommittedDamageMutationV2,
        { readonly kind: 'internal' }
    > => mutation.kind === 'internal'
        && legLocationIds.has(mutation.locationId)
        && !mutation.beforeDestroyed
        && mutation.afterDestroyed)).map(mutation => Object.freeze({
            triggerKind: 'leg-destroyed-auto-fall' as const,
            locationIds: Object.freeze([mutation.locationId]),
        })));
}

function synthesizeAutomaticFalls(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
    mutations: readonly MekCommittedDamageMutationV2[],
): readonly MekAutomaticFallV2[] {
    const falls: MekAutomaticFallV2[] = [];
    const gyroSlotIds = canonicalIds(
        profile.gyro.criticalSlotIds,
        'gyro critical slot',
    ) as CriticalSlotId[];
    const gyroThreshold = profile.gyro.destructionHitThreshold;
    if (!canonicalNonnegativeInteger(gyroThreshold, gyroSlotIds.length)) {
        throw new Error('Invalid Mek gyro destruction threshold');
    }
    if (gyroThreshold === 0) return synthesizeAutomaticLegFalls(profile, mutations);
    const gyroSlotSet = new Set<CriticalSlotId>(gyroSlotIds);
    const gyroMutations = sortedMutations(mutations.filter((mutation): mutation is Extract<
        MekCommittedDamageMutationV2,
        { readonly kind: 'critical' }
    > => mutation.kind === 'critical'
        && gyroSlotSet.has(mutation.slotId)
        && !mutation.beforeUnavailable
        && mutation.afterUnavailable));
    const afterGyroSlotIds = gyroSlotIds.filter(slotId => facts.criticalSlotUnavailable(slotId));
    const beforeGyroSlotSet = new Set<CriticalSlotId>(afterGyroSlotIds);
    for (const mutation of gyroMutations) beforeGyroSlotSet.delete(mutation.slotId);
    const beforeGyroSlotIds = gyroSlotIds.filter(slotId => beforeGyroSlotSet.has(slotId));
    if (beforeGyroSlotIds.length < gyroThreshold
        && afterGyroSlotIds.length >= gyroThreshold) {
        falls.push(Object.freeze({
            triggerKind: 'gyro-destroyed',
            locationIds: Object.freeze([]),
        }));
    }

    falls.push(...synthesizeAutomaticLegFalls(profile, mutations));
    return canonicalAutomaticFalls(falls);
}

function automaticFallTriggerStillActive(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
    fall: MekAutomaticFallV2,
): boolean {
    if (fall.triggerKind === 'leg-destroyed-auto-fall') {
        return fall.locationIds.every(locationId => facts.locationDestroyed(locationId));
    }
    return profile.gyro.destructionHitThreshold > 0
        && profile.gyro.criticalSlotIds.filter(slotId => facts.criticalSlotUnavailable(slotId)).length
            >= profile.gyro.destructionHitThreshold;
}

function coreLegPilotCheckGroups(
    profile: MekMechanicsProfile,
    checks: readonly MekPilotCheckV2[],
): readonly CoreLegPilotCheckGroup[] {
    if (profile.rulesFlavor !== 'core-2026') return Object.freeze([]);

    const groups = new Map<string, {
        readonly entries: { readonly index: number; readonly check: MekPilotCheckV2 }[];
        readonly reasons: Set<string>;
    }>();
    for (const [index, check] of checks.entries()) {
        const candidate = coreLegPilotCheckCandidate(profile, check);
        if (!candidate) continue;
        const resolutionKey = check.status === 'pending'
            ? 'pending'
            : `${check.status}:${check.resolution!.dice.join(',')}:${check.resolution!.total}`;
        const key = `${candidate.locationId}\u0000${resolutionKey}`;
        const group = groups.get(key) ?? { entries: [], reasons: new Set<string>() };
        group.entries.push({ index, check });
        for (const reason of candidate.reasons) group.reasons.add(reason);
        groups.set(key, group);
    }

    return Object.freeze([...groups.values()].map(group => {
        const indexes = Object.freeze(group.entries.map(entry => entry.index));
        const representative = group.entries[group.entries.length - 1]!.check;
        const reason = ['Hip hit', 'Leg Actuator hit', 'Foot hit']
            .filter(item => group.reasons.has(item))
            .join(', ');
        return Object.freeze({
            firstIndex: indexes[0]!,
            indexes,
            representative,
            reason,
        });
    }));
}

function coreLegPilotCheckCandidate(
    profile: MekMechanicsProfile,
    check: MekPilotCheckV2,
): { readonly locationId: LocationId; readonly reasons: readonly string[] } | null {
    if (check.source.locationIds.length !== 1) return null;
    const trigger = check.source.triggerKind;
    if (trigger !== 'hip-hit'
        && trigger !== 'leg-actuator-hit'
        && trigger !== 'move-damaged-actuator') return null;

    const reasons = new Set<string>();
    if (trigger === 'hip-hit') reasons.add('Hip hit');
    if (trigger === 'leg-actuator-hit') reasons.add('Leg Actuator hit');
    if (trigger === 'move-damaged-actuator') {
        const slotIds = new Set(check.source.criticalSlotIds);
        const limb = profile.limbs.find(candidate =>
            candidate.locationId === check.source.locationIds[0]);
        for (const actuator of limb?.actuators ?? []) {
            if (!actuator.criticalSlotIds.some(slotId => slotIds.has(slotId))) continue;
            if (actuator.kind === 'hip') reasons.add('Hip hit');
            else if (actuator.kind === 'foot') reasons.add('Foot hit');
            else if (actuator.kind === 'upper-leg' || actuator.kind === 'lower-leg') {
                reasons.add('Leg Actuator hit');
            }
        }
    }
    return reasons.size === 0 ? null : Object.freeze({
        locationId: check.source.locationIds[0]!,
        reasons: Object.freeze([...reasons]),
    });
}

function pilotCheckTriggerStillActive(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
    state: MekMovementPsrStateV2,
    check: MekPilotCheckV2,
): boolean {
    const source = check.source;
    switch (source.triggerKind) {
        case 'damage-total-20':
            return state.damageThisPhase >= 20;
        case 'leg-actuator-hit':
        case 'hip-hit':
        case 'gyro-hit':
            return source.criticalSlotIds.every(slotId => facts.criticalSlotUnavailable(slotId));
        case 'leg-destroyed':
            return source.locationIds.every(locationId => facts.locationDestroyed(locationId));
        case 'move-damaged-gyro':
            return movementWitnessMatchesDeclaration(source, state.movement)
                && source.criticalSlotIds.every(slotId => facts.criticalSlotUnavailable(slotId));
        case 'move-damaged-leg':
            return movementWitnessMatchesDeclaration(source, state.movement)
                && source.locationIds.every(locationId => facts.locationDestroyed(locationId));
        case 'move-damaged-actuator':
            return movementWitnessMatchesDeclaration(source, state.movement)
                && source.criticalSlotIds.every(slotId => facts.criticalSlotUnavailable(slotId));
        case 'sprint-booster': {
            if (!movementWitnessMatchesDeclaration(source, state.movement)) return false;
            const witness = JSON.parse(source.witness) as Record<string, unknown>;
            const groups = witness['boosterKind'] === 'MASC'
                ? profile.masc
                : profile.superchargers;
            const selected = new Set(state.movement?.boosterComponentIds ?? []);
            return groups.some(group => selected.has(group.componentId)
                && boosterActive(facts, group.componentId));
        }
        case 'get-up':
            return false;
        case 'shutdown':
            return state.action?.kind === 'shutdown';
    }
}

function movementWitnessMatchesDeclaration(
    source: MekPilotCheckSourceV2,
    declaration: MekMovementDeclarationV2 | null,
): boolean {
    if (declaration === null) return false;
    const witness = JSON.parse(source.witness) as Record<string, unknown>;
    return jsonValuesEqual(witness['declaration'], declaration);
}

function assertNoPendingPilotChecks(state: MekMovementPsrStateV2, boundary: 'phase' | 'turn'): void {
    if (state.automaticFalls.length === 0
        && state.checks.some(check => check.status === 'pending')) {
        throw new Error(`Cannot reset Mek movement/PSR ${boundary} with pending pilot checks`);
    }
}

function appendSeeds(
    current: readonly MekPilotCheckV2[],
    seeds: readonly MekPilotCheckSeedV2[],
    producingRevision: number,
): readonly MekPilotCheckV2[] {
    if (current.length + seeds.length > MAX_MEK_PILOT_CHECKS_V2) {
        throw new Error('Mek pilot check ledger is full');
    }
    const result = [...current];
    const firstOrdinal = current.filter(check => check.producingRevision === producingRevision)
        .reduce((maximum, check) => Math.max(maximum, check.ordinal + 1), 0);
    if (seeds.length > 0 && firstOrdinal + seeds.length > MAX_MEK_PILOT_CHECKS_V2) {
        throw new Error('Mek pilot check revision ordinal range is full');
    }
    for (const [index, item] of seeds.entries()) {
        const ordinal = firstOrdinal + index;
        const targetNumber = item.source.baseTarget + item.source.triggerModifier;
        if (!canonicalInteger(targetNumber, -MAX_MEK_PILOT_TARGET_V2, MAX_MEK_PILOT_TARGET_V2)) {
            throw new Error('Mek pilot check target is outside the bounded range');
        }
        const checkId = createCheckId(producingRevision, ordinal);
        result.push(Object.freeze({
            checkId,
            source: item.source,
            producingRevision,
            ordinal,
            targetNumber,
            reason: item.reason,
            status: 'pending' as const,
        }));
    }
    return Object.freeze(result);
}

function seed(source: MekPilotCheckSourceV2, reason: string): MekPilotCheckSeedV2 {
    return Object.freeze({ source: canonicalizeSource(source), reason: canonicalText(reason, 512) });
}

function canonicalizeCheck(value: unknown): MekPilotCheckV2 {
    if (!plainRecord(value)
        || !exactKeys(value, [
            'checkId', 'source', 'producingRevision', 'ordinal', 'targetNumber', 'reason', 'status', 'resolution',
        ])
        || !boundedText(value['checkId'], 256)
        || !canonicalNonnegativeInteger(value['producingRevision'], Number.MAX_SAFE_INTEGER)
        || !canonicalNonnegativeInteger(value['ordinal'], MAX_MEK_PILOT_CHECKS_V2 - 1)
        || !canonicalInteger(value['targetNumber'], -MAX_MEK_PILOT_TARGET_V2, MAX_MEK_PILOT_TARGET_V2)
        || !boundedCanonicalText(value['reason'], 512)
        || !isMekPilotCheckStatus(value['status'])) {
        throw new Error('Invalid Mek pilot check');
    }
    const checkId = value['checkId'];
    const producingRevision = value['producingRevision'];
    const ordinal = value['ordinal'];
    const targetNumber = value['targetNumber'];
    const reason = value['reason'];
    const status = value['status'];
    const source = canonicalizeSource(value['source']);
    if (targetNumber !== source.baseTarget + source.triggerModifier
        || checkId !== createCheckId(producingRevision, ordinal)) {
        throw new Error('Mek pilot check identity or target drifted');
    }
    let resolution: MekPilotCheckResolutionEvidenceV2 | undefined;
    if (status === 'pending') {
        if (value['resolution'] !== undefined) throw new Error('Pending Mek pilot check has resolution evidence');
    } else {
        resolution = canonicalResolution(value['resolution']);
        const outcome = resolution.total >= targetNumber ? 'success' : 'failed';
        if (outcome !== status) throw new Error('Mek pilot check outcome contradicts its dice');
    }
    return Object.freeze({
        checkId,
        source,
        producingRevision,
        ordinal,
        targetNumber,
        reason,
        status,
        ...(resolution === undefined ? {} : { resolution }),
    });
}

function canonicalizeSource(value: unknown): MekPilotCheckSourceV2 {
    if (!plainRecord(value)
        || !exactKeys(value, [
            'sourceKind', 'triggerKind', 'witness', 'criticalSlotIds', 'locationIds',
            'baseTarget', 'triggerModifier',
        ])
        || !isMekPilotCheckSourceKind(value['sourceKind'])
        || !isMekPilotCheckTriggerKind(value['triggerKind'])
        || !boundedCanonicalText(value['witness'], MAX_MEK_PILOT_CHECK_WITNESS_LENGTH_V2)
        || !canonicalInteger(value['baseTarget'], -MAX_MEK_PILOT_TARGET_V2, MAX_MEK_PILOT_TARGET_V2)
        || !canonicalInteger(value['triggerModifier'], -MAX_MEK_PILOT_TARGET_V2, MAX_MEK_PILOT_TARGET_V2)) {
        throw new Error('Invalid Mek pilot check source');
    }
    const sourceKind = value['sourceKind'];
    const triggerKind = value['triggerKind'];
    const witness = value['witness'];
    const baseTarget = value['baseTarget'];
    const triggerModifier = value['triggerModifier'];
    let decodedWitness: unknown;
    try {
        decodedWitness = JSON.parse(witness);
    } catch {
        throw new Error('Mek pilot check witness is not valid JSON');
    }
    const result = Object.freeze({
        sourceKind,
        triggerKind,
        witness,
        criticalSlotIds: Object.freeze(canonicalIds(value['criticalSlotIds'], 'critical slot').map(asCriticalSlotId)),
        locationIds: Object.freeze(canonicalIds(value['locationIds'], 'location').map(asLocationId)),
        baseTarget,
        triggerModifier,
    });
    validateSourceSemantics(result, decodedWitness);
    return result;
}

function validateSourceSemantics(source: MekPilotCheckSourceV2, decodedWitness: unknown): void {
    const requireSource = (
        sourceKind: MekPilotCheckSourceKindV2,
        criticalSlots: number | 'one-or-more',
        locations: number,
        triggerModifier: number,
    ): void => {
        const criticalSlotsMatch = criticalSlots === 'one-or-more'
            ? source.criticalSlotIds.length > 0
            : source.criticalSlotIds.length === criticalSlots;
        if (source.sourceKind !== sourceKind
            || !criticalSlotsMatch
            || source.locationIds.length !== locations
            || source.triggerModifier !== triggerModifier) {
            throw new Error('Mek pilot check source does not match its trigger semantics');
        }
    };

    switch (source.triggerKind) {
        case 'damage-total-20': {
            requireSource('damage', 0, 0, 1);
            const witness = exactWitnessRecord(decodedWitness, [
                'triggerKind', 'before', 'after', 'mutations',
            ]);
            if (witness['triggerKind'] !== 'damage-total-20'
                || !canonicalNonnegativeInteger(witness['before'], 1_000_000)
                || !canonicalNonnegativeInteger(witness['after'], 1_000_000)
                || witness['before'] >= 20
                || witness['after'] < 20
                || !Array.isArray(witness['mutations'])
                || witness['mutations'].length > MAX_MEK_PILOT_CHECKS_V2) {
                throw new Error('Invalid 20-damage pilot check witness');
            }
            const mutations = witness['mutations'].map(canonicalDamageMutation);
            const received = mutations.reduce((sum, mutation) => sum + mutation.receivedDamage, 0);
            if (witness['after'] !== witness['before'] + received) {
                throw new Error('20-damage pilot check witness does not balance');
            }
            return;
        }
        case 'leg-actuator-hit':
        case 'hip-hit': {
            requireSource('damage', 1, 1, 0);
            const mutation = canonicalDamageMutation(decodedWitness);
            if (mutation.kind !== 'critical'
                || mutation.beforeUnavailable
                || !mutation.afterUnavailable
                || mutation.slotId !== source.criticalSlotIds[0]) {
                throw new Error('Damage critical pilot check witness does not match its source');
            }
            return;
        }
        case 'gyro-hit': {
            if (![1, 2, 3].includes(source.triggerModifier)) {
                throw new Error('Gyro-hit pilot check modifier is invalid');
            }
            if (source.sourceKind !== 'damage'
                || source.criticalSlotIds.length !== 1
                || source.locationIds.length !== 1) {
                throw new Error('Mek pilot check source does not match its trigger semantics');
            }
            const mutation = canonicalDamageMutation(decodedWitness);
            if (mutation.kind !== 'critical'
                || mutation.beforeUnavailable
                || !mutation.afterUnavailable
                || mutation.slotId !== source.criticalSlotIds[0]) {
                throw new Error('Gyro-hit witness does not match its source');
            }
            return;
        }
        case 'leg-destroyed': {
            requireSource('damage', 0, 1, 0);
            const mutation = canonicalDamageMutation(decodedWitness);
            if (mutation.kind !== 'internal'
                || mutation.beforeDestroyed
                || !mutation.afterDestroyed
                || mutation.locationId !== source.locationIds[0]) {
                throw new Error('Destroyed-leg pilot check witness does not match its source');
            }
            return;
        }
        case 'move-damaged-gyro': {
            const witness = exactWitnessRecord(decodedWitness, [
                'declaration', 'damagedGyro', 'heavyDuty',
            ]);
            const declaration = exactWitnessMovementDeclaration(witness['declaration']);
            const criticalSlotIds = exactWitnessIds(
                witness['damagedGyro'], 'damaged gyro critical slot',
            ) as CriticalSlotId[];
            const validTriggerModifier = source.triggerModifier === 0
                || (witness['heavyDuty'] === true
                    && declaration.mode === 'jump'
                    && source.triggerModifier === 2);
            if (typeof witness['heavyDuty'] !== 'boolean'
                || !sameStrings(criticalSlotIds, source.criticalSlotIds)
                || !['run', 'sprint', 'jump'].includes(declaration.mode)
                || !validTriggerModifier) {
                throw new Error('Damaged-gyro movement witness does not match its source');
            }
            if (source.sourceKind !== 'movement'
                || source.criticalSlotIds.length === 0
                || source.locationIds.length !== 1) {
                throw new Error('Mek pilot check source does not match its trigger semantics');
            }
            return;
        }
        case 'move-damaged-leg': {
            const witness = exactWitnessRecord(decodedWitness, [
                'declaration', 'locationId', 'quadruped',
            ]);
            const declaration = exactWitnessMovementDeclaration(witness['declaration']);
            if (!['run', 'sprint', 'jump'].includes(declaration.mode)
                || !boundedCanonicalText(witness['locationId'], 512)
                || typeof witness['quadruped'] !== 'boolean'
                || witness['locationId'] !== source.locationIds[0]
                || (source.triggerModifier !== 0
                    && !(declaration.mode === 'jump'
                        && witness['quadruped'] === true
                        && source.triggerModifier === 5))) {
                throw new Error('Damaged-leg movement witness does not match its source');
            }
            if (source.sourceKind !== 'movement'
                || source.criticalSlotIds.length !== 0
                || source.locationIds.length !== 1) {
                throw new Error('Mek pilot check source does not match its trigger semantics');
            }
            return;
        }
        case 'move-damaged-actuator': {
            const witness = exactWitnessRecord(decodedWitness, [
                'declaration', 'locationId', 'slotIds',
            ]);
            const declaration = exactWitnessMovementDeclaration(witness['declaration']);
            const criticalSlotIds = exactWitnessIds(
                witness['slotIds'], 'damaged actuator critical slot',
            ) as CriticalSlotId[];
            if (!['run', 'sprint', 'jump'].includes(declaration.mode)
                || !boundedCanonicalText(witness['locationId'], 512)
                || witness['locationId'] !== source.locationIds[0]
                || !sameStrings(criticalSlotIds, source.criticalSlotIds)) {
                throw new Error('Damaged-actuator movement witness does not match its source');
            }
            requireSource('movement', 'one-or-more', 1, 0);
            return;
        }
        case 'sprint-booster': {
            requireSource('movement', 0, 0, 0);
            const witness = exactWitnessRecord(decodedWitness, ['declaration', 'boosterKind']);
            const declaration = exactWitnessMovementDeclaration(witness['declaration']);
            if (declaration.mode !== 'sprint'
                || (witness['boosterKind'] !== 'MASC'
                    && witness['boosterKind'] !== 'supercharger')) {
                throw new Error('Sprint-booster witness does not match its source');
            }
            return;
        }
        case 'get-up': {
            if (source.sourceKind !== 'action'
                || source.criticalSlotIds.length !== 0
                || source.locationIds.length !== 0) {
                throw new Error('Mek pilot check source does not match its trigger semantics');
            }
            const witness = exactWitnessRecord(decodedWitness, ['carefulStand', 'prone']);
            if (typeof witness['carefulStand'] !== 'boolean' || witness['prone'] !== true) {
                throw new Error('Get-up pilot check witness does not match its source');
            }
            if (![0, -1, -2, -3].includes(source.triggerModifier)) {
                throw new Error('Get-up pilot check modifier is invalid');
            }
            return;
        }
        case 'shutdown': {
            requireSource('action', 0, 0, 3);
            const witness = exactWitnessRecord(decodedWitness, ['action']);
            const action = exactWitnessActionDeclaration(witness['action']);
            if (action.kind !== 'shutdown') {
                throw new Error('Shutdown pilot check witness does not match its source');
            }
            return;
        }
    }
}

function exactWitnessRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!plainRecord(value)
        || Object.keys(value).length !== keys.length
        || !exactKeys(value, keys)) {
        throw new Error('Invalid Mek pilot check witness structure');
    }
    return value;
}

function exactWitnessMovementDeclaration(value: unknown): MekMovementDeclarationV2 {
    const declaration = canonicalizeMekMovementDeclarationV2(value as MekMovementDeclarationV2);
    if (!jsonValuesEqual(value, declaration)) {
        throw new Error('Mek movement witness declaration is not canonical');
    }
    return declaration;
}

function exactWitnessActionDeclaration(value: unknown): MekActionDeclarationV2 {
    const action = canonicalizeMekActionDeclarationV2(value as MekActionDeclarationV2);
    if (!jsonValuesEqual(value, action)) {
        throw new Error('Mek action witness declaration is not canonical');
    }
    return action;
}

function exactWitnessIds(value: unknown, label: string): string[] {
    const ids = canonicalIds(value, label);
    if (!sameStrings(value as readonly string[], ids)) {
        throw new Error(`Mek pilot check witness ${label} IDs are not canonical`);
    }
    return ids;
}

function canonicalResolution(value: unknown): MekPilotCheckResolutionEvidenceV2 {
    if (!plainRecord(value)
        || !exactKeys(value, ['dice', 'total'])
        || !Array.isArray(value['dice'])
        || value['dice'].length !== 2
        || !value['dice'].every(die => Number.isSafeInteger(die) && die >= 1 && die <= 6)
        || value['total'] !== value['dice'][0] + value['dice'][1]) {
        throw new Error('Invalid Mek pilot check resolution evidence');
    }
    return Object.freeze({
        dice: Object.freeze([value['dice'][0] as number, value['dice'][1] as number] as const),
        total: value['total'] as number,
    });
}

function canonicalDamageMutation(value: unknown): MekCommittedDamageMutationV2 {
    if (!plainRecord(value)) throw new Error('Invalid committed Mek damage mutation');
    if (value['kind'] === 'critical') {
        const slotId = value['slotId'];
        const beforeHits = value['beforeHits'];
        const afterHits = value['afterHits'];
        const beforeUnavailable = value['beforeUnavailable'];
        const afterUnavailable = value['afterUnavailable'];
        const receivedDamage = value['receivedDamage'];
        if (!exactKeys(value, [
            'kind', 'slotId', 'beforeHits', 'afterHits', 'beforeUnavailable', 'afterUnavailable', 'receivedDamage',
        ]) || !boundedCanonicalText(slotId, 512)
            || !canonicalNonnegativeInteger(beforeHits, 1_000_000)
            || !canonicalNonnegativeInteger(afterHits, 1_000_000)
            || typeof beforeUnavailable !== 'boolean'
            || typeof afterUnavailable !== 'boolean'
            || receivedDamage !== 0
            || afterHits < beforeHits
            || beforeUnavailable && !afterUnavailable
            || beforeUnavailable !== afterUnavailable && afterHits === beforeHits) {
            throw new Error('Invalid committed critical mutation');
        }
        return Object.freeze({
            kind: 'critical',
            slotId: asCriticalSlotId(slotId),
            beforeHits,
            afterHits,
            beforeUnavailable,
            afterUnavailable,
            receivedDamage,
        });
    }
    if (value['kind'] === 'internal') {
        const locationId = value['locationId'];
        const beforeRemaining = value['beforeRemaining'];
        const afterRemaining = value['afterRemaining'];
        const beforeDestroyed = value['beforeDestroyed'];
        const afterDestroyed = value['afterDestroyed'];
        const receivedDamage = value['receivedDamage'];
        if (!exactKeys(value, [
            'kind', 'locationId', 'beforeRemaining', 'afterRemaining', 'beforeDestroyed', 'afterDestroyed',
            'receivedDamage',
        ]) || !boundedCanonicalText(locationId, 512)
            || !canonicalNonnegativeInteger(beforeRemaining, 1_000_000)
            || !canonicalNonnegativeInteger(afterRemaining, 1_000_000)
            || typeof beforeDestroyed !== 'boolean'
            || typeof afterDestroyed !== 'boolean'
            || !canonicalNonnegativeInteger(receivedDamage, 1_000_000)
            || afterRemaining > beforeRemaining
            || receivedDamage !== beforeRemaining - afterRemaining
            || beforeDestroyed && !afterDestroyed) {
            throw new Error('Invalid committed internal mutation');
        }
        return Object.freeze({
            kind: 'internal',
            locationId: asLocationId(locationId),
            beforeRemaining,
            afterRemaining,
            beforeDestroyed,
            afterDestroyed,
            receivedDamage,
        });
    }
    if (value['kind'] === 'armor') {
        const faceId = value['faceId'];
        const beforeRemaining = value['beforeRemaining'];
        const afterRemaining = value['afterRemaining'];
        const receivedDamage = value['receivedDamage'];
        if (!exactKeys(value, ['kind', 'faceId', 'beforeRemaining', 'afterRemaining', 'receivedDamage'])
            || !boundedCanonicalText(faceId, 512)
            || !canonicalNonnegativeInteger(beforeRemaining, 1_000_000)
            || !canonicalNonnegativeInteger(afterRemaining, 1_000_000)
            || !canonicalNonnegativeInteger(receivedDamage, 1_000_000)
            || afterRemaining > beforeRemaining
            || receivedDamage !== beforeRemaining - afterRemaining) {
            throw new Error('Invalid committed armor mutation');
        }
        return Object.freeze({
            kind: 'armor',
            faceId,
            beforeRemaining,
            afterRemaining,
            receivedDamage,
        });
    }
    throw new Error('Unknown committed Mek damage mutation');
}

function assertMutationMatchesCommittedFacts(
    mutation: MekCommittedDamageMutationV2,
    facts: MekMovementPsrRuntimeFactsV2,
): void {
    if (mutation.kind === 'critical'
        && facts.criticalSlotUnavailable(mutation.slotId) !== mutation.afterUnavailable) {
        throw new Error('Committed critical mutation disagrees with runtime facts');
    }
    if (mutation.kind === 'internal'
        && facts.locationDestroyed(mutation.locationId) !== mutation.afterDestroyed) {
        throw new Error('Committed internal mutation disagrees with runtime facts');
    }
}

function assertDistinctMutationTargets(mutations: readonly MekCommittedDamageMutationV2[]): void {
    const targets = new Set<string>();
    for (const mutation of mutations) {
        const target = mutation.kind === 'critical'
            ? `critical:${mutation.slotId}`
            : mutation.kind === 'internal'
                ? `internal:${mutation.locationId}`
                : `armor:${mutation.faceId}`;
        if (targets.has(target)) throw new Error('Duplicate committed Mek damage mutation target');
        targets.add(target);
    }
}

function sortedMutations<T extends MekCommittedDamageMutationV2>(mutations: readonly T[]): readonly T[] {
    return Object.freeze([...mutations].sort((left, right) => compareText(
        JSON.stringify(left),
        JSON.stringify(right),
    )));
}

function deserializeMovementDeclaration(value: unknown): MekMovementDeclarationV2 {
    const result = canonicalizeMekMovementDeclarationV2(value as MekMovementDeclarationV2);
    const record = value as Record<string, unknown>;
    if (!sameStrings(record['boosterComponentIds'] as readonly string[], result.boosterComponentIds)) {
        throw new Error('Serialized Mek movement booster IDs are not canonical');
    }
    return result;
}

function deserializeActionDeclaration(value: unknown): MekActionDeclarationV2 {
    return canonicalizeMekActionDeclarationV2(value as MekActionDeclarationV2);
}

function deserializeCheck(value: unknown): MekPilotCheckV2 {
    if (!plainRecord(value)) throw new Error('Invalid serialized Mek pilot check');
    const result = canonicalizeCheck(value);
    const source = value['source'];
    if (!plainRecord(source)
        || !sameStrings(source['criticalSlotIds'] as readonly string[], result.source.criticalSlotIds)
        || !sameStrings(source['locationIds'] as readonly string[], result.source.locationIds)) {
        throw new Error('Serialized Mek pilot check source IDs are not canonical');
    }
    return result;
}

function freezeState(value: MekMovementPsrStateV2): MekMovementPsrStateV2 {
    return Object.freeze({
        movement: value.movement === null ? null : Object.freeze({
            ...value.movement,
            boosterComponentIds: Object.freeze([...value.movement.boosterComponentIds]),
        }),
        action: value.action === null ? null : Object.freeze({ ...value.action }),
        standAttempts: value.standAttempts,
        carefulStand: value.carefulStand,
        damageThisPhase: value.damageThisPhase,
        checks: Object.freeze(value.checks.map(check => Object.freeze({
            ...check,
            source: Object.freeze({
                ...check.source,
                criticalSlotIds: Object.freeze([...check.source.criticalSlotIds]),
                locationIds: Object.freeze([...check.source.locationIds]),
            }),
            ...(check.resolution === undefined ? {} : {
                resolution: Object.freeze({
                    dice: Object.freeze([...check.resolution.dice] as [number, number]),
                    total: check.resolution.total,
                }),
            }),
        }))),
        automaticFalls: Object.freeze(value.automaticFalls.map(fall => Object.freeze({
            triggerKind: fall.triggerKind,
            locationIds: Object.freeze([...fall.locationIds]),
        }))),
    });
}

type RemappableIdentityKindV2 = Exclude<MekMovementPsrRemapIdentityKindV2, 'state'>;

interface MekMovementPsrRemapReferencesV2 {
    readonly components: Map<string, Set<string>>;
    readonly criticalSlots: Map<string, Set<string>>;
    readonly locations: Map<string, Set<string>>;
}

interface MekMovementPsrResolvedIdsV2 {
    readonly components: ReadonlyMap<string, ComponentId>;
    readonly criticalSlots: ReadonlyMap<string, CriticalSlotId>;
    readonly locations: ReadonlyMap<string, LocationId>;
}

function collectRemapReferences(state: MekMovementPsrStateV2): MekMovementPsrRemapReferencesV2 {
    const references: MekMovementPsrRemapReferencesV2 = {
        components: new Map(),
        criticalSlots: new Map(),
        locations: new Map(),
    };
    if (state.movement !== null) {
        collectMovementDeclarationReferences(state.movement, '$.movement', references);
    }
    state.checks.forEach((check, checkIndex) => {
        const sourcePath = `$.checks[${checkIndex}].source`;
        check.source.criticalSlotIds.forEach((id, index) => addRemapReference(
            references,
            'critical-slot',
            id,
            `${sourcePath}.criticalSlotIds[${index}]`,
        ));
        check.source.locationIds.forEach((id, index) => addRemapReference(
            references,
            'location',
            id,
            `${sourcePath}.locationIds[${index}]`,
        ));
        collectPilotCheckWitnessReferences(check, `${sourcePath}.witness`, references);
    });
    state.automaticFalls.forEach((fall, fallIndex) => {
        fall.locationIds.forEach((id, index) => addRemapReference(
            references,
            'location',
            id,
            `$.automaticFalls[${fallIndex}].locationIds[${index}]`,
        ));
    });
    return references;
}

function collectPilotCheckWitnessReferences(
    check: MekPilotCheckV2,
    path: string,
    references: MekMovementPsrRemapReferencesV2,
): void {
    const witness = JSON.parse(check.source.witness) as Record<string, unknown>;
    switch (check.source.triggerKind) {
        case 'damage-total-20':
            (witness['mutations'] as MekCommittedDamageMutationV2[]).forEach((mutation, index) =>
                collectDamageMutationReferences(mutation, `${path}.mutations[${index}]`, references));
            return;
        case 'leg-actuator-hit':
        case 'hip-hit':
        case 'gyro-hit':
        case 'leg-destroyed':
            collectDamageMutationReferences(canonicalDamageMutation(witness), path, references);
            return;
        case 'move-damaged-gyro':
            collectMovementDeclarationReferences(
                witness['declaration'] as MekMovementDeclarationV2,
                `${path}.declaration`,
                references,
            );
            (witness['damagedGyro'] as CriticalSlotId[]).forEach((id, index) => addRemapReference(
                references,
                'critical-slot',
                id,
                `${path}.damagedGyro[${index}]`,
            ));
            return;
        case 'move-damaged-leg':
            collectMovementDeclarationReferences(
                witness['declaration'] as MekMovementDeclarationV2,
                `${path}.declaration`,
                references,
            );
            addRemapReference(
                references,
                'location',
                witness['locationId'] as LocationId,
                `${path}.locationId`,
            );
            return;
        case 'move-damaged-actuator':
            collectMovementDeclarationReferences(
                witness['declaration'] as MekMovementDeclarationV2,
                `${path}.declaration`,
                references,
            );
            addRemapReference(
                references,
                'location',
                witness['locationId'] as LocationId,
                `${path}.locationId`,
            );
            (witness['slotIds'] as CriticalSlotId[]).forEach((id, index) => addRemapReference(
                references,
                'critical-slot',
                id,
                `${path}.slotIds[${index}]`,
            ));
            return;
        case 'sprint-booster':
            collectMovementDeclarationReferences(
                witness['declaration'] as MekMovementDeclarationV2,
                `${path}.declaration`,
                references,
            );
            return;
        case 'get-up':
        case 'shutdown':
            return;
    }
}

function collectMovementDeclarationReferences(
    declaration: MekMovementDeclarationV2,
    path: string,
    references: MekMovementPsrRemapReferencesV2,
): void {
    declaration.boosterComponentIds.forEach((id, index) => addRemapReference(
        references,
        'component',
        id,
        `${path}.boosterComponentIds[${index}]`,
    ));
}

function collectDamageMutationReferences(
    mutation: MekCommittedDamageMutationV2,
    path: string,
    references: MekMovementPsrRemapReferencesV2,
): void {
    if (mutation.kind === 'critical') {
        addRemapReference(references, 'critical-slot', mutation.slotId, `${path}.slotId`);
    } else if (mutation.kind === 'internal') {
        addRemapReference(references, 'location', mutation.locationId, `${path}.locationId`);
    }
    // ArmorFaceId is stable event evidence rather than a profile lookup used by
    // any persisted pilot-check trigger, so its bounded text remains unchanged.
}

function addRemapReference(
    references: MekMovementPsrRemapReferencesV2,
    kind: RemappableIdentityKindV2,
    sourceId: string,
    path: string,
): void {
    const target = kind === 'component'
        ? references.components
        : kind === 'critical-slot'
            ? references.criticalSlots
            : references.locations;
    const paths = target.get(sourceId) ?? new Set<string>();
    paths.add(path);
    target.set(sourceId, paths);
}

function resolveRemapReferences(
    references: MekMovementPsrRemapReferencesV2,
    resolvers: MekMovementPsrIdRemapResolversV2,
): {
    readonly ids: MekMovementPsrResolvedIdsV2;
    readonly unresolved: readonly MekMovementPsrRemapUnresolvedV2[];
} {
    const components = new Map<string, ComponentId>();
    const criticalSlots = new Map<string, CriticalSlotId>();
    const locations = new Map<string, LocationId>();
    const unresolved: MekMovementPsrRemapUnresolvedV2[] = [];
    resolveIdentityKind(
        'component', references.components, resolvers?.componentId, components, unresolved,
    );
    resolveIdentityKind(
        'critical-slot', references.criticalSlots, resolvers?.criticalSlotId, criticalSlots, unresolved,
    );
    resolveIdentityKind(
        'location', references.locations, resolvers?.locationId, locations, unresolved,
    );
    detectTargetCollisions('component', references.components, components, unresolved);
    detectTargetCollisions('critical-slot', references.criticalSlots, criticalSlots, unresolved);
    detectTargetCollisions('location', references.locations, locations, unresolved);
    return Object.freeze({
        ids: Object.freeze({ components, criticalSlots, locations }),
        unresolved: canonicalRemapUnresolved(unresolved),
    });
}

function resolveIdentityKind<TId extends string>(
    kind: RemappableIdentityKindV2,
    references: ReadonlyMap<string, ReadonlySet<string>>,
    resolver: ((sourceId: TId) => readonly TId[]) | undefined,
    output: Map<string, TId>,
    unresolved: MekMovementPsrRemapUnresolvedV2[],
): void {
    for (const [sourceId, rawPaths] of [...references].sort(([left], [right]) => compareText(left, right))) {
        const paths = [...rawPaths].sort(compareText);
        if (typeof resolver !== 'function') {
            unresolved.push(remapUnresolved(
                'INVALID_RESOLVER_RESULT', kind, [sourceId], [], paths,
            ));
            continue;
        }
        let rawCandidates: unknown;
        try {
            rawCandidates = resolver(sourceId as TId);
        } catch {
            unresolved.push(remapUnresolved(
                'INVALID_RESOLVER_RESULT', kind, [sourceId], [], paths,
            ));
            continue;
        }
        if (!Array.isArray(rawCandidates) || rawCandidates.length > 256) {
            unresolved.push(remapUnresolved(
                'INVALID_RESOLVER_RESULT', kind, [sourceId], [], paths,
            ));
            continue;
        }
        let candidates: TId[];
        try {
            candidates = [...new Set(rawCandidates.map(candidate =>
                canonicalText(candidate, 512) as TId))].sort(compareText);
        } catch {
            unresolved.push(remapUnresolved(
                'INVALID_RESOLVER_RESULT', kind, [sourceId], [], paths,
            ));
            continue;
        }
        if (candidates.length === 0) {
            unresolved.push(remapUnresolved(
                'MISSING_ID_MAPPING', kind, [sourceId], [], paths,
            ));
        } else if (candidates.length > 1) {
            unresolved.push(remapUnresolved(
                'AMBIGUOUS_ID_MAPPING', kind, [sourceId], candidates, paths,
            ));
        } else {
            output.set(sourceId, candidates[0]!);
        }
    }
}

function detectTargetCollisions<TId extends string>(
    kind: RemappableIdentityKindV2,
    references: ReadonlyMap<string, ReadonlySet<string>>,
    resolved: ReadonlyMap<string, TId>,
    unresolved: MekMovementPsrRemapUnresolvedV2[],
): void {
    const sourcesByTarget = new Map<string, string[]>();
    for (const [sourceId, targetId] of resolved) {
        const sources = sourcesByTarget.get(targetId) ?? [];
        sources.push(sourceId);
        sourcesByTarget.set(targetId, sources);
    }
    for (const [targetId, rawSources] of [...sourcesByTarget].sort(([left], [right]) =>
        compareText(left, right))) {
        const sourceIds = [...new Set(rawSources)].sort(compareText);
        if (sourceIds.length < 2) continue;
        const paths = sourceIds.flatMap(sourceId => [...(references.get(sourceId) ?? [])]);
        unresolved.push(remapUnresolved(
            'TARGET_ID_COLLISION', kind, sourceIds, [targetId], paths,
        ));
    }
}

function remapMovementDeclaration(
    declaration: MekMovementDeclarationV2,
    ids: MekMovementPsrResolvedIdsV2,
): MekMovementDeclarationV2 {
    return canonicalizeMekMovementDeclarationV2({
        ...declaration,
        boosterComponentIds: declaration.boosterComponentIds
            .map(id => requiredRemappedId(ids.components, id))
            .sort(compareText),
    });
}

function remapPilotCheck(
    check: MekPilotCheckV2,
    ids: MekMovementPsrResolvedIdsV2,
): MekPilotCheckV2 {
    const source = canonicalizeSource({
        ...check.source,
        witness: remapPilotCheckWitness(check, ids),
        criticalSlotIds: check.source.criticalSlotIds
            .map(id => requiredRemappedId(ids.criticalSlots, id))
            .sort(compareText),
        locationIds: check.source.locationIds
            .map(id => requiredRemappedId(ids.locations, id))
            .sort(compareText),
    });
    return canonicalizeCheck({
        ...check,
        checkId: createCheckId(check.producingRevision, check.ordinal),
        source,
    });
}

function remapPilotCheckWitness(
    check: MekPilotCheckV2,
    ids: MekMovementPsrResolvedIdsV2,
): string {
    const witness = JSON.parse(check.source.witness) as Record<string, unknown>;
    switch (check.source.triggerKind) {
        case 'damage-total-20':
            return canonicalWitness({
                triggerKind: witness['triggerKind'],
                before: witness['before'],
                after: witness['after'],
                mutations: (witness['mutations'] as MekCommittedDamageMutationV2[])
                    .map(mutation => remapDamageMutation(mutation, ids)),
            });
        case 'leg-actuator-hit':
        case 'hip-hit':
        case 'gyro-hit':
        case 'leg-destroyed':
            return canonicalWitness(remapDamageMutation(canonicalDamageMutation(witness), ids));
        case 'move-damaged-gyro':
            return canonicalWitness({
                declaration: remapMovementDeclaration(
                    witness['declaration'] as MekMovementDeclarationV2,
                    ids,
                ),
                damagedGyro: (witness['damagedGyro'] as CriticalSlotId[])
                    .map(id => requiredRemappedId(ids.criticalSlots, id))
                    .sort(compareText),
                heavyDuty: witness['heavyDuty'],
            });
        case 'move-damaged-leg':
            return canonicalWitness({
                declaration: remapMovementDeclaration(
                    witness['declaration'] as MekMovementDeclarationV2,
                    ids,
                ),
                locationId: requiredRemappedId(
                    ids.locations,
                    witness['locationId'] as LocationId,
                ),
                quadruped: witness['quadruped'],
            });
        case 'move-damaged-actuator':
            return canonicalWitness({
                declaration: remapMovementDeclaration(
                    witness['declaration'] as MekMovementDeclarationV2,
                    ids,
                ),
                locationId: requiredRemappedId(
                    ids.locations,
                    witness['locationId'] as LocationId,
                ),
                slotIds: (witness['slotIds'] as CriticalSlotId[])
                    .map(id => requiredRemappedId(ids.criticalSlots, id))
                    .sort(compareText),
            });
        case 'sprint-booster':
            return canonicalWitness({
                declaration: remapMovementDeclaration(
                    witness['declaration'] as MekMovementDeclarationV2,
                    ids,
                ),
                boosterKind: witness['boosterKind'],
            });
        case 'get-up':
        case 'shutdown':
            return check.source.witness;
    }
}

function remapDamageMutation(
    mutation: MekCommittedDamageMutationV2,
    ids: MekMovementPsrResolvedIdsV2,
): MekCommittedDamageMutationV2 {
    if (mutation.kind === 'critical') {
        return Object.freeze({
            ...mutation,
            slotId: requiredRemappedId(ids.criticalSlots, mutation.slotId),
        });
    }
    if (mutation.kind === 'internal') {
        return Object.freeze({
            ...mutation,
            locationId: requiredRemappedId(ids.locations, mutation.locationId),
        });
    }
    return mutation;
}

function requiredRemappedId<TId extends string>(
    ids: ReadonlyMap<string, TId>,
    sourceId: string,
): TId {
    const result = ids.get(sourceId);
    if (result === undefined) throw new Error('Required Mek movement/PSR identity was not remapped');
    return result;
}

function remapUnresolved(
    code: MekMovementPsrRemapUnresolvedCodeV2,
    identityKind: MekMovementPsrRemapIdentityKindV2,
    sourceIds: readonly string[],
    candidateIds: readonly string[],
    paths: readonly string[],
): MekMovementPsrRemapUnresolvedV2 {
    return Object.freeze({
        code,
        identityKind,
        sourceIds: Object.freeze([...new Set(sourceIds)].sort(compareText)),
        candidateIds: Object.freeze([...new Set(candidateIds)].sort(compareText)),
        paths: Object.freeze([...new Set(paths)].sort(compareText)),
    });
}

function canonicalRemapUnresolved(
    values: readonly MekMovementPsrRemapUnresolvedV2[],
): readonly MekMovementPsrRemapUnresolvedV2[] {
    const byWitness = new Map<string, MekMovementPsrRemapUnresolvedV2>();
    for (const value of values) {
        const canonical = remapUnresolved(
            value.code,
            value.identityKind,
            value.sourceIds,
            value.candidateIds,
            value.paths,
        );
        byWitness.set(JSON.stringify(canonical), canonical);
    }
    return Object.freeze([...byWitness]
        .sort(([left], [right]) => compareText(left, right))
        .map(([, value]) => value));
}

function remapRejected(
    unresolved: readonly MekMovementPsrRemapUnresolvedV2[],
): Extract<MekMovementPsrStateRemapResultV2, { readonly accepted: false }> {
    return Object.freeze({
        accepted: false as const,
        unresolved: canonicalRemapUnresolved(unresolved),
    });
}

function groupAvailable(
    group: MekExactComponentGroup,
    facts: MekMovementPsrRuntimeFactsV2,
): boolean {
    return facts.componentAvailable(group.componentId)
        && group.criticalSlotIds.every(slotId => !facts.criticalSlotUnavailable(slotId))
        && group.locationIds.every(locationId => !facts.locationDestroyed(locationId));
}

function createCheckId(revision: number, ordinal: number): string {
    return `mek-psr:${revision}:${ordinal}`;
}

function canonicalWitness(value: unknown): string {
    const result = JSON.stringify(value);
    if (!boundedCanonicalText(result, MAX_MEK_PILOT_CHECK_WITNESS_LENGTH_V2)) {
        throw new Error('Mek pilot check witness exceeds its bounded range');
    }
    return result;
}

function canonicalIds(values: unknown, label: string): string[] {
    if (!Array.isArray(values) || values.length > 256) throw new Error(`Invalid ${label} IDs`);
    const result = values.map(value => canonicalText(value, 512)).sort(compareText);
    for (let index = 1; index < result.length; index++) {
        if (result[index - 1] === result[index]) throw new Error(`Duplicate ${label} ID`);
    }
    return result;
}

function blocker(
    code: MekMovementBlockReasonCodeV2,
    message: string,
): MekMovementMessageV2<MekMovementBlockReasonCodeV2> {
    return Object.freeze({ code, message });
}

function warning(
    code: MekMovementWarningCodeV2,
    message: string,
): MekMovementMessageV2<MekMovementWarningCodeV2> {
    return Object.freeze({ code, message });
}

function unsupported(message: string): MekMovementPsrUnsupportedV2 {
    return Object.freeze({ kind: 'unsupported', blockers: Object.freeze([message]) });
}

function withStandAttemptsAndClampedMovement(
    profile: MekMechanicsProfile,
    facts: MekMovementPsrRuntimeFactsV2,
    state: MekMovementPsrStateV2,
    standAttempts: number,
    carefulStand: boolean,
): MekMovementPsrStateV2 {
    const numbers = movementNumbers(profile, facts);
    const capacity = movementCapacityForDeclaration(profile, facts, numbers, state.movement);
    const spent = carefulStand ? capacity : standAttempts * 2;
    const maximum = Math.max(0, capacity - spent);
    const movement = state.movement === null
        ? null
        : Object.freeze({ ...state.movement, distance: Math.min(state.movement.distance, maximum) });
    return freezeState({ ...state, movement, standAttempts, carefulStand });
}

function rejectedStand(
    reason: Extract<MekStandAttemptResolutionV2, { readonly accepted: false }>['reason'],
    blockers: readonly string[],
): Extract<MekStandAttemptResolutionV2, { readonly accepted: false }> {
    return Object.freeze({ accepted: false, reason, blockers: Object.freeze([...blockers]) });
}

function rejectedTransition(
    reason: 'INVALID_DECLARATION',
    blockerMessage: string,
): MekMovementStateTransitionV2 {
    return Object.freeze({ accepted: false, reason, blockers: Object.freeze([blockerMessage]) });
}

function requireRevision(value: number): void {
    if (!canonicalNonnegativeInteger(value, Number.MAX_SAFE_INTEGER)) {
        throw new Error('Invalid Mek pilot-check producing revision');
    }
}

function isMovementMode(value: unknown): value is MekMovementModeV2 {
    return MOVEMENT_MODES.includes(value as MekMovementModeV2);
}

function isActionKind(value: unknown): value is MekActionIntentKindV2 {
    return ACTION_KINDS.includes(value as MekActionIntentKindV2);
}

function canonicalText(value: unknown, maximum: number): string {
    if (typeof value !== 'string' || !boundedCanonicalText(value, maximum)) {
        throw new Error('Invalid canonical text');
    }
    return value;
}

function boundedText(value: unknown, maximum: number): value is string {
    return typeof value === 'string' && value.trim().length > 0
        && value.length <= maximum && !value.includes('\0');
}

function boundedCanonicalText(value: unknown, maximum: number): value is string {
    return boundedText(value, maximum)
        && value === value.trim()
        && value === value.normalize('NFC');
}

function canonicalNonnegativeNumber(value: unknown, maximum: number): value is number {
    return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)
        && value >= 0 && value <= maximum;
}

function canonicalNonnegativeInteger(value: unknown, maximum: number): value is number {
    return canonicalNonnegativeNumber(value, maximum) && Number.isSafeInteger(value);
}

function canonicalInteger(value: unknown, minimum: number, maximum: number): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0)
        && value >= minimum && value <= maximum;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value: object, allowed: readonly string[]): boolean {
    const keys = Object.keys(value);
    return keys.every(key => allowed.includes(key));
}

function sameStrings(left: unknown, right: readonly string[]): boolean {
    return Array.isArray(left)
        && left.length === right.length
        && left.every((value, index) => value === right[index]);
}
