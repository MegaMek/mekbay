// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { AlphaStrikeArcStats, AlphaStrikeUnitStats, ASUnitTypeCode } from '../../../../unit-summary.model';
import { adjustPointValueForSkill } from '../../../../../utils/pv-skill-adjustment.util';

type DamageRange = readonly [number, number, number];
type AbilitySource = readonly string[];

const LARGE_AEROSPACE_TYPES = new Set<ASUnitTypeCode>(['SC', 'DS', 'DA', 'SS', 'JS', 'WS']);
const AEROSPACE_TYPES = new Set<ASUnitTypeCode>(['AF', 'CF', ...LARGE_AEROSPACE_TYPES]);
const ARTILLERY_VALUES: Readonly<Record<string, number>> = {
  ARTAIS: 12, ARTAC: 12, ARTT: 6, ARTS: 12, ARTBA: 6, ARTLTC: 12, ARTSC: 6,
  ARTCM5: 30, ARTCM7: 54, ARTCM9: 72, ARTCM12: 93, ARTLT: 27, ARTTC: 3,
};
const C3_ABILITIES = ['C3BSM', 'C3BSS', 'C3EM', 'C3I', 'C3M', 'C3S', 'AC3', 'NC3', 'NOVA'];
const BRAWLER_EXCLUSIONS = [
  'BT', ...Object.keys(ARTILLERY_VALUES), ...C3_ABILITIES, 'C3RS', 'ECM', 'AECM', 'MEC', 'XMEC',
];

/** Calculates Alpha Strike PV from a completed Alpha Strike element. */
export function calculateAlphaStrikePointValue(stats: AlphaStrikeUnitStats, skill = 4): number {
  if (!Number.isInteger(skill) || skill < 0) {
    throw new RangeError('Alpha Strike skill must be a non-negative integer.');
  }
  const base = Math.max(1, Math.round(basePointValue(stats)));
  return adjustPointValueForSkill(base, skill);
}

function basePointValue(stats: AlphaStrikeUnitStats): number {
  const abilities = stats.specials;
  const highestMove = Math.max(0, ...Object.values(stats.MVm));
  const largeAero = LARGE_AEROSPACE_TYPES.has(stats.TP);
  const aero = largeAero || stats.TP === 'AF' || stats.TP === 'CF'
    || (stats.TP === 'SV' && ['a', 'k', 'i', 'p'].some(mode => mode in stats.MVm));

  let offense = largeAero ? largeAerospaceDamage(stats) : standardOffense(stats);
  if (!largeAero && ['BM', 'IM', 'PM'].includes(stats.TP)) offense += stats.SZ / 2;
  offense += offensiveAbilityValue(abilities, highestMove, stats.SZ, stats.OV, aero);
  if (largeAero) offense += arcOffensiveAbilityValue(stats);
  offense *= offensiveBlanketMultiplier(stats.TP, abilities);
  if (largeAero) offense /= largeAerospaceDivisor(stats.TP);

  let defense = movementDefense(stats, highestMove, aero);
  defense += defensiveAbilityValue(stats, abilities, aero, largeAero);
  defense += defensiveIntegrity(stats, abilities, aero, largeAero);

  const initialSubtotal = offense + defense;
  let subtotal = initialSubtotal;
  if (aero) {
    subtotal += c3Bonus(initialSubtotal, abilities);
  } else {
    subtotal += agileBonus(stats, abilities);
    subtotal += c3Bonus(initialSubtotal, abilities);
    subtotal -= brawlerPenalty(stats, abilities, highestMove, initialSubtotal);
  }
  return subtotal + forceBonus(abilities);
}

function standardOffense(stats: AlphaStrikeUnitStats): number {
  const standard = damageVector(stats.dmg.dmgS, stats.dmg.dmgM, stats.dmg.dmgL, true);
  const tor = vectorAbility(stats.specials, 'TOR', true);
  const damage: DamageRange = [standard[0] + tor[0], standard[1] + tor[1], standard[2] + tor[2]];
  let result = damage[0] + 2 * damage[1] + damage[2];
  if (stats.OV >= 1) {
    let overheat = 1 + 0.5 * (stats.OV - 1);
    if (damage[1] + damage[2] === 0) overheat /= 2;
    result += overheat;
  }
  return result;
}

