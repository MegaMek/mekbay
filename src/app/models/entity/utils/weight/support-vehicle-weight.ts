import { AmmoEquipment, ArmorEquipment, MiscEquipment, StructureEquipment, WeaponEquipment } from '../../../equipment.model';
import { isQuartersBay } from '../../bays/bay-definitions';
import type { SupportVehicle } from '../../entities/support-vehicle';
import type { VehicleEntity } from '../../entities/vehicle/vehicle-entity';
import type { TechRating } from '../../types';
import { calculateHeatNeutralRequirement, calculatePowerAmplifierWeight } from '../cost/common';
import { getEquipmentEngineWeight } from '../equipment-engine-weight';
import { ceilToHalfTon } from './weight-rounding';

const TECH_RATINGS: readonly TechRating[] = ['A', 'B', 'C', 'D', 'E', 'F'];
const STRUCTURAL_RATING_MULTIPLIERS = [1.6, 1.3, 1.15, 1, 0.85, 0.66] as const;
const CHASSIS_MODIFIERS: ReadonlyArray<readonly [string, number]> = [
  ['F_AMPHIBIOUS', 1.75], ['F_ARMORED_CHASSIS', 1.5], ['F_BICYCLE', 0.75],
  ['F_CONVERTIBLE', 1.1], ['F_DUNE_BUGGY', 1.5], ['F_ENVIRONMENTAL_SEALING', 2],
  ['F_EXTERNAL_POWER_PICKUP', 1.1], ['F_HYDROFOIL', 1.7], ['F_MONOCYCLE', 0.5],
  ['F_OFF_ROAD', 1.5], ['F_PROP', 1.2], ['F_SNOWMOBILE', 1.75],
  ['F_STOL_CHASSIS', 1.5], ['F_SUBMERSIBLE', 1.8], ['F_TRACTOR_MODIFICATION', 1.2],
  ['F_TRAILER_MODIFICATION', 0.8], ['F_ULTRA_LIGHT', 0.5], ['F_VSTOL_CHASSIS', 2],
];
const SYSTEM_MISC_FLAGS = [
  'F_CHASSIS_MODIFICATION',
  'F_SUPPORT_VEE_BAR_ARMOR', 'F_FERRO_FIBROUS', 'F_FERRO_LAMELLOR',
  'F_LIGHT_FERRO', 'F_HEAVY_FERRO', 'F_REACTIVE', 'F_REFLECTIVE',
  'F_HARDENED_ARMOR', 'F_HEAT_SINK', 'F_DOUBLE_HEAT_SINK',
] as const;

type SupportVehicleEntity = VehicleEntity & SupportVehicle;

export interface SupportVehicleWeightBreakdown {
  readonly engine: number;
  readonly structure: number;
  readonly controls: number;
  readonly heatSinks: number;
  readonly armor: number;
  readonly turret: number;
  readonly dualTurret: number;
  readonly miscellaneous: number;
  readonly weapons: number;
  readonly ammo: number;
  readonly powerAmplifiers: number;
  readonly carryingSpace: number;
  readonly fuel: number;
  readonly exact: number;
  readonly rounded: number;
}

export function calculateSupportVehicleEffectiveTonnage(entity: SupportVehicleEntity): number {
  return calculateSupportVehicleWeightBreakdown(entity).rounded;
}

export function calculateSupportVehicleWeightBreakdown(entity: SupportVehicleEntity): SupportVehicleWeightBreakdown {
  const small = entity.weightClass() === 'Small Support';
  const engine = getEquipmentEngineWeight(entity);
  const structure = calculateSupportVehicleStructureWeight(entity);
  const controls = roundKg(entity.transporters().reduce((total, transporter) =>
    total + (transporter.kind === 'bay' && isQuartersBay(transporter)
      ? getQuartersWeight(transporter)
      : 0), 0));
  const heatSinks = small ? 0 : calculateHeatNeutralRequirement(entity);
  const armor = calculateSupportVehicleArmorWeight(entity);
  const turret = calculateTurretWeight(entity, false);
  const dualTurret = calculateTurretWeight(entity, true);

  let miscellaneous = 0;
  let weapons = 0;
  let ammo = 0;
  for (const mount of entity.equipment()) {
    const equipment = mount.equipment;
    if (!equipment) throw new Error(`Unresolved equipment ${mount.equipmentId} on ${entity.displayName()}`);
    if (equipment instanceof ArmorEquipment || equipment instanceof StructureEquipment) continue;
    if (equipment instanceof AmmoEquipment) {
      if (mount.location !== 'None') ammo += requireTonnage(entity, mount);
    } else if (equipment instanceof WeaponEquipment) {
      weapons += requireTonnage(entity, mount);
    } else if (equipment instanceof MiscEquipment && !equipment.hasAnyFlag([...SYSTEM_MISC_FLAGS])) {
      miscellaneous += requireTonnage(entity, mount);
    }
  }

  const powerAmplifiers = calculatePowerAmplifierWeight(entity);
  const fuel = entity.fuel();
  const carryingSpace = entity.transporters().reduce((total, transporter) => {
    if (transporter.kind === 'troop-space') return total + transporter.totalSpace;
    if (transporter.kind !== 'bay' || isQuartersBay(transporter)) return total;
    return total + (transporter.constructionWeight ?? transporter.capacity);
  }, 0);
  const exact = engine + structure + controls + heatSinks + armor + turret + dualTurret
    + miscellaneous + weapons + ammo + powerAmplifiers + carryingSpace + fuel;
  return {
    engine, structure, controls, heatSinks, armor, turret, dualTurret, miscellaneous,
    weapons, ammo, powerAmplifiers, carryingSpace, fuel, exact,
    rounded: small ? roundKg(exact) : ceilToHalfTon(exact),
  };
}

