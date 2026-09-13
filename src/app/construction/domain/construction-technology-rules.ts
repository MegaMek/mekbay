// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import { AeroEntity, DropShipEntity, InfantryEntity, MekEntity, VehicleEntity } from '../../models/entity/entities';
import { DROPSHIP_COLLAR_TECH, getEngineTechAdvancement, getSupportComponentTech } from '../../models/entity/components';
import { MIXED_TECH, OMNI_TECH, OMNI_VEHICLE_TECH, PATCHWORK_ARMOR_TECH } from '../../models/entity/components/entity-system-tech-data';
import { compareTechLevels, getTechMilestoneYear, isTechnologyAvailable, type ComponentTechLevel,
  type EngineType, type EntityTechBase, type EntityValidationMessage, type TechFactions, type TechRatingSource } from '../../models/entity/types';

export interface ConstructionTechnologyEligibility {
  readonly techBase: boolean;
  readonly available: boolean;
  readonly rulesLevel: boolean;
}

/** Resolve the same candidate engine variant for selectors and installed-system validation. */
export function constructionEngineTechnology(entity: BaseEntity, type: EngineType, base: EntityTechBase) {
  return getEngineTechAdvancement(type, { clan: !entity.isSupportVehicle() && base === 'Clan',
    large: entity.usesLargeEngineTechnology() && entity.mountedEngine().rating > 400, supportVee: entity.isSupportVehicle() });
}

/** Native rules levels are static; dates independently constrain technology availability. */
export function constructionTechnologyEligibility(entity: BaseEntity,
  source: TechRatingSource & { readonly factions?: TechFactions }, base?: 'IS' | 'Clan'): ConstructionTechnologyEligibility {
  const sourceBase = source.techBase ?? source.base ?? 'All';
  // Shared technology (for example standard fusion) has no IS/Clan restriction,
  // even when the native file explicitly records a non-Clan engine flag.
  const compatibleBase = entity.mixedTech() || sourceBase === 'All'
    || (base == null || base === entity.techBase()) && sourceBase === entity.techBase();
  const allowed: ComponentTechLevel = (['Introductory', 'Standard', 'Advanced', 'Experimental', 'Unofficial'] as const)[entity.rulesLevel() - 1] ?? 'Unofficial';
  const rulesLevel = source.level === undefined || compareTechLevels(source.level, allowed) <= 0;
  const dates = source.dates ?? source.advancement;
  // Infantry histories are incomplete; context-free chassis records supply only a static rules level.
  if (entity instanceof InfantryEntity || !dates) return { techBase: compatibleBase, available: true, rulesLevel };
  const technology = { level: source.level ?? 'Standard', dates, factions: source.factions };
  const bases: ('IS' | 'Clan')[] = base ? [base] : entity.mixedTech()
    ? sourceBase === 'All' ? ['IS', 'Clan'] : [sourceBase] : [entity.techBase()];
  const start = entity.effectiveOriginalBuildYear(), end = entity.year();
  for (const techBase of bases) {
    const context = { techBase, faction: entity.faction() === 'None' ? undefined : entity.faction() };
    // Availability changes only at its canonical, faction-adjusted milestones.
    const years = new Set([start, end]);
    for (const milestone of ['prototype', 'production', 'common', 'extinct', 'reintroduced'] as const) {
      const year = getTechMilestoneYear(technology, milestone, context);
      if (year != null && year >= start && year <= end) years.add(year);
    }
    for (const year of years) {
      const atYear = { ...context, year };
      if (isTechnologyAvailable(technology, atYear)) return { techBase: compatibleBase, available: true, rulesLevel };
    }
  }
  return { techBase: compatibleBase, available: false, rulesLevel };
}

export function constructionTechnologyYearLabel(entity: BaseEntity): string {
  const start = entity.effectiveOriginalBuildYear(), end = entity.year();
  return start === end ? `${end}` : `${start}–${end}`;
}

/** TestEntity technology constraints, using the same native component records as entity statistics. */
export function constructionTechnologyMessages(entity: BaseEntity): EntityValidationMessage[] {
  // TestInfantry deliberately omits introduction-year verification: infantry equipment histories are incomplete.
  if (entity instanceof InfantryEntity) return [];
  const messages: EntityValidationMessage[] = [];
  const sources: { name: string; source: TechRatingSource & { factions?: TechFactions }; base?: 'IS' | 'Clan' }[] =
    entity.entityTechAdvancements().filter(source => !(entity instanceof MekEntity) ||
      source !== entity.mountedCockpit().tech && source !== entity.mountedGyro().tech)
      .map(source => ({ name: source === (entity instanceof AeroEntity ? entity.mountedCockpitTech() : null)
        ? 'Cockpit' : 'Chassis systems', source }));
  const engine = entity.mountedEngine();
  if (entity.isSupportVehicle()) sources.push({ name: 'Structure tech rating', source: getSupportComponentTech(entity.structuralTechRating()) },
    { name: 'Engine tech rating', source: getSupportComponentTech(entity.engineTechRating()) });
  if (entity instanceof DropShipEntity && ['Standard', 'Prototype'].includes(entity.collarType())) sources.push({ name: 'Docking collar', source: DROPSHIP_COLLAR_TECH });
  if (!(entity instanceof MekEntity) && engine.installed) sources.push({ name: 'Engine', base: entity.isSupportVehicle() ? undefined : engine.techBase,
    source: constructionEngineTechnology(entity, engine.type(), engine.techBase) });
  if (entity.omni() && (!(entity instanceof AeroEntity) || entity.techBase() === 'IS')) sources.push({ name: 'Omni chassis', source: entity instanceof VehicleEntity ? OMNI_VEHICLE_TECH : OMNI_TECH });
  if (entity.mixedTech()) sources.push({ name: 'Mixed technology', source: MIXED_TECH });
  if (entity.hasPatchworkArmor()) sources.push({ name: 'Patchwork armor', source: PATCHWORK_ARMOR_TECH });
  const add = (code: string, message: string) => messages.push({ category: 'tech', code, message, severity: 'error' });
  for (const { name, source, base } of sources) {
    const eligibility = constructionTechnologyEligibility(entity, source, base);
    if (!eligibility.techBase) {
      add('SYSTEM_TECH_BASE', `${name} requires mixed technology.`);
    }
    const dates = source.dates ?? source.advancement;
    // Context-free records deliberately add only a rules level (for example, experimental FrankenMek construction).
    if (!dates) {
      if (!eligibility.rulesLevel) add('SYSTEM_TECH_LEVEL', `${name} requires ${source.level!.toLowerCase()} construction rules.`);
      continue;
    }
    if (!eligibility.available) add('SYSTEM_TECH_DATE', `${name} technology is unavailable in ${constructionTechnologyYearLabel(entity)}.`);
    if (!eligibility.rulesLevel) add('SYSTEM_TECH_LEVEL', `${name} exceeds the selected rules level in ${constructionTechnologyYearLabel(entity)}.`);
  }
  return messages;
}
