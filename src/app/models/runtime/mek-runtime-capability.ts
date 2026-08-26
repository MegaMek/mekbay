// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MekEntity } from '../entity/entities/mek/mek-entity';
import { mekComponentBayTopologyProblem } from './component-bay-runtime';
import type {
    MekDestructionProjectionResultV2,
    MekMechanicsContextBlockerV2,
} from './mek-mechanics-context-v2';

export type MekRuntimeCapabilityBlockerCode =
    | 'NOT_A_MEK'
    | 'NOT_MM_DATA_MEGAMEK'
    | 'NOT_NATIVE_MTF'
    | 'TRANSPORT_INTERACTION_REQUIRED'
    | 'COMPONENT_BAY_NOT_SUPPORTED'
    | 'HEAT_CONTEXT_NOT_SUPPORTED'
    | 'MECHANICS_CONTEXT_NOT_SUPPORTED';

export interface MekRuntimeCapabilityBlocker {
    readonly code: MekRuntimeCapabilityBlockerCode;
    readonly message: string;
}

export type MekRuntimeCapabilityDecision =
    | {
        readonly readiness: 'ready';
        readonly family: 'mek';
        readonly v2Coverage: 'whole-unit';
    }
    | {
        readonly readiness: 'deferred';
        readonly reason: string;
        readonly blockers: readonly MekRuntimeCapabilityBlocker[];
    };

/**
 * Intersects the entity-only admission decision with the exact heat profile
 * and scenario bound to a constructed runtime. Historical snapshots may still
 * restore with an unsupported heat context for lossless recovery, but a fresh
 * whole-unit admission must not advertise readiness without this intersection.
 */
export function requireSupportedMekHeatContext(
    decision: MekRuntimeCapabilityDecision,
    capability: { readonly kind: 'supported' }
        | { readonly kind: 'unsupported'; readonly blockers: readonly string[] },
): MekRuntimeCapabilityDecision {
    if (capability.kind === 'supported') return decision;
    return appendCapabilityBlocker(decision, blocker(
        'HEAT_CONTEXT_NOT_SUPPORTED',
        `The bound heat profile or scenario is unsupported: ${capability.blockers.join('; ')}`,
    ));
}

/**
 * Intersects admission with the exact mechanics profile, scenario, and
 * restoration evidence bound to the runtime owner. Historical snapshots may
 * remain constructible for lossless recovery; they are not fresh whole-unit
 * admissions until this capability is supported.
 */
export function requireSupportedMekMechanicsContext(
    decision: MekRuntimeCapabilityDecision,
    capability: MekDestructionProjectionResultV2,
): MekRuntimeCapabilityDecision {
    if (capability.kind === 'supported') return decision;
    return appendCapabilityBlocker(decision, blocker(
        'MECHANICS_CONTEXT_NOT_SUPPORTED',
        `The bound Mek mechanics profile or scenario is unsupported: ${
            capability.blockers.map(describeMechanicsBlocker).join('; ')
        }`,
    ));
}

function appendCapabilityBlocker(
    decision: MekRuntimeCapabilityDecision,
    added: MekRuntimeCapabilityBlocker,
): MekRuntimeCapabilityDecision {
    if (decision.readiness === 'deferred'
        && decision.blockers.some(existing => existing.code === added.code)) return decision;
    return deferred([
        ...(decision.readiness === 'deferred' ? decision.blockers : []),
        added,
    ]);
}

function describeMechanicsBlocker(blockerValue: MekMechanicsContextBlockerV2): string {
    if (blockerValue.source === 'runtime') {
        return `${blockerValue.code}: ${blockerValue.message}`;
    }
    return `${blockerValue.blocker.code}: ${blockerValue.blocker.feature}: ${blockerValue.blocker.message}`;
}

/**
 * One default-deny capability predicate for the retained whole-unit Mek owner.
 * Callers cannot select a smaller compatibility profile. Equipment state,
 * ammo, firing, heat, destruction, movement/PSRs, targeting/C3 and damaged BV
 * are all routed through the entity plus typed runtime. The
 * entity-level transport and bay topology are checked before construction;
 * exact heat/mechanics capability is intersected afterward.
 */
export function evaluateMekRuntimeCapability(
    entity: MekEntity,
): MekRuntimeCapabilityDecision {
    const blockers: MekRuntimeCapabilityBlocker[] = [];
    if (entity.transporters().length > 0) blockers.push(blocker(
        'TRANSPORT_INTERACTION_REQUIRED',
        'Transport occupancy is not yet owned by the retained Mek runtime',
    ));
    const bayProblem = mekComponentBayTopologyProblem(entity);
    if (bayProblem !== null) blockers.push(blocker(
        'COMPONENT_BAY_NOT_SUPPORTED',
        `The component-bay topology is not supported: ${bayProblem}`,
    ));
    if (blockers.length === 0) return Object.freeze({
        readiness: 'ready',
        family: 'mek',
        v2Coverage: 'whole-unit',
    });
    return deferred(blockers);
}

function blocker(code: MekRuntimeCapabilityBlockerCode, message: string): MekRuntimeCapabilityBlocker {
    return Object.freeze({ code, message });
}

function deferred(blockers: readonly MekRuntimeCapabilityBlocker[]): Extract<MekRuntimeCapabilityDecision, { readiness: 'deferred' }> {
    const frozen = Object.freeze([...blockers]);
    return Object.freeze({
        readiness: 'deferred',
        reason: frozen.map(item => item.code).join(','),
        blockers: frozen,
    });
}
