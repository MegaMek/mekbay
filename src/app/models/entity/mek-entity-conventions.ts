// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  asComponentId,
  asLocationId,
  type ComponentId,
  type LocationId,
} from './entity-identifiers';
import type { MekSystemType } from './types';

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

type MekSystemIdentityScope = 'unit' | 'location';

interface MekSystemIdentity {
  readonly key: string;
  readonly scope: MekSystemIdentityScope;
}

/** Language-neutral identity and grouping policy for every intrinsic system. */
const MEK_SYSTEM_IDENTITIES = {
  Engine: { key: 'engine', scope: 'unit' },
  Gyro: { key: 'gyro', scope: 'unit' },
  Sensors: { key: 'sensors', scope: 'unit' },
  'Life Support': { key: 'life-support', scope: 'unit' },
  Cockpit: { key: 'cockpit', scope: 'unit' },
  Shoulder: { key: 'shoulder', scope: 'location' },
  'Upper Arm Actuator': { key: 'upper-arm-actuator', scope: 'location' },
  'Lower Arm Actuator': { key: 'lower-arm-actuator', scope: 'location' },
  'Hand Actuator': { key: 'hand-actuator', scope: 'location' },
  Hip: { key: 'hip', scope: 'location' },
  'Upper Leg Actuator': { key: 'upper-leg-actuator', scope: 'location' },
  'Lower Leg Actuator': { key: 'lower-leg-actuator', scope: 'location' },
  'Foot Actuator': { key: 'foot-actuator', scope: 'location' },
  'Landing Gear': { key: 'landing-gear', scope: 'unit' },
  Avionics: { key: 'avionics', scope: 'unit' },
  'Conversion Gear': { key: 'conversion-gear', scope: 'location' },
} as const satisfies Readonly<Record<MekSystemType, MekSystemIdentity>>;

/** Stable runtime identity for a Mek location code. */
export function mekLocationId(code: string): LocationId | null {
  const name = LOCATION_NAMES[code];
  return name ? asLocationId(`mek:${name}`) : null;
}

/** Stable runtime identity for one logical intrinsic-system component. */
export function mekSystemComponentId(system: MekSystemType, locationId: LocationId): ComponentId {
  const identity = MEK_SYSTEM_IDENTITIES[system];
  const location = identity.scope === 'location' ? `:${locationId}` : '';
  return asComponentId(`system:${identity.key}${location}`);
}
