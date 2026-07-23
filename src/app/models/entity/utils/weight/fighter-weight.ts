import { AmmoEquipment, ArmorEquipment, MiscEquipment, StructureEquipment, WeaponEquipment } from '../../../equipment.model';
import { isQuartersBay } from '../../bays/bay-definitions';
import type { AeroEntity } from '../../entities/aero/aero-entity';
import type { ConvFighterEntity } from '../../entities/aero/conv-fighter-entity';
import { calculateHeatNeutralRequirement, calculatePowerAmplifierWeight } from '../cost/common';
import { getEquipmentEngineWeight } from '../equipment-engine-weight';
import { ceilToHalfTon } from './weight-rounding';

const SYSTEM_MISC_FLAGS = [
  'F_FERRO_ALUMINUM', 'F_FERRO_ALUMINUM_PROTO', 'F_LIGHT_FERRO', 'F_HEAVY_FERRO',
  'F_REACTIVE', 'F_REFLECTIVE', 'F_HARDENED_ARMOR', 'F_HEAT_SINK',
  'F_DOUBLE_HEAT_SINK', 'F_IS_DOUBLE_HEAT_SINK_PROTOTYPE',
] as const;

export interface FighterWeightBreakdown {
  readonly engine: number;
  readonly controls: number;
  readonly fuel: number;
  readonly heatSinks: number;
  readonly armor: number;
  readonly vstol: number;
  readonly miscellaneous: number;
  readonly weapons: number;
  readonly ammo: number;
  readonly powerAmplifiers: number;
  readonly carryingSpace: number;
  readonly exact: number;
  readonly rounded: number;
}

export function calculateFighterEffectiveTonnage(entity: AeroEntity): number {
  return calculateFighterWeightBreakdown(entity).rounded;
}

export function calculateFighterWeightBreakdown(entity: AeroEntity): FighterWeightBreakdown {
  const conventional = entity.entityType === 'ConvFighter';
  let engine = getEquipmentEngineWeight(entity);
  if (conventional && (entity.mountedEngine().isFusion || entity.mountedEngine().isFission)) {
    engine = ceilToHalfTon(engine * 1.5);
  }
  const controls = conventional
    ? Math.round(entity.tonnage() * 0.2) / 2
    : ({ Standard: 3, Small: 2, 'Command Console': 6, Primitive: 5 }[entity.cockpitType()] ?? 3);
  const fuelPointsPerTon = conventional ? 160 : 80;
  const fuel = Math.round(2 * entity.fuel() / fuelPointsPerTon) / 2;
  const requiredSinks = conventional ? calculateHeatNeutralRequirement(entity) : entity.heatSinkCount();
  const heatSinks = Math.max(0, requiredSinks - entity.mountedEngine().weightFreeHeatSinks);
  const armor = calculateFighterArmorWeight(entity);
  const vstol = conventional && (entity as ConvFighterEntity).vstol()
    ? ceilToHalfTon(entity.tonnage() * 0.05)
    : 0;

  let miscellaneous = 0;
  let weapons = 0;
  let ammo = 0;
  for (const mount of entity.equipment()) {
    const equipment = mount.equipment;
    if (!equipment) throw new Error(`Unresolved equipment ${mount.equipmentId} on ${entity.displayName()}`);
    if (equipment instanceof ArmorEquipment || equipment instanceof StructureEquipment) continue;
    if (equipment instanceof AmmoEquipment) {
      if (mount.location !== 'None' && !equipment.hasFlag('F_BOMB')) ammo += requireTonnage(entity, mount);
    } else if (equipment instanceof WeaponEquipment) {
      if (!equipment.hasFlag('F_BOMB')) weapons += requireTonnage(entity, mount);
    } else if (equipment instanceof MiscEquipment && !equipment.hasAnyFlag([...SYSTEM_MISC_FLAGS])) {
      miscellaneous += requireTonnage(entity, mount);
    }
  }
  const powerAmplifiers = conventional ? calculatePowerAmplifierWeight(entity) : 0;
  const carryingSpace = entity.transporters().reduce((total, transporter) => {
    if (transporter.kind === 'troop-space') return total + transporter.totalSpace;
    if (transporter.kind !== 'bay' || isQuartersBay(transporter)) return total;
    return total + (transporter.constructionWeight ?? transporter.capacity);
  }, 0);
  const exact = engine + controls + fuel + heatSinks + armor + vstol + miscellaneous
    + weapons + ammo + powerAmplifiers + carryingSpace;
  return {
    engine, controls, fuel, heatSinks, armor, vstol, miscellaneous, weapons, ammo,
    powerAmplifiers, carryingSpace, exact, rounded: ceilToHalfTon(exact),
  };
}

export function calculateFighterArmorWeight(entity: AeroEntity): number {
  const uniform = entity.uniformArmor();
  if (uniform && !entity.hasPatchworkArmor()) {
    return ceilToHalfTon(entity.totalArmorPoints() / (16 * uniform.armor.pptMultiplier));
  }
  let raw = 0;
  for (const [location, allocation] of entity.armorValues()) {
    const armor = entity.armorByLocation().get(location)?.armor;
    if (!armor) continue;
    raw += ((allocation.front ?? 0) + (allocation.rear ?? 0)) / (16 * armor.pptMultiplier);
  }
  return ceilToHalfTon(raw);
}

function requireTonnage(
  entity: AeroEntity,
  mount: { equipmentId: string; getTonnage(owner: AeroEntity): number | undefined },
): number {
  const tonnage = mount.getTonnage(entity);
  if (tonnage === undefined) throw new Error(`Unable to calculate tonnage for ${mount.equipmentId} on ${entity.displayName()}`);
  return tonnage;
}
