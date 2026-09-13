// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import { buildingHexKey, parseBuildingLocation } from '../../models/entity/types/building';
import type { ComponentId } from '../../models/entity/entity-identifiers';
import { mekLocationId, mekSystemComponentId } from '../../models/entity/mek-entity-conventions';
import {
  AmmoEquipment,
  ArmorEquipment,
  Equipment,
  MiscEquipment,
  StructureEquipment,
  WeaponEquipment,
  ammoMatchesWeapon,
} from '../../models/equipment.model';
import type { EquipmentFlag } from '../../models/equipment-flags.type';
import { getStructureByTypeId, MountedArmor, MountedStructure } from '../../models/entity/components';
import {
  AeroEntity,
  BattleArmorEntity,
  InfantryEntity,
  JumpShipEntity,
  MekEntity,
  ProtoMekEntity,
  SmallCraftEntity,
  StaticEmplacementEntity,
  VehicleEntity,
} from '../../models/entity/entities';
import {
  EntityMountedEquipment,
  resolveArmorEquipment,
  type EntityTechBase,
  type EntityValidationMessage,
  type EntityValidationResult,
  type MekSystemType,
  type MountPlacement,
  type TechRating,
} from '../../models/entity/types';
import { getNumCriticalSlots } from '../../models/entity/utils/equipment-helpers';
import { getMekLocationLabel, isMekLocation } from '../../models/entity/types/mek';
import { getEquipmentTonnage } from '../../models/entity/utils/equipment-tonnage';
import { getConstructionMass, getConstructionMassCapacity } from './construction-factory';
import {
  constructionEquipmentChassisMessages,
  constructionEquipmentPlatformFlag,
  constructionFamilyMessages,
} from './construction-family-rules';
import { weaponBayEquipmentId } from '../../models/entity/utils/implicit-equipment';
import { areMekSplitLocationsAdjacent, getMekSplitPrimaryLocation } from '../../models/entity/types/mek';
import { constructionSupportVesselMessages } from './construction-support-vessel-rules';
import { constructionInfantryBaMessages, constructionBattleArmorCamoCount } from './construction-infantry-ba-rules';
import { isSimpleCamoEquipment } from '../../models/stealth-equipment.model';
import { constructionAdvancedMekMessages } from './construction-advanced-mek-rules';
import { constructionComponentArmorMessages } from './construction-component-armor';
import { constructionEquipmentMessages } from './construction-equipment-rules';
import {
  constructionTechnologyEligibility,
  constructionTechnologyMessages,
  constructionTechnologyYearLabel,
} from './construction-technology-rules';
import { constructionQuirkMessages } from './construction-quirk-rules';
import { firstCriticalSlots } from '../../models/entity/utils/critical-slot-allocation';
import { constructionArmorTechRating, constructionMaterialMessages } from './construction-material-rules';
import { constructionOmniApplies, constructionOmniWeaponRemovesArmActuators } from './construction-system-rules';
import { MekWithArmsEntity } from '../../models/entity/entities/mek/mek-entity';
import { constructionProtoMekRequiresSlot, constructionProtoMekSlotCapacity, constructionProtoMekLocationUsage, constructionProtoMekMessages } from './construction-protomek-rules';
import { constructionEquipmentConflictMessages } from './construction-equipment-conflicts';
import { buildingFacility } from '../../models/entity/utils/building-construction';
export { getConstructionArmorOptions, getConstructionStructureOptions } from './construction-material-rules';

const any = (equipment: Equipment, flags: readonly EquipmentFlag[]) => flags.some((flag) => equipment.hasFlag(flag));

/** Families whose native BLK equipment grammar preserves an authored ammunition quantity. */
export function constructionSupportsAmmoQuantity(entity: BaseEntity): boolean {
  return ['BattleArmor', 'ProtoMek', 'HandheldWeapon', 'DropShip', 'JumpShip', 'WarShip', 'SpaceStation', 'BuildingEntity', 'MobileStructure'].includes(
    entity.entityType,
  );
}

/** Platform eligibility is separate from technology and current space availability. */
export function constructionEquipmentApplies(entity: BaseEntity, equipment: Equipment): boolean {
  if (equipment.isInternalRepresentation || equipment.type === 'armor' || equipment.type === 'structure') return false;
  if (entity instanceof StaticEmplacementEntity) {
    if (entity.hasNoInterior()) return false;
    if (buildingFacility(equipment)) return true;
    if (equipment instanceof AmmoEquipment) return !equipment.hasAnyFlag(['F_BATTLEARMOR', 'F_PROTOMEK']) && equipment.category !== 'Bomb';
    if (equipment instanceof WeaponEquipment) return equipment.isInfantryWeapon() || equipment.hasFlag('F_TANK_WEAPON') || equipment.capital;
    return !equipment.hasFlag('F_TURRET') && equipment.hasAnyFlag([
      'F_SUPPORT_TANK_EQUIPMENT', 'F_DS_EQUIPMENT', 'F_POWER_GENERATOR', 'F_HEAT_SINK', 'F_DOUBLE_HEAT_SINK',
    ]);
  }
  // Heat sinks have only their sink flags in MegaMek's registry; MML handles
  // them through the dedicated heat-sink selector rather than platform flags.
  if (equipment instanceof MiscEquipment && equipment.isHeatSink) return entity instanceof MekEntity;
  if (equipment instanceof AmmoEquipment) {
    if (equipment.ammoType === 'COOLANT_POD' && entity instanceof SmallCraftEntity) return false;
    if (equipment.capital && !(entity instanceof JumpShipEntity || entity.entityType === 'DropShip')) return false;
    if (equipment.ammoType === 'INFANTRY' && !(entity instanceof InfantryEntity || entity instanceof BattleArmorEntity))
      return false;
    if (equipment.category === 'Bomb') return false;
    if (equipment.hasFlag('F_BATTLEARMOR') !== entity instanceof BattleArmorEntity) return false;
    if (equipment.hasFlag('F_PROTOMEK') && !(entity instanceof ProtoMekEntity)) return false;
    if (entity instanceof InfantryEntity)
      return (
        equipment.ammoType === 'INFANTRY' ||
        entity
          .equipment()
          .some(
            (mount) =>
              mount.location === 'Field Guns' &&
              mount.equipment instanceof WeaponEquipment &&
              ammoMatchesWeapon(mount.equipment, equipment),
          )
      );
    if (entity instanceof AeroEntity && !entity.isSupportVehicle()) {
      if (['AC_LBX', 'SBGAUSS'].includes(equipment.ammoType)) return equipment.hasMunitionType('M_CLUSTER');
      if (['ATM', 'IATM'].includes(equipment.ammoType))
        return ['M_STANDARD', 'M_HIGH_EXPLOSIVE', 'M_EXTENDED_RANGE'].some((flag) =>
          equipment.hasMunitionType(flag as 'M_STANDARD'),
        );
      if (
        equipment.ammoType !== 'AR10' &&
        !['M_STANDARD', 'M_ARTEMIS_CAPABLE', 'M_ARTEMIS_V_CAPABLE'].some((flag) =>
          equipment.hasMunitionType(flag as 'M_STANDARD'),
        )
      )
        return false;
    }
    return true;
  }
  if (equipment instanceof WeaponEquipment) {
    if (equipment.hasFlag('F_BOMB_WEAPON') || equipment.id === weaponBayEquipmentId(equipment)) return false;
    if (entity instanceof InfantryEntity) return equipment.isInfantryWeapon() || equipment.hasFlag('F_EXTINGUISHER') || isConstructionFieldGun(equipment);
    if (entity instanceof BattleArmorEntity)
      return (
        (equipment.hasFlag('F_BA_WEAPON') && !equipment.capital && !equipment.subCapital) ||
        (equipment.isInfantryWeapon() &&
          !equipment.hasAnyFlag(['F_INF_POINT_BLANK', 'F_INF_ARCHAIC']) &&
          equipment.infantry.crew < 2)
      );
    if (entity.isSupportVehicle() && entity.tonnage() < 5)
      return equipment.isInfantryWeapon() && !equipment.hasFlag('F_INF_ARCHAIC');
    if (equipment.isInfantryWeapon()) return false;
    if (entity instanceof ProtoMekEntity) return equipment.hasFlag('F_PROTO_WEAPON');
    if (entity instanceof MekEntity) {
      return (
        equipment.hasFlag('F_MEK_WEAPON') &&
        !equipment.capital &&
        !equipment.subCapital &&
        hasStandardWeaponScale(equipment) &&
        !(entity.chassisConfig === 'LAM' && ['GAUSS_HEAVY', 'IGAUSS_HEAVY'].includes(equipment.ammoType))
      );
    }
    if (entity instanceof AeroEntity && !entity.isSupportVehicle()) {
      if (equipment.hasFlag('F_BOMB_WEAPON')) return false;
      if (equipment.ammoType === 'C3_REMOTE_SENSOR') return entity.entityType === 'SmallCraft';
      if (
        equipment.subCapital ||
        (equipment.capital && equipment.hasFlag('F_MISSILE')) ||
        equipment.ammoType === 'SCREEN_LAUNCHER'
      ) {
        return entity.entityType === 'DropShip' || entity instanceof JumpShipEntity;
      }
      if (equipment.capital) return entity instanceof JumpShipEntity;
      if (!equipment.hasFlag('F_AERO_WEAPON')) return false;
      if (equipment.hasFlag('F_ARTILLERY'))
        return (
          entity instanceof SmallCraftEntity ||
          (!(entity instanceof JumpShipEntity) && ['ARROW_IV', 'THUMPER', 'SNIPER'].includes(equipment.ammoType))
        );
      return hasStandardWeaponScale(equipment);
    }
    if (entity.entityType === 'HandheldWeapon') return equipment.hasFlag('F_MEK_WEAPON') && !equipment.capital;
    return (
      equipment.hasFlag('F_TANK_WEAPON') &&
      !equipment.capital &&
      !equipment.subCapital &&
      hasStandardWeaponScale(equipment)
    );
  }
  if (entity instanceof InfantryEntity) return equipment.hasAnyFlag(['F_TOOLS', 'F_ARMOR_KIT', 'F_ANTI_MEK_GEAR']);
  if (entity.entityType === 'HandheldWeapon') return equipment.hasFlag('F_MEK_EQUIPMENT');
  if (equipment.hasFlag('F_FLOTATION_HULL') && entity.entityType === 'ConvFighter') return true;
  const flag = constructionEquipmentPlatformFlag(entity);
  return (
    (flag !== undefined && equipment.hasFlag(flag)) ||
    (entity.motiveType() === 'VTOL' && equipment.hasFlag('F_VTOL_EQUIPMENT'))
  );
}

