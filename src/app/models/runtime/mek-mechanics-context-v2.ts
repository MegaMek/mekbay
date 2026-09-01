// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { compareText } from '../../utils/string.util';
import type {
    MekMechanicsProfile,
    MekMechanicsProfileBlocker,
    MekMechanicsScenarioBlocker,
    MekMechanicsScenarioRules,
} from './mek-mechanics-profile';
import {
    compileMekMechanicsProfile,
    evaluateMekMechanicsScenarioSupport,
} from './mek-mechanics-profile';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import type { ComponentId, CrewPositionId } from '../entity/entity-identifiers';
import type { MekRuntimeIndex } from './mek-runtime-index';
import { type CrewRuntimeState } from './runtime-state';
import { isCrewDeathCommitted } from './cbt-unit-runtime';
import type { CrewAssignment } from './crew-assignment';
import type { C3NetworkType, C3Role } from '../c3-network.model';
import {
    adjustMekStandAttemptsV2,
    declareMekActionV2,
    declareMekMovementV2,
    prepareMekStandUpV2,
    projectMekBattleValueMovementV2,
    projectMekMovementPsrV2,
    projectMekPilotChecksV2,
    reconcileMekPilotChecksV2,
    resolveMekPilotCheckV2,
    resolveMekStandAttemptV2,
    synthesizeCommittedMekDamagePilotChecksV2,
    type MekActionDeclarationV2,
    type MekBattleValueMovementProjectionV2,
    type MekCommittedDamageMutationV2,
    type MekCommittedDamagePilotCheckSynthesisResultV2,
    type MekMovementDeclarationV2,
    type MekMovementPsrProjectionResultV2,
    type MekMovementPsrRuntimeFactsV2,
    type MekMovementPsrStateV2,
    type MekMovementStateTransitionV2,
    type MekPilotCheckDiceEvidenceV2,
    type MekPilotCheckResolutionResultV2,
    type MekPilotCheckV2,
    type MekStandAttemptResolutionV2,
} from './mek-movement-psr-v2';
import {
    projectMekDestructionStateV2,
    mekRuleCheckTriggerConflictV2,
    reconcileMekRuleChecksV2,
    resolveMekRuleCheckV2,
    type MekDamageStateViewV2,
    type MekDestructionFactsV2,
    type MekRuleCheckKeyV2,
    type MekRuleCheckOutcomeV2,
    type MekRuleChecksV2,
    type MekRuleCheckTokenV2,
} from './mek-destruction-state-v2';
import {
    projectMekPhysicalAttacksV2,
    type MekPhysicalAttackProjectionResultV2,
    type MekPhysicalAttackRuntimeFactsV2,
} from './mek-physical-attack-v2';
import {
    projectMekShieldsV2,
    type MekShieldProjectionV2,
    type MekShieldRuntimeFactsV2,
    type MekShieldTrack,
} from './mek-shield-rules';
import {
    projectMekCombatModifiers,
    type MekCombatModifierProjectionResult,
} from './mek-combat-modifiers';

export type MekMechanicsContextBlockerV2 =
    | {
        readonly source: 'profile';
        readonly blocker: MekMechanicsProfileBlocker;
    }
    | {
        readonly source: 'scenario';
        readonly blocker: MekMechanicsScenarioBlocker;
    }
    | {
        readonly source: 'runtime';
        readonly code: 'UNBOUND_CONTEXT' | 'ENTITY_CONTEXT_MISMATCH';
        readonly message: string;
    }
    ;

export type MekMechanicsContextCapabilityV2 =
    | { readonly kind: 'supported' }
    | {
        readonly kind: 'unsupported';
        readonly blockers: readonly MekMechanicsContextBlockerV2[];
    };

/**
 * The complete C3 fact surface allowed to leave the opaque mechanics context.
 * Slot topology, equipment definitions, the compiled profile, and the
 * emergency endpoint's future activated role remain private.
 */
export interface MekC3EndpointCapabilityV2 {
    readonly componentId: ComponentId;
    readonly family: C3NetworkType;
    /** Emergency masters are projected in their structural standby slave role. */
    readonly role: C3Role;
    readonly boosted: boolean;
    readonly emergency: boolean;
}

