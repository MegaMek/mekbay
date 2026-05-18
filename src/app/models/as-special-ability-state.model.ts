/**
 * Represents a special ability with both original and effective values.
 */
export interface SpecialAbilityState {
    original: string;
    effective: string;
    /** True if this ability is exhausted (should show strikethrough) */
    isExhausted?: boolean;
    /** For consumable abilities, how many have been consumed */
    consumedCount?: number;
    /** For consumable abilities, the max count */
    maxCount?: number;
}