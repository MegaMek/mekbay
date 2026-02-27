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
  InfantrySpecialization,
  StructureType,
} from '../../types';

// ============================================================================
// InfantryEntity — conventional infantry platoons
// ============================================================================

export class InfantryEntity extends BaseEntity {
  override readonly entityType: EntityType = 'Infantry';

  // ═══════════════════════════════════════════════════════════════════════════
  //  SIGNALS
  // ═══════════════════════════════════════════════════════════════════════════

  squadSize = signal<number>(0);
  squadCount = signal<number>(0);
  primaryWeapon = signal<string>('');
  secondaryWeapon = signal<string>('');
  secondaryCount = signal<number>(0);
  armorDivisor = signal<number>(1);
  armorKit = signal<string>('');
  motionType = signal<string>('Leg');
  antimek = signal<boolean>(false);

  // Infantry-specific armor / stealth booleans
  encumberingArmor = signal<boolean>(false);
  spaceSuit = signal<boolean>(false);
  hasDEST = signal<boolean>(false);
  sneakCamo = signal<boolean>(false);
  sneakIR = signal<boolean>(false);
  sneakECM = signal<boolean>(false);

  // Manei Domini augmentations (pilot option names)
  augmentations = signal<string[]>([]);

  // Prosthetic Enhancement (Enhanced Limbs) — IO p.84
  prostheticEnhancement1 = signal<string>('');
  prostheticEnhancement1Count = signal<number>(0);
  prostheticEnhancement2 = signal<string>('');
  prostheticEnhancement2Count = signal<number>(0);
  extraneousPair1 = signal<string>('');
  extraneousPair2 = signal<string>('');

  specializations = signal<Set<InfantrySpecialization>>(new Set());

  // ═══════════════════════════════════════════════════════════════════════════
  //  LOCATION OVERRIDES
  // ═══════════════════════════════════════════════════════════════════════════

  get locationOrder(): readonly string[] {
    return ['Infantry'];
  }

  get validLocations(): ReadonlySet<string> {
    return new Set(['Infantry', 'Field Guns']);
  }

  override hasRearArmor(_loc: string): boolean {
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ABSTRACT IMPLEMENTATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  protected override computeExpectedEngineRating(): number | null {
    return null; // Infantry have no engine
  }

  protected override computeStructureValues(
    _tonnage: number, _structureType: StructureType,
  ): Map<string, number> {
    const values = new Map<string, number>();
    values.set('Infantry', this.squadSize() * this.squadCount());
    return values;
  }

  protected override computeMaxArmor(
    _structureValues: Map<string, number>,
  ): Map<string, number> {
    return new Map(); // Infantry armor is handled differently
  }

  // ── Validation ────────────────────────────────────────────────────────

  protected override typeSpecificValidation: Signal<EntityValidationMessage[]> = computed(() => {
    const msgs: EntityValidationMessage[] = [];

    if (this.squadSize() <= 0) {
      msgs.push({
        severity: 'error', category: 'general', code: 'INF_NO_SQUAD_SIZE',
        message: 'Infantry squad size must be greater than 0',
      });
    }
    if (this.squadCount() <= 0) {
      msgs.push({
        severity: 'error', category: 'general', code: 'INF_NO_SQUAD_COUNT',
        message: 'Infantry must have at least one squad',
      });
    }

    return msgs;
  });
}
