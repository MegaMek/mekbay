/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { type BaseEntity, AeroEntity, ConvFighterEntity, DropShipEntity, FixedWingSupportEntity, 
    SmallCraftEntity, BattleArmorEntity, InfantryEntity, JumpShipEntity, SpaceStationEntity, 
    WarShipEntity, MekEntity, LamEntity, QuadVeeEntity, ProtoMekEntity, VehicleEntity } from '../../entities';
import { AmmoEquipment, WeaponEquipment, ammoMatchesWeapon } from '../../../equipment.model';
import type { AlphaStrikeArcStats, AlphaStrikeUnitStats, ASUnitTypeCode } from '../../../units.model';
import { AS_MOVEMENT_CALCULATION } from '../../types';
import { infantryDamageDivisor } from '../battle-value/infantry-rules';

type MovementMap = Record<string, number>;
type Damage = AlphaStrikeUnitStats['dmg'];
type ArcName = 'frontArc' | 'leftArc' | 'rightArc' | 'rearArc';

const ZERO_DAMAGE: Damage = { dmgS: '0', dmgM: '0', dmgL: '0', dmgE: '0' };
const AEROSPACE_EXPORT_TYPES = new Set<ASUnitTypeCode>(['AF', 'CF', 'SC', 'DS', 'DA', 'SS', 'JS', 'WS']);
const LARGE_AEROSPACE_TYPES = new Set<ASUnitTypeCode>(['SC', 'DS', 'DA', 'SS', 'JS', 'WS']);

/** Converts a pristine canonical entity to the Alpha Strike data exported by MegaMekLab. */
export function convertEntityToAlphaStrike(entity: BaseEntity): AlphaStrikeUnitStats {
  const TP = alphaStrikeUnitType(entity);
  const SZ = alphaStrikeSize(entity);
  const movement = alphaStrikeMovement(entity, TP);
  const usesArcs = LARGE_AEROSPACE_TYPES.has(TP) || (TP === 'SV' && SZ >= 3);
  const usesTh = isAerospaceElement(entity, TP);
  const usesE = usesTh;
  const Arm = alphaStrikeArmor(entity);
  const Str = alphaStrikeStructure(entity);
  const damage = alphaStrikeDamage(entity, TP, usesArcs);
  const result: AlphaStrikeUnitStats = {
    TP,
    PV: 0,
    SZ,
    TMM: AEROSPACE_EXPORT_TYPES.has(TP) ? null
      : isAerospaceElement(entity, TP) ? 0
      : tmmForMovement(primaryTmmMovement(entity, movement)),
    usesOV: TP === 'BM' || TP === 'IM' || TP === 'AF',
    OV: damage.overheat,
    MV: movementString(TP, movement.values),
    MVm: movement.values,
    MVp: movement.primary,
    usesTh,
    Th: usesTh ? alphaStrikeRoundUp(Arm / 3 / (isFighter(entity, TP) ? 1 : 4)) : -1,
    Arm,
    Str,
    specials: alphaStrikeSpecials(entity, TP, SZ),
    dmg: damage.standard,
    usesE,
    usesArcs,
  };
  Object.assign(result, damage.arcs);
  return result;
}

export function alphaStrikeUnitType(entity: BaseEntity): ASUnitTypeCode {
  if (entity instanceof MekEntity) return entity.isIndustrial() ? 'IM' : 'BM';
  if (entity instanceof ProtoMekEntity) return 'PM';
  if (entity instanceof VehicleEntity) return entity.isSupportVehicle() ? 'SV' : 'CV';
  if (entity instanceof BattleArmorEntity) return 'BA';
  if (entity instanceof InfantryEntity) return 'CI';
  if (entity instanceof SpaceStationEntity) return 'SS';
  if (entity instanceof WarShipEntity) return 'WS';
  if (entity instanceof JumpShipEntity) return 'JS';
  if (entity instanceof DropShipEntity) return entity.motiveType() === 'Spheroid' ? 'DS' : 'DA';
  if (entity instanceof SmallCraftEntity) return 'SC';
  if (entity instanceof FixedWingSupportEntity) return 'SV';
  if (entity instanceof ConvFighterEntity) return 'CF';
  if (entity instanceof AeroEntity) return 'AF';
  return 'UNKNOWN';
}

