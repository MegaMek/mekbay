// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentFlag } from '../models/equipment-flags.type';
import { fireControlFeatureFromFlagLookup } from '../models/entity/utils/fire-control';

/** MegaMek export labels for resolved armor type codes. */
const ARMOR_TYPE_DISPLAY_NAME: Readonly<Partial<Record<string, string>>> = Object.freeze({
  STANDARD: 'Standard Armor',
  FERRO_FIBROUS: 'Ferro-Fibrous',
  REACTIVE: 'Reactive',
  REFLECTIVE: 'Reflective',
  HARDENED: 'Hardened',
  LIGHT_FERRO: 'Light Ferro-Fibrous',
  HEAVY_FERRO: 'Heavy Ferro-Fibrous',
  PATCHWORK: 'Patchwork',
  STEALTH: 'Stealth',
  FERRO_FIBROUS_PROTO: 'Ferro-Fibrous Prototype',
  COMMERCIAL: 'Commercial, BAR: 5',
  INDUSTRIAL: 'Industrial',
  HEAVY_INDUSTRIAL: 'Heavy Industrial',
  FERRO_LAMELLOR: 'Ferro-Lamellor',
  PRIMITIVE: 'Primitive',
  EDP: 'Electric Discharge ProtoMech',
  ANTI_PENETRATIVE_ABLATION: 'Anti-Penetrative Ablation',
  HEAT_DISSIPATING: 'Heat-Dissipating',
  IMPACT_RESISTANT: 'Impact-Resistant',
  BALLISTIC_REINFORCED: 'Ballistic-Reinforced',
  ALUM: 'Ferro-Aluminum',
  HEAVY_ALUM: 'Heavy Ferro-Aluminum',
  LIGHT_ALUM: 'Light Ferro-Aluminum',
  FERRO_ALUM_PROTO: 'Prototype Ferro-Aluminum',
  STEALTH_VEHICLE: 'Vehicular Stealth',
  LC_FERRO_CARBIDE: 'Ferro-Carbide',
  LC_LAMELLOR_FERRO_CARBIDE: 'Lamellor Ferro-Carbide',
  LC_FERRO_IMP: 'Improved Ferro-Aluminum',
  AEROSPACE: 'Standard Aerospace',
  STANDARD_PROTOMEK: 'Standard ProtoMech',
  PRIMITIVE_FIGHTER: 'Primitive Fighter',
  PRIMITIVE_AERO: 'Primitive Aerospace',
  BA_STANDARD: 'BA Standard (Basic)',
  BA_STANDARD_PROTOTYPE: 'BA Standard (Prototype)',
  BA_STANDARD_ADVANCED: 'BA Advanced',
  BA_STEALTH_BASIC: 'BA Stealth (Basic)',
  BA_STEALTH: 'BA Stealth (Standard)',
  BA_STEALTH_IMP: 'BA Stealth (Improved)',
  BA_STEALTH_PROTOTYPE: 'BA Stealth (Prototype)',
  BA_FIRE_RESIST: 'BA Fire Resistant',
  BA_MIMETIC: 'BA Mimetic',
  BA_REFLECTIVE: 'BA Laser Reflective (Reflec/Glazed)',
  BA_REACTIVE: 'BA Reactive (Blazer)',
  SV_BAR_2: 'BAR: 2',
  SV_BAR_3: 'BAR: 3',
  SV_BAR_4: 'BAR: 4',
  SV_BAR_5: 'BAR: 5',
  SV_BAR_6: 'BAR: 6',
  SV_BAR_7: 'BAR: 7',
  SV_BAR_8: 'BAR: 8',
  SV_BAR_9: 'BAR: 9',
  SV_BAR_10: 'BAR: 10',
});

export function armorTypeDisplayName(type: string, fallback: string): string {
  return ARMOR_TYPE_DISPLAY_NAME[type] ?? fallback;
}

/** Export label derived only from installed equipment flags. */
export function equipmentFireControlFeature(
  hasEquipmentFlag: (flag: EquipmentFlag) => boolean,
): 'Advanced Fire Control' | 'Basic Fire Control' | undefined {
  return fireControlFeatureFromFlagLookup(hasEquipmentFlag);
}
