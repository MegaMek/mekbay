// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Equipment } from './equipment.model';

export type UtilityEquipmentKind =
  | 'anti-personnel-pod'
  | 'bulldozer'
  | 'chaff-pod'
  | 'damage-interrupt-circuit'
  | 'ejection-seat'
  | 'fire-resistant'
  | 'harjel'
  | 'harjel-ii'
  | 'harjel-iii'
  | 'heavy-bridge-layer'
  | 'hitch'
  | 'light-bridge-layer'
  | 'mass'
  | 'mast-mount'
  | 'medium-bridge-layer'
  | 'mine'
  | 'minesweeper'
  | 'searchlight';

export function utilityEquipmentKind(
  equipment: Equipment | null | undefined,
): UtilityEquipmentKind | null {
  if (equipment?.hasFlag('F_AP_POD') === true) return 'anti-personnel-pod';
  if (equipment?.hasFlag('F_BULLDOZER') === true) return 'bulldozer';
  if (equipment?.hasFlag('F_CHAFF_POD') === true) return 'chaff-pod';
  if (equipment?.hasFlag('F_DAMAGE_INTERRUPT_CIRCUIT') === true) return 'damage-interrupt-circuit';
  if (equipment?.hasFlag('F_EJECTION_SEAT') === true) return 'ejection-seat';
  if (equipment?.hasFlag('F_FIRE_RESISTANT') === true) return 'fire-resistant';
  if (equipment?.hasFlag('F_HARJEL_III') === true) return 'harjel-iii';
  if (equipment?.hasFlag('F_HARJEL_II') === true) return 'harjel-ii';
  if (equipment?.hasFlag('F_HARJEL') === true) return 'harjel';
  if (equipment?.hasFlag('F_HEAVY_BRIDGE_LAYER') === true) return 'heavy-bridge-layer';
  if (equipment?.hasFlag('F_HITCH') === true) return 'hitch';
  if (equipment?.hasFlag('F_LIGHT_BRIDGE_LAYER') === true) return 'light-bridge-layer';
  if (equipment?.hasFlag('F_MASS') === true) return 'mass';
  if (equipment?.hasFlag('F_MAST_MOUNT') === true) return 'mast-mount';
  if (equipment?.hasFlag('F_MEDIUM_BRIDGE_LAYER') === true) return 'medium-bridge-layer';
  if (equipment?.hasFlag('F_MINE') === true) return 'mine';
  if (equipment?.hasFlag('F_MINESWEEPER') === true) return 'minesweeper';
  if (equipment?.hasFlag('F_SEARCHLIGHT') === true
    || equipment?.hasFlag('F_BA_SEARCHLIGHT') === true) return 'searchlight';
  return null;
}

export function utilityEquipmentAlphaStrikeAbilities(
  equipment: Equipment | null | undefined,
): readonly string[] {
  const kind = utilityEquipmentKind(equipment);
  if (kind === 'bulldozer') return Object.freeze(['ENG']);
  if (kind === 'ejection-seat') return Object.freeze(['ES']);
  if (kind === 'fire-resistant') return Object.freeze(['FR']);
  if (kind === 'harjel') return Object.freeze(['BHJ']);
  if (kind === 'harjel-ii') return Object.freeze(['BHJ2']);
  if (kind === 'harjel-iii') return Object.freeze(['BHJ3']);
  if (kind === 'light-bridge-layer' || kind === 'medium-bridge-layer'
    || kind === 'heavy-bridge-layer') return Object.freeze(['BRID']);
  if (kind === 'hitch') return Object.freeze(['HTC']);
  if (kind === 'minesweeper') return Object.freeze(['MSW']);
  if (kind === 'searchlight') return Object.freeze(['SRCH']);
  return Object.freeze([]);
}

export function isDefensiveBattleValueUtility(
  equipment: Equipment | null | undefined,
): boolean {
  const kind = utilityEquipmentKind(equipment);
  return kind === 'anti-personnel-pod'
    || kind === 'mass'
    || kind === 'heavy-bridge-layer'
    || kind === 'medium-bridge-layer'
    || kind === 'light-bridge-layer'
    || kind === 'bulldozer'
    || kind === 'chaff-pod'
    || kind === 'harjel-ii'
    || kind === 'harjel-iii'
    || kind === 'minesweeper';
}

export function isOffensiveBattleValueExcludedUtility(
  equipment: Equipment | null | undefined,
): boolean {
  return isDefensiveBattleValueUtility(equipment) || utilityEquipmentKind(equipment) === 'mine';
}

export function harJelArmorMultiplier(
  equipment: readonly (Equipment | null | undefined)[],
): number {
  return (equipment.some(item => utilityEquipmentKind(item) === 'harjel-ii') ? 1.1 : 1)
    * (equipment.some(item => utilityEquipmentKind(item) === 'harjel-iii') ? 1.2 : 1);
}

export function isHarJelEquipment(equipment: Equipment | null | undefined): boolean {
  const kind = utilityEquipmentKind(equipment);
  return kind === 'harjel' || kind === 'harjel-ii' || kind === 'harjel-iii';
}

export function isMassEquipment(equipment: Equipment | null | undefined): boolean {
  return utilityEquipmentKind(equipment) === 'mass';
}

export function isMastMountEquipment(equipment: Equipment | null | undefined): boolean {
  return utilityEquipmentKind(equipment) === 'mast-mount';
}

export function isChaffPodEquipment(equipment: Equipment | null | undefined): boolean {
  return utilityEquipmentKind(equipment) === 'chaff-pod';
}

export function isDamageInterruptCircuitEquipment(
  equipment: Equipment | null | undefined,
): boolean {
  return utilityEquipmentKind(equipment) === 'damage-interrupt-circuit';
}

export function isBattleArmorStructuralUtility(equipment: Equipment | null | undefined): boolean {
  const kind = utilityEquipmentKind(equipment);
  return kind === 'fire-resistant' || isHarJelEquipment(equipment) || kind === 'mass';
}