/** MML UnitUtil.isNonMekOrTankWeapon / AeroUtil exclude nonstandard missile racks and BA plasma representations. */
function hasStandardWeaponScale(equipment: WeaponEquipment): boolean {
  return (
    !(equipment.hasFlag('F_LRM') && ![5, 10, 15, 20].includes(equipment.rackSize)) &&
    !(equipment.hasFlag('F_SRM') && ![2, 4, 6].includes(equipment.rackSize)) &&
    !(['MRM', 'ROCKET_LAUNCHER'].includes(equipment.ammoType) && equipment.rackSize < 10) &&
    !(equipment.hasFlag('F_ENERGY') && equipment.hasFlag('F_PLASMA') && equipment.ammoType === 'NA')
  );
}

/** MegaMekLab CIFieldGunTableView offers these weapon families as field guns/artillery. */
function isConstructionFieldGun(equipment: WeaponEquipment): boolean {
  if (equipment.capital || equipment.hasFlag('F_BA_WEAPON') || equipment.hasFlag('F_BOMB_WEAPON')) return false;
  if (
    [
      'AC',
      'AC_PRIMITIVE',
      'AC_IMP',
      'LAC',
      'PAC',
      'HYPER_VELOCITY',
      'AC_ROTARY',
      'AC_ULTRA',
      'AC_ULTRA_THB',
      'AC_LBX',
      'AC_LBX_THB',
      'RIFLE',
      'THUMPER_CANNON',
      'SNIPER_CANNON',
      'LONG_TOM_CANNON',
    ].includes(equipment.ammoType)
  )
    return true;
  if (equipment.hasFlag('F_GAUSS'))
    return !['GAUSS_HEAVY', 'IGAUSS_HEAVY', 'MAGSHOT', 'HAG'].includes(equipment.ammoType);
  return equipment.hasFlag('F_ARTILLERY') && equipment.ammoType !== 'CRUISE_MISSILE';
}

/** Warehouse eligibility omits allocation, location and free-space constraints. */
export function constructionEquipmentEligibilityIssues(entity: BaseEntity, equipment: Equipment, ignoreMount?: EntityMountedEquipment): readonly string[] {
  const issues = constructionEquipmentPlatformIssues(entity, equipment);
  issues.push(...constructionEquipmentConflictMessages(entity, equipment, ignoreMount).map(message => message.message));
  if (!entity.mountedEquipmentContributesStaticTech(equipment)) return issues;
  const technology = constructionTechnologyEligibility(entity, equipment.tech);
  if (!technology.techBase) issues.push('Requires mixed technology.');
  if (!technology.available) issues.push(`Not available in ${constructionTechnologyYearLabel(entity)}.`);
  if (!technology.rulesLevel) issues.push('Exceeds the selected rules level.');
  return issues;
}

/** Platform and chassis eligibility, independent of technology and location. */
function constructionEquipmentPlatformIssues(entity: BaseEntity, equipment: Equipment): string[] {
  const issues: string[] = [];
  if (!constructionEquipmentApplies(entity, equipment))
    issues.push(`${equipment.name} is not applicable to this unit family.`);
  issues.push(...constructionEquipmentChassisMessages(entity, equipment).map((message) => message.message));
  // MML's default "Ammo w/o Weapon" filter permits coolant pods independently of weapon inventory.
  if (
    equipment instanceof AmmoEquipment &&
    equipment.ammoType !== 'COOLANT_POD' &&
    !entity
      .equipment()
      .some(
        (mount) =>
          mount.equipment instanceof WeaponEquipment &&
          !mount.equipment.hasFlag('F_ONE_SHOT') &&
          ammoMatchesWeapon(mount.equipment, equipment),
      )
  ) {
    issues.push('No installed weapon uses this ammunition.');
  }
  return issues;
}

/** MML exposes patchwork for Meks, vehicles and fighters, not infantry or large craft. */
export function constructionSupportsPatchwork(entity: BaseEntity): boolean {
  return (
    entity instanceof MekEntity ||
    entity instanceof VehicleEntity ||
    (entity instanceof AeroEntity && !(entity instanceof SmallCraftEntity || entity instanceof JumpShipEntity))
  );
}

export function setConstructionPatchwork(entity: BaseEntity, enabled: boolean): void {
  if (!constructionSupportsPatchwork(entity)) throw new Error('This unit family does not support patchwork armor.');
  if (enabled) {
    if (entity.isSupportVehicle()) {
      for (const location of entity.armorLocations) {
        const armor = entity.armorAt(location);
        if (armor.techRating === null)
          entity.setArmorAt(
            location,
            new MountedArmor({
              ...armor,
              techRating: armor.armor.rating as TechRating,
            }),
          );
      }
    }
    entity.enablePatchworkArmor();
  } else entity.setUniformArmor(entity.armorAt(entity.armorLocations[0]));
  if (entity.isSupportVehicle()) entity.barRating.set(entity.armorAt(entity.armorLocations[0]).armor.bar);
  if (entity instanceof MekEntity) reconcileConstructionMaterialSlots(entity, 'armor');
}

export function setConstructionHybridStructure(entity: BaseEntity, enabled: boolean): void {
  if (!(entity instanceof MekEntity)) throw new Error('Hybrid structure requires a Mek.');
  if (enabled) {
    setConstructionOmni(entity, false);
    entity.enableHybridStructure();
  }
  else entity.setUniformStructure(entity.structureAt('CT'));
  reconcileConstructionMaterialSlots(entity, 'structure');
}

/** A chassis edit owns the whole transition, including facts serialized as Omni pods. */
export function setConstructionOmni(entity: BaseEntity, enabled: boolean): void {
  if (enabled && !constructionOmniApplies(entity)) throw new Error('This chassis cannot use Omni technology.');
  if (enabled && entity instanceof MekEntity && entity.hasHybridStructure()) setConstructionHybridStructure(entity, false);
  entity.omni.set(enabled);
  if (enabled) for (const mount of entity.equipment()) if (mount.equipment) {
    removeConstructionOmniArmActuators(entity, mount.equipment, mount.getOccupiedLocations());
  }
  if (!enabled) {
    entity.updateEquipment(mounts => mounts.map(mount => mount.omniPodMounted ? mount.clone({ omniPodMounted: false }) : mount));
    entity.transporters.update(items => items.map(item => item.omni ? { ...item, omni: false } : item));
    if (entity instanceof AeroEntity) entity.omnipodHeatSinkCount.set(0);
    if (entity instanceof VehicleEntity) {
      entity.baseChassisTurretWeight.set(-1);
      entity.baseChassisTurret2Weight.set(-1);
    }
    if (entity.isSupportVehicle()) entity.baseChassisFireConWeight.set(-1);
  }
  if (entity instanceof MekEntity) entity.mountedEngine().setBaseChassisHeatSinks(enabled
    ? entity.heatSinkCount() : -1);
}

/** Retarget equivalent materials; retain unsupported selections so their existing issues stay actionable. */
export function setConstructionTechBase(entity: BaseEntity, base: EntityTechBase): void {
  if (base === entity.techBase()) return;
  entity.techBase.set(base);
  const registry = entity.getEquipmentRegistry();
  let armorChanged = false, structureChanged = false;
  const rebaseArmor = (mounted: MountedArmor): MountedArmor => {
    const candidate = resolveArmorEquipment(mounted.type, base === 'Clan', registry);
    const armor = candidate && (candidate.techBase === 'All' || candidate.techBase === base) ? candidate
      : mounted.armor.techBase === 'All' ? mounted.armor : null;
    if (!armor) return mounted;
    armorChanged ||= armor.id !== mounted.armor.id;
    return new MountedArmor({ armor, techBase: base, techRating: mounted.techRating });
  };
  const uniformArmor = entity.uniformArmor();
  if (uniformArmor && !entity.hasPatchworkArmor()) entity.setUniformArmor(rebaseArmor(uniformArmor));
  else {
    if (entity.hasPatchworkArmor()) entity.enablePatchworkArmor();
    for (const [location, armor] of entity.armorByLocation()) entity.setArmorAt(location, rebaseArmor(armor));
  }
  if (entity instanceof MekEntity) {
    const rebaseStructure = (mounted: MountedStructure): MountedStructure => {
      const structure = getStructureByTypeId(mounted.structure.structureTypeId, base, registry)
        ?? (mounted.structure.techBase === 'All' ? mounted.structure : null);
      if (!structure) return mounted;
      structureChanged ||= structure.id !== mounted.structure.id;
      return new MountedStructure({ structure, tonnage: mounted.tonnage, techBase: base });
    };
    const uniformStructure = entity.uniformStructure();
    if (uniformStructure && !entity.hasHybridStructure()) entity.setUniformStructure(rebaseStructure(uniformStructure));
    else {
      if (entity.hasHybridStructure()) entity.enableHybridStructure();
      for (const [location, structure] of entity.structureByLocation()) entity.setStructureAt(location, rebaseStructure(structure));
    }
    // Release both old reservations before assigning either new material's slots.
    for (const mount of entity.equipment()) {
      if (armorChanged && mount.equipment?.type === 'armor' || structureChanged && mount.equipment?.type === 'structure') entity.removeEquipment(mount);
    }
    if (armorChanged) reconcileConstructionMaterialSlots(entity, 'armor');
    if (structureChanged) reconcileConstructionMaterialSlots(entity, 'structure');
  }
}

