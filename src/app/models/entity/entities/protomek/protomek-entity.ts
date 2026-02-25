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
  PROTO_LOCATIONS,
  PROTO_LOCATIONS_WITH_MAIN_GUN,
} from '../../types';

// ============================================================================
// ProtoMekEntity — ProtoMech units (2-15 tons)
// ============================================================================

export class ProtoMekEntity extends BaseEntity {
  override readonly entityType: EntityType = 'ProtoMek';

  // ═══════════════════════════════════════════════════════════════════════════
  //  SIGNALS
  // ═══════════════════════════════════════════════════════════════════════════

  interfaceCockpit = signal<boolean>(false);
  isGlider = signal<boolean>(false);
  isQuad = signal<boolean>(false);

  // ═══════════════════════════════════════════════════════════════════════════
  //  LOCATION OVERRIDES
  // ═══════════════════════════════════════════════════════════════════════════

  get locationOrder(): readonly string[] {
    return this.tonnage() > 9
      ? PROTO_LOCATIONS_WITH_MAIN_GUN
      : PROTO_LOCATIONS;
  }

  get validLocations(): ReadonlySet<string> {
    return new Set([...this.locationOrder, 'Body']);
  }

  override hasRearArmor(loc: string): boolean {
    return loc === 'Torso';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ABSTRACT IMPLEMENTATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  protected override computeExpectedEngineRating(): number | null {
    return this.walkMP() * this.tonnage();
  }

  /**
   * ProtoMek internal structure table (simplified):
   * Head=1 for all, Torso/Legs scale with tonnage, Arms=1-2, Main Gun=1.
   */
  protected override computeStructureValues(
    tonnage: number, _structureType: string,
  ): Map<string, number> {
    const values = new Map<string, number>();
    values.set('Head', 1 + Math.floor(tonnage / 5));
    values.set('Torso', 2 + Math.floor(tonnage / 3));
    values.set('Left Arm', 1 + Math.floor(tonnage / 7));
    values.set('Right Arm', 1 + Math.floor(tonnage / 7));
    values.set('Legs', 2 + Math.floor(tonnage / 4));
    if (tonnage > 9) values.set('Main Gun', 1);
    return values;
  }

  protected override computeMaxArmor(
    structureValues: Map<string, number>,
  ): Map<string, number> {
    const maxArmor = new Map<string, number>();
    for (const [loc, isVal] of structureValues) {
      // Torso can have front + rear (max = IS × 2 total)
      maxArmor.set(loc, loc === 'Torso' ? isVal * 2 : isVal * 2);
    }
    return maxArmor;
  }

  // ── Validation ────────────────────────────────────────────────────────

  protected override typeSpecificValidation: Signal<EntityValidationMessage[]> = computed(() => {
    const msgs: EntityValidationMessage[] = [];

    if (this.tonnage() < 2 || this.tonnage() > 15) {
      msgs.push({
        severity: 'error', category: 'weight', code: 'PROTO_TONNAGE',
        message: `ProtoMek tonnage ${this.tonnage()} is out of range (2-15)`,
      });
    }

    if (this.walkMP() <= 0) {
      msgs.push({
        severity: 'warning', category: 'movement', code: 'PROTO_NO_WALK',
        message: 'ProtoMek has no walk MP',
      });
    }

    return msgs;
  });
}
