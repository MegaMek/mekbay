// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import { AmmoEquipment, ArmorEquipment, Equipment, MiscEquipment, StructureEquipment, WeaponEquipment, ammoMatchesWeapon } from '../../models/equipment.model';
import type { EquipmentFlag } from '../../models/equipment-flags.type';
import { MountedArmor, MountedStructure } from '../../models/entity/components';
import { AeroEntity, BattleArmorEntity, InfantryEntity, JumpShipEntity, MekEntity, ProtoMekEntity, SmallCraftEntity, StaticEmplacementEntity, VehicleEntity } from '../../models/entity/entities';
import { EntityMountedEquipment, type EntityValidationMessage, type EntityValidationResult, type EntityType, type MountPlacement } from '../../models/entity/types';
import { getNumCriticalSlots } from '../../models/entity/utils/equipment-helpers';
import { getMekLocationLabel } from '../../models/entity/types/mek';
import { getEquipmentTonnage } from '../../models/entity/utils/equipment-tonnage';
import { getConstructionMass, getConstructionMassCapacity } from './construction-factory';
import { constructionFamilyMessages, equipmentFitsVehicleMovement } from './construction-family-rules';
import { weaponBayEquipmentId } from '../../models/entity/utils/implicit-equipment';
import { areMekSplitLocationsAdjacent, getMekSplitPrimaryLocation } from '../../models/entity/types/mek';
import { constructionSupportVesselMessages } from './construction-support-vessel-rules';
import { constructionInfantryBaMessages } from './construction-infantry-ba-rules';
import { constructionAdvancedMekMessages } from './construction-advanced-mek-rules';

const MISC_PLATFORM: Partial<Record<EntityType, EquipmentFlag>> = {
  Mek: 'F_MEK_EQUIPMENT', ProtoMek: 'F_PROTOMEK_EQUIPMENT', BattleArmor: 'F_BA_EQUIPMENT',
  Tank: 'F_TANK_EQUIPMENT', Naval: 'F_TANK_EQUIPMENT', VTOL: 'F_TANK_EQUIPMENT',
  SupportTank: 'F_SUPPORT_TANK_EQUIPMENT', SupportNaval: 'F_SUPPORT_TANK_EQUIPMENT',
  SupportVTOL: 'F_SUPPORT_TANK_EQUIPMENT', LargeSupportTank: 'F_SUPPORT_TANK_EQUIPMENT',
  FixedWingSupport: 'F_SUPPORT_TANK_EQUIPMENT', Aero: 'F_FIGHTER_EQUIPMENT', ConvFighter: 'F_FIGHTER_EQUIPMENT',
  SmallCraft: 'F_SC_EQUIPMENT', DropShip: 'F_DS_EQUIPMENT', JumpShip: 'F_JS_EQUIPMENT',
  WarShip: 'F_WS_EQUIPMENT', SpaceStation: 'F_SS_EQUIPMENT', GunEmplacement: 'F_TANK_EQUIPMENT', BuildingEntity: 'F_TANK_EQUIPMENT',
};
const any = (equipment: Equipment, flags: readonly EquipmentFlag[]) => flags.some(flag => equipment.hasFlag(flag));

/** Families whose native BLK equipment grammar preserves an authored ammunition quantity. */
export function constructionSupportsAmmoQuantity(entity: BaseEntity): boolean {
  return ['BattleArmor', 'ProtoMek', 'HandheldWeapon', 'DropShip', 'JumpShip', 'WarShip', 'SpaceStation'].includes(entity.entityType);
}