export type MekC3EndpointCapabilitiesResultV2 =
    | {
        readonly kind: 'supported';
        readonly endpoints: readonly MekC3EndpointCapabilityV2[];
    }
    | Extract<MekMechanicsContextCapabilityV2, { readonly kind: 'unsupported' }>;

/**
 * Opaque immutable binding for one Mek entity and its scenario rules.
 * Profile/rules/blocker ownership is module-private so query callers
 * cannot turn the compiler profile into a second public mechanics surface.
 */
export interface MekMechanicsContextV2 {
    readonly kind: 'supported' | 'unsupported';
}

type MekMechanicsContextBindingV2 =
    | {
        readonly kind: 'supported';
        readonly profile: MekMechanicsProfile;
        readonly rules: MekMechanicsScenarioRules;
        readonly boundEntity: MekEntity;
        readonly index: MekRuntimeIndex;
        readonly capability: Extract<MekMechanicsContextCapabilityV2, { readonly kind: 'supported' }>;
    }
    | {
        readonly kind: 'unsupported';
        readonly blockers: readonly MekMechanicsContextBlockerV2[];
        readonly boundEntity?: MekEntity;
        readonly capability: Extract<MekMechanicsContextCapabilityV2, { readonly kind: 'unsupported' }>;
    };

const CONTEXT_BINDINGS = new WeakMap<object, MekMechanicsContextBindingV2>();

/** Bind profile and scenario compilation outcomes without exposing either authority. */
export function createMekMechanicsContextV2(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    scenario: unknown,
): MekMechanicsContextV2 {
    // Compile here so callers cannot pair a valid entity witness with a
    // handcrafted profile compiled from another entity.
    const profileResult = compileMekMechanicsProfile(entity, index, ruleset);
    const scenarioResult = evaluateMekMechanicsScenarioSupport(scenario);
    const blockers: MekMechanicsContextBlockerV2[] = [];
    if (profileResult.kind === 'unsupported') {
        blockers.push(...profileResult.blockers.map(blocker => Object.freeze({
            source: 'profile' as const,
            blocker,
        })));
    }
    if (scenarioResult.kind === 'unsupported') {
        blockers.push(...scenarioResult.blockers.map(blocker => Object.freeze({
            source: 'scenario' as const,
            blocker,
        })));
    }
    if (blockers.length > 0 || profileResult.kind === 'unsupported' || scenarioResult.kind === 'unsupported') {
        const frozenBlockers = Object.freeze(blockers);
        const capability = Object.freeze({ kind: 'unsupported' as const, blockers: frozenBlockers });
        const context = Object.freeze({ kind: 'unsupported' as const });
        CONTEXT_BINDINGS.set(context, Object.freeze({
            kind: 'unsupported',
            blockers: frozenBlockers,
            boundEntity: entity,
            capability,
        }));
        return context;
    }

    const capability = Object.freeze({ kind: 'supported' as const });
    const context = Object.freeze({ kind: 'supported' as const });
    CONTEXT_BINDINGS.set(context, Object.freeze({
        kind: 'supported',
        profile: profileResult.profile,
        rules: scenarioResult.rules,
        boundEntity: entity,
        index,
        capability,
    }));
    return context;
}

/** Explicit unsupported default for direct/test owners that have not bound scenario mechanics. */
export function createUnboundMekMechanicsContextV2(
    message = 'Mek mechanics profile was not bound at runtime construction',
): MekMechanicsContextV2 {
    const blocker = Object.freeze({
        source: 'runtime' as const,
        code: 'UNBOUND_CONTEXT' as const,
        message,
    });
    const blockers = Object.freeze([blocker]);
    const capability = Object.freeze({ kind: 'unsupported' as const, blockers });
    const context = Object.freeze({ kind: 'unsupported' as const });
    CONTEXT_BINDINGS.set(context, Object.freeze({ kind: 'unsupported', blockers, capability }));
    return context;
}

