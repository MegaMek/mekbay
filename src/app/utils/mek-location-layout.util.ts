// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { LEG_LOCATIONS, type MekConfig } from '../models/entity/types/mek';
import type { MekLocation } from '../models/entity/types/locations';

export type MekLocationForm = MekConfig | 'biped' | 'quad' | 'tripod' | 'lam' | 'quadvee';
export type MekCriticalLocationMatrix = readonly [
    readonly [MekLocation | null, MekLocation | null, MekLocation | null],
    readonly [MekLocation | null, MekLocation | null, MekLocation | null],
    readonly [MekLocation | null, MekLocation | null, MekLocation | null],
];

const BIPED_CRITICAL_LOCATION_MATRIX = Object.freeze([
    Object.freeze(['LA', 'HD', 'RA'] as const),
    Object.freeze(['LT', 'CT', 'RT'] as const),
    Object.freeze(['LL', null, 'RL'] as const),
] as const) satisfies MekCriticalLocationMatrix;

const TRIPOD_CRITICAL_LOCATION_MATRIX = Object.freeze([
    Object.freeze(['LA', 'HD', 'RA'] as const),
    Object.freeze(['LT', 'CT', 'RT'] as const),
    Object.freeze(['LL', 'CL', 'RL'] as const),
] as const) satisfies MekCriticalLocationMatrix;

const QUAD_CRITICAL_LOCATION_MATRIX = Object.freeze([
    Object.freeze(['FLL', 'HD', 'FRL'] as const),
    Object.freeze(['LT', 'CT', 'RT'] as const),
    Object.freeze(['RLL', null, 'RRL'] as const),
] as const) satisfies MekCriticalLocationMatrix;

/** Canonical 3x3 location geometry shared by generated sheets and live views. */
export function mekCriticalLocationMatrix(form: MekLocationForm): MekCriticalLocationMatrix {
    switch (form) {
        case 'Quad':
        case 'QuadVee':
        case 'quad':
        case 'quadvee':
            return QUAD_CRITICAL_LOCATION_MATRIX;
        case 'Tripod':
        case 'tripod':
            return TRIPOD_CRITICAL_LOCATION_MATRIX;
        default:
            return BIPED_CRITICAL_LOCATION_MATRIX;
    }
}

export function mekCriticalLocationCells(form: MekLocationForm): readonly (MekLocation | null)[] {
    return mekCriticalLocationMatrix(form).flat();
}

/** Number of numbered rows rendered for a location in a Mek critical table. */
export function mekCriticalTableRowCount(location: MekLocation): 6 | 12 {
    return location === 'HD' || LEG_LOCATIONS.has(location) ? 6 : 12;
}

/** Head first, then outside-to-inside on the left, center, and inside-to-outside on the right. */
export function mekDamageLocationOrder(form: MekLocationForm): readonly MekLocation[] {
    const matrix = mekCriticalLocationMatrix(form);
    return Object.freeze([
        matrix[0][1],
        matrix[0][0], matrix[2][0], matrix[1][0],
        matrix[1][1], matrix[2][1],
        matrix[1][2], matrix[2][2], matrix[0][2],
    ].filter((code): code is MekLocation => code !== null));
}
