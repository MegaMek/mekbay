// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import { AmmoEquipment, Equipment, WeaponEquipment, ammoMatchesWeapon } from '../../models/equipment.model';
import type { EquipmentFlag } from '../../models/equipment-flags.type';
import { AeroEntity, BattleArmorEntity, InfantryEntity, JumpShipEntity, MekEntity, SmallCraftEntity, VehicleEntity } from '../../models/entity/entities';
import type { EntityMountedEquipment, EntityValidationMessage } from '../../models/entity/types';
import { calculateBattleArmorWeightBreakdown } from '../../models/entity/utils/weight/battle-armor-weight';
import { getNumCriticalSlots } from '../../models/entity/utils/equipment-helpers';
import { isImprovedJumpJetEquipment } from '../../models/jump-equipment.model';
import { standardWeaponBayDamage, weaponBayDamageLimit, weaponBayGroupingKey } from '../../models/entity/utils/weapon-bay-grouping';

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
  if (any('F_JUMP_JET', 'S_CHAINSAW', 'S_DUAL_SAW', 'S_MINING_DRILL')) return ground || ['Hover', 'WiGE'].includes(mode);
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
  if (entity instanceof MekEntity) {
    const engine = entity.mountedEngine();
    if (!engine.installed || engine.type() === 'None') add('MEK_ENGINE_REQUIRED', 'Meks require an installed engine.', 'engine');
    if (engine.rating < 10 || engine.rating > 500 || engine.rating % 5 !== 0) add('MEK_ENGINE_RATING', 'Mek engine rating must be 10–500 in increments of five.', 'engine');
    if (engine.rating !== entity.originalWalkMP() * entity.tonnage() && !entity.mountedCockpit().isPrimitive) add('MEK_ENGINE_MOVEMENT', 'Engine rating must equal chassis tonnage × walk MP.', 'engine');
    if (entity.isSuperHeavy() !== (entity.gyroType() === 'Superheavy')) add('MEK_GYRO_CLASS', 'Superheavy Meks require a superheavy gyro; other Meks cannot use one.', 'structure');
    if (entity.isSuperHeavy() && (entity.equipment().some(mount => mount.armored) || entity.armoredSystemSlots().size > 0)) add('SUPERHEAVY_ARMORED_COMPONENT', 'Superheavy Meks cannot have armored components.');
    if (entity.chassisConfig === 'QuadVee' && entity.isSuperHeavy()) add('QUADVEE_WEIGHT', 'QuadVees cannot be superheavy.', 'weight');
    const improved = entity.equipment().some(mount => isImprovedJumpJetEquipment(mount.equipment));
    if (!has('F_PARTIAL_WING') && entity.jumpMP() > Math.ceil(entity.originalWalkMP() * 1.5)) add('MEK_JUMP_RUN_LIMIT', 'Jump MP cannot exceed run MP.', 'movement');
    if (!has('F_PARTIAL_WING') && !improved && entity.jumpMP() > entity.originalWalkMP()) add('MEK_JUMP_WALK_LIMIT', 'Standard jump jets cannot exceed walk MP.', 'movement');
    if (entity.chassisConfig === 'LAM' && entity.jumpMP() < 3) add('LAM_JUMP_MINIMUM', 'LAMs need at least three jump MP.', 'movement');
    if (has('F_UMU') && has('F_JUMP_JET')) add('MEK_UMU_JUMP_CONFLICT', 'UMUs cannot be combined with jump jets.');
    if (has('F_PARTIAL_WING') && has('F_JUMP_BOOSTER')) add('MEK_WING_BOOSTER_CONFLICT', 'Partial wings cannot be combined with jump boosters.');
    for (const flag of ['F_QUAD_TURRET', 'F_HEAD_TURRET', 'F_TARGETING_COMPUTER'] as const) if (count(flag) > 1) add('MEK_SINGLE_SYSTEM', `Only one ${flag.replace('F_', '').toLowerCase().replaceAll('_', ' ')} may be installed.`);
    if (entity.isIndustrial()) {
      if (!['Fusion', 'ICE', 'Fuel Cell', 'Fission'].includes(engine.type())) add('INDUSTRIAL_ENGINE', 'Industrial Meks require standard fusion, ICE, fuel-cell or fission engines.', 'engine');
      if (!['Standard', 'Superheavy'].includes(entity.gyroType())) add('INDUSTRIAL_GYRO', 'Industrial Meks require standard or superheavy gyros.', 'structure');
      if (entity.heatSinkEquipment()?.id && entity.heatSinkEquipment()?.hasFlag('F_DOUBLE_HEAT_SINK')) add('INDUSTRIAL_HEAT_SINK', 'Industrial Meks require single heat sinks.', 'heat');
    }
  }
  if (entity instanceof VehicleEntity || entity.isSupportVehicle()) {
    for (const mount of entity.equipment()) if (mount.equipment && !equipmentFitsVehicleMovement(entity, mount.equipment)) add('VEHICLE_MOTIVE_EQUIPMENT', `${mount.equipment.name} is incompatible with ${entity.motiveType()} movement.`, 'equipment', mount.location);
    if (entity.isSupportVehicle() && entity.tonnage() < 5) {
      for (const mount of entity.equipment()) if ((mount.getTonnage(entity) ?? 0) >= 5) add('SMALL_SUPPORT_EQUIPMENT_WEIGHT', 'Equipment on a small support vehicle must weigh less than five tons.', 'weight', mount.location);
    }
    if (has('F_MASC') && ['Solar', 'External', 'None'].includes(entity.mountedEngine().type())) add('SUPERCHARGER_ENGINE', 'Superchargers require a compatible powered engine.', 'engine');
    if (has('F_FUEL') && !['ICE', 'Fuel Cell'].includes(entity.mountedEngine().type())) add('FUEL_TANK_ENGINE', 'External fuel tanks require ICE or fuel-cell engines.', 'engine');
    if (entity instanceof VehicleEntity && !entity.isSupportVehicle()) {
      const budget = combatVehicleSlotBudget(entity);
      if (budget.used > budget.capacity) add('VEHICLE_SLOTS', `Vehicle uses ${budget.used} of ${budget.capacity} equipment slots.`, 'crit');
      const max: Record<string, number> = { Wheeled: 160, WiGE: 160, Hover: 100, VTOL: 60, Naval: 555, Submarine: 555, Hydrofoil: 100 };
      if (entity.tonnage() > (max[entity.motiveType()] ?? 200)) add('VEHICLE_MAX_TONNAGE', 'Chassis exceeds the maximum tonnage for its motive type.', 'weight');
      if (entity.hasDualTurret() && !entity.hasTurret()) add('VEHICLE_SECOND_TURRET', 'A second turret requires the first turret.', 'structure');
    }
  }
  if (entity instanceof AeroEntity && !(entity instanceof SmallCraftEntity || entity instanceof JumpShipEntity) && !entity.isSupportVehicle()) {
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
    const classes = ['Ultra Light', 'Light', 'Medium', 'Heavy', 'Assault'];
    const index = classes.indexOf(entity.weightClass());
    const quad = entity.chassisType().toLowerCase() === 'quad';
    const maxWalk = (index >= 3 ? 2 : 3) + (quad ? 2 : 0);
    const maxPropulsion = quad ? 0 : entity.motiveType() === 'VTOL' ? index > 2 ? 0 : 7 - index
      : entity.motiveType() === 'UMU' ? Math.min(5, 6 - index) : maxWalk;
    if (entity.originalWalkMP() > maxWalk) add('BA_WALK_LIMIT', `This suit permits at most ${maxWalk} base walk MP.`, 'movement');
    if (entity.propulsionMP() > maxPropulsion) add('BA_PROPULSION_LIMIT', `This suit permits at most ${maxPropulsion} propulsion MP.`, 'movement');
    const maximumArmor = [2, 6, 10, 14, 18][index] ?? 0;
    if ((entity.armorValues().get('Squad')?.front ?? 0) > maximumArmor) add('BA_ARMOR_MAXIMUM', `Each suit permits at most ${maximumArmor} armor points.`, 'armor', 'Squad');
    const suitLimit = [0.4, 0.75, 1, 1.5, 2][index] ?? 0;
    try {
      for (const suit of calculateBattleArmorWeightBreakdown(entity).suits) if (suit.exact > suitLimit + 0.00001) add('BA_SUIT_OVERWEIGHT', `Trooper ${suit.trooper + 1} weighs ${suit.exact} t; suit limit is ${suitLimit} t.`, 'weight');
    } catch { /* Unresolved equipment mass is reported by the aggregate validator. */ }
    for (let trooper = 1; trooper <= entity.trooperCount(); trooper++) {
      const mounts = entity.equipment().filter(mount => mount.location === 'Squad' || mount.location === `Trooper ${trooper}`);
      for (const location of ['Body', 'LA', 'RA', 'Turret']) {
        const installed = mounts.filter(mount => (mount.baMountLocation ?? 'Body') === location);
        const slots = installed.reduce((sum, mount) => sum + baCriticalSlots(entity, mount), 0);
        const capacity = battleArmorMountCapacity(entity, location);
        if (slots > capacity) add('BA_LOCATION_SLOTS', `Trooper ${trooper} ${location} uses ${slots} of ${capacity} critical slots.`, 'crit');
        const weapons = installed.filter(mount => mount.equipment instanceof WeaponEquipment && !mount.equipment.isInfantryWeapon());
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
  if (entity instanceof SmallCraftEntity || entity instanceof JumpShipEntity) {
    for (const bay of entity.equipmentBays().filter(bay => bay.kind === 'weapon-bay')) {
      if (!bay.weapons.length) add('EMPTY_WEAPON_BAY', 'Weapon bays must contain a weapon.');
      if (new Set(bay.weapons.map(weaponBayGroupingKey)).size > 1) add('WEAPON_BAY_GROUPING', 'Every weapon in a bay must have the same class and firing arc.');
      if (bay.weapons.length && bay.weapons.reduce((sum, weapon) => sum + standardWeaponBayDamage(weapon), 0) > weaponBayDamageLimit(bay.weapons[0])) add('WEAPON_BAY_DAMAGE', 'A weapon bay exceeds the maximum standard damage.');
      for (const weapon of bay.weapons) {
        if (weapon.equipment.oneShotCount || weapon.equipment.ammoType === 'NA') continue;
        const required = 10 * (weapon.equipment.ammoType === 'AC_ULTRA' ? 2 : weapon.equipment.ammoType === 'AC_ROTARY' ? 6 : 1);
        const shots = bay.ammo.reduce((sum, ammo) => ammo.equipment instanceof AmmoEquipment && ammoMatchesWeapon(weapon.equipment, ammo.equipment) ? sum + (ammo.getAmmoShots() ?? 0) : sum, 0);
        const peers = bay.weapons.filter(other => other.equipment.ammoType === weapon.equipment.ammoType && other.equipment.rackSize === weapon.equipment.rackSize).length;
        if (shots < required * peers) add('BAY_AMMUNITION_MINIMUM', `${weapon.equipment.name} bay requires at least ${required * peers} matching shots.`, 'equipment', weapon.location);
      }
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
  if (!eq || eq.hasFlag('F_BA_MANIPULATOR') || mount.isAPM) return 0;
  return eq.isSpreadable ? 1 : getNumCriticalSlots(entity, eq, mount.size ?? 1) ?? 0;
}
