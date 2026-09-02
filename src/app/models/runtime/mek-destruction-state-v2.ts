// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { compareText } from '../../utils/string.util';
import type {
    ArmorFaceId,
    CrewPositionId,
    CriticalSlotId,
    LocationId,
} from '../entity/entity-identifiers';
import type {
    MekMechanicsProfile,
    MekMechanicsScenarioRules,
} from './mek-mechanics-profile';
import { ImmutableIndex } from '../entity/immutable-collections';
import type { MekRuntimeIndex } from './mek-runtime-index';
import type { CrewMember } from '../crew-member.model';

export const MEK_TORSO_CRIPPLING_RULE_CHECK_KEY = 'core.torso-crippling' as const;

export type MekRuleCheckKeyV2 = typeof MEK_TORSO_CRIPPLING_RULE_CHECK_KEY;
export type MekRuleCheckOutcomeV2 = 'success' | 'failed';
export type MekRuleCheckStatusV2 = 'pending' | MekRuleCheckOutcomeV2;

declare const mekRuleCheckTokenBrand: unique symbol;
export type MekRuleCheckTokenV2 = string & { readonly [mekRuleCheckTokenBrand]: true };

export function isMekRuleCheckKeyV2(value: unknown): value is MekRuleCheckKeyV2 {
    return value === MEK_TORSO_CRIPPLING_RULE_CHECK_KEY;
}

export function isMekRuleCheckStatusV2(value: unknown): value is MekRuleCheckStatusV2 {
    return value === 'pending' || value === 'success' || value === 'failed';
}

export function asMekRuleCheckTokenV2(value: string): MekRuleCheckTokenV2 {
    if (!value.trim() || value.length > 512 || value.includes('\0')) {
        throw new Error('Invalid Mek rule-check token');
    }
    return value as MekRuleCheckTokenV2;
}

/** Persistent outcome state for one exact, deterministic mechanics trigger. */
export interface MekRuleCheckStateV2 {
    readonly token: MekRuleCheckTokenV2;
    readonly triggerLocationId: LocationId;
    readonly openedRevision: number;
    readonly status: MekRuleCheckStatusV2;
}

export type MekRuleChecksV2 = ReadonlyMap<MekRuleCheckKeyV2, MekRuleCheckStateV2>;

export type MekDamageStatePerspectiveV2 = 'committed' | 'preview';

/**
 * Narrow immutable damage view consumed by the pure kernel. The owning unit
 * supplies this view; the mechanics context supplies the private profile and
 * scenario rules.
 */
export interface MekDamageStateViewV2 {
    remainingInternal(locationId: LocationId, perspective: MekDamageStatePerspectiveV2): number;
    remainingArmor(faceId: ArmorFaceId, perspective: MekDamageStatePerspectiveV2): number;
    criticalHits(slotId: CriticalSlotId, perspective: MekDamageStatePerspectiveV2): number;
    crewState(positionId: CrewPositionId): CrewMember;
    locationCondition(
        locationId: LocationId,
        condition: 'blown-off' | 'flooded',
        perspective: MekDamageStatePerspectiveV2,
    ): number;
}

export interface MekCommittedDestructionFactsV2 {
    readonly destroyed: boolean;
    readonly engineUnavailableSlotIds: readonly CriticalSlotId[];
    readonly mainCockpitUnavailable: boolean;
    readonly commandConsoleUnavailable: boolean;
    /** Includes direct critical damage and committed location/parent loss. */
    readonly unavailableCriticalSlotIds: readonly CriticalSlotId[];
}

export interface MekPreviewCripplingFactsV2 {
    readonly crippled: boolean;
    /** Pending direct critical hits and direct structural propagation are included. */
    readonly engineUnavailableSlotIds: readonly CriticalSlotId[];
    readonly destroyedLimbLocationIds: readonly LocationId[];
    readonly destroyedLegLocationIds: readonly LocationId[];
    readonly destroyedTorsoLocationIds: readonly LocationId[];
    /** Legacy `destroying || unavailable`, expressed without mutating slot facts. */
    readonly unavailableCriticalSlotIds: readonly CriticalSlotId[];
    readonly torsoCripplingCheckRequired: boolean;
}

