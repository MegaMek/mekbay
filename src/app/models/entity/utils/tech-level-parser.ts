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

import { EntityTechBase } from '../types';

/**
 * BLK tech level string conversions.
 *
 * BLK files store tech level as combined strings like "IS Level 2",
 * "Clan Level 3", "Mixed (IS Chassis) Advanced", etc.
 */

/** Parsed tech level information */
export interface ParsedTechLevel {
  techBase: EntityTechBase;
  rulesLevel: number;
  mixedTech: boolean;
  /** Raw cleaned string */
  raw: string;
}

/**
 * Parse a BLK tech level string into structured data.
 *
 * Examples:
 * - "IS Level 1"            → { techBase: 'Inner Sphere', rulesLevel: 1 }
 * - "IS Level 2"            → { techBase: 'Inner Sphere', rulesLevel: 2 }
 * - "Clan Level 3"          → { techBase: 'Clan', rulesLevel: 3 }
 * - "Mixed (IS Chassis)"    → { techBase: 'Mixed', mixedTech: true, rulesLevel: 3 }
 * - "Mixed (Clan Chassis)"  → { techBase: 'Mixed', mixedTech: true, rulesLevel: 3 }
 * - "IS Level 2 Advanced"   → { techBase: 'Inner Sphere', rulesLevel: 3 }
 */
export function parseTechLevel(raw: string): ParsedTechLevel {
  const result: ParsedTechLevel = {
    techBase: 'Inner Sphere',
    rulesLevel: 2,
    mixedTech: false,
    raw: raw.trim(),
  };

  const str = raw.trim();

  // Mixed tech
  if (str.toLowerCase().startsWith('mixed')) {
    result.mixedTech = true;
    result.techBase = 'Mixed';

    if (str.includes('Clan Chassis') || str.includes('Clan chassis')) {
      result.techBase = 'Mixed';
    }

    // Default mixed to rules level 3 (Advanced)
    result.rulesLevel = 3;
    if (str.includes('Experimental') || str.includes('Level 4')) {
      result.rulesLevel = 4;
    } else if (str.includes('Unofficial') || str.includes('Level 5')) {
      result.rulesLevel = 5;
    }

    return result;
  }

  // Clan
  if (str.toLowerCase().startsWith('clan')) {
    result.techBase = 'Clan';
  }

  // Extract numeric level
  const levelMatch = str.match(/Level\s+(\d)/i);
  if (levelMatch) {
    result.rulesLevel = parseInt(levelMatch[1], 10);
  }

  // Suffix overrides
  if (str.includes('Advanced')) {
    result.rulesLevel = 3;
  } else if (str.includes('Experimental')) {
    result.rulesLevel = 4;
  } else if (str.includes('Unofficial')) {
    result.rulesLevel = 5;
  }

  return result;
}

/**
 * Encode a tech level back to a BLK string.
 */
export function encodeTechLevel(
  techBase: EntityTechBase,
  rulesLevel: number,
  mixedTech: boolean,
): string {
  if (mixedTech) {
    const chassis = techBase === 'Clan' ? 'Clan Chassis' : 'IS Chassis';
    const suffix = rulesLevelSuffix(rulesLevel);
    return `Mixed (${chassis})${suffix ? ' ' + suffix : ''}`;
  }

  const prefix = techBase === 'Clan' ? 'Clan' : 'IS';
  return `${prefix} Level ${rulesLevel}`;
}

/**
 * Map rules level to suffix string (for mixed tech).
 */
function rulesLevelSuffix(level: number): string {
  switch (level) {
    case 3: return 'Advanced';
    case 4: return 'Experimental';
    case 5: return 'Unofficial';
    default: return '';
  }
}