/** The only wave-one public query: supported, or the exact frozen compiler blockers. */
export function mekMechanicsContextCapabilityV2(
    context: MekMechanicsContextV2,
): MekMechanicsContextCapabilityV2 {
    const binding = CONTEXT_BINDINGS.get(context);
    if (!binding || binding.kind !== context.kind) {
        throw new Error('Mek mechanics context was not created by the canonical context factory');
    }
    return binding.capability;
}

/**
 * Projects only immutable endpoint identity and structural C3 facts. The
 * current entity is required on every query so a context cannot be paired with
 * another entity that happens to expose the same ComponentId strings.
 */
export function projectMekC3EndpointCapabilitiesV2(
    context: MekMechanicsContextV2,
    entity: MekEntity,
): MekC3EndpointCapabilitiesResultV2 {
    const binding = requireBinding(context);
    const mismatch = entityMismatchCapability(binding, entity);
    if (mismatch) return mismatch;
    if (binding.kind === 'unsupported') return binding.capability;

    const endpoints: MekC3EndpointCapabilityV2[] = [
        ...binding.profile.ordinaryC3Endpoints.map(endpoint => Object.freeze({
            componentId: endpoint.componentId,
            family: endpoint.networkType,
            role: endpoint.role,
            boosted: endpoint.boosted,
            emergency: false,
        })),
        ...binding.profile.emergencyC3Endpoints.map(endpoint => Object.freeze({
            componentId: endpoint.componentId,
            family: endpoint.networkType,
            role: endpoint.standbyRole,
            boosted: endpoint.boosted,
            emergency: true,
        })),
    ];
    endpoints.sort((left, right) => left.componentId < right.componentId
        ? -1
        : left.componentId > right.componentId ? 1 : 0);
    return Object.freeze({ kind: 'supported', endpoints: Object.freeze(endpoints) });
}

/** Owner construction fence; validates identity without exposing the bound key. */
export function assertMekMechanicsContextEntityV2(
    context: MekMechanicsContextV2,
    entity: MekEntity,
): void {
    const binding = requireBinding(context);
    if (binding.boundEntity !== undefined && binding.boundEntity !== entity) {
        throw new Error('Mek mechanics context does not match the entity');
    }
}

/**
 * Opaque admission fence for the exact entity bound at construction.
 */
export function mekMechanicsContextMatchesEntityV2(
    context: MekMechanicsContextV2,
    entity: MekEntity,
): boolean {
    const binding = requireBinding(context);
    return binding.boundEntity === entity;
}

export type MekDestructionProjectionResultV2 =
    | {
        readonly kind: 'supported';
        /** Narrow owner projection used by action-availability consumers. */
        readonly destroyed: boolean;
        readonly facts: MekDestructionFactsV2;
    }
    | Extract<MekMechanicsContextCapabilityV2, { readonly kind: 'unsupported' }>;

export type MekRuleCheckReconciliationResultV2 =
    | {
        readonly kind: 'supported';
        readonly ruleChecks: MekRuleChecksV2;
        readonly triggerConflict: boolean;
    }
    | Extract<MekMechanicsContextCapabilityV2, { readonly kind: 'unsupported' }>;

export type MekRuleCheckContextResolutionV2 =
    | {
        readonly kind: 'supported';
        readonly resolution: ReturnType<typeof resolveMekRuleCheckV2>;
    }
    | Extract<MekMechanicsContextCapabilityV2, { readonly kind: 'unsupported' }>;

/**
 * Narrow mutable-runtime facts accepted by the mechanics owner. The compiled
 * cockpit/profile remains private; this module selects the controlling crew
 * position and verifies its exact seat topology before producing kernel facts.
 */
export interface MekMovementRuntimeContextInputV2 {
    readonly currentHeat: number;
    readonly airborne: boolean;
    readonly crewAssignment: CrewAssignment;
    crewState(positionId: CrewPositionId): CrewRuntimeState;
    readonly conditions: ReadonlySet<'shutdown' | 'prone' | 'disconnected'>;
    readonly destruction: MekDestructionFactsV2;
    componentAvailable(componentId: ComponentId): boolean;
    componentDisabled(componentId: ComponentId): boolean;
    componentDestroyed(componentId: ComponentId): boolean;
    componentBoosterActive(componentId: ComponentId): boolean;
    modularArmorRemaining(componentId: ComponentId): number;
    criticalSlotUnavailable(slotId: import('../entity/entity-identifiers').CriticalSlotId): boolean;
    criticalSlotDestroyedTurn(
        slotId: import('../entity/entity-identifiers').CriticalSlotId,
    ): number | undefined;
    locationDestroyed(locationId: import('../entity/entity-identifiers').LocationId): boolean;
    shieldDamage(componentId: ComponentId, track: MekShieldTrack): number;
}

