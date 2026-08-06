// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
  alphaStrikeRoundUp,
  dualRoundedNormalDamage,
  dualRoundedUpDamage,
  roundUpToTenth,
  toStandardDamage,
} from './damage-rounding';

describe('Alpha Strike damage rounding', () => {
  it('rounds any meaningful fraction up to the nearest tenth', () => {
    expect(roundUpToTenth(0)).toBe(0);
    expect(roundUpToTenth(0.4)).toBe(0.4);
    expect(roundUpToTenth(0.401)).toBe(0.5);
    expect(roundUpToTenth(1.20000001)).toBe(1.2);
    expect(roundUpToTenth(1.200001)).toBe(1.3);
  });

  it('uses Java-compatible Alpha Strike upward integer rounding', () => {
    expect(alphaStrikeRoundUp(0)).toBe(0);
    expect(alphaStrikeRoundUp(0.1)).toBe(1);
    expect(alphaStrikeRoundUp(1.1)).toBe(2);
  });

  it('creates dual-rounded-up standard damage at all boundaries', () => {
    expect(dualRoundedUpDamage(0)).toBe('0');
    expect(dualRoundedUpDamage(0.000001)).toBe('0*');
    expect(dualRoundedUpDamage(0.4)).toBe('0*');
    expect(dualRoundedUpDamage(0.401)).toBe('1');
    expect(dualRoundedUpDamage(1.2)).toBe('2');
  });

  it('creates dual-rounded-normal special damage', () => {
    expect(dualRoundedNormalDamage(0)).toBe('0');
    expect(dualRoundedNormalDamage(0.4)).toBe('0*');
    expect(dualRoundedNormalDamage(0.401)).toBe('1');
    expect(dualRoundedNormalDamage(1.2)).toBe('1');
    expect(dualRoundedNormalDamage(1.5)).toBe('2');
  });

  it('converts all four standard range bands', () => {
    expect(toStandardDamage([0.4, 0.5, 1.2, 0])).toEqual({
      dmgS: '0*', dmgM: '1', dmgL: '2', dmgE: '0',
    });
  });

  it('rejects non-finite input', () => {
    expect(() => roundUpToTenth(Number.NaN)).toThrowError(RangeError);
    expect(() => dualRoundedUpDamage(Number.POSITIVE_INFINITY)).toThrowError(RangeError);
  });
});
