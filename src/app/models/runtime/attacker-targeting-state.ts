// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { compareText } from '../../utils/string.util';
import { isPlainRecord } from '../../utils/json-value.util';
import { ImmutableIndex, ImmutableSet } from '../entity/immutable-collections';
import { asComponentId, type ComponentId } from '../entity/entity-identifiers';
import { asEncounterTargetId, type EncounterTargetId } from './encounter-runtime';
import { TN_CUSTOM_MODIFIER_MAX, TN_CUSTOM_MODIFIER_MIN } from '../target-number-calculator.model';

export const ATTACKER_TARGETING_STATE_SCHEMA_VERSION = 1 as const;
export const DEFAULT_ATTACKER_TARGET_DISTANCE = 1;
export const MAX_ATTACKER_TARGETING_COMPONENTS = 1024;
export const MAX_ATTACKER_TARGETING_ACTIONS = 256;
export const MAX_ATTACKER_TARGETS = 12;
export const MAX_ATTACKER_AMMO_SOURCES_PER_WEAPON = 512;
export const MAX_ATTACKER_MUNITIONS_PER_WEAPON = 512;
export const MAX_ATTACKER_TARGETING_TEXT_LENGTH = 512;

/**
 * Production accepts every finite non-negative distance and every finite manual
 * modifier. Number.MAX_VALUE is the finite JavaScript boundary, so the
 * kernel retains that behavior while rejecting infinities and NaN.
 */
export const MAX_ATTACKER_TARGET_DISTANCE = Number.MAX_VALUE;
export const MAX_ATTACKER_MANUAL_TN_MAGNITUDE = Number.MAX_VALUE;

export type AttackerManualRange = 'short' | 'medium' | 'long' | 'extreme';

export type AttackerActionTarget =
    | { readonly kind: 'component'; readonly componentId: ComponentId }
    | { readonly kind: 'intrinsic'; readonly actionId: string };

/**
 * Only attacker-relative calculator inputs live here. Target movement, posture,
 * unit type, target-hex cover, airborne state, skidding, and large-target state
 * remain force-shared target-registry facts.
 *
 * Default values are omitted: no woods, front, stationary, and false.
 */
export interface AttackerLocalCalculatorInputs {
    readonly interveningWoods?: 'light1' | 'light2';
    readonly partialCover?: true;
    readonly attackDirection?: 'left' | 'rear' | 'right';
    readonly indirectFire?: true;
    readonly secondaryTarget?: true;
    readonly secondaryTargetSideBack?: true;
    readonly spotterMoveMode?: 'walk' | 'run' | 'jump';
    readonly spotterDeclaredAttacks?: true;
    readonly customModifier?: number;
}

/** An explicit user fact, never a cached or caller-derived calculator result. */
export interface AttackerManualTnOverride {
    readonly kind: 'user-manual';
    readonly modifier: number;
}

export type AttackerSelection =
    | { readonly kind: 'selected' }
    | { readonly kind: 'target'; readonly targetId: EncounterTargetId }
    | { readonly kind: 'manual-range'; readonly range: AttackerManualRange };

/** Physical actions have no range-band-only selection state. */
export type AttackerActionSelection = Exclude<AttackerSelection, { readonly kind: 'manual-range' }>;

export interface AttackerAmmoSelection {
    readonly munitionKey: string;
    /** Exact installed/intrinsic ammo-source identity; grouped display IDs are forbidden. */
    readonly preferredSourceId?: ComponentId;
}

/** Sparse component row. Absence means unselected with no ammo preference. */
export interface AttackerComponentState {
    readonly selection?: AttackerSelection;
    readonly ammo?: AttackerAmmoSelection;
}

/** Sparse physical-action row. The canonical map key is derived from target. */
export interface AttackerActionState {
    readonly target: AttackerActionTarget;
    readonly selection: AttackerActionSelection;
}

/**
 * Sparse attacker-local facts. Absence of `distance` means one hex. No shared
 * target identity or calculator fact, and no calculated TN, is representable.
 */
export interface AttackerLocalTargetState {
    readonly distance?: number;
    readonly c3Distance?: number;
    readonly useC3?: true;
    readonly calculator?: AttackerLocalCalculatorInputs;
    readonly manualTnOverride?: AttackerManualTnOverride;
}

export interface AttackerTargetingState {
    readonly schemaVersion: typeof ATTACKER_TARGETING_STATE_SCHEMA_VERSION;
    readonly components: ReadonlyMap<ComponentId, AttackerComponentState>;
    readonly actions: ReadonlyMap<string, AttackerActionState>;
    readonly targets: ReadonlyMap<EncounterTargetId, AttackerLocalTargetState>;
}

/** Minimal shared-target witness. Name, color, unit type, and calculator are deliberately absent. */
export interface AttackerRegistryTargetValidation {
    readonly id: EncounterTargetId;
    readonly source: 'manual' | 'opfor';
    readonly readOnly: boolean;
}

export interface AttackerAmmoSourceValidation {
    readonly componentId: ComponentId;
    readonly munitionKeys: readonly string[];
}

/** Exact installed, non-physical weapon and its current unit-owned compatibility facts. */
export interface AttackerWeaponValidation {
    readonly componentId: ComponentId;
    readonly compatibleMunitionKeys: readonly string[];
    readonly sources: readonly AttackerAmmoSourceValidation[];
}

/** Detached validation facts supplied by the force-owned command boundary. */
export interface AttackerTargetingValidationContext {
    readonly registryRevision: number;
    readonly forceReadOnly: boolean;
    readonly targets: readonly AttackerRegistryTargetValidation[];
    readonly weapons: readonly AttackerWeaponValidation[];
    readonly actions: readonly AttackerActionTarget[];
}

interface AttackerTargetingCommandEnvelope {
    readonly expectedRegistryRevision: number;
}

