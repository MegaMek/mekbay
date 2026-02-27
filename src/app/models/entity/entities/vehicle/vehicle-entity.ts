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
  EngineFlag,
  EntityValidationMessage,
  MotiveType,
  SUSPENSION_FACTOR_TABLE,
  TANK_LOCATIONS,
  TANK_LOCATIONS_WITH_DUAL_TURRET,
  TANK_LOCATIONS_WITH_TURRET,
  StructureType,
} from '../../types';

// ============================================================================
// VehicleEntity — abstract base for all combat-vehicle entities
// ============================================================================

export abstract class VehicleEntity extends BaseEntity {

  // ═══════════════════════════════════════════════════════════════════════════
  //  SIGNALS
  // ═══════════════════════════════════════════════════════════════════════════

  override motiveType = signal<MotiveType>('Tracked');
  hasTurret = signal<boolean>(false);
  hasDualTurret = signal<boolean>(false);
  baseChassisTurretWeight = signal<number>(-1);
  baseChassisTurret2Weight = signal<number>(-1);
  baseChassisSponsonPintleWeight = signal<number>(-1);
  fuelType = signal<string>('');
  isTrailer = signal<boolean>(false);
  hasNoControlSystems = signal<boolean>(false);
  extraSeats = signal<number>(0);

  /** cruiseMP is the same as walkMP for vehicles */
  get cruiseMP() { return this.walkMP; }

  // ═══════════════════════════════════════════════════════════════════════════
  //  COMPUTED
  // ═══════════════════════════════════════════════════════════════════════════

  isSuperHeavy = computed(() => {
    const t = this.tonnage();
    switch (this.motiveType()) {
      case 'Tracked':   return t > 100;
      case 'Wheeled':   return t > 80;
      case 'Hover':     return t > 50;
      case 'VTOL':      return t > 30;
      case 'WiGE':      return t > 80;
      case 'Naval':     return t > 300;
      case 'Submarine': return t > 300;
      case 'Hydrofoil': return t > 100;
      default:          return false;
    }
  });

  suspensionFactor = computed(() => {
    const fn = SUSPENSION_FACTOR_TABLE[this.motiveType()];
    return fn ? fn(this.tonnage()) : 0;
  });

  override engineFlags = computed<Set<EngineFlag>>(() => {
    const flags = new Set<EngineFlag>();
    if (this.techBase() === 'Clan' && !this.mixedTech()) flags.add('clan');
    if (this.engineRating() > 400) flags.add('large');
    flags.add('tank');
    if (this.isSuperHeavy()) flags.add('superheavy');
    return flags;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  LOCATION OVERRIDES
  // ═══════════════════════════════════════════════════════════════════════════

  get locationOrder(): readonly string[] {
    if (this.hasDualTurret()) {
      return TANK_LOCATIONS_WITH_DUAL_TURRET;
    }
    if (this.hasTurret()) {
      return TANK_LOCATIONS_WITH_TURRET;
    }
    return TANK_LOCATIONS;
  }

  get validLocations(): ReadonlySet<string> {
    return new Set([...this.locationOrder, 'Body']);
  }

  override hasRearArmor(_loc: string): boolean {
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ABSTRACT IMPLEMENTATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  protected override computeExpectedEngineRating(): number | null {
    return this.walkMP() * this.tonnage();
  }

  protected override computeStructureValues(
    tonnage: number, _structureType: StructureType,
  ): Map<string, number> {
    // Vehicles: each location gets IS = tonnage × 0.1 (simplified)
    const values = new Map<string, number>();
    const is = Math.ceil(tonnage * 0.1);
    for (const loc of this.locationOrder) {
      values.set(loc, is);
    }
    return values;
  }

  protected override computeMaxArmor(
    structureValues: Map<string, number>,
  ): Map<string, number> {
    const maxArmor = new Map<string, number>();
    for (const [loc, isVal] of structureValues) {
      maxArmor.set(loc, isVal * 2);
    }
    return maxArmor;
  }

  // ── Validation ────────────────────────────────────────────────────────

  protected override typeSpecificValidation: Signal<EntityValidationMessage[]> = computed(() => {
    const msgs: EntityValidationMessage[] = [];

    if (this.walkMP() <= 0 && !this.isTrailer()) {
      msgs.push({
        severity: 'warning', category: 'movement', code: 'VEHICLE_NO_CRUISE',
        message: 'Non-trailer vehicle has no cruise MP',
      });
    }

    return msgs;
  });
}
