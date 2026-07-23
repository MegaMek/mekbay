import { AmmoEquipment, MiscEquipment, WeaponEquipment } from '../../../equipment.model';
import type { BattleArmorEntity } from '../../entities/infantry/battle-armor-entity';
import type { EntityMountedEquipment } from '../../types/equipment';

const WEIGHT_CLASS_INDEX = {
  'Ultra Light': 0, Light: 1, Medium: 2, Heavy: 3, Assault: 4,
} as const;
const IS_CHASSIS = [0.08, 0.1, 0.175, 0.3, 0.55] as const;
const CLAN_CHASSIS = [0.13, 0.15, 0.25, 0.4, 0.7] as const;
const GROUND_MP = [0.025, 0.03, 0.04, 0.08, 0.16] as const;
const JUMP_MP = [0.025, 0.025, 0.05, 0.125, 0.25] as const;
const UMU_MP = [0.045, 0.045, 0.085, 0.16, 0.25] as const;
const VTOL_MP = [0.03, 0.04, 0.06, 0, 0] as const;

const SYSTEM_MISC_FLAGS = [
  'F_ENDO_STEEL', 'F_ENDO_COMPOSITE', 'F_ENDO_STEEL_PROTO', 'F_COMPOSITE',
  'F_INDUSTRIAL_STRUCTURE', 'F_REINFORCED', 'F_FERRO_FIBROUS',
  'F_FERRO_FIBROUS_PROTO', 'F_FERRO_LAMELLOR', 'F_LIGHT_FERRO',
  'F_HEAVY_FERRO', 'F_REACTIVE', 'F_REFLECTIVE', 'F_HARDENED_ARMOR',
  'F_PRIMITIVE_ARMOR', 'F_COMMERCIAL_ARMOR', 'F_INDUSTRIAL_ARMOR',
  'F_HEAVY_INDUSTRIAL_ARMOR', 'F_ANTI_PENETRATIVE_ABLATIVE',
  'F_HEAT_DISSIPATING', 'F_IMPACT_RESISTANT', 'F_BALLISTIC_REINFORCED',
  'F_HEAT_SINK', 'F_DOUBLE_HEAT_SINK', 'F_IS_DOUBLE_HEAT_SINK_PROTOTYPE',
] as const;

export interface BattleArmorSuitWeight {
  readonly trooper: number;
  readonly structure: number;
  readonly armor: number;
  readonly turret: number;
  readonly miscellaneous: number;
  readonly weapons: number;
  readonly ammo: number;
  readonly exact: number;
}

export interface BattleArmorWeightBreakdown {
  readonly suits: readonly BattleArmorSuitWeight[];
  readonly exact: number;
  readonly rounded: number;
}

export function calculateBattleArmorEffectiveTonnage(entity: BattleArmorEntity): number {
  return calculateBattleArmorWeightBreakdown(entity).rounded;
}

export function calculateBattleArmorWeightBreakdown(entity: BattleArmorEntity): BattleArmorWeightBreakdown {
  const structure = calculateBattleArmorStructureWeight(entity);
  const armor = (entity.armorValues().get('Squad')?.front ?? 0)
    * (entity.uniformArmor()?.armor.weightPerPoint ?? 0);
  const turret = calculateTurretWeight(entity.turretConfig());
  const suits = Array.from({ length: entity.trooperCount() }, (_, trooper) => {
    const mounts = entity.equipment().filter(mount => appliesToSuit(mount, trooper));
    const miscellaneous = mounts.reduce((sum, mount) => {
      if (!(mount.equipment instanceof MiscEquipment)
        || mount.equipment.hasAnyFlag([...SYSTEM_MISC_FLAGS])) return sum;
      return sum + requireTonnage(entity, mount);
    }, 0);
    const weapons = roundKg(mounts.reduce((sum, mount) => {
      if (!(mount.equipment instanceof WeaponEquipment) || mount.isAPM) return sum;
      const modifier = mount.isDWP ? 0.75 : mount.isSSWM ? (entity.techBase() === 'Clan' ? 0.4 : 0.5) : 1;
      const weight = requireTonnage(entity, mount) * modifier;
      return sum + (modifier === 1 ? weight : ceilKg(weight));
    }, 0));
    const ammo = mounts.reduce((sum, mount) => {
      if (!(mount.equipment instanceof AmmoEquipment)) return sum;
      const modifier = mount.isDWP ? 0.75 : mount.isSSWM ? (entity.techBase() === 'Clan' ? 0.4 : 0.5) : 1;
      return sum + mount.equipment.kgPerShot * (mount.getAmmoShots() ?? 0) / 1000 * modifier;
    }, 0);
    const exact = roundKg(structure + armor + turret + miscellaneous + weapons + ammo);
    return { trooper, structure, armor, turret, miscellaneous, weapons, ammo, exact };
  });
  const exact = suits.reduce((sum, suit) => sum + suit.exact, 0);
  return { suits, exact, rounded: roundKg(exact) };
}

export function calculateBattleArmorStructureWeight(entity: BattleArmorEntity): number {
  const weightClass = entity.declaredWeightClass();
  if (!(weightClass in WEIGHT_CLASS_INDEX)) {
    throw new Error(`Unsupported Battle Armor weight class: ${weightClass}`);
  }
  const index = WEIGHT_CLASS_INDEX[weightClass as keyof typeof WEIGHT_CLASS_INDEX];
  const chassisTable = entity.techBase() === 'Clan' && !entity.clanExoWithoutHarJel()
    ? CLAN_CHASSIS : IS_CHASSIS;
  const freeGroundMp = entity.chassisType().toLowerCase() === 'quad' ? 2 : 1;
  const ground = Math.max(0, entity.originalWalkMP() - freeGroundMp) * GROUND_MP[index];
  const motiveTable = entity.motiveType() === 'VTOL' ? VTOL_MP
    : entity.motiveType() === 'UMU' ? UMU_MP : JUMP_MP;
  return chassisTable[index] + ground + entity.propulsionMP() * motiveTable[index];
}

export function calculateTurretWeight(config: string): number {
  const match = /^(Standard|Modular|Configurable):(\d+)$/i.exec(config.trim());
  if (!match) return 0;
  const capacity = Number(match[2]);
  if (capacity <= 0) return 0;
  return capacity * 0.01 + 0.03 + (/^(Modular|Configurable)$/i.test(match[1]) ? 0.02 : 0);
}

function appliesToSuit(mount: EntityMountedEquipment, trooper: number): boolean {
  if (mount.location === 'Squad') return true;
  if (trooper === 0 || mount.location !== `Trooper ${trooper}`) return false;
  return mount.baMountLocation !== undefined;
}

function requireTonnage(entity: BattleArmorEntity, mount: EntityMountedEquipment): number {
  const tonnage = mount.getTonnage(entity);
  if (tonnage === undefined) {
    throw new Error(`Unable to calculate tonnage for ${mount.equipmentId} on ${entity.displayName()}`);
  }
  return tonnage;
}

function roundKg(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function ceilKg(value: number): number {
  return Math.ceil(Math.round(value * 1_000_000) / 1000) / 1000;
}