export type AttackerTargetingEdit =
    | {
        readonly kind: 'set-component-selection';
        readonly componentId: ComponentId;
        readonly selection: AttackerSelection | null;
    }
    | {
        readonly kind: 'set-component-selections';
        readonly componentIds: readonly ComponentId[];
        readonly selection: AttackerSelection | null;
    }
    | {
        readonly kind: 'set-action-selection';
        readonly target: AttackerActionTarget;
        readonly selection: AttackerActionSelection | null;
    }
    | {
        readonly kind: 'set-component-ammo';
        readonly componentId: ComponentId;
        readonly ammo: (AttackerAmmoSelection & { readonly preferredSourceId?: ComponentId | null }) | null;
    }
    | {
        readonly kind: 'set-component-ammos';
        readonly updates: readonly Readonly<{
            readonly componentId: ComponentId;
            readonly ammo: (AttackerAmmoSelection & {
                readonly preferredSourceId?: ComponentId | null;
            }) | null;
        }>[];
    }
    | {
        readonly kind: 'set-target-facts';
        readonly targetId: EncounterTargetId;
        readonly facts: AttackerLocalTargetState | null;
    }
;

export type AttackerTargetingCommand = AttackerTargetingCommandEnvelope
    & AttackerTargetingEdit;

export type AttackerTargetingRejectionReason =
    | 'STALE_REGISTRY'
    | 'READ_ONLY'
    | 'INVALID_STATE'
    | 'INVALID_CONTEXT'
    | 'INVALID_COMMAND'
    | 'INVALID_COMPONENT'
    | 'INVALID_TARGET'
    | 'INVALID_TARGET_POLICY'
    | 'INVALID_RANGE'
    | 'INVALID_TARGET_FACTS'
    | 'INVALID_MUNITION'
    | 'INVALID_AMMO_SOURCE'
    | 'SOURCE_NOT_COMPATIBLE';

export type AttackerTargetingPlanResult =
    | {
        readonly accepted: true;
        readonly changed: boolean;
        readonly nextState: AttackerTargetingState;
    }
    | {
        readonly accepted: false;
        readonly changed: false;
        readonly reason: AttackerTargetingRejectionReason;
        readonly state: AttackerTargetingState;
    };

export type AttackerTargetingReduction =
    | {
        readonly accepted: true;
        readonly changed: boolean;
        readonly state: AttackerTargetingState;
    }
    | {
        readonly accepted: false;
        readonly changed: false;
        readonly reason: AttackerTargetingRejectionReason;
        readonly state: AttackerTargetingState;
    };

export interface SerializedAttackerTargetingState {
    readonly schemaVersion: typeof ATTACKER_TARGETING_STATE_SCHEMA_VERSION;
    readonly components: readonly {
        readonly componentId: ComponentId;
        readonly selection?: AttackerSelection;
        readonly ammo?: AttackerAmmoSelection;
    }[];
    readonly actions: readonly AttackerActionState[];
    readonly targets: readonly ({
        readonly targetId: EncounterTargetId;
    } & AttackerLocalTargetState)[];
}

interface ValidatedContext {
    readonly targetIds: ReadonlySet<EncounterTargetId>;
    readonly weapons: ReadonlyMap<ComponentId, ValidatedWeapon>;
    readonly actions: ReadonlyMap<string, AttackerActionTarget>;
}

interface ValidatedWeapon {
    readonly compatibleMunitions: ReadonlySet<string>;
    readonly sources: ReadonlyMap<ComponentId, ReadonlySet<string>>;
}

export function createPristineAttackerTargetingState(): AttackerTargetingState {
    return Object.freeze({
        schemaVersion: ATTACKER_TARGETING_STATE_SCHEMA_VERSION,
        components: new ImmutableIndex<ComponentId, AttackerComponentState>([]),
        actions: new ImmutableIndex<string, AttackerActionState>([]),
        targets: new ImmutableIndex<EncounterTargetId, AttackerLocalTargetState>([]),
    });
}

/** Copies, canonicalizes, sorts, and deeply freezes the complete state. */
export function freezeAttackerTargetingState(
    state: AttackerTargetingState,
): AttackerTargetingState {
    if (!isPlainRecord(state)
        || !hasExactKeys(state, ['schemaVersion', 'components', 'actions', 'targets'])
        || state.schemaVersion !== ATTACKER_TARGETING_STATE_SCHEMA_VERSION
        || !isReadonlyMap(state.components)
        || !isReadonlyMap(state.actions)
        || !isReadonlyMap(state.targets)
        || state.components.size > MAX_ATTACKER_TARGETING_COMPONENTS
        || state.actions.size > MAX_ATTACKER_TARGETING_ACTIONS
        || state.targets.size > MAX_ATTACKER_TARGETS) {
        throw new Error('Invalid Attacker targeting state');
    }

    const components = new Map<ComponentId, AttackerComponentState>();
    for (const [componentId, component] of state.components) {
        if (!validId(componentId)) throw new Error('Invalid targeting component ID');
        if (components.has(componentId)) throw new Error('Duplicate targeting component ID');
        const frozen = canonicalComponentState(component);
        if (frozen) components.set(componentId, frozen);
    }

    const targets = new Map<EncounterTargetId, AttackerLocalTargetState>();
    for (const [targetId, facts] of state.targets) {
        if (!validId(targetId)) throw new Error('Invalid attacker-local target ID');
        if (targets.has(targetId)) throw new Error('Duplicate attacker-local target ID');
        const frozen = canonicalTargetFacts(facts);
        if (frozen) targets.set(targetId, frozen);
    }

    const actions = new Map<string, AttackerActionState>();
    for (const [key, value] of state.actions) {
        const target = canonicalActionTarget(value.target);
        const expectedKey = attackerActionTargetKey(target);
        if (key !== expectedKey || actions.has(key)) throw new Error('Invalid targeting action identity');
        const selection = canonicalSelection(value.selection);
        if (selection.reason || !selection.selection || selection.selection.kind === 'manual-range') {
            throw new Error('Invalid targeting action selection');
        }
        actions.set(key, Object.freeze({ target, selection: selection.selection }));
    }

    return Object.freeze({
        schemaVersion: ATTACKER_TARGETING_STATE_SCHEMA_VERSION,
        components: new ImmutableIndex(sortedEntries(components)),
        actions: new ImmutableIndex(sortedEntries(actions)),
        targets: new ImmutableIndex(sortedEntries(targets)),
    });
}

