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
import { BaseEntity, MovementCalculationOptions } from '../../base-entity';
import { AERO_COCKPIT_TECH } from '../../components';
import {
  AeroCockpitType,
  ASF_WEIGHT_LIMITS,
  EntityType,
  EntityValidationMessage,
  HeatSinkType,
  MotiveType,
  resolveWeightClass,
  WeightClass,
} from '../../types';
import type { UnitSubtype, UnitType } from '../../types';
import type { TechRatingSource } from '../../types';

// ============================================================================
// AeroEntity - abstract base for all aero-type entities
//
// Covers ASF, ConvFighter, FixedWingSupport, SmallCraft, DropShip, etc.
// Non-Mek units have no critical-slot grid - equipment is simply associated
// with a location string.
// ============================================================================

export abstract class AeroEntity extends BaseEntity {
  override readonly entityType: EntityType = 'Aero';

  override unitType(): UnitType {
    return 'Aero';
  }

  abstract override unitSubtype(): UnitSubtype;

  protected override omniTechAdvancement(): TechRatingSource | null {
    // MegaMek includes the Omni system advancement for Inner Sphere
    // OmniFighters, while Clan OmniFighter availability is equipment-derived.
    return this.techBase() === 'IS' ? super.omniTechAdvancement() : null;
  }

  protected isPrimitiveAero(): boolean {
    return this.cockpitType() === 'Primitive';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SIGNALS - user / parser inputs
  // ═══════════════════════════════════════════════════════════════════════════

  fuel = signal<number>(0);
  cockpitType = signal<AeroCockpitType>('Standard');
  mountedCockpitTech = computed(() => AERO_COCKPIT_TECH[this.cockpitType()]);
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

  override computeWalkMP(options: MovementCalculationOptions): number {
    const modularArmorPenalty = !options.ignoreModularArmor
      && this.equipment().some(
        mount => mount.equipment?.hasFlag('F_MODULAR_ARMOR'),
      ) ? 1 : 0;
    return Math.max(0, this.originalWalkMP() - modularArmorPenalty);
  }

  protected override computeMaximumArmorPoints(): number {
    if (this.entityType === 'ConvFighter') return Math.floor(this.tonnage());
    if (this.entityType === 'Aero') return Math.floor(this.tonnage() * 8);
    if (this.entityType === 'FixedWingSupport') return 4 + Math.floor(this.tonnage());
    return 0;
  }

  maxThrust = computed(() => Math.ceil(this.walkMP() * 1.5));

  autoSetStructuralIntegrity(): void {
    this.structuralIntegrity.set(Math.max(
      Math.floor(this.tonnage() / 10),
      this.originalWalkMP(),
    ));
  }

  override tracksHeat(): boolean {
    return this.entityType === 'Aero' || this.entityType === 'SmallCraft';
  }

  protected override computeHeatDissipation(includeRadical: boolean): number {
    const sinks = this.heatSinkCount();
    let capacity = sinks * (this.heatSinkType() === 'Double' ? 2 : 1);
    if (includeRadical && this.hasEquipmentFlag('F_RADICAL_HEATSINK')) {
      capacity += Math.ceil(sinks * 0.4);
    }
    return capacity;
  }

  protected override computeMaximumHeatDissipation(normal: number): number {
    const sinks = this.heatSinkCount();
    let maximum = normal;
    if (this.hasEquipmentFlag('F_RADICAL_HEATSINK')) maximum += sinks;
    if (this.hasCoolantPod()) maximum += sinks;
    maximum += this.equipment().filter(
      mount => mount.equipment?.hasFlag('F_EMERGENCY_COOLANT_SYSTEM'),
    ).length * 6;
    return maximum;
  }

  override readonly engineHeatSinks = computed(() =>
    this.tracksHeat() ? this.heatSinkCount() : 0
  );

  override readonly engineHeatSinkType = computed<string | null>(() => {
    if (!this.tracksHeat()) return null;
    return this.heatSinkType() === 'Double' ? 'ISDoubleHeatSink' : 'Heat Sink';
  });

  override readonly crewSlotCount = computed<number>(() =>
    this.cockpitType() === 'Command Console' ? 2 : 1
  );

  protected override computeWeightClass(): WeightClass {
    return resolveWeightClass(this.tonnage(), ASF_WEIGHT_LIMITS);
  }

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
    // Aero engine rating is not simply walkMP x tonnage
    return null;
  }

  protected override computeStructureValues(_tonnage: number): Map<string, number> {
    // For aero, each location gets the structural integrity value
    const values = new Map<string, number>();
    const si = this.structuralIntegrity();
    for (const loc of this.locationOrder) {
      values.set(loc, si);
    }
    return values;
  }

  protected override computeTotalInternalPoints(): number {
    return this.structuralIntegrity();
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
