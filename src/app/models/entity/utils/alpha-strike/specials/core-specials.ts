/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 */

import type { ASUnitTypeCode } from '../../../../units.model';
import { MekEntity, type BaseEntity, VehicleEntity } from '../../../entities';
import { isAerospaceElement, isFighter, LARGE_AEROSPACE_TYPES } from '../foundation/unit-classification';
import { hasExplosiveComponent } from './explosive-components';

export interface AlphaStrikeCoreSpecialContext {
  readonly type: ASUnitTypeCode;
  /** Aerospace elements only receive ENE when their standard damage is non-zero. */
  readonly hasStandardDamage: boolean;
}

const STEALTH_ARMOR_TYPES = new Set([
  'STEALTH',
  'STEALTH_VEHICLE',
  'BA_STEALTH',
  'BA_STEALTH_BASIC',
  'BA_STEALTH_IMP',
  'BA_STEALTH_PROTOTYPE',
]);

/**
 * Converts export-visible, non-weapon Alpha Strike special abilities.
 * Weapon and transport abilities intentionally remain in their dedicated
 * conversion stages, where their values and locations can be represented.
 */
export function alphaStrikeCoreSpecials(
  entity: BaseEntity,
  context: AlphaStrikeCoreSpecialContext,
): string[] {
  const specials = new Set<string>();
  const explosive = hasExplosiveComponent(entity);

  if (eligibleForENE(entity, context) && !explosive) specials.add('ENE');
  addEquipmentSpecials(entity, context.type, explosive, specials);
  addUnitSpecials(entity, specials);
  finalizeSpecials(specials);
  return [...specials].sort();
}

function eligibleForENE(entity: BaseEntity, context: AlphaStrikeCoreSpecialContext): boolean {
  if (context.type === 'CI' || context.type === 'BA' || LARGE_AEROSPACE_TYPES.has(context.type)) return false;
  return !isAerospaceElement(entity, context.type) || context.hasStandardDamage;
}

function addEquipmentSpecials(
  entity: BaseEntity,
  type: ASUnitTypeCode,
  explosive: boolean,
  specials: Set<string>,
): void {
  const caseEligible = eligibleForCASE(entity, type);
  if (explosive && caseEligible && entity.techBase() === 'Clan'
    && ['BM', 'IM', 'SV', 'CV', 'MS'].includes(type)) specials.add('CASE');

  for (const mount of entity.equipment()) {
    const equipment = mount.equipment;
    if (!equipment) continue;
    if (equipment.hasFlag('F_NOVA')) {
      specials.add('PRB');
      specials.add('ECM');
      specials.add('NOVA');
    } else if (equipment.hasFlag('F_WATCHDOG')) {
      specials.add('LPRB');
      specials.add('ECM');
      specials.add('WAT');
    } else if (equipment.hasFlag('F_BLOODHOUND')) {
      specials.add('BH');
    } else if (equipment.hasFlag('F_BAP')) {
      specials.add('PRB');
    } else if (equipment.hasFlag('F_ECM')) {
      if (equipment.hasFlag('F_ANGEL_ECM')) specials.add('AECM');
      else if (equipment.hasFlag('F_SINGLE_HEX_ECM')) specials.add('LECM');
      else specials.add('ECM');
    } else if (caseEligible && equipment.hasFlag('F_CASE')) {
      specials.add('CASE');
    } else if (caseEligible && equipment.hasFlag('F_CASE_P')) {
      specials.add('CASEP');
    } else if (caseEligible && equipment.hasFlag('F_CASE_II')) {
      specials.add('CASEII');
    }
  }
}

function eligibleForCASE(entity: BaseEntity, type: ASUnitTypeCode): boolean {
  return type !== 'CI' && type !== 'BA' && type !== 'PM'
    && !isFighter(entity, type) && !LARGE_AEROSPACE_TYPES.has(type);
}

function addUnitSpecials(entity: BaseEntity, specials: Set<string>): void {
  const armor = entity.uniformArmor()?.armor;
  if (!entity.hasPatchworkArmor() && armor && STEALTH_ARMOR_TYPES.has(armor.armorType)) {
    specials.add('STL');
  }
  if ((entity instanceof MekEntity || entity instanceof VehicleEntity) && entity.omni()) {
    specials.add('OMNI');
  }
}

function finalizeSpecials(specials: Set<string>): void {
  if (specials.has('CASEII')) specials.delete('CASE');
  if (specials.has('AECM')) specials.delete('ECM');
  if (['PRB', 'LPRB', 'BH', 'WAT', 'NOVA'].some(special => specials.has(special))) {
    specials.add('RCN');
  }
  if (specials.has('ENE')) {
    specials.delete('CASE');
    specials.delete('CASEII');
    specials.delete('CASEP');
  }
}