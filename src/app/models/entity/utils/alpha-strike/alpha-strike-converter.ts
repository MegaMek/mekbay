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

import { type BaseEntity, AeroEntity, ConvFighterEntity, FixedWingSupportEntity,
  BattleArmorEntity, InfantryEntity, MekEntity,
  VehicleEntity } from '../../entities';
import { AmmoEquipment, MiscEquipment, WeaponEquipment, ammoMatchesWeapon, getAmmoCategory } from '../../../equipment.model';
import type { AlphaStrikeArcStats, AlphaStrikeUnitStats, ASUnitTypeCode } from '../../../units.model';
import {
  CalculationReportBuilder,
  NULL_CALCULATION_REPORT,
  type CalculationReportEvent,
  type CalculationReportSink,
} from './report/calculation-report';
import {
  renderTextCalculationReport,
  type TextCalculationReportOptions,
} from './report/text-calculation-report-renderer';
import {
  AEROSPACE_EXPORT_TYPES,
  alphaStrikeSize,
  alphaStrikeUnitType,
  hasAlphaStrikeVstolCapability,
  isAerospaceElement,
  isFighter,
  usesArcs as alphaStrikeUsesArcs,
} from './foundation/unit-classification';
import {
  alphaStrikeMovement,
  type AlphaStrikeMovement,
  movementString,
  primaryTmmMovement,
  tmmForMovement,
} from './foundation/movement';
import {
  alphaStrikeArmor,
  alphaStrikeStructure,
  alphaStrikeThreshold,
} from './foundation/integrity';
import { alphaStrikeDamageFamily } from './damage/damage-dispatch';
import { dualRoundedUpDamage } from './damage/damage-rounding';
import { createEmptyArcs } from './damage/damage-types';
import { calculateBattleArmorStandardDamage } from './damage/battle-armor-damage';
import { calculateLargeAerospaceDamage } from './damage/large-aerospace-damage';
import {
  adjustAlphaStrikeDamageForHeat,
  alphaStrikeHeatCapacity,
  alphaStrikeMovementHeat,
  alphaStrikeWeaponHeat,
  type AlphaStrikeJumpSystem,
} from './damage/heat-adjustment';
import {
  baseBattleForceDamageForWeapon,
  battleForceDamageForMount,
  type AlphaStrikeRangeIndex,
} from './damage/weapon-damage-profile';
import { alphaStrikeCoreSpecials } from './specials/core-specials';

export { alphaStrikeSize, alphaStrikeUnitType } from './foundation/unit-classification';
export { tmmForMovement } from './foundation/movement';

type Damage = AlphaStrikeUnitStats['dmg'];
type ArcName = 'frontArc' | 'leftArc' | 'rightArc' | 'rearArc';

const ZERO_DAMAGE: Damage = { dmgS: '0', dmgM: '0', dmgL: '0', dmgE: '0' };

export interface AlphaStrikeConversionWithReport {
  readonly stats: AlphaStrikeUnitStats;
  readonly reportEvents: readonly CalculationReportEvent[];
  readonly report: string;
}

/** Pristine-conversion options. Alpha Strike skill is the pilot's Gunnery value. */
export interface AlphaStrikeConversionOptions {
  /** Gunnery skill; defaults to the standard skill 4. */
  readonly skill?: number;
  /** Optional structured calculation-report receiver. */
  readonly report?: CalculationReportSink;
}

export interface AlphaStrikeConversionReportOptions
  extends AlphaStrikeConversionOptions, TextCalculationReportOptions {}

/** Converts a pristine canonical entity to the Alpha Strike data exported by MegaMekLab. */
export function convertEntityToAlphaStrike(
  entity: BaseEntity,
  options: AlphaStrikeConversionOptions = {},
): AlphaStrikeUnitStats {
  const skill = resolveAlphaStrikeSkill(options.skill);
  const report = options.report ?? NULL_CALCULATION_REPORT;
  const TP = alphaStrikeUnitType(entity);
  const SZ = alphaStrikeSize(entity);
  const movement = alphaStrikeMovement(entity);
  const usesArcs = alphaStrikeUsesArcs(TP, SZ);
  const usesTh = isAerospaceElement(entity, TP);
  const usesE = usesTh;
  const Arm = alphaStrikeArmor(entity);
  const Str = alphaStrikeStructure(entity);
  const damage = alphaStrikeDamage(entity, TP, movement);
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
    Th: usesTh ? alphaStrikeThreshold(Arm, isFighter(entity, TP)) : -1,
    Arm,
    Str,
    specials: [...new Set([
      ...alphaStrikeSpecials(entity, TP, SZ),
      ...alphaStrikeCoreSpecials(entity, {
        type: TP,
        hasStandardDamage: Object.values(damage.standard).some(value => Number(value) > 0),
      }),
      ...(damage.overheatLong ? ['OVL'] : []),
    ])].sort(),
    dmg: damage.standard,
    usesE,
    usesArcs,
  };
  Object.assign(result, usesArcs ? { ...createEmptyArcs(), ...damage.arcs } : damage.arcs);
  writeConversionReport(entity, result, skill, report);
  return result;
}

