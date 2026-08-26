// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { EntityMountedPhysicalWeapon } from '../utils/physical-weapon';

export type EntityWeaponHitModifier = number | 'versus' | 'variable';

interface IntrinsicWeaponBase {
  readonly id: string;
  readonly name: string;
  readonly locations: readonly string[];
  /** Construction-only adjustment. The selected ruleset supplies the base modifier. */
  readonly hitModifierAdjustment: EntityWeaponHitModifier;
}

export type FixedPhysicalDamage = {
  readonly kind: 'fixed';
  readonly value: number;
  readonly boostedValue?: number;
  readonly alternatives?: Readonly<Record<string, IntrinsicWeaponDamage>>;
};

export type IntrinsicWeaponDamage =
  | FixedPhysicalDamage
  | {
    readonly kind: 'per-hex';
    readonly coefficient: number;
    readonly bonus: number;
  }
  | {
    readonly kind: 'none';
  };

export type IntrinsicWeaponKind =
  | 'punch'
  | 'kick'
  | 'club'
  | 'death-from-above'
  | 'charge'
  | 'airmek-ram'
  | 'push'
  | 'frenzy';

export interface IntrinsicWeapon extends IntrinsicWeaponBase {
  readonly source: 'intrinsic';
  readonly kind: IntrinsicWeaponKind;
  readonly damage: IntrinsicWeaponDamage;
}

/** Every physical weapon capability, regardless of whether it is mounted or intrinsic. */
export type PhysicalWeapon = EntityMountedPhysicalWeapon | IntrinsicWeapon;