/**
 * Plans one closed mutation without changing its input. The force adds
 * unit-revision/idempotency fencing around this registry-revision plan.
 */
export function planAttackerTargetingCommand(
    current: AttackerTargetingState,
    context: AttackerTargetingValidationContext,
    command: AttackerTargetingCommand,
): AttackerTargetingPlanResult {
    let state: AttackerTargetingState;
    try {
        state = freezeAttackerTargetingState(current);
    } catch {
        return rejectedPlan(createPristineAttackerTargetingState(), 'INVALID_STATE');
    }

    if (!isPlainRecord(command)
        || !validRevision(command.expectedRegistryRevision)) {
        return rejectedPlan(state, 'INVALID_COMMAND');
    }
    if (!isPlainRecord(context) || !validRevision(context.registryRevision)) {
        return rejectedPlan(state, 'INVALID_CONTEXT');
    }
    if (command.expectedRegistryRevision !== context.registryRevision) {
        return rejectedPlan(state, 'STALE_REGISTRY');
    }

    const validated = validateContext(context);
    if (validated.reason) return rejectedPlan(state, validated.reason);
    if (context.forceReadOnly) return rejectedPlan(state, 'READ_ONLY');

    const components = new Map(state.components);
    const actions = new Map(state.actions);
    const targets = new Map(state.targets);

    switch (command.kind) {
        case 'set-component-selection': {
            if (!hasExactKeys(command, ['kind', 'expectedRegistryRevision', 'componentId', 'selection'])
                || !validId(command.componentId)) {
                return rejectedPlan(state, 'INVALID_COMMAND');
            }
            if (!validated.context.weapons.has(command.componentId)) {
                return rejectedPlan(state, 'INVALID_COMPONENT');
            }
            let selection: AttackerSelection | undefined;
            if (command.selection !== null) {
                const result = canonicalSelection(command.selection);
                if (result.reason) return rejectedPlan(state, result.reason);
                selection = result.selection;
                if (selection?.kind === 'target'
                    && !validated.context.targetIds.has(selection.targetId)) {
                    return rejectedPlan(state, 'INVALID_TARGET');
                }
            }
            const existing = components.get(command.componentId);
            putComponentState(components, command.componentId, {
                ...(selection && { selection }),
                ...(existing?.ammo && { ammo: existing.ammo }),
            });
            break;
        }
        case 'set-component-selections': {
            if (!hasExactKeys(command, ['kind', 'expectedRegistryRevision', 'componentIds', 'selection'])
                || !Array.isArray(command.componentIds)
                || command.componentIds.length === 0
                || command.componentIds.length > MAX_ATTACKER_TARGETING_COMPONENTS
                || command.componentIds.some(componentId => !validId(componentId))
                || new Set(command.componentIds).size !== command.componentIds.length) {
                return rejectedPlan(state, 'INVALID_COMMAND');
            }
            const componentIds = command.componentIds.map(componentId => asComponentId(componentId));
            if (componentIds.some(componentId => !validated.context.weapons.has(componentId))) {
                return rejectedPlan(state, 'INVALID_COMPONENT');
            }
            let selection: AttackerSelection | undefined;
            if (command.selection !== null) {
                const result = canonicalSelection(command.selection);
                if (result.reason) return rejectedPlan(state, result.reason);
                selection = result.selection;
                if (selection?.kind === 'target'
                    && !validated.context.targetIds.has(selection.targetId)) {
                    return rejectedPlan(state, 'INVALID_TARGET');
                }
            }
            for (const componentId of componentIds) {
                const existing = components.get(componentId);
                putComponentState(components, componentId, {
                    ...(selection && { selection }),
                    ...(existing?.ammo && { ammo: existing.ammo }),
                });
            }
            break;
        }
        case 'set-component-ammo': {
            if (!hasExactKeys(command, ['kind', 'expectedRegistryRevision', 'componentId', 'ammo'])
                || !validId(command.componentId)) {
                return rejectedPlan(state, 'INVALID_COMMAND');
            }
            const weapon = validated.context.weapons.get(command.componentId);
            if (!weapon) return rejectedPlan(state, 'INVALID_COMPONENT');

            let ammo: AttackerAmmoSelection | undefined;
            if (command.ammo !== null) {
                if (!isPlainRecord(command.ammo)
                    || !hasExactKeys(command.ammo, ['munitionKey', 'preferredSourceId'])
                    || !validCanonicalText(command.ammo.munitionKey)) {
                    return rejectedPlan(state, 'INVALID_MUNITION');
                }
                if (!weapon.compatibleMunitions.has(command.ammo.munitionKey)) {
                    return rejectedPlan(state, 'INVALID_MUNITION');
                }
                const sourceId = command.ammo.preferredSourceId ?? undefined;
                if (sourceId !== undefined) {
                    if (!validId(sourceId)) return rejectedPlan(state, 'INVALID_AMMO_SOURCE');
                    const sourceMunitions = weapon.sources.get(sourceId);
                    if (!sourceMunitions) return rejectedPlan(state, 'SOURCE_NOT_COMPATIBLE');
                    if (!sourceMunitions.has(command.ammo.munitionKey)) {
                        return rejectedPlan(state, 'SOURCE_NOT_COMPATIBLE');
                    }
                }
                ammo = Object.freeze({
                    munitionKey: command.ammo.munitionKey,
                    ...(sourceId && { preferredSourceId: sourceId }),
                });
            }
            const existing = components.get(command.componentId);
            putComponentState(components, command.componentId, {
                ...(existing?.selection && { selection: existing.selection }),
                ...(ammo && { ammo }),
            });
            break;
        }
        case 'set-component-ammos': {
            if (!hasExactKeys(command, ['kind', 'expectedRegistryRevision', 'updates'])
                || !Array.isArray(command.updates)
                || command.updates.length === 0
                || command.updates.length > MAX_ATTACKER_TARGETING_COMPONENTS) {
                return rejectedPlan(state, 'INVALID_COMMAND');
            }
            const seen = new Set<ComponentId>();
            const updates: Array<Readonly<{
                readonly componentId: ComponentId;
                readonly ammo?: AttackerAmmoSelection;
            }>> = [];
            for (const update of command.updates) {
                if (!isPlainRecord(update)
                    || !hasExactKeys(update, ['componentId', 'ammo'])
                    || !validId(update.componentId)) {
                    return rejectedPlan(state, 'INVALID_COMMAND');
                }
                const componentId = asComponentId(update.componentId);
                if (seen.has(componentId)) return rejectedPlan(state, 'INVALID_COMMAND');
                seen.add(componentId);
                const weapon = validated.context.weapons.get(componentId);
                if (!weapon) return rejectedPlan(state, 'INVALID_COMPONENT');
                if (update.ammo === null) {
                    updates.push(Object.freeze({ componentId }));
                    continue;
                }
                if (!isPlainRecord(update.ammo)
                    || !hasExactKeys(update.ammo, ['munitionKey', 'preferredSourceId'])
                    || !validCanonicalText(update.ammo.munitionKey)) {
                    return rejectedPlan(state, 'INVALID_MUNITION');
                }
                if (!weapon.compatibleMunitions.has(update.ammo.munitionKey)) {
                    return rejectedPlan(state, 'INVALID_MUNITION');
                }
                const sourceId = update.ammo.preferredSourceId ?? undefined;
                if (sourceId !== undefined) {
                    if (!validId(sourceId)) return rejectedPlan(state, 'INVALID_AMMO_SOURCE');
                    const sourceMunitions = weapon.sources.get(asComponentId(sourceId));
                    if (!sourceMunitions?.has(update.ammo.munitionKey)) {
                        return rejectedPlan(state, 'SOURCE_NOT_COMPATIBLE');
                    }
                }
                updates.push(Object.freeze({
                    componentId,
                    ammo: Object.freeze({
                        munitionKey: update.ammo.munitionKey,
                        ...(sourceId && { preferredSourceId: asComponentId(sourceId) }),
                    }),
                }));
            }
            for (const update of updates) {
                const existing = components.get(update.componentId);
                putComponentState(components, update.componentId, {
                    ...(existing?.selection && { selection: existing.selection }),
                    ...(update.ammo && { ammo: update.ammo }),
                });
            }
            break;
        }
        case 'set-action-selection': {
            if (!hasExactKeys(command, ['kind', 'expectedRegistryRevision', 'target', 'selection'])) {
                return rejectedPlan(state, 'INVALID_COMMAND');
            }
            let target: AttackerActionTarget;
            try {
                target = canonicalActionTarget(command.target);
            } catch {
                return rejectedPlan(state, 'INVALID_COMMAND');
            }
            const key = attackerActionTargetKey(target);
            if (!validated.context.actions.has(key)) return rejectedPlan(state, 'INVALID_COMPONENT');
            if (command.selection === null) {
                actions.delete(key);
                break;
            }
            const selection = canonicalSelection(command.selection);
            if (selection.reason || !selection.selection) {
                return rejectedPlan(state, selection.reason ?? 'INVALID_COMMAND');
            }
            if (selection.selection.kind === 'manual-range') {
                return rejectedPlan(state, 'INVALID_RANGE');
            }
            if (selection.selection.kind === 'target'
                && !validated.context.targetIds.has(selection.selection.targetId)) {
                return rejectedPlan(state, 'INVALID_TARGET');
            }
            actions.set(key, Object.freeze({ target, selection: selection.selection }));
            break;
        }
        case 'set-target-facts': {
            if (!hasExactKeys(command, ['kind', 'expectedRegistryRevision', 'targetId', 'facts'])
                || !validId(command.targetId)) {
                return rejectedPlan(state, 'INVALID_COMMAND');
            }
            if (!validated.context.targetIds.has(command.targetId)) {
                return rejectedPlan(state, 'INVALID_TARGET');
            }
            if (command.facts === null) {
                targets.delete(command.targetId);
            } else {
                let facts: AttackerLocalTargetState | null;
                try {
                    facts = canonicalTargetFacts(command.facts);
                } catch {
                    return rejectedPlan(state, 'INVALID_TARGET_FACTS');
                }
                if (facts) targets.set(command.targetId, facts);
                else targets.delete(command.targetId);
            }
            break;
        }
        default:
            return rejectedPlan(state, 'INVALID_COMMAND');
    }

    const nextState = freezeAttackerTargetingState({
        schemaVersion: ATTACKER_TARGETING_STATE_SCHEMA_VERSION,
        components,
        actions,
        targets,
    });
    return Object.freeze({
        accepted: true,
        changed: canonicalStateJson(state) !== canonicalStateJson(nextState),
        nextState,
    });
}

