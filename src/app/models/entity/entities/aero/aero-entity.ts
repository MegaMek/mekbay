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
import { BaseEntity } from '../../base-entity';
import {
  EntityType,
  EntityValidationMessage,
  HeatSinkType,
  MotiveType,
  StructureType,
} from '../../types';

// ============================================================================
// AeroEntity - abstract base for all aero-type entities
//
// Covers ASF, ConvFighter, FixedWingSupport, SmallCraft, DropShip, etc.
// Non-Mek units have no critical-slot grid - equipment is simply associated
// with a location string.
// ============================================================================

export abstract class AeroEntity extends BaseEntity {
  override readonly entityType: EntityType = 'Aero';

  // ═══════════════════════════════════════════════════════════════════════════
  //  SIGNALS - user / parser inputs
  // ═══════════════════════════════════════════════════════════════════════════

  fuel = signal<number>(0);
  cockpitType = signal<string>('Standard');
  heatSinkType = signal<HeatSinkType>('Single');
  heatSinkCount = signal<number>(0);
  omnipodHeatSinkCount = signal<number>(0);
  structuralIntegrity = signal<number>(0);
  override motiveType = signal<MotiveType>('Aerodyne');

  // walkMP doubles as safeThrust for aero entities
  get safeThrust() { return this.walkMP; }

  // ═══════════════════════════════════════════════════════════════════════════
  //  COMPUTED
  // ═══════════════════════════════════════════════════════════════════════════

  maxThrust = computed(() => Math.ceil(this.walkMP() * 1.5));

  // ═══════════════════════════════════════════════════════════════════════════
  //  ABSTRACT - subclasses define locations
  // ═══════════════════════════════════════════════════════════════════════════

  /** All equipment locations (superset of armor locations) */
  abstract get equipLocations(): readonly string[];

  // ═══════════════════════════════════════════════════════════════════════════
  //  BASE OVERRIDES
  // ═══════════════════════════════════════════════════════════════════════════

  /** Aero units have no rear armor */
  override hasRearArmor(_loc: string): boolean {
    return false;
  }

  protected override computeExpectedEngineRating(): number | null {
    // Aero engine rating is not simply walkMP × tonnage
    return null;
  }

  protected override computeStructureValues(
    _tonnage: number, _structureType: StructureType,
  ): Map<string, number> {
    // For aero, each location gets the structural integrity value
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
    // Rough max: tonnage determines total max armor points
    // Per-location maximums are fairly permissive for aero
    const maxPerLoc = this.tonnage() * 2;
    const maxArmor = new Map<string, number>();
    for (const loc of this.locationOrder) {
      maxArmor.set(loc, maxPerLoc);
    }
    return maxArmor;
  }

  // ── Validation ────────────────────────────────────────────────────────

  protected override typeSpecificValidation: Signal<EntityValidationMessage[]> = computed(() => {
    const msgs: EntityValidationMessage[] = [];

    if (this.fuel() <= 0) {
      msgs.push({
        severity: 'warning', category: 'general', code: 'AERO_NO_FUEL',
        message: 'Aero unit has no fuel',
      });
    }

    if (this.walkMP() <= 0) {
      msgs.push({
        severity: 'error', category: 'movement', code: 'AERO_NO_THRUST',
        message: 'Safe thrust must be greater than 0',
      });
    }

    return msgs;
  });
}
