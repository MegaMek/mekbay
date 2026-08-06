// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import {
  DropShipCollarType,
  DROPSHIP_LOCATIONS,
  DROPSHIP_WEIGHT_LIMITS,
  EntityType,
  resolveWeightClass,
  SMALL_CRAFT_EQUIP_LOCATIONS,
  WeightClass,
} from '../../types';
import { SmallCraftEntity } from './small-craft-entity';
import type { TechRatingSource } from '../../types';
import { getDropshipConstructionTech } from '../../components';

/**
 * DropShip entity (200+ tons, up to 100,000 tons).
 *
 * Extends SmallCraft - shares crew, design type, fuel, structural integrity.
 * Uses 6-location armor layout (Nose/LF/RF/LBS/RBS/Aft) but the same
 * equipment locations as SmallCraft (Nose/Left Side/Right Side/Aft/Hull).
 */
export class DropShipEntity extends SmallCraftEntity {
  override readonly entityType: EntityType = 'DropShip';

  protected override unitSubtypeKind(): 'DropShip' {
    return 'DropShip';
  }

  override entityTechAdvancements(): readonly TechRatingSource[] {
    return [getDropshipConstructionTech(this.uniformArmor()?.type === 'PRIMITIVE_AERO')];
  }

  protected override supportsWeaponBays(): boolean {
    return true;
  }

  // ── DropShip-specific signals ──
  collarType = signal<DropShipCollarType>('Unspecified');
  kfBoomAttached = signal<boolean>(false);

  protected override computeWeightClass(): WeightClass {
    return resolveWeightClass(this.tonnage(), DROPSHIP_WEIGHT_LIMITS);
  }

  // ── Location overrides ──

  override get locationOrder(): readonly string[] {
    return DROPSHIP_LOCATIONS;
  }

  override get equipLocations(): readonly string[] {
    return [...SMALL_CRAFT_EQUIP_LOCATIONS];
  }

  override get validLocations(): ReadonlySet<string> {
    // Union of armor locations and equipment locations
    return new Set([...DROPSHIP_LOCATIONS, ...SMALL_CRAFT_EQUIP_LOCATIONS]);
  }
}
