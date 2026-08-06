// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/** Inclusive numeric range used by Classic BV normalization. */
export interface UnitSearchNumericRange {
    readonly min: number;
    readonly max: number;
}

/** Default maximum and sentinel for preserving unbounded Classic BV selection behavior. */
export const DEFAULT_CLASSIC_BV_NORMALIZATION_MAX = 999_999;
export const DEFAULT_CLASSIC_BV_NORMALIZATION_MAX_DELTA = 8;
/** Default maximum and sentinel for preserving unbounded Alpha Strike PV selection behavior. */
export const DEFAULT_ALPHA_STRIKE_PV_NORMALIZATION_MAX = 9_999;

/** User-selected settings for matching a unit to a target adjusted BV. */
export interface BvNormalizationSettings {
    readonly targetBv: UnitSearchNumericRange;
    readonly gunnery: UnitSearchNumericRange;
    /** Ignored for units whose Piloting value is mandatory. */
    readonly piloting: UnitSearchNumericRange;
    /** Ignored for units whose Piloting value is mandatory. */
    readonly maxDelta: number;
}

/** User-selected settings for matching a unit to a target adjusted PV. */
export interface PvNormalizationSettings {
    readonly targetPv: UnitSearchNumericRange;
    readonly skill: UnitSearchNumericRange;
}

/** Active normalization request. The discriminant prevents incompatible settings combinations. */
export type UnitSearchNormalization =
    | { readonly kind: 'bv'; readonly settings: BvNormalizationSettings }
    | { readonly kind: 'pv'; readonly settings: PvNormalizationSettings };

/** The deterministic adjusted value and skill selection for a normalized search result. */
export type UnitSearchNormalizationMatch =
    | {
        readonly kind: 'bv';
        readonly adjustedValue: number;
        readonly gunnery: number;
        /** The effective Piloting value used by BV calculation and force addition. */
        readonly piloting: number;
    }
    | {
        readonly kind: 'pv';
        readonly adjustedValue: number;
        readonly skill: number;
    };

export function getNormalizationGunnery(match: UnitSearchNormalizationMatch): number {
    return match.kind === 'bv' ? match.gunnery : match.skill;
}

export function getNormalizationPiloting(match: UnitSearchNormalizationMatch): number {
    return match.kind === 'bv' ? match.piloting : match.skill;
}

export type UnitSearchBudgetMode = 'force-limit' | 'bv-normalization' | 'pv-normalization' | null;
