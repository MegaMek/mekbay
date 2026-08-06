// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { AERO_EQUIP_LOCATIONS, AERO_LOCATIONS, EntityType, type TechRatingSource } from '../../types';
import { AeroEntity } from './aero-entity';
import { getConventionalFighterConstructionTech } from '../../components';
import type { UnitSubtype } from '../../types';

/** Conventional Fighter - ICE-powered, limited tech, optional VSTOL. */
export class ConvFighterEntity extends AeroEntity {
  override readonly entityType: EntityType = 'ConvFighter';
  vstol = signal<boolean>(false);

  override unitSubtype(): UnitSubtype {
    return this.withOmniSubtype('Conventional Fighter');
  }

  override entityTechAdvancements(): readonly TechRatingSource[] {
    return [
      getConventionalFighterConstructionTech(),
      this.mountedCockpitTech(),
    ];
  }

  get locationOrder(): readonly string[] {
    return AERO_LOCATIONS;
  }

  get equipLocations(): readonly string[] {
    return [...AERO_EQUIP_LOCATIONS];
  }

  get validLocations(): ReadonlySet<string> {
    return new Set([...AERO_EQUIP_LOCATIONS]);
  }
}
