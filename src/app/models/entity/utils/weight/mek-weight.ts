import { AmmoEquipment, ArmorEquipment, MiscEquipment, StructureEquipment, WeaponEquipment } from '../../../equipment.model';
import type { MekEntity } from '../../entities/mek/mek-entity';
import { isQuartersBay } from '../../bays/bay-definitions';
import { ceilToHalfTon, ceilToWholeTon } from './weight-rounding';

export interface MekWeightBreakdown {
  readonly engine: number;
  readonly structure: number;
  readonly cockpit: number;
  readonly gyro: number;
  readonly heatSinks: number;
  readonly armor: number;
  readonly conversion: number;
  readonly equipment: number;
  readonly powerAmplifiers: number;
  readonly carryingSpace: number;
  readonly armoredComponents: number;
  readonly exact: number;
  readonly rounded: number;
}

const STRUCTURE_DIVISORS: Readonly<Record<number, { normal: number; superHeavy: number }>> = {
  0: { normal: 10, superHeavy: 5 },
  1: { normal: 5, superHeavy: 2.5 },
  2: { normal: 20, superHeavy: 10 },
  3: { normal: 20, superHeavy: 20 },
  4: { normal: 5, superHeavy: 5 },
  5: { normal: 20, superHeavy: 20 },
  6: { normal: 10 / 0.75, superHeavy: 10 / 1.5 },
};

const HYBRID_STRUCTURE_FRACTIONS: Readonly<Record<string, number>> = {
  HD: 0.05, CT: 0.25, RT: 0.15, LT: 0.15,
  RA: 0.1, LA: 0.1, RL: 0.1, LL: 0.1,
};

const SYSTEM_MISC_FLAGS = [
  'F_ENDO_STEEL', 'F_ENDO_COMPOSITE', 'F_ENDO_STEEL_PROTO', 'F_COMPOSITE',
  'F_INDUSTRIAL_STRUCTURE', 'F_REINFORCED', 'F_FERRO_FIBROUS',
  'F_FERRO_FIBROUS_PROTO', 'F_FERRO_LAMELLOR', 'F_LIGHT_FERRO',
  'F_HEAVY_FERRO', 'F_REACTIVE', 'F_REFLECTIVE', 'F_HARDENED_ARMOR',
  'F_PRIMITIVE_ARMOR', 'F_COMMERCIAL_ARMOR', 'F_INDUSTRIAL_ARMOR',
  'F_HEAVY_INDUSTRIAL_ARMOR', 'F_ANTI_PENETRATIVE_ABLATIVE',
  'F_HEAT_DISSIPATING', 'F_IMPACT_RESISTANT', 'F_BALLISTIC_REINFORCED',
  'F_ELECTRIC_DISCHARGE_ARMOR', 'F_HEAT_SINK', 'F_DOUBLE_HEAT_SINK',
  'F_IS_DOUBLE_HEAT_SINK_PROTOTYPE', 'F_COMPACT_HEAT_SINK',
] as const;

export function calculateMekEffectiveTonnage(entity: MekEntity): number {
  return calculateMekWeightBreakdown(entity).rounded;
}

export function calculateMekWeightBreakdown(entity: MekEntity): MekWeightBreakdown {
  const engine = entity.mountedEngine().installed ? entity.mountedEngine().getWeight() : 0;
  const structure = calculateMekStructureWeight(entity);
  const cockpit = entity.mountedCockpit().weight;
  const gyro = ceilToHalfTon(
    Math.ceil(entity.mountedEngine().rating / 100) * entity.mountedGyro().weightMultiplier,
  );
  const heatSinks = calculateMekHeatSinkWeight(entity);
  const armor = calculateMekArmorWeight(entity);
  const conversion = calculateMekConversionWeight(entity);
  const equipment = calculateMekEquipmentWeight(entity);
  const powerAmplifiers = calculateMekPowerAmplifierWeight(entity);
  const carryingSpace = calculateMekCarryingSpaceWeight(entity);
  const armoredComponents = calculateMekArmoredComponentWeight(entity);
  const exact = engine + structure + cockpit + gyro + heatSinks + armor + conversion
    + equipment + powerAmplifiers + carryingSpace + armoredComponents;
  return {
    engine, structure, cockpit, gyro, heatSinks, armor, conversion, equipment,
    powerAmplifiers, carryingSpace, armoredComponents, exact,
    rounded: ceilToHalfTon(exact),
  };
}

export function calculateMekStructureWeight(entity: MekEntity): number {
  if (!entity.hasHybridStructure()) {
    const structure = entity.structureAt('CT');
    return fullStructureWeight(entity, structure.tonnage, structure.structure.structureTypeId);
  }

  const total = entity.locationOrder.reduce((sum, location) => {
    const fraction = HYBRID_STRUCTURE_FRACTIONS[location] ?? 0;
    if (fraction === 0) return sum;
    const structure = entity.structureAt(location);
    return sum + fullStructureWeight(entity, structure.tonnage, structure.structure.structureTypeId) * fraction;
  }, 0);
  return ceilToHalfTon(total);
}