export function reduceAttackerTargetingCommand(
    current: AttackerTargetingState,
    context: AttackerTargetingValidationContext,
    command: AttackerTargetingCommand,
): AttackerTargetingReduction {
    const planned = planAttackerTargetingCommand(current, context, command);
    return planned.accepted
        ? Object.freeze({ accepted: true, changed: planned.changed, state: planned.nextState })
        : planned;
}

/**
 * Deterministically removes dangling registry assignments/facts and invalid
 * weapon/source preferences. A removed source clears only the preference when
 * the selected munition remains compatible.
 */
export function reconcileAttackerTargetingState(
    current: AttackerTargetingState,
    context: AttackerTargetingValidationContext,
): AttackerTargetingReduction {
    let state: AttackerTargetingState;
    try {
        state = freezeAttackerTargetingState(current);
    } catch {
        return rejectedReduction(createPristineAttackerTargetingState(), 'INVALID_STATE');
    }
    const validated = validateContext(context);
    if (validated.reason) return rejectedReduction(state, validated.reason);

    const components = new Map<ComponentId, AttackerComponentState>();
    for (const [componentId, component] of state.components) {
        const weapon = validated.context.weapons.get(componentId);
        if (!weapon) continue;

        const selection = component.selection?.kind === 'target'
            && !validated.context.targetIds.has(component.selection.targetId)
            ? undefined
            : component.selection;
        let ammo = component.ammo;
        if (ammo && !weapon.compatibleMunitions.has(ammo.munitionKey)) {
            ammo = undefined;
        } else if (ammo?.preferredSourceId) {
            const sourceMunitions = weapon.sources.get(ammo.preferredSourceId);
            if (!sourceMunitions?.has(ammo.munitionKey)) {
                ammo = Object.freeze({ munitionKey: ammo.munitionKey });
            }
        }
        putComponentState(components, componentId, {
            ...(selection && { selection }),
            ...(ammo && { ammo }),
        });
    }

    const targets = new Map<EncounterTargetId, AttackerLocalTargetState>();
    for (const [targetId, facts] of state.targets) {
        if (validated.context.targetIds.has(targetId)) targets.set(targetId, facts);
    }
    const actions = new Map<string, AttackerActionState>();
    for (const [key, action] of state.actions) {
        if (!validated.context.actions.has(key)) continue;
        if (action.selection.kind === 'target'
            && !validated.context.targetIds.has(action.selection.targetId)) continue;
        actions.set(key, action);
    }
    const next = freezeAttackerTargetingState({
        schemaVersion: ATTACKER_TARGETING_STATE_SCHEMA_VERSION,
        components,
        actions,
        targets,
    });
    return Object.freeze({
        accepted: true,
        changed: canonicalStateJson(state) !== canonicalStateJson(next),
        state: next,
    });
}

