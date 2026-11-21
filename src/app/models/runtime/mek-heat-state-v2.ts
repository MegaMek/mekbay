// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MekConvertedMode } from '../mek-conversion-mode';
import type { HeatAutomationPolicy } from './cbt-unit-runtime';
import { endTurnHeat, endTurnHeatStepForPolicy } from './end-turn-heat-selection';

import { isObjectLiteralRecord } from '../../utils/json-value.util';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import type { ComponentId,CriticalSlotId } from '../entity/entity-identifiers';
import { ImmutableSet } from '../entity/immutable-collections';
import { MAX_OUTSIDE_HEAT_PER_TURN } from '../rules/inferno-rules';
import type { UnitWaterState } from '../unit-cover.model';
import { mekJumpHeat, wholeJumpJetMp } from '../jump-equipment.model';
import { isHeatOffset,isHeatValue,settleHeat,type CBTUnitHeatState } from './cbt-unit-runtime';
import { compileMekHeatProfile,evaluateMekHeatScenarioSupport,type MekHeatProfile,type MekHeatScenarioInput } from './mek-heat-profile';
import { MAX_MEK_MOVEMENT_MP_V2,type MekMovementHeatInputV2 } from './mek-movement-psr-v2';
import type { MekRuntimeIndex } from './mek-runtime-index';
import type { ComponentRuntimeState } from './runtime-state';
import { POWER_DISABLED_MODE } from './component-electronic-suite';
import { isPrototypeDoubleHeatSinkEquipment } from '../heat-equipment.model';
import { canonicalizeMekTurnStateV2,type MekTurnStateV2 } from './mek-turn-state-v2';
import {
    COMPONENT_HEAT_SOURCE_KINDS,
    componentHeatSourceId,
    HEAT_DISSIPATION_DEFICIT_ID,
    projectTurnHeat,
    settleTurnHeatLedger,
    type TurnHeatLedger,
} from './turn-heat-ledger';

export const MAX_MEK_HEATSINKS_OFF_V2 = 1_000;
export const MAX_MEK_HEAT_CONTEXT_BLOCKERS_V2 = 64;
export const EQUIPMENT_HEAT_SOURCE_GROUP = 'Equipment';

/** Durable heat track. The turn's settled heat (`TurnHeatLedger`) stays in MekTurnStateV2. */
export type MekHeatStateV2 = CBTUnitHeatState;

export interface MekHeatSourceV2 {
    readonly id: string;
    readonly label: string;
    readonly value: number;
    /** Optional label used to combine sources only in compact presentations. */
    readonly group?: string;
    readonly replacedByFiringEntryId?: ComponentId;
}

export interface MekHeatProjectionV2 {
    readonly current: number;
    /** Sources that still require settlement, including a synthetic cooling deficit. */
    readonly sources: readonly MekHeatSourceV2[];
    /** All current rule sources, before the heat settled this turn is taken off. */
    readonly committedSources: readonly MekHeatSourceV2[];
    readonly capacity: number;
    readonly underwaterBonus: number;
    readonly disabledSinkUnits: number;
    /** The turn's settled heat and booked dissipation this projection counts from. */
    readonly ledger: TurnHeatLedger;
    /** Cooling left this turn; negative by the heat sinks lost after APPLY HEAT booked them. */
    readonly dissipationBalance: number;
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
    /** Outside heat this turn as play reads it, committed and pending together (`outsideHeatThisTurn`). */
    readonly outsideHeat: number;
    readonly movement: MekMovementHeatInputV2 | null;
    readonly standAttempts: number;
    /** The mode a LAM or QuadVee has converted to; absent in BattleMech mode. */
    readonly conversionMode?: MekConvertedMode;
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
    /** The one effective Nova CEWS mount; pending shutdown remains active this turn. */
    readonly activeElectronicComponents: ReadonlySet<ComponentId>;
    /** Mobile HPG mounts currently charging or transmitting. */
    readonly activeMobileHpgComponents: ReadonlySet<ComponentId>;
    /** A consumed Coolant Pod adds 1 cooling per active heat sink of any type this turn (TO:AUE p. 116). */
    readonly activeCoolantPodComponents: ReadonlySet<ComponentId>;
    readonly disabledPrototypeHeatSinks: ReadonlySet<ComponentId>;
    readonly ppcCapacitors: readonly {
        readonly capacitorId: ComponentId;
        readonly weaponId: ComponentId;
        readonly chargeState: 'charging' | 'charged' | null;
    }[];
}

