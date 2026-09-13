// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import { AmmoEquipment, Equipment, MiscEquipment, WeaponEquipment, ammoMatchesWeapon } from '../../models/equipment.model';
import type { EquipmentFlag } from '../../models/equipment-flags.type';
import { AeroEntity, BattleArmorEntity, InfantryEntity, JumpShipEntity, MekEntity, SmallCraftEntity, VehicleEntity } from '../../models/entity/entities';
import { EntityMountedEquipment, type EntityType, type EntityValidationMessage } from '../../models/entity/types';
import { calculateBattleArmorWeightBreakdown } from '../../models/entity/utils/weight/battle-armor-weight';
import { getNumCriticalSlots } from '../../models/entity/utils/equipment-helpers';
import { getEquipmentTonnage } from '../../models/entity/utils/equipment-tonnage';
import { isImprovedJumpJetEquipment } from '../../models/jump-equipment.model';
import { standardWeaponBayDamage, weaponBayDamageLimit, weaponBayGroupingKey } from '../../models/entity/utils/weapon-bay-grouping';
import { constructionBattleArmorChassisApplies, constructionEngineApplies, constructionGyroApplies } from './construction-system-rules';
import { ceilToHalfTon } from '../../models/entity/utils/weight/weight-rounding';

const MISC_PLATFORM: Partial<Record<EntityType, EquipmentFlag>> = {
  Mek: 'F_MEK_EQUIPMENT', ProtoMek: 'F_PROTOMEK_EQUIPMENT', BattleArmor: 'F_BA_EQUIPMENT',
  Tank: 'F_TANK_EQUIPMENT', Naval: 'F_TANK_EQUIPMENT', VTOL: 'F_TANK_EQUIPMENT',
  SupportTank: 'F_SUPPORT_TANK_EQUIPMENT', SupportNaval: 'F_SUPPORT_TANK_EQUIPMENT',
  SupportVTOL: 'F_SUPPORT_TANK_EQUIPMENT', LargeSupportTank: 'F_SUPPORT_TANK_EQUIPMENT',
  FixedWingSupport: 'F_SUPPORT_TANK_EQUIPMENT', Aero: 'F_FIGHTER_EQUIPMENT', ConvFighter: 'F_FIGHTER_EQUIPMENT',
  SmallCraft: 'F_SC_EQUIPMENT', DropShip: 'F_DS_EQUIPMENT', JumpShip: 'F_JS_EQUIPMENT',
  WarShip: 'F_WS_EQUIPMENT', SpaceStation: 'F_SS_EQUIPMENT',
};

export function constructionEquipmentPlatformFlag(entity: BaseEntity): EquipmentFlag | undefined {
  return MISC_PLATFORM[entity.entityType];
}

/** MegaMek TestTank.legalForMotiveType, independent of weapon/misc platform flags. */
export function equipmentFitsVehicleMovement(entity: BaseEntity, eq: Equipment): boolean {
  const mode = entity.motiveType();
  const any = (...flags: EquipmentFlag[]) => flags.some(flag => eq.hasFlag(flag));
  const aero = ['Aerodyne', 'Airship', 'Station Keeping'].includes(mode);
  const marine = ['Naval', 'Hydrofoil', 'Submarine'].includes(mode);
  const ground = ['Tracked', 'Wheeled'].includes(mode);
  if (eq instanceof WeaponEquipment) {
    return !(eq.ammoType === 'BPOD' && marine) && !(eq.ammoType === 'NAIL_RIVET_GUN' && mode === 'VTOL');
  }
  if (any('F_FLOTATION_HULL')) return ['Hover', 'VTOL', 'WiGE'].includes(mode);
  if (any('F_FULLY_AMPHIBIOUS', 'F_LIMITED_AMPHIBIOUS', 'F_BULLDOZER', 'S_COMBINE')) return ground;
  if (any('F_DUNE_BUGGY')) return mode === 'Wheeled';
  if (any('F_ENVIRONMENTAL_SEALING')) return mode !== 'Submarine';
  if (any('F_JUMP_JET', 'F_VEE_DC', 'S_CHAINSAW', 'S_DUAL_SAW', 'S_MINING_DRILL')) return ground || ['Hover', 'WiGE'].includes(mode);
  if (any('F_MINESWEEPER', 'S_PILE_DRIVER')) return ground || marine;
  if (any('F_HITCH')) return ground || ['Rail', 'MagLev'].includes(mode);
  if (any('F_LIFEBOAT')) return any('S_MARITIME_ESCAPE_POD', 'S_MARITIME_LIFEBOAT') ? entity.isSupportVehicle() ? mode !== 'Hover' : marine : aero;
  if (any('F_HEAVY_BRIDGE_LAYER', 'F_MEDIUM_BRIDGE_LAYER', 'F_LIGHT_BRIDGE_LAYER', 'S_SUPERCHARGER', 'S_BACKHOE', 'S_ROCK_CUTTER', 'S_SPOT_WELDER', 'S_WRECKING_BALL')) return mode !== 'VTOL' && !aero;
  if (any('F_AP_POD')) return !marine && !aero;
  if (any('F_ARMORED_MOTIVE_SYSTEM')) return !aero && !['VTOL', 'Rail', 'MagLev'].includes(mode);
  if (any('F_MASH')) return mode !== 'VTOL';
  if (any('F_SPONSON_TURRET', 'F_LADDER')) return !aero;
  if (any('F_PINTLE_TURRET')) return !marine && !['Aerodyne', 'Station Keeping'].includes(mode);
  if (any('F_LOOKDOWN_RADAR', 'F_INFRARED_IMAGER', 'F_HIRES_IMAGER')) return aero || mode === 'VTOL';
  if (any('F_REFUELING_DROGUE')) return ['VTOL', 'Aerodyne', 'Airship'].includes(mode);
  if (any('F_SASRCS', 'F_LIGHT_SAIL', 'F_SPACE_MINE_DISPENSER', 'F_SMALL_COMM_SCANNER_SUITE')) return mode === 'Station Keeping';
  if (any('F_VEHICLE_MINE_DISPENSER')) return mode !== 'Station Keeping';
  if (any('F_EXTERNAL_STORES_HARDPOINT')) return mode === 'Aerodyne';
  if (any('F_MAST_MOUNT') || (any('F_MASC') && any('F_VTOL_EQUIPMENT'))) return mode === 'VTOL';
  return true;
}