function offensiveAbilityValue(
  abilities: AbilitySource,
  highestMove: number,
  size: number,
  overheat: number,
  aero: boolean,
): number {
  let value = 0;
  if (has(abilities, 'TAG')) value += 0.5;
  if (has(abilities, 'LTAG')) value += 0.25;
  value += optionalCount(abilities, 'SNARC');
  value += optionalCount(abilities, 'INARC');
  value += 0.5 * optionalCount(abilities, 'CNARC');
  if (has(abilities, 'TSM')) value += 1;
  if (has(abilities, 'ECS')) value += 0.25;
  if (has(abilities, 'MEL')) value += 0.5;
  value += scalar(abilities, 'MDS');
  value += scalar(abilities, 'MTAS');
  value += 0.25 * scalar(abilities, 'BTAS');
  value += 5 * scalar(abilities, 'TSEMP');
  value += Math.min(5, scalar(abilities, 'TSEMP-O'));
  if (has(abilities, 'BT')) value += aero ? size : 0.5 * highestMove * size;
  value += vectorAbility(abilities, 'IATM', false)[2];
  if (has(abilities, 'OVL')) value += 0.25 * overheat;
  value += scalar(abilities, 'BOMB');
  const ht = vectorAbility(abilities, 'HT', false);
  value += Math.max(...ht) + (ht[1] > 0 ? 0.5 : 0);
  value += singleDamageAbility(abilities, 'IF');
  if (has(abilities, 'RHS')) value += has(abilities, 'OVL') ? 1 : overheat > 0 ? 0.5 : 0.25;
  value += artilleryValue(abilities);
  return value;
}

function offensiveBlanketMultiplier(type: ASUnitTypeCode, abilities: AbilitySource): number {
  let multiplier = 1;
  if (has(abilities, 'ATAC')) multiplier += 0.1;
  if (has(abilities, 'VRT')) multiplier += 0.1;
  if (has(abilities, 'SHLD')) multiplier -= 0.1;
  if ((type === 'SV' || type === 'IM') && !has(abilities, 'AFC') && !has(abilities, 'BFC')) multiplier -= 0.2;
  if (has(abilities, 'BFC')) multiplier -= 0.1;
  return multiplier;
}

function movementDefense(stats: AlphaStrikeUnitStats, highestMove: number, aero: boolean): number {
  if (aero) return 4 + highestMove / 4 + (highestMove >= 10 ? 1 : highestMove >= 7 ? 0.5 : 0);
  let value = highestMove / 8;
  if ('a' in stats.MVm) value += stats.MVm['a'] / 4 + (stats.MVm['a'] >= 10 ? 1 : 0);
  if ('j' in stats.MVm) value += 0.5;
  return value;
}

function defensiveAbilityValue(
  stats: AlphaStrikeUnitStats,
  abilities: AbilitySource,
  aero: boolean,
  largeAero: boolean,
): number {
  const armorThird = Math.floor(stats.Arm / 3);
  const barFactor = has(abilities, 'BAR') ? 0.5 : 1;
  if (aero) {
    let value = largeAero ? arcScalarValue(stats, 'PNT') : scalar(abilities, 'PNT');
    if (has(abilities, 'STL')) value += 2;
    if (has(abilities, 'RCA')) value += barFactor * armorThird;
    return value;
  }
  let value = 0;
  if (has(abilities, 'ABA')) value += 0.5;
  if (has(abilities, 'AMS')) value += 1;
  if (has(abilities, 'FR')) value += 0.5;
  if (has(abilities, 'RAMS')) value += 1.25;
  if (has(abilities, 'BHJ2')) value += barFactor * armorThird;
  if (has(abilities, 'RCA')) value += barFactor * armorThird;
  if (has(abilities, 'SHLD')) value += barFactor * armorThird;
  if (has(abilities, 'BHJ3')) value += barFactor * 1.5 * armorThird;
  if (has(abilities, 'BRA')) value += barFactor * 0.75 * armorThird;
  if (has(abilities, 'IRA')) value += barFactor * 0.5 * armorThird;
  if (has(abilities, 'CR') && stats.Str >= 3) value += 0.25;
  if (has(abilities, 'ARM') && stats.Str > 1) value += 0.5;
  return value;
}

function defensiveIntegrity(
  stats: AlphaStrikeUnitStats,
  abilities: AbilitySource,
  aero: boolean,
  largeAero: boolean,
): number {
  const barFactor = has(abilities, 'BAR') ? 0.5 : 1;
  if (largeAero) return 1.5 * stats.Arm * barFactor + stats.Str + 0.5 * stats.Th * stats.SZ;
  let integrity: number;
  if (aero) {
    integrity = stats.Arm * barFactor * Math.min(1.3 + 0.1 * stats.Th, 1.9) + stats.Str;
  } else {
    let armorMultiplier = 2;
    if (stats.TP === 'CV' || stats.TP === 'SV') {
      const modes = Object.keys(stats.MVm);
      if (modes.some(mode => ['t', 'n', 's'].includes(mode))) armorMultiplier = 1.8;
      else if (modes.some(mode => ['h', 'w'].includes(mode))) armorMultiplier = 1.7;
      else if (modes.some(mode => ['v', 'g'].includes(mode))) armorMultiplier = 1.5;
      if (has(abilities, 'ARS')) armorMultiplier += 0.1;
    }
    armorMultiplier *= barFactor;
    const structureMultiplier = stats.TP === 'CI' || stats.TP === 'BA' ? 2
      : stats.TP === 'IM' || has(abilities, 'BAR') ? 0.5 : 1;
    integrity = stats.Arm * armorMultiplier + stats.Str * structureMultiplier;
  }
  return roundToHalf(integrity * defenseFactor(stats, abilities, aero));
}