/** Converts an entity and returns both serialized stats and a Java-compatible text report. */
export function convertEntityToAlphaStrikeWithReport(
  entity: BaseEntity,
  options: AlphaStrikeConversionReportOptions = {},
): AlphaStrikeConversionWithReport {
  const reportBuilder = new CalculationReportBuilder();
  const stats = convertEntityToAlphaStrike(entity, { ...options, report: reportBuilder });
  const reportEvents = reportBuilder.events();
  return {
    stats,
    reportEvents,
    report: renderTextCalculationReport(reportEvents, { eol: options.eol }),
  };
}

function resolveAlphaStrikeSkill(skill: number | undefined): number {
  const resolved = skill ?? 4;
  if (!Number.isInteger(resolved) || resolved < 0) {
    throw new RangeError('Alpha Strike skill must be a non-negative integer.');
  }
  return resolved;
}

function writeConversionReport(
  entity: BaseEntity,
  stats: AlphaStrikeUnitStats,
  skill: number,
  report: CalculationReportSink,
): void {
  const name = entity.displayName();
  if (name.length < 15) report.addHeader(`Alpha Strike Conversion for ${name}`);
  else report.addHeader('Alpha Strike Conversion for').addHeader(name);

  report.addEmptyLine().addSubHeader('Basic Info:')
    .addLine('Chassis:', entity.chassis())
    .addLine('Model:', entity.model())
    .addLine('MUL ID:', String(entity.mulId()))
    .addLine('Unit Role:', entity.role())
    .addLine('Unit Type:', alphaStrikeUnitTypeName(stats.TP), stats.TP)
    .addLine('Size:', alphaStrikeSizeDescription(stats.TP, stats.SZ), String(stats.SZ))
    .addLine('Skill:', '', String(skill))
    .addEmptyLine()
    .addSubHeader('Movement:')
    .addLine('Standard Movement', '', stats.MV);
  if (!AEROSPACE_EXPORT_TYPES.has(stats.TP)) {
    report.addLine('TMM', `of ${stats.MVm[stats.MVp] ?? 0}`, String(stats.TMM ?? 0));
  }

  writeIntegrityReport(report, 'Armor:', 'Final Armor Value', stats.Arm);
  writeIntegrityReport(report, 'Structure:', 'Structure', stats.Str);
  if (stats.usesTh) {
    report.addEmptyLine().addSubHeader('Threshold:')
      .addLine('Threshold', 'Armor / 3 / Arcs, round up', String(stats.Th));
  }

  report.addEmptyLine().addSubHeader('Damage Conversion:')
    .addLine('Final S damage:', '', stats.dmg.dmgS)
    .addLine('Final M damage:', '', stats.dmg.dmgM)
    .addLine('Final L damage:', '', stats.dmg.dmgL);
  if (stats.usesE) report.addLine('Final E damage:', '', stats.dmg.dmgE);
  if (stats.usesOV) report.addLine('Overheat:', '', String(stats.OV));
  report.addEmptyLine().addSubHeader('Weapon-based Special Abilities:')
    .addLine('None')
    .addEmptyLine().addSubHeader('Further Special Abilities:');
  if (stats.specials.length === 0) report.addLine('None');
  else stats.specials.forEach(special => report.addLine('', '', special));

  report.addEmptyLine().addSubHeader('Point Value:')
    .addResultLine('Base Point Value', 'round normal', String(stats.PV));
}

function writeIntegrityReport(
  report: CalculationReportSink,
  heading: string,
  label: string,
  value: number,
): void {
  report.addEmptyLine().addSubHeader(heading).addLine(label, '', String(value));
}

