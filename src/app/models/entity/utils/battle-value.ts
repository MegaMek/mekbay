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

import type { BaseEntity } from '../base-entity';
import { BV_MOVEMENT_CALCULATION } from '../types';
import { isMekEntity } from './entity-type-guards';

/**
 * MegaMek's TM p.316 offensive speed factor, rounded to two decimal places.
 *
 * This is deliberately separate from battle-value assembly: the value is also
 * exported as `offSpeedFactor` by SVGMassPrinter.
 */
export function offensiveSpeedFactor(mp: number): number {
  return Math.round(Math.pow(1 + (mp - 5) / 10, 1.2) * 100) / 100;
}

/**
 * Select the movement value used by MegaMek's BV calculator for the
 * offensive speed factor.  Movement values use the BV calculation settings
 * (`max*MP`), not transient in-game movement state.
 */
export function offensiveSpeedFactorMP(entity: BaseEntity): number {
  const run = entity.maxRunMP();
  const jump = entity.computeJumpMP(BV_MOVEMENT_CALCULATION);

  switch (entity.entityType) {
    case 'Aero':
    case 'ConvFighter':
    case 'FixedWingSupport':
    case 'SmallCraft':
    case 'DropShip':
    case 'WarShip':
      return run;

    case 'JumpShip':
      return 1;

    case 'SpaceStation':
    case 'HandheldWeapon':
      return 0;

    case 'BattleArmor':
      return Math.max(entity.maxWalkMP(), jump, entity.umuMP());

    case 'Infantry':
      return Math.max(run, jump, entity.umuMP());

    case 'Tank':
    case 'Naval':
    case 'VTOL':
    case 'SupportTank':
    case 'SupportNaval':
    case 'SupportVTOL':
    case 'LargeSupportTank': {
      // BV uses cruise MP for trains and treats a zero-MP trailer as MP 1.
      const vehicleRun = entity.originalWalkMP() === 0 ? 1
        : entity.motiveType() === 'Rail' ? entity.maxWalkMP()
          : run;
      return vehicleRun + Math.round(jump / 2);
    }

    default:
      if (isMekEntity(entity)) {
        if (entity.isLandAirMek()) return run + Math.round(entity.airMekFlankMP() / 2);
      }
      return run + Math.round(Math.max(jump, entity.umuMP()) / 2);
  }
}

/** Return the entity's exported offensive BV speed factor. */
export function getOffensiveSpeedFactor(entity: BaseEntity): number {
  return offensiveSpeedFactor(offensiveSpeedFactorMP(entity));
}