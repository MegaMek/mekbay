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
import {
  getDualTurretTech,
  OMNI_VEHICLE_TECH,
} from '../../components';
import {
  EngineFlag,
  EngineType,
  EntityValidationMessage,
  LARGE_SUPPORT_TANK_LOCATIONS,
  LARGE_SUPPORT_TANK_LOCATIONS_WITH_DUAL_TURRET,
  LARGE_SUPPORT_TANK_LOCATIONS_WITH_TURRET,
  MotiveType,
  SUSPENSION_FACTOR_TABLE,
  TANK_LOCATIONS,
  TANK_LOCATIONS_WITH_DUAL_TURRET,
  TANK_LOCATIONS_WITH_TURRET,
  VEHICLE_WEIGHT_LIMITS,
  WeightClass,
  TechRatingSource,
  resolveWeightClass,
} from '../../types';
import type { UnitSubtype, UnitType } from '../../types';
import type { Equipment } from '../../../equipment.model';

// ============================================================================
// VehicleEntity - abstract base for all combat-vehicle entities
// ============================================================================

export abstract class VehicleEntity extends BaseEntity {
  abstract override unitType(): UnitType;

  override unitSubtype(): UnitSubtype {
    const subtype = this.isSupportVehicle()
      ? 'Support Vehicle'
      : COMBAT_VEHICLE_MOTIVE_SUBTYPES[this.motiveType()] ?? 'Combat Vehicle';
    return this.withOmniSubtype(subtype);
  }

  override entityTechAdvancements(): readonly TechRatingSource[] {
    const sources: TechRatingSource[] = [this.vehicleConstructionTechAdvancement()];
    if (this.hasDualTurret()) sources.push(getDualTurretTech());
    return sources;
  }

  protected abstract vehicleConstructionTechAdvancement(): TechRatingSource;

  protected override omniTechAdvancement(): TechRatingSource {
    return OMNI_VEHICLE_TECH;
  }

  protected override computeImplicitSystemEquipment(): readonly Equipment[] {
    const implicit = [...super.computeImplicitSystemEquipment()];
    if (!this.equipment().some(mount => mount.turretType === 'sponson')) return implicit;
    const sponsonTurret = this.equipmentRegistry.findForTechBase('SponsonTurret', this.techBase());
    if (sponsonTurret) implicit.push(sponsonTurret);
    return implicit;
  }

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

  override computeWalkMP(options: MovementCalculationOptions): number {
    const equipment = this.equipment();
    let walkMP = this.originalWalkMP();
    if (equipment.some(mount => mount.equipment?.hasFlag('F_HYDROFOIL'))) {
      walkMP = Math.round(walkMP * 1.25);
    }
    if (!options.ignoreModularArmor
      && equipment.some(mount => mount.equipment?.hasFlag('F_MODULAR_ARMOR'))) walkMP--;
    if (equipment.some(mount => mount.equipment?.hasFlag('F_DUNE_BUGGY'))) walkMP--;
    return Math.max(0, walkMP);
  }

  override computeRunMP(options: MovementCalculationOptions): number {
    const walkMP = this.computeWalkMP(options);
    return !options.ignoreMASC
      && this.equipment().some(mount => mount.equipment?.hasFlag('F_MASC'))
      ? walkMP * 2
      : Math.ceil(walkMP * 1.5);
  }

  protected override computeMaximumArmorPoints(): number {
    if (!this.isSupportVehicle()) return Math.floor(this.tonnage() * 3.5 + 40);

    let factor = 0;
    switch (this.motiveType()) {
      case 'Airship':
      case 'Naval':
      case 'Hydrofoil':
      case 'Submarine':
        factor = this.weightClass() === 'Large Support' ? 0.05 : 0.334;
        break;
      case 'WiGE':
      case 'Rail':
      case 'MagLev':
      case 'Station Keeping':
        factor = 0.5;
        break;
      case 'Hover':
      case 'VTOL':
        factor = 1;
        break;
      case 'Tracked':
      case 'Wheeled':
        factor = 2;
        break;
    }
    return 4 + Math.floor(this.tonnage() * factor);
  }

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

  calculatedEngineRating = computed(() => this.calculateEngineRating(this.mountedEngine().type()));

  calculateEngineRating(engineType: EngineType): number {
    let rating = (this.cruiseMP() * Math.trunc(this.tonnage())) - this.suspensionFactor();
    if (this.minimumEngineRating !== null) rating = Math.max(this.minimumEngineRating, rating);
    if (this.zeroCruiseUsesEngineType && this.cruiseMP() === 0) {
      rating = engineType === 'None' ? 0 : 10;
    }
    if (rating % 5 > 0) rating += 5 - (rating % 5);
    return rating;
  }

  protected get minimumEngineRating(): number | null {
    return 10;
  }

  protected get zeroCruiseUsesEngineType(): boolean {
    return true;
  }

  override engineFlags = computed<Set<EngineFlag>>(() => {
    const flags = new Set<EngineFlag>();
    if (this.techBase() === 'Clan' && !this.mixedTech()) flags.add('clan');
    if (this.mountedEngine()?.rating > 400) flags.add('large');
    flags.add('tank');
    if (this.isSuperHeavy()) flags.add('superheavy');
    return flags;
  });

  protected override computeWeightClass(): WeightClass {
    return resolveWeightClass(this.tonnage(), VEHICLE_WEIGHT_LIMITS);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  LOCATION OVERRIDES
  // ═══════════════════════════════════════════════════════════════════════════

  get locationOrder(): readonly string[] {
    if (this.isSuperHeavy()) {
      if (this.hasDualTurret()) return LARGE_SUPPORT_TANK_LOCATIONS_WITH_DUAL_TURRET;
      if (this.hasTurret()) return LARGE_SUPPORT_TANK_LOCATIONS_WITH_TURRET;
      return LARGE_SUPPORT_TANK_LOCATIONS;
    }
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
    return this.calculatedEngineRating();
  }

  protected override computeStructureValues(tonnage: number): Map<string, number> {
    // Vehicles: each location gets IS = tonnage x 0.1 (simplified)
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

const COMBAT_VEHICLE_MOTIVE_SUBTYPES: Partial<Record<MotiveType, string>> = {
  Submarine: 'Submarine',
  Hover: 'Hovercraft',
  Rail: 'Rail Vehicle',
  Naval: 'Naval Vessel',
  Hydrofoil: 'Naval Vessel',
  WiGE: 'WiGE',
};