function alphaStrikeUnitTypeName(type: ASUnitTypeCode): string {
  const names: Partial<Record<ASUnitTypeCode, string>> = {
    BM: 'BattleMek', IM: 'Industrial Mek', CV: 'Combat Vehicle', SV: 'Support Vehicle',
    PM: 'ProtoMek', BA: 'Battle Armor', CI: 'Conventional Infantry', AF: 'Aerospace Fighter',
    CF: 'Conventional Fighter', SC: 'Small Craft', WS: 'WarShip', SS: 'Space Station',
    JS: 'JumpShip', DA: 'Aerodyne DropShip', DS: 'Spheroid DropShip',
  };
  return names[type] ?? 'Unknown';
}

function alphaStrikeSizeDescription(type: ASUnitTypeCode, size: number): string {
  if (type === 'CI' || type === 'BA') return 'Infantry';
  return `Size ${size}`;
}

function alphaStrikeDamage(
  entity: BaseEntity,
  TP: ASUnitTypeCode,
  movement: AlphaStrikeMovement,
): { standard: Damage; overheat: number; overheatLong?: boolean; arcs: Partial<Record<ArcName, AlphaStrikeArcStats>> } {
  const family = alphaStrikeDamageFamily(entity, TP);
  if (family === 'conventional-infantry') return conventionalInfantryDamage(entity as InfantryEntity);
  if (family === 'battle-armor') {
    return { standard: calculateBattleArmorStandardDamage(entity as BattleArmorEntity).standard, overheat: 0, arcs: {} };
  }
  if (family === 'arced') return arcedDamage(entity);

  const raw = sumWeaponDamage(entity, mount => isFrontWeapon(entity, mount.location, mount.rearMounted));
  if (family === 'generic') raw[3] = 0;
  const adjusted = applyHeatAdjustment(entity, TP, raw, movement);
  return {
    standard: damageVector(adjusted.front),
    overheat: adjusted.overheat,
    overheatLong: adjusted.overheatLong,
    arcs: {},
  };
}

