import { AmmoEquipment, ArmorEquipment, MiscEquipment, StructureEquipment, WeaponEquipment } from '../../../equipment.model';
import { isQuartersBay } from '../../bays/bay-definitions';
import type { FixedWingSupportEntity } from '../../entities/aero/fixed-wing-support-entity';
import type { TechRating } from '../../types';
import { calculateHeatNeutralRequirement, calculatePowerAmplifierWeight } from '../cost/common';
import { getEquipmentEngineWeight } from '../equipment-engine-weight';
import { ceilToHalfTon } from './weight-rounding';

const RATINGS: readonly TechRating[] = ['A', 'B', 'C', 'D', 'E', 'F'];
const STRUCTURE_MULTIPLIERS = [1.6, 1.3, 1.15, 1, 0.85, 0.66] as const;
const KG_PER_FUEL_POINT = [
  [50, 30, 23, 15, 13, 10],
  [63, 38, 25, 20, 18, 15],
  [83, 50, 35, 28, 23, 20],
] as const;
const CHASSIS_MODIFIERS: ReadonlyArray<readonly [string, number]> = [
  ['F_AMPHIBIOUS', 1.75], ['F_ARMORED_CHASSIS', 1.5], ['F_BICYCLE', 0.75],
  ['F_CONVERTIBLE', 1.1], ['F_DUNE_BUGGY', 1.5], ['F_ENVIRONMENTAL_SEALING', 2],
  ['F_EXTERNAL_POWER_PICKUP', 1.1], ['F_HYDROFOIL', 1.7], ['F_MONOCYCLE', 0.5],
  ['F_OFF_ROAD', 1.5], ['F_PROP', 1.2], ['F_SNOWMOBILE', 1.75],
  ['F_STOL_CHASSIS', 1.5], ['F_SUBMERSIBLE', 1.8], ['F_TRACTOR_MODIFICATION', 1.2],
  ['F_TRAILER_MODIFICATION', 0.8], ['F_ULTRA_LIGHT', 0.5], ['F_VSTOL_CHASSIS', 2],
];
const SYSTEM_FLAGS = [
  'F_BASIC_FIRE_CONTROL', 'F_ADVANCED_FIRE_CONTROL', 'F_CHASSIS_MODIFICATION',
  'F_FERRO_FIBROUS', 'F_FERRO_LAMELLOR', 'F_LIGHT_FERRO', 'F_HEAVY_FERRO',
  'F_REACTIVE', 'F_REFLECTIVE', 'F_HARDENED_ARMOR', 'F_HEAT_SINK', 'F_DOUBLE_HEAT_SINK',
] as const;

export interface FixedWingSupportWeightBreakdown {
  readonly engine: number; readonly structure: number; readonly controls: number;
  readonly heatSinks: number; readonly armor: number; readonly miscellaneous: number;
  readonly weapons: number; readonly ammo: number; readonly powerAmplifiers: number;
  readonly carryingSpace: number; readonly fuel: number; readonly exact: number; readonly rounded: number;
}

export function calculateFixedWingSupportEffectiveTonnage(entity: FixedWingSupportEntity): number {
  return calculateFixedWingSupportWeightBreakdown(entity).rounded;
}