export function alphaStrikeSize(entity: BaseEntity): number {
  const tons = entity.tonnage();
  if (entity instanceof VehicleEntity && entity.isSupportVehicle()) {
    if (tons < 5) return 1;
    const limits: Partial<Record<string, readonly number[]>> = {
      Tracked: [100, 200], Wheeled: [80, 160], Hover: [50, 100],
      Naval: [300, 6000, 30000], Hydrofoil: [300, 6000, 30000],
      Submarine: [300, 6000, 30000], WiGE: [80, 240], Rail: [300, 600],
      Airship: [300, 600, 900], VTOL: [30, 60],
    };
    const [medium = 0, large = 0, veryLarge = 0] = limits[entity.motiveType()] ?? [];
    if (tons <= medium) return 2;
    if (tons <= large) return 3;
    if (veryLarge === 0 || tons <= veryLarge) return 4;
    return 5;
  }
  if (entity instanceof InfantryEntity || entity instanceof BattleArmorEntity) return 1;
  if (entity instanceof WarShipEntity) return tons < 500_000 ? 1 : tons < 800_000 ? 2 : tons < 1_200_000 ? 3 : 4;
  if (entity instanceof JumpShipEntity) return tons < 100_000 ? 1 : tons < 300_000 ? 2 : 3;
  if (entity instanceof SmallCraftEntity) return tons < 2_500 ? 1 : tons < 10_000 ? 2 : 3;
  if (entity instanceof FixedWingSupportEntity) return tons < 5 ? 1 : tons <= 100 ? 2 : 3;
  if (entity instanceof AeroEntity) return tons < 50 ? 1 : tons < 75 ? 2 : 3;
  return tons < 40 ? 1 : tons < 60 ? 2 : tons < 80 ? 3 : 4;
}

function alphaStrikeMovement(entity: BaseEntity, TP: ASUnitTypeCode): { values: MovementMap; primary: string } {
  if (entity instanceof AeroEntity) {
    if (entity instanceof WarShipEntity) return { values: { '': entity.walkMP() }, primary: '' };
    if (entity instanceof JumpShipEntity) return { values: { k: 2 }, primary: 'k' };
    const primary = movementCode(entity);
    return { values: { [primary]: entity.walkMP() }, primary };
  }

  if (entity instanceof InfantryEntity || entity instanceof BattleArmorEntity) {
    const walk = entity.computeWalkMP(AS_MOVEMENT_CALCULATION);
    const jump = entity.computeJumpMP(AS_MOVEMENT_CALCULATION);
    const code = movementCode(entity);
    const values: MovementMap = {};
    const minimalWalk = entity instanceof InfantryEntity && walk === 0;
    const walkMove = minimalWalk ? 2 : minimumConvertedMovement(walk * 2);
    const jumpMove = minimumConvertedMovement(jump * 2);
    let primary = code;
    if (walk > jump || jump === 0) values[code] = walkMove;
    else {
      primary = code === 'v' ? code : 'j';
      values[primary] = jumpMove;
    }
    addUmuMovement(values, entity);
    return { values, primary };
  }

  let walk = entity.originalWalkMP();
  const equipment = entity.equipment();
  const hasSupercharger = equipment.some(mount => mount.equipment?.hasFlag('F_MASC') && mount.equipment.hasFlag('S_SUPERCHARGER'));
  const hasMasc = entity instanceof MekEntity && equipment.some(mount => mount.equipment?.hasFlag('F_MASC') && !mount.equipment.hasFlag('S_SUPERCHARGER'));
  const hasSingleBooster = hasSupercharger || hasMasc
    || equipment.some(mount => mount.equipment?.hasFlag('F_JET_BOOSTER'))
    || (entity instanceof ProtoMekEntity && equipment.some(mount => mount.equipment?.hasFlag('F_MASC')));
  if (hasSupercharger && hasMasc) walk *= 1.5;
  else if (hasSingleBooster) walk *= 1.25;
  walk = Math.round(walk);
  if (entity instanceof MekEntity && entity.locationOrder.some(location =>
    entity.locationIsLeg(location) && entity.armorAt(location).type === 'HARDENED')) walk--;
  if (equipment.some(mount => mount.equipment?.hasFlag('F_MODULAR_ARMOR'))) walk--;
  if (equipment.some(mount => mount.equipment?.hasFlag('F_CLUB')
    && mount.equipment.hasAnyFlag(['S_SHIELD_LARGE', 'S_SHIELD_MEDIUM']))) walk--;
  const baseMove = Math.max(0, Math.round(walk) * 2);
  const jumpMove = entity.computeJumpMP({ ...AS_MOVEMENT_CALCULATION, includeAlternateJumpSystems: true }) * 2;
  const code = movementCode(entity);
  const values: MovementMap = {};
  let primary = code;
  if (jumpMove === baseMove && jumpMove > 0 && code === '') {
    values['j'] = baseMove;
    primary = 'j';
  } else {
    values[code] = baseMove;
    if (jumpMove > 0) values['j'] = jumpMove;
  }
  addUmuMovement(values, entity);
  if (Object.keys(values).length > 1) primary = code;
  if (entity instanceof LamEntity) {
    values['a'] = entity.computeJumpMP(AS_MOVEMENT_CALCULATION);
    if (entity.lamType().toLowerCase() !== 'bimodal') {
      values['g'] = entity.computeJumpMP(AS_MOVEMENT_CALCULATION) * 6;
    }
  }
  return { values, primary };
}