function conventionalInfantryDamage(entity: InfantryEntity): { standard: Damage; overheat: number; arcs: {} } {
  const fieldGuns = entity.mountedWeapons().filter(mount => mount.location === 'Field Guns');
  const hasActiveFieldArtillery = fieldGuns.some(mount =>
    getAmmoCategory(mount.equipment.ammoType) === 'Artillery');
  if (fieldGuns.length > 0 && !hasActiveFieldArtillery) {
    const raw = sumWeaponDamage(entity, mount => mount.location === 'Field Guns');
    raw[3] = 0;
    return { standard: damageVector(raw), overheat: 0, arcs: {} };
  }

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
  const rounded = dualRoundedUpDamage(damage);
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
    if (entity instanceof MekEntity && ['LA', 'RA'].includes(mount.location)
      && entity.getEquipmentAtLocation(mount.location).some(candidate =>
        candidate.equipment?.hasFlag('F_ACTUATOR_ENHANCEMENT_SYSTEM'))) modifier *= 1.05;
    for (let index = 0; index < 4; index++) {
      total[index] += battleForceDamageForMount(entity, mount, index as AlphaStrikeRangeIndex) * modifier;
    }
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

function applyHeatAdjustment(
  entity: BaseEntity,
  TP: ASUnitTypeCode,
  raw: number[],
  movement: AlphaStrikeMovement,
): { front: [number, number, number, number]; overheat: number; overheatLong: boolean } {
  const front = raw as [number, number, number, number];
  if (!(TP === 'BM' || TP === 'IM' || TP === 'AF')) {
    return { front, overheat: 0, overheatLong: false };
  }
  const frontWeapons = entity.mountedWeapons().filter(mount => isFrontWeapon(entity, mount.location, mount.rearMounted));
  const mediumWeaponHeat = frontWeapons.reduce((sum, mount) => sum + mountedWeaponHeat(mount.equipment), 0);
  const longWeaponHeat = frontWeapons.reduce((sum, mount) =>
    sum + (baseBattleForceDamageForWeapon(mount.equipment, 2) > 0
      ? mountedWeaponHeat(mount.equipment)
      : 0), 0);
  let movementHeat = 0;
  let signatureHeat = 0;
  if (entity instanceof MekEntity) {
    movementHeat = alphaStrikeMovementHeat({
      jumpMove: movement.values['j'] ?? 0,
      jumpSystem: alphaStrikeJumpSystem(entity),
      xxlEngine: entity.mountedEngine().type() === 'XXL',
      industrial: entity.isIndustrial(),
      engineInstalled: entity.mountedEngine().installed,
      runHeat: entity.mountedEngine().movementHeat.run,
    });
    const hasStealthArmor = [...entity.armorByLocation().values()].some(armor =>
      armor.armor.hasFlag('F_STEALTH') || armor.armor.armorType === 'STEALTH');
    const hasSignature = hasStealthArmor || entity.equipment().some(mount =>
      mount.equipment?.hasAnyFlag(['F_STEALTH', 'F_VOID_SIG', 'F_NULL_SIG']));
    signatureHeat = (hasSignature ? 10 : 0) + (entity.equipment().some(mount =>
      mount.equipment?.hasFlag('F_CHAMELEON_SHIELD')) ? 6 : 0);
  } else if (entity instanceof AeroEntity && entity.equipment().some(mount =>
    mount.equipment?.hasFlag('F_STEALTH'))) {
    signatureHeat = 10;
  }
  const equipment = entity.equipment();
  const baseCapacity = entity instanceof MekEntity ? equipment.reduce((capacity, mount) => {
    const heatSink = mount.equipment;
    if (!(heatSink instanceof MiscEquipment) || !heatSink.isHeatSink) return capacity;
    const multiplier = heatSink.isCompactHeatSink || heatSink.hasFlag('F_HEAT_SINK') ? 1 : 2;
    return capacity + heatSink.heatSinkUnitsPerMount * multiplier;
  }, 0) : Math.max(0, entity.heatCapacity(false));
  const capacity = alphaStrikeHeatCapacity({
    baseCapacity,
    coolantPodCount: equipment.filter(mount => mount.equipment instanceof AmmoEquipment
      && mount.equipment.ammoType === 'COOLANT_POD').length,
    partialWing: equipment.some(mount => mount.equipment?.hasFlag('F_PARTIAL_WING')),
    radicalHeatSink: equipment.some(mount => mount.equipment?.hasFlag('F_RADICAL_HEATSINK')),
    emergencyCoolantSystem: equipment.some(mount => mount.equipment?.hasFlag('F_EMERGENCY_COOLANT_SYSTEM')),
  });
  const rearWeaponHeat = entity.mountedWeapons().reduce((sum, mount) =>
    sum + (!isFrontWeapon(entity, mount.location, mount.rearMounted)
      ? mountedWeaponHeat(mount.equipment)
      : 0), 0);
  return adjustAlphaStrikeDamageForHeat(front, {
    capacity,
    mediumFront: movementHeat + signatureHeat + mediumWeaponHeat,
    mediumRear: movementHeat + signatureHeat + rearWeaponHeat,
    longFront: movementHeat + signatureHeat + longWeaponHeat,
  });
}

function alphaStrikeJumpSystem(entity: MekEntity): AlphaStrikeJumpSystem {
  const jumpJet = entity.equipment().find(mount => mount.equipment?.hasFlag('F_JUMP_JET'))?.equipment;
  if (!jumpJet) return 'none';
  if (jumpJet.hasFlag('S_IMPROVED') && jumpJet.hasFlag('S_PROTOTYPE')) return 'prototype-improved';
  return jumpJet.hasFlag('S_IMPROVED') ? 'improved' : 'standard';
}

function mountedWeaponHeat(weapon: WeaponEquipment): number {
  return alphaStrikeWeaponHeat({
    equipmentId: weapon.id,
    twHeat: weapon.heat,
    ammoType: weapon.ammoType,
    oneShot: (weapon.oneShotCount ?? 0) > 0,
  });
}

function arcedDamage(entity: BaseEntity): { standard: Damage; overheat: number; arcs: Record<ArcName, AlphaStrikeArcStats> } {
  return calculateLargeAerospaceDamage(entity);
}

function damageVector(values: readonly number[]): Damage {
  return {
    dmgS: dualRoundedUpDamage(values[0] ?? 0),
    dmgM: dualRoundedUpDamage(values[1] ?? 0),
    dmgL: dualRoundedUpDamage(values[2] ?? 0),
    dmgE: dualRoundedUpDamage(values[3] ?? 0),
  };
}

function alphaStrikeSpecials(entity: BaseEntity, TP: ASUnitTypeCode, size: number): string[] {
  const specials: string[] = [];
  if (TP === 'SV' && size === 3) specials.push('LG');
  else if (TP === 'SV' && size === 4) specials.push('VLG');
  else if (TP === 'SV' && size === 5) specials.push('SLG');
  if (entity instanceof FixedWingSupportEntity || entity instanceof ConvFighterEntity) specials.push('ATMO');
  if (hasAlphaStrikeVstolCapability(entity, TP)) specials.push('VSTOL');
  return specials.sort();
}


