import { alphaStrikeRoundUp, dualRoundedUpDamage, roundUpToTenth } from './damage-rounding';
import type { WeaponEquipment } from '../../../../equipment.model';
import type { RawDamageVector } from './damage-types';

export type AlphaStrikeJumpSystem = 'none' | 'standard' | 'improved' | 'prototype-improved';

export interface AlphaStrikeMovementHeatInput {
  readonly jumpMove: number;
  readonly jumpSystem: AlphaStrikeJumpSystem;
  readonly xxlEngine: boolean;
  readonly industrial: boolean;
  readonly engineInstalled: boolean;
  readonly runHeat: number;
}

export interface AlphaStrikeCapacityInput {
  readonly baseCapacity: number;
  readonly coolantPodCount: number;
  readonly partialWing: boolean;
  readonly radicalHeatSink: boolean;
  readonly emergencyCoolantSystem: boolean;
}

export interface AlphaStrikeWeaponHeatInput {
  readonly equipmentId: string;
  readonly twHeat: number;
  readonly ammoType: string;
  readonly oneShot: boolean;
}

const ALPHA_STRIKE_WEAPON_HEAT_OVERRIDES: Readonly<Record<string, number>> = {
  ISERLargeLaserPrototype: 15,
  ISLargePulseLaserPrototype: 13,
  ISMediumPulseLaserPrototype: 7,
  ISMediumPulseLaserRecovered: 7,
  ISSmallPulseLaserPrototype: 4,
};

export interface AlphaStrikeHeatProfile {
  readonly capacity: number;
  readonly mediumFront: number;
  readonly mediumRear: number;
  readonly longFront: number;
}

export interface AlphaStrikeHeatAdjustmentResult {
  readonly front: RawDamageVector;
  readonly overheat: number;
  readonly overheatLong: boolean;
  readonly factors: Readonly<{
    mediumFront: number;
    mediumRear: number;
    longFront: number;
  }>;
}

export function alphaStrikeMovementHeat(input: AlphaStrikeMovementHeatInput): number {
  validateFiniteNonnegative(Object.values(input).filter(value => typeof value === 'number') as number[]);
  if (input.jumpMove <= 0 || input.jumpSystem === 'none') {
    return input.industrial || !input.engineInstalled ? 0 : input.runHeat;
  }
  if (input.jumpSystem === 'prototype-improved') return Math.max(3, input.jumpMove);
  if (input.jumpSystem === 'improved') {
    return input.xxlEngine
      ? Math.max(3, Math.floor(input.jumpMove / 2))
      : Math.max(3, alphaStrikeRoundUp(0.25 * input.jumpMove));
  }
  return input.xxlEngine
    ? Math.max(6, input.jumpMove)
    : Math.max(3, Math.floor(input.jumpMove / 2));
}

export function alphaStrikeHeatCapacity(input: AlphaStrikeCapacityInput): number {
  validateFiniteNonnegative([input.baseCapacity, input.coolantPodCount]);
  return input.baseCapacity
    + input.coolantPodCount
    + (input.partialWing ? 3 : 0)
    + (input.radicalHeatSink ? 1 : 0)
    + (input.emergencyCoolantSystem ? 1 : 0);
}

export function alphaStrikeWeaponHeat(input: AlphaStrikeWeaponHeatInput): number {
  validateFiniteNonnegative([input.twHeat]);
  if (input.oneShot) return 0;
  const heat = ALPHA_STRIKE_WEAPON_HEAT_OVERRIDES[input.equipmentId] ?? input.twHeat;
  const multiplier = input.ammoType === 'AC_ROTARY' ? 6
    : input.ammoType === 'AC_ULTRA' || input.ammoType === 'AC_ULTRA_THB' ? 2 : 1;
  return heat * multiplier;
}

/** Adapts canonical mounted-weapon data to Alpha Strike heat accounting. */
export function alphaStrikeWeaponHeatForConversion(
  weapon: WeaponEquipment,
  includeOneShotHeat = false,
): number {
  return alphaStrikeWeaponHeat({
    equipmentId: weapon.id,
    twHeat: weapon.heat,
    ammoType: weapon.ammoType,
    oneShot: !includeOneShotHeat && (weapon.oneShotCount ?? 0) > 0,
  });
}

export function adjustAlphaStrikeDamageForHeat(
  front: Readonly<RawDamageVector>,
  heat: AlphaStrikeHeatProfile,
): AlphaStrikeHeatAdjustmentResult {
  validateFiniteNonnegative([...front, heat.capacity, heat.mediumFront, heat.mediumRear, heat.longFront]);
  const mediumFront = heatFactor(heat.capacity, heat.mediumFront);
  const mediumRear = heatFactor(heat.capacity, heat.mediumRear);
  const longFront = heatFactor(heat.capacity, heat.longFront);
  const adjusted: RawDamageVector = [...front];
  adjusted[0] *= mediumFront;
  adjusted[1] *= mediumFront;

  let overheat = 0;
  if (mediumFront < 1) {
    if (front[1] === 0) {
      overheat = Math.min(4, Math.max(0,
        numericDualRoundedDamage(front[0]) - numericDualRoundedDamage(adjusted[0])));
    } else {
      overheat = Math.min(4, Math.max(0,
        roundedUpDamage(front[1]) - roundedUpDamage(adjusted[1])));
    }
  }

  let overheatLong = false;
  if (overheat > 0 && longFront < 1) {
    const rawLong = roundedUpDamage(front[2]);
    const trialLong = roundedUpDamage(front[2] * longFront);
    if (trialLong < rawLong) {
      overheatLong = true;
      adjusted[2] *= mediumFront;
      adjusted[3] *= mediumFront;
    }
  } else if (longFront < 1) {
    adjusted[2] *= longFront;
    // MegaMek's aero converter intentionally preserves this established behavior:
    // E checks the long adjustment but applies the medium factor.
    adjusted[3] *= mediumFront;
  }

  return {
    front: adjusted,
    overheat,
    overheatLong,
    factors: { mediumFront, mediumRear, longFront },
  };
}

function heatFactor(capacity: number, heat: number): number {
  return heat - 4 > capacity ? capacity / (heat - 4) : 1;
}

function roundedUpDamage(value: number): number {
  return alphaStrikeRoundUp(roundUpToTenth(value));
}

function numericDualRoundedDamage(value: number): number {
  const rendered = dualRoundedUpDamage(value);
  return rendered === '0' || rendered === '0*' ? 0 : Number(rendered);
}

function validateFiniteNonnegative(values: readonly number[]): void {
  if (values.some(value => !Number.isFinite(value) || value < 0)) {
    throw new RangeError('Alpha Strike heat values must be finite and nonnegative');
  }
}
