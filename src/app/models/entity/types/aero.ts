/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

export type AeroDesignType = 'Civilian' | 'Military';

export type DriveCoreType = 'Standard' | 'Compact' | 'Subcompact' | 'None' | 'Primitive';

export type DropShipCollarType = 'Unspecified' | 'Standard' | 'Prototype' | 'No Boom';

export const AERO_DESIGN_TYPE_TO_CODE: Readonly<Record<AeroDesignType, number>> = {
  Civilian: 0,
  Military: 1,
};

export const DRIVE_CORE_TYPE_TO_CODE: Readonly<Record<DriveCoreType, number>> = {
  Standard: 0,
  Compact: 1,
  Subcompact: 2,
  None: 3,
  Primitive: 4,
};

export const DROPSHIP_COLLAR_TYPE_TO_CODE: Readonly<Record<DropShipCollarType, number>> = {
  Unspecified: -1,
  Standard: 0,
  Prototype: 1,
  'No Boom': 2,
};

export function aeroDesignTypeFromCode(code: number): AeroDesignType {
  return code === 1 ? 'Military' : 'Civilian';
}

export function driveCoreTypeFromCode(code: number): DriveCoreType {
  switch (code) {
    case 1: return 'Compact';
    case 2: return 'Subcompact';
    case 3: return 'None';
    case 4: return 'Primitive';
    default: return 'Standard';
  }
}

export function dropShipCollarTypeFromCode(code: number): DropShipCollarType {
  switch (code) {
    case 0: return 'Standard';
    case 1: return 'Prototype';
    case 2: return 'No Boom';
    default: return 'Unspecified';
  }
}