export interface MekPhysicalAttackRuntimeContextInputV2 extends MekMovementRuntimeContextInputV2 {
    readonly movementMode: import('./mek-movement-psr-v2').MekMovementModeV2 | null;
    readonly movementDistance: number;
    componentMode(componentId: ComponentId): string | undefined;
}

export type MekShieldProjectionResultV2 =
    | {
        readonly kind: 'supported';
        readonly shields: readonly MekShieldProjectionV2[];
    }
    | Extract<MekMechanicsContextCapabilityV2, { readonly kind: 'unsupported' }>;

export type MekCommittedDamagePilotCheckContextResultV2 =
    | {
        readonly kind: 'supported';
        readonly synthesis: MekCommittedDamagePilotCheckSynthesisResultV2;
    }
    | Extract<MekMovementPsrProjectionResultV2, { readonly kind: 'unsupported' }>;

export type MekPilotCheckProjectionContextResultV2 =
    | { readonly kind: 'supported'; readonly checks: readonly MekPilotCheckV2[] }
    | Extract<MekMechanicsContextCapabilityV2, { readonly kind: 'unsupported' }>;

export type MekPilotCheckResolutionContextResultV2 =
    | { readonly kind: 'supported'; readonly resolution: MekPilotCheckResolutionResultV2 }
    | Extract<MekMechanicsContextCapabilityV2, { readonly kind: 'unsupported' }>;

/** Bounded destruction projection; the private profile/rules never escape the context. */
export function projectMekDestructionContextV2(
    context: MekMechanicsContextV2,
    entity: MekEntity,
    state: MekDamageStateViewV2,
    ruleChecks: MekRuleChecksV2,
): MekDestructionProjectionResultV2 {
    const binding = requireBinding(context);
    const mismatch = entityMismatchCapability(binding, entity);
    if (mismatch) return mismatch;
    if (binding.kind === 'unsupported') return binding.capability;
    const facts = projectMekDestructionStateV2(
        binding.profile,
        binding.rules,
        binding.index,
        state,
        ruleChecks,
    );
    return Object.freeze({
        kind: 'supported',
        destroyed: facts.committed.destroyed,
        facts,
    });
}

/** Owner-only deterministic reconciliation after a state transition. */
export function reconcileMekRuleChecksContextV2(
    context: MekMechanicsContextV2,
    entity: MekEntity,
    state: MekDamageStateViewV2,
    current: MekRuleChecksV2,
    openingRevision: number,
): MekRuleCheckReconciliationResultV2 {
    const binding = requireBinding(context);
    const mismatch = entityMismatchCapability(binding, entity);
    if (mismatch) return mismatch;
    if (binding.kind === 'unsupported') return binding.capability;
    return Object.freeze({
        kind: 'supported',
        triggerConflict: mekRuleCheckTriggerConflictV2(
            binding.profile,
            binding.rules,
            state,
            current,
        ),
        ruleChecks: reconcileMekRuleChecksV2(
            binding.profile,
            binding.rules,
            binding.index,
            state,
            current,
            openingRevision,
        ),
    });
}

/** Owner-only typed resolution; reducer revision CAS is checked before this call. */
export function resolveMekRuleCheckContextV2(
    context: MekMechanicsContextV2,
    entity: MekEntity,
    state: MekDamageStateViewV2,
    current: MekRuleChecksV2,
    key: MekRuleCheckKeyV2,
    token: MekRuleCheckTokenV2,
    outcome: MekRuleCheckOutcomeV2,
): MekRuleCheckContextResolutionV2 {
    const binding = requireBinding(context);
    const mismatch = entityMismatchCapability(binding, entity);
    if (mismatch) return mismatch;
    if (binding.kind === 'unsupported') return binding.capability;
    return Object.freeze({
        kind: 'supported',
        resolution: resolveMekRuleCheckV2(
            binding.profile,
            binding.rules,
            state,
            current,
            key,
            token,
            outcome,
        ),
    });
}

