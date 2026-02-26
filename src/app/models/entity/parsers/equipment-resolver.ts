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

import { Equipment, EquipmentAliasMap, EquipmentMap } from '../../equipment.model';
import { EntityTechBase } from '../types';

/**
 * Resolves equipment names from MTF/BLK files against the equipment database.
 *
 * Resolution strategy mirrors Java's `EquipmentType.get()`:
 * 1. Exact match on internal name
 * 2. Tech-prefix variants (IS/Clan)
 * 3. Opposite tech base
 * 4. Alias lookup (O(1) via pre-built alias index)
 */
export function resolveEquipment(
  name: string,
  techBase: EntityTechBase,
  equipmentDb: EquipmentMap,
  aliasMap?: EquipmentAliasMap,
): Equipment | null {
  if (!name || name === '-Empty-') {
    return null;
  }

  // 1. Exact match
  if (equipmentDb[name]) {
    return equipmentDb[name];
  }

  // 4. Try alias lookup — O(1) when alias index is available
  if (aliasMap) {
    const aliased = aliasMap.get(name);
    if (aliased) return aliased;
  } else {
    // Fallback: linear scan (slow, used only when no alias index is provided)
    for (const eq of Object.values(equipmentDb)) {
      if (eq.aliases?.includes(name)) {
        return eq;
      }
    }
  }

  return null;
}

/**
 * Strip equipment name suffixes that are mount modifiers, not part of the
 * equipment's internal name. Returns the clean name plus parsed modifiers.
 *
 * Recognised suffixes (from BLK format):
 * - `:OMNI`
 * - `:SIZE:N`
 * - `:ShotsN#`
 * - `(R)` rear
 * - `(ST)` sponson turret, `(T)` turret, `(PT)` pintle turret
 * - `(FL)`, `(FR)`, `(RL)`, `(RR)`, `(F)`, `(R)` facing
 * - `:DWP`, `:SSWM`, `:APM`
 * - `:Body`, `:LA`, `:RA`, `:TU` (BA mount location)
 */
export interface EquipmentLineModifiers {
  name: string;
  omniPod: boolean;
  rearMounted: boolean;
  turretType?: 'standard' | 'sponson' | 'pintle';
  size?: number;
  shots?: number;
  facing?: number;
  baMountLocation?: 'Body' | 'LA' | 'RA' | 'Turret';
  isDWP: boolean;
  isSSWM: boolean;
  isAPM: boolean;
  isNewBay: boolean;
}

/** Facing suffix → numeric facing value */
const FACING_MAP: Record<string, number> = {
  '(FL)': 0,
  '(FR)': 1,
  '(RL)': 4,
  '(RR)': 5,
  '(F)': 0,
  '(R)': 3,
};

/**
 * Parse a BLK equipment line into a clean name and modifiers.
 */
export function parseEquipmentLine(line: string): EquipmentLineModifiers {
  const result: EquipmentLineModifiers = {
    name: line,
    omniPod: false,
    rearMounted: false,
    isDWP: false,
    isSSWM: false,
    isAPM: false,
    isNewBay: false,
  };

  let name = line.trim();

  // (B) prefix — new weapon bay marker
  if (name.startsWith('(B)')) {
    result.isNewBay = true;
    name = name.substring(3).trim();
  }

  // (R) prefix — rear mounted (BLK format)
  if (name.startsWith('(R)')) {
    result.rearMounted = true;
    name = name.substring(3).trim();
  }

  // Turret suffixes
  if (name.endsWith('(ST)')) {
    result.turretType = 'sponson';
    name = name.slice(0, -4).trim();
  } else if (name.endsWith('(PT)')) {
    result.turretType = 'pintle';
    name = name.slice(0, -4).trim();
  } else if (name.endsWith('(T)')) {
    result.turretType = 'standard';
    name = name.slice(0, -3).trim();
  }

  // Facing suffixes
  for (const [suffix, facing] of Object.entries(FACING_MAP)) {
    if (name.endsWith(suffix)) {
      result.facing = facing;
      name = name.slice(0, -suffix.length).trim();
      break;
    }
  }

  // Colon-separated suffixes
  const colonParts = name.split(':');
  const suffixesToRemove: number[] = [];

  for (let i = 1; i < colonParts.length; i++) {
    const part = colonParts[i];
    if (part === 'OMNI') {
      result.omniPod = true;
      suffixesToRemove.push(i);
    } else if (part === 'DWP') {
      result.isDWP = true;
      suffixesToRemove.push(i);
    } else if (part === 'SSWM') {
      result.isSSWM = true;
      suffixesToRemove.push(i);
    } else if (part === 'APM') {
      result.isAPM = true;
      suffixesToRemove.push(i);
    } else if (part === 'Body') {
      result.baMountLocation = 'Body';
      suffixesToRemove.push(i);
    } else if (part === 'LA') {
      result.baMountLocation = 'LA';
      suffixesToRemove.push(i);
    } else if (part === 'RA') {
      result.baMountLocation = 'RA';
      suffixesToRemove.push(i);
    } else if (part === 'TU') {
      result.baMountLocation = 'Turret';
      suffixesToRemove.push(i);
    } else if (part === 'SIZE' && i + 1 < colonParts.length) {
      result.size = parseFloat(colonParts[i + 1]);
      suffixesToRemove.push(i, i + 1);
    } else if (part.startsWith('Shots')) {
      const shotMatch = part.match(/^Shots(\d+)#?$/);
      if (shotMatch) {
        result.shots = parseInt(shotMatch[1], 10);
        suffixesToRemove.push(i);
      }
    }
  }

  // Rebuild name without recognised suffixes
  const remainingParts = colonParts.filter((_, i) => !suffixesToRemove.includes(i));
  result.name = remainingParts.join(':').trim();

  return result;
}
