// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed, signal } from '@angular/core';
import { supportVehicleBarRating, type SupportVehicle } from '../support-vehicle';
import {
  AERO_LOCATIONS,
  EntityType,
  FIXED_WING_EQUIP_LOCATIONS,
  type EntityFeature,
  WeightClass,
  resolveSupportVehicleWeightClass,
} from '../../types';
import { isExternalStoresHardpointEquipment } from '../../../aerospace-support-equipment.model';
import { AeroEntity } from './aero-entity';
import type { UnitSubtype } from '../../types';
import type { TechRatingSource } from '../../types';
import { getFixedWingSupportConstructionTech } from '../../components';
import { isVstolEquipment } from '../../../chassis-equipment.model';

/** Fixed Wing Support vehicle - uses BAR rating and tech ratings. */
export class FixedWingSupportEntity extends AeroEntity implements SupportVehicle {
  override readonly entityType: EntityType = 'FixedWingSupport';

  override componentLocationOrder(): readonly string[] {
    return ['Nose', 'Left Wing', 'Right Wing', 'Aft', 'Wings', 'Body'];
  }

  override componentLocationLabel(location: string): string {
    return location === 'Body' ? 'BOD' : super.componentLocationLabel(location);
  }

  override unitSubtype(): UnitSubtype {
    return this.withOmniSubtype('Fixed Wing Support Vehicle');
  }

  readonly barRating = signal(10);
  readonly structuralTechRating = signal(0);
  readonly engineTechRating = signal(0);

  protected override computeAeroFeatures(): readonly EntityFeature[] {
    const features = [...super.computeAeroFeatures()];
    if (this.equipment().some(mount => isVstolEquipment(mount.equipment))) {
      features.push('VSTOL Equipment');
    }
    return features;
  }

  protected override computeEntityFeatures(): readonly EntityFeature[] {
    return [
      ...this.computeAeroFeatures(),
      ...this.computeChassisModificationFeatures(),
      ...this.computeTransportFeatures(),
    ];
  }
  
  /** Maximum bomb payload, derived from external hardpoints and Internal Bomb Bay cargo space. */
  readonly maxBombPoints = computed(() => {
    const externalHardpoints = this.equipment().filter(mount =>
      isExternalStoresHardpointEquipment(mount.equipment)).length;
    if (!this.quirks().some(({ quirk }) => quirk.key === 'internal_bomb')) return externalHardpoints;
    const internalCapacity = this.transporters().reduce((total, transporter) =>
      total + (transporter.kind === 'bay' && transporter.configuration.type === 'cargo'
        ? Math.floor(transporter.capacity)
        : 0), 0);
    return externalHardpoints + internalCapacity;
  });

  override isSupportVehicle(): this is this & SupportVehicle {
    return true;
  }

  override entityTechAdvancements(): readonly TechRatingSource[] {
    return [getFixedWingSupportConstructionTech(this.motiveType(), this.weightClass())];
  }

  protected override computeWeightClass(): WeightClass {
    return resolveSupportVehicleWeightClass(this.tonnage(), 'Aerodyne');
  }

  override autoSetStructuralIntegrity(): void {
    this.structuralIntegrity.set(this.originalWalkMP());
  }

  override armorDamageThreshold(location: string): number {
    const bar = supportVehicleBarRating(this, location);
    return bar === 10 ? super.armorDamageThreshold(location) : bar >= 2 ? 1 : 0;
  }

  get locationOrder(): readonly string[] {
    return AERO_LOCATIONS;
  }

  get equipLocations(): readonly string[] {
    return [...FIXED_WING_EQUIP_LOCATIONS];
  }

  get validLocations(): ReadonlySet<string> {
    return new Set([...FIXED_WING_EQUIP_LOCATIONS]);
  }
}