function getQuartersWeight(bay: { configuration: { type: string }; capacity: number; constructionWeight?: number }): number {
  if (bay.constructionWeight !== undefined) return bay.constructionWeight;
  switch (bay.configuration.type) {
    case 'pillion-seats': return bay.capacity * 0.025;
    case 'standard-seats': return bay.capacity * 0.075;
    case 'ejection-seats': return bay.capacity * 0.1;
    default: return bay.capacity;
  }
}

export function calculateSupportVehicleStructureWeight(entity: SupportVehicleEntity): number {
  let modifier = 1;
  for (const [flag, multiplier] of CHASSIS_MODIFIERS) {
    if (entity.equipment().some(mount => mount.equipment?.hasFlag(flag))) modifier *= multiplier;
  }
  const raw = entity.tonnage() * getBaseChassisValue(entity)
    * (STRUCTURAL_RATING_MULTIPLIERS[entity.structuralTechRating()] ?? 1) * modifier;
  return entity.weightClass() === 'Small Support' ? ceilKg(raw) : ceilToHalfTon(raw);
}

export function calculateSupportVehicleArmorWeight(entity: SupportVehicleEntity): number {
  const calculateRaw = (armor: ArmorEquipment, points: number, rating: TechRating | null): number => {
    if (!armor.hasFlag('F_SUPPORT_VEE_BAR_ARMOR')) return points / (16 * armor.pptMultiplier);
    const key = rating ?? TECH_RATINGS[entity.structuralTechRating()] ?? 'A';
    return points * (armor.weightPerPointSV[key] ?? armor.weightPerPoint);
  };
  let raw = 0;
  if (!entity.hasPatchworkArmor()) {
    const mounted = entity.uniformArmor();
    if (mounted) raw = calculateRaw(mounted.armor, entity.totalArmorPoints(), mounted.techRating);
  } else {
    for (const [location, allocation] of entity.armorValues()) {
      const mounted = entity.armorByLocation().get(location);
      if (!mounted) continue;
      raw += calculateRaw(mounted.armor, (allocation.front ?? 0) + (allocation.rear ?? 0), mounted.techRating);
    }
  }
  return entity.weightClass() === 'Small Support' ? ceilKg(raw) : ceilToHalfTon(raw);
}

function getBaseChassisValue(entity: SupportVehicleEntity): number {
  const small = entity.weightClass() === 'Small Support';
  const large = entity.weightClass() === 'Large Support';
  switch (entity.motiveType()) {
    case 'Hover':
    case 'VTOL': return small ? 0.2 : large ? 0.3 : 0.25;
    case 'Naval':
    case 'Hydrofoil':
    case 'Submarine': return small ? 0.12 : large ? 0.17 : 0.15;
    case 'Tracked': return small ? 0.13 : large ? 0.25 : 0.15;
    case 'Wheeled': return small ? 0.12 : large ? 0.18 : 0.15;
    case 'WiGE': return small ? 0.12 : large ? 0.17 : 0.15;
    case 'Rail':
    case 'MagLev': return small ? 0.15 : large ? 0.3 : 0.2;
    default: return 0;
  }
}

function calculateTurretWeight(entity: SupportVehicleEntity, dual: boolean): number {
  const exists = dual ? entity.hasDualTurret() : entity.hasTurret();
  if (!exists) return 0;
  const baseWeight = dual ? entity.baseChassisTurret2Weight() : entity.baseChassisTurretWeight();
  if (entity.omni() && baseWeight >= 0) return baseWeight;
  const locations = dual ? ['Rear Turret'] : ['Turret', 'Front Turret'];
  const raw = entity.equipment().reduce((total, mount) => {
    if (!locations.includes(mount.location) || mount.equipment instanceof AmmoEquipment) return total;
    if (!dual && mount.equipment instanceof ArmorEquipment) return total;
    return total + requireTonnage(entity, mount);
  }, 0) / 10;
  return entity.tonnage() < 5 ? ceilKg(raw) : ceilToHalfTon(raw);
}

function requireTonnage(
  entity: SupportVehicleEntity,
  mount: { equipmentId: string; getTonnage(owner: SupportVehicleEntity): number | undefined },
): number {
  const tonnage = mount.getTonnage(entity);
  if (tonnage === undefined) throw new Error(`Unable to calculate tonnage for ${mount.equipmentId} on ${entity.displayName()}`);
  return tonnage;
}

function roundKg(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function ceilKg(value: number): number {
  return Math.ceil(Math.round(value * 1_000_000) / 1000) / 1000;
}