/** Projects movement/PSR without exposing the compiled mechanics profile. */
export function projectMekMovementPsrContextV2(
    context: MekMechanicsContextV2,
    entity: MekEntity,
    input: MekMovementRuntimeContextInputV2,
    state: MekMovementPsrStateV2,
): MekMovementPsrProjectionResultV2 {
    const resolved = movementRuntimeFacts(context, entity, input);
    return resolved.kind === 'unsupported'
        ? resolved
        : projectMekMovementPsrV2(resolved.profile, resolved.facts, state);
}

/** Projects the rules-owned pilot-check list without exposing the compiled profile. */
export function projectMekPilotChecksContextV2(
    context: MekMechanicsContextV2,
    entity: MekEntity,
    state: MekMovementPsrStateV2,
): MekPilotCheckProjectionContextResultV2 {
    const binding = requireBinding(context);
    const mismatch = entityMismatchCapability(binding, entity);
    if (mismatch) return mismatch;
    if (binding.kind === 'unsupported') return binding.capability;
    return Object.freeze({
        kind: 'supported',
        checks: projectMekPilotChecksV2(binding.profile, state),
    });
}

/** Resolves one displayed roll, including Core same-leg grouped checks. */
export function resolveMekPilotCheckContextV2(
    context: MekMechanicsContextV2,
    entity: MekEntity,
    state: MekMovementPsrStateV2,
    checkId: string,
    evidence: MekPilotCheckDiceEvidenceV2,
): MekPilotCheckResolutionContextResultV2 {
    const binding = requireBinding(context);
    const mismatch = entityMismatchCapability(binding, entity);
    if (mismatch) return mismatch;
    if (binding.kind === 'unsupported') return binding.capability;
    return Object.freeze({
        kind: 'supported',
        resolution: resolveMekPilotCheckV2(binding.profile, state, checkId, evidence),
    });
}

/** Projects committed-damage movement for BV without exposing the profile. */
export function projectMekBattleValueMovementContextV2(
    context: MekMechanicsContextV2,
    entity: MekEntity,
    input: MekMovementRuntimeContextInputV2,
): MekBattleValueMovementProjectionV2 {
    const resolved = movementRuntimeFacts(context, entity, input);
    return resolved.kind === 'unsupported'
        ? resolved
        : projectMekBattleValueMovementV2(resolved.profile, resolved.facts);
}

/** Projects current physical effects without exposing the compiled mechanics profile. */
export function projectMekPhysicalAttacksContextV2(
    context: MekMechanicsContextV2,
    entity: MekEntity,
    input: MekPhysicalAttackRuntimeContextInputV2,
): MekPhysicalAttackProjectionResultV2 {
    const binding = requireBinding(context);
    const mismatch = entityMismatchCapability(binding, entity);
    if (mismatch) return physicalAttackUnsupported(mismatch);
    if (binding.kind === 'unsupported') return physicalAttackUnsupported(binding.capability);
    const facts: MekPhysicalAttackRuntimeFactsV2 = Object.freeze({
        currentHeat: input.currentHeat,
        movementMode: input.movementMode,
        movementDistance: input.movementDistance,
        componentAvailable: input.componentAvailable,
        componentDestroyed: input.componentDestroyed,
        componentMode: input.componentMode,
        criticalSlotDestroyedTurn: input.criticalSlotDestroyedTurn,
        criticalSlotUnavailable: input.criticalSlotUnavailable,
        locationDestroyed: input.locationDestroyed,
        shieldDamage: input.shieldDamage,
    });
    return projectMekPhysicalAttacksV2(binding.profile, binding.index, facts);
}