/** Platform eligibility is separate from technology and current space availability. */
export function constructionEquipmentApplies(entity: BaseEntity, equipment: Equipment): boolean {
  if (equipment.isInternalRepresentation || equipment.type === 'armor' || equipment.type === 'structure') return false;
  // Heat sinks have only their sink flags in MegaMek's registry; MML handles
  // them through the dedicated heat-sink selector rather than platform flags.
  if (equipment instanceof MiscEquipment && equipment.isHeatSink) return entity instanceof MekEntity;
  if (equipment instanceof AmmoEquipment) {
    if (equipment.capital && !(entity instanceof JumpShipEntity || entity.entityType === 'DropShip')) return false;
    if (equipment.ammoType === 'INFANTRY' && !(entity instanceof InfantryEntity || entity instanceof BattleArmorEntity)) return false;
    if (equipment.category === 'Bomb') return false;
    if (equipment.hasFlag('F_BATTLEARMOR') !== (entity instanceof BattleArmorEntity)) return false;
    if (equipment.hasFlag('F_PROTOMEK') && !(entity instanceof ProtoMekEntity)) return false;
    if (entity instanceof InfantryEntity) return equipment.ammoType === 'INFANTRY' || entity.equipment().some(mount => mount.location === 'Field Guns' && mount.equipment instanceof WeaponEquipment && ammoMatchesWeapon(mount.equipment, equipment));
    if (entity instanceof AeroEntity && !entity.isSupportVehicle()) {
      if (['AC_LBX', 'SBGAUSS'].includes(equipment.ammoType)) return equipment.hasMunitionType('M_CLUSTER');
      if (['ATM', 'IATM'].includes(equipment.ammoType)) return ['M_STANDARD', 'M_HIGH_EXPLOSIVE', 'M_EXTENDED_RANGE'].some(flag => equipment.hasMunitionType(flag as 'M_STANDARD'));
      if (equipment.ammoType !== 'AR10' && !['M_STANDARD', 'M_ARTEMIS_CAPABLE', 'M_ARTEMIS_V_CAPABLE'].some(flag => equipment.hasMunitionType(flag as 'M_STANDARD'))) return false;
    }
    return true;
  }
  if (equipment instanceof WeaponEquipment) {
    if (equipment.hasFlag('F_BOMB_WEAPON') || equipment.id === weaponBayEquipmentId(equipment)) return false;
    if (entity instanceof InfantryEntity) return equipment.isInfantryWeapon() || isConstructionFieldGun(equipment);
    if (entity instanceof BattleArmorEntity) return equipment.hasFlag('F_BA_WEAPON') || equipment.isInfantryWeapon();
    if (entity.isSupportVehicle() && entity.tonnage() < 5) return equipment.isInfantryWeapon() && !equipment.hasFlag('F_INF_ARCHAIC');
    if (equipment.isInfantryWeapon()) return false;
    if (entity instanceof ProtoMekEntity) return equipment.hasFlag('F_PROTO_WEAPON');
    if (entity instanceof MekEntity) {
      return equipment.hasFlag('F_MEK_WEAPON') && !equipment.capital && !equipment.subCapital
        && !(entity.chassisConfig === 'LAM' && ['GAUSS_HEAVY', 'IGAUSS_HEAVY'].includes(equipment.ammoType));
    }
    if (entity instanceof AeroEntity && !entity.isSupportVehicle()) {
      if (equipment.hasFlag('F_BOMB_WEAPON')) return false;
      if (equipment.ammoType === 'C3_REMOTE_SENSOR') return entity.entityType === 'SmallCraft';
      if (equipment.subCapital || (equipment.capital && equipment.hasFlag('F_MISSILE')) || equipment.ammoType === 'SCREEN_LAUNCHER') {
        return entity.entityType === 'DropShip' || entity instanceof JumpShipEntity;
      }
      if (equipment.capital) return entity instanceof JumpShipEntity;
      if (!equipment.hasFlag('F_AERO_WEAPON')) return false;
      if (equipment.hasFlag('F_ARTILLERY')) return entity instanceof SmallCraftEntity ||
        (!(entity instanceof JumpShipEntity) && ['ARROW_IV', 'THUMPER', 'SNIPER'].includes(equipment.ammoType));
      if (equipment.hasFlag('F_LRM') && ![5, 10, 15, 20].includes(equipment.rackSize)) return false;
      if (equipment.hasFlag('F_SRM') && ![2, 4, 6].includes(equipment.rackSize)) return false;
      if (['MRM', 'ROCKET_LAUNCHER'].includes(equipment.ammoType) && equipment.rackSize < 10) return false;
      return true;
    }
    if (entity.entityType === 'HandheldWeapon') return equipment.hasFlag('F_MEK_WEAPON') && !equipment.capital;
    return equipment.hasFlag('F_TANK_WEAPON') && !equipment.capital && !equipment.subCapital;
  }
  if (entity instanceof InfantryEntity) return equipment.hasFlag('F_TOOLS') || equipment.hasFlag('F_ARMOR_KIT');
  if (entity.entityType === 'HandheldWeapon') return equipment.hasFlag('F_MEK_EQUIPMENT');
  const flag = MISC_PLATFORM[entity.entityType];
  return (flag !== undefined && equipment.hasFlag(flag)) ||
    (entity.motiveType() === 'VTOL' && equipment.hasFlag('F_VTOL_EQUIPMENT'));
}

/** MegaMekLab CIFieldGunTableView offers these weapon families as field guns/artillery. */
function isConstructionFieldGun(equipment: WeaponEquipment): boolean {
  if (equipment.capital || equipment.hasFlag('F_BA_WEAPON') || equipment.hasFlag('F_BOMB_WEAPON')) return false;
  if (['AC', 'AC_PRIMITIVE', 'AC_ULTRA', 'AC_ULTRA_THB', 'AC_LBX', 'AC_LBX_THB', 'RIFLE', 'THUMPER_CANNON', 'SNIPER_CANNON', 'LONG_TOM_CANNON'].includes(equipment.ammoType)) return true;
  if (equipment.hasFlag('F_GAUSS')) return !['GAUSS_HEAVY', 'IGAUSS_HEAVY', 'MAGSHOT', 'HAG'].includes(equipment.ammoType);
  return equipment.hasFlag('F_ARTILLERY') && equipment.ammoType !== 'CRUISE_MISSILE';
}