function fullStructureWeight(entity: MekEntity, tonnage: number, typeId: number): number {
  const divisor = STRUCTURE_DIVISORS[typeId] ?? STRUCTURE_DIVISORS[0];
  const tripodMultiplier = entity.motiveType() === 'Tripod' ? 1.1 : 1;
  return ceilToHalfTon(tonnage * tripodMultiplier / (tonnage > 100 ? divisor.superHeavy : divisor.normal));
}

export function calculateMekArmorWeight(entity: MekEntity): number {
  const raw = [...entity.armorByLocation()].reduce((total, [location, mountedArmor]) => {
    const allocation = entity.armorValues().get(location);
    const points = (allocation?.front ?? 0) + (allocation?.rear ?? 0);
    return total + points / (16 * mountedArmor.armor.pptMultiplier);
  }, 0);
  return ceilToHalfTon(raw);
}

function calculateMekHeatSinkWeight(entity: MekEntity): number {
  const compactTonnage = entity.equipment().reduce((sum, mount) => {
    const equipment = mount.equipment;
    if (!(equipment instanceof MiscEquipment) || !equipment.isCompactHeatSink) return sum;
    return sum + requireMountTonnage(entity, mount);
  }, 0);
  const free = entity.mountedEngine().weightFreeHeatSinks;
  return Math.max(0, compactTonnage > 0
    ? compactTonnage - free * 1.5
    : entity.heatSinkCount() - free);
}

function calculateMekConversionWeight(entity: MekEntity): number {
  if (entity.chassisConfig === 'LAM') {
    const lamType = 'lamType' in entity && typeof entity.lamType === 'function'
      ? String(entity.lamType()).toLowerCase()
      : 'standard';
    return ceilToWholeTon(entity.tonnage() * (lamType === 'bimodal' ? 0.15 : 0.1));
  }
  return entity.chassisConfig === 'QuadVee' ? ceilToWholeTon(entity.tonnage() * 0.1) : 0;
}

function calculateMekEquipmentWeight(entity: MekEntity): number {
  return entity.equipment().reduce((total, mount) => {
    const equipment = mount.equipment;
    if (!equipment) throw new Error(`Unresolved equipment ${mount.equipmentId} on ${entity.displayName()}`);
    if (equipment instanceof ArmorEquipment || equipment instanceof StructureEquipment) return total;
    if (equipment instanceof MiscEquipment && equipment.hasAnyFlag([...SYSTEM_MISC_FLAGS])) return total;
    if (equipment instanceof AmmoEquipment && mount.allocation.kind === 'unallocated') return total;
    let mountWeight = requireMountTonnage(entity, mount);
    if (mount.secondEquipment) {
      mountWeight += requireMountTonnage(entity, mount.clone({
        equipmentId: mount.secondEquipmentId ?? mount.secondEquipment.id,
        equipment: mount.secondEquipment,
        secondEquipmentId: undefined,
        secondEquipment: undefined,
      }));
    }
    return total + mountWeight;
  }, 0);
}

function calculateMekPowerAmplifierWeight(entity: MekEntity): number {
  const engine = entity.mountedEngine();
  if (engine.installed && !engine.isICE && engine.type() !== 'Fuel Cell') return 0;
  const poweredWeight = entity.equipment().reduce((total, mount) => {
    const equipment = mount.equipment;
    if (!(equipment instanceof WeaponEquipment)) return total;
    const requiresPower = equipment.hasAnyFlag(['F_LASER', 'F_PPC', 'F_PLASMA', 'F_PLASMA_MFUK'])
      || (equipment.hasFlag('F_FLAMER') && equipment.ammoType === 'NA');
    if (!requiresPower) return total;
    const capacitor = entity.getLinkingMount(mount);
    return total + requireMountTonnage(entity, mount)
      + (capacitor?.equipment?.hasFlag('F_PPC_CAPACITOR') ? requireMountTonnage(entity, capacitor) : 0);
  }, 0);
  return ceilToHalfTon(poweredWeight / 10);
}

function calculateMekCarryingSpaceWeight(entity: MekEntity): number {
  return entity.transporters().reduce((total, transporter) => {
    if (transporter.kind === 'troop-space') return total + transporter.totalSpace;
    if (transporter.kind !== 'bay' || isQuartersBay(transporter)) return total;
    return total + (transporter.constructionWeight ?? transporter.capacity);
  }, 0);
}

function calculateMekArmoredComponentWeight(entity: MekEntity): number {
  let weight = 0;
  let armoredCockpit = false;
  for (const slots of entity.criticalSlotGrid().values()) {
    for (const slot of slots) {
      if (!slot.armored) continue;
      if (slot.type === 'system' && slot.systemType === 'Cockpit') armoredCockpit = true;
      else weight += 0.5;
    }
  }
  return weight + (armoredCockpit ? 1 : 0);
}

function requireMountTonnage(entity: MekEntity, mount: { equipmentId: string; getTonnage(owner: MekEntity): number | undefined }): number {
  const tonnage = mount.getTonnage(entity);
  if (tonnage === undefined) {
    throw new Error(`Unable to calculate tonnage for ${mount.equipmentId} on ${entity.displayName()}`);
  }
  return tonnage;
}