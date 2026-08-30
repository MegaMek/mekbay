// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/** Physical equipment exported as an independently mounted attack capability. */
export const SHIELD_FLAG = 'F_SHIELD' as const;
export const SMALL_SHIELD_FLAG = 'S_SHIELD_SMALL' as const;
export const MEDIUM_SHIELD_FLAG = 'S_SHIELD_MEDIUM' as const;
export const LARGE_SHIELD_FLAG = 'S_SHIELD_LARGE' as const;

export type PhysicalEquipmentKind =
  | 'shield'
  | 'talon'
  | 'hand-claw'
  | 'improvised-claw'
  | 'hatchet'
  | 'sword'
  | 'lance'
  | 'mace'
  | 'retractable-blade'
  | 'vibroblade-small'
  | 'vibroblade-medium'
  | 'vibroblade-large'
  | 'pile-driver'
  | 'flail'
  | 'dual-saw'
  | 'chainsaw'
  | 'buzzsaw'
  | 'backhoe'
  | 'mining-drill'
  | 'wrecking-ball'
  | 'chain-whip'
  | 'combine'
  | 'rock-cutter'
  | 'spot-welder'
  | 'protomek-melee'
  | 'club'
  | 'hand-weapon';

export function physicalEquipmentKindFromFlags(
  flags: ReadonlySet<string>,
): PhysicalEquipmentKind | null {
  if (flags.has(SHIELD_FLAG)) return 'shield';
  if (flags.has('F_TALON')) return 'talon';
  if (flags.has('F_PROTOMEK_MELEE')) return 'protomek-melee';
  if (flags.has('F_HAND_WEAPON') && flags.has('S_CLAW')) return 'hand-claw';
  if (flags.has('F_CLUB') && flags.has('S_CLAW')) return 'improvised-claw';
  if (flags.has('F_CLUB') && flags.has('S_HATCHET')) return 'hatchet';
  if (flags.has('F_CLUB') && flags.has('S_SWORD')) return 'sword';
  if (flags.has('F_CLUB') && flags.has('S_LANCE')) return 'lance';
  if (flags.has('F_CLUB') && flags.has('S_MACE')) return 'mace';
  if (flags.has('F_CLUB') && flags.has('S_RETRACTABLE_BLADE')) return 'retractable-blade';
  if (flags.has('F_CLUB') && flags.has('S_VIBRO_LARGE')) return 'vibroblade-large';
  if (flags.has('F_CLUB') && flags.has('S_VIBRO_MEDIUM')) return 'vibroblade-medium';
  if (flags.has('F_CLUB') && flags.has('S_VIBRO_SMALL')) return 'vibroblade-small';
  if (flags.has('F_CLUB') && flags.has('S_PILE_DRIVER')) return 'pile-driver';
  if (flags.has('F_CLUB') && flags.has('S_FLAIL')) return 'flail';
  if (flags.has('F_CLUB') && flags.has('S_DUAL_SAW')) return 'dual-saw';
  if (flags.has('F_CLUB') && flags.has('S_CHAINSAW')) return 'chainsaw';
  if (flags.has('F_CLUB') && flags.has('S_BUZZSAW')) return 'buzzsaw';
  if (flags.has('F_CLUB') && flags.has('S_BACKHOE')) return 'backhoe';
  if (flags.has('F_CLUB') && flags.has('S_MINING_DRILL')) return 'mining-drill';
  if (flags.has('F_CLUB') && flags.has('S_WRECKING_BALL')) return 'wrecking-ball';
  if (flags.has('F_CLUB') && flags.has('S_CHAIN_WHIP')) return 'chain-whip';
  if (flags.has('F_CLUB') && flags.has('S_COMBINE')) return 'combine';
  if (flags.has('F_CLUB') && flags.has('S_ROCK_CUTTER')) return 'rock-cutter';
  if (flags.has('F_CLUB') && flags.has('S_SPOT_WELDER')) return 'spot-welder';
  if (flags.has('F_CLUB')) return 'club';
  if (flags.has('F_HAND_WEAPON')) return 'hand-weapon';
  return null;
}

export function isPhysicalWeaponFlags(flags: ReadonlySet<string>): boolean {
  return physicalEquipmentKindFromFlags(flags) !== null;
}

export function isClubOrHandWeaponFlags(flags: ReadonlySet<string>): boolean {
  return flags.has('F_CLUB') || flags.has('F_HAND_WEAPON');
}

export function isShieldFlags(flags: ReadonlySet<string>): boolean {
  return flags.has(SHIELD_FLAG);
}