export function setConstructionArmorMaterial(entity: BaseEntity, equipment: ArmorEquipment, location?: string): void {
  if (
    location &&
    entity.armorLocations.length > 1 &&
    !(entity instanceof BattleArmorEntity) &&
    !constructionSupportsPatchwork(entity)
  ) {
    throw new Error('This unit family requires uniform armor; choose its material in Chassis & Systems.');
  }
  const rating = constructionArmorTechRating(entity, location);
  const issues = constructionMaterialMessages(entity, equipment, rating);
  if (issues.length) throw new Error(issues.map((issue) => issue.message).join(' '));
  const armor = new MountedArmor({
    armor: equipment,
    techBase: equipment.techBase === 'All' ? entity.techBase() : equipment.techBase,
    techRating: entity.isSupportVehicle() ? rating : null,
  });
  if (entity instanceof BattleArmorEntity) entity.setUniformArmor(armor);
  else if (location) entity.setArmorAt(location, armor);
  else entity.setUniformArmor(armor);
  if (entity.isSupportVehicle()) entity.barRating.set(entity.armorAt(entity.armorLocations[0]).armor.bar);
  if (entity instanceof MekEntity) reconcileConstructionMaterialSlots(entity, 'armor');
}

export function setConstructionStructure(
  entity: BaseEntity,
  equipment: StructureEquipment,
  location?: string,
  donorTonnage?: number,
): void {
  if (!(entity instanceof MekEntity)) throw new Error('This unit derives structure from its chassis settings.');
  const existing = location ? entity.structureAt(location) : entity.uniformStructureMaterial();
  const sameMaterial = existing?.structure.id === equipment.id;
  if (!sameMaterial) {
    const issues = constructionMaterialMessages(entity, equipment);
    if (issues.length) throw new Error(issues.map((issue) => issue.message).join(' '));
  }
  const structure = new MountedStructure({
    structure: equipment,
    tonnage: donorTonnage ?? (location ? entity.structureAt(location).tonnage : entity.tonnage()),
    techBase: sameMaterial ? existing.techBase : equipment.techBase === 'All' ? entity.techBase() : equipment.techBase,
  });
  if (location) entity.setStructureAt(location, structure);
  else entity.setUniformStructure(structure);
  if (entity.hasHybridStructure() || !constructionOmniApplies(entity)) setConstructionOmni(entity, false);
  reconcileConstructionMaterialSlots(entity, 'structure');
}

export interface ConstructionLocation {
  readonly id: string;
  readonly label: string;
  readonly armor: number;
  readonly rearArmor: number;
  readonly maxArmor: number;
  readonly structure: number;
  readonly slots: readonly {
    index: number;
    system?: MekSystemType;
    componentId?: ComponentId;
    mount?: EntityMountedEquipment;
  }[];
  readonly slotCapacity: number | null;
}

export function constructionSlotCapacity(entity: BaseEntity, location: string): number | null {
  if (entity instanceof MekEntity) return entity.criticalSlotCapacity(location);
  if (entity instanceof ProtoMekEntity) {
    return constructionProtoMekSlotCapacity(entity, location);
  }
  return null;
}

export function getConstructionLocations(entity: BaseEntity): ConstructionLocation[] {
  const locations = [...new Set([...entity.locationOrder, ...entity.validLocations])];
  if (entity instanceof VehicleEntity || entity instanceof ProtoMekEntity) {
    if (!locations.includes('Body')) locations.push('Body');
  }
  const grid = entity instanceof MekEntity ? entity.criticalSlotGrid() : null;
  return locations.map((id) => {
    const armor = entity.armorValues().get(entity instanceof BattleArmorEntity ? 'Squad' : id);
    const capacity = constructionSlotCapacity(entity, id);
    const slots: ConstructionLocation['slots'][number][] = [];
    if (entity instanceof MekEntity && grid) {
      const physical = grid.get(id as Parameters<typeof grid.get>[0]);
      for (let index = 0; index < (capacity ?? 0); index++) {
        const slot = physical?.[index];
        slots.push({
          index,
          ...(slot?.type === 'system'
            ? {
                system: slot.systemType,
                componentId: mekSystemComponentId(slot.systemType, mekLocationId(id)!),
              }
            : {}),
          ...(slot?.type === 'equipment' ? { mount: slot.mounts[0] } : {}),
        });
      }
    } else {
      entity.getEquipmentAtLocation(id).forEach((mount, index) => slots.push({ index, mount }));
      if (capacity !== null) while (slots.length < capacity) slots.push({ index: slots.length });
    }
    return {
      id,
      label: entity instanceof StaticEmplacementEntity ? entity.displayLocation(id) : getMekLocationLabel(id) ?? id,
      armor: armor?.front ?? 0,
      rearArmor: armor?.rear ?? 0,
      maxArmor: entity.maxArmorValues().get(entity instanceof BattleArmorEntity ? 'Squad' : id) ?? 0,
      structure: entity.structureValues().get(id) ?? 0,
      slots,
      slotCapacity: capacity,
    };
  });
}

export function setConstructionArmor(entity: BaseEntity, location: string, front: number, rear = 0): void {
  if (!entity.armorLocations.includes(location)) throw new Error('This location has no armor.');
  if (![front, rear].every((value) => Number.isInteger(value) && value >= 0))
    throw new Error('Armor points must be non-negative whole numbers.');
  if (rear > 0 && !entity.hasRearArmor(location)) throw new Error('This location has no rear armor.');
  if (entity instanceof BattleArmorEntity) entity.armorValues.set(new Map([['Squad', { front, rear: 0 }]]));
  else if (entity instanceof StaticEmplacementEntity)
    entity.armorValues.set(new Map(entity.locationOrder.map(location => [location, { front, rear: 0 }])));
  else entity.armorValues.update((values) => new Map(values).set(location, { front, rear }));
}

/** Location rules are adapted from TestMek/Tank/ProtoMek/Aero; no weapon hardpoint fiction. */
export function equipmentPlacementIssues(
  entity: BaseEntity,
  equipment: Equipment,
  location: string,
  ignoreMount?: EntityMountedEquipment,
): string[] {
  if (ignoreMount && isRequiredConstructionEquipment(entity, ignoreMount)) {
    return equipmentLocationIssues(entity, equipment, location, ignoreMount);
  }
  return [
    ...constructionEquipmentEligibilityIssues(entity, equipment, ignoreMount),
    ...equipmentLocationIssues(entity, equipment, location, ignoreMount),
  ];
}