/** Projects physical-shield tracks without exposing the compiled mechanics profile. */
export function projectMekShieldsContextV2(
    context: MekMechanicsContextV2,
    entity: MekEntity,
    facts: MekShieldRuntimeFactsV2,
): MekShieldProjectionResultV2 {
    const binding = requireBinding(context);
    const mismatch = entityMismatchCapability(binding, entity);
    if (mismatch) return mismatch;
    if (binding.kind === 'unsupported') return binding.capability;
    return Object.freeze({
        kind: 'supported',
        shields: projectMekShieldsV2(binding.profile, facts),
    });
}

/** Projects current ranged/physical modifier breakdowns without exposing the profile. */
export function projectMekCombatModifiersContextV2(
    context: MekMechanicsContextV2,
    entity: MekEntity,
    input: MekMovementRuntimeContextInputV2,
): MekCombatModifierProjectionResult {
    const binding = requireBinding(context);
    const mismatch = entityMismatchCapability(binding, entity);
    if (mismatch) return combatModifiersUnsupported(mismatch);
    if (binding.kind === 'unsupported') return combatModifiersUnsupported(binding.capability);
    const crew = runtimeCrewPositions(binding, input);
    const pilot = crew.find(item => item.position.occurrence === 0);
    const gunneryOfficer = crew.find(item => item.position.occurrence === 1);
    return projectMekCombatModifiers(binding.profile, binding.index, Object.freeze({
        currentHeat: input.currentHeat,
        conditions: input.conditions,
        dedicatedPilotPresent: pilot !== undefined,
        dedicatedPilotFunctional: pilot?.functional ?? false,
        dedicatedGunneryOfficerPresent: gunneryOfficer !== undefined,
        dedicatedGunneryOfficerFunctional: gunneryOfficer?.functional ?? false,
        componentAvailable: input.componentAvailable,
        criticalSlotUnavailable: input.criticalSlotUnavailable,
        locationDestroyed: input.locationDestroyed,
    }));
}

export function declareMekMovementContextV2(
    context: MekMechanicsContextV2,
    entity: MekEntity,
    input: MekMovementRuntimeContextInputV2,
    state: MekMovementPsrStateV2,
    declaration: MekMovementDeclarationV2,
    producingRevision: number,
): MekMovementStateTransitionV2 {
    const resolved = movementRuntimeFacts(context, entity, input);
    return resolved.kind === 'unsupported'
        ? Object.freeze({ accepted: false, reason: 'UNSUPPORTED' as const, blockers: resolved.blockers })
        : declareMekMovementV2(resolved.profile, resolved.facts, state, declaration, producingRevision);
}

export function declareMekActionContextV2(
    context: MekMechanicsContextV2,
    entity: MekEntity,
    input: MekMovementRuntimeContextInputV2,
    state: MekMovementPsrStateV2,
    action: MekActionDeclarationV2,
    producingRevision: number,
): MekMovementStateTransitionV2 {
    const resolved = movementRuntimeFacts(context, entity, input);
    return resolved.kind === 'unsupported'
        ? Object.freeze({ accepted: false, reason: 'UNSUPPORTED' as const, blockers: resolved.blockers })
        : declareMekActionV2(resolved.profile, resolved.facts, state, action, producingRevision);
}

export function prepareMekStandUpContextV2(
    context: MekMechanicsContextV2,
    entity: MekEntity,
    input: MekMovementRuntimeContextInputV2,
    state: MekMovementPsrStateV2,
): MekMovementStateTransitionV2 {
    const resolved = movementRuntimeFacts(context, entity, input);
    return resolved.kind === 'unsupported'
        ? Object.freeze({ accepted: false, reason: 'UNSUPPORTED' as const, blockers: resolved.blockers })
        : prepareMekStandUpV2(resolved.profile, resolved.facts, state);
}

export function resolveMekStandAttemptContextV2(
    context: MekMechanicsContextV2,
    entity: MekEntity,
    input: MekMovementRuntimeContextInputV2,
    state: MekMovementPsrStateV2,
    carefulStand: boolean,
    evidence: MekPilotCheckDiceEvidenceV2 | undefined,
    producingRevision: number,
): MekStandAttemptResolutionV2 {
    const resolved = movementRuntimeFacts(context, entity, input);
    return resolved.kind === 'unsupported'
        ? Object.freeze({ accepted: false, reason: 'UNSUPPORTED' as const, blockers: resolved.blockers })
        : resolveMekStandAttemptV2(
            resolved.profile,
            resolved.facts,
            state,
            carefulStand,
            evidence,
            producingRevision,
        );
}