export function resolveShieldSizeFromFlags(
  flags: ReadonlySet<string>,
): 'small' | 'medium' | 'large' | undefined {
  const sizes = [
    ...(flags.has(SMALL_SHIELD_FLAG) ? ['small' as const] : []),
    ...(flags.has(MEDIUM_SHIELD_FLAG) ? ['medium' as const] : []),
    ...(flags.has(LARGE_SHIELD_FLAG) ? ['large' as const] : []),
  ];
  return sizes.length === 1 ? sizes[0] : undefined;
}

export interface ShieldProfile {
  readonly bashBonus: number;
  readonly damageAbsorption: number;
  readonly damageCapacity: number;
}

export interface VibrobladeProfile {
  readonly activeDamage: number;
  readonly activeHeat: number;
}

export function getVibrobladeProfileFromFlags(
  flags: ReadonlySet<string>,
): VibrobladeProfile | null {
  const kind = physicalEquipmentKindFromFlags(flags);
  if (kind === 'vibroblade-large') return { activeDamage: 14, activeHeat: 7 };
  if (kind === 'vibroblade-medium') return { activeDamage: 10, activeHeat: 5 };
  if (kind === 'vibroblade-small') return { activeDamage: 7, activeHeat: 3 };
  return null;
}

/** Static shield values shared by entity and runtime calculations. */
export function resolveShieldProfileFromFlags(
  flags: ReadonlySet<string>,
): ShieldProfile | undefined {
  if (flags.has(LARGE_SHIELD_FLAG)) {
    return { bashBonus: 3, damageAbsorption: 7, damageCapacity: 25 };
  }
  if (flags.has(MEDIUM_SHIELD_FLAG)) {
    return { bashBonus: 2, damageAbsorption: 5, damageCapacity: 18 };
  }
  if (flags.has(SMALL_SHIELD_FLAG)) {
    return { bashBonus: 1, damageAbsorption: 3, damageCapacity: 11 };
  }
  return undefined;
}

/** Static record-sheet damage from detached equipment flags and chassis mass. */
export function resolvePhysicalWeaponDamageFromFlags(
  flags: ReadonlySet<string>,
  entityTonnage: number,
): number {
  const kind = physicalEquipmentKindFromFlags(flags);
  if (kind === 'shield') return resolveShieldProfileFromFlags(flags)?.damageAbsorption ?? 0;
  if (kind === 'talon') return Math.round(Math.floor(entityTonnage / 5) * 1.5);
  if (kind === 'hand-claw') return Math.ceil(entityTonnage / 7);
  if (kind === 'sword') return Math.ceil(entityTonnage / 10) + 1;
  if (kind === 'retractable-blade') return Math.ceil(entityTonnage / 10);
  if (kind === 'mace') return Math.ceil(entityTonnage / 4);
  if (kind === 'pile-driver') return 10;
  if (kind === 'flail') return 9;
  if (kind === 'dual-saw') return 7;
  if (kind === 'chainsaw') return 5;
  if (kind === 'backhoe') return 6;
  if (kind === 'mining-drill') return 4;
  if (kind === 'wrecking-ball') return 8;
  if (kind === 'vibroblade-large') return 14;
  if (kind === 'vibroblade-medium') return 10;
  if (kind === 'vibroblade-small') return 7;
  if (kind === 'chain-whip' || kind === 'combine') return 3;
  if (kind === 'rock-cutter' || kind === 'spot-welder') return 5;
  return Math.floor(entityTonnage / 5);
}

export function physicalEquipmentVariableTonnageFromFlags(
  flags: ReadonlySet<string>,
  entityTonnage: number,
): number | null {
  const kind = physicalEquipmentKindFromFlags(flags);
  if (kind === 'hatchet' || kind === 'hand-claw' || kind === 'talon') {
    return Math.ceil(entityTonnage / 15);
  }
  if (kind === 'lance') return Math.ceil(entityTonnage / 20);
  if (kind === 'sword') return nextHalfTon(entityTonnage / 20);
  if (kind === 'mace') return Math.ceil(entityTonnage / 10);
  if (kind === 'retractable-blade') return 0.5 + nextHalfTon(entityTonnage / 20);
  return null;
}

export function physicalEquipmentVariableCostFromFlags(
  flags: ReadonlySet<string>,
  entityTonnage: number,
): number | null {
  const kind = physicalEquipmentKindFromFlags(flags);
  if (kind === 'hatchet') return Math.ceil(entityTonnage / 15) * 5000;
  if (kind === 'sword') return nextHalfTon(entityTonnage / 20) * 10000;
  if (kind === 'retractable-blade') return (1 + Math.ceil(entityTonnage / 20)) * 10000;
  if (kind === 'talon') return Math.ceil(Math.ceil(entityTonnage / 15) * 300);
  if (kind === 'hand-claw') return Math.ceil(entityTonnage * 200);
  if (kind === 'lance') return Math.ceil(entityTonnage * 150);
  return null;
}