/** Committed unit destruction and preview forced-withdrawal state are deliberately separate. */
export interface MekDestructionFactsV2 {
    readonly committed: MekCommittedDestructionFactsV2;
    readonly preview: MekPreviewCripplingFactsV2;
    readonly torsoCripplingCheck?: MekRuleCheckStateV2;
}

export type MekRuleCheckResolutionV2 =
    | { readonly accepted: true; readonly ruleChecks: MekRuleChecksV2 }
    | { readonly accepted: false; readonly reason: 'INVALID_RULE_CHECK' };

/**
 * The token is a canonical trigger witness, not a random UI nonce. An old
 * token cannot resolve a reopened check because the opening revision changes;
 * a drifted/retargeted check also changes because the exact LocationId is part
 * of the witness.
 */
export function createMekTorsoCripplingRuleCheckTokenV2(
    openedRevision: number,
    triggerLocationId: LocationId,
): MekRuleCheckTokenV2 {
    if (!Number.isSafeInteger(openedRevision) || openedRevision < 0) {
        throw new Error(`Invalid Mek rule-check opening revision ${openedRevision}`);
    }
    if (typeof triggerLocationId !== 'string' || !triggerLocationId.trim() || triggerLocationId.includes('\0')) {
        throw new Error('Invalid Mek rule-check trigger location');
    }
    return asMekRuleCheckTokenV2(
        `${MEK_TORSO_CRIPPLING_RULE_CHECK_KEY}:${openedRevision}:${triggerLocationId}`,
    );
}

export function projectMekDestructionStateV2(
    profile: MekMechanicsProfile,
    rules: MekMechanicsScenarioRules,
    index: MekRuntimeIndex,
    state: MekDamageStateViewV2,
    ruleChecks: MekRuleChecksV2,
): MekDestructionFactsV2 {
    const orderedSlots = slotsInMechanicsOrder(profile, index);
    const committedUnavailable = orderedSlots.filter(slotId =>
        criticalUnavailableCommitted(profile, index, state, slotId));
    const previewUnavailable = orderedSlots.filter(slotId =>
        criticalUnavailableForLegacyPreview(profile, index, state, slotId));
    const committedUnavailableSet = new Set(committedUnavailable);
    const previewUnavailableSet = new Set(previewUnavailable);

    const committedEngine = profile.engine.criticalSlotIds.filter(slotId =>
        committedUnavailableSet.has(slotId));
    const previewEngine = profile.engine.criticalSlotIds.filter(slotId =>
        previewUnavailableSet.has(slotId));
    const mainCockpitUnavailable = profile.cockpit.main.criticalSlotIds.some(slotId =>
        committedUnavailableSet.has(slotId));
    const commandConsoleUnavailable = profile.cockpit.commandConsole?.criticalSlotIds.some(slotId =>
        committedUnavailableSet.has(slotId)) ?? false;
    const destroyed = committedEngine.length >= profile.engine.destructionHitThreshold
        || (mainCockpitUnavailable
            && (profile.cockpit.commandConsole === undefined || commandConsoleUnavailable));

    const destroyedLimbs = profile.limbs.filter(limb =>
        locationDirectlyDestroyed(state, limb.locationId, 'preview'));
    const destroyedLegs = destroyedLimbs.filter(limb => limb.kind === 'leg');
    const destroyedTorsos = profile.locations.filter(location =>
        isTorsoRole(location.role)
        && locationDirectlyDestroyed(state, location.locationId, 'preview'));
    const durableTorso = requiresDurableTorsoCheck(profile, rules);
    const torsoCheckRequired = durableTorso && destroyedTorsos.length === 1;
    const storedCheck = ruleChecks.get(MEK_TORSO_CRIPPLING_RULE_CHECK_KEY);
    const applicableCheck = torsoCheckRequired
        && storedCheck?.triggerLocationId === destroyedTorsos[0]!.locationId
        ? storedCheck
        : undefined;

    const crippled = !rules.forcedWithdrawal
        ? false
        : profile.rulesFlavor === 'total-warfare'
            ? totalWarfareCrippled(
                profile,
                index,
                state,
                committedUnavailableSet,
                previewUnavailableSet,
            )
            : previewEngine.length >= 2
                || (destroyedLimbs.length >= 2 && destroyedLegs.length > 0)
                || destroyedTorsos.length >= 2
                || (destroyedTorsos.length === 1
                    && (!durableTorso || applicableCheck?.status === 'failed'));

    return Object.freeze({
        committed: Object.freeze({
            destroyed,
            engineUnavailableSlotIds: Object.freeze([...committedEngine]),
            mainCockpitUnavailable,
            commandConsoleUnavailable,
            unavailableCriticalSlotIds: Object.freeze([...committedUnavailable]),
        }),
        preview: Object.freeze({
            crippled,
            engineUnavailableSlotIds: Object.freeze([...previewEngine]),
            destroyedLimbLocationIds: Object.freeze(destroyedLimbs.map(limb => limb.locationId)),
            destroyedLegLocationIds: Object.freeze(destroyedLegs.map(limb => limb.locationId)),
            destroyedTorsoLocationIds: Object.freeze(destroyedTorsos.map(location => location.locationId)),
            unavailableCriticalSlotIds: Object.freeze([...previewUnavailable]),
            torsoCripplingCheckRequired: torsoCheckRequired,
        }),
        ...(applicableCheck === undefined ? {} : { torsoCripplingCheck: applicableCheck }),
    });
}

