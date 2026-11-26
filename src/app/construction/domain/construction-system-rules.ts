// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import {
  AeroEntity,
  BattleArmorEntity,
  ConvFighterEntity,
  InfantryEntity,
  MekEntity,
  VehicleEntity,
} from '../../models/entity/entities';
import {
  COCKPIT_DATA,
  ENGINE_DATA,
  GYRO_DATA,
  MountedEngine,
  getFixedWingSupportConstructionTech,
  getInfantryMotiveTech,
  getSupportTankConstructionTech,
} from '../../models/entity/components';
import type { GyroType } from '../../models/entity/components/gyro-data';
import { TECH_RATINGS, type CockpitType, type EngineType, type EntityMountedEquipment, type EntityTechBase, type MekSystemType, type MotiveType } from '../../models/entity/types';
import { mekLocationId, mekSystemComponentId } from '../../models/entity/mek-entity-conventions';
import { constructionEngineTechnology, constructionTechnologyEligibility } from './construction-technology-rules';
import { WeaponEquipment, type Equipment } from '../../models/equipment.model';

export function replaceConstructionEngine(entity: BaseEntity,
  changes: Partial<{ type: EngineType; rating: number; techBase: 'IS' | 'Clan'; installed: boolean }>): void {
  const old = entity.mountedEngine();
  const next = new MountedEngine({
    type: old.type(), rating: old.rating, installed: true, baseChassisHeatSinks: old.getBaseChassisHeatSinks(false),
    ...changes, techBase: entity.mixedTech() ? changes.techBase ?? old.techBase : entity.techBase(),
  });
  if (entity instanceof MekEntity) entity.configureEngine(next);
  else entity.mountedEngine.set(next);
}

export function mekConstructionEngineLimit(entity: BaseEntity, primitive = entity instanceof MekEntity && entity.mountedCockpit().isPrimitive): number {
  return primitive || entity.mountedEngine().type() === 'Compact' ? 400 : 500;
}

export function syncConstructionMekEngine(entity: MekEntity, walkMP = entity.originalWalkMP(), tonnage = entity.tonnage(),
  primitive = entity.mountedCockpit().isPrimitive): void {
  const rating = entity.calculateEngineRating(walkMP, tonnage, primitive);
  const limit = mekConstructionEngineLimit(entity, primitive);
  if (rating < 10 || rating > limit || rating % 5 !== 0)
    throw new Error(`This movement and tonnage require engine rating ${rating}; choose a rating from 10 to ${limit} in increments of five.`);
  const engine = entity.mountedEngine();
  if (rating !== engine.rating || !engine.installed || (!entity.mixedTech() && engine.techBase !== entity.techBase()))
    replaceConstructionEngine(entity, { rating });
}

/** Read the fixed template, before mounted equipment overlays the critical grid: each system slot and its system. */
export function constructionSystemSlotKeys(entity: BaseEntity): ReadonlyMap<string, string> {
  const slots = new Map<string, string>();
  if (entity instanceof MekEntity) for (const location of entity.locationOrder) {
    entity.getSystemSlotsForLocation(location).forEach((slot, index) => {
      if (slot.type === 'system') slots.set(`${location}:${index}`, slot.systemType);
    });
  }
  return slots;
}

/** System slot keys grouped by the component they belong to (engine and gyro Mek-wide, actuators per location). */
export function constructionSystemComponents(slots: ReadonlyMap<string, string>): ReadonlyMap<string, readonly string[]> {
  const components = new Map<string, string[]>();
  for (const [key, system] of slots) {
    const id = mekSystemComponentId(system as MekSystemType, mekLocationId(key.slice(0, key.indexOf(':')))!);
    components.set(id, [...components.get(id) ?? [], key]);
  }
  return components;
}

/**
 * New system slots displace whole mounts; leave all other placements as authored. Armor covers every slot of its
 * component (TO:AUE p. 95): a fully armored component keeps it over its new slots, and a slot that no longer holds the
 * same system loses it.
 */
export function reconcileConstructionSystemSlots(entity: BaseEntity, previous: ReadonlyMap<string, string>): void {
  const current = constructionSystemSlotKeys(entity);
  if (entity instanceof MekEntity) {
    const armored = entity.armoredSystemSlots();
    const kept = new Set([...armored].filter(key => current.has(key) && (!previous.has(key) || previous.get(key) === current.get(key))));
    const before = constructionSystemComponents(previous);
    for (const [id, keys] of constructionSystemComponents(current)) {
      if (before.get(id)?.every(key => armored.has(key))) for (const key of keys) kept.add(key);
    }
    if (kept.size !== armored.size || [...kept].some(key => !armored.has(key))) entity.armoredSystemSlots.set(kept);
  }
  if (!(entity instanceof MekEntity)) return;
  // System slots that come or go move the location's equipment down or up, keeping its order, so it stays packed from
  // the first free slot as MegaMek reads it; what no longer fits is left unallocated.
  const changed = new Set([...previous.keys(), ...current.keys()].filter(key => previous.get(key) !== current.get(key))
    .map(key => key.slice(0, key.indexOf(':'))));
  const overflow: EntityMountedEquipment[] = [];
  for (const location of changed) entity.arrangeEquipment(location, undefined, overflow);
  if (!overflow.length) return;
  const displaced = new Set(overflow.map(mount => mount.mountId));
  entity.updateEquipment(mounts => mounts.map(mount =>
    displaced.has(mount.mountId) ? mount.clone({ allocation: { kind: 'unallocated' } }) : mount));
}