/** Stable array wire shape for later persistence integration and digest tests. */
export function serializeAttackerTargetingState(
    state: AttackerTargetingState,
): SerializedAttackerTargetingState {
    const frozen = freezeAttackerTargetingState(state);
    return Object.freeze({
        schemaVersion: ATTACKER_TARGETING_STATE_SCHEMA_VERSION,
        components: Object.freeze([...frozen.components].map(([componentId, component]) => Object.freeze({
            componentId,
            ...(component.selection && { selection: cloneSelection(component.selection) }),
            ...(component.ammo && { ammo: Object.freeze({ ...component.ammo }) }),
        }))),
        actions: Object.freeze([...frozen.actions].map(([, action]) => Object.freeze({
            target: canonicalActionTarget(action.target),
            selection: cloneActionSelection(action.selection),
        }))),
        targets: Object.freeze([...frozen.targets].map(([targetId, facts]) => Object.freeze({
            targetId,
            ...cloneTargetFacts(facts),
        }))),
    });
}

export function deserializeAttackerTargetingState(
    value: unknown,
): AttackerTargetingState {
    if (!isPlainRecord(value)) throw new Error('Invalid attacker-targeting wire state');
    const record = value as Record<string, unknown>;
    if (!hasExactKeys(record, ['schemaVersion', 'components', 'actions', 'targets'])
        || record['schemaVersion'] !== ATTACKER_TARGETING_STATE_SCHEMA_VERSION
        || !Array.isArray(record['components'])
        || !Array.isArray(record['actions'])
        || !Array.isArray(record['targets'])
        || record['components'].length > MAX_ATTACKER_TARGETING_COMPONENTS
        || record['actions'].length > MAX_ATTACKER_TARGETING_ACTIONS
        || record['targets'].length > MAX_ATTACKER_TARGETS) {
        throw new Error('Invalid attacker-targeting wire state');
    }

    const components = new Map<ComponentId, AttackerComponentState>();
    for (const raw of record['components']) {
        if (!isPlainRecord(raw)) throw new Error('Invalid attacker-targeting component');
        const row = raw as Record<string, unknown>;
        if (!hasExactKeys(row, ['componentId', 'selection', 'ammo'])
            || !validId(row['componentId'])) {
            throw new Error('Invalid attacker-targeting component');
        }
        const componentId = asComponentId(row['componentId']);
        const component = canonicalComponentState({
            selection: row['selection'],
            ammo: row['ammo'],
        } as AttackerComponentState);
        if (component === null) throw new Error('Invalid attacker-targeting component');
        if (components.has(componentId)) throw new Error('Duplicate attacker-targeting entry');
        components.set(componentId, component);
    }

    const actions = new Map<string, AttackerActionState>();
    for (const raw of record['actions']) {
        if (!isPlainRecord(raw)) throw new Error('Invalid attacker-targeting action');
        const row = raw as Record<string, unknown>;
        if (!hasExactKeys(row, ['target', 'selection'])) {
            throw new Error('Invalid attacker-targeting action');
        }
        const target = canonicalActionTarget(row['target'] as AttackerActionTarget);
        const selectionResult = canonicalSelection(row['selection'] as AttackerSelection);
        const selection = selectionResult.selection;
        if (selectionResult.reason || selection === undefined || selection.kind === 'manual-range') {
            throw new Error('Invalid attacker-targeting action selection');
        }
        const key = attackerActionTargetKey(target);
        if (actions.has(key)) throw new Error('Duplicate attacker-targeting action');
        actions.set(key, Object.freeze({ target, selection }));
    }

    const targets = new Map<EncounterTargetId, AttackerLocalTargetState>();
    for (const raw of record['targets']) {
        if (!isPlainRecord(raw)) throw new Error('Invalid attacker-targeting target');
        const row = raw as Record<string, unknown>;
        if (!hasExactKeys(row, [
                'targetId', 'distance', 'c3Distance', 'useC3', 'calculator', 'manualTnOverride',
            ])
            || !validId(row['targetId'])) {
            throw new Error('Invalid attacker-targeting target');
        }
        const targetId = row['targetId'] as EncounterTargetId;
        const facts = canonicalTargetFacts({
            distance: row['distance'],
            c3Distance: row['c3Distance'],
            useC3: row['useC3'],
            calculator: row['calculator'],
            manualTnOverride: row['manualTnOverride'],
        } as AttackerLocalTargetState);
        if (facts === null || targets.has(targetId)) {
            throw new Error('Invalid or duplicate attacker-targeting target');
        }
        targets.set(targetId, facts);
    }

    return freezeAttackerTargetingState({
        schemaVersion: ATTACKER_TARGETING_STATE_SCHEMA_VERSION,
        components,
        actions,
        targets,
    });
}