/** Reconcile the persistent check after a damage mutation, without consuming randomness. */
export function reconcileMekRuleChecksV2(
    profile: MekMechanicsProfile,
    rules: MekMechanicsScenarioRules,
    _index: MekRuntimeIndex,
    state: MekDamageStateViewV2,
    current: MekRuleChecksV2,
    openingRevision: number,
): MekRuleChecksV2 {
    const existing = current.get(MEK_TORSO_CRIPPLING_RULE_CHECK_KEY);
    if (!requiresDurableTorsoCheck(profile, rules)) {
        return existing === undefined ? current : withoutTorsoCheck(current);
    }

    const committedTorsos = profile.locations.filter(location =>
        isTorsoRole(location.role)
        && locationDirectlyDestroyed(state, location.locationId, 'committed'));
    if (existing !== undefined
        && committedTorsos.some(location => location.locationId === existing.triggerLocationId)) {
        // A committed trigger owns its outcome until a repair commits. A
        // pending repair merely makes the check dormant, so cancel restores
        // the exact token/outcome rather than opening a reroll.
        return current;
    }

    const destroyedTorsos = profile.locations.filter(location =>
        isTorsoRole(location.role)
        && locationDirectlyDestroyed(state, location.locationId, 'preview'));
    if (destroyedTorsos.length === 0) {
        return existing === undefined ? current : withoutTorsoCheck(current);
    }
    if (destroyedTorsos.length >= 2) {
        if (existing === undefined
            || destroyedTorsos.some(location => location.locationId === existing.triggerLocationId)) {
            return current;
        }
        return withoutTorsoCheck(current);
    }

    const triggerLocationId = destroyedTorsos[0]!.locationId;
    if (existing?.triggerLocationId === triggerLocationId) return current;
    const next = new Map(current);
    next.set(MEK_TORSO_CRIPPLING_RULE_CHECK_KEY, Object.freeze({
        token: createMekTorsoCripplingRuleCheckTokenV2(openingRevision, triggerLocationId),
        triggerLocationId,
        openedRevision: openingRevision,
        status: 'pending',
    }));
    return freezeRuleChecks(next);
}

/** One persisted key cannot safely represent a different preview trigger while its committed trigger survives. */
export function mekRuleCheckTriggerConflictV2(
    profile: MekMechanicsProfile,
    rules: MekMechanicsScenarioRules,
    state: MekDamageStateViewV2,
    current: MekRuleChecksV2,
): boolean {
    if (!requiresDurableTorsoCheck(profile, rules)) return false;
    const existing = current.get(MEK_TORSO_CRIPPLING_RULE_CHECK_KEY);
    if (!existing) return false;
    const committedTriggerSurvives = locationDirectlyDestroyed(
        state,
        existing.triggerLocationId,
        'committed',
    );
    if (!committedTriggerSurvives) return false;
    const previewTorsos = profile.locations.filter(location =>
        isTorsoRole(location.role)
        && locationDirectlyDestroyed(state, location.locationId, 'preview'));
    return previewTorsos.length > 0
        && !previewTorsos.some(location => location.locationId === existing.triggerLocationId);
}

