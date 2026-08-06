// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AERO_EQUIP_LOCATIONS, AERO_LOCATIONS, EntityType, type TechRatingSource } from '../../types';
import { AeroEntity } from './aero-entity';
import { getAerospaceFighterConstructionTech } from '../../components';
import type { UnitSubtype } from '../../types';

/** Standard AeroSpace Fighter (ASF). */
export class AeroSpaceFighterEntity extends AeroEntity {
  override readonly entityType: EntityType = 'Aero';

  override unitSubtype(): UnitSubtype {
    return this.withOmniSubtype('Aerospace Fighter');
  }

  override entityTechAdvancements(): readonly TechRatingSource[] {
    return [getAerospaceFighterConstructionTech(this.isPrimitiveAero()), this.mountedCockpitTech()];
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