export function physicalEquipmentCriticalSlotsFromFlags(
  flags: ReadonlySet<string>,
  entityTonnage: number,
): number | null {
  const kind = physicalEquipmentKindFromFlags(flags);
  if (kind === 'hatchet' || kind === 'sword') return Math.ceil(entityTonnage / 15);
  if (kind === 'lance') return Math.ceil(entityTonnage / 20);
  if (kind === 'mace') return Math.ceil(entityTonnage / 10);
  if (kind === 'retractable-blade') return 1 + Math.ceil(entityTonnage / 20);
  if (kind === 'hand-claw') return Math.ceil(entityTonnage / 15);
  return null;
}

export function physicalEquipmentBattleValueFromFlags(
  flags: ReadonlySet<string>,
  entityTonnage: number,
  myomerMultiplier: number,
): number | null {
  const kind = physicalEquipmentKindFromFlags(flags);
  if (kind === 'hatchet') return Math.ceil(entityTonnage / 5) * 1.5 * myomerMultiplier;
  if (kind === 'sword') return Math.ceil((entityTonnage / 10) + 1) * 1.725 * myomerMultiplier;
  if (kind === 'lance') return Math.ceil(entityTonnage / 5) * myomerMultiplier;
  if (kind === 'mace') return Math.ceil(entityTonnage / 4) * myomerMultiplier;
  if (kind === 'retractable-blade') return Math.ceil(entityTonnage / 10) * 1.725 * myomerMultiplier;
  if (kind === 'hand-claw') return Math.ceil(entityTonnage / 7) * 1.275 * myomerMultiplier;
  if (kind === 'talon') return Math.round(Math.floor(entityTonnage / 5) * 0.5) * myomerMultiplier;
  return null;
}

export function physicalEquipmentOperatingHeatFromFlags(flags: ReadonlySet<string>): number {
  const kind = physicalEquipmentKindFromFlags(flags);
  if (kind === 'spot-welder') return 2;
  if (kind === 'vibroblade-small') return 3;
  if (kind === 'vibroblade-medium') return 5;
  if (kind === 'vibroblade-large') return 7;
  return 0;
}

export function isPhysicalSawFlags(flags: ReadonlySet<string>): boolean {
  const kind = physicalEquipmentKindFromFlags(flags);
  return kind === 'dual-saw' || kind === 'chainsaw' || kind === 'buzzsaw'
    || kind === 'retractable-blade';
}

export function isPhysicalEngineeringToolFlags(flags: ReadonlySet<string>): boolean {
  const kind = physicalEquipmentKindFromFlags(flags);
  return kind === 'backhoe' || kind === 'pile-driver' || kind === 'mining-drill'
    || kind === 'rock-cutter' || kind === 'wrecking-ball';
}

export function isBackhoeFlags(flags: ReadonlySet<string>): boolean {
  return physicalEquipmentKindFromFlags(flags) === 'backhoe';
}

export function isHandClawFlags(flags: ReadonlySet<string>): boolean {
  return physicalEquipmentKindFromFlags(flags) === 'hand-claw';
}

export function isClawFlags(flags: ReadonlySet<string>): boolean {
  return flags.has('S_CLAW');
}

export function isImprovisedClawFlags(flags: ReadonlySet<string>): boolean {
  return physicalEquipmentKindFromFlags(flags) === 'improvised-claw';
}

export function isTalonFlags(flags: ReadonlySet<string>): boolean {
  return physicalEquipmentKindFromFlags(flags) === 'talon';
}

export function isFlailFlags(flags: ReadonlySet<string>): boolean {
  return physicalEquipmentKindFromFlags(flags) === 'flail';
}

export function isSpotWelderFlags(flags: ReadonlySet<string>): boolean {
  return physicalEquipmentKindFromFlags(flags) === 'spot-welder';
}

export function isProtoMekMeleeFlags(flags: ReadonlySet<string>): boolean {
  return physicalEquipmentKindFromFlags(flags) === 'protomek-melee';
}

export function isProtoMekQuadMeleeSystemFlags(flags: ReadonlySet<string>): boolean {
  return isProtoMekMeleeFlags(flags) && flags.has('S_PROTO_QMS');
}

function nextHalfTon(tonnage: number): number {
  return Math.ceil(Math.round(tonnage * 1000) / 500) / 2;
}
