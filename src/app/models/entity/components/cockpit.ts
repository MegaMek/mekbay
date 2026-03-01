/*
 * Copyright (C) 2025-2026 The MegaMek Team. All Rights Reserved.
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

import type { CockpitType, TechAdvancement } from '../types';
import { MEK_SLOTS_PER_LOCATION } from '../types';
import {
  COCKPIT_DATA,
  type CockpitTypeDescriptor,
  type CockpitCrewType,
  type CockpitHeadLayout,
} from './cockpit-data';

// Re-export cockpit-data symbols for barrel convenience
export {
  COCKPIT_DATA,
  type CockpitTypeDescriptor,
  type CockpitCrewType,
  type CockpitHeadLayout,
  getCockpitTechAdvancement,
  COCKPIT_TYPE_FROM_CODE,
  COCKPIT_TYPE_TO_CODE,
  cockpitTypeFromCode,
  cockpitTypeToCode,
} from './cockpit-data';

// ============================================================================
// Lookup helpers
// ============================================================================

/** All known cockpit types (keys of COCKPIT_DATA). */
export function getAllCockpitTypes(): readonly CockpitType[] {
  return Object.keys(COCKPIT_DATA) as CockpitType[];
}

/**
 * Normalize a raw cockpit-type string (e.g. "Standard Cockpit") to the
 * canonical `CockpitType` key.
 */
export function normalizeCockpitType(raw: string): CockpitType {
  if (raw in COCKPIT_DATA) return raw as CockpitType;
  // Strip trailing " Cockpit" suffix
  const stripped = raw.replace(/\s+Cockpit$/i, '').trim();
  if (stripped in COCKPIT_DATA) return stripped as CockpitType;
  // Handle "Torso Mounted" → "Torso-Mounted"
  const hyphenated = stripped.replace(/\s+/g, '-');
  if (hyphenated in COCKPIT_DATA) return hyphenated as CockpitType;
  return 'Standard';
}

// ============================================================================
// Head layout builder
// ============================================================================

/**
 * Build the head system slot layout from a CockpitTypeDescriptor.
 * Returns an array of length `MEK_SLOTS_PER_LOCATION` where each entry is
 * a system type string or null (empty).
 */
export function buildHeadSystemLayout(
  cockpit: CockpitTypeDescriptor,
): (string | null)[] {
  const layout: (string | null)[] = new Array(MEK_SLOTS_PER_LOCATION).fill(null);
  const headLayout = cockpit.headLayout;
  for (let i = 0; i < headLayout.length && i < MEK_SLOTS_PER_LOCATION; i++) {
    layout[i] = headLayout[i];
  }
  return layout;
}
