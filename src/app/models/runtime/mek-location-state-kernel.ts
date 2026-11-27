// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { LocationId } from '../entity/entity-identifiers';
import type { LocationRuntimeState } from './runtime-state';
interface MekLocationTopology {
    readonly locations: ReadonlyMap<LocationId, Readonly<{
        readonly id: LocationId;
        readonly code: string;
        readonly internalPoints: number;
    }>>;
    readonly destructionParentLocationIdByLocation: ReadonlyMap<LocationId, LocationId | null>;
}

export interface MekLocationPhysicalStateView {
    internalDamage(locationId: LocationId): number;
    blownOff(locationId: LocationId): boolean;
}

/** Stable dependent-destruction lookup shared by every Mek runtime-state boundary. */
export function mekLocationDestructionParentId(
    index: MekLocationTopology,
    locationId: LocationId,
): LocationId | null {
    return index.locations.has(locationId)
        ? index.destructionParentLocationIdByLocation.get(locationId) ?? null
        : null;
}

/**
 * Physical loss is committed internal depletion or `blown-off`, inherited from
 * a lost parent. Flooding is deliberately not physical destruction.
 */
export function isMekLocationPhysicallyDestroyed(
    index: MekLocationTopology,
    locations: ReadonlyMap<LocationId, LocationRuntimeState>,
    locationId: LocationId,
): boolean {
    return isMekLocationPhysicallyDestroyedFromView(index, locationId, {
        internalDamage: id => locations.get(id)?.internalDamage ?? 0,
        blownOff: id => (locations.get(id)?.conditions.get('blown-off') ?? 0) > 0,
    });
}

export function isMekLocationPhysicallyDestroyedFromView(
    index: MekLocationTopology,
    locationId: LocationId,
    view: MekLocationPhysicalStateView,
): boolean {
    return isPhysicallyDestroyed(index, locationId, view, new Set());
}

function isPhysicallyDestroyed(
    index: MekLocationTopology,
    locationId: LocationId,
    view: MekLocationPhysicalStateView,
    visited: Set<LocationId>,
): boolean {
    const definition = index.locations.get(locationId);
    if (!definition || visited.has(locationId)) return false;
    visited.add(locationId);
    if (view.blownOff(locationId)
        || view.internalDamage(locationId) >= definition.internalPoints) return true;
    const parentId = mekLocationDestructionParentId(index, locationId);
    return parentId !== null && isPhysicallyDestroyed(index, parentId, view, visited);
}