/**
 * Keeps every Mek location packed from its first free slot in its current order, as MegaMek's MtfFile reads it, with
 * split weapons ordered so each row reads back as its own. A location that cannot be packed (a draft whose blocks do
 * not fit) is left as it is.
 */
export function packConstructionMekLocations(entity: BaseEntity): void {
  if (!(entity instanceof MekEntity)) return;
  for (const location of entity.locationOrder) {
    const overflow: EntityMountedEquipment[] = [];
    entity.planEquipmentOrder(location, undefined, entity.equipment(), overflow);
    if (!overflow.length) entity.arrangeEquipment(location);
  }
}

/** TechManual p. 19; MML also excludes primitive fighters, primitive Meks and LAMs. */
export function constructionOmniApplies(entity: BaseEntity): boolean {
  if (entity instanceof MekEntity)
    return !entity.isIndustrial() && !entity.mountedCockpit().isPrimitive && entity.chassisConfig !== 'LAM';
  if (entity instanceof VehicleEntity || entity.isSupportVehicle()) return true;
  return entity.entityType === 'Aero' && entity instanceof AeroEntity && entity.cockpitType() !== 'Primitive';
}

export function constructionFullHeadEjectionApplies(entity: MekEntity): boolean {
  return !['Torso-Mounted', 'Command Console'].includes(entity.cockpitType());
}

/** MekConstructionUtil.removesHandAndLowerArmSlotsOnOmni, including AC subclasses. */
export function constructionOmniWeaponRemovesArmActuators(equipment: Equipment): boolean {
  return (
    equipment instanceof WeaponEquipment &&
    (equipment.hasAnyFlag(['F_GAUSS', 'F_PPC']) ||
      [
        'AC',
        'AC_IMP',
        'AC_PRIMITIVE',
        'AC_ULTRA',
        'AC_ULTRA_THB',
        'AC_LBX',
        'AC_LBX_THB',
        'AC_ROTARY',
        'LAC',
        'HVAC',
      ].includes(equipment.ammoType))
  );
}

/** MML's engine-family restrictions, independent of installation space. */
export function constructionEngineApplies(
  entity: BaseEntity,
  type: EngineType,
  base: EntityTechBase,
  rating = entity.mountedEngine().rating,
): boolean {
  if (!entity.isSupportVehicle() && base === 'Clan' && (type === 'Light' || type === 'Fission')) return false;
  if (!entity.isSupportVehicle() && type === 'Compact' && rating > 400) return false;
  if (entity.isSupportVehicle()) return constructionSupportEngineApplies(entity, type);
  if (entity instanceof MekEntity) {
    const primitive = entity.mountedCockpit().isPrimitive;
    if (primitive && rating > 400) return false;
    if (entity.chassisConfig === 'LAM') return type === 'Fusion' || type === 'Compact';
    if (entity.isIndustrial() || primitive)
      return entity.isSuperHeavy() ? type === 'Fusion' : ['Fusion', 'ICE', 'Fuel Cell', 'Fission'].includes(type);
    if (!['Fusion', 'XL', 'XXL', 'Light', 'Compact', 'ICE', 'Fuel Cell', 'Fission'].includes(type)) return false;
    return ENGINE_DATA[type].powerSource === 'fusion' || (!entity.isSuperHeavy() && entity.rulesLevel() >= 4);
  }
  if (entity instanceof ConvFighterEntity) return ['Fusion', 'XL', 'XXL', 'Light', 'ICE', 'Fission'].includes(type);
  if (entity instanceof AeroEntity)
    return entity.cockpitType() === 'Primitive' ? type === 'Fusion' : ENGINE_DATA[type].powerSource === 'fusion';
  if (entity instanceof VehicleEntity)
    return type === 'None'
      ? entity.isTrailer()
      : ['Fusion', 'XL', 'XXL', 'Light', 'Compact', 'ICE', 'Fuel Cell', 'Fission'].includes(type);
  return true;
}

