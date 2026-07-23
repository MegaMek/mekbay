import { AmmoEquipment, ArmorEquipment, MiscEquipment, StructureEquipment, WeaponEquipment } from '../../../equipment.model';
import { getBayConstructionWeight, isQuartersBay } from '../../bays/bay-definitions';
import type { SmallCraftEntity } from '../../entities/aero/small-craft-entity';
import { ceilToHalfTon, ceilToWholeTon } from './weight-rounding';

const SYSTEM_FLAGS = [
  'F_FERRO_ALUMINUM', 'F_FERRO_ALUMINUM_PROTO', 'F_LIGHT_FERRO', 'F_HEAVY_FERRO',
  'F_REACTIVE', 'F_REFLECTIVE', 'F_HARDENED_ARMOR', 'F_PRIMITIVE_ARMOR',
  'F_HEAT_SINK', 'F_DOUBLE_HEAT_SINK', 'F_IS_DOUBLE_HEAT_SINK_PROTOTYPE',
] as const;
const ALL_CRAFT_SLOT_FLAGS = ['F_CHAFF_POD', 'F_SPACE_MINE_DISPENSER', 'F_MOBILE_HPG',
  'F_RECON_CAMERA', 'F_HIRES_IMAGER', 'F_HYPERSPECTRAL_IMAGER', 'F_INFRARED_IMAGER',
  'F_LOOKDOWN_RADAR'] as const;
const SMALL_CRAFT_SLOT_FLAGS = ['F_BAP', 'F_WATCHDOG', 'F_ECM', 'F_ANGEL_ECM',
  'F_EW_EQUIPMENT', 'F_BOOBY_TRAP', 'F_SENSOR_DISPENSER'] as const;

export interface SmallCraftWeightBreakdown {
  readonly structure: number; readonly engine: number; readonly controls: number;
  readonly fuel: number; readonly heatSinks: number; readonly armor: number;
  readonly systems: number; readonly miscellaneous: number; readonly weapons: number;
  readonly ammo: number; readonly carryingSpace: number; readonly quarters: number;
  readonly exact: number; readonly rounded: number;
}

export function calculateSmallCraftEffectiveTonnage(entity: SmallCraftEntity): number {
  return calculateSmallCraftWeightBreakdown(entity).rounded;
}

export function calculateSmallCraftWeightBreakdown(entity: SmallCraftEntity): SmallCraftWeightBreakdown {
  const dropShip = entity.entityType === 'DropShip';
  const spheroid = entity.motiveType() === 'Spheroid';
  const primitive = entity.uniformArmor()?.type === 'PRIMITIVE_AERO';
  const year = entity.effectiveOriginalBuildYear();
  const structure = ceilToHalfTon(entity.structuralIntegrity() * entity.tonnage() / (spheroid ? 500 : 200));
  const engineMultiplier = entity.techBase() === 'Clan' ? 0.061
    : dropShip ? dropShipEngineMultiplier(year) : smallCraftEngineMultiplier(year);
  const engine = ceilToHalfTon(entity.tonnage() * entity.originalWalkMP() * engineMultiplier);
  const controlYear = primitive ? year : 2500;
  const controlsRaw = entity.tonnage() * (dropShip
    ? dropShipControlMultiplier(controlYear)
    : smallCraftControlMultiplier(controlYear));
  const controls = dropShip ? ceilToWholeTon(controlsRaw) : ceilToHalfTon(controlsRaw);
  const baseFuelPpt = dropShip ? dropShipFuelPointsPerTon(entity.tonnage()) : 80;
  const primitiveFactor = primitive
    ? dropShip ? dropShipPrimitiveFactor(year) : smallCraftPrimitiveFactor(year)
    : 1;
  const fuelTonnage = Math.round(2 * entity.fuel() / (baseFuelPpt / primitiveFactor)) / 2;
  const fuel = ceilToHalfTon(fuelTonnage * 1.02);
  let freeHeatSinks: number;
  if (spheroid) {
    freeHeatSinks = Math.floor(Math.sqrt(engine * (primitive ? 1.3 : dropShip && entity.designType() === 'Military' ? 6.8 : 1.6)));
  } else {
    freeHeatSinks = Math.floor(engine / (primitive ? 75 : dropShip && entity.designType() === 'Military' ? 20 : 60));
  }
  const heatSinks = Math.max(0, entity.heatSinkCount() - freeHeatSinks);
  const armor = calculateArmorWeight(entity, primitive, spheroid);
  const systems = 7 * (entity.lifeboats() + entity.escapePods()) + calculateExtraSlotWeight(entity);
  let miscellaneous = 0, weapons = 0, ammo = 0;
  for (const mount of entity.equipment()) {
    const equipment = mount.equipment;
    if (!equipment) throw new Error(`Unresolved equipment ${mount.equipmentId} on ${entity.displayName()}`);
    if (equipment instanceof ArmorEquipment || equipment instanceof StructureEquipment) continue;
    if (equipment instanceof AmmoEquipment) {
      if (mount.location !== 'Unallocated' && mount.location !== 'None') {
        const bins = Math.ceil((mount.getAmmoShots() ?? equipment.shots) / equipment.shots);
        ammo += requireTonnage(entity, mount) * bins;
      }
    } else if (equipment instanceof WeaponEquipment) {
      weapons += requireTonnage(entity, mount);
    } else if (equipment instanceof MiscEquipment && !equipment.hasAnyFlag([...SYSTEM_FLAGS])) {
      miscellaneous += requireTonnage(entity, mount);
    }
  }
  let carryingSpace = 0, quarters = 0;
  for (const transporter of entity.transporters()) {
    if (transporter.kind === 'troop-space') carryingSpace += transporter.totalSpace;
    else if (transporter.kind === 'bay') {
      const value = getBayConstructionWeight(transporter);
      if (isQuartersBay(transporter)) quarters += value;
      else carryingSpace += value;
    }
  }
  const exact = structure + engine + controls + fuel + heatSinks + armor + systems
    + miscellaneous + weapons + ammo + carryingSpace + quarters;
  return { structure, engine, controls, fuel, heatSinks, armor, systems, miscellaneous,
    weapons, ammo, carryingSpace, quarters, exact, rounded: ceilToHalfTon(exact) };
}