function validateContext(context: unknown): {
    readonly context: ValidatedContext;
    readonly reason?: 'INVALID_CONTEXT' | 'INVALID_TARGET_POLICY';
} {
    const empty: ValidatedContext = Object.freeze({
        targetIds: new ImmutableSet<EncounterTargetId>([]),
        weapons: new ImmutableIndex<ComponentId, ValidatedWeapon>([]),
        actions: new ImmutableIndex<string, AttackerActionTarget>([]),
    });
    if (!isPlainRecord(context)
        || !hasExactKeys(context, ['registryRevision', 'forceReadOnly', 'targets', 'weapons', 'actions'])
        || !validRevision(context['registryRevision'])
        || typeof context['forceReadOnly'] !== 'boolean'
        || !Array.isArray(context['targets'])
        || !Array.isArray(context['weapons'])
        || !Array.isArray(context['actions'])
        || context['targets'].length > MAX_ATTACKER_TARGETS
        || context['weapons'].length > MAX_ATTACKER_TARGETING_COMPONENTS
        || context['actions'].length > MAX_ATTACKER_TARGETING_ACTIONS) {
        return { context: empty, reason: 'INVALID_CONTEXT' };
    }

    const targetIds = new Set<EncounterTargetId>();
    for (const target of context['targets']) {
        if (!isPlainRecord(target)
            || !hasExactKeys(target, ['id', 'source', 'readOnly'])
            || !validId(target['id'])
            || (target['source'] !== 'manual' && target['source'] !== 'opfor')
            || typeof target['readOnly'] !== 'boolean') {
            return { context: empty, reason: 'INVALID_CONTEXT' };
        }
        const targetId = asEncounterTargetId(target['id']);
        if (targetIds.has(targetId)) return { context: empty, reason: 'INVALID_CONTEXT' };
        if ((target['source'] === 'opfor') !== target['readOnly']) {
            return { context: empty, reason: 'INVALID_TARGET_POLICY' };
        }
        targetIds.add(targetId);
    }

    const weapons = new Map<ComponentId, ValidatedWeapon>();
    for (const weapon of context['weapons']) {
        if (!isPlainRecord(weapon)
            || !hasExactKeys(weapon, ['componentId', 'compatibleMunitionKeys', 'sources'])
            || !validId(weapon['componentId'])
            || !Array.isArray(weapon['compatibleMunitionKeys'])
            || weapon['compatibleMunitionKeys'].length > MAX_ATTACKER_MUNITIONS_PER_WEAPON
            || !Array.isArray(weapon['sources'])
            || weapon['sources'].length > MAX_ATTACKER_AMMO_SOURCES_PER_WEAPON) {
            return { context: empty, reason: 'INVALID_CONTEXT' };
        }
        const weaponId = asComponentId(weapon['componentId']);
        if (weapons.has(weaponId)) return { context: empty, reason: 'INVALID_CONTEXT' };
        const compatibleMunitions = stringSet(weapon['compatibleMunitionKeys']);
        if (!compatibleMunitions) return { context: empty, reason: 'INVALID_CONTEXT' };
        const sources = new Map<ComponentId, ReadonlySet<string>>();
        for (const source of weapon['sources']) {
            if (!isPlainRecord(source)
                || !hasExactKeys(source, ['componentId', 'munitionKeys'])
                || !validId(source['componentId'])
                || !Array.isArray(source['munitionKeys'])
                || source['munitionKeys'].length > MAX_ATTACKER_MUNITIONS_PER_WEAPON) {
                return { context: empty, reason: 'INVALID_CONTEXT' };
            }
            const sourceId = asComponentId(source['componentId']);
            if (sources.has(sourceId)) return { context: empty, reason: 'INVALID_CONTEXT' };
            const sourceMunitions = stringSet(source['munitionKeys']);
            if (!sourceMunitions
                || [...sourceMunitions].some(munition => !compatibleMunitions.has(munition))) {
                return { context: empty, reason: 'INVALID_CONTEXT' };
            }
            sources.set(sourceId, sourceMunitions);
        }
        weapons.set(weaponId, Object.freeze({
            compatibleMunitions,
            sources: new ImmutableIndex(sources),
        }));
    }
    const actions = new Map<string, AttackerActionTarget>();
    for (const candidate of context['actions']) {
        let target: AttackerActionTarget;
        try {
            target = canonicalActionTarget(candidate);
        } catch {
            return { context: empty, reason: 'INVALID_CONTEXT' };
        }
        const key = attackerActionTargetKey(target);
        if (actions.has(key)) return { context: empty, reason: 'INVALID_CONTEXT' };
        actions.set(key, target);
    }
    return {
        context: Object.freeze({
            targetIds: new ImmutableSet(targetIds),
            weapons: new ImmutableIndex(weapons),
            actions: new ImmutableIndex(actions),
        }),
    };
}

function canonicalComponentState(
    component: AttackerComponentState,
): AttackerComponentState | null {
    if (!isPlainRecord(component) || !hasExactKeys(component, ['selection', 'ammo'])) {
        throw new Error('Invalid targeting component state');
    }
    const selectionResult = component.selection === undefined
        ? {}
        : canonicalSelection(component.selection);
    if (selectionResult.reason) throw new Error('Invalid targeting component selection');

    let ammo: AttackerAmmoSelection | undefined;
    if (component.ammo !== undefined) {
        if (!isPlainRecord(component.ammo)
            || !hasExactKeys(component.ammo, ['munitionKey', 'preferredSourceId'])
            || !validCanonicalText(component.ammo.munitionKey)
            || (component.ammo.preferredSourceId !== undefined
                && !validId(component.ammo.preferredSourceId))) {
            throw new Error('Invalid targeting ammo selection');
        }
        ammo = Object.freeze({
            munitionKey: component.ammo.munitionKey,
            ...(component.ammo.preferredSourceId === undefined
                ? {}
                : { preferredSourceId: component.ammo.preferredSourceId }),
        });
    }
    const selection = selectionResult.selection;
    if (!selection && !ammo) return null;
    return Object.freeze({
        ...(selection && { selection }),
        ...(ammo && { ammo }),
    });
}