export function calculateFixedWingSupportWeightBreakdown(entity: FixedWingSupportEntity): FixedWingSupportWeightBreakdown {
  const small = entity.weightClass() === 'Small Support';
  const engine = getEquipmentEngineWeight(entity);
  let structureModifier = 1;
  for (const [flag, multiplier] of CHASSIS_MODIFIERS) {
    if (entity.equipment().some(mount => mount.equipment?.hasFlag(flag))) structureModifier *= multiplier;
  }
  const chassisFactor = entity.tonnage() < 5 ? 0.08 : entity.tonnage() <= 100 ? 0.1 : 0.15;
  const structureRaw = entity.tonnage() * chassisFactor
    * (STRUCTURE_MULTIPLIERS[entity.structuralTechRating()] ?? 1) * structureModifier;
  const structure = small ? ceilKg(structureRaw) : ceilToHalfTon(structureRaw);
  const controls = roundKg(entity.transporters().reduce((total, transporter) => {
    if (transporter.kind !== 'bay' || !isQuartersBay(transporter)) return total;
    if (transporter.constructionWeight !== undefined) return total + transporter.constructionWeight;
    if (transporter.configuration.type === 'pillion-seats') return total + transporter.capacity * 0.025;
    if (transporter.configuration.type === 'standard-seats') return total + transporter.capacity * 0.075;
    if (transporter.configuration.type === 'ejection-seats') return total + transporter.capacity * 0.1;
    return total + transporter.capacity;
  }, 0));
  const heatSinks = small ? 0 : calculateHeatNeutralRequirement(entity);
  const armor = calculateArmor(entity);
  let miscellaneous = 0, weapons = 0, ammo = 0;
  for (const mount of entity.equipment()) {
    const equipment = mount.equipment;
    if (!equipment) throw new Error(`Unresolved equipment ${mount.equipmentId} on ${entity.displayName()}`);
    if (equipment instanceof ArmorEquipment || equipment instanceof StructureEquipment) continue;
    if (equipment instanceof AmmoEquipment) {
      if (!small && mount.location !== 'None' && !equipment.hasFlag('F_BOMB')) ammo += requireTonnage(entity, mount);
    } else if (equipment instanceof WeaponEquipment) {
      if (!equipment.hasFlag('F_BOMB')) weapons += requireTonnage(entity, mount);
    } else if (equipment instanceof MiscEquipment && !equipment.hasAnyFlag([...SYSTEM_FLAGS])) {
      miscellaneous += requireTonnage(entity, mount);
    }
  }
  const powerAmplifiers = calculatePowerAmplifierWeight(entity);
  const carryingSpace = entity.transporters().reduce((total, transporter) => {
    if (transporter.kind === 'troop-space') return total + transporter.totalSpace;
    if (transporter.kind !== 'bay' || isQuartersBay(transporter)) return total;
    return total + (transporter.constructionWeight ?? transporter.capacity);
  }, 0);
  const prop = entity.equipment().some(mount => mount.equipment?.hasFlag('F_PROP'));
  const fuelFree = (prop || entity.motiveType() === 'Airship')
    && (entity.mountedEngine().isFusion || entity.mountedEngine().isFission
      || entity.mountedEngine().descriptor().powerSource === 'solar');
  const classIndex = small ? 0 : entity.weightClass() === 'Large Support' ? 2 : 1;
  let kgPerFuelPoint = fuelFree ? 0 : KG_PER_FUEL_POINT[classIndex][entity.engineTechRating()] ?? 0;
  if (kgPerFuelPoint && (prop || entity.motiveType() === 'Airship')) kgPerFuelPoint = Math.ceil(kgPerFuelPoint * 0.75);
  const fuelRaw = entity.fuel() * kgPerFuelPoint / 1000;
  const fuel = small ? ceilKg(fuelRaw) : ceilToHalfTon(fuelRaw);
  const exact = engine + structure + controls + heatSinks + armor + miscellaneous + weapons + ammo
    + powerAmplifiers + carryingSpace + fuel;
  return { engine, structure, controls, heatSinks, armor, miscellaneous, weapons, ammo,
    powerAmplifiers, carryingSpace, fuel, exact, rounded: small ? ceilKg(exact) : ceilToHalfTon(exact) };
}

function calculateArmor(entity: FixedWingSupportEntity): number {
  const mounted = entity.uniformArmor();
  if (!mounted) return 0;
  const raw = mounted.armor.hasFlag('F_SUPPORT_VEE_BAR_ARMOR')
    ? entity.totalArmorPoints() * (mounted.armor.weightPerPointSV[mounted.techRating ?? RATINGS[entity.structuralTechRating()] ?? 'A'] ?? mounted.armor.weightPerPoint)
    : entity.totalArmorPoints() / (16 * mounted.armor.pptMultiplier);
  return entity.weightClass() === 'Small Support' ? ceilKg(raw) : ceilToHalfTon(raw);
}
function requireTonnage(entity: FixedWingSupportEntity, mount: { equipmentId: string; getTonnage(owner: FixedWingSupportEntity): number | undefined }): number {
  const value = mount.getTonnage(entity);
  if (value === undefined) throw new Error(`Unable to calculate tonnage for ${mount.equipmentId} on ${entity.displayName()}`);
  return value;
}
function roundKg(value: number): number { return Math.round(value * 1000) / 1000; }
function ceilKg(value: number): number { return Math.ceil(Math.round(value * 1_000_000) / 1000) / 1000; }
