// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ComponentId, CriticalSlotId } from '../entity/entity-identifiers';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import type { UnitWaterState } from '../unit-cover.model';
import {
    compileMekHeatProfile,
    evaluateMekHeatScenarioSupport,
    type MekHeatProfile,
    type MekHeatScenarioInput,
} from './mek-heat-profile';
import type { MekRuntimeIndex } from './mek-runtime-index';
import { ImmutableIndex, ImmutableSet } from '../entity/immutable-collections';
import {
    canonicalizeMekTurnStateV2,
    type MekTurnStateV2,
} from './mek-turn-state-v2';
import {
    MAX_MEK_MOVEMENT_MP_V2,
    type MekMovementHeatInputV2,
} from './mek-movement-psr-v2';

export const MAX_MEK_HEAT_VALUE_V2 = 1_000_000;
export const MAX_MEK_HEATSINKS_OFF_V2 = 1_000;
export const MAX_MEK_HEAT_CONTEXT_BLOCKERS_V2 = 64;

export type MekHeatAutomationPolicyV2 = 'automatic' | 'manual';

/** Durable heat track. Turn-scoped source acknowledgements remain in MekTurnStateV2. */
export interface MekHeatStateV2 {
    readonly current: number;
    readonly previous: number;
    readonly pendingOverride?: number;
    readonly heatsinksOff: number;
}

export interface MekHeatSourceV2 {
    readonly id: string;
    readonly label: string;
    readonly value: number;
    readonly replacedByFiringEntryId?: ComponentId;
    readonly signature?: string;
}

export interface MekHeatProjectionV2 {
    readonly current: number;
    /** Sources that still require settlement, including a synthetic cooling deficit. */
    readonly sources: readonly MekHeatSourceV2[];
    /** All current rule sources before acknowledgement filtering. */
    readonly committedSources: readonly MekHeatSourceV2[];
    readonly capacity: number;
    readonly underwaterBonus: number;
    readonly previouslyConsumedDissipation: number;
    readonly remainingDissipation: number;
    readonly generated: number;
    /** Cooling used by this projection. */
    readonly dissipated: number;
    readonly projected: number;
    readonly delta: number;
    readonly hasPendingResolution: boolean;
    readonly hasPendingSettlement: boolean;
}

export type MekHeatCapabilityV2 =
    | { readonly kind: 'supported'; readonly maxHeatsinksOff: number }
    | { readonly kind: 'unsupported'; readonly blockers: readonly string[] };

export type MekHeatProjectionResultV2 =
    | { readonly kind: 'supported'; readonly projection: MekHeatProjectionV2 }
    | { readonly kind: 'unsupported'; readonly blockers: readonly string[] };

/** Opaque immutable binding for one exact Mek entity and heat-context input. */
export interface MekHeatRuntimeContextV2 {
    readonly kind: 'supported' | 'unsupported';
}

type MekHeatContextBindingV2 =
    | {
        readonly kind: 'supported';
        readonly boundEntity: MekEntity;
        readonly profile: MekHeatProfile;
        readonly capability: Extract<MekHeatCapabilityV2, { readonly kind: 'supported' }>;
    }
    | {
        readonly kind: 'unsupported';
        readonly boundEntity?: MekEntity;
        readonly blockers: readonly string[];
        readonly capability: Extract<MekHeatCapabilityV2, { readonly kind: 'unsupported' }>;
    };

const HEAT_CONTEXT_BINDINGS = new WeakMap<object, MekHeatContextBindingV2>();

/** Detached snapshot consumed by the pure kernel. */
export interface MekHeatKernelInputV2 {
    readonly heat: MekHeatStateV2;
    readonly turn: MekTurnStateV2;
    readonly movement: MekMovementHeatInputV2 | null;
    readonly standAttempts: number;
    readonly destroyed: boolean;
    readonly shutdown: boolean;
    readonly water: UnitWaterState;
    /** Committed slot unavailability drives SCM/wing support and current movement rules. */
    readonly committedUnavailableCriticalSlots: ReadonlySet<CriticalSlotId>;
    /** Only committed destruction reduces ordinary heat-sink cooling this turn. */
    readonly committedDestroyedCriticalSlots: ReadonlySet<CriticalSlotId>;
    /** Committed plus pending hits generate damaged-engine heat before damage commit. */
    readonly previewUnavailableCriticalSlots: ReadonlySet<CriticalSlotId>;
    readonly committedUnavailableComponents: ReadonlySet<ComponentId>;
    /** Components whose escalating system was selected for this turn. */
    readonly activeEscalatingFailureComponents: ReadonlySet<ComponentId>;
    /** Vibroblades currently in their heat-producing ON mode. */
    readonly activeVibrobladeComponents: ReadonlySet<ComponentId>;
    /** Signature systems currently effective, including pending deactivation. */
    readonly activeStealthComponents: ReadonlySet<ComponentId>;
    /** A selected-but-not-yet-fired weapon still triggers a failed coolant leak. */
    readonly hasSelectedWeapon: boolean;
    readonly ppcCapacitors: readonly {
        readonly capacitorId: ComponentId;
        readonly weaponId: ComponentId;
        readonly chargeState: 'charging' | 'charged' | null;
    }[];
}

