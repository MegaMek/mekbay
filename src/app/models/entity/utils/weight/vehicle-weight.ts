import { AmmoEquipment, ArmorEquipment, MiscEquipment, StructureEquipment, WeaponEquipment } from '../../../equipment.model';
import { isQuartersBay } from '../../bays/bay-definitions';
import type { VehicleEntity } from '../../entities/vehicle/vehicle-entity';
import { calculateHeatNeutralRequirement, calculatePowerAmplifierWeight } from '../cost/common';
import { getEquipmentEngineWeight } from '../equipment-engine-weight';
import { ceilToHalfTon } from './weight-rounding';

const SYSTEM_MISC_FLAGS = [
  'F_ENDO_STEEL', 'F_ENDO_COMPOSITE', 'F_ENDO_STEEL_PROTO', 'F_COMPOSITE',
  'F_INDUSTRIAL_STRUCTURE', 'F_REINFORCED', 'F_FERRO_FIBROUS',
  'F_FERRO_LAMELLOR', 'F_LIGHT_FERRO', 'F_HEAVY_FERRO', 'F_REACTIVE',
  'F_REFLECTIVE', 'F_HARDENED_ARMOR', 'F_PRIMITIVE_ARMOR',
  'F_COMMERCIAL_ARMOR', 'F_INDUSTRIAL_ARMOR', 'F_HEAVY_INDUSTRIAL_ARMOR',
  'F_ANTI_PENETRATIVE_ABLATIVE', 'F_HEAT_DISSIPATING', 'F_IMPACT_RESISTANT',
  'F_BALLISTIC_REINFORCED', 'F_ELECTRIC_DISCHARGE_ARMOR', 'F_HEAT_SINK',
  'F_DOUBLE_HEAT_SINK', 'F_IS_DOUBLE_HEAT_SINK_PROTOTYPE',
] as const;

export interface VehicleWeightBreakdown {
  readonly engine: number;
  readonly structure: number;
  readonly controls: number;
  readonly heatSinks: number;
  readonly armor: number;
  readonly turret: number;
  readonly dualTurret: number;
  readonly liftingEquipment: number;
  readonly miscellaneous: number;
  readonly weapons: number;
  readonly ammo: number;
  readonly powerAmplifiers: number;
  readonly carryingSpace: number;
  readonly exact: number;
  readonly rounded: number;
}

export function calculateVehicleEffectiveTonnage(entity: VehicleEntity): number {
  return calculateVehicleWeightBreakdown(entity).rounded;
}

export function calculateVehicleWeightBreakdown(entity: VehicleEntity): VehicleWeightBreakdown {
  if (entity.isSupportVehicle()) {
    throw new Error(`Support vehicle weight requires its dedicated verifier: ${entity.displayName()}`);
  }

  const engine = getEquipmentEngineWeight(entity);
  const structure = calculateVehicleStructureWeight(entity);
  const controls = entity.hasNoControlSystems() ? 0 : ceilToHalfTon(entity.tonnage() / 20);
  const heatSinks = Math.max(0,
    calculateHeatNeutralRequirement(entity) - entity.mountedEngine().weightFreeHeatSinks,
  );
  const armor = calculateVehicleArmorWeight(entity);
  const turret = calculateTurretWeight(entity, false);
  const dualTurret = calculateTurretWeight(entity, true);
  const liftingEquipment = ['Hover', 'VTOL', 'Hydrofoil', 'Submarine', 'WiGE'].includes(entity.motiveType())
    ? ceilToHalfTon(entity.tonnage() / 10)
    : 0;

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
  const carryingSpace = entity.transporters().reduce((total, transporter) => {
    if (transporter.kind === 'troop-space') return total + transporter.totalSpace;
    if (transporter.kind !== 'bay' || isQuartersBay(transporter)) return total;
    return total + (transporter.constructionWeight ?? transporter.capacity);
  }, entity.extraSeats() * 0.5);

  const exact = engine + structure + controls + heatSinks + armor + turret + dualTurret
    + liftingEquipment + miscellaneous + weapons + ammo + powerAmplifiers + carryingSpace;
  return {
    engine, structure, controls, heatSinks, armor, turret, dualTurret, liftingEquipment,
    miscellaneous, weapons, ammo, powerAmplifiers, carryingSpace, exact,
    rounded: ceilToHalfTon(exact),
  };
}

export function calculateVehicleStructureWeight(entity: VehicleEntity): number {
  const structureType = entity.uniformStructure()?.structure.structureTypeId ?? 0;
  let divisor = structureType === 1 ? 20 : 10;
  const navalSuperHeavy = entity.isSuperHeavy()
    && ['Naval', 'Submarine'].includes(entity.motiveType());
  if (entity.isSuperHeavy() && !navalSuperHeavy) divisor /= 2;
  return ceilToHalfTon(entity.tonnage() / divisor);
}

export function calculateVehicleArmorWeight(entity: VehicleEntity): number {
  const uniform = entity.uniformArmor();
  if (uniform && !entity.hasPatchworkArmor()) {
    return ceilToHalfTon(entity.totalArmorPoints() / (16 * uniform.armor.pptMultiplier));
  }
  let raw = 0;
  for (const [location, points] of entity.armorValues()) {
    const armor = entity.armorByLocation().get(location)?.armor;
    if (!armor) continue;
    raw += ((points.front ?? 0) + (points.rear ?? 0)) / (16 * armor.pptMultiplier);
  }
  return ceilToHalfTon(raw);
}

function calculateTurretWeight(entity: VehicleEntity, dual: boolean): number {
  const exists = dual ? entity.hasDualTurret() : entity.hasTurret();
  if (!exists) return 0;
  const baseWeight = dual ? entity.baseChassisTurret2Weight() : entity.baseChassisTurretWeight();
  if (entity.omni() && baseWeight >= 0) return baseWeight;
  const locations = dual ? ['Rear Turret'] : ['Turret', 'Front Turret'];
  const equipmentWeight = entity.equipment().reduce((total, mount) => {
    if (!locations.includes(mount.location) || mount.equipment instanceof AmmoEquipment) return total;
    if (!dual && mount.equipment instanceof ArmorEquipment) return total;
    return total + requireTonnage(entity, mount);
  }, 0);
  return ceilToHalfTon(equipmentWeight / 10);
}

function requireTonnage(
  entity: VehicleEntity,
  mount: { equipmentId: string; getTonnage(owner: VehicleEntity): number | undefined },
): number {
  const tonnage = mount.getTonnage(entity);
  if (tonnage === undefined) {
    throw new Error(`Unable to calculate tonnage for ${mount.equipmentId} on ${entity.displayName()}`);
  }
  return tonnage;
}