/** Physical placement and capacity, independent of construction eligibility. */
export function equipmentLocationIssues(
  entity: BaseEntity,
  equipment: Equipment,
  location: string,
  ignoreMount?: EntityMountedEquipment,
  checkCapacity = true,
): string[] {
  const issues: string[] = [];
  const must = (condition: boolean, message: string) => {
    if (!condition) issues.push(message);
  };
  must(
    entity.validLocations.has(location) ||
      ((entity instanceof VehicleEntity || entity instanceof ProtoMekEntity) && location === 'Body') ||
      ((entity instanceof BattleArmorEntity || entity instanceof MekEntity) && location === 'None'
        && getNumCriticalSlots(entity, equipment, ignoreMount?.size ?? 1) === 0
        && !(equipment instanceof WeaponEquipment && equipment.isInfantryWeapon())),
    'Invalid equipment location.',
  );
  if (entity instanceof StaticEmplacementEntity && entity.isMobile()) {
    issues.push(...constructionEquipmentConflictMessages(entity, equipment, ignoreMount, location).map(message => message.message));
  }
  if (entity instanceof InfantryEntity) {
    if (equipment instanceof WeaponEquipment)
      must(
        location === (equipment.isInfantryWeapon() || equipment.hasFlag('F_EXTINGUISHER') ? 'Infantry' : 'Field Guns'),
        equipment.isInfantryWeapon() || equipment.hasFlag('F_EXTINGUISHER')
          ? 'Infantry weapons belong with the troopers.'
          : 'Field guns require the Field Guns location.',
      );
    if (equipment instanceof AmmoEquipment)
      must(
        location === (equipment.ammoType === 'INFANTRY' ? 'Infantry' : 'Field Guns'),
        'Ammunition must share the infantry weapon location.',
      );
  } else if (entity instanceof BattleArmorEntity) {
    if (ignoreMount) {
      const pack = entity.getLinkingMount(ignoreMount);
      const attachedToPack = ignoreMount.isDWP || pack?.isDWP
        || pack?.equipment?.hasFlag('F_DETACHABLE_WEAPON_PACK');
      if (equipment.hasFlag('F_BATTLEMEK_NIU')) must(ignoreMount.baMountLocation === 'Body',
        'Neural interfaces require the suit body.');
      else must(!!ignoreMount.baMountLocation || attachedToPack === true
        || getNumCriticalSlots(entity, equipment, ignoreMount.size ?? 1) === 0,
      'Equipment requiring slots must be assigned a suit body or arm location.');
    }
    if (isSimpleCamoEquipment(equipment)) must(constructionBattleArmorCamoCount(entity, location, ignoreMount) === 0,
      'Only one camo system is permitted on a suit.');
  } else if (entity instanceof MekEntity) {
    const torso = ['CT', 'LT', 'RT'].includes(location);
    const arm = ['LA', 'RA'].includes(location);
    const leg = entity.locationIsLeg(location);
    const quad = ['Quad', 'QuadVee'].includes(entity.chassisConfig);
    const system = (name: string) =>
      entity
        .criticalSlotGrid()
        .get(location as Parameters<ReturnType<typeof entity.criticalSlotGrid>['get']>[0])
        ?.some((slot) => slot.type === 'system' && slot.systemType === name) === true;
    if (any(equipment, ['F_CLUB', 'F_HAND_WEAPON', 'F_SHIELD', 'F_SALVAGE_ARM'])) {
      const industrialTool = any(equipment, [
        'S_DUAL_SAW',
        'S_PILE_DRIVER',
        'S_BACKHOE',
        'S_MINING_DRILL',
        'S_COMBINE',
        'S_CHAINSAW',
        'S_ROCK_CUTTER',
        'S_BUZZSAW',
        'S_SPOT_WELDER',
      ]);
      must(
        industrialTool && quad ? ['LT', 'RT'].includes(location) : arm,
        industrialTool && quad ? 'Requires a side torso.' : 'Requires an arm.',
      );
    }
    if (any(equipment, ['F_AP_POD', 'F_TRACKS', 'F_TALON'])) must(leg, 'Requires a leg.');
    if (equipment.hasFlag('F_JUMP_JET')) must(torso || leg, 'Jump jets require a torso or leg.');
    if (equipment.hasFlag('F_ACTUATOR_ENHANCEMENT_SYSTEM')) must(arm || leg, 'Requires an arm or leg.');
    if (equipment.hasFlag('F_HEAD_TURRET')) must(location === 'CT', 'Head turret mechanism requires the center torso.');
    if (any(equipment, ['F_QUAD_TURRET', 'F_SHOULDER_TURRET']))
      must(['LT', 'RT'].includes(location), 'Requires a side torso.');
    if (equipment.hasFlag('F_HARJEL')) must(!system('Cockpit'), 'HarJel cannot share the cockpit location.');
    if (any(equipment, ['F_MASS', 'F_REMOTE_DRONE_COMMAND_CONSOLE']))
      must(system('Cockpit'), 'Requires the cockpit location.');
    if (
      (equipment.hasFlag('F_MASC') && equipment.hasFlag('S_SUPERCHARGER')) ||
      equipment.hasFlag('F_EMERGENCY_COOLANT_SYSTEM')
    )
      must(system('Engine'), 'Requires a location containing engine critical slots.');
    const bridge = any(equipment, ['F_LIGHT_BRIDGE_LAYER', 'F_MEDIUM_BRIDGE_LAYER', 'F_HEAVY_BRIDGE_LAYER']);
    if (bridge) must(quad, 'Bridgelayers require a quad Mek.');
    if (
      bridge ||
      any(equipment, ['F_FUEL', 'F_LADDER', 'F_VGL']) ||
      (equipment.hasFlag('F_CASE') && equipment.techBase !== 'Clan')
    )
      must(torso, 'Requires a torso.');
    if (equipment.hasFlag('F_LIFT_HOIST')) must(torso || arm, 'Lift hoists require a torso or arm.');
    if (equipment.hasFlag('F_MODULAR_ARMOR')) must(location !== 'HD', 'Modular armor cannot be mounted in the head.');
    if (equipment.hasFlag('F_EJECTION_SEAT')) must(location === 'HD', 'Ejection seats require the head.');
    if (
      equipment instanceof WeaponEquipment &&
      ['GAUSS_HEAVY', 'IGAUSS_HEAVY'].includes(equipment.ammoType) &&
      !entity.isSuperHeavy()
    )
      must(torso, 'Heavy Gauss rifles require a torso.');
  } else if (entity instanceof VehicleEntity) {
    const bodyOnly =
      equipment instanceof AmmoEquipment ||
      any(equipment, [
        'F_CHASSIS_MODIFICATION',
        'F_BASIC_FIRE_CONTROL',
        'F_ADVANCED_FIRE_CONTROL',
        'F_CASE',
        'F_CASE_II',
        'F_JUMP_JET',
        'F_FUEL',
        'F_BLUE_SHIELD',
      ]);
    if (bodyOnly) must(location === 'Body', 'Requires the vehicle body.');
    if (equipment instanceof WeaponEquipment) {
      if (!any(equipment, ['F_C3M', 'F_C3MBS', 'F_TAG'])) must(location !== 'Body', 'Weapons need a facing or turret.');
      must(location !== 'Rotor', 'Weapons cannot mount in the rotor.');
      if (equipment.ammoType === 'GAUSS_HEAVY')
        must(['Front', 'Rear'].includes(location), 'Heavy Gauss rifles require the front or rear.');
      if (equipment.ammoType === 'IGAUSS_HEAVY')
        must(!location.includes('Turret'), 'Improved heavy Gauss rifles cannot mount in a turret.');
    }
    if (any(equipment, ['F_BULLDOZER', 'F_MINESWEEPER', 'S_PILE_DRIVER']))
      must(['Front', 'Rear'].includes(location), 'Requires the front or rear.');
    if (equipment.hasFlag('S_WRECKING_BALL')) must(location.includes('Turret'), 'Wrecking balls require a turret.');
    if (equipment.hasFlag('F_MAST_MOUNT')) must(location === 'Rotor', 'Mast mounts require the rotor.');
    if (
      any(equipment, [
        'F_MODULAR_ARMOR',
        'F_HARJEL',
        'F_LIFT_HOIST',
        'F_MANIPULATOR',
        'F_FLUID_SUCTION_SYSTEM',
        'F_LIGHT_FLUID_SUCTION_SYSTEM',
        'F_SPRAYER',
      ])
    )
      must(location !== 'Rotor', 'This equipment cannot mount in the rotor.');
    if (equipment.hasFlag('F_LADDER'))
      must(!['Front', 'Rear', 'Rotor'].includes(location), 'Ladders require a side or turret.');
  } else if (entity instanceof ProtoMekEntity) {
    const needsSlot = constructionProtoMekRequiresSlot(equipment);
    if (!needsSlot) must(location === 'Body', 'This equipment belongs in the ProtoMek body.');
    else must((constructionSlotCapacity(entity, location) ?? 0) > 0, 'This ProtoMek location cannot mount equipment.');
    if (equipment.hasFlag('S_PROTOMEK_WEAPON'))
      must(location.endsWith('Arm'), 'ProtoMek melee weapons require an arm.');
    if (any(equipment, ['F_MAGNETIC_CLAMP', 'S_PROTO_QMS'])) must(location === 'Torso', 'Requires the ProtoMek torso.');
    if (equipment.hasFlag('F_MAGNETIC_CLAMP'))
      must(!entity.isQuad() && !entity.isGlider(), 'Magnetic clamps are unavailable to quad and glider ProtoMeks.');
    if (equipment.hasFlag('S_PROTO_QMS')) must(entity.isQuad(), 'Quad melee systems require a quad ProtoMek.');
    if (equipment.hasFlag('S_PROTOMEK_WEAPON')) must(!entity.isQuad(), 'Arm melee weapons cannot be mounted on quad ProtoMeks.');
    if (needsSlot) {
      const usage = constructionProtoMekLocationUsage(entity, location, ignoreMount);
      must(
        usage.slots + 1 <= usage.maxSlots,
        'The ProtoMek location has no equipment slots left.',
      );
      const candidate = ignoreMount ?? constructionEquipmentCandidate(entity, equipment, location);
      const tons = usage.tons + (getEquipmentTonnage(entity, candidate) ?? 0);
      must(tons <= usage.maxTons + 1e-9, `Equipment exceeds this location's ${usage.maxTons} t limit.`);
    }
  } else if (
    entity instanceof AeroEntity &&
    !(entity instanceof SmallCraftEntity || entity instanceof JumpShipEntity)
  ) {
    const stowage = entity.isSupportVehicle() ? 'Body' : 'Fuselage';
    if (
      equipment instanceof AmmoEquipment ||
      any(equipment, ['F_BASIC_FIRE_CONTROL', 'F_ADVANCED_FIRE_CONTROL', 'F_BLUE_SHIELD', 'F_LIFT_HOIST']) ||
      (equipment.hasFlag('F_CASE') && equipment.techBase !== 'Clan')
    )
      must(location === stowage, `Requires the ${stowage.toLowerCase()}.`);
    if (
      (equipment instanceof WeaponEquipment && !any(equipment, ['F_C3M', 'F_C3MBS', 'F_TAG'])) ||
      any(equipment, [
        'F_ARTEMIS',
        'F_ARTEMIS_V',
        'F_ARTEMIS_PROTO',
        'F_APOLLO',
        'F_PPC_CAPACITOR',
        'F_RISC_LASER_PULSE_MODULE',
      ])
    )
      must(!['Wings', 'Fuselage', 'Body'].includes(location), 'Requires a location with a firing arc.');
    if (equipment instanceof WeaponEquipment && equipment.ammoType === 'GAUSS_HEAVY')
      must(['Nose', 'Aft'].includes(location), 'Heavy Gauss rifles require the nose or aft.');
  }
  if (entity instanceof MekEntity) {
    const needed = equipment instanceof ArmorEquipment || equipment instanceof StructureEquipment
      ? constructionMaterialSlotCount(entity, equipment) : getNumCriticalSlots(entity, equipment, ignoreMount?.size ?? 1);
    const distribution = requiredMekDistribution(entity, equipment);
    if (distribution)
      must(distribution.has(location), 'This distributed system requires one of its prescribed locations.');
    if (equipment.hasFlag('F_MOBILE_HPG'))
      must(['CT', 'LT', 'RT'].includes(location), 'Ground mobile HPGs require torso locations.');
    if (checkCapacity && needed !== undefined)
      must(
        availableMekPlacements(entity, equipment, location, ignoreMount).length >= needed,
        `Requires ${needed} critical slots in contiguous blocks in this location${equipment.canSplit() ? ' or two adjacent non-leg locations' : equipment.isSpreadable ? ' or other eligible locations' : ''}.`,
      );
  }
  return issues;
}

function freeMekSlots(entity: MekEntity, location: string, ignore?: EntityMountedEquipment, candidate?: Equipment): number[] {
  const grid =
    entity.criticalSlotGrid().get(location as Parameters<ReturnType<typeof entity.criticalSlotGrid>['get']>[0]) ?? [];
  return grid
    .slice(0, constructionSlotCapacity(entity, location) ?? 0)
    .flatMap((slot, index) =>
      slot.type === 'empty' ||
      (candidate && entity.omni() && ['LA', 'RA'].includes(location) && constructionOmniWeaponRemovesArmActuators(candidate)
        && slot.type === 'system' && (slot.systemType === 'Lower Arm Actuator' || slot.systemType === 'Hand Actuator')) ||
      (slot.type === 'equipment' && slot.mounts.some((mount) => mount.mountId === ignore?.mountId))
        ? [index]
        : [],
    );
}

/** Default installation context for placement checks and palette statistics; does not install the equipment. */
export function constructionEquipmentCandidate(entity: BaseEntity, equipment: Equipment, location: string): EntityMountedEquipment {
  return new EntityMountedEquipment(
    {
      mountId: 'construction-candidate',
      equipmentId: equipment.id,
      equipment,
      allocation: { kind: 'location', location },
      rearMounted: false,
      turretMounted: false,
      omniPodMounted: entity.omni() && !equipment.omniFixedOnly,
      armored: false,
    },
    entity,
  );
}

