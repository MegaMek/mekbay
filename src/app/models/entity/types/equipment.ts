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

import { Equipment } from '../../equipment.model';

// ============================================================================
// Mount Placement — Mek crit slot positions
//
// Each placement anchors one crit of an equipment mount to a specific
// (location, slot-index) pair.  Together with the system template, these
// derive the crit-slot grid without a separate editable signal.
// ============================================================================

/** A single crit-slot assignment for a Mek equipment mount */
export interface MountPlacement {
  readonly location: string;
  readonly slotIndex: number;
}

// ============================================================================
// Mounted Equipment — the single canonical equipment model
//
// The entity's `equipment` signal is the sole source of truth for what is
// installed.  Mek critical-slot grids and location inventories are DERIVED
// from this list; they are never independently editable.
// ============================================================================

export interface EntityMountedEquipment {
  /** Stable unique identifier within this entity */
  readonly mountId: string;

  /** Internal name — lookup key into the equipment DB */
  equipmentId: string;

  /** Resolved reference (set after parse / on equipment DB load) */
  equipment?: Equipment;

  /** Primary location code (canonical ID) */
  location: string;

  /**
   * Mek only: explicit crit-slot assignments for this mount.
   * The array length equals the number of crits the equipment occupies.
   * Non-Mek entity types leave this undefined.
   */
  placements?: readonly MountPlacement[];

  /** Number of crits occupied (equals placements.length for Meks) */
  criticalSlots?: number;

  /** Rear-mounted */
  rearMounted: boolean;

  /** Turret-mounted (Mek head turret) */
  turretMounted: boolean;

  /** Vehicle turret type */
  turretType?: 'standard' | 'sponson' | 'pintle';

  /** OmniPod equipped */
  omniPodMounted: boolean;

  /** Component armored */
  armored: boolean;

  /** VGL facing (0–5) */
  facing?: number;

  /** Variable-size equipment size */
  size?: number;

  /** Split weapon tracking (Mek: crits span multiple locations) */
  isSplit?: boolean;

  /** BA mount location */
  baMountLocation?: 'Body' | 'LA' | 'RA' | 'Turret';

  /** Detachable Weapon Pack */
  isDWP?: boolean;

  /** Squad Support Weapon Mount */
  isSSWM?: boolean;

  /** Anti-Personnel Mount weapon */
  isAPM?: boolean;

  /** Ammo: shot count */
  shotsLeft?: number;

  /** Weapon bay members (large craft) */
  bayWeapons?: number[];

  /** Weapon bay ammo (large craft) */
  bayAmmo?: number[];

  /** Starts a new weapon bay (large craft) */
  isNewBay?: boolean;

  /** Combined slot — second equipment in same slot (superheavy Mek) */
  secondEquipmentId?: string;
  secondEquipment?: Equipment;
}
