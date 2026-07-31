import { AmmoEquipment, ArmorEquipment, MiscEquipment, StructureEquipment, WeaponEquipment } from '../../../equipment.model';
import { getEngineBaseWeight } from '../../components/engine';
import type { ProtoMekEntity } from '../../entities/protomek/protomek-entity';
import { calculateHeatNeutralRequirement } from '../cost/common';

const SYSTEM_MISC_FLAGS = [
  'F_ENDO_STEEL', 'F_ENDO_COMPOSITE', 'F_ENDO_STEEL_PROTO', 'F_COMPOSITE',
  'F_INDUSTRIAL_STRUCTURE', 'F_REINFORCED', 'F_FERRO_FIBROUS',
  'F_FERRO_FIBROUS_PROTO', 'F_FERRO_LAMELLOR', 'F_LIGHT_FERRO',
  'F_HEAVY_FERRO', 'F_REACTIVE', 'F_REFLECTIVE', 'F_HARDENED_ARMOR',
  'F_PRIMITIVE_ARMOR', 'F_COMMERCIAL_ARMOR', 'F_INDUSTRIAL_ARMOR',
  'F_HEAVY_INDUSTRIAL_ARMOR', 'F_ANTI_PENETRATIVE_ABLATIVE',
  'F_HEAT_DISSIPATING', 'F_IMPACT_RESISTANT', 'F_BALLISTIC_REINFORCED',
  'F_ELECTRIC_DISCHARGE_ARMOR', 'F_HEAT_SINK', 'F_DOUBLE_HEAT_SINK',
  'F_IS_DOUBLE_HEAT_SINK_PROTOTYPE',
] as const;

export interface ProtoMekWeightBreakdown {
  readonly engine: number;
  readonly structure: number;
  readonly controls: number;
  readonly heatSinks: number;
  readonly armor: number;
  readonly miscellaneous: number;
  readonly weapons: number;
  readonly ammo: number;
  readonly exact: number;
  readonly rounded: number;
}

export function calculateProtoMekEffectiveTonnage(entity: ProtoMekEntity): number {
  return calculateProtoMekWeightBreakdown(entity).rounded;
}

export function calculateProtoMekWeightBreakdown(entity: ProtoMekEntity): ProtoMekWeightBreakdown {
  const engine = calculateProtoMekEngineWeight(entity);
  const structure = roundKg(entity.tonnage() * 0.1);
  const controls = entity.tonnage() > 9 ? 0.75 : 0.5;
  const heatSinks = calculateHeatNeutralRequirement(entity) * 0.25;
  const armor = calculateProtoMekArmorWeight(entity);
  let miscellaneous = 0;
  let weapons = 0;
  let ammo = 0;
  for (const mount of entity.equipment()) {
    const equipment = mount.equipment;
    if (!equipment) throw new Error(`Unresolved equipment ${mount.equipmentId} on ${entity.displayName()}`);
    if (equipment instanceof ArmorEquipment || equipment instanceof StructureEquipment) continue;
    if (equipment instanceof AmmoEquipment) {
      ammo += ceilKg(equipment.kgPerShot * (mount.getAmmoShots() ?? 0) / 1000);
    } else if (equipment instanceof WeaponEquipment) {
      weapons += requireTonnage(entity, mount);
    } else if (equipment instanceof MiscEquipment && !equipment.hasAnyFlag([...SYSTEM_MISC_FLAGS])) {
      miscellaneous += requireTonnage(entity, mount);
    }
  }
  const exact = engine + structure + controls + heatSinks + armor + miscellaneous + weapons + ammo;
  return { engine, structure, controls, heatSinks, armor, miscellaneous, weapons, ammo, exact, rounded: roundKg(exact) };
}

export function calculateProtoMekEngineWeight(entity: ProtoMekEntity): number {
  const engine = entity.mountedEngine();
  if (!engine.installed) return 0;
  if (engine.rating < 40) return ceilKg(engine.rating * 0.025);
  const descriptor = engine.descriptor();
  return ceilKg(Math.max(getEngineBaseWeight(engine.rating) * descriptor.weightMultiplier, descriptor.minWeight));
}

export function calculateProtoMekArmorWeight(entity: ProtoMekEntity): number {
  if (!entity.hasPatchworkArmor()) {
    const armor = entity.uniformArmor();
    return armor ? ceilKg(entity.totalArmorPoints() * armor.armor.weightPerPoint) : 0;
  }
  return [...entity.armorValues()].reduce((total, [location, allocation]) => {
    const armor = entity.armorByLocation().get(location);
    return total + ((allocation.front ?? 0) + (allocation.rear ?? 0)) * (armor?.armor.weightPerPoint ?? 0);
  }, 0);
}

function requireTonnage(entity: ProtoMekEntity, mount: { equipmentId: string; getTonnage(owner: ProtoMekEntity): number | undefined }): number {
  const tonnage = mount.getTonnage(entity);
  if (tonnage === undefined) throw new Error(`Unable to calculate tonnage for ${mount.equipmentId} on ${entity.displayName()}`);
  return tonnage;
}

function roundKg(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function ceilKg(value: number): number {
  return Math.ceil(Math.round(value * 1_000_000) / 1000) / 1000;
}