export function allocationPlacements(
  entity: BaseEntity,
  equipment: Equipment,
  location: string,
  _slotIndex?: number,
  ignore?: EntityMountedEquipment,
): readonly MountPlacement[] | undefined {
  if (!(entity instanceof MekEntity)) return undefined;
  const needed = equipment instanceof ArmorEquipment || equipment instanceof StructureEquipment
    ? constructionMaterialSlotCount(entity, equipment) : getNumCriticalSlots(entity, equipment, ignore?.size ?? 1);
  if (needed === undefined) throw new Error('Set this equipment size before allocating variable critical slots.');
  const distribution = requiredMekDistribution(entity, equipment);
  if (distribution) {
    if (!distribution.has(location)) throw new Error('Choose a prescribed location for this distributed system.');
    const placements: MountPlacement[] = [];
    for (const [requiredLocation, count] of distribution) {
      const slots = freeMekSlots(entity, requiredLocation, ignore);
      if (slots.length < count)
        throw new Error(`This system requires ${count} free critical slots in ${requiredLocation}.`);
      placements.push(...slots.slice(0, count).map((index) => ({ location: requiredLocation, slotIndex: index })));
    }
    return placements;
  }
  const placements = availableMekPlacements(entity, equipment, location, ignore);
  if (placements.length < needed) throw new Error('Not enough free critical slots.');
  return placements.slice(0, needed);
}

/** Add a component, leaving it unallocated when no location is supplied. */
export function installConstructionEquipment(
  entity: BaseEntity,
  equipment: Equipment,
  location?: string,
  slotIndex?: number,
): EntityMountedEquipment {
  const issues = location === undefined
    ? constructionEquipmentEligibilityIssues(entity, equipment)
    : equipmentPlacementIssues(entity, equipment, location);
  if (issues.length) throw new Error(issues.join(' '));
  let allocation: EntityMountedEquipment['allocation'] = { kind: 'unallocated' };
  if (location !== undefined) {
    const placements = allocationPlacements(entity, equipment, location, slotIndex);
    const primary =
      placements?.reduce((current, placement) => getMekSplitPrimaryLocation(current, placement.location), location) ??
      location;
    removeConstructionOmniArmActuators(entity, equipment, placements?.map(placement => placement.location) ?? [primary]);
    allocation = { kind: 'location', location: primary, placements };
  }
  return entity.addEquipment({
    equipmentId: equipment.id,
    equipment,
    allocation,
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: entity.omni() && !equipment.omniFixedOnly,
    armored: false,
    ...(entity instanceof BattleArmorEntity ? { baMountLocation: 'Body' as const } : {}),
    ...(equipment instanceof AmmoEquipment && constructionSupportsAmmoQuantity(entity)
      ? { shotsCount: equipment.shots }
      : {}),
  });
}

/** CASE needs at most one critical slot. Reclaim it from a movable spread system when the location is full. */
export function planConstructionCaseInstallation(
  entity: MekEntity,
  equipment: Equipment,
  location: string,
  previous?: EntityMountedEquipment,
): readonly { mount: EntityMountedEquipment; placements: readonly MountPlacement[] }[] | null {
  if (!isMekLocation(location) || constructionEquipmentEligibilityIssues(entity, equipment, previous).length
    || equipmentLocationIssues(entity, equipment, location, previous, false).length) return null;
  const needed = getNumCriticalSlots(entity, equipment);
  if (needed === undefined) return null;
  if (freeMekSlots(entity, location, previous).length >= needed) return [];
  if (needed !== 1) return null;

  const slots = entity.criticalSlotGrid().get(location) ?? [];
  for (const [slotIndex, slot] of slots.slice(0, constructionSlotCapacity(entity, location) ?? 0).entries()) {
    if (slot.type !== 'equipment' || slot.mounts.length !== 1) continue;
    const mount = slot.mounts[0];
    const allocation = constructionSpreadAllocation(entity, mount);
    if (!allocation || allocation.prescribed) continue;
    const destination = allocation.locations.find(target => target.id !== location
      && target.free > 0 && target.count < target.limit);
    if (!destination) continue;
    return [{ mount, placements: constructionSpreadMovePlacements(entity, mount, location, destination.id, 1, slotIndex) }];
  }
  return null;
}

function removeConstructionOmniArmActuators(entity: BaseEntity, equipment: Equipment, locations: readonly string[]): void {
  if (!(entity instanceof MekWithArmsEntity) || !entity.omni() || !constructionOmniWeaponRemovesArmActuators(equipment)) return;
  for (const [location, side] of [['LA', 'left'], ['RA', 'right']] as const) if (locations.includes(location)) {
    entity.hasHandActuator.update(current => ({ ...current, [side]: false }));
    entity.hasLowerArmActuator.update(current => ({ ...current, [side]: false }));
  }
}

/** Resolve the same legal donor for both the myomer selector and its installation. */
export function constructionMyomerEquipment(entity: MekEntity, type: string): Equipment | undefined {
  const flags: Record<string, EquipmentFlag> = {
    'Triple Strength': 'F_TSM',
    'Industrial Triple Strength': 'F_INDUSTRIAL_TSM',
    'Super-Cooled': 'F_SCM',
  };
  const flag = flags[type];
  return flag
    ? Object.values(entity.getEquipmentRegistry().equipment).find(
        (candidate) =>
          candidate instanceof MiscEquipment &&
          candidate.hasFlag(flag) &&
          !candidate.hasFlag('F_PROTOTYPE') &&
          constructionEquipmentEligibilityIssues(entity, candidate).length === 0,
      )
    : undefined;
}

/** The MTF myomer header accompanies the mounted system that supplies its actual rules and slots. */
export function setConstructionMyomer(entity: MekEntity, type: string): void {
  const equipment = constructionMyomerEquipment(entity, type);
  if (type !== 'Standard' && !equipment)
    throw new Error('This myomer system is unavailable in the equipment catalog for the selected technology.');
  const previous = entity.equipment();
  entity.setEquipment(previous.filter((mount) => !mount.equipment?.hasAnyFlag(['F_TSM', 'F_INDUSTRIAL_TSM', 'F_SCM'])));
  try {
    if (equipment) {
      const placements = allocationPlacements(entity, equipment, 'RT');
      entity.addEquipment({
        equipmentId: equipment.id,
        equipment,
        allocation: { kind: 'location', location: 'RT', placements },
        rearMounted: false,
        turretMounted: false,
        omniPodMounted: false,
        armored: false,
      });
    }
    entity.myomerType.set(type);
  } catch (error) {
    entity.setEquipment(previous);
    throw error;
  }
}

export function moveConstructionEquipment(
  entity: BaseEntity,
  mount: EntityMountedEquipment,
  location: string,
  slotIndex?: number,
): EntityMountedEquipment {
  if (!mount.equipment) throw new Error('Resolve this equipment before moving it.');
  const issues = equipmentPlacementIssues(entity, mount.equipment, location, mount);
  if (issues.length) throw new Error(issues.join(' '));
  const placements = allocationPlacements(entity, mount.equipment, location, slotIndex, mount);
  const primary =
    placements?.reduce((current, placement) => getMekSplitPrimaryLocation(current, placement.location), location) ??
    location;
  removeConstructionOmniArmActuators(entity, mount.equipment, placements?.map(placement => placement.location) ?? [primary]);
  const moved = entity.moveEquipment(mount, primary, placements);
  if (entity instanceof StaticEmplacementEntity) {
    const design = entity.equipmentDesign().get(mount.mountId);
    const position = parseBuildingLocation(primary), previous = parseBuildingLocation(mount.location);
    if (design?.positions.length && position && previous) entity.equipmentDesign.update(values => new Map(values).set(mount.mountId,
      { ...design, positions: [...design.positions.filter(item => buildingHexKey(item.hex) !== buildingHexKey(previous.hex)
        && buildingHexKey(item.hex) !== buildingHexKey(position.hex)), position] }));
  }
  if (entity instanceof MekEntity) {
    for (const source of new Set(mount.placements?.map((p) => p.location))) entity.arrangeEquipment(source);
  }
  return entity.equipment().find((item) => item.mountId === moved.mountId)!;
}

export function removeConstructionEquipment(entity: BaseEntity, mount: EntityMountedEquipment): void {
  if (isRequiredConstructionEquipment(entity, mount)) {
    throw new Error('This component is required by the chassis configuration. Uninstall it or change the chassis material.');
  }
  entity.removeEquipment(mount);
  if (entity instanceof StaticEmplacementEntity) entity.equipmentDesign.update(values => {
    const next = new Map(values); next.delete(mount.mountId); return next;
  });
  if (entity instanceof MekEntity)
    for (const location of new Set(mount.placements?.map((p) => p.location))) entity.arrangeEquipment(location);
}

/** Keep the component and its options while releasing all of its occupied slots. */
export function uninstallConstructionEquipment(entity: BaseEntity, mount: EntityMountedEquipment): EntityMountedEquipment {
  if (mount.allocation.kind === 'engine') throw new Error('Integral equipment is configured with the engine.');
  const unallocated = mount.clone({ allocation: { kind: 'unallocated' } });
  entity.updateEquipment(mounts => mounts.map(item => item.mountId === mount.mountId ? unallocated : item));
  if (entity instanceof MekEntity) {
    for (const location of new Set(mount.placements?.map(placement => placement.location))) entity.arrangeEquipment(location);
  }
  return unallocated;
}

/** TM pp. 47, 53, 55: Endo-Steel, TSM and armor may use separated slots; Stealth has prescribed shares.
 * A spread system has one identity; only its assigned critical slots are durable. */