export function getConstructionArmorOptions(entity: BaseEntity): readonly ArmorEquipment[] {
  const flag = MISC_PLATFORM[entity.entityType];
  const existing = [...entity.armorByLocation().values()].map(item => item.armor);
  return [...new Map([...existing, ...Object.values(entity.getEquipmentRegistry().equipment).filter((eq): eq is ArmorEquipment =>
    eq instanceof ArmorEquipment && eq.armorType !== 'PATCHWORK' && flag !== undefined && eq.hasFlag(flag))]
    .map(eq => [eq.id, eq])).values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getConstructionStructureOptions(entity: BaseEntity): readonly StructureEquipment[] {
  if (!(entity instanceof MekEntity)) return [];
  const existing = [...entity.structureByLocation().values()].map(item => item.structure);
  return [...new Map([...existing, ...Object.values(entity.getEquipmentRegistry().equipment)
    .filter((eq): eq is StructureEquipment => eq instanceof StructureEquipment)].map(eq => [eq.id, eq])).values()];
}

export function setConstructionArmorMaterial(entity: BaseEntity, equipment: ArmorEquipment, location?: string): void {
  if (!getConstructionArmorOptions(entity).some(option => option.id === equipment.id)) throw new Error('Armor is not compatible with this unit family.');
  const armor = new MountedArmor({ armor: equipment, techBase: equipment.techBase === 'All' ? entity.techBase() : equipment.techBase });
  if (entity instanceof BattleArmorEntity) entity.setUniformArmor(armor);
  else if (location) entity.setArmorAt(location, armor); else entity.setUniformArmor(armor);
  if (entity.isSupportVehicle() && equipment.bar > 0) entity.barRating.set(equipment.bar);
  if (entity instanceof MekEntity) reconcileConstructionMaterialSlots(entity, 'armor');
}

export function setConstructionStructure(entity: BaseEntity, equipment: StructureEquipment, location?: string, donorTonnage?: number): void {
  if (!(entity instanceof MekEntity)) throw new Error('This unit derives structure from its chassis settings.');
  const structure = new MountedStructure({ structure: equipment, tonnage: donorTonnage ?? entity.tonnage(),
    techBase: equipment.techBase === 'All' ? entity.techBase() : equipment.techBase });
  if (location) entity.setStructureAt(location, structure); else entity.setUniformStructure(structure);
  reconcileConstructionMaterialSlots(entity, 'structure');
}

export interface ConstructionLocation {
  readonly id: string;
  readonly label: string;
  readonly armor: number;
  readonly rearArmor: number;
  readonly maxArmor: number;
  readonly structure: number;
  readonly slots: readonly { index: number; system?: string; mount?: EntityMountedEquipment }[];
  readonly slotCapacity: number | null;
}

export function constructionSlotCapacity(entity: BaseEntity, location: string): number | null {
  if (entity instanceof MekEntity) return location === 'HD' || entity.locationIsLeg(location) ? 6 : 12;
  if (entity instanceof ProtoMekEntity) {
    if (location === 'Torso') return (entity.tonnage() > 9 ? 3 : 2) * (entity.isQuad() ? 2 : 1);
    if (location.endsWith('Arm')) return entity.isQuad() ? 0 : 1;
    if (location === 'Main Gun') return entity.isQuad() && entity.tonnage() > 9 ? 2 : 1;
    return location === 'Body' ? null : 0;
  }
  return null;
}

export function getConstructionLocations(entity: BaseEntity): ConstructionLocation[] {
  const locations = [...new Set([...entity.locationOrder, ...entity.validLocations])];
  if (entity instanceof VehicleEntity || entity instanceof ProtoMekEntity) {
    if (!locations.includes('Body')) locations.push('Body');
  }
  const grid = entity instanceof MekEntity ? entity.criticalSlotGrid() : null;
  return locations.map(id => {
    const armor = entity.armorValues().get(entity instanceof BattleArmorEntity ? 'Squad' : id);
    const capacity = constructionSlotCapacity(entity, id);
    const slots: { index: number; system?: string; mount?: EntityMountedEquipment }[] = [];
    if (entity instanceof MekEntity && grid) {
      const physical = grid.get(id as Parameters<typeof grid.get>[0]);
      for (let index = 0; index < (capacity ?? 0); index++) {
        const slot = physical?.[index];
        slots.push({ index, ...(slot?.type === 'system' ? { system: slot.systemType } : {}),
          ...(slot?.type === 'equipment' ? { mount: slot.mounts[0] } : {}) });
      }
    } else {
      entity.getEquipmentAtLocation(id).forEach((mount, index) => slots.push({ index, mount }));
      if (capacity !== null) while (slots.length < capacity) slots.push({ index: slots.length });
    }
    return { id, label: getMekLocationLabel(id) ?? id, armor: armor?.front ?? 0, rearArmor: armor?.rear ?? 0,
      maxArmor: entity instanceof BattleArmorEntity ? battleArmorMaximumArmor(entity) : entity.maxArmorValues().get(id) ?? 0, structure: entity.structureValues().get(id) ?? 0,
      slots, slotCapacity: capacity };
  });
}

export function setConstructionArmor(entity: BaseEntity, location: string, front: number, rear = 0): void {
  if (!entity.armorLocations.includes(location)) throw new Error('This location has no armor.');
  if (![front, rear].every(value => Number.isInteger(value) && value >= 0)) throw new Error('Armor points must be non-negative whole numbers.');
  if (rear > 0 && !entity.hasRearArmor(location)) throw new Error('This location has no rear armor.');
  if (entity instanceof BattleArmorEntity) entity.armorValues.set(new Map([['Squad', { front, rear: 0 }]]));
  else entity.armorValues.update(values => new Map(values).set(location, { front, rear }));
}

/** Location rules are adapted from TestMek/Tank/ProtoMek/Aero; no weapon hardpoint fiction. */
export function equipmentPlacementIssues(entity: BaseEntity, equipment: Equipment, location: string,
  ignoreMount?: EntityMountedEquipment): string[] {
  const issues: string[] = [];
  const must = (condition: boolean, message: string) => { if (!condition) issues.push(message); };
  must(constructionEquipmentApplies(entity, equipment), `${equipment.name} is not applicable to this unit family.`);
  const base = entity.mixedTech() && equipment.techBase !== 'All' ? equipment.techBase : entity.techBase();
  must(entity.mixedTech() || equipment.techBase === 'All' || equipment.techBase === entity.techBase(), 'Requires mixed technology.');
  must(equipment.isAvailableIn(entity.year(), base), `Not available in ${entity.year()}.`);
  must(['Introductory', 'Standard', 'Advanced', 'Experimental', 'Unofficial'].slice(0, entity.rulesLevel()).includes(equipment.getTechLevel(entity.year(), base)), 'Exceeds the selected rules level.');
  if (entity instanceof VehicleEntity || entity.isSupportVehicle()) must(equipmentFitsVehicleMovement(entity, equipment), 'Incompatible with this movement system.');
  if (equipment instanceof AmmoEquipment) must(entity.equipment().some(mount => mount.equipment instanceof WeaponEquipment && ammoMatchesWeapon(mount.equipment, equipment)), 'No installed weapon uses this ammunition.');
  must(entity.validLocations.has(location) || ((entity instanceof VehicleEntity || entity instanceof ProtoMekEntity) && location === 'Body'), 'Invalid equipment location.');
  if (entity instanceof InfantryEntity) {
    if (equipment instanceof WeaponEquipment) must(location === (equipment.isInfantryWeapon() ? 'Infantry' : 'Field Guns'), equipment.isInfantryWeapon() ? 'Infantry weapons belong with the troopers.' : 'Field guns require the Field Guns location.');
    if (equipment instanceof AmmoEquipment) must(location === (equipment.ammoType === 'INFANTRY' ? 'Infantry' : 'Field Guns'), 'Ammunition must share the infantry weapon location.');
  } else if (entity instanceof MekEntity) {
    const torso = ['CT', 'LT', 'RT'].includes(location);
    const arm = ['LA', 'RA'].includes(location);
    const leg = entity.locationIsLeg(location);
    const quad = ['Quad', 'QuadVee'].includes(entity.chassisConfig);
    const system = (name: string) => entity.criticalSlotGrid().get(location as Parameters<ReturnType<typeof entity.criticalSlotGrid>['get']>[0])?.some(slot => slot.type === 'system' && slot.systemType === name) === true;
    if (any(equipment, ['F_CLUB', 'F_HAND_WEAPON', 'F_SHIELD', 'F_SALVAGE_ARM'])) {
      const industrialTool = any(equipment, ['S_DUAL_SAW', 'S_PILE_DRIVER', 'S_BACKHOE', 'S_MINING_DRILL', 'S_COMBINE', 'S_CHAINSAW', 'S_ROCK_CUTTER', 'S_BUZZSAW', 'S_SPOT_WELDER']);
      must(industrialTool && quad ? ['LT', 'RT'].includes(location) : arm, industrialTool && quad ? 'Requires a side torso.' : 'Requires an arm.');
    }
    if (any(equipment, ['F_AP_POD', 'F_TRACKS', 'F_TALON'])) must(leg, 'Requires a leg.');
    if (equipment.hasFlag('F_JUMP_JET')) must(torso || leg, 'Jump jets require a torso or leg.');
    if (equipment.hasFlag('F_ACTUATOR_ENHANCEMENT_SYSTEM')) must(arm || leg, 'Requires an arm or leg.');
    if (equipment.hasFlag('F_HEAD_TURRET')) must(location === 'CT', 'Head turret mechanism requires the center torso.');
    if (any(equipment, ['F_QUAD_TURRET', 'F_SHOULDER_TURRET'])) must(['LT', 'RT'].includes(location), 'Requires a side torso.');
    if (equipment.hasFlag('F_HARJEL')) must(!system('Cockpit'), 'HarJel cannot share the cockpit location.');
    if (any(equipment, ['F_MASS', 'F_REMOTE_DRONE_COMMAND_CONSOLE'])) must(system('Cockpit'), 'Requires the cockpit location.');
    if ((equipment.hasFlag('F_MASC') && equipment.hasFlag('S_SUPERCHARGER')) || equipment.hasFlag('F_EMERGENCY_COOLANT_SYSTEM')) must(system('Engine'), 'Requires a location containing engine critical slots.');
    const bridge = any(equipment, ['F_LIGHT_BRIDGE_LAYER', 'F_MEDIUM_BRIDGE_LAYER', 'F_HEAVY_BRIDGE_LAYER']);
    if (bridge) must(quad, 'Bridgelayers require a quad Mek.');
    if (bridge || any(equipment, ['F_FUEL', 'F_LADDER', 'F_VGL']) || (equipment.hasFlag('F_CASE') && equipment.techBase !== 'Clan')) must(torso, 'Requires a torso.');
    if (equipment.hasFlag('F_LIFT_HOIST')) must(torso || arm, 'Lift hoists require a torso or arm.');
    if (equipment.hasFlag('F_MODULAR_ARMOR')) must(location !== 'HD', 'Modular armor cannot be mounted in the head.');
    if (equipment.hasFlag('F_EJECTION_SEAT')) must(location === 'HD', 'Ejection seats require the head.');
    if (equipment instanceof WeaponEquipment && ['GAUSS_HEAVY', 'IGAUSS_HEAVY'].includes(equipment.ammoType) && !entity.isSuperHeavy()) must(torso, 'Heavy Gauss rifles require a torso.');
  } else if (entity instanceof VehicleEntity) {
    const bodyOnly = equipment instanceof AmmoEquipment || any(equipment, ['F_CHASSIS_MODIFICATION', 'F_BASIC_FIRE_CONTROL', 'F_ADVANCED_FIRE_CONTROL', 'F_CASE', 'F_CASE_II', 'F_JUMP_JET', 'F_FUEL', 'F_BLUE_SHIELD']);
    if (bodyOnly) must(location === 'Body', 'Requires the vehicle body.');
    if (equipment instanceof WeaponEquipment) {
      if (!any(equipment, ['F_C3M', 'F_C3MBS', 'F_TAG'])) must(location !== 'Body', 'Weapons need a facing or turret.');
      must(location !== 'Rotor', 'Weapons cannot mount in the rotor.');
      if (equipment.ammoType === 'GAUSS_HEAVY') must(['Front', 'Rear'].includes(location), 'Heavy Gauss rifles require the front or rear.');
      if (equipment.ammoType === 'IGAUSS_HEAVY') must(!location.includes('Turret'), 'Improved heavy Gauss rifles cannot mount in a turret.');
    }
    if (any(equipment, ['F_BULLDOZER', 'F_MINESWEEPER', 'S_PILE_DRIVER'])) must(['Front', 'Rear'].includes(location), 'Requires the front or rear.');
    if (equipment.hasFlag('S_WRECKING_BALL')) must(location.includes('Turret'), 'Wrecking balls require a turret.');
    if (equipment.hasFlag('F_MAST_MOUNT')) must(location === 'Rotor', 'Mast mounts require the rotor.');
    if (any(equipment, ['F_MODULAR_ARMOR', 'F_HARJEL', 'F_LIFT_HOIST', 'F_MANIPULATOR', 'F_FLUID_SUCTION_SYSTEM', 'F_LIGHT_FLUID_SUCTION_SYSTEM', 'F_SPRAYER'])) must(location !== 'Rotor', 'This equipment cannot mount in the rotor.');
    if (equipment.hasFlag('F_LADDER')) must(!['Front', 'Rear', 'Rotor'].includes(location), 'Ladders require a side or turret.');
  } else if (entity instanceof ProtoMekEntity) {
    const needsSlot = protoEquipmentRequiresSlot(equipment);
    if (!needsSlot) must(location === 'Body', 'This equipment belongs in the ProtoMek body.');
    else must((constructionSlotCapacity(entity, location) ?? 0) > 0, 'This ProtoMek location cannot mount equipment.');
    if (equipment.hasFlag('S_PROTOMEK_WEAPON')) must(location.endsWith('Arm'), 'ProtoMek melee weapons require an arm.');
    if (any(equipment, ['F_MAGNETIC_CLAMP', 'S_PROTO_QMS'])) must(location === 'Torso', 'Requires the ProtoMek torso.');
    if (equipment.hasFlag('F_MAGNETIC_CLAMP')) must(!entity.isQuad() && !entity.isGlider(), 'Magnetic clamps are unavailable to quad and glider ProtoMeks.');
    if (needsSlot) {
      const occupied = entity.getEquipmentAtLocation(location).filter(mount => mount.mountId !== ignoreMount?.mountId && mount.equipment && protoEquipmentRequiresSlot(mount.equipment));
      must(occupied.length + 1 <= (constructionSlotCapacity(entity, location) ?? 0), 'The ProtoMek location has no equipment slots left.');
      const maximum = location === 'Main Gun' ? Infinity : location === 'Torso' ? (entity.isQuad() ? (entity.tonnage() > 9 ? 8 : 5) : (entity.tonnage() > 9 ? 4 : 2)) : entity.tonnage() > 9 ? 1 : 0.5;
      const candidate = candidateMount(entity, equipment, location);
      const tons = [...occupied, candidate].reduce((sum, mount) => sum + (getEquipmentTonnage(entity, mount) ?? 0), 0);
      must(tons <= maximum, `Equipment exceeds this location's ${maximum} t limit.`);
    }
  } else if (entity instanceof AeroEntity && !(entity instanceof SmallCraftEntity || entity instanceof JumpShipEntity)) {
    const stowage = entity.isSupportVehicle() ? 'Body' : 'Fuselage';
    if (equipment instanceof AmmoEquipment || any(equipment, ['F_BASIC_FIRE_CONTROL', 'F_ADVANCED_FIRE_CONTROL', 'F_BLUE_SHIELD', 'F_LIFT_HOIST']) || (equipment.hasFlag('F_CASE') && equipment.techBase !== 'Clan')) must(location === stowage, `Requires the ${stowage.toLowerCase()}.`);
    if ((equipment instanceof WeaponEquipment && !any(equipment, ['F_C3M', 'F_C3MBS', 'F_TAG'])) || any(equipment, ['F_ARTEMIS', 'F_ARTEMIS_V', 'F_ARTEMIS_PROTO', 'F_APOLLO', 'F_PPC_CAPACITOR', 'F_RISC_LASER_PULSE_MODULE'])) must(!['Wings', 'Fuselage', 'Body'].includes(location), 'Requires a location with a firing arc.');
    if (equipment instanceof WeaponEquipment && equipment.ammoType === 'GAUSS_HEAVY') must(['Nose', 'Aft'].includes(location), 'Heavy Gauss rifles require the nose or aft.');
  }
  if (entity instanceof MekEntity) {
    const needed = getNumCriticalSlots(entity, equipment, ignoreMount?.size ?? 1);
    const distribution = requiredMekDistribution(entity, equipment);
    if (distribution) must(distribution.has(location), 'This distributed system requires one of its prescribed locations.');
    if (equipment.hasFlag('F_MOBILE_HPG')) must(['CT', 'LT', 'RT'].includes(location), 'Ground mobile HPGs require torso locations.');
    if (needed !== undefined) must(availableMekPlacements(entity, equipment, location, ignoreMount).length >= needed, `Requires ${needed} free critical slots in this location or an eligible adjacent location.`);
  }
  return issues;
}

function protoEquipmentRequiresSlot(equipment: Equipment): boolean {
  return !(equipment instanceof AmmoEquipment) && !any(equipment, ['F_MASC', 'F_UMU', 'F_JUMP_JET', 'F_EI_INTERFACE']);
}

function freeMekSlots(entity: MekEntity, location: string, ignore?: EntityMountedEquipment): number[] {
  const grid = entity.criticalSlotGrid().get(location as Parameters<ReturnType<typeof entity.criticalSlotGrid>['get']>[0]) ?? [];
  return grid.slice(0, constructionSlotCapacity(entity, location) ?? 0).flatMap((slot, index) =>
    slot.type === 'empty' || (slot.type === 'equipment' && slot.mounts.every(mount => mount.mountId === ignore?.mountId)) ? [index] : []);
}

function candidateMount(entity: BaseEntity, equipment: Equipment, location: string): EntityMountedEquipment {
  return new EntityMountedEquipment({ mountId: 'construction-candidate', equipmentId: equipment.id, equipment,
    allocation: { kind: 'location', location }, rearMounted: false, turretMounted: false, omniPodMounted: entity.omni(), armored: false }, entity);
}

function allocationPlacements(entity: BaseEntity, equipment: Equipment, location: string, slotIndex?: number,
  ignore?: EntityMountedEquipment): readonly MountPlacement[] | undefined {
  if (!(entity instanceof MekEntity)) return undefined;
  const needed = getNumCriticalSlots(entity, equipment, ignore?.size ?? 1);
  if (needed === undefined) throw new Error('Set this equipment size before allocating variable critical slots.');
  const free = freeMekSlots(entity, location, ignore);
  if (slotIndex !== undefined && !free.includes(slotIndex)) throw new Error('This critical slot is occupied.');
  const distribution = requiredMekDistribution(entity, equipment);
  if (distribution) {
    if (!distribution.has(location)) throw new Error('Choose a prescribed location for this distributed system.');
    const placements: MountPlacement[] = [];
    for (const [requiredLocation, count] of distribution) {
      const slots = freeMekSlots(entity, requiredLocation, ignore);
      if (requiredLocation === location && slotIndex !== undefined) slots.sort((a, b) => (a === slotIndex ? -1 : b === slotIndex ? 1 : a - b));
      if (slots.length < count) throw new Error(`This system requires ${count} free critical slots in ${requiredLocation}.`);
      placements.push(...slots.slice(0, count).map(index => ({ location: requiredLocation, slotIndex: index })));
    }
    return placements;
  }
  const ordered = slotIndex === undefined ? free : [...free.filter(index => index >= slotIndex), ...free.filter(index => index < slotIndex)];
  const placements = ordered.map(index => ({ location, slotIndex: index }));
  if (placements.length < needed) placements.push(...availableMekPlacements(entity, equipment, location, ignore).filter(placement => placement.location !== location));
  if (placements.length < needed) throw new Error('Not enough free critical slots.');
  return placements.slice(0, needed);
}

export function installConstructionEquipment(entity: BaseEntity, equipment: Equipment, location: string, slotIndex?: number): EntityMountedEquipment {
  const issues = equipmentPlacementIssues(entity, equipment, location);
  if (issues.length) throw new Error(issues.join(' '));
  const placements = allocationPlacements(entity, equipment, location, slotIndex);
  const primary = placements?.reduce((current, placement) => getMekSplitPrimaryLocation(current, placement.location), location) ?? location;
  return entity.addEquipment({ equipmentId: equipment.id, equipment, allocation: { kind: 'location', location: primary, placements },
    rearMounted: false, turretMounted: false, omniPodMounted: entity.omni(), armored: false,
    ...(entity instanceof BattleArmorEntity ? { baMountLocation: 'Body' as const } : {}),
    ...(equipment instanceof AmmoEquipment && constructionSupportsAmmoQuantity(entity) ? { shotsCount: equipment.shots } : {}),
  });
}

export function moveConstructionEquipment(entity: BaseEntity, mount: EntityMountedEquipment, location: string, slotIndex?: number): EntityMountedEquipment {
  if (!mount.equipment) throw new Error('Resolve this equipment before moving it.');
  const issues = equipmentPlacementIssues(entity, mount.equipment, location, mount);
  if (issues.length) throw new Error(issues.join(' '));
  const placements = allocationPlacements(entity, mount.equipment, location, slotIndex, mount);
  const primary = placements?.reduce((current, placement) => getMekSplitPrimaryLocation(current, placement.location), location) ?? location;
  return entity.moveEquipment(mount, primary, placements);
}

/** Resize atomically: allocation failures leave the existing mount unchanged. */
export function resizeConstructionEquipment(entity: BaseEntity, mount: EntityMountedEquipment, size: number): EntityMountedEquipment {
  if (!Number.isFinite(size) || size <= 0) throw new Error('Equipment size must be a positive number.');
  if (!mount.equipment) throw new Error('Resolve the equipment before changing its size.');
  const candidate = mount.clone({ size });
  const placements = mount.allocation.kind === 'location'
    ? allocationPlacements(entity, mount.equipment, mount.location, undefined, candidate) : undefined;
  const primary = placements?.reduce((current, placement) => getMekSplitPrimaryLocation(current, placement.location), mount.location) ?? mount.location;
  const resized = candidate.clone({ allocation: mount.allocation.kind === 'location'
    ? { kind: 'location', location: primary, placements } : mount.allocation });
  entity.updateEquipment(current => current.map(item => item.mountId === mount.mountId ? resized : item));
  return resized;
}

export function validateConstruction(entity: BaseEntity): EntityValidationResult {
  const messages: EntityValidationMessage[] = [...entity.validationResult().messages].filter(message =>
    !(entity instanceof BattleArmorEntity && message.category === 'armor') && !(entity.entityType === 'SpaceStation' && message.code === 'AERO_NO_THRUST'));
  messages.push(...constructionFamilyMessages(entity));
  messages.push(...constructionSupportVesselMessages(entity), ...constructionInfantryBaMessages(entity), ...constructionAdvancedMekMessages(entity));
  const add = (category: EntityValidationMessage['category'], code: string, message: string, location?: string,
    severity: EntityValidationMessage['severity'] = 'error') => messages.push({ category, code, message, location, severity });
  if (!entity.chassis().trim()) add('general', 'CHASSIS_REQUIRED', 'Enter a chassis name.');
  const mass = getConstructionMass(entity);
  if ((mass === null && !(entity instanceof StaticEmplacementEntity)) || (mass !== null && !Number.isFinite(mass))) add('weight', 'MASS_UNRESOLVED', 'Construction mass could not be calculated. Check unresolved or variable-size equipment.');
  else if (mass !== null && !(entity instanceof InfantryEntity) && mass > getConstructionMassCapacity(entity) + 0.00001) add('weight', 'OVERWEIGHT', `Installed mass ${mass.toFixed(3)} t exceeds ${getConstructionMassCapacity(entity)} t.`);
  if (entity instanceof MekEntity && (entity.tonnage() < 10 || entity.tonnage() > 200 || entity.tonnage() % 5 !== 0)) add('weight', 'MEK_CHASSIS_WEIGHT', 'Mek chassis weight must be 10–200 tons in 5-ton increments.');
  const totalArmor = [...entity.armorValues().values()].reduce((total, armor) => total + armor.front + armor.rear, 0);
  if (totalArmor > entity.maximumArmorPoints()) add('armor', 'ARMOR_TOTAL_EXCEEDED', `Total armor ${totalArmor} exceeds ${entity.maximumArmorPoints()} points.`);
  for (const [location, armor] of entity.armorValues()) {
    if (![armor.front, armor.rear].every(value => Number.isInteger(value) && value >= 0)) add('armor', 'INVALID_ARMOR_VALUE', 'Armor must be non-negative whole points.', location);
  }
  const materials = [...new Map([
    ...[...entity.armorByLocation().values()].map(material => material.armor),
    ...[...entity.structureByLocation().values()].map(material => material.structure),
  ].map(material => [material.id, material])).values()];
  for (const material of materials) {
    const base = entity.mixedTech() && material.techBase !== 'All' ? material.techBase : entity.techBase();
    if (!entity.mixedTech() && material.techBase !== 'All' && material.techBase !== entity.techBase()) add('tech', 'MATERIAL_TECH_BASE', `${material.name} requires mixed technology.`);
    if (!material.isAvailableIn(entity.year(), base)) add('tech', 'MATERIAL_TECH_UNAVAILABLE', `${material.name} is unavailable in ${entity.year()}.`);
    if (!['Introductory', 'Standard', 'Advanced', 'Experimental', 'Unofficial'].slice(0, entity.rulesLevel()).includes(material.getTechLevel(entity.year(), base))) add('tech', 'MATERIAL_TECH_LEVEL', `${material.name} exceeds the selected rules level.`);
    if (entity instanceof MekEntity) {
      const required = constructionMaterialSlotCount(entity, material);
      const allocated = entity.equipment().filter(mount => mount.equipmentId === material.id).reduce((sum, mount) => sum + (mount.placements?.length ?? 0), 0);
      if (allocated !== required) add('crit', 'MATERIAL_CRITICALS', `${material.name} requires ${required} reserved critical slots; ${allocated} are assigned.`);
    }
  }
  for (const mount of entity.equipment()) {
    const eq = mount.equipment;
    if (!eq) continue;
    if (mount.allocation.kind === 'unallocated') {
      add('crit', 'UNALLOCATED_EQUIPMENT', `${eq.name} has not been assigned a location.`);
      continue;
    }
    if (mount.allocation.kind !== 'engine' && eq.type !== 'armor' && eq.type !== 'structure') {
      for (const issue of equipmentPlacementIssues(entity, eq, mount.location, mount)) add('equipment', 'MOUNT_PLACEMENT', `${eq.name}: ${issue}`, mount.location);
    }
    if (!entity.mixedTech() && eq.techBase !== 'All' && eq.techBase !== entity.techBase()) add('tech', 'TECH_BASE_MISMATCH', `${eq.name} requires mixed technology.`, mount.location);
    const base = entity.mixedTech() && eq.techBase !== 'All' ? eq.techBase : entity.techBase();
    if (!eq.isAvailableIn(entity.year(), base)) add('tech', 'TECH_UNAVAILABLE', `${eq.name} is unavailable in ${entity.year()}.`, mount.location);
    const allowed = ['Introductory', 'Standard', 'Advanced', 'Experimental', 'Unofficial'].slice(0, entity.rulesLevel());
    if (!allowed.includes(eq.getTechLevel(entity.year(), base))) add('tech', 'TECH_LEVEL_EXCEEDED', `${eq.name} exceeds the selected rules level.`, mount.location);
    if (entity instanceof MekEntity && mount.allocation.kind === 'location') {
      const required = eq.type === 'armor' || eq.type === 'structure' ? undefined : getNumCriticalSlots(entity, eq, mount.size ?? 1);
      if (required !== undefined && (mount.placements?.length ?? 0) !== required) add('crit', 'CRIT_ALLOCATION_COUNT', `${eq.name} requires ${required} critical slots.`, mount.location);
      for (const placement of mount.placements ?? []) if (placement.slotIndex < 0 || placement.slotIndex >= (constructionSlotCapacity(entity, placement.location) ?? 0)) add('crit', 'CRIT_OUT_OF_BOUNDS', `${eq.name} is outside the physical critical-slot grid.`, placement.location);
      const occupied = [...new Set(mount.placements?.map(placement => placement.location) ?? [])];
      if (occupied.length > 1 && !eq.isSpreadable && (!eq.canSplit() || occupied.length > 2 || !areMekSplitLocationsAdjacent(occupied[0], occupied[1]))) add('crit', 'CRIT_SPLIT_LOCATION', `${eq.name} has an invalid location split.`, mount.location);
      const distribution = requiredMekDistribution(entity, eq);
      if (distribution) for (const [location, count] of distribution) {
        if (mount.placements?.filter(placement => placement.location === location).length !== count) add('crit', 'CRIT_DISTRIBUTION', `${eq.name} requires ${count} critical slots in ${location}.`, location);
      }
    }
  }
  if (entity instanceof ProtoMekEntity) {
    if (entity.isGlider() && entity.originalWalkMP() < 4) add('movement', 'PROTO_GLIDER_SPEED', 'Glider ProtoMeks require at least 4 cruise MP.');
    if (entity.isQuad() && entity.originalWalkMP() < 3) add('movement', 'PROTO_QUAD_SPEED', 'Quad ProtoMeks require at least 3 walk MP.');
    if (entity.isQuad() && entity.isGlider()) add('structure', 'PROTO_CONFIGURATION', 'ProtoMeks cannot be both quad and glider.');
  }
  // Advanced combinations must not receive a false claim of full verifier parity.
  add('general', 'CONSTRUCTION_RULE_COVERAGE', 'Construction checks cover chassis, armor, mass, technology and equipment placement. Advanced equipment combinations and every optional construction rule are not yet fully verified.', undefined, 'warning');
  const unique = [...new Map(messages.map(message => [`${message.code}|${message.location ?? ''}|${message.message}`, message])).values()];
  return { valid: !unique.some(message => message.severity === 'error'), messages: unique };
}

function battleArmorMaximumArmor(entity: BattleArmorEntity): number {
  return ({ 'Ultra Light': 2, Light: 6, Medium: 10, Heavy: 14, Assault: 18 } as Record<string, number>)[entity.weightClass()] ?? 0;
}

function availableMekPlacements(entity: MekEntity, eq: Equipment, location: string, ignore?: EntityMountedEquipment): MountPlacement[] {
  const distribution = requiredMekDistribution(entity, eq);
  if (distribution) return [...distribution].flatMap(([requiredLocation, count]) => freeMekSlots(entity, requiredLocation, ignore).slice(0, count).map(slotIndex => ({ location: requiredLocation, slotIndex })));
  const primary = freeMekSlots(entity, location, ignore).map(slotIndex => ({ location, slotIndex }));
  const remaining = (getNumCriticalSlots(entity, eq, ignore?.size ?? 1) ?? 0) - primary.length;
  if (remaining <= 0) return primary;
  const candidates = entity.locationOrder.filter(other => other !== location &&
    (!eq.hasFlag('F_MOBILE_HPG') || ['CT', 'LT', 'RT'].includes(other)) &&
    (eq.isSpreadable || eq.canSplit() && areMekSplitLocationsAdjacent(location, other)));
  if (eq.isSpreadable) return [...primary, ...candidates.flatMap(other => freeMekSlots(entity, other, ignore).map(slotIndex => ({ location: other, slotIndex })))];
  const adjacent = candidates.find(other => freeMekSlots(entity, other, ignore).length >= remaining);
  return adjacent ? [...primary, ...freeMekSlots(entity, adjacent, ignore).map(slotIndex => ({ location: adjacent, slotIndex }))] : primary;
}

/** TestMek.checkMiscSpreadAllocation prescribes these locations, rather than any free slots. */
function requiredMekDistribution(entity: MekEntity, eq: Equipment): ReadonlyMap<string, number> | null {
  if (eq.hasFlag('F_TRACKS')) return new Map(entity.locationOrder.filter(location => entity.locationIsLeg(location)).map(location => [location, 1]));
  if (eq.hasFlag('F_STEALTH') && !entity.hasPatchworkArmor()) return new Map(['LA', 'RA', 'LT', 'RT', 'LL', 'RL'].map(location => [location, entity.isSuperHeavy() ? 1 : 2]));
  if (eq.hasFlag('F_ENVIRONMENTAL_SEALING')) return new Map(entity.locationOrder.map(location => [location, 1]));
  if (eq.hasFlag('F_BLUE_SHIELD')) return new Map(entity.locationOrder.filter(location => location !== 'HD').map(location => [location, 1]));
  if (eq.hasFlag('F_PARTIAL_WING')) return new Map(['LT', 'RT'].map(location => [location, eq.techBase === 'Clan' ? 3 : 4]));
  if (eq.hasFlag('F_CHAIN_DRAPE')) return new Map(['LT', 'RT'].map(location => [location, 3]));
  return null;
}

function constructionMaterialSlotCount(entity: MekEntity, material: Equipment): number {
  if (material instanceof ArmorEquipment && entity.hasPatchworkArmor()) return entity.locationOrder
    .filter(location => entity.armorByLocation().get(location)?.armor.id === material.id)
    .reduce(sum => sum + Math.ceil(material.patchworkSlotsMekSV / (entity.isSuperHeavy() ? 2 : 1)), 0);
  return getNumCriticalSlots(entity, material) ?? 0;
}

/** Materials own their critical reservations; changing a material replaces its old allocations. */
function reconcileConstructionMaterialSlots(entity: MekEntity, kind: 'armor' | 'structure'): void {
  for (const mount of entity.equipment()) if (mount.equipment?.type === kind) entity.removeEquipment(mount);
  const materials = kind === 'armor'
    ? [...new Map([...entity.armorByLocation().values()].map(material => [material.armor.id, material.armor])).values()]
    : [...new Map([...entity.structureByLocation().values()].map(material => [material.structure.id, material.structure])).values()];
  for (const equipment of materials) {
    let required = constructionMaterialSlotCount(entity, equipment);
    if (required <= 0) continue;
    const matching = kind === 'armor' && entity.hasPatchworkArmor()
      ? entity.locationOrder.filter(location => entity.armorByLocation().get(location)?.armor.id === equipment.id) : entity.locationOrder;
    const placements: MountPlacement[] = [];
    if (kind === 'armor' && entity.hasPatchworkArmor() && equipment instanceof ArmorEquipment) {
      required = 0;
      for (const location of matching) {
        const count = Math.ceil(equipment.patchworkSlotsMekSV / (entity.isSuperHeavy() ? 2 : 1));
        required += count;
        placements.push(...freeMekSlots(entity, location).slice(0, count).map(slotIndex => ({ location, slotIndex })));
      }
    } else if (requiredMekDistribution(entity, equipment)) {
      placements.push(...availableMekPlacements(entity, equipment, matching[0]));
    } else {
      for (const location of matching) placements.push(...freeMekSlots(entity, location).map(slotIndex => ({ location, slotIndex })));
    }
    const chosen = placements.slice(0, required);
    entity.addEquipment({ equipmentId: equipment.id, equipment,
      allocation: chosen.length ? { kind: 'location', location: chosen[0].location, placements: chosen } : { kind: 'unallocated' },
      rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false });
  }
}
