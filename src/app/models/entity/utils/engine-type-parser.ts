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
 * MTF-specific engine parsing and formatting.
 *
 * Code tables (ENGINE_TYPE_FROM_CODE, ENGINE_TYPE_TO_CODE) and their
 * convenience functions live in ../types.ts - re-exported here for
 * backwards compatibility.
 */

// Re-export code tables and convenience functions from types.ts
export {
  ENGINE_TYPE_FROM_CODE,
  ENGINE_TYPE_TO_CODE,
  engineTypeFromCode,
  engineTypeToCode,
} from '../types';

import type { EngineType } from '../types';

/**
 * Parse an engine type from an MTF string.
 *
 * MTF format embeds the engine type in the Engine line as:
 * `<rating> <type> Engine`
 * e.g. "300 XL Engine", "160 Fusion Engine", "200 Light Engine"
 *
 * Also handles "(Clan)" suffix for Clan tech.
 *
 * @param mtfEngine The full engine string from an MTF file
 * @returns Parsed engine info
 */
export interface MtfEngineInfo {
  rating: number;
  type: EngineType;
  clanTech: boolean;
}

export function parseMtfEngine(mtfEngine: string): MtfEngineInfo {
  const result: MtfEngineInfo = {
    rating: 0,
    type: 'Fusion',
    clanTech: false,
  };

  const trimmed = mtfEngine.trim();

  // Check for (Clan) suffix
  if (trimmed.includes('(Clan)')) {
    result.clanTech = true;
  }

  // Extract rating (first number)
  const ratingMatch = trimmed.match(/^(\d+)/);
  if (ratingMatch) {
    result.rating = parseInt(ratingMatch[1], 10);
  }

  // Extract engine type by matching known engine types against the string
  // Try longest matches first to avoid "Light" matching before "XXL", etc.
  const typeMatches: [string, EngineType][] = [
    ['Fuel Cell', 'Fuel Cell'],
    ['XXL', 'XXL'],
    ['XL', 'XL'],
    ['Light', 'Light'],
    ['Compact', 'Compact'],
    ['ICE', 'ICE'],
    ['I.C.E.', 'ICE'],
    ['Fission', 'Fission'],
    ['None', 'None'],
    ['Maglev', 'Maglev'],
    ['Steam', 'Steam'],
    ['Battery', 'Battery'],
    ['Solar', 'Solar'],
    ['External', 'External'],
    ['Fusion', 'Fusion'],
  ];

  for (const [pattern, type] of typeMatches) {
    if (trimmed.includes(pattern)) {
      result.type = type;
      break;
    }
  }

  return result;
}

/**
 * Format engine info into an MTF engine string.
 *
 * @param rating Engine rating
 * @param type Engine type
 * @param clanTech Whether it uses Clan tech
 * @returns e.g. "300 XL Engine" or "160 Fusion Engine (Clan)"
 */
export function formatMtfEngine(rating: number, type: EngineType, clanTech: boolean): string {
  let result = `${rating} ${type} Engine`;
  if (clanTech) {
    result += ' (Clan)';
  }
  return result;
}
