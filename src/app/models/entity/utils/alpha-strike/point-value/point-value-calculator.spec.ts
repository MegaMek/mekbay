// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { AlphaStrikeArcStats, AlphaStrikeUnitStats } from '../../../../units.model';
import { adjustPointValueForSkill } from '../../../../../utils/pv-skill-adjustment.util';
import { calculateAlphaStrikePointValue } from './point-value-calculator';

describe('Alpha Strike point value', () => {
  it('calculates ground offense, defense, movement, and force bonuses', () => {
    const stats = element({
      TP: 'CV', SZ: 2, TMM: 1, MVm: { t: 8 }, MVp: 't', MV: '8t',
      Arm: 5, Str: 2, dmg: damage('2', '1', '0'), specials: ['AMS', 'ECM'],
    });

    expect(calculateAlphaStrikePointValue(stats)).toBe(20);
  });

  it('treats minimal standard damage as half a point for ordinary offense', () => {
    const noDamage = element({ TP: 'BM', SZ: 0, Arm: 4, Str: 1 });
    const minimalDamage = element({
      TP: 'BM', SZ: 0, Arm: 4, Str: 1, dmg: damage('0*', '0', '0'),
    });

    expect(calculateAlphaStrikePointValue(minimalDamage))
      .toBe(calculateAlphaStrikePointValue(noDamage) + 1);
  });

  it('uses aerospace movement and defense-factor semantics for support aircraft', () => {
    const stats = element({
      TP: 'SV', SZ: 1, TMM: 0, MVm: { a: 4 }, MVp: 'a', MV: '4a',
      Arm: 0, Str: 2, Th: 0, usesTh: true, usesE: true,
      specials: ['ATMO', 'RCN', 'VSTOL'],
    });

    expect(calculateAlphaStrikePointValue(stats)).toBe(10);
  });

  it('uses arc damage and large-aerospace integrity without defense-factor rounding', () => {
    const frontArc = arc();
    frontArc.STD = damage('4', '0', '0');
    frontArc.CAP = damage('0', '4', '0');
    const stats = element({
      TP: 'DA', SZ: 2, TMM: null, MVm: { a: 6 }, MVp: 'a', MV: '6a',
      Arm: 4, Str: 2, Th: 1, usesTh: true, usesE: true, usesArcs: true,
      frontArc, leftArc: arc(), rightArc: arc(), rearArc: arc(),
    });

    expect(calculateAlphaStrikePointValue(stats)).toBe(20);
  });

  it('applies better and worse skill adjustments at bracket boundaries', () => {
    expect(adjustPointValueForSkill(7, 3)).toBe(8);
    expect(adjustPointValueForSkill(8, 3)).toBe(10);
    expect(adjustPointValueForSkill(14, 5)).toBe(13);
    expect(adjustPointValueForSkill(15, 5)).toBe(13);
    expect(adjustPointValueForSkill(1, 10)).toBe(1);
  });

  it('rejects invalid skill and base-PV inputs', () => {
    expect(() => calculateAlphaStrikePointValue(element(), -1)).toThrowError(RangeError);
    expect(() => calculateAlphaStrikePointValue(element(), 1.5)).toThrowError(RangeError);
    expect(() => adjustPointValueForSkill(0, 4)).toThrowError(RangeError);
  });
});

function element(overrides: Partial<AlphaStrikeUnitStats> = {}): AlphaStrikeUnitStats {
  return {
    TP: 'CV', PV: 0, SZ: 1, TMM: 0, usesOV: false, OV: 0,
    MV: '0', MVm: {}, MVp: '', usesTh: false, Th: -1, Arm: 0, Str: 0,
    specials: [], dmg: damage('0', '0', '0'), usesE: false, usesArcs: false,
    ...overrides,
  };
}

function damage(short: string, medium: string, long: string): AlphaStrikeUnitStats['dmg'] {
  return { dmgS: short, dmgM: medium, dmgL: long, dmgE: '0' };
}

function arc(): AlphaStrikeArcStats {
  return {
    STD: damage('0', '0', '0'), CAP: damage('0', '0', '0'),
    MSL: damage('0', '0', '0'), SCAP: damage('0', '0', '0'), specials: [],
  };
}