export interface MekHeatApplicationV2 {
    readonly changed: boolean;
    readonly heat: MekHeatStateV2;
    readonly turn: MekTurnStateV2;
    readonly projection: MekHeatProjectionV2;
}

export function createPristineMekHeatStateV2(initialHeat = 0): MekHeatStateV2 {
    assertHeatValue(initialHeat, '$.initialHeat');
    return Object.freeze({ current: initialHeat, previous: 0, heatsinksOff: 0 });
}

export function canonicalizeMekHeatStateV2(value: MekHeatStateV2): MekHeatStateV2 {
    if (!isPlainRecord(value)) throw new Error('Heat state must be a plain object');
    const keys = Object.keys(value);
    const allowed = new Set(['current', 'previous', 'pendingOverride', 'heatsinksOff']);
    if (keys.some(key => !allowed.has(key))) throw new Error('Heat state contains an unknown field');
    if (!keys.includes('current') || !keys.includes('previous') || !keys.includes('heatsinksOff')) {
        throw new Error('Heat state is missing a required field');
    }
    assertHeatValue(value.current, '$.current');
    assertHeatValue(value.previous, '$.previous');
    if (value.pendingOverride !== undefined) assertHeatValue(value.pendingOverride, '$.pendingOverride');
    if (!Number.isSafeInteger(value.heatsinksOff)
        || value.heatsinksOff < 0
        || value.heatsinksOff > MAX_MEK_HEATSINKS_OFF_V2) {
        throw new Error('$.heatsinksOff must be a bounded non-negative integer');
    }
    return Object.freeze({
        current: value.current,
        previous: value.previous,
        ...(value.pendingOverride === undefined ? {} : { pendingOverride: value.pendingOverride }),
        heatsinksOff: value.heatsinksOff,
    });
}

export function mekHeatStatesEqualV2(left: MekHeatStateV2, right: MekHeatStateV2): boolean {
    return left.current === right.current
        && left.previous === right.previous
        && left.pendingOverride === right.pendingOverride
        && left.heatsinksOff === right.heatsinksOff;
}

/**
 * The sole supported-context factory. Compilation and recovery classification happen inside
 * this authority boundary so a caller cannot pair a real entity with a handcrafted result.
 */
export function createMekHeatContextV2(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    scenario: MekHeatScenarioInput,
): MekHeatRuntimeContextV2 {
    const profileResult = compileMekHeatProfile(entity, index, ruleset);
    const scenarioResult = evaluateMekHeatScenarioSupport(scenario);
    const blockers = [
        ...(profileResult.kind === 'unsupported'
            ? profileResult.blockers.map(blocker => `${blocker.code}:${blocker.feature}: ${blocker.message}`)
            : []),
        ...(scenarioResult.kind === 'unsupported'
            ? scenarioResult.blockers.map(blocker => `${blocker.code}:${blocker.feature}: ${blocker.message}`)
            : []),
    ];
    if (profileResult.kind === 'supported'
        && profileResult.profile.declaredHeatSinkUnits > MAX_MEK_HEATSINKS_OFF_V2) {
        blockers.push(`UNREPRESENTABLE_HEAT_SINK_COUNT:${profileResult.profile.declaredHeatSinkUnits}`);
    }
    if (blockers.length > 0
        || profileResult.kind === 'unsupported'
        || scenarioResult.kind === 'unsupported') {
        return bindUnsupportedMekHeatContextV2(blockers, {
            boundEntity: entity,
        });
    }
    const capability = Object.freeze({
        kind: 'supported' as const,
        maxHeatsinksOff: profileResult.profile.declaredHeatSinkUnits,
    });
    const context = Object.freeze({ kind: 'supported' as const });
    HEAT_CONTEXT_BINDINGS.set(context, Object.freeze({
        kind: 'supported',
        boundEntity: entity,
        profile: profileResult.profile,
        capability,
    }));
    return context;
}

