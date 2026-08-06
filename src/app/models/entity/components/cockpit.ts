// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CockpitType, TechAdvancement } from '../types';
import { MEK_SLOTS_PER_LOCATION } from '../types';
import {
  COCKPIT_DATA,
  type CockpitTypeDescriptor,
  type CockpitCrewType,
  type CockpitHeadLayout,
} from './cockpit-data';

/** All known cockpit types (keys of COCKPIT_DATA). */
export function getAllCockpitTypes(): readonly CockpitType[] {
  return Object.keys(COCKPIT_DATA) as CockpitType[];
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