export function constructionSpreadAllocation(entity: BaseEntity, mount: EntityMountedEquipment) {
  const equipment = mount.equipment;
  if (!(entity instanceof MekEntity) || !equipment?.isSpreadable) return null;
  const total = equipment instanceof ArmorEquipment || equipment instanceof StructureEquipment
    ? constructionMaterialSlotCount(entity, equipment) : getNumCriticalSlots(entity, equipment, mount.size ?? 1);
  if (!total) return null;
  const allocated = mount.placements?.length ?? 0;
  const remaining = Math.max(0, total - allocated);
  const distribution = requiredMekDistribution(entity, equipment);
  const locations = entity.locationOrder.map(id => {
    const count = mount.placements?.filter(placement => placement.location === id).length ?? 0;
    const allowed = equipmentLocationIssues(entity, equipment, id, mount, false).length === 0;
    const required = distribution?.get(id) ?? null;
    const limit = allowed ? required ?? total : 0;
    const free = freeMekSlots(entity, id).length;
    return { id, label: entity instanceof StaticEmplacementEntity ? entity.displayLocation(id) : getMekLocationLabel(id) ?? id, count, free, required, limit,
      maximum: Math.max(count, Math.min(limit, count + free, count + remaining)) };
  });
  return { total, allocated, remaining, prescribed: distribution !== null, locations };
}

/** Plan a visible block transfer, or place as many of the remaining slots as fit in one location. */
export function constructionSpreadMovePlacements(entity: MekEntity, mount: EntityMountedEquipment,
  source: string | undefined, destination: string | undefined, slotCount?: number, sourceSlotIndex?: number): readonly MountPlacement[] {
  const allocation = constructionSpreadAllocation(entity, mount);
  if (!allocation) throw new Error('This component does not have spreadable critical slots.');
  const current = mount.placements ?? [];
  if (source && source === destination) return current;
  const block = source ? current.filter(placement => placement.location === source
    && (sourceSlotIndex === undefined || placement.slotIndex >= sourceSlotIndex
      && placement.slotIndex < sourceSlotIndex + (slotCount ?? allocation.total))).slice(0, slotCount) : [];
  if (source && !block.length) throw new Error('This critical-slot block is no longer installed.');
  const rest = current.filter(placement => !block.includes(placement));
  if (!destination) return rest;
  const target = allocation.locations.find(location => location.id === destination);
  if (!target?.limit) throw new Error('This system cannot allocate critical slots in that location.');
  const capacity = Math.min(target.free, target.limit - target.count);
  const count = source ? block.length : Math.min(allocation.remaining, capacity);
  if (count <= 0 || count > capacity) throw new Error(`${target.label} can accept ${Math.max(0, capacity)} more critical slots.`);
  return [...rest, ...freeMekSlots(entity, destination).slice(0, count).map(slotIndex => ({ location: destination, slotIndex }))];
}

/** Preserve all manual assignments when filling the remainder. */
export function constructionSpreadAutoPlacements(entity: MekEntity, mount: EntityMountedEquipment): readonly MountPlacement[] {
  const allocation = constructionSpreadAllocation(entity, mount);
  if (!allocation) throw new Error('This component does not have spreadable critical slots.');
  const placements = [...mount.placements ?? []];
  let remaining = allocation.remaining;
  for (const location of allocation.locations) {
    const count = Math.max(0, Math.min(remaining, location.free, location.limit - location.count));
    placements.push(...freeMekSlots(entity, location.id).slice(0, count).map(slotIndex => ({ location: location.id, slotIndex })));
    remaining -= count;
  }
  if (remaining) throw new Error(`${remaining} critical slots still need room in eligible locations.`);
  return placements;
}

export function setConstructionSpreadSlots(entity: MekEntity, mount: EntityMountedEquipment, location: string, count: number, slotIndex?: number): EntityMountedEquipment {
  const allocation = constructionSpreadAllocation(entity, mount);
  const target = allocation?.locations.find(item => item.id === location);
  if (!target || !Number.isInteger(count) || count < 0 || count > target.maximum) {
    throw new Error('Choose a whole number of slots within the available capacity.');
  }
  const current = mount.placements ?? [];
  let kept = 0;
  const placements = current.filter(placement => placement.location !== location || ++kept <= count);
  if (count > target.count) {
    const free = freeMekSlots(entity, location);
    if (slotIndex !== undefined && free.includes(slotIndex)) free.unshift(...free.splice(free.indexOf(slotIndex), 1));
    placements.push(...free.slice(0, count - target.count).map(slotIndex => ({ location, slotIndex })));
  }
  return applyConstructionSpreadPlacements(entity, mount, placements);
}

export function applyConstructionSpreadPlacements(entity: MekEntity, mount: EntityMountedEquipment, placements: readonly MountPlacement[]): EntityMountedEquipment {
  if (!placements.length) return uninstallConstructionEquipment(entity, mount);
  const primary = placements.some(placement => placement.location === mount.location) ? mount.location : placements[0].location;
  entity.moveEquipment(mount, primary, placements);
  for (const location of new Set(mount.placements?.map(placement => placement.location))) {
    // Keep unaffected locations exactly as authored.
    const before = mount.placements!.filter(placement => placement.location === location);
    if (before.some(placement => !placements.includes(placement))) entity.arrangeEquipment(location);
  }
  return entity.equipment().find(item => item.mountId === mount.mountId)!;
}

/** Move one section of a split weapon, joining it with an existing section at the destination. */
export function constructionBlockMovePlacements(
  entity: MekEntity,
  mount: EntityMountedEquipment,
  source: string,
  destination: string,
): readonly MountPlacement[] {
  const eq = mount.equipment;
  if (!eq?.canSplit() || eq.isSpreadable || !mount.placements?.some((p) => p.location === source))
    throw new Error('This split weapon block is no longer installed.');
  const issues = equipmentPlacementIssues(entity, eq, destination, mount);
  if (issues.length) throw new Error(issues.join(' '));
  const rest = mount.placements.filter((p) => p.location !== source && p.location !== destination);
  const occupied = [...new Set([...rest.map((p) => p.location), destination])];
  if (
    !eq.isSpreadable &&
    occupied.length > 1 &&
    (!eq.canSplit() ||
      occupied.length > 2 ||
      occupied.some((location) => entity.locationIsLeg(location)) ||
      !areMekSplitLocationsAdjacent(occupied[0], occupied[1]))
  ) {
    throw new Error('A split weapon needs two adjacent non-leg locations.');
  }
  const count = mount.placements.length - rest.length;
  const slots = firstCriticalSlots(freeMekSlots(entity, destination, mount, eq), count, eq.isSpreadable);
  if (slots.length !== count)
    throw new Error(`${destination} needs ${count} contiguous free critical slots to accept this block.`);
  return [...rest, ...slots.map((slotIndex) => ({ location: destination, slotIndex }))];
}

export function moveConstructionEquipmentBlock(
  entity: MekEntity,
  mount: EntityMountedEquipment,
  source: string,
  destination: string,
): EntityMountedEquipment {
  const placements = constructionBlockMovePlacements(entity, mount, source, destination);
  const primary = placements.reduce((location, p) => getMekSplitPrimaryLocation(location, p.location), destination);
  if (mount.equipment) removeConstructionOmniArmActuators(entity, mount.equipment, placements.map(placement => placement.location));
  const moved = entity.moveEquipment(mount, primary, placements);
  entity.arrangeEquipment(source);
  return entity.equipment().find((item) => item.mountId === moved.mountId)!;
}

export function reorderConstructionEquipment(
  entity: BaseEntity,
  location: string,
  mountId: string,
  beforeMountId?: string,
): void {
  const local = getConstructionLocations(entity).find((item) => item.id === location)?.slots ?? [];
  const order: string[] = [...new Set(local.flatMap((slot) => (slot.mount ? [slot.mount.mountId] : [])))];
  if (!order.includes(mountId) || mountId === beforeMountId) return;
  order.splice(order.indexOf(mountId), 1);
  const index = beforeMountId ? order.indexOf(beforeMountId) : order.length;
  order.splice(index < 0 ? order.length : index, 0, mountId);
  if (entity instanceof MekEntity) entity.arrangeEquipment(location, order);
  else {
    const mounts = [...entity.equipment()];
    const localMounts = order.map((id) => mounts.find((mount) => mount.mountId === id)!);
    let index = 0;
    entity.setEquipment(mounts.map((mount) => (order.includes(mount.mountId) ? localMounts[index++] : mount)));
  }
}

/** Preview an incoming block with the same packing used after install, transfer, or reorder. */
export function planConstructionEquipmentInsertion(
  entity: MekEntity,
  equipment: Equipment,
  location: string,
  placements: readonly MountPlacement[],
  mount?: EntityMountedEquipment,
  beforeMountId?: string,
) {
  const incoming = (mount ?? constructionEquipmentCandidate(entity, equipment, location)).clone({
    allocation: { kind: 'location', location, placements },
  });
  const mounts = [...entity.equipment().filter((item) => item.mountId !== incoming.mountId), incoming];
  const local = getConstructionLocations(entity).find((item) => item.id === location)?.slots ?? [];
  const order: string[] = [...new Set(local.flatMap((slot) => (slot.mount ? [slot.mount.mountId] : [])))];
  if (beforeMountId !== incoming.mountId) {
    const previous = order.indexOf(incoming.mountId);
    if (previous >= 0) order.splice(previous, 1);
    const index = beforeMountId ? order.indexOf(beforeMountId) : order.length;
    order.splice(index < 0 ? order.length : index, 0, incoming.mountId);
  }
  return { mountId: incoming.mountId, arrangement: entity.planEquipmentOrder(location, order, mounts) };
}

/** Explicit split editing never falls back to a third location or a fragmented block. */
export function splitConstructionEquipment(
  entity: BaseEntity,
  mount: EntityMountedEquipment,
  location: string,
  count: number,
  secondLocation: string,
): EntityMountedEquipment {
  const eq = mount.equipment;
  if (!(entity instanceof MekEntity) || !eq?.canSplit() || eq.isSpreadable)
    throw new Error('This equipment does not support a two-location split.');
  const needed = getNumCriticalSlots(entity, eq, mount.size ?? 1)!;
  if (!Number.isInteger(count) || count < 1 || count >= needed)
    throw new Error(`Assign between 1 and ${needed - 1} slots to the first location.`);
  if (
    !areMekSplitLocationsAdjacent(location, secondLocation) ||
    entity.locationIsLeg(location) ||
    entity.locationIsLeg(secondLocation)
  )
    throw new Error('Choose two adjacent non-leg locations.');
  for (const target of [location, secondLocation]) {
    const issues = equipmentPlacementIssues(entity, eq, target, mount);
    if (issues.length) throw new Error(issues.join(' '));
  }
  const placements = [
    [location, count],
    [secondLocation, needed - count],
  ] as const;
  const chosen = placements.flatMap(([target, slots]) => {
    const free = firstCriticalSlots(freeMekSlots(entity, target, mount), slots);
    if (free.length !== slots) throw new Error(`${target} needs ${slots} contiguous free critical slots.`);
    return free.map((slotIndex) => ({ location: target, slotIndex }));
  });
  const moved = entity.moveEquipment(mount, getMekSplitPrimaryLocation(location, secondLocation), chosen);
  for (const source of new Set(mount.placements?.map((p) => p.location))) entity.arrangeEquipment(source);
  return entity.equipment().find((item) => item.mountId === moved.mountId)!;
}