/** Explicit default-deny context for direct owners that have not bound heat authority. */
export function createUnboundMekHeatContextV2(
    message = 'Mek heat profile was not bound at runtime construction',
): MekHeatRuntimeContextV2 {
    return bindUnsupportedMekHeatContextV2([message]);
}

export function assertMekHeatContextEntityV2(
    context: MekHeatRuntimeContextV2,
    entity: MekEntity,
): void {
    const binding = requireHeatContextBinding(context);
    if (binding.boundEntity !== undefined && binding.boundEntity !== entity) {
        throw new Error('Mek heat context does not match the entity');
    }
}

/**
 * Opaque admission fence for a freshly resolved entity. Equivalent
 * immutable clones pass; key/content/profile drift fails without exposing the
 * private compiled heat profile or either witness.
 */
export function mekHeatContextMatchesEntityV2(
    context: MekHeatRuntimeContextV2,
    entity: MekEntity,
): boolean {
    const binding = requireHeatContextBinding(context);
    return binding.boundEntity === entity;
}

export function mekHeatCapabilityV2(
    context: MekHeatRuntimeContextV2,
    entity?: MekEntity,
): MekHeatCapabilityV2 {
    const binding = requireHeatContextBinding(context);
    const mismatch = heatContextMismatchBlockers(binding, entity);
    return mismatch === null
        ? binding.capability
        : Object.freeze({ kind: 'unsupported', blockers: mismatch });
}

export function projectMekHeatContextV2(
    context: MekHeatRuntimeContextV2,
    entity: MekEntity,
    input: MekHeatKernelInputV2,
    policy: MekHeatAutomationPolicyV2,
): MekHeatProjectionResultV2 {
    const binding = requireHeatContextBinding(context);
    const mismatch = heatContextMismatchBlockers(binding, entity);
    if (mismatch !== null) return Object.freeze({ kind: 'unsupported', blockers: mismatch });
    if (binding.kind === 'unsupported') return binding.capability;
    return Object.freeze({
        kind: 'supported',
        projection: projectMekHeatV2(binding.profile, input, policy),
    });
}

export type MekHeatApplicationResultV2 =
    | { readonly kind: 'supported'; readonly application: MekHeatApplicationV2 }
    | { readonly kind: 'unsupported'; readonly blockers: readonly string[] };

export function applyPendingMekHeatContextV2(
    context: MekHeatRuntimeContextV2,
    entity: MekEntity,
    input: MekHeatKernelInputV2,
    policy: MekHeatAutomationPolicyV2,
): MekHeatApplicationResultV2 {
    const binding = requireHeatContextBinding(context);
    const mismatch = heatContextMismatchBlockers(binding, entity);
    if (mismatch !== null) return Object.freeze({ kind: 'unsupported', blockers: mismatch });
    if (binding.kind === 'unsupported') return binding.capability;
    return Object.freeze({
        kind: 'supported',
        application: applyPendingMekHeatV2(binding.profile, input, policy),
    });
}

export function resolveEndTurnMekHeatContextV2(
    context: MekHeatRuntimeContextV2,
    entity: MekEntity,
    input: MekHeatKernelInputV2,
    policy: MekHeatAutomationPolicyV2,
): MekHeatApplicationResultV2 {
    const binding = requireHeatContextBinding(context);
    const mismatch = heatContextMismatchBlockers(binding, entity);
    if (mismatch !== null) return Object.freeze({ kind: 'unsupported', blockers: mismatch });
    if (binding.kind === 'unsupported') return binding.capability;
    return Object.freeze({
        kind: 'supported',
        application: resolveEndTurnMekHeatV2(binding.profile, input, policy),
    });
}

/** Monotonic owner-only downgrade used when restored durable heat evidence is impossible. */
export function disableMekHeatContextV2(
    context: MekHeatRuntimeContextV2,
    blockers: readonly string[],
): MekHeatRuntimeContextV2 {
    const binding = requireHeatContextBinding(context);
    return bindUnsupportedMekHeatContextV2([
        ...(binding.kind === 'unsupported' ? binding.blockers : []),
        ...blockers,
    ], {
        ...(binding.boundEntity === undefined ? {} : { boundEntity: binding.boundEntity }),
    });
}