function defenseFactor(stats: AlphaStrikeUnitStats, abilities: AbilitySource, aero: boolean): number {
  let movementModifier = stats.TMM ?? 0;
  const jumpCapable = 'j' in stats.MVm;
  const noStandardDamage = !Object.values(stats.dmg).slice(0, 4).some(value => damageValue(String(value), true) > 0);
  if (jumpCapable && ((stats.TP === 'CI' || stats.TP === 'BA')
    || (noStandardDamage && !has(abilities, 'TSEMP')
      && !Object.keys(ARTILLERY_VALUES).some(ability => has(abilities, ability))))) {
    movementModifier += 1;
  }
  let rating = has(abilities, 'MAS') && movementModifier < 3 ? 3
    : has(abilities, 'LMAS') && movementModifier < 2 ? 2 : movementModifier;
  if (aero || AEROSPACE_TYPES.has(stats.TP)) rating += 2;
  if (stats.TP === 'DS' || stats.TP === 'DA') rating -= 2;
  if (stats.TP === 'BA' || stats.TP === 'PM') rating += 1;
  if (stats.TP !== 'BM' && stats.TP !== 'IM' && ('g' in stats.MVm || 'v' in stats.MVm)) rating += 1;
  if (has(abilities, 'STL')) rating += 1;
  if (['LG', 'SLG', 'VLG'].some(ability => has(abilities, ability))) rating -= 1;
  rating += 0.5 * scalar(abilities, 'JMPS');
  rating += 0.5 * scalar(abilities, 'SUBS');
  return 1 + (rating <= 2 ? 0.1 : 0.25) * rating;
}

function agileBonus(stats: AlphaStrikeUnitStats, abilities: AbilitySource): number {
  const modifiedTmm = (stats.TMM ?? 0) + 0.5 * scalar(abilities, 'JMPS') + 0.5 * scalar(abilities, 'SUBS');
  if (modifiedTmm <= 1) return 0;
  const short = damageValue(stats.dmg.dmgS, true);
  const medium = damageValue(stats.dmg.dmgM, true);
  if (medium > 0) return roundToHalf((modifiedTmm - 1) * medium);
  if ((stats.TMM ?? 0) >= 3) return roundToHalf((modifiedTmm - 2) * short);
  return 0;
}

function brawlerPenalty(
  stats: AlphaStrikeUnitStats,
  abilities: AbilitySource,
  highestMove: number,
  subtotal: number,
): number {
  if (highestMove < 2 || BRAWLER_EXCLUSIONS.some(ability => has(abilities, ability))
    || (has(abilities, 'CAR') && scalar(abilities, 'CAR') <= 8)) return 0;
  const standard = damageVector(stats.dmg.dmgS, stats.dmg.dmgM, stats.dmg.dmgL, true);
  const tor = vectorAbility(abilities, 'TOR', true);
  const short = standard[0] + tor[0];
  const medium = standard[1] + tor[1];
  const long = standard[2] + tor[2];
  const onlyShort = medium + long === 0 && short > 0;
  const onlyShortMedium = long === 0 && short + medium > 0;
  const multiplier = highestMove >= 6 && highestMove <= 10 && onlyShort ? 0.25
    : highestMove < 6 && onlyShort ? 0.5
      : highestMove < 6 && onlyShortMedium ? 0.25 : 0;
  return roundToHalf(multiplier * subtotal);
}

function c3Bonus(subtotal: number, abilities: AbilitySource): number {
  return C3_ABILITIES.some(ability => has(abilities, ability)) ? roundToHalf(0.05 * subtotal) : 0;
}

function forceBonus(abilities: AbilitySource): number {
  let value = 0;
  for (const [ability, bonus] of Object.entries({ AECM: 3, BH: 2, C3RS: 2, ECM: 2, RCN: 2, TRN: 2, LPRB: 1, PRB: 1, LECM: 0.5 })) {
    if (has(abilities, ability)) value += bonus;
  }
  const mhq = scalar(abilities, 'MHQ');
  if (mhq > 0) value += mhq <= 4 ? mhq : 4 + Math.ceil(0.2 * (mhq - 5));
  return value;
}