/** Resize atomically: allocation failures leave the existing mount unchanged. */
export function resizeConstructionEquipment(
  entity: BaseEntity,
  mount: EntityMountedEquipment,
  size: number,
): EntityMountedEquipment {
  if (!Number.isFinite(size) || size <= 0) throw new Error('Equipment size must be a positive number.');
  if (!mount.equipment) throw new Error('Resolve the equipment before changing its size.');
  const candidate = mount.clone({ size });
  const placements =
    mount.allocation.kind === 'location'
      ? allocationPlacements(entity, mount.equipment, mount.location, undefined, candidate)
      : undefined;
  const primary =
    placements?.reduce(
      (current, placement) => getMekSplitPrimaryLocation(current, placement.location),
      mount.location,
    ) ?? mount.location;
  const resized = candidate.clone({
    allocation:
      mount.allocation.kind === 'location' ? { kind: 'location', location: primary, placements } : mount.allocation,
  });
  entity.updateEquipment((current) => current.map((item) => (item.mountId === mount.mountId ? resized : item)));
  return resized;
}

export function validateConstruction(entity: BaseEntity): EntityValidationResult {
  const messages: EntityValidationMessage[] = [...entity.validationResult().messages].filter(
    (message) =>
      !(entity instanceof BattleArmorEntity && message.code === 'ARMOR_EXCEEDS_MAX' && message.location === 'Squad') &&
      !(entity.entityType === 'SpaceStation' && message.code === 'AERO_NO_THRUST'),
  );
  messages.push(...constructionFamilyMessages(entity));
  messages.push(
    ...constructionSupportVesselMessages(entity),
    ...constructionInfantryBaMessages(entity),
    ...constructionAdvancedMekMessages(entity),
    ...constructionComponentArmorMessages(entity),
    ...constructionEquipmentMessages(entity),
    ...constructionEquipmentConflictMessages(entity),
    ...constructionProtoMekMessages(entity),
  );
  messages.push(...constructionTechnologyMessages(entity));
  messages.push(...constructionQuirkMessages(entity));
  const add = (
    category: EntityValidationMessage['category'],
    code: string,
    message: string,
    location?: string,
    severity: EntityValidationMessage['severity'] = 'error',
    mountId?: string,
  ) => messages.push({ category, code, message, location, severity, ...(mountId ? { mountId } : {}) });
  if (!entity.chassis().trim()) add('general', 'CHASSIS_REQUIRED', 'Enter a chassis name.');
  if (entity.omni() && !constructionOmniApplies(entity)) add('structure', 'OMNI_CHASSIS', 'This chassis cannot use Omni technology.');
  if (entity.originalBuildYear() > entity.year())
    add('tech', 'OEM_YEAR_AFTER_INTRODUCTION', 'OEM year must be earlier than the introduction year.');
  const mass = getConstructionMass(entity);
  if (mass === null || !Number.isFinite(mass))
    add(
      'weight',
      'MASS_UNRESOLVED',
      'Construction mass could not be calculated. Check unresolved or variable-size equipment.',
    );
  else if (mass !== null && !(entity instanceof InfantryEntity) && mass > getConstructionMassCapacity(entity) + 0.00001)
    add(
      'weight',
      'OVERWEIGHT',
      `Installed mass ${mass.toFixed(3)} t exceeds ${getConstructionMassCapacity(entity)} t.`,
    );
  if (entity instanceof MekEntity && (entity.tonnage() < 10 || entity.tonnage() > 200 || entity.tonnage() % 5 !== 0))
    add('weight', 'MEK_CHASSIS_WEIGHT', 'Mek chassis weight must be 10–200 tons in 5-ton increments.');
  const totalArmor = entity.totalArmorPoints();
  if (totalArmor > entity.maximumArmorPoints())
    add('armor', 'ARMOR_TOTAL_EXCEEDED', `Total armor ${totalArmor} exceeds ${entity.maximumArmorPoints()} points.`);
  for (const [location, armor] of entity.armorValues()) {
    if (![armor.front, armor.rear].every((value) => Number.isInteger(value) && value >= 0))
      add('armor', 'INVALID_ARMOR_VALUE', 'Armor must be non-negative whole points.', location);
  }
  const materials = [
    ...new Map(
      [
        ...[...entity.armorByLocation().values()].map((material) => material.armor),
        ...[...entity.structureByLocation().values()].map((material) => material.structure),
      ].map((material) => [material.id, material]),
    ).values(),
  ];
  for (const material of materials) {
    if (entity.isSupportVehicle() && material instanceof ArmorEquipment) {
      const ratings = new Set(
        [...entity.armorByLocation().values()]
          .filter((mounted) => mounted.armor.id === material.id)
          .map(
            (mounted) => mounted.techRating ?? (['A', 'B', 'C', 'D', 'E', 'F'] as const)[entity.structuralTechRating()],
          ),
      );
      for (const rating of ratings) messages.push(...constructionMaterialMessages(entity, material, rating));
    } else messages.push(...constructionMaterialMessages(entity, material));
    if (entity instanceof MekEntity) {
      const required = constructionMaterialSlotCount(entity, material);
      const allocated = entity
        .equipment()
        .filter((mount) => (mount.equipment?.id ?? mount.equipmentId) === material.id)
        .reduce((sum, mount) => sum + (mount.placements?.length ?? 0), 0);
      if (allocated !== required)
        add(
          'crit',
          'MATERIAL_CRITICALS',
          `${material.name} requires ${required} reserved critical slots; ${allocated} are assigned.`,
        );
    }
  }
  for (const mount of entity.equipment()) {
    const eq = mount.equipment;
    if (!eq) continue;
    if (mount.allocation.kind === 'unallocated') {
      add('crit', 'UNALLOCATED_EQUIPMENT', `${eq.name} has not been assigned a location.`, undefined, 'error', mount.mountId);
      continue;
    }
    // Materials have already been checked above; their critical-slot mounts are the same technology.
    if (eq.type !== 'armor' && eq.type !== 'structure') {
      if (mount.allocation.kind !== 'engine') {
        for (const issue of [
          ...constructionEquipmentPlatformIssues(entity, eq),
          ...equipmentLocationIssues(entity, eq, mount.location, mount),
        ])
          add('equipment', 'MOUNT_PLACEMENT', `${eq.name}: ${issue}`, mount.location, 'error', mount.mountId);
      }
      if (entity.mountedEquipmentContributesStaticTech(eq)) {
        const technology = constructionTechnologyEligibility(entity, eq.tech);
        if (!technology.techBase)
          add('tech', 'TECH_BASE_MISMATCH', `${eq.name} requires mixed technology.`, mount.location, 'error', mount.mountId);
        if (!technology.available)
          add(
            'tech',
            'TECH_UNAVAILABLE',
            `${eq.name} is unavailable in ${constructionTechnologyYearLabel(entity)}.`,
            mount.location,
            'error', mount.mountId,
          );
        if (!technology.rulesLevel)
          add('tech', 'TECH_LEVEL_EXCEEDED', `${eq.name} exceeds the selected rules level.`, mount.location, 'error', mount.mountId);
      }
    }
    if (entity instanceof MekEntity && mount.allocation.kind === 'location') {
      const required =
        eq.type === 'armor' || eq.type === 'structure' ? undefined : getNumCriticalSlots(entity, eq, mount.size ?? 1);
      if (required !== undefined && (mount.placements?.length ?? 0) !== required)
        add('crit', 'CRIT_ALLOCATION_COUNT', `${eq.name} requires ${required} critical slots.`, mount.location, 'error', mount.mountId);
      for (const placement of mount.placements ?? [])
        if (
          placement.slotIndex < 0 ||
          placement.slotIndex >= (constructionSlotCapacity(entity, placement.location) ?? 0)
        )
          add(
            'crit',
            'CRIT_OUT_OF_BOUNDS',
            `${eq.name} is outside the physical critical-slot grid.`,
            placement.location,
            'error', mount.mountId,
          );
      const occupied = [...new Set(mount.placements?.map((placement) => placement.location) ?? [])];
      if (!eq.isSpreadable)
        for (const location of occupied) {
          const slots = mount
            .placements!.filter((p) => p.location === location)
            .map((p) => p.slotIndex)
            .sort((a, b) => a - b);
          if (slots.some((slot, index) => index > 0 && slot !== slots[index - 1] + 1))
            add('crit', 'CRIT_CONTIGUOUS', `${eq.name} requires one contiguous block in ${location}.`, location, 'error', mount.mountId);
        }
      if (
        occupied.length > 1 &&
        !eq.isSpreadable &&
        (!eq.canSplit() || occupied.length > 2 || !areMekSplitLocationsAdjacent(occupied[0], occupied[1]))
      )
        add('crit', 'CRIT_SPLIT_LOCATION', `${eq.name} has an invalid location split.`, mount.location, 'error', mount.mountId);
      const distribution = requiredMekDistribution(entity, eq);
      if (distribution)
        for (const [location, count] of distribution) {
          if (mount.placements?.filter((placement) => placement.location === location).length !== count)
            add('crit', 'CRIT_DISTRIBUTION', `${eq.name} requires ${count} critical slots in ${location}.`, location, 'error', mount.mountId);
        }
    }
  }
  if (entity instanceof ProtoMekEntity) {
    if (entity.isGlider() && entity.originalWalkMP() < 4)
      add('movement', 'PROTO_GLIDER_SPEED', 'Glider ProtoMeks require at least 4 cruise MP.');
    if (entity.isQuad() && entity.originalWalkMP() < 3)
      add('movement', 'PROTO_QUAD_SPEED', 'Quad ProtoMeks require at least 3 walk MP.');
    if (entity.isQuad() && entity.isGlider())
      add('structure', 'PROTO_CONFIGURATION', 'ProtoMeks cannot be both quad and glider.');
  }
  const unique = [
    ...new Map(
      messages.map((message) => [`${message.code}|${message.location ?? ''}|${message.mountId ?? ''}|${message.message}`, message]),
    ).values(),
  ];
  return { valid: !unique.some((message) => message.severity === 'error'), messages: unique };
}

