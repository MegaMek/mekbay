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
 * Cockpit system component.
 *
 * Cockpits are fundamental structural elements of every Mek, with statically
 * known properties (head slot layout, etc.) initialised at runtime.
 * They are NOT equipment from equipment2.json.
 */

// ============================================================================
// Types
// ============================================================================

export type CockpitType =
  | 'Standard' | 'Small' | 'Small Cockpit' | 'Command Console' | 'Torso-Mounted'
  | 'Dual' | 'Dual Cockpit' | 'Industrial' | 'Primitive' | 'Primitive Industrial'
  | 'Superheavy' | 'Superheavy Tripod' | 'Tripod'
  | 'Interface' | 'Virtual Reality Piloting Pod' | 'QuadVee';

// ============================================================================
// Cockpit Component
// ============================================================================

export interface CockpitComponent {
  readonly type: string;
  /**
   * Head slot layout for this cockpit type.
   * Each entry is the system type for that slot index.
   * `null` means the slot is empty/available for equipment.
   */
  readonly headLayout: readonly (string | null)[];
}

const COCKPIT_DEFINITIONS: Record<string, CockpitComponent> = {
  'Standard': {
    type: 'Standard',
    headLayout: ['Life Support', 'Sensors', 'Cockpit', null, 'Sensors', 'Life Support'],
  },
  'Small': {
    type: 'Small',
    headLayout: ['Life Support', 'Sensors', 'Cockpit', 'Sensors', null, null],
  },
  'Small Cockpit': {
    type: 'Small Cockpit',
    headLayout: ['Life Support', 'Sensors', 'Cockpit', 'Sensors', null, null],
  },
  'Command Console': {
    type: 'Command Console',
    headLayout: ['Life Support', 'Sensors', 'Cockpit', 'Cockpit', 'Sensors', 'Life Support'],
  },
  'Torso-Mounted': {
    type: 'Torso-Mounted',
    headLayout: ['Sensors', 'Sensors', null, null, null, null],
  },
  'Dual': {
    type: 'Dual',
    headLayout: ['Life Support', 'Sensors', 'Cockpit', 'Cockpit', 'Sensors', 'Life Support'],
  },
  'Dual Cockpit': {
    type: 'Dual Cockpit',
    headLayout: ['Life Support', 'Sensors', 'Cockpit', 'Cockpit', 'Sensors', 'Life Support'],
  },
  'Industrial': {
    type: 'Industrial',
    headLayout: ['Life Support', 'Sensors', 'Cockpit', null, 'Sensors', 'Life Support'],
  },
  'Primitive': {
    type: 'Primitive',
    headLayout: ['Life Support', 'Sensors', 'Cockpit', null, 'Sensors', 'Life Support'],
  },
  'Primitive Industrial': {
    type: 'Primitive Industrial',
    headLayout: ['Life Support', 'Sensors', 'Cockpit', null, 'Sensors', 'Life Support'],
  },
  'Superheavy': {
    type: 'Superheavy',
    headLayout: ['Life Support', 'Sensors', 'Cockpit', null, 'Sensors', 'Life Support'],
  },
  'Superheavy Tripod': {
    type: 'Superheavy Tripod',
    headLayout: ['Life Support', 'Sensors', 'Cockpit', null, 'Sensors', 'Life Support'],
  },
  'Tripod': {
    type: 'Tripod',
    headLayout: ['Life Support', 'Sensors', 'Cockpit', null, 'Sensors', 'Life Support'],
  },
  'Interface': {
    type: 'Interface',
    headLayout: ['Life Support', 'Sensors', 'Cockpit', 'Cockpit', 'Sensors', 'Life Support'],
  },
  'Virtual Reality Piloting Pod': {
    type: 'Virtual Reality Piloting Pod',
    headLayout: ['Life Support', 'Sensors', 'Cockpit', null, 'Sensors', 'Life Support'],
  },
  'QuadVee': {
    type: 'QuadVee',
    headLayout: ['Life Support', 'Sensors', 'Cockpit', 'Cockpit', 'Sensors', 'Life Support'],
  },
};

// ============================================================================
// Lookup
// ============================================================================

/**
 * Normalize a raw cockpit-type string (e.g. "Standard Cockpit") to the
 * canonical form used as lookup key (e.g. "Standard").
 */
function normalizeCockpitType(raw: string): string {
  if (raw in COCKPIT_DEFINITIONS) return raw;
  const stripped = raw.replace(/\s+Cockpit$/i, '').trim();
  if (stripped in COCKPIT_DEFINITIONS) return stripped;
  return 'Standard';
}

/** Resolve a CockpitComponent by type name. Falls back to Standard. */
export function getCockpit(type: string): CockpitComponent {
  return COCKPIT_DEFINITIONS[normalizeCockpitType(type)];
}

/** Get all known cockpit types. */
export function getAllCockpitTypes(): readonly string[] {
  return Object.keys(COCKPIT_DEFINITIONS);
}

// ============================================================================
// Head layout builder
// ============================================================================

/**
 * Build the head system slot layout from a cockpit component.
 */
export function buildHeadSystemLayout(
  cockpit: CockpitComponent,
  slotsPerLocation: number,
): (string | null)[] {
  const layout: (string | null)[] = new Array(slotsPerLocation).fill(null);
  for (let i = 0; i < cockpit.headLayout.length && i < slotsPerLocation; i++) {
    layout[i] = cockpit.headLayout[i];
  }
  return layout;
}
