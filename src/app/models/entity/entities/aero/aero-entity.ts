// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Signal, computed, signal } from '@angular/core';
import { BaseEntity } from '../../base-entity';
import { AERO_COCKPIT_TECH } from '../../components';
import {
  type UnitType,
  type UnitSubtype,
  type MovementCalculationOptions,
  type TechRatingSource,
  AeroCockpitType,
  ASF_WEIGHT_LIMITS,
  EntityType,
  EntityValidationMessage,
  HeatSinkType,
  MotiveType,
  resolveWeightClass,
  WeightClass,
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

  override componentLocationOrder(): readonly string[] {
    return ['Nose', 'Left Wing', 'Right Wing', 'Aft', 'Wings', 'Fuselage'];
  }

  override componentLocationLabel(location: string): string {
    return ({
      Nose: 'NOS', 'Left Wing': 'LWG', 'Right Wing': 'RWG', Aft: 'AFT', Wings: 'WNG', Fuselage: 'FSLG',
    })[location] ?? super.componentLocationLabel(location);
  }

  override unitType(): UnitType {
    return 'Aero';
  }

  abstract override unitSubtype(): UnitSubtype;

  protected override omniTechAdvancement(): TechRatingSource | null {
    // MegaMek includes the Omni system advancement for Inner Sphere
    // OmniFighters, while Clan OmniFighter availability is equipment-derived.
    return this.techBase() === 'IS' ? super.omniTechAdvancement() : null;
  }

  protected override usesLargeEngineTechnology(): boolean {
    return false;
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
