// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ArmorEquipment, StructureEquipment } from '../../equipment.model';
import type { BaseEntity } from '../base-entity';
import type { ParseContext } from './parse-context';

/**
 * Older files can name a slot-bearing armor or structure with the opposite tech
 * base (an `IS Ferro-Fibrous` slot on Clan ferro-fibrous armor). The material
 * installed at the slot's location is authoritative, so patchwork armor and
 * hybrid structure are resolved per location. Must run after armor and
 * structure are installed on the entity. Only the name changes: a slot count
 * that does not fit the installed material stays a construction error.
 */
export function installedMaterialSlotName(
  entity: BaseEntity,
  location: string,
  name: string,
  ctx: ParseContext,
): string {
  const listed = ctx.equipmentRegistry.findForTechBase(name, entity.techBase());
  let installed: ArmorEquipment | StructureEquipment | undefined;
  if (listed instanceof ArmorEquipment) {
    const armor = entity.armorByLocation().get(location)?.armor;
    if (armor?.armorType === listed.armorType) installed = armor;
  } else if (listed instanceof StructureEquipment) {
    const structure = entity.structureByLocation().get(location)?.structure;
    if (structure?.structureTypeId === listed.structureTypeId) installed = structure;
  }
  if (!listed || !installed || installed.id === listed.id) return name;

  const message = `Slot "${name}" converted to "${installed.id}" to match the installed ${listed.type}.`;
  if (!ctx.warnings.some((warning) => warning.message === message)) {
    ctx.warn(installed instanceof ArmorEquipment ? 'Armor' : 'Structure', message, 'MATERIAL_SLOT_TECH_BASE');
  }
  return installed.id;
}
