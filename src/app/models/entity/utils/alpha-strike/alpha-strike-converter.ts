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

import { type BaseEntity, AeroEntity, BattleArmorEntity, InfantryEntity, MekEntity } from '../../entities';
import { WeaponEquipment } from '../../../equipment.model';
import type { AlphaStrikeUnitStats, ASUnitTypeCode } from '../../../units.model';
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
import { toStandardDamage } from './damage/damage-rounding';
import { createEmptyArcs, type AlphaStrikeStandardDamageResult } from './damage/damage-types';
import { calculateBattleArmorStandardDamage } from './damage/battle-armor-damage';
import { calculateConventionalInfantryDamage } from './damage/conventional-infantry-damage';
import { alphaStrikeDamageLocationMultiplier } from './damage/generic-location-mapper';
import { alphaStrikeHeatSpecial, sumAlphaStrikeHeatDamage } from './damage/heat-damage';
import { calculateLargeAerospaceDamage } from './damage/large-aerospace-damage';
import { alphaStrikeHeatCapacityForEntity } from './damage/heat-capacity';
import {
  adjustAlphaStrikeDamageForHeat,
  alphaStrikeMovementHeat,
  alphaStrikeWeaponHeatForConversion,
  type AlphaStrikeJumpSystem,
} from './damage/heat-adjustment';
import {
  baseBattleForceDamageForWeapon,
} from './damage/weapon-damage-profile';
import { sumAlphaStrikeWeaponDamage } from './damage/weapon-damage-aggregation';
import { alphaStrikeSpecialsForEntity } from './specials/specials-converter';
import { calculateAlphaStrikePointValue } from './point-value/point-value-calculator';

export { alphaStrikeSize, alphaStrikeUnitType } from './foundation/unit-classification';
export { tmmForMovement } from './foundation/movement';

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
    specials: alphaStrikeSpecialsForEntity(entity, {
      type: TP,
      size: SZ,
      movement,
      usesArcs,
      usesArcedDamage: alphaStrikeDamageFamily(entity, TP) === 'arced',
      hasStandardDamage: Object.values(damage.standard).some(value => value !== '0' && value !== '-'),
      heatSpecials: damage.heatSpecials,
      overheatLong: damage.overheatLong ?? false,
      specialDamageHeatFactors: damage.specialDamageHeatFactors,
      rearSpecialDamageHeatFactors: damage.rearSpecialDamageHeatFactors,
    }),
    dmg: damage.standard,
    usesE,
    usesArcs,
  };
  Object.assign(result, usesArcs ? { ...createEmptyArcs(), ...damage.arcs } : damage.arcs);
  result.PV = calculateAlphaStrikePointValue(result, skill);
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
): AlphaStrikeStandardDamageResult {
  const family = alphaStrikeDamageFamily(entity, TP);
  if (family === 'conventional-infantry') return calculateConventionalInfantryDamage(entity as InfantryEntity);
  if (family === 'battle-armor') {
    const battleArmor = calculateBattleArmorStandardDamage(entity as BattleArmorEntity);
    const rawHeat = sumAlphaStrikeHeatDamage(entity.mountedWeapons(), mount =>
      !mount.isSSWM && isBattleArmorRepresentativeLocation(mount.location));
    const heatSpecial = alphaStrikeHeatSpecial(rawHeat.map(value =>
      Math.floor(value * battleArmor.breakdown.troopFactor)) as [number, number, number]);
    return {
      standard: battleArmor.standard,
      overheat: 0,
      arcs: {},
      heatSpecials: heatSpecial ? [heatSpecial] : [],
    };
  }
  if (family === 'arced') return { ...calculateLargeAerospaceDamage(entity), heatSpecials: [] };

  const raw = sumAlphaStrikeWeaponDamage(entity, mount =>
    alphaStrikeDamageLocationMultiplier(entity, 'standard', mount) > 0,
  family === 'aerospace');
  if (family === 'generic') raw[3] = 0;
  const adjusted = applyHeatAdjustment(entity, TP, raw, movement);
  const heatSpecial = alphaStrikeHeatSpecial(sumAlphaStrikeHeatDamage(entity.mountedWeapons(), mount =>
    alphaStrikeDamageLocationMultiplier(entity, 'standard', mount) > 0));
  return {
    standard: toStandardDamage(adjusted.front),
    overheat: adjusted.overheat,
    overheatLong: adjusted.overheatLong,
    specialDamageHeatFactors: adjusted.specialDamageHeatFactors,
    rearSpecialDamageHeatFactors: adjusted.rearSpecialDamageHeatFactors,
    arcs: {},
    heatSpecials: heatSpecial ? [heatSpecial] : [],
  };
}