function movementCode(entity: BaseEntity): string {
  if (entity instanceof QuadVeeEntity) return entity.motiveType() === 'Track' ? 'qt' : 'qw';
  const motiveType = entity instanceof InfantryEntity && entity.mount()
    ? entity.mount()!.movementMode
    : entity.motiveType();
  switch (motiveType) {
    case 'None': case 'Biped': case 'Quad': case 'Tripod': return '';
    case 'Track': case 'Tracked': return 't';
    case 'Wheel': case 'Wheeled': return 'w';
    case 'Hover': return 'h';
    case 'VTOL': return 'v';
    case 'Naval': case 'Hydrofoil': return 'n';
    case 'Submarine': case 'UMU': return 's';
    case 'Leg': return 'f';
    case 'Motorized': return 'm';
    case 'Jump': return entity.jumpMP() > 0 ? 'j' : 'f';
    case 'WiGE': return 'g';
    case 'Rail': return 'r';
    case 'Aerodyne': case 'Aerospace': return 'a';
    case 'Spheroid': return 'p';
    default: return 'ERROR';
  }
}

function addUmuMovement(values: MovementMap, entity: BaseEntity): void {
  if (entity.umuMP() > 0) values['s'] = entity.umuMP() * 2;
}

function minimumConvertedMovement(value: number): number {
  return value > 0 ? Math.max(value, 2) : value;
}

function primaryTmmMovement(entity: BaseEntity, movement: { values: MovementMap; primary: string }): number {
  let value = movement.values[movement.primary] ?? 0;
  if (entity instanceof InfantryEntity || entity instanceof BattleArmorEntity) {
    const alternative = Object.entries(movement.values).find(([mode]) => mode !== 'f');
    if (alternative) value = alternative[1];
  }
  return value;
}

export function tmmForMovement(movement: number): number {
  return movement > 34 ? 5 : movement > 18 ? 4 : movement > 12 ? 3 : movement > 8 ? 2 : movement > 4 ? 1 : 0;
}

function movementString(TP: ASUnitTypeCode, movement: MovementMap): string {
  return Object.entries(movement)
    .filter(([mode]) => TP !== 'BM' || (mode !== 'a' && mode !== 'g'))
    .map(([mode, value]) => {
    if (mode === 'k') return `0.${value}k`;
    if (mode === 'a' || mode === 'p') return `${value}${mode}`;
    if (['DS', 'WS', 'DA', 'JS', 'SS'].includes(TP) && mode === '') return String(value);
    return `${value}\"${mode}`;
    }).join('/');
}

