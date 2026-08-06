// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed, signal } from '@angular/core';
import { EntityType } from '../../types';
import { JumpShipEntity } from './jumpship-entity';
import type { UnitSubtype } from '../../types';
import type { TechRatingSource } from '../../types';
import { getSpaceStationConstructionTech } from '../../components';
import { EquipmentRegistry } from '../../../equipment-lookup';

const MODULAR_MINIMUM_WEIGHT = 100_000;

/**
 * Space Station - a stationary JumpShip variant (no KF drive, no thrust).
 */
export class SpaceStationEntity extends JumpShipEntity {
  override readonly entityType: EntityType = 'SpaceStation';
  readonly modularOrKFAdapter = signal<boolean>(false);

  override unitSubtype(): UnitSubtype {
    return this.withOmniSubtype(`${this.isMilitary() ? 'Military' : 'Civilian'} Space Station`);
  }

  override entityTechAdvancements(): readonly TechRatingSource[] {
    return [getSpaceStationConstructionTech()];
  }

  constructor(equipmentRegistry: EquipmentRegistry) {
    super(equipmentRegistry);
    this.driveCoreType.set('None');
    this.sail.set(false);
  }

  readonly isModular = computed(() =>
    this.modularOrKFAdapter() && this.tonnage() > MODULAR_MINIMUM_WEIGHT);

  readonly hasKFAdapter = computed(() =>
    this.modularOrKFAdapter() && this.tonnage() <= MODULAR_MINIMUM_WEIGHT);

}