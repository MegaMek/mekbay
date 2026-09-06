// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ComponentId } from '../entity/entity-identifiers';
import { ImmutableIndex } from '../entity/immutable-collections';
import type { EquipmentStatus } from '../equipment-status.model';
import type { CBTUnitRuntimeState } from './cbt-unit-runtime';
import type { ComponentRuntimeState } from './runtime-state';

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
