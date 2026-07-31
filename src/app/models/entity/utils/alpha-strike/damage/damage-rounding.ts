import type { AlphaStrikeDamage } from './damage-types';
import type { RawDamageVector } from './damage-types';

const TENTH_ROUNDING_TOLERANCE = 0.000001;

export function roundUpToTenth(value: number): number {
  requireFinite(value);
  const intermediate = value * 10;
  let result = Math.trunc(intermediate);
  if (intermediate - Math.trunc(intermediate) > TENTH_ROUNDING_TOLERANCE) result++;
  return result / 10;
}

export function alphaStrikeRoundUp(value: number): number {
  requireFinite(value);
  return Math.round(value + 0.4);
}

/** Java ASDamage.createDualRoundedUp, serialized with an explicit zero. */
export function dualRoundedUpDamage(value: number): string {
  const intermediate = roundUpToTenth(value);
  if (intermediate > 0 && intermediate < 0.5) return '0*';
  return String(intermediate < 0.5 ? 0 : alphaStrikeRoundUp(intermediate));
}

/** Java ASDamage.createDualRoundedNormal, serialized with an explicit zero. */
export function dualRoundedNormalDamage(value: number): string {
  const intermediate = roundUpToTenth(value);
  if (intermediate > 0 && intermediate < 0.5) return '0*';
  return String(Math.max(0, Math.round(intermediate)));
}

export function toStandardDamage(values: Readonly<RawDamageVector>): AlphaStrikeDamage {
  return {
    dmgS: dualRoundedUpDamage(values[0]),
    dmgM: dualRoundedUpDamage(values[1]),
    dmgL: dualRoundedUpDamage(values[2]),
    dmgE: dualRoundedUpDamage(values[3]),
  };
}

function requireFinite(value: number): void {
  if (!Number.isFinite(value)) throw new RangeError('Alpha Strike damage values must be finite.');
}
