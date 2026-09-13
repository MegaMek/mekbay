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
  getFixedWingSupportConstructionTech,
  getInfantryMotiveTech,
  getSupportTankConstructionTech,
} from '../../models/entity/components';
import type { GyroType } from '../../models/entity/components/gyro-data';
import type { CockpitType, EngineType, EntityTechBase, MotiveType, TechRating } from '../../models/entity/types';
import { constructionEngineTechnology, constructionTechnologyEligibility } from './construction-technology-rules';
import { WeaponEquipment, type Equipment } from '../../models/equipment.model';

/** Read the fixed template, before mounted equipment overlays the critical grid. */
export function constructionSystemSlotKeys(entity: BaseEntity): ReadonlySet<string> {
  const slots = new Set<string>();
  if (entity instanceof MekEntity) for (const location of entity.locationOrder) {
    entity.getSystemSlotsForLocation(location).forEach((slot, index) => {
      if (slot.type === 'system') slots.add(`${location}:${index}`);
    });
  }
  return slots;
}

/** New system slots displace whole mounts; leave all other placements as authored. */
export function reconcileConstructionSystemSlots(entity: BaseEntity, previous: ReadonlySet<string>): void {
  const added = new Set([...constructionSystemSlotKeys(entity)].filter(key => !previous.has(key)));
  if (!added.size) return;
  // Release every affected mount together, without packing one into another's slots.
  entity.updateEquipment(mounts => mounts.map(mount =>
    mount.placements?.some(placement => added.has(`${placement.location}:${placement.slotIndex}`))
      ? mount.clone({ allocation: { kind: 'unallocated' } })
      : mount));
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

export function constructionSupportEngineRatingApplies(type: EngineType, rating: number): boolean {
  return (
    type === 'None' ||
    ENGINE_DATA[type].svWeightMultipliers[(['A', 'B', 'C', 'D', 'E', 'F'] as const)[rating] as TechRating] > 0
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