/** Resolve only the currently applicable pending check. Revision CAS remains reducer-owned. */
export function resolveMekRuleCheckV2(
    profile: MekMechanicsProfile,
    rules: MekMechanicsScenarioRules,
    state: MekDamageStateViewV2,
    current: MekRuleChecksV2,
    key: MekRuleCheckKeyV2,
    token: MekRuleCheckTokenV2,
    outcome: MekRuleCheckOutcomeV2,
): MekRuleCheckResolutionV2 {
    if (key !== MEK_TORSO_CRIPPLING_RULE_CHECK_KEY
        || (outcome !== 'success' && outcome !== 'failed')
        || !requiresDurableTorsoCheck(profile, rules)) {
        return Object.freeze({ accepted: false, reason: 'INVALID_RULE_CHECK' });
    }
    const destroyedTorsos = profile.locations.filter(location =>
        isTorsoRole(location.role)
        && locationDirectlyDestroyed(state, location.locationId, 'preview'));
    const check = current.get(key);
    if (destroyedTorsos.length !== 1
        || check === undefined
        || check.status !== 'pending'
        || check.token !== token
        || check.triggerLocationId !== destroyedTorsos[0]!.locationId
        || check.token !== createMekTorsoCripplingRuleCheckTokenV2(
            check.openedRevision,
            check.triggerLocationId,
        )) {
        return Object.freeze({ accepted: false, reason: 'INVALID_RULE_CHECK' });
    }
    const next = new Map(current);
    next.set(key, Object.freeze({ ...check, status: outcome }));
    return Object.freeze({ accepted: true, ruleChecks: freezeRuleChecks(next) });
}

export function freezeRuleChecks(
    checks: ReadonlyMap<MekRuleCheckKeyV2, MekRuleCheckStateV2>,
): MekRuleChecksV2 {
    return new ImmutableIndex([...checks].map(([key, check]) => [
        key,
        Object.freeze({ ...check }),
    ] as const));
}

function withoutTorsoCheck(current: MekRuleChecksV2): MekRuleChecksV2 {
    const next = new Map(current);
    next.delete(MEK_TORSO_CRIPPLING_RULE_CHECK_KEY);
    return freezeRuleChecks(next);
}

function requiresDurableTorsoCheck(
    profile: MekMechanicsProfile,
    rules: MekMechanicsScenarioRules,
): boolean {
    if (!rules.forcedWithdrawal || profile.rulesFlavor !== 'core-2026') return false;
    const engineType = profile.engine.type.trim().toLocaleLowerCase('en-US');
    return engineType === 'fusion' || engineType === 'compact';
}

function totalWarfareCrippled(
    profile: MekMechanicsProfile,
    index: MekRuntimeIndex,
    state: MekDamageStateViewV2,
    committedUnavailable: ReadonlySet<CriticalSlotId>,
    previewUnavailable: ReadonlySet<CriticalSlotId>,
): boolean {
    const allSensorsUnavailable = profile.sensors.criticalSlotIds.length > 0
        && profile.sensors.criticalSlotIds.every(slotId => previewUnavailable.has(slotId));
    const engineHits = profile.engine.criticalSlotIds.filter(slotId => previewUnavailable.has(slotId)).length;
    const gyroHits = profile.gyro.criticalSlotIds.filter(slotId => previewUnavailable.has(slotId)).length;
    const sideTorsoDestroyed = profile.locations.some(location =>
        (location.role === 'left-torso' || location.role === 'right-torso')
        && locationDirectlyDestroyed(state, location.locationId, 'preview'));

    let damagedLimbs = 0;
    let damagedTorsos = 0;
    const limbIds = new Set(profile.limbs.map(limb => limb.locationId));
    for (const location of profile.locations) {
        const indexed = index.locations.get(location.locationId);
        if (!indexed) throw new Error(`Unknown mechanics location ${location.locationId}`);
        if (state.remainingInternal(location.locationId, 'preview') >= indexed.internalPoints) continue;
        if (limbIds.has(location.locationId)) damagedLimbs += 1;
        else if (isTorsoRole(location.role) && frontArmorDestroyed(index, state, location.locationId)) {
            damagedTorsos += 1;
        }
    }

    return allCrewCrippled(profile, index, state, committedUnavailable)
        || allSensorsUnavailable
        || engineHits >= 2
        || (engineHits >= 1 && gyroHits >= 1)
        || sideTorsoDestroyed
        || damagedLimbs >= 3
        || damagedTorsos >= 2;
}