export function adjustMekStandAttemptsContextV2(
    context: MekMechanicsContextV2,
    entity: MekEntity,
    input: MekMovementRuntimeContextInputV2,
    state: MekMovementPsrStateV2,
    delta: number,
): MekMovementPsrStateV2 | Extract<MekMovementPsrProjectionResultV2, { readonly kind: 'unsupported' }> {
    const resolved = movementRuntimeFacts(context, entity, input);
    return resolved.kind === 'unsupported'
        ? resolved
        : adjustMekStandAttemptsV2(resolved.profile, resolved.facts, state, delta);
}

export function synthesizeCommittedMekDamagePilotChecksContextV2(
    context: MekMechanicsContextV2,
    entity: MekEntity,
    input: MekMovementRuntimeContextInputV2,
    state: MekMovementPsrStateV2,
    mutations: readonly MekCommittedDamageMutationV2[],
    producingRevision: number,
): MekCommittedDamagePilotCheckContextResultV2 {
    const resolved = movementRuntimeFacts(context, entity, input);
    if (resolved.kind === 'unsupported') return resolved;
    return Object.freeze({
        kind: 'supported',
        synthesis: synthesizeCommittedMekDamagePilotChecksV2(
            resolved.profile,
            resolved.facts,
            state,
            mutations,
            producingRevision,
        ),
    });
}

export function reconcileMekPilotChecksContextV2(
    context: MekMechanicsContextV2,
    entity: MekEntity,
    input: MekMovementRuntimeContextInputV2,
    state: MekMovementPsrStateV2,
): MekMovementPsrStateV2 | Extract<MekMovementPsrProjectionResultV2, { readonly kind: 'unsupported' }> {
    const resolved = movementRuntimeFacts(context, entity, input);
    return resolved.kind === 'unsupported'
        ? resolved
        : reconcileMekPilotChecksV2(resolved.profile, resolved.facts, state);
}

type MekMovementRuntimeFactsResolutionV2 =
    | {
        readonly kind: 'supported';
        readonly profile: MekMechanicsProfile;
        readonly facts: MekMovementPsrRuntimeFactsV2;
    }
    | Extract<MekMovementPsrProjectionResultV2, { readonly kind: 'unsupported' }>;

function movementRuntimeFacts(
    context: MekMechanicsContextV2,
    entity: MekEntity,
    input: MekMovementRuntimeContextInputV2,
): MekMovementRuntimeFactsResolutionV2 {
    const binding = requireBinding(context);
    const mismatch = entityMismatchCapability(binding, entity);
    if (mismatch) return movementUnsupported(mismatch);
    if (binding.kind === 'unsupported') return movementUnsupported(binding.capability);

    const functional = runtimeCrewPositions(binding, input);
    const occurrenceZero = functional.find(item => item.position.occurrence === 0);
    const selected = occurrenceZero?.healthy && occurrenceZero.seatAvailable
        ? occurrenceZero
        : functional.find(item => item.healthy && item.seatAvailable);
    const pilotingSkill = selected?.assigned.piloting ?? occurrenceZero?.assigned.piloting ?? 5;
    return Object.freeze({
        kind: 'supported',
        profile: binding.profile,
        facts: Object.freeze({
            rulesFlavor: binding.profile.rulesFlavor,
            sprintingAllowed: binding.rules.sprinting,
            currentHeat: input.currentHeat,
            airborne: input.airborne,
            pilotingSkill,
            functionalCrew: selected !== undefined,
            dedicatedPilotFunctional: occurrenceZero !== undefined
                && occurrenceZero.healthy
                && occurrenceZero.seatAvailable,
            conditions: input.conditions,
            destruction: input.destruction,
            componentAvailable: input.componentAvailable,
            componentDisabled: input.componentDisabled,
            componentDestroyed: input.componentDestroyed,
            componentBoosterActive: input.componentBoosterActive,
            modularArmorRemaining: input.modularArmorRemaining,
            criticalSlotUnavailable: input.criticalSlotUnavailable,
            criticalSlotDestroyedTurn: input.criticalSlotDestroyedTurn,
            locationDestroyed: input.locationDestroyed,
            shieldDamage: input.shieldDamage,
        }),
    });
}