function calculateExtraSlotWeight(entity: SmallCraftEntity): number {
  const dropShip = entity.entityType === 'DropShip';
  const spheroid = entity.motiveType() === 'Spheroid';
  const arcs = new Map<string, { count: number; tonnage: number }>();
  for (const mount of entity.equipment()) {
    const equipment = mount.equipment;
    if (!equipment || mount.location === 'Unallocated' || mount.location === 'None') continue;
    const usesSlot = equipment instanceof WeaponEquipment
      || equipment instanceof MiscEquipment && (equipment.hasAnyFlag([...ALL_CRAFT_SLOT_FLAGS])
        || !dropShip && equipment.hasAnyFlag([...SMALL_CRAFT_SLOT_FLAGS]));
    if (!usesSlot) continue;
    let arc = mount.location;
    if (spheroid && mount.rearMounted && (arc === 'Left Side' || arc === 'Right Side')) arc += ' Aft';
    const current = arcs.get(arc) ?? { count: 0, tonnage: 0 };
    current.count++;
    current.tonnage += requireTonnage(entity, mount);
    arcs.set(arc, current);
  }
  const navalC3Multiplier = entity.equipment().some(mount => mount.equipment?.hasFlag('F_NAVAL_C3')) ? 2 : 1;
  let total = 0;
  for (const arc of arcs.values()) {
    const excessGroups = Math.trunc((arc.count - 1) / 12);
    if (excessGroups > 0) total += ceilToHalfTon(excessGroups * arc.tonnage / 10) * navalC3Multiplier;
  }
  return total;
}

function calculateArmorWeight(entity: SmallCraftEntity, primitive: boolean, spheroid: boolean): number {
  const armor = entity.uniformArmor()?.armor;
  if (!armor) return 0;
  let points = entity.totalArmorPoints();
  if (primitive) points = Math.ceil(points / 0.66);
  const weightedPoints = Math.max(0, points - 4 * entity.structuralIntegrity());
  let ppt = 16 * armor.pptMultiplier;
  if (armor.pptDropship.length) {
    const thresholds = spheroid ? [12500, 20000, 35000, 50000, 65000] : [6000, 9500, 12500, 17500, 25000];
    const index = thresholds.findIndex(value => entity.tonnage() < value);
    ppt = armor.pptDropship[index < 0 ? armor.pptDropship.length - 1 : Math.min(index, armor.pptDropship.length - 1)] ?? ppt;
  }
  return ceilToHalfTon(weightedPoints / ppt);
}
function smallCraftEngineMultiplier(y: number): number { return y >= 2500 ? .065 : y >= 2400 ? .078 : y >= 2300 ? .091 : y >= 2251 ? .0975 : y >= 2201 ? .1105 : y >= 2151 ? .1235 : .143; }
function dropShipEngineMultiplier(y: number): number { return y >= 2500 ? .065 : y >= 2351 ? .0715 : y >= 2300 ? .0845 : y >= 2251 ? .091 : y >= 2201 ? .1104 : y >= 2151 ? .117 : .13; }
function smallCraftControlMultiplier(y: number): number { return y >= 2500 ? .0075 : y >= 2400 ? .00825 : y >= 2300 ? .00975 : y >= 2251 ? .01125 : y >= 2201 ? .01275 : y >= 2151 ? .01245 : .01575; }
function dropShipControlMultiplier(y: number): number { return y >= 2500 ? .0075 : y >= 2351 ? .009 : y >= 2300 ? .00975 : y >= 2251 ? .0105 : y >= 2201 ? .012 : y >= 2151 ? .0135 : .015; }
function smallCraftPrimitiveFactor(y: number): number { return y >= 2500 ? 1 : y >= 2400 ? 1.2 : y >= 2300 ? 1.4 : y >= 2251 ? 1.5 : y >= 2201 ? 1.7 : y >= 2151 ? 1.9 : 2.2; }
function dropShipPrimitiveFactor(y: number): number { return y >= 2500 ? 1 : y >= 2400 ? 1.1 : y >= 2351 ? 1.3 : y >= 2251 ? 1.4 : y >= 2201 ? 1.6 : y >= 2151 ? 1.8 : 2; }
function dropShipFuelPointsPerTon(t: number): number { return t < 400 ? 80 : t < 800 ? 70 : t < 1200 ? 60 : t < 1900 ? 50 : t < 3000 ? 40 : t < 20000 ? 30 : t < 40000 ? 20 : 10; }
function requireTonnage(entity: SmallCraftEntity, mount: { equipmentId: string; getTonnage(owner: SmallCraftEntity): number | undefined }): number {
  const value = mount.getTonnage(entity);
  if (value === undefined) throw new Error(`Unable to calculate tonnage for ${mount.equipmentId} on ${entity.displayName()}`);
  return value;
}
