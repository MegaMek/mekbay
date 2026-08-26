// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asLocationId, type LocationId } from './entity-identifiers';

const LOCATION_NAMES: Readonly<Record<string, string>> = Object.freeze({
  HD: 'head',
  CT: 'center-torso',
  LT: 'left-torso',
  RT: 'right-torso',
  LA: 'left-arm',
  RA: 'right-arm',
  LL: 'left-leg',
  RL: 'right-leg',
  FLL: 'front-left-leg',
  FRL: 'front-right-leg',
  RLL: 'rear-left-leg',
  RRL: 'rear-right-leg',
  CL: 'center-leg',
});

const LOCATION_SCOPED_SYSTEMS: ReadonlySet<string> = new Set([
  'Shoulder', 'Upper Arm Actuator', 'Lower Arm Actuator', 'Hand Actuator',
  'Hip', 'Upper Leg Actuator', 'Lower Leg Actuator', 'Foot Actuator',
]);

/** Stable runtime identity for a Mek location code. */
export function mekLocationId(code: string): LocationId | null {
  const name = LOCATION_NAMES[code];
  return name ? asLocationId(`mek:${name}`) : null;
}

/** Systems outside this list are one logical component even when they span locations. */
export function mekSystemComponentGroupKey(system: string, locationId: LocationId): string {
  return LOCATION_SCOPED_SYSTEMS.has(system) ? `${system}\0${locationId}` : system;
}
