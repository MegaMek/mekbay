// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { getMekLegLocations, type MekConfig } from '../types/mek';
import type { EquipmentFlag } from '../../equipment-flags.type';
import type {
  IntrinsicWeapon,
  IntrinsicWeaponDamage,
  IntrinsicWeaponKind,
} from '../types/weapon';
import {
  isActuatorEnhancementSystemFlags,
  tripleStrengthMyomerKindFromFlags,
} from '../../myomer-equipment.model';
import { hasRamPlateFlags, hasSpikesFlags } from '../../physical-augmentation.model';
import {
  isHandClawFlags,
  isImprovisedClawFlags,
  isTalonFlags,
} from './physical-weapon-kernel';

export interface MekIntrinsicEquipmentFact {
  /** Primary installation location. This intentionally matches MekEntity's location index. */
  readonly location: string | null;
  readonly flags: ReadonlySet<EquipmentFlag>;
}

export interface MekIntrinsicActionFacts {
  readonly tonnage: number;
  readonly config: MekConfig;
  readonly installedJumpMp: number;
  readonly lowerArmActuators: Readonly<{ left: boolean; right: boolean }>;
  readonly handActuators: Readonly<{ left: boolean; right: boolean }>;
  readonly equipment: readonly MekIntrinsicEquipmentFact[];
}

const ARMED_CONFIGS: ReadonlySet<MekConfig> = new Set(['Biped', 'Tripod', 'LAM']);

/**
 * Derive the Mek's intrinsic physical-attack capabilities from construction
 * facts. This is the sole formula implementation used by both mutable editor
 * entities and immutable published entities.
 */
export function buildMekIntrinsicActions(
  facts: MekIntrinsicActionFacts,
): readonly IntrinsicWeapon[] {
  const attacks: IntrinsicWeapon[] = [];
  const isLam = facts.config === 'LAM';
  const hasArms = ARMED_CONFIGS.has(facts.config);
  const tsm = facts.equipment.some(item =>
    tripleStrengthMyomerKindFromFlags(item.flags) === 'standard');
  const legLocations = getMekLegLocations(facts.config);
  const talons = legLocations.length > 0 && legLocations.every(location =>
    facts.equipment.some(item => item.location === location && isTalonFlags(item.flags)));

  if (hasArms) {
    for (const side of ['left', 'right'] as const) {
      const location = side === 'left' ? 'LA' : 'RA';
      const claw = facts.equipment.some(item => item.location === location
        && isHandClawFlags(item.flags));
      if (claw) continue;

      let baseDamage = Math.ceil(facts.tonnage / 10);
      if (isLam) baseDamage /= 2;
      const damage = Math.ceil(facts.lowerArmActuators[side]
        ? baseDamage
        : Math.floor(baseDamage / 2));
      const armAes = hasActuatorEnhancementSystemAt(facts.equipment, location);
      const hitModifier = (facts.handActuators[side] ? 0 : 1)
        + (facts.lowerArmActuators[side] ? 0 : 2)
        - (armAes ? 1 : 0);
      attacks.push(action(
        `punch:${location}`, 'punch', 'Punch', [location],
        fixedDamage(damage, tsm), hitModifier,
      ));
    }

  }

  const kickDamage = talons
    ? Math.ceil(Math.ceil(facts.tonnage / 5) * 1.5)
    : Math.ceil(facts.tonnage / 5);
  attacks.push(action(
    'kick', 'kick', talons ? 'Kick [Talons]' : 'Kick', [],
    fixedDamage(kickDamage, tsm, isLam ? Math.ceil(kickDamage / 2) : undefined),
    legLocations.every(location => hasActuatorEnhancementSystemAt(
      facts.equipment, location,
    )) ? -1 : 0,
  ));

  if (hasArms && facts.handActuators.left && facts.handActuators.right) {
    const armAes = hasActuatorEnhancementSystemAt(facts.equipment, 'LA')
      && hasActuatorEnhancementSystemAt(facts.equipment, 'RA');
    const clawModifier = facts.equipment.some(item =>
      isImprovisedClawFlags(item.flags)) ? 2 : 0;
    attacks.push(action(
      'club', 'club', 'Club (Club/Improvised)', [],
      fixedDamage(Math.ceil(facts.tonnage / 5), tsm),
      clawModifier - (armAes ? 1 : 0),
    ));
  }

  if (facts.installedJumpMp > 0) {
    const baseDamage = Math.ceil(facts.tonnage / 10 * 3);
    attacks.push(action(
      'death-from-above', 'death-from-above', talons ? 'DFA [Talons]' : 'Death From Above', [],
      fixedDamage(talons ? Math.ceil(baseDamage * 1.5) : baseDamage, false), 'versus',
    ));
  }

  const ramPlate = facts.equipment.some(item => hasRamPlateFlags(item.flags));
  const spikeCount = facts.equipment.filter(item => hasSpikesFlags(item.flags)).length;
  attacks.push(action('charge', 'charge', 'Charge', [], Object.freeze({
    kind: 'per-hex',
    coefficient: facts.tonnage / 10 * (ramPlate ? 1.5 : 1),
    bonus: spikeCount * 2,
  }), 'versus'));

  if (isLam) attacks.push(action('airmek-ram', 'airmek-ram', 'AirMek Ram', [], Object.freeze({
    kind: 'per-hex', coefficient: facts.tonnage / 5, bonus: 0,
  }), 'versus'));

  if (hasArms) {
    const armAes = hasActuatorEnhancementSystemAt(facts.equipment, 'LA')
      && hasActuatorEnhancementSystemAt(facts.equipment, 'RA');
    attacks.push(action(
      'push', 'push', 'Push', [], Object.freeze({ kind: 'none' }), armAes ? -1 : 0,
    ));
  }

  return Object.freeze(attacks);
}