/** MML catalog restrictions depend on the chassis, not a destination or remaining capacity. */
export function constructionEquipmentChassisMessages(entity: BaseEntity, equipment: Equipment,
  mount?: EntityMountedEquipment): readonly EntityValidationMessage[] {
  const messages: EntityValidationMessage[] = [];
  const add = (code: string, message: string, category: EntityValidationMessage['category'] = 'equipment') =>
    messages.push({ code, message, category, severity: 'error', ...(mount ? { location: mount.location } : {}) });
  if (entity instanceof MekEntity && equipment instanceof MiscEquipment) {
    const quad = entity.chassisConfig === 'Quad' || entity.chassisConfig === 'QuadVee';
    const lam = entity.chassisConfig === 'LAM';
    // MekUtil.isMekEquipment: chassis-specific equipment remains hidden even with ample slots.
    if (!lam && equipment.hasAnyFlag(['F_LAM_FUEL_TANK', 'F_BOMB_BAY'])) add('MEK_LAM_ONLY_EQUIPMENT', `${equipment.name} requires a LAM.`);
    if (!quad && equipment.hasFlag('F_QUAD_TURRET')) add('MEK_QUAD_TURRET_CHASSIS', 'Quad turrets require a quad Mek.');
    if (!quad && equipment.hasFlag('F_RAM_PLATE')) add('MEK_RAM_PLATE_CHASSIS', 'Ram plates require a quad Mek.');
    if (quad && equipment.hasFlag('F_SHOULDER_TURRET')) add('MEK_QUAD_SHOULDER_TURRET', 'Quad Meks cannot mount shoulder turrets.');
    if (quad && equipment.hasAnyFlag(['F_CHAIN_DRAPE_APRON', 'F_CHAIN_DRAPE_PONCHO'])) add('MEK_CHAIN_DRAPE_CONFIGURATION', 'Quad Meks can use only cape chain drapes.');
    if (entity.isSuperHeavy() && equipment.hasAnyFlag(['F_TSM', 'F_INDUSTRIAL_TSM', 'F_SCM', 'F_MASC', 'F_JUMP_JET', 'F_MECHANICAL_JUMP_BOOSTER', 'F_UMU', 'F_ACTUATOR_ENHANCEMENT_SYSTEM', 'F_MODULAR_ARMOR', 'F_PARTIAL_WING'])) {
      add('MEK_SUPERHEAVY_EQUIPMENT', `${equipment.name} cannot be mounted on a superheavy Mek.`);
    }
    const myomer = equipment.hasAnyFlag(['F_TSM', 'F_INDUSTRIAL_TSM', 'F_SCM'])
      || equipment.hasFlag('F_MASC') && !equipment.hasFlag('S_SUPERCHARGER');
    if (entity.mountedCockpit().isPrimitive && myomer) add('PRIMITIVE_MYOMER_EQUIPMENT', 'Primitive Meks cannot use myomer enhancements.');
    if (entity.isIndustrial() && myomer && !equipment.hasFlag('F_INDUSTRIAL_TSM')) add('MEK_INDUSTRIAL_MYOMER', `${equipment.name} cannot be mounted on an IndustrialMek.`);
    if (!entity.isIndustrial() && equipment.hasFlag('F_INDUSTRIAL_TSM')) add('MEK_INDUSTRIAL_ONLY_EQUIPMENT', `${equipment.name} requires an IndustrialMek.`);
    if (entity.isIndustrial() && isImprovedJumpJetEquipment(equipment)) add('MEK_INDUSTRIAL_JUMP_TYPE', 'IndustrialMeks may use standard or prototype-standard jump jets, or mechanical jump boosters.', 'movement');
    if ((entity.isIndustrial() || entity.mountedCockpit().isPrimitive) && equipment.isHeatSink
      && equipment.hasAnyFlag(['F_DOUBLE_HEAT_SINK', 'F_COMPACT_HEAT_SINK', 'F_IS_DOUBLE_HEAT_SINK_PROTOTYPE'])) {
      add(entity.isIndustrial() ? 'INDUSTRIAL_HEAT_SINK' : 'PRIMITIVE_HEAT_SINK', 'Industrial and primitive Meks require single heat sinks.', 'heat');
    }
    if (lam && (equipment.hasAnyFlag(['F_MODULAR_ARMOR', 'F_JUMP_BOOSTER', 'F_PARTIAL_WING', 'F_VOID_SIG', 'F_NULL_SIG',
      'F_BLUE_SHIELD', 'F_CHAMELEON_SHIELD', 'F_ENVIRONMENTAL_SEALING', 'F_DUMPER', 'F_HEAVY_BRIDGE_LAYER',
      'F_MEDIUM_BRIDGE_LAYER', 'F_LIGHT_BRIDGE_LAYER']) || equipment.hasFlag('F_MASC') && equipment.hasFlag('S_SUPERCHARGER')
      || equipment.hasFlag('F_CLUB') && equipment.hasAnyFlag(['S_BACKHOE', 'S_COMBINE']))) {
      add('LAM_EQUIPMENT', `${equipment.name} cannot be fitted to a LAM.`);
    }
    if (equipment.hasFlag('F_FUEL') && (!entity.isIndustrial() || !['ICE', 'Fuel Cell'].includes(entity.mountedEngine().type()))) {
      add('MEK_EXTERNAL_FUEL_ENGINE', 'External fuel tanks require an IndustrialMek with an ICE or fuel-cell engine.');
    }
    if (!entity.isIndustrial() && (equipment.hasFlag('F_ENVIRONMENTAL_SEALING') || equipment.id === 'Cargo Container (10 tons)')) {
      add('MEK_INDUSTRIAL_ONLY_EQUIPMENT', `${equipment.name} requires an IndustrialMek.`);
    }
  }
  if (entity instanceof VehicleEntity || entity.isSupportVehicle()) {
    if (!equipmentFitsVehicleMovement(entity, equipment)) add('VEHICLE_MOTIVE_EQUIPMENT', `${equipment.name} is incompatible with ${entity.motiveType()} movement.`);
    if (equipment instanceof MiscEquipment) {
      const engine = entity.mountedEngine();
      if (equipment.hasFlag('F_MASC') && (!engine.installed || ['Solar', 'External', 'None'].includes(engine.type()))) {
        add('SUPERCHARGER_ENGINE', 'Superchargers require a compatible powered engine.', 'engine');
      }
      if (equipment.hasFlag('F_FUEL') && (!engine.installed || !['ICE', 'Fuel Cell'].includes(engine.type()))) {
        add('VEHICLE_EXTERNAL_FUEL_ENGINE', 'External fuel tanks require an ICE or fuel-cell engine.', 'engine');
      }
    }
    if (entity.isSupportVehicle() && entity.tonnage() < 5) {
      const tonnage = equipment.hasFixedTonnage() ? equipment.tonnage : getEquipmentTonnage(entity, mount ?? new EntityMountedEquipment({
        mountId: 'construction-candidate', equipmentId: equipment.id, equipment, allocation: { kind: 'unallocated' },
        rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false,
      }, entity));
      if (tonnage !== undefined && tonnage >= 5) add('SMALL_SUPPORT_EQUIPMENT_WEIGHT', 'Equipment on a small support vehicle must weigh less than five tons.', 'weight');
    }
  }
  if (entity instanceof AeroEntity && equipment.hasFlag('F_FLOTATION_HULL') && entity.entityType !== 'ConvFighter') {
    add('FLOTATION_HULL_CHASSIS', 'Aerospace flotation hulls require a conventional fighter.');
  }
  return messages;
}

