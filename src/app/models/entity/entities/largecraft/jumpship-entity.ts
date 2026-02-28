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

import { Signal, computed, signal } from '@angular/core';
import { AeroEntity } from '../aero/aero-entity';
import {
  EntityType,
  EntityValidationMessage,
  LARGE_CRAFT_LOCATIONS,
  StructureType,
} from '../../types';

// ============================================================================
// JumpShip equipment location tags
// ============================================================================

const JUMPSHIP_EQUIP_LOCS = [
  'Nose', 'FLS', 'FRS', 'ALS', 'ARS', 'Aft', 'Hull',
] as const;

// ============================================================================
// JumpShipEntity — KF-drive capital ships
// ============================================================================

export class JumpShipEntity extends AeroEntity {
  override readonly entityType: EntityType = 'JumpShip';

  // ═══════════════════════════════════════════════════════════════════════════
  //  SIGNALS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── JumpShip specifics ──
  designType = signal<number>(0);
  sail = signal<boolean>(true);
  jumpRange = signal<number>(-1);
  dockingCollars = signal<number>(0);
  gravDecks = signal<number[]>([]);
  lithiumFusion = signal<boolean>(false);
  hpg = signal<boolean>(false);

  // ── Crew ──
  crew = signal<number>(0);
  officers = signal<number>(0);
  gunners = signal<number>(0);
  passengers = signal<number>(0);
  marines = signal<number>(0);
  battleArmor = signal<number>(0);
  lifeboats = signal<number>(0);
  escapePods = signal<number>(0);

  // ═══════════════════════════════════════════════════════════════════════════
  //  LOCATION OVERRIDES
  // ═══════════════════════════════════════════════════════════════════════════

  get locationOrder(): readonly string[] {
    return LARGE_CRAFT_LOCATIONS;
  }

  get equipLocations(): readonly string[] {
    return [...JUMPSHIP_EQUIP_LOCS];
  }

  get validLocations(): ReadonlySet<string> {
    return new Set([...LARGE_CRAFT_LOCATIONS, 'Hull']);
  }

  override hasRearArmor(_loc: string): boolean {
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ABSTRACT IMPLEMENTATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  protected override computeExpectedEngineRating(): number | null {
    return null; // JumpShips use KF drives, not standard engines
  }

  protected override computeStructureValues(
    _tonnage: number, _structureType: StructureType,
  ): Map<string, number> {
    const values = new Map<string, number>();
    const si = this.structuralIntegrity();
    for (const loc of this.locationOrder) {
      values.set(loc, si);
    }
    return values;
  }

  protected override computeMaxArmor(
    _structureValues: Map<string, number>,
  ): Map<string, number> {
    const maxPerLoc = this.tonnage();
    const maxArmor = new Map<string, number>();
    for (const loc of this.locationOrder) {
      maxArmor.set(loc, maxPerLoc);
    }
    return maxArmor;
  }

  // ── Validation ────────────────────────────────────────────────────────

  protected override typeSpecificValidation: Signal<EntityValidationMessage[]> = computed(() => {
    const msgs: EntityValidationMessage[] = [];

    if (this.structuralIntegrity() <= 0) {
      msgs.push({
        severity: 'warning', category: 'structure', code: 'JS_NO_SI',
        message: 'JumpShip has no structural integrity',
      });
    }

    return msgs;
  });
}