/** Validates durable ledger facts without erasing legitimate pending heat or consumed cooling. */
export function validateMekHeatContextStateV2(
    context: MekHeatRuntimeContextV2,
    entity: MekEntity,
    input: MekHeatKernelInputV2,
): readonly string[] {
    const binding = requireHeatContextBinding(context);
    const mismatch = heatContextMismatchBlockers(binding, entity);
    if (mismatch !== null) return mismatch;
    if (binding.kind === 'unsupported') return binding.blockers;
    const blockers: string[] = [];
    const heat = canonicalizeMekHeatStateV2(input.heat);
    const turn = canonicalizeMekTurnStateV2(input.turn);
    if (heat.heatsinksOff > binding.profile.declaredHeatSinkUnits) {
        blockers.push(`HEATSINKS_OFF_EXCEEDS_PROFILE:${heat.heatsinksOff}/${binding.profile.declaredHeatSinkUnits}`);
    }
    const maximumDissipation = binding.profile.baseDissipation
        + (binding.profile.partialWing?.dissipationBonus ?? 0)
        + binding.profile.providers.filter(provider => provider.kind === 'radical-heat-sink').length
            * binding.profile.declaredHeatSinkUnits;
    if (turn.heatDissipationConsumed > maximumDissipation) {
        blockers.push(`HEAT_DISSIPATION_LEDGER_EXCEEDS_PROFILE:${turn.heatDissipationConsumed}/${maximumDissipation}`);
    }
    const currentSources = new Map(buildCommittedHeatSources(binding.profile, { ...input, heat, turn })
        .map(source => [source.id, mekHeatSourceSignatureV2(source)]));
    for (const [sourceId, signature] of turn.acknowledgedHeatSources) {
        if (currentSources.get(sourceId) !== signature) {
            blockers.push(`HEAT_SOURCE_ACKNOWLEDGEMENT_MISMATCH:${sourceId}`);
        }
    }
    return canonicalHeatContextBlockers(blockers);
}

function bindUnsupportedMekHeatContextV2(
    blockers: readonly string[],
    binding: Omit<Extract<MekHeatContextBindingV2, { readonly kind: 'unsupported' }>,
        'kind' | 'blockers' | 'capability'> = {},
): MekHeatRuntimeContextV2 {
    const bounded = canonicalHeatContextBlockers(blockers.length === 0
        ? ['INVALID_EMPTY_HEAT_CONTEXT_BLOCKERS']
        : blockers);
    const capability = Object.freeze({ kind: 'unsupported' as const, blockers: bounded });
    const context = Object.freeze({ kind: 'unsupported' as const });
    HEAT_CONTEXT_BINDINGS.set(context, Object.freeze({
        kind: 'unsupported',
        ...binding,
        blockers: bounded,
        capability,
    }));
    return context;
}

function canonicalHeatContextBlockers(blockers: readonly string[]): readonly string[] {
    const canonical = blockers.map((blocker, index) => {
        if (typeof blocker !== 'string' || !blocker.trim() || blocker.includes('\0')) {
            return `INVALID_HEAT_CONTEXT_BLOCKER:${index}`;
        }
        return blocker.trim().slice(0, 1_024);
    });
    const unique = [...new Set(canonical)];
    return Object.freeze(unique.length <= MAX_MEK_HEAT_CONTEXT_BLOCKERS_V2
        ? unique
        : [
            ...unique.slice(0, MAX_MEK_HEAT_CONTEXT_BLOCKERS_V2 - 1),
            `HEAT_CONTEXT_BLOCKERS_TRUNCATED:${unique.length - MAX_MEK_HEAT_CONTEXT_BLOCKERS_V2 + 1}`,
        ]);
}

function requireHeatContextBinding(context: MekHeatRuntimeContextV2): MekHeatContextBindingV2 {
    const binding = HEAT_CONTEXT_BINDINGS.get(context);
    if (!binding || binding.kind !== context.kind) {
        throw new Error('Mek heat context was not created by the canonical context factory');
    }
    return binding;
}

function heatContextMismatchBlockers(
    binding: MekHeatContextBindingV2,
    entity?: MekEntity,
): readonly string[] | null {
    return binding.boundEntity !== undefined
        && entity !== undefined
        && binding.boundEntity !== entity
        ? Object.freeze(['ENTITY_CONTEXT_MISMATCH: Mek heat context is bound to a different entity'])
        : null;
}