/** Armor and equipment reduce fighter weapon slots, not arbitrary critical grids. */
export function fighterWeaponCapacity(entity: AeroEntity): ReadonlyMap<string, number> {
  const order = ['Nose', 'Left Wing', 'Right Wing', 'Aft'];
  const capacity = [5, 5, 5, 5];
  const armor = entity.uniformArmor();
  if (armor) {
    let remaining = armor.armor.fighterSlots;
    let index = remaining === 2 ? 2 : 3;
    while (remaining > 0) { capacity[index]--; remaining--; index = (index + 3) % 4; }
  } else {
    order.forEach((location, index) => capacity[index] -= entity.armorByLocation().get(location)?.armor.patchworkSlotsCVFtr ?? 0);
  }
  if (entity.equipment().some(mount => mount.equipment?.hasFlag('F_BLUE_SHIELD'))) capacity.forEach((_, index) => capacity[index]--);
  if (entity.entityType === 'ConvFighter' && entity.mountedEngine().rating > 400) capacity[3]--;
  return new Map(order.map((location, index) => [location, capacity[index]]));
}

/** Tank.getFreeSlots: ammo families and cargo/JJ/fuel groups each reserve one slot. */
export function combatVehicleSlotBudget(entity: VehicleEntity): { capacity: number; used: number } {
  let used = entity.extraSeats();
  const groups = new Set<string>();
  for (const mount of entity.equipment()) {
    const eq = mount.equipment;
    if (!eq || eq.type === 'armor') continue;
    if (eq instanceof AmmoEquipment) { groups.add(`ammo:${eq.ammoType}:${eq.rackSize}`); continue; }
    const group = ['F_CARGO', 'F_JUMP_JET', 'F_FUEL'].find(flag => eq.hasFlag(flag as EquipmentFlag));
    if (group) { groups.add(group); continue; }
    used += eq.tankSlots;
  }
  used += groups.size;
  const engine = entity.mountedEngine();
  used += engine.type() === 'Light' ? 1 : engine.type() === 'XL' ? (engine.techBase === 'Clan' ? 1 : 2)
    : engine.type() === 'XXL' ? (engine.techBase === 'Clan' ? 2 : 4) : engine.type() === 'Compact' ? -1 : 0;
  if (engine.rating > 400) used++;
  const armor = entity.uniformArmor();
  if (armor) used += armor.armor.tankSlots;
  else for (const material of entity.armorByLocation().values()) used += material.armor.patchworkSlotsCVFtr;
  let infantryCounted = false;
  for (const transporter of entity.transporters()) {
    if (transporter.kind === 'troop-space' || (transporter.kind === 'bay' && ['infantry', 'battle-armor'].includes(transporter.configuration.type))) {
      if (!infantryCounted) used++;
      infantryCounted = true;
    } else if (transporter.kind === 'bay') used++;
  }
  return { capacity: 5 + Math.floor(entity.tonnage() / 5), used };
}