function largeAerospaceDamage(stats: AlphaStrikeUnitStats): number {
  const forwardArcs = [stats.frontArc, stats.leftArc, stats.rightArc];
  let standard = sumArcDamage(forwardArcs, ['STD', 'MSL']);
  let capital = sumArcDamage(forwardArcs, ['CAP', 'SCAP']);
  if ('a' in stats.MVm) return standard + capital / 4;
  standard += sumArcDamage([stats.rearArc], ['STD', 'MSL']);
  capital += sumArcDamage([stats.rearArc], ['CAP', 'SCAP']);
  return standard + capital / 5;
}

function sumArcDamage(
  arcs: readonly (AlphaStrikeArcStats | undefined)[],
  families: readonly ('STD' | 'MSL' | 'CAP' | 'SCAP')[],
): number {
  let value = 0;
  for (const arc of arcs) for (const family of families) {
    if (!arc) continue;
    const vector = arc[family];
    value += damageValue(vector.dmgS, false) + damageValue(vector.dmgM, false) + damageValue(vector.dmgL, false);
  }
  return value;
}

function arcOffensiveAbilityValue(stats: AlphaStrikeUnitStats): number {
  return arcs(stats).reduce((sum, arc) => sum + artilleryValue(arc.specials)
    + optionalCount(arc.specials, 'SNARC') + optionalCount(arc.specials, 'INARC')
    + 0.5 * optionalCount(arc.specials, 'CNARC'), 0);
}

function arcScalarValue(stats: AlphaStrikeUnitStats, ability: string): number {
  return arcs(stats).reduce((sum, arc) => sum + scalar(arc.specials, ability), 0);
}

function arcs(stats: AlphaStrikeUnitStats): AlphaStrikeArcStats[] {
  return [stats.frontArc, stats.leftArc, stats.rightArc, stats.rearArc]
    .filter((arc): arc is AlphaStrikeArcStats => arc !== undefined);
}

function largeAerospaceDivisor(type: ASUnitTypeCode): number {
  if (type === 'WS' || type === 'DS' || type === 'SC') return 4;
  if (type === 'SS' || type === 'JS' || type === 'SV') return 3;
  return 1;
}

function artilleryValue(abilities: AbilitySource): number {
  return Object.entries(ARTILLERY_VALUES).reduce((sum, [ability, value]) =>
    sum + value * hyphenatedCount(abilities, ability), 0);
}

function has(abilities: AbilitySource, ability: string): boolean {
  return abilities.includes(ability) || scalar(abilities, ability) > 0 || hyphenatedCount(abilities, ability) > 0;
}

function scalar(abilities: AbilitySource, ability: string): number {
  for (const value of abilities) {
    if (!value.startsWith(ability)) continue;
    const suffix = value.slice(ability.length);
    if (SIGNED_DECIMAL.test(suffix)) return Number(suffix);
  }
  return 0;
}

function optionalCount(abilities: AbilitySource, ability: string): number {
  return abilities.includes(ability) ? 1 : scalar(abilities, ability);
}

function hyphenatedCount(abilities: AbilitySource, ability: string): number {
  const prefix = `${ability}-`;
  for (const value of abilities) {
    if (!value.startsWith(prefix)) continue;
    const suffix = value.slice(prefix.length);
    if (UNSIGNED_INTEGER.test(suffix)) return Number(suffix);
  }
  return 0;
}

function vectorAbility(abilities: AbilitySource, ability: string, minimalAsHalf: boolean): DamageRange {
  const prefix = `${ability}`;
  const value = abilities.find(candidate => candidate.startsWith(prefix)
    && candidate.slice(prefix.length).split('/').length === 3);
  if (!value) return [0, 0, 0];
  const [short, medium, long] = value.slice(prefix.length).split('/');
  return damageVector(short, medium, long, minimalAsHalf);
}

function singleDamageAbility(abilities: AbilitySource, ability: string): number {
  const value = abilities.find(candidate => candidate.startsWith(ability));
  return value ? damageValue(value.slice(ability.length), true) : 0;
}

function damageVector(short: string, medium: string, long: string, minimalAsHalf: boolean): DamageRange {
  return [
    damageValue(short, minimalAsHalf),
    damageValue(medium, minimalAsHalf),
    damageValue(long, minimalAsHalf),
  ];
}

function damageValue(value: string, minimalAsHalf: boolean): number {
  if (value === '0*') return minimalAsHalf ? 0.5 : 0;
  if (value === '-' || value === '' || value === '0') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundToHalf(value: number): number {
  return 0.5 * Math.round(value * 2);
}

const SIGNED_DECIMAL = /^-?\d+(?:\.\d+)?$/;
const UNSIGNED_INTEGER = /^\d+$/;