export function projectMekHeatV2(
    profile: MekHeatProfile,
    input: MekHeatKernelInputV2,
    policy: MekHeatAutomationPolicyV2,
): MekHeatProjectionV2 {
    const heat = canonicalizeMekHeatStateV2(input.heat);
    const turn = canonicalizeMekTurnStateV2(input.turn);
    const committedSources = buildCommittedHeatSources(profile, { ...input, heat, turn });
    const sources = policy === 'automatic'
        ? committedSources.filter(source => turn.acknowledgedHeatSources.get(source.id) !== mekHeatSourceSignatureV2(source))
        : [...committedSources];
    const cooling = committedCoolingCapacity(profile, input, heat.heatsinksOff);
    const capacity = cooling.capacity;
    const previouslyConsumedDissipation = turn.heatDissipationConsumed;
    const remainingDissipation = Math.max(0, capacity - previouslyConsumedDissipation);
    const deficit = Math.max(0, previouslyConsumedDissipation - capacity);
    if (deficit > 0) sources.push(Object.freeze({
        id: 'heat-dissipation-deficit',
        label: 'Dissipation',
        value: deficit,
    }));
    const generated = sources.reduce((total, source) => total + source.value, 0);
    const dissipated = Math.min(remainingDissipation, heat.current + generated);
    const projected = heat.current + generated - dissipated;
    const frozenSources = Object.freeze(sources.map(source => Object.freeze({ ...source })));
    const frozenCommitted = Object.freeze(committedSources.map(source => Object.freeze({ ...source })));
    const hasPendingResolution = frozenSources.some(source => source.value > 0) || projected !== heat.current;
    return Object.freeze({
        current: heat.current,
        sources: frozenSources,
        committedSources: frozenCommitted,
        capacity,
        underwaterBonus: cooling.underwaterBonus,
        previouslyConsumedDissipation,
        remainingDissipation,
        generated,
        dissipated,
        projected,
        delta: projected - heat.current,
        hasPendingResolution,
        hasPendingSettlement: heat.pendingOverride !== undefined || hasPendingResolution,
    });
}

/** Applies only the heat value explicitly selected by the user. */
export function applyPendingMekHeatV2(
    profile: MekHeatProfile,
    input: MekHeatKernelInputV2,
    policy: MekHeatAutomationPolicyV2,
): MekHeatApplicationV2 {
    const projection = projectMekHeatV2(profile, input, policy);
    const heat = canonicalizeMekHeatStateV2(input.heat);
    if (heat.pendingOverride === undefined) {
        return Object.freeze({ changed: false, heat, turn: input.turn, projection });
    }
    const nextHeat = canonicalizeMekHeatStateV2({
        current: heat.pendingOverride,
        previous: heat.current,
        heatsinksOff: heat.heatsinksOff,
    });
    if (policy === 'automatic') {
        return Object.freeze({ changed: true, heat: nextHeat, turn: input.turn, projection });
    }
    const consumed = Math.min(input.turn.heatDissipationConsumed, projection.capacity);
    const turn = consumed === input.turn.heatDissipationConsumed
        ? input.turn
        : canonicalizeMekTurnStateV2({ ...input.turn, heatDissipationConsumed: consumed });
    return Object.freeze({ changed: true, heat: nextHeat, turn, projection });
}

