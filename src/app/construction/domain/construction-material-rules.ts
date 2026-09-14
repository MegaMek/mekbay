// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import { JumpShipEntity, MekEntity, VehicleEntity } from '../../models/entity/entities';
import { ArmorEquipment, StructureEquipment } from '../../models/equipment.model';
import { isSupportVehicleBarArmor, structureConstructionKind } from '../../models/construction-equipment.model';
import { STRUCTURE_TYPE, type EntityValidationMessage, type TechRating } from '../../models/entity/types';
import { getNumCriticalSlots } from '../../models/entity/utils/equipment-helpers';
import { getStructureTechAdvancement, STANDARD_STRUCTURE_EQUIPMENT } from '../../models/entity/components/structure';
import { getSupportComponentTech } from '../../models/entity/components/construction-tech-data';
import { constructionEquipmentPlatformFlag } from './construction-family-rules';
import { constructionTechnologyEligibility, constructionTechnologyYearLabel } from './construction-technology-rules';
import { constructionEquipmentConflictMessages } from './construction-equipment-conflicts';

/** Armor rating is an installed design choice, not the catalog's minimum technology rating. */
export function constructionArmorTechRating(entity: BaseEntity, location?: string): TechRating {
  const mounted = location ? entity.armorByLocation().get(location) : entity.uniformArmor() ?? entity.armorByLocation().values().next().value;
  return mounted?.techRating ?? (entity.isSupportVehicle() ? (['A', 'B', 'C', 'D', 'E', 'F'] as const)[entity.structuralTechRating()] : 'D');
}

