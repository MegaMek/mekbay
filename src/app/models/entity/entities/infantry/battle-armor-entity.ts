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
import {
  EntityType,
  EntityValidationMessage,
  StructureType,
} from '../../types';
import { InfantryEntity } from './infantry-entity';

// ============================================================================
// BattleArmorEntity — powered-armor squads (Elemental, etc.)
// ============================================================================

export class BattleArmorEntity extends InfantryEntity {
  override readonly entityType: EntityType = 'BattleArmor';

  // ═══════════════════════════════════════════════════════════════════════════
  //  SIGNALS
  // ═══════════════════════════════════════════════════════════════════════════

  trooperCount = signal<number>(4);
  weightClass = signal<string>('Medium');
  chassisType = signal<string>('Biped');
  jumpingMP = signal<number>(0);
  apMounts = signal<number>(0);
  dwpCapacity = signal<number>(0);
  sswmCapacity = signal<number>(0);
  costKC = signal<number>(0);

  /** Quad BA turret config, e.g. "Modular:3" or "Standard:2" */
  turretConfig = signal<string>('');
  /** Whether this unit is an exoskeleton */
  isExoskeleton = signal<boolean>(false);
  /** Raw armor_tech code (TechConstants value) for BLK round-trip */
  armorTechCode = signal<number>(0);
  /** Squad equipment tag: 'Squad' (modern) or 'Point' (legacy) for BLK round-trip */
  squadEquipmentTag = signal<'Squad' | 'Point'>('Squad');

  // ═══════════════════════════════════════════════════════════════════════════
  //  LOCATION OVERRIDES
  // ═══════════════════════════════════════════════════════════════════════════

  override get locationOrder(): readonly string[] {
    const locs: string[] = ['Squad'];
    for (let i = 1; i <= this.trooperCount(); i++) {
      locs.push(`Trooper ${i}`);
    }
    return locs;
  }

  override get validLocations(): ReadonlySet<string> {
    return new Set(this.locationOrder);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ABSTRACT IMPLEMENTATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  protected override computeStructureValues(
    _tonnage: number, _structureType: StructureType,
  ): Map<string, number> {
    const values = new Map<string, number>();
    values.set('Squad', this.trooperCount());
    for (let i = 1; i <= this.trooperCount(); i++) {
      values.set(`Trooper ${i}`, 1);
    }
    return values;
  }

  protected override computeMaxArmor(
    _structureValues: Map<string, number>,
  ): Map<string, number> {
    // BA armor points depend on weight class
    const maxPerTrooper: Record<string, number> = {
      'PA(L)': 2, 'Light': 5, 'Medium': 8, 'Heavy': 10, 'Assault': 14,
    };
    const mx = maxPerTrooper[this.weightClass()] ?? 8;
    const maxArmor = new Map<string, number>();
    for (let i = 1; i <= this.trooperCount(); i++) {
      maxArmor.set(`Trooper ${i}`, mx);
    }
    return maxArmor;
  }

  // ── Validation ────────────────────────────────────────────────────────

  protected override typeSpecificValidation: Signal<EntityValidationMessage[]> = computed(() => {
    const msgs: EntityValidationMessage[] = [];

    if (this.trooperCount() < 1 || this.trooperCount() > 6) {
      msgs.push({
        severity: 'error', category: 'general', code: 'BA_TROOPER_COUNT',
        message: `Trooper count ${this.trooperCount()} is out of range (1-6)`,
      });
    }

    return msgs;
  });
}