function canonicalSelection(selection: AttackerSelection): {
    readonly selection?: AttackerSelection;
    readonly reason?: 'INVALID_COMMAND' | 'INVALID_TARGET' | 'INVALID_RANGE';
} {
    if (!isPlainRecord(selection) || typeof selection.kind !== 'string') {
        return { reason: 'INVALID_COMMAND' };
    }
    switch (selection.kind) {
        case 'selected':
            return hasExactKeys(selection, ['kind'])
                ? { selection: Object.freeze({ kind: 'selected' }) }
                : { reason: 'INVALID_COMMAND' };
        case 'target':
            return hasExactKeys(selection, ['kind', 'targetId']) && validId(selection.targetId)
                ? { selection: Object.freeze({ kind: 'target', targetId: selection.targetId }) }
                : { reason: 'INVALID_TARGET' };
        case 'manual-range':
            return hasExactKeys(selection, ['kind', 'range']) && validRange(selection.range)
                ? { selection: Object.freeze({ kind: 'manual-range', range: selection.range }) }
                : { reason: 'INVALID_RANGE' };
        default:
            return { reason: 'INVALID_COMMAND' };
    }
}

function canonicalTargetFacts(
    facts: AttackerLocalTargetState,
): AttackerLocalTargetState | null {
    if (!isPlainRecord(facts)
        || !hasExactKeys(facts, ['distance', 'c3Distance', 'useC3', 'calculator', 'manualTnOverride'])) {
        throw new Error('Invalid attacker-local target facts');
    }
    if (facts.distance !== undefined && !validDistance(facts.distance)) {
        throw new Error('Invalid target distance');
    }
    if (facts.c3Distance !== undefined && !validDistance(facts.c3Distance)) {
        throw new Error('Invalid C3 distance');
    }
    if (facts.useC3 !== undefined && facts.useC3 !== true) {
        throw new Error('Invalid C3 selection');
    }
    const calculator = facts.calculator === undefined
        ? undefined
        : canonicalCalculator(facts.calculator);
    if (facts.useC3 === true && facts.c3Distance === undefined) {
        throw new Error('C3 use requires an exact distance');
    }
    if (facts.useC3 === true && calculator?.indirectFire === true) {
        throw new Error('C3 and indirect fire are incompatible');
    }

    let manualTnOverride: AttackerManualTnOverride | undefined;
    if (facts.manualTnOverride !== undefined) {
        if (!isPlainRecord(facts.manualTnOverride)
            || !hasExactKeys(facts.manualTnOverride, ['kind', 'modifier'])
            || facts.manualTnOverride.kind !== 'user-manual'
            || !validManualModifier(facts.manualTnOverride.modifier)) {
            throw new Error('Invalid manual TN override');
        }
        manualTnOverride = Object.freeze({ ...facts.manualTnOverride });
    }

    const distance = facts.distance === DEFAULT_ATTACKER_TARGET_DISTANCE
        ? undefined
        : facts.distance;
    if (distance === undefined
        && facts.c3Distance === undefined
        && facts.useC3 === undefined
        && calculator === undefined
        && manualTnOverride === undefined) return null;
    return Object.freeze({
        ...(distance !== undefined && { distance }),
        ...(facts.c3Distance !== undefined && { c3Distance: facts.c3Distance }),
        ...(facts.useC3 === true && { useC3: true as const }),
        ...(calculator && { calculator }),
        ...(manualTnOverride && { manualTnOverride }),
    });
}

function canonicalCalculator(
    calculator: AttackerLocalCalculatorInputs,
): AttackerLocalCalculatorInputs | undefined {
    if (!isPlainRecord(calculator)
        || !hasExactKeys(calculator, [
            'interveningWoods', 'partialCover', 'attackDirection', 'indirectFire',
            'secondaryTarget', 'secondaryTargetSideBack', 'spotterMoveMode',
            'spotterDeclaredAttacks', 'customModifier',
        ])) throw new Error('Invalid local target calculator');
    if (calculator.interveningWoods !== undefined
        && calculator.interveningWoods !== 'light1'
        && calculator.interveningWoods !== 'light2') throw new Error('Invalid intervening woods');
    if (calculator.partialCover !== undefined && calculator.partialCover !== true) {
        throw new Error('Invalid partial cover');
    }
    if (calculator.attackDirection !== undefined
        && calculator.attackDirection !== 'left'
        && calculator.attackDirection !== 'rear'
        && calculator.attackDirection !== 'right') throw new Error('Invalid attack direction');
    for (const value of [
        calculator.indirectFire,
        calculator.secondaryTarget,
        calculator.secondaryTargetSideBack,
        calculator.spotterDeclaredAttacks,
    ]) {
        if (value !== undefined && value !== true) throw new Error('Invalid sparse calculator boolean');
    }
    if (calculator.spotterMoveMode !== undefined
        && calculator.spotterMoveMode !== 'walk'
        && calculator.spotterMoveMode !== 'run'
        && calculator.spotterMoveMode !== 'jump') throw new Error('Invalid spotter movement');
    if (calculator.customModifier !== undefined
        && (!Number.isSafeInteger(calculator.customModifier)
            || calculator.customModifier < TN_CUSTOM_MODIFIER_MIN
            || calculator.customModifier > TN_CUSTOM_MODIFIER_MAX)) {
        throw new Error('Invalid custom target modifier');
    }
    if (calculator.secondaryTarget === true && calculator.secondaryTargetSideBack === true) {
        throw new Error('Secondary-target modes are mutually exclusive');
    }
    if (calculator.indirectFire !== true
        && (calculator.spotterMoveMode !== undefined
            || calculator.spotterDeclaredAttacks !== undefined)) {
        throw new Error('Spotter facts require indirect fire');
    }
    const canonical: AttackerLocalCalculatorInputs = {
        ...(calculator.interveningWoods === undefined
            ? {}
            : { interveningWoods: calculator.interveningWoods }),
        ...(calculator.partialCover === true ? { partialCover: true as const } : {}),
        ...(calculator.attackDirection === undefined
            ? {}
            : { attackDirection: calculator.attackDirection }),
        ...(calculator.indirectFire === true ? { indirectFire: true as const } : {}),
        ...(calculator.secondaryTarget === true ? { secondaryTarget: true as const } : {}),
        ...(calculator.secondaryTargetSideBack === true
            ? { secondaryTargetSideBack: true as const }
            : {}),
        ...(calculator.spotterMoveMode === undefined
            ? {}
            : { spotterMoveMode: calculator.spotterMoveMode }),
        ...(calculator.spotterDeclaredAttacks === true
            ? { spotterDeclaredAttacks: true as const }
            : {}),
        ...(calculator.customModifier === undefined || calculator.customModifier === 0
            ? {}
            : { customModifier: calculator.customModifier }),
    };
    return Object.keys(canonical).length === 0
        ? undefined
        : Object.freeze(canonical);
}