/** TechManual p. 163, Structure Weights: total suit limits converted from kg to tons. */
export function battleArmorSuitMassCapacity(entity: BattleArmorEntity): number {
  const limits: Readonly<Record<string, number>> = { 'Ultra Light': 0.4, Light: 0.75, Medium: 1, Heavy: 1.5, Assault: 2 };
  return limits[entity.weightClass()] ?? 0;
}

export function battleArmorMountCapacity(entity: BattleArmorEntity, location: string): number {
  const quad = entity.chassisType().toLowerCase() === 'quad';
  const index = ['Ultra Light', 'Light', 'Medium', 'Heavy', 'Assault'].indexOf(entity.weightClass());
  const turret = /^(Standard|Modular|Configurable):(\d+)$/i.exec(entity.turretConfig());
  if (location === 'Turret') return turret ? Number(turret[2]) : 0;
  if (location === 'LA' || location === 'RA') return quad ? 0 : [2, 2, 3, 3, 4][index] ?? 0;
  if (quad) return ([0, 5, 7, 9, 11][index] ?? 0) - (turret ? /^Standard$/i.test(turret[1]) ? 1 : 2 : 0);
  return [2, 4, 4, 6, 6][index] ?? 0;
}

export function constructionFamilyMessages(entity: BaseEntity): EntityValidationMessage[] {
  const messages: EntityValidationMessage[] = [];
  const add = (code: string, message: string, category: EntityValidationMessage['category'] = 'equipment', location?: string) =>
    messages.push({ severity: 'error', code, message, category, location });
  const has = (flag: EquipmentFlag) => entity.equipment().some(mount => mount.equipment?.hasFlag(flag));
  const count = (flag: EquipmentFlag) => entity.equipment().filter(mount => mount.equipment?.hasFlag(flag)).length;
  if (!(entity instanceof MekEntity)) for (const mount of entity.equipment()) {
    if (mount.equipment) messages.push(...constructionEquipmentChassisMessages(entity, mount.equipment, mount));
  }
  if (entity instanceof MekEntity) {
    const engine = entity.mountedEngine();
    if (!engine.installed || engine.type() === 'None') add('MEK_ENGINE_REQUIRED', 'Meks require an installed engine.', 'engine');
    if (engine.rating < 10 || engine.rating > 500 || engine.rating % 5 !== 0) add('MEK_ENGINE_RATING', 'Mek engine rating must be 10–500 in increments of five.', 'engine');
    if (engine.rating !== entity.calculateEngineRating()) add('MEK_ENGINE_MOVEMENT', entity.mountedCockpit().isPrimitive
      ? 'Primitive engine rating must equal chassis tonnage × walk MP × 1.2, rounded up to the next five.'
      : 'Engine rating must equal chassis tonnage × walk MP.', 'engine');
    if (!constructionGyroApplies(entity, entity.gyroType())) add('MEK_GYRO_CLASS', 'This gyro is incompatible with the Mek chassis and cockpit.', 'structure');
    if (entity.chassisConfig === 'QuadVee' && entity.isSuperHeavy()) add('QUADVEE_WEIGHT', 'QuadVees cannot be superheavy.', 'weight');
    const improved = entity.equipment().some(mount => isImprovedJumpJetEquipment(mount.equipment));
    if (!has('F_PARTIAL_WING') && entity.jumpMP() > Math.ceil(entity.originalWalkMP() * 1.5)) add('MEK_JUMP_RUN_LIMIT', 'Jump MP cannot exceed run MP.', 'movement');
    if (!has('F_PARTIAL_WING') && !improved && entity.jumpMP() > entity.originalWalkMP()) add('MEK_JUMP_WALK_LIMIT', 'Standard jump jets cannot exceed walk MP.', 'movement');
    if (entity.chassisConfig === 'LAM' && entity.jumpMP() < 3) add('LAM_JUMP_MINIMUM', 'LAMs need at least three jump MP.', 'movement');
    if (entity.isIndustrial()) {
      if (!constructionEngineApplies(entity, engine.type(), engine.techBase)) add('INDUSTRIAL_ENGINE', 'This engine is incompatible with the IndustrialMek chassis.', 'engine');
    }
  }
  if (entity instanceof VehicleEntity || entity.isSupportVehicle()) {
    if (entity instanceof VehicleEntity) {
      if (!entity.effectiveIsTrailer() && entity.hasNoControlSystems()) add('VEHICLE_CONTROL_SYSTEMS', 'Only trailers may omit control systems.', 'structure');
      if (entity.hasDualTurret() && !entity.hasTurret()) add('VEHICLE_SECOND_TURRET', 'A second turret requires the first turret.', 'structure');
      if (entity.motiveType() === 'VTOL') {
        if (count('F_MAST_MOUNT') > 1) add('VEHICLE_MAST_COUNT', 'Only one mast mount is permitted.');
        if (!has('F_MAST_MOUNT') && entity.getEquipmentAtLocation('Rotor').some(mount => mount.equipment?.type !== 'armor')) add('VEHICLE_ROTOR_MAST', 'Rotor equipment requires a mast mount.', 'equipment', 'Rotor');
      }
      for (const location of entity.validLocations) {
        if (entity.getEquipmentAtLocation(location).filter(mount => mount.equipment?.hasFlag('F_MANIPULATOR')).length > 2) add('VEHICLE_MANIPULATOR_LIMIT', 'Only two manipulators are permitted per location.', 'equipment', location);
      }
      if (entity.omni()) for (const [locations, base] of [
        [['Turret', 'Rear Turret'], entity.baseChassisTurretWeight()],
        [['Front Turret'], entity.baseChassisTurret2Weight()],
      ] as const) {
        if (base < 0) continue;
        const tons = entity.equipment().filter(mount => locations.some(location => location === mount.location) && !(mount.equipment instanceof AmmoEquipment))
          .reduce((sum, mount) => sum + (mount.getTonnage(entity) ?? 0), 0) / 10;
        const required = entity.isSupportVehicle() && entity.tonnage() < 5 ? Math.ceil((tons - 1e-9) * 1000) / 1000 : ceilToHalfTon(tons);
        if (required > base + 1e-9) add('VEHICLE_OMNI_TURRET_CAPACITY', `Turret equipment requires ${required} t of turret structure; the base chassis provides ${base} t.`, 'weight', locations[0]);
      }
      if (count('F_BULLDOZER') > 2) add('VEHICLE_BULLDOZER_LIMIT', 'A vehicle can mount at most two bulldozer blades.');
    }
    if (entity instanceof VehicleEntity && !entity.isSupportVehicle()) {
      const budget = combatVehicleSlotBudget(entity);
      if (budget.used > budget.capacity) add('VEHICLE_SLOTS', `Vehicle uses ${budget.used} of ${budget.capacity} equipment slots.`, 'crit');
      const max: Record<string, number> = { Wheeled: 160, WiGE: 160, Hover: 100, VTOL: 60, Naval: 555, Submarine: 555, Hydrofoil: 100 };
      if (entity.tonnage() > (max[entity.motiveType()] ?? 200)) add('VEHICLE_MAX_TONNAGE', 'Chassis exceeds the maximum tonnage for its motive type.', 'weight');
      if (!Number.isInteger(entity.tonnage()) || entity.tonnage() < 1) add('VEHICLE_TONNAGE_INCREMENT', 'Combat vehicles require whole-ton chassis weights of at least one ton.', 'weight');
      const engine = entity.mountedEngine();
      if (!constructionEngineApplies(entity, engine.type(), engine.techBase)) add('VEHICLE_ENGINE_TYPE', 'This engine is incompatible with the vehicle chassis.', 'engine');
      if (!entity.isTrailer() && (!engine.installed || engine.type() === 'None')) add('VEHICLE_ENGINE_REQUIRED', 'Powered combat vehicles require an engine.', 'engine');
      if (engine.type() !== 'None' && (engine.rating < 10 || engine.rating > 500 || engine.rating % 5 !== 0)) add('VEHICLE_ENGINE_RATING', 'Vehicle engine rating must be 10–500 in increments of five.', 'engine');
      if (engine.type() === 'None' && entity.originalWalkMP() !== 0) add('VEHICLE_UNPOWERED_MOVEMENT', 'An unpowered trailer must have zero cruise MP.', 'movement');
      if (entity.motiveType() === 'WiGE' && entity.originalWalkMP() < 5) add('VEHICLE_WIGE_SPEED', 'WiGE combat vehicles require at least five cruise MP.', 'movement');
      if (has('F_JUMP_JET') && (has('F_SPONSON_TURRET') || entity.equipment().some(mount => mount.turretType === 'sponson'))) add('VEHICLE_SPONSON_JUMP', 'Vehicular jump jets cannot be combined with sponson turrets.');
      for (const flag of ['F_ENVIRONMENTAL_SEALING', 'F_DUNE_BUGGY', 'F_FLOTATION_HULL', 'F_FULLY_AMPHIBIOUS', 'F_LIMITED_AMPHIBIOUS'] as const) {
        if (count(flag) > 1) add('VEHICLE_DUPLICATE_CHASSIS_MOD', `Only one ${flag.slice(2).toLowerCase().replaceAll('_', ' ')} chassis modification is permitted.`);
      }
    }
  }
  if (entity instanceof AeroEntity && !(entity instanceof SmallCraftEntity || entity instanceof JumpShipEntity) && !entity.isSupportVehicle()) {
    const engine = entity.mountedEngine();
    if (!engine.installed || !constructionEngineApplies(entity, engine.type(), engine.techBase)) add('FIGHTER_ENGINE_TYPE', 'This fighter requires a compatible installed engine.', 'engine');
    if (engine.rating < 10 || engine.rating > 500 || engine.rating % 5 !== 0) add('FIGHTER_ENGINE_RATING', 'Fighter engine rating must be 10–500 in increments of five.', 'engine');
    if (entity.entityType === 'ConvFighter') {
      if (entity.heatSinkType() !== 'Single') add('CONVENTIONAL_HEAT_SINK_TYPE', 'Conventional fighters require single heat sinks.', 'heat');
    }
    if (count('F_FLOTATION_HULL') > 1) add('FIGHTER_FLOTATION_LIMIT', 'Only one flotation hull is permitted.');
    if (!entity.omni() && entity.omnipodHeatSinkCount() > 0) add('FIGHTER_OMNI_HEAT_SINKS', 'Pod heat sinks require an OmniFighter.', 'heat');
    if (entity.omnipodHeatSinkCount() > entity.heatSinkCount()) add('FIGHTER_POD_SINK_COUNT', 'Pod heat sinks cannot exceed the total heat sink count.', 'heat');
    for (const [location, maximum] of fighterWeaponCapacity(entity)) {
      const used = entity.getEquipmentAtLocation(location).filter(mount => mount.equipment instanceof WeaponEquipment && !mount.equipment.isInternalRepresentation).length;
      if (used > maximum) add('FIGHTER_WEAPON_SLOTS', `${location} has ${used} weapons but only ${maximum} weapon slots.`, 'crit', location);
    }
    if (entity.entityType === 'ConvFighter' && entity.cockpitType() !== 'Standard') add('CONVENTIONAL_COCKPIT', 'Conventional fighters require a standard cockpit.', 'structure');
    if (entity.entityType === 'Aero' && entity.heatSinkCount() < 10) add('FIGHTER_HEAT_SINKS', 'Aerospace fighters require at least ten heat sinks.', 'heat');
    if (entity.tonnage() % 5 !== 0 || entity.tonnage() < 5 || entity.tonnage() > (entity.entityType === 'ConvFighter' ? 50 : 100)) add('FIGHTER_TONNAGE', 'Fighter tonnage must be in 5-ton increments within its chassis limits.', 'weight');
    for (const mount of entity.equipment()) if (mount.equipment instanceof AmmoEquipment && mount.equipment.ammoType === 'AC_LBX' && !mount.equipment.hasMunitionType('M_CLUSTER')) add('FIGHTER_LBX_CLUSTER', 'Aerospace LB-X weapons require cluster ammunition.', 'equipment', mount.location);
  }
  if (entity instanceof BattleArmorEntity) {
    if (!constructionBattleArmorChassisApplies(entity.chassisType(), entity.weightClass())) add('BA_QUAD_ULTRALIGHT', 'Quad battle armor requires a light or heavier chassis.', 'structure');
    const classes = ['Ultra Light', 'Light', 'Medium', 'Heavy', 'Assault'];
    const index = classes.indexOf(entity.weightClass());
    const quad = entity.chassisType().toLowerCase() === 'quad';
    const turret = /^(Standard|Modular|Configurable):(\d+)$/i.exec(entity.turretConfig());
    if (entity.turretConfig() && (!turret || !quad || Number(turret[2]) < 1 || Number(turret[2]) > (/^Standard$/i.test(turret[1]) ? 10 : 9))) add('BA_TURRET_CONFIGURATION', 'Battle armor turrets require a quad chassis and 1–10 standard or 1–9 modular slots.', 'structure');
    if (!['Leg', 'Jump', 'UMU', 'VTOL'].includes(entity.motiveType()) || quad && entity.motiveType() !== 'Leg'
      || ['Heavy', 'Assault'].includes(entity.weightClass()) && entity.motiveType() === 'VTOL') add('BA_MOTIVE_CONFIGURATION', 'The selected propulsion system is incompatible with this battle armor chassis.', 'movement');
    if (entity.motiveType() === 'Leg' && entity.propulsionMP() > 0) add('BA_PROPULSION_REQUIRED', 'Select a propulsion system to allocate propulsion MP.', 'movement');
    if (entity.isExoskeleton() && entity.weightClass() !== 'Ultra Light') add('BA_EXOSKELETON_CLASS', 'Exoskeletons require ultra-light powered armor.', 'structure');
    if (entity.clanExoWithoutHarJel() && (!entity.isExoskeleton() || entity.techBase() !== 'Clan')) add('BA_EXOSKELETON_HARJEL', 'Omitting exoskeleton HarJel requires a Clan exoskeleton.', 'structure');
    const maxWalk = (index >= 3 ? 2 : 3) + (quad ? 2 : 0);
    const maxPropulsion = quad ? 0 : entity.motiveType() === 'VTOL' ? index > 2 ? 0 : 7 - index
      : entity.motiveType() === 'UMU' ? Math.min(5, 6 - index) : maxWalk;
    if (entity.originalWalkMP() > maxWalk) add('BA_WALK_LIMIT', `This suit permits at most ${maxWalk} base walk MP.`, 'movement');
    if (entity.propulsionMP() > maxPropulsion) add('BA_PROPULSION_LIMIT', `This suit permits at most ${maxPropulsion} propulsion MP.`, 'movement');
    const maximumArmor = entity.maxArmorValues().get('Squad') ?? 0;
    if ((entity.armorValues().get('Squad')?.front ?? 0) > maximumArmor) add('BA_ARMOR_MAXIMUM', `Each suit permits at most ${maximumArmor} armor points.`, 'armor', 'Squad');
    const suitLimit = battleArmorSuitMassCapacity(entity);
    try {
      for (const suit of calculateBattleArmorWeightBreakdown(entity).suits) if (suit.exact > suitLimit + 0.00001) add('BA_SUIT_OVERWEIGHT', `Trooper ${suit.trooper + 1} weighs ${suit.exact} t; suit limit is ${suitLimit} t.`, 'weight');
    } catch { /* Unresolved equipment mass is reported by the aggregate validator. */ }
    for (let trooper = 1; trooper <= entity.trooperCount(); trooper++) {
      // DWP weapons and ammunition are external; only the pack occupies a suit slot (TO:AUE p. 99).
      const mounts = entity.getConstructionEquipmentForTrooper(trooper).filter(mount => !mount.isDWP);
      for (const location of ['Body', 'LA', 'RA', 'Turret']) {
        const installed = mounts.filter(mount => (mount.baMountLocation ?? 'Body') === location);
        const slots = installed.reduce((sum, mount) => sum + baCriticalSlots(entity, mount), 0);
        const capacity = battleArmorMountCapacity(entity, location);
        if (slots > capacity) add('BA_LOCATION_SLOTS', `Trooper ${trooper} ${location} uses ${slots} of ${capacity} critical slots.`, 'crit');
        if (location === 'Turret') continue; // Quad turret weapons count against the body allowance.
        const weapons = mounts.filter(mount => ((mount.baMountLocation ?? 'Body') === location || quad && location === 'Body' && mount.baMountLocation === 'Turret')
          && mount.equipment instanceof WeaponEquipment && !mount.equipment.isInfantryWeapon());
        if (weapons.length > (location === 'LA' || location === 'RA' ? 1 : quad ? 4 : 2)) add('BA_ANTI_MEK_WEAPON_LIMIT', `Too many anti-Mek weapons on trooper ${trooper} ${location}.`);
      }
    }
    for (const mount of entity.equipment()) {
      if (mount.location === 'Squad' && mount.equipment instanceof WeaponEquipment && (mount.equipment.hasFlag('F_TASER') || mount.equipment.ammoType === 'NARC')) add('BA_INDIVIDUAL_WEAPON', 'BA tasers and NARC must be assigned to individual troopers.', 'equipment', mount.location);
      if (mount.equipment?.hasFlag('F_BA_MANIPULATOR') && (quad || !['LA', 'RA'].includes(mount.baMountLocation ?? ''))) add('BA_MANIPULATOR_LOCATION', 'Manipulators require a biped suit arm.', 'equipment', mount.location);
      if (mount.equipment instanceof WeaponEquipment && mount.equipment.isInfantryWeapon() && !mount.isAPM) add('BA_AP_MOUNT_REQUIRED', 'Infantry weapons require an anti-personnel mount.', 'equipment', mount.location);
    }
  }
  if (entity instanceof InfantryEntity) {
    if (!entity.primaryWeapon()) add('INFANTRY_PRIMARY_WEAPON', 'Select a primary infantry weapon.');
    if (entity.secondaryCount() > entity.squadSize()) add('INFANTRY_SECONDARY_COUNT', 'Secondary weapon count cannot exceed squad size.');
    if (entity.secondaryCount() > 0 && !entity.secondaryWeapon()) add('INFANTRY_SECONDARY_MISSING', 'Select a secondary infantry weapon.');
    const guns = entity.equipment().filter(mount => mount.location === 'Field Guns' && mount.equipment instanceof WeaponEquipment);
    if (new Set(guns.map(mount => mount.equipmentId)).size > 1) add('INFANTRY_FIELD_GUN_TYPE', 'All field guns must have the same type and size.');
    if (guns.length > 1 && guns.some(mount => mount.equipment?.hasFlag('F_ARTILLERY'))) add('INFANTRY_ARTILLERY_LIMIT', 'Infantry can operate only one field artillery weapon.');
    const crew = guns.reduce((sum, mount) => sum + Math.max(2, Math.ceil(mount.getTonnage(entity) ?? 0)), 0);
    if (crew > entity.squadCount() * entity.squadSize()) add('INFANTRY_FIELD_GUN_CREW', `Field guns require ${crew} troopers.`, 'general');
  }
  if (entity.entityType === 'HandheldWeapon') {
    const equipment = entity.equipment();
    if (equipment.some(mount => mount.equipment?.hasFlag('F_CLUB'))) {
      if (equipment.length > 1) add('HANDHELD_MELEE_EXCLUSIVE', 'A handheld melee weapon cannot contain any other equipment.');
    } else if (equipment.filter(mount => !(mount.equipment instanceof AmmoEquipment) && !mount.equipment?.hasFlag('F_WEAPON_ENHANCEMENT')).length > 6) {
      add('HANDHELD_ITEM_LIMIT', 'Handheld weapons can mount at most six items, excluding ammunition and weapon enhancements.');
    }
    const kinds = new Set<string>();
    for (const mount of equipment) if (mount.equipment instanceof AmmoEquipment) {
      const kind = `${mount.equipment.ammoType}:${mount.equipment.rackSize}`;
      if (kinds.has(kind)) add('HANDHELD_AMMO_BIN_LIMIT', 'Use a single ammunition bin per ammunition type and rack size; adjust its shot count.');
      kinds.add(kind);
    }
  }
  if (entity instanceof SmallCraftEntity || entity instanceof JumpShipEntity) {
    for (const bay of entity.equipmentBays().filter(bay => bay.kind === 'weapon-bay')) {
      if (!bay.weapons.length) add('EMPTY_WEAPON_BAY', 'Weapon bays must contain a weapon.');
      if (new Set(bay.weapons.map(weaponBayGroupingKey)).size > 1) add('WEAPON_BAY_GROUPING', 'Every weapon in a bay must have the same class and firing arc.');
      if (bay.weapons.length && bay.weapons.reduce((sum, weapon) => sum + standardWeaponBayDamage(weapon), 0) > weaponBayDamageLimit(bay.weapons[0])) add('WEAPON_BAY_DAMAGE', 'A weapon bay exceeds the maximum standard damage.');
      for (const weapon of bay.weapons) {
        if (weapon.equipment.oneShotCount || weapon.equipment.ammoType === 'NA') continue;
        const required = 10 * (['AC_ULTRA', 'AC_ULTRA_THB'].includes(weapon.equipment.ammoType) ? 2 : weapon.equipment.ammoType === 'AC_ROTARY' ? 6 : 1);
        const shots = bay.ammo.reduce((sum, ammo) => ammo.equipment instanceof AmmoEquipment && ammoMatchesWeapon(weapon.equipment, ammo.equipment) ? sum + (ammo.getAmmoShots() ?? 0) : sum, 0);
        const peers = bay.weapons.filter(other => other.equipment.ammoType === weapon.equipment.ammoType && other.equipment.rackSize === weapon.equipment.rackSize).length;
        if (shots < required * peers) add('BAY_AMMUNITION_MINIMUM', `${weapon.equipment.name} bay requires at least ${required * peers} matching shots.`, 'equipment', weapon.location);
      }
      for (const ammo of bay.ammo) if (ammo.equipment instanceof AmmoEquipment && !bay.weapons.some(weapon => ammoMatchesWeapon(weapon.equipment, ammo.equipment as AmmoEquipment))) add('BAY_AMMUNITION_WEAPON', 'A weapon bay contains ammunition for a weapon outside that bay.', 'equipment', ammo.location);
    }
    if (entity instanceof SmallCraftEntity) {
      const lateral = new Map<string, number>();
      for (const mount of entity.equipment()) if (mount.equipment instanceof WeaponEquipment && !mount.equipment.isInternalRepresentation) {
        const side = ['Left Wing', 'Left Side'].includes(mount.location) ? 1 : ['Right Wing', 'Right Side'].includes(mount.location) ? -1 : 0;
        if (side) {
          const key = `${mount.equipmentId}:${mount.rearMounted}`;
          lateral.set(key, (lateral.get(key) ?? 0) + side);
        }
      }
      if ([...lateral.values()].some(balance => balance !== 0)) add('SPACECRAFT_LATERAL_WEAPONS', 'Left and right side weapon loads must match, including rear-facing weapons.');
    }
    if (entity.crew() < 1) add('SPACECRAFT_CREW', 'Spacecraft require assigned crew.', 'general');
    if (entity.structuralIntegrity() < 1) add('SPACECRAFT_SI', 'Spacecraft structural integrity must be positive.', 'structure');
  }
  return messages;
}

function baCriticalSlots(entity: BattleArmorEntity, mount: EntityMountedEquipment): number {
  const eq = mount.equipment;
  if (!eq || eq.hasFlag('F_BA_MANIPULATOR') || mount.isAPM && entity.getLinkingMount(mount)?.equipment?.hasFlag('F_AP_MOUNT')) return 0;
  return eq.isSpreadable ? 1 : getNumCriticalSlots(entity, eq, mount.size ?? 1) ?? 0;
}
