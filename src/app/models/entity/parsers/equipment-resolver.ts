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

export type EquipmentLineProfile = 'generic' | 'large-craft' | 'dropship' | 'protomek';

export interface EquipmentLineParseOptions {
  readonly profile?: EquipmentLineProfile;
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
export function parseEquipmentLine(
  line: string,
  options: EquipmentLineParseOptions = {},
): EquipmentLineModifiers {
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

  // Java writes rear bay members as `(R) (B) equipment` and consumes the
  // rear marker before the bay marker when loading DropShips.
  if (name.startsWith('(R)')) {
    result.rearMounted = true;
    name = name.substring(3).trim();
  }

  // Weapon-bay boundaries are valid only for DropShip and large-craft BLKs.
  if (options.profile !== undefined
    && options.profile !== 'generic'
    && name.startsWith('(B)')) {
    result.isNewBay = true;
    name = name.substring(3).trim();
  }

  // Colon-separated suffixes
  const colonParts = name.split(':');
  const suffixesToRemove: number[] = [];

  for (let i = 1; i < colonParts.length; i++) {
    if (suffixesToRemove.includes(i)) continue;
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
      const size = Number(colonParts[i + 1]);
      if (Number.isFinite(size)) {
        result.size = size;
        suffixesToRemove.push(i, i + 1);
        i++;
      }
    } else if (part.startsWith('Shots')) {
      const shotMatch = part.match(/^Shots(\d+)#?$/);
      if (shotMatch) {
        result.shots = parseInt(shotMatch[1], 10);
        suffixesToRemove.push(i);
      }
    } else if (i === colonParts.length - 1
      && /^\d+$/.test(part)
      && acceptsBayAmmoQuantity(colonParts.slice(0, i).join(':'), options.profile)) {
      result.shots = parseInt(part, 10);
      suffixesToRemove.push(i);
    }
  }

  // Rebuild name without recognised suffixes
  const remainingParts = colonParts.filter((_, i) => !suffixesToRemove.includes(i));
  name = remainingParts.join(':').trim();

  // ProtoMek BLKs encode the number of shots in an ammo mount as a terminal
  // parenthesized integer. Keep this grammar scoped to ProtoMeks because
  // parentheses are otherwise valid equipment-name text.
  if (options.profile === 'protomek') {
    const shotMatch = name.match(/^(.*\S) \((\d+)\)$/);
    if (shotMatch) {
      name = shotMatch[1].trim();
      result.shots = parseInt(shotMatch[2], 10);
    }
  }

  // Location modifiers precede colon modifiers in BLK files, for example
  // `Light Gauss Rifle (PT):SIZE:1.0`. Strip them after rebuilding the name.
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

  for (const [suffix, facing] of Object.entries(FACING_MAP)) {
    if (name.endsWith(suffix)) {
      result.facing = facing;
      name = name.slice(0, -suffix.length).trim();
      break;
    }
  }

  result.name = name;

  return result;
}

function acceptsBayAmmoQuantity(name: string, profile: EquipmentLineProfile | undefined): boolean {
  if (profile === 'large-craft') return name.includes('Ammo');
  if (profile === 'dropship') return name.includes('Ammo') || name.includes('Pod');
  return false;
}
