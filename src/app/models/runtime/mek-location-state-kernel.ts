// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { LocationId } from '../entity/entity-identifiers';
import { getMekLocationParent } from '../entity/types';
import type { LocationRuntimeState } from './runtime-state';
interface MekLocationTopology {
    readonly locations: ReadonlyMap<LocationId, Readonly<{
        readonly id: LocationId;
        readonly code: string;
        readonly internalPoints: number;
    }>>;
}

export interface MekLocationPhysicalStateView {
    internalDamage(locationId: LocationId): number;
    blownOff(locationId: LocationId): boolean;
}

/** Stable entity-topology parent lookup shared by every Mek runtime-state boundary. */
export function mekLocationParentId(
    index: MekLocationTopology,
    locationId: LocationId,
): LocationId | null {
    const location = index.locations.get(locationId);
    if (!location) return null;
    const locations = [...index.locations.values()];
    const parentCode = getMekLocationParent(locations.map(candidate => candidate.code), location.code);
    if (parentCode === null) return null;
    return locations.find(candidate => candidate.code === parentCode)?.id ?? null;
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
    const parentId = mekLocationParentId(index, locationId);
    return parentId !== null && isPhysicallyDestroyed(index, parentId, view, visited);
}