/** Canonical construction-time damage text for legacy presentation adapters. */
export function intrinsicActionBaseDamageText(action: IntrinsicWeapon): string {
  if (action.damage.kind === 'none') return '—';
  if (action.damage.kind === 'fixed') return `${action.damage.value}`;
  const coefficient = Number.isInteger(action.damage.coefficient)
    ? action.damage.coefficient.toFixed(0)
    : `${action.damage.coefficient}`;
  return `${coefficient}/hex${action.damage.bonus === 0 ? '' : `+${action.damage.bonus}`}`;
}

function hasActuatorEnhancementSystemAt(
  equipment: readonly MekIntrinsicEquipmentFact[],
  location: string,
): boolean {
  return equipment.some(item => item.location === location
    && isActuatorEnhancementSystemFlags(item.flags));
}


function fixedDamage(
  damage: number,
  tsm: boolean,
  alternateDamage?: number,
): IntrinsicWeaponDamage {
  const alternative = alternateDamage === undefined
    ? undefined
    : Object.freeze({
      kind: 'fixed' as const,
      value: alternateDamage,
      ...(tsm ? { boostedValue: alternateDamage * 2 } : {}),
    });
  return Object.freeze({
    kind: 'fixed',
    value: damage,
    ...(tsm ? { boostedValue: damage * 2 } : {}),
    ...(alternative ? { alternatives: Object.freeze({ airmek: alternative }) } : {}),
  });
}

function action(
  id: string,
  kind: IntrinsicWeaponKind,
  name: string,
  locations: readonly string[],
  damage: IntrinsicWeaponDamage,
  hitModifierAdjustment: IntrinsicWeapon['hitModifierAdjustment'],
): IntrinsicWeapon {
  return Object.freeze({
    source: 'intrinsic',
    id: `intrinsic:${id}`,
    kind,
    name,
    locations: Object.freeze([...locations]),
    damage,
    hitModifierAdjustment,
  });
}