/** Minimal detached facts needed by the movement-heat rules kernel. */
export interface MekMovementHeatFactsV2 {
    readonly movement: MekMovementHeatInputV2 | null;
    readonly standAttempts: number;
    readonly airborne: boolean;
    readonly conversionMode?: MekConvertedMode;
    readonly committedUnavailableCriticalSlots: ReadonlySet<CriticalSlotId>;
    readonly committedUnavailableComponents: ReadonlySet<ComponentId>;
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

/**
 * Legacy saves counted prototype double heat sinks in the bulk heat-sink switch, which on a mixed design now covers
 * only the other sinks. Returns the bulk count to keep, switching the rest off on prototype doubles one by one, and how
 * many of those could not be switched off because no prototype double is left on.
 */
export function splitLegacyHeatsinksOff(
    entity: MekEntity,
    index: MekRuntimeIndex,
    components: Map<ComponentId, ComponentRuntimeState>,
    heatsinksOff: number,
): { readonly heatsinksOff: number; readonly unrepresented: number } {
    const bulk = Math.min(heatsinksOff, entity.bulkHeatSinkCount());
    let rest = heatsinksOff - bulk;
    for (const [componentId, component] of index.components) {
        if (rest === 0) break;
        if (component.kind !== 'equipment' || !isPrototypeDoubleHeatSinkEquipment(component.mount.equipment)) continue;
        const current = components.get(componentId) ?? {};
        if (current.mode === POWER_DISABLED_MODE) continue;
        components.set(componentId, Object.freeze({ ...current, mode: POWER_DISABLED_MODE }));
        rest--;
    }
    return { heatsinksOff: bulk, unrepresented: rest };
}

export function canonicalizeMekHeatStateV2(value: MekHeatStateV2): MekHeatStateV2 {
    if (!isObjectLiteralRecord(value)) throw new Error('Heat state must be a plain object');
    const keys = Object.keys(value);
    const allowed = new Set(['current', 'previous', 'pendingOverride', 'pendingOffset', 'heatsinksOff', 'heatsinksOffNext']);
    if (keys.some(key => !allowed.has(key))) throw new Error('Heat state contains an unknown field');
    if (!keys.includes('current') || !keys.includes('previous') || !keys.includes('heatsinksOff')) {
        throw new Error('Heat state is missing a required field');
    }
    assertHeatValue(value.current, '$.current');
    assertHeatValue(value.previous, '$.previous');
    if (value.pendingOverride !== undefined) assertHeatValue(value.pendingOverride, '$.pendingOverride');
    if (value.pendingOffset !== undefined && (value.pendingOverride === undefined || !isHeatOffset(value.pendingOffset))) {
        throw new Error('$.pendingOffset must be a bounded whole number beside NEXT');
    }
    if (!Number.isSafeInteger(value.heatsinksOff)
        || value.heatsinksOff < 0
        || value.heatsinksOff > MAX_MEK_HEATSINKS_OFF_V2) {
        throw new Error('$.heatsinksOff must be a bounded non-negative integer');
    }
    if (value.heatsinksOffNext !== undefined && (!Number.isSafeInteger(value.heatsinksOffNext)
        || value.heatsinksOffNext < 0 || value.heatsinksOffNext > MAX_MEK_HEATSINKS_OFF_V2
        || value.heatsinksOffNext === value.heatsinksOff)) {
        throw new Error('$.heatsinksOffNext must be a bounded non-negative integer that changes the switch');
    }
    return Object.freeze({
        current: value.current,
        previous: value.previous,
        ...(value.pendingOverride === undefined ? {} : { pendingOverride: value.pendingOverride }),
        ...(value.pendingOffset === undefined ? {} : { pendingOffset: value.pendingOffset }),
        heatsinksOff: value.heatsinksOff,
        ...(value.heatsinksOffNext === undefined ? {} : { heatsinksOffNext: value.heatsinksOffNext }),
    });
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
        maxHeatsinksOff: profileResult.profile.bulkHeatSinkUnits,
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
): MekHeatProjectionResultV2 {
    const binding = requireHeatContextBinding(context);
    const mismatch = heatContextMismatchBlockers(binding, entity);
    if (mismatch !== null) return Object.freeze({ kind: 'unsupported', blockers: mismatch });
    if (binding.kind === 'unsupported') return binding.capability;
    return Object.freeze({
        kind: 'supported',
        projection: projectMekHeatV2(binding.profile, input),
    });
}

export type MekHeatApplicationResultV2 =
    | { readonly kind: 'supported'; readonly application: MekHeatApplicationV2 }
    | { readonly kind: 'unsupported'; readonly blockers: readonly string[] };

export function applyPendingMekHeatContextV2(
    context: MekHeatRuntimeContextV2,
    entity: MekEntity,
    input: MekHeatKernelInputV2,
): MekHeatApplicationResultV2 {
    const binding = requireHeatContextBinding(context);
    const mismatch = heatContextMismatchBlockers(binding, entity);
    if (mismatch !== null) return Object.freeze({ kind: 'unsupported', blockers: mismatch });
    if (binding.kind === 'unsupported') return binding.capability;
    return Object.freeze({
        kind: 'supported',
        application: applyPendingMekHeatV2(binding.profile, input),
    });
}

export function resolveEndTurnMekHeatContextV2(
    context: MekHeatRuntimeContextV2,
    entity: MekEntity,
    input: MekHeatKernelInputV2,
    policy: HeatAutomationPolicy,
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
    // Booked dissipation above what the unit can cool now (sinks lost, a refit) comes back as heat (`projectTurnHeat`).
    const heat = canonicalizeMekHeatStateV2(input.heat);
    for (const off of [heat.heatsinksOff, heat.heatsinksOffNext ?? 0]) {
        if (off > binding.profile.bulkHeatSinkUnits) {
            blockers.push(`HEATSINKS_OFF_EXCEEDS_PROFILE:${off}/${binding.profile.bulkHeatSinkUnits}`);
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

/** Heat sources named for one of the unit's components: `<prefix><componentId>`. */
type CoolantHeatSourceKind = Extract<MekHeatProfile['providers'][number], { kind: 'coolant-system' }>['sourceId'];
/** Coolant sources also name the heat they cool: `<kind>:<componentId>:movement` or `:weapons`. */
const COOLANT_HEAT_SOURCE_KINDS = Object.keys({
    'radical-heat-sink': true,
    'risc-emergency-coolant': true,
} satisfies Record<CoolantHeatSourceKind, true>);

/**
 * A heat source id with the component it names mapped through `component`: ids naming no component come back as they
 * are, and null when a coolant id names no cooled heat.
 */
export function rekeyMekHeatSourceId(sourceId: string, component: (componentId: string) => string): string | null {
    const prefix = COMPONENT_HEAT_SOURCE_KINDS.map(kind => `${kind}:`).find(candidate => sourceId.startsWith(candidate));
    if (prefix) return prefix + component(sourceId.slice(prefix.length));
    const coolant = COOLANT_HEAT_SOURCE_KINDS.map(kind => `${kind}:`).find(candidate => sourceId.startsWith(candidate));
    if (!coolant) return sourceId;
    const suffix = [':movement', ':weapons'].find(candidate => sourceId.endsWith(candidate));
    return suffix === undefined
        ? null
        : coolant + component(sourceId.slice(coolant.length, -suffix.length)) + suffix;
}

/**
 * A map keyed by heat source with each key re-keyed through `component` (`rekeyMekHeatSourceId`); null when no key
 * moves. Ids may shift or swap. A source that keeps its id is placed first, so none is displaced by another moved
 * onto it; a source landing on a taken id keeps its saved id, and is dropped only when that is taken too.
 */
export function rekeyMekHeatSourceMap<V>(
    sources: ReadonlyMap<string, V>,
    component: (componentId: string) => string,
): Map<string, V> | null {
    const entries = [...sources].map(([sourceId, value]) =>
        [sourceId, rekeyMekHeatSourceId(sourceId, component) ?? sourceId, value] as const);
    if (entries.every(([sourceId, target]) => sourceId === target)) return null;
    const rekeyed = new Map<string, V>();
    for (const [sourceId, target, value] of [
        ...entries.filter(([sourceId, target]) => sourceId === target),
        ...entries.filter(([sourceId, target]) => sourceId !== target),
    ]) {
        const key = rekeyed.has(target) ? sourceId : target;
        if (!rekeyed.has(key)) rekeyed.set(key, value);
    }
    return rekeyed;
}

export function projectMekHeatV2(
    profile: MekHeatProfile,
    input: MekHeatKernelInputV2,
): MekHeatProjectionV2 {
    const heat = canonicalizeMekHeatStateV2(input.heat);
    const turn = canonicalizeMekTurnStateV2(input.turn);
    const committedSources = buildCommittedHeatSources(profile, { ...input, heat, turn });
    const cooling = committedCoolingCapacity(profile, input, heat.heatsinksOff);
    const capacity = cooling.capacity;
    // Heat settled earlier this turn (APPLY HEAT) never counts again; sources count only what they add since.
    const ledger = projectTurnHeat(heat.current, committedSources, capacity, turn);
    const sources = [...ledger.sources];
    if (ledger.deficit > 0) sources.push(Object.freeze({
        id: HEAT_DISSIPATION_DEFICIT_ID,
        label: 'Dissipation',
        value: ledger.deficit,
    }));
    const remainingDissipation = ledger.remaining;
    const { generated, dissipated, projected } = ledger;
    const frozenSources = Object.freeze(sources.map(source => Object.freeze({ ...source })));
    const frozenCommitted = Object.freeze(committedSources.map(source => Object.freeze({ ...source })));
    const hasPendingResolution = frozenSources.some(source => source.value > 0) || projected !== heat.current;
    return Object.freeze({
        current: heat.current,
        sources: frozenSources,
        committedSources: frozenCommitted,
        capacity,
        underwaterBonus: cooling.underwaterBonus,
        disabledSinkUnits: cooling.disabledSinkUnits,
        ledger: Object.freeze({
            settledHeat: turn.settledHeat,
            ...(turn.heatDissipationConsumed === undefined ? {} : { heatDissipationConsumed: turn.heatDissipationConsumed }),
        }),
        dissipationBalance: ledger.remaining - ledger.deficit,
        remainingDissipation,
        generated,
        dissipated,
        projected,
        delta: projected - heat.current,
        hasPendingResolution,
        hasPendingSettlement: heat.pendingOverride !== undefined || hasPendingResolution,
    });
}

/**
 * APPLY HEAT: the player's arrow (NEXT) is their heat for the turn, so it becomes the unit's heat and settles the turn
 * so far; heat generated afterwards adds at End Turn. Aerospace units apply it the same way.
 */
export function applyPendingMekHeatV2(
    profile: MekHeatProfile,
    input: MekHeatKernelInputV2,
): MekHeatApplicationV2 {
    const projection = projectMekHeatV2(profile, input);
    const heat = canonicalizeMekHeatStateV2(input.heat);
    if (heat.pendingOverride === undefined) {
        return Object.freeze({ changed: false, heat, turn: input.turn, projection });
    }
    return settleMekTurnHeat(input, projection, heat.pendingOverride);
}

/**
 * End Turn's heat step (`endTurnHeat`, the same for every unit): the player's arrow whenever one is set; without one,
 * automatic resolution settles the calculated heat and manual resolution leaves it alone.
 */
export function resolveEndTurnMekHeatV2(
    profile: MekHeatProfile,
    input: MekHeatKernelInputV2,
    policy: HeatAutomationPolicy,
): MekHeatApplicationV2 {
    const projection = projectMekHeatV2(profile, input);
    const heat = canonicalizeMekHeatStateV2(input.heat);
    if (heat.pendingOverride === undefined && (policy === 'manual' || !projection.hasPendingSettlement)) {
        return Object.freeze({ changed: false, heat, turn: input.turn, projection });
    }
    return settleMekTurnHeat(input, projection, endTurnHeat(endTurnHeatStepForPolicy(policy), heat, projection.projected));
}

/**
 * Settles the turn's heat at `value`: every source's heat so far is settled and the dissipation the projection used is
 * booked (`settleTurnHeatLedger`), so heat generated afterwards counts on its own against the heat sinks left over.
 */
function settleMekTurnHeat(
    input: MekHeatKernelInputV2,
    projection: MekHeatProjectionV2,
    value: number,
): MekHeatApplicationV2 {
    const nextHeat = canonicalizeMekHeatStateV2(settleHeat(canonicalizeMekHeatStateV2(input.heat), value));
    const turn = canonicalizeMekTurnStateV2({
        ...input.turn,
        ...settleTurnHeatLedger(input.turn, projection.capacity, projection.committedSources, projection.dissipated),
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
    if (!Number.isSafeInteger(input.outsideHeat) || input.outsideHeat < 0 || input.outsideHeat > MAX_OUTSIDE_HEAT_PER_TURN) {
        throw new Error('Invalid Mek outside heat input');
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
        activeElectronicComponents: new ImmutableSet(input.activeElectronicComponents),
        activeMobileHpgComponents: new ImmutableSet(input.activeMobileHpgComponents),
        activeCoolantPodComponents: new ImmutableSet(input.activeCoolantPodComponents),
        disabledPrototypeHeatSinks: new ImmutableSet(input.disabledPrototypeHeatSinks),
        ppcCapacitors: Object.freeze(input.ppcCapacitors.map(entry => Object.freeze({ ...entry }))),
    });
}

function canonicalizeHeatMovement(
    value: MekMovementHeatInputV2 | null,
): MekMovementHeatInputV2 | null {
    if (value === null) return null;
    if (value === undefined || value === null || typeof value !== 'object'
        || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
        || Object.keys(value).some(key => key !== 'mode' && key !== 'distance' && key !== 'jumpJetsFired')
        || !['stationary', 'walk', 'run', 'sprint', 'jump', 'UMU', 'VTOL', 'tracked'].includes(value.mode)
        || !Number.isSafeInteger(value.distance)
        || value.distance < 0
        || value.distance > MAX_MEK_MOVEMENT_MP_V2
        || (value.jumpJetsFired !== undefined && (value.mode !== 'jump' || !Number.isSafeInteger(value.jumpJetsFired) || value.jumpJetsFired < 0))
        || (value.mode === 'stationary' && value.distance !== 0)) {
        throw new Error('Invalid Mek heat movement input');
    }
    return Object.freeze({ ...value });
}

function buildCommittedHeatSources(
    profile: MekHeatProfile,
    input: MekHeatKernelInputV2,
): MekHeatSourceV2[] {
    const movement = projectMekMovementHeatV2(profile, {
        movement: input.movement,
        standAttempts: input.standAttempts,
        airborne: input.turn.airborne === true,
        ...(input.conversionMode === undefined ? {} : { conversionMode: input.conversionMode }),
        committedUnavailableCriticalSlots: input.committedUnavailableCriticalSlots,
        committedUnavailableComponents: input.committedUnavailableComponents,
    });
    const sources: MekHeatSourceV2[] = [Object.freeze({
        id: 'movement',
        label: 'Movement',
        value: movement,
    })];
    const damagedEngineSlots = profile.engine.criticalSlotIds
        .filter(slotId => input.previewUnavailableCriticalSlots.has(slotId));
    if (profile.engine.fusion
        && !input.destroyed && !input.shutdown && damagedEngineSlots.length > 0) {
        sources.push(Object.freeze({
            id: 'damaged-engine',
            label: 'Damaged Engine',
            value: Math.min(
                profile.engine.maximumCriticalHeat,
                damagedEngineSlots.length * profile.engine.heatPerCriticalHit,
            ),
        }));
    }
    if (input.turn.weaponsHeat > 0) sources.push(Object.freeze({
        id: 'weapons',
        label: 'Weapons',
        value: input.turn.weaponsHeat,
    }));
    if (input.outsideHeat > 0) sources.push(Object.freeze({
        id: 'outside-heat',
        label: 'Outside Heat',
        value: input.outsideHeat,
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
                id: componentHeatSourceId('ppc-capacitor', provider.weaponId),
                label: 'PPC Capacitor',
                value: provider.heatWhileChargingOrCharged,
                group: EQUIPMENT_HEAT_SOURCE_GROUP,
                ...(lifecycle.chargeState === 'charged'
                    ? { replacedByFiringEntryId: provider.weaponId }
                    : {}),
            }));
        } else if (provider.kind === 'viral-jammer') {
            if (input.destroyed || input.shutdown
                || input.committedUnavailableComponents.has(provider.componentId)
                || !input.activeEscalatingFailureComponents.has(provider.componentId)) continue;
            sources.push(Object.freeze({
                id: componentHeatSourceId('risc-viral-jammer', provider.componentId),
                label: 'RISC Viral Jammer',
                value: provider.heat,
                group: EQUIPMENT_HEAT_SOURCE_GROUP,
            }));
        } else if (provider.kind === 'vibroblade') {
            if (input.destroyed || input.shutdown
                || !input.activeVibrobladeComponents.has(provider.componentId)) continue;
            sources.push(Object.freeze({
                id: componentHeatSourceId('vibroblade', provider.componentId),
                label: provider.label,
                value: provider.heat,
            }));
        } else if (provider.kind === 'stealth-system') {
            if (input.destroyed || input.shutdown
                || !input.activeStealthComponents.has(provider.componentId)) continue;
            sources.push(Object.freeze({
                id: componentHeatSourceId('equipment', provider.componentId),
                label: provider.label,
                value: provider.heat,
                group: EQUIPMENT_HEAT_SOURCE_GROUP,
            }));
        } else if (provider.kind === 'nova-cews') {
            if (input.destroyed || input.shutdown
                || input.committedUnavailableComponents.has(provider.componentId)
                || !input.activeElectronicComponents.has(provider.componentId)) continue;
            sources.push(Object.freeze({
                id: componentHeatSourceId('nova-cews', provider.componentId),
                label: 'Nova CEWS',
                value: provider.heat,
                group: EQUIPMENT_HEAT_SOURCE_GROUP,
            }));
        } else if (provider.kind === 'mobile-hpg') {
            if (input.destroyed || input.shutdown
                || input.committedUnavailableComponents.has(provider.componentId)
                || !input.activeMobileHpgComponents.has(provider.componentId)) continue;
            sources.push(Object.freeze({
                id: componentHeatSourceId('mobile-hpg', provider.componentId),
                label: 'Mobile HPG',
                value: provider.heat,
                group: EQUIPMENT_HEAT_SOURCE_GROUP,
            }));
        } else if (provider.kind === 'coolant-system'
            && input.committedUnavailableComponents.has(provider.componentId)) {
            if (input.movement !== null && input.movement.mode !== 'stationary') sources.push(Object.freeze({
                id: `${provider.sourceId}:${provider.componentId}:movement`,
                label: provider.label,
                value: 1,
                group: EQUIPMENT_HEAT_SOURCE_GROUP,
            }));
            if (input.turn.weaponsHeat > 0) sources.push(Object.freeze({
                id: `${provider.sourceId}:${provider.componentId}:weapons`,
                label: provider.label,
                value: 1,
                group: EQUIPMENT_HEAT_SOURCE_GROUP,
            }));
        }
    }
    return sources;
}

export function projectMekMovementHeatV2(
    profile: MekHeatProfile,
    input: MekMovementHeatFactsV2,
): number {
    // TW p. 143: tracked movement generates heat as walking does, none on an ICE-equipped Mek.
    const moveMode = input.movement?.mode === 'tracked' ? 'walk' : input.movement?.mode;
    const standHeat = profile.heatPerStandAttempt * input.standAttempts;
    // IO:AE p. 107: a LAM in Fighter mode generates heat as an aerospace fighter, whose thrust generates none.
    if (input.conversionMode === 'fighter') return standHeat;
    const scmActive = profile.superCooledMyomer.componentIds.length > 0
        && profile.superCooledMyomer.componentIds.some(
            componentId => !input.committedUnavailableComponents.has(componentId),
        );
    if (moveMode === 'stationary' || moveMode === 'walk' || moveMode === 'run' || moveMode === 'sprint') {
        if (profile.engine.heatlessIndustrialGroundMovement && moveMode !== 'stationary') {
            return standHeat;
        }
        if (input.conversionMode === 'airmek' && input.airborne && moveMode !== 'stationary') {
            return Math.round(jumpMovementHeat(profile, input) / 3) + standHeat;
        }
        return (scmActive ? 0 : profile.engine.movementHeatByMode[moveMode]) + standHeat;
    }
    if (moveMode === 'UMU') return profile.engine.movementHeatByMode.UMU + standHeat;
    if (moveMode !== 'jump') return standHeat;
    return jumpMovementHeat(profile, input) + standHeat;
}

function jumpMovementHeat(profile: MekHeatProfile, input: MekMovementHeatFactsV2): number {
    const workingJumpJets = profile.jump.jets.filter(
        jet => !input.committedUnavailableComponents.has(jet.componentId),
    );
    const workingJumpBooster = profile.jump.boosterComponentIds.some(
        componentId => !input.committedUnavailableComponents.has(componentId),
    );
    // MegaMek chooses conventional jets on dual-system Meks; a booster-only
    // jump is the one heatless path.
    if (input.movement?.jumpJetsFired === undefined && workingJumpBooster && wholeJumpJetMp(workingJumpJets) === 0) return 0;
    const destroyedWingCriticals = profile.partialWing?.criticalSlotIds
        .filter(slotId => input.committedUnavailableCriticalSlots.has(slotId)).length ?? 0;
    const wingReduction = profile.partialWing === undefined
        ? 0
        : Math.max(0, profile.partialWing.jumpHeatDistanceReduction - destroyedWingCriticals);
    const heatDistance = Math.max(0, (input.movement?.distance ?? 0) - wingReduction);
    const workingJumpKind = (workingJumpJets.length > 0 || input.movement?.jumpJetsFired !== undefined) && profile.jump.kind !== 'none' ? profile.jump.kind : 'standard';
    return mekJumpHeat(profile.engine.jumpHeat, workingJumpKind, heatDistance,
        workingJumpJets.map(jet => jet.mpContribution), input.movement?.jumpJetsFired);
}

function committedCoolingCapacity(
    profile: MekHeatProfile,
    input: MekHeatKernelInputV2,
    heatsinksOff: number,
): { readonly capacity: number; readonly underwaterBonus: number; readonly disabledSinkUnits: number } {
    let baseCapacity = 0;
    let functioningHeatSinkCount = 0;
    let submergedCapacity = 0;
    let remainingOff = heatsinksOff;
    let disabledSinkUnits = 0;
    // IO:AE p. 88. Each damaged super-cooled myomer slot takes one surviving sink out of service.
    let myomerLoss = profile.superCooledMyomer.criticalSlotIds
        .filter(slotId => input.committedUnavailableCriticalSlots.has(slotId)).length;
    // The bulk switch leaves leg sinks on as long as possible, as the sheet's anonymous pips always have.
    for (const heatSink of profile.heatSinks) {
        if (heatSink.criticalSlotIds.some(slotId => input.committedDestroyedCriticalSlots.has(slotId))) continue;
        const lost = Math.min(myomerLoss, heatSink.units);
        myomerLoss -= lost;
        const surviving = heatSink.units - lost;
        const individuallyOff = heatSink.prototype && input.disabledPrototypeHeatSinks.has(heatSink.componentId);
        const inBulk = !heatSink.prototype || profile.bulkHeatSinkUnits === profile.declaredHeatSinkUnits;
        const bulkOff = inBulk && !individuallyOff ? Math.min(remainingOff, surviving) : 0;
        const disabled = individuallyOff ? surviving : bulkOff;
        remainingOff -= bulkOff;
        disabledSinkUnits += disabled;
        const active = surviving - disabled;
        const cooling = active * heatSink.dissipationPerUnit;
        baseCapacity += cooling;
        functioningHeatSinkCount += active;
        if (input.water.submerged || input.water.partiallyUnderwater && heatSink.legMounted) submergedCapacity += cooling;
    }
    const underwaterBonus = Math.min(6, submergedCapacity);

    let capacity = baseCapacity + underwaterBonus;
    const radicalHeatSinkCount = profile.providers.filter(provider =>
        provider.kind === 'radical-heat-sink'
        && input.activeEscalatingFailureComponents.has(provider.componentId)
        && !input.committedUnavailableComponents.has(provider.componentId)).length;
    if (!input.destroyed && !input.shutdown && radicalHeatSinkCount > 0) {
        capacity += radicalHeatSinkCount * functioningHeatSinkCount;
    }
    if (!input.destroyed && !input.shutdown
        && input.activeCoolantPodComponents.size > 0
        && radicalHeatSinkCount === 0
        && [...input.activeCoolantPodComponents].some(componentId =>
            !input.committedUnavailableComponents.has(componentId))) {
        capacity += functioningHeatSinkCount;
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
    return Object.freeze({ capacity, underwaterBonus, disabledSinkUnits });
}

function assertHeatValue(value: number, path: string): void {
    if (!isHeatValue(value)) throw new Error(`${path} must be a canonical heat value`);
}
