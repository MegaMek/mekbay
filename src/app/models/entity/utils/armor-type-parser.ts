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

/**
 * MTF-specific armor/structure parsing and formatting.
 *
 * MTF format: "Standard Armor" or "Ferro-Fibrous Armor (Clan)" or
 * "Patchwork Armor" with per-location types on subsequent lines.
 */
export interface MtfArmorInfo {
  type: string;
  clanTech: boolean;
  patchwork: boolean;
}

export function parseMtfArmor(mtfArmor: string): MtfArmorInfo {
  const result: MtfArmorInfo = {
    type: 'Standard',
    clanTech: false,
    patchwork: false,
  };

  const trimmed = mtfArmor.trim();

  // Check for (Clan) or (Inner Sphere) suffix
  if (trimmed.includes('(Clan)')) {
    result.clanTech = true;
  }

  // Check for patchwork
  if (trimmed.toLowerCase().includes('patchwork')) {
    result.type = 'Patchwork';
    result.patchwork = true;
    return result;
  }

  // Remove " Armor" suffix and tech base parenthetical
  let typeName = trimmed
    .replace(/\s*\(Clan\)/i, '')
    .replace(/\s*\(Inner Sphere\)/i, '')
    .replace(/\s*\(IS\)/i, '')
    .replace(/\s*Armor$/i, '')
    .trim();

  if (!typeName) {
    typeName = 'Standard';
  }

  result.type = typeName;
  return result;
}

/**
 * Format armor info into an MTF armor string.
 */
export function formatMtfArmor(type: string, clanTech: boolean): string {
  let result = type;
  // Ensure "Armor" suffix
  if (!result.toLowerCase().endsWith('armor')) {
    result += ' Armor';
  }
  if (clanTech) {
    result += ' (Clan)';
  }
  return result;
}