function putComponentState(
    components: Map<ComponentId, AttackerComponentState>,
    componentId: ComponentId,
    component: AttackerComponentState,
): void {
    const canonical = canonicalComponentState(component);
    if (canonical) components.set(componentId, canonical);
    else components.delete(componentId);
}

/** Canonical identity shared by the runtime state, record sheet, and codec. */
export function attackerActionTargetKey(target: AttackerActionTarget): string {
    const canonical = canonicalActionTarget(target);
    return canonical.kind === 'component'
        ? `component\u0000${canonical.componentId}`
        : `intrinsic\u0000${canonical.actionId}`;
}

export function attackerActionSelection(
    state: AttackerTargetingState,
    target: AttackerActionTarget,
): AttackerActionSelection | undefined {
    return state.actions.get(attackerActionTargetKey(target))?.selection;
}

function canonicalActionTarget(target: unknown): AttackerActionTarget {
    if (!isPlainRecord(target) || typeof target['kind'] !== 'string') {
        throw new Error('Invalid targeting action target');
    }
    if (target['kind'] === 'component'
        && hasExactKeys(target, ['kind', 'componentId'])
        && validId(target['componentId'])) {
        return Object.freeze({ kind: 'component', componentId: asComponentId(target['componentId']) });
    }
    if (target['kind'] === 'intrinsic'
        && hasExactKeys(target, ['kind', 'actionId'])
        && validId(target['actionId'])) {
        return Object.freeze({ kind: 'intrinsic', actionId: target['actionId'] });
    }
    throw new Error('Invalid targeting action target');
}

function cloneSelection(selection: AttackerSelection): AttackerSelection {
    return Object.freeze({ ...selection });
}

function cloneActionSelection(selection: AttackerActionSelection): AttackerActionSelection {
    return Object.freeze({ ...selection });
}

function cloneTargetFacts(facts: AttackerLocalTargetState): AttackerLocalTargetState {
    return Object.freeze({
        ...facts,
        ...(facts.calculator && { calculator: Object.freeze({ ...facts.calculator }) }),
        ...(facts.manualTnOverride && {
            manualTnOverride: Object.freeze({ ...facts.manualTnOverride }),
        }),
    });
}

function rejectedPlan(
    state: AttackerTargetingState,
    reason: AttackerTargetingRejectionReason,
): AttackerTargetingPlanResult {
    return Object.freeze({ accepted: false, changed: false, reason, state });
}

function rejectedReduction(
    state: AttackerTargetingState,
    reason: AttackerTargetingRejectionReason,
): AttackerTargetingReduction {
    return Object.freeze({ accepted: false, changed: false, reason, state });
}

function canonicalStateJson(state: AttackerTargetingState): string {
    return JSON.stringify(serializeAttackerTargetingState(state));
}

function sortedEntries<K extends string, V>(values: ReadonlyMap<K, V>): readonly (readonly [K, V])[] {
    return [...values].sort(([left], [right]) => compareText(left, right));
}

function stringSet(values: readonly unknown[]): ReadonlySet<string> | null {
    const result = new Set<string>();
    for (const value of values) {
        if (!validCanonicalText(value) || result.has(value)) return null;
        result.add(value);
    }
    return new ImmutableSet(result);
}

function validRevision(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validDistance(value: unknown): value is number {
    return typeof value === 'number'
        && Number.isFinite(value)
        && value >= 0
        && value <= MAX_ATTACKER_TARGET_DISTANCE;
}

function validManualModifier(value: unknown): value is number {
    return typeof value === 'number'
        && Number.isFinite(value)
        && Math.abs(value) <= MAX_ATTACKER_MANUAL_TN_MAGNITUDE;
}

function validRange(value: unknown): value is AttackerManualRange {
    return value === 'short' || value === 'medium' || value === 'long' || value === 'extreme';
}

function validCanonicalText(value: unknown): value is string {
    return typeof value === 'string'
        && value.length > 0
        && value.length <= MAX_ATTACKER_TARGETING_TEXT_LENGTH
        && value.trim() === value
        && !value.includes('\0');
}

function validId(value: unknown): value is string {
    return typeof value === 'string'
        && value.trim().length > 0
        && value.length <= MAX_ATTACKER_TARGETING_TEXT_LENGTH
        && !value.includes('\0');
}

function isReadonlyMap(value: unknown): value is ReadonlyMap<unknown, unknown> {
    return value !== null
        && typeof value === 'object'
        && typeof (value as ReadonlyMap<unknown, unknown>).entries === 'function'
        && typeof (value as ReadonlyMap<unknown, unknown>).get === 'function'
        && typeof (value as ReadonlyMap<unknown, unknown>).has === 'function'
        && typeof (value as ReadonlyMap<unknown, unknown>).size === 'number';
}

function hasExactKeys(value: object, allowed: readonly string[]): boolean {
    const allowedKeys = new Set(allowed);
    return Object.keys(value).every(key => allowedKeys.has(key));
}
