// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ComponentId } from '../entity/entity-identifiers';
import { ImmutableIndex } from '../entity/immutable-collections';
import type { EquipmentStatus } from '../equipment-status.model';
import type { CBTUnitRuntimeState } from './cbt-unit-runtime';
import type { AmmoRuntimeState,ComponentRuntimeState } from './runtime-state';

export interface ComponentStateChangeResult {
    readonly accepted: boolean;
    readonly changed: boolean;
}

export function unchangedComponentState(): ComponentStateChangeResult {
    return Object.freeze({ accepted: true, changed: false });
}

export function componentStateChangeFromReduction(reduction: ComponentStateChangeResult): ComponentStateChangeResult {
    return Object.freeze({
        accepted: reduction.accepted,
        changed: reduction.changed,
    });
}

/** Default modes remain implicit; all other component lifecycle facts survive the edit. */
export function withComponentMode<State extends CBTUnitRuntimeState>(
    state: State, componentId: ComponentId, mode: string, defaultMode: string | undefined,
): State | null {
    const current = state.components.get(componentId);
    if ((current?.mode ?? defaultMode) === mode) return null;
    const components = new Map(state.components);
    if (mode === defaultMode) {
        const { mode: _removed, ...remaining } = current ?? {};
        if (Object.keys(remaining).length === 0) components.delete(componentId);
        else components.set(componentId, Object.freeze(remaining));
    } else {
        components.set(componentId, Object.freeze({ ...current, mode }));
    }
    return { ...state, components: new ImmutableIndex(components) };
}

/** Jamming is sparse `true`; callers validate that the equipment can jam under the ruleset. */
export function withComponentJammed<State extends CBTUnitRuntimeState>(
    state: State, componentId: ComponentId, jammed: boolean,
): State | null {
    const current = state.components.get(componentId) ?? {};
    if ((current.jammed ?? false) === jammed) return null;
    const components = new Map(state.components);
    if (jammed) {
        components.set(componentId, Object.freeze({ ...current, jammed: true }));
    } else {
        const { jammed: _removed, ...remaining } = current;
        if (Object.keys(remaining).length === 0) components.delete(componentId);
        else components.set(componentId, Object.freeze(remaining));
    }
    return { ...state, components: new ImmutableIndex(components) };
}

/** Adds spent shots to sparse ammo rows; callers validate each source's capacity. */
export function withAmmoShotsSpent<State extends CBTUnitRuntimeState>(
    state: State, spends: Iterable<readonly [ComponentId, number]>,
): State {
    const ammo = new Map(state.ammo);
    for (const [componentId, amount] of spends) {
        const current = ammo.get(componentId);
        ammo.set(componentId, Object.freeze({ ...current, shotsSpent: (current?.shotsSpent ?? 0) + amount }));
    }
    return { ...state, ammo: new ImmutableIndex(ammo) };
}

/**
 * Configures one ammunition source. The default munition stays implicit, an
 * omitted hot-load request keeps the current setting, and a pristine row is
 * deleted. Callers validate the munition, capacity and hot-load permission.
 */
export function withAmmoConfiguration<State extends CBTUnitRuntimeState>(
    state: State,
    componentId: ComponentId,
    configuration: Readonly<{
        munitionKey: string;
        defaultMunitionKey: string;
        shotsSpent: number;
        hotLoadable: boolean;
        hotLoaded: boolean | undefined;
    }>,
): State | null {
    const current = state.ammo.get(componentId);
    const hotLoaded = configuration.hotLoadable && (configuration.hotLoaded ?? current?.hotLoaded ?? false);
    const next: AmmoRuntimeState = Object.freeze({
        shotsSpent: configuration.shotsSpent,
        ...(configuration.munitionKey === configuration.defaultMunitionKey
            ? {}
            : { munitionOverride: configuration.munitionKey }),
        ...(hotLoaded ? { hotLoaded: true as const } : {}),
    });
    if ((current?.shotsSpent ?? 0) === next.shotsSpent
        && current?.munitionOverride === next.munitionOverride
        && current?.hotLoaded === next.hotLoaded) return null;
    const ammo = new Map(state.ammo);
    if (next.shotsSpent === 0 && next.munitionOverride === undefined && !next.hotLoaded) ammo.delete(componentId);
    else ammo.set(componentId, next);
    return { ...state, ammo: new ImmutableIndex(ammo) };
}

/** Caller mechanics validate equipment and apply consequences such as capacitor explosions. */
export function withComponentStatuses<State extends CBTUnitRuntimeState>(
    state: State, componentIds: readonly ComponentId[], status: EquipmentStatus,
): State | null {
    let components: Map<ComponentId, ComponentRuntimeState> | undefined;
    for (const componentId of componentIds) {
        const current = (components ?? state.components).get(componentId);
        if ((current?.statusOverride ?? 'available') === status) continue;
        components ??= new Map(state.components);
        if (status === 'available') {
            const { statusOverride: _removed, ...remaining } = current ?? {};
            if (Object.keys(remaining).length === 0) components.delete(componentId);
            else components.set(componentId, Object.freeze(remaining));
        } else {
            components.set(componentId, Object.freeze({ ...current, statusOverride: status }));
        }
    }
    return components === undefined ? null : { ...state, components: new ImmutableIndex(components) };
}

/** A pending repair is explicit until it matches the committed status again. */
export function withPendingComponentStatuses<State extends CBTUnitRuntimeState>(
    state: State, componentIds: readonly ComponentId[], status: EquipmentStatus,
): State | null {
    let componentStatus: Map<ComponentId, EquipmentStatus> | undefined;
    for (const componentId of componentIds) {
        const committed = state.components.get(componentId)?.statusOverride ?? 'available';
        const pending = (componentStatus ?? state.pendingCombat.componentStatus).get(componentId) ?? committed;
        if (pending === status) continue;
        componentStatus ??= new Map(state.pendingCombat.componentStatus);
        if (status === committed) componentStatus.delete(componentId);
        else componentStatus.set(componentId, status);
    }
    return componentStatus === undefined ? null : {
        ...state,
        pendingCombat: Object.freeze({ ...state.pendingCombat, componentStatus: new ImmutableIndex(componentStatus) }),
    };
}
