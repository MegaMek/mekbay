// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentFlag } from './equipment-flags.type';

/** Dependency-free catalog taxonomy shared by Equipment and rule-family owners. */
export interface EquipmentFlagsView {
  readonly flags: ReadonlySet<string>;
}

export interface EquipmentFlagPredicate {
  hasFlag(flag: string): boolean;
}

export type EquipmentFlagsSource = ReadonlySet<string> | EquipmentFlagsView | EquipmentFlagPredicate;

export type WeaponTrait =
  | 'anti-missile'
  | 'anti-missile-bay'
  | 'anti-personnel-pod'
  | 'artillery'
  | 'atm'
  | 'autocannon'
  | 'ballistic'
  | 'battle-armor-weapon'
  | 'burst-fire'
  | 'b-pod'
  | 'capital-missile'
  | 'cws'
  | 'direct-fire'
  | 'double-one-shot'
  | 'energy'
  | 'heavy-vehicle-autocannon'
  | 'hyper'
  | 'indirect-fire'
  | 'incendiary-needles'
  | 'inferno'
  | 'infantry-support'
  | 'infantry-archaic'
  | 'infantry-weapon'
  | 'large-missile'
  | 'laser'
  | 'lrm'
  | 'machine-gun'
  | 'machine-gun-array'
  | 'mass-driver'
  | 'mek-mortar'
  | 'mek-weapon'
  | 'missile'
  | 'mml'
  | 'm-pod'
  | 'mrm'
  | 'narc'
  | 'one-shot'
  | 'plasma'
  | 'plasma-mfuk'
  | 'pulse'
  | 'srm'
  | 'tag'
  | 'taser'
  | 'tsemp'
  | 'vehicle-grenade-launcher'
  | 'variable-speed-pulse'
  | 'vibroclaw';

const WEAPON_TRAIT_FLAGS: Readonly<Record<WeaponTrait, EquipmentFlag>> = Object.freeze({
  'anti-missile': 'F_AMS',
  'anti-missile-bay': 'F_AMS_BAY',
  'anti-personnel-pod': 'F_AP_POD',
  artillery: 'F_ARTILLERY',
  atm: 'F_ATM',
  autocannon: 'F_AC',
  ballistic: 'F_BALLISTIC',
  'battle-armor-weapon': 'F_BA_WEAPON',
  'burst-fire': 'F_BURST_FIRE',
  'b-pod': 'F_B_POD',
  'capital-missile': 'F_CAP_MISSILE',
  cws: 'F_CWS',
  'direct-fire': 'F_DIRECT_FIRE',
  'double-one-shot': 'F_DOUBLE_ONE_SHOT',
  energy: 'F_ENERGY',
  'heavy-vehicle-autocannon': 'F_HVAC',
  hyper: 'F_HYPER',
  'indirect-fire': 'F_INDIRECT_FIRE',
  'incendiary-needles': 'F_INCENDIARY_NEEDLES',
  inferno: 'F_INFERNO',
  'infantry-support': 'F_INF_SUPPORT',
  'infantry-archaic': 'F_INF_ARCHAIC',
  'infantry-weapon': 'F_INFANTRY',
  'large-missile': 'F_LARGE_MISSILE',
  laser: 'F_LASER',
  lrm: 'F_LRM',
  'machine-gun': 'F_MG',
  'machine-gun-array': 'F_MGA',
  'mass-driver': 'F_MASS_DRIVER',
  'mek-mortar': 'F_MEK_MORTAR',
  'mek-weapon': 'F_MEK_WEAPON',
  missile: 'F_MISSILE',
  mml: 'F_MML',
  'm-pod': 'F_M_POD',
  mrm: 'F_MRM',
  narc: 'F_NARC',
  'one-shot': 'F_ONE_SHOT',
  plasma: 'F_PLASMA',
  'plasma-mfuk': 'F_PLASMA_MFUK',
  pulse: 'F_PULSE',
  srm: 'F_SRM',
  tag: 'F_TAG',
  taser: 'F_TASER',
  tsemp: 'F_TSEMP',
  'vehicle-grenade-launcher': 'F_VGL',
  'variable-speed-pulse': 'F_VSP',
  vibroclaw: 'F_VIBROCLAW',
});

export function hasWeaponTrait(
  source: EquipmentFlagsSource | null | undefined,
  trait: WeaponTrait,
): boolean {
  if (source == null) return false;
  const flag = WEAPON_TRAIT_FLAGS[trait];
  if ('flags' in source) return source.flags.has(flag);
  if ('hasFlag' in source) return source.hasFlag(flag);
  return source.has(flag);
}

export function hasAnyWeaponTrait(
  source: EquipmentFlagsSource | null | undefined,
  traits: readonly WeaponTrait[],
): boolean {
  return traits.some(trait => hasWeaponTrait(source, trait));
}

/** Registration boundary for generic infrastructure that indexes handlers by catalog flag. */
export function weaponTraitFlag(trait: WeaponTrait): EquipmentFlag {
  return WEAPON_TRAIT_FLAGS[trait];
}

export function isDirectFireFlags(flags: ReadonlySet<string>): boolean {
  return hasWeaponTrait(flags, 'direct-fire');
}