/** MML legalArmorsFor / BMChassisView candidate rules, shared by selectors and validation. */
export function constructionMaterialMessages(entity: BaseEntity, material: ArmorEquipment | StructureEquipment,
  armorRating: TechRating = constructionArmorTechRating(entity)): EntityValidationMessage[] {
  // Building armor is construction-factor protection (TO:AR p.126), not BattleMek armor technology.
  if ((entity.entityType === 'BuildingEntity' || entity.entityType === 'MobileStructure') && material instanceof ArmorEquipment && material.armorType === 'STANDARD') return [];
  // Non-Mek structure is defined by chassis construction, not BattleMek structure technology.
  if (material instanceof StructureEquipment && !(entity instanceof MekEntity)) return [];
  const messages: EntityValidationMessage[] = [];
  const category = material instanceof ArmorEquipment ? 'armor' : 'structure';
  const add = (code: string, message: string) => messages.push({ category, code, message, severity: 'error' });
  const technology = constructionTechnologyEligibility(entity, material instanceof StructureEquipment ? getStructureTechAdvancement(material) : material.tech);
  if (!technology.techBase) add('MATERIAL_TECH_BASE', `${material.name} requires mixed technology.`);
  if (!technology.available) add('MATERIAL_TECH_UNAVAILABLE', `${material.name} is unavailable in ${constructionTechnologyYearLabel(entity)}.`);
  if (!technology.rulesLevel) add('MATERIAL_TECH_LEVEL', `${material.name} exceeds the selected rules level.`);
  if (material instanceof ArmorEquipment) {
    messages.push(...constructionEquipmentConflictMessages(entity, material));
    const flag = constructionEquipmentPlatformFlag(entity);
    // TO:AUE p.94 permits Reactive fighter armor; native armor omits its fighter flag.
    const reactiveFighter = flag === 'F_FIGHTER_EQUIPMENT' && material.armorType === 'REACTIVE';
    if (flag && ((!material.hasFlag(flag) && !reactiveFighter) || material.armorType === 'PATCHWORK')) add('ARMOR_PLATFORM', `${material.name} is not applicable to this unit family.`);
    if (entity instanceof MekEntity) {
      if (material.armorType === 'COMMERCIAL' && !entity.isIndustrial()) add('MEK_COMMERCIAL_ARMOR', 'Commercial armor requires an IndustrialMek.');
      if (entity.isIndustrial() && entity.rulesLevel() < 4 && !material.hasAnyFlag([
        'F_COMMERCIAL_ARMOR', 'F_INDUSTRIAL_ARMOR', 'F_HEAVY_INDUSTRIAL_ARMOR', 'F_PRIMITIVE_ARMOR',
      ])) add('MEK_INDUSTRIAL_ARMOR', 'BattleMek armor on an IndustrialMek requires experimental construction rules.');
      if (entity.chassisConfig === 'LAM' && (material.armorType === 'HARDENED' || (getNumCriticalSlots(entity, material) ?? 0) > 0)) {
        add('LAM_ARMOR', 'LAMs cannot use hardened armor or armor that requires critical slots.');
      }
      if (entity.mountedCockpit().isPrimitive && !(entity.isIndustrial() ? ['COMMERCIAL'] : ['PRIMITIVE', 'INDUSTRIAL']).includes(material.armorType)) {
        add('PRIMITIVE_ARMOR', entity.isIndustrial() ? 'Primitive IndustrialMeks require commercial armor.' : 'Primitive BattleMeks require primitive or industrial armor.');
      }
    }
    if (entity instanceof VehicleEntity && !entity.isSupportVehicle() && material.armorType === 'HARDENED'
      && ['VTOL', 'Hover', 'WiGE'].includes(entity.motiveType())) add('VEHICLE_HARDENED_ARMOR', 'Hardened armor is incompatible with VTOL, hover and WiGE movement.');
    if (entity instanceof JumpShipEntity && entity.driveCoreType() === 'Primitive' && material.armorType !== 'PRIMITIVE_AERO') {
      add('PRIMITIVE_CAPITAL_ARMOR', 'Primitive JumpShips require primitive aerospace armor.');
    }
    if (entity.isSupportVehicle()) {
      const ratingTech = constructionTechnologyEligibility(entity, getSupportComponentTech(['A', 'B', 'C', 'D', 'E', 'F'].indexOf(armorRating)));
      if (!ratingTech.available || !ratingTech.rulesLevel) add('SUPPORT_ARMOR_RATING_TECH', `Armor tech rating ${armorRating} is unavailable at the selected dates and rules level.`);
      const bar = isSupportVehicleBarArmor(material);
      const perPoint = material.weightPerPointSV[armorRating] ?? material.weightPerPoint;
      if (!bar && entity.rulesLevel() < 3) add('SUPPORT_ADVANCED_ARMOR', 'Non-BAR support vehicle armor requires advanced construction rules.');
      if (!entity.equipment().some(mount => mount.equipment?.hasFlag('F_ARMORED_CHASSIS')) && (!bar || perPoint > 0.05)) {
        add('SUPPORT_ARMORED_CHASSIS_REQUIRED', 'Advanced armor or armor heavier than 50 kg per point requires the armored chassis modification.');
      }
      if (bar && (material.bar < 2 || material.bar > 10 || perPoint < 0.001)) add('SUPPORT_BAR_TECH', 'BAR armor must be 2–10 and supported by its armor tech rating.');
    }
  } else if (entity instanceof MekEntity) {
    // Structure defines IndustrialMek status here; keep the choice that changes that status available.
    const kind = structureConstructionKind(material);
    if (entity.isSuperHeavy() && kind && !['industrial', 'endo-steel', 'endo-composite'].includes(kind)) {
      add('SUPERHEAVY_STRUCTURE', 'Superheavy Meks require standard, industrial, endo-steel or endo-composite structure.');
    }
    if (entity.chassisConfig === 'LAM' && (getNumCriticalSlots(entity, material) ?? 0) > 0) add('LAM_STRUCTURE', 'LAMs cannot use structure that requires critical slots.');
    if (entity.mountedCockpit().isPrimitive
        && material.structureTypeId !== STRUCTURE_TYPE.STANDARD
        && material.structureTypeId !== STRUCTURE_TYPE.INDUSTRIAL) add('PRIMITIVE_STRUCTURE', 'Primitive Meks require standard or industrial structure.');
  }
  return messages;
}

export function getConstructionArmorOptions(entity: BaseEntity, showIncompatible = false): readonly ArmorEquipment[] {
  if (!constructionEquipmentPlatformFlag(entity)) return [];
  const existing = [...entity.armorByLocation().values()].map(item => item.armor);
  return [...new Map([...existing, ...Object.values(entity.getEquipmentRegistry().equipment)
    .filter((eq): eq is ArmorEquipment => eq instanceof ArmorEquipment && eq.armorType !== 'PATCHWORK')]
    .map(eq => [eq.id, eq])).values()]
    .filter(eq => showIncompatible || !constructionMaterialMessages(entity, eq).length)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getConstructionStructureOptions(entity: BaseEntity, showIncompatible = false): readonly StructureEquipment[] {
  if (!(entity instanceof MekEntity)) return [];
  const existing = [...entity.structureByLocation().values()].map(item => item.structure);
  const candidates = [...existing, ...Object.values(entity.getEquipmentRegistry().equipment)
    .filter((eq): eq is StructureEquipment => eq instanceof StructureEquipment)];
  if (!candidates.some(eq => eq.structureTypeId === STRUCTURE_TYPE.STANDARD)) candidates.push(STANDARD_STRUCTURE_EQUIPMENT);
  return [...new Map(candidates.map(eq => [eq.id, eq])).values()]
    .filter(eq => showIncompatible || !constructionMaterialMessages(entity, eq).length);
}
