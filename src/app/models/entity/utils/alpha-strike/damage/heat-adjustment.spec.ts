// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
  adjustAlphaStrikeDamageForHeat,
  alphaStrikeHeatCapacity,
  alphaStrikeMovementHeat,
  alphaStrikeWeaponHeat,
  alphaStrikeWeaponHeatForConversion,
} from './heat-adjustment';
import { AmmoEquipment, WeaponEquipment } from '../../../../equipment.model';
import { alphaStrikeHeatCapacityForEntity } from './heat-capacity';
import { TestBipedMekEntity } from '../../../testing/test-entities';
import { addTestEquipment, addTestEquipmentWithFlags } from '../../../testing/test-mounted-equipment';

const baseHeat = { capacity: 6, mediumFront: 10, mediumRear: 0, longFront: 10 };

describe('Alpha Strike heat adjustment', () => {
  it('does not adjust at the heat-capacity boundary', () => {
    const result = adjustAlphaStrikeDamageForHeat([4, 5, 3, 0], baseHeat);
    expect(result.front).toEqual([4, 5, 3, 0]);
    expect(result.overheat).toBe(0);
    expect(result.overheatLong).toBeFalse();
  });

  it('adjusts short and medium with one factor and caps overheat', () => {
    const result = adjustAlphaStrikeDamageForHeat(
      [4, 10, 3, 0],
      { ...baseHeat, capacity: 0, mediumFront: 14 },
    );
    expect(result.front.slice(0, 2)).toEqual([0, 0]);
    expect(result.overheat).toBe(4);
  });

  it('uses rounded short damage when raw medium damage is zero', () => {
    const result = adjustAlphaStrikeDamageForHeat(
      [3, 0, 0, 0],
      { ...baseHeat, capacity: 2, mediumFront: 10 },
    );
    expect(result.front[0]).toBe(1);
    expect(result.overheat).toBe(2);
    expect(adjustAlphaStrikeDamageForHeat(
      [0.4, 0, 0, 0],
      { ...baseHeat, capacity: 2, mediumFront: 10 },
    ).overheat).toBe(0);
  });

  it('uses medium heat for long damage only when OVL is assigned', () => {
    const assigned = adjustAlphaStrikeDamageForHeat(
      [4, 5, 4, 2],
      { capacity: 6, mediumFront: 14, mediumRear: 0, longFront: 12 },
    );
    expect(assigned.overheat).toBe(2);
    expect(assigned.overheatLong).toBeTrue();
    expect(assigned.front[2]).toBeCloseTo(2.4, 12);
    expect(assigned.front[3]).toBeCloseTo(1.2, 12);

    const sameRounded = adjustAlphaStrikeDamageForHeat(
      [4, 5, 0.4, 0],
      { capacity: 6, mediumFront: 14, mediumRear: 0, longFront: 12 },
    );
    expect(sameRounded.overheatLong).toBeFalse();
    expect(sameRounded.front[2]).toBe(0.4);
  });

  it('uses long heat for aerospace extreme damage without OVL', () => {
    const result = adjustAlphaStrikeDamageForHeat(
      [9.14, 9.14, 6.8, 4.4],
      { capacity: 50, mediumFront: 71, mediumRear: 0, longFront: 58 },
    );

    expect(result.overheat).toBe(3);
    expect(result.overheatLong).toBeFalse();
    expect(result.front[2]).toBe(6.8);
    expect(result.front[3]).toBeCloseTo(4.4 * 50 / 54, 12);
  });

  it('applies independent long heat when no overheat is produced', () => {
    const result = adjustAlphaStrikeDamageForHeat(
      [1, 0.4, 4, 2],
      { capacity: 6, mediumFront: 11, mediumRear: 0, longFront: 12 },
    );
    expect(result.overheat).toBe(0);
    expect(result.front[2]).toBe(3);
    expect(result.front[3]).toBe(1.5);
  });

  it('rejects invalid inputs without mutating vectors', () => {
    const vector = Object.freeze([1, 2, 3, 4]) as unknown as [number, number, number, number];
    expect(adjustAlphaStrikeDamageForHeat(vector, baseHeat).front).toEqual([1, 2, 3, 4]);
    expect(vector).toEqual([1, 2, 3, 4]);
    expect(() => adjustAlphaStrikeDamageForHeat(vector, { ...baseHeat, capacity: -1 })).toThrowError(RangeError);
    expect(() => adjustAlphaStrikeDamageForHeat([1, Number.NaN, 0, 0], baseHeat)).toThrowError(RangeError);
  });
});