function availableMekPlacements(
  entity: MekEntity,
  eq: Equipment,
  location: string,
  ignore?: EntityMountedEquipment,
): MountPlacement[] {
  const distribution = requiredMekDistribution(entity, eq);
  if (distribution)
    return [...distribution].flatMap(([requiredLocation, count]) =>
      freeMekSlots(entity, requiredLocation, ignore)
        .slice(0, count)
        .map((slotIndex) => ({ location: requiredLocation, slotIndex })),
    );
  const needed = getNumCriticalSlots(entity, eq, ignore?.size ?? 1) ?? 0;
  const free = freeMekSlots(entity, location, ignore, eq);
  const primary = firstCriticalSlots(free, needed, eq.isSpreadable).map((slotIndex) => ({ location, slotIndex }));
  if (primary.length === needed) return primary;
  const candidates = entity.locationOrder.filter(
    (other) =>
      other !== location &&
      (!eq.hasFlag('F_MOBILE_HPG') || ['CT', 'LT', 'RT'].includes(other)) &&
      (eq.isSpreadable || (eq.canSplit() && areMekSplitLocationsAdjacent(location, other))),
  );
  if (eq.isSpreadable)
    return [
      ...primary,
      ...candidates.flatMap((other) =>
        freeMekSlots(entity, other, ignore).map((slotIndex) => ({ location: other, slotIndex })),
      ),
    ];
  // A splittable weapon has exactly one contiguous block in each of at most two locations.
  for (const other of candidates.filter((other) => !entity.locationIsLeg(location) && !entity.locationIsLeg(other))) {
    const otherFree = freeMekSlots(entity, other, ignore, eq);
    for (let count = Math.min(needed - 1, free.length); count >= 1; count--) {
      const first = firstCriticalSlots(free, count);
      const second = firstCriticalSlots(otherFree, needed - count);
      if (first.length === count && second.length === needed - count)
        return [
          ...first.map((slotIndex) => ({ location, slotIndex })),
          ...second.map((slotIndex) => ({ location: other, slotIndex })),
        ];
    }
  }
  return [];
}

/** TestMek.checkMiscSpreadAllocation prescribes these locations, rather than any free slots. */
function requiredMekDistribution(entity: MekEntity, eq: Equipment): ReadonlyMap<string, number> | null {
  if (eq instanceof ArmorEquipment && entity.hasPatchworkArmor()) {
    return new Map(entity.locationOrder
      .filter(location => entity.armorByLocation().get(location)?.armor.id === eq.id)
      .map(location => [location, Math.ceil(eq.patchworkSlotsMekSV / (entity.isSuperHeavy() ? 2 : 1))]));
  }
  if (eq instanceof StructureEquipment && entity.hasHybridStructure()) {
    return new Map(entity.locationOrder
      .filter(location => entity.structureAt(location).structure.id === eq.id && hybridStructureCriticals(entity, location) > 0)
      .map(location => [location, hybridStructureCriticals(entity, location)]));
  }
  if (eq.hasFlag('F_RAM_PLATE')) return new Map(['CT', 'LT', 'RT'].map((location) => [location, 1]));
  if (eq.hasFlag('F_TRACKS'))
    return new Map(
      entity.locationOrder.filter((location) => entity.locationIsLeg(location)).map((location) => [location, 1]),
    );
  if (eq.hasFlag('F_TALON'))
    return new Map(
      entity.locationOrder
        .filter((location) => entity.locationIsLeg(location))
        .map((location) => [location, entity.isSuperHeavy() ? 1 : 2]),
    );
  if (eq.hasFlag('F_STEALTH') && !entity.hasPatchworkArmor()) {
    const limbs =
      entity.chassisConfig === 'Quad' || entity.chassisConfig === 'QuadVee'
        ? ['FLL', 'FRL', 'RLL', 'RRL']
        : ['LA', 'RA', 'LL', 'RL'];
    return new Map([...limbs, 'LT', 'RT'].map((location) => [location, entity.isSuperHeavy() ? 1 : 2]));
  }
  if (eq.hasFlag('F_ENVIRONMENTAL_SEALING')) return new Map(entity.locationOrder.map((location) => [location, 1]));
  if (eq.hasFlag('F_BLUE_SHIELD'))
    return new Map(entity.locationOrder.filter((location) => location !== 'HD').map((location) => [location, 1]));
  if (eq.hasFlag('F_PARTIAL_WING'))
    return new Map(['LT', 'RT'].map((location) => [location, eq.techBase === 'Clan' ? 3 : 4]));
  if (eq.hasFlag('F_CHAIN_DRAPE')) return new Map(['LT', 'RT'].map((location) => [location, 3]));
  return null;
}

export function constructionMaterialSlotCount(entity: MekEntity, material: Equipment): number {
  if (material instanceof ArmorEquipment && entity.hasPatchworkArmor())
    return entity.locationOrder
      .filter((location) => entity.armorByLocation().get(location)?.armor.id === material.id)
      .reduce((sum) => sum + Math.ceil(material.patchworkSlotsMekSV / (entity.isSuperHeavy() ? 2 : 1)), 0);
  if (material instanceof StructureEquipment && entity.hasHybridStructure())
    return entity.locationOrder
      .filter((location) => entity.structureAt(location).structure.id === material.id)
      .reduce((sum, location) => sum + hybridStructureCriticals(entity, location), 0);
  return getNumCriticalSlots(entity, material) ?? 0;
}

function constructionRequiredMaterials(entity: BaseEntity): readonly Equipment[] {
  if (!(entity instanceof MekEntity)) return [];
  return [...new Map([
    ...[...entity.armorByLocation().values()].map(material => material.armor),
    ...[...entity.structureByLocation().values()].map(material => material.structure),
  ].map(material => [material.id, material])).values()]
    .filter(material => constructionMaterialSlotCount(entity, material) > 0);
}

export function isRequiredConstructionEquipment(entity: BaseEntity, mount: EntityMountedEquipment): boolean {
  return constructionRequiredMaterials(entity).some(material => material.id === (mount.equipment?.id ?? mount.equipmentId));
}

/** Drafts can name a chassis material without supplying any of its critical reservations. */
export function ensureConstructionMaterialEquipment(entity: BaseEntity): void {
  for (const equipment of constructionRequiredMaterials(entity)) {
    if (entity.equipment().some(mount => (mount.equipment?.id ?? mount.equipmentId) === equipment.id)) continue;
    entity.addEquipment({ equipmentId: equipment.id, equipment, allocation: { kind: 'unallocated' },
      rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false });
  }
}

/** MegaMek's CO:p212 fallback allocation for authored FrankenMek donor locations. */
function hybridStructureCriticals(entity: MekEntity, location: string): number {
  const material = entity.structureAt(location);
  const type = material.structure.structureTypeId;
  if (type !== 2 && type !== 6) return 0;
  if (type === 6 || material.techBase === 'Clan') return location === 'HD' ? 0 : 1;
  return location === 'HD' || location === 'CT' || entity.locationIsLeg(location)
    ? 1
    : location === 'LT' || location === 'RT'
      ? 3
      : 2;
}

/** Materials own their critical reservations; changing a material replaces its old allocations. */
function reconcileConstructionMaterialSlots(entity: MekEntity, kind: 'armor' | 'structure'): void {
  for (const mount of entity.equipment()) if (mount.equipment?.type === kind) entity.removeEquipment(mount);
  const materials =
    kind === 'armor'
      ? [
          ...new Map(
            [...entity.armorByLocation().values()].map((material) => [material.armor.id, material.armor]),
          ).values(),
        ]
      : [
          ...new Map(
            [...entity.structureByLocation().values()].map((material) => [material.structure.id, material.structure]),
          ).values(),
        ];
  for (const equipment of materials) {
    let required = constructionMaterialSlotCount(entity, equipment);
    if (required <= 0) continue;
    const matching =
      kind === 'armor' && entity.hasPatchworkArmor()
        ? entity.locationOrder.filter((location) => entity.armorByLocation().get(location)?.armor.id === equipment.id)
        : kind === 'structure' && entity.hasHybridStructure()
          ? entity.locationOrder.filter((location) => entity.structureAt(location).structure.id === equipment.id)
          : entity.locationOrder;
    const placements: MountPlacement[] = [];
    if (kind === 'armor' && entity.hasPatchworkArmor() && equipment instanceof ArmorEquipment) {
      required = 0;
      for (const location of matching) {
        const count = Math.ceil(equipment.patchworkSlotsMekSV / (entity.isSuperHeavy() ? 2 : 1));
        required += count;
        placements.push(
          ...freeMekSlots(entity, location)
            .slice(0, count)
            .map((slotIndex) => ({ location, slotIndex })),
        );
      }
    } else if (kind === 'structure' && entity.hasHybridStructure()) {
      for (const location of matching) {
        placements.push(
          ...freeMekSlots(entity, location)
            .slice(0, hybridStructureCriticals(entity, location))
            .map((slotIndex) => ({ location, slotIndex })),
        );
      }
    } else if (requiredMekDistribution(entity, equipment)) {
      placements.push(...availableMekPlacements(entity, equipment, matching[0]));
    } else {
      for (const location of matching)
        placements.push(...freeMekSlots(entity, location).map((slotIndex) => ({ location, slotIndex })));
    }
    const chosen = placements.slice(0, required);
    entity.addEquipment({
      equipmentId: equipment.id,
      equipment,
      allocation: chosen.length
        ? { kind: 'location', location: chosen[0].location, placements: chosen }
        : { kind: 'unallocated' },
      rearMounted: false,
      turretMounted: false,
      omniPodMounted: false,
      armored: false,
    });
  }
}
