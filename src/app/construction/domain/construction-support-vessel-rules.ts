// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import { AeroEntity, JumpShipEntity, SmallCraftEntity, VehicleEntity } from '../../models/entity/entities';
import { AmmoEquipment, MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import type { EquipmentFlag } from '../../models/equipment-flags.type';
import type { EntityTransportBay, EntityValidationMessage } from '../../models/entity/types';
import { chassisEquipmentKind, type ChassisEquipmentKind } from '../../models/chassis-equipment.model';
import { isSupportVehicleBarArmor } from '../../models/construction-equipment.model';
import { isDroneOperatingSystemEquipment } from '../../models/drone-operating-system.model';
import { c3EquipmentTraits } from '../../models/c3-network.model';
import { supportEquipmentCrewContribution } from '../../models/support-equipment.model';
import { getNumCriticalSlots } from '../../models/entity/utils/equipment-helpers';
import { isQuartersBay } from '../../models/entity/bays/bay-definitions';
import { calculateSpacecraftEquipmentCrew, calculateSpacecraftRequiredGunners, calculateTransportBayPersonnel } from '../../models/entity/utils/crew-requirements';
import { calculateSmallCraftMinimumHeatSinks } from '../../models/entity/utils/weight/small-craft-weight';
import { calculateAdvancedAerospaceMinimumHeatSinks } from '../../models/entity/utils/weight/advanced-aerospace-weight';

type Support = BaseEntity & { structuralTechRating(): number; fuel(): number };
const has = (entity: BaseEntity, flag: EquipmentFlag) => entity.equipment().some(mount => mount.equipment?.hasFlag(flag));
const crewQuarters = new Set(['first-class-quarters', 'second-class-quarters', 'crew-quarters', 'steerage-quarters']);
const seatTypes = new Set(['standard-seats', 'pillion-seats', 'ejection-seats']);
const facilityTypes = new Set(['drop-shuttle', 'naval-repair', 'reinforced-repair']);
const bays = (entity: BaseEntity) => entity.transporters().filter((item): item is EntityTransportBay => item.kind === 'bay');

/** Compute.getFullCrewSize/getSVBaseCrewNeeds, including fire-control and command staff. */
export function constructionSupportCrew(entity: Support): number {
  if (entity.equipment().some(mount => isDroneOperatingSystemEquipment(mount.equipment))) return 0;
  const small = entity.weightClass() === 'Small Support';
  const marine = ['Naval', 'Hydrofoil', 'Submarine'].includes(entity.motiveType());
  const airship = entity.motiveType() === 'Airship';
  const unpoweredTrailer = entity instanceof VehicleEntity && entity.effectiveIsTrailer() && entity.mountedEngine().type() === 'None';
  let base = unpoweredTrailer ? 0 : small ? 1 : entity.weightClass() === 'Medium Support' ? marine || airship ? 4 : 2
    : 3 + (marine ? Math.ceil(entity.tonnage() / 5000) : airship ? Math.ceil(entity.tonnage() / 500) : 0);
  const weapons = entity.equipment().filter(mount => mount.equipment instanceof WeaponEquipment && !mount.equipment.isInternalRepresentation);
  const advanced = has(entity, 'F_ADVANCED_FIRE_CONTROL'), basic = has(entity, 'F_BASIC_FIRE_CONTROL');
  if (small) {
    base += advanced || basic ? Math.max(0, new Set(weapons.map(mount => `${mount.location}:${mount.turretType === 'pintle'}`)).size - Number(advanced)) : weapons.length;
  } else {
    const tons = weapons.filter(mount => !mount.equipment?.hasFlag('F_AMS')).reduce((sum, mount) => sum + (mount.getTonnage(entity) ?? 0), 0);
    const divisor = advanced ? entity.structuralTechRating() >= 5 ? 6 : entity.structuralTechRating() === 4 ? 5 : 4 : basic ? 3 : 2;
    base += Math.ceil(tons / divisor);
  }
  base += entity.equipment().reduce((sum, mount) => sum + supportEquipmentCrewContribution(entity, mount), 0);
  if (entity instanceof VehicleEntity) base += entity.extraSeats();
  return base < 4 ? base : base + Math.ceil(base / 6);
}

/** TestSupportVehicle: ammunition groups, all JJs, and excess quarters reserve distinct item slots. */
export function constructionSupportSlots(entity: Support): { used: number; capacity: number } {
  let used = 0;
  const ammo = new Set<string>();
  let jumpJets = false;
  for (const mount of entity.equipment()) {
    const eq = mount.equipment;
    if (!eq || eq.type === 'armor' || eq.type === 'structure' || eq.isInternalRepresentation) continue;
    if (eq instanceof AmmoEquipment) {
      if (entity.weightClass() !== 'Small Support') ammo.add(`${eq.ammoType}:${eq.rackSize}`);
    } else if (eq.hasFlag('F_JUMP_JET')) jumpJets = true;
    else used += getNumCriticalSlots(entity, eq, mount.size ?? 1) ?? 0;
  }
  used += ammo.size + Number(jumpJets);
  const armor = entity.uniformArmor();
  used += armor ? getNumCriticalSlots(entity, armor.armor) ?? 0
    : [...entity.armorByLocation().values()].reduce((sum, material) => sum + material.armor.patchworkSlotsMekSV, 0);
  const quarters = new Map<string, number>();
  for (const bay of bays(entity)) {
    if (!isQuartersBay(bay)) used++;
    if (crewQuarters.has(bay.configuration.type)) quarters.set(bay.configuration.type, (quarters.get(bay.configuration.type) ?? 0) + Math.trunc(bay.capacity));
  }
  if (entity.transporters().some(item => item.kind === 'troop-space')) used++;
  let extra = Math.max(0, (quarters.get('first-class-quarters') ?? 0) + (quarters.get('crew-quarters') ?? 0) + (quarters.get('steerage-quarters') ?? 0) - constructionSupportCrew(entity));
  used += Math.ceil((quarters.get('second-class-quarters') ?? 0) / 20);
  for (const [type, perSlot] of [['steerage-quarters', 50], ['crew-quarters', 20], ['first-class-quarters', 5]] as const) {
    const count = Math.min(extra, quarters.get(type) ?? 0);
    used += Math.ceil(count / perSlot); extra -= count;
  }
  return { used, capacity: 5 + Math.floor(entity.tonnage() / 10) };
}

/** Compact data form of TestSupportVehicle.ChassisModification.allowedTypes. */
const modModes: Partial<Record<ChassisEquipmentKind, readonly string[]>> = {
  bicycle: ['Hover', 'Wheeled'], monocycle: ['Hover', 'Wheeled'], convertible: ['Hover', 'Wheeled', 'Tracked'],
  'dune-buggy': ['Wheeled'], 'external-power-pickup': ['Rail', 'MagLev'], hydrofoil: ['Naval', 'Hydrofoil', 'Submarine'],
  'off-road': ['Wheeled'], propeller: ['Aerodyne'], snowmobile: ['Wheeled', 'Tracked'], stol: ['Aerodyne'],
  submersible: ['Naval', 'Hydrofoil', 'Submarine'], tractor: ['Wheeled', 'Tracked', 'Naval', 'Hydrofoil', 'Submarine', 'Rail', 'MagLev'],
  trailer: ['Wheeled', 'Tracked', 'Rail', 'MagLev'], vstol: ['Aerodyne'],
};
const incompatibleMods: readonly (readonly [ChassisEquipmentKind, ChassisEquipmentKind])[] = [
  ['armored-chassis', 'ultra-light'], ['bicycle', 'monocycle'], ['snowmobile', 'dune-buggy'],
  ['snowmobile', 'amphibious'], ['snowmobile', 'off-road'], ['dune-buggy', 'amphibious'], ['dune-buggy', 'off-road'],
];

export function constructionSupportVesselMessages(entity: BaseEntity): EntityValidationMessage[] {
  const messages: EntityValidationMessage[] = [];
  const add = (code: string, message: string, category: EntityValidationMessage['category'] = 'equipment', location?: string) => messages.push({ code, message, category, location, severity: 'error' });
  if (entity.isSupportVehicle()) {
    const small = entity.weightClass() === 'Small Support', mode = entity.motiveType();
    const engine = entity.mountedEngine().type();
    const mods = new Set(entity.equipment().filter(mount => mount.equipment?.hasFlag('F_CHASSIS_MODIFICATION')).map(mount => chassisEquipmentKind(mount.equipment)));
    for (const mod of mods) {
      if (!mod) continue;
      if (modModes[mod] && !modModes[mod]!.includes(mode)) add('SUPPORT_MOD_MOTIVE', `${mod} chassis modification is incompatible with ${mode}.`);
      if ((mod === 'amphibious' && ['Hover', 'Naval', 'Hydrofoil', 'Submarine'].includes(mode)) || (mod === 'armored-chassis' && mode === 'Airship')) add('SUPPORT_MOD_MOTIVE', `${mod} chassis modification is incompatible with ${mode}.`);
      if (['bicycle', 'monocycle', 'ultra-light'].includes(mod) && !small) add('SUPPORT_MOD_SIZE', `${mod} requires a small support vehicle.`);
    }
    for (const [first, second] of incompatibleMods) if (mods.has(first) && mods.has(second)) add('SUPPORT_MOD_CONFLICT', `${first} and ${second} chassis modifications cannot be combined.`);
    if (mods.has('hydrofoil') && entity.tonnage() > 100) add('SUPPORT_HYDROFOIL_WEIGHT', 'Hydrofoil chassis modification requires a vehicle of at most 100 tons.', 'weight');
    if (mods.has('convertible') && entity instanceof VehicleEntity && entity.hasTurret()) add('SUPPORT_CONVERTIBLE_TURRET', 'Convertible support vehicles cannot have a turret.');
    if ((engine === 'External') !== mods.has('external-power-pickup')) add('SUPPORT_EXTERNAL_POWER', 'External engines and external power pickup chassis modification require each other.', 'engine');
    if (entity instanceof AeroEntity && ['Battery', 'Fuel Cell', 'Solar', 'External'].includes(engine) && !mods.has('propeller')) add('SUPPORT_ELECTRIC_PROPELLER', 'Electric aerospace support engines require the propeller chassis modification.', 'engine');
    const engineModes: Record<string, readonly string[]> = {
      Steam: ['Wheeled', 'Tracked', 'Airship', 'Naval', 'Hydrofoil', 'Submarine', 'Rail', 'MagLev'],
      Solar: ['Wheeled', 'Tracked', 'Airship', 'Aerodyne', 'Naval', 'Hydrofoil', 'Submarine', 'WiGE', 'Station Keeping'],
      Maglev: ['Rail', 'MagLev'], External: ['Rail', 'MagLev'], None: ['Wheeled', 'Tracked', 'Rail', 'MagLev'],
    };
    if (['XL', 'XXL', 'Light', 'Compact'].includes(engine) || engineModes[engine] && !engineModes[engine].includes(mode) || engine === 'ICE' && mode === 'Station Keeping') add('SUPPORT_ENGINE_TYPE', `${engine} is not a legal engine for this support vehicle.`, 'engine');
    if (engine === 'None' && entity.originalWalkMP() !== 0) add('SUPPORT_UNPOWERED_MOVEMENT', 'An unpowered vehicle must have zero cruise MP.', 'movement');
    const requiresFuel = entity instanceof AeroEntity
      ? !((mods.has('propeller') || mode === 'Airship') && ['Fusion', 'Fission', 'Solar'].includes(engine))
      : ['Steam', 'ICE', 'Battery', 'Fuel Cell'].includes(engine);
    if (requiresFuel && engine !== 'None' && entity.fuel() <= 0) add('SUPPORT_FUEL_REQUIRED', 'This powered support vehicle requires fuel allocation.', 'engine');
    for (const [location, material] of entity.armorByLocation()) {
      const armor = material.armor, bar = isSupportVehicleBarArmor(armor);
      const rating = material.techRating ?? ['A', 'B', 'C', 'D', 'E', 'F'][entity.structuralTechRating()];
      const perPoint = armor.weightPerPointSV[rating] ?? armor.weightPerPoint;
      if (!mods.has('armored-chassis') && (!bar || perPoint > 0.05)) add('SUPPORT_ARMORED_CHASSIS_REQUIRED', 'Advanced armor or armor heavier than 50 kg per point requires the armored chassis modification.', 'armor', location);
      if (bar && (armor.bar < 2 || armor.bar > 10 || perPoint < 0.001)) add('SUPPORT_BAR_TECH', 'BAR armor must be 2–10 and supported by its armor tech rating.', 'armor', location);
    }
    if (['armored-chassis', 'amphibious', 'environmental-sealing', 'submersible'].some(mod => mods.has(mod as ChassisEquipmentKind))) {
      if (entity.armorLocations.some(location => (entity.armorValues().get(location)?.front ?? 0) < 1)) add('SUPPORT_SEALED_ARMOR', 'This chassis modification requires armor on every armored facing.', 'armor');
    }
    const budget = constructionSupportSlots(entity);
    if (budget.used > budget.capacity) add('SUPPORT_EQUIPMENT_SLOTS', `Support vehicle uses ${budget.used} of ${budget.capacity} equipment slots.`, 'crit');
    const advanced = has(entity, 'F_ADVANCED_FIRE_CONTROL'), basic = has(entity, 'F_BASIC_FIRE_CONTROL');
    if (!advanced && entity.equipment().some(mount => mount.equipment && c3EquipmentTraits(mount.equipment.flags).networkTypes.length > 0)) add('SUPPORT_C3_FIRE_CONTROL', 'C3 equipment requires advanced fire control.');
    if (entity.omni() && (advanced || basic) && entity.baseChassisFireConWeight() >= 0) {
      const tons = entity.equipment().filter(mount => mount.equipment instanceof WeaponEquipment).reduce((sum, mount) => sum + (mount.getTonnage(entity) ?? 0), 0);
      if (tons / 10 > entity.baseChassisFireConWeight()) add('SUPPORT_OMNI_FIRE_CONTROL', 'Weapons exceed the base chassis fire-control mass capacity.');
    }
    const sponson = has(entity, 'F_SPONSON_TURRET') || entity.equipment().some(mount => mount.turretType === 'sponson');
    const pintle = has(entity, 'F_PINTLE_TURRET') || entity.equipment().some(mount => mount.turretType === 'pintle');
    if (sponson && (small || ['Aerodyne', 'Airship', 'Station Keeping'].includes(mode))) add('SUPPORT_SPONSON_SIZE', 'Sponson turrets require a medium or large surface support vehicle.');
    if (sponson && entity.jumpMP() > 0) add('SUPPORT_SPONSON_JUMP', 'Support vehicles cannot combine sponson turrets with jump jets.');
    if (pintle && (!small || ['Aerodyne', 'Naval', 'Hydrofoil', 'Submarine'].includes(mode))) add('SUPPORT_PINTLE_SIZE', 'Pintle turrets require a small support vehicle with a compatible movement type.');
    if (entity.equipment().filter(mount => mount.equipment?.hasFlag('F_EXTERNAL_STORES_HARDPOINT')).length > entity.tonnage() / 10) add('SUPPORT_HARDPOINT_LIMIT', 'At most one external stores hardpoint is permitted per ten tons.');
    for (const location of entity.validLocations) if (entity.getEquipmentAtLocation(location).filter(mount => mount.equipment?.hasFlag('F_MANIPULATOR')).length > 2) add('SUPPORT_MANIPULATOR_LIMIT', 'At most two manipulators are allowed per location.', 'equipment', location);
    if (small) {
      const seating = bays(entity).filter(bay => seatTypes.has(bay.configuration.type)).reduce((sum, bay) => sum + Math.trunc(bay.capacity), 0);
      const required = constructionSupportCrew(entity);
      if (seating < required) add('SUPPORT_CREW_SEATING', `This vehicle requires ${required} crew seats; ${seating} are provided.`, 'general');
    }
  }
  if (entity instanceof AeroEntity) validateVesselDoors(entity, add);
  if (entity instanceof SmallCraftEntity || entity instanceof JumpShipEntity) validateVessel(entity, add);
  return messages;
}

type Add = (code: string, message: string, category?: EntityValidationMessage['category'], location?: string) => void;
function validateVesselDoors(entity: AeroEntity, add: Add): void {
  const maximum = entity.entityType === 'WarShip' ? 8 + Math.ceil(entity.tonnage() / 100000)
    : entity.entityType === 'SpaceStation' ? 8 + Math.ceil(entity.tonnage() / 75000)
    : ['JumpShip', 'DropShip', 'FixedWingSupport'].includes(entity.entityType) ? 7 + Math.ceil(entity.tonnage() / 50000)
    : entity instanceof SmallCraftEntity ? entity.motiveType() === 'Spheroid' ? 4 : 2 : 0;
  let doors = 0;
  for (const bay of bays(entity)) {
    doors += bay.doors;
    const type = bay.configuration.type;
    const canBeDoorless = isQuartersBay(bay) || type.includes('cargo') || ['generic', 'infantry', 'battle-armor'].includes(type);
    if (!canBeDoorless && bay.doors < 1) add('BAY_DOOR_REQUIRED', `${type} bays require at least one door.`);
  }
  if (doors > maximum) add('VESSEL_BAY_DOOR_LIMIT', `This craft permits at most ${maximum} bay doors; ${doors} are fitted.`);
}

function validateVessel(entity: SmallCraftEntity | JumpShipEntity, add: Add): void {
  const jump = entity instanceof JumpShipEntity;
  const standardCrewApplies = jump || entity.tonnage() > 25;
  if (standardCrewApplies) {
    const base = jump ? ['WarShip', 'SpaceStation'].includes(entity.entityType) ? 45 + Math.ceil(entity.tonnage() / 5000) : 6 + Math.ceil(entity.tonnage() / 20000)
      : 3 + (entity.entityType === 'DropShip' ? Math.ceil(entity.tonnage() / 5000) + Number(entity.designType() === 'Military') : 0);
    const required = base + calculateSpacecraftEquipmentCrew(entity) + calculateSpacecraftRequiredGunners(entity);
    const aboard = entity.crew() - calculateTransportBayPersonnel(entity);
    if (aboard < required) add('VESSEL_CREW_MINIMUM', `This craft requires ${required} vessel crew, excluding bay personnel; ${aboard} are assigned.`, 'general');
    const officers = Math.ceil(required / (jump ? 6 : 5));
    if (entity.officers() < officers) add('VESSEL_OFFICER_MINIMUM', `At least ${officers} officers are required.`, 'general');
    const occupants = aboard + entity.passengers() + entity.marines() + entity.battleArmor();
    const quarters = bays(entity).filter(bay => crewQuarters.has(bay.configuration.type)).reduce((sum, bay) => sum + Math.trunc(bay.capacity), 0);
    if (quarters < occupants) add('VESSEL_QUARTERS_MINIMUM', `Quarters accommodate ${quarters} of ${occupants} crew and passengers.`, 'general');
  }
  const freeSinks = jump ? calculateAdvancedAerospaceMinimumHeatSinks(entity) : calculateSmallCraftMinimumHeatSinks(entity);
  if (entity.heatSinkCount() < freeSinks) add('VESSEL_ENGINE_HEAT_SINKS', `The engine requires at least ${freeSinks} heat sinks.`, 'heat');
  if (!jump) {
    const drop = entity.entityType === 'DropShip';
    const spheroid = entity.motiveType() === 'Spheroid';
    const primitive = entity.uniformArmor()?.type === 'PRIMITIVE_AERO';
    const caps = [[2130, 3000, 1000], [2150, 4000, 1500], [2165, 7000, 2500], [2175, 10000, 3000], [2200, 14000, 5000], [2250, 15000, 6000], [2300, 19000, 7000], [2350, 23000, 8000], [2425, 30000, 10000], [Infinity, 50000, 20000]];
    const primitiveCap = caps.find(row => entity.year() < row[0])!;
    const maximum = !drop ? 200 : primitive ? primitiveCap[spheroid ? 1 : 2] : spheroid ? 100000 : 35000;
    if (entity.tonnage() > maximum) add('VESSEL_MAX_TONNAGE', `This vessel permits at most ${maximum} tons.`, 'weight');
    return;
  }
  const core = entity.driveCoreType();
  const [minimum, increment] = core === 'Compact' ? [100000, 10000] : core === 'Subcompact' ? [5000, 100] : core === 'None' ? [2000, 500] : [50000, 1000];
  const maximum = core === 'Subcompact' ? 25000 : core === 'Primitive' ? primitiveJumpShipMaximum(entity) : entity.entityType === 'JumpShip' ? 500000 : 2500000;
  if (entity.tonnage() < minimum || entity.tonnage() > maximum || entity.tonnage() % increment !== 0) add('VESSEL_DRIVE_TONNAGE', `${core} drive vessels require ${minimum}–${maximum} tons in ${increment}-ton increments.`, 'weight');
  if ((entity.entityType === 'SpaceStation' && core !== 'None') || (entity.entityType === 'JumpShip' && !['Standard', 'Primitive'].includes(core))) add('VESSEL_DRIVE_FAMILY', 'Drive core type is incompatible with this vessel family.', 'engine');
  if (core === 'Primitive' && (entity.jumpRange() < 15 || entity.jumpRange() > 30 || !Number.isInteger(entity.jumpRange()))) add('VESSEL_PRIMITIVE_RANGE', 'Primitive jump range must be 15–30 whole light-years.', 'engine');
  if (entity.entityType === 'JumpShip' || entity.entityType === 'SpaceStation' || entity.originalWalkMP() === 0) {
    if (entity.structuralIntegrity() !== 1) add('VESSEL_FIXED_SI', 'This vessel configuration requires structural integrity 1.', 'structure');
  } else if (entity.structuralIntegrity() < entity.runMP() || entity.structuralIntegrity() > entity.runMP() * 30) add('VESSEL_SI_THRUST', 'Structural integrity must be between maximum thrust and thirty times maximum thrust.', 'structure');
  const maxDecks = 3 + Math.ceil(entity.tonnage() / 100000), maxDiameter = entity.entityType === 'SpaceStation' ? 1500 : 250;
  if (entity.gravDecks().length > maxDecks) add('VESSEL_GRAV_DECK_COUNT', `At most ${maxDecks} gravity decks are permitted.`);
  if (entity.gravDecks().some(diameter => !Number.isInteger(diameter) || diameter <= 0 || diameter > maxDiameter)) add('VESSEL_GRAV_DECK_DIAMETER', `Gravity decks require whole diameters of 1–${maxDiameter} meters.`);
  const facilities = bays(entity).filter(bay => facilityTypes.has(bay.configuration.type));
  const hardpoints = entity.tonnage() < 50000 ? 0 : Math.max(0, Math.ceil(entity.tonnage() / 50000) - facilities.length * 2);
  if (entity.dockingCollarCount() > hardpoints) add('VESSEL_DOCKING_HARDPOINTS', `This vessel has capacity for ${hardpoints} docking collars after repair and shuttle facilities.`);
  const facings = new Set<number>();
  for (const facility of facilities) {
    const facing = 'facing' in facility.configuration ? facility.configuration.facing : -1;
    if (facing === undefined || facing < 0 || facing > 5 || facings.has(facing)) add('VESSEL_FACILITY_FACING', 'Repair facilities and shuttle bays need distinct armor facings from 0 to 5.');
    if (facing !== undefined) facings.add(facing);
  }
  const balance = new Map<string, number>(), massDrivers = new Map<string, number>();
  for (const mount of entity.equipment()) if (mount.equipment instanceof WeaponEquipment && !mount.equipment.isInternalRepresentation) {
    const eq = mount.equipment;
    const pairs = [['FLS', 'FRS'], ['ALS', 'ARS'], ['LBS', 'RBS']];
    for (const [left, right] of pairs) if (mount.location === left || mount.location === right) {
      const key = `${left}:${eq.id}:${mount.rearMounted}`;
      balance.set(key, (balance.get(key) ?? 0) + (mount.location === left ? 1 : -1));
    }
    if (eq.hasFlag('F_MASS_DRIVER')) {
      massDrivers.set(mount.location, (massDrivers.get(mount.location) ?? 0) + 1);
      if (entity.entityType === 'JumpShip' || entity.entityType === 'WarShip' && mount.location !== 'Nose') add('VESSEL_MASS_DRIVER_ARC', 'Mass drivers require a station facing or a WarShip nose.', 'equipment', mount.location);
      const weight = ({ HMASS: 2000000, MMASS: 1500000, LMASS: 750000 } as Record<string, number>)[eq.ammoType] ?? 0;
      if (entity.tonnage() < weight) add('VESSEL_MASS_DRIVER_TONNAGE', `${eq.name} requires a vessel of at least ${weight} tons.`, 'weight');
    }
  }
  if ([...balance.values()].some(value => value !== 0)) add('VESSEL_LATERAL_WEAPONS', 'Port and starboard weapon complements must match in each corresponding arc.');
  if ([...massDrivers.values()].some(count => count > 1)) add('VESSEL_MASS_DRIVER_COUNT', 'At most one mass driver is permitted in a firing arc.');
}

function primitiveJumpShipMaximum(entity: JumpShipEntity): number {
  const year = entity.year(), faction = entity.faction();
  if (['TA', 'TH', 'None'].includes(faction)) return year < 2130 ? 100000 : year < 2150 ? 150000 : year < 2165 ? 200000 : year < 2175 ? 250000 : year < 2200 ? 350000 : year < 2300 ? 500000 : year < 2350 ? 1000000 : year < 2400 ? 1600000 : 1800000;
  if (['CC', 'DC', 'FS', 'FW', 'LC'].includes(faction)) return year < 2300 ? 350000 : year < 2350 ? 600000 : year < 2400 ? 800000 : 1000000;
  return year < 2300 ? 300000 : year < 2350 ? 450000 : year < 2400 ? 600000 : 1000000;
}