/** Resolves calculated heat only for automatic end-turn; manual mode owns only its selected value. */
export function resolveEndTurnMekHeatV2(
    profile: MekHeatProfile,
    input: MekHeatKernelInputV2,
    policy: MekHeatAutomationPolicyV2,
): MekHeatApplicationV2 {
    if (policy === 'manual') return applyPendingMekHeatV2(profile, input, policy);

    const projection = projectMekHeatV2(profile, input, policy);
    const heat = canonicalizeMekHeatStateV2(input.heat);
    if (!projection.hasPendingSettlement) {
        return Object.freeze({ changed: false, heat, turn: input.turn, projection });
    }
    const nextHeat = canonicalizeMekHeatStateV2({
        current: projection.projected,
        previous: heat.current,
        heatsinksOff: heat.heatsinksOff,
    });

    const acknowledged = new Map(input.turn.acknowledgedHeatSources);
    for (const source of projection.sources) {
        if (source.id !== 'heat-dissipation-deficit') acknowledged.set(source.id, mekHeatSourceSignatureV2(source));
    }
    const turnWithoutWeaponHeat = canonicalizeMekTurnStateV2({
        ...input.turn,
        weaponsHeat: 0,
        acknowledgedHeatSources: acknowledged,
        heatDissipationConsumed: Math.min(
            input.turn.heatDissipationConsumed,
            projection.capacity,
        ) + projection.dissipated,
    });
    const postSources = buildCommittedHeatSources(profile, {
        ...input,
        heat: nextHeat,
        turn: turnWithoutWeaponHeat,
    });
    const postById = new Map(postSources.map(source => [source.id, mekHeatSourceSignatureV2(source)]));
    const reconciledAcknowledgements = new ImmutableIndex([...turnWithoutWeaponHeat.acknowledgedHeatSources]
        .filter(([id, signature]) => postById.get(id) === signature));
    const turn = canonicalizeMekTurnStateV2({
        ...turnWithoutWeaponHeat,
        acknowledgedHeatSources: reconciledAcknowledgements,
    });
    return Object.freeze({ changed: true, heat: nextHeat, turn, projection });
}

export function buildMekHeatKernelInputV2(input: MekHeatKernelInputV2): MekHeatKernelInputV2 {
    if (!Number.isSafeInteger(input.standAttempts)
        || input.standAttempts < 0
        || input.standAttempts > MAX_MEK_MOVEMENT_MP_V2) {
        throw new Error('Invalid Mek stand-attempt heat input');
    }
    if (typeof input.water?.partiallyUnderwater !== 'boolean'
        || typeof input.water?.submerged !== 'boolean') {
        throw new Error('Invalid Mek water heat input');
    }
    return Object.freeze({
        ...input,
        heat: canonicalizeMekHeatStateV2(input.heat),
        turn: canonicalizeMekTurnStateV2(input.turn),
        movement: canonicalizeHeatMovement(input.movement),
        standAttempts: input.standAttempts,
        water: Object.freeze({ ...input.water }),
        committedUnavailableCriticalSlots: new ImmutableSet(input.committedUnavailableCriticalSlots),
        committedDestroyedCriticalSlots: new ImmutableSet(input.committedDestroyedCriticalSlots),
        previewUnavailableCriticalSlots: new ImmutableSet(input.previewUnavailableCriticalSlots),
        committedUnavailableComponents: new ImmutableSet(input.committedUnavailableComponents),
        activeEscalatingFailureComponents: new ImmutableSet(input.activeEscalatingFailureComponents),
        activeVibrobladeComponents: new ImmutableSet(input.activeVibrobladeComponents),
        activeStealthComponents: new ImmutableSet(input.activeStealthComponents),
        hasSelectedWeapon: input.hasSelectedWeapon === true,
        ppcCapacitors: Object.freeze(input.ppcCapacitors.map(entry => Object.freeze({ ...entry }))),
    });
}

function canonicalizeHeatMovement(
    value: MekMovementHeatInputV2 | null,
): MekMovementHeatInputV2 | null {
    if (value === null) return null;
    if (value === undefined || value === null || typeof value !== 'object'
        || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
        || Object.keys(value).some(key => key !== 'mode' && key !== 'distance')
        || !['stationary', 'walk', 'run', 'jump', 'UMU', 'VTOL'].includes(value.mode)
        || !Number.isSafeInteger(value.distance)
        || value.distance < 0
        || value.distance > MAX_MEK_MOVEMENT_MP_V2
        || (value.mode === 'stationary' && value.distance !== 0)) {
        throw new Error('Invalid Mek heat movement input');
    }
    return Object.freeze({ mode: value.mode, distance: value.distance });
}

