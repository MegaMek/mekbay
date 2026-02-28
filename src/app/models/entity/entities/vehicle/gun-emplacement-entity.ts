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

import { signal } from '@angular/core';
import { EntityType, StructureType } from '../../types';
import { VehicleEntity } from './vehicle-entity';

/**
 * Gun Emplacement - a stationary turret with no movement.
 *
 * Only has a single Turret location. Internal structure is replaced by
 * Building CF (Construction Factor).
 */
export class GunEmplacementEntity extends VehicleEntity {
  override readonly entityType: EntityType = 'GunEmplacement';

  buildingCF = signal<number>(0);

  override get locationOrder(): readonly string[] {
    return ['Turret'];
  }

  override get validLocations(): ReadonlySet<string> {
    return new Set(['Turret']);
  }

  protected override computeStructureValues(
    _tonnage: number, _structureType: StructureType,
  ): Map<string, number> {
    const values = new Map<string, number>();
    values.set('Turret', this.buildingCF());
    return values;
  }

  protected override computeExpectedEngineRating(): number | null {
    return null; // Gun emplacements have no engine
  }
}