describe('Alpha Strike movement heat', () => {
  const input = {
    jumpMove: 8, jumpSystem: 'standard' as const, xxlEngine: false,
    industrial: false, engineInstalled: true, runHeat: 2,
  };

  it('covers standard, improved, prototype-improved, and XXL jumps', () => {
    expect(alphaStrikeMovementHeat(input)).toBe(4);
    expect(alphaStrikeMovementHeat({ ...input, xxlEngine: true })).toBe(8);
    expect(alphaStrikeMovementHeat({ ...input, jumpSystem: 'improved' })).toBe(3);
    expect(alphaStrikeMovementHeat({ ...input, jumpSystem: 'improved', xxlEngine: true })).toBe(4);
    expect(alphaStrikeMovementHeat({ ...input, jumpSystem: 'prototype-improved' })).toBe(8);
    expect(alphaStrikeMovementHeat({ ...input, jumpSystem: 'prototype-improved', xxlEngine: true })).toBe(8);
    expect(alphaStrikeMovementHeat({ ...input, jumpMove: 2, jumpSystem: 'prototype-improved' })).toBe(3);
  });

  it('uses run heat only for an installed non-industrial engine', () => {
    expect(alphaStrikeMovementHeat({ ...input, jumpMove: 0, jumpSystem: 'none' })).toBe(2);
    expect(alphaStrikeMovementHeat({ ...input, jumpMove: 0, jumpSystem: 'none', industrial: true })).toBe(0);
    expect(alphaStrikeMovementHeat({ ...input, jumpMove: 0, jumpSystem: 'none', engineInstalled: false })).toBe(0);
  });
});

describe('Alpha Strike heat capacity', () => {
  it('adds each conversion-only capacity bonus once', () => {
    expect(alphaStrikeHeatCapacity({
      baseCapacity: 10,
      coolantPodCount: 2,
      partialWing: true,
      radicalHeatSink: true,
      emergencyCoolantSystem: true,
    })).toBe(17);
  });

  it('rejects invalid capacity values', () => {
    expect(() => alphaStrikeHeatCapacity({
      baseCapacity: Number.POSITIVE_INFINITY,
      coolantPodCount: 0,
      partialWing: false,
      radicalHeatSink: false,
      emergencyCoolantSystem: false,
    })).toThrowError(RangeError);
  });
});

describe('Alpha Strike weapon heat', () => {
  it('uses an exported Alpha Strike heat override', () => {
    expect(alphaStrikeWeaponHeat({
      heat: 1, alphaStrikeHeatOverride: 15, ammoType: 'NA', oneShot: false,
    })).toBe(15);
  });

  it('applies rapid-fire multipliers after resolving base heat', () => {
    expect(alphaStrikeWeaponHeat({
      heat: 2, ammoType: 'AC_ROTARY', oneShot: false,
    })).toBe(12);
    expect(alphaStrikeWeaponHeat({
      heat: 2, ammoType: 'AC_ULTRA', oneShot: false,
    })).toBe(4);
    expect(alphaStrikeWeaponHeat({
      heat: 2, ammoType: 'AC_ULTRA_THB', oneShot: false,
    })).toBe(4);
  });

  it('excludes one-shot weapons and rejects invalid heat', () => {
    expect(alphaStrikeWeaponHeat({
      heat: 100, ammoType: 'NA', oneShot: true,
    })).toBe(0);
    expect(() => alphaStrikeWeaponHeat({
      heat: -1, ammoType: 'NA', oneShot: false,
    })).toThrowError(RangeError);
  });

  it('makes the one-shot inclusion policy explicit for mounted weapons', () => {
    const weapon = new WeaponEquipment({
      id: 'test-one-shot', name: 'Test One-Shot', type: 'weapon',
      flags: ['F_ONE_SHOT'],
      weapon: { heat: 6, ammoType: 'NA' },
    });
    expect(alphaStrikeWeaponHeatForConversion(weapon)).toBe(0);
    expect(alphaStrikeWeaponHeatForConversion(weapon, true)).toBe(6);
  });
});

describe('Alpha Strike entity heat capacity', () => {
  it('adds equipment-derived capacity bonuses to the provided family base capacity', () => {
    const entity = new TestBipedMekEntity();
    addTestEquipment(entity, new AmmoEquipment({
      id: 'coolant-pod', name: 'Coolant Pod', type: 'ammo',
      ammo: { type: 'COOLANT_POD', shots: 1 },
    }));
    addTestEquipmentWithFlags(entity, ['F_PARTIAL_WING', 'F_RADICAL_HEATSINK']);

    expect(alphaStrikeHeatCapacityForEntity(entity, 10)).toBe(15);
  });
});
