// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentFlag } from './equipment-flags.type';
import { hasWeaponTrait } from './weapon-traits-kernel';
import type { Equipment } from './equipment.model';

const ARTEMIS_IV_FLAG = 'F_ARTEMIS' as const;
const ARTEMIS_V_FLAG = 'F_ARTEMIS_V' as const;
const ARTEMIS_PROTOTYPE_FLAG = 'F_ARTEMIS_PROTO' as const;
const ARTEMIS_COMPATIBLE_FLAG = 'F_ARTEMIS_COMPATIBLE' as const;

export interface ArtemisFlagCarrier {
  hasFlag(flag: EquipmentFlag): boolean;
}

export type ArtemisKind = 'iv' | 'v' | 'prototype';

export function artemisKind(equipment: ArtemisFlagCarrier | null | undefined): ArtemisKind | null {
  if (equipment?.hasFlag(ARTEMIS_V_FLAG) === true) return 'v';
  if (equipment?.hasFlag(ARTEMIS_IV_FLAG) === true) return 'iv';
  if (equipment?.hasFlag(ARTEMIS_PROTOTYPE_FLAG) === true) return 'prototype';
  return null;
}

export function isArtemisEquipment(equipment: ArtemisFlagCarrier | null | undefined): boolean {
  return artemisKind(equipment) !== null;
}

export function isArtemisVEquipment(equipment: Equipment | null | undefined): boolean {
  return artemisKind(equipment) === 'v';
}

export function isArtemisCompatibleWeapon(equipment: Equipment | null | undefined): boolean {
  return equipment?.hasFlag(ARTEMIS_COMPATIBLE_FLAG) === true;
}

export function artemisBattleValueMultiplier(
  equipment: ArtemisFlagCarrier | null | undefined,
): number {
  const kind = artemisKind(equipment);
  if (kind === 'v') return 1.3;
  if (kind === 'iv') return 1.2;
  if (kind === 'prototype') return 1.1;
  return 1;
}

export function artemisTorpedoDamageMultiplier(
  equipment: ArtemisFlagCarrier | null | undefined,
): number | null {
  const kind = artemisKind(equipment);
  if (kind === 'v') return 1.4;
  if (kind === 'iv') return 1.2;
  if (kind === 'prototype') return 1.1;
  return null;
}

export function artemisClanLrmDamageMultiplier(
  equipment: ArtemisFlagCarrier | null | undefined,
): number | null {
  const kind = artemisKind(equipment);
  if (kind === 'v') return 1.4;
  return kind === 'iv' || kind === 'prototype' ? 4 / 3 : null;
}

export function artemisClusterRoll(
  equipment: ArtemisFlagCarrier | null | undefined,
  fallback: number | null = null,
): number | null {
  const kind = artemisKind(equipment);
  if (kind === 'v') return 11;
  if (kind === 'iv') return 9;
  if (kind === 'prototype') return 8;
  return fallback;
}

export function usesArtemisIVDamageTable(
  equipment: ArtemisFlagCarrier | null | undefined,
): boolean {
  const kind = artemisKind(equipment);
  return kind === 'iv' || kind === 'prototype';
}

export function artemisReferenceNoteFromFlags(
  flags: ReadonlySet<EquipmentFlag>,
): 'artemisIV' | 'artemisV' | 'artemisProto' | null {
  if (flags.has(ARTEMIS_IV_FLAG) || hasWeaponTrait(flags, 'atm')) return 'artemisIV';
  if (flags.has(ARTEMIS_V_FLAG)) return 'artemisV';
  if (flags.has(ARTEMIS_PROTOTYPE_FLAG)) return 'artemisProto';
  return null;
}