function buildCommittedHeatSources(
    profile: MekHeatProfile,
    input: MekHeatKernelInputV2,
): MekHeatSourceV2[] {
    const movement = movementHeat(profile, input);
    const sources: MekHeatSourceV2[] = [Object.freeze({
        id: 'movement',
        label: 'Movement',
        value: movement,
        // Movement setters in V1 explicitly invalidate this source even when two choices produce
        // equal heat. Carry the complete choice/support witness into the signature in V2.
        signature: movementSignature(profile, input),
    })];
    const damagedEngineSlots = profile.engine.criticalSlotIds
        .filter(slotId => input.previewUnavailableCriticalSlots.has(slotId));
    if (!input.destroyed && !input.shutdown && damagedEngineSlots.length > 0) {
        sources.push(Object.freeze({
            id: 'damaged-engine',
            label: 'Damaged Engine',
            value: Math.min(
                profile.engine.maximumCriticalHeat,
                damagedEngineSlots.length * profile.engine.heatPerCriticalHit,
            ),
            signature: [...damagedEngineSlots].sort(compareText).join('|'),
        }));
    }
    if (input.turn.weaponsHeat > 0) sources.push(Object.freeze({
        id: 'weapons',
        label: 'Weapons',
        value: input.turn.weaponsHeat,
    }));
    for (const provider of profile.providers) {
        if (provider.kind === 'ppc-capacitor') {
            const lifecycle = input.ppcCapacitors.find(entry => entry.capacitorId === provider.componentId
                && entry.weaponId === provider.weaponId);
            if (input.destroyed || input.shutdown
                || !lifecycle?.chargeState
                || input.committedUnavailableComponents.has(provider.componentId)
                || input.committedUnavailableComponents.has(provider.weaponId)) continue;
            sources.push(Object.freeze({
                id: `ppc-capacitor:${provider.weaponId}`,
                label: 'PPC Capacitor',
                value: provider.heatWhileChargingOrCharged,
                ...(lifecycle.chargeState === 'charged'
                    ? { replacedByFiringEntryId: provider.weaponId }
                    : {}),
            }));
        } else if (provider.kind === 'viral-jammer') {
            if (input.destroyed || input.shutdown
                || input.committedUnavailableComponents.has(provider.componentId)
                || !input.activeEscalatingFailureComponents.has(provider.componentId)) continue;
            sources.push(Object.freeze({
                id: `risc-viral-jammer:${provider.componentId}`,
                label: 'RISC Viral Jammer',
                value: provider.heat,
            }));
        } else if (provider.kind === 'vibroblade') {
            if (input.destroyed || input.shutdown
                || !input.activeVibrobladeComponents.has(provider.componentId)) continue;
            sources.push(Object.freeze({
                id: `vibroblade:${provider.componentId}`,
                label: provider.label,
                value: provider.heat,
            }));
        } else if (provider.kind === 'stealth-system') {
            if (input.destroyed || input.shutdown
                || !input.activeStealthComponents.has(provider.componentId)) continue;
            sources.push(Object.freeze({
                id: `equipment:${provider.componentId}`,
                label: 'Equipment',
                value: provider.heat,
            }));
        } else if (provider.kind === 'coolant-system'
            && input.committedUnavailableComponents.has(provider.componentId)) {
            if (input.movement !== null && input.movement.mode !== 'stationary') sources.push(Object.freeze({
                id: `${provider.sourceId}:${provider.componentId}:movement`,
                label: provider.label,
                value: 1,
            }));
            if (input.turn.weaponsHeat > 0 || input.hasSelectedWeapon) sources.push(Object.freeze({
                id: `${provider.sourceId}:${provider.componentId}:weapons`,
                label: provider.label,
                value: 1,
            }));
        }
    }
    return sources;
}

function movementSignature(profile: MekHeatProfile, input: MekHeatKernelInputV2): string {
    const unavailableJump = profile.jump.componentIds
        .filter(componentId => input.committedUnavailableComponents.has(componentId));
    const unavailableScm = profile.superCooledMyomer.componentIds
        .filter(componentId => input.committedUnavailableComponents.has(componentId));
    const unavailableWingSlots = profile.partialWing?.criticalSlotIds
        .filter(slotId => input.committedUnavailableCriticalSlots.has(slotId)) ?? [];
    return JSON.stringify([
        input.movement?.mode ?? null,
        input.movement?.distance ?? null,
        input.standAttempts,
        unavailableJump,
        unavailableScm,
        unavailableWingSlots,
    ]);
}