/** TestSupportVehicle.SVEngine; the same predicate serves selectors and validation. */
export function constructionSupportEngineApplies(entity: BaseEntity, type: EngineType): boolean {
  const mode = entity.motiveType();
  switch (type) {
    case 'Steam':
      return ['Wheeled', 'Tracked', 'Airship', 'Naval', 'Hydrofoil', 'Submarine', 'Rail', 'MagLev'].includes(mode);
    case 'Solar':
      return [
        'Wheeled',
        'Tracked',
        'Airship',
        'Aerodyne',
        'Naval',
        'Hydrofoil',
        'Submarine',
        'WiGE',
        'Station Keeping',
      ].includes(mode);
    case 'Maglev':
    case 'External':
      return mode === 'Rail' || mode === 'MagLev';
    case 'None':
      return (
        entity instanceof VehicleEntity &&
        entity.effectiveIsTrailer() &&
        ['Wheeled', 'Tracked', 'Rail', 'MagLev'].includes(mode)
      );
    case 'ICE':
      return mode !== 'Station Keeping';
    case 'Battery':
    case 'Fuel Cell':
    case 'Fusion':
    case 'Fission':
      return true;
    default:
      return false;
  }
}

export function constructionEngineCompatible(entity: BaseEntity, type: EngineType, base: EntityTechBase): boolean {
  const tech = constructionTechnologyEligibility(
    entity,
    constructionEngineTechnology(entity, type, base),
    entity.isSupportVehicle() ? undefined : base,
  );
  return (
    constructionEngineApplies(entity, type, base) &&
    tech.techBase &&
    tech.available &&
    tech.rulesLevel &&
    (!entity.isSupportVehicle() || constructionSupportEngineRatingApplies(type, entity.engineTechRating()))
  );
}

/** TM p. 127: Steam, ICE, Battery and Fuel Cell engines carry fuel by weight; Solar, Fission and Fusion list none. */
export function constructionSupportEngineBurnsFuel(type: EngineType): boolean {
  return (['Steam', 'ICE', 'Battery', 'Fuel Cell'] as readonly EngineType[]).includes(type);
}

export function constructionSupportEngineRatingApplies(type: EngineType, rating: number): boolean {
  return (
    type === 'None' ||
    ENGINE_DATA[type].svWeightMultipliers[TECH_RATINGS[rating]] > 0
  );
}

export function constructionBattleArmorChassisApplies(chassis: string, weightClass: string): boolean {
  return chassis !== 'Quad' || weightClass !== 'Ultra Light';
}

/** Cockpit owns primitive classification, so both primitive and modern transitions remain possible. */
export function constructionCockpitApplies(entity: MekEntity, type: CockpitType): boolean {
  const cockpit = COCKPIT_DATA[type];
  if (entity.chassisConfig === 'QuadVee') return type === 'QuadVee';
  if (entity.chassisConfig === 'LAM') return type === 'Standard' || type === 'Small';
  if (
    type === 'QuadVee' ||
    cockpit.isSuperHeavy !== entity.isSuperHeavy() ||
    cockpit.isTripod !== (entity.motiveType() === 'Tripod')
  )
    return false;
  if (!entity.isIndustrial()) return !cockpit.isIndustrial;
  if (cockpit.isSuperHeavy || cockpit.isTripod) return true;
  return ['Industrial', 'Standard', 'Command Console', 'Torso-Mounted', 'Primitive Industrial', 'Primitive'].includes(
    type,
  );
}

export function constructionGyroApplies(entity: MekEntity, type: GyroType): boolean {
  if (type === 'None') return entity.cockpitType() === 'Interface';
  if (entity.isSuperHeavy()) return type === 'Superheavy';
  if (type === 'Superheavy') return false;
  if (entity.isIndustrial() || entity.mountedCockpit().isPrimitive) return type === 'Standard';
  return entity.chassisConfig !== 'LAM' || type !== 'XL';
}

/** A gyro-less Mek uses the interface cockpit technology; None has no standalone introduction date. */
export function constructionGyroTechnology(entity: MekEntity, type: GyroType) {
  return type === 'None' && entity.cockpitType() === 'Interface' ? COCKPIT_DATA.Interface.tech : GYRO_DATA[type].tech;
}

export function constructionMotiveCompatible(entity: BaseEntity, mode: MotiveType): boolean {
  const source =
    entity instanceof InfantryEntity
      ? getInfantryMotiveTech(mode)
      : entity.entityType === 'FixedWingSupport'
        ? getFixedWingSupportConstructionTech(mode, entity.weightClass())
        : entity.isSupportVehicle()
          ? getSupportTankConstructionTech(mode, entity.weightClass())
          : null;
  if (source) {
    const tech = constructionTechnologyEligibility(entity, source);
    if (!tech.techBase || !tech.available || !tech.rulesLevel) return false;
  }
  if (entity instanceof BattleArmorEntity) {
    if (entity.chassisType() === 'Quad') return mode === 'Leg';
    if (mode === 'VTOL') return !['Heavy', 'Assault'].includes(entity.weightClass());
  }
  return true;
}