function isBattleArmorRepresentativeLocation(location: string): boolean {
  return location === 'Squad' || location === 'Trooper 1';
}

function applyHeatAdjustment(
  entity: BaseEntity,
  TP: ASUnitTypeCode,
  raw: number[],
  movement: AlphaStrikeMovement,
): {
  front: [number, number, number, number];
  overheat: number;
  overheatLong: boolean;
  specialDamageHeatFactors: [number, number, number, number];
  rearSpecialDamageHeatFactors: [number, number, number, number];
} {
  const front = raw as [number, number, number, number];
  if (!(TP === 'BM' || TP === 'IM' || TP === 'AF')) {
    return {
      front, overheat: 0, overheatLong: false,
      specialDamageHeatFactors: [1, 1, 1, 1],
      rearSpecialDamageHeatFactors: [1, 1, 1, 1],
    };
  }
  const frontWeapons = entity.mountedWeapons().filter(mount =>
    alphaStrikeDamageLocationMultiplier(entity, 'standard', mount) > 0);
  const mediumWeaponHeat = frontWeapons.reduce((sum, mount) =>
    sum + alphaStrikeWeaponHeatForConversion(mount.equipment), 0);
  const longWeaponHeat = frontWeapons.reduce((sum, mount) =>
    sum + (countsForAlphaStrikeLongRangeHeat(mount.equipment)
      ? alphaStrikeWeaponHeatForConversion(mount.equipment)
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
  const baseCapacity = Math.max(0, entity instanceof MekEntity
    ? entity.alphaStrikeBaseHeatCapacity()
    : entity.heatCapacity(false));
  const capacity = alphaStrikeHeatCapacityForEntity(entity, baseCapacity);
  const rearWeaponHeat = entity.mountedWeapons().reduce((sum, mount) =>
    sum + (alphaStrikeDamageLocationMultiplier(entity, 'rear', mount) > 0
      ? alphaStrikeWeaponHeatForConversion(mount.equipment)
      : 0), 0);
  const adjusted = adjustAlphaStrikeDamageForHeat(front, {
    capacity,
    mediumFront: movementHeat + signatureHeat + mediumWeaponHeat,
    mediumRear: movementHeat + signatureHeat + rearWeaponHeat,
    longFront: movementHeat + signatureHeat + longWeaponHeat,
  });
  const longFactor = adjusted.overheatLong ? adjusted.factors.mediumFront : adjusted.factors.longFront;
  return {
    ...adjusted,
    specialDamageHeatFactors: [
      adjusted.factors.mediumFront,
      adjusted.factors.mediumFront,
      longFactor,
      longFactor,
    ],
    rearSpecialDamageHeatFactors: [
      adjusted.factors.mediumRear,
      adjusted.factors.mediumRear,
      longFactor,
      longFactor,
    ],
  };
}

function countsForAlphaStrikeLongRangeHeat(weapon: WeaponEquipment): boolean {
  return baseBattleForceDamageForWeapon(weapon, 2) > 0
    || (weapon.techBase === 'Clan' && weapon.hasFlag('F_PLASMA') && weapon.damage === 'variable');
}

function alphaStrikeJumpSystem(entity: MekEntity): AlphaStrikeJumpSystem {
  const jumpJet = entity.equipment().find(mount => mount.equipment?.hasFlag('F_JUMP_JET'))?.equipment;
  if (!jumpJet) return 'none';
  if (jumpJet.hasFlag('S_IMPROVED') && jumpJet.hasFlag('S_PROTOTYPE')) return 'prototype-improved';
  return jumpJet.hasFlag('S_IMPROVED') ? 'improved' : 'standard';
}