function alphaStrikeArmor(entity: BaseEntity): number {
  if (entity instanceof InfantryEntity) {
    let divisor = infantryDamageDivisor(entity);
    if (['Tracked', 'Wheeled', 'Hover', 'VTOL', 'Submarine'].includes(entity.motiveType())) divisor /= 2;
    return Math.round(divisor / 15 * entity.totalInternalPoints());
  }
  if (entity instanceof BattleArmorEntity) return Math.round(entity.totalArmorPoints() / 30);
  let points = 0;
  for (const [location, armor] of entity.armorValues()) {
    if (!armor || (armor.front <= 0 && armor.rear <= 0)) continue;
    const type = entity.armorByLocation().get(location)?.type ?? entity.uniformArmor()?.type ?? 'STANDARD';
    let modifier = type === 'COMMERCIAL' ? 0.5 : type === 'FERRO_LAMELLOR' ? 1.2 : type === 'HARDENED' ? 2 : 1;
    if (entity.isSupportVehicle() && entity.barRating() < 9 && type !== 'COMMERCIAL') modifier *= entity.barRating() / 10;
    points += Math.max(0, armor.front * modifier) + Math.max(0, armor.rear * modifier);
  }
  points += entity.equipment().filter(mount => mount.equipment?.hasFlag('F_MODULAR_ARMOR')).length * 10;
  return entity instanceof JumpShipEntity ? Math.round(points * 0.33) : Math.round(points / 30);
}

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

