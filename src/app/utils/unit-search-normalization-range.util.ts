import type { UnitSearchNumericRange } from '../models/unit-search-result.model';

export const MIN_NORMALIZATION_SKILL = 0;
export const MAX_NORMALIZATION_SKILL = 8;

/** Updates one range bound while preserving an ordered inclusive range. */
export function updateNumericRangeBound(
    range: UnitSearchNumericRange,
    bound: 'min' | 'max',
    value: number,
): UnitSearchNumericRange {
    return bound === 'min'
        ? { min: value, max: Math.max(value, range.max) }
        : { min: Math.min(range.min, value), max: value };
}

export function isValidNormalizationSkillRange(range: UnitSearchNumericRange): boolean {
    return Number.isInteger(range.min)
        && Number.isInteger(range.max)
        && range.min >= MIN_NORMALIZATION_SKILL
        && range.max <= MAX_NORMALIZATION_SKILL
        && range.min <= range.max;
}

export function isWithinNumericRange(value: number, range: UnitSearchNumericRange): boolean {
    return value >= range.min && value <= range.max;
}