function allCrewCrippled(
    profile: MekMechanicsProfile,
    index: MekRuntimeIndex,
    state: MekDamageStateViewV2,
    committedUnavailable: ReadonlySet<CriticalSlotId>,
): boolean {
    if (profile.droneOperatingSystems.length > 0) return false;
    const positions = [...index.crewPositions.values()];
    return positions.length > 0 && positions.every(position => {
        const crew = state.crewState(position.id);
        const cockpit = position.occurrence === 1 && profile.cockpit.commandConsole !== undefined
            ? profile.cockpit.commandConsole
            : profile.cockpit.main;
        const cockpitUnavailable = cockpit.criticalSlotIds.some(slotId =>
            committedUnavailable.has(slotId));
        return crew.isCrippled(cockpitUnavailable);
    });
}

function frontArmorDestroyed(
    index: MekRuntimeIndex,
    state: MekDamageStateViewV2,
    locationId: LocationId,
): boolean {
    if (locationDirectlyDestroyed(state, locationId, 'preview')) return true;
    for (const face of index.armorFaces.values()) {
        if (face.locationId === locationId && face.face === 'front') {
            return state.remainingArmor(face.id, 'preview') <= 0;
        }
    }
    return false;
}

function criticalUnavailableCommitted(
    profile: MekMechanicsProfile,
    index: MekRuntimeIndex,
    state: MekDamageStateViewV2,
    slotId: CriticalSlotId,
): boolean {
    const slot = requireSlot(index, slotId);
    return state.criticalHits(slotId, 'committed') >= (slot.armored ? 2 : 1)
        || locationUnavailableCommitted(profile, state, slot.locationId);
}

/** Exact legacy `destroying || unavailable` behavior used by forced withdrawal. */
function criticalUnavailableForLegacyPreview(
    profile: MekMechanicsProfile,
    index: MekRuntimeIndex,
    state: MekDamageStateViewV2,
    slotId: CriticalSlotId,
): boolean {
    const slot = requireSlot(index, slotId);
    return criticalUnavailableCommitted(profile, index, state, slotId)
        || state.criticalHits(slotId, 'preview') >= (slot.armored ? 2 : 1)
        || state.remainingInternal(slot.locationId, 'preview') <= 0;
}

function locationUnavailableCommitted(
    profile: MekMechanicsProfile,
    state: MekDamageStateViewV2,
    locationId: LocationId,
    visited: Set<LocationId> = new Set(),
): boolean {
    if (visited.has(locationId)) return false;
    visited.add(locationId);
    if (state.remainingInternal(locationId, 'committed') <= 0
        || state.locationCondition(locationId, 'blown-off', 'committed') > 0
        || state.locationCondition(locationId, 'flooded', 'committed') > 0) return true;
    const location = profile.locations.find(candidate => candidate.locationId === locationId);
    if (!location) throw new Error(`Mechanics profile does not contain location ${locationId}`);
    return location.parentLocationId !== null
        && locationUnavailableCommitted(profile, state, location.parentLocationId, visited);
}

function locationDirectlyDestroyed(
    state: MekDamageStateViewV2,
    locationId: LocationId,
    perspective: MekDamageStatePerspectiveV2,
): boolean {
    return state.remainingInternal(locationId, perspective) <= 0
        || state.locationCondition(locationId, 'blown-off', perspective) > 0
        || state.locationCondition(locationId, 'flooded', perspective) > 0;
}

function slotsInMechanicsOrder(
    profile: MekMechanicsProfile,
    index: MekRuntimeIndex,
): readonly CriticalSlotId[] {
    const locationOrder = new Map(profile.locations.map((location, index) => [location.locationId, index] as const));
    return Object.freeze([...index.slots.values()].sort((left, right) =>
        (locationOrder.get(left.locationId) ?? Number.MAX_SAFE_INTEGER)
        - (locationOrder.get(right.locationId) ?? Number.MAX_SAFE_INTEGER)
        || left.slotIndex - right.slotIndex
        || compareText(left.id, right.id)).map(slot => slot.id));
}

function requireSlot(index: MekRuntimeIndex, slotId: CriticalSlotId) {
    const slot = index.slots.get(slotId);
    if (!slot) throw new Error(`Mechanics profile references unknown critical slot ${slotId}`);
    return slot;
}

function isTorsoRole(role: MekMechanicsProfile['locations'][number]['role']): boolean {
    return role === 'center-torso' || role === 'left-torso' || role === 'right-torso';
}