function alphaStrikeStructure(entity: BaseEntity): number {
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
  if (entity instanceof VehicleEntity) {
    let divisor = 10;
    if (entity.isSupportVehicle() && ['Naval', 'Hydrofoil', 'Submarine'].includes(entity.motiveType())) {
      const tons = entity.tonnage();
      divisor = tons >= 30000.5 ? 35 : tons >= 12000.5 ? 30 : tons >= 6000.5 ? 25
        : tons >= 500.5 ? 20 : tons >= 300.5 ? 15 : 10;
    }
    const internalPoints = !entity.isSupportVehicle() && entity.isSuperHeavy()
      ? entity.totalInternalPoints() - 1
      : entity.totalInternalPoints();
    return Math.ceil(internalPoints / divisor);
  }
  if (entity instanceof AeroEntity) return Math.ceil(entity.structuralIntegrity() * 0.5);
  return -1;
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

function isAerospaceElement(entity: BaseEntity, TP: ASUnitTypeCode): boolean {
  return AEROSPACE_EXPORT_TYPES.has(TP) || entity instanceof FixedWingSupportEntity;
}

function isFighter(entity: BaseEntity, TP: ASUnitTypeCode): boolean {
  return TP === 'AF' || TP === 'CF' || entity instanceof FixedWingSupportEntity;
}

function alphaStrikeRoundUp(value: number): number {
  return Math.round(value + 0.4);
}

function alphaStrikeDamage(
  entity: BaseEntity,
  TP: ASUnitTypeCode,
  usesArcs: boolean,
): { standard: Damage; overheat: number; arcs: Partial<Record<ArcName, AlphaStrikeArcStats>> } {
  if (entity instanceof InfantryEntity) return conventionalInfantryDamage(entity);
  if (entity instanceof BattleArmorEntity) return battleArmorDamage(entity);
  if (usesArcs) return arcedDamage(entity);

  const raw = sumWeaponDamage(entity, mount => isFrontWeapon(entity, mount.location, mount.rearMounted));
  const adjusted = applyHeatAdjustment(entity, TP, raw);
  return { standard: damageVector(adjusted.values), overheat: adjusted.overheat, arcs: {} };
}

function conventionalInfantryDamage(entity: InfantryEntity): { standard: Damage; overheat: number; arcs: {} } {
  const weapon = entity.rangeWeapon();
  if (!weapon?.infantry) return { standard: ZERO_DAMAGE, overheat: 0, arcs: {} };
  const troopFactors = [0,0,1,2,3,3,4,4,5,5,6,7,8,8,9,9,10,10,11,11,12,13,14,15,16,16,17,17,17,18,18];
  const factor = troopFactors[Math.min(entity.totalInternalPoints(), 30)];
  const primary = entity.primaryWeapon();
  const secondary = entity.secondaryWeapon();
  const secondaryCount = entity.secondaryCount();
  const squadSize = Math.max(entity.squadSize(), 1);
  const primaryDamage = Math.min(0.6, primary?.infantry.damage ?? 0);
  const damagePerTrooper = (
    primaryDamage * Math.max(0, squadSize - secondaryCount)
    + (secondary?.infantry.damage ?? 0) * secondaryCount
  ) / squadSize;
  const damage = damagePerTrooper * factor / 10;
  const rounded = asDamage(damage);
  const range = weapon.infantry.range * 3;
  return {
    standard: {
      dmgS: rounded,
      dmgM: range > 3 ? rounded : '0',
      dmgL: range > 15 ? rounded : '0',
      dmgE: '0',
    },
    overheat: 0,
    arcs: {},
  };
}

function sumWeaponDamage(
  entity: BaseEntity,
  include: (mount: ReturnType<BaseEntity['mountedWeapons']>[number]) => boolean,
): number[] {
  const weapons = entity.mountedWeapons();
  const targetingComputer = entity.equipment().some(mount => mount.equipment?.hasFlag('F_TARGETING_COMPUTER'));
  const ammo = entity.equipment().filter(mount => mount.equipment instanceof AmmoEquipment);
  return weapons.reduce((total, mount) => {
    if (!include(mount) || mount.equipment.hasFlag('F_ARTILLERY')) return total;
    const weapon = mount.equipment;
    let modifier = ammoModifier(weapon, weapons, ammo);
    if (weapon.oneShotCount && weapon.id !== 'CLFussilade') modifier *= 0.1;
    if (targetingComputer && weapon.hasFlag('F_DIRECT_FIRE')) modifier *= 1.1;
    for (let index = 0; index < 4; index++) total[index] += battleForceDamage(weapon, index) * modifier;
    return total;
  }, [0, 0, 0, 0]);
}

function ammoModifier(
  weapon: WeaponEquipment,
  weapons: readonly ReturnType<BaseEntity['mountedWeapons']>[number][],
  ammo: readonly ReturnType<BaseEntity['equipment']>[number][],
): number {
  if (weapon.ammoType === 'NA' || weapon.oneShotCount) return 1;
  const weaponCount = weapons.filter(mount => mount.equipment.id === weapon.id).length;
  const shots = ammo.reduce((sum, mount) => mount.equipment instanceof AmmoEquipment
    && ammoMatchesWeapon(weapon, mount.equipment) ? sum + (mount.getAmmoShots() ?? 0) : sum, 0);
  const divisor = weapon.ammoType === 'AC_ROTARY' ? 6
    : weapon.ammoType === 'AC_ULTRA' || weapon.ammoType === 'AC_ULTRA_THB' ? 2 : 1;
  return shots / Math.max(weaponCount, 1) >= 10 * divisor ? 1 : shots > 0 ? 0.75 : 0;
}

function isFrontWeapon(entity: BaseEntity, location: string, rearMounted: boolean): boolean {
  if (rearMounted) return false;
  if (entity instanceof AeroEntity && location === 'Aft') return false;
  if (entity instanceof VehicleEntity && location === 'Rear') return false;
  return true;
}

function applyHeatAdjustment(entity: BaseEntity, TP: ASUnitTypeCode, raw: number[]): { values: number[]; overheat: number } {
  if (!(TP === 'BM' || TP === 'IM' || TP === 'AF')) return { values: raw, overheat: 0 };
  const frontWeapons = entity.mountedWeapons().filter(mount => isFrontWeapon(entity, mount.location, mount.rearMounted));
  const weaponHeat = frontWeapons.reduce((sum, mount) => {
    if (mount.equipment.oneShotCount) return sum;
    const multiplier = mount.equipment.ammoType === 'AC_ROTARY' ? 6
      : mount.equipment.ammoType === 'AC_ULTRA' || mount.equipment.ammoType === 'AC_ULTRA_THB' ? 2 : 1;
    return sum + mount.equipment.heat * multiplier;
  }, 0);
  let movementHeat = 0;
  if (entity instanceof MekEntity) {
    movementHeat = entity.jumpMP() > 0 ? Math.max(3, entity.jumpMP())
      : entity.isIndustrial() || !entity.mountedEngine().installed ? 0 : entity.mountedEngine().movementHeat.run;
  }
  const heat = weaponHeat + movementHeat;
  let capacity = Math.max(0, entity.heatCapacity(false));
  capacity += entity.equipment().filter(mount => mount.equipment instanceof AmmoEquipment
    && mount.equipment.ammoType === 'COOLANT_POD').length;
  if (entity.equipment().some(mount => mount.equipment?.hasFlag('F_PARTIAL_WING'))) capacity += 3;
  if (entity.equipment().some(mount => mount.equipment?.hasFlag('F_RADICAL_HEATSINK'))) capacity++;
  if (entity.equipment().some(mount => mount.equipment?.hasFlag('F_EMERGENCY_COOLANT_SYSTEM'))) capacity++;
  if (heat - 4 <= capacity) return { values: raw, overheat: 0 };
  const factor = capacity / (heat - 4);
  const adjusted = raw.map(value => value * factor);
  const rawDamage = alphaStrikeRoundUp(roundUpToTenth(raw[1] || raw[0]));
  const adjustedDamage = alphaStrikeRoundUp(roundUpToTenth(adjusted[1] || adjusted[0]));
  return { values: adjusted, overheat: Math.min(Math.max(0, rawDamage - adjustedDamage), 4) };
}

function arcedDamage(entity: BaseEntity): { standard: Damage; overheat: number; arcs: Record<ArcName, AlphaStrikeArcStats> } {
  const arcDefinitions: readonly [ArcName, (location: string, rear: boolean) => number][] = [
    ['frontArc', (location, rear) => arcMultiplier(entity, 0, location, rear)],
    ['leftArc', (location, rear) => arcMultiplier(entity, 1, location, rear)],
    ['rightArc', (location, rear) => arcMultiplier(entity, 2, location, rear)],
    ['rearArc', (location, rear) => arcMultiplier(entity, 3, location, rear)],
  ];
  const arcs = Object.fromEntries(arcDefinitions.map(([name, multiplier]) => {
    const damage = entity.mountedWeapons().reduce((sum, mount) => {
      const factor = multiplier(mount.location, mount.rearMounted);
      if (factor === 0) return sum;
      for (let index = 0; index < 4; index++) sum[index] += battleForceDamage(mount.equipment, index) * factor;
      return sum;
    }, [0, 0, 0, 0]);
    return [name, emptyArc(damageVector(damage))];
  })) as Record<ArcName, AlphaStrikeArcStats>;
  return { standard: ZERO_DAMAGE, overheat: 0, arcs };
}

function arcMultiplier(entity: BaseEntity, arc: number, location: string, rear: boolean): number {
  if (entity instanceof WarShipEntity) {
    if (arc === 0) return ['Nose', 'FLS', 'FRS'].includes(location) ? 1 : 0;
    if (arc === 1) return ['Left Broadside', 'ALS'].includes(location) ? 1 : 0;
    if (arc === 2) return ['Right Broadside', 'ARS'].includes(location) ? 1 : 0;
    return location === 'Aft' ? 1 : 0;
  }
  if (entity instanceof JumpShipEntity) {
    if (arc === 0) return location === 'Nose' ? 1 : ['FLS', 'FRS'].includes(location) ? 0.5 : 0;
    if (arc === 1) return ['FLS', 'ALS'].includes(location) ? 0.5 : 0;
    if (arc === 2) return ['FRS', 'ARS'].includes(location) ? 0.5 : 0;
    return location === 'Aft' ? 1 : ['ALS', 'ARS'].includes(location) ? 0.5 : 0;
  }
  if (entity instanceof SmallCraftEntity) {
    if (arc === 0) return location === 'Nose' ? 1 : entity.motiveType() === 'Spheroid'
      && ['Left Wing', 'Right Wing'].includes(location) && !rear ? 0.5 : 0;
    if (arc === 1 || arc === 2) {
      const side = arc === 1 ? 'Left Wing' : 'Right Wing';
      return location === side && !rear ? entity.motiveType() === 'Spheroid' ? 0.5 : 1 : 0;
    }
    return location === 'Aft' ? 1 : rear && ['Left Wing', 'Right Wing'].includes(location)
      ? entity.motiveType() === 'Spheroid' ? 0.5 : 1 : 0;
  }
  return arc === 0 && location !== 'Rear' ? 1 : arc === 3 && location === 'Rear' ? 1 : 0;
}

function emptyArc(STD: Damage): AlphaStrikeArcStats {
  return { STD, CAP: { ...ZERO_DAMAGE }, SCAP: { ...ZERO_DAMAGE }, MSL: { ...ZERO_DAMAGE }, specials: '' };
}

function damageVector(values: readonly number[]): Damage {
  return { dmgS: asDamage(values[0]), dmgM: asDamage(values[1]), dmgL: asDamage(values[2]), dmgE: asDamage(values[3]) };
}

function asDamage(value = 0): string {
  const roundedTenth = roundUpToTenth(value);
  if (roundedTenth > 0 && roundedTenth < 0.5) return '0*';
  return String(roundedTenth < 0.5 ? 0 : alphaStrikeRoundUp(roundedTenth));
}

function roundUpToTenth(value: number): number {
  return Math.ceil((value - 0.0000001) * 10) / 10;
}

function alphaStrikeSpecials(entity: BaseEntity, TP: ASUnitTypeCode, size: number): string[] {
  const specials: string[] = [];
  if (TP === 'SV' && size === 3) specials.push('LG');
  else if (TP === 'SV' && size === 4) specials.push('VLG');
  else if (TP === 'SV' && size === 5) specials.push('SLG');
  if (entity instanceof FixedWingSupportEntity || entity instanceof ConvFighterEntity) specials.push('ATMO');
  return specials.sort();
}

function battleForceDamage(weapon: WeaponEquipment, alphaStrikeRange: number): number {
  const range = [0, 4, 16, 24][alphaStrikeRange];
  if (range > (weapon.ranges[2] ?? 0)) return 0;

  let avIndex = alphaStrikeRange;
  while (avIndex > 0 && (weapon.weapon.av[avIndex] ?? 0) === 0) avIndex--;
  let damage = weapon.weapon.av[avIndex] ?? 0;
  if (damage === 0) {
    if (typeof weapon.damage === 'number' && weapon.damage >= 0) damage = weapon.damage;
    else if (weapon.damage === 'cluster') {
      damage = weapon.rackSize * (weapon.hasFlag('F_SRM') || weapon.ammoType === 'MML' ? 2 : 0.6);
    }
  }
  if (range === 0 && weapon.minimumRange > 0) damage *= (12 - weapon.minimumRange) / 12;
  const toHitModifier = typeof weapon.toHitModifier === 'number'
    ? weapon.toHitModifier
    : weapon.toHitModifier[0] ?? 0;
  if (toHitModifier !== 0) damage -= damage * toHitModifier * 0.05;
  return damage / 10;
}

function battleArmorDamage(entity: BattleArmorEntity): { standard: Damage; overheat: number; arcs: {} } {
  const troopFactors = [0,0,1,2,3,3,4,4,5,5,6,7,8,8,9,9,10,10,11,11,12,13,14,15,16,16,17,17,17,18,18];
  const troopFactor = troopFactors[Math.min(entity.trooperCount(), 30)] + 0.5;
  const normal = sumWeaponDamage(entity, mount => !mount.isAPM && !mount.isSSWM);
  const squadSupport = sumWeaponDamage(entity, mount => !!mount.isSSWM);
  const equipment = entity.equipment();
  if (equipment.some(mount => mount.equipment?.hasFlag('F_ARMORED_GLOVE'))) normal[0] += 0.1;
  else if (equipment.some(mount => mount.equipment?.hasFlag('F_AP_MOUNT'))) normal[0] += 0.05;
  const vibroclaws = equipment.filter(mount => mount.equipment?.hasFlag('F_VIBROCLAW')).length;
  const values = normal.map((value, index) => value * troopFactor + squadSupport[index]);
  values[0] += vibroclaws * 0.1;
  return { standard: damageVector(values), overheat: 0, arcs: {} };
}