type SupportedMekMechanicsBinding = Extract<MekMechanicsContextBindingV2, { readonly kind: 'supported' }>;

function runtimeCrewPositions(
    binding: SupportedMekMechanicsBinding,
    input: MekMovementRuntimeContextInputV2,
) {
    const assignments = new Map(input.crewAssignment.positions.map(position => [position.positionId, position]));
    const positions = [...binding.index.crewPositions.values()].sort((left, right) =>
        left.occurrence - right.occurrence
        || compareText(left.id, right.id));
    return positions.map(position => {
        const assigned = assignments.get(position.id);
        if (!assigned) throw new Error(`Movement crew assignment is missing ${position.id}`);
        const runtime = input.crewState(position.id);
        const seat = position.occurrence === 1 && binding.profile.cockpit.commandConsole
            ? binding.profile.cockpit.commandConsole
            : binding.profile.cockpit.main;
        const seatAvailable = input.componentAvailable(seat.componentId)
            && seat.criticalSlotIds.every(slotId => !input.criticalSlotUnavailable(slotId))
            && seat.locationIds.every(locationId => !input.locationDestroyed(locationId));
        const healthy = !runtime.unconscious
            && !runtime.ejected
            && !isCrewDeathCommitted(runtime);
        return Object.freeze({ position, assigned, healthy, seatAvailable, functional: healthy && seatAvailable });
    });
}

function movementUnsupported(
    capability: Extract<MekMechanicsContextCapabilityV2, { readonly kind: 'unsupported' }>,
): Extract<MekMovementPsrProjectionResultV2, { readonly kind: 'unsupported' }> {
    return Object.freeze({
        kind: 'unsupported',
        blockers: Object.freeze(capability.blockers.map(item => {
            if (item.source === 'profile' || item.source === 'scenario') return item.blocker.message;
            return item.message;
        })),
    });
}

function physicalAttackUnsupported(
    capability: Extract<MekMechanicsContextCapabilityV2, { readonly kind: 'unsupported' }>,
): Extract<MekPhysicalAttackProjectionResultV2, { readonly kind: 'unsupported' }> {
    return Object.freeze({
        kind: 'unsupported',
        blockers: Object.freeze(capability.blockers.map(item => {
            if (item.source === 'profile' || item.source === 'scenario') return item.blocker.message;
            return item.message;
        })),
    });
}

function combatModifiersUnsupported(
    capability: Extract<MekMechanicsContextCapabilityV2, { readonly kind: 'unsupported' }>,
): Extract<MekCombatModifierProjectionResult, { readonly kind: 'unsupported' }> {
    return Object.freeze({
        kind: 'unsupported',
        blockers: Object.freeze(capability.blockers.map(item => {
            if (item.source === 'profile' || item.source === 'scenario') return item.blocker.message;
            return item.message;
        })),
    });
}

function requireBinding(context: MekMechanicsContextV2): MekMechanicsContextBindingV2 {
    const binding = CONTEXT_BINDINGS.get(context);
    if (!binding || binding.kind !== context.kind) {
        throw new Error('Mek mechanics context was not created by the canonical context factory');
    }
    return binding;
}

function entityMismatchCapability(
    binding: MekMechanicsContextBindingV2,
    entity: MekEntity,
): Extract<MekMechanicsContextCapabilityV2, { readonly kind: 'unsupported' }> | null {
    if (binding.boundEntity === undefined || binding.boundEntity === entity) return null;
    const blocker = Object.freeze({
        source: 'runtime' as const,
        code: 'ENTITY_CONTEXT_MISMATCH' as const,
        message: 'Mek mechanics context is bound to a different entity',
    });
    return Object.freeze({ kind: 'unsupported', blockers: Object.freeze([blocker]) });
}
