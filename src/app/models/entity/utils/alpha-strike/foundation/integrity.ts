import {
  AeroEntity,
  BattleArmorEntity,
  type BaseEntity,
  InfantryEntity,
  JumpShipEntity,
  MekEntity,
  ProtoMekEntity,
  VehicleEntity,
  WarShipEntity,
} from '../../../entities';
import { infantryDamageDivisor } from '../../battle-value/infantry-rules';

const AS_MEK_STRUCTURE: readonly (readonly number[])[] = [
  [1,1,2,2,3,3,3,4,4,5,5,5,6,6,6,7,7,8,8,8,8,9,9,10,10,10,11,11,11,12,12,13,13,13,14,14,14,15,15],
  [1,2,2,3,3,4,4,5,5,6,7,7,7,8,8,9,10,10,10,11,11,12,12,13,13,14,14,15,15,16,16,17,17,18,18,19,19,20,20],
  [1,1,1,2,2,2,2,3,3,4,4,4,4,5,5,5,6,6,6,6,7,7,7,8,8,8,8,9,9,9,10,10,10,11,11,11,11,12,12],
  [1,1,1,1,2,2,2,2,3,3,3,4,4,4,4,5,5,5,5,5,6,6,6,6,7,7,7,7,8,8,8,8,9,9,9,9,10,10,10],
  [1,1,1,1,1,2,2,2,2,3,3,3,3,3,4,4,4,4,4,5,5,5,5,5,6,6,6,6,6,7,7,7,7,8,8,8,8,8,9],
  [1,1,1,1,1,1,2,2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,5,5,5,5,5,6,6,6,6,6,6,7,7,7,7,7,8],
  [1,1,1,1,1,1,1,1,2,2,2,2,2,2,3,3,3,3,3,3,3,4,4,4,4,4,4,4,5,5,5,5,5,5,5,6,6,6,6],
  [1,1,1,1,1,1,1,2,2,2,2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,5,5,5,5,5,5,6,6,6,6,6,6,7,7],
  [1,1,1,1,1,1,1,1,1,2,2,2,2,2,2,2,3,3,3,3,3,3,3,3,4,4,4,4,4,4,4,5,5,5,5,5,5,5,5],
];

export function alphaStrikeArmor(entity: BaseEntity): number {
  if (entity instanceof InfantryEntity) {
    let divisor = infantryDamageDivisor(entity);
    if (['Tracked', 'Wheeled', 'Hover', 'VTOL', 'Submarine'].includes(entity.motiveType())) {
      divisor /= 2;
    }
    return Math.round(divisor / 15 * entity.totalInternalPoints());
  }
  if (entity instanceof BattleArmorEntity) return Math.round(entity.totalArmorPoints() / 30);

  let points = 0;
  for (const [location, armor] of entity.armorValues()) {
    if (!armor || (armor.front <= 0 && armor.rear <= 0)) continue;
    const type = entity.armorByLocation().get(location)?.type ?? entity.uniformArmor()?.type ?? 'STANDARD';
    let modifier = type === 'COMMERCIAL' ? 0.5
      : type === 'FERRO_LAMELLOR' ? 1.2
      : type === 'HARDENED' ? 2 : 1;
    if (entity.isSupportVehicle() && entity.barRating() < 9 && type !== 'COMMERCIAL') {
      modifier *= entity.barRating() / 10;
    }
    points += Math.max(0, armor.front * modifier) + Math.max(0, armor.rear * modifier);
  }
  points += entity.equipment().filter(mount => mount.equipment?.hasFlag('F_MODULAR_ARMOR')).length * 10;
  return entity instanceof JumpShipEntity ? Math.round(points * 0.33) : Math.round(points / 30);
}

export function alphaStrikeStructure(entity: BaseEntity): number {
  if (entity instanceof MekEntity) {
    const weightIndex = Math.trunc(entity.tonnage() / 5) - 2;
    let structure = AS_MEK_STRUCTURE[mekEngineIndex(entity)]?.[weightIndex] ?? -1;
    const typeId = entity.uniformStructureMaterial()?.structure.structureTypeId;
    if (typeId === 5) structure = Math.ceil(structure * 0.5);
    else if (typeId === 4) structure *= 2;
    return structure;
  }
  if (entity instanceof WarShipEntity) return entity.structuralIntegrity();
  if (entity instanceof BattleArmorEntity) return 2;
  if (entity instanceof InfantryEntity || entity instanceof JumpShipEntity || entity instanceof ProtoMekEntity) return 1;
  if (entity instanceof VehicleEntity) return vehicleStructure(entity);
  if (entity instanceof AeroEntity) return Math.ceil(entity.structuralIntegrity() * 0.5);
  return -1;
}

function vehicleStructure(entity: VehicleEntity): number {
  let divisor = 10;
  if (entity.isSupportVehicle() && ['Naval', 'Hydrofoil', 'Submarine'].includes(entity.motiveType())) {
    const tons = entity.tonnage();
    divisor = tons >= 30000.5 ? 35
      : tons >= 12000.5 ? 30
      : tons >= 6000.5 ? 25
      : tons >= 500.5 ? 20
      : tons >= 300.5 ? 15 : 10;
  }
  const internalPoints = !entity.isSupportVehicle() && entity.isSuperHeavy()
    ? entity.totalInternalPoints() - 1
    : entity.totalInternalPoints();
  return Math.ceil(internalPoints / divisor);
}

function mekEngineIndex(entity: MekEntity): number {
  const engine = entity.mountedEngine();
  const clan = engine.techBase === 'Clan';
  const large = engine.isLarge;
  switch (engine.type()) {
    case 'Compact': return clan ? 0 : 1;
    case 'Light': return clan ? 0 : large ? 4 : 3;
    case 'XL': return clan ? (large ? 4 : 3) : 4;
    case 'XXL': return clan ? (large ? 7 : 5) : large ? 8 : 6;
    default: return clan ? 0 : large ? 2 : 0;
  }
}

export function alphaStrikeRoundUp(value: number): number {
  return Math.round(value + 0.4);
}

export function alphaStrikeThreshold(armor: number, fighter: boolean): number {
  return alphaStrikeRoundUp(armor / 3 / (fighter ? 1 : 4));
}