function movementHeat(profile: MekHeatProfile, input: MekHeatKernelInputV2): number {
    const moveMode = input.movement?.mode;
    const standHeat = profile.heatPerStandAttempt * input.standAttempts;
    const scmActive = profile.superCooledMyomer.componentIds.length > 0
        && profile.superCooledMyomer.componentIds.some(
            componentId => !input.committedUnavailableComponents.has(componentId),
        );
    if (moveMode === 'stationary' || moveMode === 'walk' || moveMode === 'run') {
        return (scmActive ? 0 : profile.engine.movementHeatByMode[moveMode]) + standHeat;
    }
    if (moveMode !== 'jump') return standHeat;
    const destroyedWingCriticals = profile.partialWing?.criticalSlotIds
        .filter(slotId => input.committedUnavailableCriticalSlots.has(slotId)).length ?? 0;
    const wingReduction = profile.partialWing === undefined
        ? 0
        : Math.max(0, profile.partialWing.jumpHeatDistanceReduction - destroyedWingCriticals);
    const heatDistance = Math.max(0, (input.movement?.distance ?? 0) - wingReduction);
    const engineMultiplier = profile.engine.xxl ? 2 : 1;
    const workingJumpKind = profile.jump.componentIds.some(
        componentId => !input.committedUnavailableComponents.has(componentId),
    ) ? profile.jump.kind : 'standard';
    if (workingJumpKind === 'improved') {
        return Math.max(3, Math.ceil((heatDistance * engineMultiplier) / 2)) + standHeat;
    }
    const prototypeMultiplier = workingJumpKind === 'prototype-improved' ? 2 : 1;
    const multiplier = engineMultiplier * prototypeMultiplier;
    return Math.max(3 * multiplier, heatDistance * multiplier) + standHeat;
}

function committedCoolingCapacity(
    profile: MekHeatProfile,
    input: MekHeatKernelInputV2,
    heatsinksOff: number,
): { readonly capacity: number; readonly underwaterBonus: number } {
    let baseCapacity = profile.baseDissipation;
    let damagedHeatSinkCount = 0;
    for (const heatSink of profile.heatSinks) {
        if (heatSink.criticalSlotIds.some(slotId => input.committedDestroyedCriticalSlots.has(slotId))) {
            baseCapacity -= heatSink.dissipation;
            damagedHeatSinkCount += 1;
        }
    }
    baseCapacity -= heatsinksOff * profile.dissipationPerDisabledSink;
    baseCapacity = Math.max(0, baseCapacity);

    let underwaterBonus = 0;
    if (input.water.submerged) {
        underwaterBonus = Math.min(6, baseCapacity);
    } else if (input.water.partiallyUnderwater) {
        const functioningHeatSinkCount = Math.max(
            0,
            profile.declaredHeatSinkUnits - damagedHeatSinkCount - heatsinksOff,
        );
        underwaterBonus = Math.min(6, profile.heatSinks
            .filter(heatSink => heatSink.legMounted
                && !heatSink.criticalSlotIds.some(slotId =>
                    input.committedDestroyedCriticalSlots.has(slotId)))
            .sort((left, right) => right.dissipation - left.dissipation)
            .slice(0, functioningHeatSinkCount)
            .reduce((total, heatSink) => total + heatSink.dissipation, 0));
    }

    let capacity = baseCapacity + underwaterBonus;
    const destroyedScmCriticals = profile.superCooledMyomer.criticalSlotIds
        .filter(slotId => input.committedUnavailableCriticalSlots.has(slotId)).length;
    capacity -= destroyedScmCriticals * profile.superCooledMyomer.dissipationLossPerCriticalHit;
    capacity = Math.max(0, capacity);
    const radicalHeatSinkCount = profile.providers.filter(provider =>
        provider.kind === 'radical-heat-sink'
        && input.activeEscalatingFailureComponents.has(provider.componentId)
        && !input.committedUnavailableComponents.has(provider.componentId)).length;
    if (!input.destroyed && !input.shutdown && radicalHeatSinkCount > 0) {
        capacity += radicalHeatSinkCount * Math.max(
            0,
            profile.declaredHeatSinkUnits - damagedHeatSinkCount - heatsinksOff,
        );
    }
    if (profile.partialWing) {
        const destroyedWingCriticals = profile.partialWing.criticalSlotIds
            .filter(slotId => input.committedUnavailableCriticalSlots.has(slotId)).length;
        capacity += Math.max(
            0,
            profile.partialWing.dissipationBonus
                - destroyedWingCriticals * profile.partialWing.dissipationLossPerCriticalHit,
        );
    }
    return Object.freeze({ capacity, underwaterBonus });
}

export function mekHeatSourceSignatureV2(source: MekHeatSourceV2): string {
    return JSON.stringify([
        source.value,
        source.replacedByFiringEntryId ?? null,
        source.signature ?? null,
    ]);
}

function assertHeatValue(value: number, path: string): void {
    if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)
        || value < 0 || value > MAX_MEK_HEAT_VALUE_V2) {
        throw new Error(`${path} must be a canonical heat value`);
    }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
