/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { WritableSignal } from '@angular/core';
import { EntityMountedEquipment } from '../types';

// ============================================================================
// Immutable signal update helpers
//
// All signal values in the entity system are treated as immutable snapshots.
// These helpers create new Array / Map instances on every write, ensuring
// Angular's signal equality check detects the change and downstream computeds
// re-evaluate correctly.
// ============================================================================

/**
 * Replace the value of a signal holding a `Map`, always producing a new Map.
 *
 * @param sig    The signal to update
 * @param mutate A callback that receives a fresh **copy** of the current Map.
 *               Mutate the copy in-place — the helper will set it back.
 */
export function updateMap<K, V>(
  sig: WritableSignal<Map<K, V>>,
  mutate: (draft: Map<K, V>) => void,
): void {
  sig.update(prev => {
    const next = new Map(prev);
    mutate(next);
    return next;
  });
}

/**
 * Replace the value of a signal holding an `Array`, always producing a new array.
 *
 * @param sig    The signal to update
 * @param mutate A callback that receives a shallow **copy** of the current array.
 */
export function updateArray<T>(
  sig: WritableSignal<T[]>,
  mutate: (draft: T[]) => void,
): void {
  sig.update(prev => {
    const next = [...prev];
    mutate(next);
    return next;
  });
}

/**
 * Insert or replace a mount in an equipment signal, matched by `mountId`.
 * If no match is found, the mount is appended.
 */
export function upsertMount(
  sig: WritableSignal<EntityMountedEquipment[]>,
  mount: EntityMountedEquipment,
): void {
  sig.update(list => {
    const idx = list.findIndex(m => m.mountId === mount.mountId);
    const next = [...list];
    if (idx >= 0) {
      next[idx] = mount;
    } else {
      next.push(mount);
    }
    return next;
  });
}

/**
 * Remove a mount from an equipment signal by `mountId`.
 */
export function removeMountById(
  sig: WritableSignal<EntityMountedEquipment[]>,
  mountId: string,
): void {
  sig.update(list => list.filter(m => m.mountId !== mountId));
}

// ============================================================================
// Mount ID generation
// ============================================================================

let nextMountId = 1;

/** Generate a unique mount ID. IDs are unique within a JS session. */
export function generateMountId(): string {
  return `m${nextMountId++}`;
}

/** Reset the mount ID counter (useful in tests / between parse calls). */
export function resetMountIdCounter(): void {
  nextMountId = 1;
}
